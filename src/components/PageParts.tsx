import React from 'react';
import { Contacts, telHref, telegramHref } from '../utils/content';
import { ArrowLeft, Phone, Send, Mail } from 'lucide-react';

/** Рамка внутренней страницы: заголовок и кнопка «На главную». */
export const PageShell: React.FC<{ title: string; onBack: () => void; children: React.ReactNode }> = ({
  title,
  onBack,
  children,
}) => (
  <div>
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-sm font-bold text-brand hover:text-brand-deep mb-3 cursor-pointer"
    >
      <ArrowLeft className="w-4 h-4" />
      На главную
    </button>
    <h1 className="text-2xl sm:text-4xl font-bold text-brand-deep leading-tight mb-6">{title}</h1>
    {children}
  </div>
);

/** Подвал: быстрые контакты на любой странице. */
export const SiteFooter: React.FC<{ contacts: Contacts; children?: React.ReactNode }> = ({ contacts, children }) => {
  const tel = telHref(contacts.phone);
  const tg = telegramHref(contacts.telegram);
  const linkCls =
    'inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 hover:bg-white/25 text-sm font-bold cursor-pointer';
  return (
    <footer className="mt-14 hero-bg text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-center">
        <div className="font-display font-bold text-xl mb-1">🎅 Вызов Деда Мороза</div>
        <p className="text-sm text-white/80 mb-4">Волшебство, в которое верят и дети, и взрослые</p>
        {(tel || tg || contacts.email) && (
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {tel && (
              <a href={tel} className={linkCls}>
                <Phone className="w-4 h-4" />
                {contacts.phone}
              </a>
            )}
            {tg && (
              <a href={tg} target="_blank" rel="noopener noreferrer" className={linkCls}>
                <Send className="w-4 h-4" />
                Telegram
              </a>
            )}
            {contacts.email && (
              <a href={`mailto:${contacts.email}`} className={linkCls}>
                <Mail className="w-4 h-4" />
                {contacts.email}
              </a>
            )}
          </div>
        )}
        {children}
      </div>
    </footer>
  );
};
