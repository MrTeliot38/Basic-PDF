// Barre d'onglets : affiche l'accueil et chaque PDF ouvert indépendamment
import { FileText, Home, X } from 'lucide-react';
import type { TabDocument } from '../types/pdf';

interface TabBarProps {
  tabs: TabDocument[];
  activeTabId: string | null;
  onSelectTab: (tabId: string | null) => void;
  onCloseTab: (tabId: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
}: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Documents ouverts">
      <button
        type="button"
        className={`tab-home-btn ${activeTabId === null ? 'is-active' : ''}`}
        onClick={() => onSelectTab(null)}
        title="Afficher l'écran d'accueil et les fichiers récents"
        aria-current={activeTabId === null ? 'page' : undefined}
      >
        <Home size={16} aria-hidden="true" />
        <span>Accueil</span>
      </button>

      <div className="tab-list" role="tablist" aria-label="Onglets PDF">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`tab-item ${isActive ? 'is-active' : ''}`}
              role="tab"
              aria-selected={isActive}
              onAuxClick={(event) => {
                // Fermeture pratique au clic molette sur l'onglet
                if (event.button === 1) {
                  event.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
            >
              <button
                type="button"
                className="tab-select-area"
                onClick={() => onSelectTab(tab.id)}
                title={tab.fileName}
              >
                <FileText size={15} aria-hidden="true" />
                <span className="tab-title">{tab.fileName}</span>
                {tab.isDirty && (
                  <span
                    className="tab-dirty-dot"
                    title="Document modifié"
                    aria-label="Document modifié"
                  />
                )}
              </button>

              <button
                type="button"
                className="tab-close-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
                aria-label={`Fermer ${tab.fileName}`}
                title="Fermer l'onglet (Ctrl+W)"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
