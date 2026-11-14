// Fenêtre d'impression avec aperçu complet : choix des pages, N pages par feuille, livret, format, marges, en-têtes et pieds de page
import { useEffect, useMemo, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { BookOpen, Download, Printer, X } from 'lucide-react';
import type { PrintSettings } from '../types/pdf';
import { getDesktopBridge } from '../utils/desktopBridge';
import { computePrintSheets, parsePageRanges } from '../utils/pdfPagesOperations';

interface PrintModalProps {
  fileName: string;
  pdfProxy: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  onShowInfo?: (msg: string) => void;
  onShowError: (msg: string) => void;
  onClose: () => void;
}

const PAPER_SIZES_MM: Record<PrintSettings['paperSize'], { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Letter: { w: 215.9, h: 279.4 },
  A3: { w: 297, h: 420 },
};

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

function expandHeaderFooter(
  template: string,
  sheetNumber: number,
  totalSheets: number,
  fileName: string,
): string {
  const cleanTitle = fileName.replace(/\.pdf$/i, '');
  const today = new Date().toLocaleDateString('fr-FR');
  return template
    .replace(/\{page\}/gi, String(sheetNumber))
    .replace(/\{total\}/gi, String(totalSheets))
    .replace(/\{titre\}/gi, cleanTitle)
    .replace(/\{date\}/gi, today);
}

export function PrintModal({
  fileName,
  pdfProxy,
  numPages,
  currentPage,
  onShowInfo,
  onShowError,
  onClose,
}: PrintModalProps) {
  const [settings, setSettings] = useState<PrintSettings>({
    pageScope: 'all',
    customRange: `1-${numPages}`,
    paperSize: 'A4',
    orientation: 'portrait',
    pagesPerSheet: 1,
    booklet: false,
    marginsMm: 6,
    headerText: '',
    footerText: 'Page {page} / {total}',
  });

  const [thumbDataUrls, setThumbDataUrls] = useState<Record<number, string>>({});

  const selectedPages = useMemo(() => {
    if (settings.pageScope === 'current') {
      return [currentPage];
    }
    if (settings.pageScope === 'custom') {
      const parsed = parsePageRanges(settings.customRange, numPages);
      return parsed.length > 0 ? parsed : [1];
    }
    return Array.from({ length: numPages }, (_, i) => i + 1);
  }, [settings.pageScope, settings.customRange, numPages, currentPage]);

  const sheets = useMemo(
    () => computePrintSheets(selectedPages, settings.pagesPerSheet, settings.booklet),
    [selectedPages, settings.pagesPerSheet, settings.booklet],
  );

  useEffect(() => {
    let cancelled = false;
    const renderThumbs = async () => {
      if (!pdfProxy) return;
      const needed = Array.from(new Set(selectedPages));
      const map: Record<number, string> = {};
      for (const p of needed) {
        if (p < 1 || p > pdfProxy.numPages) continue;
        const page = await pdfProxy.getPage(p);
        const vp = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
          if (cancelled) return;
          map[p] = canvas.toDataURL('image/jpeg', 0.88);
        }
      }
      if (!cancelled) {
        setThumbDataUrls(map);
      }
    };
    void renderThumbs();
    return () => {
      cancelled = true;
    };
  }, [pdfProxy, selectedPages]);

  const effectiveOrientation = settings.booklet ? 'landscape' : settings.orientation;
  const effectivePerSheet = settings.booklet ? 2 : settings.pagesPerSheet;
  const paperDim = PAPER_SIZES_MM[settings.paperSize];
  const sheetWidthMm = effectiveOrientation === 'landscape' ? paperDim.h : paperDim.w;
  const sheetHeightMm = effectiveOrientation === 'landscape' ? paperDim.w : paperDim.h;

  const gridCols =
    effectivePerSheet === 1 ? 1 : effectivePerSheet === 2 ? 2 : effectivePerSheet === 4 ? 2 : 3;
  const gridRows =
    effectivePerSheet <= 2 ? 1 : 2;

  const handlePrintNow = async () => {
    const desktop = getDesktopBridge();
    if (!desktop) {
      window.print();
      return;
    }

    try {
      const res = await desktop.printSheetsNative({
        title: fileName,
        paperSize: settings.paperSize,
        widthMm: sheetWidthMm,
        heightMm: sheetHeightMm,
        landscape: effectiveOrientation === 'landscape',
        sheets: sheets.map((sheetPages, sIdx) => ({
          gridCols,
          gridRows,
          marginMm: settings.marginsMm,
          headerText: settings.headerText.trim()
            ? expandHeaderFooter(settings.headerText, sIdx + 1, sheets.length, fileName)
            : undefined,
          footerText: settings.footerText.trim()
            ? expandHeaderFooter(settings.footerText, sIdx + 1, sheets.length, fileName)
            : undefined,
          cells: sheetPages.map((srcPage) => ({
            imageDataUrl: srcPage ? thumbDataUrls[srcPage] : undefined,
          })),
        })),
      });

      if (res.ok) {
        onShowInfo?.('Impression lancée.');
      } else if (!res.canceled && res.error) {
        onShowError(res.error);
      }
    } catch {
      onShowError("Impossible de lancer l'impression Windows.");
    }
  };

  const handleSaveImposedPdf = async () => {
    try {
      const outDoc = await PDFDocument.create();
      const font = await outDoc.embedFont(StandardFonts.Helvetica);
      const sheetW = mmToPt(sheetWidthMm);
      const sheetH = mmToPt(sheetHeightMm);
      const margin = mmToPt(settings.marginsMm);
      const headerBand = settings.headerText.trim() ? 18 : 0;
      const footerBand = settings.footerText.trim() ? 18 : 0;

      for (let sIdx = 0; sIdx < sheets.length; sIdx += 1) {
        const sheet = sheets[sIdx];
        const pdfPage = outDoc.addPage([sheetW, sheetH]);
        const usableW = Math.max(40, sheetW - margin * 2);
        const usableH = Math.max(40, sheetH - margin * 2 - headerBand - footerBand);
        const cellW = usableW / gridCols;
        const cellH = usableH / gridRows;

        if (headerBand > 0) {
          pdfPage.drawText(
            expandHeaderFooter(settings.headerText, sIdx + 1, sheets.length, fileName),
            {
              x: margin,
              y: sheetH - margin - 11,
              size: 9,
              font,
              color: rgb(0.25, 0.3, 0.38),
            },
          );
        }

        if (footerBand > 0) {
          pdfPage.drawText(
            expandHeaderFooter(settings.footerText, sIdx + 1, sheets.length, fileName),
            {
              x: margin,
              y: margin + 4,
              size: 9,
              font,
              color: rgb(0.25, 0.3, 0.38),
            },
          );
        }

        for (let cellIdx = 0; cellIdx < sheet.length; cellIdx += 1) {
          const srcPageNum = sheet[cellIdx];
          if (!srcPageNum || !thumbDataUrls[srcPageNum]) continue;
          const col = cellIdx % gridCols;
          const row = Math.floor(cellIdx / gridCols);
          const base64 = thumbDataUrls[srcPageNum].split(',')[1] ?? '';
          const bin = atob(base64);
          const jpgBytes = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k += 1) jpgBytes[k] = bin.charCodeAt(k);
          const img = await outDoc.embedJpg(jpgBytes);

          const pad = 4;
          const maxW = Math.max(10, cellW - pad * 2);
          const maxH = Math.max(10, cellH - pad * 2);
          const ratio = Math.min(maxW / img.width, maxH / img.height);
          const drawW = img.width * ratio;
          const drawH = img.height * ratio;

          const cellLeft = margin + col * cellW;
          const cellBottom = margin + footerBand + (gridRows - 1 - row) * cellH;
          pdfPage.drawImage(img, {
            x: cellLeft + (cellW - drawW) / 2,
            y: cellBottom + (cellH - drawH) / 2,
            width: drawW,
            height: drawH,
          });
        }
      }

      const bytes = await outDoc.save();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, '') + '-impression.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      onShowError("Impossible de préparer ce fichier PDF d'impression.");
    }
  };

  return (
    <div className="modal-backdrop print-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-print"
        role="dialog"
        aria-modal="true"
        aria-label="Aperçu avant impression"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header no-print">
          <h2 className="modal-title">
            <Printer size={18} aria-hidden="true" />
            <span>Impression et aperçu ({sheets.length} feuille{sheets.length > 1 ? 's' : ''})</span>
          </h2>
          <button
            type="button"
            className="tab-close-btn"
            aria-label="Fermer l'impression"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="print-layout-split">
          {/* Panneau de réglages */}
          <div className="print-options-col no-print">
            <div className="inspector-field">
              <label className="inspector-label" htmlFor="print-scope">
                Pages à imprimer
              </label>
              <select
                id="print-scope"
                className="inspector-select"
                value={settings.pageScope}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, pageScope: e.target.value as PrintSettings['pageScope'] }))
                }
              >
                <option value="all">Toutes les pages (1 à {numPages})</option>
                <option value="current">Page actuelle uniquement (page {currentPage})</option>
                <option value="custom">Sélection personnalisée</option>
              </select>
            </div>

            {settings.pageScope === 'custom' && (
              <div className="inspector-field">
                <label className="inspector-label" htmlFor="print-custom-range">
                  Plage (ex. 1, 3-5)
                </label>
                <input
                  id="print-custom-range"
                  type="text"
                  className="inspector-select"
                  value={settings.customRange}
                  onChange={(e) => setSettings((s) => ({ ...s, customRange: e.target.value }))}
                />
              </div>
            )}

            <div className="inspector-row-2col">
              <div className="inspector-field">
                <label className="inspector-label" htmlFor="print-paper">
                  Format de papier
                </label>
                <select
                  id="print-paper"
                  className="inspector-select"
                  value={settings.paperSize}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, paperSize: e.target.value as PrintSettings['paperSize'] }))
                  }
                >
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                  <option value="Letter">Lettre US</option>
                  <option value="A3">A3</option>
                </select>
              </div>

              <div className="inspector-field">
                <label className="inspector-label" htmlFor="print-orient">
                  Orientation
                </label>
                <select
                  id="print-orient"
                  className="inspector-select"
                  disabled={settings.booklet}
                  value={effectiveOrientation}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, orientation: e.target.value as 'portrait' | 'landscape' }))
                  }
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Paysage</option>
                </select>
              </div>
            </div>

            <div className="inspector-row-2col">
              <div className="inspector-field">
                <label className="inspector-label" htmlFor="print-per-sheet">
                  Pages par feuille
                </label>
                <select
                  id="print-per-sheet"
                  className="inspector-select"
                  disabled={settings.booklet}
                  value={effectivePerSheet}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      pagesPerSheet: Number(e.target.value) as 1 | 2 | 4 | 6,
                    }))
                  }
                >
                  <option value={1}>1 page par feuille</option>
                  <option value={2}>2 pages par feuille</option>
                  <option value={4}>4 pages par feuille</option>
                  <option value={6}>6 pages par feuille</option>
                </select>
              </div>

              <div className="inspector-field">
                <label className="inspector-label" htmlFor="print-margins">
                  Marges
                </label>
                <select
                  id="print-margins"
                  className="inspector-select"
                  value={settings.marginsMm}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, marginsMm: Number(e.target.value) as 0 | 6 | 12 | 20 }))
                  }
                >
                  <option value={0}>Sans marge</option>
                  <option value={6}>Étroites (6 mm)</option>
                  <option value={12}>Normales (12 mm)</option>
                  <option value={20}>Larges (20 mm)</option>
                </select>
              </div>
            </div>

            <label className="checkbox-row booklet-toggle">
              <input
                type="checkbox"
                checked={settings.booklet}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, booklet: e.target.checked }))
                }
              />
              <BookOpen size={15} aria-hidden="true" />
              <span>Impression en livret (pliage cahier automatique)</span>
            </label>

            <div className="inspector-field">
              <label className="inspector-label" htmlFor="print-header">
                En-tête (variables : {'{titre}'}, {'{date}'}, {'{page}'})
              </label>
              <input
                id="print-header"
                type="text"
                className="inspector-select"
                placeholder="Ex. {titre} — {date}"
                value={settings.headerText}
                onChange={(e) => setSettings((s) => ({ ...s, headerText: e.target.value }))}
              />
            </div>

            <div className="inspector-field">
              <label className="inspector-label" htmlFor="print-footer">
                Pied de page (variables : {'{page}'}, {'{total}'}, {'{date}'})
              </label>
              <input
                id="print-footer"
                type="text"
                className="inspector-select"
                value={settings.footerText}
                onChange={(e) => setSettings((s) => ({ ...s, footerText: e.target.value }))}
              />
            </div>
          </div>

          {/* Zone d'aperçu visuel réelle et imprimable */}
          <div className="print-preview-area" id="print-sheets-area">
            {sheets.map((sheetPages, sIdx) => (
              <div
                key={`sheet-${sIdx}`}
                data-testid={`print-sheet-${sIdx + 1}`}
                className="print-sheet-card"
                style={{
                  aspectRatio: `${sheetWidthMm} / ${sheetHeightMm}`,
                  padding: `${Math.round((settings.marginsMm / sheetWidthMm) * 100)}%`,
                }}
              >
                {settings.headerText.trim() && (
                  <div className="print-sheet-header">
                    {expandHeaderFooter(settings.headerText, sIdx + 1, sheets.length, fileName)}
                  </div>
                )}

                <div
                  className="print-sheet-grid"
                  style={{
                    gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
                  }}
                >
                  {sheetPages.map((srcPage, cIdx) => (
                    <div key={`cell-${sIdx}-${cIdx}`} className="print-sheet-cell">
                      {srcPage ? (
                        <>
                          {thumbDataUrls[srcPage] && (
                            <img
                              src={thumbDataUrls[srcPage]}
                              alt={`Aperçu page ${srcPage}`}
                              className="print-cell-img"
                            />
                          )}
                          {(settings.booklet || settings.pagesPerSheet > 1 || !thumbDataUrls[srcPage]) && (
                            <span className="print-cell-num">Page {srcPage}</span>
                          )}
                        </>
                      ) : (
                        <span className="print-cell-blank" aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </div>

                {settings.footerText.trim() && (
                  <div className="print-sheet-footer">
                    {expandHeaderFooter(settings.footerText, sIdx + 1, sheets.length, fileName)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer no-print">
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void handleSaveImposedPdf()}
          >
            <Download size={15} aria-hidden="true" />
            <span>Enregistrer la mise en page (PDF)</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handlePrintNow()}
          >
            <Printer size={16} aria-hidden="true" />
            <span>Imprimer</span>
          </button>
        </div>
      </div>
    </div>
  );
}
