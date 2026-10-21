/**
 * Vercel Function: удаление элемента из списка медиа и его файла из Vercel Blob.
 *   DELETE /api/media-list/:code/:id
 */
import process from 'node:process';
import { del } from '@vercel/blob';

const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
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

  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const code = String(req.query?.code ?? '');
  const id = String(req.query?.id ?? '');
  if (!CODE_RE.test(code) || !ID_RE.test(id)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }
  const key = `media:${code}`;

  try {
    // Узнаём ссылку на файл, чтобы удалить его из Blob
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
    return res.status(200).json({ success: true });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Хранилище не подключено (нет переменных Redis)' });
    }
    console.error('media delete error:', e);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}
