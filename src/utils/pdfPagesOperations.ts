// Opérations sur les pages PDF via pdf-lib : ajout, images, suppression, déplacement, rotation, duplication, fusion, extraction et division
import { PDFDocument, degrees } from 'pdf-lib';
import type { EditableImageBlock, EditableTextBlock, PageAnnotation } from '../types/pdf';

/** Analyse une saisie utilisateur comme "1, 3-5, 7" en liste triée de numéros de page valides (1..maxPages) */
export function parsePageRanges(rangeText: string, maxPages: number): number[] {
  if (maxPages < 1) {
    return [];
  }
  const clean = rangeText.trim();
  if (!clean) {
    return [];
  }

  const seen = new Set<number>();
  const ordered: number[] = [];

  for (const part of clean.split(',')) {
    const token = part.trim();
    if (!token) {
      continue;
    }
    const dashMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (dashMatch) {
      const a = Number.parseInt(dashMatch[1], 10);
      const b = Number.parseInt(dashMatch[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const start = Math.max(1, Math.min(a, b));
        const end = Math.min(maxPages, Math.max(a, b));
        for (let p = start; p <= end; p += 1) {
          if (!seen.has(p)) {
            seen.add(p);
            ordered.push(p);
          }
        }
      }
      continue;
    }

    const single = Number.parseInt(token, 10);
    if (Number.isFinite(single) && single >= 1 && single <= maxPages && !seen.has(single)) {
      seen.add(single);
      ordered.push(single);
    }
  }

  return ordered;
}

/**
 * Calcule l'ordre des paires de pages pour une impression en livret plié (imposition cahier).
 * Exemple pour 4 pages : recto [4, 1], verso [2, 3]. Les pages blanches de complément valent null.
 */
export function computeBookletSpreads(pages: number[]): Array<[number | null, number | null]> {
  if (pages.length === 0) {
    return [];
  }
  const paddedCount = Math.ceil(pages.length / 4) * 4;
  const padded: Array<number | null> = [...pages];
  while (padded.length < paddedCount) {
    padded.push(null);
  }

  const spreads: Array<[number | null, number | null]> = [];
  let leftIdx = 0;
  let rightIdx = padded.length - 1;
  let sheetSide = 0;

  while (leftIdx < rightIdx) {
    if (sheetSide % 2 === 0) {
      // Recto : [dernière, première]
      spreads.push([padded[rightIdx], padded[leftIdx]]);
    } else {
      // Verso : [suivante gauche, précédente droite]
      spreads.push([padded[leftIdx], padded[rightIdx]]);
    }
    leftIdx += 1;
    rightIdx -= 1;
    sheetSide += 1;
  }

  return spreads;
}

/** Regroupe une liste de pages sélectionnées en feuilles d'impression selon N par feuille ou livret */
export function computePrintSheets(
  pages: number[],
  pagesPerSheet: 1 | 2 | 4 | 6,
  booklet: boolean,
): Array<Array<number | null>> {
  if (pages.length === 0) {
    return [];
  }
  if (booklet) {
    return computeBookletSpreads(pages);
  }
  const sheets: Array<Array<number | null>> = [];
  for (let i = 0; i < pages.length; i += pagesPerSheet) {
    const chunk: Array<number | null> = pages.slice(i, i + pagesPerSheet);
    while (chunk.length < pagesPerSheet) {
      chunk.push(null);
    }
    sheets.push(chunk);
  }
  return sheets;
}

/** Réindexe une table par numéro de page selon un nouveau tableau mapping (ancienNuméro -> nouveauNuméro) */
export function remapPageKeyedRecord<T extends { pageNumber: number }>(
  record: Record<number, T[]>,
  oldToNewPage: Map<number, number>,
): Record<number, T[]> {
  const next: Record<number, T[]> = {};
  for (const [oldKey, items] of Object.entries(record)) {
    const newPage = oldToNewPage.get(Number(oldKey));
    if (!newPage) {
      continue;
    }
    next[newPage] = items.map((item) => ({ ...item, pageNumber: newPage }));
  }
  return next;
}

export interface PageMutationOutput {
  bytes: Uint8Array;
  numPages: number;
  textBlocksByPage: Record<number, EditableTextBlock[]>;
  imageBlocksByPage: Record<number, EditableImageBlock[]>;
  annotationsByPage: Record<number, PageAnnotation[]>;
  targetPage: number;
}

export interface OverlayMapsSnapshot {
  textBlocksByPage: Record<number, EditableTextBlock[]>;
  imageBlocksByPage: Record<number, EditableImageBlock[]>;
  annotationsByPage: Record<number, PageAnnotation[]>;
}

/** Insère une page vierge (même format que la page de référence ou A4) après `afterPage` */
export async function addBlankPageOperation(
  bytes: Uint8Array,
  afterPage: number,
  state: OverlayMapsSnapshot,
): Promise<PageMutationOutput> {
  const doc = await PDFDocument.load(bytes);
  const count = doc.getPageCount();
  const refPage = count > 0 ? doc.getPage(Math.max(0, Math.min(count - 1, afterPage - 1))) : null;
  const size = refPage ? refPage.getSize() : { width: 595.28, height: 841.89 };
  const insertIdx = Math.max(0, Math.min(count, afterPage));
  doc.insertPage(insertIdx, [size.width, size.height]);

  const map = new Map<number, number>();
  for (let p = 1; p <= count; p += 1) {
    map.set(p, p <= insertIdx ? p : p + 1);
  }

  return {
    bytes: await doc.save(),
    numPages: doc.getPageCount(),
    textBlocksByPage: remapPageKeyedRecord(state.textBlocksByPage, map),
    imageBlocksByPage: remapPageKeyedRecord(state.imageBlocksByPage, map),
    annotationsByPage: remapPageKeyedRecord(state.annotationsByPage, map),
    targetPage: insertIdx + 1,
  };
}

/** Ajoute une ou plusieurs images (JPG/PNG) converties chacune en nouvelle page A4 ou adaptée */
export async function addImagePagesOperation(
  bytes: Uint8Array,
  afterPage: number,
  images: Array<{ dataUrl: string; width: number; height: number }>,
  state: OverlayMapsSnapshot,
): Promise<PageMutationOutput> {
  const doc = await PDFDocument.load(bytes);
  const count = doc.getPageCount();
  let insertIdx = Math.max(0, Math.min(count, afterPage));
  const firstAddedPage = insertIdx + 1;

  for (const item of images) {
    const base64 = item.dataUrl.split(',')[1] ?? '';
    const bin = atob(base64);
    const pngBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      pngBytes[i] = bin.charCodeAt(i);
    }
    const embedded = await doc.embedPng(pngBytes);
    const landscape = item.width > item.height;
    const pageW = landscape ? 841.89 : 595.28;
    const pageH = landscape ? 595.28 : 841.89;
    const page = doc.insertPage(insertIdx, [pageW, pageH]);

    const margin = 24;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;
    const ratio = Math.min(maxW / item.width, maxH / item.height);
    const drawW = item.width * ratio;
    const drawH = item.height * ratio;
    page.drawImage(embedded, {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
    insertIdx += 1;
  }

  const addedCount = images.length;
  const originalInsertIdx = firstAddedPage - 1;
  const map = new Map<number, number>();
  for (let p = 1; p <= count; p += 1) {
    map.set(p, p <= originalInsertIdx ? p : p + addedCount);
  }

  return {
    bytes: await doc.save(),
    numPages: doc.getPageCount(),
    textBlocksByPage: remapPageKeyedRecord(state.textBlocksByPage, map),
    imageBlocksByPage: remapPageKeyedRecord(state.imageBlocksByPage, map),
    annotationsByPage: remapPageKeyedRecord(state.annotationsByPage, map),
    targetPage: firstAddedPage,
  };
}

/** Supprime une page du document (bloqué s'il ne reste qu'une seule page) */
export async function deletePageOperation(
  bytes: Uint8Array,
  pageNumber: number,
  state: OverlayMapsSnapshot,
): Promise<PageMutationOutput> {
  const doc = await PDFDocument.load(bytes);
  const count = doc.getPageCount();
  if (count <= 1) {
    throw new Error('Impossible de supprimer la dernière page restante du document.');
  }
  const idx = Math.max(0, Math.min(count - 1, pageNumber - 1));
  doc.removePage(idx);

  const map = new Map<number, number>();
  for (let p = 1; p <= count; p += 1) {
    if (p < pageNumber) {
      map.set(p, p);
    } else if (p > pageNumber) {
      map.set(p, p - 1);
    }
  }

  const nextCount = doc.getPageCount();
  return {
    bytes: await doc.save(),
    numPages: nextCount,
    textBlocksByPage: remapPageKeyedRecord(state.textBlocksByPage, map),
    imageBlocksByPage: remapPageKeyedRecord(state.imageBlocksByPage, map),
    annotationsByPage: remapPageKeyedRecord(state.annotationsByPage, map),
    targetPage: Math.min(pageNumber, nextCount),
  };
}

/** Duplique une page juste après elle-même */
export async function duplicatePageOperation(
  bytes: Uint8Array,
  pageNumber: number,
  state: OverlayMapsSnapshot,
): Promise<PageMutationOutput> {
  const doc = await PDFDocument.load(bytes);
  const count = doc.getPageCount();
  const idx = Math.max(0, Math.min(count - 1, pageNumber - 1));
  const [copied] = await doc.copyPages(doc, [idx]);
  doc.insertPage(idx + 1, copied);

  const map = new Map<number, number>();
  for (let p = 1; p <= count; p += 1) {
    map.set(p, p <= pageNumber ? p : p + 1);
  }

  return {
    bytes: await doc.save(),
    numPages: doc.getPageCount(),
    textBlocksByPage: remapPageKeyedRecord(state.textBlocksByPage, map),
    imageBlocksByPage: remapPageKeyedRecord(state.imageBlocksByPage, map),
    annotationsByPage: remapPageKeyedRecord(state.annotationsByPage, map),
    targetPage: pageNumber + 1,
  };
}

/** Déplace une page d'un rang vers une nouvelle position (1..N) */
export async function movePageOperation(
  bytes: Uint8Array,
  fromPage: number,
  toPage: number,
  state: OverlayMapsSnapshot,
): Promise<PageMutationOutput> {
  const srcDoc = await PDFDocument.load(bytes);
  const count = srcDoc.getPageCount();
  const clampedFrom = Math.max(1, Math.min(count, fromPage));
  const clampedTo = Math.max(1, Math.min(count, toPage));
  if (clampedFrom === clampedTo) {
    return {
      bytes,
      numPages: count,
      textBlocksByPage: state.textBlocksByPage,
      imageBlocksByPage: state.imageBlocksByPage,
      annotationsByPage: state.annotationsByPage,
      targetPage: clampedTo,
    };
  }

  const order = Array.from({ length: count }, (_, idx) => idx + 1);
  const [moved] = order.splice(clampedFrom - 1, 1);
  order.splice(clampedTo - 1, 0, moved);

  const nextDoc = await PDFDocument.create();
  const copied = await nextDoc.copyPages(
    srcDoc,
    order.map((p) => p - 1),
  );
  for (const p of copied) {
    nextDoc.addPage(p);
  }

  const map = new Map<number, number>();
  order.forEach((oldNum, newIdx) => {
    map.set(oldNum, newIdx + 1);
  });

  return {
    bytes: await nextDoc.save(),
    numPages: nextDoc.getPageCount(),
    textBlocksByPage: remapPageKeyedRecord(state.textBlocksByPage, map),
    imageBlocksByPage: remapPageKeyedRecord(state.imageBlocksByPage, map),
    annotationsByPage: remapPageKeyedRecord(state.annotationsByPage, map),
    targetPage: clampedTo,
  };
}

/** Pivote une page de +90, -90 ou 180 degrés */
export async function rotatePageOperation(
  bytes: Uint8Array,
  pageNumber: number,
  deltaDeg: 90 | -90 | 180,
  state: OverlayMapsSnapshot,
): Promise<PageMutationOutput> {
  const doc = await PDFDocument.load(bytes);
  const count = doc.getPageCount();
  const idx = Math.max(0, Math.min(count - 1, pageNumber - 1));
  const page = doc.getPage(idx);
  const currentAngle = page.getRotation().angle;
  const nextAngle = (((currentAngle + deltaDeg) % 360) + 360) % 360;
  page.setRotation(degrees(nextAngle));

  // Réinitialise uniquement les extractions en cache de cette page pour qu'elles soient recalculées dans la nouvelle orientation
  const nextText = { ...state.textBlocksByPage };
  const nextImgs = { ...state.imageBlocksByPage };
  delete nextText[pageNumber];
  delete nextImgs[pageNumber];

  return {
    bytes: await doc.save(),
    numPages: count,
    textBlocksByPage: nextText,
    imageBlocksByPage: nextImgs,
    annotationsByPage: state.annotationsByPage,
    targetPage: pageNumber,
  };
}

/** Fusionne un autre PDF à la suite ou après une page précise du document ouvert */
export async function mergePdfOperation(
  baseBytes: Uint8Array,
  extraBytes: Uint8Array,
  insertAfterPage: number,
  state: OverlayMapsSnapshot,
): Promise<PageMutationOutput> {
  const baseDoc = await PDFDocument.load(baseBytes);
  const extraDoc = await PDFDocument.load(extraBytes);
  const baseCount = baseDoc.getPageCount();
  const extraCount = extraDoc.getPageCount();
  const insertIdx = Math.max(0, Math.min(baseCount, insertAfterPage));

  const copied = await baseDoc.copyPages(
    extraDoc,
    Array.from({ length: extraCount }, (_, i) => i),
  );
  copied.forEach((p, offset) => {
    baseDoc.insertPage(insertIdx + offset, p);
  });

  const map = new Map<number, number>();
  for (let p = 1; p <= baseCount; p += 1) {
    map.set(p, p <= insertIdx ? p : p + extraCount);
  }

  return {
    bytes: await baseDoc.save(),
    numPages: baseDoc.getPageCount(),
    textBlocksByPage: remapPageKeyedRecord(state.textBlocksByPage, map),
    imageBlocksByPage: remapPageKeyedRecord(state.imageBlocksByPage, map),
    annotationsByPage: remapPageKeyedRecord(state.annotationsByPage, map),
    targetPage: insertIdx + 1,
  };
}

/** Extrait une liste précise de pages (1..N) dans un nouveau document PDF autonome */
export async function extractPagesToNewPdf(
  bytes: Uint8Array,
  pageNumbers: number[],
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(bytes);
  const maxP = srcDoc.getPageCount();
  const validIndices = pageNumbers
    .filter((p) => p >= 1 && p <= maxP)
    .map((p) => p - 1);
  if (validIndices.length === 0) {
    throw new Error('Veuillez sélectionner au moins une page valide à extraire.');
  }
  const destDoc = await PDFDocument.create();
  const copied = await destDoc.copyPages(srcDoc, validIndices);
  for (const p of copied) {
    destDoc.addPage(p);
  }
  return await destDoc.save();
}

/** Divise un PDF en plusieurs documents selon le mode choisi */
export async function splitPdfIntoMultiple(
  bytes: Uint8Array,
  mode: 'single-pages' | 'halves' | 'every-n',
  chunkSize = 2,
): Promise<Array<{ label: string; bytes: Uint8Array }>> {
  const srcDoc = await PDFDocument.load(bytes);
  const total = srcDoc.getPageCount();
  const groups: number[][] = [];

  if (mode === 'single-pages') {
    for (let p = 1; p <= total; p += 1) {
      groups.push([p]);
    }
  } else if (mode === 'halves') {
    const mid = Math.ceil(total / 2);
    groups.push(Array.from({ length: mid }, (_, i) => i + 1));
    if (mid < total) {
      groups.push(Array.from({ length: total - mid }, (_, i) => mid + i + 1));
    }
  } else {
    const step = Math.max(1, Math.min(total, chunkSize));
    for (let start = 1; start <= total; start += step) {
      const len = Math.min(step, total - start + 1);
      groups.push(Array.from({ length: len }, (_, i) => start + i));
    }
  }

  const out: Array<{ label: string; bytes: Uint8Array }> = [];
  for (let i = 0; i < groups.length; i += 1) {
    const partBytes = await extractPagesToNewPdf(bytes, groups[i]);
    const g = groups[i];
    const suffix = g.length === 1 ? `page-${g[0]}` : `pages-${g[0]}-a-${g[g.length - 1]}`;
    out.push({ label: suffix, bytes: partBytes });
  }
  return out;
}
