// ---------------------------------------------------------------------------
// Resumen de reportes de competencia — Google Sheets ("Competencia").
// ---------------------------------------------------------------------------
// El reporte completo (con las fotos) se guarda en la base de datos
// (CompetitionReport); esta pestaña solo recibe una fila-resumen para que el
// admin pueda revisarlos sin abrir la app. Best-effort: si el Sheet no está
// configurado o falla, se registra el error y se sigue (el reporte YA quedó
// guardado en la base de datos, así que nunca se pierde).
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { formatMexicoDateTime } from "./businessDay.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const HEADERS = ["registrado_en", "id_promotor", "nombre", "marca", "descripcion", "fotos"];

let clientPromise = null;
let tabEnsured = false;

function isConfigured() {
  return Boolean((config.sheets.json || config.sheets.keyFile) && config.sheets.spreadsheetId);
}

function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para el Sheet de competencia.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

async function ensureTab(sheets) {
  if (tabEnsured) return;
  const tab = config.sheets.competenciaTab;
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.sheets.spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range: `${tab}!A1:Z1` });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
  tabEnsured = true;
}

// Agrega la fila-resumen de un reporte de competencia. Best-effort: nunca
// lanza (el reporte ya está a salvo en la base de datos).
export async function appendCompetitionRow({ promoterId, promoterName, marca, descripcion, photoCount }) {
  if (!isConfigured()) {
    console.warn("[competitionSheet] Sin credenciales/spreadsheetId; se omite.");
    return { skipped: true };
  }
  try {
    const sheets = await getClient();
    await ensureTab(sheets);
    const row = [
      formatMexicoDateTime(new Date()), // registrado_en (hora de México, no UTC)
      promoterId,
      promoterName,
      marca,
      descripcion,
      photoCount > 0 ? `${photoCount} foto(s)` : "sin fotos",
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${config.sheets.competenciaTab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    return { appended: true };
  } catch (e) {
    console.error("[competitionSheet] No se pudo agregar la fila:", e.message);
    return { error: e.message };
  }
}
