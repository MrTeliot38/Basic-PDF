// Moteur hors ligne du scanner de documents : détection de feuille en direct, correction de perspective, filtres et création PDF
import { PDFDocument } from 'pdf-lib';

export interface ScanPoint {
  /** Coordonnée horizontale normalisée (0 à 1) */
  x: number;
  /** Coordonnée verticale normalisée (0 à 1) */
  y: number;
}

export interface ScanQuad {
  topLeft: ScanPoint;
  topRight: ScanPoint;
  bottomRight: ScanPoint;
  bottomLeft: ScanPoint;
}

export type ScanQuality = 'leger' | 'standard' | 'haute';
export type ScanColorMode = 'couleur' | 'nb' | 'gris';

export interface DetectedQuadResult {
  quad: ScanQuad;
  confidence: number;
  detected: boolean;
}

export interface ScannedPageEntry {
  id: string;
  rawDataUrl: string;
  rawWidth: number;
  rawHeight: number;
  quad: ScanQuad;
  rotationDeg: 0 | 90 | 180 | 270;
  colorMode: ScanColorMode;
  quality: ScanQuality;
  processedDataUrl: string;
  processedWidth: number;
  processedHeight: number;
}

export function getDefaultScanQuad(): ScanQuad {
  return {
    topLeft: { x: 0.1, y: 0.1 },
    topRight: { x: 0.9, y: 0.1 },
    bottomRight: { x: 0.9, y: 0.9 },
    bottomLeft: { x: 0.1, y: 0.9 },
  };
}

export function clampPoint(p: ScanPoint): ScanPoint {
  return {
    x: Math.max(0.01, Math.min(0.99, p.x)),
    y: Math.max(0.01, Math.min(0.99, p.y)),
  };
}

/** Lisse les mouvements du cadre bleu d'une image vidéo à l'autre pour éviter les tremblements */
export function smoothScanQuad(prev: ScanQuad, next: ScanQuad, alpha = 0.35): ScanQuad {
  const lerp = (a: ScanPoint, b: ScanPoint): ScanPoint => ({
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
  });
  return {
    topLeft: lerp(prev.topLeft, next.topLeft),
    topRight: lerp(prev.topRight, next.topRight),
    bottomRight: lerp(prev.bottomRight, next.bottomRight),
    bottomLeft: lerp(prev.bottomLeft, next.bottomLeft),
  };
}

function quadAreaNormalized(q: ScanQuad): number {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

function isConvexQuad(q: ScanQuad): boolean {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % 4];
    const p2 = pts[(i + 2) % 4];
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cross) < 1e-4) return false;
    const curSign = cross > 0 ? 1 : -1;
    if (sign === 0) sign = curSign;
    else if (sign !== curSign) return false;
  }
  return true;
}

/**
 * Détecte automatiquement les 4 coins d'une feuille claire posée devant la caméra
 * (sans aucune bibliothèque cloud, en moins de quelques millisecondes).
 */
