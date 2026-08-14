"use strict";

const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const {logger} = require("firebase-functions");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue, Timestamp} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");
const crypto = require("node:crypto");

initializeApp();
// Controles de costo: ninguna instancia queda reservada y nunca se escala
// a más de una instancia para este proceso programado.
setGlobalOptions({region: "southamerica-east1", maxInstances: 1, minInstances: 0});

const db = getFirestore();
const TZ = "America/Argentina/Salta";
const BOT_STATE = db.collection("estadoBot").doc("monitor");
const ACTIVE = db.collection("alertasBot");
const HISTORY = db.collection("historialAlertasBot");
const CONFIG = db.collection("configuracion").doc("climaAlertBot");
const PUSH_TEST_STATE = db.collection("estadoPush");
const PUSH_INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);

const SECTORS = [
  {id:"s1", name:"Salta Capital", lat:-24.7859, lon:-65.4116, ramal:"C13"},
  {id:"s3", name:"Metán", lat:-25.4944, lon:-64.9744, ramal:"C / C12"},
  {id:"s4", name:"Embarcación", lat:-23.2097, lon:-64.1014, ramal:"C15"},
  {id:"s5", name:"Pichanal", lat:-23.3167, lon:-64.2167, ramal:"C15"},
  {id:"s6", name:"General Güemes", lat:-24.6667, lon:-65.05, ramal:"C"},
  {id:"s7", name:"Perico", lat:-24.3833, lon:-65.1167, ramal:"C / C15"},
  {id:"s8", name:"San Pedro de Jujuy", lat:-24.2333, lon:-64.8667, ramal:"C15"},
  {id:"s9", name:"Campo Quijano", lat:-24.9, lon:-65.6333, ramal:"C14"},
  {id:"s11", name:"San Antonio de los Cobres", lat:-24.226711, lon:-66.316378, ramal:"C14"},
  {id:"s12", name:"Tolar Grande", lat:-24.588351, lon:-67.390988, ramal:"C14"},
  {id:"s13", name:"Socompa", lat:-24.4167, lon:-68.2333, ramal:"C14"},
  {id:"s18", name:"Lumbreras", lat:-25.209216, lon:-64.925198, ramal:"C"},
  {id:"s19", name:"Palomitas", lat:-24.898745, lon:-64.973082, ramal:"C"},
  {id:"s20", name:"Ing. Maury", lat:-24.681907, lon:-65.772606, ramal:"C14"},
  {id:"s21", name:"Las Cuevas", lat:-24.341251, lon:-65.994822, ramal:"C14"},
  {id:"s22", name:"Laguna Seca", lat:-24.22784, lon:-66.916828, ramal:"C14"},
  {id:"s23", name:"Gral. Savio", lat:-24.250277, lon:-65.204414, ramal:"C"},
  {id:"s24", name:"La Estrella", lat:-23.822596, lon:-64.07222, ramal:"C18"},
  {id:"s25", name:"Gral. Pizarro", lat:-24.227961, lon:-63.992501, ramal:"C18"},
  {id:"s14", name:"Yuto", lat:-23.6333, lon:-64.4667, ramal:"C15"},
  {id:"s15", name:"Urundel", lat:-23.5667, lon:-64.3833, ramal:"C15"},
  {id:"s16", name:"Ledesma", lat:-23.8167, lon:-64.7833, ramal:"C15"},
  {id:"s17", name:"Fraile Pintado", lat:-23.9333, lon:-64.7833, ramal:"C15"}
];

const DEFAULT_THRESHOLDS = {
  s1:{hot:38,cold:2,rain:20,wind:60}, s3:{hot:37,cold:2,rain:18,wind:55},
  s4:{hot:38,cold:3,rain:20,wind:55}, s5:{hot:38,cold:3,rain:20,wind:55},
  s6:{hot:38,cold:2,rain:18,wind:60}, s7:{hot:37,cold:1,rain:18,wind:55},
  s8:{hot:36,cold:1,rain:18,wind:55}, s9:{hot:34,cold:0,rain:15,wind:60},
  s11:{hot:20,cold:-5,rain:8,wind:70}, s12:{hot:18,cold:-8,rain:5,wind:75},
  s13:{hot:16,cold:-10,rain:4,wind:80}, s18:{hot:37,cold:2,rain:18,wind:55},
  s19:{hot:38,cold:2,rain:18,wind:55}, s20:{hot:22,cold:-3,rain:8,wind:70},
  s21:{hot:18,cold:-8,rain:5,wind:75}, s22:{hot:20,cold:-5,rain:6,wind:72},
  s23:{hot:38,cold:2,rain:18,wind:55}, s24:{hot:38,cold:3,rain:20,wind:55},
  s25:{hot:38,cold:3,rain:20,wind:55}, s14:{hot:38,cold:3,rain:20,wind:55},
  s15:{hot:38,cold:3,rain:20,wind:55}, s16:{hot:38,cold:3,rain:20,wind:55},
  s17:{hot:38,cold:3,rain:20,wind:55}
};

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit"}).format(date);
}

