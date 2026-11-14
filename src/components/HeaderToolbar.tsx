// Barre d'outils principale : ouverture, navigation, zoom, texte, images, annotations, OCR, pages, compression, impression, partage et thème
import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Moon,
  MoveHorizontal,
  PanelLeft,
  Printer,
  Redo2,
  Save,
  SaveAll,
  ScanLine,
  ScanText,
  Search,
  Settings,
  Share2,
  Sun,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { EditorToolMode, FitMode, TabDocument, ThemeMode } from '../types/pdf';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from '../utils/formatters';

interface HeaderToolbarProps {
  activeTab: TabDocument | null;
  theme: ThemeMode;
  showThumbnails: boolean;
  toolMode: EditorToolMode;
  annotationBarOpen: boolean;
  searchOpen: boolean;
  isOcrRunning: boolean;
  canInstallPwa: boolean;
  isDesktop?: boolean;
  isAndroid?: boolean;
  onOpenFileClick: () => void;
  onOpenScanner: () => void;
  onToggleThumbnails: () => void;
  onToggleTextSelectMode: () => void;
  onToggleImageSelectMode: () => void;
  onToggleAnnotationBar: () => void;
  onToggleSearch: () => void;
  onRunOcrCurrentPage: () => void;
  onOpenPageManager: () => void;
  onOpenCompress: () => void;
  onOpenPrint: () => void;
  onSharePdf: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSaveCopy: () => void;
  onSaveAs?: () => void;
  onJumpToPage: (page: number) => void;
  onChangeZoom: (zoom: number, fitMode?: FitMode) => void;
  onToggleTheme: () => void;
  onInstallPwa: () => void;
  onOpenDesktopSettings?: () => void;
  onOpenAndroidSettings?: () => void;
}

