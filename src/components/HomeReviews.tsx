import React, { useEffect, useState } from 'react';
import { PageKey } from '../nav';
import { Review, fetchReviews } from '../utils/content';
import { WORKSPACE_CODE, plural } from '../utils/storage';

const MAX_TEXT = 160;

const trimText = (t: string): string => {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length <= MAX_TEXT) return s;
  // Режем по границе слова, чтобы не обрывать посередине
  const cut = s.slice(0, MAX_TEXT);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
};

const Stars: React.FC<{ value: number; className?: string }> = ({ value, className = '' }) => {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className={`text-amber-500 tracking-tight ${className}`} role="img" aria-label={`Оценка ${full} из 5`}>
      {'★'.repeat(full)}
      <span className="text-slate-300">{'★'.repeat(5 - full)}</span>
    </span>
  );
};

/**
 * Заметный блок отзывов на главной: средняя оценка и два самых свежих отзыва (без фильтра по оценке).
 * Показываются только одобренные отзывы (сервер отдаёт публично только их). Если отзывов нет, блока нет.
 */
export const HomeReviews: React.FC<{ setPage: (p: PageKey) => void }> = ({ setPage }) => {
  const [reviews, setReviews] = useState<Review[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchReviews(WORKSPACE_CODE).then((list) => {
      if (alive) setReviews(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!reviews || reviews.length === 0) return null;

  const rated = reviews.filter((r) => Number(r.rating) >= 1 && Number(r.rating) <= 5);
  const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : 0;
  const latest = [...reviews].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 2);

  return (
    <section aria-label="Отзывы семей">
      <h2 className="text-2xl font-bold text-brand-deep text-center mb-4">Что говорят семьи</h2>

      {rated.length > 0 && (
        <div className="flex items-center justify-center gap-3 mb-5">
          <span className="text-4xl font-bold text-slate-900 tabular-nums">{avg.toFixed(1).replace('.', ',')}</span>
          <div>
            <Stars value={avg} className="text-2xl leading-none" />
            <div className="text-sm text-slate-600 mt-0.5">
              {reviews.length} {plural(reviews.length, ['отзыв', 'отзыва', 'отзывов'])}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {latest.map((r) => (
          <figure key={r.id} className="rounded-2xl bg-white border border-slate-200/90 shadow-xs p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <figcaption className="font-bold text-slate-900 truncate">{r.name}</figcaption>
              {Number(r.rating) >= 1 && <Stars value={Number(r.rating)} className="text-lg shrink-0" />}
            </div>
            <blockquote className="text-sm text-slate-700 leading-relaxed break-words">{trimText(r.text)}</blockquote>
          </figure>
        ))}
      </div>

      <div className="text-center mt-4">
        <button
          type="button"
          onClick={() => setPage('reviews')}
          className="px-5 py-2.5 rounded-full border-2 border-brand/30 text-brand font-bold hover:bg-brand/5 cursor-pointer"
        >
          Все отзывы
        </button>
      </div>
    </section>
  );
};
