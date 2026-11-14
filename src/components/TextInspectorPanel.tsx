// Panneau de droite : mise en forme du texte sélectionné, suppression et rétablissement du texte d'origine
import { useEffect, useState } from 'react';
import { Bold, Edit3, Italic, RotateCcw, Trash2, Type, X } from 'lucide-react';
import type { EditableTextBlock, TextStyle } from '../types/pdf';
import { CURATED_FONT_FAMILIES } from '../utils/backgroundPreserver';
import { isDesktopApp, loadInstalledSystemFonts } from '../utils/desktopBridge';
import { formatCssFontStack } from '../utils/fontRecognizer';

interface TextInspectorPanelProps {
  selectedBlock: EditableTextBlock | null;
  deletedBlocksOnPage: EditableTextBlock[];
  isOcrPage: boolean;
  onStartInlineEdit: (blockId: string) => void;
  onUpdateTextAndStyle: (
    blockId: string,
    nextText: string,
    nextStyle: TextStyle,
    label: string,
  ) => void;
  onDeleteBlock: (blockId: string) => void;
  onRestoreOriginal: (blockId: string) => void;
  onCloseSelection: () => void;
}

const COLOR_SWATCHES = ['#111827', '#ffffff', '#2563eb', '#dc2626', '#16a34a', '#9333ea'];

