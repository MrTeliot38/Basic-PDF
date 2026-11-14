// Gestionnaire complet des pages : ajout vierge ou images, rotation, déplacement, duplication, suppression, fusion, extraction, division et export JPG/PNG
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  FilePlus,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  RotateCcw,
  RotateCw,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
import { readImageFileAsPngDataUrl } from '../utils/pdfImageExtractor';
import { exportPagesAsImages } from '../utils/pdfExportAndCompress';
import {
  addBlankPageOperation,
  addImagePagesOperation,
  deletePageOperation,
  duplicatePageOperation,
  extractPagesToNewPdf,
  mergePdfOperation,
  movePageOperation,
  parsePageRanges,
  rotatePageOperation,
  splitPdfIntoMultiple,
  type OverlayMapsSnapshot,
  type PageMutationOutput,
} from '../utils/pdfPagesOperations';
import { hasPdfHeader } from '../utils/pdfValidation';
import { createZipBytes } from '../utils/zipWriter';

interface PageManagerModalProps {
  fileName: string;
  currentBytes: Uint8Array;
  pdfProxy: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  overlayMaps: OverlayMapsSnapshot;
  onApplyPageMutation: (label: string, result: PageMutationOutput) => Promise<void>;
  onOpenPdfInNewTab: (fileName: string, bytes: Uint8Array) => Promise<void>;
  onShowInfo: (msg: string) => void;
  onShowError: (msg: string) => void;
  onClose: () => void;
}

function PageCardThumb({
  pdfProxy,
  pageNumber,
}: {
  pdfProxy: PDFDocumentProxy | null;
  pageNumber: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const canvas = canvasRef.current;
      if (!pdfProxy || !canvas || pageNumber > pdfProxy.numPages) return;
      try {
        const page = await pdfProxy.getPage(pageNumber);
        const vp = page.getViewport({ scale: 1 });
        const scale = Math.min(115 / vp.width, 150 / vp.height);
        const scaled = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(scaled.width));
        canvas.height = Math.max(1, Math.floor(scaled.height));
        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
      } catch {
        // Page en cours de rechargement
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [pdfProxy, pageNumber]);

  return <canvas ref={canvasRef} className="page-card-canvas" />;
}

