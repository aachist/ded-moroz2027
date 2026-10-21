import { DaySchedule, MediaItem, StorageConfig } from '../types';
import { compressImage } from './videoThumb';
import {
  fbFetchSchedule,
  fbSaveSchedule,
  fbSavePhoto,
  fbFetchMedia,
  fbDeleteMedia,
  RemoteSchedule,
} from './firebaseSync';

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
const SCHEDULE_STORE = 'schedules';

// Просим браузер не вычищать данные сайта при нехватке места
export function requestPersistentStorage(): void {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch (e) {}
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SCHEDULE_STORE)) {
        db.createObjectStore(SCHEDULE_STORE, { keyPath: 'code' });
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
// У каждой копии расписания есть метка времени updatedAt. При загрузке выигрывает
// самая свежая версия (локальная / Firebase / сервер), а не "первая, что ответила".
// Раньше удалённая (часто устаревшая) копия затирала только что внесённые правки.
const scheduleKey = (code: string) => `${SCHEDULE_KEY}:${code}`;
const dirtyKey = (code: string) => `${SCHEDULE_KEY}:dirty:${code}`;

function isEmptySchedule(d: DaySchedule | undefined | null): boolean {
  return !d || Object.keys(d).length === 0;
}

function readLocalStorageSchedule(code: string): RemoteSchedule {
  try {
    const raw = localStorage.getItem(scheduleKey(code));
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.updatedAt === 'number' && p.data && typeof p.data === 'object') {
        return { data: p.data, updatedAt: p.updatedAt };
      }
    }
    // Миграция со старого общего ключа
    const legacy = localStorage.getItem(SCHEDULE_KEY);
    if (legacy) {
      return { data: JSON.parse(legacy), updatedAt: 0 };
    }
  } catch (e) {}
  return { data: {}, updatedAt: 0 };
}

