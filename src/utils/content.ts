export interface Contacts {
  phone: string;
  telegram: string;
  email: string;
}

export interface SiteContent {
  contacts: Contacts;
  variants: string; // «Варианты встреч с Дедом Морозом» (редактирует администратор)
  rules: string; // «Правила встреч с Дедом Морозом» (редактирует администратор)
  updatedAt: number;
}

export const EMPTY_CONTENT: SiteContent = {
  contacts: { phone: '', telegram: '', email: '' },
  variants: '',
  rules: '',
  updatedAt: 0,
};

const isJson = (res: Response) => (res.headers.get('content-type') || '').includes('application/json');

/** Содержимое сайта (публично). null — сервер не ответил. */
export async function fetchContent(code: string): Promise<SiteContent | null> {
  try {
    const res = await fetch(`/api/content/${code}`, { cache: 'no-store' });
    if (!res.ok || !isJson(res)) return null;
    const j = await res.json();
    return {
      contacts: {
        phone: String(j.contacts?.phone ?? ''),
        telegram: String(j.contacts?.telegram ?? ''),
        email: String(j.contacts?.email ?? ''),
      },
      variants: String(j.variants ?? ''),
      rules: String(j.rules ?? ''),
      updatedAt: Number(j.updatedAt) || 0,
    };
  } catch (e) {
    return null;
  }
}

export type SaveResult = { ok: true; content: SiteContent } | { ok: false; message: string };

/** Сохранение (только администратор). Можно передать любые из полей contacts / variants / rules. */
export async function saveContent(
  code: string,
  patch: Partial<Pick<SiteContent, 'contacts' | 'variants' | 'rules'>>
): Promise<SaveResult> {
  try {
    const res = await fetch(`/api/content/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const j = isJson(res) ? await res.json().catch(() => ({})) : {};
    if (res.ok) return { ok: true, content: j as SiteContent };
    if (res.status === 401) return { ok: false, message: 'Нужно войти как администратор заново.' };
    return { ok: false, message: typeof j.error === 'string' ? j.error : 'Не удалось сохранить. Попробуйте ещё раз.' };
  } catch (e) {
    return { ok: false, message: 'Нет связи с сервером. Проверьте интернет и повторите.' };
  }
}

/* ---------- Ссылки для контактов ---------- */

/** Телефон -> tel:-ссылка (только цифры и ведущий +; 8… превращаем в +7…) */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return `tel:${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `tel:+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `tel:+${digits}`;
  return `tel:${digits}`;
}

/** @имя или ссылка -> https-ссылка на Telegram */
export function telegramHref(tg: string): string {
  const v = tg.trim();
  if (!v) return '';
  if (v.startsWith('@')) return `https://t.me/${v.slice(1)}`;
  return v;
}

/* ---------- Отзывы ---------- */
export interface Review {
  id: string;
  name: string;
  text: string;
  rating: number;
  createdAt: number;
  status?: 'approved' | 'pending'; // приходит только администратору
}

export async function fetchReviews(code: string, all = false): Promise<Review[] | null> {
  try {
    const res = await fetch(`/api/reviews/${code}${all ? '?all=1' : ''}`, { cache: 'no-store' });
    if (!res.ok || !isJson(res)) return null;
    const j = await res.json();
    return Array.isArray(j.reviews) ? (j.reviews as Review[]) : null;
  } catch (e) {
    return null;
  }
}

export type ReviewResult = { ok: true; pending: boolean } | { ok: false; message: string };

export async function createReview(
  code: string,
  input: { name: string; text: string; rating: number; website?: string }
): Promise<ReviewResult> {
  try {
    const res = await fetch(`/api/reviews/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const j = isJson(res) ? await res.json().catch(() => ({})) : {};
    if (res.status === 201) return { ok: true, pending: j.pending !== false && j.status !== 'approved' };
    return { ok: false, message: typeof j.message === 'string' ? j.message : 'Не удалось отправить отзыв. Попробуйте позже.' };
  } catch (e) {
    return { ok: false, message: 'Нет связи с сервером. Проверьте интернет и повторите.' };
  }
}

export async function updateReview(
  code: string,
  id: string,
  patch: Partial<Pick<Review, 'status' | 'name' | 'text' | 'rating'>>
): Promise<boolean> {
  try {
    const res = await fetch(`/api/reviews/${code}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function deleteReview(code: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/reviews/${code}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch (e) {
    return false;
  }
}
