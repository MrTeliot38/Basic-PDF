// Fenêtre modale pour créer, importer et mémoriser sa signature (100 % locale sans réseau)
import { useEffect, useRef, useState } from 'react';
import { Check, Eraser, PenTool, Trash2, Upload, X } from 'lucide-react';
import type { SavedSignature } from '../types/pdf';
import {
  deleteSavedSignature,
  loadSavedSignatures,
  makeSignatureBackgroundTransparent,
  saveNewSignature,
} from '../utils/signatureStorage';

interface SignatureModalProps {
  onSelectSignatureForPlacement: (dataUrl: string) => void;
  onClose: () => void;
}

const PEN_COLORS = [
  { color: '#111827', label: 'Noir' },
  { color: '#1d4ed8', label: 'Bleu encre' },
  { color: '#dc2626', label: 'Rouge' },
];

export function SignatureModal({
  onSelectSignatureForPlacement,
  onClose,
}: SignatureModalProps) {
  const [tab, setTab] = useState<'draw' | 'import'>('draw');
  const [penColor, setPenColor] = useState('#1d4ed8');
  const [remember, setRemember] = useState(true);
  const [hasStroke, setHasStroke] = useState(false);
  const [importedUrl, setImportedUrl] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [savedList, setSavedList] = useState<SavedSignature[]>(() => loadSavedSignatures());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = penColor;
    }
  }, [penColor, tab]);

  const getCanvasPoint = (evt: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * canvas.width,
      y: ((evt.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  };

  /** Rogne l'espace transparent inutile autour de la signature dessinée */
  const exportCroppedPad = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return null;
    const pad = 8;
    const cx = Math.max(0, minX - pad);
    const cy = Math.max(0, minY - pad);
    const cw = Math.min(width - cx, maxX - minX + pad * 2);
    const ch = Math.min(height - cy, maxY - minY + pad * 2);

    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d')?.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
    return out.toDataURL('image/png');
  };

  const handleUseSignature = () => {
    const url = tab === 'draw' ? exportCroppedPad() : importedUrl;
    if (!url) return;
    if (remember) {
      setSavedList(saveNewSignature('Ma signature', url));
    }
    onSelectSignatureForPlacement(url);
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    try {
      const cleanUrl = await makeSignatureBackgroundTransparent(file);
      setImportedUrl(cleanUrl);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Impossible d'importer cette image.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Ajouter une signature"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <PenTool size={18} aria-hidden="true" />
            <span>Signature du document</span>
          </h2>
          <button
            type="button"
            className="tab-close-btn"
            aria-label="Fermer la fenêtre de signature"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'draw'}
            className={`btn ${tab === 'draw' ? 'is-active' : ''}`}
            onClick={() => setTab('draw')}
          >
            <PenTool size={15} aria-hidden="true" />
            <span>Dessiner</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'import'}
            className={`btn ${tab === 'import' ? 'is-active' : ''}`}
            onClick={() => setTab('import')}
          >
            <Upload size={15} aria-hidden="true" />
            <span>Importer une image</span>
          </button>
        </div>

        {tab === 'draw' ? (
          <div className="signature-pad-section">
            <div className="signature-pad-toolbar">
              <div className="color-swatches-row">
                {PEN_COLORS.map((item) => (
                  <button
                    key={item.color}
                    type="button"
                    aria-label={`Encre ${item.label}`}
                    className={`color-dot ${penColor === item.color ? 'is-active' : ''}`}
                    style={{ backgroundColor: item.color }}
                    onClick={() => setPenColor(item.color)}
                  />
                ))}
              </div>
              <button type="button" className="btn" onClick={clearPad}>
                <Eraser size={15} aria-hidden="true" />
                <span>Effacer</span>
              </button>
            </div>

            <canvas
              ref={canvasRef}
              width={460}
              height={160}
              className="signature-canvas"
              aria-label="Zone de dessin de la signature"
              onPointerDown={(e) => {
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;
                canvas.setPointerCapture(e.pointerId);
                drawingRef.current = true;
                const pt = getCanvasPoint(e);
                ctx.strokeStyle = penColor;
                ctx.lineWidth = 3.2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(pt.x, pt.y);
                ctx.lineTo(pt.x + 0.1, pt.y + 0.1);
                ctx.stroke();
                setHasStroke(true);
              }}
              onPointerMove={(e) => {
                if (!drawingRef.current) return;
                const ctx = canvasRef.current?.getContext('2d');
                if (!ctx) return;
                const pt = getCanvasPoint(e);
                ctx.lineTo(pt.x, pt.y);
                ctx.stroke();
              }}
              onPointerUp={() => {
                drawingRef.current = false;
              }}
              onPointerCancel={() => {
                drawingRef.current = false;
              }}
            />
          </div>
        ) : (
          <div className="signature-import-section">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only-input"
              aria-label="Importer une photo de signature"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
              }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} aria-hidden="true" />
              <span>Choisir une image ou photo de signature</span>
            </button>
            {importError && <p className="inline-error">{importError}</p>}
            {importedUrl && (
              <div className="signature-import-preview">
                <img src={importedUrl} alt="Aperçu signature importée" />
              </div>
            )}
          </div>
        )}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Mémoriser cette signature sur cet appareil pour la réutiliser</span>
        </label>

        {savedList.length > 0 && (
          <div className="saved-signatures-section">
            <p className="inspector-subheading">Signatures mémorisées</p>
            <div className="saved-signatures-grid">
              {savedList.map((sig) => (
                <div key={sig.id} className="saved-sig-card">
                  <button
                    type="button"
                    className="saved-sig-pick"
                    aria-label="Réutiliser cette signature"
                    onClick={() => onSelectSignatureForPlacement(sig.dataUrl)}
                  >
                    <img src={sig.dataUrl} alt="Signature enregistrée" />
                  </button>
                  <button
                    type="button"
                    className="saved-sig-del"
                    aria-label="Supprimer cette signature mémorisée"
                    onClick={() => setSavedList(deleteSavedSignature(sig.id))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={tab === 'draw' ? !hasStroke : !importedUrl}
            onClick={handleUseSignature}
          >
            <Check size={16} aria-hidden="true" />
            <span>Placer sur le document</span>
          </button>
        </div>
      </div>
    </div>
  );
}
