import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Ensure data and upload directories exist
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Simple JSON storage helper for schedule & media records
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const MEDIA_FILE = path.join(DATA_DIR, 'media.json');

function loadJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf-8');
      if (!text.trim()) return fallback; // пустой файл = нет данных
      try {
        return JSON.parse(text);
      } catch (e) {
        // Файл повреждён: сохраняем копию, чтобы следующая запись не уничтожила данные
        const backup = `${file}.corrupt-${Date.now()}`;
        try {
          fs.copyFileSync(file, backup);
        } catch (_) {}
        console.error(`Error loading ${file} (копия: ${backup}):`, e);
      }
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e);
  }
  return fallback;
}

function saveJson<T>(file: string, data: T): boolean {
  try {
    // Пишем во временный файл и переименовываем — так JSON не повредится при сбое посреди записи
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    console.error(`Error saving ${file}:`, e);
    return false;
  }
}

// Configure multer for disk storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '';
    const safeName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB limit for local video/photo
  },
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    storageMode: 'local_server',
    maxUploadMB: 200,
    timestamp: new Date().toISOString(),
  });
});

// POST /api/upload - Handle file upload (photo/video)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не был передан' });
  }

  const file = req.file;
  const isVideo = file.mimetype.startsWith('video/');
  const isPhoto = file.mimetype.startsWith('image/');

  const fileInfo = {
    id: path.parse(file.filename).name,
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    type: isVideo ? 'video' : isPhoto ? 'photo' : 'other',
    size: file.size,
    url: `/api/media/${file.filename}`,
    uploadedAt: Date.now(),
  };

  return res.json(fileInfo);
});

// GET /api/media/:filename - Stream media with HTTP Range support for video scrubbing
app.get('/api/media/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // Detect mime type simply by extension
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  if (range && contentType.startsWith('video/')) {
    // Handle Range Requests for smooth HTML5 video streaming
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).send(`Requested range not satisfiable: ${start} >= ${fileSize}`);
      return;
    }

    const chunksize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };

    res.writeHead(206, head);
    stream.pipe(res);
  } else {
    // Regular full stream
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// DELETE /api/media/:filename
app.delete('/api/media/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Error deleting file:', err);
    }
  }

  // Also remove from media records
  const allMedia = loadJson<Record<string, any[]>>(MEDIA_FILE, {});
  for (const code of Object.keys(allMedia)) {
    allMedia[code] = allMedia[code].filter((m) => m.filename !== filename && m.url !== `/api/media/${filename}`);
  }
  saveJson(MEDIA_FILE, allMedia);

  res.json({ success: true });
});

// Schedule Sync Endpoints
// В schedules.json: { [code]: { __v: 2, data, updatedAt } }  (старый формат — просто расписание)
function readScheduleRecord(code: string): { data: any; updatedAt: number } {
  const schedules = loadJson<Record<string, any>>(SCHEDULES_FILE, {});
  const rec = schedules[code];
  if (rec && rec.__v === 2) {
    return { data: rec.data || {}, updatedAt: Number(rec.updatedAt) || 0 };
  }
  return { data: rec || {}, updatedAt: 0 };
}

app.get('/api/schedule/:code', (req, res) => {
  const code = req.params.code;
  const { data, updatedAt } = readScheduleRecord(code);
  res.set('Cache-Control', 'no-store');
  res.json({ code, data, updatedAt });
});

app.post('/api/schedule/:code', (req, res) => {
  const code = req.params.code;
  const body = req.body;

  // Новый формат { data, updatedAt }; старый клиент присылает расписание целиком
  const isNew = body && typeof body === 'object' && typeof body.updatedAt === 'number' && body.data;
  const data = isNew ? body.data : body;
  const updatedAt = isNew ? body.updatedAt : Date.now();

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ success: false, error: 'Неверный формат расписания' });
  }

  const current = readScheduleRecord(code);
  if (updatedAt < current.updatedAt) {
    // Пришла более старая версия (например, запросы обогнали друг друга) — не затираем свежую
    return res.status(409).json({ success: false, stale: true, updatedAt: current.updatedAt });
  }
  if (updatedAt === current.updatedAt && JSON.stringify(data) === JSON.stringify(current.data)) {
    // Ничего не изменилось — не трогаем файл (иначе Vite/Tailwind видят "изменение" и перерисовывают страницу)
    return res.json({ success: true, updated: updatedAt, unchanged: true });
  }

  const schedules = loadJson<Record<string, any>>(SCHEDULES_FILE, {});
  schedules[code] = { __v: 2, data, updatedAt };
  const saved = saveJson(SCHEDULES_FILE, schedules);
  if (!saved) {
    return res.status(500).json({ success: false, error: 'Не удалось записать файл на диск' });
  }
  res.json({ success: true, updated: updatedAt });
});

// Media List Sync Endpoints
app.get('/api/media-list/:code', (req, res) => {
  const code = req.params.code;
  const allMedia = loadJson<Record<string, any[]>>(MEDIA_FILE, {});
  res.json({ code, items: allMedia[code] || [] });
});

app.post('/api/media-list/:code', (req, res) => {
  const code = req.params.code;
  const item = req.body;
  const allMedia = loadJson<Record<string, any[]>>(MEDIA_FILE, {});
  if (!allMedia[code]) {
    allMedia[code] = [];
  }
  // Add to top of list
  allMedia[code].unshift(item);
  saveJson(MEDIA_FILE, allMedia);
  res.json({ success: true, item });
});

app.delete('/api/media-list/:code/:id', (req, res) => {
  const { code, id } = req.params;
  const allMedia = loadJson<Record<string, any[]>>(MEDIA_FILE, {});
  if (allMedia[code]) {
    const itemToDelete = allMedia[code].find((m) => m.id === id);
    if (itemToDelete && itemToDelete.filename) {
      const filePath = path.join(UPLOADS_DIR, itemToDelete.filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error(e);
        }
      }
    }
    allMedia[code] = allMedia[code].filter((m) => m.id !== id);
    saveJson(MEDIA_FILE, allMedia);
  }
  res.json({ success: true });
});

// Dev vs Production Setup
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
