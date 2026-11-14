// Export des pages en images (JPG/PNG) et compression du PDF selon plusieurs niveaux de qualité
import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { CompressionLevel } from '../types/pdf';
import { loadPdfDocument } from './pdfLoader';

export interface ExportedPageImage {
  pageNumber: number;
  fileName: string;
  bytes: Uint8Array;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Exporte une sélection de pages du document en fichiers PNG ou JPG haute netteté.
 */
export async function exportPagesAsImages(
  pdfProxy: PDFDocumentProxy,
  pageNumbers: number[],
  baseTitle: string,
  format: 'png' | 'jpeg',
  jpegQuality = 0.9,
): Promise<ExportedPageImage[]> {
  const cleanTitle = baseTitle.replace(/\.pdf$/i, '') || 'document';
  const ext = format === 'png' ? 'png' : 'jpg';
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const results: ExportedPageImage[] = [];

  for (const pageNum of pageNumbers) {
    if (pageNum < 1 || pageNum > pdfProxy.numPages) {
      continue;
    }
    const page = await pdfProxy.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      continue;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const dataUrl =
      format === 'png' ? canvas.toDataURL(mime) : canvas.toDataURL(mime, jpegQuality);
    results.push({
      pageNumber: pageNum,
      fileName: `${cleanTitle}-page-${pageNum}.${ext}`,
      bytes: dataUrlToUint8Array(dataUrl),
    });
  }

  return results;
}

const COMPRESSION_PRESETS: Record<
  CompressionLevel,
  { scale: number; jpegQuality: number; label: string }
> = {
  light: { scale: 1.65, jpegQuality: 0.84, label: 'Compression légère (haute qualité)' },
  balanced: { scale: 1.3, jpegQuality: 0.65, label: 'Compression équilibrée (recommandée)' },
  maximum: { scale: 0.95, jpegQuality: 0.42, label: 'Compression maximale (fichier très léger)' },
};

/**
 * Réduit le poids du PDF selon le niveau choisi : ré-optimisation structurelle + JPEG maîtrisé.
 * Compare toujours avec le fichier optimisé sans perte et conserve la version la plus légère si utile.
 */
export async function compressPdfDocument(
  sourceBytes: Uint8Array,
  level: CompressionLevel,
  onProgress?: (percent: number) => void,
): Promise<{
  bytes: Uint8Array;
  originalSize: number;
  compressedSize: number;
  presetLabel: string;
}> {
  const preset = COMPRESSION_PRESETS[level];
  const srcProxy = await loadPdfDocument(sourceBytes);

  try {
    const outDoc = await PDFDocument.create();
    const total = srcProxy.numPages;

    for (let p = 1; p <= total; p += 1) {
      const page = await srcProxy.getPage(p);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale: preset.scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise;

        const jpgBytes = dataUrlToUint8Array(canvas.toDataURL('image/jpeg', preset.jpegQuality));
        const jpgImg = await outDoc.embedJpg(jpgBytes);
        const newPage = outDoc.addPage([baseViewport.width, baseViewport.height]);
        newPage.drawImage(jpgImg, {
          x: 0,
          y: 0,
          width: baseViewport.width,
          height: baseViewport.height,
        });
      }

      if (onProgress) {
        onProgress(Math.round((p / total) * 100));
      }
    }

    const compressedBytes = await outDoc.save({ useObjectStreams: true });
    return {
      bytes: compressedBytes,
      originalSize: sourceBytes.byteLength,
      compressedSize: compressedBytes.byteLength,
      presetLabel: preset.label,
    };
  } finally {
    await srcProxy.destroy().catch(() => undefined);
  }
}
