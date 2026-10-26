// ---------------------------------------------------------------------------
// Resumen del gerente desde el Sheet de auditoría (para DESARROLLO LOCAL).
// ---------------------------------------------------------------------------
// En producción, el resumen del gerente lee la base de datos (VisitRecord),
// que ahí SÍ tiene la actividad real. En una copia local esa base está vacía
// (es otra base de datos, no la de producción), así que no hay forma de ver
// actividad real sin esto: reconstruimos las "visitas del día" a partir de la
// pestaña de auditoría que el check-out ya escribe en el Sheet (ver
// appendVisitRow en sheets.js) y las alimentamos al MISMO agregador puro
// (managerSummary.js) que usa la ruta real. Actívalo con VISITS_SOURCE=sheet.
//
// Desde que check-in y check-out escriben CADA UNO su propia fila (ver
// appendVisitRow en sheets.js), una visita puede tener DOS filas aquí: la del
// check-in (hora_salida = "0", visita abierta) y la del check-out (repite
// hora_entrada, con hora_salida real). Se deduplican por (promotor, tienda,
// día): si existe la fila cerrada, esa gana (trae los datos completos); si
// solo existe la abierta, el promotor se ve "en tienda" — a diferencia de
// antes, esta fuente YA puede mostrar visitas abiertas. Las filas viejas (de
// antes de este cambio) solo tenían la fila cerrada; siguen leyéndose igual.
//
// Las columnas se leen por POSICIÓN, no por el texto del encabezado: deben
// coincidir exactamente con el orden que escribe appendVisitRow en sheets.js
// (registrado_en, id_promotor, nombre, tienda, hora_entrada, hora_salida,
// rollos, cubetas). Los encabezados visibles en el Sheet pueden decir otra
// cosa (quedaron de un diseño anterior); no se usan para parsear. Las filas
// viejas que sí tenían una novena columna ("galones", ya no se usa) se leen
// igual de bien: esa posición extra simplemente se ignora.
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { prisma } from "./prisma.js";
import { dayKeyOf, parseSheetDateTime, timeZoneForEstado } from "./businessDay.js";
import { getAllPromotersFromSheet } from "./promotersSheet.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

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
  throw new Error("Sin credenciales de Service Account para leer la actividad del Sheet.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

function slugify(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Lee TODAS las filas de la pestaña de auditoría y las convierte a la misma
// forma que summarizeVisitRows() espera de una fila de VisitRecord+Prisma
// (promoter/store incluidos), filtrando por el rango de días de negocio
// pedido ({from, to}, ambos "YYYY-MM-DD" inclusive).
export async function fetchVisitRowsFromSheet({ from, to }) {
  if (!isConfigured()) {
    console.warn("[activitySheet] Sin credenciales/spreadsheetId; se omite (0 visitas).");
    return [];
  }

  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.actividadTab}!A1:I20000`,
  });
  const rows = res.data.values ?? [];

  // Catálogo local de tiendas (ya sincronizado desde el Sheet por el llamador)
  // para resolver "nombre de tienda" -> { id, estado, lat, lng }.
  const stores = await prisma.store.findMany();
  const storeByName = new Map(stores.map((s) => [s.name.trim().toLowerCase(), s]));
  // Promotores del Sheet (NO de la base local: en desarrollo, un promotor
  // puede tener actividad importada del Sheet sin haber iniciado sesión nunca
  // en este backend, así que su fila local ni existe), para saber a qué
  // SUPERVISOR pertenece cada uno — el Sheet de auditoría no trae esa columna.
  const promotersById = await getAllPromotersFromSheet();

  // Clave (promotor, tienda, día) -> la mejor fila vista hasta ahora (una
  // fila cerrada siempre gana sobre una abierta, sin importar el orden en
  // que aparezcan en el Sheet).
  const byKey = new Map();

  // Fila 0 es el encabezado; los datos empiezan en la fila 1.
  for (let r = 1; r < rows.length; r++) {
    const [registradoEn, promoterId, promoterName, sucursalName, horaEntrada, horaSalida, rollosRaw, cubetasRaw] = rows[r] || [];
    if (!promoterId || !sucursalName) continue; // fila vacía/incompleta

    const pid = String(promoterId).trim();
    // Zona horaria REAL de este promotor (ver timeZoneForEstado) — necesaria
    // tanto para interpretar horaEntrada/horaSalida (filas nuevas: texto
    // plano en hora local del promotor, ver appendVisitRow en sheets.js) como
    // para derivar a qué "día" pertenece la visita.
    const tz = timeZoneForEstado(promotersById.get(pid)?.estado);

    // registrado_en/hora_entrada/hora_salida pueden venir en dos formatos:
    // ISO/UTC (filas viejas, con "T") o texto plano en hora local (filas
    // nuevas, ver formatMexicoDateTime en sheets.js) — parseSheetDateTime
    // entiende ambos y siempre devuelve un instante real sin ambigüedad.
    // "0" (la fila del check-in, visita abierta) también cae en null aquí.
    const checkInDate = parseSheetDateTime(horaEntrada, tz) || parseSheetDateTime(registradoEn, tz);
    const checkOutDate = parseSheetDateTime(horaSalida, tz);
    if (!checkInDate) continue; // fila con fecha ilegible: se descarta, no se rompe
    const rowDay = dayKeyOf(checkInDate, tz);
    if (rowDay < from || rowDay > to) continue; // comparación lexicográfica válida en "YYYY-MM-DD"

    const match = storeByName.get(String(sucursalName).trim().toLowerCase());
    const sucursalId = match?.id ?? slugify(sucursalName);
    const key = `${pid}|${sucursalId}|${rowDay}`;

    const candidate = {
      day: rowDay,
      promoterId: pid,
      promoter: {
        name: promoterName || pid,
        supervisor: promotersById.get(pid)?.supervisor ?? null,
        estado: promotersById.get(pid)?.estado ?? null,
      },
      sucursalId,
      store: match
        ? { name: match.name, estado: match.estado, lat: match.lat, lng: match.lng }
        : { name: sucursalName, estado: null, lat: null, lng: null },
      status: checkOutDate ? "checked-out" : "checked-in",
      rollos: Number(rollosRaw) || 0,
      cubetas: Number(cubetasRaw) || 0,
      checkInTime: checkInDate.toISOString(),
      checkOutTime: checkOutDate ? checkOutDate.toISOString() : null,
    };

    const existing = byKey.get(key);
    // Una fila cerrada siempre gana sobre una abierta; entre dos del mismo
    // tipo, se queda la más reciente (checkInTime mayor).
    if (
      !existing ||
      (existing.status === "checked-in" && candidate.status === "checked-out") ||
      (existing.status === candidate.status && candidate.checkInTime > existing.checkInTime)
    ) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}
