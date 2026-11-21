import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import {
  DAY_NAMES,
  DEFAULT_HOURS,
  HoursException,
  HoursRules,
  WEEK_ORDER,
  describeWindow,
  fetchHours,
  hourLabel,
  saveHours,
  weekdayOf,
  windowFor,
} from '../utils/hours';
import { Booking, fetchBookings } from '../utils/bookings';
import { fetchMediaList, generateMissingPreviews } from '../utils/storage';

interface Props {
  syncCode: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const prettyDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};
const SHORT_DAY: Record<number, string> = { 0: 'вс', 1: 'пн', 2: 'вт', 3: 'ср', 4: 'чт', 5: 'пт', 6: 'сб' };

const card = 'bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-xs';
const selectCls =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400';
const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

/** Будущие заявки (не отклонённые), которые не попадают в часы работы. Их никто не отменяет, администратор решает сам. */
const outsideHours = (bookings: Booking[], rules: HoursRules): Booking[] => {
  const today = todayKey();
  return bookings.filter((b) => {
    if (b.date < today || b.status === 'declined' || b.status === 'cancelled') return false;
    const w = windowFor(rules, b.date);
    if (!w) return true;
    const s = Number(b.start.slice(0, 2)) * 60 + Number(b.start.slice(3, 5));
    const e = b.end === '24:00' ? 1440 : Number(b.end.slice(0, 2)) * 60 + Number(b.end.slice(3, 5));
    return s < w.open * 60 || e > w.close * 60;
  });
};

