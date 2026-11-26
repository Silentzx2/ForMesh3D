import { MotionClipV1, validateMotionClipV1 } from '@/services/motionClient';

const DB_NAME = 'formesh3d_motion_clips';
const DB_VERSION = 1;
const STORE_NAME = 'clips';

export type SavedClipSource = 'generated' | 'preview' | 'preset';

export interface SavedMotionClipRecord {
  id: string;
  name: string;
  savedAt: number;
  source: SavedClipSource;
  clip: MotionClipV1;
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openMotionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open motion IndexedDB'));
  });
}

export async function listSavedMotionClips(): Promise<SavedMotionClipRecord[]> {
  if (!isIndexedDbAvailable()) return [];
  const db = await openMotionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const rawRecords = Array.isArray(req.result) ? req.result : [];
      const validRecords: SavedMotionClipRecord[] = [];
      for (const rec of rawRecords) {
        if (!rec || typeof rec !== 'object') continue;
        try {
          const validatedClip = validateMotionClipV1((rec as any).clip);
          validRecords.push({
            id: String((rec as any).id ?? validatedClip.id),
            name: String((rec as any).name ?? validatedClip.name),
            savedAt: typeof (rec as any).savedAt === 'number' ? (rec as any).savedAt : Date.now(),
            source:
              (rec as any).source === 'generated' ||
              (rec as any).source === 'preview' ||
              (rec as any).source === 'preset'
                ? (rec as any).source
                : 'preview',
            clip: validatedClip,
          });
        } catch {
          // Skip corrupted IndexedDB entries
        }
      }
      validRecords.sort((a, b) => b.savedAt - a.savedAt);
      resolve(validRecords);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to read saved motion clips'));
    tx.oncomplete = () => db.close();
  });
}

export async function getSavedMotionClip(id: string): Promise<SavedMotionClipRecord | null> {
  if (!isIndexedDbAvailable()) return null;
  const db = await openMotionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => {
      const rec = req.result;
      if (!rec) {
        resolve(null);
        return;
      }
      try {
        const validatedClip = validateMotionClipV1(rec.clip);
        resolve({
          id: String(rec.id ?? validatedClip.id),
          name: String(rec.name ?? validatedClip.name),
          savedAt: typeof rec.savedAt === 'number' ? rec.savedAt : Date.now(),
          source: rec.source ?? 'preview',
          clip: validatedClip,
        });
      } catch {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to load saved motion clip'));
    tx.oncomplete = () => db.close();
  });
}

export async function saveMotionClip(
  clip: MotionClipV1,
  source: SavedClipSource = 'preview'
): Promise<SavedMotionClipRecord> {
  const validatedClip = validateMotionClipV1(clip);
  const record: SavedMotionClipRecord = {
    id: validatedClip.id,
    name: validatedClip.name,
    savedAt: Date.now(),
    source,
    clip: validatedClip,
  };

  const db = await openMotionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);

    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error ?? new Error('Failed to save motion clip'));
    tx.oncomplete = () => db.close();
  });
}

export async function deleteSavedMotionClip(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openMotionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Failed to delete saved motion clip'));
    tx.oncomplete = () => db.close();
  });
}
