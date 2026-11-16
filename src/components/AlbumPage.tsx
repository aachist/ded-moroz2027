import React, { useEffect, useState } from 'react';
import { MediaItem } from '../types';
import { WORKSPACE_CODE, fetchAlbumByToken, plural } from '../utils/storage';
import { MediaViewer } from './MediaViewer';
import { Play } from 'lucide-react';

type State =
  | { kind: 'loading' }
  | { kind: 'notfound' }
  | { kind: 'error' }
  | { kind: 'ready'; title: string; items: MediaItem[] };

/**
 * Личный альбом семьи: открывается по ссылке вида /#album=<токен>.
 * Без шапки и меню сайта; только просмотр и скачивание. Альбом не индексируется поисковиками.
 */
export const AlbumPage: React.FC<{ token: string }> = ({ token }) => {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    // Личную ссылку не нужно показывать поисковикам
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    setViewerIndex(null);
    fetchAlbumByToken(WORKSPACE_CODE, token)
      .then((a) => {
        if (cancelled) return;
        document.title = `${a.title} — Вызов Деда Мороза`;
        setState({ kind: 'ready', title: a.title, items: a.items });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ kind: String(e?.message) === 'NOT_FOUND' ? 'notfound' : 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const goHome = () => {
    history.pushState(null, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <span className="font-bold text-slate-900">🎅 Вызов Деда Мороза</span>
          <button
            type="button"
            onClick={goHome}
            className="text-sm text-blue-600 hover:text-blue-700 underline cursor-pointer"
          >
            На сайт
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-6 py-6">
        {state.kind === 'loading' && <p className="text-center text-slate-500 py-16">Загружаем альбом…</p>}

        {state.kind === 'notfound' && (
          <div className="text-center py-16 px-4">
            <p className="text-lg font-semibold text-slate-800">Альбом не найден</p>
            <p className="text-sm text-slate-500 mt-2">
              Возможно, ссылка устарела или скопирована не полностью. Попросите Деда Мороза прислать новую.
            </p>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="text-center py-16 px-4">
            <p className="text-lg font-semibold text-slate-800">Не удалось открыть альбом</p>
            <p className="text-sm text-slate-500 mt-2">Проверьте интернет и обновите страницу.</p>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{state.title}</h1>
            <p className="text-sm text-slate-500 mt-1 mb-5">
              {state.items.length} {plural(state.items.length, ['файл', 'файла', 'файлов'])}. Нажмите на снимок, чтобы
              открыть или скачать.
            </p>

            {state.items.length === 0 ? (
              <p className="text-center text-slate-500 py-12">В альбоме пока нет файлов 🙂 Загляните позже.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {state.items.map((m, idx) => (
                  <div key={m.id} className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setViewerIndex(idx)}
                      className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-2xs hover:shadow-md transition-all cursor-pointer"
                    >
                      {m.type === 'photo' || m.thumb ? (
                        <img
                          src={m.thumb || m.url}
                          alt={m.caption || ''}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <video src={m.url} preload="metadata" muted playsInline className="w-full h-full object-cover" />
                      )}
                      {m.type === 'video' && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white">
                            <Play className="w-5 h-5 fill-current ml-0.5" />
                          </span>
                        </span>
                      )}
                    </button>
                    {m.caption && <p className="px-1 text-xs text-slate-700 break-words">{m.caption}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {state.kind === 'ready' && viewerIndex !== null && state.items[viewerIndex] && (
        <MediaViewer
          mediaList={state.items}
          currentIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
          onDelete={() => {}}
          onUpdateCaption={() => {}}
          readOnly
        />
      )}
    </div>
  );
};