export function HeaderToolbar({
  activeTab,
  theme,
  showThumbnails,
  toolMode,
  annotationBarOpen,
  searchOpen,
  isOcrRunning,
  canInstallPwa,
  isDesktop = false,
  isAndroid = false,
  onOpenFileClick,
  onOpenScanner,
  onToggleThumbnails,
  onToggleTextSelectMode,
  onToggleImageSelectMode,
  onToggleAnnotationBar,
  onToggleSearch,
  onRunOcrCurrentPage,
  onOpenPageManager,
  onOpenCompress,
  onOpenPrint,
  onSharePdf,
  onUndo,
  onRedo,
  onSaveCopy,
  onSaveAs,
  onJumpToPage,
  onChangeZoom,
  onToggleTheme,
  onInstallPwa,
  onOpenDesktopSettings,
  onOpenAndroidSettings,
}: HeaderToolbarProps) {
  const [pageInput, setPageInput] = useState(
    activeTab ? String(activeTab.currentPage) : '1',
  );

  useEffect(() => {
    if (activeTab) {
      setPageInput(String(activeTab.currentPage));
    }
  }, [activeTab?.id, activeTab?.currentPage]);

  const submitPageInput = () => {
    if (!activeTab) {
      return;
    }
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput(String(activeTab.currentPage));
      return;
    }
    const clamped = Math.max(1, Math.min(activeTab.numPages, parsed));
    setPageInput(String(clamped));
    onJumpToPage(clamped);
  };

  return (
    <header className="toolbar no-print">
      <div className="toolbar-group toolbar-primary">
        <span className="toolbar-brand" aria-label="Basic PDF">
          <FileText size={20} color="var(--accent)" aria-hidden="true" />
          <span>Basic PDF</span>
        </span>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onOpenFileClick}
          title="Ouvrir un fichier PDF depuis votre appareil"
        >
          <FolderOpen size={17} aria-hidden="true" />
          <span>Ouvrir</span>
        </button>

        <button
          type="button"
          className="btn"
          onClick={onOpenScanner}
          aria-label="Scanner un document"
          title="Scanner une ou plusieurs feuilles avec l’appareil photo ou une image"
          data-testid="toolbar-btn-scanner"
        >
          <ScanLine size={17} aria-hidden="true" />
          <span>Scanner</span>
        </button>

        {activeTab && (
          <button
            type="button"
            className={`btn ${showThumbnails ? 'is-active' : ''}`}
            onClick={onToggleThumbnails}
            aria-label="Miniatures"
            aria-pressed={showThumbnails}
            title="Afficher ou masquer les miniatures des pages"
          >
            <PanelLeft size={17} aria-hidden="true" />
            <span className="btn-label-desktop">Miniatures</span>
          </button>
        )}
      </div>

      {activeTab && (
        <div className="toolbar-group toolbar-document-controls">
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onJumpToPage(Math.max(1, activeTab.currentPage - 1))}
            disabled={activeTab.currentPage <= 1}
            aria-label="Page précédente"
            title="Page précédente"
          >
            <ChevronUp size={18} aria-hidden="true" />
          </button>

          <form
            className="page-jump-box"
            onSubmit={(e) => {
              e.preventDefault();
              submitPageInput();
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              className="page-jump-input"
              aria-label="Numéro de page"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={submitPageInput}
            />
            <span>/ {activeTab.numPages}</span>
          </form>

          <button
            type="button"
            className="btn btn-icon"
            onClick={() =>
              onJumpToPage(Math.min(activeTab.numPages, activeTab.currentPage + 1))
            }
            disabled={activeTab.currentPage >= activeTab.numPages}
            aria-label="Page suivante"
            title="Page suivante"
          >
            <ChevronDown size={18} aria-hidden="true" />
          </button>

          <div className="toolbar-divider" aria-hidden="true" />

          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onChangeZoom(activeTab.zoom - ZOOM_STEP, 'custom')}
            disabled={activeTab.zoom <= MIN_ZOOM}
            aria-label="Réduire le zoom"
            title="Zoom arrière"
          >
            <ZoomOut size={17} aria-hidden="true" />
          </button>

          <span className="zoom-readout" aria-live="polite">
            {Math.round(activeTab.zoom * 100)} %
          </span>

          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onChangeZoom(activeTab.zoom + ZOOM_STEP, 'custom')}
            disabled={activeTab.zoom >= MAX_ZOOM}
            aria-label="Augmenter le zoom"
            title="Zoom avant"
          >
            <ZoomIn size={17} aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`btn ${activeTab.fitMode === 'page-width' ? 'is-active' : ''}`}
            onClick={() => onChangeZoom(activeTab.zoom, 'page-width')}
            aria-label="Ajuster à la largeur"
            title="Ajuster la page à la largeur de l'écran"
          >
            <MoveHorizontal size={17} aria-hidden="true" />
            <span className="btn-label-desktop">Largeur</span>
          </button>

          <button
            type="button"
            className={`btn ${activeTab.fitMode === 'page-fit' ? 'is-active' : ''}`}
            onClick={() => onChangeZoom(activeTab.zoom, 'page-fit')}
            aria-label="Afficher la page entière"
            title="Afficher la page entière à l'écran"
          >
            <Maximize2 size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Page entière</span>
          </button>

          <div className="toolbar-divider" aria-hidden="true" />

          <button
            type="button"
            className={`btn ${toolMode === 'select-text' ? 'is-active' : ''}`}
            onClick={onToggleTextSelectMode}
            aria-label="Modifier le texte"
            aria-pressed={toolMode === 'select-text'}
            title="Mode Sélection de texte : survoler et cliquer un texte pour le corriger"
          >
            <Type size={16} aria-hidden="true" />
            <span>Modifier le texte</span>
          </button>

          <button
            type="button"
            className={`btn ${toolMode === 'select-image' ? 'is-active' : ''}`}
            onClick={onToggleImageSelectMode}
            aria-label="Modifier les images"
            aria-pressed={toolMode === 'select-image'}
            title="Mode Images : déplacer, pivoter, remplacer ou supprimer photos et logos"
          >
            <ImageIcon size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Images</span>
          </button>

          <button
            type="button"
            className={`btn ${annotationBarOpen ? 'is-active' : ''}`}
            onClick={onToggleAnnotationBar}
            aria-label="Annoter, remplir et signer"
            aria-pressed={annotationBarOpen}
            title="Surligner, remplir, signer, ajouter des formes ou caviarder"
          >
            <Highlighter size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Annoter</span>
          </button>

          <button
            type="button"
            className={`btn ${searchOpen ? 'is-active' : ''}`}
            onClick={onToggleSearch}
            aria-label="Rechercher"
            aria-pressed={searchOpen}
            title="Rechercher et remplacer dans le PDF (Ctrl+F)"
          >
            <Search size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Rechercher</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={onRunOcrCurrentPage}
            disabled={isOcrRunning}
            aria-label="Lire (OCR)"
            title="Lire automatiquement le texte d'une page scannée ou image (100 % hors ligne)"
          >
            <ScanText size={16} aria-hidden="true" />
            <span className="btn-label-desktop">
              {isOcrRunning ? 'Lecture…' : 'Lire (OCR)'}
            </span>
          </button>

          <div className="toolbar-divider" aria-hidden="true" />

          <button
            type="button"
            className="btn"
            onClick={onOpenPageManager}
            aria-label="Organiser les pages et exporter"
            title="Ajouter, pivoter, supprimer, fusionner, extraire, diviser ou exporter JPG/PNG"
          >
            <Layers size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Pages</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={onOpenCompress}
            aria-label="Compresser le PDF"
            title="Alléger la taille du fichier PDF"
          >
            <FileDown size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Compresser</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={onOpenPrint}
            aria-label="Aperçu et impression"
            title="Imprimer avec aperçu complet, livret et plusieurs pages par feuille"
          >
            <Printer size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Imprimer</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={onSharePdf}
            aria-label="Partager le PDF"
            title="Partager par messagerie ou enregistrer pour joindre à un e-mail"
          >
            <Share2 size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Partager</span>
          </button>

          <div className="toolbar-divider" aria-hidden="true" />

          <button
            type="button"
            className="btn btn-icon"
            onClick={onUndo}
            disabled={activeTab.undoStack.length === 0}
            aria-label="Annuler"
            title="Annuler la dernière modification (Ctrl+Z)"
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="btn btn-icon"
            onClick={onRedo}
            disabled={activeTab.redoStack.length === 0}
            aria-label="Rétablir"
            title="Rétablir la modification annulée (Ctrl+Y)"
          >
            <Redo2 size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="btn"
            onClick={onSaveCopy}
            aria-label="Enregistrer"
            title={
              isDesktop
                ? 'Enregistrer le PDF sur votre ordinateur (Ctrl+S)'
                : 'Télécharger le PDF avec toutes vos modifications'
            }
          >
            <Save size={16} aria-hidden="true" />
            <span className="btn-label-desktop">Enregistrer</span>
          </button>

          {(isDesktop || isAndroid) && onSaveAs && (
            <button
              type="button"
              className="btn"
              onClick={onSaveAs}
              aria-label="Enregistrer sous"
              title="Enregistrer une copie sous un autre nom ou dossier"
            >
              <SaveAll size={16} aria-hidden="true" />
              <span className="btn-label-desktop">Enregistrer sous</span>
            </button>
          )}
        </div>
      )}

      <div className="toolbar-group toolbar-actions">
        {isDesktop && onOpenDesktopSettings && (
          <button
            type="button"
            className="btn"
            onClick={onOpenDesktopSettings}
            aria-label="Paramètres Windows et mises à jour"
            title="Lecteur PDF par défaut, polices installées et mises à jour facultatives"
          >
            <Settings size={17} aria-hidden="true" />
            <span className="btn-label-desktop">Paramètres</span>
          </button>
        )}

        {isAndroid && onOpenAndroidSettings && (
          <button
            type="button"
            className="btn"
            onClick={onOpenAndroidSettings}
            aria-label="Paramètres Android et mises à jour"
            title="Lecteur PDF par défaut et mises à jour facultatives"
          >
            <Settings size={17} aria-hidden="true" />
            <span className="btn-label-desktop">Paramètres</span>
          </button>
        )}

        {canInstallPwa && (
          <button
            type="button"
            className="btn"
            onClick={onInstallPwa}
            aria-label="Installer l’application"
            title="Installer Basic PDF sur cet appareil pour l'utiliser comme une application"
          >
            <Download size={17} aria-hidden="true" />
            <span className="btn-label-desktop">Installer</span>
          </button>
        )}

        <button
          type="button"
          className="btn"
          onClick={onToggleTheme}
          aria-label={
            theme === 'light'
              ? 'Passer au thème sombre'
              : 'Passer au thème clair'
          }
          title={
            theme === 'light'
              ? 'Passer au thème sombre'
              : 'Passer au thème clair'
          }
        >
          {theme === 'light' ? (
            <Moon size={17} aria-hidden="true" />
          ) : (
            <Sun size={17} aria-hidden="true" />
          )}
          <span className="btn-label-desktop">
            {theme === 'light' ? 'Sombre' : 'Clair'}
          </span>
        </button>
      </div>
    </header>
  );
}
