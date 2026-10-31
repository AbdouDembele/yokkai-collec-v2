/* global self, clients */
self.addEventListener("push", event => {
  if (!event.data) return;
  const data = event.data.json();
  const target = new URL(data.url || "/", self.location.origin);
  const url =
    target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/apple-touch-icon.png",
      tag: data.tag,
      lang: data.lang,
      data: { url }
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/",
    self.location.origin
  );
  const url =
    target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      const existing = windows.find(
        client => new URL(client.url).origin === self.location.origin
      );
      if (existing) {
        await existing.navigate(url);
        return existing.focus();
      }
      return clients.openWindow(url);
    })()
  );
});
