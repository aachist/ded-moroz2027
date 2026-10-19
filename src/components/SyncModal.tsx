import React, { useState } from 'react';
import { DaySchedule } from '../types';
import { X, Copy, Check, Link2, Download, Upload, Cloud } from 'lucide-react';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncCode: string;
  onConnectCode: (code: string) => void;
  schedule: DaySchedule;
  onImportSchedule: (data: DaySchedule) => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  syncCode,
  onConnectCode,
  schedule,
  onImportSchedule,
}) => {
  const [copied, setCopied] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(syncCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputCode.trim().toLowerCase();
    if (!/^[a-z0-9-]{6,12}$/i.test(clean)) {
      setErrorMsg('Неверный формат кода. Код состоит из латинских букв и цифр, например 4k9p-w72x');
      return;
    }
    setErrorMsg('');
    onConnectCode(clean);
    onClose();
  };

  const handleExportBackup = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(schedule, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `raspisanie_backup_${syncCode}.json`);
    dlAnchor.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (typeof parsed === 'object') {
          onImportSchedule(parsed);
          onClose();
        }
      } catch (err) {
        setErrorMsg('Ошибка чтения JSON файла');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Cloud className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 text-lg">
              Синхронизация расписания
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-4 space-y-5">
          {/* Current Code Box */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
              Код вашего устройства
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 font-mono font-bold text-lg text-slate-800 text-center tracking-widest">
                {syncCode}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-xs cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Скопировано' : 'Копировать'}</span>
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Введите этот код на телефоне или другом компьютере, чтобы видеть одно расписание
            </p>
          </div>

          {/* Join Code Box */}
          <form onSubmit={handleJoin} className="space-y-2 pt-2 border-t border-slate-100">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Подключиться к другому устройству
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => {
                  setInputCode(e.target.value);
                  setErrorMsg('');
                }}
                placeholder="например: 4k9p-w72x"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
              />
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold transition-colors cursor-pointer"
              >
                <Link2 className="w-4 h-4" />
                <span>Подключить</span>
              </button>
            </div>
            {errorMsg && <p className="text-xs text-rose-600 font-medium">{errorMsg}</p>}
          </form>

          {/* Backup / Export */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Скачать резервную копию (JSON)</span>
            </button>

            <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-slate-500" />
              <span>Загрузить копию</span>
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImportFile}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
