// Moteur hors ligne de reconnaissance visuelle des polices d'écriture (toutes polices PC + catalogue enrichi)
import type { EditableTextBlock, TextStyle } from '../types/pdf';
import { classifyFontCategory, type FontVisualCategory } from './fontMatching';

/** Catalogue enrichi utilisé sur le Web, PWA et Android lorsque les polices système complètes ne sont pas exposées */
export const ENRICHED_RECOGNITION_FAMILIES = [
  // Sans-serif courantes
  'Calibri',
  'Calibri Light',
  'Segoe UI',
  'Arial',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Candara',
  'Corbel',
  'Century Gothic',
  'Helvetica',
  'Roboto',
  'Open Sans',
  'Liberation Sans',
  'DejaVu Sans',
  'Noto Sans',
  // Serif courantes
  'Times New Roman',
  'Georgia',
  'Cambria',
  'Garamond',
  'Palatino Linotype',
  'Book Antiqua',
  'Constantia',
  'Century Schoolbook',
  'Baskerville',
  'Liberation Serif',
  'DejaVu Serif',
  'Noto Serif',
  // Chasse fixe
  'Courier New',
  'Consolas',
  'Lucida Console',
  'Cascadia Mono',
  'DejaVu Sans Mono',
] as const;

const EXCLUDED_SYMBOL_PATTERNS = [
  'wingdings',
  'webdings',
  'symbol',
  'marlett',
  'mdl2',
  'fluent icons',
  'emoji',
  'dingbat',
  'hololens',
  'bookshelf',
  'mt extra',
  'barcode',
  'segoe script',
  'segoe print',
];

const CORE_OFFICE_CANDIDATES = new Set([
  'times new roman',
  'georgia',
  'cambria',
  'garamond',
  'palatino linotype',
  'book antiqua',
  'constantia',
  'calibri',
  'calibri light',
  'arial',
  'verdana',
  'segoe ui',
  'tahoma',
  'trebuchet ms',
  'candara',
  'corbel',
  'courier new',
  'consolas',
]);

export interface FontMatchCandidateInput {
  family: string;
  category?: FontVisualCategory;
}

export interface WordSampleBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FontGeometricProfile {
  family: string;
  category: FontVisualCategory;
  aspectRatio: number;
  fillRatio: number;
  serifScore: number;
  isMonospace: boolean;
}

export interface BinaryCrop {
  width: number;
  height: number;
  /** Valeurs d'encre normalisées entre 0 et 1 */
  data: Float32Array;
  aspectRatio: number;
  fillRatio: number;
  serifScore: number;
  medianSlant: number;
  strokeWidthRatio: number;
  isMonospace: boolean;
}

export interface VisualFontRecognitionResult {
  fontFamily: string;
  matchedFamilyName: string;
  detectedFontLabel: string;
  bold: boolean;
  italic: boolean;
  category: FontVisualCategory;
  confidence: number;
}

const fontProfileCache = new Map<string, FontGeometricProfile | null>();

/** Filtre les polices de symboles, icônes ou codes-barres inutiles pour le texte courant */
export function isValidTextFontFamily(family: string): boolean {
  const lower = family.trim().toLowerCase();
  if (!lower || lower.length < 2) {
    return false;
  }
  return !EXCLUDED_SYMBOL_PATTERNS.some((kw) => lower.includes(kw));
}

/** Retourne la pile CSS propre avec secours générique selon la catégorie */
export function formatCssFontStack(family: string, category?: FontVisualCategory): string {
  const cat = category ?? classifyFontCategory(family);
  const clean = family.replace(/["']/g, '').trim();
  if (!clean) {
    return cat === 'serif'
      ? 'Georgia, "Times New Roman", serif'
      : cat === 'monospace'
        ? '"Courier New", Consolas, monospace'
        : 'Arial, Helvetica, sans-serif';
  }
  return `"${clean}", ${cat}`;
}

/**
 * Calcule les métriques fines d'un tampon RGBA (fond estimé localement) :
 * - détection lettre par lettre de l'italique (médiane des pentes par composante connexe)
 * - détection des empattements (évasement haut/bas par colonne de caractère)
 * - détection de graisse (épaisseur relative de trait et densité dans la zone d'encre serrée)
 */
export function extractScanBinaryCropFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryCrop | null {
  if (width < 4 || height < 4) {
    return null;
  }

  // Estime la luminosité de fond sur le pourtour extérieur et les blancs dominants
  const samples: Array<[number, number, number]> = [];
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 24))) {
    const topIdx = x * 4;
    const botIdx = ((height - 1) * width + x) * 4;
    samples.push([rgba[topIdx], rgba[topIdx + 1], rgba[topIdx + 2]]);
    samples.push([rgba[botIdx], rgba[botIdx + 1], rgba[botIdx + 2]]);
  }
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  // Médiane haute (3e quartile) pour rester insensible aux lettres touchant le haut/bas
  const q3 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.75))] ?? [255, 255, 255];
  const bgR = q3[0];
  const bgG = q3[1];
  const bgB = q3[2];

  const rawDist = new Float32Array(width * height);
  let maxObservedDist = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const dist = Math.hypot(rgba[idx] - bgR, rgba[idx + 1] - bgG, rgba[idx + 2] - bgB);
      if (dist > 34) {
        rawDist[y * width + x] = dist;
        if (dist > maxObservedDist) {
          maxObservedDist = dist;
        }
      }
    }
  }

  if (maxObservedDist <= 34) {
    return null;
  }

  // Normalise l'intensité d'encre relativement au pic de contraste réel du bloc (évite d'épaissir l'anticrénelage)
  const inkDenom = Math.max(140, maxObservedDist * 0.92);
  const rawInk = new Float32Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dist = rawDist[y * width + x];
      if (dist > 34) {
        const strength = Math.min(1, (dist - 22) / inkDenom);
        rawInk[y * width + x] = strength;
        if (strength > 0.22) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  if (maxX <= minX + 1 || maxY <= minY + 1) {
    return null;
  }

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const data = new Float32Array(cw * ch);
  let sumInk = 0;

  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const val = rawInk[(minY + y) * width + (minX + x)];
      data[y * cw + x] = val;
      if (val > 0.2) {
        sumInk += 1;
      }
    }
  }

  return analyzeTightInkBuffer(data, cw, ch, sumInk);
}

/** Mesure inclinaison, graisse, empattements et régularité de chasse sur un crop binaire serré */
export function analyzeTightInkBuffer(
  data: Float32Array,
  cw: number,
  ch: number,
  precomputedCount?: number,
): BinaryCrop {
  let activeCount = precomputedCount ?? 0;
  if (precomputedCount === undefined) {
    for (let i = 0; i < data.length; i += 1) {
      if (data[i] > 0.2) {
        activeCount += 1;
      }
    }
  }

  const fillRatio = activeCount / Math.max(1, cw * ch);
  const aspectRatio = cw / Math.max(1, ch);

  // 1. Découpe en tranches verticales (chaque glyphe ou groupe étroit) pour mesurer pente et pas
  const colHasInk = new Uint8Array(cw);
  for (let x = 0; x < cw; x += 1) {
    for (let y = 0; y < ch; y += 1) {
      if (data[y * cw + x] > 0.25) {
        colHasInk[x] = 1;
        break;
      }
    }
  }

  const charSlices: Array<{ x0: number; x1: number }> = [];
  let inSlice = false;
  let sStart = 0;
  for (let x = 0; x < cw; x += 1) {
    if (colHasInk[x]) {
      if (!inSlice) {
        inSlice = true;
        sStart = x;
      }
    } else if (inSlice) {
      if (x - sStart >= 2) {
        charSlices.push({ x0: sStart, x1: x - 1 });
      }
      inSlice = false;
    }
  }
  if (inSlice && cw - sStart >= 2) {
    charSlices.push({ x0: sStart, x1: cw - 1 });
  }

  // Pente italique médiane calculée individuellement par glyphe (insensible aux longs blancs)
  const slants: number[] = [];
  for (const sl of charSlices) {
    const sw = sl.x1 - sl.x0 + 1;
    // Écarte les tranches très larges (plusieurs lettres fusionnées) ou minuscules (points)
    if (sw > Math.max(8, ch * 1.4)) {
      continue;
    }
    let minSy = ch;
    let maxSy = -1;
    let sumW = 0;
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < ch; y += 1) {
      for (let x = sl.x0; x <= sl.x1; x += 1) {
        const w = data[y * cw + x];
        if (w > 0.25) {
          if (y < minSy) minSy = y;
          if (y > maxSy) maxSy = y;
          sumW += w;
          sumX += x * w;
          sumY += y * w;
        }
      }
    }
    const glyphH = maxSy - minSy + 1;
    if (sumW < 6 || glyphH < Math.max(6, ch * 0.38)) {
      continue;
    }
    const cx = sumX / sumW;
    const cy = sumY / sumW;
    let num = 0;
    let den = 0;
    for (let y = minSy; y <= maxSy; y += 1) {
      for (let x = sl.x0; x <= sl.x1; x += 1) {
        const w = data[y * cw + x];
        if (w > 0.25) {
          // Rappel écran (y vers le bas) : sur de l'italique (/), en haut (y < cy) -> x > cx
          num += w * (x - cx) * (cy - y);
          den += w * (y - cy) * (y - cy);
        }
      }
    }
    if (den > 4) {
      const slope = num / den;
      if (Number.isFinite(slope) && slope > -0.35 && slope < 0.65) {
        slants.push(slope);
      }
    }
  }

  slants.sort((a, b) => a - b);
  const medianSlant = slants.length > 0 ? slants[Math.floor(slants.length / 2)] : 0;

  // 2. Score d'empattements : compare l'encre sur les pieds/têtes locaux (haut/bas de la hauteur utile)
  // au cœur des fûts verticaux de chaque tranche de caractère
  let flareSum = 0;
  let coreSum = 0;
  for (const sl of charSlices) {
    let minSy = ch;
    let maxSy = -1;
    for (let y = 0; y < ch; y += 1) {
      for (let x = sl.x0; x <= sl.x1; x += 1) {
        if (data[y * cw + x] > 0.25) {
          if (y < minSy) minSy = y;
          if (y > maxSy) maxSy = y;
        }
      }
    }
    const gh = maxSy - minSy + 1;
    if (gh < 7) {
      continue;
    }
    const band = Math.max(1, Math.round(gh * 0.14));
    const midY0 = minSy + Math.floor(gh * 0.38);
    const midY1 = minSy + Math.ceil(gh * 0.62);
    let edgeCols = 0;
    let midCols = 0;

    for (let x = sl.x0; x <= sl.x1; x += 1) {
      let hasEdge = false;
      for (let y = minSy; y < minSy + band; y += 1) {
        if (data[y * cw + x] > 0.25) hasEdge = true;
      }
      for (let y = maxSy - band + 1; y <= maxSy; y += 1) {
        if (data[y * cw + x] > 0.25) hasEdge = true;
      }
      let hasMid = false;
      for (let y = midY0; y <= midY1; y += 1) {
        if (data[y * cw + x] > 0.25) hasMid = true;
      }
      if (hasEdge) edgeCols += 1;
      if (hasMid) midCols += 1;
    }
    flareSum += edgeCols;
    coreSum += midCols;
  }
  const serifScore = coreSum > 0 ? flareSum / coreSum : 1;

  // 3. Épaisseur médiane des traits horizontaux (pour détecter le gras indépendamment des espaces)
  const runLengths: number[] = [];
  for (let y = Math.floor(ch * 0.25); y <= Math.floor(ch * 0.78); y += 1) {
    let run = 0;
    for (let x = 0; x < cw; x += 1) {
      if (data[y * cw + x] > 0.35) {
        run += 1;
      } else if (run > 0) {
        if (run < Math.max(4, ch * 0.48)) {
          runLengths.push(run);
        }
        run = 0;
      }
    }
    if (run > 0 && run < Math.max(4, ch * 0.48)) {
      runLengths.push(run);
    }
  }
  runLengths.sort((a, b) => a - b);
  const medianRun =
    runLengths.length > 0 ? runLengths[Math.floor(runLengths.length / 2)] : Math.max(1, ch * 0.08);
  const strokeWidthRatio = medianRun / Math.max(1, ch);

  // 4. Régularité des pas horizontaux entre caractères (monospace)
  let isMonospace = false;
  if (charSlices.length >= 4) {
    const pitches: number[] = [];
    for (let i = 1; i < charSlices.length; i += 1) {
      const cPrev = (charSlices[i - 1].x0 + charSlices[i - 1].x1) / 2;
      const cCurr = (charSlices[i].x0 + charSlices[i].x1) / 2;
      const step = cCurr - cPrev;
      if (step > 0 && step < ch * 1.4) {
        pitches.push(step);
      }
    }
    if (pitches.length >= 3) {
      const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
      const std = Math.sqrt(
        pitches.reduce((a, b) => a + (b - mean) * (b - mean), 0) / pitches.length,
      );
      if (mean > 2 && std / mean < 0.14) {
        isMonospace = true;
      }
    }
  }

  return {
    width: cw,
    height: ch,
    data,
    aspectRatio,
    fillRatio,
    serifScore,
    medianSlant,
    strokeWidthRatio,
    isMonospace,
  };
}

/**
 * Rend une chaîne de texte avec une police sur un canvas hors écran et retourne son crop serré.
 */
function renderFontSampleCrop(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  text: string,
  family: string,
  bold: boolean,
  italic: boolean,
  fontPx = 36,
): BinaryCrop | null {
  const cleanFam = family.replace(/["']/g, '').trim();
  const estW = Math.min(960, Math.max(64, Math.ceil(text.length * fontPx * 0.95) + 40));
  const estH = Math.ceil(fontPx * 1.8) + 20;
  if (canvas.width < estW) {
    canvas.width = estW;
  }
  if (canvas.height < estH) {
    canvas.height = estH;
  }

  ctx.clearRect(0, 0, estW, estH);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontPx}px "${cleanFam}", sans-serif`;
  ctx.fillText(text, 16, Math.floor(estH / 2));

  const img = ctx.getImageData(0, 0, estW, estH).data;
  let minX = estW;
  let minY = estH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < estH; y += 1) {
    for (let x = 0; x < estW; x += 1) {
      const alpha = img[(y * estW + x) * 4 + 3];
      if (alpha > 36) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX + 1 || maxY <= minY + 1) {
    return null;
  }

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const buf = new Float32Array(cw * ch);
  let active = 0;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const alpha = img[((minY + y) * estW + (minX + x)) * 4 + 3] / 255;
      buf[y * cw + x] = alpha;
      if (alpha > 0.2) {
        active += 1;
      }
    }
  }

  return analyzeTightInkBuffer(buf, cw, ch, active);
}

/** Vérifie que la police est réellement disponible sur l'appareil (ne se contente pas d'un repli générique) */
function isFontAvailableInCanvas(ctx: CanvasRenderingContext2D, family: string): boolean {
  const probeText = 'mmmmmmmmmmlli0123456789';
  ctx.font = '28px serif';
  const serifW = ctx.measureText(probeText).width;
  ctx.font = '28px sans-serif';
  const sansW = ctx.measureText(probeText).width;
  ctx.font = '28px monospace';
  const monoW = ctx.measureText(probeText).width;

  const cleanFam = family.replace(/["']/g, '').trim();
  ctx.font = `28px "${cleanFam}", serif`;
  const withSerif = ctx.measureText(probeText).width;
  ctx.font = `28px "${cleanFam}", sans-serif`;
  const withSans = ctx.measureText(probeText).width;
  ctx.font = `28px "${cleanFam}", monospace`;
  const withMono = ctx.measureText(probeText).width;

  return (
    Math.abs(withSerif - serifW) > 0.25 ||
    Math.abs(withSans - sansW) > 0.25 ||
    Math.abs(withMono - monoW) > 0.25
  );
}

/** Vérifie qu'une police système rend des glyphes latins distincts et pas des symboles identiques */
function isRealLatinTextFont(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  family: string,
): boolean {
  if (!isFontAvailableInCanvas(ctx, family)) {
    return false;
  }
  const cA = renderFontSampleCrop(ctx, canvas, 'a', family, false, false, 24);
  const cO = renderFontSampleCrop(ctx, canvas, 'O', family, false, false, 24);
  const cI = renderFontSampleCrop(ctx, canvas, 'i', family, false, false, 24);
  if (!cA || !cO || !cI) {
    return false;
  }
  // Si 'i' et 'O' ont exactement la même boîte et le même taux de remplissage, c'est probablement des glyphes manquants (tôles)
  if (
    cI.width === cO.width &&
    cI.height === cO.height &&
    Math.abs(cI.fillRatio - cO.fillRatio) < 0.01
  ) {
    return false;
  }
  // Vérifie une largeur réaliste pour 'a' vs 'O'
  return cA.width >= 4 && cO.height >= 8;
}

/** Construit et met en cache le profil typographique de toutes les polices candidates installées */
function getOrBuildFontProfiles(
  candidateFamilies: FontMatchCandidateInput[],
): FontGeometricProfile[] {
  if (typeof document === 'undefined') {
    return [];
  }
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 96;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return [];
  }

  const seen = new Set<string>();
  const profiles: FontGeometricProfile[] = [];

  for (const item of candidateFamilies) {
    const clean = item.family.replace(/["']/g, '').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key) || !isValidTextFontFamily(clean)) {
      continue;
    }
    seen.add(key);

    if (fontProfileCache.has(key)) {
      const cached = fontProfileCache.get(key);
      if (cached) {
        profiles.push(cached);
      }
      continue;
    }

    if (!isRealLatinTextFont(ctx, canvas, clean)) {
      fontProfileCache.set(key, null);
      continue;
    }

    const specimen = renderFontSampleCrop(ctx, canvas, 'Hae08g', clean, false, false, 28);
    if (!specimen) {
      fontProfileCache.set(key, null);
      continue;
    }

    const narrow = renderFontSampleCrop(ctx, canvas, 'iiii', clean, false, false, 24);
    const wide = renderFontSampleCrop(ctx, canvas, 'mmmm', clean, false, false, 24);
    const monoRatio = narrow && wide && wide.width > 0 ? narrow.width / wide.width : 0.35;
    const isMono = monoRatio > 0.78 || classifyFontCategory(clean) === 'monospace';
    const cat = isMono
      ? 'monospace'
      : item.category ?? classifyFontCategory(clean);

    const profile: FontGeometricProfile = {
      family: clean,
      category: cat,
      aspectRatio: specimen.aspectRatio,
      fillRatio: specimen.fillRatio,
      serifScore: specimen.serifScore,
      isMonospace: isMono,
    };
    fontProfileCache.set(key, profile);
    profiles.push(profile);
  }

  return profiles;
}

/** Redimensionne un crop binaire sur une grille normalisée (avec léger lissage bilinéaire) */
function resampleBinaryCrop(crop: BinaryCrop, targetW: number, targetH: number): Float32Array {
  const out = new Float32Array(targetW * targetH);
  for (let ty = 0; ty < targetH; ty += 1) {
    const sy = ((ty + 0.5) * crop.height) / targetH - 0.5;
    const y0 = Math.max(0, Math.min(crop.height - 1, Math.floor(sy)));
    const y1 = Math.max(0, Math.min(crop.height - 1, y0 + 1));
    const wy = Math.max(0, Math.min(1, sy - y0));

    for (let tx = 0; tx < targetW; tx += 1) {
      const sx = ((tx + 0.5) * crop.width) / targetW - 0.5;
      const x0 = Math.max(0, Math.min(crop.width - 1, Math.floor(sx)));
      const x1 = Math.max(0, Math.min(crop.width - 1, x0 + 1));
      const wx = Math.max(0, Math.min(1, sx - x0));

      const v00 = crop.data[y0 * crop.width + x0];
      const v10 = crop.data[y0 * crop.width + x1];
      const v01 = crop.data[y1 * crop.width + x0];
      const v11 = crop.data[y1 * crop.width + x1];

      const top = v00 * (1 - wx) + v10 * wx;
      const bot = v01 * (1 - wx) + v11 * wx;
      out[ty * targetW + tx] = top * (1 - wy) + bot * wy;
    }
  }
  return out;
}

/**
 * Calcule la similarité visuelle tolérante (±1 px Chamfer-Dice + pénalité de proportion)
 * entre un mot scanné et le rendu réel d'une police candidate.
 */
function scoreWordBitmapSimilarity(scan: BinaryCrop, candidate: BinaryCrop): number {
  const aspectDiff = Math.abs(scan.aspectRatio - candidate.aspectRatio) / Math.max(0.5, scan.aspectRatio);
  if (aspectDiff > 0.65) {
    return 0;
  }

  const gridH = 22;
  const gridW = Math.max(18, Math.min(96, Math.round(gridH * scan.aspectRatio)));
  const a = resampleBinaryCrop(scan, gridW, gridH);
  const b = resampleBinaryCrop(candidate, gridW, gridH);

  // Dilatation douce d'1 px pour tolérer l'épaisseur de numérisation/lissage des scans
  const dilate = (src: Float32Array) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < gridH; y += 1) {
      for (let x = 0; x < gridW; x += 1) {
        let best = src[y * gridW + x];
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= gridH) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= gridW) continue;
            const neighbor = src[ny * gridW + nx] * (dx === 0 || dy === 0 ? 0.72 : 0.45);
            if (neighbor > best) best = neighbor;
          }
        }
        out[y * gridW + x] = best;
      }
    }
    return out;
  };

  const aDil = dilate(a);
  const bDil = dilate(b);

  let hitScan = 0;
  let totalScan = 0;
  let hitCand = 0;
  let totalCand = 0;

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] > 0.22) {
      totalScan += a[i];
      hitScan += Math.min(a[i], bDil[i]);
    }
    if (b[i] > 0.22) {
      totalCand += b[i];
      hitCand += Math.min(b[i], aDil[i]);
    }
  }

  if (totalScan < 1 || totalCand < 1) {
    return 0;
  }

  const recallScan = hitScan / totalScan;
  const recallCand = hitCand / totalCand;
  const chamferDice = (2 * recallScan * recallCand) / Math.max(0.0001, recallScan + recallCand);
  const fillPenalty = Math.abs(scan.fillRatio - candidate.fillRatio) * 0.45;
  const serifPenalty = Math.abs(scan.serifScore - candidate.serifScore) * 0.14;

  return Math.max(0, chamferDice - aspectDiff * 0.48 - fillPenalty - serifPenalty);
}

/** Sélectionne les 1 à 2 mots les plus nets et discriminants du bloc OCR */
function pickRepresentativeWords(words: WordSampleBox[]): WordSampleBox[] {
  const scored = words
    .map((w) => {
      const clean = w.text.trim();
      const boxH = w.y1 - w.y0;
      const boxW = w.x1 - w.x0;
      if (clean.length < 3 || clean.length > 14 || boxH < 10 || boxW < 14) {
        return null;
      }
      // Favorise les mots avec lettres/chiffres caractéristiques (a, e, g, f, t, R, S, 0, 2, 5, 8)
      const discCount = (clean.match(/[aegftRS0258QMp]/g) ?? []).length;
      const alnumCount = (clean.match(/[A-Za-zÀ-ÿ0-9/]/g) ?? []).length;
      if (alnumCount < 3) {
        return null;
      }
      const score = Math.min(10, clean.length) * 2 + discCount * 2.5 + Math.min(40, boxH);
      return { word: { ...w, text: clean }, score };
    })
    .filter((item): item is { word: WordSampleBox; score: number } => item !== null)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 2).map((s) => s.word);
}

/** Construit la liste dédupliquée des polices à évaluer (Windows PC complet + catalogue Web/Android) */
export function buildRecognitionFontPool(
  installedFamilies: FontMatchCandidateInput[],
): FontMatchCandidateInput[] {
  const pool: FontMatchCandidateInput[] = [];
  const seen = new Set<string>();

  for (const f of installedFamilies) {
    const clean = f.family.replace(/["']/g, '').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key) || !isValidTextFontFamily(clean)) {
      continue;
    }
    seen.add(key);
    pool.push({ family: clean, category: f.category ?? classifyFontCategory(clean) });
  }

  // Complète toujours avec le catalogue enrichi (dédupliqué ; ignoré à l'exécution si non disponible sur l'appareil)
  for (const fam of ENRICHED_RECOGNITION_FAMILIES) {
    const key = fam.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      pool.push({ family: fam, category: classifyFontCategory(fam) });
    }
  }

  return pool;
}

/**
 * Identifie la police installée (ou web) visuellement la plus fidèle à un bloc texte scanné,
 * en mesurant inclinaison par glyphe, graisse, empattements puis en comparant réellement les mots sur canvas.
 */
export function recognizeFontFromScanBlock(params: {
  pageCanvas: HTMLCanvasElement;
  blockRectPx: { x: number; y: number; width: number; height: number };
  words?: WordSampleBox[];
  blockText: string;
  installedFamilies: FontMatchCandidateInput[];
  usingSystemFonts: boolean;
  hintBold?: boolean;
  hintItalic?: boolean;
  hintCategory?: FontVisualCategory;
}): VisualFontRecognitionResult | null {
  const ctxPage = params.pageCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctxPage || typeof document === 'undefined') {
    return null;
  }

  const pool = buildRecognitionFontPool(params.installedFamilies);
  const profiles = getOrBuildFontProfiles(pool);
  if (profiles.length === 0) {
    return null;
  }

  // Extrait les 1 à 2 meilleurs mots nettoyés, ou à défaut les premiers mots du bloc entier
  const candidateWords = pickRepresentativeWords(params.words ?? []);
  const wordCrops: Array<{ text: string; crop: BinaryCrop }> = [];

  for (const w of candidateWords) {
    const wx0 = Math.max(0, Math.floor(w.x0) - 2);
    const wy0 = Math.max(0, Math.floor(w.y0) - 2);
    const wx1 = Math.min(params.pageCanvas.width, Math.ceil(w.x1) + 2);
    const wy1 = Math.min(params.pageCanvas.height, Math.ceil(w.y1) + 2);
    const ww = wx1 - wx0;
    const wh = wy1 - wy0;
    if (ww >= 8 && wh >= 8) {
      const rgba = ctxPage.getImageData(wx0, wy0, ww, wh).data;
      const crop = extractScanBinaryCropFromRgba(rgba, ww, wh);
      if (crop) {
        wordCrops.push({ text: w.text, crop });
      }
    }
  }

  // Repli si aucun mot isolé propre n'est disponible : analyse tout le bloc (tronqué au 1er segment utile)
  if (wordCrops.length === 0) {
    const bx0 = Math.max(0, Math.floor(params.blockRectPx.x));
    const by0 = Math.max(0, Math.floor(params.blockRectPx.y));
    const bw = Math.min(params.pageCanvas.width - bx0, Math.max(4, Math.ceil(params.blockRectPx.width)));
    const bh = Math.min(params.pageCanvas.height - by0, Math.max(4, Math.ceil(params.blockRectPx.height)));
    if (bw >= 8 && bh >= 8) {
      const rgba = ctxPage.getImageData(bx0, by0, bw, bh).data;
      const blockCrop = extractScanBinaryCropFromRgba(rgba, bw, bh);
      if (blockCrop) {
        wordCrops.push({ text: params.blockText.trim().slice(0, 42), crop: blockCrop });
      }
    }
  }

  if (wordCrops.length === 0) {
    return null;
  }

  // Synthèse géométrique sur les mots extraits (compense l'arrondi 1px sur les scans de petite taille)
  const primary = wordCrops[0].crop;
  const avgWordH =
    wordCrops.reduce((acc, wc) => acc + wc.crop.height, 0) / wordCrops.length;
  const slants = wordCrops.map((wc) => wc.crop.medianSlant).sort((a, b) => a - b);
  const avgSlant = slants[Math.floor(slants.length / 2)];
  const avgStroke =
    wordCrops.reduce((acc, wc) => acc + wc.crop.strokeWidthRatio, 0) / wordCrops.length;
  const adjustedStroke = Math.max(0, avgStroke - 0.65 / Math.max(10, avgWordH));
  const avgSerif = wordCrops.reduce((acc, wc) => acc + wc.crop.serifScore, 0) / wordCrops.length;

  const detectedItalic = params.hintItalic || avgSlant > 0.115;
  const borderlineItalic = avgSlant >= 0.055 && avgSlant <= 0.22;
  const detectedBold = params.hintBold || adjustedStroke > 0.142 || primary.fillRatio > 0.37;
  const borderlineBold =
    (!detectedBold && (adjustedStroke > 0.095 || primary.fillRatio > 0.28)) ||
    (detectedBold && !params.hintBold && adjustedStroke < 0.19 && primary.fillRatio < 0.44);
  const sampleFontPx = Math.max(18, Math.min(40, Math.round(avgWordH * 1.18)));

  const guessedCategory: FontVisualCategory =
    params.hintCategory ??
    (wordCrops.some((wc) => wc.crop.isMonospace)
      ? 'monospace'
      : avgSerif >= 1.24
        ? 'serif'
        : 'sans-serif');

  // Pré-sélection rapide des ~28 meilleures candidates parmi TOUTES les polices installées
  const rankedProfiles = profiles
    .map((p) => {
      const catPenalty = p.category === guessedCategory ? 0 : 0.45;
      const fillDiff = Math.abs(p.fillRatio - primary.fillRatio);
      const serifDiff = Math.abs(p.serifScore - avgSerif) * 0.35;
      const coreBonus = CORE_OFFICE_CANDIDATES.has(p.family.toLowerCase()) ? -0.15 : 0;
      return { profile: p, roughDist: catPenalty + fillDiff + serifDiff + coreBonus };
    })
    .sort((a, b) => a.roughDist - b.roughDist);

  const shortlist: FontGeometricProfile[] = [];
  const shortlistKeys = new Set<string>();
  const addShort = (p: FontGeometricProfile) => {
    const k = p.family.toLowerCase();
    if (!shortlistKeys.has(k)) {
      shortlistKeys.add(k);
      shortlist.push(p);
    }
  };

  for (const item of rankedProfiles.slice(0, 22)) {
    addShort(item.profile);
  }
  for (const p of profiles) {
    if (CORE_OFFICE_CANDIDATES.has(p.family.toLowerCase()) && shortlist.length < 34) {
      addShort(p);
    }
  }

  // Comparaison réelle sur canvas mot par mot
  const testCanvas = document.createElement('canvas');
  testCanvas.width = 480;
  testCanvas.height = 96;
  const testCtx = testCanvas.getContext('2d', { willReadFrequently: true });
  if (!testCtx) {
    return null;
  }

  let bestMatch: {
    profile: FontGeometricProfile;
    score: number;
    bold: boolean;
    italic: boolean;
  } | null = null;

  const styleCombos: Array<{ bold: boolean; italic: boolean }> = [
    { bold: detectedBold, italic: detectedItalic },
  ];
  if (borderlineItalic) {
    styleCombos.push({ bold: detectedBold, italic: !detectedItalic });
  }
  if (borderlineBold) {
    styleCombos.push({ bold: !detectedBold, italic: detectedItalic });
  }

  for (const prof of shortlist) {
    for (const st of styleCombos) {
      let scoreSum = 0;
      let validWords = 0;

      for (const wc of wordCrops) {
        if (!wc.text) continue;
        const candCrop = renderFontSampleCrop(
          testCtx,
          testCanvas,
          wc.text,
          prof.family,
          st.bold,
          st.italic,
          sampleFontPx,
        );
        if (!candCrop) continue;
        scoreSum += scoreWordBitmapSimilarity(wc.crop, candCrop);
        validWords += 1;
      }

      if (validWords === 0) {
        continue;
      }

      const avgScore = scoreSum / validWords;
      // Léger bonus de stabilité si l'utilisateur a déjà la famille classique bureautique à score égal,
      // et priorité au poids normal tant que l'épaisseur mesurée reste sous le seuil du vrai gras
      const slightOfficeTieBreaker = CORE_OFFICE_CANDIDATES.has(prof.family.toLowerCase()) ? 0.008 : 0;
      const regularWeightPrior = !st.bold && adjustedStroke < 0.135 && !params.hintBold ? 0.022 : 0;
      const totalScore = avgScore + slightOfficeTieBreaker + regularWeightPrior;

      if (!bestMatch || totalScore > bestMatch.score) {
        bestMatch = {
          profile: prof,
          score: totalScore,
          bold: st.bold,
          italic: st.italic,
        };
      }
    }
  }

  if (!bestMatch || bestMatch.score < 0.25) {
    return null;
  }

  const suffix = params.usingSystemFonts ? '(installée)' : '(détectée)';
  return {
    fontFamily: formatCssFontStack(bestMatch.profile.family, bestMatch.profile.category),
    matchedFamilyName: bestMatch.profile.family,
    detectedFontLabel: `${bestMatch.profile.family} ${suffix}`,
    bold: bestMatch.bold,
    italic: bestMatch.italic,
    category: bestMatch.profile.category,
    confidence: Math.min(1, bestMatch.score),
  };
}

/**
 * Harmonise les lignes OCR appartenant manifestement au même bloc/paragraphe :
 * évite qu'un mot isolé court sur une ligne ne bascule dans une autre police que ses voisines.
 */
export function harmonizeOcrParagraphFonts(blocks: EditableTextBlock[]): void {
  if (blocks.length < 2) {
    return;
  }

  // Regroupe les blocs proches verticalement ayant presque la même taille, graisse et italique
  const sorted = [...blocks].sort((a, b) => a.origY - b.origY);
  const used = new Set<string>();

  for (let i = 0; i < sorted.length; i += 1) {
    if (used.has(sorted[i].id)) continue;
    const group: EditableTextBlock[] = [sorted[i]];
    used.add(sorted[i].id);

    for (let j = i + 1; j < sorted.length; j += 1) {
      const prev = group[group.length - 1];
      const curr = sorted[j];
      if (used.has(curr.id)) continue;

      const verticalGap = curr.origY - (prev.origY + prev.origHeight);
      const sameSize = Math.abs(curr.style.fontSize - prev.style.fontSize) <= 1.8;
      const sameLineFlags =
        curr.style.italic === prev.style.italic && curr.style.bold === prev.style.bold;
      const alignedX = Math.abs(curr.origX - prev.origX) <= 36;

      if (verticalGap >= -4 && verticalGap <= prev.origHeight * 1.9 && sameSize && sameLineFlags && alignedX) {
        group.push(curr);
        used.add(curr.id);
      }
    }

    if (group.length < 3) {
      continue;
    }

    // Vote majoritaire pondéré par longueur de texte du bloc (un titre long pèse plus que "le 08")
    const votes = new Map<string, { weight: number; fontFamily: string; label?: string }>();
    for (const blk of group) {
      const k = blk.style.fontFamily;
      const w = Math.max(2, blk.originalText.trim().length);
      const cur = votes.get(k);
      if (cur) {
        cur.weight += w;
      } else {
        votes.set(k, { weight: w, fontFamily: blk.style.fontFamily, label: blk.detectedFontLabel });
      }
    }

    let winner: { weight: number; fontFamily: string; label?: string } | null = null;
    for (const v of votes.values()) {
      if (!winner || v.weight > winner.weight) {
        winner = v;
      }
    }

    if (!winner) continue;
    const totalWeight = group.reduce((acc, b) => acc + Math.max(2, b.originalText.trim().length), 0);
    if (winner.weight / totalWeight >= 0.45) {
      for (const blk of group) {
        blk.style.fontFamily = winner.fontFamily;
        blk.originalStyle.fontFamily = winner.fontFamily;
        if (winner.label) {
          blk.detectedFontLabel = winner.label;
        }
      }
    }
  }
}

/**
 * Calcule le style de texte dominant du document (utile pour pré-remplir "Texte libre" et "Date"
 * sur une autre page afin d'être cohérent avec le document ouvert).
 */
export function computeDominantDocumentTextStyle(
  blocksByPage: Record<number, EditableTextBlock[]>,
): TextStyle | null {
  const counts = new Map<string, { score: number; style: TextStyle }>();

  for (const blocks of Object.values(blocksByPage)) {
    for (const b of blocks) {
      if (b.status === 'deleted') continue;
      const key = `${b.style.fontFamily}|${b.style.bold ? 1 : 0}|${b.style.italic ? 1 : 0}`;
      // Privilégie les lignes de texte courant (taille 9..16 pt, beaucoup de caractères)
      const isBodySize = b.style.fontSize >= 8 && b.style.fontSize <= 16 ? 1.5 : 0.7;
      const weight = Math.max(3, b.currentText.trim().length) * isBodySize;
      const cur = counts.get(key);
      if (cur) {
        cur.score += weight;
      } else {
        counts.set(key, { score: weight, style: { ...b.style } });
      }
    }
  }

  let best: { score: number; style: TextStyle } | null = null;
  for (const item of counts.values()) {
    if (!best || item.score > best.score) {
      best = item;
    }
  }
  return best ? best.style : null;
}

/** Extrait le nom principal lisible d'une pile CSS (ex: '"Calibri", sans-serif' -> 'Calibri') */
export function extractPrimaryFontName(fontFamily: string): string {
  const first = fontFamily.split(',')[0] ?? '';
  const cleaned = first.replace(/["']/g, '').trim();
  return cleaned || 'Arial';
}

/**
 * Retourne la valeur d'option correspondante dans une liste existante (même si le repli CSS diffère),
 * sinon retourne `currentFamily` tel quel.
 */
export function findMatchingFontOptionValue(currentFamily: string, optionValues: string[]): string {
  if (optionValues.includes(currentFamily)) {
    return currentFamily;
  }
  const targetName = extractPrimaryFontName(currentFamily).toLowerCase();
  const match = optionValues.find(
    (val) => extractPrimaryFontName(val).toLowerCase() === targetName,
  );
  return match ?? currentFamily;
}