export function TextInspectorPanel({
  selectedBlock,
  deletedBlocksOnPage,
  isOcrPage,
  onStartInlineEdit,
  onUpdateTextAndStyle,
  onDeleteBlock,
  onRestoreOriginal,
  onCloseSelection,
}: TextInspectorPanelProps) {
  const [localFonts, setLocalFonts] = useState<string[]>([]);
  const [panelText, setPanelText] = useState('');

  useEffect(() => {
    setPanelText(selectedBlock?.currentText ?? '');
  }, [selectedBlock?.id, selectedBlock?.currentText]);

  // Liste les polices installées (nativement via Windows en version bureau, sinon via navigateur autorisé)
  useEffect(() => {
    if (isDesktopApp()) {
      loadInstalledSystemFonts()
        .then((fonts) => {
          setLocalFonts(fonts.map((f) => f.family));
        })
        .catch(() => undefined);
      return;
    }

    const queryLocalFonts = (
      window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }
    ).queryLocalFonts;
    if (typeof queryLocalFonts !== 'function') {
      return;
    }
    // Vérifie seulement si la permission est déjà accordée afin de ne jamais afficher de popup intempestive
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'local-fonts' as PermissionName })
        .then(async (status) => {
          if (status.state === 'granted') {
            const fonts = await queryLocalFonts();
            const unique = Array.from(new Set(fonts.map((f) => f.family))).slice(0, 30);
            setLocalFonts(unique);
          }
        })
        .catch(() => undefined);
    }
  }, []);

  if (!selectedBlock && deletedBlocksOnPage.length === 0) {
    return (
      <aside className="inspector-panel" aria-label="Panneau de correction de texte">
        <div className="inspector-header">
          <span className="inspector-title">
            <Type size={16} aria-hidden="true" />
            <span>Modification du texte</span>
          </span>
        </div>
        <div className="inspector-empty">
          <p>
            Survolez un texte sur la page puis cliquez dessus pour le sélectionner,
            le corriger, changer sa police ou le déplacer.
          </p>
          {isOcrPage && (
            <p className="inspector-hint">
              Cette page a été lue par reconnaissance de texte (OCR). Les colonnes ont été
              séparées automatiquement.
            </p>
          )}
        </div>
      </aside>
    );
  }

  const isModified =
    selectedBlock &&
    (selectedBlock.status !== 'original' ||
      selectedBlock.currentText !== selectedBlock.originalText ||
      Math.abs(selectedBlock.x - selectedBlock.origX) > 0.5 ||
      Math.abs(selectedBlock.y - selectedBlock.origY) > 0.5);

  const commitPanelText = () => {
    if (!selectedBlock) {
      return;
    }
    if (!panelText.trim()) {
      onDeleteBlock(selectedBlock.id);
      return;
    }
    if (panelText !== selectedBlock.currentText) {
      onUpdateTextAndStyle(
        selectedBlock.id,
        panelText,
        selectedBlock.style,
        'Modifier le texte',
      );
    }
  };

  return (
    <aside className="inspector-panel" aria-label="Panneau de correction de texte">
      <div className="inspector-header">
        <span className="inspector-title">
          <Type size={16} aria-hidden="true" />
          <span>{selectedBlock ? 'Texte sélectionné' : 'Textes supprimés'}</span>
        </span>
        {selectedBlock && (
          <button
            type="button"
            className="tab-close-btn"
            onClick={onCloseSelection}
            aria-label="Désélectionner"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="inspector-body">
        {selectedBlock && (
          <>
            <div className="inspector-badge-row">
              <span className="inspector-badge">
                {selectedBlock.source === 'ocr' ? 'Texte lu (OCR)' : 'Texte du PDF'}
              </span>
              {selectedBlock.detectedFontLabel && (
                <span className="inspector-font-hint" title={selectedBlock.detectedFontLabel}>
                  Police proche : {selectedBlock.detectedFontLabel}
                </span>
              )}
            </div>

            <div className="inspector-field">
              <label htmlFor="inspector-text-input" className="inspector-label">
                Contenu
              </label>
              <textarea
                id="inspector-text-input"
                className="inspector-textarea"
                rows={3}
                value={panelText}
                onChange={(e) => setPanelText(e.target.value)}
                onBlur={commitPanelText}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitPanelText();
                  }
                }}
              />
              <div className="inspector-inline-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => onStartInlineEdit(selectedBlock.id)}
                >
                  <Edit3 size={15} aria-hidden="true" />
                  <span>Éditer sur la page</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={commitPanelText}
                >
                  Appliquer
                </button>
              </div>
            </div>

            <div className="inspector-field">
              <label htmlFor="inspector-font-select" className="inspector-label">
                Police
              </label>
              <select
                id="inspector-font-select"
                className="inspector-select"
                value={selectedBlock.style.fontFamily}
                onChange={(e) =>
                  onUpdateTextAndStyle(
                    selectedBlock.id,
                    selectedBlock.currentText,
                    { ...selectedBlock.style, fontFamily: e.target.value },
                    'Changer la police',
                  )
                }
              >
                <optgroup label="Polices standard du document">
                  {CURATED_FONT_FAMILIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                  {!CURATED_FONT_FAMILIES.some((f) => f.value === selectedBlock.style.fontFamily) &&
                    !localFonts.some(
                      (family) =>
                        formatCssFontStack(family) === selectedBlock.style.fontFamily ||
                        selectedBlock.style.fontFamily
                          .toLowerCase()
                          .includes(`"${family.toLowerCase()}"`),
                    ) && (
                      <option value={selectedBlock.style.fontFamily}>
                        {selectedBlock.style.fontFamily.split(',')[0].replace(/["']/g, '')}
                      </option>
                    )}
                </optgroup>
                {localFonts.length > 0 && (
                  <optgroup label={`Polices installées sur l’ordinateur (${localFonts.length})`}>
                    {localFonts.map((family) => {
                      const matchedCurrent = selectedBlock.style.fontFamily
                        .toLowerCase()
                        .includes(`"${family.toLowerCase()}"`);
                      const optionValue = matchedCurrent
                        ? selectedBlock.style.fontFamily
                        : formatCssFontStack(family);
                      return (
                        <option key={family} value={optionValue}>
                          {family}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="inspector-row-2">
              <div className="inspector-field">
                <label htmlFor="inspector-font-size" className="inspector-label">
                  Taille (pt)
                </label>
                <input
                  id="inspector-font-size"
                  type="number"
                  min={6}
                  max={96}
                  step={0.5}
                  className="inspector-number"
                  value={selectedBlock.style.fontSize}
                  onChange={(e) => {
                    const size = Number.parseFloat(e.target.value);
                    if (Number.isFinite(size) && size >= 6 && size <= 96) {
                      onUpdateTextAndStyle(
                        selectedBlock.id,
                        selectedBlock.currentText,
                        { ...selectedBlock.style, fontSize: size },
                        'Changer la taille',
                      );
                    }
                  }}
                />
              </div>

              <div className="inspector-field">
                <span className="inspector-label">Style</span>
                <div className="inspector-style-toggles">
                  <button
                    type="button"
                    className={`btn btn-icon ${selectedBlock.style.bold ? 'is-active' : ''}`}
                    aria-label="Gras"
                    aria-pressed={selectedBlock.style.bold}
                    onClick={() =>
                      onUpdateTextAndStyle(
                        selectedBlock.id,
                        selectedBlock.currentText,
                        { ...selectedBlock.style, bold: !selectedBlock.style.bold },
                        'Gras',
                      )
                    }
                  >
                    <Bold size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`btn btn-icon ${selectedBlock.style.italic ? 'is-active' : ''}`}
                    aria-label="Italique"
                    aria-pressed={selectedBlock.style.italic}
                    onClick={() =>
                      onUpdateTextAndStyle(
                        selectedBlock.id,
                        selectedBlock.currentText,
                        { ...selectedBlock.style, italic: !selectedBlock.style.italic },
                        'Italique',
                      )
                    }
                  >
                    <Italic size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            <div className="inspector-field">
              <label htmlFor="inspector-color-input" className="inspector-label">
                Couleur du texte
              </label>
              <div className="inspector-color-row">
                <input
                  id="inspector-color-input"
                  type="color"
                  className="inspector-color-picker"
                  value={selectedBlock.style.color}
                  onChange={(e) =>
                    onUpdateTextAndStyle(
                      selectedBlock.id,
                      selectedBlock.currentText,
                      { ...selectedBlock.style, color: e.target.value },
                      'Changer la couleur',
                    )
                  }
                />
                <div className="inspector-swatches">
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className={`color-swatch ${
                        selectedBlock.style.color.toLowerCase() === swatch ? 'is-active' : ''
                      }`}
                      style={{ backgroundColor: swatch }}
                      aria-label={`Couleur ${swatch}`}
                      onClick={() =>
                        onUpdateTextAndStyle(
                          selectedBlock.id,
                          selectedBlock.currentText,
                          { ...selectedBlock.style, color: swatch },
                          'Changer la couleur',
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="inspector-actions-stack">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onDeleteBlock(selectedBlock.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>Supprimer ce texte (Suppr)</span>
              </button>

              {isModified && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => onRestoreOriginal(selectedBlock.id)}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  <span>Rétablir le texte d’origine</span>
                </button>
              )}
            </div>
          </>
        )}

        {deletedBlocksOnPage.length > 0 && (
          <div className="inspector-deleted-section">
            <h3 className="inspector-subheading">
              Textes supprimés sur cette page ({deletedBlocksOnPage.length})
            </h3>
            <p className="inspector-hint">
              Ces textes sont masqués sur le document. Vous pouvez uniquement les faire revenir ici.
            </p>
            <div className="deleted-list">
              {deletedBlocksOnPage.map((deleted) => (
                <div key={deleted.id} className="deleted-item-card">
                  <span className="deleted-item-preview" title={deleted.originalText}>
                    {deleted.originalText}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onRestoreOriginal(deleted.id)}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    <span>Rétablir le texte d’origine</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
