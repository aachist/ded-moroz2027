/**
 * Vercel Function (объединённая): media-list.ts
 * Содержит несколько обработчиков, чтобы уложиться в лимит функций тарифа Hobby (12).
 * Маршрутизация по адресам — в vercel.json (rewrites); здесь выбор обработчика по параметрам запроса.
 */
import process from 'node:process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { del } from '@vercel/blob';

// ============================================================ listHandler
const listHandler = (() => {
/**
 * Vercel Function: список фото/видео (метаданные) в Redis (Upstash).
 * Тот же контракт, что у server.ts:
 *   GET  /api/media-list/:code  ->  { items: MediaItem[] }
 *   POST /api/media-list/:code  <-  MediaItem  (сохраняет/обновляет элемент)
 * Сами файлы лежат в Vercel Blob, здесь только ссылки и подписи.
 */

/** Администратор = подписанная cookie dm_session. Пока ADMIN_PASSWORD не задан, доступ открыт (прежнее поведение). */
function isAdmin(req: any): boolean {
  if (!process.env.ADMIN_PASSWORD) return true;
  const key = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD;
  const m = /(?:^|;\s*)dm_session=([^;]+)/.exec(String(req.headers?.cookie || ''));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!Number(exp) || Number(exp) < Date.now() || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(createHmac('sha256', key).update(exp).digest('hex'));
  return a.length === b.length && timingSafeEqual(a, b);
}

const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_ITEM = 200_000; // метаданные одного файла (вместе с превью видео)
const MAX_CAPTION = 300;
const BLOB_HOST_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

async function redis(cmd: Array<string | number>): Promise<any> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('NOT_CONFIGURED');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Redis HTTP ${r.status}`);
  return j.result;
}

async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Неверный код синхронизации' });
  }
  const key = `media:${code}`;
  const delKey = `media-del:${code}`; // «надгробия»: id удалённых файлов, чтобы удаление дошло до всех устройств

  try {
    if (req.method === 'GET') {
      const flat: string[] = (await redis(['HGETALL', key])) || [];
      const items: any[] = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          items.push(JSON.parse(flat[i]));
        } catch {}
      }
      const deleted: string[] = (await redis(['HKEYS', delKey])) || [];
      return res.status(200).json({ items, deleted });
    }

    if (req.method === 'POST') {
      // Добавлять и менять файлы может только администратор (читать список может любой — это галерея клиентов)
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Требуется вход' });
      }
      const b = req.body;
      if (!b || typeof b !== 'object' || !ID_RE.test(String(b.id ?? ''))) {
        return res.status(400).json({ error: 'Неверный формат элемента' });
      }
      if (b.type !== 'photo' && b.type !== 'video') {
        return res.status(400).json({ error: 'Неверный тип файла' });
      }
      // Принимаем только ссылки на наше хранилище Blob
      if (!BLOB_HOST_RE.test(String(b.url ?? ''))) {
        return res.status(400).json({ error: 'Неверная ссылка на файл' });
      }

      // Файл уже удалён на другом устройстве: не возвращаем его и убираем только что загруженное
      if (Number(await redis(['HEXISTS', delKey, String(b.id)])) === 1) {
        try {
          await del(String(b.url));
        } catch (e) {
          console.warn('blob delete (tombstoned) failed:', e);
        }
        return res.status(410).json({ error: 'Файл удалён' });
      }

      const thumbOk =
        typeof b.thumb === 'string' &&
        (BLOB_HOST_RE.test(b.thumb) || (b.thumb.startsWith('data:image/') && b.thumb.length < 150_000));

      // Сохраняем только нужные поля (без data/blob и прочего лишнего)
      const caption = typeof b.caption === 'string' ? b.caption.slice(0, MAX_CAPTION) : undefined;
      const item = {
        id: String(b.id),
        code,
        type: b.type,
        mime: typeof b.mime === 'string' ? b.mime.slice(0, 100) : undefined,
        name: String(b.name ?? '').slice(0, 200),
        created: Number(b.created) || Date.now(),
        size: Number(b.size) || undefined,
        duration: Number(b.duration) || undefined,
        url: String(b.url),
        thumb: thumbOk ? b.thumb : undefined,
        caption,
        captionAt: caption !== undefined ? Number(b.captionAt) || Date.now() : undefined,
        storageSource: 'server',
      };
      // Не затираем более свежую подпись, если запись уже есть (например, файл выгрузило второе устройство)
      try {
        const prevRaw = await redis(['HGET', key, item.id]);
        if (prevRaw) {
          const prev = JSON.parse(prevRaw);
          if ((Number(prev.captionAt) || 0) > (Number(item.captionAt) || 0)) {
            item.caption = prev.caption;
            item.captionAt = prev.captionAt;
          }
        }
      } catch {}

      const serialized = JSON.stringify(item);
      if (serialized.length > MAX_ITEM) {
        return res.status(413).json({ error: 'Слишком большой элемент' });
      }
      await redis(['HSET', key, item.id, serialized]);
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Хранилище не подключено (нет переменных Redis)' });
    }
    console.error('media-list api error:', e);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}

  return handler;
})();

// ============================================================ itemHandler
const itemHandler = (() => {
/**
 * Vercel Function: операции над одним элементом списка медиа.
 *   DELETE /api/media-list/:code/:id  — удаляет запись и файл из Vercel Blob и оставляет «надгробие»,
 *                                       чтобы удаление дошло до остальных устройств
 *   PATCH  /api/media-list/:code/:id  — задаёт подпись { caption, captionAt }
 */

/** Администратор = подписанная cookie dm_session. Пока ADMIN_PASSWORD не задан, доступ открыт (прежнее поведение). */
function isAdmin(req: any): boolean {
  if (!process.env.ADMIN_PASSWORD) return true;
  const key = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD;
  const m = /(?:^|;\s*)dm_session=([^;]+)/.exec(String(req.headers?.cookie || ''));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!Number(exp) || Number(exp) < Date.now() || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(createHmac('sha256', key).update(exp).digest('hex'));
  return a.length === b.length && timingSafeEqual(a, b);
}

const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_CAPTION = 300;
const BLOB_HOST_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

async function redis(cmd: Array<string | number>): Promise<any> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('NOT_CONFIGURED');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Redis HTTP ${r.status}`);
  return j.result;
}

