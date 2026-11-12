// 알림을 누르면 알림에 담긴 주소(예: .../#comm)로 이동합니다.
self.addEventListener("notificationclick", function (event) {
  var n = event.notification, d = n.data || {}, f = (d.FCM_MSG || {});
  var url = d.url || (f.data && f.data.url) || (f.fcmOptions && f.fcmOptions.link) || (f.notification && f.notification.click_action) || "";
  if (!url) return;                                   // 주소가 없는 알림은 기본 동작에 맡김
  event.stopImmediatePropagation();
  n.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) {
          return c.focus().then(function (w) { return (w && "navigate" in w) ? w.navigate(url).catch(function () { return self.clients.openWindow(url); }) : w; });
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyADLXkO8UqJ048mG2HQCFJNmoL-xAcXY5c",
  authDomain: "mysignalpush.firebaseapp.com",
  projectId: "mysignalpush",
  storageBucket: "mysignalpush.firebasestorage.app",
  messagingSenderId: "224309937152",
  appId: "1:224309937152:web:0e79104fb7aea5b86dc4e5"
});
firebase.messaging();                                 // 알림 표시는 SDK가 자동으로 처리
