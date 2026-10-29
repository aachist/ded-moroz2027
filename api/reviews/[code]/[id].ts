/**
 * Vercel Function: модерация отзыва (только администратор).
 *   PATCH  /api/reviews/:code/:id   { status?: 'approved'|'pending', name?, text?, rating? }
 *   DELETE /api/reviews/:code/:id
 */
import process from 'node:process';
import { createHmac, timingSafeEqual } from 'node:crypto';

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

const clean = (v: any, max: number) =>
  typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Требуется вход' });
  }

  const code = String(req.query?.code ?? '');
  const id = String(req.query?.id ?? '');
  if (!CODE_RE.test(code) || !ID_RE.test(id)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }
  const key = `reviews:${code}`;

  try {
    if (req.method === 'DELETE') {
      await redis(['HDEL', key, id]);
      return res.status(200).json({ success: true });
    }

    // PATCH
    const raw = await redis(['HGET', key, id]);
    if (!raw) return res.status(404).json({ error: 'Отзыв не найден' });
    const review = JSON.parse(raw);
    const b = req.body && typeof req.body === 'object' ? req.body : {};

    if (b.status !== undefined) {
      if (b.status !== 'approved' && b.status !== 'pending') return res.status(400).json({ error: 'Неверный статус' });
      review.status = b.status;
    }
    if (b.name !== undefined) {
      const name = clean(b.name, 60);
      if (name.length < 2) return res.status(400).json({ error: 'Слишком короткое имя' });
      review.name = name;
    }
    if (b.text !== undefined) {
      const text = clean(b.text, 1000);
      if (text.length < 10) return res.status(400).json({ error: 'Слишком короткий отзыв' });
      review.text = text;
    }
    if (b.rating !== undefined) {
      const rating = Number(b.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Оценка от 1 до 5' });
      review.rating = rating;
    }

    await redis(['HSET', key, id, JSON.stringify(review)]);
    return res.status(200).json(review);
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Хранилище не подключено' });
    }
    console.error('review item error:', e);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}
