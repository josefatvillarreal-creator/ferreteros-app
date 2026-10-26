import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (keyFile && existsSync(keyFile)) {
    return JSON.parse(readFileSync(keyFile, "utf8"));
  }
  throw new Error("No se encontraron credenciales (GOOGLE_SERVICE_ACCOUNT_JSON o _KEY_FILE).");
}

const looksSecret = (h) => /contrase|password|passwd|clave|pass/i.test(String(h || ""));

async function main() {
  if (!SPREADSHEET_ID) throw new Error("Falta GOOGLE_SHEETS_ID en backend/.env");
  const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))",
  });

  console.log("\n================ LIBRO ================");
  console.log("Titulo:", meta.data.properties?.title);
  console.log("Pestanas:", meta.data.sheets?.length ?? 0);

  for (const sh of meta.data.sheets ?? []) {
    const title = sh.properties?.title;
    const rows = sh.properties?.gridProperties?.rowCount;
    const cols = sh.properties?.gridProperties?.columnCount;
    console.log(`\n================ PESTANA: "${title}" ================`);
    console.log(`(grid: ${rows} filas x ${cols} columnas)`);
    const range = `${title}!A1:Z3`;
    let values = [];
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
      values = res.data.values ?? [];
    } catch (e) {
      console.log("  (no se pudo leer:", e.message, ")");
      continue;
    }
    const header = values[0] ?? [];
    console.log("ENCABEZADOS (fila 1):");
    header.forEach((h, i) => console.log(`  [${String.fromCharCode(65 + i)}] ${h}`));
    for (let r = 1; r < values.length; r++) {
      const row = values[r].map((cell, i) => (looksSecret(header[i]) ? "******" : cell));
      console.log(`FILA DE MUESTRA ${r}:`, JSON.stringify(row));
    }
    if (values.length <= 1) console.log("  (sin filas de datos)");
  }
  console.log("\n================ FIN ================\n");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
