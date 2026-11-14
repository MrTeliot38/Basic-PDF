// Lecteur et éditeur PDF fluide : rendu haute définition, texte, images, formulaires, annotations, Ctrl+molette et pincement tactile
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type {
  BackgroundPatch,
  EditableImageBlock,
  EditableTextBlock,
  EditorToolMode,
  FitMode,
  PageAnnotation,
  PdfFormField,
  SearchMatch,
  TabDocument,
} from '../types/pdf';
import { clampZoom } from '../utils/formatters';
import { extractBackgroundPatch, extractImageHolePatch } from '../utils/backgroundPreserver';
import { extractPageFormFields } from '../utils/pdfFormExtractor';
import { extractSelectableImages } from '../utils/pdfImageExtractor';
import { extractNativeTextBlocks } from '../utils/pdfTextExtractor';
import { AnnotationsOverlayLayer } from './AnnotationsOverlayLayer';
import { FormFieldsLayer } from './FormFieldsLayer';
import { ImageOverlayLayer } from './ImageOverlayLayer';
import { TextOverlayLayer } from './TextOverlayLayer';

interface PageDimension {
  width: number;
  height: number;
}

export interface ScrollRequest {
  page: number;
  nonce: number;
}

interface PdfViewerProps {
  tab: TabDocument;
  pdfProxy: PDFDocumentProxy;
  toolMode: EditorToolMode;
  editingBlockId: string | null;
  activeToolColor: string;
  activeStrokeWidth: number;
  activeStampText: string;
  pendingSignatureUrl: string | null;
  searchMatches: SearchMatch[];
  activeSearchMatch: SearchMatch | null;
  scrollRequest: ScrollRequest | null;
  onUpdateZoom: (tabId: string, zoom: number, fitMode?: FitMode) => void;
  onUpdatePage: (tabId: string, page: number) => void;
  onUpdateScrollTop: (tabId: string, scrollTop: number) => void;
  // Texte
  onPageTextExtracted: (pageNumber: number, blocks: EditableTextBlock[]) => void;
  onSelectBlock: (blockId: string | null) => void;
  onStartEditing: (blockId: string) => void;
  onFinishEditing: (blockId: string, nextText: string, patch?: BackgroundPatch) => void;
  onMoveOrResizeBlock: (
    blockId: string,
    nextRect: { x: number; y: number; width: number; height: number },
    label: string,
    patch?: BackgroundPatch,
  ) => void;
  // Images
  onPageImagesExtracted: (pageNumber: number, images: EditableImageBlock[]) => void;
  onSelectImage: (imageId: string | null) => void;
  onMoveOrResizeImage: (
    imageId: string,
    nextRect: { x: number; y: number; width: number; height: number },
    label: string,
    patch?: BackgroundPatch,
  ) => void;
  // Formulaires & annotations
  onPageFormFieldsExtracted: (
    pageNumber: number,
    fields: PdfFormField[],
    defaults: Record<string, string | boolean>,
  ) => void;
  onChangeFormValue: (fieldName: string, value: string | boolean) => void;
  onSelectAnnotation: (annotationId: string | null) => void;
  onAddAnnotation: (ann: PageAnnotation, label: string) => void;
  onUpdateAnnotation: (
    annotationId: string,
    label: string,
    updater: (ann: PageAnnotation) => PageAnnotation,
  ) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSignaturePlaced: () => void;
  onRegisterCanvasHelper: (
    helper: (
      pageNumber: number,
      target: {
        kind: 'text' | 'image';
        origX: number;
        origY: number;
        origWidth: number;
        origHeight: number;
        backgroundPatch?: BackgroundPatch;
      },
    ) => Promise<BackgroundPatch | undefined>,
  ) => void;
}

interface PdfPageCanvasProps {
  pdfProxy: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  height: number;
  zoom: number;
  toolMode: EditorToolMode;
  blocks: EditableTextBlock[];
  images: EditableImageBlock[];
  annotations: PageAnnotation[];
  formFields: PdfFormField[];
  formValues: Record<string, string | boolean>;
  hasExtractedBlocks: boolean;
  hasExtractedImages: boolean;
  hasExtractedForms: boolean;
  selectedBlockId: string | null;
  selectedImageId: string | null;
  selectedAnnotationId: string | null;
  editingBlockId: string | null;
  activeToolColor: string;
  activeStrokeWidth: number;
  activeStampText: string;
  pendingSignatureUrl: string | null;
  searchMatches: SearchMatch[];
  activeSearchMatch: SearchMatch | null;
  registerRef: (page: number, el: HTMLDivElement | null) => void;
  registerCanvas: (
    page: number,
    entry: { canvas: HTMLCanvasElement; scale: number } | null,
  ) => void;
  onPageTextExtracted: (pageNumber: number, blocks: EditableTextBlock[]) => void;
  onPageImagesExtracted: (pageNumber: number, images: EditableImageBlock[]) => void;
  onPageFormFieldsExtracted: (
    pageNumber: number,
    fields: PdfFormField[],
    defaults: Record<string, string | boolean>,
  ) => void;
  onSelectBlock: (blockId: string | null) => void;
  onStartEditing: (blockId: string) => void;
  onFinishEditing: (blockId: string, nextText: string, patch?: BackgroundPatch) => void;
  onMoveOrResizeBlock: (
    blockId: string,
    nextRect: { x: number; y: number; width: number; height: number },
    label: string,
    patch?: BackgroundPatch,
  ) => void;
  onSelectImage: (imageId: string | null) => void;
  onMoveOrResizeImage: (
    imageId: string,
    nextRect: { x: number; y: number; width: number; height: number },
    label: string,
    patch?: BackgroundPatch,
  ) => void;
  onChangeFormValue: (fieldName: string, value: string | boolean) => void;
  onSelectAnnotation: (annotationId: string | null) => void;
  onAddAnnotation: (ann: PageAnnotation, label: string) => void;
  onUpdateAnnotation: (
    annotationId: string,
    label: string,
    updater: (ann: PageAnnotation) => PageAnnotation,
  ) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSignaturePlaced: () => void;
  onRequestTextPatch: (block: EditableTextBlock) => BackgroundPatch | undefined;
  onRequestImagePatch: (img: EditableImageBlock) => BackgroundPatch | undefined;
}

function PdfPageCanvas({
  pdfProxy,
  pageNumber,
  width,
  height,
  zoom,
  toolMode,
  blocks,
  images,
  annotations,
  formFields,
  formValues,
  hasExtractedBlocks,
  hasExtractedImages,
  hasExtractedForms,
  selectedBlockId,
  selectedImageId,
  selectedAnnotationId,
  editingBlockId,
  activeToolColor,
  activeStrokeWidth,
  activeStampText,
  pendingSignatureUrl,
  searchMatches,
  activeSearchMatch,
  registerRef,
  registerCanvas,
  onPageTextExtracted,
  onPageImagesExtracted,
  onPageFormFieldsExtracted,
  onSelectBlock,
  onStartEditing,
  onFinishEditing,
  onMoveOrResizeBlock,
  onSelectImage,
  onMoveOrResizeImage,
  onChangeFormValue,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onSignaturePlaced,
  onRequestTextPatch,
  onRequestImagePatch,
}: PdfPageCanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  // Conserve l'état courant des extractions sans relancer un rendu inutile à chaque fin d'extraction
  const flagsRef = useRef({
    blocks,
    hasExtractedBlocks,
    hasExtractedImages,
    hasExtractedForms,
  });
  flagsRef.current = { blocks, hasExtractedBlocks, hasExtractedImages, hasExtractedForms };

  useEffect(() => {
    const node = frameRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(Boolean(entries[0]?.isIntersecting));
      },
      { rootMargin: '450px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    (async () => {
      try {
        const page = await pdfProxy.getPage(pageNumber);
        if (cancelled) {
          return;
        }
        const viewport = page.getViewport({ scale: zoom });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        renderTask = page.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled) {
          setRendered(true);
          const totalScale = zoom * dpr;
          registerCanvas(pageNumber, { canvas, scale: totalScale });

          let currentBlocks = flagsRef.current.blocks;
          if (!flagsRef.current.hasExtractedBlocks) {
            currentBlocks = await extractNativeTextBlocks(page, pageNumber, canvas, totalScale);
            if (!cancelled) {
              onPageTextExtracted(pageNumber, currentBlocks);
            }
          }

          if (!cancelled && !flagsRef.current.hasExtractedImages) {
            const imgs = await extractSelectableImages(
              page,
              pageNumber,
              currentBlocks,
              canvas,
              totalScale,
            );
            if (!cancelled) {
              onPageImagesExtracted(pageNumber, imgs);
            }
          }

          if (!cancelled && !flagsRef.current.hasExtractedForms) {
            const { fields, values } = await extractPageFormFields(page, pageNumber);
            if (!cancelled) {
              onPageFormFieldsExtracted(pageNumber, fields, values);
            }
          }
        }
      } catch {
        // Annulation attendue si le zoom change pendant le tracé
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [
    isVisible,
    onPageFormFieldsExtracted,
    onPageImagesExtracted,
    onPageTextExtracted,
    pageNumber,
    pdfProxy,
    registerCanvas,
    zoom,
  ]);

  useEffect(() => {
    return () => {
      registerCanvas(pageNumber, null);
    };
  }, [pageNumber, registerCanvas]);

  const scaledWidth = Math.max(1, Math.floor(width * zoom));
  const scaledHeight = Math.max(1, Math.floor(height * zoom));

  return (
    <div
      ref={(el) => {
        frameRef.current = el;
        registerRef(pageNumber, el);
      }}
      className="pdf-page-frame"
      data-page-number={pageNumber}
      style={{ width: scaledWidth, height: scaledHeight }}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />

      <ImageOverlayLayer
        zoom={zoom}
        toolMode={toolMode}
        images={images}
        selectedImageId={selectedImageId}
        onSelectImage={onSelectImage}
        onMoveOrResizeImage={onMoveOrResizeImage}
        onRequestBackgroundPatch={onRequestImagePatch}
      />

      <TextOverlayLayer
        pageNumber={pageNumber}
        zoom={zoom}
        toolMode={toolMode}
        blocks={blocks}
        selectedBlockId={selectedBlockId}
        editingBlockId={editingBlockId}
        searchMatches={searchMatches}
        activeSearchMatch={activeSearchMatch}
        onSelectBlock={onSelectBlock}
        onStartEditing={onStartEditing}
        onFinishEditing={onFinishEditing}
        onMoveOrResizeBlock={onMoveOrResizeBlock}
        onRequestBackgroundPatch={onRequestTextPatch}
      />

      <FormFieldsLayer
        zoom={zoom}
        fields={formFields}
        values={formValues}
        disabled={toolMode !== 'view'}
        onChangeValue={onChangeFormValue}
      />

      <AnnotationsOverlayLayer
        pageNumber={pageNumber}
        pageWidth={width}
        pageHeight={height}
        zoom={zoom}
        toolMode={toolMode}
        activeColor={activeToolColor}
        activeStrokeWidth={activeStrokeWidth}
        activeStampText={activeStampText}
        pendingSignatureUrl={pendingSignatureUrl}
        annotations={annotations}
        selectedAnnotationId={selectedAnnotationId}
        onSelectAnnotation={onSelectAnnotation}
        onAddAnnotation={onAddAnnotation}
        onUpdateAnnotation={onUpdateAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onSignaturePlaced={onSignaturePlaced}
      />

      {!rendered && (
        <span
          className="pdf-page-loading"
          style={{ position: 'absolute', pointerEvents: 'none' }}
        >
          Chargement de la page {pageNumber}…
        </span>
      )}
    </div>
  );
}

export function PdfViewer({
  tab,
  pdfProxy,
  toolMode,
  editingBlockId,
  activeToolColor,
  activeStrokeWidth,
  activeStampText,
  pendingSignatureUrl,
  searchMatches,
  activeSearchMatch,
  scrollRequest,
  onUpdateZoom,
  onUpdatePage,
  onUpdateScrollTop,
  onPageTextExtracted,
  onSelectBlock,
  onStartEditing,
  onFinishEditing,
  onMoveOrResizeBlock,
  onPageImagesExtracted,
  onSelectImage,
  onMoveOrResizeImage,
  onPageFormFieldsExtracted,
  onChangeFormValue,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onSignaturePlaced,
  onRegisterCanvasHelper,
}: PdfViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const pageCanvasesRef = useRef<Map<number, { canvas: HTMLCanvasElement; scale: number }>>(
    new Map(),
  );
  const [pageDimensions, setPageDimensions] = useState<PageDimension[]>([]);
  const restoredTabIdRef = useRef<string | null>(null);

  const pinchStateRef = useRef<{
    startDistance: number;
    startZoom: number;
    previewRatio: number;
  } | null>(null);
  const [pinchPreviewScale, setPinchPreviewScale] = useState(1);

  const registerPageRef = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) {
      pageElementsRef.current.set(page, el);
    } else {
      pageElementsRef.current.delete(page);
    }
  }, []);

  const registerCanvas = useCallback(
    (page: number, entry: { canvas: HTMLCanvasElement; scale: number } | null) => {
      if (entry) {
        pageCanvasesRef.current.set(page, entry);
      } else {
        pageCanvasesRef.current.delete(page);
      }
    },
    [],
  );

  const getTextPatchSync = useCallback((block: EditableTextBlock): BackgroundPatch | undefined => {
    if (block.backgroundPatch) {
      return block.backgroundPatch;
    }
    const entry = pageCanvasesRef.current.get(block.pageNumber);
    if (!entry) {
      return undefined;
    }
    return extractBackgroundPatch(
      entry.canvas,
      {
        x: block.origX,
        y: block.origY,
        width: block.origWidth,
        height: block.origHeight,
      },
      entry.scale,
    );
  }, []);

  const getImagePatchSync = useCallback((img: EditableImageBlock): BackgroundPatch | undefined => {
    if (img.backgroundPatch) {
      return img.backgroundPatch;
    }
    const entry = pageCanvasesRef.current.get(img.pageNumber);
    if (!entry) {
      return undefined;
    }
    return extractImageHolePatch(
      entry.canvas,
      {
        x: img.origX,
        y: img.origY,
        width: img.origWidth,
        height: img.origHeight,
      },
      entry.scale,
    );
  }, []);

  useEffect(() => {
    const helper = async (
      pageNumber: number,
      target: {
        kind: 'text' | 'image';
        origX: number;
        origY: number;
        origWidth: number;
        origHeight: number;
        backgroundPatch?: BackgroundPatch;
      },
    ): Promise<BackgroundPatch | undefined> => {
      if (target.backgroundPatch) {
        return target.backgroundPatch;
      }
      const cached = pageCanvasesRef.current.get(pageNumber);
      const extractFn = target.kind === 'image' ? extractImageHolePatch : extractBackgroundPatch;
      if (cached) {
        return extractFn(
          cached.canvas,
          {
            x: target.origX,
            y: target.origY,
            width: target.origWidth,
            height: target.origHeight,
          },
          cached.scale,
        );
      }
      const page = await pdfProxy.getPage(pageNumber);
      const offScale = 2;
      const vp = page.getViewport({ scale: offScale });
      const offCanvas = document.createElement('canvas');
      offCanvas.width = Math.max(1, Math.floor(vp.width));
      offCanvas.height = Math.max(1, Math.floor(vp.height));
      const ctx = offCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return undefined;
      }
      await page.render({ canvas: offCanvas, canvasContext: ctx, viewport: vp }).promise;
      return extractFn(
        offCanvas,
        {
          x: target.origX,
          y: target.origY,
          width: target.origWidth,
          height: target.origHeight,
        },
        offScale,
      );
    };

    onRegisterCanvasHelper(helper);
  }, [onRegisterCanvasHelper, pdfProxy]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dims: PageDimension[] = [];
      for (let i = 1; i <= pdfProxy.numPages; i += 1) {
        const page = await pdfProxy.getPage(i);
        if (cancelled) {
          return;
        }
        const vp = page.getViewport({ scale: 1 });
        dims.push({ width: vp.width, height: vp.height });
      }
      if (!cancelled) {
        setPageDimensions(dims);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfProxy]);

  const applyFitZoom = useCallback(
    (fitMode: FitMode) => {
      if (fitMode === 'custom' || pageDimensions.length === 0) {
        return;
      }
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }
      const refDim = pageDimensions[Math.max(0, tab.currentPage - 1)] ?? pageDimensions[0];
      const availableWidth = Math.max(180, container.clientWidth - 48);
      const availableHeight = Math.max(200, container.clientHeight - 56);

      if (fitMode === 'page-width') {
        const nextZoom = clampZoom(availableWidth / refDim.width);
        if (Math.abs(nextZoom - tab.zoom) > 0.01) {
          onUpdateZoom(tab.id, nextZoom, 'page-width');
        }
      } else if (fitMode === 'page-fit') {
        const nextZoom = clampZoom(
          Math.min(availableWidth / refDim.width, availableHeight / refDim.height),
        );
        if (Math.abs(nextZoom - tab.zoom) > 0.01) {
          onUpdateZoom(tab.id, nextZoom, 'page-fit');
        }
      }
    },
    [onUpdateZoom, pageDimensions, tab.currentPage, tab.fitMode, tab.id, tab.zoom],
  );

  useEffect(() => {
    if (tab.fitMode !== 'custom') {
      applyFitZoom(tab.fitMode);
    }
  }, [applyFitZoom, tab.fitMode, pageDimensions]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || tab.fitMode === 'custom') {
      return;
    }
    const observer = new ResizeObserver(() => {
      applyFitZoom(tab.fitMode);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applyFitZoom, tab.fitMode]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || pageDimensions.length === 0 || restoredTabIdRef.current === tab.id) {
      return;
    }
    restoredTabIdRef.current = tab.id;
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = tab.scrollTop;
      }
    });
  }, [pageDimensions.length, tab.id, tab.scrollTop]);

  useEffect(() => {
    if (!scrollRequest) {
      return;
    }
    const el = pageElementsRef.current.get(scrollRequest.page);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [scrollRequest]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    onUpdateScrollTop(tab.id, container.scrollTop);

    const viewportCenter = container.scrollTop + container.clientHeight * 0.4;
    let closestPage = tab.currentPage;
    let smallestDistance = Number.POSITIVE_INFINITY;

    for (const [pageNum, el] of pageElementsRef.current.entries()) {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (viewportCenter >= top && viewportCenter <= bottom) {
        closestPage = pageNum;
        break;
      }
      const dist = Math.min(
        Math.abs(viewportCenter - top),
        Math.abs(viewportCenter - bottom),
      );
      if (dist < smallestDistance) {
        smallestDistance = dist;
        closestPage = pageNum;
      }
    }

    if (closestPage !== tab.currentPage) {
      onUpdatePage(tab.id, closestPage);
    }
  };

  const zoomRef = useRef(tab.zoom);
  const tabIdRef = useRef(tab.id);
  zoomRef.current = tab.zoom;
  tabIdRef.current = tab.id;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      onUpdateZoom(tabIdRef.current, clampZoom(zoomRef.current * factor), 'custom');
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        pinchStateRef.current = {
          startDistance: Math.hypot(dx, dy),
          startZoom: zoomRef.current,
          previewRatio: 1,
        };
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const state = pinchStateRef.current;
      if (!state || event.touches.length !== 2) {
        return;
      }
      event.preventDefault();
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (state.startDistance <= 0) {
        return;
      }
      const rawRatio = dist / state.startDistance;
      const clampedTargetZoom = clampZoom(state.startZoom * rawRatio);
      const actualRatio = clampedTargetZoom / state.startZoom;
      state.previewRatio = actualRatio;
      setPinchPreviewScale(actualRatio);
    };

    const onTouchEnd = (event: TouchEvent) => {
      const state = pinchStateRef.current;
      if (!state || event.touches.length >= 2) {
        return;
      }
      const finalZoom = clampZoom(state.startZoom * state.previewRatio);
      pinchStateRef.current = null;
      setPinchPreviewScale(1);
      if (Math.abs(finalZoom - zoomRef.current) > 0.01) {
        onUpdateZoom(tabIdRef.current, finalZoom, 'custom');
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onUpdateZoom]);

  return (
    <div
      ref={scrollContainerRef}
      className="pdf-viewer-scroll"
      data-testid="pdf-viewer"
      onScroll={handleScroll}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (toolMode === 'select-text') onSelectBlock(null);
        if (toolMode === 'select-image') onSelectImage(null);
        onSelectAnnotation(null);
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
          transform: pinchPreviewScale !== 1 ? `scale(${pinchPreviewScale})` : undefined,
          transformOrigin: 'top center',
        }}
      >
        {pageDimensions.map((dim, idx) => {
          const pageNum = idx + 1;
          const pageBlocks = tab.textBlocksByPage[pageNum] ?? [];
          const pageImages = tab.imageBlocksByPage[pageNum] ?? [];
          const pageAnnots = tab.annotationsByPage[pageNum] ?? [];
          const pageForms = tab.formFieldsByPage[pageNum] ?? [];

          return (
            <PdfPageCanvas
              key={`${tab.id}-page-${pageNum}`}
              pdfProxy={pdfProxy}
              pageNumber={pageNum}
              width={dim.width}
              height={dim.height}
              zoom={tab.zoom}
              toolMode={toolMode}
              blocks={pageBlocks}
              images={pageImages}
              annotations={pageAnnots}
              formFields={pageForms}
              formValues={tab.formValues}
              hasExtractedBlocks={Boolean(tab.textBlocksByPage[pageNum])}
              hasExtractedImages={Boolean(tab.imageBlocksByPage[pageNum])}
              hasExtractedForms={Boolean(tab.formFieldsByPage[pageNum])}
              selectedBlockId={tab.selectedBlockId}
              selectedImageId={tab.selectedImageId}
              selectedAnnotationId={tab.selectedAnnotationId}
              editingBlockId={editingBlockId}
              activeToolColor={activeToolColor}
              activeStrokeWidth={activeStrokeWidth}
              activeStampText={activeStampText}
              pendingSignatureUrl={pendingSignatureUrl}
              searchMatches={searchMatches}
              activeSearchMatch={activeSearchMatch}
              registerRef={registerPageRef}
              registerCanvas={registerCanvas}
              onPageTextExtracted={onPageTextExtracted}
              onPageImagesExtracted={onPageImagesExtracted}
              onPageFormFieldsExtracted={onPageFormFieldsExtracted}
              onSelectBlock={onSelectBlock}
              onStartEditing={onStartEditing}
              onFinishEditing={onFinishEditing}
              onMoveOrResizeBlock={onMoveOrResizeBlock}
              onSelectImage={onSelectImage}
              onMoveOrResizeImage={onMoveOrResizeImage}
              onChangeFormValue={onChangeFormValue}
              onSelectAnnotation={onSelectAnnotation}
              onAddAnnotation={onAddAnnotation}
              onUpdateAnnotation={onUpdateAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onSignaturePlaced={onSignaturePlaced}
              onRequestTextPatch={getTextPatchSync}
              onRequestImagePatch={getImagePatchSync}
            />
          );
        })}
      </div>
    </div>
  );
}
