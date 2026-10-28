/**
 * Vercel Function: заявки клиентов на вызов Деда Мороза.
 *   POST /api/bookings/:code   (публично)   — клиент занимает СВОБОДНОЕ время
 *   GET  /api/bookings/:code   (администратор) — список всех заявок с контактами
 *
 * Заявки хранятся отдельно от расписания администратора (Redis hash bookings:<code>),
 * чтобы его синхронизация не затирала заявки, а заявки — его записи.
 * Занятость проверяется на сервере: и по расписанию администратора, и по другим заявкам.
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPES = new Set(['kids', 'adults']);

const MIN_MINUTES = 15;
const MAX_MINUTES = 8 * 60;
const MAX_DAYS_AHEAD = 365;
const MAX_BOOKINGS = 1000; // общий предел заявок (защита от засорения)
const RATE_LIMIT = 10; // обращений с одного адреса
const RATE_WINDOW = 60 * 60; // за час

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

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clientIp(req: any): string {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.socket?.remoteAddress || 'unknown');
}

function cleanText(v: any, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

/** Все занятые интервалы дня: расписание администратора + чужие заявки. */
async function busyForDate(code: string, date: string): Promise<Array<{ s: number; e: number }>> {
  const out: Array<{ s: number; e: number }> = [];
  const raw = await redis(['GET', `schedule:${code}`]);
  if (raw) {
    try {
      const events = (JSON.parse(raw).data || {})[date];
      if (Array.isArray(events)) {
        for (const ev of events) {
          if (TIME_RE.test(String(ev?.start)) && (TIME_RE.test(String(ev?.end)) || ev?.end === '24:00')) {
            out.push({ s: toMin(ev.start), e: ev.end === '24:00' ? 1440 : toMin(ev.end) });
          }
        }
      }
    } catch {}
  }
  const flat: string[] = (await redis(['HGETALL', `bookings:${code}`])) || [];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      const b = JSON.parse(flat[i]);
      if (b.date === date) out.push({ s: toMin(b.start), e: toMin(b.end) });
    } catch {}
  }
  return out;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }
  const key = `bookings:${code}`;

  try {
    // ---- Администратор: список заявок со всеми контактами ----
    if (req.method === 'GET') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход' });
      const flat: string[] = (await redis(['HGETALL', key])) || [];
      const bookings: any[] = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          bookings.push(JSON.parse(flat[i]));
        } catch {}
      }
      bookings.sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start)));
      return res.status(200).json({ bookings });
    }

    // ---- Клиент: новая заявка ----
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

      // Ловушка для ботов: скрытое поле, которое человек не заполняет
      if (typeof b.website === 'string' && b.website.trim()) {
        return res.status(201).json({ id: 'ok', ignored: true });
      }

      // Ограничение частоты (защита от спама)
      try {
        const ipKey = `book-rate:${clientIp(req)}`;
        const n = Number(await redis(['INCR', ipKey]));
        if (n === 1) await redis(['EXPIRE', ipKey, RATE_WINDOW]);
        if (n > RATE_LIMIT) {
          return res.status(429).json({ error: 'rate', message: 'Слишком много заявок. Попробуйте позже или позвоните нам.' });
        }
      } catch {}

      const date = String(b.date ?? '');
      const start = String(b.start ?? '');
      const end = String(b.end ?? '');
      const type = String(b.type ?? '');
      const name = cleanText(b.name, 80);
      const phone = cleanText(b.phone, 30);
      const note = cleanText(b.note, 500);

      const bad = (message: string) => res.status(400).json({ error: 'invalid', message });
      if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return bad('Укажите дату');
      const dayDiff = (Date.parse(`${date}T00:00:00Z`) - Date.now()) / 86_400_000;
      if (dayDiff < -1 || dayDiff > MAX_DAYS_AHEAD) return bad('Выберите дату в ближайший год');
      if (!TIME_RE.test(start) || !TIME_RE.test(end)) return bad('Укажите время начала и окончания');
      const s = toMin(start);
      const e = toMin(end);
      if (e - s < MIN_MINUTES) return bad('Время окончания должно быть позже начала (минимум 15 минут)');
      if (e - s > MAX_MINUTES) return bad('Слишком длинный интервал (максимум 8 часов)');
      if (!TYPES.has(type)) return bad('Выберите вид праздника');
      if (name.length < 2) return bad('Укажите имя');
      if ((phone.match(/\d/g) || []).length < 6 || !/^[0-9+()\-\s.]+$/.test(phone)) return bad('Укажите телефон');

      if (Number(await redis(['HLEN', key])) >= MAX_BOOKINGS) {
        return res.status(503).json({ error: 'full', message: 'Приём заявок временно закрыт. Позвоните нам.' });
      }

      // Короткая блокировка на дату: две заявки на одно время не пройдут одновременно
      const lockKey = `booklock:${code}:${date}`;
      let locked = false;
      for (let i = 0; i < 5 && !locked; i++) {
        locked = (await redis(['SET', lockKey, '1', 'NX', 'EX', 8])) === 'OK';
        if (!locked) await sleep(250);
      }
      if (!locked) {
        return res.status(503).json({ error: 'busy_lock', message: 'Сервер занят, повторите через секунду.' });
      }

      try {
        const busy = await busyForDate(code, date);
        if (busy.some((x) => s < x.e && x.s < e)) {
          return res.status(409).json({ error: 'busy', message: 'Это время уже занято. Выберите свободное.' });
        }
        const booking = {
          id: `${Date.now()}-${randomBytes(4).toString('hex')}`,
          date,
          start,
          end,
          type,
          name,
          phone,
          note: note || undefined,
          createdAt: Date.now(),
        };
        await redis(['HSET', key, booking.id, JSON.stringify(booking)]);
        return res.status(201).json(booking);
      } finally {
        try {
          await redis(['DEL', lockKey]);
        } catch {}
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'not_configured', message: 'Хранилище не подключено' });
    }
    console.error('bookings api error:', e);
    return res.status(500).json({ error: 'server', message: 'Ошибка сервера. Попробуйте позже.' });
  }
}
