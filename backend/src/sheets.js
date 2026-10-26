// ---------------------------------------------------------------------------
// Integración con Google Sheets (para el administrador).
// ---------------------------------------------------------------------------
// Al hacer check-out de una visita, se agrega una fila con los datos al Sheet.
// Autenticación mediante un Google Service Account. Dale las credenciales de
// UNA de estas dos formas:
//   - GOOGLE_SERVICE_ACCOUNT_JSON = el contenido JSON completo (ideal para
//     variables de entorno / Secret Files en la nube), o
//   - GOOGLE_SERVICE_ACCOUNT_KEY_FILE = ruta a un archivo .json.
// Además: GOOGLE_SHEETS_ID (id del documento) y GOOGLE_SHEETS_ACTIVIDAD_TAB
// (pestaña "Actividad Diaria", donde se escriben las filas de check-in/out).
//
// Si falta configuración o algo falla, la integración se omite y el check-out
// NO se ve afectado (best-effort).
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { formatMexicoDateTime, timeZoneForEstado } from "./businessDay.js";
 
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
 
// Encabezados de la hoja (se crean solos si la pestaña está vacía).
const HEADERS = [
  "registrado_en",
  "id_promotor",
  "nombre",
  "tienda",
  "hora_entrada",
  "hora_salida",
  "rollos",
  "cubetas",
];
 
// Encabezados de la pestaña de retroalimentación (reportes de error de los
// asesores). Se crean solos si la pestaña está vacía.
const FEEDBACK_HEADERS = [
  "registrado_en", // fecha/hora del envío (ISO)
  "id_promotor", // ID capturado en el form (autollenado, editable)
  "nombre", // nombre capturado en el form
  "sucursal", // sucursal escrita a mano por el asesor
  "descripcion", // descripción amplia del error/problema
  "enviado_por", // ID de la sesión que envió el reporte (auditoría)
  "ubicacion", // coordenadas GPS "lat,lng" capturadas al enviar el reporte
  "id_ticket", // ID del ticket (hilo de seguimiento) que se abrió con este reporte
];
 
let sheetsClientPromise = null;
let headerEnsured = false;
let feedbackHeaderEnsured = false;
 
function isConfigured() {
  return Boolean((config.sheets.json || config.sheets.keyFile) && config.sheets.spreadsheetId);
}
 
// Devuelve el objeto de credenciales del Service Account (desde el JSON en la
// variable de entorno o desde el archivo). Lanza si no puede obtenerlo.
function loadCredentials() {
  if (config.sheets.json) {
    return JSON.parse(config.sheets.json);
  }
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) {
      throw new Error(`No se encontró el archivo de credenciales: ${config.sheets.keyFile}`);
    }
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account (define GOOGLE_SERVICE_ACCOUNT_JSON o _KEY_FILE).");
}
 
// Cliente de Sheets autenticado con el Service Account (lazy + cacheado).
async function getSheetsClient() {
  if (!sheetsClientPromise) {
    const credentials = loadCredentials();
    const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
    sheetsClientPromise = auth.getClient().then((authClient) =>
      google.sheets({ version: "v4", auth: authClient })
    );
  }
  return sheetsClientPromise;
}
 
// Escribe la fila de encabezados si la pestaña está vacía, o la completa si le
// faltan columnas al final (p. ej. una pestaña de producción creada antes de
// agregar una columna nueva — así no queda una columna de datos sin encabezado).
async function ensureHeader(sheets) {
  if (headerEnsured) return;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.actividadTab}!A1:Z1`,
  });
  const current = (res.data.values && res.data.values[0]) || [];
  if (current.length < HEADERS.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${config.sheets.actividadTab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
  headerEnsured = true;
}
 
// Crea la pestaña `tab` si aún no existe en el documento y, si está vacía,
// escribe la fila de encabezados. A diferencia de `ensureHeader` (que asume que
// la pestaña "Visitas" ya existe), esto es necesario para la pestaña de
// retroalimentación, que "apenas se va a crear". Se ejecuta una vez por proceso.
async function ensureFeedbackTab(sheets) {
  if (feedbackHeaderEnsured) return;
  const tab = config.sheets.feedbackTab;
 
  // 1) ¿Existe la pestaña? Leemos los títulos de todas las hojas del documento.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.sheets.spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === tab);
 
  // 2) Si no existe, la creamos con un batchUpdate (addSheet).
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
 
  // 3) Encabezados: se escriben si la fila 1 está vacía O si tiene menos
  //    columnas de las esperadas (auto-reparación al agregar "ubicacion" a una
  //    pestaña que ya existía con 6 columnas).
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${tab}!A1:Z1`,
  });
  const current = (res.data.values && res.data.values[0]) || [];
  if (current.length < FEEDBACK_HEADERS.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [FEEDBACK_HEADERS] },
    });
  }
  feedbackHeaderEnsured = true;
}
 
// Agrega una fila con un reporte de retroalimentación del asesor. A diferencia
// del check-out, aquí SÍ propagamos el error al caller: la ruta necesita saber
// si el reporte se guardó para responderle al asesor (no es best-effort mudo).
export async function appendFeedbackRow({ idPromotor, nombre, sucursal, descripcion, enviadoPor, ubicacion, idTicket }) {
  if (!isConfigured()) {
    throw new Error("La integración con Google Sheets no está configurada (faltan credenciales o GOOGLE_SHEETS_ID).");
  }
  const sheets = await getSheetsClient();
  await ensureFeedbackTab(sheets);
  const row = [
    formatMexicoDateTime(new Date()), // registrado_en (hora de México, no UTC)
    idPromotor, // id_promotor
    nombre, // nombre
    sucursal, // sucursal
    descripcion, // descripcion
    enviadoPor, // enviado_por (ID de la sesión)
    ubicacion || "", // ubicacion (lat,lng)
    idTicket || "", // id_ticket (vacío si no se abrió ticket, p. ej. reportes de comportamiento)
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.feedbackTab}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return { appended: true };
}
 
// Agrega una fila a "Actividad Diaria" — una por EVENTO (no una por visita
// completa): el check-in agrega la suya de inmediato (con hora_salida en "0",
// para distinguirla a simple vista de una visita cerrada) y el check-out
// agrega otra propia después (repitiendo checkInTime, para que esa fila sola
// ya tenga las dos horas). Ninguna de las dos espera a que Postgres termine
// primero — se disparan en paralelo (ver routes/visits.js). Best-effort:
// nunca lanza hacia el caller (registra el error y sigue), para no afectar al
// check-in/check-out del promotor.
export async function appendVisitRow({ promoter, store, sucursalId, checkInTime, checkOutTime, rollos, cubetas }) {
  if (!isConfigured()) {
    console.warn("[sheets] Integración no configurada (faltan credenciales o spreadsheetId); se omite.");
    return { skipped: true };
  }
  try {
    const sheets = await getSheetsClient();
    await ensureHeader(sheets);
    // Hora entrada/salida en la zona horaria REAL del promotor (no siempre
    // Ciudad de México — ver timeZoneForEstado): así coincide con su horario
    // de "Entrada"/"Salida" (también local) y con el "día" que le asigna
    // submitVisitReport en la base de datos. "registrado_en" sí se deja fijo
    // en hora de México: es solo cuándo se escribió la fila, no la hora de la
    // visita, y sirve de referencia única para ordenar/auditar entre estados.
    const promoterTz = timeZoneForEstado(promoter?.estado);
    const row = [
      formatMexicoDateTime(new Date()), // registrado_en (hora de México, no UTC)
      promoter.id, // ID promotor
      promoter.name, // Nombre promotor
      store?.name ?? sucursalId, // Tienda
      formatMexicoDateTime(checkInTime, promoterTz), // Hora entrada (hora local del promotor)
      checkOutTime ? formatMexicoDateTime(checkOutTime, promoterTz) : "0", // Hora salida: "0" = check-in todavía abierto
      rollos ?? 0, // Inventario: rollos
      cubetas ?? 0, // Inventario: cubetas
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${config.sheets.actividadTab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    return { appended: true };
  } catch (err) {
    console.error("[sheets] No se pudo agregar la fila de la visita:", err.message);
    return { error: err.message };
  }
}
 
// Diagnóstico para verificar la conexión sin depender de un check-out real.
// Devuelve si está configurado, el email del Service Account, y si puede leer
// el documento (título de la hoja) o el error concreto.
export async function checkSheetsConnection() {
  if (!isConfigured()) {
    return { configured: false, reason: "Faltan credenciales o GOOGLE_SHEETS_ID." };
  }
  let clientEmail;
  try {
    clientEmail = loadCredentials().client_email;
  } catch (e) {
    return { configured: true, ok: false, error: `Credenciales inválidas: ${e.message}` };
  }
  try {
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheets.spreadsheetId });
    await ensureHeader(sheets);
    return {
      configured: true,
      ok: true,
      serviceAccountEmail: clientEmail,
      spreadsheetTitle: meta.data.properties?.title,
      tab: config.sheets.actividadTab,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      serviceAccountEmail: clientEmail,
      error: err.message,
      hint: "¿Compartiste el documento con el email del Service Account (como Editor) y habilitaste la Google Sheets API?",
    };
  }
}
 