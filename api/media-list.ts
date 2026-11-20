/**
 * Vercel Function (объединённая): media-list.ts
 * Содержит несколько обработчиков, чтобы уложиться в лимит функций тарифа Hobby (12).
 * Маршрутизация по адресам — в vercel.json (rewrites); здесь выбор обработчика по параметрам запроса.
 */
import process from 'node:process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
const ALBUM_ID_RE = /^[a-z0-9]{6,20}$/;
const ALBUM_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const MAX_ALBUMS = 200;

/**
 * Личные альбомы видны только при настроенном пароле администратора И действующей сессии.
 * Если пароль на сервере не задан, isAdmin() пускает всех, поэтому для альбомов это не годится:
 * без пароля личные альбомы не показываются в общем списке никому.
 */
function isAdminStrict(req: any): boolean {
  return !!process.env.ADMIN_PASSWORD && isAdmin(req);
}

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

type Album = { id: string; title: string; token: string; createdAt: number };

async function readAlbums(code: string): Promise<Album[]> {
  const flat: string[] = (await redis(['HGETALL', `albums:${code}`])) || [];
  const out: Album[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      const a = JSON.parse(flat[i]);
      if (a && ALBUM_ID_RE.test(String(a.id)) && ALBUM_TOKEN_RE.test(String(a.token))) out.push(a);
    } catch {}
  }
  return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

const cleanTitle = (v: any): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';

async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Неверный код синхронизации' });
  }
  const key = `media:${code}`;
  const delKey = `media-del:${code}`; // «надгробия»: id удалённых файлов, чтобы удаление дошло до всех устройств
  const albumsKey = `albums:${code}`;

  try {
    // ---- Управление личными альбомами (только администратор) ----
    if (String(req.query?.view ?? '') === 'albums') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
      }
      if (!process.env.ADMIN_PASSWORD) {
        return res.status(403).json({ error: 'Личные альбомы работают только при заданном пароле администратора' });
      }
      if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const op = String(b.op ?? '');
      const albums = await readAlbums(code);

      if (op === 'create') {
        const title = cleanTitle(b.title);
        if (title.length < 1) return res.status(400).json({ error: 'Укажите название альбома' });
        if (albums.length >= MAX_ALBUMS) return res.status(400).json({ error: 'Слишком много альбомов' });
        const album: Album = {
          id: randomBytes(5).toString('hex'),
          title,
          token: randomBytes(18).toString('base64url'),
          createdAt: Date.now(),
        };
        await redis(['HSET', albumsKey, album.id, JSON.stringify(album)]);
        return res.status(200).json({ album });
      }

      const album = albums.find((a) => a.id === String(b.id ?? ''));
      if (!album) return res.status(404).json({ error: 'Альбом не найден' });

      if (op === 'rename') {
        const title = cleanTitle(b.title);
        if (title.length < 1) return res.status(400).json({ error: 'Укажите название альбома' });
        album.title = title;
      } else if (op === 'rotate') {
        album.token = randomBytes(18).toString('base64url'); // старая ссылка перестаёт работать
      } else if (op === 'delete') {
        // Удалять можно только пустой альбом: личные файлы не должны случайно стать общими или пропасть
        const flat: string[] = (await redis(['HGETALL', key])) || [];
        for (let i = 1; i < flat.length; i += 2) {
          try {
            if (JSON.parse(flat[i]).album === album.id) {
              return res.status(409).json({ error: 'В альбоме есть файлы. Сначала переместите или удалите их.' });
            }
          } catch {}
        }
        await redis(['HDEL', albumsKey, album.id]);
        return res.status(200).json({ success: true });
      } else {
        return res.status(400).json({ error: 'Неизвестное действие' });
      }
      await redis(['HSET', albumsKey, album.id, JSON.stringify(album)]);
      return res.status(200).json({ album });
    }

    if (req.method === 'GET') {
      const flat: string[] = (await redis(['HGETALL', key])) || [];
      const all: any[] = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          all.push(JSON.parse(flat[i]));
        } catch {}
      }

      // ---- Личный альбом по ссылке: GET ?album=<токен> (публично, но только с верным токеном) ----
      const albumToken = String(req.query?.album ?? '');
      if (albumToken) {
        const album = ALBUM_TOKEN_RE.test(albumToken)
          ? (await readAlbums(code)).find((a) => a.token === albumToken)
          : undefined;
        if (!album) return res.status(404).json({ error: 'Альбом не найден' });
        return res.status(200).json({
          album: { id: album.id, title: album.title },
          items: all.filter((it) => it.album === album.id),
        });
      }

      // ---- Общий список: файлы личных альбомов видит только администратор ----
      const admin = isAdminStrict(req);
      const items = admin ? all : all.filter((it) => !it.album);
      const deleted: string[] = (await redis(['HKEYS', delKey])) || [];
      return res.status(200).json(admin ? { items, deleted, albums: await readAlbums(code) } : { items, deleted });
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

      // Личный альбом: файл можно сразу загрузить в существующий альбом (без album — общая галерея)
      let album: string | undefined;
      if (b.album !== undefined && b.album !== null && b.album !== '') {
        const aid = String(b.album);
        if (!ALBUM_ID_RE.test(aid) || Number(await redis(['HEXISTS', albumsKey, aid])) !== 1) {
          return res.status(400).json({ error: 'Альбом не найден' });
        }
        album = aid;
      }

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
        album,
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
          // Альбом уже записанного файла меняется только отдельной операцией «переместить», а не повторной выгрузкой
          item.album = prev.album;
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
const ALBUM_ID_RE = /^[a-z0-9]{6,20}$/;

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
      // Маленькое превью фото для сетки галереи: { thumb: "<blob-url>" } (создаётся при загрузке и кнопкой «Создать превью»)
      if (b && typeof b === 'object' && 'thumb' in b && !('album' in b) && !('caption' in b)) {
        if (typeof b.thumb !== 'string' || !BLOB_HOST_RE.test(b.thumb)) {
          return res.status(400).json({ error: 'Неверная ссылка на превью' });
        }
        if (Number(await redis(['HEXISTS', delKey, id])) === 1) {
          return res.status(410).json({ error: 'Файл удалён' });
        }
        const rawThumbItem = await redis(['HGET', key, id]);
        if (!rawThumbItem) return res.status(404).json({ error: 'Файл не найден' });
        const withThumb = JSON.parse(rawThumbItem);
        withThumb.thumb = b.thumb;
        await redis(['HSET', key, id, JSON.stringify(withThumb)]);
        return res.status(200).json({ success: true });
      }
      // Переместить файл в личный альбом или обратно в общую галерею: { album: "<id>" | null }
      if (b && typeof b === 'object' && 'album' in b) {
        if (Number(await redis(['HEXISTS', delKey, id])) === 1) {
          return res.status(410).json({ error: 'Файл удалён' });
        }
        const rawItem = await redis(['HGET', key, id]);
        if (!rawItem) return res.status(404).json({ error: 'Файл не найден' });
        const target = b.album === null || b.album === '' ? '' : String(b.album);
        if (target) {
          if (!process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: 'Личные альбомы работают только при заданном пароле администратора' });
          }
          if (!ALBUM_ID_RE.test(target) || Number(await redis(['HEXISTS', `albums:${code}`, target])) !== 1) {
            return res.status(400).json({ error: 'Альбом не найден' });
          }
        }
        const moved = JSON.parse(rawItem);
        if (target) moved.album = target;
        else delete moved.album;
        await redis(['HSET', key, id, JSON.stringify(moved)]);
        return res.status(200).json({ success: true, album: target || null });
      }
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
