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

firebase.messaging();
