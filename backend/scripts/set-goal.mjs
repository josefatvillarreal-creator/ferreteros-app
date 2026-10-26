// ---------------------------------------------------------------------------
// Alta / actualización de UNA meta mensual (promotor o tienda) en la pestaña
// "Metas" del Sheet (unidades = rollos+cubetas del mes).
// ---------------------------------------------------------------------------
// Crea la pestaña si no existe. Si el ID ya tiene una meta, la reemplaza.
//
// USO (desde backend/):
//   node scripts/set-goal.mjs <promotor|tienda> <ID> <META_UNIDADES> ["<Nombre opcional>"]
//
// Ejemplos:
//   node scripts/set-goal.mjs promotor 90500276 40 "HERNANDEZ HERNANDEZ JUAN VICENTE"
//   node scripts/set-goal.mjs tienda 8789 300 "Miguel Alemán"
// ---------------------------------------------------------------------------
import "dotenv/config";
import { getSheetsClient, colLetter } from "./_sheetlib.mjs";

const METAS_TAB = process.env.GOOGLE_SHEETS_METAS_TAB || "Metas";
const HEADERS = ["Tipo", "ID", "Nombre", "Meta"];

const [tipoRaw, id, metaRaw, nombre] = process.argv.slice(2);

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

export async function setGoal({ tipo, id, meta, nombre, sheets, rows }) {
  const cells = rows[0].map((c) => String(c ?? "").trim());
  const tipoC = cells.findIndex((c) => /^tipo$/i.test(c));
  const idC = cells.findIndex((c) => /^id$/i.test(c));
  const nameC = cells.findIndex((c) => /^nombre$/i.test(c));
  const metaC = cells.findIndex((c) => /^meta/i.test(c));

  let rowNumber = -1;
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r]?.[idC] ?? "").trim() === String(id).trim() && String(rows[r]?.[tipoC] ?? "").trim().toLowerCase() === tipo) {
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
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${METAS_TAB}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
  } else {
    const lastCol = colLetter(rowValues.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${METAS_TAB}!A${rowNumber}:${lastCol}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  }
}

async function main() {
  const tipo = String(tipoRaw || "").trim().toLowerCase();
  const meta = Number(metaRaw);
  if (!["promotor", "tienda"].includes(tipo) || !id || !Number.isFinite(meta) || meta <= 0) {
    console.error('Uso: node scripts/set-goal.mjs <promotor|tienda> <ID> <META_UNIDADES> ["<Nombre>"]');
    process.exit(1);
  }
  const sheets = await getSheetsClient();
  const rows = await ensureTab(sheets);
  await setGoal({ tipo, id, meta, nombre, sheets, rows });
  console.log(`✅ Meta guardada: ${tipo} ${id} -> ${meta} unidades/mes.`);
}

// Solo ejecuta el CLI si se invoca directamente (para poder importar setGoal
// desde seed-promoter-goals.mjs sin disparar el main()). Compara vía
// pathToFileURL (no un template literal a mano): esta carpeta vive en Google
// Drive y tiene espacios en la ruta, que un `file://${...}` simple no escapa
// igual que `import.meta.url` — la comparación fallaba siempre y el script no
// hacía nada, sin avisar.
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
