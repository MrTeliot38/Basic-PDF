// Types principaux pour Basic PDF : documents, onglets, texte, OCR, images, formulaires, annotations et pages

/** Thème d'affichage choisi par l'utilisateur */
export type ThemeMode = 'light' | 'dark';

/** Mode d'ajustement automatique du zoom */
export type FitMode = 'custom' | 'page-width' | 'page-fit';

/** Outil actif dans le lecteur/éditeur */
export type EditorToolMode =
  | 'view'
  | 'select-text'
  | 'select-image'
  | 'fill-free-text'
  | 'fill-cross'
  | 'fill-check'
  | 'fill-date'
  | 'sign'
  | 'annotate-highlight'
  | 'annotate-underline'
  | 'annotate-strike'
  | 'annotate-rect'
  | 'annotate-ellipse'
  | 'annotate-line'
  | 'annotate-arrow'
  | 'annotate-draw'
  | 'annotate-note'
  | 'annotate-stamp'
  | 'redact';

/** État d'un bloc de texte sur la page */
export type TextBlockStatus = 'original' | 'edited' | 'deleted';

/** État d'une image sur la page */
export type ImageBlockStatus = 'original' | 'modified' | 'deleted';

/** Angle de rotation d'une image ou d'une page */
export type RotationQuarterTurn = 0 | 90 | 180 | 270;

/** Style typographique d'un bloc de texte */
export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

/** Patch d'arrière-plan reconstruit sans l'ancien contenu (en points PDF) */
export interface BackgroundPatch {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bloc de texte éditable (issu d'un PDF natif ou de l'OCR hors ligne) */
export interface EditableTextBlock {
  id: string;
  pageNumber: number;
  source: 'pdf' | 'ocr';
  originalText: string;
  currentText: string;
  status: TextBlockStatus;
  /** Coordonnées d'origine (en points PDF, origine haut-gauche) */
  origX: number;
  origY: number;
  origWidth: number;
  origHeight: number;
  /** Coordonnées courantes (modifiables par déplacement / redimensionnement) */
  x: number;
  y: number;
  width: number;
  height: number;
  style: TextStyle;
  originalStyle: TextStyle;
  /** Libellé informatif de la police détectée automatiquement */
  detectedFontLabel?: string;
  /** Image PNG du fond sans texte (conservant couleur, encadré ou dégradé) */
  backgroundPatch?: BackgroundPatch;
}

/** Image manipulable sur la page (photo, logo, scan ou image ajoutée) */
export interface EditableImageBlock {
  id: string;
  pageNumber: number;
  source: 'pdf' | 'added' | 'copied';
  status: ImageBlockStatus;
  /** Emplacement d'origine sur la page en points PDF */
  origX: number;
  origY: number;
  origWidth: number;
  origHeight: number;
  /** Emplacement et taille courants en points PDF */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation horaire en degrés (0, 90, 180, 270) */
  rotation: RotationQuarterTurn;
  /** Image PNG d'origine extraite */
  origImageDataUrl: string;
  /** Image courante (peut différer après remplacement) */
  imageDataUrl: string;
  /** Patch d'arrière-plan masquant l'ancien emplacement lors d'un déplacement/suppression */
  backgroundPatch?: BackgroundPatch;
}

/** Champ de formulaire AcroForm natif détecté sur une page */
export interface PdfFormField {
  id: string;
  fieldName: string;
  pageNumber: number;
  fieldType: 'text' | 'checkbox' | 'radio' | 'select';
  x: number;
  y: number;
  width: number;
  height: number;
  defaultValue: string | boolean;
  options?: string[];
  radioValue?: string;
  multiline?: boolean;
}

/** Type d'annotation, tampon, remplissage libre, signature ou caviardage */
export type AnnotationKind =
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'draw'
  | 'note'
  | 'stamp'
  | 'signature'
  | 'free-text'
  | 'cross'
  | 'check'
  | 'date'
  | 'redact';

/** Élément d'annotation, remplissage libre, signature ou caviardage sur une page */
export interface PageAnnotation {
  id: string;
  pageNumber: number;
  kind: AnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  opacity?: number;
  /** Points du tracé (dessin libre, ligne ou flèche) en points PDF */
  points?: Array<{ x: number; y: number }>;
  /** Texte associé (note, tampon, texte libre, date) */
  text?: string;
  fontSize?: number;
  /** Signature dessinée ou importée en PNG transparent */
  imageDataUrl?: string;
}

/** Signature mémorisée localement sur l'appareil pour réutilisation */
export interface SavedSignature {
  id: string;
  label: string;
  dataUrl: string;
  createdAt: number;
}

/** Correspondance trouvée lors d'une recherche */
export interface SearchMatch {
  blockId: string;
  pageNumber: number;
  startIndex: number;
  endIndex: number;
}

/** Niveau de compression lors de l'allégement du PDF */
export type CompressionLevel = 'light' | 'balanced' | 'maximum';

/** Options complètes d'aperçu avant impression */
export interface PrintSettings {
  pageScope: 'all' | 'current' | 'custom';
  customRange: string;
  paperSize: 'A4' | 'A5' | 'Letter' | 'A3';
  orientation: 'portrait' | 'landscape';
  pagesPerSheet: 1 | 2 | 4 | 6;
  booklet: boolean;
  marginsMm: 0 | 6 | 12 | 20;
  headerText: string;
  footerText: string;
}

/** Entrée d'historique propre à un onglet pour Annuler / Rétablir fiable */
export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  bytes: Uint8Array;
  textBlocksByPage: Record<number, EditableTextBlock[]>;
  imageBlocksByPage: Record<number, EditableImageBlock[]>;
  annotationsByPage: Record<number, PageAnnotation[]>;
  formValues: Record<string, string | boolean>;
  selectedBlockId: string | null;
  selectedImageId: string | null;
  selectedAnnotationId: string | null;
}

