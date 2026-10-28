export interface BusySlot {
  start: string;
  end: string;
  id?: string; // есть только у заявок клиентов
}
export type BusyMap = Record<string, BusySlot[]>;

export interface BookingInput {
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string; // HH:mm
  type: 'kids' | 'adults';
  name: string;
  phone: string;
  note?: string;
  website?: string; // скрытое поле-ловушка для ботов, у людей всегда пустое
}

export interface Booking extends Omit<BookingInput, 'website'> {
  id: string;
  createdAt: number;
}

const isJson = (res: Response) => (res.headers.get('content-type') || '').includes('application/json');

/** Занятое время (без деталей) на период. null — сервер не ответил. */
export async function fetchAvailability(code: string, from: string, to: string): Promise<BusyMap | null> {
  try {
    const res = await fetch(`/api/availability/${code}?from=${from}&to=${to}`, { cache: 'no-store' });
    if (!res.ok || !isJson(res)) return null;
    const json = await res.json();
    return json && typeof json.busy === 'object' ? (json.busy as BusyMap) : null;
  } catch (e) {
    return null;
  }
}

export type CreateResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'busy' | 'rate' | 'invalid' | 'error'; message: string };

export async function createBooking(code: string, input: BookingInput): Promise<CreateResult> {
  try {
    const res = await fetch(`/api/bookings/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = isJson(res) ? await res.json().catch(() => ({})) : {};
    if (res.status === 201 && json.id) return { ok: true, booking: json as Booking };
    const message = typeof json.message === 'string' ? json.message : '';
    if (res.status === 409) return { ok: false, reason: 'busy', message: message || 'Это время уже занято.' };
    if (res.status === 429) return { ok: false, reason: 'rate', message: message || 'Слишком много заявок. Попробуйте позже.' };
    if (res.status === 400) return { ok: false, reason: 'invalid', message: message || 'Проверьте введённые данные.' };
    return { ok: false, reason: 'error', message: message || 'Не удалось отправить заявку. Попробуйте ещё раз.' };
  } catch (e) {
    return { ok: false, reason: 'error', message: 'Нет связи с сервером. Проверьте интернет и повторите.' };
  }
}

/** Все заявки с контактами (только для администратора). null — недоступно. */
export async function fetchBookings(code: string): Promise<Booking[] | null> {
  try {
    const res = await fetch(`/api/bookings/${code}`, { cache: 'no-store' });
    if (!res.ok || !isJson(res)) return null;
    const json = await res.json();
    return Array.isArray(json.bookings) ? (json.bookings as Booking[]) : null;
  } catch (e) {
    return null;
  }
}

export async function deleteBooking(code: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/bookings/${code}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/* ---------- «Мои заявки»: хранятся только в браузере клиента ---------- */
const MY_KEY = 'myBookings';

export function loadMyBookings(): Booking[] {
  try {
    const a = JSON.parse(localStorage.getItem(MY_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}

export function saveMyBookings(list: Booking[]): void {
  try {
    localStorage.setItem(MY_KEY, JSON.stringify(list.slice(-50)));
  } catch (e) {}
}

/* ---------- Вспомогательное для времени ---------- */
export const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const fromMinutes = (n: number): string =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** Свободные окна внутри рабочего дня (для подсказок): длиной не меньше minLen минут. */
export function freeWindows(
  busy: BusySlot[],
  dayStart = 8 * 60,
  dayEnd = 22 * 60,
  minLen = 30
): Array<{ start: string; end: string }> {
  const sorted = busy
    .map((b) => ({ s: toMinutes(b.start), e: b.end === '24:00' ? 1440 : toMinutes(b.end) }))
    .sort((a, b) => a.s - b.s);
  const out: Array<{ start: string; end: string }> = [];
  let cursor = dayStart;
  for (const b of sorted) {
    if (b.s - cursor >= minLen) out.push({ start: fromMinutes(cursor), end: fromMinutes(Math.min(b.s, dayEnd)) });
    cursor = Math.max(cursor, b.e);
    if (cursor >= dayEnd) break;
  }
  if (dayEnd - cursor >= minLen) out.push({ start: fromMinutes(cursor), end: fromMinutes(dayEnd) });
  return out;
}
