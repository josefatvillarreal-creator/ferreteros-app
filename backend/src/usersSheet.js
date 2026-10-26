// ---------------------------------------------------------------------------
// Usuarios administrativos (ADMIN / GERENTE) desde Google Sheets.
// ---------------------------------------------------------------------------
// Estos usuarios NO son promotores: viven en su propia pestaña ("Usuarios") para
// no mezclarlos con los 54 promotores de campo. El login (auth.js) los busca
// AQUÍ primero; si no encuentra el ID, cae al listado de promotores.
//
// Estructura esperada de la pestaña "Usuarios" (los encabezados se detectan por
// su nombre, no por posición):
//   ID | Nombre | Rol | Contraseña
//   - ID         → identificador con el que inicia sesión (ej. "admin", "9001").
//   - Nombre     → nombre para mostrar.
//   - Rol        → "admin" o "gerente" (cualquier otra cosa se trata como "gerente").
//   - Contraseña → HASH bcrypt (nunca texto plano). Se genera con
//                  `node scripts/create-user.mjs`.
//
// Cachea en memoria (TTL) para no llamar a la API en cada login. Si la pestaña
// aún no existe o no hay credenciales, devuelve null sin lanzar (el login sigue
// con el flujo de promotores).
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const TTL_MS = Number(process.env.USERS_CACHE_TTL_MS ?? 5 * 60 * 1000);

let clientPromise = null;
let cache = { at: 0, byId: new Map() };

function isConfigured() {
  return Boolean((config.sheets.json || config.sheets.keyFile) && config.sheets.spreadsheetId);
}

function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para leer usuarios del Sheet.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

// Normaliza el rol a un valor conocido. Un usuario en esta pestaña nunca es un
// promotor de campo: es "admin", "gerente" o "supervisor" (ve solo a SUS
// promotores, filtrados por el nombre en la columna SUPERVISOR de la pestaña
// Promotores). Cualquier otra cosa cae a "gerente".
function normalizeRole(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (/admin/.test(v)) return "admin";
  if (/supervisor/.test(v)) return "supervisor";
  return "gerente";
}

async function loadUsers() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.usuariosTab}!A1:Z2000`,
  });
  const rows = res.data.values ?? [];
  let header = -1, idC = -1, passC = -1, nameC = -1, roleC = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((c) => String(c ?? "").trim());
    const idI = cells.findIndex((c) => /^id$/i.test(c));
    const passI = cells.findIndex((c) => /contrase|password/i.test(c));
    if (idI !== -1 && passI !== -1) {
      header = r; idC = idI; passC = passI;
      nameC = cells.findIndex((c) => /nombre|usuario/i.test(c));
      roleC = cells.findIndex((c) => /rol|role|perfil/i.test(c));
      break;
    }
  }
  if (header === -1) throw new Error(`Encabezado (ID + CONTRASEÑA) no encontrado en "${config.sheets.usuariosTab}".`);

  const byId = new Map();
  for (let r = header + 1; r < rows.length; r++) {
    const cells = rows[r];
    const id = String(cells?.[idC] ?? "").trim();
    if (!id) continue;
    byId.set(id, {
      id,
      name: nameC !== -1 ? String(cells?.[nameC] ?? "").trim() : id,
      role: normalizeRole(roleC !== -1 ? cells?.[roleC] : ""),
      password: String(cells?.[passC] ?? "").trim(), // hash bcrypt
    });
  }
  cache = { at: Date.now(), byId };
  return cache;
}

async function ensureCache() {
  if (Date.now() - cache.at < TTL_MS && cache.byId.size) return cache;
  return loadUsers();
}

// Devuelve { id, name, role, password } o null. Nunca lanza: si la pestaña no
// existe o hay un problema de credenciales, se comporta como "usuario no
// encontrado" para que el login continúe con el flujo de promotores.
export async function findUserInSheet(userId) {
  if (!isConfigured()) return null;
  try {
    const { byId } = await ensureCache();
    return byId.get(String(userId).trim()) ?? null;
  } catch (e) {
    // Pestaña "Usuarios" ausente todavía, o error transitorio: no es fatal.
    if (cache.byId.size) return cache.byId.get(String(userId).trim()) ?? null;
    console.warn("[usersSheet] No se pudo leer la pestaña de usuarios:", e.message);
    return null;
  }
}

// Todos los usuarios con rol "supervisor" — lo usa el reporte semanal para
// generarle uno a cada supervisor (uno por uno, con SU equipo).
export async function getAllSupervisorsFromSheet() {
  if (!isConfigured()) return [];
  try {
    const { byId } = await ensureCache();
    return [...byId.values()].filter((u) => u.role === "supervisor");
  } catch (e) {
    console.warn("[usersSheet] No se pudo leer supervisores:", e.message);
    return [];
  }
}
