/**
 * Vercel Function: настройка уведомлений в Telegram (только администратор).
 *   GET  /api/telegram/:code                        -> { tokenSet, tokenOk, botUsername, chatId, chatFromEnv }
 *   POST /api/telegram/:code { action: 'find' }      -> chats[]   (кто писал боту: чтобы выбрать, кому слать)
 *   POST /api/telegram/:code { action: 'select', chatId } -> подключает чат и шлёт приветствие
 *   POST /api/telegram/:code { action: 'test' }      -> тестовое сообщение
 *   POST /api/telegram/:code { action: 'disconnect' }
 *
 * Токен бота хранится только в переменной окружения TELEGRAM_BOT_TOKEN на сервере и никогда не уходит в браузер.
 * Чат получателя хранится в Redis (или в переменной TELEGRAM_CHAT_ID).
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
const CHAT_RE = /^-?\d{3,20}$/;

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

/** Вызов Telegram Bot API. Ошибки возвращаются как { ok:false, description } — токен наружу не попадает. */
async function tg(method: string, body: any = {}, timeoutMs = 8000): Promise<{ ok: boolean; result?: any; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'Токен бота не задан на сервере' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const j: any = await r.json().catch(() => ({}));
    return j && typeof j.ok === 'boolean' ? j : { ok: false, description: `Ответ Telegram: HTTP ${r.status}` };
  } catch (e: any) {
    return { ok: false, description: e?.name === 'AbortError' ? 'Telegram не ответил вовремя' : 'Нет связи с Telegram' };
  } finally {
    clearTimeout(timer);
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function savedChat(code: string): Promise<{ id: string | null; fromEnv: boolean }> {
  const env = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (CHAT_RE.test(env)) return { id: env, fromEnv: true };
  try {
    const v = await redis(['GET', `telegram-chat:${code}`]);
    return { id: v && CHAT_RE.test(String(v)) ? String(v) : null, fromEnv: false };
  } catch {
    return { id: null, fromEnv: false };
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход' });

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Неверные параметры' });

  try {
    if (req.method === 'GET') {
      const tokenSet = !!process.env.TELEGRAM_BOT_TOKEN;
      let tokenOk = false;
      let botUsername = '';
      if (tokenSet) {
        const me = await tg('getMe', {}, 6000);
        tokenOk = !!me.ok;
        botUsername = me.ok ? String(me.result?.username || '') : '';
      }
      const chat = await savedChat(code);
      return res.status(200).json({ tokenSet, tokenOk, botUsername, chatId: chat.id, chatFromEnv: chat.fromEnv });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const action = String(req.body?.action ?? '');

    if (action === 'find') {
      const r = await tg('getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message'] });
      if (!r.ok) return res.status(200).json({ ok: false, error: r.description || 'Не удалось получить сообщения' });
      const seen = new Map<string, any>();
      for (const u of r.result || []) {
        const c = u?.message?.chat;
        if (!c || seen.has(String(c.id))) continue;
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.title || '';
        seen.set(String(c.id), { id: String(c.id), type: c.type, name, username: c.username || '' });
      }
      return res.status(200).json({ ok: true, chats: [...seen.values()] });
    }

    if (action === 'select') {
      const chatId = String(req.body?.chatId ?? '').trim();
      if (!CHAT_RE.test(chatId)) return res.status(400).json({ ok: false, error: 'Неверный номер чата' });
      // Подключаем только если бот может написать в этот чат
      const r = await tg('sendMessage', {
        chat_id: chatId,
        text: '✅ <b>Уведомления подключены.</b>\nСюда будут приходить новые заявки и отзывы с сайта.',
        parse_mode: 'HTML',
      });
      if (!r.ok) return res.status(200).json({ ok: false, error: r.description || 'Не удалось отправить сообщение' });
      await redis(['SET', `telegram-chat:${code}`, chatId]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'test') {
      const chat = await savedChat(code);
      if (!chat.id) return res.status(200).json({ ok: false, error: 'Сначала подключите чат' });
      const r = await tg('sendMessage', {
        chat_id: chat.id,
        text: `🔔 <b>Проверка связи</b>\nЕсли вы видите это сообщение, уведомления работают.\n${esc(new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))} (МСК)`,
        parse_mode: 'HTML',
      });
      return res.status(200).json(r.ok ? { ok: true } : { ok: false, error: r.description || 'Не удалось отправить' });
    }

    if (action === 'disconnect') {
      await redis(['DEL', `telegram-chat:${code}`]);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Неизвестное действие' });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') return res.status(503).json({ error: 'Хранилище не подключено' });
    console.error('telegram api error:', e?.message);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
}
