import { DaySchedule, MediaItem, StorageConfig } from '../types';

const SYNC_CODE_KEY = 'syncCode';
const SCHEDULE_KEY = 'weekSchedule';
const STORAGE_CONFIG_KEY = 'storage_config_settings';

// Generate safe 8-character sync code: 4 chars - 4 chars
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export function generateSyncCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s.slice(0, 4) + '-' + s.slice(4);
}

export function getStoredSyncCode(): string {
  let code = localStorage.getItem(SYNC_CODE_KEY);
  if (!code || !/^[a-z0-9-]{6,12}$/i.test(code)) {
    code = generateSyncCode();
    localStorage.setItem(SYNC_CODE_KEY, code);
  }
  return code;
}

export function setStoredSyncCode(code: string): void {
  localStorage.setItem(SYNC_CODE_KEY, code.trim().toLowerCase());
}

export function getStorageConfig(): StorageConfig {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn(e);
  }
  return {
    provider: 'local',
  };
}

export function setStorageConfig(cfg: StorageConfig): void {
  localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(cfg));
}

// Format file size in Russian
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 Б';
  if (bytes > 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
  }
  return Math.round(bytes / 1024) + ' КБ';
}

// Russian plural forms
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/* ================= IndexedDB local media cache ================= */
const DB_NAME = 'rasp_media_db';
const STORE_NAME = 'media_items';

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSaveMedia(item: MediaItem): Promise<void> {
  try {
    const db = await openIndexedDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
  } catch (e) {
    console.warn('IDB save error:', e);
  }
}

export async function idbGetMediaList(syncCode: string): Promise<MediaItem[]> {
  try {
    const db = await openIndexedDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all: MediaItem[] = req.result || [];
        const filtered = all.filter((m) => m.code === syncCode);
        filtered.sort((a, b) => (b.created || 0) - (a.created || 0));
        resolve(filtered);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    console.warn('IDB get error:', e);
    return [];
  }
}

export async function idbDeleteMedia(id: string): Promise<void> {
  try {
    const db = await openIndexedDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
  } catch (e) {
    console.warn('IDB delete error:', e);
  }
}

/* ================= Schedule API & LocalStorage ================= */
export async function fetchSchedule(syncCode: string): Promise<DaySchedule> {
  // 1. Try server endpoint
  try {
    const res = await fetch(`/api/schedule/${syncCode}`);
    if (res.ok) {
      const json = await res.json();
      if (json.data && Object.keys(json.data).length > 0) {
        localStorage.setItem(SCHEDULE_KEY, JSON.stringify(json.data));
        return json.data;
      }
    }
  } catch (e) {
    // offline or dev
  }

  // 2. Fallback to localStorage
  try {
    const local = localStorage.getItem(SCHEDULE_KEY);
    if (local) {
      return JSON.parse(local);
    }
  } catch (e) {}

  return {};
}

export async function saveSchedule(syncCode: string, schedule: DaySchedule): Promise<boolean> {
  // Save local first
  try {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
  } catch (e) {}

  // Push to server
  try {
    const res = await fetch(`/api/schedule/${syncCode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedule),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/* ================= Media API & Uploads ================= */
export async function fetchMediaList(syncCode: string): Promise<MediaItem[]> {
  let serverItems: MediaItem[] = [];
  try {
    const res = await fetch(`/api/media-list/${syncCode}`);
    if (res.ok) {
      const json = await res.json();
      serverItems = json.items || [];
    }
  } catch (e) {}

  // Also get local IDB items
  const localItems = await idbGetMediaList(syncCode);

  // Merge server & local items by id
  const map = new Map<string, MediaItem>();
  for (const m of localItems) {
    map.set(m.id, m);
  }
  for (const m of serverItems) {
    map.set(m.id, m);
    // update local IDB with server item
    idbSaveMedia(m).catch(() => {});
  }

  const result = Array.from(map.values());
  result.sort((a, b) => (b.created || 0) - (a.created || 0));
  return result;
}

/**
 * Uploads media file to the server without needing ANY API keys!
 * Supports progress callback 0% - 100%.
 */
export async function uploadMediaFile(
  file: File,
  syncCode: string,
  thumbnailDataUrl?: string,
  duration?: number,
  onProgress?: (percent: number) => void
): Promise<MediaItem> {
  const isVideo = file.type.startsWith('video/');
  const isPhoto = file.type.startsWith('image/');

  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('code', syncCode);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct);
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          const mediaItem: MediaItem = {
            id: resp.id || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            code: syncCode,
            type: isVideo ? 'video' : 'photo',
            mime: file.type || resp.mimeType,
            name: file.name,
            created: Date.now(),
            size: file.size,
            url: resp.url,
            thumb: thumbnailDataUrl || (isPhoto ? resp.url : ''),
            filename: resp.filename,
            duration: duration || 0,
          };

          // Record in server media-list
          await fetch(`/api/media-list/${syncCode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mediaItem),
          }).catch(() => {});

          // Record in IDB
          await idbSaveMedia(mediaItem);

          resolve(mediaItem);
        } catch (err: any) {
          reject(new Error(err.message || 'Ошибка парсинга ответа сервера'));
        }
      } else {
        let errorMsg = `Ошибка сервера (${xhr.status})`;
        try {
          const errJson = JSON.parse(xhr.responseText);
          if (errJson.error) errorMsg = errJson.error;
        } catch (e) {}
        reject(new Error(errorMsg));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Сетевая ошибка при передаче файла на сервер'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Время ожидания загрузки истекло'));
    };

    xhr.send(formData);
  });
}

/**
 * Deletes media item from both server and local storage
 */
export async function deleteMediaItem(syncCode: string, item: MediaItem): Promise<boolean> {
  try {
    await fetch(`/api/media-list/${syncCode}/${item.id}`, { method: 'DELETE' });
  } catch (e) {}

  if (item.filename) {
    try {
      await fetch(`/api/media/${item.filename}`, { method: 'DELETE' });
    } catch (e) {}
  }

  await idbDeleteMedia(item.id);
  return true;
}
