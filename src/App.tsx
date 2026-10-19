import React, { useEffect, useState, useCallback, useRef } from 'react';
import { DaySchedule, MediaItem } from './types';
import {
  getStoredSyncCode,
  setStoredSyncCode,
  fetchSchedule,
  saveSchedule,
  fetchMediaList,
} from './utils/storage';
import { Header } from './components/Header';
import { ScheduleView } from './components/ScheduleView';
import { MediaGallery } from './components/MediaGallery';
import { SyncModal } from './components/SyncModal';
import { StorageSettingsModal } from './components/StorageSettingsModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'media' | 'settings'>('schedule');
  const [syncCode, setSyncCode] = useState<string>(() => getStoredSyncCode());
  const [schedule, setSchedule] = useState<DaySchedule>({});
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<string>('Проверка связи…');
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load schedule and media for current syncCode
  const loadData = useCallback(async (code: string) => {
    try {
      setSyncStatus('Синхронизация…');
      const [schedData, mediaData] = await Promise.all([
        fetchSchedule(code),
        fetchMediaList(code),
      ]);
      setSchedule(schedData);
      setMediaList(mediaData);
      setSyncStatus(`Синхронизировано в ${new Date().toLocaleTimeString('ru-RU')}`);
    } catch (err) {
      console.error(err);
      setSyncStatus('Данные сохранены локально');
    }
  }, []);

  useEffect(() => {
    loadData(syncCode);
  }, [syncCode, loadData]);

  // Periodic poll to check for updates from other devices every 20s
  useEffect(() => {
    const interval = setInterval(() => {
      loadData(syncCode);
    }, 20000);
    return () => clearInterval(interval);
  }, [syncCode, loadData]);

  // Update schedule handler with automatic push
  const handleUpdateSchedule = (newSchedule: DaySchedule) => {
    setSchedule(newSchedule);
    setSyncStatus('Сохранение…');

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      const ok = await saveSchedule(syncCode, newSchedule);
      if (ok) {
        setSyncStatus(`✅ Сохранено в ${new Date().toLocaleTimeString('ru-RU')}`);
      } else {
        setSyncStatus('Сохранено локально в браузере');
      }
    }, 400);
  };

  // Connect to another device's sync code
  const handleConnectCode = async (newCode: string) => {
    setStoredSyncCode(newCode);
    setSyncCode(newCode);
    await loadData(newCode);
  };

  // Import backup data
  const handleImportSchedule = (data: DaySchedule) => {
    handleUpdateSchedule(data);
  };

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-4xl mx-auto px-3 sm:px-6 pt-6 sm:pt-8">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          syncCode={syncCode}
          onOpenSync={() => setIsSyncModalOpen(true)}
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
            <MediaGallery
              mediaList={mediaList}
              syncCode={syncCode}
              onRefreshMedia={() => fetchMediaList(syncCode).then(setMediaList)}
            />
          )}

          {activeTab === 'settings' && <StorageSettingsModal />}
        </main>
      </div>

      <SyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        syncCode={syncCode}
        onConnectCode={handleConnectCode}
        schedule={schedule}
        onImportSchedule={handleImportSchedule}
      />
    </div>
  );
}