export const SettingsView: React.FC<Props> = ({ syncCode }) => {
  const [rules, setRules] = useState<HoursRules | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [affected, setAffected] = useState<Booking[]>([]);

  // Превью фото для старых загрузок
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const runPreviews = async () => {
    if (previewBusy) return;
    setPreviewBusy(true);
    setPreviewMsg({ type: 'ok', text: 'Ищем фото без превью…' });
    try {
      const items = await fetchMediaList(syncCode);
      const res = await generateMissingPreviews(syncCode, items, (done, total) =>
        setPreviewMsg({ type: 'ok', text: `Создаём превью: ${done} из ${total}…` })
      );
      if (res.total === 0) {
        setPreviewMsg({ type: 'ok', text: 'Все фото уже с превью, делать ничего не нужно.' });
      } else if (res.failed === 0) {
        setPreviewMsg({ type: 'ok', text: `Готово: превью созданы для ${res.done} фото. Обновите страницу «Фото и видео».` });
      } else {
        setPreviewMsg({
          type: 'err',
          text: `Создано ${res.done} из ${res.total}, не получилось: ${res.failed}. Проверьте интернет и нажмите кнопку ещё раз: готовые превью пропускаются.`,
        });
      }
    } catch {
      setPreviewMsg({ type: 'err', text: 'Не удалось создать превью. Проверьте интернет и войдите как администратор.' });
    } finally {
      setPreviewBusy(false);
    }
  };

  // Форма добавления исключения
  const [exDate, setExDate] = useState('');
  const [exMode, setExMode] = useState<'closed' | 'hours'>('closed');
  const [exOpen, setExOpen] = useState(10);
  const [exClose, setExClose] = useState(20);
  const [exNote, setExNote] = useState('');

  const load = async () => {
    setLoadFailed(false);
    const r = await fetchHours(syncCode);
    if (!r) {
      setLoadFailed(true);
      return;
    }
    // Прошедшие даты не нужны: при следующем сохранении они уйдут из списка
    const today = todayKey();
    setRules({ weekly: r.weekly, exceptions: r.exceptions.filter((x) => x.date >= today) });
    setDirty(false);
  };

  useEffect(() => {
    load();
  }, [syncCode]);

  const change = (next: HoursRules) => {
    setRules(next);
    setDirty(true);
    setMessage(null);
  };

  const setDay = (dow: number, value: { open: number; close: number } | null) => {
    if (!rules) return;
    const weekly = rules.weekly.slice();
    weekly[dow] = value;
    change({ ...rules, weekly });
  };

  const setOpen = (dow: number, open: number) => {
    const w = rules?.weekly[dow];
    if (!w) return;
    setDay(dow, { open, close: Math.max(w.close, open + 1) });
  };
  const setClose = (dow: number, close: number) => {
    const w = rules?.weekly[dow];
    if (!w) return;
    setDay(dow, { open: Math.min(w.open, close - 1), close });
  };

  const copyMondayToAll = () => {
    if (!rules) return;
    const mon = rules.weekly[1];
    change({ ...rules, weekly: Array.from({ length: 7 }, () => (mon ? { ...mon } : null)) });
  };

  const addException = () => {
    if (!rules) return;
    if (!exDate) {
      setMessage({ type: 'err', text: 'Выберите дату.' });
      return;
    }
    if (exDate < todayKey()) {
      setMessage({ type: 'err', text: 'Эта дата уже прошла.' });
      return;
    }
    if (exMode === 'hours' && exClose <= exOpen) {
      setMessage({ type: 'err', text: 'Время окончания должно быть позже начала.' });
      return;
    }
    const note = exNote.trim().slice(0, 80);
    const item: HoursException =
      exMode === 'closed'
        ? { date: exDate, closed: true, ...(note ? { note } : {}) }
        : { date: exDate, closed: false, open: exOpen, close: exClose, ...(note ? { note } : {}) };
    const exceptions = [...rules.exceptions.filter((x) => x.date !== exDate), item].sort((a, b) => a.date.localeCompare(b.date));
    change({ ...rules, exceptions });
    setExDate('');
    setExNote('');
  };

  const removeException = (date: string) => {
    if (!rules) return;
    change({ ...rules, exceptions: rules.exceptions.filter((x) => x.date !== date) });
  };

  const save = async () => {
    if (!rules || saving) return;
    setSaving(true);
    setMessage(null);
    const err = await saveHours(syncCode, rules);
    setSaving(false);
    if (err) {
      setMessage({ type: 'err', text: err });
      return;
    }
    setDirty(false);
    setMessage({ type: 'ok', text: 'Сохранено. Клиенты увидят новые часы сразу.' });
    // Заявки не отменяются автоматически: показываем те, что теперь вне часов, чтобы вы решили по ним сами
    const list = await fetchBookings(syncCode);
    setAffected(list ? outsideHours(list, rules) : []);
  };

  if (loadFailed) {
    return (
      <div className={card}>
        <p className="text-sm text-slate-700">Не удалось загрузить настройки. Проверьте интернет.</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (!rules) {
    return (
      <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Загрузка…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="font-bold text-slate-900">Часы работы по дням недели</h3>
        <p className="text-sm text-slate-600 mt-1 mb-4">
          В эти часы клиенты могут записаться на сайте. Вне этих часов плитки серые («не работаем»). Время задаётся
          целыми часами. Пока вы ничего не настроили, запись открыта круглые сутки.
        </p>

        <div className="space-y-2">
          {WEEK_ORDER.map((dow) => {
            const w = rules.weekly[dow];
            return (
              <div key={dow} className="flex items-center gap-2 sm:gap-3 flex-wrap rounded-xl border border-slate-200 px-3 py-2">
                <label className="flex items-center gap-2 w-40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!w}
                    onChange={(e) => setDay(dow, e.target.checked ? { open: 10, close: 20 } : null)}
                    className="w-4 h-4"
                  />
                  <span className={`text-sm font-semibold ${w ? 'text-slate-900' : 'text-slate-400'}`}>{DAY_NAMES[dow]}</span>
                </label>
                {w ? (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    с
                    <select value={w.open} onChange={(e) => setOpen(dow, Number(e.target.value))} className={selectCls} aria-label={`${DAY_NAMES[dow]}: начало`}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{hourLabel(h)}</option>
                      ))}
                    </select>
                    до
                    <select value={w.close} onChange={(e) => setClose(dow, Number(e.target.value))} className={selectCls} aria-label={`${DAY_NAMES[dow]}: окончание`}>
                      {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                        <option key={h} value={h}>{hourLabel(h)}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <span className="text-sm text-slate-400">не работаем</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={copyMondayToAll}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Как в понедельник для всех дней
          </button>
          <button
            type="button"
            onClick={() => change({ ...rules, weekly: DEFAULT_HOURS.weekly.map((w) => (w ? { ...w } : null)) })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Открыто круглые сутки
          </button>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-bold text-slate-900">Закрытые даты и особые часы</h3>
        <p className="text-sm text-slate-600 mt-1 mb-4">
          Для отдельной даты можно закрыть запись или задать свои часы. Это важнее недельных часов. Заметка (например,
          «Новый год») видна клиентам.
        </p>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Дата</span>
              <input type="date" value={exDate} min={todayKey()} onChange={(e) => setExDate(e.target.value)} className={inputCls + ' mt-1'} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Что сделать</span>
              <select value={exMode} onChange={(e) => setExMode(e.target.value as 'closed' | 'hours')} className={inputCls + ' mt-1'}>
                <option value="closed">Закрыть запись на весь день</option>
                <option value="hours">Особые часы</option>
              </select>
            </label>
          </div>

          {exMode === 'hours' && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              с
              <select value={exOpen} onChange={(e) => { const v = Number(e.target.value); setExOpen(v); if (exClose <= v) setExClose(v + 1); }} className={selectCls} aria-label="Особые часы: начало">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
              до
              <select value={exClose} onChange={(e) => setExClose(Number(e.target.value))} className={selectCls} aria-label="Особые часы: окончание">
                {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Заметка для клиентов (необязательно)</span>
            <input
              type="text"
              maxLength={80}
              value={exNote}
              onChange={(e) => setExNote(e.target.value)}
              placeholder="Например: Новый год, выходной"
              className={inputCls + ' mt-1'}
            />
          </label>

          <button
            type="button"
            onClick={addException}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            Добавить в список
          </button>
        </div>

        <div className="mt-4">
          {rules.exceptions.length === 0 ? (
            <p className="text-sm text-slate-400">Исключений нет.</p>
          ) : (
            <ul className="space-y-2">
              {rules.exceptions.map((x) => (
                <li key={x.date} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      {prettyDate(x.date)} <span className="font-normal text-slate-400">({SHORT_DAY[weekdayOf(x.date)]})</span>
                    </div>
                    <div className={`text-sm ${x.closed ? 'text-rose-600' : 'text-blue-700'}`}>
                      {x.closed ? 'запись закрыта' : describeWindow({ open: Number(x.open), close: Number(x.close) })}
                    </div>
                    {x.note && <div className="text-xs text-slate-500 break-words">{x.note}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeException(x.date)}
                    aria-label={`Удалить исключение ${x.date}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={card}>
        <h3 className="font-bold text-slate-900">Быстрые превью фото</h3>
        <p className="text-sm text-slate-600 mt-1 mb-3">
          Новые фото получают маленькое превью автоматически, и галерея открывается быстрее. Для фото, загруженных раньше,
          превью можно создать одной кнопкой. Сами фото не меняются и не удаляются. Страницу не закрывайте, пока идёт
          создание (при большом числе фото это может занять несколько минут).
        </p>
        <button
          type="button"
          onClick={runPreviews}
          disabled={previewBusy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 cursor-pointer flex items-center gap-2"
        >
          {previewBusy && <Loader2 className="w-4 h-4 animate-spin" />}
          Создать превью для старых фото
        </button>
        {previewMsg && (
          <p className={`mt-3 text-sm ${previewMsg.type === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{previewMsg.text}</p>
        )}
      </div>

      <div className={`${card} flex items-center gap-3 flex-wrap sticky bottom-20 sm:bottom-4 z-10`}>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Сохранить
        </button>
        {dirty && !saving && <span className="text-xs text-amber-700">Есть несохранённые изменения</span>}
        {message && (
          <span className={`text-sm flex items-center gap-1.5 ${message.type === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
            {message.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {message.text}
          </span>
        )}
      </div>

      {affected.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="w-4 h-4" />
            Есть заявки вне новых часов работы: {affected.length}
          </div>
          <p className="text-xs text-amber-900/80 mt-1 mb-2">
            Они не отменены. Решите по каждой сами: подтвердите, отклоните или свяжитесь с клиентом.
          </p>
          <ul className="text-sm text-amber-950 space-y-0.5">
            {affected.slice(0, 20).map((b) => (
              <li key={b.id}>
                {prettyDate(b.date)}, {b.start}–{b.end}: {b.name}, {b.phone}
              </li>
            ))}
          </ul>
          {affected.length > 20 && <p className="text-xs text-amber-900/70 mt-1">…и ещё {affected.length - 20}</p>}
        </div>
      )}
    </div>
  );
};