function localDateTime(date = new Date()) {
  return new Intl.DateTimeFormat("es-AR", {timeZone: TZ, dateStyle:"short", timeStyle:"short", hour12:false}).format(date);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchForecast(sector) {
  const params = new URLSearchParams({
    latitude:String(sector.lat), longitude:String(sector.lon),
    daily:"temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max",
    forecast_days:"2", timezone:TZ
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {signal:controller.signal});
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const data = await response.json();
    if (!data.daily?.time?.length) throw new Error("Pronóstico diario vacío");
    return {sector, daily:data.daily};
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent(items, concurrency, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = {ok:true, value:await task(items[index])}; }
      catch (error) { results[index] = {ok:false, item:items[index], error:String(error?.message || error)}; }
    }
  }
  await Promise.all(Array.from({length:concurrency}, worker));
  return results;
}

function evaluate({sector, daily}, threshold) {
  const rain24 = number(daily.precipitation_sum?.[0]);
  const rain48 = rain24 + number(daily.precipitation_sum?.[1]);
  const gust48 = Math.max(number(daily.wind_gusts_10m_max?.[0]), number(daily.wind_gusts_10m_max?.[1]));
  const probability = Math.max(number(daily.precipitation_probability_max?.[0]), number(daily.precipitation_probability_max?.[1]));
  const max24 = number(daily.temperature_2m_max?.[0], NaN);
  const min24 = number(daily.temperature_2m_min?.[0], NaN);
  const impacts = [];
  if (threshold.enStorm !== false && gust48 >= threshold.wind) impacts.push({score:gust48 >= threshold.wind * 1.25 ? 4 : 3, type:"viento", text:`Ráfagas de ${gust48.toFixed(0)} km/h`});
  if (threshold.enRain !== false && rain24 >= threshold.rain) impacts.push({score:rain24 >= threshold.rain * 1.5 ? 4 : 3, type:"lluvia", text:`Lluvia prevista ${rain24.toFixed(1)} mm/24 h`});
  if (threshold.enHot !== false && Number.isFinite(max24) && max24 >= threshold.hot) impacts.push({score:max24 >= threshold.hot + 3 ? 4 : 3, type:"calor", text:`Temperatura máxima ${max24.toFixed(1)} °C`});
  if (threshold.enCold !== false && Number.isFinite(min24) && min24 <= threshold.cold) impacts.push({score:min24 <= threshold.cold - 3 ? 4 : 3, type:"frio", text:`Temperatura mínima ${min24.toFixed(1)} °C`});
  impacts.sort((a, b) => b.score - a.score);
  return {sector, rain24, rain48, gust48, probability, max24, min24, impacts, severity:impacts[0]?.score || 1};
}

