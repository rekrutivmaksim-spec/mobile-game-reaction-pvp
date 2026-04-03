importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: self.__FCM_API_KEY__ || "",
  projectId: "ne-slomaisa",
  messagingSenderId: "16535890851",
  appId: "1:16535890851:web:placeholder",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(title || "НЕ СЛОМАЙСЯ", {
    body: body || "Попробуешь ещё раз?",
    icon: "/icon-192.png",
    badge: "/icon-96.png",
    data,
    actions: [{ action: "play", title: "Играть" }],
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.notification.data?.action;
  const url = action === "start_game" ? "/?autostart=1" : "/";
  event.waitUntil(clients.openWindow(url));
});