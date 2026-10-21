import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  addDoc,
  deleteDoc,
  onSnapshot,
  Firestore,
} from 'firebase/firestore';
import { DaySchedule, MediaItem } from '../types';

export const firebaseConfig = {
  apiKey: 'AIzaSyBWa1uMmEH6xx7q0wxpP5Ld3X1ZjjWpf0s',
  authDomain: 'raspisanie-fc5d2.firebaseapp.com',
  projectId: 'raspisanie-fc5d2',
  storageBucket: 'raspisanie-fc5d2.firebasestorage.app',
  messagingSenderId: '408084828645',
  appId: '1:408084828645:web:8b8ad715a659acb9245f0c',
};

let db: Firestore | null = null;
let firebaseAvailable = false;

// Initialize Firebase safely
try {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  firebaseAvailable = true;
} catch (e) {
  console.warn('Firebase init error (will run offline):', e);
  firebaseAvailable = false;
}

// Timeout wrapper so that when Firebase is blocked (e.g. in Russia without VPN),
// it times out quickly (3.5s) instead of hanging indefinitely!
function withTimeout<T>(promise: Promise<T>, ms: number = 3500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Firebase network timeout (возможно заблокирован без VPN)')), ms)
    ),
  ]);
}

/**
 * Fetch schedule from Firebase with timeout
 */
export interface RemoteSchedule {
  data: DaySchedule;
  updatedAt: number;
}

export async function fbFetchSchedule(code: string): Promise<RemoteSchedule | null> {
  if (!db || !firebaseAvailable) return null;
  try {
    const snap = await withTimeout(getDoc(doc(db, 'schedules', code)), 3500);
    if (snap.exists()) {
      const raw = snap.data() as any;
      // Новый формат: { days: '<json>', updatedAt }
      if (typeof raw.days === 'string') {
        return { data: JSON.parse(raw.days), updatedAt: Number(raw.updatedAt) || 0 };
      }
      // Старый формат: документ = само расписание
      return { data: raw as DaySchedule, updatedAt: 0 };
    }
  } catch (err) {
    // Network blocked or timeout without VPN
  }
  return null;
}

/**
 * Save schedule to Firebase with timeout.
 * Расписание хранится как JSON-строка: Firestore не принимает `undefined`
 * внутри объектов (например, event.note без комментария), из-за чего
 * раньше запись молча падала.
 */
export async function fbSaveSchedule(
  code: string,
  schedule: DaySchedule,
  updatedAt: number
): Promise<boolean> {
  if (!db || !firebaseAvailable) return false;
  try {
    await withTimeout(
      setDoc(doc(db, 'schedules', code), { days: JSON.stringify(schedule), updatedAt }),
      4000
    );
    return true;
  } catch (err) {
    console.warn('Firebase schedule save failed:', err);
    return false;
  }
}

/**
 * Save photo to Firebase Firestore (under 900KB)
 */
export async function fbSavePhoto(
  code: string,
  dataUrl: string,
  name: string,
  id: string,
  created: number
): Promise<string | null> {
  if (!db || !firebaseAvailable) return null;
  try {
    // Тот же id, что и в локальной базе — иначе фото появлялось бы дважды
    await withTimeout(
      setDoc(doc(db, 'media', id), {
        code,
        type: 'photo',
        mime: 'image/jpeg',
        name: (name || '').slice(0, 80),
        created,
        data: dataUrl,
      }),
      4000
    );
    return id;
  } catch (err) {
    return null;
  }
}

/**
 * Fetch media items from Firebase
 */
export async function fbFetchMedia(code: string): Promise<MediaItem[]> {
  if (!db || !firebaseAvailable) return [];
  try {
    // We can query with short timeout
    return await new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve([]);
        }
      }, 3500);

      const q = query(collection(db!, 'media'), where('code', '==', code));
      const unsubscribe = onSnapshot(
        q,
        (snap) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            const items: MediaItem[] = snap.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                code: data.code,
                type: data.type || 'photo',
                name: data.name || 'Фото',
                mime: data.mime || 'image/jpeg',
                created: data.created || Date.now(),
                url: data.data || data.url || '',
                thumb: data.thumb || data.data || '',
                data: data.data,
                storageSource: 'firebase',
              };
            });
            resolve(items);
          }
        },
        () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve([]);
          }
        }
      );

      // Unsubscribe after 30 seconds if still listening
      setTimeout(() => {
        try {
          unsubscribe();
        } catch (e) {}
      }, 30000);
    });
  } catch (err) {
    return [];
  }
}

/**
 * Delete media item from Firebase
 */
export async function fbDeleteMedia(docId: string): Promise<boolean> {
  if (!db || !firebaseAvailable) return false;
  try {
    await withTimeout(deleteDoc(doc(db, 'media', docId)), 3000);
    return true;
  } catch (e) {
    return false;
  }
}
