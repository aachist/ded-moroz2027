export interface Session {
  admin: boolean;
  configured: boolean; // задан ли пароль администратора на сервере
}

/** Текущий статус входа. null — сервер не ответил (например, нет связи). */
export async function getSession(): Promise<Session | null> {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('application/json')) return null;
    const j = await res.json();
    return { admin: !!j.admin, configured: !!j.configured };
  } catch (e) {
    return null;
  }
}

export type LoginResult = 'ok' | 'wrong' | 'too_many' | 'not_configured' | 'error';

export async function login(password: string): Promise<LoginResult> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return 'ok';
    if (res.status === 401) return 'wrong';
    if (res.status === 429) return 'too_many';
    if (res.status === 503) return 'not_configured';
    return 'error';
  } catch (e) {
    return 'error';
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
}
