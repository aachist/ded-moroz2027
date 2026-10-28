export interface ScheduleEvent {
  id: string;
  start: string; // HH:mm
  end: string;   // HH:mm
  type: string;  // activity type key
  note?: string;
  _col?: number;
  fromClient?: boolean; // заявка, оставленная клиентом на сайте (не часть расписания администратора)
  bookingId?: string;   // id заявки, если fromClient
}

export interface ActivityTypeConfig {
  name: string;
  color: string;
  bgLight: string;
  textColor: string;
  legacy?: boolean; // старый вид: показывается у уже созданных записей, но не предлагается при создании новых
}

export interface DaySchedule {
  [dateStr: string]: ScheduleEvent[];
}

export interface MediaItem {
  id: string;
  code: string;
  type: 'photo' | 'video';
  mime?: string;
  name: string;
  created: number;
  size?: number;
  url: string;        // Server URL, object URL, or data URL
  thumb?: string;      // Video poster thumbnail data URL or image URL
  data?: string;       // Compressed base64 data for photos/offline
  blob?: Blob;         // Stored binary Blob in IndexedDB for 100% offline playback
  filename?: string;   // Local disk filename if stored on server
  cloudUrl?: string;   // Ссылка на файл в облачном хранилище (Vercel Blob), если он уже выгружен
  caption?: string;    // Подпись к фото/видео
  captionAt?: number;  // Когда подпись изменена (для выбора более свежей версии при синхронизации)
  duration?: number;   // Video duration in seconds
  storageSource?: 'local' | 'server' | 'firebase';
}

export interface StorageConfig {
  provider: 'local' | 'cloudinary';
  cloudinaryCloudName?: string;
  cloudinaryPreset?: string;
}
