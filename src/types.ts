export interface ScheduleEvent {
  id: string;
  start: string; // HH:mm
  end: string;   // HH:mm
  type: string;  // activity type key
  note?: string;
  _col?: number;
}

export interface ActivityTypeConfig {
  name: string;
  color: string;
  bgLight: string;
  textColor: string;
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
  url: string;        // Server URL e.g. /api/media/... or Cloudinary URL or data URL
  thumb?: string;      // Video poster thumbnail data URL or image URL
  filename?: string;   // Local disk filename if stored on server
  duration?: number;   // Video duration in seconds
}

export interface StorageConfig {
  provider: 'local' | 'cloudinary';
  cloudinaryCloudName?: string;
  cloudinaryPreset?: string;
}
