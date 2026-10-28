/**
 * Vercel Function: занятое время для клиентов (публичный запрос).
 *   GET /api/availability/:code?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     ->  { busy: { "YYYY-MM-DD": [ { start, end, id? } ] } }
 *
 * Отдаёт ТОЛЬКО интервалы времени: без вида праздника, имён, телефонов и комментариев.
 * id есть только у заявок, оставленных клиентами (случайный, чтобы клиент узнал свою заявку).
 */
import process from 'node:process';

const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SPAN_DAYS = 400;

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

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const code = String(req.query?.code ?? '');
  const from = String(req.query?.from ?? '');
  const to = String(req.query?.to ?? '');
  if (!CODE_RE.test(code) || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }
  const span = dayNumber(to) - dayNumber(from);
  if (!(span >= 0) || span > MAX_SPAN_DAYS) {
    return res.status(400).json({ error: 'Неверный диапазон дат' });
  }

  try {
    const busy: Record<string, Array<{ start: string; end: string; id?: string }>> = {};
    const inRange = (d: string) => DATE_RE.test(d) && d >= from && d <= to;
    const add = (date: string, start: any, end: any, id?: string) => {
      if (!inRange(date) || !TIME_RE.test(String(start)) || !(TIME_RE.test(String(end)) || end === '24:00')) return;
      (busy[date] ||= []).push(id ? { start, end, id } : { start, end });
    };

    // Расписание администратора: берём только время
    const rawSchedule = await redis(['GET', `schedule:${code}`]);
    if (rawSchedule) {
      try {
        const data = JSON.parse(rawSchedule).data || {};
        for (const [date, events] of Object.entries<any>(data)) {
          if (!Array.isArray(events)) continue;
          for (const e of events) add(date, e?.start, e?.end);
        }
      } catch {}
    }

    // Заявки клиентов: время и случайный id (без контактов)
    const flat: string[] = (await redis(['HGETALL', `bookings:${code}`])) || [];
    for (let i = 1; i < flat.length; i += 2) {
      try {
        const b = JSON.parse(flat[i]);
        add(String(b.date), b.start, b.end, String(b.id));
      } catch {}
    }

    for (const d of Object.keys(busy)) busy[d].sort((a, b) => a.start.localeCompare(b.start));
    return res.status(200).json({ busy });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Хранилище не подключено' });
    }
    console.error('availability error:', e);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}
