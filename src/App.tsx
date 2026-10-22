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
import { Header, TabKey } from './components/Header';
import { ScheduleView } from './components/ScheduleView';
import { MediaGallery } from './components/MediaGallery';
import { HelpView } from './components/HelpView';

// Все устройства работают в одном общем пространстве: коды синхронизации не нужны
const syncCode = WORKSPACE_CODE;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const [schedule, setSchedule] = useState<DaySchedule>({});
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<string>('Проверка связи…');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Счётчик правок и число отправок "в полёте": по ним loadData понимает,
  // что пока он грузил данные, пользователь успел изменить расписание.
  const editVersionRef = useRef(0);
  const pendingPushesRef = useRef(0);

  const loadData = useCallback(async () => {
    const editsAtStart = editVersionRef.current;
    try {
      setSyncStatus('Синхронизация…');
      const [schedData, mediaData] = await Promise.all([
        fetchSchedule(syncCode),
        fetchMediaList(syncCode),
      ]);

      setMediaList(mediaData);

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

  useEffect(() => {
    requestPersistentStorage();
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Периодический опрос: изменения с других устройств подтягиваются раз в 20 секунд
  useEffect(() => {
    const interval = setInterval(() => {
      loadData();
    }, 20000);
    return () => clearInterval(interval);
  }, [loadData]);

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
            : `⚠️ Сохранено только на этом устройстве (${time}): нет связи с сервером`
        );
      } finally {
        pendingPushesRef.current -= 1;
      }
    }, 400);
  };

  const refreshMedia = () => fetchMediaList(syncCode).then(setMediaList);

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-4xl mx-auto px-3 sm:px-6 pt-6 sm:pt-8">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          mediaCount={mediaList.length}
          syncStatus={syncStatus}
        />

        <main className="transition-all duration-200">
          {activeTab === 'schedule' && (
            <ScheduleView
              schedule={schedule}
              onUpdateSchedule={handleUpdateSchedule}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
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
              syncCode={syncCode}
              onRefreshMedia={refreshMedia}
            />
          )}
        </main>
      </div>
    </div>
  );
}
