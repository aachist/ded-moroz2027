/**
 * Vercel Function (объединённая): bookings.ts
 * Содержит несколько обработчиков, чтобы уложиться в лимит функций тарифа Hobby (12).
 * Маршрутизация по адресам — в vercel.json (rewrites); здесь выбор обработчика по параметрам запроса.
 */
import process from 'node:process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ============================================================ listHandler
const listHandler = (() => {
/**
 * Vercel Function: заявки клиентов на вызов Деда Мороза.
 *   POST /api/bookings/:code            (публично)      — клиент занимает СВОБОДНОЕ время; заявка ждёт подтверждения
 *   GET  /api/bookings/:code            (администратор) — список всех заявок с контактами и статусами
 *   GET  /api/bookings/:code?ids=a,b    (публично)      — статусы заявок по их id (без контактов): клиент видит свою
 *
 * Статусы: pending (ждёт подтверждения) -> confirmed (подтверждена) или declined (отклонена, время свободно).
 * Заявки без статуса (созданные до появления подтверждений) считаются подтверждёнными.
 * Ожидающие и подтверждённые заявки занимают время; отклонённые — нет.
 *
 * Заявки хранятся отдельно от расписания администратора (Redis hash bookings:<code>),
 * чтобы его синхронизация не затирала заявки, а заявки — его записи.
 * Занятость проверяется на сервере: и по расписанию администратора, и по другим заявкам.
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

/* ---------- Часы работы и закрытые даты (настраиваются на странице «Настройки») ---------- */
type HoursWindow = { open: number; close: number }; // целые часы: open 0..23, close 1..24
type HoursRules = {
  weekly: Array<HoursWindow | null>; // индекс = день недели как в JS: 0 — воскресенье … 6 — суббота; null — не работаем
  exceptions: Array<{ date: string; closed: boolean; open?: number; close?: number; note?: string }>;
};
const hh2 = (h: number) => `${String(h).padStart(2, '0')}:00`;

async function readHours(code: string): Promise<HoursRules | null> {
  try {
    const raw = await redis(['GET', `hours:${code}`]);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return Array.isArray(j?.weekly) && j.weekly.length === 7 ? (j as HoursRules) : null;
  } catch {
    return null;
  }
}

/** Окно записи на дату: исключение важнее недельных часов. null — запись закрыта. Нет настроек — открыто 0–24, как раньше. */
function hoursWindowFor(rules: HoursRules | null, date: string): HoursWindow | null {
  if (!rules) return { open: 0, close: 24 };
  const ex = (rules.exceptions || []).find((x) => x.date === date);
  if (ex) return ex.closed ? null : { open: Number(ex.open), close: Number(ex.close) };
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return rules.weekly[dow] || null;
}

/* ---------- Уведомления владельцу в Telegram (необязательно) ---------- */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const siteUrl = () =>
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
const dateRu = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'UTC' });

