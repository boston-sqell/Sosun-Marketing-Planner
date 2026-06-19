import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

// 1. Precache Vite build assets.
// vite-plugin-pwa will inject the self.__WB_MANIFEST array here.
precacheAndRoute(self.__WB_MANIFEST);

// 2. Navigation routes: Network-First (ensures online users get the latest build),
// falling back to the cached /index.html shell when offline.
const navigationRoute = new NavigationRoute(
  new NetworkFirst({
    cacheName: 'sosun-navigations',
  }),
  {
    denylist: [
      /^\/api\//,
      /^\/__\/auth\//,
      /^\/settings\//,
    ],
  }
);
registerRoute(navigationRoute);

// 3. Push Notification Handlers (preserved from original sw.js)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Sosun Marketing Planner', body: event.data.text() };
  }

  const options = {
    body:     data.body    || 'You have a new notification.',
    icon:     data.icon    || '/icon.svg',
    badge:    data.badge   || '/favicon.svg',
    image:    data.image,
    data:     { url: data.url || '/' },
    tag:      data.tag     || 'sosun-general',
    renotify: !!data.tag,
    vibrate:  [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Sosun Marketing Planner', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Focus existing tab if open
        for (const client of windowClients) {
          if (client.url.includes(targetUrl) && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new tab
        return self.clients.openWindow(targetUrl);
      })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription?.options || { userVisibleOnly: true })
      .then((newSub) =>
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: newSub.toJSON(),
            platform: 'unknown',
            userAgent: '',
            timezone: 'UTC',
          }),
        })
      )
      .catch((err) => console.error('pushsubscriptionchange failed:', err))
  );
});
