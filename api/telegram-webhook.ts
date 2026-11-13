/**
 * Vercel Function: приём нажатий на кнопки в Telegram («Подтвердить» / «Отклонить» заявку).
 *   POST /api/telegram-webhook   (вызывает сам Telegram)
 *
 * Защита:
 *  - Telegram присылает секретный заголовок X-Telegram-Bot-Api-Secret-Token, выведенный из токена бота; чужие запросы отклоняются;
 *  - нажатие принимается только из подключённого чата владельца.
 * Всегда отвечаем 200 на корректные запросы, иначе Telegram будет их повторять.
 */
import process from 'node:process';
import { createHmac, timingSafeEqual } from 'node:crypto';

const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const DATA_RE = /^(ok|no):([A-Za-z0-9_-]{4,40}):([A-Za-z0-9_.-]{1,80})$/;
const CHAT_RE = /^-?\d{3,20}$/;

/** Секрет вебхука выводится из токена бота (отдельную переменную заводить не нужно). */
const webhookSecret = (token: string) => createHmac('sha256', token).update('dm-webhook').digest('hex').slice(0, 40);

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

async function tg(token: string, method: string, body: any): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await r.json().catch(() => ({}));
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dateRu = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'UTC' });
const siteUrl = () =>
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');

async function savedChat(code: string): Promise<string | null> {
  const env = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (CHAT_RE.test(env)) return env;
  const v = await redis(['GET', `telegram-chat:${code}`]);
  return v && CHAT_RE.test(String(v)) ? String(v) : null;
}

const statusOf = (b: any): 'pending' | 'confirmed' | 'declined' =>
  b?.status === 'pending' || b?.status === 'declined' ? b.status : 'confirmed';

/** Текст сообщения после решения (заменяет исходное, кнопки убираются). */
function resultText(b: any, status: 'confirmed' | 'declined'): string {
  return [
    status === 'confirmed' ? '✅ <b>Заявка подтверждена</b>' : '❌ <b>Заявка отклонена</b>',
    `📅 ${esc(dateRu(String(b.date)))}, <b>${esc(String(b.start))}–${esc(String(b.end))}</b>`,
    `🎭 ${b.type === 'adults' ? 'Взрослые' : 'Дети'}`,
    `👤 ${esc(String(b.name || ''))}`,
    `📞 ${esc(String(b.phone || ''))}`,
    b.note ? `📝 ${esc(String(b.note))}` : '',
    siteUrl() ? `\n<a href="${siteUrl()}/#schedule">Открыть расписание</a>` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).json({ error: 'Бот не настроен' });

  // Запрос должен прийти от Telegram с нашим секретом
  const got = String(req.headers?.['x-telegram-bot-api-secret-token'] || '');
  const want = webhookSecret(token);
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Неверный секрет' });
  }

  const cq = req.body?.callback_query;
  if (!cq) return res.status(200).json({ ok: true }); // другие события (обычные сообщения) нам не нужны

  try {
    const m = DATA_RE.exec(String(cq.data || ''));
    const chatId = String(cq.message?.chat?.id ?? '');
    const messageId = cq.message?.message_id;
    const answer = (text: string, alert = false) =>
      tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert });

    if (!m || !CODE_RE.test(m[2]) || !ID_RE.test(m[3])) {
      await answer('Неверная кнопка');
      return res.status(200).json({ ok: true });
    }
    const [, action, code, id] = m;

    // Решать может только подключённый чат владельца
    const owner = await savedChat(code);
    if (!owner || owner !== chatId) {
      await answer('Недостаточно прав', true);
      return res.status(200).json({ ok: true });
    }

    const key = `bookings:${code}`;
    const raw = await redis(['HGET', key, id]);
    const clearButtons = () => tg(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });

    if (!raw) {
      await answer('Заявка уже удалена', true);
      await clearButtons();
      return res.status(200).json({ ok: true });
    }
    const booking = JSON.parse(raw);
    const current = statusOf(booking);

    if (current !== 'pending') {
      await answer(current === 'confirmed' ? 'Уже подтверждена' : 'Уже отклонена', true);
      await tg(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: resultText(booking, current),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [] },
      });
      return res.status(200).json({ ok: true });
    }

    const status = action === 'ok' ? 'confirmed' : 'declined';
    booking.status = status;
    booking.decidedAt = Date.now();
    delete booking.reason;
    await redis(['HSET', key, id, JSON.stringify(booking)]);

    await answer(status === 'confirmed' ? '✅ Заявка подтверждена' : '❌ Заявка отклонена');
    await tg(token, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: resultText(booking, status),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (e: any) {
    console.error('telegram webhook error:', e?.message);
  }
  return res.status(200).json({ ok: true });
}
