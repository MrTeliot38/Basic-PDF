// Couche interactive par-dessus chaque page PDF : survol, sélection, saisie directe, déplacement, redimensionnement et masquage fidèle du fond
import { useEffect, useRef, useState } from 'react';
import type {
  BackgroundPatch,
  EditableTextBlock,
  EditorToolMode,
  SearchMatch,
} from '../types/pdf';

interface TextOverlayLayerProps {
  pageNumber: number;
  zoom: number;
  toolMode: EditorToolMode;
  blocks: EditableTextBlock[];
  selectedBlockId: string | null;
  editingBlockId: string | null;
  searchMatches: SearchMatch[];
  activeSearchMatch: SearchMatch | null;
  onSelectBlock: (blockId: string | null) => void;
  onStartEditing: (blockId: string) => void;
  onFinishEditing: (blockId: string, nextText: string, patch?: BackgroundPatch) => void;
  onMoveOrResizeBlock: (
    blockId: string,
    nextRect: { x: number; y: number; width: number; height: number },
    label: string,
    patch?: BackgroundPatch,
  ) => void;
  onRequestBackgroundPatch: (block: EditableTextBlock) => BackgroundPatch | undefined;
}

export function TextOverlayLayer({
  pageNumber,
  zoom,
  toolMode,
  blocks,
  selectedBlockId,
  editingBlockId,
  searchMatches,
  activeSearchMatch,
  onSelectBlock,
  onStartEditing,
  onFinishEditing,
  onMoveOrResizeBlock,
  onRequestBackgroundPatch,
}: TextOverlayLayerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [dragPreview, setDragPreview] = useState<{
    blockId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editingCommittedRef = useRef(false);

  // Synchronise le texte initial lorsqu'un bloc passe en saisie directe
  useEffect(() => {
    if (!editingBlockId) {
      return;
    }
    const target = blocks.find((b) => b.id === editingBlockId);
    if (!target) {
      return;
    }
    editingCommittedRef.current = false;
    setDraftText(target.currentText);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.select();
        // Assure que le clavier tactile mobile ne masque jamais le texte en cours de saisie
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }, [editingBlockId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitInlineEdit = (block: EditableTextBlock, textToSave: string) => {
    if (editingCommittedRef.current) {
      return;
    }
    editingCommittedRef.current = true;
    const patch = block.backgroundPatch ?? onRequestBackgroundPatch(block);
    onFinishEditing(block.id, textToSave, patch);
  };

  const startPointerDrag = (
    event: React.PointerEvent,
    block: EditableTextBlock,
    mode: 'move' | 'resize',
  ) => {
    if (toolMode !== 'select-text' || editingBlockId === block.id) {
      return;
    }
    event.stopPropagation();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const origX = block.x;
    const origY = block.y;
    const origW = block.width;
    const origH = block.height;
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
          blockId: block.id,
          x: Math.max(0, origX + dxPdf),
          y: Math.max(0, origY + dyPdf),
          width: origW,
          height: origH,
        });
      } else {
        setDragPreview({
          blockId: block.id,
          x: origX,
          y: origY,
          width: Math.max(24, origW + dxPdf),
          height: Math.max(12, origH + dyPdf),
        });
      }
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setDragPreview(null);

      if (!moved) {
        return;
      }
      const dxPdf = (upEvt.clientX - startClientX) / zoom;
      const dyPdf = (upEvt.clientY - startClientY) / zoom;
      const patch = block.backgroundPatch ?? onRequestBackgroundPatch(block);

      if (mode === 'move') {
        onMoveOrResizeBlock(
          block.id,
          {
            x: Math.max(0, origX + dxPdf),
            y: Math.max(0, origY + dyPdf),
            width: origW,
            height: origH,
          },
          'Déplacer le texte',
          patch,
        );
      } else {
        onMoveOrResizeBlock(
          block.id,
          {
            x: origX,
            y: origY,
            width: Math.max(24, origW + dxPdf),
            height: Math.max(12, origH + dyPdf),
          },
          'Redimensionner le texte',
          patch,
        );
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const pageMatches = searchMatches.filter((m) => m.pageNumber === pageNumber);

  return (
    <div
      className={`text-overlay-layer ${toolMode === 'select-text' ? 'is-select-mode' : ''}`}
      onClick={(event) => {
        if (toolMode === 'select-text' && event.target === event.currentTarget) {
          onSelectBlock(null);
        }
      }}
    >
      {/* 1. Patchs de fond reconstruits masquant l'ancien texte (jamais remplacé par du blanc) */}
      {blocks.map((block) => {
        const hasMoved =
          Math.abs(block.x - block.origX) > 0.5 || Math.abs(block.y - block.origY) > 0.5;
        const shouldMaskOriginal = block.status !== 'original' || hasMoved;
        if (!shouldMaskOriginal || !block.backgroundPatch?.dataUrl) {
          return null;
        }
        const p = block.backgroundPatch;
        return (
          <img
            key={`patch-${block.id}`}
            src={p.dataUrl}
            alt=""
            aria-hidden="true"
            className="text-bg-patch"
            data-testid={`bg-patch-${block.id}`}
            style={{
              left: p.x * zoom,
              top: p.y * zoom,
              width: p.width * zoom,
              height: p.height * zoom,
            }}
          />
        );
      })}

      {/* 2. Surlignage des résultats de recherche */}
      {pageMatches.map((match) => {
        const block = blocks.find((b) => b.id === match.blockId);
        if (!block || block.status === 'deleted') {
          return null;
        }
        const isActive =
          activeSearchMatch?.blockId === match.blockId &&
          activeSearchMatch?.startIndex === match.startIndex;
        const totalLen = Math.max(1, block.currentText.length);
        const startRatio = match.startIndex / totalLen;
        const widthRatio = Math.max(0.08, (match.endIndex - match.startIndex) / totalLen);

        return (
          <div
            key={`match-${match.blockId}-${match.startIndex}`}
            className={`search-highlight ${isActive ? 'is-active' : ''}`}
            data-search-active={isActive ? 'true' : undefined}
            style={{
              left: (block.x + block.width * startRatio) * zoom,
              top: block.y * zoom,
              width: Math.max(12, block.width * widthRatio * zoom),
              height: block.height * zoom,
            }}
          />
        );
      })}

      {/* 3. Blocs de texte visibles (les blocs supprimés ne sont plus proposés ni sélectionnables) */}
      {blocks.map((block) => {
        if (block.status === 'deleted') {
          return null;
        }

        const isSelected = block.id === selectedBlockId;
        const isEditing = block.id === editingBlockId;
        const isHovered = toolMode === 'select-text' && block.id === hoveredId;
        const hasMoved =
          Math.abs(block.x - block.origX) > 0.5 || Math.abs(block.y - block.origY) > 0.5;
        const showRenderedText = block.status === 'edited' || hasMoved;

        const rect =
          dragPreview && dragPreview.blockId === block.id
            ? dragPreview
            : { x: block.x, y: block.y, width: block.width, height: block.height };

        const interactive = toolMode === 'select-text' || isSelected || isEditing;

        return (
          <div
            key={block.id}
            data-testid={`text-block-${block.id}`}
            data-block-source={block.source}
            data-block-status={block.status}
            className={[
              'editable-text-block',
              isHovered ? 'is-hovered' : '',
              isSelected ? 'is-selected' : '',
              isEditing ? 'is-editing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: rect.x * zoom,
              top: rect.y * zoom,
              width: Math.max(18, rect.width * zoom),
              height: Math.max(14, rect.height * zoom),
              pointerEvents: interactive ? 'auto' : 'none',
            }}
            onMouseEnter={() => {
              if (toolMode === 'select-text') {
                setHoveredId(block.id);
              }
            }}
            onMouseLeave={() => {
              if (hoveredId === block.id) {
                setHoveredId(null);
              }
            }}
            onPointerDown={(event) => {
              if (toolMode !== 'select-text') {
                return;
              }
              event.stopPropagation();
              if (!isSelected) {
                onSelectBlock(block.id);
              } else if (!isEditing) {
                startPointerDrag(event, block, 'move');
              }
            }}
            onClick={(event) => {
              if (toolMode !== 'select-text') {
                return;
              }
              event.stopPropagation();
              if (!isSelected) {
                onSelectBlock(block.id);
              }
            }}
            onDoubleClick={(event) => {
              if (toolMode !== 'select-text') {
                return;
              }
              event.stopPropagation();
              onStartEditing(block.id);
            }}
          >
            {isEditing ? (
              <textarea
                ref={textareaRef}
                className="inline-text-editor"
                aria-label="Modifier le texte"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onBlur={() => commitInlineEdit(block, draftText)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    editingCommittedRef.current = true;
                    onFinishEditing(block.id, block.currentText);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitInlineEdit(block, draftText);
                  }
                }}
                style={{
                  fontFamily: block.style.fontFamily,
                  fontSize: Math.max(8, block.style.fontSize * zoom),
                  color: block.style.color,
                  fontWeight: block.style.bold ? 700 : 400,
                  fontStyle: block.style.italic ? 'italic' : 'normal',
                }}
              />
            ) : showRenderedText ? (
              <div
                className="rendered-edited-text"
                style={{
                  fontFamily: block.style.fontFamily,
                  fontSize: Math.max(6, block.style.fontSize * zoom),
                  color: block.style.color,
                  fontWeight: block.style.bold ? 700 : 400,
                  fontStyle: block.style.italic ? 'italic' : 'normal',
                }}
              >
                {block.currentText}
              </div>
            ) : (
              <span className="sr-only-text">{block.currentText}</span>
            )}

            {isSelected && !isEditing && (
              <button
                type="button"
                className="resize-corner-handle"
                aria-label="Redimensionner le bloc de texte"
                title="Glisser pour redimensionner"
                onPointerDown={(event) => startPointerDrag(event, block, 'resize')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
