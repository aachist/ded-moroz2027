/**
 * Vercel Function: операции над одним элементом списка медиа.
 *   DELETE /api/media-list/:code/:id  — удаляет запись и файл из Vercel Blob и оставляет «надгробие»,
 *                                       чтобы удаление дошло до остальных устройств
 *   PATCH  /api/media-list/:code/:id  — задаёт подпись { caption, captionAt }
 */
import process from 'node:process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { del } from '@vercel/blob';

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

export default async function handler(req: any, res: any) {
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
