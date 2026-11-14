// Stockage 100 % local des fichiers récents dans IndexedDB (aucune donnée envoyée sur le réseau)
import type { RecentFileRecord } from '../types/pdf';

const DB_NAME = 'basic-pdf-local-db';
const DB_VERSION = 1;
const STORE_NAME = 'recent-files';
const MAX_RECENT_FILES = 12;
// Au-delà de 30 Mo, on évite de copier les octets complets dans IndexedDB pour préserver le quota
const MAX_STORED_BYTES = 30 * 1024 * 1024;

let memoryFallback: RecentFileRecord[] = [];

/** Ouvre la base IndexedDB locale */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('lastOpenedAt', 'lastOpenedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Erreur IndexedDB'));
  });
}

/** Calcule un identifiant stable basé sur le nom et la taille du fichier */
export function buildRecentFileId(fileName: string, fileSize: number): string {
  return `${fileName}__${fileSize}`;
}

/** Récupère la liste des fichiers récents triée du plus récent au plus ancien */
export async function getRecentFiles(): Promise<RecentFileRecord[]> {
  try {
    const db = await openDatabase();
    return await new Promise<RecentFileRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as RecentFileRecord[]).sort(
          (a, b) => b.lastOpenedAt - a.lastOpenedAt,
        );
        resolve(items);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return [...memoryFallback].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }
}

/** Enregistre ou met à jour un fichier récent localement */
export async function saveRecentFile(
  fileName: string,
  fileSize: number,
  numPages: number,
  bytes: Uint8Array,
  filePath?: string,
): Promise<void> {
  const id = buildRecentFileId(fileName, fileSize);
  const record: RecentFileRecord = {
    id,
    fileName,
    ...(filePath ? { filePath } : {}),
    fileSize,
    numPages,
    lastOpenedAt: Date.now(),
    bytes: bytes.byteLength <= MAX_STORED_BYTES ? bytes.slice() : undefined,
  };

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);

      const allReq = store.getAll();
      allReq.onsuccess = () => {
        const sorted = (allReq.result as RecentFileRecord[]).sort(
          (a, b) => b.lastOpenedAt - a.lastOpenedAt,
        );
        // Supprime les entrées les plus anciennes si la limite est dépassée
        for (const extra of sorted.slice(MAX_RECENT_FILES)) {
          store.delete(extra.id);
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    memoryFallback = [record, ...memoryFallback.filter((item) => item.id !== id)].slice(
      0,
      MAX_RECENT_FILES,
    );
  }
}

/** Retire un fichier de l'historique récent */
export async function removeRecentFile(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    memoryFallback = memoryFallback.filter((item) => item.id !== id);
  }
}

/** Vide entièrement l'historique des fichiers récents */
export async function clearRecentFiles(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    memoryFallback = [];
  }
}
