// Panneau latéral des miniatures de pages avec chargement paresseux
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { X } from 'lucide-react';

interface SidebarThumbnailsProps {
  pdfProxy: PDFDocumentProxy;
  numPages: number;
  currentPage: number;
  onSelectPage: (page: number) => void;
  onCloseMobile: () => void;
}

interface ThumbnailItemProps {
  pdfProxy: PDFDocumentProxy;
  pageNumber: number;
  isActive: boolean;
  onSelect: (page: number) => void;
}

function ThumbnailItem({
  pdfProxy,
  pageNumber,
  isActive,
  onSelect,
}: ThumbnailItemProps) {
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = itemRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
        }
      },
      { rootMargin: '200px 0px' },
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
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = 140;
        const scale = targetWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        renderTask = page.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
      } catch {
        // Annulation normale lors d'un changement rapide de document
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [isVisible, pageNumber, pdfProxy]);

  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isActive]);

  return (
    <button
      ref={itemRef}
      type="button"
      className={`thumbnail-item ${isActive ? 'is-active' : ''}`}
      onClick={() => onSelect(pageNumber)}
      aria-label={`Aller à la page ${pageNumber}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <div className="thumbnail-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <span className="thumbnail-label">Page {pageNumber}</span>
    </button>
  );
}

export function SidebarThumbnails({
  pdfProxy,
  numPages,
  currentPage,
  onSelectPage,
  onCloseMobile,
}: SidebarThumbnailsProps) {
  const pages = Array.from({ length: numPages }, (_, idx) => idx + 1);

  return (
    <>
      <div
        className="sidebar-backdrop"
        onClick={onCloseMobile}
        aria-hidden="true"
      />
      <aside className="thumbnails-sidebar" aria-label="Miniatures des pages">
        <div className="thumbnails-header">
          <span>Pages ({numPages})</span>
          <button
            type="button"
            className="tab-close-btn"
            onClick={onCloseMobile}
            aria-label="Fermer le panneau des miniatures"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="thumbnails-list">
          {pages.map((pageNum) => (
            <ThumbnailItem
              key={pageNum}
              pdfProxy={pdfProxy}
              pageNumber={pageNum}
              isActive={pageNum === currentPage}
              onSelect={(p) => {
                onSelectPage(p);
                if (window.innerWidth <= 768) {
                  onCloseMobile();
                }
              }}
            />
          ))}
        </div>
      </aside>
    </>
  );
}
