// Gestion centralisée des onglets PDF : zoom, texte, images, formulaires, annotations, pages et historique Annuler/Rétablir indépendant
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  BackgroundPatch,
  EditableImageBlock,
  EditableTextBlock,
  FitMode,
  HistoryEntry,
  PageAnnotation,
  PdfFormField,
  TabDocument,
} from '../types/pdf';
import { clampZoom, createId } from '../utils/formatters';
import { formatPdfError, loadPdfDocument } from '../utils/pdfLoader';
import { saveRecentFile } from '../utils/recentFilesStorage';

function cloneTextBlocksMap(
  map: Record<number, EditableTextBlock[]>,
): Record<number, EditableTextBlock[]> {
  const copy: Record<number, EditableTextBlock[]> = {};
  for (const [pageKey, list] of Object.entries(map)) {
    copy[Number(pageKey)] = list.map((b) => ({
      ...b,
      style: { ...b.style },
      originalStyle: { ...b.originalStyle },
      backgroundPatch: b.backgroundPatch ? { ...b.backgroundPatch } : undefined,
    }));
  }
  return copy;
}

function cloneImageBlocksMap(
  map: Record<number, EditableImageBlock[]>,
): Record<number, EditableImageBlock[]> {
  const copy: Record<number, EditableImageBlock[]> = {};
  for (const [pageKey, list] of Object.entries(map)) {
    copy[Number(pageKey)] = list.map((img) => ({
      ...img,
      backgroundPatch: img.backgroundPatch ? { ...img.backgroundPatch } : undefined,
    }));
  }
  return copy;
}

function cloneAnnotationsMap(
  map: Record<number, PageAnnotation[]>,
): Record<number, PageAnnotation[]> {
  const copy: Record<number, PageAnnotation[]> = {};
  for (const [pageKey, list] of Object.entries(map)) {
    copy[Number(pageKey)] = list.map((a) => ({
      ...a,
      points: a.points ? a.points.map((pt) => ({ ...pt })) : undefined,
    }));
  }
  return copy;
}

function computeTabDirty(
  bytes: Uint8Array,
  originalBytes: Uint8Array,
  textBlocks: Record<number, EditableTextBlock[]>,
  imageBlocks: Record<number, EditableImageBlock[]>,
  annotations: Record<number, PageAnnotation[]>,
  formFields: Record<number, PdfFormField[]>,
  formValues: Record<string, string | boolean>,
): boolean {
  if (bytes !== originalBytes && bytes.byteLength !== originalBytes.byteLength) {
    return true;
  }
  // Vérifie si au moins un octet diffère lorsqu'il y a eu remplacement de bytes
  if (bytes !== originalBytes) {
    for (let i = 0; i < Math.min(64, bytes.length); i += 1) {
      if (bytes[i] !== originalBytes[i]) {
        return true;
      }
    }
    return true;
  }

  for (const list of Object.values(textBlocks)) {
    for (const b of list) {
      if (
        b.status !== 'original' ||
        Math.abs(b.x - b.origX) > 0.5 ||
        Math.abs(b.y - b.origY) > 0.5 ||
        Math.abs(b.width - b.origWidth) > 0.5 ||
        Math.abs(b.height - b.origHeight) > 0.5
      ) {
        return true;
      }
    }
  }

  for (const list of Object.values(imageBlocks)) {
    for (const img of list) {
      if (
        img.source !== 'pdf' ||
        img.status !== 'original' ||
        img.rotation !== 0 ||
        Math.abs(img.x - img.origX) > 0.5 ||
        Math.abs(img.y - img.origY) > 0.5 ||
        Math.abs(img.width - img.origWidth) > 0.5 ||
        Math.abs(img.height - img.origHeight) > 0.5
      ) {
        return true;
      }
    }
  }

  for (const list of Object.values(annotations)) {
    if (list.length > 0) {
      return true;
    }
  }

  for (const fields of Object.values(formFields)) {
    for (const f of fields) {
      const currentVal = formValues[f.fieldName];
      if (currentVal !== undefined && currentVal !== f.defaultValue) {
        return true;
      }
    }
  }

  return false;
}

function makeSnapshot(tab: TabDocument, label: string): HistoryEntry {
  return {
    id: createId('hist'),
    label,
    timestamp: Date.now(),
    bytes: tab.currentBytes,
    textBlocksByPage: cloneTextBlocksMap(tab.textBlocksByPage),
    imageBlocksByPage: cloneImageBlocksMap(tab.imageBlocksByPage),
    annotationsByPage: cloneAnnotationsMap(tab.annotationsByPage),
    formValues: { ...tab.formValues },
    selectedBlockId: tab.selectedBlockId,
    selectedImageId: tab.selectedImageId,
    selectedAnnotationId: tab.selectedAnnotationId,
  };
}

export interface TabsStateResult {
  tabs: TabDocument[];
  activeTabId: string | null;
  activeTab: TabDocument | null;
  activePdfProxy: PDFDocumentProxy | null;
  isLoading: boolean;
  openPdfFromBytes: (
    fileName: string,
    bytes: Uint8Array,
    filePath?: string,
    options?: { androidWritable?: boolean },
  ) => Promise<void>;
  markTabSaved: (
    tabId: string,
    filePath?: string,
    fileName?: string,
    options?: { androidWritable?: boolean },
  ) => void;
  selectTab: (tabId: string | null) => void;
  closeTab: (tabId: string) => void;
  cycleTab: (direction: 1 | -1) => void;
  updateTabZoom: (tabId: string, zoom: number, fitMode?: FitMode) => void;
  updateTabPage: (tabId: string, page: number) => void;
  updateTabScrollTop: (tabId: string, scrollTop: number) => void;
  // Texte & OCR
  initializePageBlocks: (
    tabId: string,
    pageNumber: number,
    blocks: EditableTextBlock[],
    markAsOcr?: boolean,
  ) => void;
  selectTextBlock: (tabId: string, blockId: string | null) => void;
  commitBlockUpdate: (
    tabId: string,
    blockId: string,
    label: string,
    updater: (block: EditableTextBlock) => EditableTextBlock,
    backgroundPatch?: BackgroundPatch,
  ) => void;
  deleteTextBlock: (
    tabId: string,
    blockId: string,
    backgroundPatch?: BackgroundPatch,
  ) => void;
  restoreOriginalTextBlock: (tabId: string, blockId: string) => void;
  commitBatchBlocksUpdate: (
    tabId: string,
    label: string,
    updater: (
      blocksByPage: Record<number, EditableTextBlock[]>,
    ) => Record<number, EditableTextBlock[]>,
  ) => void;
  // Images (Étape A3)
  initializePageImages: (
    tabId: string,
    pageNumber: number,
    images: EditableImageBlock[],
  ) => void;
  selectImageBlock: (tabId: string, imageId: string | null) => void;
  commitImageUpdate: (
    tabId: string,
    imageId: string,
    label: string,
    updater: (img: EditableImageBlock) => EditableImageBlock,
    backgroundPatch?: BackgroundPatch,
  ) => void;
  deleteImageBlock: (
    tabId: string,
    imageId: string,
    backgroundPatch?: BackgroundPatch,
  ) => void;
  restoreOriginalImageBlock: (tabId: string, imageId: string) => void;
  copyImageToAllPages: (tabId: string, imageId: string) => void;
  addNewImageToPage: (
    tabId: string,
    pageNumber: number,
    dataUrl: string,
    widthPdf: number,
    heightPdf: number,
  ) => void;
  // Formulaires (Étape A4)
  initializePageFormFields: (
    tabId: string,
    pageNumber: number,
    fields: PdfFormField[],
    defaults: Record<string, string | boolean>,
  ) => void;
  updateFormValue: (tabId: string, fieldName: string, value: string | boolean) => void;
  // Annotations, signatures, remplissage libre & caviardage (Étape A4)
  selectAnnotation: (tabId: string, annotationId: string | null) => void;
  addAnnotation: (tabId: string, annotation: PageAnnotation, label: string) => void;
  updateAnnotation: (
    tabId: string,
    annotationId: string,
    label: string,
    updater: (ann: PageAnnotation) => PageAnnotation,
  ) => void;
  deleteAnnotation: (tabId: string, annotationId: string) => void;
  // Opérations de pages & compression (Étape A5)
  commitDocumentBytesChange: (
    tabId: string,
    label: string,
    nextBytes: Uint8Array,
    maps?: {
      textBlocksByPage?: Record<number, EditableTextBlock[]>;
      imageBlocksByPage?: Record<number, EditableImageBlock[]>;
      annotationsByPage?: Record<number, PageAnnotation[]>;
      targetPage?: number;
      clearExtractedFormFields?: boolean;
    },
  ) => Promise<void>;
  undoTab: (tabId: string) => Promise<void>;
  redoTab: (tabId: string) => Promise<void>;
}

export function useTabs(onError: (message: string) => void): TabsStateResult {
  const [tabs, setTabs] = useState<TabDocument[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const tabsRef = useRef<TabDocument[]>(tabs);
  tabsRef.current = tabs;

  const proxyMapRef = useRef<Map<string, PDFDocumentProxy>>(new Map());
  const historyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [, setProxyVersion] = useState(0);

  useEffect(() => {
    const map = proxyMapRef.current;
    return () => {
      for (const proxy of map.values()) {
        proxy.destroy().catch(() => undefined);
      }
      map.clear();
    };
  }, []);

  const replaceProxy = useCallback(async (tabId: string, bytes: Uint8Array) => {
    const nextProxy = await loadPdfDocument(bytes);
    const oldProxy = proxyMapRef.current.get(tabId);
    proxyMapRef.current.set(tabId, nextProxy);
    if (oldProxy) {
      oldProxy.destroy().catch(() => undefined);
    }
    setProxyVersion((v) => v + 1);
    return nextProxy;
  }, []);

  const openPdfFromBytes = useCallback(
    async (
      fileName: string,
      bytes: Uint8Array,
      filePath?: string,
      options?: { androidWritable?: boolean },
    ) => {
      // Sous Windows ou Android, si exactement ce fichier/URI est déjà ouvert, on active simplement son onglet
      if (filePath) {
        const normalizedTarget = filePath.toLowerCase();
        const existingTab = tabsRef.current.find(
          (t) => t.filePath && t.filePath.toLowerCase() === normalizedTarget,
        );
        if (existingTab) {
          setActiveTabId(existingTab.id);
          return;
        }
      }

      setIsLoading(true);
      try {
        const proxy = await loadPdfDocument(bytes);
        const tabId = createId('tab');
        const originalCopy = bytes.slice();
        const workingCopy = bytes.slice();

        proxyMapRef.current.set(tabId, proxy);
        setProxyVersion((v) => v + 1);

        const newTab: TabDocument = {
          id: tabId,
          fileName,
          filePath,
          androidWritable: options?.androidWritable,
          fileSize: bytes.byteLength,
          originalBytes: originalCopy,
          currentBytes: workingCopy,
          numPages: proxy.numPages,
          currentPage: 1,
          zoom: 1,
          fitMode: 'page-width',
          scrollTop: 0,
          textBlocksByPage: {},
          imageBlocksByPage: {},
          annotationsByPage: {},
          formFieldsByPage: {},
          formValues: {},
          ocrPages: [],
          selectedBlockId: null,
          selectedImageId: null,
          selectedAnnotationId: null,
          undoStack: [],
          redoStack: [],
          isDirty: false,
          openedAt: Date.now(),
        };

        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(tabId);

        await saveRecentFile(fileName, bytes.byteLength, proxy.numPages, originalCopy, filePath);
      } catch (err) {
        onError(formatPdfError(err));
      } finally {
        setIsLoading(false);
      }
    },
    [onError],
  );

  const markTabSaved = useCallback(
    (
      tabId: string,
      filePath?: string,
      fileName?: string,
      options?: { androidWritable?: boolean },
    ) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                ...(filePath ? { filePath } : {}),
                ...(fileName ? { fileName } : {}),
                ...(options?.androidWritable !== undefined
                  ? { androidWritable: options.androidWritable }
                  : {}),
                isDirty: false,
              }
            : tab,
        ),
      );
    },
    [],
  );

  const selectTab = useCallback((tabId: string | null) => {
    setActiveTabId(tabId);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    const proxy = proxyMapRef.current.get(tabId);
    if (proxy) {
      proxy.destroy().catch(() => undefined);
      proxyMapRef.current.delete(tabId);
      setProxyVersion((v) => v + 1);
    }

    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === tabId);
      if (index === -1) {
        return prev;
      }
      const next = prev.filter((t) => t.id !== tabId);

      setActiveTabId((currentActive) => {
        if (currentActive !== tabId) {
          return currentActive;
        }
        if (next.length === 0) {
          return null;
        }
        const fallbackIndex = Math.min(index, next.length - 1);
        return next[fallbackIndex].id;
      });

      return next;
    });
  }, []);

  const cycleTab = useCallback((direction: 1 | -1) => {
    setTabs((currentTabs) => {
      if (currentTabs.length === 0) {
        return currentTabs;
      }
      setActiveTabId((currentId) => {
        if (!currentId) {
          return currentTabs[0].id;
        }
        const idx = currentTabs.findIndex((t) => t.id === currentId);
        if (idx === -1) {
          return currentTabs[0].id;
        }
        const nextIdx = (idx + direction + currentTabs.length) % currentTabs.length;
        return currentTabs[nextIdx].id;
      });
      return currentTabs;
    });
  }, []);

  const updateTabZoom = useCallback((tabId: string, zoom: number, fitMode: FitMode = 'custom') => {
    const clamped = clampZoom(zoom);
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, zoom: clamped, fitMode } : tab)),
    );
  }, []);

  const updateTabPage = useCallback((tabId: string, page: number) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const safePage = Math.max(1, Math.min(tab.numPages, Math.floor(page)));
        if (safePage === tab.currentPage) {
          return tab;
        }
        return { ...tab, currentPage: safePage };
      }),
    );
  }, []);

  const updateTabScrollTop = useCallback((tabId: string, scrollTop: number) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, scrollTop } : tab)),
    );
  }, []);

  // --- Texte & OCR ---
  const initializePageBlocks = useCallback(
    (
      tabId: string,
      pageNumber: number,
      blocks: EditableTextBlock[],
      markAsOcr = false,
    ) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          if (!markAsOcr && tab.textBlocksByPage[pageNumber]) {
            return tab;
          }
          const nextOcrPages =
            markAsOcr && !tab.ocrPages.includes(pageNumber)
              ? [...tab.ocrPages, pageNumber]
              : tab.ocrPages;

          return {
            ...tab,
            textBlocksByPage: {
              ...tab.textBlocksByPage,
              [pageNumber]: blocks,
            },
            ocrPages: nextOcrPages,
          };
        }),
      );
    },
    [],
  );

  const selectTextBlock = useCallback((tabId: string, blockId: string | null) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        if (!blockId) {
          return { ...tab, selectedBlockId: null };
        }
        for (const list of Object.values(tab.textBlocksByPage)) {
          const found = list.find((b) => b.id === blockId);
          if (found) {
            return found.status === 'deleted'
              ? tab
              : {
                  ...tab,
                  selectedBlockId: blockId,
                  selectedImageId: null,
                  selectedAnnotationId: null,
                };
          }
        }
        return tab;
      }),
    );
  }, []);

  const commitBatchBlocksUpdate = useCallback(
    (
      tabId: string,
      label: string,
      updater: (
        blocksByPage: Record<number, EditableTextBlock[]>,
      ) => Record<number, EditableTextBlock[]>,
    ) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          const snapshot = makeSnapshot(tab, label);
          const nextBlocks = updater(cloneTextBlocksMap(tab.textBlocksByPage));
          let nextSelected = tab.selectedBlockId;
          if (nextSelected) {
            const stillVisible = Object.values(nextBlocks).some((list) =>
              list.some((b) => b.id === nextSelected && b.status !== 'deleted'),
            );
            if (!stillVisible) {
              nextSelected = null;
            }
          }

          return {
            ...tab,
            textBlocksByPage: nextBlocks,
            selectedBlockId: nextSelected,
            undoStack: [...tab.undoStack, snapshot],
            redoStack: [],
            isDirty: computeTabDirty(
              tab.currentBytes,
              tab.originalBytes,
              nextBlocks,
              tab.imageBlocksByPage,
              tab.annotationsByPage,
              tab.formFieldsByPage,
              tab.formValues,
            ),
          };
        }),
      );
    },
    [],
  );

  const commitBlockUpdate = useCallback(
    (
      tabId: string,
      blockId: string,
      label: string,
      updater: (block: EditableTextBlock) => EditableTextBlock,
      backgroundPatch?: BackgroundPatch,
    ) => {
      commitBatchBlocksUpdate(tabId, label, (blocksByPage) => {
        for (const [pageKey, list] of Object.entries(blocksByPage)) {
          const idx = list.findIndex((b) => b.id === blockId);
          if (idx !== -1) {
            const existing = list[idx];
            const withPatch: EditableTextBlock = {
              ...existing,
              backgroundPatch: existing.backgroundPatch ?? backgroundPatch,
            };
            const updated = updater(withPatch);
            const nextList = [...list];
            nextList[idx] = updated;
            blocksByPage[Number(pageKey)] = nextList;
            break;
          }
        }
        return blocksByPage;
      });
    },
    [commitBatchBlocksUpdate],
  );

  const deleteTextBlock = useCallback(
    (tabId: string, blockId: string, backgroundPatch?: BackgroundPatch) => {
      commitBlockUpdate(
        tabId,
        blockId,
        'Supprimer le texte',
        (block) => ({
          ...block,
          status: 'deleted',
          currentText: '',
        }),
        backgroundPatch,
      );
    },
    [commitBlockUpdate],
  );

  const restoreOriginalTextBlock = useCallback((tabId: string, blockId: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const snapshot = makeSnapshot(tab, "Rétablir le texte d'origine");
        const nextBlocks = cloneTextBlocksMap(tab.textBlocksByPage);
        for (const [pageKey, list] of Object.entries(nextBlocks)) {
          const idx = list.findIndex((b) => b.id === blockId);
          if (idx !== -1) {
            const target = list[idx];
            list[idx] = {
              ...target,
              status: 'original',
              currentText: target.originalText,
              x: target.origX,
              y: target.origY,
              width: target.origWidth,
              height: target.origHeight,
              style: { ...target.originalStyle },
            };
            nextBlocks[Number(pageKey)] = [...list];
            break;
          }
        }

        return {
          ...tab,
          textBlocksByPage: nextBlocks,
          selectedBlockId: blockId,
          undoStack: [...tab.undoStack, snapshot],
          redoStack: [],
          isDirty: computeTabDirty(
            tab.currentBytes,
            tab.originalBytes,
            nextBlocks,
            tab.imageBlocksByPage,
            tab.annotationsByPage,
            tab.formFieldsByPage,
            tab.formValues,
          ),
        };
      }),
    );
  }, []);

  // --- Images (Étape A3) ---
  const initializePageImages = useCallback(
    (tabId: string, pageNumber: number, images: EditableImageBlock[]) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId || tab.imageBlocksByPage[pageNumber]) {
            return tab;
          }
          return {
            ...tab,
            imageBlocksByPage: {
              ...tab.imageBlocksByPage,
              [pageNumber]: images,
            },
          };
        }),
      );
    },
    [],
  );

  const selectImageBlock = useCallback((tabId: string, imageId: string | null) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        if (!imageId) {
          return { ...tab, selectedImageId: null };
        }
        for (const list of Object.values(tab.imageBlocksByPage)) {
          const found = list.find((img) => img.id === imageId);
          if (found) {
            return found.status === 'deleted'
              ? tab
              : {
                  ...tab,
                  selectedImageId: imageId,
                  selectedBlockId: null,
                  selectedAnnotationId: null,
                };
          }
        }
        return tab;
      }),
    );
  }, []);

  const commitImageUpdate = useCallback(
    (
      tabId: string,
      imageId: string,
      label: string,
      updater: (img: EditableImageBlock) => EditableImageBlock,
      backgroundPatch?: BackgroundPatch,
    ) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          const snapshot = makeSnapshot(tab, label);
          const nextImages = cloneImageBlocksMap(tab.imageBlocksByPage);
          for (const [pageKey, list] of Object.entries(nextImages)) {
            const idx = list.findIndex((img) => img.id === imageId);
            if (idx !== -1) {
              const existing = list[idx];
              const withPatch: EditableImageBlock = {
                ...existing,
                backgroundPatch: existing.backgroundPatch ?? backgroundPatch,
              };
              const updated = updater(withPatch);
              const nextList = [...list];
              nextList[idx] = updated;
              nextImages[Number(pageKey)] = nextList;
              break;
            }
          }

          let nextSel = tab.selectedImageId;
          if (nextSel) {
            const stillVisible = Object.values(nextImages).some((list) =>
              list.some((img) => img.id === nextSel && img.status !== 'deleted'),
            );
            if (!stillVisible) {
              nextSel = null;
            }
          }

          return {
            ...tab,
            imageBlocksByPage: nextImages,
            selectedImageId: nextSel,
            undoStack: [...tab.undoStack, snapshot],
            redoStack: [],
            isDirty: computeTabDirty(
              tab.currentBytes,
              tab.originalBytes,
              tab.textBlocksByPage,
              nextImages,
              tab.annotationsByPage,
              tab.formFieldsByPage,
              tab.formValues,
            ),
          };
        }),
      );
    },
    [],
  );

  const deleteImageBlock = useCallback(
    (tabId: string, imageId: string, backgroundPatch?: BackgroundPatch) => {
      commitImageUpdate(
        tabId,
        imageId,
        "Supprimer l'image",
        (img) => ({
          ...img,
          status: 'deleted',
        }),
        backgroundPatch,
      );
    },
    [commitImageUpdate],
  );

  const restoreOriginalImageBlock = useCallback((tabId: string, imageId: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const snapshot = makeSnapshot(tab, "Remettre l'image à sa place d'origine");
        const nextImages = cloneImageBlocksMap(tab.imageBlocksByPage);
        for (const [pageKey, list] of Object.entries(nextImages)) {
          const idx = list.findIndex((img) => img.id === imageId);
          if (idx !== -1) {
            const target = list[idx];
            if (target.source !== 'pdf') {
              nextImages[Number(pageKey)] = list.filter((img) => img.id !== imageId);
            } else {
              list[idx] = {
                ...target,
                status: 'original',
                x: target.origX,
                y: target.origY,
                width: target.origWidth,
                height: target.origHeight,
                rotation: 0,
                imageDataUrl: target.origImageDataUrl,
              };
              nextImages[Number(pageKey)] = [...list];
            }
            break;
          }
        }

        return {
          ...tab,
          imageBlocksByPage: nextImages,
          selectedImageId: imageId,
          undoStack: [...tab.undoStack, snapshot],
          redoStack: [],
          isDirty: computeTabDirty(
            tab.currentBytes,
            tab.originalBytes,
            tab.textBlocksByPage,
            nextImages,
            tab.annotationsByPage,
            tab.formFieldsByPage,
            tab.formValues,
          ),
        };
      }),
    );
  }, []);

  const copyImageToAllPages = useCallback((tabId: string, imageId: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        let sourceImg: EditableImageBlock | null = null;
        for (const list of Object.values(tab.imageBlocksByPage)) {
          const found = list.find((img) => img.id === imageId && img.status !== 'deleted');
          if (found) {
            sourceImg = found;
            break;
          }
        }
        if (!sourceImg) {
          return tab;
        }
        const snapshot = makeSnapshot(tab, "Copier l'image sur toutes les pages");
        const nextImages = cloneImageBlocksMap(tab.imageBlocksByPage);

        for (let p = 1; p <= tab.numPages; p += 1) {
          if (p === sourceImg.pageNumber) {
            continue;
          }
          const copyBlock: EditableImageBlock = {
            id: createId('imgcp'),
            pageNumber: p,
            source: 'copied',
            status: 'modified',
            origX: sourceImg.x,
            origY: sourceImg.y,
            origWidth: sourceImg.width,
            origHeight: sourceImg.height,
            x: sourceImg.x,
            y: sourceImg.y,
            width: sourceImg.width,
            height: sourceImg.height,
            rotation: sourceImg.rotation,
            origImageDataUrl: sourceImg.imageDataUrl,
            imageDataUrl: sourceImg.imageDataUrl,
          };
          nextImages[p] = [...(nextImages[p] ?? []), copyBlock];
        }

        return {
          ...tab,
          imageBlocksByPage: nextImages,
          undoStack: [...tab.undoStack, snapshot],
          redoStack: [],
          isDirty: true,
        };
      }),
    );
  }, []);

  const addNewImageToPage = useCallback(
    (
      tabId: string,
      pageNumber: number,
      dataUrl: string,
      widthPdf: number,
      heightPdf: number,
    ) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          const snapshot = makeSnapshot(tab, 'Ajouter une image');
          const nextImages = cloneImageBlocksMap(tab.imageBlocksByPage);
          const id = createId('imgadd');
          const newBlock: EditableImageBlock = {
            id,
            pageNumber,
            source: 'added',
            status: 'modified',
            origX: 72,
            origY: 96,
            origWidth: widthPdf,
            origHeight: heightPdf,
            x: 72,
            y: 96,
            width: widthPdf,
            height: heightPdf,
            rotation: 0,
            origImageDataUrl: dataUrl,
            imageDataUrl: dataUrl,
          };
          nextImages[pageNumber] = [...(nextImages[pageNumber] ?? []), newBlock];
          return {
            ...tab,
            imageBlocksByPage: nextImages,
            selectedImageId: id,
            selectedBlockId: null,
            selectedAnnotationId: null,
            undoStack: [...tab.undoStack, snapshot],
            redoStack: [],
            isDirty: true,
          };
        }),
      );
    },
    [],
  );

  // --- Formulaires AcroForm (Étape A4) ---
  const initializePageFormFields = useCallback(
    (
      tabId: string,
      pageNumber: number,
      fields: PdfFormField[],
      defaults: Record<string, string | boolean>,
    ) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId || tab.formFieldsByPage[pageNumber]) {
            return tab;
          }
          const mergedValues = { ...defaults, ...tab.formValues };
          return {
            ...tab,
            formFieldsByPage: {
              ...tab.formFieldsByPage,
              [pageNumber]: fields,
            },
            formValues: mergedValues,
          };
        }),
      );
    },
    [],
  );

  const updateFormValue = useCallback(
    (tabId: string, fieldName: string, value: string | boolean) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId || tab.formValues[fieldName] === value) {
            return tab;
          }
          const snapshot = makeSnapshot(tab, 'Remplir le formulaire');
          const nextValues = { ...tab.formValues, [fieldName]: value };
          return {
            ...tab,
            formValues: nextValues,
            undoStack: [...tab.undoStack, snapshot],
            redoStack: [],
            isDirty: computeTabDirty(
              tab.currentBytes,
              tab.originalBytes,
              tab.textBlocksByPage,
              tab.imageBlocksByPage,
              tab.annotationsByPage,
              tab.formFieldsByPage,
              nextValues,
            ),
          };
        }),
      );
    },
    [],
  );

  // --- Annotations, signatures, remplissage libre & caviardage (Étape A4) ---
  const selectAnnotation = useCallback((tabId: string, annotationId: string | null) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        return {
          ...tab,
          selectedAnnotationId: annotationId,
          ...(annotationId ? { selectedBlockId: null, selectedImageId: null } : {}),
        };
      }),
    );
  }, []);

  const addAnnotation = useCallback(
    (tabId: string, annotation: PageAnnotation, label: string) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          const snapshot = makeSnapshot(tab, label);
          const nextAnnots = cloneAnnotationsMap(tab.annotationsByPage);
          nextAnnots[annotation.pageNumber] = [
            ...(nextAnnots[annotation.pageNumber] ?? []),
            annotation,
          ];
          return {
            ...tab,
            annotationsByPage: nextAnnots,
            selectedAnnotationId: annotation.id,
            selectedBlockId: null,
            selectedImageId: null,
            undoStack: [...tab.undoStack, snapshot],
            redoStack: [],
            isDirty: true,
          };
        }),
      );
    },
    [],
  );

  const updateAnnotation = useCallback(
    (
      tabId: string,
      annotationId: string,
      label: string,
      updater: (ann: PageAnnotation) => PageAnnotation,
    ) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          const snapshot = makeSnapshot(tab, label);
          const nextAnnots = cloneAnnotationsMap(tab.annotationsByPage);
          for (const [pk, list] of Object.entries(nextAnnots)) {
            const idx = list.findIndex((a) => a.id === annotationId);
            if (idx !== -1) {
              const nextList = [...list];
              nextList[idx] = updater(list[idx]);
              nextAnnots[Number(pk)] = nextList;
              break;
            }
          }
          return {
            ...tab,
            annotationsByPage: nextAnnots,
            undoStack: [...tab.undoStack, snapshot],
            redoStack: [],
            isDirty: computeTabDirty(
              tab.currentBytes,
              tab.originalBytes,
              tab.textBlocksByPage,
              tab.imageBlocksByPage,
              nextAnnots,
              tab.formFieldsByPage,
              tab.formValues,
            ),
          };
        }),
      );
    },
    [],
  );

  const deleteAnnotation = useCallback((tabId: string, annotationId: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const snapshot = makeSnapshot(tab, "Supprimer l'annotation");
        const nextAnnots = cloneAnnotationsMap(tab.annotationsByPage);
        for (const [pk, list] of Object.entries(nextAnnots)) {
          if (list.some((a) => a.id === annotationId)) {
            nextAnnots[Number(pk)] = list.filter((a) => a.id !== annotationId);
            break;
          }
        }
        return {
          ...tab,
          annotationsByPage: nextAnnots,
          selectedAnnotationId:
            tab.selectedAnnotationId === annotationId ? null : tab.selectedAnnotationId,
          undoStack: [...tab.undoStack, snapshot],
          redoStack: [],
          isDirty: computeTabDirty(
            tab.currentBytes,
            tab.originalBytes,
            tab.textBlocksByPage,
            tab.imageBlocksByPage,
            nextAnnots,
            tab.formFieldsByPage,
            tab.formValues,
          ),
        };
      }),
    );
  }, []);

  // --- Pages & compression (Étape A5) ---
  const commitDocumentBytesChange = useCallback(
    async (
      tabId: string,
      label: string,
      nextBytes: Uint8Array,
      maps?: {
        textBlocksByPage?: Record<number, EditableTextBlock[]>;
        imageBlocksByPage?: Record<number, EditableImageBlock[]>;
        annotationsByPage?: Record<number, PageAnnotation[]>;
        targetPage?: number;
        clearExtractedFormFields?: boolean;
      },
    ) => {
      const nextProxy = await replaceProxy(tabId, nextBytes);
      const nextNumPages = nextProxy.numPages;

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          const snapshot = makeSnapshot(tab, label);
          const nextText = maps?.textBlocksByPage ?? cloneTextBlocksMap(tab.textBlocksByPage);
          const nextImgs = maps?.imageBlocksByPage ?? cloneImageBlocksMap(tab.imageBlocksByPage);
          const nextAnnots = maps?.annotationsByPage ?? cloneAnnotationsMap(tab.annotationsByPage);
          const nextFormFields = maps?.clearExtractedFormFields ? {} : tab.formFieldsByPage;

          return {
            ...tab,
            currentBytes: nextBytes,
            fileSize: nextBytes.byteLength,
            numPages: nextNumPages,
            currentPage: Math.max(1, Math.min(nextNumPages, maps?.targetPage ?? tab.currentPage)),
            textBlocksByPage: nextText,
            imageBlocksByPage: nextImgs,
            annotationsByPage: nextAnnots,
            formFieldsByPage: nextFormFields,
            selectedBlockId: null,
            selectedImageId: null,
            selectedAnnotationId: null,
            undoStack: [...tab.undoStack, snapshot],
            redoStack: [],
            isDirty: true,
          };
        }),
      );
    },
    [replaceProxy],
  );

  // --- Historique Annuler / Rétablir atomique par onglet (exécuté en file FIFO pour éviter toute perte si clics rapides) ---
  const applyHistoryDirection = useCallback(
    (tabId: string, direction: 'undo' | 'redo') => {
      const task = historyQueueRef.current.then(async () => {
        const target = tabsRef.current.find((t) => t.id === tabId);
        if (!target) {
          return;
        }
        const sourceStack = direction === 'undo' ? target.undoStack : target.redoStack;
        if (sourceStack.length === 0) {
          return;
        }
        const entry = sourceStack[sourceStack.length - 1];
        const needsProxyReload = entry.bytes !== target.currentBytes;
        let nextNumPages = target.numPages;

        if (needsProxyReload) {
          const proxy = await replaceProxy(tabId, entry.bytes);
          nextNumPages = proxy.numPages;
        }

        const updater = (prev: TabDocument[]): TabDocument[] => {
          const nextTabs = prev.map((tab) => {
            if (tab.id !== tabId) {
              return tab;
            }
            const curStack = direction === 'undo' ? tab.undoStack : tab.redoStack;
            if (curStack.length === 0) {
              return tab;
            }
            const top = curStack[curStack.length - 1];
            const inverseEntry = makeSnapshot(tab, top.label);

            const restoredText = cloneTextBlocksMap(top.textBlocksByPage);
            const restoredImages = cloneImageBlocksMap(top.imageBlocksByPage);
            const restoredAnnots = cloneAnnotationsMap(top.annotationsByPage);
            const restoredForm = { ...top.formValues };

            const restoredTextSel =
              top.selectedBlockId &&
              Object.values(restoredText).some((l) =>
                l.some((b) => b.id === top.selectedBlockId && b.status !== 'deleted'),
              )
                ? top.selectedBlockId
                : null;
            const restoredImgSel =
              top.selectedImageId &&
              Object.values(restoredImages).some((l) =>
                l.some((i) => i.id === top.selectedImageId && i.status !== 'deleted'),
              )
                ? top.selectedImageId
                : null;
            const restoredAnnSel =
              top.selectedAnnotationId &&
              Object.values(restoredAnnots).some((l) =>
                l.some((a) => a.id === top.selectedAnnotationId),
              )
                ? top.selectedAnnotationId
                : null;

            return {
              ...tab,
              currentBytes: top.bytes,
              fileSize: top.bytes.byteLength,
              numPages: nextNumPages,
              currentPage: Math.min(tab.currentPage, nextNumPages),
              textBlocksByPage: restoredText,
              imageBlocksByPage: restoredImages,
              annotationsByPage: restoredAnnots,
              formValues: restoredForm,
              formFieldsByPage: needsProxyReload ? {} : tab.formFieldsByPage,
              selectedBlockId: restoredTextSel,
              selectedImageId: restoredImgSel,
              selectedAnnotationId: restoredAnnSel,
              undoStack:
                direction === 'undo' ? tab.undoStack.slice(0, -1) : [...tab.undoStack, inverseEntry],
              redoStack:
                direction === 'undo' ? [...tab.redoStack, inverseEntry] : tab.redoStack.slice(0, -1),
              isDirty: computeTabDirty(
                top.bytes,
                tab.originalBytes,
                restoredText,
                restoredImages,
                restoredAnnots,
                tab.formFieldsByPage,
                restoredForm,
              ),
            };
          });
          tabsRef.current = nextTabs;
          return nextTabs;
        };

        setTabs(updater);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      historyQueueRef.current = task.catch(() => undefined);
      return task;
    },
    [replaceProxy],
  );

  const undoTab = useCallback(
    (tabId: string) => applyHistoryDirection(tabId, 'undo'),
    [applyHistoryDirection],
  );

  const redoTab = useCallback(
    (tabId: string) => applyHistoryDirection(tabId, 'redo'),
    [applyHistoryDirection],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activePdfProxy = activeTabId ? proxyMapRef.current.get(activeTabId) ?? null : null;

  return {
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
  };
}
