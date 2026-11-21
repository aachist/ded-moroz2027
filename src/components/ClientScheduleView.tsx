import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVITY_TYPES, SELECTABLE_TYPES } from '../constants/types';
import {
  BusyMap,
  Booking,
  fetchAvailability,
  fetchBookingStatuses,
  statusLabel,
  createBooking,
  cancelBooking,
  lookupBooking,
  loadMyBookings,
  saveMyBookings,
  toMinutes,
} from '../utils/bookings';
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, AlertTriangle, Send, Clock } from 'lucide-react';
import { DEFAULT_HOURS, HoursRules, describeWindow, exceptionFor, fetchHours, windowFor } from '../utils/hours';
import { PhoneField } from './PhoneField';
import { fullPhone, isPhoneComplete } from '../utils/phone';

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
const MAX_HOURS = 8; // не больше стольких часов подряд в одной заявке (как на сервере)

type TileState = 'loading' | 'free' | 'busy' | 'closed' | 'past' | 'pending' | 'confirmed';
interface TileInfo {
  hour: number;
  state: TileState;
}

const TILE_LABEL: Record<TileState, string> = {
  loading: '…',
  free: 'свободно',
  busy: 'занято',
  closed: 'не работаем',
  past: 'прошло',
  pending: 'заявка подана',
  confirmed: 'заявка подтверждена',
};

const TILE_CLASS: Record<TileState | 'selected', string> = {
  loading: 'bg-slate-50 border-slate-200 text-slate-300 cursor-wait',
  free: 'bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50 hover:border-emerald-400 cursor-pointer',
  busy: 'bg-slate-200 border-slate-200 text-slate-400 cursor-not-allowed',
  closed: 'bg-slate-100 border-slate-200 border-dashed text-slate-400 cursor-not-allowed',
  past: 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed',
  pending: 'bg-amber-100 border-amber-400 border-dashed text-amber-900 cursor-default',
  confirmed: 'bg-emerald-100 border-emerald-500 text-emerald-900 cursor-default',
  selected: 'bg-blue-600 border-blue-600 text-white shadow-md cursor-pointer',
};

