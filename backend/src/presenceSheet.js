// ---------------------------------------------------------------------------
// Confirmaciones de "sigo en tienda" — Google Sheets ("Confirmación en tienda").
// ---------------------------------------------------------------------------
// La app del promotor le muestra, una vez al día en un momento aleatorio
// entre 10am y 4pm (mientras tiene un check-in abierto), la pregunta "¿sigues
// en la tienda?" (Sí/No). Al responder cualquiera de las dos, se captura su
// GPS en ese momento y se guarda una fila aquí con la respuesta y esa
// ubicación — a diferencia del check-in, esto NO se revalida contra el radio
// de la tienda (si responde "No" lo normal es que ya esté fuera de rango).
// A diferencia del check-out, SÍ propagamos el error al caller (mismo
// criterio que retroalimentación): es el registro que importa, no queremos
// que falle en silencio sin que el promotor se entere.
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { formatMexicoDateTime } from "./businessDay.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const HEADERS = ["registrado_en", "id_promotor", "nombre", "supervisor", "id_tienda", "tienda", "ubicacion", "sigue_en_tienda"];

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
  throw new Error("Sin credenciales de Service Account para el Sheet de confirmación en tienda.");
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
  const tab = config.sheets.confirmacionTab;
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
  const current = (res.data.values && res.data.values[0]) || [];
  if (current.length < HEADERS.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
  tabEnsured = true;
}

// Agrega una fila de confirmación. Lanza si falla (el caller decide qué
// responderle al promotor) — ver comentario arriba. `coords` es
// {lat,lng} | null (best-effort: si el GPS falla o lo niega, se guarda vacío,
// no se bloquea la respuesta) y `sigueEnTienda` es boolean.
export async function appendPresenceConfirmation({ promoterId, promoterName, supervisor, sucursalId, sucursalName, coords, sigueEnTienda }) {
  if (!isConfigured()) {
    throw new Error("La integración con Google Sheets no está configurada (faltan credenciales o GOOGLE_SHEETS_ID).");
  }
  const sheets = await getClient();
  await ensureTab(sheets);
  const row = [
    formatMexicoDateTime(new Date()), // registrado_en (hora de México, no UTC)
    promoterId,
    promoterName,
    supervisor || "",
    sucursalId,
    sucursalName,
    coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? `${coords.lat},${coords.lng}` : "",
    sigueEnTienda ? "Sí" : "No",
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.confirmacionTab}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return { appended: true };
}
