/**
 * Vercel Function: список фото/видео (метаданные) в Redis (Upstash).
 * Тот же контракт, что у server.ts:
 *   GET  /api/media-list/:code  ->  { items: MediaItem[] }
 *   POST /api/media-list/:code  <-  MediaItem  (сохраняет/обновляет элемент)
 * Сами файлы лежат в Vercel Blob, здесь только ссылки и подписи.
 */
import process from 'node:process';

const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_ITEM = 200_000; // метаданные одного файла (вместе с превью видео)
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

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Неверный код синхронизации' });
  }
  const key = `media:${code}`;

  try {
    if (req.method === 'GET') {
      const flat: string[] = (await redis(['HGETALL', key])) || [];
      const items: any[] = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          items.push(JSON.parse(flat[i]));
        } catch {}
      }
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
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
      const thumbOk =
        typeof b.thumb === 'string' &&
        (BLOB_HOST_RE.test(b.thumb) || (b.thumb.startsWith('data:image/') && b.thumb.length < 150_000));

      // Сохраняем только нужные поля (без data/blob и прочего лишнего)
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
        storageSource: 'server',
      };
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
