import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Режим отображения: сайт сам определяет, что его открыли с телефона, и показывает мобильную версию.
 *  - «телефон» определяется по устройству (userAgentData / User-Agent), а не только по ширине окна,
 *    поэтому мобильная версия включается и при повороте телефона горизонтально;
 *  - узкое окно браузера на компьютере (до 640 px) тоже получает мобильную версию;
 *  - посетитель может переключить вид вручную (ссылка внизу страницы), выбор запоминается.
 * Логика совпадает со скриптом в index.html, который ставит data-device до отрисовки.
 */
export type ViewMode = 'auto' | 'mobile' | 'desktop';

const MODE_KEY = 'viewMode';
const PHONE_RE = /Android.*Mobile|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|webOS|\bMobi\b/i;
export const NARROW_QUERY = '(max-width: 640px)';

/** Телефон ли это: по подсказке браузера (Chromium) или по User-Agent. Планшеты в «телефоны» не попадают. */
export function isPhoneDevice(userAgent: string, uaDataMobile?: boolean): boolean {
  if (uaDataMobile === true) return true;
  return PHONE_RE.test(userAgent || '');
}

/** Итоговое решение: какой вид показывать. */
export function decideMobile(mode: ViewMode, phone: boolean, narrow: boolean): boolean {
  if (mode === 'mobile') return true;
  if (mode === 'desktop') return false;
  return phone || narrow;
}

function readMode(): ViewMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'mobile' || v === 'desktop' ? v : 'auto';
  } catch (e) {
    return 'auto';
  }
}

export interface DeviceInfo {
  isMobile: boolean; // показывать мобильную версию
  isPhone: boolean; // само устройство — телефон
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
}

export function useDevice(): DeviceInfo {
  const [mode, setModeState] = useState<ViewMode>(readMode);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches);

  const isPhone = useMemo(
    () => isPhoneDevice(navigator.userAgent, (navigator as any).userAgentData?.mobile),
    []
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isMobile = decideMobile(mode, isPhone, narrow);

  // Метка на <html>: по ней CSS подстраивает оформление под телефон
  useEffect(() => {
    document.documentElement.setAttribute('data-device', isMobile ? 'mobile' : 'desktop');
  }, [isMobile]);

  const setMode = useCallback((m: ViewMode) => {
    try {
      if (m === 'auto') localStorage.removeItem(MODE_KEY);
      else localStorage.setItem(MODE_KEY, m);
    } catch (e) {}
    setModeState(m);
  }, []);

  return { isMobile, isPhone, mode, setMode };
}
