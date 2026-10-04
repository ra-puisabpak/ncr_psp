// NCR eForm service worker — app-shell caching for installable PWA
const CACHE = 'puisabpak-ncr-v2'
const APP_SHELL = ['/', '/ncr', '/receiving/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle same-origin GET. API calls (cross-origin) pass straight through.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // SPA navigations: network-first, fall back to cached app shell when offline.
  // The receiving app (/receiving/) is its own page; everything else is the React app shell at '/'.
  if (request.mode === 'navigate') {
    const shell = url.pathname.startsWith('/receiving') ? '/receiving/' : '/'
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(shell, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => caches.match(shell))
    )
    return
  }

  // Static assets (js/css/img/fonts): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
