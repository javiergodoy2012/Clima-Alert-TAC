/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:'AIzaSyB_xWShz8Rc9qH9vDEJpi2veAoDs7ZdHIg',
  authDomain:'up-salta-vision.firebaseapp.com',
  projectId:'up-salta-vision',
  storageBucket:'up-salta-vision.firebasestorage.app',
  messagingSenderId:'1087987428046',
  appId:'1:1087987428046:web:ff122468cf8f1c9ae7be9f'
});

const messaging=firebase.messaging();

messaging.onBackgroundMessage(payload=>{
  const title=payload.data?.title||'Clima Alert';
  const options={
    body:payload.data?.body||'Nueva alerta meteorológica en UP Salta.',
    icon:'./logo-clima-alert-tac.webp',
    badge:'./favicon.png',
    tag:'clima-alert-operativa',
    renotify:true,
    data:{url:payload.data?.url||'./'}
  };
  return self.registration.showNotification(title,options);
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'./',self.location.href).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    for(const client of windows){
      if(client.url.startsWith(self.registration.scope)&&'focus' in client)return client.focus();
    }
    return clients.openWindow?clients.openWindow(target):undefined;
  }));
});
