// Минимальный service worker: нужен только для установки сайта на экран телефона.
// Ничего не кэширует и не перехватывает запросы: сайт, заявки и личные альбомы всегда берутся свежими из сети.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // На случай старых кэшей: удаляем всё, что могло остаться
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});
// Обработчик нужен браузеру для установки; без respondWith запрос идёт напрямую в сеть
self.addEventListener('fetch', () => {});
