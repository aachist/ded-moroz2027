import React, { useState } from 'react';
import { DaySchedule, ScheduleEvent } from '../types';
import { ACTIVITY_TYPES } from '../constants/types';
import { Timeline } from './Timeline';
import { Plus, Trash2, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, PieChart } from 'lucide-react';

interface ScheduleViewProps {
  schedule: DaySchedule;
  onUpdateSchedule: (newSchedule: DaySchedule) => void;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  schedule,
  onUpdateSchedule,
  selectedDate,
  setSelectedDate,
}) => {
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [selectedType, setSelectedType] = useState('work');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'warn' | 'err' } | null>(null);

  // Generate 7 days starting from 1 day before today or rolling from current week
  const daysList: Date[] = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    daysList.push(d);
  }

  const selectedKey = formatDateKey(selectedDate);
  const currentEvents: ScheduleEvent[] = schedule[selectedKey] || [];

  const showMsg = (text: string, type: 'ok' | 'warn' | 'err') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    let end = endTime;
    if (end === '00:00') end = '24:00';

    const startMin = toMinutes(startTime);
    let endMin = toMinutes(end);
    if (end === '24:00') endMin = 1440;

    if (endMin <= startMin) {
      showMsg('Ошибка: время окончания должно быть позже начала', 'err');
      return;
    }

    // Check overlaps
    const hasOverlap = currentEvents.some((evt) => {
      let eEnd = toMinutes(evt.end);
      if (evt.end === '24:00') eEnd = 1440;
      const eStart = toMinutes(evt.start);
      return startMin < eEnd && endMin > eStart;
    });

    const newEvent: ScheduleEvent = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      start: startTime,
      end: end,
      type: selectedType,
      note: note.trim() || undefined,
    };

    const updated = {
      ...schedule,
      [selectedKey]: [...currentEvents, newEvent],
    };

    onUpdateSchedule(updated);
    setNote('');

    if (hasOverlap) {
      showMsg('Занятие добавлено, но время пересекается с другим планом', 'warn');
    } else {
      showMsg('Занятие успешно добавлено в расписание ✔', 'ok');
    }
  };

  const handleDeleteEvent = (id: string) => {
    const remaining = currentEvents.filter((e) => e.id !== id);
    const updated = { ...schedule };
    if (remaining.length === 0) {
      delete updated[selectedKey];
    } else {
      updated[selectedKey] = remaining;
    }
    onUpdateSchedule(updated);
    showMsg('Занятие удалено', 'ok');
  };

  const handleClearDay = () => {
    if (!currentEvents.length) {
      showMsg('Этот день и так свободен', 'warn');
      return;
    }
    if (window.confirm('Очистить все занятия на этот выбранный день?')) {
      const updated = { ...schedule };
      delete updated[selectedKey];
      onUpdateSchedule(updated);
      showMsg('Все занятия на этот день удалены', 'ok');
    }
  };

  // Calculate day stats
  const totalMinutes = currentEvents.reduce((acc, evt) => {
    let eEnd = toMinutes(evt.end);
    if (evt.end === '24:00') eEnd = 1440;
    const eStart = toMinutes(evt.start);
    return acc + Math.max(0, eEnd - eStart);
  }, 0);
  const totalHours = (totalMinutes / 60).toFixed(1);

  return (
    <div className="space-y-6">
      {/* 7-Days Selector */}
      <div className="flex items-center justify-between gap-1 sm:gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => {
            const prev = new Date(selectedDate);
            prev.setDate(prev.getDate() - 1);
            setSelectedDate(prev);
          }}
          className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors shrink-0 cursor-pointer"
          title="Предыдущий день"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex gap-2 flex-1 justify-center min-w-0">
          {daysList.map((d) => {
            const key = formatDateKey(d);
            const isSelected = key === selectedKey;
            const hasEvents = (schedule[key] || []).length > 0;
            const isToday = formatDateKey(new Date()) === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDate(d)}
                className={`relative px-3 py-2.5 rounded-2xl border text-center transition-all min-w-[64px] sm:min-w-[80px] cursor-pointer ${
                  isSelected
                    ? 'border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-500/25 scale-[1.02]'
                    : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                }`}
              >
                <span className="block text-[11px] uppercase font-semibold opacity-75">
                  {d.toLocaleDateString('ru-RU', { weekday: 'short' })}
                </span>
                <span className="block text-xl font-bold leading-tight">{d.getDate()}</span>
                {isToday && (
                  <span
                    className={`block text-[9px] font-bold ${
                      isSelected ? 'text-blue-100' : 'text-blue-600'
                    }`}
                  >
                    Сегодня
                  </span>
                )}
                {hasEvents && (
                  <span
                    className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                      isSelected ? 'bg-emerald-300 ring-2 ring-blue-600' : 'bg-emerald-500'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => {
            const next = new Date(selectedDate);
            next.setDate(next.getDate() + 1);
            setSelectedDate(next);
          }}
          className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors shrink-0 cursor-pointer"
          title="Следующий день"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Add Event Form Card */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 capitalize">
            {selectedDate.toLocaleDateString('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h2>
          {totalMinutes > 0 && (
            <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 border border-blue-100">
              <PieChart className="w-3.5 h-3.5" />
              Занято: {totalHours} ч.
            </span>
          )}
        </div>

        <form onSubmit={handleAddEvent} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">Начало</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">Конец</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs font-semibold text-slate-500">Вид занятости</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-700 cursor-pointer"
            >
              {Object.entries(ACTIVITY_TYPES).map(([k, cfg]) => (
                <option key={k} value={k}>
                  {cfg.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[170px]">
            <label className="text-xs font-semibold text-slate-500">Комментарий (необязательно)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: лекция, бассейн, отчёт"
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex gap-2 w-full sm:w-auto pt-1">
            <button
              type="submit"
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить</span>
            </button>
            <button
              type="button"
              onClick={handleClearDay}
              className="px-3 py-2.5 rounded-xl text-sm font-semibold text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all cursor-pointer"
              title="Очистить все занятия на выбранный день"
            >
              Очистить день
            </button>
          </div>
        </form>

        {/* Status Message */}
        {message && (
          <div
            className={`mt-4 p-3 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 transition-all ${
              message.type === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : message.type === 'warn'
                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {message.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
            )}
            <span>{message.text}</span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 py-1">
        {Object.entries(ACTIVITY_TYPES).map(([k, cfg]) => (
          <div
            key={k}
            className="flex items-center gap-1.5 text-xs text-slate-600 font-medium px-2 py-1 rounded-lg bg-white/60 border border-slate-200/60 shadow-2xs"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: cfg.color }}
            />
            <span>{cfg.name}</span>
          </div>
        ))}
      </div>

      {/* Interactive Visual Timeline */}
      <Timeline
        events={currentEvents}
        selectedDate={selectedDate}
        onDeleteEvent={handleDeleteEvent}
      />

      {/* List of Events */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
        <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-3">
          Список занятий на {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
        </h3>

        {currentEvents.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            На этот день пока нет занятий — добавьте первое через форму выше 🙂
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {[...currentEvents]
              .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
              .map((evt) => {
                const cfg = ACTIVITY_TYPES[evt.type] || ACTIVITY_TYPES.other;
                return (
                  <div
                    key={evt.id}
                    className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 px-2 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-3.5 h-3.5 rounded-md shrink-0 shadow-2xs"
                        style={{ backgroundColor: cfg.color }}
                      />
                      <span className="font-mono font-bold text-slate-800 text-sm whitespace-nowrap">
                        {evt.start} – {evt.end}
                      </span>
                      <span className="font-semibold text-slate-700 text-sm truncate">
                        {cfg.name}
                      </span>
                      {evt.note && (
                        <span className="text-xs text-slate-400 truncate hidden sm:inline">
                          — {evt.note}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteEvent(evt.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                      title="Удалить занятие"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};
