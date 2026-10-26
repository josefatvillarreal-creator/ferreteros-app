// ---------------------------------------------------------------------------
// Origen de promotores desde Google Sheets (para login contra el hash del Sheet).
// ---------------------------------------------------------------------------
// Se activa con AUTH_SOURCE=sheet. Lee la pestaña de promotores (por defecto
// "Promotores"), detecta las columnas por su encabezado y devuelve el promotor
// con su HASH bcrypt en `password`, de modo que auth.js (bcrypt.compare) funciona
// sin cambios. Cachea en memoria (TTL) para no llamar a la API en cada login.
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
 
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const TTL_MS = Number(process.env.PROMOTERS_CACHE_TTL_MS ?? 5 * 60 * 1000);
 
let clientPromise = null;
let cache = { at: 0, byId: new Map() };
 
function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para leer promotores del Sheet.");
}
 
function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}
 
async function loadPromoters() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.promotersTab}!A1:Z2000`,
  });
  const rows = res.data.values ?? [];
  let header = -1, idC = -1, passC = -1, nameC = -1, locC = -1, supC = -1, estC = -1, entC = -1, salC = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((c) => String(c ?? "").trim());
    const idI = cells.findIndex((c) => /^id$/i.test(c));
    const passI = cells.findIndex((c) => /contrase|password/i.test(c));
    if (idI !== -1 && passI !== -1) {
      header = r; idC = idI; passC = passI;
      nameC = cells.findIndex((c) => /promotor|nombre/i.test(c));
      locC = cells.findIndex((c) => /ubicaci/i.test(c));
      supC = cells.findIndex((c) => /supervisor/i.test(c));
      estC = cells.findIndex((c) => /^estado$/i.test(c));
      entC = cells.findIndex((c) => /^entrada$/i.test(c));
      salC = cells.findIndex((c) => /^salida$/i.test(c));
      break;
    }
  }
  if (header === -1) throw new Error(`Encabezado (ID + CONTRASEÑA) no encontrado en "${config.sheets.promotersTab}".`);

  const byId = new Map();
  for (let r = header + 1; r < rows.length; r++) {
    const cells = rows[r];
    const id = String(cells?.[idC] ?? "").trim();
    if (!id) continue;
    byId.set(id, {
      id,
      name: String(cells?.[nameC] ?? "").trim(),
      location: locC !== -1 ? String(cells?.[locC] ?? "").trim() : null,
      supervisor: supC !== -1 ? String(cells?.[supC] ?? "").trim() : null,
      estado: estC !== -1 ? String(cells?.[estC] ?? "").trim() || null : null,
      // Horario esperado ("H:MM", 24h) — puede faltar si aún no se llenó.
      entrada: entC !== -1 ? String(cells?.[entC] ?? "").trim() || null : null,
      salida: salC !== -1 ? String(cells?.[salC] ?? "").trim() || null : null,
      password: String(cells?.[passC] ?? "").trim(), // hash bcrypt
    });
  }
  cache = { at: Date.now(), byId };
  return cache;
}
 
async function ensureCache() {
  if (Date.now() - cache.at < TTL_MS && cache.byId.size) return cache;
  try {
    return await loadPromoters();
  } catch (e) {
    console.error("[promotersSheet] No se pudo leer el Sheet:", e.message);
    if (cache.byId.size) return cache; // usa el caché previo si la API falla
    throw e;
  }
}
 
// Misma interfaz que db.findPromoterById: devuelve { id, name, location, supervisor, password }.
export async function findPromoterInSheet(promoterId) {
  const { byId } = await ensureCache();
  return byId.get(String(promoterId).trim()) ?? null;
}

// Todos los promotores del Sheet, indexados por ID. Lo usa activitySheet.js
// para saber el SUPERVISOR de cada promotor sin depender de que ya exista una
// fila en la base local (que solo se crea cuando ese promotor inició sesión
// alguna vez en ESTE backend).
export async function getAllPromotersFromSheet() {
  const { byId } = await ensureCache();
  return byId;
}