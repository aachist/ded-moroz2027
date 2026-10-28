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
import { Header, TabKey } from './components/Header';
import { ScheduleView } from './components/ScheduleView';
import { ClientScheduleView } from './components/ClientScheduleView';
import { MediaGallery } from './components/MediaGallery';
import { HelpView } from './components/HelpView';
import { LoginForm } from './components/LoginForm';

// Все устройства работают в одном общем пространстве: коды синхронизации не нужны
const syncCode = WORKSPACE_CODE;

// admin — полный доступ (после входа по паролю);
// client — две страницы: запись на свободное время (чужие заказы видны только как «Занято») и просмотр фото/видео
type Role = 'loading' | 'admin' | 'client';

export default function App() {
  const [role, setRole] = useState<Role>('loading');
  const [authConfigured, setAuthConfigured] = useState(true);

  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const [schedule, setSchedule] = useState<DaySchedule>({});
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]); // заявки клиентов (видит только администратор)
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
      else setRole('client'); // сервер не ответил: безопасный режим — только просмотр
    });
  }, [applySession]);

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
  }, []);

  // ---- Режим клиента: только чтение списка фото и видео ----
  const loadClientData = useCallback(async () => {
    try {
      const list = await fetchMediaList(syncCode, { readOnly: true });
      setMediaList(list);
    } catch (err) {
      console.error(err);
    }
  }, []);

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

  const handleLogout = async () => {
    await logout();
    setSchedule({});
    setMediaList([]);
    setBookings([]);
    setActiveTab('schedule');
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

  // ---- Клиент: запись на свободное время + просмотр фото и видео ----
  if (role === 'client') {
    const clientTab: TabKey = activeTab === 'media' ? 'media' : 'schedule';
    return (
      <div className="min-h-screen pb-16">
        <div className="max-w-4xl mx-auto px-3 sm:px-6 pt-6 sm:pt-8">
          <Header
            activeTab={clientTab}
            setActiveTab={setActiveTab}
            mediaCount={mediaList.length}
            syncStatus=""
            clientMode
          />
          <main>
            {clientTab === 'schedule' ? (
              <ClientScheduleView syncCode={syncCode} />
            ) : (
              <MediaGallery mediaList={mediaList} syncCode={syncCode} onRefreshMedia={refreshMedia} readOnly />
            )}
          </main>
          <LoginForm onSuccess={handleLoginSuccess} />
        </div>
      </div>
    );
  }

  // ---- Администратор: весь сайт ----
  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-4xl mx-auto px-3 sm:px-6 pt-6 sm:pt-8">
        {!authConfigured && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3">
            ⚠️ <b>Пароль администратора не задан: сейчас сайт открыт всем, у кого есть ссылка.</b> Добавьте переменную{' '}
            <code className="font-mono">ADMIN_PASSWORD</code> в Vercel (Settings → Environment Variables) и нажмите
            Redeploy.
          </div>
        )}

        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          mediaCount={mediaList.length}
          syncStatus={syncStatus}
          onLogout={authConfigured ? handleLogout : undefined}
        />

        <main className="transition-all duration-200">
          {activeTab === 'schedule' && (
            <ScheduleView
              schedule={schedule}
              onUpdateSchedule={handleUpdateSchedule}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              bookings={bookings}
              onDeleteBooking={handleDeleteBooking}
            />
          )}

          {activeTab === 'media' && (
            <MediaGallery mediaList={mediaList} syncCode={syncCode} onRefreshMedia={refreshMedia} />
          )}

          {activeTab === 'help' && (
            <HelpView
              schedule={schedule}
              onUpdateSchedule={handleUpdateSchedule}
              mediaList={mediaList}
              bookings={bookings}
              syncCode={syncCode}
              onRefreshMedia={refreshMedia}
            />
          )}
        </main>
      </div>
    </div>
  );
}
