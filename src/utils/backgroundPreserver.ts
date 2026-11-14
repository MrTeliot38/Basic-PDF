// Reconstruction intelligente du fond sans texte (couleur unie, encadré étroit ou dégradé)
// et détection automatique du style visuel (couleur, graisse, italique, famille de police)

import type { BackgroundPatch } from '../types/pdf';
import {
  extractScanBinaryCropFromRgba,
  formatCssFontStack,
} from './fontRecognizer';

export interface RgbaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedVisualStyle {
  color: string;
  fontFamily: string;
  detectedFontLabel: string;
  bold: boolean;
  italic: boolean;
}

export const CURATED_FONT_FAMILIES = [
  { label: 'Sans-serif (Arial / Helvetica)', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif (Times / Georgia)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Chasse fixe (Courier)', value: '"Courier New", Consolas, monospace' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Calibri', value: '"Calibri", sans-serif' },
  { label: 'Calibri Light', value: '"Calibri Light", sans-serif' },
  { label: 'Cambria', value: '"Cambria", serif' },
  { label: 'Georgia', value: '"Georgia", serif' },
  { label: 'Garamond', value: '"Garamond", serif' },
  { label: 'Palatino', value: '"Palatino Linotype", "Book Antiqua", Georgia, serif' },
  { label: 'Segoe UI', value: '"Segoe UI", sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: '"Tahoma", sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
] as const;

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorDistanceSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Estime la couleur de fond locale autour du pixel (x, y) à l'intérieur du rectangle texte
 * en utilisant le groupe de couleur majoritaire dans une fenêtre locale (résistant aux dégradés
 * et aux encadrés étroits).
 */
function estimateLocalBackground(
  data: Uint8ClampedArray,
  width: number,
  _height: number,
  cx: number,
  cy: number,
  innerLeft: number,
  innerTop: number,
  innerRight: number,
  innerBottom: number,
): [number, number, number] {
  const winRadius = 11;
  const xStart = Math.max(innerLeft, cx - winRadius);
  const xEnd = Math.min(innerRight - 1, cx + winRadius);
  const yStart = Math.max(innerTop, cy - winRadius);
  const yEnd = Math.min(innerBottom - 1, cy + winRadius);

  // Histogramme grossier (pas de 16) pour identifier le cluster de fond majoritaire
  const buckets = new Map<number, { count: number; sr: number; sg: number; sb: number }>();

  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const entry = buckets.get(key);
      if (entry) {
        entry.count += 1;
        entry.sr += r;
        entry.sg += g;
        entry.sb += b;
      } else {
        buckets.set(key, { count: 1, sr: r, sg: g, sb: b });
      }
    }
  }

  let best: { count: number; sr: number; sg: number; sb: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }

  if (!best || best.count === 0) {
    return [255, 255, 255];
  }
  return [best.sr / best.count, best.sg / best.count, best.sb / best.count];
}

/**
 * Reconstruit les pixels d'une image de patch en effaçant les glyphes de texte tout en
 * préservant exactement les fonds colorés, encadrés étroits et dégradés.
 * Fonction pure testable directement sur un tampon RGBA.
 */
