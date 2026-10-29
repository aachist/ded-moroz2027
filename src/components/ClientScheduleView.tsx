import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScheduleEvent } from '../types';
import { ACTIVITY_TYPES, SELECTABLE_TYPES } from '../constants/types';
import { Timeline } from './Timeline';
import {
  BusyMap,
  Booking,
  fetchAvailability,
  createBooking,
  loadMyBookings,
  saveMyBookings,
  freeWindows,
  toMinutes,
  fromMinutes,
} from '../utils/bookings';
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, AlertTriangle, Send } from 'lucide-react';

interface Props {
  syncCode: string;
}

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const HORIZON_DAYS = 120; // на сколько дней вперёд показываем занятость

export const ClientScheduleView: React.FC<Props> = ({ syncCode }) => {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [windowStart, setWindowStart] = useState<Date>(today);

  const [busy, setBusy] = useState<BusyMap | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [myBookings, setMyBookings] = useState<Booking[]>(() => loadMyBookings());

  const [type, setType] = useState<'kids' | 'adults'>('kids');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState(''); // ловушка для ботов
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const selectedKey = keyOf(selectedDate);

  // Окно из 7 дней следует за выбранной датой
  const windowEnd = addDays(windowStart, 6);
  useEffect(() => {
    const sel = startOfDay(selectedDate);
    if (sel < windowStart) setWindowStart(sel);
    else if (sel > windowEnd) setWindowStart(addDays(sel, -6));
  }, [selectedDate]);

  const days: Date[] = Array.from({ length: 7 }, (_, i) => addDays(windowStart, i));

  const loadBusy = useCallback(async () => {
    const from = keyOf(startOfDay(new Date()));
    const to = keyOf(addDays(startOfDay(new Date()), HORIZON_DAYS));
    const data = await fetchAvailability(syncCode, from, to);
    if (!data) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setBusy(data);

    // Свои заявки, которых больше нет на сервере (например, отклонены администратором), убираем из списка
    setMyBookings((prev) => {
      const next = prev.filter((b) => {
        if (b.date < from || b.date > to) return b.date >= from; // за горизонтом — оставляем
        return (data[b.date] || []).some((s) => s.id === b.id);
      });
      if (next.length !== prev.length) saveMyBookings(next);
      return next.length !== prev.length ? next : prev;
    });
  }, [syncCode]);

  useEffect(() => {
    loadBusy();
    const t = setInterval(loadBusy, 30000);
    return () => clearInterval(t);
  }, [loadBusy]);

  const daySlots = busy?.[selectedKey] || [];
  const myIds = useMemo(() => new Set(myBookings.map((b) => b.id)), [myBookings]);

  // Для шкалы: чужое — безымянное «Занято», своё — цветом с пометкой
  const timelineEvents: ScheduleEvent[] = daySlots.map((s, i) => {
    const mine = s.id ? myBookings.find((b) => b.id === s.id) : undefined;
    return mine
      ? { id: `m${i}`, start: s.start, end: s.end, type: mine.type, note: 'Ваша заявка' }
      : { id: `b${i}`, start: s.start, end: s.end, type: 'busy' };
  });

  // Подсказки: свободные окна (если сегодня — только после текущего времени)
  const now = new Date();
  const isToday = selectedKey === keyOf(now);
  const earliest = isToday ? Math.ceil((now.getHours() * 60 + now.getMinutes() + 30) / 15) * 15 : 8 * 60;
  const free = busy
    ? freeWindows(daySlots, Math.max(8 * 60, earliest), 22 * 60, 30)
    : [];

  const pickWindow = (w: { start: string; end: string }) => {
    setStart(w.start);
    setEnd(fromMinutes(Math.min(toMinutes(w.end), toMinutes(w.start) + 60)));
    setMessage(null);
  };

  const validate = (): string | null => {
    if (!start || !end) return 'Укажите время начала и окончания.';
    const s = toMinutes(start);
    const e = toMinutes(end);
    if (e - s < 15) return 'Время окончания должно быть позже начала (минимум 15 минут).';
    if (e - s > 8 * 60) return 'Слишком длинный интервал (максимум 8 часов).';
    if (isToday && s <= now.getHours() * 60 + now.getMinutes()) return 'Это время уже прошло. Выберите позже.';
    if (daySlots.some((x) => s < (x.end === '24:00' ? 1440 : toMinutes(x.end)) && toMinutes(x.start) < e)) {
      return 'Это время занято (серые блоки на шкале). Выберите свободное.';
    }
    if (name.trim().length < 2) return 'Укажите ваше имя.';
    if ((phone.match(/\d/g) || []).length < 6) return 'Укажите телефон, чтобы мы могли связаться.';
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const problem = validate();
    if (problem) {
      setMessage({ type: 'err', text: problem });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await createBooking(syncCode, {
      date: selectedKey,
      start,
      end,
      type,
      name: name.trim(),
      phone: phone.trim(),
      note: note.trim() || undefined,
      website,
    });
    setSubmitting(false);

    if (result.ok) {
      const list = [...myBookings, result.booking];
      setMyBookings(list);
      saveMyBookings(list);
      setStart('');
      setEnd('');
      setNote('');
      setMessage({
        type: 'ok',
        text: `Заявка принята: ${selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${result.booking.start}–${result.booking.end}. Мы свяжемся с вами по указанному телефону.`,
      });
    } else {
      setMessage({ type: 'err', text: result.message });
    }
    loadBusy(); // обновляем занятость (в том числе при конфликте)
  };

  const typeBtn = (key: string, label: string, color: string) => {
    const active = type === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setType(key as 'kids' | 'adults')}
        className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all cursor-pointer ${
          active ? 'text-white shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
        }`}
        style={active ? { backgroundColor: color, borderColor: color } : undefined}
      >
        {label}
      </button>
    );
  };

  const upcomingMine = [...myBookings]
    .filter((b) => b.date >= keyOf(today))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  const inputCls =
    'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

  return (
    <div className="space-y-6">
      <div className="bg-white/80 border border-slate-200/80 rounded-2xl p-4 text-sm text-slate-600 leading-relaxed">
        Выберите день, посмотрите свободное время на шкале и оставьте заявку. Серым отмечено занятое время, на него записаться
        нельзя.
      </div>

      {/* Выбор даты */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold text-slate-700">
            {days[0].toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} —{' '}
            {days[6].toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <input
            type="date"
            min={keyOf(today)}
            value={selectedKey}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split('-').map(Number);
              if (y && m && d) {
                const picked = new Date(y, m - 1, d);
                if (picked >= today) setSelectedDate(picked);
              }
            }}
            className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            title="Перейти к дате"
          />
        </div>

        <div className="flex items-stretch gap-2">
          <button
            type="button"
            disabled={windowStart <= today}
            onClick={() => setWindowStart(addDays(windowStart, -7) < today ? today : addDays(windowStart, -7))}
            className="px-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            title="Предыдущая неделя"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const k = keyOf(d);
              const active = k === selectedKey;
              const count = busy?.[k]?.length || 0;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={`rounded-xl py-2 text-center border transition-all cursor-pointer ${
                    active
                      ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-[10px] uppercase opacity-70">
                    {d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '')}
                  </span>
                  <span className="block text-xl font-bold leading-tight">{d.getDate()}</span>
                  <span className="block text-[10px] opacity-70">
                    {d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}
                  </span>
                  <span className={`hidden sm:block text-[9px] mt-0.5 ${active ? 'text-white/80' : 'text-slate-400'}`}>
                    {busy ? (count ? `занято: ${count}` : 'свободно') : ' '}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setWindowStart(addDays(windowStart, 7))}
            className="px-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
            title="Следующая неделя"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          Не удалось загрузить занятое время. Проверьте интернет: без этого записаться нельзя.
        </div>
      )}

      {/* Шкала дня: чужое — только «Занято» */}
      <Timeline events={timelineEvents} selectedDate={selectedDate} hint="Серое — занято" />

      {/* Форма заявки */}
      <form onSubmit={submit} className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs space-y-4">
        <h3 className="font-bold text-slate-900">
          Заявка на {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
        </h3>

        {busy && (
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1.5">Свободное время (нажмите, чтобы подставить)</div>
            {free.length === 0 ? (
              <div className="text-sm text-slate-400">На этот день свободного времени нет. Выберите другой день.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {free.map((w) => (
                  <button
                    key={w.start + w.end}
                    type="button"
                    onClick={() => pickWindow(w)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 cursor-pointer"
                  >
                    {w.start} – {w.end}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1.5">Вид праздника</div>
          <div className="flex gap-2">{SELECTABLE_TYPES.map(([k, cfg]) => typeBtn(k, cfg.name, cfg.color))}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Начало</span>
            <input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Окончание</span>
            <input type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </label>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Ваше имя</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="Как к вам обращаться"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Телефон</span>
            <input
              type="tel"
              value={phone}
              maxLength={30}
              autoComplete="tel"
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
              placeholder="+7 900 000-00-00"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Адрес, имя ребёнка, пожелания (необязательно)</span>
          <textarea
            value={note}
            maxLength={500}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            className={inputCls}
            placeholder="Например: ул. Ленина 5, кв. 12, Маша 6 лет, любит рисовать"
          />
        </label>

        {/* Ловушка для ботов: человек это поле не видит */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>
            Сайт
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        {message && (
          <div
            className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
              message.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {message.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span className="break-words">{message.text}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !busy}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold cursor-pointer transition-colors"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Отправить заявку
        </button>
      </form>

      {/* Свои заявки (только на этом устройстве) */}
      {upcomingMine.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
          <h3 className="font-bold text-slate-900 mb-3">Ваши заявки</h3>
          <div className="space-y-2">
            {upcomingMine.map((b) => {
              const cfg = ACTIVITY_TYPES[b.type] || ACTIVITY_TYPES.other;
              return (
                <div key={b.id} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <span className="w-1.5 self-stretch rounded-full" style={{ backgroundColor: cfg.color }} />
                  <div className="text-sm text-slate-700 min-w-0">
                    <div className="font-semibold">
                      {new Date(b.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })},{' '}
                      <span className="font-mono">
                        {b.start}–{b.end}
                      </span>{' '}
                      <span className="font-normal text-slate-500">· {cfg.name}</span>
                    </div>
                    {b.note && <div className="text-xs text-slate-500 break-words">{b.note}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Список хранится только на этом устройстве. Чтобы изменить или отменить заявку, свяжитесь с нами.
          </p>
        </div>
      )}
    </div>
  );
};
