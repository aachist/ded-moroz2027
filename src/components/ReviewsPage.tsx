import React, { useCallback, useEffect, useState } from 'react';
import {
  Review,
  fetchReviews,
  createReview,
  updateReview,
  deleteReview,
} from '../utils/content';
import { Check, Loader2, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface ReviewsPageProps {
  syncCode: string;
  isAdmin: boolean;
}

const Stars: React.FC<{ value: number }> = ({ value }) => (
  <span className="text-amber-400 text-lg tracking-wide" aria-label={`Оценка ${value} из 5`}>
    {'★'.repeat(value)}
    <span className="text-slate-300">{'★'.repeat(5 - value)}</span>
  </span>
);

const formatDate = (ts: number) =>
  new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

const inputCls =
  'w-full border border-slate-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand';

export const ReviewsPage: React.FC<ReviewsPageProps> = ({ syncCode, isAdmin }) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [name, setName] = useState('');
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [website, setWebsite] = useState(''); // ловушка для ботов
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await fetchReviews(syncCode, isAdmin);
    if (list) {
      setReviews(list);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    setLoading(false);
  }, [syncCode, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (name.trim().length < 2) return setMessage({ type: 'err', text: 'Укажите ваше имя.' });
    if (text.trim().length < 10) return setMessage({ type: 'err', text: 'Напишите отзыв подробнее (минимум 10 символов).' });

    setSubmitting(true);
    setMessage(null);
    const res = await createReview(syncCode, { name: name.trim(), text: text.trim(), rating, website });
    setSubmitting(false);
    if (res.ok) {
      setName('');
      setText('');
      setRating(5);
      setMessage({
        type: 'ok',
        text: isAdmin || !res.pending
          ? 'Отзыв добавлен.'
          : 'Спасибо за отзыв! Он появится на сайте после проверки.',
      });
      load();
    } else {
      setMessage({ type: 'err', text: res.message });
    }
  };

  const approve = async (r: Review) => {
    setBusyId(r.id);
    await updateReview(syncCode, r.id, { status: 'approved' });
    await load();
    setBusyId(null);
  };

  const remove = async (r: Review) => {
    if (!window.confirm(`Удалить отзыв от «${r.name}»? Это действие нельзя отменить.`)) return;
    setBusyId(r.id);
    await deleteReview(syncCode, r.id);
    await load();
    setBusyId(null);
  };

  const pending = reviews.filter((r) => r.status === 'pending');
  const approved = reviews.filter((r) => r.status !== 'pending');

  const card = (r: Review) => (
    <article key={r.id} className="bg-white rounded-3xl p-5 shadow-md border border-slate-200/80">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="font-display font-bold text-brand-deep text-lg break-words">{r.name}</div>
          <div className="text-xs text-slate-400">{formatDate(r.createdAt)}</div>
        </div>
        <Stars value={r.rating} />
      </div>
      <p className="text-slate-700 leading-relaxed whitespace-pre-line break-words">{r.text}</p>

      {isAdmin && (
        <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
          {r.status === 'pending' && (
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => approve(r)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-lime text-[#26340a] text-sm font-bold hover:brightness-105 disabled:opacity-60 cursor-pointer"
            >
              {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Одобрить
            </button>
          )}
          <button
            type="button"
            disabled={busyId === r.id}
            onClick={() => remove(r)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-rose-50 text-rose-700 text-sm font-bold hover:bg-rose-100 disabled:opacity-60 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Удалить
          </button>
        </div>
      )}
    </article>
  );

  return (
    <div className="space-y-8">
      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          Не удалось загрузить отзывы. Проверьте интернет и обновите страницу.
        </div>
      )}

      {/* Администратор: отзывы, ожидающие проверки */}
      {isAdmin && pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold text-amber-700">Ждут вашей проверки: {pending.length}</h2>
          <div className="space-y-3 rounded-3xl bg-amber-50 border border-amber-200 p-3">{pending.map(card)}</div>
        </section>
      )}

      {/* Список отзывов */}
      <section className="space-y-3">
        {loading ? (
          <div className="text-center text-slate-400 py-8">
            <Loader2 className="w-5 h-5 animate-spin inline" />
          </div>
        ) : approved.length === 0 ? (
          loadError ? null : (
            <div className="bg-white rounded-3xl p-10 text-center text-slate-500 shadow-md border border-slate-200/80">
              <div className="text-4xl mb-2">💬</div>
              Пока нет отзывов. Станьте первым!
            </div>
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-2">{approved.map(card)}</div>
        )}
      </section>

      {/* Форма */}
      <form onSubmit={submit} className="bg-white rounded-3xl p-5 sm:p-7 shadow-md border border-slate-200/80 space-y-4 max-w-2xl">
        <h2 className="text-xl font-bold text-brand-deep">
          {isAdmin ? 'Добавить отзыв (появится сразу)' : 'Оставить отзыв'}
        </h2>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">Ваше имя</span>
          <input
            type="text"
            value={name}
            maxLength={60}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="Как вас представить"
          />
        </label>

        <div>
          <span className="text-sm font-bold text-slate-700">Оценка</span>
          <div className="flex gap-1 mt-1" role="radiogroup" aria-label="Оценка">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                onClick={() => setRating(n)}
                className={`text-3xl leading-none cursor-pointer transition-transform hover:scale-110 ${
                  n <= rating ? 'text-amber-400' : 'text-slate-300'
                }`}
                title={`${n} из 5`}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">Ваш отзыв</span>
          <textarea
            value={text}
            maxLength={1000}
            rows={5}
            onChange={(e) => setText(e.target.value)}
            className={inputCls}
            placeholder="Расскажите, как прошла встреча с Дедом Морозом"
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
            {message.type === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <button type="submit" disabled={submitting} className="btn-lime disabled:opacity-60">
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Отправить отзыв
        </button>
        {!isAdmin && <p className="text-xs text-slate-400">Отзыв появится на сайте после проверки администратором.</p>}
      </form>
    </div>
  );
};
