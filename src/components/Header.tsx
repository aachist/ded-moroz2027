import React from 'react';
import { Calendar, Image as ImageIcon, BookOpen } from 'lucide-react';

export type TabKey = 'schedule' | 'media' | 'help';

interface HeaderProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  mediaCount: number;
  syncStatus: string;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, mediaCount, syncStatus }) => {
  const tabClass = (active: boolean) =>
    `flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
      active
        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 ring-2 ring-blue-600/30'
        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
    }`;

  return (
    <header className="mb-6 text-center">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-1 flex items-center justify-center gap-2">
        <span>📅</span>
        <span>Запись на вызов Деда Мороза</span>
      </h1>
      <p className="text-sm text-slate-500 mb-2">
        Планируйте вызовы по часам и сохраняйте памятные фото и видео
      </p>
      <div className="text-xs text-slate-400 font-medium mb-5 min-h-4">{syncStatus}</div>

      {/* Tabs */}
      <div className="flex gap-2 justify-center flex-wrap">
        <button type="button" onClick={() => setActiveTab('schedule')} className={tabClass(activeTab === 'schedule')}>
          <Calendar className="w-4 h-4" />
          <span>Запись на вызов</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('media')}
          className={`${tabClass(activeTab === 'media')} relative`}
        >
          <ImageIcon className="w-4 h-4" />
          <span>Фото и видео</span>
          {mediaCount > 0 && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                activeTab === 'media' ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'
              }`}
            >
              {mediaCount}
            </span>
          )}
        </button>

        <button type="button" onClick={() => setActiveTab('help')} className={tabClass(activeTab === 'help')}>
          <BookOpen className="w-4 h-4" />
          <span>Инструкция</span>
        </button>
      </div>
    </header>
  );
};
