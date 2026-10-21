/**
 * Vercel Function: хранение расписания в Redis (Upstash).
 * Тот же контракт, что у server.ts:
 *   GET  /api/schedule/:code  ->  { code, data, updatedAt }
 *   POST /api/schedule/:code  <-  { data, updatedAt }
 *
 * Переменные окружения добавляются автоматически при подключении
 * Upstash Redis в Vercel (Storage / Marketplace):
 *   KV_REST_API_URL, KV_REST_API_TOKEN  (или UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
 */
import process from 'node:process';

const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const MAX_BODY = 500_000; // ~500 КБ на расписание — с большим запасом

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

async function readRecord(code: string): Promise<{ data: any; updatedAt: number }> {
  const raw = await redis(['GET', `schedule:${code}`]);
  if (!raw) return { data: {}, updatedAt: 0 };
  try {
    const rec = JSON.parse(raw);
    return { data: rec.data || {}, updatedAt: Number(rec.updatedAt) || 0 };
  } catch {
    return { data: {}, updatedAt: 0 };
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query?.code ?? '');
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Неверный код синхронизации' });
  }

  try {
    if (req.method === 'GET') {
      const { data, updatedAt } = await readRecord(code);
      return res.status(200).json({ code, data, updatedAt });
    }

    if (req.method === 'POST') {
      const body = req.body;
      if (!body || typeof body !== 'object' || typeof body.updatedAt !== 'number') {
        return res.status(400).json({ success: false, error: 'Неверный формат запроса' });
      }
      const { data, updatedAt } = body;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ success: false, error: 'Неверный формат расписания' });
      }
      const serialized = JSON.stringify({ data, updatedAt });
      if (serialized.length > MAX_BODY) {
        return res.status(413).json({ success: false, error: 'Расписание слишком большое' });
      }

      const current = await readRecord(code);
      if (updatedAt < current.updatedAt) {
        // Пришла более старая версия — не затираем свежую
        return res.status(409).json({ success: false, stale: true, updatedAt: current.updatedAt });
      }
      if (updatedAt === current.updatedAt && JSON.stringify(data) === JSON.stringify(current.data)) {
        return res.status(200).json({ success: true, updated: updatedAt, unchanged: true });
      }

      await redis(['SET', `schedule:${code}`, serialized]);
      return res.status(200).json({ success: true, updated: updatedAt });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    if (e?.message === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Хранилище не подключено (нет переменных Redis)' });
    }
    console.error('schedule api error:', e);
    return res.status(500).json({ error: 'Ошибка хранилища' });
  }
}
