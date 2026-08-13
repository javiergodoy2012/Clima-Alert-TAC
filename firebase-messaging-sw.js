const CLIMA_ALERT_CACHE_VERSION='20260813-5';

self.addEventListener('install',event=>{
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

function pushData(event){
  if(!event.data)return {};
  try{return event.data.json()||{};}
  catch(_){
    try{return {data:{body:event.data.text()}};}
    catch(__){return {};}
  }
}

self.addEventListener('push',event=>{
  const payload=pushData(event);
  const data=payload.data||{};
  const notification=payload.notification||{};
  const title=data.title||notification.title||'Clima Alert';
  const options={
    body:data.body||notification.body||'Nueva alerta meteorológica en UP Salta.',
    icon:data.icon||notification.icon||'./logo-clima-alert-tac.webp',
    badge:data.badge||'./favicon.png',
    tag:data.tag||'clima-alert-operativa',
    renotify:true,
    vibrate:[300,120,300,120,800,180,800],
    data:{url:data.url||notification.click_action||'./',version:CLIMA_ALERT_CACHE_VERSION}
  };
  const notify=self.registration.showNotification(title,options);
  const signalVisibleClient=self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const visible=clients.find(client=>client.visibilityState==='visible');
    if(visible)visible.postMessage({type:'CLIMA_ALERT_PUSH',title,body:options.body});
  });
  event.waitUntil(Promise.all([notify,signalVisibleClient]));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'./',self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    for(const client of windows){
      if(client.url.startsWith(self.registration.scope)&&'focus' in client){
        if('navigate' in client)client.navigate(target).catch(()=>false);
        return client.focus();
      }
    }
    return self.clients.openWindow?self.clients.openWindow(target):undefined;
  }));
});
