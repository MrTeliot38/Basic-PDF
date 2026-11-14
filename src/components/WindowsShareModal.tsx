// Fenêtre de partage simplifié sous Windows : enregistrer/préparer le PDF puis l'afficher dans l'Explorateur pour le joindre dans WhatsApp ou un e-mail
import { FolderOpen, Mail, Save, Share2, X } from 'lucide-react';
import { getDesktopBridge } from '../utils/desktopBridge';

interface WindowsShareModalProps {
  fileName: string;
  preparedFilePath: string;
  onSaveCopyToFolder: () => Promise<void>;
  onClose: () => void;
}

export function WindowsShareModal({
  fileName,
  preparedFilePath,
  onSaveCopyToFolder,
  onClose,
}: WindowsShareModalProps) {
  const desktop = getDesktopBridge();

  const handleRevealFile = async () => {
    if (!desktop) return;
    await desktop.revealInExplorer(preparedFilePath);
  };

  const handleOpenMail = async () => {
    if (!desktop) return;
    await desktop.revealInExplorer(preparedFilePath);
    await desktop.openMailClient(
      `Document PDF : ${fileName}`,
      `Bonjour,\n\nVeuillez trouver ci-joint le document « ${fileName} ».\n`,
    );
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-desktop"
        role="dialog"
        aria-modal="true"
        aria-label="Partager ce PDF sous Windows"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <Share2 size={18} aria-hidden="true" />
            <span>Partager par e-mail ou WhatsApp</span>
          </h2>
          <button
            type="button"
            className="tab-close-btn"
            aria-label="Fermer le partage"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body-stack">
          <p className="modal-hint">
            Votre document à jour (<strong>{fileName}</strong>) est prêt avec toutes vos
            modifications. Pour l’envoyer facilement :
          </p>

          <div className="desktop-share-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => void handleRevealFile()}
            >
              <FolderOpen size={17} aria-hidden="true" />
              <span>Afficher le PDF dans l’Explorateur Windows</span>
            </button>
            <p className="modal-hint">
              Le fichier sera déjà sélectionné : il suffira de le glisser dans{' '}
              <strong>WhatsApp</strong> ou dans votre messagerie.
            </p>

            <button
              type="button"
              className="btn"
              onClick={() => void handleOpenMail()}
            >
              <Mail size={16} aria-hidden="true" />
              <span>Ouvrir mon logiciel d’e-mail + afficher le fichier</span>
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => void onSaveCopyToFolder()}
            >
              <Save size={16} aria-hidden="true" />
              <span>Enregistrer une copie dans un autre dossier (Bureau, Documents…)</span>
            </button>
          </div>
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
