/**
 * Размер текста для слабовидящих (кнопка «A+» в шапке).
 * Масштабируется размер шрифта страницы: все размеры в rem (заголовки, текст, кнопки, плитки) растут вместе с ним.
 * Выбор запоминается на устройстве. Тот же расчёт в index.html (применяется до отрисовки, чтобы страница не «прыгала»).
 */

export type FontScaleId = 'normal' | 'large' | 'xlarge';

export const FONT_SCALES: Array<{ id: FontScaleId; percent: number; label: string; hint: string }> = [
  { id: 'normal', percent: 100, label: 'Обычный', hint: 'Стандартный размер текста' },
  { id: 'large', percent: 125, label: 'Крупный', hint: 'Текст крупнее на четверть' },
  { id: 'xlarge', percent: 150, label: 'Очень крупный', hint: 'Текст крупнее в полтора раза' },
];

const KEY = 'dm_font_scale';

export function getFontScale(): FontScaleId {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'large' || v === 'xlarge' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function applyFontScale(id: FontScaleId): void {
  const s = FONT_SCALES.find((x) => x.id === id) || FONT_SCALES[0];
  document.documentElement.style.fontSize = s.percent === 100 ? '' : `${s.percent}%`;
}

export function setFontScale(id: FontScaleId): void {
  try {
    if (id === 'normal') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {}
  applyFontScale(id);
}
