// ---------------------------------------------------------------------------
// Centro de notificaciones (check-in, meta alcanzada) — Google Sheets.
// ---------------------------------------------------------------------------
// Se guardan como filas en la pestaña "Notificaciones" (se crea sola). Cada
// notificación tiene un DESTINATARIO (`para`): el ID de un supervisor, o
// "admin" para el/los administradores. El centro de notificaciones del
// frontend (campana) solo pide las que le tocan a la sesión actual.
//
// Tipos:
//   - "checkin"          → un promotor hizo check-in. Para: su supervisor.
//   - "promoter_goal"     → un promotor alcanzó su meta mensual. Para: su
//                           supervisor.
//   - "store_goal"        → una tienda alcanzó su meta mensual. Para: "admin".
//
// Best-effort en TODO: si el Sheet no está configurado o falla, se registra el
// error y se sigue (nunca debe romper un check-in/check-out).
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { dayKeyOf, todayKey } from "./businessDay.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const HEADERS = ["fecha", "tipo", "para", "id_promotor", "promotor", "id_tienda", "tienda", "periodo", "detalle"];

// La campana hace polling cada 30s (ver NotificationBell.jsx) — sin caché,
// eso era una lectura completa del Sheet (hasta 5000 filas) por cada admin/
// supervisor con la app abierta, cada 30 segundos, sin parar. 60s de caché
// no se nota (las notificaciones no son tan urgentes) y corta ese tráfico
// a la mitad o menos.
const TTL_MS = Number(process.env.NOTIFICATIONS_CACHE_TTL_MS ?? 60 * 1000);

let clientPromise = null;
let tabEnsured = false;
let rowsCache = { at: 0, rows: [] };

function isConfigured() {
  return Boolean((config.sheets.json || config.sheets.keyFile) && config.sheets.spreadsheetId);
}

function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para las notificaciones.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

async function ensureTab(sheets) {
  if (tabEnsured) return;
  const tab = config.sheets.notificacionesTab;
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.sheets.spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range: `${tab}!A1:Z1` });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
  tabEnsured = true;
}

async function readAllRows() {
  if (Date.now() - rowsCache.at < TTL_MS) return rowsCache.rows;
  if (!isConfigured()) return [];
  const sheets = await getClient();
  await ensureTab(sheets);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.notificacionesTab}!A1:I5000`,
  });
  const rows = res.data.values ?? [];
  const parsed = rows.slice(1).map((r) => ({
    fecha: r[0] || "",
    tipo: r[1] || "",
    para: r[2] || "",
    idPromotor: r[3] || "",
    promotor: r[4] || "",
    idSucursal: r[5] || "",
    tienda: r[6] || "",
    periodo: r[7] || "",
    detalle: r[8] || "",
  }));
  rowsCache = { at: Date.now(), rows: parsed };
  return parsed;
}

// Agrega una notificación. Best-effort: nunca lanza (registra y sigue).
export async function appendNotification({ tipo, para, idPromotor = "", promotor = "", idSucursal = "", tienda = "", periodo = "", detalle = "" }) {
  if (!isConfigured()) return { skipped: true };
  try {
    const sheets = await getClient();
    await ensureTab(sheets);
    const row = [new Date().toISOString(), tipo, para, idPromotor, promotor, idSucursal, tienda, periodo, detalle];
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${config.sheets.notificacionesTab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    rowsCache = { at: 0, rows: [] }; // invalida el caché: que la próxima lectura sí vea esta fila
    return { appended: true };
  } catch (e) {
    console.error("[notificationsSheet] No se pudo agregar la notificación:", e.message);
    return { error: e.message };
  }
}

// ¿Ya existe una notificación de meta para este promotor/tienda en este
// período? Se usa para no mandar la misma alerta de "meta alcanzada" en cada
// check-out del mes (idempotencia: se revisa el histórico en vez de intentar
// detectar el cruce exacto del umbral).
export async function hasGoalNotification({ tipo, id, periodo }) {
  try {
    const rows = await readAllRows();
    return rows.some((r) => r.tipo === tipo && r.periodo === periodo && (r.idPromotor === id || r.idSucursal === id));
  } catch (e) {
    console.error("[notificationsSheet] No se pudo verificar duplicados:", e.message);
    return false; // ante la duda, no bloquear la notificación por un error de lectura
  }
}

// Notificaciones para la sesión actual: `para` = ID del supervisor, o "admin"
// para admin/gerente. Las más recientes primero, tope de `limit`.
export async function listNotificationsFor(para, limit = 50) {
  const rows = await readAllRows();
  return rows
    .filter((r) => r.para === para)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .slice(0, limit);
}

// Notificaciones de HOY (hora de negocio) para la campana — reemplaza el
// tope fijo de 50 históricas: el día de hoy, completo, sin importar cuántas
// sean. El historial de días anteriores vive en listNotificationsPage.
export async function listNotificationsForToday(para) {
  const rows = await readAllRows();
  const today = todayKey();
  return rows
    .filter((r) => r.para === para && r.fecha && dayKeyOf(new Date(r.fecha)) === today)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

// Historial de notificaciones PAGINADO POR DÍA (no por fila) — misma idea que
// el historial de check-in/check-out del promotor: cada página trae
// `daysPerPage` días distintos (con TODAS sus notificaciones), más recientes
// primero. `hasMore` indica si hay días más viejos que la página actual.
export async function listNotificationsPage(para, { page = 1, daysPerPage = 7 } = {}) {
  const rows = await readAllRows();
  const mine = rows.filter((r) => r.para === para && r.fecha);

  const byDay = new Map();
  for (const r of mine) {
    const d = dayKeyOf(new Date(r.fecha));
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }
  const allDays = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1)); // desc

  const start = Math.max(0, (page - 1) * daysPerPage);
  const pageDays = allDays.slice(start, start + daysPerPage);
  const hasMore = allDays.length > start + daysPerPage;

  const days = pageDays.map((d) => ({
    day: d,
    notifications: byDay.get(d).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
  }));
  return { days, page, daysPerPage, hasMore };
}

// La notificación más reciente de un tipo/destinatario dado, o null. La usa
// el reporte semanal para saber si ya pasó una semana desde el último envío.
export async function getLatestNotification({ tipo, para }) {
  try {
    const rows = await readAllRows();
    return rows
      .filter((r) => r.tipo === tipo && r.para === para)
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0] ?? null;
  } catch (e) {
    console.error("[notificationsSheet] No se pudo leer la última notificación:", e.message);
    return null;
  }
}
