/**
 * Vercel Function: редактируемое содержимое сайта (контакты, «Варианты встреч», «Правила встреч»).
 *   GET /api/content/:code   (публично)       -> { contacts, variants, rules, updatedAt }
 *   PUT /api/content/:code   (администратор)  <- любые из полей contacts / variants / rules
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
const MAX_TEXT = 20000;
const PHONE_RE = /^[0-9+()\-\s.]{0,30}$/;
const TG_RE = /^(https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+\/-]{2,100}|@[A-Za-z0-9_]{3,40})?$/;
const EMAIL_RE = /^([^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,20})?$/;

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

const EMPTY = { contacts: { phone: '', telegram: '', email: '' }, variants: '', rules: '', updatedAt: 0 };

async function readContent(code: string) {
  const raw = await redis(['GET', `content:${code}`]);
  if (!raw) return { ...EMPTY, contacts: { ...EMPTY.contacts } };
  try {
    const c = JSON.parse(raw);
    return {
      contacts: {
        phone: String(c.contacts?.phone ?? ''),
        telegram: String(c.contacts?.telegram ?? ''),
        email: String(c.contacts?.email ?? ''),
      },
      variants: String(c.variants ?? ''),
      rules: String(c.rules ?? ''),
      updatedAt: Number(c.updatedAt) || 0,
    };
  } catch {
    return { ...EMPTY, contacts: { ...EMPTY.contacts } };
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Неверные параметры' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await readContent(code));
    }

    if (req.method === 'PUT') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход' });

      let b = req.body;
      if (typeof b === 'string') {
        try {
          b = JSON.parse(b);
        } catch {
          b = null;
        }
      }
      if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Неверный формат' });

      const current = await readContent(code);
      const next = { ...current, contacts: { ...current.contacts } };

      for (const key of ['variants', 'rules'] as const) {
        if (b[key] !== undefined) {
          if (typeof b[key] !== 'string' || b[key].length > MAX_TEXT) {
            return res.status(400).json({ error: `Слишком длинный текст (максимум ${MAX_TEXT} символов)` });
          }
          next[key] = b[key].replace(/\r\n/g, '\n');
        }
      }

      if (b.contacts !== undefined) {
        const c = b.contacts;
        if (!c || typeof c !== 'object') return res.status(400).json({ error: 'Неверные контакты' });
        const phone = c.phone !== undefined ? String(c.phone).trim() : current.contacts.phone;
        const telegram = c.telegram !== undefined ? String(c.telegram).trim() : current.contacts.telegram;
        const email = c.email !== undefined ? String(c.email).trim() : current.contacts.email;
        if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'Телефон: только цифры, + - ( ) и пробелы' });
        if (!TG_RE.test(telegram)) {
          return res.status(400).json({ error: 'Telegram: ссылка вида https://t.me/название или @название' });
        }
        if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Неверный адрес почты' });
        next.contacts = { phone, telegram, email };
      }

      next.updatedAt = Date.now();
      await redis(['SET', `content:${code}`, JSON.stringify(next)]);
      return res.status(200).json(next);
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Хранилище не подключено' });
    }
    console.error('content api error:', e);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}