function normalizeRamal(ramal) {
  return ramal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildRamalAlert(ramal, evaluations) {
  const affected = evaluations.filter(item => item.severity >= 3).sort((a, b) => b.severity - a.severity);
  if (!affected.length) return null;
  const severity = Math.max(...affected.map(item => item.severity));
  const state = severity >= 4 ? "Crítico" : "Alerta";
  const sectors = affected.map(item => item.sector.name);
  const maxRain24 = Math.max(...evaluations.map(item => item.rain24));
  const maxRain48 = Math.max(...evaluations.map(item => item.rain48));
  const maxGust = Math.max(...evaluations.map(item => item.gust48));
  const events = [...new Set(affected.flatMap(item => item.impacts.filter(i => i.score >= 3).map(i => i.type)))];
  const message = `⚠️ *CLIMA ALERT — RAMAL ${ramal}*\nNivel: *${state}*\nSectores: ${sectors.join(", ")}\nLluvia máx.: ${maxRain24.toFixed(1)} mm/24 h · ${maxRain48.toFixed(1)} mm/48 h\nRáfaga máx.: ${maxGust.toFixed(0)} km/h\nEventos: ${events.join(", ")}\nActualizado: ${localDateTime()} h\n_Verificar alertas oficiales del SMN._`;
  const signaturePayload = JSON.stringify({ramal, severity, sectors, events, rain:Math.round(maxRain24), gust:Math.round(maxGust), day:localDate()});
  const pushPayload = JSON.stringify({ramal, severity, sectors, events, day:localDate()});
  return {
    ramal, severity, state, sectors, events, maxRain24, maxRain48, maxGust, message,
    signature:crypto.createHash("sha256").update(signaturePayload).digest("hex").slice(0, 24),
    pushSignature:crypto.createHash("sha256").update(pushPayload).digest("hex").slice(0, 24)
  };
}

async function persistAlert(ramal, alert, checkedAt) {
  const ref = ACTIVE.doc(normalizeRamal(ramal));
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(ref);
    const prior = previous.exists ? previous.data() : null;
    if (!alert) {
      if (prior?.active) transaction.set(ref, {active:false, closedAt:checkedAt, updatedAt:checkedAt}, {merge:true});
      return {pushChanged:false, alert:null};
    }
    const changed = !prior || prior.signature !== alert.signature || !prior.active;
    const pushChanged = !prior || prior.pushSignature !== alert.pushSignature || !prior.active;
    transaction.set(ref, {...alert, active:true, checkedAt, updatedAt:checkedAt, createdAt:changed ? checkedAt : (prior.createdAt || checkedAt)}, {merge:true});
    if (changed) {
      const historyRef = HISTORY.doc();
      transaction.create(historyRef, {...alert, active:true, createdAt:checkedAt, source:"Open-Meteo", botVersion:"1.2.0"});
    }
    return {pushChanged, alert};
  });
}

function buildPushContent(alerts, test = false) {
  if (test) {
    return {
      title:"Clima Alert · Prueba correcta",
      body:"Este teléfono ya puede recibir alertas meteorológicas de UP Salta."
    };
  }
  if (alerts.length === 1) {
    const alert = alerts[0];
    const eventText = alert.events?.length ? alert.events.join(", ") : "evento meteorológico";
    return {
      title:`Clima Alert · Ramal ${alert.ramal}`,
      body:`${alert.state} en ${alert.sectors.join(", ")} · ${eventText} · Ráfagas ${alert.maxGust.toFixed(0)} km/h`
    };
  }
  return {
    title:`Clima Alert · ${alerts.length} ramales`,
    body:`Alertas nuevas o actualizadas en ${alerts.map(alert => alert.ramal).join(", ")}.`
  };
}

async function sendPushToDeviceDocs(deviceDocs, content, data = {}) {
  const uniqueTokens = new Map();
  for (const doc of deviceDocs) {
    const token = doc.data().token;
    if (typeof token === "string" && token.length > 20 && !uniqueTokens.has(token)) uniqueTokens.set(token, {doc, token});
  }
  const devices = [...uniqueTokens.values()].slice(0, 500);
  if (!devices.length) return {successCount:0, failureCount:0, removedCount:0};
  const message = {
    tokens:devices.map(device => device.token),
    data:{type:"clima-alert", url:"./", ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]))},
    webpush:{headers:{Urgency:"high"}},
    android:{priority:"high"}
  };
  const response = await getMessaging().sendEachForMulticast(message);
  const invalidDocs = [];
  response.responses.forEach((item, index) => {
    if (!item.success && PUSH_INVALID_TOKEN_CODES.has(item.error?.code)) invalidDocs.push(devices[index].doc.ref);
  });
  if (invalidDocs.length) {
    const batch = db.batch();
    invalidDocs.forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  logger.info("Push Clima Alert procesada", {success:response.successCount, failures:response.failureCount, removed:invalidDocs.length});
  return {successCount:response.successCount, failureCount:response.failureCount, removedCount:invalidDocs.length};
}

async function notifyChangedAlerts(alerts) {
  if (!alerts.length) return {successCount:0, failureCount:0, removedCount:0};
  const devices = await db.collectionGroup("dispositivos").where("activo", "==", true).limit(500).get();
  const content = buildPushContent(alerts);
  return sendPushToDeviceDocs(devices.docs, content, {
    title:content.title,
    body:content.body,
    ramales:alerts.map(alert => alert.ramal).join(","),
    severity:String(Math.max(...alerts.map(alert => alert.severity)))
  });
}

