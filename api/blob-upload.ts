/**
 * Vercel Function: выдаёт браузеру одноразовый токен для прямой загрузки файла в Vercel Blob.
 * Файл летит с устройства напрямую в Blob, минуя функцию (у функций лимит ~4.5 МБ на запрос).
 * Нужна переменная окружения BLOB_READ_WRITE_TOKEN (добавляется при подключении Blob к проекту).
 */
import process from 'node:process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

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
const MAX_SIZE = 200 * 1024 * 1024; // 200 МБ, как указано в интерфейсе

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Загружать файлы может только администратор
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Требуется вход' });
  }

  try {
    const json = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let code = '';
        try {
          code = JSON.parse(clientPayload || '{}').code;
        } catch {}
        if (!CODE_RE.test(String(code))) {
          throw new Error('Неверный код синхронизации');
        }
        // Писать можно только в свою папку (иначе при перезаписи можно затереть чужие файлы)
        if (!pathname.startsWith(`media/${code}/`) || pathname.includes('..')) {
          throw new Error('Недопустимый путь файла');
        }
        return {
          allowedContentTypes: ['video/*', 'image/*'],
          maximumSizeInBytes: MAX_SIZE,
          // Постоянное имя media/<код>/<id>.<расширение>: если два устройства выгрузят один файл
          // одновременно, он перезапишется, а не продублируется (экономим квоту Blob).
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    return res.status(200).json(json);
  } catch (e: any) {
    console.error('blob-upload error:', e);
    return res.status(400).json({ error: e?.message || 'Ошибка загрузки' });
  }
}
