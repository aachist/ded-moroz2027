import React, { useState } from 'react';
import { Contacts, telHref, telegramHref } from '../utils/content';
import { Loader2, Mail, Pencil, Phone, Send } from 'lucide-react';

interface ContactsPageProps {
  contacts: Contacts;
  isAdmin: boolean;
  /** Возвращает текст ошибки или null при успехе. */
  onSave: (c: Contacts) => Promise<string | null>;
}

const inputCls =
  'w-full border border-slate-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand';

export const ContactsPage: React.FC<ContactsPageProps> = ({ contacts, isAdmin, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Contacts>(contacts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(contacts);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const err = await onSave({
      phone: draft.phone.trim(),
      telegram: draft.telegram.trim(),
      email: draft.email.trim(),
    });
    setSaving(false);
    if (err) setError(err);
    else setEditing(false);
  };

  if (editing) {
    return (
      <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-md border border-slate-200/80 space-y-4 max-w-xl">
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Телефон</span>
          <input
            type="tel"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            className={inputCls}
            placeholder="+7 900 000-00-00"
            maxLength={30}
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Telegram-канал</span>
          <input
            type="text"
            value={draft.telegram}
            onChange={(e) => setDraft({ ...draft, telegram: e.target.value })}
            className={inputCls}
            placeholder="https://t.me/название_канала или @название"
            maxLength={150}
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Электронная почта</span>
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            className={inputCls}
            placeholder="name@example.ru"
            maxLength={120}
          />
        </label>
        <p className="text-xs text-slate-500">Пустое поле скрывает соответствующую кнопку на сайте.</p>

        {error && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm px-4 py-3">{error}</div>}

        <div className="flex gap-3">
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
        </div>
      </div>
    );
  }

  const tel = telHref(contacts.phone);
  const tg = telegramHref(contacts.telegram);
  const has = !!(tel || tg || contacts.email);

  const bigBtn =
    'group flex items-center gap-4 rounded-3xl p-5 text-white shadow-lg transition-transform hover:-translate-y-0.5 cursor-pointer';

  return (
    <div className="space-y-5">
      {isAdmin && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand text-white text-sm font-bold hover:bg-brand-deep cursor-pointer"
          >
            <Pencil className="w-4 h-4" />
            Редактировать контакты
          </button>
        </div>
      )}

      {has ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {tel && (
            <a href={tel} className={bigBtn} style={{ background: 'linear-gradient(135deg,#e0564f,#b82e29)' }}>
              <span className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <Phone className="w-6 h-6" />
              </span>
              <span className="min-w-0">
                <span className="block font-display font-bold text-lg leading-tight">Позвонить Деду Морозу</span>
                <span className="block text-sm text-white/85 break-words">{contacts.phone}</span>
              </span>
            </a>
          )}
          {tg && (
            <a
              href={tg}
              target="_blank"
              rel="noopener noreferrer"
              className={bigBtn}
              style={{ background: 'linear-gradient(135deg,#2d8fd0,#1f4097)' }}
            >
              <span className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <Send className="w-6 h-6" />
              </span>
              <span className="min-w-0">
                <span className="block font-display font-bold text-lg leading-tight">Telegram-канал</span>
                <span className="block text-sm text-white/85">Новости и фото встреч</span>
              </span>
            </a>
          )}
          {contacts.email && (
            <a
              href={`mailto:${contacts.email}`}
              className={bigBtn}
              style={{ background: 'linear-gradient(135deg,#8a4fc0,#5d2c94)' }}
            >
              <span className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <Mail className="w-6 h-6" />
              </span>
              <span className="min-w-0">
                <span className="block font-display font-bold text-lg leading-tight">Написать на почту</span>
                <span className="block text-sm text-white/85 break-all">{contacts.email}</span>
              </span>
            </a>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl p-10 text-center text-slate-500 shadow-md border border-slate-200/80">
          <div className="text-4xl mb-2">📞</div>
          {isAdmin ? 'Контакты ещё не заполнены. Нажмите «Редактировать контакты».' : 'Контакты появятся совсем скоро.'}
        </div>
      )}
    </div>
  );
};