export function reconstructBackgroundBuffer(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  margin = 2,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(sourceData);
  if (width <= 2 || height <= 2) {
    return result;
  }

  const safeMarginX = Math.min(margin, Math.floor(width / 6));
  const safeMarginY = Math.min(margin, Math.floor(height / 6));
  const innerLeft = safeMarginX;
  const innerTop = safeMarginY;
  const innerRight = width - safeMarginX;
  const innerBottom = height - safeMarginY;

  // 1. Calcul d'une grille grossière de fond local (tous les 6 px) pour la rapidité
  const step = 6;
  const gridCols = Math.max(1, Math.ceil(width / step));
  const gridRows = Math.max(1, Math.ceil(height / step));
  const bgGridR = new Float32Array(gridCols * gridRows);
  const bgGridG = new Float32Array(gridCols * gridRows);
  const bgGridB = new Float32Array(gridCols * gridRows);

  for (let gy = 0; gy < gridRows; gy += 1) {
    const py = Math.min(innerBottom - 1, Math.max(innerTop, gy * step + Math.floor(step / 2)));
    for (let gx = 0; gx < gridCols; gx += 1) {
      const px = Math.min(innerRight - 1, Math.max(innerLeft, gx * step + Math.floor(step / 2)));
      const [br, bg, bb] = estimateLocalBackground(
        sourceData,
        width,
        height,
        px,
        py,
        innerLeft,
        innerTop,
        innerRight,
        innerBottom,
      );
      const gi = gy * gridCols + gx;
      bgGridR[gi] = br;
      bgGridG[gi] = bg;
      bgGridB[gi] = bb;
    }
  }

  // 2. Masque binaire des pixels d'encre / anti-crénelage à reconstruire
  const rawInkMask = new Uint8Array(width * height);
  const distThresholdSq = 28 * 28;

  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(gridRows - 1, Math.floor(y / step));
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(gridCols - 1, Math.floor(x / step));
      const gi = gy * gridCols + gx;
      const idx = (y * width + x) * 4;
      const r = sourceData[idx];
      const g = sourceData[idx + 1];
      const b = sourceData[idx + 2];

      // Si le pixel est dans la marge extérieure et diffère nettement du fond intérieur,
      // c'est probablement la bordure d'un encadré étroit : on ne l'efface pas !
      const isOuterMargin =
        x < innerLeft || x >= innerRight || y < innerTop || y >= innerBottom;
      if (isOuterMargin) {
        continue;
      }

      if (colorDistanceSq(r, g, b, bgGridR[gi], bgGridG[gi], bgGridB[gi]) > distThresholdSq) {
        rawInkMask[y * width + x] = 1;
      }
    }
  }

  // 3. Légère dilatation (1 px) uniquement à l'intérieur pour supprimer les halos d'anticrénelage
  const mask = new Uint8Array(rawInkMask);
  for (let y = innerTop; y < innerBottom; y += 1) {
    for (let x = innerLeft; x < innerRight; x += 1) {
      const pos = y * width + x;
      if (rawInkMask[pos]) {
        continue;
      }
      if (
        (x > innerLeft && rawInkMask[pos - 1]) ||
        (x + 1 < innerRight && rawInkMask[pos + 1]) ||
        (y > innerTop && rawInkMask[pos - width]) ||
        (y + 1 < innerBottom && rawInkMask[pos + width])
      ) {
        mask[pos] = 1;
      }
    }
  }

  // 4. Interpolation directionnelle à 8 rayons depuis les pixels de fond les plus proches
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const;

  for (let y = innerTop; y < innerBottom; y += 1) {
    for (let x = innerLeft; x < innerRight; x += 1) {
      const pos = y * width + x;
      if (!mask[pos]) {
        continue;
      }
      const gi = Math.min(gridRows - 1, Math.floor(y / step)) * gridCols +
        Math.min(gridCols - 1, Math.floor(x / step));
      const localR = bgGridR[gi];
      const localG = bgGridG[gi];
      const localB = bgGridB[gi];

      let weightSum = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      for (const [dx, dy] of dirs) {
        let sx = x + dx;
        let sy = y + dy;
        let steps = 1;
        while (sx >= innerLeft && sx < innerRight && sy >= innerTop && sy < innerBottom) {
          const sPos = sy * width + sx;
          if (!mask[sPos]) {
            const sIdx = sPos * 4;
            const sr = sourceData[sIdx];
            const sg = sourceData[sIdx + 1];
            const sb = sourceData[sIdx + 2];
            // Ignore un pixel étranger isolé très loin de la teinte du fond local
            if (colorDistanceSq(sr, sg, sb, localR, localG, localB) <= 55 * 55) {
              const dist = Math.hypot(sx - x, sy - y);
              const w = 1 / (dist * dist);
              weightSum += w;
              sumR += sr * w;
              sumG += sg * w;
              sumB += sb * w;
            }
            break;
          }
          steps += 1;
          if (steps > Math.max(width, height)) {
            break;
          }
          sx += dx;
          sy += dy;
        }
      }

      const outIdx = pos * 4;
      if (weightSum > 0) {
        result[outIdx] = clampByte(sumR / weightSum);
        result[outIdx + 1] = clampByte(sumG / weightSum);
        result[outIdx + 2] = clampByte(sumB / weightSum);
      } else {
        result[outIdx] = clampByte(localR);
        result[outIdx + 1] = clampByte(localG);
        result[outIdx + 2] = clampByte(localB);
      }
      result[outIdx + 3] = 255;
    }
  }

  return result;
}