export function detectDocumentQuad(imageData: ImageData): DetectedQuadResult {
  const srcW = imageData.width;
  const srcH = imageData.height;
  if (srcW < 16 || srcH < 16) {
    return { quad: getDefaultScanQuad(), confidence: 0, detected: false };
  }

  // Sous-échantillonnage rapide vers ~160 px de large
  const step = Math.max(1, Math.floor(srcW / 160));
  const w = Math.max(16, Math.floor(srcW / step));
  const h = Math.max(16, Math.floor(srcH / step));
  const total = w * h;

  const scores = new Uint8Array(total);
  const hist = new Int32Array(256);
  const data = imageData.data;

  for (let y = 0; y < h; y += 1) {
    const sy = y * step;
    for (let x = 0; x < w; x += 1) {
      const sx = x * step;
      const idx = (sy * srcW + sx) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = maxC - minC;
      // Le papier est plus lumineux et moins saturé qu'un bureau ou une nappe
      const score = Math.max(0, Math.min(255, Math.round(lum - chroma * 0.45)));
      scores[y * w + x] = score;
      hist[score] += 1;
    }
  }

  // Seuil d'Otsu pour séparer automatiquement la feuille du fond
  let sumAll = 0;
  for (let i = 0; i < 256; i += 1) {
    sumAll += i * hist[i];
  }

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let bestTStart = 135;
  let bestTEnd = 135;

  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar + 1e-6) {
      maxVar = varBetween;
      bestTStart = t;
      bestTEnd = t;
    } else if (Math.abs(varBetween - maxVar) <= 1e-6) {
      bestTEnd = t;
    }
  }
  const threshold = Math.round((bestTStart + bestTEnd) / 2);

  // Vérification que la feuille se distingue nettement de l'arrière-plan
  let fgSum = 0;
  let fgCount = 0;
  let bgSum = 0;
  let bgCount = 0;
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    if (scores[i] > threshold) {
      mask[i] = 1;
      fgSum += scores[i];
      fgCount += 1;
    } else {
      bgSum += scores[i];
      bgCount += 1;
    }
  }

  if (fgCount === 0 || bgCount === 0) {
    return { quad: getDefaultScanQuad(), confidence: 0, detected: false };
  }

  const fgMean = fgSum / fgCount;
  const bgMean = bgSum / bgCount;
  const contrastGap = fgMean - bgMean;
  if (contrastGap < 22 || fgMean < 105) {
    return { quad: getDefaultScanQuad(), confidence: 0, detected: false };
  }

  // Recherche de la plus grande composante connexe (la feuille principale)
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let bestCount = 0;
  let bestIndices: number[] = [];

  for (let start = 0; start < total; start += 1) {
    if (mask[start] === 0 || visited[start] === 1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const comp: number[] = [];

    while (head < tail) {
      const cur = queue[head++];
      comp.push(cur);
      const cx = cur % w;
      const cy = Math.floor(cur / w);

      if (cx > 0 && mask[cur - 1] && !visited[cur - 1]) {
        visited[cur - 1] = 1;
        queue[tail++] = cur - 1;
      }
      if (cx + 1 < w && mask[cur + 1] && !visited[cur + 1]) {
        visited[cur + 1] = 1;
        queue[tail++] = cur + 1;
      }
      if (cy > 0 && mask[cur - w] && !visited[cur - w]) {
        visited[cur - w] = 1;
        queue[tail++] = cur - w;
      }
      if (cy + 1 < h && mask[cur + w] && !visited[cur + w]) {
        visited[cur + w] = 1;
        queue[tail++] = cur + w;
      }
    }

    if (comp.length > bestCount) {
      bestCount = comp.length;
      bestIndices = comp;
    }
  }

  const coverage = bestCount / total;
  if (coverage < 0.08 || coverage > 0.94) {
    return { quad: getDefaultScanQuad(), confidence: 0, detected: false };
  }

  // Repérage des 4 coins extrêmes (x+y min/max et x-y min/max) sur la feuille détectée
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  let tl = { x: 0.1, y: 0.1 };
  let br = { x: 0.9, y: 0.9 };
  let tr = { x: 0.9, y: 0.1 };
  let bl = { x: 0.1, y: 0.9 };

  for (const idx of bestIndices) {
    const px = idx % w;
    const py = Math.floor(idx / w);
    const sum = px + py;
    const diff = px - py;
    const nx = (px + 0.5) / w;
    const ny = (py + 0.5) / h;

    if (sum < minSum) {
      minSum = sum;
      tl = { x: nx, y: ny };
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = { x: nx, y: ny };
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = { x: nx, y: ny };
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = { x: nx, y: ny };
    }
  }

  const candidate: ScanQuad = {
    topLeft: clampPoint(tl),
    topRight: clampPoint(tr),
    bottomRight: clampPoint(br),
    bottomLeft: clampPoint(bl),
  };

  const area = quadAreaNormalized(candidate);
  if (area < 0.07 || area > 0.95 || !isConvexQuad(candidate)) {
    return { quad: getDefaultScanQuad(), confidence: 0, detected: false };
  }

  return {
    quad: candidate,
    confidence: Math.max(0.2, Math.min(1, contrastGap / 65)),
    detected: true,
  };
}

/**
 * Calcule les 8 coefficients de la matrice d'homographie 3×3 transformant
 * les points destination (u, v) vers la source (x, y) pour un redressement sans trous.
 */
export function computePerspectiveTransform(
  dstPts: [ScanPoint, ScanPoint, ScanPoint, ScanPoint],
  srcPts: [ScanPoint, ScanPoint, ScanPoint, ScanPoint],
): number[] {
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const u = dstPts[i].x;
    const v = dstPts[i].y;
    const x = srcPts[i].x;
    const y = srcPts[i].y;
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    B.push(y);
  }

  const n = 8;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) {
        pivot = row;
      }
    }
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [B[col], B[pivot]] = [B[pivot], B[col]];

    const diag = A[col][col];
    if (Math.abs(diag) < 1e-10) {
      throw new Error('Coins invalides : impossible de redresser la perspective.');
    }

    for (let row = col + 1; row < n; row += 1) {
      const factor = A[row][col] / diag;
      for (let k = col; k < n; k += 1) {
        A[row][k] -= factor * A[col][k];
      }
      B[row] -= factor * B[col];
    }
  }

  const h = new Array<number>(9);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = B[row];
    for (let k = row + 1; k < n; k += 1) {
      sum -= A[row][k] * h[k];
    }
    h[row] = sum / A[row][row];
  }
  h[8] = 1;
  return h;
}

