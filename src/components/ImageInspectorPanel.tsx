// Panneau de droite pour la gestion d'une image sélectionnée : rotation, remplacement, copie partout, rétablissement et ajout
import { useRef } from 'react';
import {
  Copy,
  Image as ImageIcon,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import type { EditableImageBlock } from '../types/pdf';

interface ImageInspectorPanelProps {
  selectedImage: EditableImageBlock | null;
  deletedImagesOnPage: EditableImageBlock[];
  totalPages: number;
  onRotateQuarterTurn: (imageId: string) => void;
  onReplaceImageFile: (imageId: string, file: File) => void;
  onCopyToAllPages: (imageId: string) => void;
  onRestoreOriginal: (imageId: string) => void;
  onDeleteImage: (imageId: string) => void;
  onAddImageFile: (file: File) => void;
  onCloseSelection: () => void;
}

export function ImageInspectorPanel({
  selectedImage,
  deletedImagesOnPage,
  totalPages,
  onRotateQuarterTurn,
  onReplaceImageFile,
  onCopyToAllPages,
  onRestoreOriginal,
  onDeleteImage,
  onAddImageFile,
  onCloseSelection,
}: ImageInspectorPanelProps) {
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const addInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <aside className="inspector-panel" aria-label="Panneau des images">
      <input
        ref={addInputRef}
        type="file"
        accept="image/*"
        className="sr-only-input"
        aria-label="Choisir une image à insérer"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            onAddImageFile(f);
            e.target.value = '';
          }
        }}
      />

      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="sr-only-input"
        aria-label="Choisir l'image de remplacement"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && selectedImage) {
            onReplaceImageFile(selectedImage.id, f);
            e.target.value = '';
          }
        }}
      />

      <div className="inspector-header">
        <span className="inspector-title">
          <ImageIcon size={16} aria-hidden="true" />
          <span>{selectedImage ? 'Image sélectionnée' : 'Images du document'}</span>
        </span>
        {selectedImage && (
          <button
            type="button"
            className="tab-close-btn"
            onClick={onCloseSelection}
            aria-label="Fermer la sélection d'image"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {!selectedImage ? (
        <div className="inspector-empty">
          <p>
            Survolez une photo ou un logo sur la page puis cliquez dessus pour le sélectionner,
            le déplacer ou le redimensionner par un coin.
          </p>
          <p className="inspector-hint">
            Les images placées en arrière-plan sous du texte ne sont volontairement pas modifiables.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => addInputRef.current?.click()}
          >
            <ImagePlus size={16} aria-hidden="true" />
            <span>Ajouter une image</span>
          </button>
        </div>
      ) : (
        <div className="inspector-body">
          <div className="image-preview-thumb-wrap">
            <img
              src={selectedImage.imageDataUrl}
              alt="Aperçu de l'image sélectionnée"
              className="image-preview-thumb"
              style={{
                transform:
                  selectedImage.rotation !== 0
                    ? `rotate(${selectedImage.rotation}deg)`
                    : undefined,
              }}
            />
          </div>

          <div className="inspector-actions-stack">
            <button
              type="button"
              className="btn"
              onClick={() => onRotateQuarterTurn(selectedImage.id)}
            >
              <RotateCw size={16} aria-hidden="true" />
              <span>Pivoter d’un quart de tour</span>
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => replaceInputRef.current?.click()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <span>Remplacer par une autre image</span>
            </button>

            <button
              type="button"
              className="btn"
              disabled={totalPages < 2}
              onClick={() => onCopyToAllPages(selectedImage.id)}
            >
              <Copy size={16} aria-hidden="true" />
              <span>Copier sur toutes les pages</span>
            </button>

            {(selectedImage.status !== 'original' ||
              selectedImage.rotation !== 0 ||
              Math.abs(selectedImage.x - selectedImage.origX) > 0.5 ||
              Math.abs(selectedImage.y - selectedImage.origY) > 0.5 ||
              Math.abs(selectedImage.width - selectedImage.origWidth) > 0.5 ||
              Math.abs(selectedImage.height - selectedImage.origHeight) > 0.5) && (
              <button
                type="button"
                className="btn"
                onClick={() => onRestoreOriginal(selectedImage.id)}
              >
                <RotateCcw size={16} aria-hidden="true" />
                <span>Remettre à sa place d’origine</span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-danger"
              onClick={() => onDeleteImage(selectedImage.id)}
            >
              <Trash2 size={16} aria-hidden="true" />
              <span>Supprimer cette image (Suppr)</span>
            </button>
          </div>
        </div>
      )}

      {deletedImagesOnPage.length > 0 && (
        <div className="inspector-body inspector-deleted-section">
          <p className="inspector-subheading">Images supprimées sur cette page</p>
          <div className="deleted-list">
            {deletedImagesOnPage.map((img) => (
              <div key={img.id} className="deleted-item-card">
                <button
                  type="button"
                  className="btn"
                  onClick={() => onRestoreOriginal(img.id)}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  <span>Remettre à sa place d’origine</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
