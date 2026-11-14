import { describe, expect, it } from 'vitest';
import type { EditableTextBlock } from '../../src/types/pdf';
import {
  buildRecognitionFontPool,
  computeDominantDocumentTextStyle,
  extractPrimaryFontName,
  extractScanBinaryCropFromRgba,
  findMatchingFontOptionValue,
  formatCssFontStack,
  harmonizeOcrParagraphFonts,
  isValidTextFontFamily,
} from '../../src/utils/fontRecognizer';

function createBlankRgba(width: number, height: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 255;
    buf[i + 1] = 255;
    buf[i + 2] = 255;
    buf[i + 3] = 255;
  }
  return buf;
}

function paintDarkRect(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let y = Math.max(0, Math.round(y0)); y <= Math.min(height - 1, Math.round(y1)); y += 1) {
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(width - 1, Math.round(x1)); x += 1) {
      const idx = (y * width + x) * 4;
      buf[idx] = 18;
      buf[idx + 1] = 20;
      buf[idx + 2] = 24;
    }
  }
}

function makeDummyBlock(overrides: Partial<EditableTextBlock> & { id: string }): EditableTextBlock {
  const baseStyle = overrides.style ?? {
    fontFamily: '"Times New Roman", serif',
    fontSize: 11,
    color: '#111827',
    bold: false,
    italic: false,
  };
  return {
    id: overrides.id,
    pageNumber: overrides.pageNumber ?? 1,
    originalText: overrides.originalText ?? 'Ligne exemple document',
    currentText: overrides.currentText ?? overrides.originalText ?? 'Ligne exemple document',
    origX: overrides.origX ?? 48,
    origY: overrides.origY ?? 100,
    origWidth: overrides.origWidth ?? 220,
    origHeight: overrides.origHeight ?? 14,
    x: overrides.x ?? overrides.origX ?? 48,
    y: overrides.y ?? overrides.origY ?? 100,
    width: overrides.width ?? overrides.origWidth ?? 220,
    height: overrides.height ?? overrides.origHeight ?? 14,
    style: { ...baseStyle },
    originalStyle: { ...(overrides.originalStyle ?? baseStyle) },
    lineItemsCount: overrides.lineItemsCount ?? 1,
    status: overrides.status ?? 'untouched',
    source: overrides.source ?? 'ocr',
    detectedFontLabel: overrides.detectedFontLabel,
  };
}

