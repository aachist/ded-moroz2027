import React, { useEffect, useState } from 'react';

const BULB_COLORS = ['#ff4d4d', '#ffd84d', '#4dff88', '#4da6ff', '#ff9a3d'];
const BULB_COUNT = 17;

/** Склонение: 1 день, 2 дня, 5 дней */
function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export interface NewYearParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isNewYearDay: boolean; // идёт 1 января: вместо отсчёта поздравление
}

/** Сколько осталось до ближайшего Нового года (по времени устройства). */
export function untilNewYear(now: Date): NewYearParts {
  const isNewYearDay = now.getMonth() === 0 && now.getDate() === 1;
  const target = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0);
  const total = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    isNewYearDay,
  };
}

/** Строка вида «62 дня 21 час 0 минут 54 секунды» */
export function formatCountdown(p: NewYearParts): string {
  return [
    `${p.days} ${plural(p.days, ['день', 'дня', 'дней'])}`,
    `${p.hours} ${plural(p.hours, ['час', 'часа', 'часов'])}`,
    `${p.minutes} ${plural(p.minutes, ['минута', 'минуты', 'минут'])}`,
    `${p.seconds} ${plural(p.seconds, ['секунда', 'секунды', 'секунд'])}`,
  ].join(' ');
}

/** Ёлочка-силуэт для фона */
const Fir: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 100 140" className={className} aria-hidden="true">
    <polygon points="50,2 74,44 62,44 86,82 72,82 98,124 2,124 28,82 14,82 38,44 26,44" fill="rgba(6,16,70,0.55)" />
    <rect x="44" y="124" width="12" height="14" fill="rgba(6,16,70,0.55)" />
  </svg>
);

export const NewYearCountdown: React.FC = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const p = untilNewYear(now);

  return (
    <section className="night-bg rounded-[2rem] shadow-xl text-center" aria-label="Сколько осталось до Нового года">
      {/* Гирлянда */}
      <div className="garland" aria-hidden="true">
        {Array.from({ length: BULB_COUNT }, (_, i) => {
          const color = BULB_COLORS[i % BULB_COLORS.length];
          return (
            <span
              key={i}
              className="bulb"
              style={{
                background: `radial-gradient(circle at 35% 30%, #fff 0%, ${color} 45%, ${color} 100%)`,
                boxShadow: `0 0 12px 3px ${color}99`,
                animationDelay: `${(i % 7) * 0.35}s`,
                marginTop: i % 2 ? 6 : 0,
              }}
            />
          );
        })}
      </div>

      {/* Ёлки на фоне */}
      <Fir className="absolute left-[18%] bottom-0 h-3/5 w-auto opacity-80 hidden sm:block" />
      <Fir className="absolute left-[42%] bottom-0 h-4/5 w-auto opacity-80 hidden sm:block" />
      <Fir className="absolute right-[20%] bottom-0 h-3/5 w-auto opacity-80 hidden sm:block" />

      <div className="relative z-10 px-6 py-8 sm:py-12" role="timer">
        {p.isNewYearDay ? (
          <>
            <div className="gold-text text-4xl sm:text-6xl leading-tight">С Новым годом!</div>
            <div className="gold-text text-xl sm:text-3xl mt-3">Пусть сбываются самые заветные мечты</div>
          </>
        ) : (
          <>
            <div className="gold-text text-2xl sm:text-4xl leading-snug">До Нового года осталось всего</div>
            <div className="gold-text text-3xl sm:text-5xl leading-snug mt-4 sm:mt-6" aria-live="off">
              {formatCountdown(p)}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