/** Représentation complète d'un document ouvert dans un onglet */
export interface TabDocument {
  id: string;
  fileName: string;
  /** Chemin complet sur disque (Windows) ou URI content:// Android lorsque le PDF est lié à un emplacement */
  filePath?: string;
  /** Indique si l'URI Android associée autorise l'écriture directe sans "Enregistrer sous" */
  androidWritable?: boolean;
  fileSize: number;
  /** Copie intacte du fichier d'origine ouvert par l'utilisateur */
  originalBytes: Uint8Array;
  /** Version courante du document */
  currentBytes: Uint8Array;
  numPages: number;
  currentPage: number;
  /** Facteur de zoom courant (1 = 100 %) */
  zoom: number;
  fitMode: FitMode;
  /** Position verticale mémorisée lors du changement d'onglet */
  scrollTop: number;
  /** Blocs de texte détectés ou modifiés par numéro de page (1..N) */
  textBlocksByPage: Record<number, EditableTextBlock[]>;
  /** Images détectées ou ajoutées par numéro de page (1..N) */
  imageBlocksByPage: Record<number, EditableImageBlock[]>;
  /** Annotations, signatures, remplissage libre et caviardages par page */
  annotationsByPage: Record<number, PageAnnotation[]>;
  /** Champs de formulaire AcroForm natifs détectés par page */
  formFieldsByPage: Record<number, PdfFormField[]>;
  /** Valeurs saisies dans les champs AcroForm (clé = fieldName) */
  formValues: Record<string, string | boolean>;
  /** Pages déjà analysées par OCR hors ligne */
  ocrPages: number[];
  /** Bloc de texte actuellement sélectionné dans cet onglet */
  selectedBlockId: string | null;
  /** Image actuellement sélectionnée dans cet onglet */
  selectedImageId: string | null;
  /** Annotation actuellement sélectionnée dans cet onglet */
  selectedAnnotationId: string | null;
  /** Historique d'annulation indépendant par onglet */
  undoStack: HistoryEntry[];
  /** Historique de rétablissement indépendant par onglet */
  redoStack: HistoryEntry[];
  isDirty: boolean;
  openedAt: number;
}

/** Métadonnées et aperçu local d'un fichier récemment ouvert */
export interface RecentFileRecord {
  id: string;
  fileName: string;
  /** Chemin sur le PC Windows (Electron) permettant de rouvrir même les gros fichiers */
  filePath?: string;
  fileSize: number;
  numPages: number;
  lastOpenedAt: number;
  /** Octets stockés localement dans IndexedDB pour réouverture directe hors ligne */
  bytes?: Uint8Array;
}
