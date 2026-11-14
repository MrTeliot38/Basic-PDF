// Fenêtre modale de compression du PDF avec choix du niveau de qualité et comparaison de taille
import { useState } from 'react';
import { Check, Download, FileDown, X } from 'lucide-react';
import type { CompressionLevel } from '../types/pdf';
import { formatFileSize } from '../utils/formatters';
import { compressPdfDocument } from '../utils/pdfExportAndCompress';

interface CompressModalProps {
  fileName: string;
  sourceBytes: Uint8Array;
  onApplyCompressedBytes: (bytes: Uint8Array) => Promise<void>;
  onClose: () => void;
}

export function CompressModal({
  fileName,
  sourceBytes,
  onApplyCompressedBytes,
  onClose,
}: CompressModalProps) {
  const [level, setLevel] = useState<CompressionLevel>('balanced');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{
    bytes: Uint8Array;
    originalSize: number;
    compressedSize: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCompression = async () => {
    setError(null);
    setProgress(0);
    setResult(null);
    try {
      const out = await compressPdfDocument(sourceBytes, level, (pct) => setProgress(pct));
      setResult(out);
    } catch {
      setError('Impossible de compresser ce document.');
    } finally {
      setProgress(null);
    }
  };

  const downloadCompressed = () => {
    if (!result) return;
    const copy = new Uint8Array(result.bytes.byteLength);
    copy.set(result.bytes);
    const blob = new Blob([copy], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/\.pdf$/i, '') + '-allege.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const savingsPct =
    result && result.originalSize > 0
      ? Math.round(((result.originalSize - result.compressedSize) / result.originalSize) * 100)
      : 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Compresser le PDF"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <FileDown size={18} aria-hidden="true" />
            <span>Compresser le PDF</span>
          </h2>
          <button
            type="button"
            className="tab-close-btn"
            aria-label="Fermer la compression"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="modal-subtitle">
          Taille actuelle du document : <strong>{formatFileSize(sourceBytes.byteLength)}</strong>
        </p>

        <div className="radio-stack">
          <label className="choice-card">
            <input
              type="radio"
              name="compression-level"
              checked={level === 'light'}
              onChange={() => {
                setLevel('light');
                setResult(null);
              }}
            />
            <div>
              <strong>Légère (haute qualité)</strong>
              <p>Idéal pour conserver un texte très net et des graphiques précis.</p>
            </div>
          </label>

          <label className="choice-card">
            <input
              type="radio"
              name="compression-level"
              checked={level === 'balanced'}
              onChange={() => {
                setLevel('balanced');
                setResult(null);
              }}
            />
            <div>
              <strong>Équilibrée (recommandée)</strong>
              <p>Réduit nettement le poids tout en restant confortable à lire et imprimer.</p>
            </div>
          </label>

          <label className="choice-card">
            <input
              type="radio"
              name="compression-level"
              checked={level === 'maximum'}
              onChange={() => {
                setLevel('maximum');
                setResult(null);
              }}
            />
            <div>
              <strong>Maximale (fichier très léger)</strong>
              <p>Pratique pour les pièces jointes ou formulaires administratifs limités en taille.</p>
            </div>
          </label>
        </div>

        {progress !== null && (
          <p className="inspector-hint">Compression locale en cours… {progress} %</p>
        )}

        {error && <p className="inline-error">{error}</p>}

        {result && (
          <div className="compression-result-box" role="status">
            <span>
              Nouveau poids : <strong>{formatFileSize(result.compressedSize)}</strong>
              {savingsPct > 0
                ? ` (gain de ${savingsPct} %)`
                : ' (ce document était déjà très compact)'}
            </span>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          {!result ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={progress !== null}
              onClick={() => void runCompression()}
            >
              <FileDown size={16} aria-hidden="true" />
              <span>Compresser maintenant</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await onApplyCompressedBytes(result.bytes);
                  onClose();
                }}
              >
                <Check size={16} aria-hidden="true" />
                <span>Appliquer à l’onglet</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={downloadCompressed}
              >
                <Download size={16} aria-hidden="true" />
                <span>Télécharger le PDF allégé</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
