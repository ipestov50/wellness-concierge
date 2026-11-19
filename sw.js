// Офлайн-оболочка приложения. Данные гостей сюда НЕ попадают: /api и база не кэшируются,
// снимок «на сегодня» хранится отдельно в IndexedDB (js/offline.js) и стирается при выходе.
const V = 'wc-shell-v40';
const SHELL = ['/', '/css/styles.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon.png', '/js/theme-init.js', '/js/app.js'];
// библиотека базы нужна и без сети; шрифты берёт обычный кэш браузера (без сети — системный шрифт)
const CDN = ['cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// сеть в приоритете (всегда свежая версия), кэш — только когда сети нет
async function networkFirst(req, key = req) {
  const c = await caches.open(V);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(key, res.clone());
    return res;
  } catch {
    const hit = await c.match(key);
    if (hit) return hit;
    throw new Error('offline');
  }
}
// библиотеки с версией в адресе не меняются — сначала кэш
async function cacheFirst(req) {
  const c = await caches.open(V);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname === '/api/config') return e.respondWith(networkFirst(req)); // публичный адрес базы и anon-ключ
    if (url.pathname.startsWith('/api/')) return; // ответы с данными гостей — никогда не кэшируем
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, '/'));
    return e.respondWith(networkFirst(req));
  }
  if (CDN.includes(url.hostname)) e.respondWith(cacheFirst(req));
});
