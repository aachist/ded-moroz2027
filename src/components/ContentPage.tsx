import React, { useState } from 'react';
import { RichText } from './RichText';
import { Loader2, Pencil } from 'lucide-react';

interface ContentPageProps {
  text: string;
  isAdmin: boolean;
  /** Сохраняет текст. Возвращает текст ошибки или null при успехе. */
  onSave: (text: string) => Promise<string | null>;
  emptyHint: string; // что увидит клиент, пока текста нет
}

/** Страница с текстом, который редактирует администратор («Варианты встреч», «Правила встреч»). */
export const ContentPage: React.FC<ContentPageProps> = ({ text, isAdmin, onSave, emptyHint }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(text);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const err = await onSave(draft);
    setSaving(false);
    if (err) setError(err);
    else setEditing(false);
  };

  if (editing) {
    return (
      <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-md border border-slate-200/80 space-y-4">
        <div className="rounded-2xl bg-brand/5 border border-brand/15 p-4 text-sm text-slate-700 leading-relaxed">
          <div className="font-bold text-brand mb-1">Как оформлять текст</div>
          <ul className="space-y-0.5">
            <li>
              <code className="font-mono bg-white px-1 rounded"># Заголовок</code> — крупный заголовок
            </li>
            <li>
              <code className="font-mono bg-white px-1 rounded">## Подзаголовок</code> — подзаголовок
            </li>
            <li>
              <code className="font-mono bg-white px-1 rounded">- пункт</code> — пункт списка (каждый с новой строки)
            </li>
            <li>
              <code className="font-mono bg-white px-1 rounded">**жирный**</code> — жирный шрифт
            </li>
            <li>
              Пустая строка — новый абзац. Адреса <code className="font-mono bg-white px-1 rounded">https://…</code>{' '}
              становятся ссылками.
            </li>
          </ul>
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          maxLength={20000}
          className="w-full border border-slate-300 rounded-2xl p-4 text-sm leading-relaxed font-mono focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          placeholder="Введите текст…"
          autoFocus
        />

        {draft.trim() && (
          <div>
            <div className="text-xs font-bold text-slate-500 mb-2">Так это увидят клиенты</div>
            <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/60">
              <RichText text={draft} />
            </div>
          </div>
        )}

        {error && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm px-4 py-3">{error}</div>}

        <div className="flex flex-wrap gap-3 items-center">
          <button type="button" onClick={save} disabled={saving} className="btn-lime disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Сохранить
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="px-5 py-3 rounded-full border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-600 cursor-pointer"
          >
            Отмена
          </button>
          <span className="text-xs text-slate-400 ml-auto">{draft.length} / 20000</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl p-5 sm:p-8 shadow-md border border-slate-200/80">
      {isAdmin && (
        <div className="flex justify-end mb-3">
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand text-white text-sm font-bold hover:bg-brand-deep cursor-pointer"
          >
            <Pencil className="w-4 h-4" />
            Редактировать
          </button>
        </div>
      )}
      {text.trim() ? (
        <RichText text={text} />
      ) : (
        <div className="text-center py-10 text-slate-500">
          <div className="text-4xl mb-2">🎄</div>
          {isAdmin ? 'Текст ещё не добавлен. Нажмите «Редактировать», чтобы заполнить страницу.' : emptyHint}
        </div>
      )}
    </div>
  );
};
