importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyADLXkO8UqJ048mG2HQCFJNmoL-xAcXY5c",
  authDomain: "mysignalpush.firebaseapp.com",
  projectId: "mysignalpush",
  storageBucket: "mysignalpush.firebasestorage.app",
  messagingSenderId: "224309937152",
  appId: "1:224309937152:web:0e79104fb7aea5b86dc4e5"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// 앱이 꺼져있을 때(백그라운드) 알림을 화면에 띄우는 로직
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: './icon.png'
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});
