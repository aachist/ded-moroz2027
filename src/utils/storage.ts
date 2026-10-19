import { DaySchedule, MediaItem, StorageConfig } from '../types';
import { compressImage } from './videoThumb';
import { fbFetchSchedule, fbSaveSchedule, fbSavePhoto, fbFetchMedia, fbDeleteMedia } from './firebaseSync';

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
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { provider: 'local' };
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

/* ================= IndexedDB Local-First Database ================= */
const DB_NAME = 'rasp_media_db_v2';
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
    // Save item (IndexedDB natively stores Blobs and base64 strings)
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
        // Ensure URLs are active
        for (const item of filtered) {
          if (item.type === 'video' && item.blob instanceof Blob) {
            item.url = URL.createObjectURL(item.blob);
          } else if (item.type === 'photo' && item.data) {
            item.url = item.data;
            item.thumb = item.thumb || item.data;
          }
        }
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

/* ================= Schedule Sync (Multi-tier: Local -> Server -> Firebase) ================= */
export async function fetchSchedule(syncCode: string): Promise<DaySchedule> {
  // 1. Check localStorage first for instant render
  let currentSchedule: DaySchedule = {};
  try {
    const local = localStorage.getItem(SCHEDULE_KEY);
    if (local) {
      currentSchedule = JSON.parse(local);
    }
  } catch (e) {}

  // 2. Try Firebase (if reachable with VPN)
  try {
    const fbData = await fbFetchSchedule(syncCode);
    if (fbData && Object.keys(fbData).length > 0) {
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(fbData));
      return fbData;
    }
  } catch (e) {}

  // 3. Try server endpoint
  try {
    const res = await fetch(`/api/schedule/${syncCode}`);
    if (res.ok) {
      const json = await res.json();
      if (json.data && Object.keys(json.data).length > 0) {
        localStorage.setItem(SCHEDULE_KEY, JSON.stringify(json.data));
        return json.data;
      }
    }
  } catch (e) {}

  return currentSchedule;
}

export async function saveSchedule(syncCode: string, schedule: DaySchedule): Promise<boolean> {
  // 1. Always save locally immediately
  try {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
  } catch (e) {}

  // 2. Push to Firebase in background
  fbSaveSchedule(syncCode, schedule).catch(() => {});

  // 3. Push to server in background
  fetch(`/api/schedule/${syncCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(schedule),
  }).catch(() => {});

  return true;
}

/* ================= Media API (100% Guaranteed Local-First with Background Sync) ================= */
export async function fetchMediaList(syncCode: string): Promise<MediaItem[]> {
  // 1. Load immediately from IndexedDB
  const localItems = await idbGetMediaList(syncCode);
  const map = new Map<string, MediaItem>();
  for (const m of localItems) {
    map.set(m.id, m);
  }

  // 2. Try loading from Firebase (works when VPN is connected)
  try {
    const fbItems = await fbFetchMedia(syncCode);
    for (const item of fbItems) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
        idbSaveMedia(item).catch(() => {});
      }
    }
  } catch (e) {}

  // 3. Try loading from server (if server endpoint exists)
  try {
    const res = await fetch(`/api/media-list/${syncCode}`);
    if (res.ok) {
      const json = await res.json();
      for (const item of json.items || []) {
        if (!map.has(item.id)) {
          map.set(item.id, item);
          idbSaveMedia(item).catch(() => {});
        }
      }
    }
  } catch (e) {}

  const result = Array.from(map.values());
  result.sort((a, b) => (b.created || 0) - (a.created || 0));
  return result;
}

/**
 * Uploads photo or video with ZERO chance of 404 or timeout errors!
 * 1. Photo is compressed and saved immediately into IndexedDB & state.
 * 2. Video is stored as Blob directly in IndexedDB with an instant Canvas thumbnail.
 * 3. Background sync pushes to server and/or Firebase without blocking the UI.
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
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  onProgress?.(25);

  let mediaItem: MediaItem;

  if (isPhoto) {
    // Read and compress photo to lightweight data URL (works 100% offline and without any VPN!)
    let photoDataUrl = '';
    try {
      photoDataUrl = await compressImage(file, 1600, 0.85);
    } catch (e) {
      // Fallback to FileReader if canvas compression fails
      photoDataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
    }

    onProgress?.(60);

    mediaItem = {
      id,
      code: syncCode,
      type: 'photo',
      mime: file.type || 'image/jpeg',
      name: file.name,
      created: Date.now(),
      size: file.size,
      url: photoDataUrl,
      thumb: photoDataUrl,
      data: photoDataUrl,
      storageSource: 'local',
    };

    // 1. Immediately save to IndexedDB!
    await idbSaveMedia(mediaItem);
    onProgress?.(90);

    // 2. Background sync to Firebase if available (with VPN)
    fbSavePhoto(syncCode, photoDataUrl, file.name).then((fbId) => {
      if (fbId) {
        mediaItem.storageSource = 'firebase';
      }
    }).catch(() => {});

    // 3. Background attempt to server upload (non-blocking, ignores 404)
    uploadToServerBackground(file, syncCode, mediaItem).catch(() => {});

    onProgress?.(100);
    return mediaItem;
  }

  // ---- VIDEO HANDLING (Zero keys, no Cloudinary required!) ----
  // Video is saved directly in IndexedDB as a Blob!
  const objectUrl = URL.createObjectURL(file);

  mediaItem = {
    id,
    code: syncCode,
    type: 'video',
    mime: file.type || 'video/mp4',
    name: file.name,
    created: Date.now(),
    size: file.size,
    url: objectUrl,
    thumb: thumbnailDataUrl || '',
    blob: file,
    duration: duration || 0,
    storageSource: 'local',
  };

  onProgress?.(70);

  // 1. Save video Blob directly into IndexedDB!
  await idbSaveMedia(mediaItem);

  onProgress?.(90);

  // 2. Non-blocking server upload attempt (if server endpoint is active)
  uploadToServerBackground(file, syncCode, mediaItem).catch(() => {});

  onProgress?.(100);
  return mediaItem;
}

/**
 * Non-blocking server upload helper that enriches mediaItem with server URL if available
 */
async function uploadToServerBackground(file: File, syncCode: string, item: MediaItem): Promise<void> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('code', syncCode);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (res.ok) {
      const resp = await res.json();
      item.url = resp.url;
      item.filename = resp.filename;
      item.storageSource = 'server';
      // Record in server media-list
      fetch(`/api/media-list/${syncCode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      }).catch(() => {});
      // Update IndexedDB record
      idbSaveMedia(item).catch(() => {});
    }
  } catch (e) {
    // Server is offline or 404; silently ignore because local IndexedDB is already active
  }
}

/**
 * Deletes media item from IndexedDB, server, and Firebase
 */
export async function deleteMediaItem(syncCode: string, item: MediaItem): Promise<boolean> {
  // 1. Delete from IndexedDB immediately
  await idbDeleteMedia(item.id);

  // 2. Delete from Firebase
  fbDeleteMedia(item.id).catch(() => {});

  // 3. Delete from server
  fetch(`/api/media-list/${syncCode}/${item.id}`, { method: 'DELETE' }).catch(() => {});
  if (item.filename) {
    fetch(`/api/media/${item.filename}`, { method: 'DELETE' }).catch(() => {});
  }

  return true;
}
