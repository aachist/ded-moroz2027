/**
 * Часы работы по дням недели и закрытые даты (настраиваются на странице «Настройки»).
 * Правила хранит сервер (/api/hours/:code); окно записи на дату считается одной и той же логикой
 * на сайте (чтобы показать «не работаем») и на сервере (чтобы нельзя было обойти сайт).
 */

/** Окно записи целыми часами: open 0..23, close 1..24 (close > open). */
export interface HoursWindow {
  open: number;
  close: number;
}

export interface HoursException {
  date: string; // YYYY-MM-DD
  closed: boolean; // true — запись на эту дату закрыта; false — особые часы open–close
  open?: number;
  close?: number;
  note?: string; // видна клиентам, например «Новый год»
}

export interface HoursRules {
  /** Индекс — день недели как в JS: 0 — воскресенье … 6 — суббота. null — не работаем. */
  weekly: Array<HoursWindow | null>;
  exceptions: HoursException[];
}

/** Правила «открыто всегда»: так сайт работал, пока часы не настроены. */
export const DEFAULT_HOURS: HoursRules = {
  weekly: Array.from({ length: 7 }, () => ({ open: 0, close: 24 })),
  exceptions: [],
};

/** Порядок дней в интерфейсе: с понедельника. Значение — индекс дня в JS (getDay). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAMES: Record<number, string> = {
  0: 'Воскресенье',
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
};

export const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`;

/** День недели по строке YYYY-MM-DD (без влияния часового пояса). */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Исключение на дату, если есть. */
export const exceptionFor = (rules: HoursRules, date: string): HoursException | undefined =>
  rules.exceptions.find((x) => x.date === date);

/** Окно записи на дату: исключение важнее недельных часов. null — запись закрыта. */
export function windowFor(rules: HoursRules, date: string): HoursWindow | null {
  const ex = exceptionFor(rules, date);
  if (ex) return ex.closed ? null : { open: Number(ex.open), close: Number(ex.close) };
  return rules.weekly[weekdayOf(date)] || null;
}

/** Короткое описание для подписей: «с 10:00 до 20:00» / «закрыто». */
export function describeWindow(w: HoursWindow | null): string {
  return w ? `с ${hourLabel(w.open)} до ${hourLabel(w.close)}` : 'закрыто';
}

const isJson = (res: Response) => (res.headers.get('content-type') || '').includes('application/json');

/** Правила с сервера. Если ничего не настроено — «открыто всегда». null — сервер не ответил. */
export async function fetchHours(code: string): Promise<HoursRules | null> {
  try {
    const res = await fetch(`/api/hours/${code}`, { cache: 'no-store' });
    if (!res.ok || !isJson(res)) return null;
    const j = await res.json();
    if (!Array.isArray(j.weekly) || j.weekly.length !== 7) return DEFAULT_HOURS;
    return {
      weekly: j.weekly as Array<HoursWindow | null>,
      exceptions: Array.isArray(j.exceptions) ? (j.exceptions as HoursException[]) : [],
    };
  } catch {
    return null;
  }
}

/** Сохранение правил (только администратор). Возвращает текст ошибки или null, если всё сохранено. */
export async function saveHours(code: string, rules: HoursRules): Promise<string | null> {
  try {
    const res = await fetch(`/api/hours/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules),
    });
    if (res.ok) return null;
    const j = isJson(res) ? await res.json().catch(() => ({})) : {};
    if (res.status === 401) return 'Нужно войти как администратор.';
    return typeof j.error === 'string' ? j.error : `Не удалось сохранить (ошибка ${res.status}).`;
  } catch {
    return 'Нет связи с сервером. Проверьте интернет и повторите.';
  }
}