export const ClientScheduleView: React.FC<Props> = ({ syncCode }) => {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [windowStart, setWindowStart] = useState<Date>(today);

  const [busy, setBusy] = useState<BusyMap | null>(null);
  // Часы работы и закрытые даты; пока не загружены (или сервер не ответил), считаем «открыто всегда»: сервер всё равно проверит
  const [hoursRules, setHoursRules] = useState<HoursRules | null>(null);
  const hours = hoursRules ?? DEFAULT_HOURS;
  const [loadError, setLoadError] = useState(false);
  const [myBookings, setMyBookings] = useState<Booking[]>(() => loadMyBookings());

  const [type, setType] = useState<'kids' | 'adults'>('kids');
  // Выбранные часы: подряд идущие плитки с часа a по час b включительно
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(''); // только 10 национальных цифр, код +7 подставляется сам
  // Поиск заявки по телефону и номеру
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupNum, setLookupNum] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  // Отмена своей заявки: какая ждёт подтверждения «Да, отменить», идёт ли запрос, итог
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
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

  // На телефоне полоса дней прокручивается: выбранный день показываем по центру
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedKey]);

  const loadBusy = useCallback(async () => {
    const from = keyOf(startOfDay(new Date()));
    const to = keyOf(addDays(startOfDay(new Date()), HORIZON_DAYS));
    const data = await fetchAvailability(syncCode, from, to);
    const rules = await fetchHours(syncCode);
    if (rules) setHoursRules(rules);
    if (!data) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setBusy(data);

    // Статусы своих заявок (ждёт / подтверждена / отклонена); заявки, которых больше нет на сервере, убираем
    const mineNow = loadMyBookings().filter((b) => b.date >= from);
    const statuses = await fetchBookingStatuses(syncCode, mineNow.map((b) => b.id));
    if (statuses) {
      const next = mineNow.flatMap((b): Booking[] => {
        const st = statuses[b.id];
        if (st === undefined) return [b]; // сервер про эту заявку ничего не вернул — оставляем как есть
        if (st === null) return []; // удалена администратором
        return [{ ...b, status: st.status, reason: st.reason }];
      });
      saveMyBookings(next);
      setMyBookings(next);
    }
  }, [syncCode]);

  useEffect(() => {
    loadBusy();
    const t = setInterval(loadBusy, 30000);
    return () => clearInterval(t);
  }, [loadBusy]);

  const daySlots = busy?.[selectedKey] || [];

  // Свои заявки по id: на плитках они подписаны статусом, чужие — просто «занято»
  const myById = useMemo(() => new Map(myBookings.map((b) => [b.id, b])), [myBookings]);
  const myOnDay = myBookings.filter((b) => b.date === selectedKey && b.status !== 'declined' && b.status !== 'cancelled');

  const now = new Date();
  const isToday = selectedKey === keyOf(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Часы записи на выбранный день (null — день закрыт) и заметка владельца к исключению, если есть
  const dayWindow = windowFor(hours, selectedKey);
  const dayException = exceptionFor(hours, selectedKey);

  // 24 плитки по часу. Приоритет состояния: своя заявка → занято другой → прошло → свободно.
  // Час, в котором есть хоть одна чужая заявка (даже на 15 минут), занят целиком.
  const tiles: TileInfo[] = Array.from({ length: 24 }, (_, hour) => {
    const hs = hour * 60;
    const he = hs + 60;
    let mine: 'pending' | 'confirmed' | null = null;
    let other = false;
    for (const slot of daySlots) {
      const ss = toMinutes(slot.start);
      const se = slot.end === '24:00' ? 1440 : toMinutes(slot.end);
      if (!(ss < he && hs < se)) continue;
      const own = slot.id ? myById.get(slot.id) : undefined;
      if (own) {
        if (own.status === 'cancelled' || own.status === 'declined') continue; // уже освобождено, даже если занятость ещё не обновилась
        if (own.status === 'confirmed') mine = 'confirmed';
        else if (mine !== 'confirmed') mine = 'pending';
      } else {
        other = true;
      }
    }
    // Свои заявки на этот день учитываем и до очередного обновления занятости с сервера
    for (const own of myOnDay) {
      const ss = toMinutes(own.start);
      const se = own.end === '24:00' ? 1440 : toMinutes(own.end);
      if (!(ss < he && hs < se)) continue;
      if (own.status === 'confirmed') mine = 'confirmed';
      else if (mine !== 'confirmed') mine = 'pending';
    }
    if (mine) return { hour, state: mine };
    if (!busy) return { hour, state: 'loading' }; // пока не знаем, что занято, выбирать нельзя
    // Вне часов работы (или в закрытый день) записаться нельзя; час должен целиком попадать в рабочее время
    if (!dayWindow || hour < dayWindow.open || hour + 1 > dayWindow.close) return { hour, state: 'closed' };
    if (other) return { hour, state: 'busy' };
    if (isToday && hs <= nowMinutes) return { hour, state: 'past' };
    return { hour, state: 'free' };
  });
  const isFree = (h: number) => tiles[h]?.state === 'free';

  // Если занятость обновилась и выбранный час стал недоступен — сбрасываем выбор
  useEffect(() => {
    if (sel) {
      for (let h = sel.a; h <= sel.b; h++) {
        if (!isFree(h)) {
          setSel(null);
          return;
        }
      }
    }
  }, [busy, myBookings, hoursRules]);

  // Другой день — другой выбор
  useEffect(() => {
    setSel(null);
    setMessage(null);
  }, [selectedKey]);

  // Нажатие на свободную плитку: выбрать час; соседний час добавляется к выбору (до 8 часов подряд);
  // нажатие на крайний выбранный час снимает его.
  const toggleHour = (h: number) => {
    if (!isFree(h)) return;
    setMessage(null);
    if (!sel) {
      setSel({ a: h, b: h });
    } else if (h >= sel.a && h <= sel.b) {
      if (sel.a === sel.b) setSel(null);
      else if (h === sel.a) setSel({ a: sel.a + 1, b: sel.b });
      else if (h === sel.b) setSel({ a: sel.a, b: sel.b - 1 });
      else setSel({ a: h, b: h });
    } else if (h === sel.b + 1 || h === sel.a - 1) {
      const next = h > sel.b ? { a: sel.a, b: h } : { a: h, b: sel.b };
      if (next.b - next.a + 1 > MAX_HOURS) {
        setMessage({ type: 'err', text: `Можно выбрать не больше ${MAX_HOURS} часов подряд.` });
      } else {
        setSel(next);
      }
    } else {
      setSel({ a: h, b: h });
    }
  };

  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const start = sel ? hh(sel.a) : '';
  const end = sel ? (sel.b + 1 >= 24 ? '24:00' : hh(sel.b + 1)) : '';
  const selHours = sel ? sel.b - sel.a + 1 : 0;

  const validate = (): string | null => {
    if (!sel) return 'Выберите на плитках свободный час.';
    for (let h = sel.a; h <= sel.b; h++) {
      if (!isFree(h)) return 'Это время занято или уже прошло. Выберите свободный час.';
    }
    if (name.trim().length < 2) return 'Укажите ваше имя.';
    if (!isPhoneComplete(phone)) return 'Введите телефон: код +7 подставлен, нужно ещё 10 цифр (например, 900 111-22-33).';
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
      phone: fullPhone(phone),
      note: note.trim() || undefined,
      website,
    });
    setSubmitting(false);

    if (result.ok) {
      const list = [...myBookings, result.booking];
      setMyBookings(list);
      saveMyBookings(list);
      setSel(null);
      setNote('');
      const dateText = selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      setMessage({
        type: 'ok',
        text: result.booking.num
          ? `Заявка № ${result.booking.num} отправлена: ${dateText}, ${result.booking.start}–${result.booking.end}. Запомните или запишите номер ${result.booking.num}: по номеру телефона и этому номеру заявку можно найти на любом устройстве. Время за вами закреплено, пока мы её не подтвердим. Статус виден ниже в разделе «Ваши заявки», также мы свяжемся с вами по телефону.`
          : `Заявка отправлена: ${dateText}, ${result.booking.start}–${result.booking.end}. Время за вами закреплено, пока мы её не подтвердим. Статус виден ниже в разделе «Ваши заявки», также мы свяжемся с вами по телефону.`,
      });
    } else {
      setMessage({ type: 'err', text: result.message });
    }
    loadBusy(); // обновляем занятость (в том числе при конфликте)
  };

  // Отмена своей заявки по телефону и номеру (они хранятся в заявке на этом устройстве)
  const doCancel = async (b: Booking) => {
    if (cancelBusy || !b.num) return;
    setCancelBusy(true);
    setCancelMsg(null);
    const res = await cancelBooking(syncCode, b.phone, b.num);
    setCancelBusy(false);
    if (!res.ok) {
      setCancelTarget(null);
      setCancelMsg({ type: 'err', text: res.message });
      return;
    }
    const next = myBookings.map((x) => (x.id === b.id ? { ...x, status: 'cancelled' as const } : x));
    setMyBookings(next);
    saveMyBookings(next);
    setCancelTarget(null);
    setCancelMsg({ type: 'ok', text: `Заявка № ${b.num} отменена. Время освобождено, мы получили уведомление.` });
    loadBusy(); // плитки сразу обновятся
  };

  // Поиск заявки по телефону и номеру (на любом устройстве); найденная заявка добавляется в «Ваши заявки» этого устройства
  const findBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lookupBusy) return;
    if (!isPhoneComplete(lookupPhone)) {
      setLookupMsg({ type: 'err', text: 'Введите телефон: код +7 подставлен, нужно ещё 10 цифр.' });
      return;
    }
    if (!/^\d{5}$/.test(lookupNum)) {
      setLookupMsg({ type: 'err', text: 'Номер заявки состоит из 5 цифр.' });
      return;
    }
    setLookupBusy(true);
    setLookupMsg(null);
    const res = await lookupBooking(syncCode, fullPhone(lookupPhone), lookupNum);
    setLookupBusy(false);
    if (!res.ok) {
      setLookupMsg({ type: 'err', text: res.message });
      return;
    }
    const found = res.booking;
    const next = [...myBookings.filter((x) => x.id !== found.id), found];
    setMyBookings(next);
    saveMyBookings(next);
    const when = new Date(found.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const st = found.status || 'confirmed';
    setLookupMsg({
      type: 'ok',
      text: `Заявка № ${found.num || lookupNum} найдена: ${when}, ${found.start}–${found.end}. Статус: ${statusLabel(st).toLowerCase()}.${
        st === 'declined' && found.reason ? ` Причина: ${found.reason}.` : ''
      } Она добавлена в «Ваши заявки» на этом устройстве.`,
    });
    setLookupNum('');
    loadBusy(); // свои часы на плитках
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
        Выберите день, затем нажмите на свободный час: он подсветится. Чтобы записаться на несколько часов подряд, нажмите
        на соседние часы. Серым отмечено занятое время, на него записаться нельзя.
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
          <div ref={stripRef} className="day-strip flex-1 grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const k = keyOf(d);
              const active = k === selectedKey;
              const count = busy?.[k]?.length || 0;
              return (
                <button
                  key={k}
                  type="button"
                  data-active={active ? 'true' : undefined}
                  onClick={() => setSelectedDate(d)}
                  className={`day-chip rounded-xl py-2 text-center border transition-all cursor-pointer ${
                    active
                      ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-[0.625rem] uppercase opacity-70">
                    {d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '')}
                  </span>
                  <span className="block text-xl font-bold leading-tight">{d.getDate()}</span>
                  <span className="block text-[0.625rem] opacity-70">
                    {d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}
                  </span>
                  <span className={`block text-[0.5625rem] mt-0.5 ${active ? 'text-white/80' : 'text-slate-400'}`}>
                    {!windowFor(hours, k) ? 'закрыто' : busy ? (count ? `занято: ${count}` : 'свободно') : ' '}
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

      {/* 24 плитки по часу: нажмите на свободную, чтобы выбрать время */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            Время на {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
          </h3>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[0.6875rem] text-slate-500">
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm border border-emerald-300 bg-white" />свободно</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-200" />занято</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm border border-dashed border-slate-300 bg-slate-100" />не работаем</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm border border-dashed border-amber-400 bg-amber-100" />заявка подана</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm border border-emerald-500 bg-emerald-100" />заявка подтверждена</span>
          </div>
        </div>

        {/* Часы работы выбранного дня: закрыто / особые часы / заметка владельца */}
        {!dayWindow ? (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            <b>В этот день запись закрыта.</b> Выберите другой день.
            {dayException?.note && <span className="block text-xs text-slate-500 mt-0.5">{dayException.note}</span>}
          </div>
        ) : dayWindow.open !== 0 || dayWindow.close !== 24 || dayException?.note ? (
          <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-900">
            {(dayWindow.open !== 0 || dayWindow.close !== 24) && (
              <>Запись принимается {describeWindow(dayWindow)}.</>
            )}
            {dayException?.note && <span className="block text-blue-800/80">{dayException.note}</span>}
          </div>
        ) : null}

        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {tiles.map(({ hour, state }) => {
            const selected = !!sel && hour >= sel.a && hour <= sel.b;
            const label = selected ? 'выбрано' : TILE_LABEL[state];
            const range = `${hh(hour)}–${hour === 23 ? '24:00' : hh(hour + 1)}`;
            return (
              <button
                key={hour}
                type="button"
                disabled={state !== 'free'}
                aria-pressed={selected}
                aria-label={`${range}: ${label}`}
                onClick={() => toggleHour(hour)}
                className={`min-h-[64px] rounded-xl px-1 py-2 text-center leading-tight border transition-all ${
                  selected ? TILE_CLASS.selected : TILE_CLASS[state]
                }`}
              >
                <span className="block text-sm font-bold tabular-nums">{hh(hour)}</span>
                <span className="block text-[0.625rem] mt-0.5">{label}</span>
              </button>
            );
          })}
        </div>
        {!busy && !loadError && <p className="text-xs text-slate-400 mt-3">Загружаем занятое время…</p>}
      </div>

      {/* Форма заявки */}
      <form onSubmit={submit} className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs space-y-4">
        <h3 className="font-bold text-slate-900">
          Заявка на {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
        </h3>

        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            sel ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-slate-200 bg-slate-50 text-slate-500'
          }`}
        >
          {sel ? (
            <>
              Выбрано: <b>{start}–{end}</b> ({selHours} {selHours === 1 ? 'час' : selHours < 5 ? 'часа' : 'часов'}). Чтобы
              изменить, нажмите на другую плитку выше.
            </>
          ) : (
            'Нажмите на свободный час на плитках выше.'
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1.5">Вид праздника</div>
          <div className="flex gap-2">{SELECTABLE_TYPES.map(([k, cfg]) => typeBtn(k, cfg.name, cfg.color))}</div>
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
            <span className="text-xs font-semibold text-slate-500">Телефон (код +7 подставлен)</span>
            <PhoneField value={phone} onChange={setPhone} className="mt-1" name="phone" />
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
          {cancelMsg && (
            <div
              className={`mb-3 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
                cancelMsg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {cancelMsg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span className="break-words">{cancelMsg.text}</span>
            </div>
          )}
          <div className="space-y-2">
            {upcomingMine.map((b) => {
              const cfg = ACTIVITY_TYPES[b.type] || ACTIVITY_TYPES.other;
              const st = b.status || 'pending'; // только что созданная заявка ждёт подтверждения
              const badge =
                st === 'confirmed'
                  ? 'bg-emerald-100 text-emerald-800'
                  : st === 'declined'
                  ? 'bg-rose-100 text-rose-800'
                  : st === 'cancelled'
                  ? 'bg-slate-200 text-slate-700'
                  : 'bg-amber-100 text-amber-800';
              const canCancel = (st === 'pending' || st === 'confirmed') && !!b.num;
              return (
                <div
                  key={b.id}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
                    st === 'declined'
                      ? 'border-rose-100 bg-rose-50/60'
                      : st === 'cancelled'
                      ? 'border-slate-100 bg-slate-50 opacity-70'
                      : 'border-slate-100 bg-slate-50'
                  }`}
                >
                  <span className="w-1.5 self-stretch rounded-full" style={{ backgroundColor: cfg.color }} />
                  <div className="text-sm text-slate-700 min-w-0 flex-1">
                    <div className="font-semibold">
                      {new Date(b.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })},{' '}
                      <span className="font-mono">
                        {b.start}–{b.end}
                      </span>{' '}
                      <span className="font-normal text-slate-500">· {cfg.name}</span>
                      {b.num && <span className="font-normal text-slate-500"> · № {b.num}</span>}
                    </div>
                    <span className={`inline-block mt-1 text-[0.6875rem] font-bold rounded-full px-2.5 py-0.5 ${badge}`}>
                      {st === 'pending' ? '⏳ ' : st === 'confirmed' ? '✅ ' : st === 'cancelled' ? '🚫 ' : '✖ '}
                      {statusLabel(st)}
                    </span>
                    {st === 'declined' && (
                      <div className="text-xs text-rose-700 mt-1 break-words">
                        {b.reason ? `Причина: ${b.reason}. ` : ''}К сожалению, это время не подошло. Выберите другое или позвоните нам.
                      </div>
                    )}
                    {st === 'cancelled' && (
                      <div className="text-xs text-slate-500 mt-1">Заявка отменена, время освобождено.</div>
                    )}
                    {b.note && <div className="text-xs text-slate-500 break-words mt-1">{b.note}</div>}

                    {/* Отмена заявки: сначала просим подтвердить, чтобы случайно не отменить */}
                    {(st === 'pending' || st === 'confirmed') &&
                      (canCancel ? (
                        cancelTarget === b.id ? (
                          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                            <div className="text-xs text-rose-900 font-semibold">
                              Отменить заявку № {b.num}? Время освободится, мы получим уведомление.
                            </div>
                            <div className="flex gap-2 mt-2">
                              <button
                                type="button"
                                disabled={cancelBusy}
                                onClick={() => doCancel(b)}
                                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5"
                              >
                                {cancelBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                                Да, отменить
                              </button>
                              <button
                                type="button"
                                disabled={cancelBusy}
                                onClick={() => setCancelTarget(null)}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold cursor-pointer"
                              >
                                Нет, оставить
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelTarget(b.id);
                              setCancelMsg(null);
                            }}
                            className="mt-2 text-xs font-semibold text-rose-700 hover:text-rose-800 underline cursor-pointer"
                          >
                            Отменить заявку
                          </button>
                        )
                      ) : (
                        <div className="text-xs text-slate-400 mt-1.5">Чтобы отменить эту заявку, позвоните нам.</div>
                      ))}
                  </div>
                  {(st === 'declined' || st === 'cancelled') && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = myBookings.filter((x) => x.id !== b.id);
                        setMyBookings(next);
                        saveMyBookings(next);
                      }}
                      className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer px-2 py-1 shrink-0"
                      title="Убрать из списка"
                    >
                      Убрать
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Статус обновляется сам. Если вы сменили телефон или открыли сайт на другом устройстве, найдите заявку по
            номеру телефона и номеру заявки ниже. Чтобы изменить или отменить заявку, свяжитесь с нами.
          </p>
        </div>
      )}

      {/* Поиск заявки на любом устройстве: телефон + номер из 5 цифр */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
        <h3 className="font-bold text-slate-900">Найти свою заявку</h3>
        <p className="text-sm text-slate-600 mt-1 mb-3">
          Введите телефон, который вы указывали, и номер заявки из 5 цифр. Номер вы получили после отправки заявки.
        </p>
        <form onSubmit={findBooking} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Телефон (код +7 подставлен)</span>
              <PhoneField value={lookupPhone} onChange={setLookupPhone} className="mt-1" name="lookup-phone" ariaLabel="Телефон из заявки" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Номер заявки (5 цифр)</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={5}
                value={lookupNum}
                onChange={(e) => setLookupNum(e.target.value.replace(/\D/g, '').slice(0, 5))}
                className={inputCls + ' mt-1'}
                placeholder="12345"
                aria-label="Номер заявки, 5 цифр"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={lookupBusy}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
          >
            {lookupBusy && <Loader2 className="w-4 h-4 animate-spin" />}
            Найти заявку
          </button>
        </form>

        {lookupMsg && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
              lookupMsg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {lookupMsg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span className="break-words">{lookupMsg.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};
