// ---------------------------------------------------------------------------
// Migración de contraseñas a HASH bcrypt en el Google Sheet «BBDD Promotores».
// ---------------------------------------------------------------------------
// Genera una contraseña segura por promotor, guarda el HASH (irreversible) en la
// columna CONTRASEÑA, y produce un CSV local con las contraseñas en claro para
// distribuirlas UNA sola vez. Idempotente: no re-hashea lo ya hasheado.
//
// USO (desde backend/):
//   node scripts/migrate-passwords.mjs            # SIMULACRO (no escribe nada)
//   node scripts/migrate-passwords.mjs --apply    # aplica: escribe hashes + CSV
//   node scripts/migrate-passwords.mjs --apply --force   # re-hashea incluso filas ya hasheadas
//   ... --length 14                               # longitud de contraseña (def. 12)
//
// ANTES DE --apply: haz un respaldo del Sheet (Archivo → Hacer una copia).
// ---------------------------------------------------------------------------
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import {
  getSheetsClient, readPromoters, generateSecurePassword, isBcryptHash,
  SPREADSHEET_ID, PROMOTERS_TAB,
} from "./_sheetlib.mjs";
 
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const COST = 12;
const lenArg = args.indexOf("--length");
const LENGTH = lenArg !== -1 ? Number(args[lenArg + 1]) || 12 : 12;
 
function csvCell(s) {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
 
async function main() {
  const sheets = await getSheetsClient();
  const { promoters, passColLetter } = await readPromoters(sheets);
 
  const toChange = promoters.filter((p) => FORCE || !isBcryptHash(p.passwordCell));
  const skipped = promoters.length - toChange.length;
 
  console.log(`\nPestaña: "${PROMOTERS_TAB}"  |  Promotores: ${promoters.length}`);
  console.log(`A hashear: ${toChange.length}  |  Ya hasheados (omitidos): ${skipped}`);
  console.log(`Columna de contraseña: ${passColLetter}  |  Modo: ${APPLY ? "APLICAR ✍️" : "SIMULACRO (no escribe)"}\n`);
 
  if (!toChange.length) { console.log("Nada que hacer."); return; }
 
  // Genera contraseña + hash para cada promotor a cambiar.
  const results = [];
  for (const p of toChange) {
    const pw = generateSecurePassword(LENGTH);
    const hash = await bcrypt.hash(pw, COST);
    results.push({ ...p, pw, hash });
  }
 
  if (!APPLY) {
    console.log("SIMULACRO — se cambiarían estas filas (sin mostrar contraseñas):");
    results.slice(0, 8).forEach((r) => console.log(`  fila ${r.rowNumber}  ID ${r.id}  ${r.name}`));
    if (results.length > 8) console.log(`  ... y ${results.length - 8} más`);
    console.log("\nVuelve a correr con --apply para escribir los hashes y generar el CSV de distribución.");
    return;
  }
 
  // Escribe los hashes en la columna de contraseña (RAW: no reinterpretar el $).
  const data = results.map((r) => ({
    range: `${PROMOTERS_TAB}!${passColLetter}${r.rowNumber}`,
    values: [[r.hash]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "RAW", data },
  });
 
  // CSV local con las contraseñas EN CLARO para distribuir una sola vez.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `nuevas-contrasenas-${stamp}.csv`;
  const lines = ["ID,Nombre,Contraseña"];
  for (const r of results) lines.push(`${csvCell(r.id)},${csvCell(r.name)},${csvCell(r.pw)}`);
  writeFileSync(file, lines.join("\n"), "utf8");
 
  console.log(`✅ ${results.length} hashes escritos en el Sheet.`);
  console.log(`📄 Contraseñas en claro para distribuir: ${file}`);
  console.log("⚠️  Entrega cada contraseña a su promotor por un canal seguro y BORRA este archivo después.");
  console.log("    (El Sheet ya NO contiene contraseñas legibles; para olvidos usa reset-password.mjs.)");
}
 
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });