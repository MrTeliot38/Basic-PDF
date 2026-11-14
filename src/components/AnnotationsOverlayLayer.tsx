// Couche interactive des annotations, remplissage libre, tampons, notes, signatures et zones de caviardage
import { useEffect, useRef, useState } from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import type { AnnotationKind, EditorToolMode, PageAnnotation } from '../types/pdf';
import { createId } from '../utils/formatters';

interface AnnotationsOverlayLayerProps {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  toolMode: EditorToolMode;
  activeColor: string;
  activeStrokeWidth: number;
  activeStampText: string;
  activeFontFamily?: string;
  activeFontSize?: number;
  activeBold?: boolean;
  activeItalic?: boolean;
  pendingSignatureUrl: string | null;
  annotations: PageAnnotation[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (annotationId: string | null) => void;
  onAddAnnotation: (ann: PageAnnotation, label: string) => void;
  onUpdateAnnotation: (
    annotationId: string,
    label: string,
    updater: (ann: PageAnnotation) => PageAnnotation,
  ) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSignaturePlaced?: () => void;
}

const CREATION_TOOLS = new Set<EditorToolMode>([
  'fill-free-text',
  'fill-cross',
  'fill-check',
  'fill-date',
  'sign',
  'annotate-highlight',
  'annotate-underline',
  'annotate-strike',
  'annotate-rect',
  'annotate-ellipse',
  'annotate-line',
  'annotate-arrow',
  'annotate-draw',
  'annotate-note',
  'annotate-stamp',
  'redact',
]);

function isCreationTool(mode: EditorToolMode): boolean {
  return CREATION_TOOLS.has(mode);
}

function getKindFromTool(mode: EditorToolMode): AnnotationKind | null {
  switch (mode) {
    case 'fill-free-text':
      return 'free-text';
    case 'fill-cross':
      return 'cross';
    case 'fill-check':
      return 'check';
    case 'fill-date':
      return 'date';
    case 'sign':
      return 'signature';
    case 'annotate-highlight':
      return 'highlight';
    case 'annotate-underline':
      return 'underline';
    case 'annotate-strike':
      return 'strike';
    case 'annotate-rect':
      return 'rect';
    case 'annotate-ellipse':
      return 'ellipse';
    case 'annotate-line':
      return 'line';
    case 'annotate-arrow':
      return 'arrow';
    case 'annotate-draw':
      return 'draw';
    case 'annotate-note':
      return 'note';
    case 'annotate-stamp':
      return 'stamp';
    case 'redact':
      return 'redact';
    default:
      return null;
  }
}

export function AnnotationsOverlayLayer({
  pageNumber,
  pageWidth,
  pageHeight,
  zoom,
  toolMode,
  activeColor,
  activeStrokeWidth,
  activeStampText,
  activeFontFamily = 'Arial, Helvetica, sans-serif',
  activeFontSize = 13,
  activeBold = false,
  activeItalic = false,
  pendingSignatureUrl,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onSignaturePlaced,
}: AnnotationsOverlayLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNoteText, setDraftNoteText] = useState('');
  const [drawDraft, setDrawDraft] = useState<{
    kind: AnnotationKind;
    startX: number;
    startY: number;
    currX: number;
    currY: number;
    points: Array<{ x: number; y: number }>;
  } | null>(null);

