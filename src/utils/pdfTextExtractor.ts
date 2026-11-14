// Extraction du texte natif d'une page PDF avec séparation respectueuse des colonnes
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { EditableTextBlock, TextStyle } from '../types/pdf';
import { createId } from './formatters';
import { analyzeTextVisualStyle, CURATED_FONT_FAMILIES } from './backgroundPreserver';
import { isDesktopApp, resolveBestDesktopFontMatch } from './desktopBridge';

interface RawTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  hasEOL: boolean;
}

/** Déduit un style CSS approximatif à partir des métadonnées de police PDF.js */
function inferStyleFromPdfFont(fontFamilyStr: string, fontName: string, fontSize: number): TextStyle {
  const hint = `${fontFamilyStr} ${fontName}`.toLowerCase();
  const hintWithoutSans = hint.replace(/sans-serif/g, 'sansserif');
  let fontFamily: string = CURATED_FONT_FAMILIES[0].value;

  if (
    hintWithoutSans.includes('times') ||
    hintWithoutSans.includes('serif') ||
    hintWithoutSans.includes('georgia') ||
    hintWithoutSans.includes('garamond')
  ) {
    fontFamily = CURATED_FONT_FAMILIES[1].value;
  } else if (hint.includes('courier') || hint.includes('mono') || hint.includes('consolas')) {
    fontFamily = CURATED_FONT_FAMILIES[2].value;
  }

  return {
    fontFamily,
    fontSize: Math.max(6, Math.round(fontSize * 10) / 10),
    color: '#111827',
    bold: hint.includes('bold') || hint.includes('black') || hint.includes('heavy'),
    italic: hint.includes('italic') || hint.includes('oblique'),
  };
}

/**
 * Extrait les blocs de texte éditables d'une page PDF native.
 * Les colonnes séparées par un espace important restent bien distinctes.
 */
export async function extractNativeTextBlocks(
  page: PDFPageProxy,
  pageNumber: number,
  cleanCanvas?: HTMLCanvasElement,
  canvasScale = 1,
): Promise<EditableTextBlock[]> {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const styles = textContent.styles ?? {};

  const items: RawTextItem[] = [];
  for (const raw of textContent.items) {
    if (!('str' in raw) || !raw.str || !raw.str.trim()) {
      continue;
    }
    const tx = pdfjsLib.Util.transform(viewport.transform, raw.transform);
    const fontHeight = Math.max(6, Math.hypot(tx[2], tx[3]) || raw.height || 12);
    const x = tx[4];
    // La ligne de base est en tx[5] (origine haut-gauche) ; on remonte de l'ascension typique
    const y = tx[5] - fontHeight * 0.88;
    const width = Math.max(4, raw.width);
    const height = Math.max(fontHeight * 1.25, raw.height || fontHeight * 1.25);

    items.push({
      text: raw.str,
      x,
      y,
      width,
      height,
      fontSize: fontHeight,
      fontName: raw.fontName ?? '',
      hasEOL: Boolean(raw.hasEOL),
    });
  }

  if (items.length === 0) {
    return [];
  }

  // Regroupe les fragments d'une même ligne sans jamais fusionner deux colonnes éloignées
  const groups: RawTextItem[][] = [];
  let currentGroup: RawTextItem[] = [items[0]];

  for (let i = 1; i < items.length; i += 1) {
    const prev = currentGroup[currentGroup.length - 1];
    const curr = items[i];
    const sameBaseline = Math.abs(curr.y - prev.y) <= Math.max(prev.fontSize, curr.fontSize) * 0.45;
    const gap = curr.x - (prev.x + prev.width);
    const maxInlineGap = Math.max(prev.fontSize * 1.8, 22);

    if (sameBaseline && gap >= -prev.fontSize * 0.5 && gap <= maxInlineGap && !prev.hasEOL) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  const blocks: EditableTextBlock[] = groups.map((group) => {
    let text = '';
    for (let i = 0; i < group.length; i += 1) {
      const part = group[i];
      if (i > 0) {
        const prev = group[i - 1];
        const gap = part.x - (prev.x + prev.width);
        if (gap > part.fontSize * 0.22 && !text.endsWith(' ') && !part.text.startsWith(' ')) {
          text += ' ';
        }
      }
      text += part.text;
    }

    const minX = Math.min(...group.map((g) => g.x));
    const minY = Math.min(...group.map((g) => g.y));
    const maxX = Math.max(...group.map((g) => g.x + g.width));
    const maxY = Math.max(...group.map((g) => g.y + g.height));
    const avgFontSize = group.reduce((acc, g) => acc + g.fontSize, 0) / group.length;

    const firstFont = group[0].fontName;
    const styleMeta = styles[firstFont];
    const baseStyle = inferStyleFromPdfFont(styleMeta?.fontFamily ?? '', firstFont, avgFontSize);

    let finalStyle = { ...baseStyle };
    let detectedFontLabel: string | undefined;

    if (cleanCanvas && canvasScale > 0) {
      const visual = analyzeTextVisualStyle(
        cleanCanvas,
        {
          x: minX * canvasScale,
          y: minY * canvasScale,
          width: (maxX - minX) * canvasScale,
          height: (maxY - minY) * canvasScale,
        },
        `${styleMeta?.fontFamily ?? ''} ${firstFont}`.trim(),
      );
      finalStyle = {
        ...finalStyle,
        color: visual.color,
        fontFamily: visual.fontFamily,
        bold: finalStyle.bold || visual.bold,
        italic: finalStyle.italic || visual.italic,
      };
      detectedFontLabel = visual.detectedFontLabel;
    }

    const w = Math.max(12, maxX - minX);
    const h = Math.max(12, maxY - minY);

    return {
      id: createId('txt'),
      pageNumber,
      source: 'pdf',
      originalText: text,
      currentText: text,
      status: 'original',
      origX: minX,
      origY: minY,
      origWidth: w,
      origHeight: h,
      x: minX,
      y: minY,
      width: w,
      height: h,
      style: finalStyle,
      originalStyle: { ...finalStyle },
      detectedFontLabel,
    };
  });

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
