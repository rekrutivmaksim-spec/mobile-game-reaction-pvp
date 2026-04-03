importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBTNZyE-5AM7tCVN8m1kpq67hozQ2sQbtg",
  authDomain: "no-e-258a2.firebaseapp.com",
  projectId: "no-e-258a2",
  storageBucket: "no-e-258a2.firebasestorage.app",
  messagingSenderId: "16535890851",
  appId: "1:16535890851:web:2513478ea89934414fc816",
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