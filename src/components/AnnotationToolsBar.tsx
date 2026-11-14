// Barre secondaire intuitive pour annoter, remplir librement, signer et caviarder un document PDF
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bold,
  Calendar,
  Check,
  Circle,
  Eraser,
  Highlighter,
  Italic,
  Minus,
  PenTool,
  Pencil,
  ShieldAlert,
  Square,
  Stamp,
  StickyNote,
  Strikethrough,
  Type,
  Underline,
  X,
} from 'lucide-react';
import type { EditorToolMode } from '../types/pdf';
import { CURATED_FONT_FAMILIES } from '../utils/backgroundPreserver';
import { loadInstalledSystemFonts } from '../utils/desktopBridge';

type InstalledSystemFont = Awaited<ReturnType<typeof loadInstalledSystemFonts>>[number];
import {
  extractPrimaryFontName,
  findMatchingFontOptionValue,
  formatCssFontStack,
} from '../utils/fontRecognizer';

export interface AnnotationFontStylePatch {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
}

interface AnnotationToolsBarProps {
  toolMode: EditorToolMode;
  activeColor: string;
  activeStrokeWidth: number;
  activeStampText: string;
  showTextFontOptions?: boolean;
  activeFontFamily?: string;
  activeFontSize?: number;
  activeBold?: boolean;
  activeItalic?: boolean;
  onSelectTool: (mode: EditorToolMode) => void;
  onChangeColor: (color: string) => void;
  onChangeStrokeWidth: (w: number) => void;
  onChangeStampText: (text: string) => void;
  onChangeFontStyle?: (patch: AnnotationFontStylePatch) => void;
  onOpenSignatureModal: () => void;
  onCloseBar: () => void;
}

const TOOL_COLORS = [
  { color: '#fde047', label: 'Jaune' },
  { color: '#2563eb', label: 'Bleu' },
  { color: '#dc2626', label: 'Rouge' },
  { color: '#16a34a', label: 'Vert' },
  { color: '#111827', label: 'Noir' },
];

const STAMP_OPTIONS = ['APPROUVÉ', 'CONFIDENTIEL', 'PAYÉ', 'URGENT', 'BROUILLON', 'À REVOIR'];

