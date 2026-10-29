/**
 * Vercel Function: отзывы.
 *   GET  /api/reviews/:code            (публично)      — только одобренные отзывы
 *   GET  /api/reviews/:code?all=1      (администратор) — все, включая ожидающие проверки
 *   POST /api/reviews/:code            (публично)      — новый отзыв: ждёт одобрения администратора
 *                                      (администратор добавляет сразу одобренный)
 */
import process from 'node:process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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
const MAX_REVIEWS = 500;
const RATE_LIMIT = 3; // отзывов с одного адреса
const RATE_WINDOW = 60 * 60; // в час

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

function clientIp(req: any): string {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.socket?.remoteAddress || 'unknown');
}

function cleanText(v: any, max: number): string {
  return typeof v === 'string'
    ? v.replace(/\r\n/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max)
    : '';
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }
  const key = `reviews:${code}`;

  try {
    if (req.method === 'GET') {
      const wantAll = String(req.query?.all ?? '') === '1';
      if (wantAll && !isAdmin(req)) return res.status(401).json({ error: 'Требуется вход' });

      const flat: string[] = (await redis(['HGETALL', key])) || [];
      let reviews: any[] = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          reviews.push(JSON.parse(flat[i]));
        } catch {}
      }
      if (!wantAll) {
        // Публично: только одобренные и только безопасные поля
        reviews = reviews
          .filter((r) => r.status === 'approved')
          .map((r) => ({ id: r.id, name: r.name, text: r.text, rating: r.rating, createdAt: r.createdAt }));
      }
      reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return res.status(200).json({ reviews });
    }

    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') {
        try {
          b = JSON.parse(b);
        } catch {
          b = null;
        }
      }
      if (!b || typeof b !== 'object') return res.status(400).json({ error: 'invalid', message: 'Неверный запрос' });

      const admin = isAdmin(req) && !!process.env.ADMIN_PASSWORD; // без пароля на сервере все считаются клиентами

      // Ловушка для ботов
      if (typeof b.website === 'string' && b.website.trim()) {
        return res.status(201).json({ ok: true, pending: true });
      }

      const name = cleanText(b.name, 60);
      const text = cleanText(b.text, 1000);
      const rating = Number(b.rating);
      const bad = (message: string) => res.status(400).json({ error: 'invalid', message });
      if (name.length < 2) return bad('Укажите имя');
      if (text.length < 10) return bad('Напишите отзыв подробнее (минимум 10 символов)');
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad('Поставьте оценку от 1 до 5');

      // Ограничение частоты (защита от спама) считается только для корректных отзывов,
      // чтобы опечатки в форме не приводили к блокировке
      if (!admin) {
        try {
          const ipKey = `review-rate:${clientIp(req)}`;
          const n = Number(await redis(['INCR', ipKey]));
          if (n === 1) await redis(['EXPIRE', ipKey, RATE_WINDOW]);
          if (n > RATE_LIMIT) {
            return res.status(429).json({ error: 'rate', message: 'Слишком много отзывов. Попробуйте позже.' });
          }
        } catch {}
      }

      if (Number(await redis(['HLEN', key])) >= MAX_REVIEWS) {
        return res.status(503).json({ error: 'full', message: 'Приём отзывов временно закрыт.' });
      }

      const review = {
        id: `${Date.now()}-${randomBytes(4).toString('hex')}`,
        name,
        text,
        rating,
        createdAt: Date.now(),
        status: admin ? 'approved' : 'pending',
      };
      await redis(['HSET', key, review.id, JSON.stringify(review)]);
      return res.status(201).json(admin ? review : { ok: true, pending: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'not_configured', message: 'Хранилище не подключено' });
    }
    console.error('reviews api error:', e);
    return res.status(500).json({ error: 'server', message: 'Ошибка сервера. Попробуйте позже.' });
  }
}
