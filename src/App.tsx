import React, { useEffect, useState, useCallback, useRef } from 'react';
import { DaySchedule, MediaItem } from './types';
import {
  WORKSPACE_CODE,
  fetchSchedule,
  saveScheduleLocal,
  pushScheduleRemote,
  requestPersistentStorage,
  fetchMediaList,
} from './utils/storage';
import { getSession, logout, Session } from './utils/auth';
import { fetchBookings, deleteBooking, Booking } from './utils/bookings';
import { fetchContent, saveContent, telHref, SiteContent, EMPTY_CONTENT, Contacts } from './utils/content';
import { PageKey, PAGE_LABELS, CLIENT_PAGES, ADMIN_PAGES, useHashPage } from './nav';
import { SiteHeader } from './components/SiteHeader';
import { HomePage } from './components/HomePage';
import { PageShell, SiteFooter } from './components/PageParts';
import { ContentPage } from './components/ContentPage';
import { ContactsPage } from './components/ContactsPage';
import { ReviewsPage } from './components/ReviewsPage';
import { ScheduleView } from './components/ScheduleView';
import { ClientScheduleView } from './components/ClientScheduleView';
import { MediaGallery } from './components/MediaGallery';
import { HelpView } from './components/HelpView';
import { LoginForm } from './components/LoginForm';

// Все устройства работают в одном общем пространстве: коды синхронизации не нужны
const syncCode = WORKSPACE_CODE;

// admin — полный доступ (после входа по паролю);
// client — клиентская часть сайта: запись на свободное время, примеры встреч, варианты, правила, отзывы, контакты
type Role = 'loading' | 'admin' | 'client';