export function AnnotationToolsBar({
  toolMode,
  activeColor,
  activeStrokeWidth,
  activeStampText,
  showTextFontOptions = false,
  activeFontFamily = 'Arial, Helvetica, sans-serif',
  activeFontSize = 13,
  activeBold = false,
  activeItalic = false,
  onSelectTool,
  onChangeColor,
  onChangeStrokeWidth,
  onChangeStampText,
  onChangeFontStyle,
  onOpenSignatureModal,
  onCloseBar,
}: AnnotationToolsBarProps) {
  const [installedFonts, setInstalledFonts] = useState<InstalledSystemFont[]>([]);

  useEffect(() => {
    let active = true;
    void loadInstalledSystemFonts().then((fonts) => {
      if (active) {
        setInstalledFonts(fonts);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const installedFontOptions = useMemo(
    () =>
      installedFonts.map((f) => ({
        label: f.family,
        value: formatCssFontStack(f.family, f.category),
      })),
    [installedFonts],
  );

  const selectedFontSelectValue = useMemo(() => {
    const allValues = [
      ...CURATED_FONT_FAMILIES.map((c) => c.value),
      ...installedFontOptions.map((o) => o.value),
    ];
    return findMatchingFontOptionValue(activeFontFamily, allValues);
  }, [activeFontFamily, installedFontOptions]);

  const hasExactSelectOption = useMemo(
    () =>
      CURATED_FONT_FAMILIES.some((c) => c.value === selectedFontSelectValue) ||
      installedFontOptions.some((o) => o.value === selectedFontSelectValue),
    [installedFontOptions, selectedFontSelectValue],
  );

  return (
    <div className="annotation-tools-bar" role="region" aria-label="Outils d'annotation et de signature">
      <div className="annot-tools-group">
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-highlight' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-highlight')}
        >
          <Highlighter size={14} aria-hidden="true" />
          <span>Surligner</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-underline' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-underline')}
        >
          <Underline size={14} aria-hidden="true" />
          <span>Souligner</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-strike' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-strike')}
        >
          <Strikethrough size={14} aria-hidden="true" />
          <span>Barrer</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-rect' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-rect')}
        >
          <Square size={14} aria-hidden="true" />
          <span>Rectangle</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-ellipse' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-ellipse')}
        >
          <Circle size={14} aria-hidden="true" />
          <span>Ellipse</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-arrow' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-arrow')}
        >
          <ArrowUpRight size={14} aria-hidden="true" />
          <span>Flèche</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-line' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-line')}
        >
          <Minus size={14} aria-hidden="true" />
          <span>Ligne</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-draw' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-draw')}
        >
          <Pencil size={14} aria-hidden="true" />
          <span>Dessiner</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-note' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-note')}
        >
          <StickyNote size={14} aria-hidden="true" />
          <span>Note</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'annotate-stamp' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('annotate-stamp')}
        >
          <Stamp size={14} aria-hidden="true" />
          <span>Tampon</span>
        </button>
      </div>

      <div className="annot-tools-group">
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'fill-free-text' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('fill-free-text')}
        >
          <Type size={14} aria-hidden="true" />
          <span>Texte libre</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'fill-cross' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('fill-cross')}
        >
          <X size={14} aria-hidden="true" />
          <span>Croix</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'fill-check' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('fill-check')}
        >
          <Check size={14} aria-hidden="true" />
          <span>Coche</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'fill-date' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('fill-date')}
        >
          <Calendar size={14} aria-hidden="true" />
          <span>Date</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${toolMode === 'sign' ? 'is-active' : ''}`}
          onClick={onOpenSignatureModal}
        >
          <PenTool size={14} aria-hidden="true" />
          <span>Signer</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm btn-redact-tool ${toolMode === 'redact' ? 'is-active' : ''}`}
          onClick={() => onSelectTool('redact')}
          title="Supprime définitivement les textes ou images masqués lors de l'enregistrement"
        >
          <ShieldAlert size={14} aria-hidden="true" />
          <span>Caviarder</span>
        </button>
      </div>

      <div className="annot-tools-options">
        <div className="color-swatches-row" role="group" aria-label="Couleur de l'outil">
          {TOOL_COLORS.map((c) => (
            <button
              key={c.color}
              type="button"
              aria-label={`Couleur ${c.label}`}
              className={`color-dot ${activeColor === c.color ? 'is-active' : ''}`}
              style={{ backgroundColor: c.color }}
              onClick={() => onChangeColor(c.color)}
            />
          ))}
        </div>

        {showTextFontOptions && onChangeFontStyle ? (
          <>
            <label className="inline-select-label">
              <span>Police</span>
              <select
                id="annot-font-select"
                aria-label="Police du texte libre ou de la date"
                className="annot-font-select"
                value={selectedFontSelectValue}
                onChange={(e) => onChangeFontStyle({ fontFamily: e.target.value })}
              >
                {!hasExactSelectOption && (
                  <option value={selectedFontSelectValue}>
                    {extractPrimaryFontName(selectedFontSelectValue)}
                  </option>
                )}
                <optgroup label="Polices courantes">
                  {CURATED_FONT_FAMILIES.map((f) => (
                    <option key={f.label} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
                {installedFontOptions.length > 0 && (
                  <optgroup label={`Polices installées (${installedFontOptions.length})`}>
                    {installedFontOptions.map((f) => (
                      <option key={f.label} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            <label className="inline-select-label">
              <span>Taille</span>
              <input
                id="annot-fontsize-input"
                type="number"
                min={7}
                max={72}
                step={1}
                aria-label="Taille de police de l'annotation"
                className="annot-fontsize-input"
                value={Math.round(activeFontSize)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next >= 7 && next <= 72) {
                    onChangeFontStyle({ fontSize: next });
                  }
                }}
              />
            </label>

            <button
              type="button"
              className={`btn btn-sm ${activeBold ? 'is-active' : ''}`}
              aria-label="Gras de l'annotation"
              aria-pressed={activeBold}
              title="Gras"
              onClick={() => onChangeFontStyle({ bold: !activeBold })}
            >
              <Bold size={14} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`btn btn-sm ${activeItalic ? 'is-active' : ''}`}
              aria-label="Italique de l'annotation"
              aria-pressed={activeItalic}
              title="Italique"
              onClick={() => onChangeFontStyle({ italic: !activeItalic })}
            >
              <Italic size={14} aria-hidden="true" />
            </button>
          </>
        ) : (
          <label className="inline-select-label">
            <span>Épaisseur</span>
            <select
              aria-label="Épaisseur du tracé"
              value={activeStrokeWidth}
              onChange={(e) => onChangeStrokeWidth(Number(e.target.value))}
            >
              <option value={2}>Fin</option>
              <option value={3}>Moyen</option>
              <option value={6}>Épais</option>
            </select>
          </label>
        )}

        {toolMode === 'annotate-stamp' && (
          <label className="inline-select-label">
            <span>Tampon</span>
            <select
              aria-label="Choix du tampon"
              value={activeStampText}
              onChange={(e) => onChangeStampText(e.target.value)}
            >
              {STAMP_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className="btn btn-sm"
          onClick={onCloseBar}
          title="Revenir au mode lecture simple"
        >
          <Eraser size={14} aria-hidden="true" />
          <span>Terminer</span>
        </button>
      </div>
    </div>
  );
}
