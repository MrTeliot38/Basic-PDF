// Génération sécurisée du document HTML destiné à l'impression native Windows
import type { DesktopPrintRequest } from '../../src/types/desktop';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeImageDataUrl(url: string | undefined): url is string {
  return (
    typeof url === 'string' &&
    /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)
  );
}

/**
 * Construit un document HTML autonome respectant exactement le format papier, les marges,
 * l'orientation, les en-têtes/pieds de page et le nombre de pages par feuille (ou livret).
 */
export function buildNativePrintHtml(req: DesktopPrintRequest): string {
  const safeWidthMm = Math.max(50, Math.min(1000, Number(req.widthMm) || 210));
  const safeHeightMm = Math.max(50, Math.min(1000, Number(req.heightMm) || 297));
  const safeTitle = escapeHtml(req.title || 'Impression Basic PDF');

  const sheetsHtml = req.sheets
    .map((sheet) => {
      const cols = Math.max(1, Math.min(4, Math.round(sheet.gridCols || 1)));
      const rows = Math.max(1, Math.min(4, Math.round(sheet.gridRows || 1)));
      const marginMm = Math.max(0, Math.min(50, Number(sheet.marginMm) || 0));

      const cellsHtml = sheet.cells
        .map((cell) => {
          if (!isSafeImageDataUrl(cell.imageDataUrl)) {
            return '<div class="cell empty"></div>';
          }
          return `<div class="cell"><img src="${cell.imageDataUrl}" alt="" /></div>`;
        })
        .join('');

      const headerHtml = sheet.headerText?.trim()
        ? `<div class="band header">${escapeHtml(sheet.headerText)}</div>`
        : '';
      const footerHtml = sheet.footerText?.trim()
        ? `<div class="band footer">${escapeHtml(sheet.footerText)}</div>`
        : '';

      return `
        <section class="sheet" style="padding: ${marginMm}mm;">
          ${headerHtml}
          <div class="grid" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr)); grid-template-rows: repeat(${rows}, minmax(0, 1fr));">
            ${cellsHtml}
          </div>
          ${footerHtml}
        </section>
      `;
    })
    .join('\n');

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
    <title>${safeTitle}</title>
    <style>
      @page {
        size: ${safeWidthMm}mm ${safeHeightMm}mm;
        margin: 0;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #1e293b;
        font-family: "Segoe UI", Arial, sans-serif;
      }
      .sheet {
        width: ${safeWidthMm}mm;
        height: ${safeHeightMm}mm;
        display: flex;
        flex-direction: column;
        gap: 2mm;
        page-break-after: always;
        break-after: page;
        overflow: hidden;
      }
      .sheet:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .band {
        font-size: 9pt;
        color: #475569;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 0 0 auto;
      }
      .footer { text-align: right; }
      .grid {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        gap: 3mm;
      }
      .cell {
        min-width: 0;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .cell img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        display: block;
      }
    </style>
  </head>
  <body>
    ${sheetsHtml}
  </body>
</html>`;
}
