// Fonctions pures de validation PDF et traduction des erreurs en français simple

/** Vérifie la signature %PDF- en début de fichier */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 5) {
    return false;
  }
  const headerSlice = bytes.slice(0, 1024);
  const text = new TextDecoder('latin1').decode(headerSlice);
  return text.includes('%PDF-');
}

/** Traduit une erreur technique PDF en message compréhensible pour tout utilisateur */
export function formatPdfError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  const lower = raw.toLowerCase();

  if (lower.includes('password')) {
    return 'Ce document PDF est protégé par un mot de passe et ne peut pas encore être ouvert.';
  }
  if (lower.includes('invalid') || lower.includes('missing pdf') || lower.includes('corrupt')) {
    return "Ce fichier ne semble pas être un document PDF valide ou il est endommagé.";
  }
  if (lower.includes('memory') || lower.includes('out of memory')) {
    return 'Ce document est trop volumineux pour la mémoire disponible de votre appareil.';
  }
  return "Impossible d'ouvrir ce fichier PDF. Vérifiez qu'il s'agit bien d'un fichier PDF valide.";
}
