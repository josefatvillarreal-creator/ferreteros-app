// ---------------------------------------------------------------------------
// Metas de venta SEMANALES (por promotor y por sucursal) desde Google Sheets.
// ---------------------------------------------------------------------------
// Pestaña "Metas", con encabezados detectados por nombre (no por posición):
//   Tipo | ID | Nombre | Meta
//   - Tipo  → "promotor" o "sucursal" (se acepta "tienda" como sinónimo).
//   - ID    → ID del promotor o Num de la sucursal (debe coincidir con su ID real).
//   - Nombre → solo para que sea legible en el Sheet; no se usa para nada.
//   - Meta  → "unidades-equivalentes" vendidas EN LA SEMANA para considerarla
//             alcanzada: cada producto aporta cantidad × su equivalencia (ver
//             units.js y la pestaña Productos).
//
// Una fila ausente = SIN META PERSONALIZADA para ese promotor/sucursal. Para
// promotores (no sucursales), db.js usa entonces el default fijo
// (DEFAULT_WEEKLY_GOAL_UNITS) en vez de "sin meta" — la meta personalizada
// de aquí es la EXCEPCIÓN, no el único camino para tener una meta.
//
// Cachea en memoria (TTL) para no llamar a la API en cada check-out. Si la
// pestaña aún no existe o no hay credenciales, se comporta como "sin metas"
// (nunca lanza: no debe romper el check-in/check-out).
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";

// Lectura Y escritura: el admin puede fijar la meta de un promotor desde el
// tablero (ver setPromoterGoal), así que no basta con solo-lectura.
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const TTL_MS = Number(process.env.GOALS_CACHE_TTL_MS ?? 5 * 60 * 1000);
const HEADERS = ["Tipo", "ID", "Nombre", "Meta"];

// Meta semanal por defecto de un promotor SIN meta personalizada, en
// unidades-equivalentes (cantidad × equivalencia de cada producto). Una meta
// PERSONALIZADA (fila en "Metas") se interpreta con la misma fórmula, solo con
// otro número de unidades objetivo.
export const DEFAULT_WEEKLY_GOAL_UNITS = 30;

let clientPromise = null;
let cache = { at: 0, promoters: new Map(), sucursales: new Map() };

function isConfigured() {
  return Boolean((config.sheets.json || config.sheets.keyFile) && config.sheets.spreadsheetId);
}

function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para leer las metas del Sheet.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

async function loadGoals() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.metasTab}!A1:Z2000`,
  });
  const rows = res.data.values ?? [];

  let header = -1, tipoC = -1, idC = -1, metaC = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((c) => String(c ?? "").trim());
    const t = cells.findIndex((c) => /^tipo$/i.test(c));
    const m = cells.findIndex((c) => /^meta/i.test(c));
    if (t !== -1 && m !== -1) {
      header = r; tipoC = t; metaC = m;
      idC = cells.findIndex((c) => /^id$/i.test(c));
      break;
    }
  }

  const promoters = new Map();
  const sucursales = new Map();
  if (header === -1 || idC === -1) return { promoters, sucursales };

  for (let r = header + 1; r < rows.length; r++) {
    const cells = rows[r];
    const id = String(cells?.[idC] ?? "").trim();
    const meta = Number(cells?.[metaC]);
    if (!id || !Number.isFinite(meta) || meta <= 0) continue;
    const tipo = String(cells?.[tipoC] ?? "").trim().toLowerCase();
    if (tipo === "sucursal" || tipo === "tienda") sucursales.set(id, meta);
    else promoters.set(id, meta); // por defecto, "promotor"
  }
  return { promoters, sucursales };
}

async function ensureCache() {
  if (Date.now() - cache.at < TTL_MS) return cache;
  if (!isConfigured()) return cache;
  try {
    const { promoters, sucursales } = await loadGoals();
    cache = { at: Date.now(), promoters, sucursales };
  } catch (e) {
    console.warn("[goalsSheet] No se pudo leer la pestaña de metas:", e.message);
  }
  return cache;
}

// Meta PERSONALIZADA (unidades-equivalentes) de un promotor, o null si usa el
// default (ver DEFAULT_WEEKLY_GOAL_UNITS en db.js, que aplica el fallback).
export async function getPromoterGoal(promoterId) {
  const { promoters } = await ensureCache();
  return promoters.get(String(promoterId).trim()) ?? null;
}

// Meta semanal (unidades-equivalentes) de una sucursal, o null si no tiene una
// definida (las sucursales NO tienen default — solo meta personalizada).
export async function getSucursalGoal(sucursalId) {
  const { sucursales } = await ensureCache();
  return sucursales.get(String(sucursalId).trim()) ?? null;
}

// Asegura que la pestaña "Metas" exista y tenga encabezados. Devuelve las
// filas crudas (incluyendo el encabezado en la fila 0).
async function ensureTab(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.sheets.spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === config.sheets.metasTab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: config.sheets.metasTab } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.metasTab}!A1:Z2000`,
  });
  let rows = res.data.values ?? [];
  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${config.sheets.metasTab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
    rows = [HEADERS];
  }
  return rows;
}

function colLetter(idx) {
  let s = "";
  for (let n = idx; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

// Crea o actualiza la meta semanal de un promotor o sucursal (`tipo`: "promotor"
// | "sucursal"). Actualiza también el caché en memoria al instante, para que el
// tablero refleje el cambio sin esperar el TTL. Usado por el botón "Meta" del
// tablero del gerente/admin.
// "tienda" es sinónimo histórico de "sucursal" en la columna Tipo.
const normTipo = (t) => (t === "tienda" ? "sucursal" : t);

async function setGoal(tipo, id, meta, nombre = "") {
  if (!isConfigured()) throw new Error("Google Sheets no está configurado (faltan credenciales o GOOGLE_SHEETS_ID).");
  const sheets = await getClient();
  const rows = await ensureTab(sheets);
  const cells = rows[0].map((c) => String(c ?? "").trim());
  const tipoC = cells.findIndex((c) => /^tipo$/i.test(c));
  const idC = cells.findIndex((c) => /^id$/i.test(c));
  const nameC = cells.findIndex((c) => /^nombre$/i.test(c));
  const metaC = cells.findIndex((c) => /^meta/i.test(c));

  let rowNumber = -1;
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r]?.[idC] ?? "").trim() === String(id).trim() && normTipo(String(rows[r]?.[tipoC] ?? "").trim().toLowerCase()) === tipo) {
      rowNumber = r + 1;
      break;
    }
  }

  const rowValues = [];
  rowValues[tipoC] = tipo;
  rowValues[idC] = String(id).trim();
  if (nameC !== -1) rowValues[nameC] = nombre || "";
  rowValues[metaC] = meta;
  for (let i = 0; i < rowValues.length; i++) if (rowValues[i] === undefined) rowValues[i] = "";

  if (rowNumber === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${config.sheets.metasTab}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
  } else {
    const lastCol = colLetter(rowValues.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${config.sheets.metasTab}!A${rowNumber}:${lastCol}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  }

  // Refleja el cambio en el caché de inmediato (no esperar el TTL de 5 min).
  const target = tipo === "sucursal" ? cache.sucursales : cache.promoters;
  target.set(String(id).trim(), meta);
}

export async function setPromoterGoal(promoterId, meta, nombre = "") {
  return setGoal("promotor", promoterId, meta, nombre);
}

export async function setSucursalGoal(sucursalId, meta, nombre = "") {
  return setGoal("sucursal", sucursalId, meta, nombre);
}
