/**
 * Резервная копия и восстановление всех мероприятий и медиа.
 * Формат: ZIP-архив с manifest.json (мероприятия + описание файлов) и папкой media/ с самими файлами.
 * Также понимается простой .json (только мероприятия).
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Zippable } from 'fflate';
import { DaySchedule, MediaItem, ScheduleEvent } from '../types';
import { importMediaItem, ImportMediaMeta, getKnownDeletedIds } from './storage';
import type { Booking } from './bookings';

export interface BackupMediaMeta extends ImportMediaMeta {
  file?: string; // путь внутри архива; нет — файл не удалось включить в копию
}

export interface BackupManifest {
  app: 'ded-moroz';
  version: 1;
  createdAt: number;
  schedule: DaySchedule;
  media: BackupMediaMeta[];
  bookings?: Booking[]; // заявки клиентов с сайта (при восстановлении становятся обычными мероприятиями)
}

export interface BackupStats {
  events: number;
  bookings: number; // заявки клиентов, вошедшие в копию
  photos: number;
  videos: number;
  missing: number; // файлы, которые не удалось получить
  skippedVideos: number; // видео, не включённые по выбору пользователя
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function countEvents(schedule: DaySchedule): number {
  return Object.values(schedule).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
}

/** Сколько мероприятий в копии: расписание + заявки клиентов. */
export function manifestEventCount(m: BackupManifest): number {
  return countEvents(m.schedule) + (m.bookings?.length || 0);
}

/** Оставляет только корректные заявки (защита от повреждённого файла). */
function sanitizeBookings(raw: any): Booking[] {
  if (!Array.isArray(raw)) return [];
  const out: Booking[] = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    if (!DATE_RE.test(String(b.date)) || !TIME_RE.test(String(b.start)) || !TIME_RE.test(String(b.end))) continue;
    out.push({
      id: String(b.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      date: String(b.date),
      start: String(b.start),
      end: String(b.end),
      type: b.type === 'adults' ? 'adults' : 'kids',
      name: String(b.name || '').slice(0, 80),
      phone: String(b.phone || '').slice(0, 30),
      note: typeof b.note === 'string' && b.note ? b.note.slice(0, 500) : undefined,
      createdAt: Number(b.createdAt) || 0,
    });
  }
  return out;
}

/** Заявка клиента -> обычное мероприятие (контакты уходят в комментарий). */
function bookingToEvent(b: Booking): ScheduleEvent {
  return {
    id: `bk-${b.id}`,
    start: b.start,
    end: b.end,
    type: b.type,
    note: ['Заявка с сайта', b.name, b.phone, b.note].filter(Boolean).join(' · '),
  };
}

/** Оставляет только корректные мероприятия (защита от повреждённого файла). */
function sanitizeSchedule(raw: any): DaySchedule {
  const out: DaySchedule = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [date, arr] of Object.entries(raw)) {
    if (!DATE_RE.test(date) || !Array.isArray(arr)) continue;
    const events: ScheduleEvent[] = [];
    for (const e of arr as any[]) {
      if (!e || typeof e !== 'object') continue;
      if (!TIME_RE.test(String(e.start)) || !TIME_RE.test(String(e.end))) continue;
      events.push({
        id: String(e.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
        start: String(e.start),
        end: String(e.end),
        type: String(e.type || 'kids'),
        note: typeof e.note === 'string' && e.note ? e.note.slice(0, 500) : undefined,
      });
    }
    if (events.length) out[date] = events;
  }
  return out;
}

async function getMediaBlob(item: MediaItem): Promise<Blob | null> {
  try {
    if (item.blob instanceof Blob) return item.blob;
    if (item.type === 'photo' && item.data) return await (await fetch(item.data)).blob();
    const url = item.cloudUrl || item.url;
    if (url && /^(https?:|blob:|data:)/i.test(url)) {
      const r = await fetch(url);
      if (r.ok) return await r.blob();
    }
  } catch (e) {}
  return null;
}