exports.monitorClimaAlert = onSchedule({
  schedule:"every 30 minutes", timeZone:TZ, timeoutSeconds:180, memory:"256MiB", retryCount:0
}, async () => {
  const startedAt = Timestamp.now();
  await BOT_STATE.set({status:"running", startedAt, schedule:"Cada 30 minutos", version:"1.2.0", costProfile:"controlado"}, {merge:true});
  try {
    const configSnap = await CONFIG.get();
    const config = configSnap.exists ? configSnap.data() : {};
    if (config.enabled === false) {
      await BOT_STATE.set({status:"paused", lastRunAt:startedAt, detail:"Pausado desde Firebase"}, {merge:true});
      return;
    }
    const thresholds = Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([id, defaults]) => [id, {...defaults, ...(config.thresholds?.[id] || {})}]));
    const fetched = await mapConcurrent(SECTORS, 6, fetchForecast);
    const failures = fetched.filter(result => !result.ok);
    const evaluations = fetched.filter(result => result.ok).map(result => evaluate(result.value, thresholds[result.value.sector.id] || DEFAULT_THRESHOLDS[result.value.sector.id]));
    const grouped = new Map();
    for (const item of evaluations) {
      const list = grouped.get(item.sector.ramal) || [];
      list.push(item);
      grouped.set(item.sector.ramal, list);
    }
    const checkedAt = Timestamp.now();
    const completeGroups = [...grouped.entries()].filter(([ramal, items]) => items.length === SECTORS.filter(sector => sector.ramal === ramal).length);
    // Si falta una localidad de un ramal, conservamos su estado anterior: no cerramos
    // una alerta con información parcial.
    const persistenceResults = await Promise.all(completeGroups.map(([ramal, items]) => persistAlert(ramal, buildRamalAlert(ramal, items), checkedAt)));
    const changedAlerts = persistenceResults.filter(result => result.pushChanged && result.alert).map(result => result.alert);
    let pushResult = {successCount:0, failureCount:0, removedCount:0};
    try {
      pushResult = await notifyChangedAlerts(changedAlerts);
    } catch (pushError) {
      logger.error("No se pudieron enviar las push de Clima Alert", pushError);
    }
    const stateUpdate = {
      status:failures.length ? "warning" : "ok", lastRunAt:checkedAt, checkedSectors:evaluations.length,
      failedSectors:failures.map(item => item.item.name), activeRamales:completeGroups.filter(([, items]) => buildRamalAlert("x", items)).map(([ramal]) => ramal),
      source:"Open-Meteo", schedule:"Cada 30 minutos", version:"1.2.0", costProfile:"controlado",
      detail:failures.length ? `Sin datos en ${failures.length} sector(es)` : "Control completado"
    };
    if (changedAlerts.length) Object.assign(stateUpdate, {lastPushAt:checkedAt, pushSuccessCount:pushResult.successCount, pushFailureCount:pushResult.failureCount});
    await BOT_STATE.set(stateUpdate, {merge:true});
    logger.info("Clima Alert completado", {checked:evaluations.length, failures:failures.length});
  } catch (error) {
    logger.error("Falló Clima Alert", error);
    await BOT_STATE.set({status:"error", lastErrorAt:FieldValue.serverTimestamp(), detail:String(error?.message || error)}, {merge:true});
    throw error;
  }
});

exports.probarPushClimaAlert = onCall({timeoutSeconds:30, memory:"256MiB", maxInstances:1}, async request => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Iniciá sesión para probar las notificaciones.");
  const uid = request.auth.uid;
  const user = await db.collection("usuarios").doc(uid).get();
  if (!user.exists || String(user.data().estado || "").toLowerCase() !== "aprobado") {
    throw new HttpsError("permission-denied", "La cuenta todavía no está aprobada.");
  }
  const devices = await db.collection("usuarios").doc(uid).collection("dispositivos").where("activo", "==", true).limit(20).get();
  if (devices.empty) throw new HttpsError("failed-precondition", "Primero activá las notificaciones en este dispositivo.");
  const stateRef = PUSH_TEST_STATE.doc(uid);
  await db.runTransaction(async transaction => {
    const state = await transaction.get(stateRef);
    const last = state.data()?.lastTestAt?.toMillis?.() || 0;
    if (Date.now() - last < 60000) throw new HttpsError("resource-exhausted", "Esperá un minuto antes de repetir la prueba.");
    transaction.set(stateRef, {lastTestAt:Timestamp.now()}, {merge:true});
  });
  const content = buildPushContent([], true);
  const result = await sendPushToDeviceDocs(devices.docs, content, {title:content.title, body:content.body, test:"true"});
  if (!result.successCount) throw new HttpsError("unavailable", "No se pudo entregar la notificación de prueba.");
  return {ok:true, delivered:result.successCount};
});