async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'DELETE' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'DELETE, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Менять подписи и удалять файлы может только администратор
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Требуется вход' });
  }

  const code = String(req.query?.code ?? '');
  const id = String(req.query?.id ?? '');
  if (!CODE_RE.test(code) || !ID_RE.test(id)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }
  const key = `media:${code}`;
  const delKey = `media-del:${code}`;

  try {
    if (req.method === 'PATCH') {
      const b = req.body;
      if (!b || typeof b !== 'object' || typeof b.caption !== 'string') {
        return res.status(400).json({ error: 'Неверный формат подписи' });
      }
      if (Number(await redis(['HEXISTS', delKey, id])) === 1) {
        return res.status(410).json({ error: 'Файл удалён' });
      }
      const raw = await redis(['HGET', key, id]);
      if (!raw) {
        // Файл ещё не выгружен в облако — клиент повторит позже
        return res.status(404).json({ error: 'Файл не найден' });
      }
      const item = JSON.parse(raw);
      const at = Number(b.captionAt) || Date.now();
      if (at >= (Number(item.captionAt) || 0)) {
        const text = b.caption.trim().slice(0, MAX_CAPTION);
        item.caption = text || undefined;
        item.captionAt = at;
        await redis(['HSET', key, id, JSON.stringify(item)]);
      }
      return res.status(200).json({ success: true });
    }

    // DELETE: узнаём ссылку на файл, чтобы удалить его из Blob
    const raw = await redis(['HGET', key, id]);
    if (raw) {
      try {
        const item = JSON.parse(raw);
        const urls = [item.url, item.thumb].filter(
          (u: any) => typeof u === 'string' && BLOB_HOST_RE.test(u)
        );
        if (urls.length) await del(urls);
      } catch (e) {
        console.warn('blob delete failed:', e);
      }
    }
    await redis(['HDEL', key, id]);
    // «Надгробие»: остальные устройства увидят удаление и уберут файл у себя
    await redis(['HSET', delKey, id, Date.now()]);
    return res.status(200).json({ success: true });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Хранилище не подключено (нет переменных Redis)' });
    }
    console.error('media item api error:', e);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}

  return handler;
})();

export default async function handler(req: any, res: any) {
  return req.query?.id ? itemHandler(req, res) : listHandler(req, res);
}
