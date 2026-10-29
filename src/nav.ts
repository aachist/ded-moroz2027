import { useCallback, useEffect, useState } from 'react';

export type PageKey = 'home' | 'schedule' | 'media' | 'variants' | 'rules' | 'reviews' | 'contacts' | 'help';

export const PAGE_LABELS: Record<PageKey, string> = {
  home: 'Главная',
  schedule: 'Запись на вызов',
  media: 'Смотреть примеры встреч с Дедом Морозом',
  variants: 'Варианты встреч с Дедом Морозом',
  rules: 'Правила встреч с Дедом Морозом',
  reviews: 'Отзывы',
  contacts: 'Контакты Деда Мороза',
  help: 'Инструкция',
};

/** Страницы, видимые клиентам (по порядку в меню). */
export const CLIENT_PAGES: PageKey[] = ['schedule', 'media', 'variants', 'rules', 'reviews', 'contacts'];
/** Страницы администратора: те же + инструкция и резервные копии. */
export const ADMIN_PAGES: PageKey[] = [...CLIENT_PAGES, 'help'];

const ALL: PageKey[] = ['home', ...ADMIN_PAGES];

function readHash(): PageKey {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (ALL as string[]).includes(h) ? (h as PageKey) : 'home';
}

/**
 * Текущая страница хранится в адресе (#media, #reviews…): работают кнопка «Назад» браузера
 * и прямые ссылки на разделы. Недоступные страницы (например, #help у клиента) ведут на главную.
 */
export function useHashPage(allowed: PageKey[]): [PageKey, (p: PageKey) => void] {
  const [page, setPageState] = useState<PageKey>(readHash);

  useEffect(() => {
    const onChange = () => {
      setPageState(readHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const setPage = useCallback((p: PageKey) => {
    if (p === 'home') {
      // чистый адрес для главной
      history.pushState(null, '', window.location.pathname + window.location.search);
      setPageState('home');
      window.scrollTo({ top: 0 });
    } else {
      window.location.hash = `#${p}`;
    }
  }, []);

  const effective: PageKey = page === 'home' || allowed.includes(page) ? page : 'home';
  return [effective, setPage];
}
