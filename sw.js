// Hifz service worker — enables two things:
//  1. The app shell (this page) can load with zero connectivity, instead of
//     failing before any of the page's own JS ever runs.
//  2. Quranic content (surah audio/text/tafsir) that the user has explicitly
//     downloaded via the in-app "Download for offline" button plays back
//     without a connection.
// It deliberately does NOT auto-cache Quranic content on ordinary browsing —
// only the explicit download action (in index.html) writes into
// CONTENT_CACHE. This worker's own fetch handler only ever READS from it.
const SHELL_CACHE = 'hifz-shell-v1';
const CONTENT_CACHE = 'hifz-offline-v1';
const FONT_CACHE = 'hifz-fonts-v1';

const CONTENT_HOSTS = [
  'api.alquran.cloud', 'api.quran.com', 'verses.quran.com',
  'mirrors.quranicaudio.com', 'cdn.islamic.network'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(['/', '/index.html']).catch(() => {}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Dynamic/user-specific endpoints (sync, auth, feedback) must always hit
  // the network — never served from, or written to, any cache.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // The app shell itself: network-first, so anyone online always gets the
  // latest deploy; falls back to the last cached copy only when the
  // network request actually fails (i.e. genuinely offline).
  if (req.mode === 'navigate' || (url.origin === self.location.origin &&
      (url.pathname === '/' || url.pathname === '/index.html'))) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put('/index.html', copy));
        return res;
      }).catch(() => caches.match('/index.html', { cacheName: SHELL_CACHE }))
    );
    return;
  }

  // Fonts: small, essential for correct Arabic rendering, and effectively
  // static — safe to cache opportunistically (unlike audio, this can't
  // grow into meaningful storage use).
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  // Quranic content: serve from the offline-download cache if the user
  // explicitly downloaded it, otherwise just go to the network as normal.
  if (CONTENT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req, { cacheName: CONTENT_CACHE }).then(cached => cached || fetch(req))
    );
    return;
  }
  // Everything else — let it proceed normally.
});