  const [moveDraft, setMoveDraft] = useState<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!editingId) return;
    const target = annotations.find((a) => a.id === editingId);
    setDraftNoteText(target?.text ?? '');
  }, [editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toPdfPoint = (clientX: number, clientY: number) => {
    const el = layerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(pageWidth, (clientX - rect.left) / zoom)),
      y: Math.max(0, Math.min(pageHeight, (clientY - rect.top) / zoom)),
    };
  };

  const handleLayerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isCreationTool(toolMode)) {
      if (event.target === event.currentTarget && selectedAnnotationId) {
        onSelectAnnotation(null);
        setEditingId(null);
      }
      return;
    }

    const kind = getKindFromTool(toolMode);
    if (!kind || !event.isPrimary) {
      setDrawDraft(null);
      return;
    }
    event.stopPropagation();

    const pt = toPdfPoint(event.clientX, event.clientY);

    // Outils à placement en 1 clic
    if (kind === 'cross' || kind === 'check') {
      onAddAnnotation(
        {
          id: createId('ann'),
          pageNumber,
          kind,
          x: Math.max(0, pt.x - 9),
          y: Math.max(0, pt.y - 9),
          width: 18,
          height: 18,
          color: activeColor,
          strokeWidth: 2,
        },
        kind === 'cross' ? 'Ajouter une croix' : 'Ajouter une coche',
      );
      return;
    }

    if (kind === 'date') {
      const today = new Date().toLocaleDateString('fr-FR');
      const fontSize = Math.max(8, Math.round(activeFontSize));
      const boxHeight = Math.max(22, Math.round(fontSize * 1.65));
      const boxWidth = Math.max(88, Math.round(today.length * fontSize * 0.68 + 18));
      onAddAnnotation(
        {
          id: createId('ann'),
          pageNumber,
          kind: 'date',
          x: Math.max(0, pt.x - 4),
          y: Math.max(0, pt.y - Math.round(boxHeight * 0.45)),
          width: boxWidth,
          height: boxHeight,
          color: activeColor,
          strokeWidth: 1,
          text: today,
          fontSize,
          fontFamily: activeFontFamily,
          bold: activeBold,
          italic: activeItalic,
        },
        'Ajouter la date',
      );
      return;
    }

    if (kind === 'free-text') {
      event.preventDefault();
      const id = createId('ann');
      const fontSize = Math.max(8, Math.round(activeFontSize));
      const boxHeight = Math.max(24, Math.round(fontSize * 1.75));
      const boxWidth = Math.max(140, Math.round(fontSize * 11));
      const initialText = 'Texte saisi';
      onAddAnnotation(
        {
          id,
          pageNumber,
          kind: 'free-text',
          x: Math.max(0, pt.x - 4),
          y: Math.max(0, pt.y - Math.round(boxHeight * 0.45)),
          width: boxWidth,
          height: boxHeight,
          color: activeColor,
          strokeWidth: 1,
          text: initialText,
          fontSize,
          fontFamily: activeFontFamily,
          bold: activeBold,
          italic: activeItalic,
        },
        'Ajouter un texte libre',
      );
      setDraftNoteText(initialText);
      setEditingId(id);
      return;
    }

    if (kind === 'note') {
      event.preventDefault();
      const id = createId('ann');
      const initialNote = 'Note sur ce passage';
      onAddAnnotation(
        {
          id,
          pageNumber,
          kind: 'note',
          x: Math.max(0, pt.x - 12),
          y: Math.max(0, pt.y - 12),
          width: 26,
          height: 26,
          color: '#111827',
          strokeWidth: 1,
          text: initialNote,
        },
        'Ajouter une note',
      );
      setDraftNoteText(initialNote);
      setEditingId(id);
      return;
    }

    if (kind === 'stamp') {
      onAddAnnotation(
        {
          id: createId('ann'),
          pageNumber,
          kind: 'stamp',
          x: Math.max(0, pt.x - 62),
          y: Math.max(0, pt.y - 18),
          width: 124,
          height: 36,
          color: activeColor,
          strokeWidth: 2,
          text: activeStampText || 'APPROUVÉ',
        },
        'Poser un tampon',
      );
      return;
    }

    if (kind === 'signature') {
      if (!pendingSignatureUrl) {
        return;
      }
      onAddAnnotation(
        {
          id: createId('sigann'),
          pageNumber,
          kind: 'signature',
          x: Math.max(0, pt.x - 70),
          y: Math.max(0, pt.y - 26),
          width: 140,
          height: 52,
          color: activeColor,
          strokeWidth: 1,
          imageDataUrl: pendingSignatureUrl,
        },
        'Poser une signature',
      );
      onSignaturePlaced?.();
      return;
    }

    // Outils par glisser (surligner, souligner, barrer, formes, tracé libre, caviarder)
    setDrawDraft({
      kind,
      startX: pt.x,
      startY: pt.y,
      currX: pt.x,
      currY: pt.y,
      points: [pt],
    });

    const onMove = (moveEvt: PointerEvent) => {
      const nextPt = toPdfPoint(moveEvt.clientX, moveEvt.clientY);
      setDrawDraft((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          currX: nextPt.x,
          currY: nextPt.y,
          points: prev.kind === 'draw' ? [...prev.points, nextPt] : [prev.points[0], nextPt],
        };
      });
    };

    const onUp = (upEvt: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const endPt = toPdfPoint(upEvt.clientX, upEvt.clientY);

      setDrawDraft(null);
      const minX = Math.min(pt.x, endPt.x);
      const minY = Math.min(pt.y, endPt.y);
      const width = Math.abs(endPt.x - pt.x);
      const height = Math.abs(endPt.y - pt.y);

      if (kind === 'draw') {
        setDrawDraft((curr) => curr);
        // Relit via une copie locale sûre dans un setter? Plus propre : calculons avec points collectés
        return;
      }

      if (width < 6 && height < 6) {
        return;
      }

      const finalH =
        kind === 'highlight' || kind === 'underline' || kind === 'strike'
          ? Math.max(12, height)
          : Math.max(6, height);

      onAddAnnotation(
        {
          id: createId('ann'),
          pageNumber,
          kind,
          x: minX,
          y: minY,
          width: Math.max(10, width),
          height: finalH,
          color: kind === 'redact' ? '#000000' : activeColor,
          strokeWidth: activeStrokeWidth,
          opacity: kind === 'highlight' ? 0.38 : 1,
          points:
            kind === 'line' || kind === 'arrow'
              ? [
                  { x: pt.x, y: pt.y },
                  { x: endPt.x, y: endPt.y },
                ]
              : undefined,
        },
        kind === 'redact' ? 'Caviarder une zone' : 'Ajouter une annotation',
      );
    };

    // Pour le tracé à main levée (draw), on accumule dans une variable mutable locale
    if (kind === 'draw') {
      const collected: Array<{ x: number; y: number }> = [pt];
      const onFreeMove = (moveEvt: PointerEvent) => {
        const nextPt = toPdfPoint(moveEvt.clientX, moveEvt.clientY);
        collected.push(nextPt);
        setDrawDraft({
          kind: 'draw',
          startX: pt.x,
          startY: pt.y,
          currX: nextPt.x,
          currY: nextPt.y,
          points: [...collected],
        });
      };
      const onFreeUp = () => {
        window.removeEventListener('pointermove', onFreeMove);
        window.removeEventListener('pointerup', onFreeUp);
        setDrawDraft(null);
        if (collected.length < 2) return;
        const xs = collected.map((p) => p.x);
        const ys = collected.map((p) => p.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const w = Math.max(10, Math.max(...xs) - x);
        const h = Math.max(10, Math.max(...ys) - y);
        onAddAnnotation(
          {
            id: createId('ann'),
            pageNumber,
            kind: 'draw',
            x,
            y,
            width: w,
            height: h,
            color: activeColor,
            strokeWidth: activeStrokeWidth,
            points: collected,
          },
          'Ajouter un dessin libre',
        );
      };
      window.addEventListener('pointermove', onFreeMove);
      window.addEventListener('pointerup', onFreeUp);
      return;
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startDragItem = (
    event: React.PointerEvent,
    ann: PageAnnotation,
    mode: 'move' | 'resize',
  ) => {
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const origX = ann.x;
    const origY = ann.y;
    const origW = ann.width;
    const origH = ann.height;
    let moved = false;

    const onMove = (moveEvt: PointerEvent) => {
      if (!moved && Math.hypot(moveEvt.clientX - startX, moveEvt.clientY - startY) < 4) {
        return;
      }
      moved = true;
      const dx = (moveEvt.clientX - startX) / zoom;
      const dy = (moveEvt.clientY - startY) / zoom;
      if (mode === 'move') {
        setMoveDraft({ id: ann.id, x: Math.max(0, origX + dx), y: Math.max(0, origY + dy), width: origW, height: origH });
      } else {
        setMoveDraft({ id: ann.id, x: origX, y: origY, width: Math.max(16, origW + dx), height: Math.max(14, origH + dy) });
      }
    };

    const onUp = (upEvt: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMoveDraft(null);
      if (!moved) return;
      const dx = (upEvt.clientX - startX) / zoom;
      const dy = (upEvt.clientY - startY) / zoom;
      onUpdateAnnotation(
        ann.id,
        mode === 'move' ? "Déplacer l'élément" : "Redimensionner l'élément",
        (curr) => {
          if (mode === 'move') {
            return {
              ...curr,
              x: Math.max(0, origX + dx),
              y: Math.max(0, origY + dy),
              points: curr.points?.map((p) => ({ x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy) })),
            };
          }
          return {
            ...curr,
            width: Math.max(16, origW + dx),
            height: Math.max(14, origH + dy),
          };
        },
      );
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const creationActive = isCreationTool(toolMode);
  const canInteractExisting = toolMode === 'view' || creationActive;

  const commitInlineText = (ann: PageAnnotation, value: string) => {
    setEditingId(null);
    if (!value.trim() && ann.kind === 'free-text') {
      onDeleteAnnotation(ann.id);
      return;
    }
    if (value !== (ann.text ?? '')) {
      onUpdateAnnotation(ann.id, 'Modifier le texte annoté', (c) => ({ ...c, text: value }));
    }
  };

  return (
    <div
      ref={layerRef}
      className={`annotations-overlay-layer ${creationActive ? 'is-drawing-tool' : ''}`}
      style={{
        pointerEvents: creationActive ? 'auto' : 'none',
      }}
      onPointerDown={handleLayerPointerDown}
    >
      {/* Tracé libre en cours */}
      {drawDraft && drawDraft.kind === 'draw' && drawDraft.points.length >= 2 && (
        <svg className="annotation-svg-layer" width={pageWidth * zoom} height={pageHeight * zoom}>
          <path
            d={drawDraft.points
              .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x * zoom} ${p.y * zoom}`)
              .join(' ')}
            fill="none"
            stroke={activeColor}
            strokeWidth={activeStrokeWidth * zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* Aperçu de rectangle / forme / caviardage en cours */}
      {drawDraft && drawDraft.kind !== 'draw' && (
        <div
          className={`annotation-draw-preview kind-${drawDraft.kind}`}
          style={{
            left: Math.min(drawDraft.startX, drawDraft.currX) * zoom,
            top: Math.min(drawDraft.startY, drawDraft.currY) * zoom,
            width: Math.max(4, Math.abs(drawDraft.currX - drawDraft.startX) * zoom),
            height: Math.max(4, Math.abs(drawDraft.currY - drawDraft.startY) * zoom),
            borderColor: drawDraft.kind === 'redact' ? '#000000' : activeColor,
            backgroundColor:
              drawDraft.kind === 'redact'
                ? 'rgba(0,0,0,0.88)'
                : drawDraft.kind === 'highlight'
                  ? `${activeColor}55`
                  : 'transparent',
          }}
        />
      )}

      {/* Éléments existants sur la page */}
      {annotations.map((ann) => {
        const isSelected = ann.id === selectedAnnotationId;
        const isEditing = ann.id === editingId;
        const rect =
          moveDraft && moveDraft.id === ann.id
            ? moveDraft
            : { x: ann.x, y: ann.y, width: ann.width, height: ann.height };

        return (
          <div
            key={ann.id}
            data-testid={`annotation-${ann.id}`}
            data-annotation-kind={ann.kind}
            className={[
              'annotation-item',
              `kind-${ann.kind}`,
              isSelected ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: rect.x * zoom,
              top: rect.y * zoom,
              width: Math.max(14, rect.width * zoom),
              height: Math.max(12, rect.height * zoom),
              pointerEvents: canInteractExisting ? 'auto' : 'none',
            }}
            onPointerDown={(e) => {
              if (!canInteractExisting) return;
              e.stopPropagation();
              if (!isSelected) {
                onSelectAnnotation(ann.id);
              } else if (!isEditing) {
                startDragItem(e, ann, 'move');
              }
            }}
            onClick={(e) => {
              if (!canInteractExisting) return;
              e.stopPropagation();
              onSelectAnnotation(ann.id);
            }}
            onDoubleClick={(e) => {
              if (ann.kind === 'free-text' || ann.kind === 'note' || ann.kind === 'date') {
                e.stopPropagation();
                setEditingId(ann.id);
              }
            }}
          >
            {ann.kind === 'highlight' && (
              <div
                className="annot-fill-box"
                style={{ backgroundColor: ann.color, opacity: ann.opacity ?? 0.38 }}
              />
            )}

            {ann.kind === 'underline' && (
              <div
                className="annot-line-bottom"
                style={{ borderBottom: `${Math.max(2, ann.strokeWidth * zoom)}px solid ${ann.color}` }}
              />
            )}

            {ann.kind === 'strike' && (
              <div
                className="annot-line-middle"
                style={{ backgroundColor: ann.color, height: Math.max(2, ann.strokeWidth * zoom) }}
              />
            )}

            {ann.kind === 'rect' && (
              <div
                className="annot-stroke-box"
                style={{ border: `${Math.max(1.5, ann.strokeWidth * zoom)}px solid ${ann.color}` }}
              />
            )}

            {ann.kind === 'ellipse' && (
              <div
                className="annot-stroke-ellipse"
                style={{ border: `${Math.max(1.5, ann.strokeWidth * zoom)}px solid ${ann.color}` }}
              />
            )}

            {(ann.kind === 'line' || ann.kind === 'arrow') && ann.points && ann.points.length >= 2 && (
              <svg width="100%" height="100%" className="annot-vector-svg">
                <defs>
                  <marker
                    id={`arrow-${ann.id}`}
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 Z" fill={ann.color} />
                  </marker>
                </defs>
                <line
                  x1={(ann.points[0].x - ann.x) * zoom}
                  y1={(ann.points[0].y - ann.y) * zoom}
                  x2={(ann.points[1].x - ann.x) * zoom}
                  y2={(ann.points[1].y - ann.y) * zoom}
                  stroke={ann.color}
                  strokeWidth={Math.max(1.5, ann.strokeWidth * zoom)}
                  strokeLinecap="round"
                  markerEnd={ann.kind === 'arrow' ? `url(#arrow-${ann.id})` : undefined}
                />
              </svg>
            )}

            {ann.kind === 'draw' && ann.points && ann.points.length >= 2 && (
              <svg width="100%" height="100%" className="annot-vector-svg">
                <path
                  d={ann.points
                    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${(p.x - ann.x) * zoom} ${(p.y - ann.y) * zoom}`)
                    .join(' ')}
                  fill="none"
                  stroke={ann.color}
                  strokeWidth={Math.max(1.5, ann.strokeWidth * zoom)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}

            {ann.kind === 'signature' && ann.imageDataUrl && (
              <img
                src={ann.imageDataUrl}
                alt="Signature posée"
                className="annot-signature-img"
                draggable={false}
              />
            )}

            {ann.kind === 'stamp' && (
              <div
                className="annot-stamp-badge"
                style={{
                  color: ann.color,
                  borderColor: ann.color,
                  fontSize: Math.max(9, rect.height * zoom * 0.42),
                }}
              >
                {ann.text}
              </div>
            )}

            {ann.kind === 'cross' && (
              <svg viewBox="0 0 24 24" width="100%" height="100%">
                <path
                  d="M4 4 L20 20 M20 4 L4 20"
                  stroke={ann.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            )}

            {ann.kind === 'check' && (
              <svg viewBox="0 0 24 24" width="100%" height="100%">
                <path
                  d="M4 13 L9.5 18.5 L20 6"
                  fill="none"
                  stroke={ann.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}

            {(ann.kind === 'free-text' || ann.kind === 'date') &&
              (isEditing ? (
                <input
                  type="text"
                  autoFocus
                  className="annot-inline-input"
                  value={draftNoteText}
                  style={{
                    color: ann.color,
                    fontSize: (ann.fontSize ?? 13) * zoom,
                    fontFamily: ann.fontFamily ?? 'Arial, Helvetica, sans-serif',
                    fontWeight: ann.bold ? 700 : 400,
                    fontStyle: ann.italic ? 'italic' : 'normal',
                  }}
                  onChange={(e) => setDraftNoteText(e.target.value)}
                  onBlur={() => commitInlineText(ann, draftNoteText)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitInlineText(ann, draftNoteText);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <span
                  className="annot-free-text-label"
                  style={{
                    color: ann.color,
                    fontSize: (ann.fontSize ?? 13) * zoom,
                    fontFamily: ann.fontFamily ?? 'Arial, Helvetica, sans-serif',
                    fontWeight: ann.bold ? 700 : 400,
                    fontStyle: ann.italic ? 'italic' : 'normal',
                  }}
                >
                  {ann.text}
                </span>
              ))}

            {ann.kind === 'note' && (
              <div className="annot-note-wrap">
                <div className="annot-note-pin" title={ann.text ?? 'Note'}>
                  <StickyNote size={16} color="#92400e" aria-hidden="true" />
                </div>
                {(isSelected || isEditing) && (
                  <div
                    className="annot-note-popover"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <textarea
                      rows={2}
                      aria-label="Texte de la note"
                      value={isEditing ? draftNoteText : ann.text ?? ''}
                      onFocus={() => {
                        if (!isEditing) {
                          setEditingId(ann.id);
                          setDraftNoteText(ann.text ?? '');
                        }
                      }}
                      onChange={(e) => setDraftNoteText(e.target.value)}
                      onBlur={() => commitInlineText(ann, draftNoteText)}
                    />
                  </div>
                )}
              </div>
            )}

            {ann.kind === 'redact' && (
              <div
                className="annot-redact-box"
                title="Contenu caviardé : supprimé définitivement du fichier à l'enregistrement"
              />
            )}

            {isSelected && (
              <>
                <button
                  type="button"
                  className="annot-delete-btn"
                  aria-label="Supprimer cet élément"
                  title="Supprimer (Suppr)"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAnnotation(ann.id);
                  }}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
                {ann.kind !== 'note' && ann.kind !== 'draw' && ann.kind !== 'line' && ann.kind !== 'arrow' && (
                  <button
                    type="button"
                    className="resize-corner-handle"
                    aria-label="Redimensionner l'élément"
                    onPointerDown={(e) => startDragItem(e, ann, 'resize')}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