export default function App() {
  const [role, setRole] = useState<Role>('loading');
  const [authConfigured, setAuthConfigured] = useState(true);

  const [page, setPage] = useHashPage(role === 'admin' ? ADMIN_PAGES : CLIENT_PAGES);

  const [schedule, setSchedule] = useState<DaySchedule>({});
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]); // заявки клиентов (видит только администратор)
  const [content, setContent] = useState<SiteContent>(EMPTY_CONTENT); // контакты и тексты страниц
  const [syncStatus, setSyncStatus] = useState<string>('Проверка связи…');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Счётчик правок и число отправок "в полёте": по ним loadData понимает,
  // что пока он грузил данные, пользователь успел изменить расписание.
  const editVersionRef = useRef(0);
  const pendingPushesRef = useRef(0);

  const applySession = useCallback((s: Session | null) => {
    if (!s) return; // нет связи — оставляем текущий режим
    setRole(s.admin ? 'admin' : 'client');
    setAuthConfigured(s.configured);
  }, []);

  // Первая проверка: кто пришёл — администратор или клиент
  useEffect(() => {
    getSession().then((s) => {
      if (s) applySession(s);
      else setRole('client'); // сервер не ответил: безопасный режим
    });
  }, [applySession]);

  // Контакты и тексты страниц (публичные): подгружаем для всех
  const loadContent = useCallback(async () => {
    const c = await fetchContent(syncCode);
    if (c) setContent((prev) => (JSON.stringify(prev) === JSON.stringify(c) ? prev : c));
  }, []);

  // ---- Режим администратора ----
  const loadData = useCallback(async () => {
    const editsAtStart = editVersionRef.current;
    try {
      // Если сессия закончилась — возвращаемся в режим клиента
      const s = await getSession();
      if (s && !s.admin) {
        setSchedule({});
        setMediaList([]);
        setBookings([]);
        setRole('client');
        return;
      }

      setSyncStatus('Синхронизация…');
      const [schedData, mediaData, bookingsData] = await Promise.all([
        fetchSchedule(syncCode),
        fetchMediaList(syncCode),
        fetchBookings(syncCode),
        loadContent(),
      ]);

      setMediaList(mediaData);
      if (bookingsData) {
        setBookings((prev) => (JSON.stringify(prev) === JSON.stringify(bookingsData) ? prev : bookingsData));
      }

      const userEditedMeanwhile =
        editVersionRef.current !== editsAtStart ||
        saveTimerRef.current !== null ||
        pendingPushesRef.current > 0;

      if (!userEditedMeanwhile) {
        // Не пересоздаём состояние, если ничего не изменилось
        setSchedule((prev) =>
          JSON.stringify(prev) === JSON.stringify(schedData) ? prev : schedData
        );
        setSyncStatus(`Синхронизировано в ${new Date().toLocaleTimeString('ru-RU')}`);
      }
    } catch (err) {
      console.error(err);
      setSyncStatus('Данные сохранены на этом устройстве');
    }
  }, [loadContent]);

  // ---- Режим клиента: только чтение ----
  const loadClientData = useCallback(async () => {
    try {
      const [list] = await Promise.all([fetchMediaList(syncCode, { readOnly: true }), loadContent()]);
      setMediaList(list);
    } catch (err) {
      console.error(err);
    }
  }, [loadContent]);

  // Загрузка и периодический опрос: изменения с других устройств подтягиваются раз в 20 секунд
  useEffect(() => {
    if (role === 'loading') return;
    const run = role === 'admin' ? loadData : loadClientData;
    run();
    const interval = setInterval(run, 20000);
    return () => clearInterval(interval);
  }, [role, loadData, loadClientData]);

  useEffect(() => {
    if (role === 'admin') requestPersistentStorage();
  }, [role]);

  // Сохранение мероприятий: в браузере сразу, на сервер — с небольшой задержкой
  const handleUpdateSchedule = (newSchedule: DaySchedule) => {
    editVersionRef.current += 1;
    setSchedule(newSchedule);
    setSyncStatus('Сохранение…');

    const updatedAt = saveScheduleLocal(syncCode, newSchedule);

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      pendingPushesRef.current += 1;
      try {
        const ok = await pushScheduleRemote(syncCode, newSchedule, updatedAt);
        const time = new Date().toLocaleTimeString('ru-RU');
        setSyncStatus(
          ok
            ? `✅ Сохранено в ${time}`
            : `⚠️ Сохранено только на этом устройстве (${time}): нет связи с сервером или нужно войти заново`
        );
      } finally {
        pendingPushesRef.current -= 1;
      }
    }, 400);
  };

  const refreshMedia = () =>
    fetchMediaList(syncCode, { readOnly: role !== 'admin' }).then(setMediaList);

  const handleDeleteBooking = async (id: string): Promise<boolean> => {
    const ok = await deleteBooking(syncCode, id);
    if (ok) setBookings((prev) => prev.filter((b) => b.id !== id));
    return ok;
  };

  // Сохранение текстов и контактов (администратор). Возвращает текст ошибки или null.
  const saveText = (field: 'variants' | 'rules') => async (text: string): Promise<string | null> => {
    const res = await saveContent(syncCode, { [field]: text });
    if (!res.ok) return res.message;
    setContent(res.content);
    return null;
  };
  const saveContacts = async (contacts: Contacts): Promise<string | null> => {
    const res = await saveContent(syncCode, { contacts });
    if (!res.ok) return res.message;
    setContent(res.content);
    return null;
  };

  const handleLogout = async () => {
    await logout();
    setSchedule({});
    setMediaList([]);
    setBookings([]);
    setPage('home');
    setRole('client');
  };

  const handleLoginSuccess = async () => {
    setSchedule({});
    setMediaList([]);
    applySession(await getSession());
  };

  if (role === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Загрузка…</div>
    );
  }

  const isAdmin = role === 'admin';
  const phoneHref = telHref(content.contacts.phone);

  const renderPage = (p: PageKey): React.ReactNode => {
    switch (p) {
      case 'home':
        return <HomePage setPage={setPage} phoneHref={phoneHref} isAdmin={isAdmin} />;

      case 'schedule':
        return (
          <PageShell title={PAGE_LABELS.schedule} onBack={() => setPage('home')}>
            {isAdmin ? (
              <ScheduleView
                schedule={schedule}
                onUpdateSchedule={handleUpdateSchedule}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                bookings={bookings}
                onDeleteBooking={handleDeleteBooking}
              />
            ) : (
              <ClientScheduleView syncCode={syncCode} />
            )}
          </PageShell>
        );

      case 'media':
        return (
          <PageShell title={PAGE_LABELS.media} onBack={() => setPage('home')}>
            <MediaGallery
              mediaList={mediaList}
              syncCode={syncCode}
              onRefreshMedia={refreshMedia}
              readOnly={!isAdmin}
            />
          </PageShell>
        );

      case 'variants':
        return (
          <PageShell title={PAGE_LABELS.variants} onBack={() => setPage('home')}>
            <ContentPage
              text={content.variants}
              isAdmin={isAdmin}
              onSave={saveText('variants')}
              emptyHint="Описание вариантов встреч появится совсем скоро. А пока позвоните нам, и мы всё расскажем!"
            />
          </PageShell>
        );

      case 'rules':
        return (
          <PageShell title={PAGE_LABELS.rules} onBack={() => setPage('home')}>
            <ContentPage
              text={content.rules}
              isAdmin={isAdmin}
              onSave={saveText('rules')}
              emptyHint="Правила встреч появятся совсем скоро."
            />
          </PageShell>
        );

      case 'reviews':
        return (
          <PageShell title={PAGE_LABELS.reviews} onBack={() => setPage('home')}>
            <ReviewsPage syncCode={syncCode} isAdmin={isAdmin} />
          </PageShell>
        );

      case 'contacts':
        return (
          <PageShell title={PAGE_LABELS.contacts} onBack={() => setPage('home')}>
            <ContactsPage contacts={content.contacts} isAdmin={isAdmin} onSave={saveContacts} />
          </PageShell>
        );

      case 'help':
        return (
          <PageShell title={PAGE_LABELS.help} onBack={() => setPage('home')}>
            <HelpView
              schedule={schedule}
              onUpdateSchedule={handleUpdateSchedule}
              mediaList={mediaList}
              bookings={bookings}
              syncCode={syncCode}
              onRefreshMedia={refreshMedia}
            />
          </PageShell>
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader
        page={page}
        setPage={setPage}
        pages={isAdmin ? ADMIN_PAGES : CLIENT_PAGES}
        phoneHref={phoneHref}
        isAdmin={isAdmin}
        syncStatus={syncStatus}
        mediaCount={mediaList.length}
        onLogout={authConfigured ? handleLogout : undefined}
      />

      <main className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-6 py-6 sm:py-8">
        {isAdmin && !authConfigured && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3">
            ⚠️ <b>Пароль администратора не задан: сейчас сайт открыт всем, у кого есть ссылка.</b> Добавьте переменную{' '}
            <code className="font-mono">ADMIN_PASSWORD</code> в Vercel (Settings → Environment Variables) и нажмите
            Redeploy.
          </div>
        )}
        {renderPage(page)}
      </main>

      <SiteFooter contacts={content.contacts}>
        {!isAdmin && <LoginForm onSuccess={handleLoginSuccess} onDark />}
      </SiteFooter>
    </div>
  );
}