/** Шлёт сообщение в Telegram, если бот подключён. Любой сбой молча игнорируется: заявку это не отменяет. */
async function notifyTelegram(code: string, html: string, replyMarkup?: any): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    let chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!/^-?\d{3,20}$/.test(chatId)) chatId = String((await redis(['GET', `telegram-chat:${code}`])) || '');
    if (!/^-?\d{3,20}$/.test(chatId)) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: ctrl.signal,
      });
      // Заявку это не отменяет, но причину отказа Telegram оставляем в журнале Vercel (токен туда не попадает)
      if (!r.ok) {
        const j: any = await r.json().catch(() => ({}));
        console.error(`telegram notify failed: HTTP ${r.status} ${String(j?.description || '').slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    console.error('telegram notify error:', e?.name === 'AbortError' ? 'timeout' : e?.message);
  }
}

/** Статус заявки; у заявок, созданных до подтверждений, статуса нет — они считаются подтверждёнными. */
const statusOf = (b: any): 'pending' | 'confirmed' | 'declined' =>
  b?.status === 'pending' || b?.status === 'declined' ? b.status : 'confirmed';

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
      if (b.date === date && statusOf(b) !== 'declined') out.push({ s: toMin(b.start), e: toMin(b.end) });
    } catch {}
  }
  return out;
}

async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }
  const key = `bookings:${code}`;

  try {
    if (req.method === 'GET') {
      // ---- Публично: статусы заявок по их id (клиент проверяет свои заявки). Без имён и телефонов ----
      const idsParam = String(req.query?.ids ?? '');
      if (idsParam) {
        const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);
        if (!ids.length || ids.some((id) => !/^[A-Za-z0-9_.-]{1,80}$/.test(id))) {
          return res.status(400).json({ error: 'Неверные параметры' });
        }
        const raws: Array<string | null> = (await redis(['HMGET', key, ...ids])) || [];
        const statuses: Record<string, { status: string; reason?: string } | null> = {};
        ids.forEach((id, i) => {
          const raw = raws[i];
          if (!raw) return void (statuses[id] = null); // заявки больше нет (удалена администратором)
          try {
            const b = JSON.parse(raw);
            const st = statusOf(b);
            statuses[id] = st === 'declined' && b.reason ? { status: st, reason: String(b.reason) } : { status: st };
          } catch {
            statuses[id] = null;
          }
        });
        return res.status(200).json({ statuses });
      }

      // ---- Администратор: список заявок со всеми контактами и статусами ----
      if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход' });
      const flat: string[] = (await redis(['HGETALL', key])) || [];
      const bookings: any[] = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          const b = JSON.parse(flat[i]);
          bookings.push({ ...b, status: statusOf(b) });
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
      // Конец может быть «24:00» (последний час суток, плитка 23:00–24:00)
      if (!TIME_RE.test(start) || !(TIME_RE.test(end) || end === '24:00')) return bad('Укажите время начала и окончания');
      const s = toMin(start);
      const e = toMin(end);
      if (e - s < MIN_MINUTES) return bad('Время окончания должно быть позже начала (минимум 15 минут)');
      if (e - s > MAX_MINUTES) return bad('Слишком длинный интервал (максимум 8 часов)');
      if (!TYPES.has(type)) return bad('Выберите вид праздника');
      if (name.length < 2) return bad('Укажите имя');
      if ((phone.match(/\d/g) || []).length < 6 || !/^[0-9+()\-\s.]+$/.test(phone)) return bad('Укажите телефон');

      // Часы работы и закрытые даты: проверяем на сервере, чтобы нельзя было обойти сайт
      const rules = await readHours(code);
      const win = hoursWindowFor(rules, date);
      if (!win) return bad('В этот день запись закрыта. Выберите другой день.');
      if (s < win.open * 60 || e > win.close * 60) {
        return bad(`В этот день запись принимается с ${hh2(win.open)} до ${hh2(win.close)}.`);
      }

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

      let booking: any = null;
      try {
        const busy = await busyForDate(code, date);
        if (busy.some((x) => s < x.e && x.s < e)) {
          return res.status(409).json({ error: 'busy', message: 'Это время уже занято. Выберите свободное.' });
        }
        booking = {
          id: `${Date.now()}-${randomBytes(4).toString('hex')}`,
          date,
          start,
          end,
          type,
          name,
          phone,
          note: note || undefined,
          status: 'pending', // ждёт подтверждения администратора
          createdAt: Date.now(),
        };
        await redis(['HSET', key, booking.id, JSON.stringify(booking)]);
      } finally {
        try {
          await redis(['DEL', lockKey]);
        } catch {}
      }

      // Сообщение владельцу в Telegram с кнопками «Подтвердить / Отклонить»
      // (блокировка уже снята; сбой Telegram заявку не отменяет)
      await notifyTelegram(
        code,
        [
          '🎅 <b>Новая заявка — ждёт подтверждения</b>',
          `📅 ${esc(dateRu(date))}, <b>${start}–${end}</b>`,
          `🎭 ${type === 'kids' ? 'Дети' : 'Взрослые'}`,
          `👤 ${esc(name)}`,
          `📞 ${esc(phone)}`,
          note ? `📝 ${esc(note)}` : '',
          siteUrl() ? `\n<a href="${siteUrl()}/#schedule">Открыть расписание</a>` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        {
          inline_keyboard: [
            [
              { text: '✅ Подтвердить', callback_data: `ok:${code}:${booking.id}` },
              { text: '❌ Отклонить', callback_data: `no:${code}:${booking.id}` },
            ],
          ],
        }
      );
      return res.status(201).json(booking);
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

  return handler;
})();

// ============================================================ itemHandler
const itemHandler = (() => {
/**
 * Vercel Function: решение администратора по заявке клиента.
 *   PATCH  /api/bookings/:code/:id  { status: 'confirmed' | 'declined', reason? }
 *   DELETE /api/bookings/:code/:id  — удаляет заявку насовсем
 *
 * Отклонённая заявка остаётся в списке (клиент увидит статус и причину), но время освобождается.
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

  return handler;
})();

// ============================================================ availabilityHandler
const availabilityHandler = (() => {
/**
 * Vercel Function: занятое время для клиентов (публичный запрос).
 *   GET /api/availability/:code?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     ->  { busy: { "YYYY-MM-DD": [ { start, end, id? } ] } }
 *
 * Отдаёт ТОЛЬКО интервалы времени: без вида праздника, имён, телефонов и комментариев.
 * id есть только у заявок, оставленных клиентами (случайный, чтобы клиент узнал свою заявку).
 */

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

async function handler(req: any, res: any) {
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
        if (b.status === 'declined') continue; // отклонённая заявка время не занимает
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

  return handler;
})();

// ============================================================ hoursHandler
const hoursHandler = (() => {
/**
 * Vercel Function: часы работы по дням недели и закрытые даты.
 *   GET  /api/hours/:code  (публично)      -> { weekly, exceptions }  (клиентам нужно, чтобы показать «не работаем»)
 *   POST /api/hours/:code  (администратор) <- { weekly, exceptions }
 *
 * weekly: 7 элементов, индекс как в JS (0 — воскресенье … 6 — суббота); null = в этот день не работаем,
 *   иначе { open, close } целыми часами (open 0..23, close 1..24, close > open).
 * exceptions: исключения по датам — { date, closed: true } или { date, closed: false, open, close }, note — заметка (видна клиентам).
 * Запись хранится отдельно от расписания (Redis hours:<code>). Пока ничего не настроено, открыто 0–24, как раньше.
 */

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
const MAX_EXCEPTIONS = 400;

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

const isInt = (v: any) => typeof v === 'number' && Number.isInteger(v);
const validWindow = (open: any, close: any) => isInt(open) && isInt(close) && open >= 0 && open <= 23 && close >= 1 && close <= 24 && close > open;

/** Приводит присланное к безопасному виду или возвращает текст ошибки. */
function parseRules(b: any): { weekly: any[]; exceptions: any[] } | string {
  if (!b || typeof b !== 'object') return 'Неверный формат';
  if (!Array.isArray(b.weekly) || b.weekly.length !== 7) return 'Нужны часы на все 7 дней недели';
  const weekly: any[] = [];
  for (const w of b.weekly) {
    if (w === null) {
      weekly.push(null);
    } else if (w && typeof w === 'object' && validWindow(w.open, w.close)) {
      weekly.push({ open: w.open, close: w.close });
    } else {
      return 'Часы работы заданы неверно (с 0 до 23, до 1–24, конец позже начала)';
    }
  }
  const raw = Array.isArray(b.exceptions) ? b.exceptions : [];
  if (raw.length > MAX_EXCEPTIONS) return 'Слишком много исключений';
  const seen = new Set<string>();
  const exceptions: any[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || !DATE_RE.test(String(x.date)) || Number.isNaN(Date.parse(`${x.date}T00:00:00Z`))) {
      return 'В списке исключений неверная дата';
    }
    if (seen.has(x.date)) return `Дата ${x.date} указана дважды`;
    seen.add(x.date);
    const note = typeof x.note === 'string' ? x.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';
    if (x.closed === true) {
      exceptions.push({ date: x.date, closed: true, ...(note ? { note } : {}) });
    } else if (x.closed === false && validWindow(x.open, x.close)) {
      exceptions.push({ date: x.date, closed: false, open: x.open, close: x.close, ...(note ? { note } : {}) });
    } else {
      return `Для даты ${x.date} неверно заданы часы`;
    }
  }
  exceptions.sort((a, b2) => a.date.localeCompare(b2.date));
  return { weekly, exceptions };
}

async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Неверный код синхронизации' });
  const key = `hours:${code}`;

  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', key]);
      if (!raw) return res.status(200).json({ weekly: null, exceptions: [] }); // не настроено: открыто всегда
      try {
        const j = JSON.parse(raw);
        return res.status(200).json({ weekly: j.weekly ?? null, exceptions: j.exceptions ?? [] });
      } catch {
        return res.status(200).json({ weekly: null, exceptions: [] });
      }
    }

    if (req.method === 'POST') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход' });
      let b = req.body;
      if (typeof b === 'string') {
        try {
          b = JSON.parse(b);
        } catch {
          b = null;
        }
      }
      const parsed = parseRules(b);
      if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
      const record = { ...parsed, updatedAt: Date.now() };
      await redis(['SET', key, JSON.stringify(record)]);
      return res.status(200).json({ success: true, ...record });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') return res.status(503).json({ error: 'Хранилище не подключено' });
    console.error('hours error:', e);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}

  return handler;
})();

export default async function handler(req: any, res: any) {
  if (String(req.query?.view ?? '') === 'hours') return hoursHandler(req, res);
  if (String(req.query?.view ?? '') === 'availability') return availabilityHandler(req, res);
  if (req.query?.id) return itemHandler(req, res);
  return listHandler(req, res);
}
