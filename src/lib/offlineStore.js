// ---------------------------------------------------------------------------
// Almacenamiento offline seguro (localforage / IndexedDB + AES-GCM).
// ---------------------------------------------------------------------------
// Sustituye a la antigua lógica de guardado temporal (window.storage en texto
// plano). Dos usos:
//   1) OUTBOX: acciones de visita (check-in/out, con inventario y foto) que se
//      generan sin red y deben sincronizarse cuando vuelva la conexión.
//   2) CACHE: copia local de los registros del día para consultarlos offline.
//
// TODO lo que se escribe pasa antes por encryptJSON (AES-GCM). En IndexedDB solo
// hay { iv, ct } — jamás texto plano.
import localforage from "localforage";
import { encryptJSON, decryptJSON } from "./crypto.js";

const outbox = localforage.createInstance({
  name: "promotores",
  storeName: "outbox",
  driver: localforage.INDEXEDDB,
});

const cache = localforage.createInstance({
  name: "promotores",
  storeName: "records_cache",
  driver: localforage.INDEXEDDB,
});

function newId() {
  // UUID para la clave del item en la cola (no colisiona entre acciones).
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// --- OUTBOX ----------------------------------------------------------------

// Encola una acción pendiente. `action` = { type, sucursalId, payload }.
// Se cifra ANTES de tocar el disco. Devuelve el id del item encolado.
export async function enqueueAction(action) {
  const id = newId();
  const item = { id, queuedAt: new Date().toISOString(), ...action };
  const blob = await encryptJSON(item); // AES-GCM
  await outbox.setItem(id, blob);
  return id;
}

// Lista (descifrando) todas las acciones pendientes, en orden de encolado.
export async function listQueuedActions() {
  const keys = await outbox.keys();
  const items = [];
  for (const k of keys) {
    const blob = await outbox.getItem(k);
    try {
      items.push(await decryptJSON(blob));
    } catch {
      // Blob corrupto/manipulado (GCM falló): se descarta.
      await outbox.removeItem(k);
    }
  }
  return items.sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
}

export async function removeQueuedAction(id) {
  await outbox.removeItem(id);
}

export async function countQueued() {
  return (await outbox.keys()).length;
}

// --- CACHE de registros del día -------------------------------------------

export async function cacheRecords(records) {
  const blob = await encryptJSON(records); // AES-GCM
  await cache.setItem("today", blob);
}

export async function readCachedRecords() {
  const blob = await cache.getItem("today");
  if (!blob) return null;
  try {
    return await decryptJSON(blob);
  } catch {
    await cache.removeItem("today");
    return null;
  }
}

export async function clearOfflineData() {
  await outbox.clear();
  await cache.clear();
}
