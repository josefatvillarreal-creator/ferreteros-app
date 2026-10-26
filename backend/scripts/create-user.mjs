// ---------------------------------------------------------------------------
// Alta / actualización de un USUARIO administrativo (admin, gerente o
// supervisor).
// ---------------------------------------------------------------------------
// Crea (o repara) la pestaña "Usuarios" del libro y agrega/actualiza un usuario
// con su contraseña guardada como HASH bcrypt (NUNCA en texto plano).
//
// USO (desde backend/):
//   node scripts/create-user.mjs <ID> <ROL> "<NOMBRE>" [--password "MiClave"] [--length 14]
//
// Ejemplos:
//   node scripts/create-user.mjs admin admin "Administrador Protexa"
//   node scripts/create-user.mjs 9001 gerente "Andrea Orantes" --password "GerenteFuerte#2026"
//   node scripts/create-user.mjs eloy supervisor "Eloy"
//
// IMPORTANTE para supervisores: el ID debe coincidir (en minúsculas) con el
// nombre exacto que aparece en la columna SUPERVISOR de la pestaña
// "Promotores" — así es como el backend sabe qué promotores le corresponden a
// cada supervisor (ver GET /api/supervisor/summary).
//
// Si NO pasas --password, se genera una segura y se muestra UNA sola vez para
// que la entregues por un canal seguro. El Sheet solo guarda el hash.
// ---------------------------------------------------------------------------
import "dotenv/config";
import bcrypt from "bcryptjs";
import { getSheetsClient, generateSecurePassword, SPREADSHEET_ID } from "./_sheetlib.mjs";

const USUARIOS_TAB = process.env.GOOGLE_SHEETS_USUARIOS_TAB || "Usuarios";
const HEADERS = ["ID", "Nombre", "Rol", "Contraseña"];
const COST = 12;

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const [id, rolRaw, nombre] = positional;
const pwIdx = args.indexOf("--password");
const explicitPw = pwIdx !== -1 ? args[pwIdx + 1] : null;
const lenIdx = args.indexOf("--length");
const LENGTH = lenIdx !== -1 ? Number(args[lenIdx + 1]) || 14 : 14;

function normalizeRole(v) {
  const s = String(v || "");
  if (/admin/i.test(s)) return "admin";
  if (/supervisor/i.test(s)) return "supervisor";
  return "gerente";
}

// Índice de columna (0-based) -> letra A1.
function colLetter(idx) {
  let s = "";
  for (let n = idx; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

// Asegura que la pestaña exista y tenga encabezados. Devuelve la matriz de filas.
async function ensureTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: "sheets.properties.title" });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === USUARIOS_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: USUARIOS_TAB } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${USUARIOS_TAB}!A1:Z2000` });
  let rows = res.data.values ?? [];
  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USUARIOS_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
    rows = [HEADERS];
  }
  return rows;
}

// Detecta las columnas por encabezado (tolerante al orden).
function detectCols(header) {
  const cells = header.map((c) => String(c ?? "").trim());
  return {
    idC: cells.findIndex((c) => /^id$/i.test(c)),
    nameC: cells.findIndex((c) => /nombre|usuario/i.test(c)),
    roleC: cells.findIndex((c) => /rol|role|perfil/i.test(c)),
    passC: cells.findIndex((c) => /contrase|password/i.test(c)),
  };
}

async function main() {
  if (!id || !rolRaw || !nombre) {
    console.error('Uso: node scripts/create-user.mjs <ID> <ROL: admin|gerente|supervisor> "<NOMBRE>" [--password "..."] [--length 14]');
    process.exit(1);
  }
  const rol = normalizeRole(rolRaw);
  const sheets = await getSheetsClient();
  const rows = await ensureTab(sheets);

  let { idC, nameC, roleC, passC } = detectCols(rows[0] || HEADERS);
  // Si por alguna razón faltan columnas, reescribe los encabezados estándar.
  if (idC === -1 || passC === -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${USUARIOS_TAB}!A1`, valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
    idC = 0; nameC = 1; roleC = 2; passC = 3;
  }

  const pw = explicitPw || generateSecurePassword(LENGTH);
  const hash = await bcrypt.hash(pw, COST);

  // ¿Ya existe el ID? -> actualiza esa fila; si no, agrega una nueva.
  let rowNumber = -1;
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r]?.[idC] ?? "").trim() === String(id).trim()) { rowNumber = r + 1; break; }
  }

  const rowValues = [];
  rowValues[idC] = String(id).trim();
  if (nameC !== -1) rowValues[nameC] = nombre;
  if (roleC !== -1) rowValues[roleC] = rol;
  rowValues[passC] = hash;
  for (let i = 0; i < rowValues.length; i++) if (rowValues[i] === undefined) rowValues[i] = "";

  if (rowNumber === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: `${USUARIOS_TAB}!A1`,
      valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
    console.log(`\n✅ Usuario CREADO: ${nombre} (ID ${id}, rol ${rol}).`);
  } else {
    const lastCol = colLetter(rowValues.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${USUARIOS_TAB}!A${rowNumber}:${lastCol}${rowNumber}`,
      valueInputOption: "RAW", requestBody: { values: [rowValues] },
    });
    console.log(`\n✅ Usuario ACTUALIZADO: ${nombre} (ID ${id}, rol ${rol}, fila ${rowNumber}).`);
  }

  console.log(`   Contraseña (entrégala por un canal seguro): ${pw}`);
  console.log("   El Sheet solo guarda el hash; esta contraseña no se puede volver a mostrar.\n");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