export function getQualitySettings(quality: ScanQuality): {
  maxSidePx: number;
  jpegQuality: number;
  label: string;
} {
  switch (quality) {
    case 'leger':
      return { maxSidePx: 1100, jpegQuality: 0.58, label: 'Léger' };
    case 'haute':
      return { maxSidePx: 2500, jpegQuality: 0.92, label: 'Haute' };
    case 'standard':
    default:
      return { maxSidePx: 1750, jpegQuality: 0.8, label: 'Standard' };
  }
}

/** Applique le traitement document (Couleur propre, Niveaux de gris ou Noir et blanc net) */
export function applyDocumentFilter(imageData: ImageData, mode: ScanColorMode): ImageData {
  const { width, height, data } = imageData;
  const total = width * height;

  if (mode === 'couleur') {
    // Éclaircissement doux du fond papier tout en gardant la couleur des stylos/tampons
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum > 185) {
        const lift = (lum - 185) * 0.65;
        data[i] = Math.min(255, Math.round(data[i] + lift));
        data[i + 1] = Math.min(255, Math.round(data[i + 1] + lift));
        data[i + 2] = Math.min(255, Math.round(data[i + 2] + lift));
      } else {
        // Contraste léger sur les textes sombres
        data[i] = Math.max(0, Math.round((data[i] - 128) * 1.12 + 122));
        data[i + 1] = Math.max(0, Math.round((data[i + 1] - 128) * 1.12 + 122));
        data[i + 2] = Math.max(0, Math.round((data[i + 2] - 128) * 1.12 + 122));
      }
    }
    return imageData;
  }

  const lums = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    lums[i] = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
  }

  if (mode === 'gris') {
    for (let i = 0; i < total; i += 1) {
      const v = Math.max(0, Math.min(255, Math.round((lums[i] - 125) * 1.3 + 135)));
      const p = i * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
    }
    return imageData;
  }

  // Noir et blanc adaptatif par image intégrale : supprime les ombres d'éclairage inégal
  const stride = width + 1;
  const integral = new Int32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    const srcRow = (y - 1) * width;
    const dstRow = y * stride;
    const prevRow = (y - 1) * stride;
    for (let x = 1; x <= width; x += 1) {
      rowSum += lums[srcRow + (x - 1)];
      integral[dstRow + x] = integral[prevRow + x] + rowSum;
    }
  }

  const radius = Math.max(8, Math.min(24, Math.round(Math.min(width, height) * 0.025)));
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];
      const localMean = sum / area;
      const lum = lums[y * width + x];
      const out = lum < localMean - 11 ? 22 : 255;
      const p = (y * width + x) * 4;
      data[p] = out;
      data[p + 1] = out;
      data[p + 2] = out;
      data[p + 3] = 255;
    }
  }

  return imageData;
}

/**
 * Redresse la feuille sélectionnée depuis un canvas source selon les 4 coins choisis,
 * applique rotation/qualité/mode couleur et renvoie l'image JPEG prête pour le PDF.
 */
