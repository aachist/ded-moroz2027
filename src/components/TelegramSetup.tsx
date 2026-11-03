import React, { useCallback, useEffect, useState } from 'react';
import {
  TgChat,
  TgStatus,
  tgStatus,
  tgFind,
  tgSelect,
  tgTest,
  tgDisconnect,
} from '../utils/telegram';
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react';

type Msg = { type: 'ok' | 'err'; text: string } | null;

const btn =
  'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** Настройка уведомлений о новых заявках и отзывах в Telegram (только администратор). */
export const TelegramSetup: React.FC<{ syncCode: string }> = ({ syncCode }) => {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [chats, setChats] = useState<TgChat[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    setStatus(await tgStatus(syncCode));
    setLoading(false);
  }, [syncCode]);

  useEffect(() => {
    load();
  }, [load]);

  const find = async () => {
    setBusy('find');
    setMsg(null);
    const r = await tgFind(syncCode);
    setBusy(null);
    if (!r.ok) return setMsg({ type: 'err', text: r.error });
    setChats(r.chats);
    if (r.chats.length === 0) {
      setMsg({
        type: 'err',
        text: 'Бот пока никто не писал. Откройте бота в Telegram, нажмите Start, отправьте любое сообщение и повторите поиск.',
      });
    }
  };

  const select = async (c: TgChat) => {
    setBusy(`select:${c.id}`);
    setMsg(null);
    const r = await tgSelect(syncCode, c.id);
    setBusy(null);
    if (!r.ok) return setMsg({ type: 'err', text: r.error });
    setChats(null);
    setMsg({ type: 'ok', text: 'Подключено! В Telegram должно прийти приветственное сообщение.' });
    load();
  };

  const test = async () => {
    setBusy('test');
    setMsg(null);
    const r = await tgTest(syncCode);
    setBusy(null);
    setMsg(r.ok ? { type: 'ok', text: 'Тестовое сообщение отправлено, проверьте Telegram.' } : { type: 'err', text: r.error });
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить уведомления в Telegram?')) return;
    setBusy('disconnect');
    const r = await tgDisconnect(syncCode);
    setBusy(null);
    setMsg(r.ok ? { type: 'ok', text: 'Уведомления отключены.' } : { type: 'err', text: r.error });
    load();
  };

  const connected = !!status?.chatId && status.tokenOk;
  const botLink = status?.botUsername ? `https://t.me/${status.botUsername}` : '';

  return (
    <div className="space-y-4">
      {/* Статус */}
      {loading ? (
        <div className="text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Проверяю подключение…
        </div>
      ) : !status ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          Не удалось получить состояние. Проверьте интернет и обновите страницу.
        </div>
      ) : connected ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <b>Уведомления включены</b>
            {status.botUsername && <> (бот @{status.botUsername})</>}. О новых заявках и отзывах придёт сообщение в Telegram.
          </span>
        </div>
      ) : !status.tokenSet ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-sm px-4 py-3">
          <b>Не настроено.</b> Токен бота ещё не добавлен на сервер: выполните шаги 1–2 ниже.
        </div>
      ) : !status.tokenOk ? (
        <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm px-4 py-3">
          <b>Telegram не принял токен.</b> Проверьте, что в переменной <code className="font-mono">TELEGRAM_BOT_TOKEN</code>{' '}
          токен скопирован целиком, без пробелов, и сделайте Redeploy.
        </div>
      ) : (
        <div className="rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-sm px-4 py-3">
          <b>Бот найден{status.botUsername ? ` (@${status.botUsername})` : ''}, осталось выбрать, кому слать уведомления</b>
          : выполните шаги 3–4 ниже.
        </div>
      )}

      {/* Инструкция */}
      <ol className="space-y-2 text-sm text-slate-700 leading-relaxed list-decimal pl-5">
        <li>
          В Telegram найдите <b>@BotFather</b>, отправьте ему <code className="font-mono">/newbot</code>, придумайте название и
          логин (должен заканчиваться на <code className="font-mono">bot</code>). BotFather пришлёт <b>токен</b>, длинную строку
          с двоеточием.
        </li>
        <li>
          Vercel → проект → Settings → Environment Variables: добавьте <code className="font-mono">TELEGRAM_BOT_TOKEN</code> со
          значением токена и сделайте <b>Redeploy</b>. Токен никому не показывайте.
        </li>
        <li>
          Откройте вашего бота
          {botLink ? (
            <>
              {' '}
              (<a href={botLink} target="_blank" rel="noopener noreferrer" className="text-brand underline">{botLink}</a>)
            </>
          ) : null}{' '}
          в Telegram, нажмите <b>Start</b> и отправьте ему любое сообщение.
        </li>
        <li>Нажмите кнопку «Найти мой Telegram» ниже и выберите себя из списка.</li>
        <li>Нажмите «Отправить тестовое сообщение», чтобы убедиться, что всё работает.</li>
      </ol>

      {/* Действия */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={find}
          disabled={busy !== null || !status?.tokenOk}
          className={`${btn} bg-white border border-slate-300 hover:bg-slate-50 text-slate-700`}
        >
          {busy === 'find' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Найти мой Telegram
        </button>
        <button
          type="button"
          onClick={test}
          disabled={busy !== null || !connected}
          className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}
        >
          {busy === 'test' && <Loader2 className="w-4 h-4 animate-spin" />}
          Отправить тестовое сообщение
        </button>
        {status?.chatId && !status.chatFromEnv && (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy !== null}
            className={`${btn} bg-white border border-slate-300 hover:bg-rose-50 text-rose-700`}
          >
            Отключить
          </button>
        )}
      </div>

      {/* Найденные чаты */}
      {chats && chats.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2">
          <div className="text-sm font-semibold text-blue-900">Кто писал боту. Выберите себя:</div>
          {chats.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 bg-white rounded-lg px-3 py-2 border border-blue-100">
              <div className="min-w-0 text-sm">
                <div className="font-semibold text-slate-800 truncate">{c.name || 'Без имени'}</div>
                <div className="text-xs text-slate-500 truncate">
                  {c.username ? `@${c.username} · ` : ''}
                  {c.type === 'private' ? 'личный чат' : c.type}
                </div>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => select(c)}
                className={`${btn} bg-blue-600 hover:bg-blue-700 text-white shrink-0`}
              >
                {busy === `select:${c.id}` && <Loader2 className="w-4 h-4 animate-spin" />}
                Это я
              </button>
            </div>
          ))}
          <p className="text-xs text-slate-500">
            Подключайте только свой чат: сюда будут приходить имена и телефоны клиентов.
          </p>
        </div>
      )}

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            msg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {msg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="break-words">{msg.text}</span>
        </div>
      )}
    </div>
  );
};
