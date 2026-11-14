// Écran d'accueil : ouverture de PDF, glisser-déposer et liste des fichiers récents
import { useState } from 'react';
import {
  Clock,
  Download,
  FileText,
  FolderOpen,
  ScanLine,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { RecentFileRecord } from '../types/pdf';
import { formatFileSize, formatRelativeDate } from '../utils/formatters';

interface WelcomeScreenProps {
  recentFiles: RecentFileRecord[];
  canInstallPwa: boolean;
  isDesktop?: boolean;
  isAndroid?: boolean;
  onOpenFileClick: () => void;
  onOpenScanner: () => void;
  onOpenSamplePdf: () => void;
  onOpenRecentFile: (record: RecentFileRecord) => void;
  onRemoveRecentFile: (id: string) => void;
  onClearRecentFiles: () => void;
  onInstallPwa: () => void;
  onOpenDesktopSettings?: () => void;
  onOpenAndroidSettings?: () => void;
}

export function WelcomeScreen({
  recentFiles,
  canInstallPwa,
  isDesktop = false,
  isAndroid = false,
  onOpenFileClick,
  onOpenScanner,
  onOpenSamplePdf,
  onOpenRecentFile,
  onRemoveRecentFile,
  onClearRecentFiles,
  onInstallPwa,
  onOpenDesktopSettings,
  onOpenAndroidSettings,
}: WelcomeScreenProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div className="welcome-screen">
      <div className="welcome-container">
        <section className="welcome-hero">
          <div className="welcome-title-row">
            <h1 className="welcome-title">Bienvenue dans Basic PDF</h1>
            <span className="offline-badge">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>100 % hors ligne et privé</span>
            </span>
          </div>
          <p className="welcome-subtitle">
            Ouvrez et lisez vos documents PDF gratuitement, sans compte et sans publicité.
            Vos fichiers restent uniquement sur votre appareil.
          </p>
        </section>

        <section
          className={`drop-zone ${isDragOver ? 'is-drag-over' : ''}`}
          aria-label="Zone d'ouverture de fichier PDF"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={() => {
            // L'ouverture effective est gérée une seule fois par le gestionnaire global de la fenêtre
            setIsDragOver(false);
          }}
        >
          <div className="drop-zone-icon">
            <Upload size={26} aria-hidden="true" />
          </div>
          <h2 className="drop-zone-title">Déposez un PDF ici</h2>
          <p className="drop-zone-hint">
            Ou choisissez un document enregistré sur votre ordinateur ou votre téléphone.
          </p>

          <div className="drop-zone-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onOpenFileClick}
            >
              <FolderOpen size={19} aria-hidden="true" />
              <span>Choisir un fichier PDF</span>
            </button>

            <button
              type="button"
              className="btn btn-lg"
              onClick={onOpenScanner}
              data-testid="welcome-btn-scanner"
            >
              <ScanLine size={19} aria-hidden="true" />
              <span>Scanner un document</span>
            </button>

            <button
              type="button"
              className="btn btn-lg"
              onClick={onOpenSamplePdf}
            >
              <Sparkles size={18} aria-hidden="true" />
              <span>Essayer un document d’exemple</span>
            </button>

            {canInstallPwa && (
              <button
                type="button"
                className="btn btn-lg"
                onClick={onInstallPwa}
              >
                <Download size={18} aria-hidden="true" />
                <span>Installer l’application</span>
              </button>
            )}

            {isDesktop && onOpenDesktopSettings && (
              <button
                type="button"
                className="btn btn-lg"
                onClick={onOpenDesktopSettings}
              >
                <Settings size={18} aria-hidden="true" />
                <span>Lecteur par défaut & Mises à jour</span>
              </button>
            )}

            {isAndroid && onOpenAndroidSettings && (
              <button
                type="button"
                className="btn btn-lg"
                onClick={onOpenAndroidSettings}
              >
                <Settings size={18} aria-hidden="true" />
                <span>Lecteur par défaut & Mises à jour</span>
              </button>
            )}
          </div>
        </section>

        <section className="recent-section" aria-label="Fichiers récents">
          <div className="recent-header">
            <h2 className="recent-heading">
              <Clock
                size={17}
                aria-hidden="true"
                style={{ verticalAlign: '-3px', marginRight: 6 }}
              />
              Fichiers récents
            </h2>

            {recentFiles.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={onClearRecentFiles}
              >
                Effacer la liste
              </button>
            )}
          </div>

          {recentFiles.length === 0 ? (
            <div className="recent-empty">
              Aucun document récent pour le moment. Les PDF que vous ouvrez apparaîtront ici.
            </div>
          ) : (
            <div className="recent-list">
              {recentFiles.map((item) => (
                <div key={item.id} className="recent-card">
                  <button
                    type="button"
                    className="recent-card-open"
                    onClick={() => onOpenRecentFile(item)}
                    title={item.fileName}
                  >
                    <div className="recent-card-icon">
                      <FileText size={20} aria-hidden="true" />
                    </div>
                    <div className="recent-card-info">
                      <span className="recent-card-name">{item.fileName}</span>
                      <span className="recent-card-meta">
                        {item.numPages} {item.numPages > 1 ? 'pages' : 'page'} •{' '}
                        {formatFileSize(item.fileSize)} •{' '}
                        {formatRelativeDate(item.lastOpenedAt)}
                        {!item.bytes ? ' • À re-sélectionner' : ''}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="recent-card-remove"
                    onClick={() => onRemoveRecentFile(item.id)}
                    aria-label={`Retirer ${item.fileName} des fichiers récents`}
                    title="Retirer de la liste"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
