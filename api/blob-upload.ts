/**
 * Vercel Function: выдаёт браузеру одноразовый токен для прямой загрузки файла в Vercel Blob.
 * Файл летит с устройства напрямую в Blob, минуя функцию (у функций лимит ~4.5 МБ на запрос).
 * Нужна переменная окружения BLOB_READ_WRITE_TOKEN (добавляется при подключении Blob к проекту).
 */
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const MAX_SIZE = 200 * 1024 * 1024; // 200 МБ, как указано в интерфейсе

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const json = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let code = '';
        try {
          code = JSON.parse(clientPayload || '{}').code;
        } catch {}
        if (!CODE_RE.test(String(code))) {
          throw new Error('Неверный код синхронизации');
        }
        return {
          allowedContentTypes: ['video/*', 'image/*'],
          maximumSizeInBytes: MAX_SIZE,
          addRandomSuffix: true,
        };
      },
    });
    return res.status(200).json(json);
  } catch (e: any) {
    console.error('blob-upload error:', e);
    return res.status(400).json({ error: e?.message || 'Ошибка загрузки' });
  }
}
