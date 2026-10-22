import React from 'react';
import { Calendar, Image as ImageIcon, Settings, Cloud, Share2, Check } from 'lucide-react';

interface HeaderProps {
  activeTab: 'schedule' | 'media' | 'settings';
  setActiveTab: (tab: 'schedule' | 'media' | 'settings') => void;
  syncCode: string;
  onOpenSync: () => void;
  mediaCount: number;
  syncStatus: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  syncCode,
  onOpenSync,
  mediaCount,
  syncStatus,
}) => {
  const [copied, setCopied] = React.useState(false);

  const copyCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(syncCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="mb-6 text-center">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        {/* Sync Device Badge */}
        <div className="flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-slate-200/80 rounded-xl px-3 py-1.5 shadow-xs text-xs sm:text-sm">
          <Cloud className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-slate-500">Синхронизация:</span>
          <span className="font-mono font-bold text-slate-800 tracking-wider">{syncCode}</span>
          <button
            onClick={copyCode}
            title="Скопировать код"
            className="p-1 hover:bg-slate-100 rounded-md text-slate-600 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onOpenSync}
            className="text-xs text-blue-600 font-medium hover:underline cursor-pointer pl-1 border-l border-slate-200"
          >
            Подключить
          </button>
        </div>

        {/* Sync status text */}
        <div className="text-xs text-slate-500 font-medium ml-auto hidden sm:block">
          {syncStatus}
        </div>
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-1 flex items-center justify-center gap-2">
        <span>📅</span>
        <span>Запись на вызов Деда Мороза</span>
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        Планируйте дела по часам и сохраняйте памятные фото и видео без ограничений
      </p>

      {/* Tabs */}
      <div className="flex gap-2 justify-center flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab('schedule')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'schedule'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 ring-2 ring-blue-600/30'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Расписание</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('media')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer relative ${
            activeTab === 'media'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 ring-2 ring-blue-600/30'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
          }`}
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

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 ring-2 ring-blue-600/30'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span className="hidden sm:inline">Хранилище</span>
        </button>
      </div>
    </header>
  );
};