function extFor(item: MediaItem): string {
  if (item.type === 'photo') return 'jpg';
  const fromName = (item.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName && fromName.length <= 5) return fromName;
  if (item.mime === 'video/quicktime') return 'mov';
  return 'mp4';
}

export async function createBackup(
  schedule: DaySchedule,
  media: MediaItem[],
  opts: { includeVideos: boolean; bookings?: Booking[] },
  onProgress?: (done: number, total: number) => void
): Promise<{ blob: Blob; stats: BackupStats }> {
  const files: Zippable = {};
  const metas: BackupMediaMeta[] = [];
  const bookings = opts.bookings || [];
  const stats: BackupStats = {
    events: countEvents(schedule),
    bookings: bookings.length,
    photos: 0,
    videos: 0,
    missing: 0,
    skippedVideos: 0,
  };

  let done = 0;
  for (const item of media) {
    onProgress?.(done++, media.length);

    const meta: BackupMediaMeta = {
      id: item.id,
      type: item.type,
      mime: item.mime,
      name: item.name,
      created: item.created,
      caption: item.caption,
      captionAt: item.captionAt,
      duration: item.duration,
      thumb: item.type === 'video' && item.thumb && item.thumb.length < 150_000 ? item.thumb : undefined,
    };

    if (item.type === 'video' && !opts.includeVideos) {
      stats.skippedVideos++;
      metas.push(meta);
      continue;
    }

    const blob = await getMediaBlob(item);
    if (!blob) {
      stats.missing++;
      metas.push(meta);
      continue;
    }

    const path = `media/${item.id}.${extFor(item)}`;
    // Фото и видео уже сжаты — кладём без повторного сжатия (быстрее)
    files[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    meta.file = path;
    metas.push(meta);
    if (item.type === 'photo') stats.photos++;
    else stats.videos++;
  }
  onProgress?.(media.length, media.length);

  const manifest: BackupManifest = {
    app: 'ded-moroz',
    version: 1,
    createdAt: Date.now(),
    schedule,
    media: metas,
    bookings,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  const zipped = zipSync(files);
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), stats };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function backupFileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `zapis-ded-moroz-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
}

export interface LoadedBackup {
  manifest: BackupManifest;
  getFile: (path: string, mime?: string) => Blob | null;
}

/** Читает файл копии (ZIP или простой JSON) и проверяет формат. */
export async function readBackup(file: File): Promise<LoadedBackup> {
  const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';

  if (isJson) {
    const parsed = JSON.parse(await file.text());
    // Полная копия в виде JSON, либо просто расписание { "2026-10-21": [...] }
    const manifest: BackupManifest = parsed && parsed.schedule
      ? {
          app: 'ded-moroz',
          version: 1,
          createdAt: Number(parsed.createdAt) || 0,
          schedule: sanitizeSchedule(parsed.schedule),
          media: [],
          bookings: sanitizeBookings(parsed.bookings),
        }
      : { app: 'ded-moroz', version: 1, createdAt: 0, schedule: sanitizeSchedule(parsed), media: [], bookings: [] };
    if (manifestEventCount(manifest) === 0) {
      throw new Error('В файле не найдено ни одного мероприятия');
    }
    return { manifest, getFile: () => null };
  }

  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    throw new Error('файл повреждён или это не архив резервной копии');
  }
  const raw = entries['manifest.json'];
  if (!raw) throw new Error('Это не резервная копия: в архиве нет manifest.json');
  const parsed = JSON.parse(strFromU8(raw));
  if (!parsed || parsed.app !== 'ded-moroz') throw new Error('Это не резервная копия этого сайта');

  const manifest: BackupManifest = {
    app: 'ded-moroz',
    version: 1,
    createdAt: Number(parsed.createdAt) || 0,
    schedule: sanitizeSchedule(parsed.schedule),
    bookings: sanitizeBookings(parsed.bookings),
    media: Array.isArray(parsed.media)
      ? parsed.media.filter(
          (m: any) => m && typeof m.id === 'string' && (m.type === 'photo' || m.type === 'video')
        )
      : [],
  };
  return {
    manifest,
    getFile: (path, mime) => {
      const bytes = entries[path];
      return bytes ? new Blob([bytes as BlobPart], mime ? { type: mime } : undefined) : null;
    },
  };
}

export interface RestoreResult {
  schedule: DaySchedule;
  addedEvents: number;
  addedMedia: number;
  skippedMedia: number; // уже есть на сайте
  unavailableMedia: number; // в копии нет самого файла
}

function mergeSchedules(current: DaySchedule, incoming: DaySchedule): { result: DaySchedule; added: number } {
  const result: DaySchedule = JSON.parse(JSON.stringify(current));
  let added = 0;
  for (const [date, events] of Object.entries(incoming)) {
    const existing = result[date] || [];
    const ids = new Set(existing.map((e) => e.id));
    for (const ev of events) {
      const sameId = ids.has(ev.id);
      const sameContent = existing.some(
        (e) => e.start === ev.start && e.end === ev.end && e.type === ev.type && (e.note || '') === (ev.note || '')
      );
      if (sameId || sameContent) continue;
      existing.push(ev);
      ids.add(ev.id);
      added++;
    }
    existing.sort((a, b) => a.start.localeCompare(b.start));
    if (existing.length) result[date] = existing;
  }
  return { result, added };
}

/**
 * Восстанавливает данные из копии.
 *  - 'merge'  — добавляет то, чего ещё нет (ничего не удаляется) — безопасный вариант;
 *  - 'replace' — заменяет все мероприятия мероприятиями из копии.
 * Медиа всегда добавляются (уже имеющиеся по id пропускаются).
 */
export async function restoreBackup(
  loaded: LoadedBackup,
  mode: 'merge' | 'replace',
  ctx: { syncCode: string; schedule: DaySchedule; media: MediaItem[]; bookings?: Booking[] }
): Promise<RestoreResult> {
  const { manifest, getFile } = loaded;

  // Заявки клиентов из копии становятся обычными мероприятиями (с контактами в комментарии).
  // Пропускаем те, что и сейчас ещё лежат на сайте как заявки: иначе время задвоится.
  const currentBookingIds = new Set((ctx.bookings || []).map((b) => b.id));
  const incoming: DaySchedule = JSON.parse(JSON.stringify(manifest.schedule));
  for (const b of manifest.bookings || []) {
    if (currentBookingIds.has(b.id)) continue;
    (incoming[b.date] ||= []).push(bookingToEvent(b));
  }

  let schedule: DaySchedule;
  let addedEvents: number;
  if (mode === 'replace') {
    schedule = incoming;
    addedEvents = countEvents(schedule);
  } else {
    const merged = mergeSchedules(ctx.schedule, incoming);
    schedule = merged.result;
    addedEvents = merged.added;
  }

  const existingIds = new Set(ctx.media.map((m) => m.id));
  const deletedIds = getKnownDeletedIds();
  let addedMedia = 0;
  let skippedMedia = 0;
  let unavailableMedia = 0;

  for (const meta of manifest.media) {
    if (existingIds.has(meta.id)) {
      skippedMedia++;
      continue;
    }
    const blob = meta.file ? getFile(meta.file, meta.mime) : null;
    if (!blob) {
      unavailableMedia++;
      continue;
    }
    // Если файл с таким id уже удалён (на сервере остаётся пометка), даём новый id, иначе сервер его отклонит
    const id = deletedIds.has(meta.id)
      ? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      : meta.id;
    await importMediaItem(ctx.syncCode, { ...meta, id }, blob);
    addedMedia++;
  }

  return { schedule, addedEvents, addedMedia, skippedMedia, unavailableMedia };
}
