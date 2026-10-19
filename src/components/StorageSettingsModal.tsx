import React, { useState } from 'react';
import {
  ShieldCheck,
  Server,
  HardDrive,
  Info,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';

export const StorageSettingsModal: React.FC = () => {
  const [healthStatus, setHealthStatus] = useState<{
    tested: boolean;
    ok: boolean;
    msg: string;
    loading: boolean;
  }>({
    tested: false,
    ok: false,
    msg: '',
    loading: false,
  });

  const checkHealth = async () => {
    setHealthStatus({ tested: false, ok: false, msg: 'Проверка...', loading: true });
    try {
      const start = performance.now();
      const res = await fetch('/api/health');
      const timeMs = Math.round(performance.now() - start);
      if (res.ok) {
        const json = await res.json();
        setHealthStatus({
          tested: true,
          ok: true,
          msg: `Встроенное хранилище активно и готово к работе (${timeMs}мс, лимит файла: ${json.maxUploadMB || 200} МБ)`,
          loading: false,
        });
      } else {
        setHealthStatus({
          tested: true,
          ok: false,
          msg: `Сервер ответил ошибкой: ${res.status}`,
          loading: false,
        });
      }
    } catch (e: any) {
      setHealthStatus({
        tested: true,
        ok: false,
        msg: `Не удалось связаться с сервером: ${e.message}`,
        loading: false,
      });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Primary Status Card */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-emerald-100 text-emerald-700 rounded-2xl">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">
                Встроенное хранилище (Без ключей)
              </h2>
              <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                Активно
              </span>
            </div>
            <p className="text-sm text-slate-600 mt-1">
              Ваша медиа-галерея работает полностью автономно. Для добавления фото и видео (включая крупные файлы до 200 МБ) не требуются ключи Cloudinary или платные аккаунты.
            </p>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={checkHealth}
                disabled={healthStatus.loading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${healthStatus.loading ? 'animate-spin' : ''}`} />
                <span>Проверить хранилище</span>
              </button>

              {healthStatus.tested && (
                <div
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                    healthStatus.ok
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}
                >
                  {healthStatus.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{healthStatus.msg}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Explanation of the previous Cloudinary error */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
          <HelpCircle className="w-5 h-5 text-blue-500" />
          <span>Почему ранее возникала ошибка «Нет соединения с Cloudinary»?</span>
        </div>

        <div className="space-y-3 text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
          <p>
            В исходной программе для видеофайлов был прописан вызов сервиса <strong>Cloudinary</strong> с параметрами <code>acggp2j1</code> и пресетом <code>ml_default</code>.
          </p>
          <p>
            В Cloudinary загрузка без секретного API-ключа работает только в том случае, если в личном кабинете Cloudinary вручную включен специальный <em>«Unsigned Upload Preset»</em>. Если такой пресет не настроен или облако заблокировано, браузер отклоняет сетевой запрос по правилам CORS — из-за чего сайт выдавал сообщение <em>«Нет соединения с Cloudinary»</em>.
          </p>
          <p className="font-medium text-slate-800">
            Для видео без Cloudinary был лимит базы всего 700 КБ (потому что документ Firestore ограничен 1 МБ), из-за чего обычные видеоролики с телефонов не могли загрузиться.
          </p>
        </div>

        <div className="flex items-center gap-2 text-slate-900 font-bold text-base pt-2">
          <Server className="w-5 h-5 text-emerald-600" />
          <span>Что было улучшено и исправлено:</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs sm:text-sm">
          <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70 space-y-1">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-blue-600" />
              Прямая загрузка без ключей
            </span>
            <p className="text-slate-500">
              Создан серверный API (Express / Node.js) на эндпоинтах <code>/api/upload</code> и <code>/api/media</code>. Файлы сохраняются прямо в файловое хранилище приложения.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70 space-y-1">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-emerald-600" />
              Поддержка потокового видео
            </span>
            <p className="text-slate-500">
              Реализована отдача видео с заголовками <code>Accept-Ranges: bytes</code>, что позволяет плавно перематывать видео вперед и назад в плеере.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70 space-y-1">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-purple-600" />
              Автогенерация обложек
            </span>
            <p className="text-slate-500">
              Браузер с помощью HTML5 Canvas автоматически делает скриншот 1-й секунды любого загружаемого видео, создавая миниатюру для галереи.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70 space-y-1">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              IndexedDB кэширование
            </span>
            <p className="text-slate-500">
              Все элементы галереи кэшируются в локальной базе браузера (IndexedDB), обеспечивая мгновенную загрузку даже при нестабильной сети.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