describe('Reconnaissance visuelle des polices et cohérence typographique', () => {
  it('distingue finement droit sans-serif, italique incliné, empattements serif et graisse', () => {
    const w = 160;
    const h = 44;

    // 1. Bâtons droits sans empattement (traits fins)
    const uprightBuf = createBlankRgba(w, h);
    for (let i = 0; i < 6; i += 1) {
      const gx = 16 + i * 20;
      paintDarkRect(uprightBuf, w, h, gx, 8, gx + 1, 35);
    }
    const uprightCrop = extractScanBinaryCropFromRgba(uprightBuf, w, h);
    expect(uprightCrop).not.toBeNull();
    expect(Math.abs(uprightCrop!.medianSlant)).toBeLessThan(0.06);
    expect(uprightCrop!.serifScore).toBeLessThan(1.18);

    // 2. Glyphes penchés en italique (haut décalé vers la droite par rapport au bas)
    const italicBuf = createBlankRgba(w, h);
    for (let i = 0; i < 6; i += 1) {
      const baseX = 16 + i * 22;
      for (let y = 8; y <= 35; y += 1) {
        const shift = (21 - y) * 0.28;
        paintDarkRect(italicBuf, w, h, baseX + shift, y, baseX + shift + 2, y);
      }
    }
    const italicCrop = extractScanBinaryCropFromRgba(italicBuf, w, h);
    expect(italicCrop).not.toBeNull();
    expect(italicCrop!.medianSlant).toBeGreaterThan(0.15);

    // 3. Lettres à empattements (pieds et têtes larges par rapport au fût central) vs traits épais
    const serifBuf = createBlankRgba(w, h);
    const boldBuf = createBlankRgba(w, h);
    for (let i = 0; i < 5; i += 1) {
      const gx = 20 + i * 24;
      // Serif : fût de 2 px, barreaux haut/bas de 8 px
      paintDarkRect(serifBuf, w, h, gx + 3, 8, gx + 4, 35);
      paintDarkRect(serifBuf, w, h, gx, 8, gx + 7, 10);
      paintDarkRect(serifBuf, w, h, gx, 33, gx + 7, 35);
      // Gras sans-serif : fût épais de 6 px
      paintDarkRect(boldBuf, w, h, gx, 8, gx + 5, 35);
    }
    const serifCrop = extractScanBinaryCropFromRgba(serifBuf, w, h);
    const boldCrop = extractScanBinaryCropFromRgba(boldBuf, w, h);
    expect(serifCrop).not.toBeNull();
    expect(boldCrop).not.toBeNull();
    expect(serifCrop!.serifScore).toBeGreaterThan(uprightCrop!.serifScore + 0.3);
    expect(boldCrop!.strokeWidthRatio).toBeGreaterThan(uprightCrop!.strokeWidthRatio + 0.05);
  });

  it('filtre les polices symboles/icônes et extrait proprement les noms de polices', () => {
    expect(isValidTextFontFamily('Wingdings 2')).toBe(false);
    expect(isValidTextFontFamily('Segoe Fluent Icons')).toBe(false);
    expect(isValidTextFontFamily('Calibri')).toBe(true);
    expect(isValidTextFontFamily('Times New Roman')).toBe(true);

    expect(extractPrimaryFontName('"Calibri", sans-serif')).toBe('Calibri');
    expect(extractPrimaryFontName('Georgia, "Times New Roman", serif')).toBe('Georgia');
    expect(formatCssFontStack('Times New Roman', 'serif')).toBe('"Times New Roman", serif');

    expect(
      findMatchingFontOptionValue('"Times New Roman", serif', [
        'Arial, Helvetica, sans-serif',
        '"Times New Roman", Times, serif',
      ]),
    ).toBe('"Times New Roman", Times, serif');

    const pool = buildRecognitionFontPool([
      { family: 'Wingdings', category: 'sans-serif' },
      { family: 'MaPoliceCustomPC', category: 'serif' },
      { family: 'Calibri', category: 'sans-serif' },
    ]);
    expect(pool.some((p) => p.family === 'Wingdings')).toBe(false);
    expect(pool[0]?.family).toBe('MaPoliceCustomPC');
    expect(pool.some((p) => p.family === 'Georgia')).toBe(true);
  });

  it("harmonise les lignes d'un même paragraphe OCR sans écraser les titres distincts", () => {
    const title = makeDummyBlock({
      id: 'title',
      origY: 40,
      origHeight: 22,
      originalText: 'TITRE PRINCIPAL DU DOCUMENT',
      style: { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 18, color: '#111827', bold: true, italic: false },
    });
    const l1 = makeDummyBlock({
      id: 'l1',
      origY: 90,
      origHeight: 13,
      originalText: 'Premiere ligne du paragraphe redige.',
      style: { fontFamily: '"Times New Roman", serif', fontSize: 11, color: '#111827', bold: false, italic: false },
    });
    const l2 = makeDummyBlock({
      id: 'l2',
      origY: 108,
      origHeight: 13,
      originalText: 'Seconde ligne du meme paragraphe.',
      style: { fontFamily: '"Times New Roman", serif', fontSize: 11, color: '#111827', bold: false, italic: false },
    });
    const l3Noisy = makeDummyBlock({
      id: 'l3',
      origY: 126,
      origHeight: 13,
      originalText: 'le 14/11',
      style: { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 11, color: '#111827', bold: false, italic: false },
    });
    const l4 = makeDummyBlock({
      id: 'l4',
      origY: 144,
      origHeight: 13,
      originalText: 'Quatrieme ligne de conclusion ici.',
      style: { fontFamily: '"Times New Roman", serif', fontSize: 11, color: '#111827', bold: false, italic: false },
    });

    harmonizeOcrParagraphFonts([title, l1, l2, l3Noisy, l4]);

    expect(l3Noisy.style.fontFamily).toBe('"Times New Roman", serif');
    expect(title.style.fontFamily).toBe('Arial, Helvetica, sans-serif');
  });

  it('calcule la police dominante globale sur toutes les pages du document (hors supprimés)', () => {
    const empty = computeDominantDocumentTextStyle({});
    expect(empty).toBeNull();

    const deletedHuge = makeDummyBlock({
      id: 'del',
      pageNumber: 1,
      currentText: 'Ce bloc tres long ne doit plus influencer la police par defaut',
      status: 'deleted',
      style: { fontFamily: '"Courier New", monospace', fontSize: 12, color: '#111827', bold: true, italic: false },
    });
    const title = makeDummyBlock({
      id: 't1',
      pageNumber: 1,
      currentText: 'NOTE',
      style: { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 22, color: '#111827', bold: true, italic: false },
    });
    const body1 = makeDummyBlock({
      id: 'b1',
      pageNumber: 1,
      currentText: 'Premier paragraphe complet du courrier en police serif classique.',
      style: { fontFamily: '"Times New Roman", serif', fontSize: 11, color: '#111827', bold: false, italic: true },
    });
    const body2 = makeDummyBlock({
      id: 'b2',
      pageNumber: 2,
      currentText: 'Suite sur la deuxieme page.',
      style: { fontFamily: '"Times New Roman", serif', fontSize: 11, color: '#111827', bold: false, italic: true },
    });

    const dominant = computeDominantDocumentTextStyle({ 1: [deletedHuge, title, body1], 2: [body2] });
    expect(dominant).not.toBeNull();
    expect(dominant!.fontFamily).toBe('"Times New Roman", serif');
    expect(dominant!.italic).toBe(true);
    expect(dominant!.fontSize).toBe(11);
  });
});
