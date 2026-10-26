// ---------------------------------------------------------------------------
// Librería compartida para la gestión segura de contraseñas en Google Sheets.
// La usan migrate-passwords.mjs y reset-password.mjs.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { google } from "googleapis";
 
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
export const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
export const PROMOTERS_TAB = process.env.GOOGLE_SHEETS_PROMOTERS_TAB || "Promotores";
 
// --- Generador de contraseñas seguras --------------------------------------
// Alfabeto sin caracteres ambiguos (0/O, 1/l/I) para que sean tecleables.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const SYMBOL = "@#$%*+=?";
const ALL = LOWER + UPPER + DIGIT + SYMBOL;
const pick = (set) => set[randomInt(set.length)];
 
export function generateSecurePassword(length = 12) {
  length = Math.max(8, length);
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
 
// Un hash bcrypt ya guardado se reconoce por su prefijo ($2a$/$2b$/$2y$).
export const isBcryptHash = (v) => typeof v === "string" && /^\$2[aby]\$/.test(v.trim());
 
// --- Cliente de Google Sheets ----------------------------------------------
function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const kf = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (kf && existsSync(kf)) return JSON.parse(readFileSync(kf, "utf8"));
  throw new Error("Sin credenciales (define GOOGLE_SERVICE_ACCOUNT_JSON o _KEY_FILE en backend/.env).");
}
 
export async function getSheetsClient() {
  if (!SPREADSHEET_ID) throw new Error("Falta GOOGLE_SHEETS_ID en backend/.env");
  const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
  return google.sheets({ version: "v4", auth: await auth.getClient() });
}
 
// Índice de columna (0-based) -> letra A1 (0->A, 5->F, 26->AA).
export function colLetter(idx) {
  let s = "";
  for (let n = idx; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}
 
// Lee la pestaña de promotores y detecta DINÁMICAMENTE las columnas por su
// encabezado (no asume posiciones), tolerando fila 1 vacía y columna A vacía.
export async function readPromoters(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${PROMOTERS_TAB}!A1:Z2000`,
  });
  const rows = res.data.values ?? [];
 
  // Fila de encabezado: la primera que contenga "ID" y una columna de contraseña.
  let headerRow = -1, idCol = -1, passCol = -1, nameCol = -1, locCol = -1, supCol = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((c) => String(c ?? "").trim());
    const findIdx = (re) => cells.findIndex((c) => re.test(c));
    const idI = cells.findIndex((c) => /^id$/i.test(c));
    const passI = findIdx(/contrase|password/i);
    if (idI !== -1 && passI !== -1) {
      headerRow = r; idCol = idI; passCol = passI;
      nameCol = findIdx(/promotor|nombre/i);
      locCol = findIdx(/ubicaci/i);
      supCol = findIdx(/supervisor/i);
      break;
    }
  }
  if (headerRow === -1) throw new Error(`No se encontró el encabezado (ID + CONTRASEÑA) en la pestaña "${PROMOTERS_TAB}".`);
 
  const promoters = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r];
    const id = String(cells?.[idCol] ?? "").trim();
    if (!id) continue; // fila vacía
    promoters.push({
      rowNumber: r + 1, // 1-based para rangos A1
      id,
      name: String(cells?.[nameCol] ?? "").trim(),
      location: locCol !== -1 ? String(cells?.[locCol] ?? "").trim() : "",
      supervisor: supCol !== -1 ? String(cells?.[supCol] ?? "").trim() : "",
      passwordCell: String(cells?.[passCol] ?? "").trim(),
    });
  }
  return { headerRow, idCol, passCol, nameCol, passColLetter: colLetter(passCol), promoters };
}