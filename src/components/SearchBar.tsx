// Barre de recherche et « Rechercher et remplacer » dans le document PDF
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react';

interface SearchBarProps {
  query: string;
  replaceValue: string;
  matchCase: boolean;
  totalMatches: number;
  activeMatchIndex: number;
  showReplaceInitial?: boolean;
  onQueryChange: (q: string) => void;
  onReplaceValueChange: (val: string) => void;
  onToggleMatchCase: () => void;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export function SearchBar({
  query,
  replaceValue,
  matchCase,
  totalMatches,
  activeMatchIndex,
  showReplaceInitial = false,
  onQueryChange,
  onReplaceValueChange,
  onToggleMatchCase,
  onPrevMatch,
  onNextMatch,
  onReplaceOne,
  onReplaceAll,
  onClose,
}: SearchBarProps) {
  const [showReplace, setShowReplace] = useState(showReplaceInitial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (showReplaceInitial) {
      setShowReplace(true);
    }
  }, [showReplaceInitial]);

  return (
    <div className="search-panel" role="dialog" aria-label="Rechercher et remplacer">
      <div className="search-row">
        <div className="search-input-wrap">
          <Search size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Rechercher dans le PDF…"
            aria-label="Texte à rechercher"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                  onPrevMatch();
                } else {
                  onNextMatch();
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </div>

        <span className="search-counter" aria-live="polite">
          {query.trim()
            ? totalMatches > 0
              ? `${activeMatchIndex + 1} / ${totalMatches}`
              : '0 résultat'
            : ''}
        </span>

        <button
          type="button"
          className={`btn btn-icon ${matchCase ? 'is-active' : ''}`}
          onClick={onToggleMatchCase}
          title="Respecter les majuscules et minuscules"
          aria-label="Respecter la casse"
          aria-pressed={matchCase}
        >
          Aa
        </button>

        <button
          type="button"
          className="btn btn-icon"
          onClick={onPrevMatch}
          disabled={totalMatches === 0}
          aria-label="Résultat précédent"
          title="Résultat précédent"
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="btn btn-icon"
          onClick={onNextMatch}
          disabled={totalMatches === 0}
          aria-label="Résultat suivant"
          title="Résultat suivant"
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`btn btn-icon ${showReplace ? 'is-active' : ''}`}
          onClick={() => setShowReplace((p) => !p)}
          title="Afficher Rechercher et remplacer"
          aria-label="Rechercher et remplacer"
          aria-expanded={showReplace}
        >
          <Replace size={16} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="btn btn-icon"
          onClick={onClose}
          aria-label="Fermer la recherche"
          title="Fermer (Échap)"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {showReplace && (
        <div className="search-row search-replace-row">
          <input
            type="text"
            className="search-input search-replace-input"
            placeholder="Remplacer par…"
            aria-label="Texte de remplacement"
            value={replaceValue}
            onChange={(e) => onReplaceValueChange(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={totalMatches === 0}
            onClick={onReplaceOne}
          >
            Remplacer
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={totalMatches === 0}
            onClick={onReplaceAll}
          >
            Tout remplacer
          </button>
        </div>
      )}
    </div>
  );
}
