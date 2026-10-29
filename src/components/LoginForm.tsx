import React, { useState } from 'react';
import { login } from '../utils/auth';
import { Loader2, Lock } from 'lucide-react';

interface LoginFormProps {
  onSuccess: () => void;
  onDark?: boolean; // ссылка на тёмном фоне (подвал сайта)
}

const ERRORS: Record<string, string> = {
  wrong: 'Неверный пароль.',
  too_many: 'Слишком много неудачных попыток. Подождите 15 минут и попробуйте снова.',
  not_configured: 'Пароль администратора не задан на сервере (переменная ADMIN_PASSWORD в Vercel).',
  error: 'Не удалось связаться с сервером. Проверьте интернет и повторите.',
};

/** Небольшая ссылка «Вход для администратора» внизу страницы клиента. */
export const LoginForm: React.FC<LoginFormProps> = ({ onSuccess, onDark = false }) => {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const result = await login(password);
    setBusy(false);
    if (result === 'ok') {
      setPassword('');
      onSuccess();
    } else {
      setError(ERRORS[result] || ERRORS.error);
    }
  };

  if (!open) {
    return (
      <div className="text-center mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-1.5 text-xs cursor-pointer transition-colors ${
            onDark ? 'text-white/50 hover:text-white/90' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Lock className="w-3 h-3" />
          Вход для администратора
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-xs mx-auto mt-10 bg-white/80 border border-slate-200 rounded-2xl p-4 space-y-3 shadow-xs">
      <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
        <Lock className="w-4 h-4" />
        Вход для администратора
      </div>
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Пароль"
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      />
      {error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !password}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Войти
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setPassword('');
          }}
          className="px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-600 cursor-pointer"
        >
          Отмена
        </button>
      </div>
    </form>
  );
};
