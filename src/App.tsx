// Composant racine de Basic PDF : orchestre onglets, recherche, texte, OCR, images, formulaires, signatures, annotations, pages, compression, impression et partage
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ScanText, X } from 'lucide-react';
import { AnnotationToolsBar } from './components/AnnotationToolsBar';
import { AndroidSettingsModal } from './components/AndroidSettingsModal';
import { CompressModal } from './components/CompressModal';
import { DesktopSettingsModal } from './components/DesktopSettingsModal';
import { DocumentScannerModal } from './components/DocumentScannerModal';
import { HeaderToolbar } from './components/HeaderToolbar';
import { ImageInspectorPanel } from './components/ImageInspectorPanel';
import { PageManagerModal } from './components/PageManagerModal';
import { PdfViewer, type ScrollRequest } from './components/PdfViewer';
import { PrintModal } from './components/PrintModal';
import { SearchBar } from './components/SearchBar';
import { SidebarThumbnails } from './components/SidebarThumbnails';
import { SignatureModal } from './components/SignatureModal';
import { TabBar } from './components/TabBar';
import { TextInspectorPanel } from './components/TextInspectorPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import { WindowsShareModal } from './components/WindowsShareModal';
import { useTabs } from './hooks/useTabs';
import { useTheme } from './hooks/useTheme';
import type {
  BackgroundPatch,
  EditableImageBlock,
  EditableTextBlock,
  EditorToolMode,
  PageAnnotation,
  RecentFileRecord,
  RotationQuarterTurn,
  SearchMatch,
  TabDocument,
  TextStyle,
} from './types/pdf';
import {
  getAndroidPendingPdfs,
  initAndroidSystemInsetsListener,
  isAndroidNativeApp,
  savePdfAndroidAs,
  savePdfAndroidDirect,
  sharePdfAndroidNative,
  subscribeAndroidIncomingPdfs,
} from './utils/androidBridge';
import { getDesktopBridge, isDesktopApp } from './utils/desktopBridge';
import { ZOOM_STEP } from './utils/formatters';
import { runOfflineOcrOnPage } from './utils/ocrEngine';
import { readImageFileAsPngDataUrl } from './utils/pdfImageExtractor';
import { formatPdfError, readPdfFile } from './utils/pdfLoader';
import type { PageMutationOutput } from './utils/pdfPagesOperations';
import { serializeDocumentEditsToPdf } from './utils/pdfSerializer';
import { extractNativeTextBlocks } from './utils/pdfTextExtractor';
import {
  clearRecentFiles,
  getRecentFiles,
  removeRecentFile,
  saveRecentFile,
} from './utils/recentFilesStorage';
import { buildSamplePdfBytes } from './utils/samplePdf';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface ToastState {
  message: string;
  isError: boolean;
}

type PatchTarget = {
  kind: 'text' | 'image';
  origX: number;
  origY: number;
  origWidth: number;
  origHeight: number;
  backgroundPatch?: BackgroundPatch;
};

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFileRecord[]>([]);
  const [showThumbnails, setShowThumbnails] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 768 : true,
  );
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const [isGlobalDragOver, setIsGlobalDragOver] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );

  // États d'édition texte, images, recherche, OCR et annotations
  const [toolMode, setToolMode] = useState<EditorToolMode>('view');
  const [annotationBarOpen, setAnnotationBarOpen] = useState(false);
  const [activeToolColor, setActiveToolColor] = useState('#2563eb');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState(3);
  const [activeStampText, setActiveStampText] = useState('APPROUVÉ');
  const [pendingSignatureUrl, setPendingSignatureUrl] = useState<string | null>(null);

  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchShowReplace, setSearchShowReplace] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [dismissedScanPromptKeys, setDismissedScanPromptKeys] = useState<Set<string>>(
    () => new Set(),
  );

  // États des fenêtres modales (A4, A5, Phase B Windows & Phase C Android)
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [pageManagerOpen, setPageManagerOpen] = useState(false);
  const [compressModalOpen, setCompressModalOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [androidSettingsOpen, setAndroidSettingsOpen] = useState(false);
  const [scannerModalOpen, setScannerModalOpen] = useState(false);
  const [windowsShareTarget, setWindowsShareTarget] = useState<{
    fileName: string;
    filePath: string;
    bytes: Uint8Array;
  } | null>(null);
  const runningOnDesktop = isDesktopApp();
  const runningOnAndroid = isAndroidNativeApp();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);
  const backgroundPatchHelperRef = useRef<
    ((pageNumber: number, target: PatchTarget) => Promise<BackgroundPatch | undefined>) | null
  >(null);

  const showError = useCallback((message: string) => {
    setToast({ message, isError: true });
  }, []);

  const showInfo = useCallback((message: string) => {
    setToast({ message, isError: false });
  }, []);

  // Ferme automatiquement les messages d'information pour ne jamais masquer ou bloquer les boutons sur mobile
  useEffect(() => {
    if (!toast || toast.isError) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const {
    tabs,
    activeTabId,
    activeTab,
    activePdfProxy,
    isLoading,
    openPdfFromBytes,
    markTabSaved,
    selectTab,
    closeTab,
    cycleTab,
    updateTabZoom,
    updateTabPage,
    updateTabScrollTop,
    initializePageBlocks,
    selectTextBlock,
    commitBlockUpdate,
    deleteTextBlock,
    restoreOriginalTextBlock,
    commitBatchBlocksUpdate,
    initializePageImages,
    selectImageBlock,
    commitImageUpdate,
    deleteImageBlock,
    restoreOriginalImageBlock,
    copyImageToAllPages,
    addNewImageToPage,
    initializePageFormFields,
    updateFormValue,
    selectAnnotation,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    commitDocumentBytesChange,
    undoTab,
    redoTab,
  } = useTabs(showError);

  const refreshRecentFiles = useCallback(async () => {
    const items = await getRecentFiles();
    setRecentFiles(items);
  }, []);

  useEffect(() => {
    void refreshRecentFiles();
  }, [refreshRecentFiles]);

  // Sous Windows (Electron), ouvre automatiquement les PDF lancés par double-clic depuis l'Explorateur
  useEffect(() => {
    const desktop = getDesktopBridge();
    if (!desktop) {
      return;
    }

    const openIncomingList = async (files: Array<{ filePath: string; fileName: string; bytes: Uint8Array }>) => {
      if (files.length === 0) return;
      for (const file of files) {
        const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
        await openPdfFromBytes(file.fileName, bytes, file.filePath);
      }
      await refreshRecentFiles();
    };

    void desktop.getPendingOpenFiles().then(openIncomingList).catch(() => undefined);
    const unsubscribe = desktop.onOpenFiles((files) => {
      void openIncomingList(files);
    });
    return () => unsubscribe();
  }, [openPdfFromBytes, refreshRecentFiles]);

  // Sous Android, récupère les PDF ouverts depuis une autre appli (WhatsApp, Gmail, Mes fichiers)
  useEffect(() => {
    if (!runningOnAndroid) {
      return;
    }

    const openIncomingAndroid = async (
      files: Array<{ uri: string; fileName: string; writable: boolean; bytes: Uint8Array }>,
    ) => {
      if (files.length === 0) return;
      for (const file of files) {
        await openPdfFromBytes(file.fileName, file.bytes, file.uri, {
          androidWritable: file.writable,
        });
      }
      await refreshRecentFiles();
    };

    void getAndroidPendingPdfs().then(openIncomingAndroid).catch(() => undefined);
    const unsubscribe = subscribeAndroidIncomingPdfs((files) => {
      void openIncomingAndroid(files);
    });
    return () => unsubscribe();
  }, [openPdfFromBytes, refreshRecentFiles, runningOnAndroid]);

  // Protège l'interface contre la barre d'état Android et garde la zone saisie au-dessus du clavier virtuel
  useEffect(() => {
    const cleanupAndroidInsets = initAndroidSystemInsetsListener();

    const syncVisualKeyboard = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty(
        '--visual-ime-bottom',
        keyboardHeight > 80 ? `${Math.round(keyboardHeight)}px` : '0px',
      );
      if (keyboardHeight > 80) {
        const activeEl = document.activeElement;
        if (
          activeEl instanceof HTMLElement &&
          (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') &&
          activeEl.closest('.app-shell')
        ) {
          requestAnimationFrame(() => {
            activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
          });
        }
      }
    };

    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncVisualKeyboard);
    vv?.addEventListener('scroll', syncVisualKeyboard);

    return () => {
      cleanupAndroidInsets();
      vv?.removeEventListener('resize', syncVisualKeyboard);
      vv?.removeEventListener('scroll', syncVisualKeyboard);
    };
  }, []);

  // Ferme l'édition inline lorsqu'on change d'onglet
  useEffect(() => {
    setEditingBlockId(null);
  }, [activeTabId]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (!installPrompt) {
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handleFilesSelected = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) {
        return;
      }
      for (const file of Array.from(fileList)) {
        try {
          const bytes = await readPdfFile(file);
          await openPdfFromBytes(file.name, bytes);
          await refreshRecentFiles();
        } catch (err) {
          showError(formatPdfError(err));
        }
      }
    },
    [openPdfFromBytes, refreshRecentFiles, showError],
  );

  const handleOpenFileAction = useCallback(async () => {
    const desktop = getDesktopBridge();
    if (!desktop) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const opened = await desktop.openPdfDialog();
      for (const file of opened) {
        const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
        await openPdfFromBytes(file.fileName, bytes, file.filePath);
      }
      if (opened.length > 0) {
        await refreshRecentFiles();
      }
    } catch (err) {
      showError(formatPdfError(err));
    }
  }, [openPdfFromBytes, refreshRecentFiles, showError]);

  const handleOpenSamplePdf = async () => {
    const bytes = buildSamplePdfBytes('Basic PDF - Document de demonstration', 4);
    await openPdfFromBytes('Exemple-Basic-PDF.pdf', bytes);
    await refreshRecentFiles();
  };

  const handleOpenRecentFile = async (record: RecentFileRecord) => {
    const desktop = getDesktopBridge();
    if (!record.bytes) {
      if (desktop && record.filePath) {
        const reopened = await desktop.openPdfAtPath(record.filePath);
        if (reopened) {
          const bytes =
            reopened.bytes instanceof Uint8Array ? reopened.bytes : new Uint8Array(reopened.bytes);
          await openPdfFromBytes(reopened.fileName, bytes, reopened.filePath);
          await refreshRecentFiles();
          return;
        }
      }
      showInfo(
        `« ${record.fileName} » n’a pas pu être rouvert directement. Veuillez le sélectionner à nouveau depuis votre appareil.`,
      );
      void handleOpenFileAction();
      return;
    }
    await openPdfFromBytes(record.fileName, record.bytes, record.filePath);
    await refreshRecentFiles();
  };

  const handleRemoveRecentFile = async (id: string) => {
    await removeRecentFile(id);
    await refreshRecentFiles();
  };

  const handleClearRecentFiles = async () => {
    await clearRecentFiles();
    await refreshRecentFiles();
  };

  const handleJumpToPage = useCallback(
    (page: number) => {
      if (!activeTab) {
        return;
      }
      const clamped = Math.max(1, Math.min(activeTab.numPages, page));
      updateTabPage(activeTab.id, clamped);
      setScrollRequest({ page: clamped, nonce: Date.now() + Math.random() });
    },
    [activeTab, updateTabPage],
  );

  const requestTextPatch = useCallback(async (block: EditableTextBlock) => {
    if (block.backgroundPatch || !backgroundPatchHelperRef.current) {
      return block.backgroundPatch;
    }
    return backgroundPatchHelperRef.current(block.pageNumber, {
      kind: 'text',
      origX: block.origX,
      origY: block.origY,
      origWidth: block.origWidth,
      origHeight: block.origHeight,
      backgroundPatch: block.backgroundPatch,
    });
  }, []);

  const requestImagePatch = useCallback(async (img: EditableImageBlock) => {
    if (img.source !== 'pdf' || img.backgroundPatch || !backgroundPatchHelperRef.current) {
      return img.backgroundPatch;
    }
    return backgroundPatchHelperRef.current(img.pageNumber, {
      kind: 'image',
      origX: img.origX,
      origY: img.origY,
      origWidth: img.origWidth,
      origHeight: img.origHeight,
      backgroundPatch: img.backgroundPatch,
    });
  }, []);

  // Extraction paresseuse de toutes les pages dès que l'utilisateur tape une recherche
  useEffect(() => {
    if (!searchOpen || !activeTab || !activePdfProxy) {
      return;
    }
    let cancelled = false;
    (async () => {
      for (let p = 1; p <= activeTab.numPages; p += 1) {
        if (cancelled || activeTab.textBlocksByPage[p]) {
          continue;
        }
        const page = await activePdfProxy.getPage(p);
        if (cancelled) {
          return;
        }
        const extracted = await extractNativeTextBlocks(page, p);
        if (!cancelled) {
          initializePageBlocks(activeTab.id, p, extracted);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePdfProxy, activeTab, initializePageBlocks, searchOpen]);

  // Calcul des correspondances de recherche sur tout l'onglet actif
  const searchMatches: SearchMatch[] = useMemo(() => {
    if (!activeTab || !searchQuery.trim()) {
      return [];
    }
    const needle = matchCase ? searchQuery : searchQuery.toLowerCase();
    const results: SearchMatch[] = [];

    for (let p = 1; p <= activeTab.numPages; p += 1) {
      const blocks = activeTab.textBlocksByPage[p] ?? [];
      for (const block of blocks) {
        if (block.status === 'deleted' || !block.currentText) {
          continue;
        }
        const haystack = matchCase ? block.currentText : block.currentText.toLowerCase();
        let searchFrom = 0;
        while (searchFrom < haystack.length) {
          const foundIdx = haystack.indexOf(needle, searchFrom);
          if (foundIdx === -1) {
            break;
          }
          results.push({
            blockId: block.id,
            pageNumber: p,
            startIndex: foundIdx,
            endIndex: foundIdx + needle.length,
          });
          searchFrom = foundIdx + Math.max(1, needle.length);
        }
      }
    }
    return results;
  }, [activeTab, matchCase, searchQuery]);

  useEffect(() => {
    if (activeMatchIndex >= searchMatches.length) {
      setActiveMatchIndex(0);
    }
  }, [activeMatchIndex, searchMatches.length]);

  const activeSearchMatch =
    searchMatches.length > 0 ? searchMatches[activeMatchIndex] ?? searchMatches[0] : null;

  const navigateSearchMatch = (delta: 1 | -1) => {
    if (searchMatches.length === 0) {
      return;
    }
    const nextIdx = (activeMatchIndex + delta + searchMatches.length) % searchMatches.length;
    setActiveMatchIndex(nextIdx);
    const targetMatch = searchMatches[nextIdx];
    if (targetMatch && activeTab && targetMatch.pageNumber !== activeTab.currentPage) {
      handleJumpToPage(targetMatch.pageNumber);
    }
  };

  // Remplacer une correspondance ou toutes les correspondances en conservant le fond
  const handleReplaceOne = async () => {
    if (!activeTab || !activeSearchMatch || !searchQuery) {
      return;
    }
    const pageBlocks = activeTab.textBlocksByPage[activeSearchMatch.pageNumber] ?? [];
    const target = pageBlocks.find((b) => b.id === activeSearchMatch.blockId);
    if (!target) {
      return;
    }
    const patch = await requestTextPatch(target);

    const nextText =
      target.currentText.slice(0, activeSearchMatch.startIndex) +
      replaceValue +
      target.currentText.slice(activeSearchMatch.endIndex);

    commitBlockUpdate(
      activeTab.id,
      target.id,
      'Rechercher et remplacer',
      (b) =>
        nextText.trim()
          ? { ...b, currentText: nextText, status: 'edited' }
          : { ...b, currentText: '', status: 'deleted' },
      patch,
    );
  };

  const handleReplaceAll = async () => {
    if (!activeTab || searchMatches.length === 0 || !searchQuery) {
      return;
    }
    const patches = new Map<string, BackgroundPatch | undefined>();
    const uniqueBlockIds = new Set(searchMatches.map((m) => m.blockId));

    for (const blockId of uniqueBlockIds) {
      for (const list of Object.values(activeTab.textBlocksByPage)) {
        const found = list.find((b) => b.id === blockId);
        if (found) {
          patches.set(blockId, await requestTextPatch(found));
          break;
        }
      }
    }

    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, matchCase ? 'g' : 'gi');
    let replacedCount = 0;

    commitBatchBlocksUpdate(activeTab.id, 'Tout remplacer', (blocksByPage) => {
      for (const [pageKey, list] of Object.entries(blocksByPage)) {
        blocksByPage[Number(pageKey)] = list.map((b) => {
          if (b.status === 'deleted' || !uniqueBlockIds.has(b.id)) {
            return b;
          }
          const nextText = b.currentText.replace(regex, () => {
            replacedCount += 1;
            return replaceValue;
          });
          const patch = b.backgroundPatch ?? patches.get(b.id);
          if (!nextText.trim()) {
            return { ...b, currentText: '', status: 'deleted', backgroundPatch: patch };
          }
          return { ...b, currentText: nextText, status: 'edited', backgroundPatch: patch };
        });
      }
      return blocksByPage;
    });

    showInfo(
      `${replacedCount} ${replacedCount > 1 ? 'remplacements effectués' : 'remplacement effectué'}.`,
    );
  };

  // Lancement de l'OCR hors ligne sur la page courante
  const handleRunOcrCurrentPage = async () => {
    if (!activeTab || !activePdfProxy || ocrProgress !== null) {
      return;
    }
    const targetPageNum = activeTab.currentPage;
    setOcrProgress(0);
    try {
      const page = await activePdfProxy.getPage(targetPageNum);
      const ocrBlocks = await runOfflineOcrOnPage(page, targetPageNum, (pct) =>
        setOcrProgress(pct),
      );
      initializePageBlocks(activeTab.id, targetPageNum, ocrBlocks, true);
      if (ocrBlocks.length > 0) {
        setAnnotationBarOpen(false);
        setToolMode('select-text');
        showInfo(
          `Lecture terminée : ${ocrBlocks.length} ${
            ocrBlocks.length > 1 ? 'zones de texte détectées' : 'zone de texte détectée'
          } sur la page ${targetPageNum}.`,
        );
      } else {
        showInfo(`Aucun texte lisible détecté sur la page ${targetPageNum}.`);
      }
    } catch {
      showError(
        "La reconnaissance de texte (OCR) n'a pas pu aboutir sur cette page.",
      );
    } finally {
      setOcrProgress(null);
    }
  };

  // Préparation complète des octets PDF finaux (texte, images, formulaires, signatures, annotations, caviardage irréversible)
  const buildEditedPdfBytes = useCallback(
    async (tab: TabDocument): Promise<Uint8Array> => {
      const enrichedBlocks: Record<number, EditableTextBlock[]> = { ...tab.textBlocksByPage };
      for (const [pageKey, list] of Object.entries(enrichedBlocks)) {
        const pNum = Number(pageKey);
        const updatedList: EditableTextBlock[] = [];
        for (const b of list) {
          if (b.status !== 'original' && !b.backgroundPatch) {
            updatedList.push({ ...b, backgroundPatch: await requestTextPatch(b) });
          } else {
            updatedList.push(b);
          }
        }
        enrichedBlocks[pNum] = updatedList;
      }

      const enrichedImages: Record<number, EditableImageBlock[]> = { ...tab.imageBlocksByPage };
      for (const [pageKey, list] of Object.entries(enrichedImages)) {
        const pNum = Number(pageKey);
        const updatedImgs: EditableImageBlock[] = [];
        for (const img of list) {
          const changed =
            img.status !== 'original' ||
            img.rotation !== 0 ||
            Math.abs(img.x - img.origX) > 0.5 ||
            Math.abs(img.y - img.origY) > 0.5 ||
            Math.abs(img.width - img.origWidth) > 0.5 ||
            Math.abs(img.height - img.origHeight) > 0.5;
          if (img.source === 'pdf' && changed && !img.backgroundPatch) {
            updatedImgs.push({ ...img, backgroundPatch: await requestImagePatch(img) });
          } else {
            updatedImgs.push(img);
          }
        }
        enrichedImages[pNum] = updatedImgs;
      }

      return serializeDocumentEditsToPdf({
        baseBytes: tab.currentBytes,
        textBlocksByPage: enrichedBlocks,
        imageBlocksByPage: enrichedImages,
        annotationsByPage: tab.annotationsByPage,
        formValues: tab.formValues,
      });
    },
    [requestImagePatch, requestTextPatch],
  );

  const downloadPdfBytes = useCallback((bytes: Uint8Array, fileName: string) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  }, []);

  // Enregistrer sous (Windows, Android SAF anti-0-Ko ou téléchargement web)
  const handleSaveAs = useCallback(async () => {
    if (!activeTab) {
      return;
    }
    try {
      const outBytes = await buildEditedPdfBytes(activeTab);
      const desktop = getDesktopBridge();
      const suggestedName = activeTab.fileName.toLowerCase().endsWith('.pdf')
        ? activeTab.fileName
        : `${activeTab.fileName}.pdf`;

      if (desktop) {
        const res = await desktop.savePdfAsDialog(
          suggestedName,
          outBytes,
          activeTab.filePath,
        );
        if (res.canceled) {
          return;
        }
        if (res.filePath) {
          const savedName = res.fileName || suggestedName;
          markTabSaved(activeTab.id, res.filePath, savedName);
          await saveRecentFile(
            savedName,
            outBytes.byteLength,
            activeTab.numPages,
            outBytes,
            res.filePath,
          );
          await refreshRecentFiles();
          showInfo(`Document enregistré sous « ${savedName} ».`);
          return;
        }
        showError(res.error || "Impossible d'enregistrer le fichier PDF.");
        return;
      }

      if (runningOnAndroid) {
        const res = await savePdfAndroidAs(suggestedName, outBytes);
        if (res.canceled) {
          return;
        }
        if (res.ok && res.uri) {
          const savedName = res.fileName || suggestedName;
          markTabSaved(activeTab.id, res.uri, savedName, { androidWritable: true });
          await saveRecentFile(
            savedName,
            outBytes.byteLength,
            activeTab.numPages,
            outBytes,
            res.uri,
          );
          await refreshRecentFiles();
          showInfo(`Document enregistré sous « ${savedName} » (${Math.max(1, Math.round(outBytes.byteLength / 1024))} Ko).`);
          return;
        }
        showError(res.error || "Impossible d'enregistrer le PDF sur Android.");
        return;
      }

      const outName = activeTab.isDirty ? `modifie-${activeTab.fileName}` : activeTab.fileName;
      downloadPdfBytes(outBytes, outName);
      showInfo('Document PDF enregistré.');
    } catch {
      showError("Impossible d'enregistrer ce document PDF.");
    }
  }, [
    activeTab,
    buildEditedPdfBytes,
    downloadPdfBytes,
    markTabSaved,
    refreshRecentFiles,
    runningOnAndroid,
    showError,
    showInfo,
  ]);

  // Sauvegarde locale : directe sur Windows ou Android si possible (via fichier temporaire anti-0 Ko), sinon Enregistrer sous
  const handleSaveCopy = useCallback(async () => {
    if (!activeTab) {
      return;
    }
    const desktop = getDesktopBridge();
    if (desktop) {
      if (activeTab.filePath) {
        try {
          const outBytes = await buildEditedPdfBytes(activeTab);
          const res = await desktop.savePdfDirect(activeTab.filePath, outBytes);
          if (res.ok) {
            markTabSaved(activeTab.id, res.filePath);
            showInfo(`Modifications enregistrées dans « ${activeTab.fileName} ».`);
            return;
          }
          showInfo(res.error || 'Choisissez un emplacement pour enregistrer votre copie.');
          await handleSaveAs();
          return;
        } catch {
          showError("Impossible d'enregistrer ce document PDF.");
          return;
        }
      }
      await handleSaveAs();
      return;
    }

    if (runningOnAndroid) {
      try {
        const outBytes = await buildEditedPdfBytes(activeTab);
        if (activeTab.filePath && activeTab.androidWritable) {
          const res = await savePdfAndroidDirect(
            activeTab.filePath,
            activeTab.fileName,
            outBytes,
          );
          if (res.ok) {
            markTabSaved(activeTab.id, activeTab.filePath, undefined, { androidWritable: true });
            showInfo(`Modifications enregistrées dans « ${activeTab.fileName} ».`);
            return;
          }
        }
        await handleSaveAs();
        return;
      } catch {
        showError("Impossible d'enregistrer ce document PDF.");
        return;
      }
    }

    try {
      const outBytes = await buildEditedPdfBytes(activeTab);
      const outName = activeTab.isDirty ? `modifie-${activeTab.fileName}` : activeTab.fileName;
      downloadPdfBytes(outBytes, outName);
      showInfo('Document PDF enregistré.');
    } catch {
      showError("Impossible d'enregistrer ce document PDF.");
    }
  }, [
    activeTab,
    buildEditedPdfBytes,
    downloadPdfBytes,
    handleSaveAs,
    markTabSaved,
    runningOnAndroid,
    showError,
    showInfo,
  ]);

  // Partage générique (feuille de partage Android native, fenêtre Windows, Web Share API sur PWA)
  const sharePdfBytesWithPlatform = useCallback(
    async (outName: string, outBytes: Uint8Array) => {
      try {
        if (runningOnAndroid) {
          const shared = await sharePdfAndroidNative(outName, outBytes);
          if (!shared.ok) {
            showError(shared.error || 'Impossible d’ouvrir le menu de partage Android.');
          }
          return;
        }

        const desktop = getDesktopBridge();
        if (desktop) {
          const prep = await desktop.preparePdfForShare(outName, outBytes);
          if (prep.ok && prep.filePath) {
            setWindowsShareTarget({
              fileName: outName,
              filePath: prep.filePath,
              bytes: outBytes,
            });
            return;
          }
          showError(prep.error || 'Impossible de préparer le fichier à partager.');
          return;
        }

        const copy = new Uint8Array(outBytes.byteLength);
        copy.set(outBytes);
        const file = new File([copy], outName, { type: 'application/pdf' });

        if (
          typeof navigator.share === 'function' &&
          (!navigator.canShare || navigator.canShare({ files: [file] }))
        ) {
          try {
            await navigator.share({
              title: outName,
              text: 'Document PDF préparé avec Basic PDF',
              files: [file],
            });
            showInfo('Document partagé.');
            return;
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              return;
            }
          }
        }

        downloadPdfBytes(outBytes, outName);
        showInfo(
          'Le partage direct n’est pas pris en charge par ce navigateur : le PDF a été enregistré sur votre appareil pour que vous puissiez l’envoyer par e-mail ou messagerie.',
        );
      } catch {
        showError('Impossible de préparer ce document pour le partage.');
      }
    },
    [downloadPdfBytes, runningOnAndroid, showError, showInfo],
  );

  // Partage du PDF de l'onglet actif
  const handleSharePdf = async () => {
    if (!activeTab) {
      return;
    }
    try {
      const outBytes = await buildEditedPdfBytes(activeTab);
      const outName = activeTab.isDirty ? `modifie-${activeTab.fileName}` : activeTab.fileName;
      await sharePdfBytesWithPlatform(outName, outBytes);
    } catch {
      showError('Impossible de préparer ce document pour le partage.');
    }
  };

  // --- Gestion des blocs de texte (A2) ---
  const findBlockById = useCallback(
    (blockId: string): EditableTextBlock | null => {
      if (!activeTab) {
        return null;
      }
      for (const list of Object.values(activeTab.textBlocksByPage)) {
        const found = list.find((b) => b.id === blockId);
        if (found) {
          return found;
        }
      }
      return null;
    },
    [activeTab],
  );

  const handleFinishInlineEditing = useCallback(
    (blockId: string, nextText: string, patch?: BackgroundPatch) => {
      setEditingBlockId(null);
      if (!activeTab) {
        return;
      }
      const existing = findBlockById(blockId);
      if (!existing) {
        return;
      }
      if (!nextText.trim()) {
        deleteTextBlock(activeTab.id, blockId, patch);
        return;
      }
      if (nextText === existing.currentText) {
        return;
      }
      commitBlockUpdate(
        activeTab.id,
        blockId,
        'Modifier le texte',
        (b) => ({
          ...b,
          currentText: nextText,
          status: 'edited',
        }),
        patch,
      );
    },
    [activeTab, commitBlockUpdate, deleteTextBlock, findBlockById],
  );

  const handleDeleteBlock = useCallback(
    async (blockId: string) => {
      if (!activeTab) {
        return;
      }
      const existing = findBlockById(blockId);
      if (!existing) {
        return;
      }
      const patch = await requestTextPatch(existing);
      setEditingBlockId(null);
      deleteTextBlock(activeTab.id, blockId, patch);
    },
    [activeTab, deleteTextBlock, findBlockById, requestTextPatch],
  );

  const handleUpdateTextAndStyle = useCallback(
    async (blockId: string, nextText: string, nextStyle: TextStyle, label: string) => {
      if (!activeTab) {
        return;
      }
      const existing = findBlockById(blockId);
      if (!existing) {
        return;
      }
      const patch = await requestTextPatch(existing);
      if (!nextText.trim()) {
        deleteTextBlock(activeTab.id, blockId, patch);
        return;
      }
      commitBlockUpdate(
        activeTab.id,
        blockId,
        label,
        (b) => ({
          ...b,
          currentText: nextText,
          style: { ...nextStyle },
          status: 'edited',
        }),
        patch,
      );
    },
    [activeTab, commitBlockUpdate, deleteTextBlock, findBlockById, requestTextPatch],
  );

  const handleMoveOrResizeBlock = useCallback(
    (
      blockId: string,
      nextRect: { x: number; y: number; width: number; height: number },
      label: string,
      patch?: BackgroundPatch,
    ) => {
      if (!activeTab) {
        return;
      }
      commitBlockUpdate(
        activeTab.id,
        blockId,
        label,
        (b) => ({
          ...b,
          x: nextRect.x,
          y: nextRect.y,
          width: nextRect.width,
          height: nextRect.height,
          status: b.status === 'original' ? 'edited' : b.status,
        }),
        patch,
      );
    },
    [activeTab, commitBlockUpdate],
  );

  // --- Gestion des images (A3) ---
  const findImageById = useCallback(
    (imageId: string): EditableImageBlock | null => {
      if (!activeTab) {
        return null;
      }
      for (const list of Object.values(activeTab.imageBlocksByPage)) {
        const found = list.find((img) => img.id === imageId);
        if (found) {
          return found;
        }
      }
      return null;
    },
    [activeTab],
  );

  const handleRotateQuarterTurn = useCallback(
    async (imageId: string) => {
      if (!activeTab) {
        return;
      }
      const existing = findImageById(imageId);
      if (!existing) {
        return;
      }
      const patch = await requestImagePatch(existing);
      commitImageUpdate(
        activeTab.id,
        imageId,
        "Pivoter l'image d'un quart de tour",
        (cur) => {
          const cx = cur.x + cur.width / 2;
          const cy = cur.y + cur.height / 2;
          const nextW = cur.height;
          const nextH = cur.width;
          return {
            ...cur,
            rotation: ((cur.rotation + 90) % 360) as RotationQuarterTurn,
            width: nextW,
            height: nextH,
            x: Math.max(0, cx - nextW / 2),
            y: Math.max(0, cy - nextH / 2),
            status: 'modified',
          };
        },
        patch,
      );
    },
    [activeTab, commitImageUpdate, findImageById, requestImagePatch],
  );

  const handleReplaceImageFile = useCallback(
    async (imageId: string, file: File) => {
      if (!activeTab) {
        return;
      }
      const existing = findImageById(imageId);
      if (!existing) {
        return;
      }
      try {
        const { dataUrl } = await readImageFileAsPngDataUrl(file);
        const patch = await requestImagePatch(existing);
        commitImageUpdate(
          activeTab.id,
          imageId,
          "Remplacer l'image",
          (cur) => ({
            ...cur,
            imageDataUrl: dataUrl,
            rotation: 0,
            status: 'modified',
          }),
          patch,
        );
        showInfo('Image remplacée.');
      } catch {
        showError("Impossible de charger cette image. Choisissez un fichier JPG, PNG ou WebP.");
      }
    },
    [activeTab, commitImageUpdate, findImageById, requestImagePatch, showError, showInfo],
  );

  const handleDeleteImage = useCallback(
    async (imageId: string) => {
      if (!activeTab) {
        return;
      }
      const existing = findImageById(imageId);
      if (!existing) {
        return;
      }
      const patch = await requestImagePatch(existing);
      deleteImageBlock(activeTab.id, imageId, patch);
    },
    [activeTab, deleteImageBlock, findImageById, requestImagePatch],
  );

  const handleCopyImageToAllPages = useCallback(
    (imageId: string) => {
      if (!activeTab) {
        return;
      }
      copyImageToAllPages(activeTab.id, imageId);
      showInfo(`Image copiée sur les autres pages du document (${activeTab.numPages} pages).`);
    },
    [activeTab, copyImageToAllPages, showInfo],
  );

  const handleAddImageFile = useCallback(
    async (file: File) => {
      if (!activeTab) {
        return;
      }
      try {
        const { dataUrl, width, height } = await readImageFileAsPngDataUrl(file);
        const maxW = 240;
        const scale = width > maxW ? maxW / width : 1;
        const fitW = Math.max(32, Math.round(width * scale));
        const fitH = Math.max(32, Math.round(height * scale));
        addNewImageToPage(activeTab.id, activeTab.currentPage, dataUrl, fitW, fitH);
        setToolMode('select-image');
        showInfo('Image ajoutée sur la page courante.');
      } catch {
        showError("Impossible d'insérer cette image.");
      }
    },
    [activeTab, addNewImageToPage, showError, showInfo],
  );

  // --- Gestion de la signature, pages et compression (A4 & A5) ---
  const handleSelectSignatureForPlacement = useCallback((dataUrl: string) => {
    setPendingSignatureUrl(dataUrl);
    setSignatureModalOpen(false);
    setAnnotationBarOpen(true);
    setToolMode('sign');
    showInfo('Cliquez sur le document à l’endroit où vous souhaitez apposer votre signature.');
  }, [showInfo]);

  const handleApplyPageMutation = useCallback(
    async (label: string, result: PageMutationOutput) => {
      if (!activeTab) {
        return;
      }
      try {
        await commitDocumentBytesChange(activeTab.id, label, result.bytes, {
          textBlocksByPage: result.textBlocksByPage,
          imageBlocksByPage: result.imageBlocksByPage,
          annotationsByPage: result.annotationsByPage,
          targetPage: result.targetPage,
          clearExtractedFormFields: true,
        });
        showInfo(`${label} terminé.`);
      } catch {
        showError(`Impossible d'effectuer l'action : ${label}.`);
      }
    },
    [activeTab, commitDocumentBytesChange, showError, showInfo],
  );

  const handleOpenExtractedPdf = useCallback(
    async (newFileName: string, bytes: Uint8Array) => {
      await openPdfFromBytes(newFileName, bytes);
      setPageManagerOpen(false);
    },
    [openPdfFromBytes],
  );

  const handleApplyCompressedBytes = useCallback(
    async (compressedBytes: Uint8Array) => {
      if (!activeTab) {
        return;
      }
      await commitDocumentBytesChange(activeTab.id, 'Compresser le PDF', compressedBytes, {
        clearExtractedFormFields: true,
      });
      setCompressModalOpen(false);
      showInfo('Document compressé appliqué dans cet onglet.');
    },
    [activeTab, commitDocumentBytesChange, showInfo],
  );

  // Raccourcis clavier globaux : Ctrl+Tab, Ctrl+W, Ctrl+O, Ctrl+F, Ctrl+H, Ctrl+P, Ctrl+Z, Ctrl+Y, Suppr, Échap
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
        if (tabs.length > 0) {
          event.preventDefault();
          cycleTab(event.shiftKey ? -1 : 1);
        }
        return;
      }

      if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        if (tabs.length > 0) {
          event.preventDefault();
          cycleTab(event.key === 'ArrowRight' ? 1 : -1);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        if (activeTabId) {
          event.preventDefault();
          closeTab(activeTabId);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void handleOpenFileAction();
        return;
      }

      if (!activeTab) {
        if (event.key === 'Escape') {
          if (scannerModalOpen) setScannerModalOpen(false);
          else if (androidSettingsOpen) setAndroidSettingsOpen(false);
          else if (desktopSettingsOpen) setDesktopSettingsOpen(false);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (event.shiftKey) {
          void handleSaveAs();
        } else {
          void handleSaveCopy();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchShowReplace(false);
        setSearchOpen(true);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setSearchShowReplace(true);
        setSearchOpen(true);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPrintModalOpen(true);
        return;
      }

      if (isEditingInput) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        setEditingBlockId(null);
        void undoTab(activeTab.id);
        return;
      }

      if (
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z')
      ) {
        event.preventDefault();
        setEditingBlockId(null);
        void redoTab(activeTab.id);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (activeTab.selectedBlockId) {
          event.preventDefault();
          void handleDeleteBlock(activeTab.selectedBlockId);
          return;
        }
        if (activeTab.selectedImageId) {
          event.preventDefault();
          void handleDeleteImage(activeTab.selectedImageId);
          return;
        }
        if (activeTab.selectedAnnotationId) {
          event.preventDefault();
          deleteAnnotation(activeTab.id, activeTab.selectedAnnotationId);
          return;
        }
      }

      if (event.key === 'Escape') {
        if (scannerModalOpen) {
          setScannerModalOpen(false);
        } else if (androidSettingsOpen) {
          setAndroidSettingsOpen(false);
        } else if (desktopSettingsOpen) {
          setDesktopSettingsOpen(false);
        } else if (windowsShareTarget) {
          setWindowsShareTarget(null);
        } else if (signatureModalOpen) {
          setSignatureModalOpen(false);
        } else if (pageManagerOpen) {
          setPageManagerOpen(false);
        } else if (compressModalOpen) {
          setCompressModalOpen(false);
        } else if (printModalOpen) {
          setPrintModalOpen(false);
        } else if (activeTab.selectedBlockId) {
          selectTextBlock(activeTab.id, null);
        } else if (activeTab.selectedImageId) {
          selectImageBlock(activeTab.id, null);
        } else if (activeTab.selectedAnnotationId) {
          selectAnnotation(activeTab.id, null);
        } else if (searchOpen) {
          setSearchOpen(false);
        } else if (toolMode !== 'view' || annotationBarOpen) {
          setAnnotationBarOpen(false);
          setToolMode('view');
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        updateTabZoom(activeTab.id, activeTab.zoom + ZOOM_STEP, 'custom');
      } else if ((event.ctrlKey || event.metaKey) && event.key === '-') {
        event.preventDefault();
        updateTabZoom(activeTab.id, activeTab.zoom - ZOOM_STEP, 'custom');
      } else if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault();
        updateTabZoom(activeTab.id, 1, 'custom');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeTab,
    activeTabId,
    androidSettingsOpen,
    annotationBarOpen,
    closeTab,
    compressModalOpen,
    cycleTab,
    deleteAnnotation,
    desktopSettingsOpen,
    handleDeleteBlock,
    handleDeleteImage,
    handleOpenFileAction,
    handleSaveAs,
    handleSaveCopy,
    pageManagerOpen,
    printModalOpen,
    redoTab,
    scannerModalOpen,
    searchOpen,
    selectAnnotation,
    selectImageBlock,
    selectTextBlock,
    signatureModalOpen,
    tabs.length,
    toolMode,
    undoTab,
    updateTabZoom,
    windowsShareTarget,
  ]);

  // Glisser-déposer global sur toute la fenêtre
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        dragCounterRef.current += 1;
        setIsGlobalDragOver(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      }
    };
    const onDragLeave = () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsGlobalDragOver(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsGlobalDragOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        void handleFilesSelected(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFilesSelected]);

  const currentPageBlocks = activeTab
    ? activeTab.textBlocksByPage[activeTab.currentPage] ?? []
    : [];
  const hasCurrentPageBeenExtracted = Boolean(
    activeTab && activeTab.textBlocksByPage[activeTab.currentPage],
  );
  const selectedBlock = activeTab?.selectedBlockId
    ? findBlockById(activeTab.selectedBlockId)
    : null;
  const deletedBlocksOnPage = currentPageBlocks.filter((b) => b.status === 'deleted');

  const currentPageImages = activeTab
    ? activeTab.imageBlocksByPage[activeTab.currentPage] ?? []
    : [];
  const selectedImage = activeTab?.selectedImageId
    ? findImageById(activeTab.selectedImageId)
    : null;
  const deletedImagesOnPage = currentPageImages.filter((img) => img.status === 'deleted');

  const showImageInspector =
    Boolean(activeTab) &&
    (toolMode === 'select-image' ||
      Boolean(selectedImage) ||
      (toolMode !== 'select-text' && !selectedBlock && deletedImagesOnPage.length > 0));

  const showTextInspector =
    Boolean(activeTab) &&
    !showImageInspector &&
    (toolMode === 'select-text' || Boolean(selectedBlock) || deletedBlocksOnPage.length > 0);

  const currentScanKey = activeTab ? `${activeTab.id}-${activeTab.currentPage}` : '';
  const showScannedPagePrompt =
    Boolean(activeTab) &&
    hasCurrentPageBeenExtracted &&
    currentPageBlocks.length === 0 &&
    !activeTab?.ocrPages.includes(activeTab.currentPage) &&
    ocrProgress === null &&
    !dismissedScanPromptKeys.has(currentScanKey);

  const modeHintLabel = (() => {
    if (toolMode === 'select-text') {
      return 'Mode sélection de texte actif — cliquez sur un texte pour le corriger';
    }
    if (toolMode === 'select-image') {
      return 'Mode gestion des images actif — survolez une image et cliquez pour la modifier';
    }
    if (toolMode === 'sign') {
      return pendingSignatureUrl
        ? 'Cliquez sur le document pour apposer votre signature'
        : 'Ouvrez le panneau Signature pour dessiner ou importer votre signature';
    }
    if (toolMode === 'redact') {
      return 'Caviardage irréversible — tracez un rectangle noir pour supprimer définitivement le texte masqué';
    }
    return null;
  })();

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          void handleFilesSelected(event.target.files);
          event.target.value = '';
        }}
      />

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
      />

      <HeaderToolbar
        activeTab={activeTab}
        theme={theme}
        showThumbnails={showThumbnails}
        toolMode={toolMode}
        annotationBarOpen={annotationBarOpen}
        searchOpen={searchOpen}
        isOcrRunning={ocrProgress !== null}
        canInstallPwa={Boolean(installPrompt)}
        isDesktop={runningOnDesktop}
        isAndroid={runningOnAndroid}
        onOpenFileClick={() => void handleOpenFileAction()}
        onOpenScanner={() => setScannerModalOpen(true)}
        onToggleThumbnails={() => setShowThumbnails((prev) => !prev)}
        onToggleTextSelectMode={() => {
          setEditingBlockId(null);
          setAnnotationBarOpen(false);
          setToolMode((prev) => {
            const next = prev === 'select-text' ? 'view' : 'select-text';
            if (next === 'view' && activeTab) {
              selectTextBlock(activeTab.id, null);
            }
            return next;
          });
        }}
        onToggleImageSelectMode={() => {
          setEditingBlockId(null);
          setAnnotationBarOpen(false);
          setToolMode((prev) => {
            const next = prev === 'select-image' ? 'view' : 'select-image';
            if (next === 'view' && activeTab) {
              selectImageBlock(activeTab.id, null);
            }
            return next;
          });
        }}
        onToggleAnnotationBar={() => {
          setEditingBlockId(null);
          setAnnotationBarOpen((prev) => {
            const nextOpen = !prev;
            if (nextOpen) {
              setToolMode((cur) =>
                cur === 'view' || cur === 'select-text' || cur === 'select-image'
                  ? 'annotate-highlight'
                  : cur,
              );
            } else {
              setToolMode('view');
              if (activeTab) {
                selectAnnotation(activeTab.id, null);
              }
            }
            return nextOpen;
          });
        }}
        onToggleSearch={() => {
          setSearchShowReplace(false);
          setSearchOpen((p) => !p);
        }}
        onRunOcrCurrentPage={() => void handleRunOcrCurrentPage()}
        onOpenPageManager={() => setPageManagerOpen(true)}
        onOpenCompress={() => setCompressModalOpen(true)}
        onOpenPrint={() => setPrintModalOpen(true)}
        onSharePdf={() => void handleSharePdf()}
        onUndo={() => {
          if (activeTab) {
            setEditingBlockId(null);
            void undoTab(activeTab.id);
          }
        }}
        onRedo={() => {
          if (activeTab) {
            setEditingBlockId(null);
            void redoTab(activeTab.id);
          }
        }}
        onSaveCopy={() => void handleSaveCopy()}
        onSaveAs={() => void handleSaveAs()}
        onJumpToPage={handleJumpToPage}
        onChangeZoom={(zoom, fitMode) => {
          if (activeTab) {
            updateTabZoom(activeTab.id, zoom, fitMode);
          }
        }}
        onToggleTheme={toggleTheme}
        onInstallPwa={() => void handleInstallPwa()}
        onOpenDesktopSettings={() => setDesktopSettingsOpen(true)}
        onOpenAndroidSettings={() => setAndroidSettingsOpen(true)}
      />

      <main className="main-content">
        {activeTab && activePdfProxy ? (
          <div className="viewer-workspace">
            {showThumbnails && (
              <SidebarThumbnails
                pdfProxy={activePdfProxy}
                numPages={activeTab.numPages}
                currentPage={activeTab.currentPage}
                onSelectPage={handleJumpToPage}
                onCloseMobile={() => setShowThumbnails(false)}
              />
            )}

            <div className="viewer-center-column">
              {annotationBarOpen && (
                <AnnotationToolsBar
                  toolMode={toolMode}
                  activeColor={activeToolColor}
                  activeStrokeWidth={activeStrokeWidth}
                  activeStampText={activeStampText}
                  onSelectTool={(mode) => {
                    if (mode === 'sign' && !pendingSignatureUrl) {
                      setSignatureModalOpen(true);
                    }
                    setToolMode(mode);
                  }}
                  onChangeColor={setActiveToolColor}
                  onChangeStrokeWidth={setActiveStrokeWidth}
                  onChangeStampText={setActiveStampText}
                  onOpenSignatureModal={() => setSignatureModalOpen(true)}
                  onCloseBar={() => {
                    setAnnotationBarOpen(false);
                    setToolMode('view');
                    selectAnnotation(activeTab.id, null);
                  }}
                />
              )}

              {showScannedPagePrompt && (
                <div className="scan-banner" role="region" aria-label="Document scanné détecté">
                  <ScanText size={18} aria-hidden="true" />
                  <span>
                    Cette page semble être une image ou un scan sans texte sélectionnable.
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleRunOcrCurrentPage()}
                  >
                    Lire le texte (OCR)
                  </button>
                  <button
                    type="button"
                    className="tab-close-btn"
                    aria-label="Ignorer"
                    onClick={() =>
                      setDismissedScanPromptKeys((prev) => new Set([...prev, currentScanKey]))
                    }
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              )}

              {ocrProgress !== null && (
                <div className="scan-banner" role="status" aria-live="polite">
                  <ScanText size={18} aria-hidden="true" />
                  <span>
                    Lecture automatique du texte en cours (100 % hors ligne)… {ocrProgress} %
                  </span>
                </div>
              )}

              {modeHintLabel && (
                <div className="tool-mode-strip">
                  <span>{modeHintLabel}</span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEditingBlockId(null);
                      selectTextBlock(activeTab.id, null);
                      selectImageBlock(activeTab.id, null);
                      selectAnnotation(activeTab.id, null);
                      setAnnotationBarOpen(false);
                      setToolMode('view');
                    }}
                  >
                    Terminer
                  </button>
                </div>
              )}

              <div className="viewer-stage-wrap">
                {searchOpen && (
                  <SearchBar
                    query={searchQuery}
                    replaceValue={replaceValue}
                    matchCase={matchCase}
                    totalMatches={searchMatches.length}
                    activeMatchIndex={activeMatchIndex}
                    showReplaceInitial={searchShowReplace}
                    onQueryChange={(q) => {
                      setSearchQuery(q);
                      setActiveMatchIndex(0);
                    }}
                    onReplaceValueChange={setReplaceValue}
                    onToggleMatchCase={() => setMatchCase((p) => !p)}
                    onPrevMatch={() => navigateSearchMatch(-1)}
                    onNextMatch={() => navigateSearchMatch(1)}
                    onReplaceOne={() => void handleReplaceOne()}
                    onReplaceAll={() => void handleReplaceAll()}
                    onClose={() => setSearchOpen(false)}
                  />
                )}

                <PdfViewer
                  key={activeTab.id}
                  tab={activeTab}
                  pdfProxy={activePdfProxy}
                  toolMode={toolMode}
                  editingBlockId={editingBlockId}
                  activeToolColor={activeToolColor}
                  activeStrokeWidth={activeStrokeWidth}
                  activeStampText={activeStampText}
                  pendingSignatureUrl={pendingSignatureUrl}
                  searchMatches={searchMatches}
                  activeSearchMatch={activeSearchMatch}
                  scrollRequest={scrollRequest}
                  onUpdateZoom={updateTabZoom}
                  onUpdatePage={updateTabPage}
                  onUpdateScrollTop={updateTabScrollTop}
                  onPageTextExtracted={(pageNum, blocks) =>
                    initializePageBlocks(activeTab.id, pageNum, blocks)
                  }
                  onSelectBlock={(blockId) => {
                    setEditingBlockId(null);
                    selectTextBlock(activeTab.id, blockId);
                  }}
                  onStartEditing={(blockId) => {
                    selectTextBlock(activeTab.id, blockId);
                    setEditingBlockId(blockId);
                  }}
                  onFinishEditing={handleFinishInlineEditing}
                  onMoveOrResizeBlock={handleMoveOrResizeBlock}
                  onPageImagesExtracted={(pageNum, images) =>
                    initializePageImages(activeTab.id, pageNum, images)
                  }
                  onSelectImage={(imageId) => selectImageBlock(activeTab.id, imageId)}
                  onMoveOrResizeImage={(imageId, nextRect, label, patch) => {
                    commitImageUpdate(
                      activeTab.id,
                      imageId,
                      label,
                      (img) => ({
                        ...img,
                        x: nextRect.x,
                        y: nextRect.y,
                        width: nextRect.width,
                        height: nextRect.height,
                        status: 'modified',
                      }),
                      patch,
                    );
                  }}
                  onPageFormFieldsExtracted={(pageNum, fields, defaults) =>
                    initializePageFormFields(activeTab.id, pageNum, fields, defaults)
                  }
                  onChangeFormValue={(fieldName, value) =>
                    updateFormValue(activeTab.id, fieldName, value)
                  }
                  onSelectAnnotation={(annotationId) => selectAnnotation(activeTab.id, annotationId)}
                  onAddAnnotation={(ann: PageAnnotation, label: string) =>
                    addAnnotation(activeTab.id, ann, label)
                  }
                  onUpdateAnnotation={(annotationId, label, updater) =>
                    updateAnnotation(activeTab.id, annotationId, label, updater)
                  }
                  onDeleteAnnotation={(annotationId) =>
                    deleteAnnotation(activeTab.id, annotationId)
                  }
                  onSignaturePlaced={() => {
                    setPendingSignatureUrl(null);
                    setToolMode('view');
                  }}
                  onRegisterCanvasHelper={(helper) => {
                    backgroundPatchHelperRef.current = helper;
                  }}
                />
              </div>
            </div>

            {showTextInspector && (
              <TextInspectorPanel
                selectedBlock={selectedBlock}
                deletedBlocksOnPage={deletedBlocksOnPage}
                isOcrPage={activeTab.ocrPages.includes(activeTab.currentPage)}
                onStartInlineEdit={(blockId) => setEditingBlockId(blockId)}
                onUpdateTextAndStyle={(id, txt, style, label) =>
                  void handleUpdateTextAndStyle(id, txt, style, label)
                }
                onDeleteBlock={(id) => void handleDeleteBlock(id)}
                onRestoreOriginal={(id) => restoreOriginalTextBlock(activeTab.id, id)}
                onCloseSelection={() => {
                  setEditingBlockId(null);
                  selectTextBlock(activeTab.id, null);
                }}
              />
            )}

            {showImageInspector && (
              <ImageInspectorPanel
                selectedImage={selectedImage}
                deletedImagesOnPage={deletedImagesOnPage}
                totalPages={activeTab.numPages}
                onRotateQuarterTurn={(id) => void handleRotateQuarterTurn(id)}
                onReplaceImageFile={(id, file) => void handleReplaceImageFile(id, file)}
                onCopyToAllPages={(id) => handleCopyImageToAllPages(id)}
                onRestoreOriginal={(id) => restoreOriginalImageBlock(activeTab.id, id)}
                onDeleteImage={(id) => void handleDeleteImage(id)}
                onAddImageFile={(file) => void handleAddImageFile(file)}
                onCloseSelection={() => selectImageBlock(activeTab.id, null)}
              />
            )}
          </div>
        ) : (
          <WelcomeScreen
            recentFiles={recentFiles}
            canInstallPwa={Boolean(installPrompt)}
            isDesktop={runningOnDesktop}
            isAndroid={runningOnAndroid}
            onOpenFileClick={() => void handleOpenFileAction()}
            onOpenScanner={() => setScannerModalOpen(true)}
            onOpenSamplePdf={() => void handleOpenSamplePdf()}
            onOpenRecentFile={(rec) => void handleOpenRecentFile(rec)}
            onRemoveRecentFile={(id) => void handleRemoveRecentFile(id)}
            onClearRecentFiles={() => void handleClearRecentFiles()}
            onInstallPwa={() => void handleInstallPwa()}
            onOpenDesktopSettings={() => setDesktopSettingsOpen(true)}
            onOpenAndroidSettings={() => setAndroidSettingsOpen(true)}
          />
        )}

        {isLoading && (
          <div className="toast-banner" role="status" aria-live="polite">
            <span className="toast-message">Ouverture du document PDF…</span>
          </div>
        )}
      </main>

      {signatureModalOpen && (
        <SignatureModal
          onSelectSignatureForPlacement={handleSelectSignatureForPlacement}
          onClose={() => setSignatureModalOpen(false)}
        />
      )}

      {pageManagerOpen && activeTab && (
        <PageManagerModal
          fileName={activeTab.fileName}
          currentBytes={activeTab.currentBytes}
          pdfProxy={activePdfProxy}
          numPages={activeTab.numPages}
          currentPage={activeTab.currentPage}
          overlayMaps={{
            textBlocksByPage: activeTab.textBlocksByPage,
            imageBlocksByPage: activeTab.imageBlocksByPage,
            annotationsByPage: activeTab.annotationsByPage,
          }}
          onApplyPageMutation={handleApplyPageMutation}
          onOpenPdfInNewTab={handleOpenExtractedPdf}
          onShowInfo={showInfo}
          onShowError={showError}
          onClose={() => setPageManagerOpen(false)}
        />
      )}

      {compressModalOpen && activeTab && (
        <CompressModal
          fileName={activeTab.fileName}
          sourceBytes={activeTab.currentBytes}
          onApplyCompressedBytes={handleApplyCompressedBytes}
          onClose={() => setCompressModalOpen(false)}
        />
      )}

      {printModalOpen && activeTab && (
        <PrintModal
          fileName={activeTab.fileName}
          pdfProxy={activePdfProxy}
          numPages={activeTab.numPages}
          currentPage={activeTab.currentPage}
          onShowInfo={showInfo}
          onShowError={showError}
          onClose={() => setPrintModalOpen(false)}
        />
      )}

      {desktopSettingsOpen && runningOnDesktop && (
        <DesktopSettingsModal
          onShowInfo={showInfo}
          onShowError={showError}
          onClose={() => setDesktopSettingsOpen(false)}
        />
      )}

      {androidSettingsOpen && runningOnAndroid && (
        <AndroidSettingsModal
          onShowInfo={showInfo}
          onShowError={showError}
          onClose={() => setAndroidSettingsOpen(false)}
        />
      )}

      {scannerModalOpen && (
        <DocumentScannerModal
          onCompletePdf={(bytes, fileName, shareAfter) => {
            setScannerModalOpen(false);
            void (async () => {
              await openPdfFromBytes(fileName, bytes);
              await refreshRecentFiles();
              showInfo(`Document scanné prêt (« ${fileName} »).`);
              if (shareAfter) {
                await sharePdfBytesWithPlatform(fileName, bytes);
              }
            })();
          }}
          onShowError={showError}
          onClose={() => setScannerModalOpen(false)}
        />
      )}

      {windowsShareTarget && runningOnDesktop && (
        <WindowsShareModal
          fileName={windowsShareTarget.fileName}
          preparedFilePath={windowsShareTarget.filePath}
          onSaveCopyToFolder={async () => {
            await handleSaveAs();
            setWindowsShareTarget(null);
          }}
          onClose={() => setWindowsShareTarget(null)}
        />
      )}

      {toast && (
        <div
          className={`toast-banner ${toast.isError ? 'is-error' : ''}`}
          role={toast.isError ? 'alert' : 'status'}
        >
          <AlertCircle size={18} aria-hidden="true" />
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="tab-close-btn"
            onClick={() => setToast(null)}
            aria-label="Fermer ce message"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {isGlobalDragOver && (
        <div className="global-drop-overlay" aria-hidden="true">
          <div className="global-drop-card">
            Relâchez pour ouvrir le PDF dans un nouvel onglet
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
