// Fenêtre Paramètres Windows : lecteur PDF par défaut, polices système et vérification facultative des mises à jour (SHA-256)
import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  Settings,
  ShieldCheck,
  Type,
  X,
} from 'lucide-react';
import type {
  DesktopAppInfo,
  DesktopDefaultPdfStatus,
  DesktopUpdateCheckResult,
} from '../types/desktop';
import { getDesktopBridge, loadInstalledSystemFonts } from '../utils/desktopBridge';

const STORAGE_REPO_KEY = 'basic-pdf-github-repo-v1';

interface DesktopSettingsModalProps {
  onShowInfo: (msg: string) => void;
  onShowError: (msg: string) => void;
  onClose: () => void;
}

export function DesktopSettingsModal({
  onShowInfo,
  onShowError,
  onClose,
}: DesktopSettingsModalProps) {
  const desktop = getDesktopBridge();
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<DesktopDefaultPdfStatus | null>(null);
  const [fontsCount, setFontsCount] = useState<number>(0);

  const [repoSlug, setRepoSlug] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_REPO_KEY) || 'MrTeliot38/Basic-PDF';
    } catch {
      return 'MrTeliot38/Basic-PDF';
    }
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateCheckResult | null>(null);
  const [verifiedInstaller, setVerifiedInstaller] = useState<{
    installerPath: string;
    actualSha256: string;
  } | null>(null);
  const [updateStatusMsg, setUpdateStatusMsg] = useState<string | null>(null);

  const refreshLocalInfo = useCallback(async () => {
    if (!desktop) return;
    const [info, pdfStatus, fonts] = await Promise.all([
      desktop.getAppInfo(),
      desktop.getDefaultPdfStatus(),
      loadInstalledSystemFonts(),
    ]);
    setAppInfo(info);
    setDefaultStatus(pdfStatus);
    setFontsCount(fonts.length);
  }, [desktop]);

  useEffect(() => {
    void refreshLocalInfo();
  }, [refreshLocalInfo]);

  const handleOpenDefaultApps = async () => {
    if (!desktop) return;
    await desktop.openWindowsDefaultAppsSettings();
    onShowInfo(
      'Dans Windows « Applications par défaut », recherchez « .pdf » puis sélectionnez Basic PDF.',
    );
  };

  const handleCheckUpdates = async () => {
    if (!desktop || checkingUpdate) return;
    try {
      localStorage.setItem(STORAGE_REPO_KEY, repoSlug.trim());
    } catch {
      // Stockage local facultatif
    }
    setCheckingUpdate(true);
    setUpdateStatusMsg(null);
    setVerifiedInstaller(null);
    try {
      const res = await desktop.checkForUpdates(repoSlug);
      setUpdateInfo(res);
      if (!res.updateAvailable) {
        setUpdateStatusMsg(`Vous utilisez déjà la dernière version (${res.currentVersion}).`);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Impossible de vérifier les mises à jour.';
      onShowError(message);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadAndVerify = async () => {
    if (!desktop || !updateInfo?.installerUrl || !updateInfo.installerFileName) return;
    if (!updateInfo.expectedSha256) {
      onShowError(
        "Aucune empreinte de sécurité SHA-256 n'est publiée avec cette version : téléchargement bloqué par précaution.",
      );
      return;
    }

    setDownloadingUpdate(true);
    setUpdateStatusMsg(null);
    try {
      const result = await desktop.downloadAndVerifyUpdate(
        updateInfo.installerUrl,
        updateInfo.installerFileName,
        updateInfo.expectedSha256,
      );
      setVerifiedInstaller(result);
      setUpdateStatusMsg('Téléchargement réussi et empreinte SHA-256 vérifiée à 100 %.');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Échec de la vérification de sécurité SHA-256.';
      onShowError(message);
    } finally {
      setDownloadingUpdate(false);
    }
  };

  const handleInstallNow = async () => {
    if (!desktop || !verifiedInstaller) return;
    const res = await desktop.launchVerifiedUpdateInstaller(verifiedInstaller.installerPath);
    if (!res.ok && res.error) {
      onShowError(res.error);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-desktop"
        role="dialog"
        aria-modal="true"
        aria-label="Paramètres Windows et mises à jour"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <Settings size={18} aria-hidden="true" />
            <span>
              Paramètres Windows {appInfo ? `— Basic PDF ${appInfo.version}` : ''}
            </span>
          </h2>
          <button
            type="button"
            className="tab-close-btn"
            aria-label="Fermer les paramètres"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body-stack">
          {/* 1. Lecteur PDF par défaut */}
          <section className="desktop-settings-card" aria-label="Lecteur PDF par défaut">
            <h3 className="desktop-card-title">Lecteur PDF par défaut sous Windows</h3>
            <p className="modal-hint">
              Statut actuel :{' '}
              <strong>
                {defaultStatus?.isBasicPdfDefault
                  ? 'Basic PDF est votre lecteur PDF par défaut'
                  : defaultStatus?.progId
                    ? `Autre application (${defaultStatus.progId})`
                    : 'Non défini sur Basic PDF'}
              </strong>
            </p>
            <p className="modal-hint">
              Pour ouvrir tous vos PDF d’un double-clic depuis l’Explorateur : ouvrez les
              paramètres Windows, tapez <strong>.pdf</strong> puis choisissez{' '}
              <strong>Basic PDF</strong>.
            </p>
            <div className="desktop-actions-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleOpenDefaultApps()}
              >
                <ExternalLink size={15} aria-hidden="true" />
                <span>Ouvrir les Applications par défaut de Windows</span>
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void refreshLocalInfo()}
              >
                <RefreshCw size={15} aria-hidden="true" />
                <span>Actualiser</span>
              </button>
            </div>
          </section>

          {/* 2. Polices système locales */}
          <section className="desktop-settings-card" aria-label="Polices de l'ordinateur">
            <h3 className="desktop-card-title">
              <Type size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
              Polices installées sur l’ordinateur
            </h3>
            <p className="modal-hint">
              <strong>{fontsCount}</strong>{' '}
              {fontsCount > 1 ? 'polices Windows détectées localement' : 'police détectée'}.
              Lors d’une correction ou d’une lecture OCR sur un document scanné, Basic PDF choisit
              automatiquement la police la plus proche et l’intègre dans le PDF enregistré.
            </p>
          </section>

          {/* 3. Mises à jour facultatives SHA-256 */}
          <section
            className="desktop-settings-card"
            aria-label="Mises à jour facultatives"
          >
            <h3 className="desktop-card-title">
              <ShieldCheck
                size={16}
                aria-hidden="true"
                style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--accent)' }}
              />
              Vérifier les mises à jour (facultatif)
            </h3>
            <p className="modal-hint">
              Aucune connexion Internet n’est lancée automatiquement. Cliquez sur le bouton
              ci-dessous uniquement si vous souhaitez interroger GitHub et contrôler la signature
              d’intégrité <strong>SHA-256</strong> avant toute installation.
            </p>

            <div className="desktop-update-row">
              <label htmlFor="desktop-update-repo" className="inspector-label">
                Dépôt GitHub
              </label>
              <div className="desktop-actions-row">
                <input
                  id="desktop-update-repo"
                  type="text"
                  className="inspector-select"
                  value={repoSlug}
                  onChange={(e) => setRepoSlug(e.target.value)}
                  placeholder="utilisateur/basic-pdf"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={checkingUpdate}
                  onClick={() => void handleCheckUpdates()}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  <span>{checkingUpdate ? 'Vérification…' : 'Vérifier maintenant'}</span>
                </button>
              </div>
            </div>

            {updateStatusMsg && (
              <div className="desktop-update-status">
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>{updateStatusMsg}</span>
              </div>
            )}

            {updateInfo?.updateAvailable && (
              <div className="desktop-update-box">
                <p>
                  Nouvelle version disponible : <strong>v{updateInfo.latestVersion}</strong> (actuelle :{' '}
                  {updateInfo.currentVersion})
                </p>
                {updateInfo.expectedSha256 && (
                  <p className="desktop-sha-code">
                    SHA-256 attendu : <code>{updateInfo.expectedSha256.slice(0, 24)}…</code>
                  </p>
                )}

                {!verifiedInstaller ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={downloadingUpdate || !updateInfo.installerUrl}
                    onClick={() => void handleDownloadAndVerify()}
                  >
                    <Download size={15} aria-hidden="true" />
                    <span>
                      {downloadingUpdate
                        ? 'Téléchargement et contrôle SHA-256…'
                        : 'Télécharger et vérifier (SHA-256)'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleInstallNow()}
                  >
                    <CheckCircle2 size={15} aria-hidden="true" />
                    <span>Installer par-dessus la version actuelle</span>
                  </button>
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
