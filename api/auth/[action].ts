/**
 * Vercel Function: вход администратора по паролю.
 *   GET  /api/auth/session  ->  { admin: boolean, configured: boolean }
 *   POST /api/auth/login    <-  { password }   (ставит защищённую cookie на 30 дней)
 *   POST /api/auth/logout   (убирает cookie)
 *
 * Пароль задаётся в Vercel: Settings → Environment Variables → ADMIN_PASSWORD (затем Redeploy).
 * Необязательно: AUTH_SECRET — отдельный секрет для подписи cookie (иначе используется пароль).
 * Пока ADMIN_PASSWORD не задан, сайт работает «открытым» (как раньше), а админ-панель показывает предупреждение.
 */
import process from 'node:process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'dm_session';
const MAX_AGE = 30 * 24 * 60 * 60; // 30 дней
const MAX_FAILS = 8; // неудачных попыток с одного адреса за окно
const FAIL_WINDOW = 15 * 60; // секунд

const secretKey = () => process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || '';

function sign(exp: string): string {
  return createHmac('sha256', secretKey()).update(exp).digest('hex');
}

function hasValidSession(req: any): boolean {
  const key = secretKey();
  if (!key) return false;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(String(req.headers?.cookie || ''));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  const expNum = Number(exp);
  if (!expNum || expNum < Date.now() || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameText(x: string, y: string): boolean {
  // Сравниваем хэши одинаковой длины — без утечки по времени
  const a = createHash('sha256').update(x).digest();
  const b = createHash('sha256').update(y).digest();
  return timingSafeEqual(a, b);
}

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

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  const action = String(req.query?.action ?? '');
  const configured = !!process.env.ADMIN_PASSWORD;

  if (action === 'session' && req.method === 'GET') {
    // Без заданного пароля сайт открыт для всех (прежнее поведение), иначе нужна cookie
    return res.status(200).json({ admin: !configured || hasValidSession(req), configured });
  }

  if (action === 'logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return res.status(200).json({ success: true });
  }

  if (action === 'login' && req.method === 'POST') {
    if (!configured) {
      return res.status(503).json({ error: 'not_configured' });
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const failKey = `login-fail:${clientIp(req)}`;

    // Защита от подбора пароля: ограничение неудачных попыток (если Redis доступен)
    try {
      const fails = Number(await redis(['GET', failKey])) || 0;
      if (fails >= MAX_FAILS) {
        return res.status(429).json({ error: 'too_many' });
      }
    } catch {}

    if (!password || !sameText(password, String(process.env.ADMIN_PASSWORD))) {
      try {
        const n = Number(await redis(['INCR', failKey]));
        if (n === 1) await redis(['EXPIRE', failKey, FAIL_WINDOW]);
      } catch {}
      return res.status(401).json({ error: 'wrong_password' });
    }

    try {
      await redis(['DEL', failKey]);
    } catch {}
    const exp = String(Date.now() + MAX_AGE * 1000);
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${encodeURIComponent(`${exp}.${sign(exp)}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`
    );
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
