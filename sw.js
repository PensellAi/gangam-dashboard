// Gangam Dashboard service worker: shows order notifications pushed by the gangam-push worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { title: 'Gangam', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Gangam', {
    body: d.body || '',
    tag: d.tag || 'gangam',
    renotify: true,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    vibrate: [250, 100, 250, 100, 500],
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes('/gangam-dashboard/'));
    if (c) { c.postMessage({ type: 'open', url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