/**
 * Extrait une image PNG du fond nettoyé pour un bloc de texte à partir du canvas de la page,
 * avec ses coordonnées exactes en points PDF pour un alignement parfait.
 */
export function extractBackgroundPatch(
  pageCanvas: HTMLCanvasElement,
  rectPdf: RgbaRect,
  canvasScale: number,
): BackgroundPatch | undefined {
  const ctx = pageCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || pageCanvas.width === 0 || pageCanvas.height === 0 || canvasScale <= 0) {
    return undefined;
  }

  const x0 = Math.max(0, Math.floor(rectPdf.x * canvasScale) - 1);
  const y0 = Math.max(0, Math.floor(rectPdf.y * canvasScale) - 1);
  const x1 = Math.min(pageCanvas.width, Math.ceil((rectPdf.x + rectPdf.width) * canvasScale) + 1);
  const y1 = Math.min(pageCanvas.height, Math.ceil((rectPdf.y + rectPdf.height) * canvasScale) + 1);
  const w = x1 - x0;
  const h = y1 - y0;

  if (w < 4 || h < 4) {
    return undefined;
  }

  const imageData = ctx.getImageData(x0, y0, w, h);
  const cleanBuffer = reconstructBackgroundBuffer(imageData.data, w, h, 1);

  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = w;
  patchCanvas.height = h;
  const patchCtx = patchCanvas.getContext('2d');
  if (!patchCtx) {
    return undefined;
  }

  const outData = new ImageData(new Uint8ClampedArray(cleanBuffer), w, h);
  patchCtx.putImageData(outData, 0, 0);
  return {
    dataUrl: patchCanvas.toDataURL('image/png'),
    x: x0 / canvasScale,
    y: y0 / canvasScale,
    width: w / canvasScale,
    height: h / canvasScale,
  };
}

/**
 * Reconstruit le fond derrière une image déplacée, pivotée ou supprimée en échantillonnant
 * le pourtour immédiat extérieur sans empiéter sur le contenu voisin.
 */
export function extractImageHolePatch(
  pageCanvas: HTMLCanvasElement,
  rectPdf: RgbaRect,
  canvasScale: number,
): BackgroundPatch | undefined {
  const ctx = pageCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || pageCanvas.width === 0 || pageCanvas.height === 0 || canvasScale <= 0) {
    return undefined;
  }

  const x0 = Math.max(0, Math.floor(rectPdf.x * canvasScale) - 1);
  const y0 = Math.max(0, Math.floor(rectPdf.y * canvasScale) - 1);
  const x1 = Math.min(pageCanvas.width, Math.ceil((rectPdf.x + rectPdf.width) * canvasScale) + 1);
  const y1 = Math.min(pageCanvas.height, Math.ceil((rectPdf.y + rectPdf.height) * canvasScale) + 1);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) {
    return undefined;
  }

  const ring = 4;
  const rx0 = Math.max(0, x0 - ring);
  const ry0 = Math.max(0, y0 - ring);
  const rx1 = Math.min(pageCanvas.width, x1 + ring);
  const ry1 = Math.min(pageCanvas.height, y1 + ring);
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  const ringData = ctx.getImageData(rx0, ry0, rw, rh).data;

  const samplePx = (gx: number, gy: number): [number, number, number] => {
    const cx = Math.max(0, Math.min(rw - 1, gx - rx0));
    const cy = Math.max(0, Math.min(rh - 1, gy - ry0));
    const idx = (cy * rw + cx) * 4;
    return [ringData[idx], ringData[idx + 1], ringData[idx + 2]];
  };

  const outBuf = new Uint8ClampedArray(w * h * 4);
  const leftX = Math.max(rx0, x0 - 2);
  const rightX = Math.min(rx1 - 1, x1 + 1);
  const topY = Math.max(ry0, y0 - 2);
  const bottomY = Math.min(ry1 - 1, y1 + 1);

  for (let py = 0; py < h; py += 1) {
    const gy = y0 + py;
    const [lr, lg, lb] = samplePx(leftX, gy);
    const [rr, rg, rb] = samplePx(rightX, gy);

    for (let px = 0; px < w; px += 1) {
      const gx = x0 + px;
      const [tr, tg, tb] = samplePx(gx, topY);
      const [br, bg, bb] = samplePx(gx, bottomY);

      const wL = 1 / ((px + 2) * (px + 2));
      const wR = 1 / ((w - px + 2) * (w - px + 2));
      const wT = 1 / ((py + 2) * (py + 2));
      const wB = 1 / ((h - py + 2) * (h - py + 2));
      const wSum = wL + wR + wT + wB;

      const idx = (py * w + px) * 4;
      outBuf[idx] = clampByte((lr * wL + rr * wR + tr * wT + br * wB) / wSum);
      outBuf[idx + 1] = clampByte((lg * wL + rg * wR + tg * wT + bg * wB) / wSum);
      outBuf[idx + 2] = clampByte((lb * wL + rb * wR + tb * wT + bb * wB) / wSum);
      outBuf[idx + 3] = 255;
    }
  }

  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = w;
  patchCanvas.height = h;
  const patchCtx = patchCanvas.getContext('2d');
  if (!patchCtx) {
    return undefined;
  }
  patchCtx.putImageData(new ImageData(outBuf, w, h), 0, 0);
  return {
    dataUrl: patchCanvas.toDataURL('image/png'),
    x: x0 / canvasScale,
    y: y0 / canvasScale,
    width: w / canvasScale,
    height: h / canvasScale,
  };
}