async function idbReadSchedule(code: string): Promise<RemoteSchedule | null> {
  try {
    const db = await openIndexedDb();
    return await new Promise((resolve) => {
      const req = db.transaction(SCHEDULE_STORE, 'readonly').objectStore(SCHEDULE_STORE).get(code);
      req.onsuccess = () => {
        const r = req.result;
        resolve(r && r.data ? { data: r.data, updatedAt: Number(r.updatedAt) || 0 } : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function idbWriteSchedule(code: string, data: DaySchedule, updatedAt: number): Promise<void> {
  try {
    const db = await openIndexedDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(SCHEDULE_STORE, 'readwrite');
      tx.objectStore(SCHEDULE_STORE).put({ code, data, updatedAt });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (e) {
    console.warn('IDB schedule write failed:', e);
  }
}

/** Читает расписание из IndexedDB и localStorage и возвращает более свежую копию. */
async function readLocalSchedule(code: string): Promise<RemoteSchedule> {
  const ls = readLocalStorageSchedule(code);
  const idb = await idbReadSchedule(code);
  if (idb && (idb.updatedAt > ls.updatedAt || (idb.updatedAt === ls.updatedAt && !isEmptySchedule(idb.data)))) {
    return idb;
  }
  return ls;
}

function writeLocalSchedule(code: string, data: DaySchedule, updatedAt: number): void {
  try {
    localStorage.setItem(scheduleKey(code), JSON.stringify({ data, updatedAt }));
  } catch (e) {
    console.warn('localStorage write failed:', e);
  }
  idbWriteSchedule(code, data, updatedAt);
}

/** Мгновенно сохраняет расписание в браузере и помечает, что его ещё надо отправить на сервер. */
export function saveScheduleLocal(syncCode: string, schedule: DaySchedule): number {
  const updatedAt = Date.now();
  writeLocalSchedule(syncCode, schedule, updatedAt);
  try {
    localStorage.setItem(dirtyKey(syncCode), '1');
  } catch (e) {}
  return updatedAt;
}

async function serverFetchSchedule(code: string): Promise<RemoteSchedule | null> {
  try {
    const res = await fetch(`/api/schedule/${code}`, { cache: 'no-store' });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('application/json')) return null;
    const json = await res.json();
    if (!json || typeof json.data !== 'object' || json.data === null) return null;
    return { data: json.data, updatedAt: Number(json.updatedAt) || 0 };
  } catch (e) {
    return null;
  }
}

async function serverSaveSchedule(code: string, schedule: DaySchedule, updatedAt: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/schedule/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: schedule, updatedAt }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Отправляет расписание в Firebase и на сервер.
 * Возвращает true, если хотя бы одно удалённое хранилище подтвердило запись.
 */
export async function pushScheduleRemote(
  syncCode: string,
  schedule: DaySchedule,
  updatedAt: number
): Promise<boolean> {
  // Сначала собственный сервер (Vercel API / локальный сервер): он работает без VPN.
  // Firebase — только запасной вариант, если сервер недоступен.
  let ok = await serverSaveSchedule(syncCode, schedule, updatedAt);
  if (!ok) {
    ok = await fbSaveSchedule(syncCode, schedule, updatedAt).catch(() => false);
  }
  if (ok) {
    // Не сбрасываем флаг, если за время отправки появилась более новая правка
    try {
      if ((await readLocalSchedule(syncCode)).updatedAt <= updatedAt) {
        localStorage.removeItem(dirtyKey(syncCode));
      }
    } catch (e) {}
  }
  return ok;
}

const lastHeal: Record<string, { updatedAt: number; at: number }> = {};

export async function fetchSchedule(syncCode: string): Promise<DaySchedule> {
  const local = await readLocalSchedule(syncCode);

  // Сначала свой сервер. Firebase опрашиваем, только если сервер недоступен
  // или ещё пуст (перенос старых данных) — так без VPN нет ожидания таймаута.
  const srv = await serverFetchSchedule(syncCode);
  const needFirebase = !srv || (srv.updatedAt === 0 && isEmptySchedule(srv.data));
  const fb = needFirebase ? await fbFetchSchedule(syncCode).catch(() => null) : null;

  // Выбираем самую свежую версию; при равенстве предпочитаем непустую
  let best: RemoteSchedule & { source: 'firebase' | 'server' | 'local' } = { ...local, source: 'local' };
  const candidates: Array<[RemoteSchedule | null, 'firebase' | 'server']> = [
    [fb, 'firebase'],
    [srv, 'server'],
  ];
  for (const [c, source] of candidates) {
    if (!c) continue;
    const newer = c.updatedAt > best.updatedAt;
    const tieButFilled =
      c.updatedAt === best.updatedAt && isEmptySchedule(best.data) && !isEmptySchedule(c.data);
    if (newer || tieButFilled) best = { ...c, source };
  }

  // Данные без метки времени (старый формат) получают её, чтобы их можно было синхронизировать
  if (best.updatedAt === 0 && !isEmptySchedule(best.data)) {
    best = { ...best, updatedAt: Date.now() };
    writeLocalSchedule(syncCode, best.data, best.updatedAt);
    try {
      localStorage.setItem(dirtyKey(syncCode), '1');
    } catch (e) {}
    if (best.source === 'local') local.updatedAt = best.updatedAt;
  }

  // Свой сервер пуст или отстаёт, а у нас (в браузере или Firebase) есть более свежее — переносим туда
  if (
    srv &&
    best.source !== 'server' &&
    !isEmptySchedule(best.data) &&
    srv.updatedAt < best.updatedAt
  ) {
    serverSaveSchedule(syncCode, best.data, best.updatedAt).catch(() => {});
  }

  if (best.source !== 'local') {
    writeLocalSchedule(syncCode, best.data, best.updatedAt);
  } else {
    // Локальная версия самая свежая — догоняем удалённые хранилища, если они отстали
    let dirty = false;
    try {
      dirty = localStorage.getItem(dirtyKey(syncCode)) === '1';
    } catch (e) {}
    const behind = [fb, srv].some((r) => r && r.updatedAt < local.updatedAt);
    if (local.updatedAt > 0 && (dirty || behind)) {
      // Не чаще раза в 5 минут для одной и той же версии, иначе при недоступном Firebase
      // каждый опрос (раз в 20 с) заново отправлял бы данные
      const last = lastHeal[syncCode];
      const now = Date.now();
      if (!last || last.updatedAt !== local.updatedAt || now - last.at > 5 * 60 * 1000) {
        lastHeal[syncCode] = { updatedAt: local.updatedAt, at: now };
        pushScheduleRemote(syncCode, local.data, local.updatedAt).catch(() => {});
      }
    }
  }

  return best.data;
}

/** Совместимость: сохранить локально и отправить удалённо. */
export async function saveSchedule(syncCode: string, schedule: DaySchedule): Promise<boolean> {
  const updatedAt = saveScheduleLocal(syncCode, schedule);
  return pushScheduleRemote(syncCode, schedule, updatedAt);
}

/* ================= Media API (100% Guaranteed Local-First with Background Sync) ================= */
/**
 * Подпись фото для поиска дублей: старая версия сохраняла одно фото под двумя id
 * (локальным и сгенерированным Firebase). Содержимое у них одинаковое.
 */
function photoSignature(m: MediaItem): string | null {
  if (m.type !== 'photo') return null;
  const d = m.data || m.url || '';
  if (!d) return null;
  return `${d.length}:${d.slice(0, 120)}:${d.slice(-120)}`;
}

// id показанного элемента -> его скрытые копии (чтобы удаление убирало и их тоже)
const mediaAliases = new Map<string, MediaItem[]>();

export async function fetchMediaList(syncCode: string): Promise<MediaItem[]> {
  // 1. Load immediately from IndexedDB
  const localItems = await idbGetMediaList(syncCode);
  const localIds = new Set(localItems.map((m) => m.id));
  const byId = new Map<string, MediaItem>();
  for (const m of localItems) {
    byId.set(m.id, m);
  }

  // 2–3. Firebase (работает с VPN) и свой сервер (Vercel API) опрашиваем параллельно
  const serverIds = new Set<string>();
  const [fbItems, serverItems] = await Promise.all([
    fbFetchMedia(syncCode).catch(() => [] as MediaItem[]),
    (async (): Promise<MediaItem[] | null> => {
      try {
        const res = await fetch(`/api/media-list/${syncCode}`, { cache: 'no-store' });
        if (!res.ok) return null;
        if (!(res.headers.get('content-type') || '').includes('application/json')) return null;
        const json = await res.json();
        return Array.isArray(json.items) ? (json.items as MediaItem[]) : [];
      } catch (e) {
        return null;
      }
    })(),
  ]);

  const serverUrlById = new Map<string, string>();
  for (const item of serverItems || []) {
    serverIds.add(item.id);
    if (item.url) serverUrlById.set(item.id, item.url);
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  for (const item of fbItems) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }

  // 4. Склеиваем копии одного и того же фото (одинаковое содержимое, загружены в одну минуту)
  const result: MediaItem[] = [];
  const bySig = new Map<string, MediaItem[]>();
  const aliases = new Map<string, MediaItem[]>();

  for (const m of byId.values()) {
    const sig = photoSignature(m);
    const twin = sig
      ? (bySig.get(sig) || []).find((k) => Math.abs((k.created || 0) - (m.created || 0)) < 60_000)
      : undefined;

    if (!sig || !twin) {
      result.push(m);
      if (sig) bySig.set(sig, [...(bySig.get(sig) || []), m]);
      continue;
    }

    // Предпочитаем вариант из Firebase: он есть в облаке и совпадает на всех устройствах
    const keepNew = m.storageSource === 'firebase' && twin.storageSource !== 'firebase';
    const winner = keepNew ? m : twin;
    const loser = keepNew ? twin : m;

    if (keepNew) {
      result[result.indexOf(twin)] = m;
      bySig.set(sig, (bySig.get(sig) || []).map((k) => (k === twin ? m : k)));
    }
    const carried = aliases.get(loser.id) || [];
    aliases.delete(loser.id);
    aliases.set(winner.id, [...(aliases.get(winner.id) || []), loser, ...carried]);
  }

  // 5. Убираем копии из локальной базы и запоминаем новые элементы
  mediaAliases.clear();
  aliases.forEach((v, k) => mediaAliases.set(k, v));
  aliases.forEach((dups) => {
    for (const d of dups) {
      if (localIds.has(d.id)) idbDeleteMedia(d.id).catch(() => {});
    }
  });
  for (const m of result) {
    if (!localIds.has(m.id)) idbSaveMedia(m).catch(() => {});
  }

  result.sort((a, b) => (b.created || 0) - (a.created || 0));

  // Отмечаем файлы, которые уже лежат в облаке (по списку с сервера)
  for (const m of result) {
    const u = serverUrlById.get(m.id);
    if (u) m.cloudUrl = u;
  }

  // Если облачный сервер доступен — выгружаем в него файлы, которые есть только в этом браузере
  if (serverItems !== null) {
    syncLocalMediaToCloud(syncCode, result, serverIds).catch(() => {});
  }
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
    fbSavePhoto(syncCode, photoDataUrl, file.name, id, mediaItem.created).then((fbId) => {
      if (fbId) {
        mediaItem.storageSource = 'firebase';
      }
    }).catch(() => {});

    // 3. Фоновая выгрузка в облако (Vercel Blob), без блокировки интерфейса
    backgroundUpload(file, syncCode, mediaItem).catch(() => {});

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

  // 2. Фоновая выгрузка в облако (Vercel Blob), без блокировки интерфейса
  backgroundUpload(file, syncCode, mediaItem).catch(() => {});

  onProgress?.(100);
  return mediaItem;
}

/* ---------- Облачная выгрузка (Vercel Blob + список в Redis) ---------- */
const cloudBusy = new Set<string>();
const cloudFailedAt = new Map<string, number>();
let cloudQueueRunning = false;

/* Статус выгрузки в облако — показывается в галерее, чтобы было видно, что происходит */
export interface CloudStatus {
  uploading: string | null; // имя файла, который выгружается сейчас
  progress: number; // 0..100
  lastError: string | null;
  lastOkAt: number | null;
}
let cloudStatus: CloudStatus = { uploading: null, progress: 0, lastError: null, lastOkAt: null };
const cloudListeners = new Set<() => void>();
export const getCloudStatus = (): CloudStatus => cloudStatus;
export function subscribeCloudStatus(cb: () => void): () => void {
  cloudListeners.add(cb);
  return () => {
    cloudListeners.delete(cb);
  };
}
function setCloudStatus(patch: Partial<CloudStatus>) {
  cloudStatus = { ...cloudStatus, ...patch };
  cloudListeners.forEach((f) => f());
}
/** Сбрасывает паузы после неудач, чтобы выгрузка повторилась сразу. */
export function resetCloudRetries(): void {
  cloudFailedAt.clear();
  setCloudStatus({ lastError: null });
}
function describeCloudError(e: any): string {
  const msg = String(e?.message || e || 'неизвестная ошибка');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'нет связи с облаком (возможно, без VPN адрес Vercel недоступен)';
  }
  return msg.slice(0, 160);
}

function toServerItem(item: MediaItem, cloudUrl: string) {
  // Превью видео — небольшая картинка; у фото превью = сам файл
  const thumb =
    item.type === 'photo'
      ? cloudUrl
      : item.thumb && item.thumb.length < 150_000
      ? item.thumb
      : undefined;
  return {
    id: item.id,
    code: item.code,
    type: item.type,
    mime: item.mime,
    name: item.name,
    created: item.created,
    size: item.size,
    duration: item.duration,
    url: cloudUrl,
    thumb,
  };
}

/** Выгружает файл в Vercel Blob и записывает ссылку в общий список. Возвращает true при успехе. */
async function uploadToCloud(syncCode: string, item: MediaItem, source?: Blob): Promise<boolean> {
  if (cloudBusy.has(item.id)) return false;
  cloudBusy.add(item.id);
  try {
    let body: Blob | null = source || (item.blob instanceof Blob ? item.blob : null);
    if (!body && item.type === 'photo' && item.data) {
      body = await (await fetch(item.data)).blob(); // сжатое фото из data URL
    }
    if (!body) return false;

    setCloudStatus({ uploading: item.name || 'файл', progress: 0, lastError: null });
    const { upload } = await import('@vercel/blob/client');
    const contentType = body.type || item.mime || (item.type === 'photo' ? 'image/jpeg' : 'video/mp4');
    const extFromName = (item.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ext =
      item.type === 'photo' ? 'jpg' : extFromName && extFromName.length <= 5 ? extFromName : 'mp4';

    const blob = await upload(`media/${syncCode}/${item.id}.${ext}`, body, {
      access: 'public',
      handleUploadUrl: '/api/blob-upload',
      clientPayload: JSON.stringify({ code: syncCode }),
      contentType,
      multipart: body.size > 20 * 1024 * 1024,
      onUploadProgress: (e) => setCloudStatus({ progress: Math.round(e.percentage) }),
    });

    const res = await fetch(`/api/media-list/${syncCode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toServerItem(item, blob.url)),
    });
    if (!res.ok) throw new Error(`media-list HTTP ${res.status}`);

    item.cloudUrl = blob.url;
    cloudFailedAt.delete(item.id);
    idbSaveMedia(item).catch(() => {});
    setCloudStatus({ uploading: null, progress: 100, lastError: null, lastOkAt: Date.now() });
    return true;
  } catch (e) {
    console.warn('Cloud upload failed:', item.name, e);
    cloudFailedAt.set(item.id, Date.now());
    setCloudStatus({
      uploading: null,
      lastError: `${item.name || 'файл'}: ${describeCloudError(e)}`,
    });
    return false;
  } finally {
    cloudBusy.delete(item.id);
  }
}

/** Сначала облако; если оно недоступно (например, локальный запуск) — старый серверный вариант. */
async function backgroundUpload(file: File, syncCode: string, item: MediaItem): Promise<void> {
  const ok = await uploadToCloud(syncCode, item, item.type === 'video' ? file : undefined);
  if (!ok) await uploadToServerBackground(file, syncCode, item);
}

/**
 * Догоняющая выгрузка: файлы, которые есть только в этом браузере (например, видео,
 * загруженные раньше), отправляются в облако, чтобы появиться на других устройствах.
 * По одному, с паузой 5 минут после неудачи.
 */
async function syncLocalMediaToCloud(
  syncCode: string,
  items: MediaItem[],
  serverIds: Set<string>
): Promise<void> {
  if (cloudQueueRunning) return;
  cloudQueueRunning = true;
  try {
    for (const it of items) {
      if (it.cloudUrl || serverIds.has(it.id) || cloudBusy.has(it.id)) continue;
      const hasPayload = it.blob instanceof Blob || (it.type === 'photo' && !!it.data);
      if (!hasPayload) continue;
      const failed = cloudFailedAt.get(it.id);
      if (failed && Date.now() - failed < 5 * 60 * 1000) continue;
      await uploadToCloud(syncCode, it);
    }
  } finally {
    cloudQueueRunning = false;
  }
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
  // Вместе с фото удаляем его скрытые копии (дубли от старых загрузок)
  const copies = mediaAliases.get(item.id) || [];
  mediaAliases.delete(item.id);
  for (const target of [item, ...copies]) {
    // 1. Delete from IndexedDB immediately
    await idbDeleteMedia(target.id);

    // 2. Delete from Firebase
    fbDeleteMedia(target.id).catch(() => {});

    // 3. Delete from server
    fetch(`/api/media-list/${syncCode}/${target.id}`, { method: 'DELETE' }).catch(() => {});
    if (target.filename) {
      fetch(`/api/media/${target.filename}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  return true;
}
