// Couche interactive des images par page : survol, sélection au clic, déplacement, redimensionnement par un coin et masquage du fond d'origine
import { useState } from 'react';
import type { BackgroundPatch, EditableImageBlock, EditorToolMode } from '../types/pdf';

interface ImageOverlayLayerProps {
  zoom: number;
  toolMode: EditorToolMode;
  images: EditableImageBlock[];
  selectedImageId: string | null;
  onSelectImage: (imageId: string | null) => void;
  onMoveOrResizeImage: (
    imageId: string,
    nextRect: { x: number; y: number; width: number; height: number },
    label: string,
    patch?: BackgroundPatch,
  ) => void;
  onRequestBackgroundPatch: (img: EditableImageBlock) => BackgroundPatch | undefined;
}

export function ImageOverlayLayer({
  zoom,
  toolMode,
  images,
  selectedImageId,
  onSelectImage,
  onMoveOrResizeImage,
  onRequestBackgroundPatch,
}: ImageOverlayLayerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    imageId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const startPointerDrag = (
    event: React.PointerEvent,
    img: EditableImageBlock,
    mode: 'move' | 'resize',
  ) => {
    if (toolMode !== 'select-image') {
      return;
    }
    event.stopPropagation();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const origX = img.x;
    const origY = img.y;
    const origW = img.width;
    const origH = img.height;
    let moved = false;

    const onPointerMove = (moveEvt: PointerEvent) => {
      const dxPdf = (moveEvt.clientX - startClientX) / zoom;
      const dyPdf = (moveEvt.clientY - startClientY) / zoom;
      if (!moved && Math.hypot(moveEvt.clientX - startClientX, moveEvt.clientY - startClientY) < 4) {
        return;
      }
      moved = true;
      if (mode === 'move') {
        setDragPreview({
          imageId: img.id,
          x: Math.max(0, origX + dxPdf),
          y: Math.max(0, origY + dyPdf),
          width: origW,
          height: origH,
        });
      } else {
        setDragPreview({
          imageId: img.id,
          x: origX,
          y: origY,
          width: Math.max(16, origW + dxPdf),
          height: Math.max(16, origH + dyPdf),
        });
      }
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setDragPreview(null);

      // Un simple clic sans déplacement (< 4 px) ne doit strictement rien modifier
      if (!moved) {
        return;
      }
      const dxPdf = (upEvt.clientX - startClientX) / zoom;
      const dyPdf = (upEvt.clientY - startClientY) / zoom;
      const patch =
        img.source === 'pdf'
          ? img.backgroundPatch ?? onRequestBackgroundPatch(img)
          : undefined;

      if (mode === 'move') {
        onMoveOrResizeImage(
          img.id,
          {
            x: Math.max(0, origX + dxPdf),
            y: Math.max(0, origY + dyPdf),
            width: origW,
            height: origH,
          },
          "Déplacer l'image",
          patch,
        );
      } else {
        onMoveOrResizeImage(
          img.id,
          {
            x: origX,
            y: origY,
            width: Math.max(16, origW + dxPdf),
            height: Math.max(16, origH + dyPdf),
          },
          "Redimensionner l'image",
          patch,
        );
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div
      className={`image-overlay-layer ${toolMode === 'select-image' ? 'is-select-mode' : ''}`}
      onClick={(event) => {
        if (toolMode === 'select-image' && event.target === event.currentTarget) {
          onSelectImage(null);
        }
      }}
    >
      {/* 1. Masquage propre de l'emplacement d'origine pour les images du PDF modifiées, déplacées ou supprimées */}
      {images.map((img) => {
        const hasGeometryChange =
          Math.abs(img.x - img.origX) > 0.5 ||
          Math.abs(img.y - img.origY) > 0.5 ||
          Math.abs(img.width - img.origWidth) > 0.5 ||
          Math.abs(img.height - img.origHeight) > 0.5;
        const shouldMaskOriginal =
          img.source === 'pdf' &&
          (img.status !== 'original' || img.rotation !== 0 || hasGeometryChange);

        if (!shouldMaskOriginal || !img.backgroundPatch?.dataUrl) {
          return null;
        }
        const p = img.backgroundPatch;
        return (
          <img
            key={`img-patch-${img.id}`}
            src={p.dataUrl}
            alt=""
            aria-hidden="true"
            className="text-bg-patch"
            data-testid={`img-bg-patch-${img.id}`}
            style={{
              left: p.x * zoom,
              top: p.y * zoom,
              width: p.width * zoom,
              height: p.height * zoom,
            }}
          />
        );
      })}

      {/* 2. Blocs image visibles et sélectionnables */}
      {images.map((img) => {
        if (img.status === 'deleted') {
          return null;
        }

        const isSelected = img.id === selectedImageId;
        const isHovered = toolMode === 'select-image' && img.id === hoveredId;
        const hasGeometryChange =
          Math.abs(img.x - img.origX) > 0.5 ||
          Math.abs(img.y - img.origY) > 0.5 ||
          Math.abs(img.width - img.origWidth) > 0.5 ||
          Math.abs(img.height - img.origHeight) > 0.5;
        const showRenderedImage =
          img.source !== 'pdf' ||
          img.status === 'modified' ||
          img.rotation !== 0 ||
          hasGeometryChange;

        const rect =
          dragPreview && dragPreview.imageId === img.id
            ? dragPreview
            : { x: img.x, y: img.y, width: img.width, height: img.height };

        const interactive = toolMode === 'select-image' || isSelected;

        return (
          <div
            key={img.id}
            data-testid={`image-block-${img.id}`}
            data-image-status={img.status}
            data-image-rotation={img.rotation}
            className={[
              'editable-image-block',
              isHovered ? 'is-hovered' : '',
              isSelected ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: rect.x * zoom,
              top: rect.y * zoom,
              width: Math.max(16, rect.width * zoom),
              height: Math.max(16, rect.height * zoom),
              pointerEvents: interactive ? 'auto' : 'none',
            }}
            onMouseEnter={() => {
              if (toolMode === 'select-image') {
                setHoveredId(img.id);
              }
            }}
            onMouseLeave={() => {
              if (hoveredId === img.id) {
                setHoveredId(null);
              }
            }}
            onPointerDown={(event) => {
              if (toolMode !== 'select-image') {
                return;
              }
              event.stopPropagation();
              if (!isSelected) {
                onSelectImage(img.id);
              } else {
                startPointerDrag(event, img, 'move');
              }
            }}
            onClick={(event) => {
              if (toolMode !== 'select-image') {
                return;
              }
              event.stopPropagation();
              if (!isSelected) {
                onSelectImage(img.id);
              }
            }}
          >
            {showRenderedImage && (
              <img
                src={img.imageDataUrl}
                alt="Image modifiée dans le document"
                className="rendered-edited-image"
                draggable={false}
                style={
                  img.rotation % 180 !== 0
                    ? {
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: Math.max(16, rect.height * zoom),
                        height: Math.max(16, rect.width * zoom),
                        transform: `translate(-50%, -50%) rotate(${img.rotation}deg)`,
                      }
                    : {
                        transform: img.rotation !== 0 ? `rotate(${img.rotation}deg)` : undefined,
                      }
                }
              />
            )}

            {isSelected && (
              <button
                type="button"
                className="resize-corner-handle"
                aria-label="Redimensionner l'image"
                title="Glisser pour redimensionner l'image"
                onPointerDown={(event) => startPointerDrag(event, img, 'resize')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