/**
 * Analyse les pixels d'un bloc sur le canvas pour retrouver sa couleur d'encre réelle,
 * estimer s'il est gras/italique et proposer la police la plus proche (utile pour les scans OCR).
 */
export function analyzeTextVisualStyle(
  pageCanvas: HTMLCanvasElement,
  rectPx: RgbaRect,
  hintFontName?: string,
): DetectedVisualStyle {
  const fallback: DetectedVisualStyle = {
    color: '#111827',
    fontFamily: 'Arial, Helvetica, sans-serif',
    detectedFontLabel: 'Sans-serif (Arial / Helvetica)',
    bold: false,
    italic: false,
  };

  const ctx = pageCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return fallback;
  }

  const x0 = Math.max(0, Math.floor(rectPx.x));
  const y0 = Math.max(0, Math.floor(rectPx.y));
  const w = Math.min(pageCanvas.width - x0, Math.max(1, Math.ceil(rectPx.width)));
  const h = Math.min(pageCanvas.height - y0, Math.max(1, Math.ceil(rectPx.height)));
  if (w < 3 || h < 3) {
    return fallback;
  }

  const { data } = ctx.getImageData(x0, y0, w, h);
  // Estimation du fond local par tranches de 24 px pour rester fiable même sur un dégradé
  const sliceWidth = 24;
  const numSlices = Math.max(1, Math.ceil(w / sliceWidth));
  const sliceBgs: Array<[number, number, number]> = [];
  for (let s = 0; s < numSlices; s += 1) {
    const cx = Math.min(w - 1, s * sliceWidth + Math.floor(sliceWidth / 2));
    sliceBgs.push(estimateLocalBackground(data, w, h, cx, Math.floor(h / 2), 0, 0, w, h));
  }

  // Récupère les pixels d'encre les plus contrastés par rapport au fond local
  const inkPixels: Array<{ x: number; y: number; r: number; g: number; b: number; distSq: number }> = [];

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const [bgR, bgG, bgB] = sliceBgs[Math.min(numSlices - 1, Math.floor(x / sliceWidth))];
      const distSq = colorDistanceSq(r, g, b, bgR, bgG, bgB);
      if (distSq > 40 * 40) {
        inkPixels.push({ x, y, r, g, b, distSq });
      }
    }
  }

  let inkColor = '#111827';
  if (inkPixels.length > 0) {
    // Garde le tiers supérieur des pixels les plus contrastés (cœur du trait, hors lissage de bord)
    const sorted = [...inkPixels].sort((a, b) => b.distSq - a.distSq);
    const sampleCount = Math.max(1, Math.ceil(sorted.length * 0.3));
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      sumR += sorted[i].r;
      sumG += sorted[i].g;
      sumB += sorted[i].b;
    }
    inkColor = rgbToHex(sumR / sampleCount, sumG / sampleCount, sumB / sampleCount);
  }

  const cropMetrics = extractScanBinaryCropFromRgba(data, w, h);

  // Indice de graisse : densité de pixels d'encre, épaisseur relative de trait et indice éventuel
  const inkRatio = inkPixels.length / (w * h);
  const lowerHint = (hintFontName ?? '').toLowerCase();
  const adjustedStrokeRatio = cropMetrics
    ? Math.max(0, cropMetrics.strokeWidthRatio - 0.65 / Math.max(10, cropMetrics.height))
    : 0;
  const isBold =
    lowerHint.includes('bold') ||
    lowerHint.includes('black') ||
    lowerHint.includes('heavy') ||
    inkRatio > 0.34 ||
    Boolean(cropMetrics && (adjustedStrokeRatio > 0.15 || cropMetrics.fillRatio > 0.38));

  // Indice d'italique fiable par composante connexe individuelle (ou nom de police)
  const isItalic =
    lowerHint.includes('italic') ||
    lowerHint.includes('oblique') ||
    Boolean(cropMetrics && cropMetrics.medianSlant > 0.115);

  // Choix de la famille la plus proche : indice PDF/Tesseract ou analyse morphologique locale
  const hintWithoutSans = lowerHint.replace(/sans-serif/g, 'sansserif');
  let fontFamily: string = CURATED_FONT_FAMILIES[0].value;
  let detectedFontLabel: string = CURATED_FONT_FAMILIES[0].label;

  const knownNamedMatches: Array<[string, string, 'sans-serif' | 'serif' | 'monospace']> = [
    ['calibri light', 'Calibri Light', 'sans-serif'],
    ['calibri', 'Calibri', 'sans-serif'],
    ['cambria', 'Cambria', 'serif'],
    ['times', 'Times New Roman', 'serif'],
    ['georgia', 'Georgia', 'serif'],
    ['garamond', 'Garamond', 'serif'],
    ['palatino', 'Palatino Linotype', 'serif'],
    ['book antiqua', 'Book Antiqua', 'serif'],
    ['constantia', 'Constantia', 'serif'],
    ['verdana', 'Verdana', 'sans-serif'],
    ['segoe ui', 'Segoe UI', 'sans-serif'],
    ['tahoma', 'Tahoma', 'sans-serif'],
    ['trebuchet', 'Trebuchet MS', 'sans-serif'],
    ['candara', 'Candara', 'sans-serif'],
    ['corbel', 'Corbel', 'sans-serif'],
    ['consolas', 'Consolas', 'monospace'],
    ['courier', 'Courier New', 'monospace'],
  ];

  const namedHit = knownNamedMatches.find(([kw]) => hintWithoutSans.includes(kw));
  if (namedHit) {
    fontFamily = formatCssFontStack(namedHit[1], namedHit[2]);
    detectedFontLabel = namedHit[1];
  } else if (hintWithoutSans.includes('serif') || hintWithoutSans.includes('roman')) {
    fontFamily = CURATED_FONT_FAMILIES[1].value;
    detectedFontLabel = CURATED_FONT_FAMILIES[1].label;
  } else if (lowerHint.includes('mono')) {
    fontFamily = CURATED_FONT_FAMILIES[2].value;
    detectedFontLabel = CURATED_FONT_FAMILIES[2].label;
  } else if (cropMetrics) {
    if (cropMetrics.isMonospace) {
      fontFamily = CURATED_FONT_FAMILIES[2].value;
      detectedFontLabel = `${CURATED_FONT_FAMILIES[2].label} (détectée)`;
    } else if (cropMetrics.serifScore >= 1.24) {
      fontFamily = CURATED_FONT_FAMILIES[1].value;
      detectedFontLabel = `${CURATED_FONT_FAMILIES[1].label} (détectée)`;
    } else {
      detectedFontLabel = `${CURATED_FONT_FAMILIES[0].label} (détectée)`;
    }
  }

  return {
    color: inkColor,
    fontFamily,
    detectedFontLabel,
    bold: isBold,
    italic: isItalic,
  };
}
