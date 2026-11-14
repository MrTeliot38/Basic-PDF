// Tests unitaires pour les étapes A3, A4 et A5 : images de fond, pages PDF, livret, impression et ZIP
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  OPS: {},
  Util: { transform: () => [1, 0, 0, 1, 0, 0] },
}));

import type { EditableTextBlock, TextStyle } from '../../src/types/pdf';
import { isBackgroundImageWithText } from '../../src/utils/pdfImageExtractor';
import {
  addBlankPageOperation,
  computeBookletSpreads,
  computePrintSheets,
  deletePageOperation,
  duplicatePageOperation,
  extractPagesToNewPdf,
  mergePdfOperation,
  movePageOperation,
  parsePageRanges,
  rotatePageOperation,
  splitPdfIntoMultiple,
} from '../../src/utils/pdfPagesOperations';
import { createZipBytes } from '../../src/utils/zipWriter';

const DEFAULT_STYLE: TextStyle = {
  fontFamily: 'Helvetica',
  fontSize: 12,
  color: '#111827',
  bold: false,
  italic: false,
};

function makeTextBlock(overrides: Partial<EditableTextBlock>): EditableTextBlock {
  return {
    id: 'tb-1',
    pageNumber: 1,
    source: 'pdf',
    status: 'original',
    origX: 100,
    origY: 100,
    origWidth: 160,
    origHeight: 20,
    x: 100,
    y: 100,
    width: 160,
    height: 20,
    originalText: 'Texte test',
    currentText: 'Texte test',
    style: DEFAULT_STYLE,
    detectedFontLabel: 'Helvetica',
    ...overrides,
  };
}

async function makeBlankPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    doc.addPage([595, 842]);
  }
  return await doc.save();
}

describe('Filtrage des images de fond portant du texte (A3)', () => {
  it("exclut une grande image de fond située sous un texte natif du PDF", () => {
    const bgRect = { x: 0, y: 0, width: 595, height: 842 };
    const textBlocks = [makeTextBlock({ source: 'pdf', origX: 80, origY: 120, origWidth: 200, origHeight: 18 })];
    expect(isBackgroundImageWithText(bgRect, textBlocks)).toBe(true);
  });

  it("autorise un logo ou une photo autonome qui ne porte pas de texte natif", () => {
    const logoRect = { x: 400, y: 60, width: 120, height: 80 };
    const textBlocks = [makeTextBlock({ source: 'pdf', origX: 60, origY: 220, origWidth: 240, origHeight: 18 })];
    expect(isBackgroundImageWithText(logoRect, textBlocks)).toBe(false);
  });

  it("autorise la sélection d'une image quand seul du texte OCR existe (document photographié)", () => {
    const scanRect = { x: 20, y: 20, width: 550, height: 800 };
    const ocrBlocks = [makeTextBlock({ source: 'ocr', origX: 80, origY: 120, origWidth: 200, origHeight: 18 })];
    expect(isBackgroundImageWithText(scanRect, ocrBlocks)).toBe(false);
  });
});

describe('Analyse des plages de pages et imposition livret (A5)', () => {
  it('analyse et déduplique une saisie utilisateur de plages de pages', () => {
    expect(parsePageRanges('1, 3-5, 4, 12', 6)).toEqual([1, 3, 4, 5]);
    expect(parsePageRanges('5-3', 6)).toEqual([3, 4, 5]);
    expect(parsePageRanges('', 6)).toEqual([]);
  });

  it("calcule l'ordre exact des cahiers d'un livret de 4 pages", () => {
    expect(computeBookletSpreads([1, 2, 3, 4])).toEqual([
      [4, 1],
      [2, 3],
    ]);
  });

  it('complète avec des faces blanches quand le nombre de pages dépasse un multiple de 4', () => {
    expect(computeBookletSpreads([1, 2, 3, 4, 5])).toEqual([
      [null, 1],
      [2, null],
      [null, 3],
      [4, 5],
    ]);
  });

  it('regroupe en 4 pages par feuille avec cases complémentaires nulles', () => {
    expect(computePrintSheets([1, 2, 3, 4, 5], 4, false)).toEqual([
      [1, 2, 3, 4],
      [5, null, null, null],
    ]);
  });
});