export function warpPerspectiveQuadToCanvas(
  sourceCanvas: HTMLCanvasElement,
  quad: ScanQuad,
  options: {
    quality: ScanQuality;
    colorMode: ScanColorMode;
    rotationDeg?: 0 | 90 | 180 | 270;
  },
): HTMLCanvasElement {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) {
    throw new Error('Contexte graphique 2D indisponible pour le redressement.');
  }
  const srcImage = srcCtx.getImageData(0, 0, sw, sh);
  const srcPixels = srcImage.data;

  const pTL = { x: quad.topLeft.x * sw, y: quad.topLeft.y * sh };
  const pTR = { x: quad.topRight.x * sw, y: quad.topRight.y * sh };
  const pBR = { x: quad.bottomRight.x * sw, y: quad.bottomRight.y * sh };
  const pBL = { x: quad.bottomLeft.x * sw, y: quad.bottomLeft.y * sh };

  const dist = (a: ScanPoint, b: ScanPoint) => Math.hypot(b.x - a.x, b.y - a.y);
  let naturalW = Math.max(dist(pTL, pTR), dist(pBL, pBR));
  let naturalH = Math.max(dist(pTL, pBL), dist(pTR, pBR));
  naturalW = Math.max(64, naturalW);
  naturalH = Math.max(64, naturalH);

  const preset = getQualitySettings(options.quality);
  const longest = Math.max(naturalW, naturalH);
  const scale = longest > preset.maxSidePx ? preset.maxSidePx / longest : 1;
  const outW = Math.max(64, Math.round(naturalW * scale));
  const outH = Math.max(64, Math.round(naturalH * scale));

  const hMat = computePerspectiveTransform(
    [
      { x: 0, y: 0 },
      { x: outW - 1, y: 0 },
      { x: outW - 1, y: outH - 1 },
      { x: 0, y: outH - 1 },
    ],
    [pTL, pTR, pBR, pBL],
  );

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) {
    throw new Error('Impossible de créer le canvas de sortie.');
  }
  const outImg = outCtx.createImageData(outW, outH);
  const outData = outImg.data;

  const h0 = hMat[0];
  const h1 = hMat[1];
  const h2 = hMat[2];
  const h3 = hMat[3];
  const h4 = hMat[4];
  const h5 = hMat[5];
  const h6 = hMat[6];
  const h7 = hMat[7];

  for (let dy = 0; dy < outH; dy += 1) {
    const vH1 = h1 * dy + h2;
    const vH4 = h4 * dy + h5;
    const vH7 = h7 * dy + 1;
    for (let dx = 0; dx < outW; dx += 1) {
      const denom = h6 * dx + vH7;
      const sx = (h0 * dx + vH1) / denom;
      const sy = (h3 * dx + vH4) / denom;

      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));

      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const dstIdx = (dy * outW + dx) * 4;
      outData[dstIdx] = Math.round(
        srcPixels[i00] * w00 +
          srcPixels[i10] * w10 +
          srcPixels[i01] * w01 +
          srcPixels[i11] * w11,
      );
      outData[dstIdx + 1] = Math.round(
        srcPixels[i00 + 1] * w00 +
          srcPixels[i10 + 1] * w10 +
          srcPixels[i01 + 1] * w01 +
          srcPixels[i11 + 1] * w11,
      );
      outData[dstIdx + 2] = Math.round(
        srcPixels[i00 + 2] * w00 +
          srcPixels[i10 + 2] * w10 +
          srcPixels[i01 + 2] * w01 +
          srcPixels[i11 + 2] * w11,
      );
      outData[dstIdx + 3] = 255;
    }
  }

  applyDocumentFilter(outImg, options.colorMode);
  outCtx.putImageData(outImg, 0, 0);

  const rot = options.rotationDeg ?? 0;
  if (rot === 0) {
    return outCanvas;
  }

  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = rot === 90 || rot === 270 ? outH : outW;
  rotCanvas.height = rot === 90 || rot === 270 ? outW : outH;
  const rCtx = rotCanvas.getContext('2d');
  if (!rCtx) return outCanvas;
  rCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
  rCtx.rotate((rot * Math.PI) / 180);
  rCtx.drawImage(outCanvas, -outW / 2, -outH / 2);
  return rotCanvas;
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Impossible de relire la photo scannée.'));
    img.src = dataUrl;
  });
}

export async function processRawScanDataUrl(
  rawDataUrl: string,
  quad: ScanQuad,
  options: {
    quality: ScanQuality;
    colorMode: ScanColorMode;
    rotationDeg: 0 | 90 | 180 | 270;
  },
): Promise<{ processedDataUrl: string; width: number; height: number }> {
  const img = await loadImageElement(rawDataUrl);
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.naturalWidth || img.width;
  srcCanvas.height = img.naturalHeight || img.height;
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Impossible de charger la photo dans le navigateur.');
  }
  ctx.drawImage(img, 0, 0);

  const resultCanvas = warpPerspectiveQuadToCanvas(srcCanvas, quad, options);
  const preset = getQualitySettings(options.quality);
  return {
    processedDataUrl: resultCanvas.toDataURL('image/jpeg', preset.jpegQuality),
    width: resultCanvas.width,
    height: resultCanvas.height,
  };
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Assemble toutes les pages scannées en un fichier PDF multipage prêt à enregistrer ou partager */
export async function buildScannedPdfBytes(
  pages: Array<{ processedDataUrl: string; processedWidth?: number; processedHeight?: number }>,
): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new Error('Ajoutez au moins une page avant de créer le PDF.');
  }

  const pdfDoc = await PDFDocument.create();
  for (const pageItem of pages) {
    const jpgBytes = dataUrlToUint8Array(pageItem.processedDataUrl);
    const embedded = await pdfDoc.embedJpg(jpgBytes);
    const imgW = embedded.width;
    const imgH = embedded.height;

    // Mise à l'échelle propre sur une page A4 en conservant portrait/paysage exact
    const isLandscape = imgW > imgH;
    const pageW = isLandscape ? 841.89 : 595.28;
    const pageH = isLandscape ? 595.28 : 841.89;
    const scale = Math.min(pageW / imgW, pageH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const page = pdfDoc.addPage([pageW, pageH]);
    page.drawImage(embedded, {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }

  return pdfDoc.save();
}
