// Extraction des images d'une page PDF et filtrage des images de fond portant du texte
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { EditableImageBlock, EditableTextBlock } from '../types/pdf';
import { createId } from './formatters';

export interface SimpleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Détermine si une image sert de fond à du texte natif du PDF.
 * Conformément au cahier des charges, une image de fond portant du texte n'est pas sélectionnable,
 * contrairement à un logo/photo autonome ou à un document photographié sans couche texte native.
 */
export function isBackgroundImageWithText(
  imgRect: SimpleRect,
  textBlocks: EditableTextBlock[],
): boolean {
  const nativeBlocks = textBlocks.filter((b) => b.source === 'pdf' && b.status !== 'deleted');
  if (nativeBlocks.length === 0) {
    return false;
  }

  for (const tb of nativeBlocks) {
    const xOverlap = Math.max(
      0,
      Math.min(imgRect.x + imgRect.width, tb.origX + tb.origWidth) - Math.max(imgRect.x, tb.origX),
    );
    const yOverlap = Math.max(
      0,
      Math.min(imgRect.y + imgRect.height, tb.origY + tb.origHeight) - Math.max(imgRect.y, tb.origY),
    );
    const interArea = xOverlap * yOverlap;
    const tbArea = Math.max(1, tb.origWidth * tb.origHeight);
    if (interArea >= tbArea * 0.25) {
      return true;
    }
  }

  return false;
}

