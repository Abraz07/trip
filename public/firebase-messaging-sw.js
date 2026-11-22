// Firebase Cloud Messaging service worker. Config arrives in the registration URL's query string.
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js')

const cfg = Object.fromEntries(new URL(location).searchParams)
firebase.initializeApp(cfg)
const messaging = firebase.messaging()

// Data-only messages so we control how the notification looks.
messaging.onBackgroundMessage((m) => {
  const d = m.data || {}
  self.registration.showNotification(d.title || 'Yatra', {
    body: d.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: d.tag,
    data: { url: d.url || '/' },
  })
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).origin === location.origin)
    if (open) { open.navigate(url); return open.focus() }
    return clients.openWindow(url)
  }))
})
