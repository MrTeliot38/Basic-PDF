// Sérialisation réelle de toutes les modifications dans un vrai PDF : texte, images, formulaires, signatures, annotations et caviardage irréversible
import fontkit from '@pdf-lib/fontkit';
import {
  LineCapStyle,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  type PDFFont,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import type {
  EditableImageBlock,
  EditableTextBlock,
  PageAnnotation,
  TextStyle,
} from '../types/pdf';
import { getDesktopBridge } from './desktopBridge';
import { rotatePngDataUrl } from './pdfImageExtractor';
import { loadPdfDocument } from './pdfLoader';

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    return rgb(0.07, 0.09, 0.15);
  }
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  );
}

/** Remplace les rares caractères absents de WinAnsi afin d'éviter toute erreur à l'export */
function sanitizeWinAnsi(text: string): string {
  return text
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ');
}

function selectStandardFontKey(style: TextStyle): StandardFonts {
  const family = style.fontFamily.toLowerCase();
  const familyNoSans = family.replace(/sans-serif/g, 'sansserif');
  const isSerif =
    familyNoSans.includes('serif') ||
    familyNoSans.includes('georgia') ||
    familyNoSans.includes('times') ||
    familyNoSans.includes('palatino');
  const isMono =
    family.includes('courier') || family.includes('mono') || family.includes('consolas');

  if (isMono) {
    if (style.bold && style.italic) return StandardFonts.CourierBoldOblique;
    if (style.bold) return StandardFonts.CourierBold;
    if (style.italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }

  if (isSerif) {
    if (style.bold && style.italic) return StandardFonts.TimesRomanBoldItalic;
    if (style.bold) return StandardFonts.TimesRomanBold;
    if (style.italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }

  if (style.bold && style.italic) return StandardFonts.HelveticaBoldOblique;
  if (style.bold) return StandardFonts.HelveticaBold;
  if (style.italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface SerializeDocumentInput {
  baseBytes: Uint8Array;
  textBlocksByPage: Record<number, EditableTextBlock[]>;
  imageBlocksByPage?: Record<number, EditableImageBlock[]>;
  annotationsByPage?: Record<number, PageAnnotation[]>;
  formValues?: Record<string, string | boolean>;
  /** Lecteur optionnel d'octets TTF/OTF (injectable pour les tests unitaires ou fourni par Windows Electron) */
  resolveCustomFontBytes?: (style: TextStyle) => Promise<Uint8Array | null>;
}

/**
 * Applique toutes les modifications dans un vrai fichier PDF téléchargeable :
 * - remplissage des formulaires AcroForm
 * - corrections/suppressions de texte avec fond reconstruit
 * - déplacement/rotation/remplacement/suppression/copie d'images
 * - annotations, formes, tampons, remplissage libre et signatures
 * - caviardage destructif réel : le contenu masqué est physiquement supprimé du fichier
 */
export async function serializeDocumentEditsToPdf({
  baseBytes,
  textBlocksByPage,
  imageBlocksByPage = {},
  annotationsByPage = {},
  formValues = {},
  resolveCustomFontBytes,
}: SerializeDocumentInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(baseBytes);
  pdfDoc.registerFontkit(fontkit);
  const pages = pdfDoc.getPages();
  const embeddedFonts = new Map<StandardFonts, PDFFont>();
  const customFontsCache = new Map<string, PDFFont | null>();

  const desktop = getDesktopBridge();
  const fontBytesResolver =
    resolveCustomFontBytes ??
    (desktop
      ? (style: TextStyle) =>
          desktop.readSystemFontBytes(style.fontFamily, style.bold, style.italic)
      : null);

  const getFont = async (key: StandardFonts) => {
    const existing = embeddedFonts.get(key);
    if (existing) {
      return existing;
    }
    const font = await pdfDoc.embedFont(key);
    embeddedFonts.set(key, font);
    return font;
  };

  const getFontForTextStyle = async (
    style: TextStyle,
  ): Promise<{ font: PDFFont; supportsUnicode: boolean }> => {
    if (fontBytesResolver) {
      const cacheKey = `${style.fontFamily}|${style.bold ? 1 : 0}|${style.italic ? 1 : 0}`;
      if (!customFontsCache.has(cacheKey)) {
        try {
          const customBytes = await fontBytesResolver(style);
          if (customBytes && customBytes.byteLength > 256) {
            const customFont = await pdfDoc.embedFont(customBytes);
            customFontsCache.set(cacheKey, customFont);
          } else {
            customFontsCache.set(cacheKey, null);
          }
        } catch {
          customFontsCache.set(cacheKey, null);
        }
      }
      const cachedCustom = customFontsCache.get(cacheKey);
      if (cachedCustom) {
        return { font: cachedCustom, supportsUnicode: true };
      }
    }

    const fallbackFont = await getFont(selectStandardFontKey(style));
    return { font: fallbackFont, supportsUnicode: false };
  };

  // 1. Applique les champs de formulaire natifs AcroForm
  if (Object.keys(formValues).length > 0) {
    try {
      const form = pdfDoc.getForm();
      for (const [fieldName, val] of Object.entries(formValues)) {
        try {
          const field = form.getField(fieldName);
          // Utilise instanceof (résistant à la minification Vite en production)
          if (field instanceof PDFCheckBox) {
            if (Boolean(val)) {
              field.check();
            } else {
              field.uncheck();
            }
          } else if (field instanceof PDFRadioGroup) {
            if (typeof val === 'string' && val) {
              field.select(val);
            }
          } else if (field instanceof PDFDropdown) {
            if (typeof val === 'string' && val) {
              field.select(val);
            }
          } else if (field instanceof PDFOptionList) {
            if (typeof val === 'string' && val) {
              field.select(val);
            }
          } else if (field instanceof PDFTextField) {
            field.setText(sanitizeWinAnsi(String(val)));
          }
        } catch {
          // Ignore un champ absent ou incompatible
        }
      }
    } catch {
      // Document sans AcroForm
    }
  }

  // 2. Applique textes, images et annotations page par page
  const redactedPages = new Set<number>();

  for (let p = 0; p < pages.length; p += 1) {
    const pageNumber = p + 1;
    const page = pages[p];
    const { height: pageHeight } = page.getSize();

    const pageAnnots = annotationsByPage[pageNumber] ?? [];
    if (pageAnnots.some((a) => a.kind === 'redact')) {
      redactedPages.add(pageNumber);
    }

    // 2a. Images modifiées, supprimées, remplacées ou ajoutées
    const imgBlocks = imageBlocksByPage[pageNumber] ?? [];
    for (const img of imgBlocks) {
      const changedOrig =
        img.status !== 'original' ||
        img.rotation !== 0 ||
        Math.abs(img.x - img.origX) > 0.5 ||
        Math.abs(img.y - img.origY) > 0.5 ||
        Math.abs(img.width - img.origWidth) > 0.5 ||
        Math.abs(img.height - img.origHeight) > 0.5;

      if (!changedOrig) {
        continue;
      }

      if (img.source === 'pdf' && img.backgroundPatch?.dataUrl) {
        const patchImg = await pdfDoc.embedPng(dataUrlToBytes(img.backgroundPatch.dataUrl));
        page.drawImage(patchImg, {
          x: img.backgroundPatch.x,
          y: pageHeight - img.backgroundPatch.y - img.backgroundPatch.height,
          width: img.backgroundPatch.width,
          height: img.backgroundPatch.height,
        });
      }

      if (img.status === 'deleted') {
        continue;
      }

      const rotatedUrl =
        img.rotation !== 0 ? await rotatePngDataUrl(img.imageDataUrl, img.rotation) : img.imageDataUrl;
      const pngImage = await pdfDoc.embedPng(dataUrlToBytes(rotatedUrl));
      page.drawImage(pngImage, {
        x: img.x,
        y: pageHeight - img.y - img.height,
        width: img.width,
        height: img.height,
      });
    }

    // 2b. Blocs de texte modifiés ou supprimés
    const textBlocks = textBlocksByPage[pageNumber] ?? [];
    for (const block of textBlocks) {
      const hasMoved =
        Math.abs(block.x - block.origX) > 0.5 || Math.abs(block.y - block.origY) > 0.5;
      if (block.status === 'original' && !hasMoved) {
        continue;
      }

      if (block.backgroundPatch?.dataUrl) {
        const pngBytes = dataUrlToBytes(block.backgroundPatch.dataUrl);
        const pngImage = await pdfDoc.embedPng(pngBytes);
        page.drawImage(pngImage, {
          x: block.backgroundPatch.x,
          y: pageHeight - block.backgroundPatch.y - block.backgroundPatch.height,
          width: block.backgroundPatch.width,
          height: block.backgroundPatch.height,
        });
      }

      if (block.status === 'deleted' || !block.currentText.trim()) {
        continue;
      }

      const { font, supportsUnicode } = await getFontForTextStyle(block.style);
      const rawText = supportsUnicode ? block.currentText : sanitizeWinAnsi(block.currentText);
      const safeLines = rawText.split(/\r?\n/);
      const lineHeight = block.style.fontSize * 1.22;

      for (let li = 0; li < safeLines.length; li += 1) {
        const yPdf = pageHeight - block.y - block.style.fontSize * 0.9 - li * lineHeight;
        const drawOpts = {
          x: block.x,
          y: yPdf,
          size: block.style.fontSize,
          font,
          color: hexToRgb(block.style.color),
          maxWidth: Math.max(20, block.width),
        };
        try {
          page.drawText(safeLines[li], drawOpts);
        } catch {
          // Repli sûr en WinAnsi si un caractère rare manque dans la police intégrée
          const fallbackFont = await getFont(selectStandardFontKey(block.style));
          page.drawText(sanitizeWinAnsi(safeLines[li]), { ...drawOpts, font: fallbackFont });
        }
      }
    }

    // 2c. Annotations (hors caviardage qui a sa passe dédiée destructive ci-dessous)
    for (const annot of pageAnnots) {
      if (annot.kind === 'redact') {
        continue;
      }
      const colorRgb = hexToRgb(annot.color);
      const opacity = annot.opacity ?? 1;

      if (annot.kind === 'highlight') {
        page.drawRectangle({
          x: annot.x,
          y: pageHeight - annot.y - annot.height,
          width: annot.width,
          height: annot.height,
          color: colorRgb,
          opacity: annot.opacity ?? 0.35,
        });
      } else if (annot.kind === 'underline') {
        const lineY = pageHeight - (annot.y + annot.height);
        page.drawLine({
          start: { x: annot.x, y: lineY },
          end: { x: annot.x + annot.width, y: lineY },
          thickness: Math.max(1.5, annot.strokeWidth),
          color: colorRgb,
        });
      } else if (annot.kind === 'strike') {
        const lineY = pageHeight - (annot.y + annot.height / 2);
        page.drawLine({
          start: { x: annot.x, y: lineY },
          end: { x: annot.x + annot.width, y: lineY },
          thickness: Math.max(1.5, annot.strokeWidth),
          color: colorRgb,
        });
      } else if (annot.kind === 'rect') {
        page.drawRectangle({
          x: annot.x,
          y: pageHeight - annot.y - annot.height,
          width: annot.width,
          height: annot.height,
          borderColor: colorRgb,
          borderWidth: annot.strokeWidth,
          opacity,
        });
      } else if (annot.kind === 'ellipse') {
        page.drawEllipse({
          x: annot.x + annot.width / 2,
          y: pageHeight - annot.y - annot.height / 2,
          xScale: Math.max(4, annot.width / 2),
          yScale: Math.max(4, annot.height / 2),
          borderColor: colorRgb,
          borderWidth: annot.strokeWidth,
          opacity,
        });
      } else if (annot.kind === 'line' || annot.kind === 'arrow') {
        const pts = annot.points && annot.points.length >= 2
          ? annot.points
          : [
              { x: annot.x, y: annot.y + annot.height / 2 },
              { x: annot.x + annot.width, y: annot.y + annot.height / 2 },
            ];
        const p1 = { x: pts[0].x, y: pageHeight - pts[0].y };
        const p2 = { x: pts[1].x, y: pageHeight - pts[1].y };
        page.drawLine({
          start: p1,
          end: p2,
          thickness: annot.strokeWidth,
          color: colorRgb,
          lineCap: LineCapStyle.Round,
        });
        if (annot.kind === 'arrow') {
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          const headLen = Math.max(8, annot.strokeWidth * 3.5);
          for (const offset of [Math.PI * 0.82, -Math.PI * 0.82]) {
            page.drawLine({
              start: p2,
              end: {
                x: p2.x + Math.cos(angle + offset) * headLen,
                y: p2.y + Math.sin(angle + offset) * headLen,
              },
              thickness: annot.strokeWidth,
              color: colorRgb,
              lineCap: LineCapStyle.Round,
            });
          }
        }
      } else if (annot.kind === 'draw' && annot.points && annot.points.length >= 2) {
        for (let i = 1; i < annot.points.length; i += 1) {
          page.drawLine({
            start: { x: annot.points[i - 1].x, y: pageHeight - annot.points[i - 1].y },
            end: { x: annot.points[i].x, y: pageHeight - annot.points[i].y },
            thickness: annot.strokeWidth,
            color: colorRgb,
            lineCap: LineCapStyle.Round,
          });
        }
      } else if (annot.kind === 'signature' && annot.imageDataUrl) {
        const sigImg = await pdfDoc.embedPng(dataUrlToBytes(annot.imageDataUrl));
        page.drawImage(sigImg, {
          x: annot.x,
          y: pageHeight - annot.y - annot.height,
          width: annot.width,
          height: annot.height,
        });
      } else if (annot.kind === 'stamp') {
        const font = await getFont(StandardFonts.HelveticaBold);
        const label = sanitizeWinAnsi(annot.text ?? 'APPROUVÉ');
        page.drawRectangle({
          x: annot.x,
          y: pageHeight - annot.y - annot.height,
          width: annot.width,
          height: annot.height,
          borderColor: colorRgb,
          borderWidth: 2,
          color: colorRgb,
          opacity: 0.12,
        });
        const fSize = Math.max(10, Math.min(18, annot.height * 0.45));
        page.drawText(label, {
          x: annot.x + 8,
          y: pageHeight - annot.y - annot.height / 2 - fSize * 0.35,
          size: fSize,
          font,
          color: colorRgb,
        });
      } else if (annot.kind === 'note') {
        const font = await getFont(StandardFonts.Helvetica);
        page.drawRectangle({
          x: annot.x,
          y: pageHeight - annot.y - 22,
          width: 22,
          height: 22,
          color: rgb(0.99, 0.9, 0.35),
          borderColor: rgb(0.7, 0.5, 0.05),
          borderWidth: 1,
        });
        if (annot.text?.trim()) {
          page.drawText(sanitizeWinAnsi(annot.text), {
            x: annot.x + 26,
            y: pageHeight - annot.y - 14,
            size: 9,
            font,
            color: hexToRgb(annot.color),
            maxWidth: 180,
          });
        }
      } else if (annot.kind === 'free-text' || annot.kind === 'date') {
        const font = await getFont(StandardFonts.Helvetica);
        const size = annot.fontSize ?? 13;
        const txt = sanitizeWinAnsi(annot.text ?? '');
        if (txt) {
          page.drawText(txt, {
            x: annot.x + 2,
            y: pageHeight - annot.y - size,
            size,
            font,
            color: colorRgb,
            maxWidth: Math.max(30, annot.width),
          });
        }
      } else if (annot.kind === 'cross') {
        const x1 = annot.x + 2;
        const x2 = annot.x + annot.width - 2;
        const yTop = pageHeight - annot.y - 2;
        const yBot = pageHeight - (annot.y + annot.height) + 2;
        page.drawLine({ start: { x: x1, y: yTop }, end: { x: x2, y: yBot }, thickness: 2.2, color: colorRgb });
        page.drawLine({ start: { x: x1, y: yBot }, end: { x: x2, y: yTop }, thickness: 2.2, color: colorRgb });
      } else if (annot.kind === 'check') {
        const x0 = annot.x + 2;
        const xMid = annot.x + annot.width * 0.38;
        const x1 = annot.x + annot.width - 2;
        const yMid = pageHeight - (annot.y + annot.height * 0.58);
        const yBot = pageHeight - (annot.y + annot.height - 2);
        const yTop = pageHeight - (annot.y + 3);
        page.drawLine({ start: { x: x0, y: yMid }, end: { x: xMid, y: yBot }, thickness: 2.2, color: colorRgb });
        page.drawLine({ start: { x: xMid, y: yBot }, end: { x: x1, y: yTop }, thickness: 2.2, color: colorRgb });
      }
    }
  }

  let savedBytes = await pdfDoc.save();

  // 3. Caviardage destructif réel : toute page contenant au moins une zone caviardée
  // est aplanie et recréée sans aucun flux texte/formulaire/objet d'origine sous la zone noire.
  if (redactedPages.size > 0) {
    const intermediateProxy = await loadPdfDocument(savedBytes);
    try {
      const cleanDoc = await PDFDocument.load(savedBytes);
      const sortedRedacted = Array.from(redactedPages).sort((a, b) => a - b);

      // Retire aussi d'éventuels champs AcroForm attachés à la page caviardée
      try {
        const form = cleanDoc.getForm();
        const redRefs = new Set(
          sortedRedacted.map((pn) => cleanDoc.getPage(pn - 1).ref.toString()),
        );
        for (const field of form.getFields()) {
          const widgets = field.acroField.getWidgets();
          const hitsRedacted = widgets.some((w) => {
            const pRef = w.P();
            return pRef && redRefs.has(pRef.toString());
          });
          if (hitsRedacted) {
            form.removeField(field);
          }
        }
      } catch {
        // Ignore si absence d'AcroForm
      }

      for (const pageNumber of sortedRedacted) {
        const page = await intermediateProxy.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const flatScale = 2.4;
        const flatViewport = page.getViewport({ scale: flatScale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(flatViewport.width));
        canvas.height = Math.max(1, Math.floor(flatViewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          continue;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: flatViewport }).promise;

        // Dessine définitivement les rectangles noirs opaques sur l'image aplatie
        const redacts = (annotationsByPage[pageNumber] ?? []).filter((a) => a.kind === 'redact');
        ctx.fillStyle = '#000000';
        for (const r of redacts) {
          ctx.fillRect(
            Math.floor(r.x * flatScale) - 1,
            Math.floor(r.y * flatScale) - 1,
            Math.ceil(r.width * flatScale) + 2,
            Math.ceil(r.height * flatScale) + 2,
          );
        }

        const flatPngBytes = dataUrlToBytes(canvas.toDataURL('image/png'));
        const embeddedFlat = await cleanDoc.embedPng(flatPngBytes);
        const idx = pageNumber - 1;
        cleanDoc.removePage(idx);
        const replacedPage = cleanDoc.insertPage(idx, [baseViewport.width, baseViewport.height]);
        replacedPage.drawImage(embeddedFlat, {
          x: 0,
          y: 0,
          width: baseViewport.width,
          height: baseViewport.height,
        });
      }

      savedBytes = await cleanDoc.save({ useObjectStreams: true });
    } finally {
      await intermediateProxy.destroy().catch(() => undefined);
    }
  }

  return savedBytes;
}

/** Compatibilité directe pour l'appel simple d'édition de texte seul */
export function serializeTextEditsToPdf(
  baseBytes: Uint8Array,
  textBlocksByPage: Record<number, EditableTextBlock[]>,
): Promise<Uint8Array> {
  return serializeDocumentEditsToPdf({ baseBytes, textBlocksByPage });
}
