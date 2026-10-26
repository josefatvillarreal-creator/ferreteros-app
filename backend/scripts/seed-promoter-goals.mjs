// ---------------------------------------------------------------------------
// Siembra una meta mensual PLACEHOLDER (unidades = rollos+cubetas) para cada
// promotor de la pestaña "Promotores" que TODAVÍA no tenga una fila en
// "Metas". No pisa metas que ya existan (así se puede correr de nuevo sin
// riesgo cuando se dan de alta promotores nuevos).
// ---------------------------------------------------------------------------
// USO (desde backend/):
//   node scripts/seed-promoter-goals.mjs [META_UNIDADES]
//   (sin argumento, usa 40 unidades/mes como placeholder)
//
// IMPORTANTE: 40 es un valor de PRUEBA para que la funcionalidad se pueda ver
// funcionando. Edita la columna "Meta" directamente en el Sheet con los
// números reales del negocio cuando los tengan.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { getSheetsClient, readPromoters } from "./_sheetlib.mjs";

const METAS_TAB = process.env.GOOGLE_SHEETS_METAS_TAB || "Metas";
const HEADERS = ["Tipo", "ID", "Nombre", "Meta"];
const PLACEHOLDER = Number(process.argv[2]) || 40;

async function ensureTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEETS_ID, fields: "sheets.properties.title" });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === METAS_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: METAS_TAB } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEETS_ID, range: `${METAS_TAB}!A1:Z2000` });
  let rows = res.data.values ?? [];
  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${METAS_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
    rows = [HEADERS];
  }
  return rows;
}

async function main() {
  const sheets = await getSheetsClient();
  const rows = await ensureTab(sheets);
  const cells = rows[0].map((c) => String(c ?? "").trim());
  const tipoC = cells.findIndex((c) => /^tipo$/i.test(c));
  const idC = cells.findIndex((c) => /^id$/i.test(c));

  const existing = new Set();
  for (let r = 1; r < rows.length; r++) {
    const tipo = String(rows[r]?.[tipoC] ?? "").trim().toLowerCase();
    const id = String(rows[r]?.[idC] ?? "").trim();
    if (id) existing.add(`${tipo || "promotor"}:${id}`);
  }

  const { promoters } = await readPromoters(sheets);
  const toAdd = promoters.filter((p) => !existing.has(`promotor:${p.id}`));
  if (!toAdd.length) {
    console.log("Todos los promotores ya tienen una meta definida. Nada que sembrar.");
    return;
  }

  const newRows = toAdd.map((p) => ["promotor", p.id, p.name, PLACEHOLDER]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${METAS_TAB}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: newRows },
  });
  console.log(`✅ Sembradas ${newRows.length} metas de PRUEBA (${PLACEHOLDER} unidades/mes). Edita la columna "Meta" en el Sheet con los números reales.`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
