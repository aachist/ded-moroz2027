import React, { useEffect } from 'react';
import { PageKey, PAGE_LABELS } from '../nav';
import { CalendarDays, ChevronRight, Clapperboard, Home, LogOut, Menu, MessageCircle, Monitor, Phone, X } from 'lucide-react';

const PAGE_EMOJI: Record<PageKey, string> = {
  home: '🏠',
  schedule: '📅',
  media: '🎬',
  variants: '🎁',
  rules: '📜',
  reviews: '💬',
  contacts: '📞',
  help: '📖',
};

/* ---------- Шапка телефона ---------- */
interface MobileHeaderProps {
  setPage: (p: PageKey) => void;
  phoneHref: string;
  isAdmin: boolean;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({ setPage, phoneHref, isAdmin }) => (
  <header
    className="hero-bg snow sticky top-0 z-30 text-white shadow-md"
    style={{ paddingTop: 'env(safe-area-inset-top)' }}
  >
    <div className="relative z-10 flex items-center justify-between gap-3 px-3 h-14">
      <button type="button" onClick={() => setPage('home')} className="flex items-center gap-2 min-w-0 cursor-pointer" aria-label="На главную">
        <span className="text-2xl drop-shadow">🎅</span>
        <span className="font-display font-bold text-base leading-tight truncate">Вызов Деда Мороза</span>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        {isAdmin && (
          <span className="text-[10px] font-extrabold uppercase tracking-wide bg-lime text-[#26340a] rounded-full px-2 py-1">
            Админ
          </span>
        )}
        {phoneHref ? (
          <a
            href={phoneHref}
            aria-label="Позвонить Деду Морозу"
            className="btn-lime !p-0 w-11 h-11 !shadow-[0_3px_0_#86a82a]"
          >
            <Phone className="w-5 h-5" />
          </a>
        ) : (
          <button
            type="button"
            onClick={() => setPage('contacts')}
            aria-label="Контакты Деда Мороза"
            className="btn-lime !p-0 w-11 h-11 !shadow-[0_3px_0_#86a82a]"
          >
            <Phone className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  </header>
);

/* ---------- Нижняя панель (как в приложениях) ---------- */
interface BottomNavProps {
  page: PageKey;
  setPage: (p: PageKey) => void;
  menuOpen: boolean;
  onMenu: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ page, setPage, menuOpen, onMenu }) => {
  const inMore = ['variants', 'rules', 'contacts', 'help'].includes(page);
  const items: Array<{ key: string; label: string; icon: React.ReactNode; active: boolean; onClick: () => void }> = [
    { key: 'home', label: 'Главная', icon: <Home className="w-6 h-6" />, active: page === 'home' && !menuOpen, onClick: () => setPage('home') },
    { key: 'schedule', label: 'Запись', icon: <CalendarDays className="w-6 h-6" />, active: page === 'schedule' && !menuOpen, onClick: () => setPage('schedule') },
    { key: 'media', label: 'Примеры', icon: <Clapperboard className="w-6 h-6" />, active: page === 'media' && !menuOpen, onClick: () => setPage('media') },
    { key: 'reviews', label: 'Отзывы', icon: <MessageCircle className="w-6 h-6" />, active: page === 'reviews' && !menuOpen, onClick: () => setPage('reviews') },
    { key: 'menu', label: 'Меню', icon: <Menu className="w-6 h-6" />, active: menuOpen || inMore, onClick: onMenu },
  ];

  return (
    <nav
      className="bottom-nav fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-4px_16px_rgba(47,31,88,0.12)]"
      aria-label="Основная навигация"
    >
      <div className="grid grid-cols-5">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={it.onClick}
            aria-current={it.active ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 min-h-[58px] cursor-pointer transition-colors ${
              it.active ? 'text-brand' : 'text-slate-500'
            }`}
          >
            <span className={`px-4 py-0.5 rounded-full transition-colors ${it.active ? 'bg-brand/10' : ''}`}>{it.icon}</span>
            <span className={`text-[11px] leading-none ${it.active ? 'font-extrabold' : 'font-semibold'}`}>{it.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};

/* ---------- Меню-шторка со всеми разделами ---------- */
interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
  page: PageKey;
  setPage: (p: PageKey) => void;
  pages: PageKey[];
  isAdmin: boolean;
  onLogout?: () => void;
  syncStatus?: string;
  /** Показывать ли переключатель «Версия для компьютера» */
  onDesktopVersion?: () => void;
  children?: React.ReactNode; // например, вход администратора
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  open,
  onClose,
  page,
  setPage,
  pages,
  isAdmin,
  onLogout,
  syncStatus,
  onDesktopVersion,
  children,
}) => {
  // Пока меню открыто: страница под ним не прокручивается; Escape закрывает
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const go = (p: PageKey) => {
    setPage(p);
    onClose();
  };

  const row = (p: PageKey) => (
    <button
      key={p}
      type="button"
      onClick={() => go(p)}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left cursor-pointer transition-colors ${
        page === p ? 'bg-brand/10 text-brand' : 'hover:bg-slate-50 text-slate-800'
      }`}
    >
      <span className="text-2xl w-8 text-center">{PAGE_EMOJI[p]}</span>
      <span className="flex-1 font-bold leading-snug">{PAGE_LABELS[p]}</span>
      <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Меню">
      <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="sheet-enter absolute bottom-0 inset-x-0 bg-white rounded-t-3xl shadow-2xl max-h-[88vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <div className="sticky top-0 bg-white/95 backdrop-blur flex items-center justify-between px-5 pt-4 pb-2 z-10">
          <div className="mx-auto absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1.5 rounded-full bg-slate-200" />
          <h2 className="font-display font-bold text-xl text-brand-deep mt-2">Меню</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть меню"
            className="mt-2 w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-3 pb-2 space-y-1">
          {row('home')}
          {pages.map(row)}
        </div>

        <div className="px-4 pt-3 space-y-3">
          {isAdmin && (
            <div className="rounded-2xl bg-lime/20 border border-lime/50 p-3 text-sm text-slate-700">
              <div className="font-bold text-[#3b4d0e]">Режим администратора</div>
              {syncStatus && <div className="text-xs text-slate-500 mt-0.5 break-words">{syncStatus}</div>}
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-slate-200 font-bold text-slate-700 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Выйти
                </button>
              )}
            </div>
          )}

          {children}

          {onDesktopVersion && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onDesktopVersion();
              }}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
            >
              <Monitor className="w-4 h-4" />
              Версия для компьютера
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
