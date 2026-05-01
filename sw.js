// Service Worker para manejar notificaciones push en segundo plano
self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push recibido.');
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Nueva Tarea', body: event.data.text() };
    }
  } else {
    data = { title: 'Recordatorio de Tareas', body: 'Tienes actualizaciones pendientes.' };
  }

  const options = {
    body: data.body,
    // Eliminamos rutas a archivos inexistentes para evitar errores 404
    badge: 'https://cdn-icons-png.flaticon.com/128/1048/1048953.png',
    vibrate: [100, 50, 100],
    data: {
      url: self.location.origin
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
