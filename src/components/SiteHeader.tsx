import React from 'react';
import { PageKey, PAGE_LABELS } from '../nav';
import { LogOut, Phone, Home } from 'lucide-react';

interface SiteHeaderProps {
  page: PageKey;
  setPage: (p: PageKey) => void;
  pages: PageKey[]; // какие пункты показывать в меню
  phoneHref: string; // tel:… или пусто, если телефон не задан
  isAdmin: boolean;
  syncStatus?: string;
  mediaCount?: number;
  onLogout?: () => void;
}

export const SiteHeader: React.FC<SiteHeaderProps> = ({
  page,
  setPage,
  pages,
  phoneHref,
  isAdmin,
  syncStatus,
  mediaCount = 0,
  onLogout,
}) => {
  const pill = (active: boolean) =>
    `shrink-0 whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer ${
      active ? 'bg-white text-brand shadow-md' : 'bg-white/15 text-white hover:bg-white/25'
    }`;

  return (
    <header className="hero-bg snow text-white shadow-lg">
      <div className="relative z-10 max-w-5xl mx-auto px-3 sm:px-6 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPage('home')}
            className="flex items-center gap-2.5 cursor-pointer text-left min-w-0"
            title="На главную"
          >
            <span className="text-3xl drop-shadow">🎅</span>
            <span className="font-display font-bold text-base sm:text-2xl leading-tight truncate">Вызов Деда Мороза</span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {phoneHref ? (
              <a href={phoneHref} className="btn-lime !py-2 !px-4 text-sm">
                <Phone className="w-4 h-4" />
                <span className="hidden sm:inline">Позвонить Деду Морозу</span>
                <span className="sm:hidden">Позвонить</span>
              </a>
            ) : (
              <button type="button" onClick={() => setPage('contacts')} className="btn-lime !py-2 !px-4 text-sm">
                <Phone className="w-4 h-4" />
                <span className="hidden sm:inline">Позвонить Деду Морозу</span>
                <span className="sm:hidden">Позвонить</span>
              </button>
            )}
            {isAdmin && onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold bg-white/15 hover:bg-white/25 cursor-pointer"
                title="Выйти из режима администратора"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Выйти</span>
              </button>
            )}
          </div>
        </div>

        {/* Меню */}
        <nav className="mt-3 flex gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap pb-1 -mx-1 px-1" aria-label="Разделы сайта">
          <button type="button" onClick={() => setPage('home')} className={pill(page === 'home')} title="Главная">
            <span className="inline-flex items-center gap-1.5">
              <Home className="w-4 h-4" />
              <span className="sr-only sm:not-sr-only">Главная</span>
            </span>
          </button>
          {pages.map((p) => (
            <button key={p} type="button" onClick={() => setPage(p)} className={pill(page === p)}>
              {PAGE_LABELS[p]}
              {p === 'media' && mediaCount > 0 && (
                <span
                  className={`ml-2 text-xs px-2 py-0.5 rounded-full font-bold ${
                    page === p ? 'bg-brand/10 text-brand' : 'bg-white/20 text-white'
                  }`}
                >
                  {mediaCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {isAdmin && (
          <div className="mt-2 flex items-center justify-between text-xs text-white/80">
            <span className="font-bold bg-lime text-[#26340a] rounded-full px-2.5 py-0.5">Режим администратора</span>
            <span className="truncate ml-3">{syncStatus}</span>
          </div>
        )}
      </div>
    </header>
  );
};
