import React, { useEffect, useRef, useState } from 'react';
import { FONT_SCALES, FontScaleId, getFontScale, setFontScale } from '../utils/fontScale';

interface Props {
  /** Вид кнопки: компактная круглая (шапка телефона) или с подписью (шапка компьютера). */
  variant?: 'round' | 'pill';
}

/** Кнопка «A+»: открывает меню выбора размера текста (обычный, крупный, очень крупный). */
export const FontScaleButton: React.FC<Props> = ({ variant = 'round' }) => {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<FontScaleId>(getFontScale);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (id: FontScaleId) => {
    setFontScale(id);
    setScale(id);
    setOpen(false);
  };

  const active = scale !== 'normal';
  const btnCls =
    variant === 'round'
      ? `w-11 h-11 rounded-full font-extrabold text-base flex items-center justify-center cursor-pointer ${
          active ? 'bg-white text-brand-deep' : 'bg-white/15 text-white hover:bg-white/25'
        }`
      : `px-3 py-2 rounded-full font-extrabold text-sm flex items-center justify-center cursor-pointer ${
          active ? 'bg-white text-brand-deep' : 'bg-white/15 text-white hover:bg-white/25'
        }`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Размер текста для слабовидящих"
        aria-haspopup="true"
        aria-expanded={open}
        title="Размер текста"
        className={btnCls}
      >
        A+
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Размер текста"
          className="absolute right-0 top-full mt-2 z-50 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-white text-slate-900 shadow-xl border border-slate-200 p-2"
        >
          <div className="px-2 pt-1 pb-2 text-xs font-bold text-slate-500">Размер текста</div>
          {FONT_SCALES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={scale === s.id}
              onClick={() => choose(s.id)}
              className={`w-full text-left rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 cursor-pointer ${
                scale === s.id ? 'bg-violet-100 text-violet-900' : 'hover:bg-slate-100'
              }`}
            >
              <span>
                <span className="block text-sm font-bold">{s.label}</span>
                <span className="block text-xs text-slate-500">{s.hint}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{scale === s.id ? '✓' : `${s.percent}%`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