describe('Opérations réelles sur les pages PDF (A5)', () => {
  it('ajoute, duplique, déplace, pivote, fusionne, extrait et divise en maintenant le mapping des calques', async () => {
    const emptyMaps = {
      textBlocksByPage: { 3: [makeTextBlock({ id: 'tb-p3', pageNumber: 3 })] },
      imageBlocksByPage: {},
      annotationsByPage: {},
    };

    const pdf3 = await makeBlankPdf(3);
    const afterBlank = await addBlankPageOperation(pdf3, 1, emptyMaps);
    expect(afterBlank.numPages).toBe(4);
    expect(afterBlank.textBlocksByPage[4]?.[0].pageNumber).toBe(4);

    const afterMove = await movePageOperation(afterBlank.bytes, 4, 1, {
      textBlocksByPage: afterBlank.textBlocksByPage,
      imageBlocksByPage: {},
      annotationsByPage: {},
    });
    expect(afterMove.textBlocksByPage[1]?.[0].id).toBe('tb-p3');
    expect(afterMove.textBlocksByPage[1]?.[0].pageNumber).toBe(1);

    const afterDup = await duplicatePageOperation(afterMove.bytes, 2, {
      textBlocksByPage: afterMove.textBlocksByPage,
      imageBlocksByPage: {},
      annotationsByPage: {},
    });
    expect(afterDup.numPages).toBe(5);

    const afterRot = await rotatePageOperation(afterDup.bytes, 1, 90, {
      textBlocksByPage: afterDup.textBlocksByPage,
      imageBlocksByPage: {},
      annotationsByPage: {},
    });
    const loadedRot = await PDFDocument.load(afterRot.bytes);
    expect(loadedRot.getPage(0).getRotation().angle).toBe(90);

    const afterDel = await deletePageOperation(afterRot.bytes, 5, {
      textBlocksByPage: {},
      imageBlocksByPage: {},
      annotationsByPage: {},
    });
    expect(afterDel.numPages).toBe(4);

    const extra2 = await makeBlankPdf(2);
    const merged = await mergePdfOperation(afterDel.bytes, extra2, 4, {
      textBlocksByPage: {},
      imageBlocksByPage: {},
      annotationsByPage: {},
    });
    expect(merged.numPages).toBe(6);

    const extractedBytes = await extractPagesToNewPdf(merged.bytes, [2, 5]);
    expect((await PDFDocument.load(extractedBytes)).getPageCount()).toBe(2);

    const splitParts = await splitPdfIntoMultiple(merged.bytes, 'every-n', 2);
    expect(splitParts.map((p) => p.label)).toEqual(['pages-1-a-2', 'pages-3-a-4', 'pages-5-a-6']);
  });

  it("refuse de supprimer l'unique page restante d'un PDF", async () => {
    const pdf1 = await makeBlankPdf(1);
    await expect(
      deletePageOperation(pdf1, 1, {
        textBlocksByPage: {},
        imageBlocksByPage: {},
        annotationsByPage: {},
      }),
    ).rejects.toThrow(/dernière page/i);
  });
});

describe('Générateur ZIP autonome (A5)', () => {
  it('produit une archive ZIP valide contenant tous les fichiers', () => {
    const zip = createZipBytes([
      { name: 'page-1.png', bytes: new Uint8Array([1, 2, 3, 4]) },
      { name: 'page-2.png', bytes: new Uint8Array([5, 6, 7]) },
    ]);
    // Signature locale PK\x03\x04
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);

    const ascii = new TextDecoder('latin1').decode(zip);
    expect(ascii).toContain('page-1.png');
    expect(ascii).toContain('page-2.png');
    // Signature EOCD PK\x05\x06 à la fin
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });
});
