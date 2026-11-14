// Scanner de documents 100 % hors ligne : détection en direct (cadre bleu), recadrage 4 coins, perspective, noir & blanc / couleur, multi-pages et partage PDF
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  FilePlus2,
  ImagePlus,
  RotateCw,
  ScanLine,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  captureAndroidDocumentPhoto,
  isAndroidNativeApp,
  requestAndroidCameraPermission,
} from '../utils/androidBridge';
import {
  buildScannedPdfBytes,
  clampPoint,
  detectDocumentQuad,
  getDefaultScanQuad,
  getQualitySettings,
  processRawScanDataUrl,
  smoothScanQuad,
  type ScanColorMode,
  type ScanQuad,
  type ScanQuality,
  type ScannedPageEntry,
} from '../utils/documentScanner';

interface DocumentScannerModalProps {
  onCompletePdf: (bytes: Uint8Array, fileName: string, openShareAfter: boolean) => void;
  onShowError: (message: string) => void;
  onClose: () => void;
}

type CornerKey = keyof ScanQuad;
type ScannerStep = 'camera' | 'edit';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Impossible de lire l’image sélectionnée.'));
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number; imageData: ImageData }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Impossible d’analyser la photo.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve({ width, height, imageData: ctx.getImageData(0, 0, width, height) });
    };
    img.onerror = () => reject(new Error('Format d’image non pris en charge.'));
    img.src = dataUrl;
  });
}

