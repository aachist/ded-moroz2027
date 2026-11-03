export interface TgStatus {
  tokenSet: boolean; // задан ли токен бота на сервере
  tokenOk: boolean; // принял ли Telegram этот токен
  botUsername: string;
  chatId: string | null; // кому приходят уведомления
  chatFromEnv: boolean;
}

export interface TgChat {
  id: string;
  type: string;
  name: string;
  username: string;
}

export async function tgStatus(code: string): Promise<TgStatus | null> {
  try {
    const res = await fetch(`/api/telegram/${code}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as TgStatus;
  } catch (e) {
    return null;
  }
}

export type TgResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

async function post<T>(code: string, body: object): Promise<TgResult<T>> {
  try {
    const res = await fetch(`/api/telegram/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, error: 'Нужно войти как администратор заново.' };
    if (j && j.ok === true) return j as TgResult<T>;
    return { ok: false, error: typeof j.error === 'string' ? j.error : 'Не удалось выполнить действие' };
  } catch (e) {
    return { ok: false, error: 'Нет связи с сервером. Проверьте интернет и повторите.' };
  }
}

export const tgFind = (code: string) => post<{ chats: TgChat[] }>(code, { action: 'find' });
export const tgSelect = (code: string, chatId: string) => post(code, { action: 'select', chatId });
export const tgTest = (code: string) => post(code, { action: 'test' });
export const tgDisconnect = (code: string) => post(code, { action: 'disconnect' });
