/**
 * Vercel Function: решение администратора по заявке клиента.
 *   PATCH  /api/bookings/:code/:id  { status: 'confirmed' | 'declined', reason? }
 *   DELETE /api/bookings/:code/:id  — удаляет заявку насовсем
 *
 * Отклонённая заявка остаётся в списке (клиент увидит статус и причину), но время освобождается.
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

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'DELETE' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'DELETE, PATCH');
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
  const key = `bookings:${code}`;

  try {
    if (req.method === 'DELETE') {
      await redis(['HDEL', key, id]);
      return res.status(200).json({ success: true });
    }

    // PATCH: подтвердить или отклонить
    const status = req.body?.status;
    if (status !== 'confirmed' && status !== 'declined') {
      return res.status(400).json({ error: 'Статус: confirmed или declined' });
    }
    const raw = await redis(['HGET', key, id]);
    if (!raw) return res.status(404).json({ error: 'Заявка не найдена (возможно, уже удалена)' });
    const booking = JSON.parse(raw);

    booking.status = status;
    booking.decidedAt = Date.now();
    if (status === 'declined') {
      const reason =
        typeof req.body?.reason === 'string'
          ? req.body.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200)
          : '';
      if (reason) booking.reason = reason;
      else delete booking.reason;
    } else {
      delete booking.reason;
    }
    await redis(['HSET', key, id, JSON.stringify(booking)]);
    return res.status(200).json(booking);
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Хранилище не подключено' });
    }
    console.error('booking item error:', e?.message);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}