export function DocumentScannerModal({
  onCompletePdf,
  onShowError,
  onClose,
}: DocumentScannerModalProps) {
  const [step, setStep] = useState<ScannerStep>('camera');
  const [pages, setPages] = useState<ScannedPageEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'crop' | 'preview'>('preview');

  const [colorMode, setColorMode] = useState<ScanColorMode>('couleur');
  const [quality, setQuality] = useState<ScanQuality>('standard');
  const [processing, setProcessing] = useState(false);

  // État caméra en direct
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<string>('Démarrage de la caméra...');
  const [sheetDetectedLive, setSheetDetectedLive] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveQuadRef = useRef<ScanQuad>(getDefaultScanQuad());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropStageRef = useRef<HTMLDivElement | null>(null);
  const draggingCornerRef = useRef<CornerKey | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  // Lancement de la caméra en direct uniquement sur l'écran caméra
  useEffect(() => {
    if (step !== 'camera') {
      stopCamera();
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;
    const analysisCanvas = document.createElement('canvas');

    const startLiveCamera = async () => {
      try {
        if (isAndroidNativeApp()) {
          const granted = await requestAndroidCameraPermission();
          if (!granted && !cancelled) {
            setCameraStatus(
              'Permission caméra refusée. Utilisez « Appareil photo » ou « Importer une photo ».',
            );
            return;
          }
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraStatus(
            'Caméra directe indisponible ici. Importez une photo ou utilisez l’appareil photo.',
          );
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1600 },
            height: { ideal: 1200 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
        setCameraStatus('Placez la feuille sur un fond contrasté...');

        // Boucle de détection en direct dessinant le cadre bleu autour de la feuille
        const tick = () => {
          if (cancelled) return;
          const video = videoRef.current;
          const overlay = overlayCanvasRef.current;
          if (video && overlay && video.readyState >= 2 && video.videoWidth > 0) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            if (overlay.width !== vw || overlay.height !== vh) {
              overlay.width = vw;
              overlay.height = vh;
            }

            const sampleW = 160;
            const sampleH = Math.max(90, Math.round((sampleW * vh) / vw));
            analysisCanvas.width = sampleW;
            analysisCanvas.height = sampleH;
            const aCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
            if (aCtx) {
              aCtx.drawImage(video, 0, 0, sampleW, sampleH);
              const imgData = aCtx.getImageData(0, 0, sampleW, sampleH);
              const det = detectDocumentQuad(imgData);
              setSheetDetectedLive(det.detected);
              if (det.detected) {
                liveQuadRef.current = smoothScanQuad(liveQuadRef.current, det.quad, 0.4);
                setCameraStatus('Feuille détectée — Prêt à capturer');
              } else {
                setCameraStatus('Placez la feuille bien visible devant la caméra...');
              }

              const oCtx = overlay.getContext('2d');
              if (oCtx) {
                oCtx.clearRect(0, 0, vw, vh);
                const q = liveQuadRef.current;
                const pts = [
                  { x: q.topLeft.x * vw, y: q.topLeft.y * vh },
                  { x: q.topRight.x * vw, y: q.topRight.y * vh },
                  { x: q.bottomRight.x * vw, y: q.bottomRight.y * vh },
                  { x: q.bottomLeft.x * vw, y: q.bottomLeft.y * vh },
                ];

                // Cadre bleu de détection en direct
                oCtx.save();
                oCtx.beginPath();
                oCtx.moveTo(pts[0].x, pts[0].y);
                oCtx.lineTo(pts[1].x, pts[1].y);
                oCtx.lineTo(pts[2].x, pts[2].y);
                oCtx.lineTo(pts[3].x, pts[3].y);
                oCtx.closePath();
                oCtx.fillStyle = det.detected
                  ? 'rgba(37, 99, 235, 0.18)'
                  : 'rgba(59, 130, 246, 0.08)';
                oCtx.fill();
                oCtx.lineWidth = Math.max(4, vw * 0.006);
                oCtx.strokeStyle = '#2563eb';
                if (!det.detected) {
                  oCtx.setLineDash([12, 8]);
                }
                oCtx.stroke();

                // Coins bleus visibles
                oCtx.setLineDash([]);
                oCtx.fillStyle = '#3b82f6';
                const radius = Math.max(8, vw * 0.014);
                for (const p of pts) {
                  oCtx.beginPath();
                  oCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
                  oCtx.fill();
                  oCtx.lineWidth = 2;
                  oCtx.strokeStyle = '#ffffff';
                  oCtx.stroke();
                }
                oCtx.restore();
              }
            }
          }
          timerId = window.setTimeout(tick, 110);
        };

        timerId = window.setTimeout(tick, 120);
      } catch {
        if (!cancelled) {
          setCameraStatus(
            'Caméra non détectée ou autorisation refusée. Vous pouvez importer une photo ci-dessous.',
          );
        }
      }
    };

    void startLiveCamera();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      stopCamera();
    };
  }, [step, stopCamera]);

  const addCapturedPhoto = useCallback(
    async (rawDataUrl: string, presetQuad?: ScanQuad) => {
      setProcessing(true);
      try {
        const { width, height, imageData } = await getImageDimensions(rawDataUrl);
        const autoDet = presetQuad
          ? { quad: presetQuad, detected: true, confidence: 1 }
          : detectDocumentQuad(imageData);

        const initialQuad = autoDet.detected ? autoDet.quad : getDefaultScanQuad();
        const processed = await processRawScanDataUrl(rawDataUrl, initialQuad, {
          quality,
          colorMode,
          rotationDeg: 0,
        });

        const entry: ScannedPageEntry = {
          id: `scan-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
          rawDataUrl,
          rawWidth: width,
          rawHeight: height,
          quad: initialQuad,
          rotationDeg: 0,
          colorMode,
          quality,
          processedDataUrl: processed.processedDataUrl,
          processedWidth: processed.width,
          processedHeight: processed.height,
        };

        setPages((prev) => {
          const next = [...prev, entry];
          setActiveIndex(next.length - 1);
          return next;
        });
        setStep('edit');
        setViewMode('preview');
      } catch (err) {
        onShowError(err instanceof Error ? err.message : 'Erreur pendant le traitement de la photo.');
      } finally {
        setProcessing(false);
      }
    },
    [colorMode, onShowError, quality],
  );

  const handleCaptureLiveFrame = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0) {
      onShowError('La caméra n’est pas encore prête.');
      return;
    }
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = video.videoWidth;
    snapCanvas.height = video.videoHeight;
    const ctx = snapCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const rawDataUrl = snapCanvas.toDataURL('image/jpeg', 0.94);
    const quadToUse = sheetDetectedLive ? liveQuadRef.current : undefined;
    await addCapturedPhoto(rawDataUrl, quadToUse);
  };

  const handleNativeCameraFallback = async () => {
    setProcessing(true);
    try {
      const res = await captureAndroidDocumentPhoto();
      if (res.canceled) return;
      if (res.imageDataUrl) {
        await addCapturedPhoto(res.imageDataUrl);
      } else if (res.error) {
        onShowError(res.error);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleImportImageFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl) {
        await addCapturedPhoto(dataUrl);
      }
    }
  };

  const activePage = pages[activeIndex] ?? null;

  const reprocessActivePage = useCallback(
    async (
      updater: (cur: ScannedPageEntry) => {
        quad: ScanQuad;
        rotationDeg: 0 | 90 | 180 | 270;
        colorMode: ScanColorMode;
        quality: ScanQuality;
      },
    ) => {
      if (!activePage) return;
      const nextParams = updater(activePage);
      setProcessing(true);
      try {
        const res = await processRawScanDataUrl(activePage.rawDataUrl, nextParams.quad, {
          quality: nextParams.quality,
          colorMode: nextParams.colorMode,
          rotationDeg: nextParams.rotationDeg,
        });
        setPages((prev) =>
          prev.map((item, idx) =>
            idx === activeIndex
              ? {
                  ...item,
                  ...nextParams,
                  processedDataUrl: res.processedDataUrl,
                  processedWidth: res.width,
                  processedHeight: res.height,
                }
              : item,
          ),
        );
      } catch (err) {
        onShowError(err instanceof Error ? err.message : 'Erreur lors du redressement.');
      } finally {
        setProcessing(false);
      }
    },
    [activeIndex, activePage, onShowError],
  );

  // Recadrage interactif à 4 coins (tactile + souris)
  const updateDraggingCorner = (clientX: number, clientY: number) => {
    const corner = draggingCornerRef.current;
    const stage = cropStageRef.current;
    if (!corner || !stage || !activePage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pt = clampPoint({
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    });
    setPages((prev) =>
      prev.map((item, idx) =>
        idx === activeIndex ? { ...item, quad: { ...item.quad, [corner]: pt } } : item,
      ),
    );
  };

  const commitCropDrag = () => {
    if (!draggingCornerRef.current || !activePage) return;
    draggingCornerRef.current = null;
    void reprocessActivePage((cur) => ({
      quad: cur.quad,
      rotationDeg: cur.rotationDeg,
      colorMode: cur.colorMode,
      quality: cur.quality,
    }));
  };

  const handleCreatePdf = async (shareDirectly: boolean) => {
    if (pages.length === 0) {
      onShowError('Capturez ou importez au moins une page d’abord.');
      return;
    }
    setProcessing(true);
    try {
      const pdfBytes = await buildScannedPdfBytes(pages);
      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName = `Scan-${dateStamp}.pdf`;
      stopCamera();
      onCompletePdf(pdfBytes, fileName, shareDirectly);
    } catch (err) {
      onShowError(err instanceof Error ? err.message : 'Impossible de créer le PDF scanné.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Scanner de documents"
    >
      <div className="modal-card modal-card-wide modal-card-scanner">
        <div className="modal-header">
          <div className="scanner-title-group">
            <h2 className="modal-title">
              <ScanLine size={20} aria-hidden="true" />
              <span>Scanner de documents</span>
            </h2>
            {pages.length > 0 && (
              <span className="scanner-page-badge">
                {pages.length} page{pages.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            className="tab-close-btn"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Fermer le scanner"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="scan-import-input"
          onChange={(e) => {
            void handleImportImageFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {step === 'camera' ? (
          <div className="scanner-camera-layout">
            <div className="scanner-viewfinder">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="scanner-video"
                data-testid="scanner-video"
              />
              <canvas
                ref={overlayCanvasRef}
                className="scanner-overlay-canvas"
                data-testid="scanner-blue-overlay"
              />
              <div
                className={`scanner-live-status ${sheetDetectedLive ? 'is-detected' : ''}`}
                data-testid="scanner-live-status"
              >
                {cameraStatus}
              </div>
            </div>

            <div className="scanner-camera-actions">
              <button
                type="button"
                className="btn btn-primary scanner-shutter-btn"
                disabled={!cameraReady || processing}
                onClick={() => void handleCaptureLiveFrame()}
                data-testid="btn-scanner-capture"
              >
                <Camera size={18} />
                Capturer cette page
              </button>

              {isAndroidNativeApp() && (
                <button
                  type="button"
                  className="btn"
                  disabled={processing}
                  onClick={() => void handleNativeCameraFallback()}
                >
                  <Camera size={16} />
                  Appareil photo système
                </button>
              )}

              <button
                type="button"
                className="btn"
                disabled={processing}
                onClick={() => fileInputRef.current?.click()}
                data-testid="btn-scanner-import-photo"
              >
                <ImagePlus size={16} />
                Importer une photo
              </button>

              {pages.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setStep('edit')}
                >
                  Voir mes {pages.length} page(s)
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="scanner-edit-layout">
            {activePage && (
              <>
                <div className="scanner-mode-tabs">
                  <button
                    type="button"
                    className={`btn ${viewMode === 'preview' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('preview')}
                    data-testid="btn-scan-view-preview"
                  >
                    Aperçu redressé
                  </button>
                  <button
                    type="button"
                    className={`btn ${viewMode === 'crop' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('crop')}
                    data-testid="btn-scan-view-crop"
                  >
                    Recadrer les 4 coins
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={processing}
                    onClick={() => {
                      const nextRot = ((activePage.rotationDeg + 90) % 360) as 0 | 90 | 180 | 270;
                      void reprocessActivePage((cur) => ({
                        quad: cur.quad,
                        rotationDeg: nextRot,
                        colorMode: cur.colorMode,
                        quality: cur.quality,
                      }));
                    }}
                    data-testid="btn-scan-rotate"
                  >
                    <RotateCw size={15} />
                    Pivoter
                  </button>
                  <button
                    type="button"
                    className="btn scanner-btn-danger"
                    disabled={processing}
                    onClick={() => {
                      const nextPages = pages.filter((_, idx) => idx !== activeIndex);
                      setPages(nextPages);
                      if (nextPages.length === 0) {
                        setStep('camera');
                      } else {
                        setActiveIndex(Math.min(activeIndex, nextPages.length - 1));
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    Retirer
                  </button>
                </div>

                <div className="scanner-preview-box">
                  {viewMode === 'preview' ? (
                    <img
                      src={activePage.processedDataUrl}
                      alt={`Page scannée ${activeIndex + 1}`}
                      className="scanner-preview-img"
                      data-testid="scanner-processed-preview"
                    />
                  ) : (
                    <div
                      ref={cropStageRef}
                      className="scanner-crop-stage"
                      onPointerMove={(e) => updateDraggingCorner(e.clientX, e.clientY)}
                      onPointerUp={() => commitCropDrag()}
                      onPointerCancel={() => commitCropDrag()}
                    >
                      <img
                        src={activePage.rawDataUrl}
                        alt="Photo brute à recadrer"
                        className="scanner-crop-raw-img"
                        draggable={false}
                      />
                      <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="scanner-crop-svg"
                      >
                        <polygon
                          points={`${activePage.quad.topLeft.x * 100},${activePage.quad.topLeft.y * 100} ${activePage.quad.topRight.x * 100},${activePage.quad.topRight.y * 100} ${activePage.quad.bottomRight.x * 100},${activePage.quad.bottomRight.y * 100} ${activePage.quad.bottomLeft.x * 100},${activePage.quad.bottomLeft.y * 100}`}
                          fill="rgba(37, 99, 235, 0.16)"
                          stroke="#2563eb"
                          strokeWidth="0.9"
                        />
                      </svg>
                      {(
                        [
                          ['topLeft', 'Coin haut gauche'],
                          ['topRight', 'Coin haut droit'],
                          ['bottomRight', 'Coin bas droit'],
                          ['bottomLeft', 'Coin bas gauche'],
                        ] as Array<[CornerKey, string]>
                      ).map(([cornerKey, label]) => {
                        const pt = activePage.quad[cornerKey];
                        return (
                          <button
                            key={cornerKey}
                            type="button"
                            className="scanner-corner-handle"
                            style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                            aria-label={label}
                            data-testid={`scan-handle-${cornerKey}`}
                            onPointerDown={(e) => {
                              e.currentTarget.setPointerCapture(e.pointerId);
                              draggingCornerRef.current = cornerKey;
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="scanner-settings-row">
                  <div className="scanner-setting-group">
                    <span className="scanner-setting-label">Rendu :</span>
                    <div className="scanner-pill-row">
                      {(
                        [
                          ['couleur', 'Couleur'],
                          ['nb', 'Noir et blanc'],
                          ['gris', 'Gris'],
                        ] as Array<[ScanColorMode, string]>
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          className={`btn ${activePage.colorMode === mode ? 'is-active' : ''}`}
                          onClick={() => {
                            setColorMode(mode);
                            void reprocessActivePage((cur) => ({
                              quad: cur.quad,
                              rotationDeg: cur.rotationDeg,
                              colorMode: mode,
                              quality: cur.quality,
                            }));
                          }}
                          data-testid={`btn-scan-color-${mode}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="scanner-setting-group">
                    <span className="scanner-setting-label">Qualité :</span>
                    <div className="scanner-pill-row">
                      {(['leger', 'standard', 'haute'] as ScanQuality[]).map((q) => (
                        <button
                          key={q}
                          type="button"
                          className={`btn ${activePage.quality === q ? 'is-active' : ''}`}
                          onClick={() => {
                            setQuality(q);
                            void reprocessActivePage((cur) => ({
                              quad: cur.quad,
                              rotationDeg: cur.rotationDeg,
                              colorMode: cur.colorMode,
                              quality: q,
                            }));
                          }}
                          data-testid={`btn-scan-quality-${q}`}
                        >
                          {getQualitySettings(q).label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {pages.length > 0 && (
                  <div className="scanner-thumbs-strip" aria-label="Pages capturées">
                    {pages.map((p, idx) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`scanner-thumb-item ${idx === activeIndex ? 'is-active' : ''}`}
                        onClick={() => setActiveIndex(idx)}
                      >
                        <img src={p.processedDataUrl} alt={`Page ${idx + 1}`} />
                        <span>Page {idx + 1}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="scanner-final-actions">
              <button
                type="button"
                className="btn"
                disabled={processing}
                onClick={() => setStep('camera')}
                data-testid="btn-scan-add-page"
              >
                <FilePlus2 size={16} />
                + Page suivante
              </button>

              <button
                type="button"
                className="btn"
                disabled={processing}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus size={16} />
                + Photo
              </button>

              <button
                type="button"
                className="btn btn-primary"
                disabled={processing || pages.length === 0}
                onClick={() => void handleCreatePdf(false)}
                data-testid="btn-scan-create-pdf"
              >
                <Check size={16} />
                Créer le PDF ({pages.length})
              </button>

              <button
                type="button"
                className="btn btn-primary"
                disabled={processing || pages.length === 0}
                onClick={() => void handleCreatePdf(true)}
                data-testid="btn-scan-create-share"
              >
                <Share2 size={16} />
                Créer et partager
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
