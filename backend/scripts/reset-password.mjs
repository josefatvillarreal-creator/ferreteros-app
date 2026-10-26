// ---------------------------------------------------------------------------
// Reseteo de contraseña de UN promotor (genera nueva + guarda el hash).
// ---------------------------------------------------------------------------
// USO (desde backend/):
//   node scripts/reset-password.mjs <ID_PROMOTOR> [--length 12]
//
// Genera una contraseña segura nueva, escribe su HASH en el Sheet y te muestra
// la contraseña en claro UNA vez para que se la entregues al promotor.
// ---------------------------------------------------------------------------
import bcrypt from "bcryptjs";
import {
  getSheetsClient, readPromoters, generateSecurePassword,
  SPREADSHEET_ID, PROMOTERS_TAB,
} from "./_sheetlib.mjs";
 
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const lenArg = args.indexOf("--length");
const LENGTH = lenArg !== -1 ? Number(args[lenArg + 1]) || 12 : 12;
const COST = 12;
 
async function main() {
  if (!id) { console.error("Uso: node scripts/reset-password.mjs <ID_PROMOTOR>"); process.exit(1); }
  const sheets = await getSheetsClient();
  const { promoters, passColLetter } = await readPromoters(sheets);
  const p = promoters.find((x) => x.id === String(id).trim());
  if (!p) { console.error(`No se encontró el promotor con ID "${id}" en la pestaña "${PROMOTERS_TAB}".`); process.exit(1); }
 
  const pw = generateSecurePassword(LENGTH);
  const hash = await bcrypt.hash(pw, COST);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${PROMOTERS_TAB}!${passColLetter}${p.rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[hash]] },
  });
 
  console.log(`\n✅ Contraseña reseteada para ${p.name || p.id} (ID ${p.id}, fila ${p.rowNumber}).`);
  console.log(`   Nueva contraseña (entrégala por un canal seguro): ${pw}`);
  console.log("   El Sheet solo guarda el hash; esta contraseña no se puede volver a mostrar.\n");
}
 
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });