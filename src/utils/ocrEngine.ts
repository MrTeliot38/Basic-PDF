// Moteur OCR 100 % hors ligne (Tesseract.js + français local) avec détection multi-colonnes
import type { PDFPageProxy } from 'pdfjs-dist';
import { createWorker, OEM, PSM } from 'tesseract.js';
import type { EditableTextBlock } from '../types/pdf';
import { createId } from './formatters';
import { analyzeTextVisualStyle } from './backgroundPreserver';
import { isDesktopApp, resolveBestDesktopFontMatch } from './desktopBridge';

export interface OcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WordToken {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fontName?: string;
}

/**
 * Construit un masque binaire (1 = encre, 0 = fond) à partir d'un tampon RGBA
 * en comparant chaque pixel au fond dominant de sa bande horizontale.
 */
export function buildInkMaskFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (width === 0 || height === 0) {
    return mask;
  }

  for (let y = 0; y < height; y += 1) {
    // Échantillonne le fond de la ligne (médiane / valeur dominante simplifiée sur un pas de 4 px)
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;
    const samples: Array<[number, number, number]> = [];
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 32))) {
      const idx = (y * width + x) * 4;
      samples.push([data[idx], data[idx + 1], data[idx + 2]]);
      rSum += data[idx];
      gSum += data[idx + 1];
      bSum += data[idx + 2];
      count += 1;
    }

    // Estime le fond en prenant la couleur médiane approximative (résistant aux textes foncés ou clairs)
    const meanR = rSum / Math.max(1, count);
    const meanG = gSum / Math.max(1, count);
    const meanB = bSum / Math.max(1, count);
    let bgR = meanR;
    let bgG = meanG;
    let bgB = meanB;
    if (samples.length > 0) {
      samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
      const mid = samples[Math.floor(samples.length / 2)];
      bgR = mid[0];
      bgG = mid[1];
      bgB = mid[2];
    }

    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const dr = data[idx] - bgR;
      const dg = data[idx + 1] - bgG;
      const db = data[idx + 2] - bgB;
      if (dr * dr + dg * dg + db * db > 38 * 38) {
        mask[y * width + x] = 1;
      }
    }
  }

  return mask;
}

/**
 * Détecte les bandes horizontales puis les gouttières verticales séparant les colonnes
 * afin d'analyser chaque colonne indépendamment sans jamais fusionner deux colonnes.
 */
export function detectColumnRegions(
  inkMask: Uint8Array,
  width: number,
  height: number,
): OcrRegion[] {
  if (width < 40 || height < 40) {
    return [{ x: 0, y: 0, width, height }];
  }

  // 1. Découpe d'abord en bandes horizontales séparées par de larges espaces blancs
  const rowHasInk = new Uint8Array(height);
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      rowSum += inkMask[rowOffset + x];
    }
    if (rowSum >= 3) {
      rowHasInk[y] = 1;
    }
  }

  // Un espacement normal entre deux lignes d’un même paragraphe ne doit pas couper une colonne en tranches
  const minRowGap = Math.max(24, Math.round(height * 0.035));
  const rawBands: Array<{ y0: number; y1: number }> = [];
  let inBand = false;
  let bandStart = 0;
  let emptyRun = 0;

  for (let y = 0; y < height; y += 1) {
    if (rowHasInk[y]) {
      if (!inBand) {
        inBand = true;
        bandStart = y;
      }
      emptyRun = 0;
    } else if (inBand) {
      emptyRun += 1;
      if (emptyRun >= minRowGap) {
        rawBands.push({ y0: Math.max(0, bandStart - 4), y1: Math.min(height, y - emptyRun + 4) });
        inBand = false;
        emptyRun = 0;
      }
    }
  }
  if (inBand) {
    rawBands.push({ y0: Math.max(0, bandStart - 4), y1: height });
  }

  if (rawBands.length === 0) {
    return [{ x: 0, y: 0, width, height }];
  }

  // 2. Dans chaque bande horizontale, cherche une gouttière verticale nette,
  // y compris si un titre pleine largeur précède deux colonnes juste en dessous
  const regions: OcrRegion[] = [];
  const minGutterWidth = Math.max(14, Math.round(width * 0.025));

  const findGutterInSlice = (yStart: number, yEnd: number): number[] => {
    const sliceH = yEnd - yStart;
    if (sliceH < 12) {
      return [];
    }
    const colInk = new Uint16Array(width);
    for (let y = yStart; y < yEnd; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        colInk[x] += inkMask[rowOffset + x];
      }
    }

    const maxNoiseInGutter = Math.max(1, Math.floor(sliceH * 0.015));
    const searchStart = Math.floor(width * 0.18);
    const searchEnd = Math.floor(width * 0.82);

    // Marque d’abord les colonnes calmes, puis autorise un filet vertical mince (1 à 4 px)
    // entouré de blanc des deux côtés afin qu’un trait séparateur n’empêche pas la coupe
    const quiet = new Uint8Array(width);
    for (let x = searchStart; x <= searchEnd; x += 1) {
      if (colInk[x] <= maxNoiseInGutter) {
        quiet[x] = 1;
      }
    }

    let xCursor = searchStart;
    while (xCursor <= searchEnd) {
      if (quiet[xCursor]) {
        xCursor += 1;
        continue;
      }
      const inkStart = xCursor;
      while (xCursor <= searchEnd && !quiet[xCursor]) {
        xCursor += 1;
      }
      const inkWidth = xCursor - inkStart;
      if (inkWidth <= 4) {
        let leftQuiet = 0;
        for (let k = inkStart - 1; k >= searchStart && quiet[k]; k -= 1) {
          leftQuiet += 1;
        }
        let rightQuiet = 0;
        for (let k = xCursor; k <= searchEnd && quiet[k]; k += 1) {
          rightQuiet += 1;
        }
        if (leftQuiet >= 6 && rightQuiet >= 6) {
          for (let k = inkStart; k < xCursor; k += 1) {
            quiet[k] = 1;
          }
        }
      }
    }

    const gutters: number[] = [];
    let gapStart = -1;

    for (let x = searchStart; x <= searchEnd; x += 1) {
      if (quiet[x]) {
        if (gapStart === -1) {
          gapStart = x;
        }
      } else if (gapStart !== -1) {
        if (x - gapStart >= minGutterWidth) {
          gutters.push(Math.floor((gapStart + x) / 2));
        }
        gapStart = -1;
      }
    }
    if (gapStart !== -1 && searchEnd - gapStart >= minGutterWidth) {
      gutters.push(Math.floor((gapStart + searchEnd) / 2));
    }
    return gutters;
  };

  const pushSplitRegions = (yStart: number, yEnd: number, gutters: number[]) => {
    const sliceH = yEnd - yStart;
    if (sliceH < 10) {
      return;
    }
    if (gutters.length === 0) {
      regions.push({ x: 0, y: yStart, width, height: sliceH });
      return;
    }
    const cuts = [0, ...gutters, width];
    for (let i = 0; i < cuts.length - 1; i += 1) {
      const rx = cuts[i];
      const rw = cuts[i + 1] - rx;
      if (rw >= 20) {
        regions.push({ x: rx, y: yStart, width: rw, height: sliceH });
      }
    }
  };

  for (const band of rawBands) {
    const bandH = band.y1 - band.y0;
    if (bandH < 12) {
      continue;
    }

    const fullGutters = findGutterInSlice(band.y0, band.y1);
    if (fullGutters.length > 0) {
      pushSplitRegions(band.y0, band.y1, fullGutters);
      continue;
    }

    // Teste si la partie basse de la bande est multi-colonnes sous un en-tête pleine largeur
    if (bandH >= 48) {
      let splitFound = false;
      const stepY = Math.max(8, Math.floor(bandH / 8));
      for (let testY = band.y0 + stepY; testY <= band.y1 - 24; testY += stepY) {
        const lowerGutters = findGutterInSlice(testY, band.y1);
        if (lowerGutters.length > 0) {
          // Remonte ligne par ligne jusqu'au début exact de la gouttière
          let exactStart = testY;
          const centerX = lowerGutters[0];
          const halfW = Math.floor(minGutterWidth / 2);
          while (exactStart > band.y0) {
            let rowNoise = 0;
            const rowOffset = (exactStart - 1) * width;
            for (let x = centerX - halfW; x <= centerX + halfW; x += 1) {
              rowNoise += inkMask[rowOffset + x];
            }
            if (rowNoise > 2) {
              break;
            }
            exactStart -= 1;
          }
          if (exactStart > band.y0 + 6) {
            regions.push({ x: 0, y: band.y0, width, height: exactStart - band.y0 });
          }
          pushSplitRegions(exactStart, band.y1, lowerGutters);
          splitFound = true;
          break;
        }
      }
      if (splitFound) {
        continue;
      }
    }

    regions.push({ x: 0, y: band.y0, width, height: bandH });
  }

  return regions.length > 0 ? regions : [{ x: 0, y: 0, width, height }];
}

/**
 * Filet de sécurité au niveau des mots : si une ligne reconnue contient un grand trou horizontal
 * entre deux colonnes, elle est coupée en plusieurs groupes distincts.
 */
export function splitLineWordsByGaps(
  words: WordToken[],
  lineHeight: number,
  imageWidth: number,
): WordToken[][] {
  const cleanWords = words
    .filter((w) => w.text.trim().length > 0)
    .sort((a, b) => a.x0 - b.x0);
  if (cleanWords.length === 0) {
    return [];
  }

  const maxWordGap = Math.max(lineHeight * 2.2, imageWidth * 0.045, 24);
  const groups: WordToken[][] = [[cleanWords[0]]];

  for (let i = 1; i < cleanWords.length; i += 1) {
    const prev = cleanWords[i - 1];
    const curr = cleanWords[i];
    if (curr.x0 - prev.x1 > maxWordGap) {
      groups.push([curr]);
    } else {
      groups[groups.length - 1].push(curr);
    }
  }

  return groups;
}

/** Résout les chemins locaux vers le worker, le cœur WASM et le dictionnaire français */
function getOfflineOcrPaths() {
  const baseHref = typeof window !== 'undefined' ? window.location.href : 'http://127.0.0.1/';
  return {
    workerPath: new URL('./ocr/worker.min.js', baseHref).href,
    corePath: new URL('./ocr/core', baseHref).href,
    langPath: new URL('./ocr/lang', baseHref).href,
  };
}

/**
 * Exécute la reconnaissance optique de texte (OCR) 100 % hors ligne sur une page PDF scannée.
 */
export async function runOfflineOcrOnPage(
  page: PDFPageProxy,
  pageNumber: number,
  onProgress?: (percent: number) => void,
): Promise<EditableTextBlock[]> {
  const ocrScale = 2.2;
  const viewport = page.getViewport({ scale: ocrScale });

  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = Math.max(1, Math.floor(viewport.width));
  pageCanvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = pageCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return [];
  }

  await page.render({ canvas: pageCanvas, canvasContext: ctx, viewport }).promise;

  const imgData = ctx.getImageData(0, 0, pageCanvas.width, pageCanvas.height);
  const inkMask = buildInkMaskFromRgba(imgData.data, pageCanvas.width, pageCanvas.height);
  const regions = detectColumnRegions(inkMask, pageCanvas.width, pageCanvas.height);

  const { workerPath, corePath, langPath } = getOfflineOcrPaths();
  const worker = await createWorker('fra', OEM.LSTM_ONLY, {
    workerPath,
    corePath,
    langPath,
    workerBlobURL: false,
    logger: (msg) => {
      if (msg.status === 'recognizing text' && typeof msg.progress === 'number' && onProgress) {
        onProgress(Math.round(msg.progress * 100));
      }
    },
  });

  const blocks: EditableTextBlock[] = [];

  try {
    const cropPad = 28;
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    });

    for (let rIdx = 0; rIdx < regions.length; rIdx += 1) {
      const region = regions[rIdx];
      await worker.setParameters({
        tessedit_pageseg_mode: region.height > 140 ? PSM.SINGLE_COLUMN : PSM.SINGLE_BLOCK,
      });

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = region.width + cropPad * 2;
      cropCanvas.height = region.height + cropPad * 2;
      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) {
        continue;
      }

      // Échantillonne la couleur de fond du coin de la région pour ajouter une marge neutre sans bord brutal
      const edgeIdx = (Math.min(pageCanvas.height - 1, region.y + 1) * pageCanvas.width + Math.min(pageCanvas.width - 1, region.x + 1)) * 4;
      cropCtx.fillStyle = `rgb(${imgData.data[edgeIdx]}, ${imgData.data[edgeIdx + 1]}, ${imgData.data[edgeIdx + 2]})`;
      cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

      cropCtx.drawImage(
        pageCanvas,
        region.x,
        region.y,
        region.width,
        region.height,
        cropPad,
        cropPad,
        region.width,
        region.height,
      );

      const { data } = await worker.recognize(cropCanvas, undefined, { blocks: true });
      const tessBlocks = data.blocks ?? [];

      for (const tb of tessBlocks) {
        for (const para of tb.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            const words: WordToken[] = (line.words ?? []).map((w) => ({
              text: w.text,
              x0: w.bbox.x0 - cropPad + region.x,
              y0: w.bbox.y0 - cropPad + region.y,
              x1: w.bbox.x1 - cropPad + region.x,
              y1: w.bbox.y1 - cropPad + region.y,
              fontName: w.font_name,
            }));

            const lineHeightPx = Math.max(10, line.bbox.y1 - line.bbox.y0);
            const splitGroups = splitLineWordsByGaps(words, lineHeightPx, pageCanvas.width);

            for (const group of splitGroups) {
              const text = group.map((w) => w.text.trim()).join(' ').trim();
              if (!text) {
                continue;
              }
              const minX = Math.min(...group.map((w) => w.x0));
              const minY = Math.min(...group.map((w) => w.y0));
              const maxX = Math.max(...group.map((w) => w.x1));
              const maxY = Math.max(...group.map((w) => w.y1));

              const xPdf = minX / ocrScale;
              const yPdf = minY / ocrScale;
              const wPdf = Math.max(14, (maxX - minX) / ocrScale);
              const hPdf = Math.max(10, (maxY - minY) / ocrScale);
              const fontSizePdf = Math.max(7, Math.round(hPdf * 0.85 * 10) / 10);

              const visual = analyzeTextVisualStyle(pageCanvas, {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
              });

              const style = {
                fontFamily: visual.fontFamily,
                fontSize: fontSizePdf,
                color: visual.color,
                bold: visual.bold,
                italic: visual.italic,
              };

              blocks.push({
                id: createId('ocr'),
                pageNumber,
                source: 'ocr',
                originalText: text,
                currentText: text,
                status: 'original',
                origX: xPdf,
                origY: yPdf,
                origWidth: wPdf,
                origHeight: hPdf,
                x: xPdf,
                y: yPdf,
                width: wPdf,
                height: hPdf,
                style,
                originalStyle: { ...style },
                detectedFontLabel: visual.detectedFontLabel,
              });
            }
          }
        }
      }
    }
  } finally {
    await worker.terminate();
  }

  // Sous Windows (Electron), associe la police détectée à la police système installée la plus proche
  if (isDesktopApp() && blocks.length > 0) {
    for (const block of blocks) {
      const matched = await resolveBestDesktopFontMatch({
        fontFamily: block.style.fontFamily,
        detectedFontLabel: block.detectedFontLabel,
      });
      if (matched) {
        block.style.fontFamily = matched.fontFamily;
        block.originalStyle.fontFamily = matched.fontFamily;
        block.detectedFontLabel = matched.detectedFontLabel;
      }
    }
  }

  return blocks;
}