function triggerDownload(bytes: Uint8Array, name: string, mime: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function PageManagerModal({
  fileName,
  currentBytes,
  pdfProxy,
  numPages,
  currentPage,
  overlayMaps,
  onApplyPageMutation,
  onOpenPdfInNewTab,
  onShowInfo,
  onShowError,
  onClose,
}: PageManagerModalProps) {
  const [section, setSection] = useState<'organize' | 'extract-split' | 'export-images'>('organize');
  const [busy, setBusy] = useState(false);
  const [extractRange, setExtractRange] = useState(`1-${Math.min(numPages, 2)}`);
  const [splitMode, setSplitMode] = useState<'single-pages' | 'halves' | 'every-n'>('single-pages');
  const [splitChunk, setSplitChunk] = useState(2);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png');
  const [exportScope, setExportScope] = useState<'current' | 'all'>('all');
  const [exportQuality, setExportQuality] = useState(0.9);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);
  const baseName = fileName.replace(/\.pdf$/i, '') || 'document';

  const runMutation = async (label: string, task: () => Promise<PageMutationOutput>) => {
    setBusy(true);
    try {
      const result = await task();
      await onApplyPageMutation(label, result);
      onShowInfo(`${label} terminé.`);
    } catch (err) {
      onShowError(err instanceof Error ? err.message : 'Opération sur les pages impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddImages = async (files: FileList) => {
    setBusy(true);
    try {
      const loaded: Array<{ dataUrl: string; width: number; height: number }> = [];
      for (const file of Array.from(files)) {
        loaded.push(await readImageFileAsPngDataUrl(file));
      }
      if (loaded.length === 0) return;
      const result = await addImagePagesOperation(currentBytes, currentPage, loaded, overlayMaps);
      await onApplyPageMutation('Ajouter des pages images', result);
      onShowInfo(`${loaded.length} page(s) ajoutée(s) depuis les images.`);
    } catch (err) {
      onShowError(err instanceof Error ? err.message : "Impossible d'ajouter ces images.");
    } finally {
      setBusy(false);
    }
  };

  const handleMergePdf = async (file: File) => {
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (!hasPdfHeader(buf)) {
        throw new Error('Le fichier choisi pour la fusion ne semble pas être un PDF valide.');
      }
      const result = await mergePdfOperation(currentBytes, buf, numPages, overlayMaps);
      await onApplyPageMutation('Fusionner un PDF', result);
      onShowInfo(`« ${file.name} » fusionné à la suite du document.`);
    } catch (err) {
      onShowError(err instanceof Error ? err.message : 'Impossible de fusionner ce document.');
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async (openInTab: boolean) => {
    const pages = parsePageRanges(extractRange, numPages);
    if (pages.length === 0) {
      onShowError(`Indiquez des numéros de page entre 1 et ${numPages} (ex. 1, 3-5).`);
      return;
    }
    setBusy(true);
    try {
      const outBytes = await extractPagesToNewPdf(currentBytes, pages);
      const outName = `${baseName}-extrait.pdf`;
      if (openInTab) {
        await onOpenPdfInNewTab(outName, outBytes);
        onShowInfo(`${pages.length} page(s) extraites dans un nouvel onglet.`);
        onClose();
      } else {
        triggerDownload(outBytes, outName, 'application/pdf');
        onShowInfo(`Extrait enregistré (${outName}).`);
      }
    } catch (err) {
      onShowError(err instanceof Error ? err.message : "Impossible d'extraire ces pages.");
    } finally {
      setBusy(false);
    }
  };

  const handleSplit = async () => {
    setBusy(true);
    try {
      const parts = await splitPdfIntoMultiple(currentBytes, splitMode, splitChunk);
      if (parts.length === 1) {
        triggerDownload(parts[0].bytes, `${baseName}-${parts[0].label}.pdf`, 'application/pdf');
      } else {
        const zipBytes = createZipBytes(
          parts.map((p) => ({ name: `${baseName}-${p.label}.pdf`, bytes: p.bytes })),
        );
        triggerDownload(zipBytes, `${baseName}-divise.zip`, 'application/zip');
      }
      onShowInfo(`Document divisé en ${parts.length} fichier(s) PDF.`);
    } catch (err) {
      onShowError(err instanceof Error ? err.message : 'Impossible de diviser ce document.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportImages = async () => {
    if (!pdfProxy) return;
    setBusy(true);
    try {
      const targetPages =
        exportScope === 'current'
          ? [currentPage]
          : Array.from({ length: numPages }, (_, i) => i + 1);
      const exported = await exportPagesAsImages(
        pdfProxy,
        targetPages,
        baseName,
        exportFormat,
        exportQuality,
      );
      if (exported.length === 1) {
        const item = exported[0];
        triggerDownload(
          item.bytes,
          item.fileName,
          exportFormat === 'png' ? 'image/png' : 'image/jpeg',
        );
      } else if (exported.length > 1) {
        const zip = createZipBytes(
          exported.map((item) => ({ name: item.fileName, bytes: item.bytes })),
        );
        triggerDownload(zip, `${baseName}-images.zip`, 'application/zip');
      }
      onShowInfo(`${exported.length} page(s) exportée(s) en ${exportFormat.toUpperCase()}.`);
    } catch (err) {
      onShowError(err instanceof Error ? err.message : "Erreur lors de l'export en images.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Gestion des pages et export"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <Layers size={18} aria-hidden="true" />
            <span>Pages, fusion et export ({numPages} page{numPages > 1 ? 's' : ''})</span>
          </h2>
          <button
            type="button"
            className="tab-close-btn"
            aria-label="Fermer la gestion des pages"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'organize'}
            className={`btn ${section === 'organize' ? 'is-active' : ''}`}
            onClick={() => setSection('organize')}
          >
            <Layers size={15} aria-hidden="true" />
            <span>Organiser &amp; Fusionner</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'extract-split'}
            className={`btn ${section === 'extract-split' ? 'is-active' : ''}`}
            onClick={() => setSection('extract-split')}
          >
            <Scissors size={15} aria-hidden="true" />
            <span>Extraire &amp; Diviser</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'export-images'}
            className={`btn ${section === 'export-images' ? 'is-active' : ''}`}
            onClick={() => setSection('export-images')}
          >
            <ImageIcon size={15} aria-hidden="true" />
            <span>Exporter JPG / PNG</span>
          </button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only-input"
          aria-label="Ajouter des pages depuis des images"
          onChange={(e) => {
            if (e.target.files?.length) {
              void handleAddImages(e.target.files);
              e.target.value = '';
            }
          }}
        />
        <input
          ref={mergeInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only-input"
          aria-label="Choisir un autre PDF à fusionner"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              void handleMergePdf(f);
              e.target.value = '';
            }
          }}
        />

        {section === 'organize' && (
          <div className="page-manager-body">
            <div className="page-manager-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void runMutation('Ajouter une page vierge', () =>
                    addBlankPageOperation(currentBytes, currentPage, overlayMaps),
                  )
                }
              >
                <FilePlus size={15} aria-hidden="true" />
                <span>Ajouter une page vierge</span>
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImagePlus size={15} aria-hidden="true" />
                <span>Ajouter depuis images</span>
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => mergeInputRef.current?.click()}
              >
                <Layers size={15} aria-hidden="true" />
                <span>Fusionner un autre PDF</span>
              </button>
            </div>

            <div className="pages-grid">
              {Array.from({ length: numPages }, (_, idx) => idx + 1).map((pNum) => (
                <div
                  key={pNum}
                  data-testid={`page-manager-card-${pNum}`}
                  className={`page-grid-card ${pNum === currentPage ? 'is-current' : ''}`}
                >
                  <PageCardThumb pdfProxy={pdfProxy} pageNumber={pNum} />
                  <div className="page-card-label">Page {pNum}</div>
                  <div className="page-card-controls">
                    <button
                      type="button"
                      className="btn btn-icon-sm"
                      disabled={busy || pNum === 1}
                      aria-label={`Déplacer la page ${pNum} avant`}
                      title="Déplacer avant"
                      onClick={() =>
                        void runMutation('Déplacer la page', () =>
                          movePageOperation(currentBytes, pNum, pNum - 1, overlayMaps),
                        )
                      }
                    >
                      <ArrowLeft size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon-sm"
                      disabled={busy || pNum === numPages}
                      aria-label={`Déplacer la page ${pNum} après`}
                      title="Déplacer après"
                      onClick={() =>
                        void runMutation('Déplacer la page', () =>
                          movePageOperation(currentBytes, pNum, pNum + 1, overlayMaps),
                        )
                      }
                    >
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon-sm"
                      disabled={busy}
                      aria-label={`Pivoter la page ${pNum} à gauche`}
                      title="Pivoter à gauche"
                      onClick={() =>
                        void runMutation('Pivoter la page', () =>
                          rotatePageOperation(currentBytes, pNum, -90, overlayMaps),
                        )
                      }
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon-sm"
                      disabled={busy}
                      aria-label={`Pivoter la page ${pNum} à droite`}
                      title="Pivoter à droite"
                      onClick={() =>
                        void runMutation('Pivoter la page', () =>
                          rotatePageOperation(currentBytes, pNum, 90, overlayMaps),
                        )
                      }
                    >
                      <RotateCw size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon-sm"
                      disabled={busy}
                      aria-label={`Dupliquer la page ${pNum}`}
                      title="Dupliquer"
                      onClick={() =>
                        void runMutation('Dupliquer la page', () =>
                          duplicatePageOperation(currentBytes, pNum, overlayMaps),
                        )
                      }
                    >
                      <Copy size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon-sm btn-danger"
                      disabled={busy || numPages <= 1}
                      aria-label={`Supprimer la page ${pNum}`}
                      title="Supprimer cette page"
                      onClick={() =>
                        void runMutation('Supprimer la page', () =>
                          deletePageOperation(currentBytes, pNum, overlayMaps),
                        )
                      }
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'extract-split' && (
          <div className="split-extract-body">
            <div className="panel-card-box">
              <h3 className="inspector-subheading">Extraire certaines pages dans un nouveau PDF</h3>
              <label className="inspector-label" htmlFor="extract-pages-input">
                Numéros ou plages (ex. <code>1, 3-5</code> sur {numPages} pages)
              </label>
              <div className="inline-form-row">
                <input
                  id="extract-pages-input"
                  type="text"
                  className="inspector-select"
                  value={extractRange}
                  onChange={(e) => setExtractRange(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void handleExtract(true)}
                >
                  Ouvrir dans un onglet
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void handleExtract(false)}
                >
                  <Download size={15} aria-hidden="true" />
                  <span>Télécharger</span>
                </button>
              </div>
            </div>

            <div className="panel-card-box">
              <h3 className="inspector-subheading">Diviser le document en plusieurs fichiers</h3>
              <div className="radio-stack">
                <label className="checkbox-row">
                  <input
                    type="radio"
                    name="split-mode"
                    checked={splitMode === 'single-pages'}
                    onChange={() => setSplitMode('single-pages')}
                  />
                  <span>1 fichier PDF par page ({numPages} fichiers)</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="radio"
                    name="split-mode"
                    checked={splitMode === 'halves'}
                    onChange={() => setSplitMode('halves')}
                  />
                  <span>Couper en deux parties égales</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="radio"
                    name="split-mode"
                    checked={splitMode === 'every-n'}
                    onChange={() => setSplitMode('every-n')}
                  />
                  <span>Un fichier toutes les</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, numPages)}
                    value={splitChunk}
                    aria-label="Nombre de pages par fichier"
                    className="inspector-number small-num"
                    onChange={(e) => setSplitChunk(Math.max(1, Number(e.target.value) || 1))}
                  />
                  <span>pages</span>
                </label>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void handleSplit()}
              >
                <Scissors size={15} aria-hidden="true" />
                <span>Diviser et télécharger</span>
              </button>
            </div>
          </div>
        )}

        {section === 'export-images' && (
          <div className="split-extract-body">
            <div className="panel-card-box">
              <h3 className="inspector-subheading">Transformer les pages en images (JPG ou PNG)</h3>
              <div className="inspector-row-2col">
                <div className="inspector-field">
                  <label className="inspector-label" htmlFor="export-img-format">
                    Format d’image
                  </label>
                  <select
                    id="export-img-format"
                    className="inspector-select"
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as 'png' | 'jpeg')}
                  >
                    <option value="png">PNG (sans perte, très net)</option>
                    <option value="jpeg">JPG (plus léger, idéal par e-mail)</option>
                  </select>
                </div>
                <div className="inspector-field">
                  <label className="inspector-label" htmlFor="export-img-scope">
                    Pages à exporter
                  </label>
                  <select
                    id="export-img-scope"
                    className="inspector-select"
                    value={exportScope}
                    onChange={(e) => setExportScope(e.target.value as 'current' | 'all')}
                  >
                    <option value="current">Page actuelle uniquement (page {currentPage})</option>
                    <option value="all">Toutes les pages ({numPages} fichiers en .zip)</option>
                  </select>
                </div>
              </div>

              {exportFormat === 'jpeg' && (
                <div className="inspector-field">
                  <label className="inspector-label" htmlFor="export-jpg-quality">
                    Qualité JPG ({Math.round(exportQuality * 100)} %)
                  </label>
                  <input
                    id="export-jpg-quality"
                    type="range"
                    min={0.4}
                    max={1}
                    step={0.05}
                    value={exportQuality}
                    onChange={(e) => setExportQuality(Number(e.target.value))}
                  />
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !pdfProxy}
                onClick={() => void handleExportImages()}
              >
                <Download size={16} aria-hidden="true" />
                <span>Exporter en {exportFormat.toUpperCase()}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
