import React, { useRef, useState } from 'react';
import { DaySchedule, MediaItem } from '../types';
import {
  createBackup,
  downloadBlob,
  backupFileName,
  readBackup,
  restoreBackup,
  countEvents,
  LoadedBackup,
} from '../utils/backup';
import { Download, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

interface HelpViewProps {
  schedule: DaySchedule;
  onUpdateSchedule: (s: DaySchedule) => void;
  mediaList: MediaItem[];
  syncCode: string;
  onRefreshMedia: () => void;
}

type Msg = { type: 'ok' | 'warn' | 'err'; text: string } | null;

const Step: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <li className="flex gap-3">
    <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">
      {n}
    </span>
    <span className="text-sm text-slate-700 leading-relaxed">{children}</span>
  </li>
);

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="bg-white/80 backdrop-blur-sm border border-slate-200/80 rounded-2xl p-5 shadow-xs">
    <h3 className="text-base font-bold text-slate-900 mb-3">{title}</h3>
    {children}
  </section>
);

export const HelpView: React.FC<HelpViewProps> = ({
  schedule,
  onUpdateSchedule,
  mediaList,
  syncCode,
  onRefreshMedia,
}) => {
  const [includeVideos, setIncludeVideos] = useState(true);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [progress, setProgress] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState<{ name: string; loaded: LoadedBackup } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const fileRef = useRef<HTMLInputElement>(null);

  const doBackup = async () => {
    setBusy('backup');
    setMsg(null);
    setProgress('');
    try {
      const { blob, stats } = await createBackup(schedule, mediaList, { includeVideos }, (d, t) =>
        setProgress(t ? `Подготовка файлов: ${d} из ${t}` : '')
      );
      downloadBlob(blob, backupFileName());
      let text = `Копия сохранена: мероприятий ${stats.events}, фото ${stats.photos}, видео ${stats.videos}.`;
      if (stats.skippedVideos) text += ` Видео не включены: ${stats.skippedVideos}.`;
      if (stats.missing) text += ` Не удалось получить файлов: ${stats.missing} (проверьте связь и повторите).`;
      setMsg({ type: stats.missing ? 'warn' : 'ok', text });
    } catch (e: any) {
      setMsg({
        type: 'err',
        text: `Не удалось создать копию: ${e?.message || e}. Если файлов очень много, попробуйте без видео.`,
      });
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg(null);
    setPending(null);
    try {
      const loaded = await readBackup(file);
      setPending({ name: file.name, loaded });
      setMode('merge');
    } catch (err: any) {
      setMsg({ type: 'err', text: `Не удалось прочитать файл: ${err?.message || err}` });
    }
  };

  const doRestore = async () => {
    if (!pending) return;
    if (
      mode === 'replace' &&
      !window.confirm(
        'Заменить все текущие мероприятия мероприятиями из копии?\n\nЭто нельзя отменить. Рекомендуем сначала скачать копию текущих данных.'
      )
    ) {
      return;
    }
    setBusy('restore');
    setMsg(null);
    try {
      const res = await restoreBackup(pending.loaded, mode, { syncCode, schedule, media: mediaList });
      if (mode === 'replace' || res.addedEvents > 0) onUpdateSchedule(res.schedule);
      if (res.addedMedia > 0) onRefreshMedia();

      let text = `Восстановлено: мероприятий ${res.addedEvents}, фото и видео ${res.addedMedia}.`;
      if (res.skippedMedia) text += ` Уже были на сайте: ${res.skippedMedia}.`;
      if (res.unavailableMedia) text += ` Не было в копии (без файла): ${res.unavailableMedia}.`;
      if (res.addedMedia > 0) text += ' Файлы выгружаются в облако в фоне, не закрывайте страницу, пока не появится «Все файлы в облаке».';
      setMsg({ type: res.unavailableMedia ? 'warn' : 'ok', text });
      setPending(null);
    } catch (err: any) {
      setMsg({ type: 'err', text: `Не удалось восстановить: ${err?.message || err}` });
    } finally {
      setBusy(null);
    }
  };

  const pendingEvents = pending ? countEvents(pending.loaded.manifest.schedule) : 0;
  const pendingFiles = pending ? pending.loaded.manifest.media.filter((m) => m.file).length : 0;
  const pendingNoFile = pending ? pending.loaded.manifest.media.length - pendingFiles : 0;

  return (
    <div className="space-y-5">
      <Card title="Как записать на вызов">
        <ol className="space-y-2.5">
          <Step n={1}>Откройте вкладку «Запись на вызов» и выберите дату: стрелками, кнопкой «Сегодня» или календарём.</Step>
          <Step n={2}>Укажите время начала и окончания и вид праздника: «Дети» или «Взрослые». При желании добавьте комментарий (адрес, имя, пожелания).</Step>
          <Step n={3}>Нажмите «Добавить». Запись появится на шкале дня и в списке мероприятий.</Step>
          <Step n={4}>Чтобы удалить запись, нажмите корзину в списке мероприятий внизу и подтвердите удаление. Цветные блоки на шкале дня только показывают время и ничего не удаляют.</Step>
        </ol>
      </Card>

      <Card title="Фото и видео">
        <ol className="space-y-2.5">
          <Step n={1}>Откройте вкладку «Фото и видео» и перетащите файлы в рамку или нажмите на неё, чтобы выбрать.</Step>
          <Step n={2}>Под каждым снимком есть поле «Подпись». Введите текст, он сохранится сам и появится на всех устройствах.</Step>
          <Step n={3}>Нажмите на снимок, чтобы открыть его на весь экран. Стрелками можно листать, значок корзины удаляет файл (он исчезнет и на других устройствах).</Step>
        </ol>
      </Card>

      <Card title="Синхронизация">
        <p className="text-sm text-slate-700 leading-relaxed">
          Всё синхронизируется автоматически, вводить коды не нужно. Откройте сайт на любом компьютере или телефоне, и
          мероприятия и файлы появятся сами (обновление идёт примерно раз в 20 секунд). Новые фото и видео сначала
          сохраняются на вашем устройстве, а затем загружаются в облако: ход загрузки виден в цветной полосе над галереей.
          На других устройствах файл появится, когда загрузка завершится.
        </p>
      </Card>

      <Card title="Резервная копия">
        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
          Копия — это один файл со всеми мероприятиями, фото, видео и подписями. Храните его в надёжном месте. Из него
          можно восстановить всё, если что-то удалили по ошибке.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button
            type="button"
            onClick={doBackup}
            disabled={busy !== null}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer transition-colors"
          >
            {busy === 'backup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Скачать копию
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeVideos}
              onChange={(e) => setIncludeVideos(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            Включить видео (файл может быть большим)
          </label>
        </div>
        {progress && <div className="text-xs text-slate-500 mb-2">{progress}</div>}

        <div className="border-t border-slate-200 my-4" />

        <input ref={fileRef} type="file" accept=".zip,.json,application/zip,application/json" className="hidden" onChange={onPickFile} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-sm font-semibold cursor-pointer transition-colors"
        >
          <Upload className="w-4 h-4" />
          Восстановить из копии…
        </button>

        {pending && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-slate-700 space-y-3">
            <div>
              <div className="font-semibold text-slate-900 break-all">{pending.name}</div>
              <div className="text-slate-600">
                В копии: мероприятий {pendingEvents}, фото и видео {pendingFiles}
                {pendingNoFile > 0 ? ` (ещё ${pendingNoFile} без файла: их восстановить нельзя)` : ''}.
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-1 accent-blue-600" />
                <span>
                  <b>Добавить к текущим</b> (рекомендуется): ничего не удаляется, добавляется только то, чего ещё нет.
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1 accent-blue-600" />
                <span>
                  <b>Заменить мероприятия</b> мероприятиями из копии (текущие мероприятия будут заменены).
                </span>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={doRestore}
                disabled={busy !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold cursor-pointer"
              >
                {busy === 'restore' && <Loader2 className="w-4 h-4 animate-spin" />}
                Восстановить
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={busy !== null}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {msg && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
              msg.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : msg.type === 'warn'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {msg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span className="break-words">{msg.text}</span>
          </div>
        )}
      </Card>
    </div>
  );
};
