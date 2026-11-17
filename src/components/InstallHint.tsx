import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

const DISMISS_KEY = 'dm_install_hint_dismissed';
const DISMISS_DAYS = 30;

// Событие Chrome/Android, которого нет в стандартных типах TypeScript
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

// iPhone/iPad (iPadOS 13+ называет себя Macintosh, но у него есть сенсорный экран)
const isIOS = (): boolean =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const wasDismissedRecently = (): boolean => {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY));
    return !!t && Date.now() - t < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
};

/**
 * Подсказка «Установить на экран телефона».
 * Android (Chrome): своя кнопка вместо меню браузера. iPhone (Safari): короткая инструкция, у iOS кнопки установки нет.
 * Не показывается, если сайт уже открыт как приложение или подсказку недавно закрыли.
 */
export const InstallHint: React.FC = () => {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState<boolean>(() => isStandalone() || wasDismissedRecently());
  const ios = isIOS();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // свою кнопку покажем сами
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setHidden(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setHidden(true);
  };

  const install = async () => {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'dismissed') dismiss();
    } catch {}
    setPrompt(null);
  };

  if (hidden || (!prompt && !ios)) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-violet-200 bg-white p-3 shadow-xs">
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className="rounded-xl shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-slate-900">Установить на экран телефона</div>
        {prompt ? (
          <>
            <p className="text-xs text-slate-600 mt-0.5">Сайт будет открываться одним нажатием, как приложение.</p>
            <button
              type="button"
              onClick={install}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Установить
            </button>
          </>
        ) : (
          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
            Нажмите внизу кнопку «Поделиться» <Share className="inline w-3.5 h-3.5 -mt-0.5" /> и выберите «На экран “Домой”».
            Откройте сайт именно в Safari.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Закрыть подсказку"
        className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
