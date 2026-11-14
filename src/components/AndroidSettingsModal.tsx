// Fenêtre Paramètres Android : lecteur PDF par défaut, versionCode calculé et mise à jour APK facultative vérifiée par SHA-256
import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import type { AndroidAppInfo, AndroidUpdateCheckResult } from '../types/android';
import {
  checkAndroidUpdates,
  downloadAndInstallAndroidUpdate,
  getAndroidAppInfo,
  openAndroidDefaultAppsSettings,
} from '../utils/androidBridge';

const STORAGE_REPO_KEY = 'basic-pdf-github-repo-v1';

interface AndroidSettingsModalProps {
  onShowInfo: (msg: string) => void;
  onShowError: (msg: string) => void;
  onClose: () => void;
}

export function AndroidSettingsModal({
  onShowInfo,
  onShowError,
  onClose,
}: AndroidSettingsModalProps) {
  const [appInfo, setAppInfo] = useState<AndroidAppInfo | null>(null);
  const [repoSlug, setRepoSlug] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_REPO_KEY) || 'MrTeliot38/Basic-PDF';
    } catch {
      return 'MrTeliot38/Basic-PDF';
    }
  });
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AndroidUpdateCheckResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadInfo = useCallback(async () => {
    const info = await getAndroidAppInfo();
    if (info) {
      setAppInfo(info);
    }
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const handleOpenDefaultApps = async () => {
    const opened = await openAndroidDefaultAppsSettings();
    if (opened) {
      onShowInfo(
        'Dans les réglages Android, autorisez « Ouverture par défaut » ou ouvrez un PDF avec Basic PDF → Toujours.',
      );
    } else {
      onShowError('Impossible d’ouvrir directement les réglages Android sur cet appareil.');
    }
  };

  const handleCheckUpdates = async () => {
    if (checking) return;
    try {
      localStorage.setItem(STORAGE_REPO_KEY, repoSlug.trim());
    } catch {
      // Stockage local facultatif
    }
    setChecking(true);
    setStatusMessage(null);
    try {
      const res = await checkAndroidUpdates(repoSlug);
      setUpdateInfo(res);
      if (!res.updateAvailable) {
        setStatusMessage(
          `Vous utilisez déjà la dernière version (${res.currentVersion}, code ${res.currentVersionCode}).`,
        );
      }
    } catch (err) {
      onShowError(
        err instanceof Error ? err.message : 'Impossible de vérifier les mises à jour Android.',
      );
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!updateInfo?.apkUrl || !updateInfo.apkFileName || !updateInfo.expectedSha256) {
      onShowError(
        'Cette version ne fournit pas d’empreinte SHA-256 vérifiable ; installation refusée par sécurité.',
      );
      return;
    }

    setDownloading(true);
    try {
      const res = await downloadAndInstallAndroidUpdate(
        updateInfo.apkUrl,
        updateInfo.apkFileName,
        updateInfo.expectedSha256,
      );
      if (res.needsUnknownSourcePermission) {
        onShowInfo(
          'Autorisez « Installer des applis inconnues » pour Basic PDF dans l’écran Android qui vient de s’ouvrir, puis relancez.',
        );
      } else if (res.installerLaunched) {
        setStatusMessage(
          `APK vérifié (SHA-256 : ${res.actualSha256?.slice(0, 12)}…). Validez la mise à jour à l’écran.`,
        );
      } else if (res.error) {
        onShowError(res.error);
      }
    } catch (err) {
      onShowError(err instanceof Error ? err.message : 'Échec du téléchargement sécurisé.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Paramètres Android de Basic PDF"
    >
      <div className="modal-card modal-card-desktop">
        <div className="modal-header">
          <h2 className="modal-title">
            <Settings size={18} aria-hidden="true" />
            <span>Paramètres Android — Basic PDF {appInfo?.versionName ?? '0.1.0'}</span>
          </h2>
          <button
            type="button"
            className="tab-close-btn"
            onClick={onClose}
            aria-label="Fermer les paramètres"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body-stack">
          <section className="desktop-settings-card">
            <h3 className="desktop-card-title">Lecteur PDF par défaut et réception d’applis</h3>
            <p className="modal-subtitle">
              Basic PDF reçoit les PDF ouverts depuis WhatsApp, Gmail ou Mes fichiers. Touchez un
              fichier <strong>.pdf</strong> → choisissez <strong>Basic PDF</strong> →{' '}
              <strong>Toujours</strong> pour en faire votre lecteur par défaut.
            </p>
            <div className="desktop-actions-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleOpenDefaultApps()}
              >
                <ExternalLink size={15} aria-hidden="true" />
                <span>Ouvrir les réglages Applications Android</span>
              </button>
            </div>
          </section>

          <section className="desktop-settings-card">
            <h3 className="desktop-card-title">Version Android &amp; enregistrement sûr (0 Ko)</h3>
            <p className="modal-subtitle">
              Version installée : <strong>{appInfo?.versionName ?? '0.1.0'}</strong> (code interne{' '}
              <strong>{appInfo?.versionCode ?? 100}</strong> selon la formule{' '}
              <em>majeur×10000 + mineur×100 + correctif</em>). Chaque sauvegarde est écrite
              d’abord dans un fichier temporaire vérifié avant d’être copiée, afin d’éviter tout
              fichier vide à 0 Ko.
            </p>
          </section>

          <section className="desktop-settings-card">
            <h3 className="desktop-card-title">Vérifier les mises à jour (facultatif)</h3>
            <p className="modal-subtitle">
              Aucune connexion Internet automatique. Appuyez ci-dessous uniquement pour interroger
              GitHub et contrôler la signature d’intégrité <strong>SHA-256</strong> de l’APK avant
              installation.
            </p>

            <div className="desktop-update-row">
              <label htmlFor="android-update-repo" className="inspector-label">
                Dépôt GitHub
              </label>
              <div className="desktop-actions-row">
                <input
                  id="android-update-repo"
                  type="text"
                  className="inspector-select"
                  value={repoSlug}
                  onChange={(e) => setRepoSlug(e.target.value)}
                  placeholder="MrTeliot38/Basic-PDF"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={checking}
                  onClick={() => void handleCheckUpdates()}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  <span>{checking ? 'Vérification…' : 'Vérifier maintenant'}</span>
                </button>
              </div>
            </div>

            {statusMessage && (
              <div className="desktop-update-status">
                <CheckCircle2 size={16} color="var(--accent)" aria-hidden="true" />
                <span>{statusMessage}</span>
              </div>
            )}

            {updateInfo?.updateAvailable && (
              <div className="desktop-update-box">
                <p>
                  <strong>Nouvelle version disponible : {updateInfo.latestVersion}</strong>
                </p>
                {updateInfo.apkUrl && updateInfo.expectedSha256 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={downloading}
                    onClick={() => void handleDownloadAndInstall()}
                  >
                    <Download size={15} aria-hidden="true" />
                    <span>
                      {downloading
                        ? 'Téléchargement et contrôle SHA-256…'
                        : `Télécharger et installer (${updateInfo.apkFileName})`}
                    </span>
                  </button>
                ) : (
                  <p className="modal-subtitle">
                    Aucun APK avec empreinte SHA-256 trouvée dans cette version GitHub.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
