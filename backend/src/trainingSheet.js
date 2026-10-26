// ---------------------------------------------------------------------------
// Contenido de Capacitación/Soporte desde Google Sheets.
// ---------------------------------------------------------------------------
// Dos secciones ("capacitacion" | "soporte") comparten exactamente la misma
// estructura de contenido — "Capacitación" es sobre cómo hacer mejor el
// trabajo, "Soporte" es información técnica de producto — discriminadas por
// la columna "Seccion" en cada una de estas tres pestañas:
//
//   "Capacitacion" (bienvenida + bloques + tooltips):
//     Seccion | Tipo (bienvenida|bloque|tooltip) | Orden | Titulo | Texto
//     - bienvenida: un mensaje corto de bienvenida (Orden se ignora).
//     - bloque: un concepto (Orden = 1,2,3…; Titulo = nombre; Texto = contenido).
//     - tooltip: una micro-guía (Titulo = término; Texto = definición).
//
//   "Capacitacion_Quiz" (preguntas de opción múltiple):
//     Seccion | Orden | Pregunta | Opcion1 | Opcion2 | Opcion3 | Correcta (1|2|3) | FeedbackAcierto | FeedbackError
//
//   "Capacitacion_Flashcards" (repaso espaciado, sistema Leitner):
//     Seccion | Orden | Anverso | Reverso
//
// Las tres pestañas se crean solas (con encabezados) si no existen, para que
// quien vaya a llenar el contenido después las encuentre listas. Sin filas =
// sección vacía (el frontend muestra un estado "todavía no hay contenido
// aquí", nunca se rompe). Cachea en memoria (TTL) para no llamar a la API en
// cada pantalla.
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const TTL_MS = Number(process.env.TRAINING_CACHE_TTL_MS ?? 5 * 60 * 1000);

const CONTENT_HEADERS = ["Seccion", "Tipo", "Orden", "Titulo", "Texto"];
const QUIZ_HEADERS = ["Seccion", "Orden", "Pregunta", "Opcion1", "Opcion2", "Opcion3", "Correcta", "FeedbackAcierto", "FeedbackError"];
const FLASHCARDS_HEADERS = ["Seccion", "Orden", "Anverso", "Reverso"];

let clientPromise = null;
let cache = { at: 0, content: [], quiz: [], flashcards: [] };

function isConfigured() {
  return Boolean((config.sheets.json || config.sheets.keyFile) && config.sheets.spreadsheetId);
}

function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para leer Capacitación/Soporte.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

// Crea la pestaña `tab` si no existe y le escribe `headers` si está vacía.
async function ensureTab(sheets, tab, headers) {
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
      requestBody: { values: [headers] },
    });
  }
}

// Lee una pestaña completa y devuelve { header (índice de fila), cells (fila
// de encabezados detectada), rows (filas de datos crudas) }. Los encabezados
// se detectan por NOMBRE (no por posición), como el resto del Sheet.
async function readTab(sheets, tab, headers) {
  await ensureTab(sheets, tab, headers);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range: `${tab}!A1:Z2000` });
  const rows = res.data.values ?? [];
  if (rows.length === 0) return { cols: {}, rows: [] };
  const cells = rows[0].map((c) => String(c ?? "").trim());
  const cols = {};
  for (const h of headers) {
    cols[h] = cells.findIndex((c) => c.toLowerCase() === h.toLowerCase());
  }
  return { cols, rows: rows.slice(1) };
}

function cell(row, cols, name) {
  const idx = cols[name];
  return idx == null || idx === -1 ? "" : String(row[idx] ?? "").trim();
}

async function loadAll() {
  const sheets = await getClient();
  const [content, quiz, flashcards] = await Promise.all([
    readTab(sheets, config.sheets.capacitacionTab, CONTENT_HEADERS),
    readTab(sheets, config.sheets.capacitacionQuizTab, QUIZ_HEADERS),
    readTab(sheets, config.sheets.capacitacionFlashcardsTab, FLASHCARDS_HEADERS),
  ]);

  const contentRows = content.rows
    .map((r) => ({
      seccion: cell(r, content.cols, "Seccion").toLowerCase(),
      tipo: cell(r, content.cols, "Tipo").toLowerCase(),
      orden: Number(cell(r, content.cols, "Orden")) || 0,
      titulo: cell(r, content.cols, "Titulo"),
      texto: cell(r, content.cols, "Texto"),
    }))
    .filter((r) => r.seccion && r.tipo && r.texto);

  const quizRows = quiz.rows
    .map((r) => ({
      seccion: cell(r, quiz.cols, "Seccion").toLowerCase(),
      orden: Number(cell(r, quiz.cols, "Orden")) || 0,
      pregunta: cell(r, quiz.cols, "Pregunta"),
      opciones: [cell(r, quiz.cols, "Opcion1"), cell(r, quiz.cols, "Opcion2"), cell(r, quiz.cols, "Opcion3")],
      correcta: Number(cell(r, quiz.cols, "Correcta")) || 0, // 1|2|3
      feedbackAcierto: cell(r, quiz.cols, "FeedbackAcierto"),
      feedbackError: cell(r, quiz.cols, "FeedbackError"),
    }))
    .filter((r) => r.seccion && r.pregunta && r.correcta >= 1 && r.correcta <= 3);

  const flashcardRows = flashcards.rows
    .map((r) => ({
      seccion: cell(r, flashcards.cols, "Seccion").toLowerCase(),
      orden: Number(cell(r, flashcards.cols, "Orden")) || 0,
      anverso: cell(r, flashcards.cols, "Anverso"),
      reverso: cell(r, flashcards.cols, "Reverso"),
    }))
    .filter((r) => r.seccion && r.anverso && r.reverso);

  return { content: contentRows, quiz: quizRows, flashcards: flashcardRows };
}

async function ensureCache() {
  if (Date.now() - cache.at < TTL_MS) return cache;
  if (!isConfigured()) return cache;
  try {
    const fresh = await loadAll();
    cache = { at: Date.now(), ...fresh };
  } catch (e) {
    console.warn("[trainingSheet] No se pudo leer el contenido de Capacitación/Soporte:", e.message);
  }
  return cache;
}

// { bienvenida: string, bloques: [{orden,titulo,texto}], tooltips: [{titulo,texto}] }
export async function getTrainingContent(seccion) {
  const { content } = await ensureCache();
  const rows = content.filter((r) => r.seccion === seccion);
  const bienvenida = rows.find((r) => r.tipo === "bienvenida")?.texto ?? "";
  const bloques = rows.filter((r) => r.tipo === "bloque").sort((a, b) => a.orden - b.orden).map(({ orden, titulo, texto }) => ({ orden, titulo, texto }));
  const tooltips = rows.filter((r) => r.tipo === "tooltip").map(({ titulo, texto }) => ({ titulo, texto }));
  return { bienvenida, bloques, tooltips };
}

export async function getTrainingQuiz(seccion) {
  const { quiz } = await ensureCache();
  return quiz.filter((r) => r.seccion === seccion).sort((a, b) => a.orden - b.orden);
}

export async function getTrainingFlashcards(seccion) {
  const { flashcards } = await ensureCache();
  return flashcards.filter((r) => r.seccion === seccion).sort((a, b) => a.orden - b.orden);
}
