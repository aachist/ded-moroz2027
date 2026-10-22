import React, { useEffect, useRef } from 'react';
import { ScheduleEvent } from '../types';
import { ACTIVITY_TYPES } from '../constants/types';
import { Clock } from 'lucide-react';

interface TimelineProps {
  events: ScheduleEvent[];
  selectedDate: Date;
}

function timeToMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export const Timeline: React.FC<TimelineProps> = ({ events, selectedDate }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const isToday = isSameDay(selectedDate, now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Scroll to 08:00 or current hour on mount/date change
  useEffect(() => {
    if (scrollContainerRef.current) {
      const targetHour = isToday ? Math.max(0, now.getHours() - 1) : 8;
      // 48px per hour
      scrollContainerRef.current.scrollTop = targetHour * 48;
    }
  }, [selectedDate]);

  // Compute non-overlapping columns for layout
  const sorted = [...events].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const colEnd: number[] = [];
  const positioned = sorted.map((evt) => {
    const s = timeToMinutes(evt.start);
    let e = timeToMinutes(evt.end);
    if (e === 0 && evt.end === '24:00') e = 1440;
    if (e <= s) e = s + 30; // fallback duration

    let col = 0;
    let placed = false;
    for (let i = 0; i < colEnd.length; i++) {
      if (s >= colEnd[i]) {
        col = i;
        colEnd[i] = e;
        placed = true;
        break;
      }
    }
    if (!placed) {
      col = colEnd.length;
      colEnd.push(e);
    }
    return { ...evt, _col: col, _startMin: s, _endMin: e };
  });

  const totalCols = Math.max(colEnd.length, 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-500" />
          <span>Временная шкала дня (24 часа)</span>
        </h3>
        <span className="text-xs text-slate-400">
          Нажмите на занятие на шкале, чтобы удалить
        </span>
      </div>

      <div
        ref={scrollContainerRef}
        className="max-h-[520px] overflow-y-auto relative scroll-smooth select-none"
      >
        <div className="flex relative" style={{ height: 'calc(24 * 48px)' }}>
          {/* Left Hours Ruler */}
          <div className="w-14 shrink-0 border-r border-slate-200 bg-slate-50/80 relative">
            {Array.from({ length: 25 }).map((_, i) => (
              <div
                key={i}
                className="absolute right-2 text-[11px] font-mono text-slate-400 font-medium -translate-y-1/2"
                style={{ top: `${i * 48}px` }}
              >
                {String(i).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Canvas with Grid and Events */}
          <div
            className="flex-1 relative"
            style={{
              background:
                'repeating-linear-gradient(to bottom, transparent 0, transparent 47px, #f1f5f9 47px, #f1f5f9 48px)',
            }}
          >
            {/* Current Time Marker */}
            {isToday && (
              <div
                className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                style={{ top: `${(currentMinutes / 1440) * 100}%` }}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500 -ml-1.5 shadow-sm" />
                <div className="flex-1 border-t-2 border-rose-500 border-dashed" />
                <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full mr-2 shadow-xs">
                  {String(now.getHours()).padStart(2, '0')}:
                  {String(now.getMinutes()).padStart(2, '0')}
                </span>
              </div>
            )}

            {/* Events */}
            {positioned.map((evt) => {
              const typeCfg = ACTIVITY_TYPES[evt.type] || ACTIVITY_TYPES.other;
              const topPercent = (evt._startMin / 1440) * 100;
              const heightPercent = ((evt._endMin - evt._startMin) / 1440) * 100;
              const widthCalc = `calc(${100 / totalCols}% - 8px)`;
              const leftCalc = `calc(${((evt._col || 0) * 100) / totalCols}% + 4px)`;
              const isShort = evt._endMin - evt._startMin < 45;

              return (
                <div
                  key={evt.id}
                  title={`${evt.start} – ${evt.end} • ${typeCfg.name}${evt.note ? ` • ${evt.note}` : ''}`}
                  className="group absolute rounded-lg p-2 text-white shadow-sm transition-all overflow-hidden border-l-4 border-black/20"
                  style={{
                    backgroundColor: typeCfg.color,
                    top: `${topPercent}%`,
                    height: `max(${heightPercent}%, 24px)`,
                    width: widthCalc,
                    left: leftCalc,
                  }}
                >
                  <div className="flex items-start justify-between gap-1 leading-tight">
                    <div className="font-bold text-[11px] sm:text-xs truncate">
                      {evt.start} – {evt.end}
                    </div>
                  </div>

                  {!isShort && (
                    <div className="text-[11px] font-medium opacity-95 truncate mt-0.5">
                      {typeCfg.name}
                    </div>
                  )}

                  {!isShort && evt.note && (
                    <div className="text-[10px] opacity-80 truncate mt-0.5">
                      {evt.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
