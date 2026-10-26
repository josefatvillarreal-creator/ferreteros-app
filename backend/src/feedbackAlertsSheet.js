// ---------------------------------------------------------------------------
// Configuración de las alertas automáticas de Retroalimentación (correo +
// push vía ntfy.sh), en dos pestañas nuevas del mismo Sheet:
// ---------------------------------------------------------------------------
// Quien REALMENTE dispara las alertas es un Google Apps Script atado al
// Sheet (no este backend): revisa cada pocos minutos si hay filas nuevas en
// "Retroalimentacion", y si "AlertasRetroConfig" dice Activo=SI, manda un
// correo (MailApp, sin SMTP) a cada fila de "AlertasRetroDestinatarios" y un
// push a `https://ntfy.sh/<TemaNtfy>`. Ver MANUAL_DESPLIEGUE.md para el
// código exacto del script y cómo instalarlo.
//
// Este backend SOLO lee/escribe esas dos pestañas para que el admin las
// pueda editar desde el tablero (encender/apagar, agregar/quitar
// destinatarios) sin tocar el Sheet a mano:
//
//   "AlertasRetroConfig": Activo (SI|NO) | TemaNtfy — una sola fila de datos.
//   "AlertasRetroDestinatarios": Nombre | Email — una fila por destinatario.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import { config } from "./config.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const CONFIG_HEADERS = ["Activo", "TemaNtfy"];
const DEST_HEADERS = ["Nombre", "Email"];

let clientPromise = null;

function isConfigured() {
  return Boolean((config.sheets.json || config.sheets.keyFile) && config.sheets.spreadsheetId);
}

function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para las alertas de retroalimentación.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

// Tema ntfy.sh por defecto: aleatorio y difícil de adivinar (los temas de
// ntfy.sh son públicos — cualquiera que sepa el nombre puede suscribirse o
// leerlo — así que no usamos algo obvio como "protexa-retroalimentacion").
function randomTopic() {
  return `protexa-retro-${randomBytes(5).toString("hex")}`;
}

async function ensureConfigTab(sheets) {
  const tab = config.sheets.alertasRetroConfigTab;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheets.spreadsheetId, fields: "sheets.properties.title" });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range: `${tab}!A1:B2` });
  const rows = res.data.values ?? [];
  if (rows.length < 2) {
    // Fila de encabezado + una fila de datos con los valores por defecto:
    // apagado hasta que el admin lo prenda a propósito, con un tema nuevo.
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [CONFIG_HEADERS, ["NO", randomTopic()]] },
    });
  }
}

async function ensureDestinatariosTab(sheets) {
  const tab = config.sheets.alertasRetroDestinatariosTab;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheets.spreadsheetId, fields: "sheets.properties.title" });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range: `${tab}!A1:B1` });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [DEST_HEADERS] },
    });
  }
}

export async function getFeedbackAlertsConfig() {
  if (!isConfigured()) return { activo: false, temaNtfy: "" };
  const sheets = await getClient();
  await ensureConfigTab(sheets);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.alertasRetroConfigTab}!A2:B2`,
  });
  const [activo, temaNtfy] = res.data.values?.[0] ?? ["NO", ""];
  return { activo: String(activo ?? "").trim().toUpperCase() === "SI", temaNtfy: String(temaNtfy ?? "").trim() };
}

export async function setFeedbackAlertsConfig({ activo, temaNtfy }) {
  if (!isConfigured()) throw new Error("Google Sheets no está configurado (faltan credenciales o GOOGLE_SHEETS_ID).");
  const sheets = await getClient();
  await ensureConfigTab(sheets);
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.alertasRetroConfigTab}!A2`,
    valueInputOption: "RAW",
    requestBody: { values: [[activo ? "SI" : "NO", String(temaNtfy ?? "").trim()]] },
  });
  return { activo: Boolean(activo), temaNtfy: String(temaNtfy ?? "").trim() };
}

export async function getFeedbackAlertsRecipients() {
  if (!isConfigured()) return [];
  const sheets = await getClient();
  await ensureDestinatariosTab(sheets);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.alertasRetroDestinatariosTab}!A2:B2000`,
  });
  return (res.data.values ?? [])
    .map((r) => ({ nombre: String(r[0] ?? "").trim(), email: String(r[1] ?? "").trim() }))
    .filter((r) => r.email);
}

// Agrega un destinatario, o actualiza su nombre si ese email ya estaba.
export async function addFeedbackAlertsRecipient(nombre, email) {
  if (!isConfigured()) throw new Error("Google Sheets no está configurado (faltan credenciales o GOOGLE_SHEETS_ID).");
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error("Correo inválido");
  const sheets = await getClient();
  await ensureDestinatariosTab(sheets);
  const tab = config.sheets.alertasRetroDestinatariosTab;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range: `${tab}!A1:B2000` });
  const rows = res.data.values ?? [];
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[1] ?? "").trim().toLowerCase() === cleanEmail);
  if (rowIdx !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A${rowIdx + 1}:B${rowIdx + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: [[nombre ?? "", cleanEmail]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[nombre ?? "", cleanEmail]] },
    });
  }
}

export async function removeFeedbackAlertsRecipient(email) {
  if (!isConfigured()) throw new Error("Google Sheets no está configurado (faltan credenciales o GOOGLE_SHEETS_ID).");
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const sheets = await getClient();
  await ensureDestinatariosTab(sheets);
  const tab = config.sheets.alertasRetroDestinatariosTab;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheets.spreadsheetId, fields: "sheets.properties" });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === tab)?.properties.sheetId;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range: `${tab}!A1:B2000` });
  const rows = res.data.values ?? [];
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[1] ?? "").trim().toLowerCase() === cleanEmail);
  if (rowIdx === -1) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.sheets.spreadsheetId,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }] },
  });
}
