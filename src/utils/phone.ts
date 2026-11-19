/**
 * Телефон с кодом страны +7: клиент вводит 10 цифр, код +7 подставляется сам.
 * Принимаются также вставленные номера вида 8 900…, 7 900…, +7 (900)… (лишняя первая цифра отбрасывается).
 * Сервер проверяет то же самое (api/bookings.ts), так что обойти проверку сайтом нельзя.
 */

export const PHONE_LENGTH = 10;

/** Из любого ввода получаем до 10 национальных цифр (без кода страны). */
export function normalizePhoneInput(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length >= PHONE_LENGTH + 1 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
  return d.slice(0, PHONE_LENGTH);
}

/** Номер полный: 10 цифр, первая 2–9 (номеров на 0 и 1 не бывает). */
export const isPhoneComplete = (digits: string): boolean => /^[2-9]\d{9}$/.test(digits);

/** Постепенное форматирование при вводе: «(900) 111-22-33». */
export function formatNational(d: string): string {
  let s = '';
  if (d.length > 0) s = '(' + d.slice(0, 3);
  if (d.length >= 3) s += ')';
  if (d.length > 3) s += ' ' + d.slice(3, 6);
  if (d.length > 6) s += '-' + d.slice(6, 8);
  if (d.length > 8) s += '-' + d.slice(8, 10);
  return s;
}

/** Полный номер для отправки: «+7 (900) 111-22-33». */
export const fullPhone = (digits: string): string => `+7 ${formatNational(digits)}`;