/** Calcule le rectangle englobant du carré unitaire [0..1, 0..1] après transformation PDF -> viewport */
export function computeTransformedImageBox(
  viewportTransform: number[],
  ctm: number[],
): SimpleRect {
  const m = pdfjsLib.Util.transform(viewportTransform, ctm);
  const corners: Array<[number, number]> = [
    [m[4], m[5]],
    [m[0] + m[4], m[1] + m[5]],
    [m[2] + m[4], m[3] + m[5]],
    [m[0] + m[2] + m[4], m[1] + m[3] + m[5]],
  ];

  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

interface RawPdfImageObj {
  bitmap?: ImageBitmap;
  data?: Uint8Array | Uint8ClampedArray;
  width?: number;
  height?: number;
  kind?: number;
}

function resolveObj(
  pool: { has?: (id: string) => boolean; get: (id: string, cb?: (v: unknown) => void) => unknown },
  id: string,
): Promise<RawPdfImageObj | null> {
  try {
    if (typeof pool.has === 'function' && pool.has(id)) {
      return Promise.resolve((pool.get(id) as RawPdfImageObj) ?? null);
    }
  } catch {
    // passe à la résolution asynchrone
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 350);
    try {
      pool.get(id, (val) => {
        clearTimeout(timer);
        resolve((val as RawPdfImageObj) ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Convertit une ressource image PDF.js en URL PNG autonome prête pour l'édition et l'export */
function pdfImageObjToDataUrl(
  obj: RawPdfImageObj | null,
  fallbackCanvas?: HTMLCanvasElement,
  rectPdf?: SimpleRect,
  canvasScale = 1,
): string | null {
  const bmp =
    typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap
      ? obj
      : (obj as RawPdfImageObj | null)?.bitmap;
  if (bmp && bmp.width > 0 && bmp.height > 0) {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.drawImage(bmp, 0, 0);
      return c.toDataURL('image/png');
    }
  }

  if (obj && obj.data && obj.width && obj.height) {
    const w = obj.width;
    const h = obj.height;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const kind = obj.kind ?? 3;

    if (kind === 3 && obj.data.length >= w * h * 4) {
      rgba.set(obj.data.subarray(0, w * h * 4));
    } else if (kind === 2 && obj.data.length >= w * h * 3) {
      for (let i = 0, j = 0; i < w * h; i += 1, j += 3) {
        const out = i * 4;
        rgba[out] = obj.data[j];
        rgba[out + 1] = obj.data[j + 1];
        rgba[out + 2] = obj.data[j + 2];
        rgba[out + 3] = 255;
      }
    } else if (kind === 1) {
      const rowBytes = Math.ceil(w / 8);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const byteVal = obj.data[y * rowBytes + (x >> 3)] ?? 0;
          const bit = (byteVal >> (7 - (x & 7))) & 1;
          const gray = bit ? 255 : 0;
          const out = (y * w + x) * 4;
          rgba[out] = gray;
          rgba[out + 1] = gray;
          rgba[out + 2] = gray;
          rgba[out + 3] = 255;
        }
      }
    } else {
      rgba.fill(255);
    }

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
      return c.toDataURL('image/png');
    }
  }

  // Repli propre par capture directe sur le canvas déjà rendu de la page
  if (fallbackCanvas && rectPdf && canvasScale > 0) {
    const sx = Math.max(0, Math.round(rectPdf.x * canvasScale));
    const sy = Math.max(0, Math.round(rectPdf.y * canvasScale));
    const sw = Math.min(fallbackCanvas.width - sx, Math.max(4, Math.round(rectPdf.width * canvasScale)));
    const sh = Math.min(fallbackCanvas.height - sy, Math.max(4, Math.round(rectPdf.height * canvasScale)));
    if (sw > 3 && sh > 3) {
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(fallbackCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return c.toDataURL('image/png');
      }
    }
  }

  return null;
}

/**
 * Extrait toutes les images sélectionnables d'une page PDF (photos, logos, scans sans texte natif par-dessus).
 * Les images servant uniquement de fond sous du texte réel ne sont volontairement pas exposées.
 */
export async function extractSelectableImages(
  page: PDFPageProxy,
  pageNumber: number,
  textBlocksOnPage: EditableTextBlock[],
  cleanCanvas?: HTMLCanvasElement,
  canvasScale = 1,
): Promise<EditableImageBlock[]> {
  const viewport = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;

  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const results: EditableImageBlock[] = [];

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];

    if (fn === pdfjsLib.OPS.save) {
      stack.push([...ctm]);
      continue;
    }
    if (fn === pdfjsLib.OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === pdfjsLib.OPS.transform && Array.isArray(args) && args.length >= 6) {
      ctm = pdfjsLib.Util.transform(ctm, args as number[]);
      continue;
    }
    if (fn === pdfjsLib.OPS.paintFormXObjectBegin) {
      stack.push([...ctm]);
      if (Array.isArray(args?.[0]) && (args[0] as number[]).length >= 6) {
        ctm = pdfjsLib.Util.transform(ctm, args[0] as number[]);
      }
      continue;
    }
    if (fn === pdfjsLib.OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }

    const isXObjectImage =
      fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintImageXObjectRepeat;
    const isInlineImage = fn === pdfjsLib.OPS.paintInlineImageXObject;

    if (!isXObjectImage && !isInlineImage) {
      continue;
    }

    const box = computeTransformedImageBox(viewport.transform, ctm);
    if (box.width < 10 || box.height < 10) {
      continue;
    }

    // Ignore les doublons strictement superposés au même endroit
    const duplicate = results.some(
      (existing) =>
        Math.abs(existing.origX - box.x) < 2 &&
        Math.abs(existing.origY - box.y) < 2 &&
        Math.abs(existing.origWidth - box.width) < 3 &&
        Math.abs(existing.origHeight - box.height) < 3,
    );
    if (duplicate) {
      continue;
    }

    // Règle importante : une image de fond qui porte du texte natif n'est pas sélectionnable
    if (isBackgroundImageWithText(box, textBlocksOnPage)) {
      continue;
    }

    let rawObj: RawPdfImageObj | null = null;
    if (isInlineImage) {
      rawObj = (args?.[0] as RawPdfImageObj) ?? null;
    } else if (typeof args?.[0] === 'string') {
      const imgId = args[0];
      rawObj = (await resolveObj(page.objs, imgId)) ?? (await resolveObj(page.commonObjs, imgId));
    }

    const dataUrl = pdfImageObjToDataUrl(rawObj, cleanCanvas, box, canvasScale);
    if (!dataUrl) {
      continue;
    }

    results.push({
      id: createId('img'),
      pageNumber,
      source: 'pdf',
      status: 'original',
      origX: box.x,
      origY: box.y,
      origWidth: box.width,
      origHeight: box.height,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: 0,
      origImageDataUrl: dataUrl,
      imageDataUrl: dataUrl,
    });
  }

  return results;
}

/** Utilitaire pour transformer un fichier image local (JPG, PNG, WebP) en PNG DataURL prêt à l'emploi */
export function readImageFileAsPngDataUrl(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire le fichier image sélectionné."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Le fichier choisi n'est pas une image reconnue."));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 200;
        canvas.height = img.naturalHeight || 200;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Mémoire graphique insuffisante pour charger cette image.'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height,
        });
      };
      img.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });
}

/** Pivote une image PNG d'un certain nombre de degrés multiples de 90 et retourne le PNG tourné */
export function rotatePngDataUrl(dataUrl: string, rotationDeg: number): Promise<string> {
  const norm = ((rotationDeg % 360) + 360) % 360;
  if (norm === 0) {
    return Promise.resolve(dataUrl);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const swap = norm === 90 || norm === 270;
      const w = swap ? img.naturalHeight : img.naturalWidth;
      const h = swap ? img.naturalWidth : img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.translate(w / 2, h / 2);
      ctx.rotate((norm * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
