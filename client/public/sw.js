// Prompt 8, Parte 4 — service worker SOLO para avisos push: recibirlos y abrir la app al
// tocarlos. A propósito, este archivo NO tiene "install" ni "fetch", y nunca llama a
// caches.addAll/caches.match ni nada parecido — si cacheara el HTML/JS/CSS de la app, después
// de cada deploy algunas consultoras seguirían viendo la versión vieja hasta que ese caché
// expire o se borre a mano. Nada de eso pasa hoy (la app no tiene service worker en absoluto),
// y este archivo no lo cambia: solo agrega lo que hace falta para los avisos.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Impulsa";
  const options = {
    body: data.body || "",
    icon: "/logo-impulsa-192.png",
    badge: "/logo-impulsa-192.png",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
