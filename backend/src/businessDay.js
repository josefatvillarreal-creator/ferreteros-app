// ---------------------------------------------------------------------------
// "Día" del negocio en hora local (NO UTC).
// ---------------------------------------------------------------------------
// Con UTC, cualquier check-in/check-out después de ~18:00 hora local ya cae en
// la fecha UTC del día siguiente, corriendo esa actividad al resumen
// equivocado. Todo el sistema (check-in, check-out, resumen del gerente, e
// importación desde el Sheet) usa esta misma función para que el "día" sea
// consistente en todos lados.
//
// México tiene VARIAS zonas horarias (no solo la de Ciudad de México), y
// Sonora en particular nunca cambia de horario de verano — así que un
// check-in tarde en la noche de un promotor en, por ejemplo, Sonora o Baja
// California puede caer en la fecha "de mañana" según Ciudad de México
// aunque para el promotor todavía sea "hoy". Por default todo usa la zona de
// Ciudad de México (BUSINESS_TIMEZONE, la referencia del negocio/oficina),
// pero cada función acepta un `timeZone` explícito — usar
// `timeZoneForEstado(promoter.estado)` para operaciones atadas a UN promotor
// en particular (día del check-in, puntualidad, etc.).
const BUSINESS_TIMEZONE = "America/Mexico_City";

// Estados de México cuya zona horaria real NO coincide con Ciudad de México
// (Zona Centro, UTC-6). El resto del país (incluyendo Nuevo León, Tamaulipas,
// Coahuila: aunque tienen franjas fronterizas con horario de verano, nuestros
// promotores ahí operan en ciudades del interior, no en el municipio
// fronterizo) cae en el default de BUSINESS_TIMEZONE.
//   - Sonora: Zona Pacífico, UTC-7 TODO el año (nunca cambia de horario).
//   - Baja California: Zona Noroeste, UTC-8/UTC-7 con horario de verano
//     (alineada a California, EUA).
//   - Baja California Sur, Chihuahua (interior), Sinaloa, Nayarit: Zona
//     Pacífico, UTC-7, sin horario de verano.
//   - Quintana Roo: Zona Sureste, UTC-5, sin horario de verano.
const MEXICO_STATE_TIMEZONES = {
  "Sonora": "America/Hermosillo",
  "Baja California": "America/Tijuana",
  "Baja California Sur": "America/Mazatlan",
  "Chihuahua": "America/Chihuahua",
  "Sinaloa": "America/Mazatlan",
  "Nayarit": "America/Mazatlan",
  "Quintana Roo": "America/Cancun",
};

// Zona horaria real para el ESTADO de un promotor/tienda (columna "Estado").
// Sin estado, o estado no listado arriba (la mayoría del país): la zona de
// negocio por default (Ciudad de México).
export function timeZoneForEstado(estado) {
  return MEXICO_STATE_TIMEZONES[String(estado ?? "").trim()] || BUSINESS_TIMEZONE;
}

// Cachés de formatters por zona horaria (Intl.DateTimeFormat es caro de
// construir; con ~6 zonas en juego, vale la pena no recrearlo en cada llamada).
const dayFormatterCache = new Map();
function dayFormatterFor(timeZone) {
  let f = dayFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatterCache.set(timeZone, f);
  }
  return f;
}

export function dayKeyOf(date, timeZone = BUSINESS_TIMEZONE) {
  return dayFormatterFor(timeZone).format(date);
}

export function todayKey(timeZone = BUSINESS_TIMEZONE) {
  return dayKeyOf(new Date(), timeZone);
}

// Fecha+hora completas en hora LOCAL (de `timeZone`), como texto plano
// "YYYY-MM-DD HH:mm:ss" (sin "Z" ni offset) — para escribir en el Sheet. A
// propósito NO es ISO: si lleváramos el offset, Sheets/Excel a veces lo
// re-interpreta o lo ignora al graficar/ordenar; como texto plano en hora
// local, lo que ves es lo que es.
const dateTimeFormatterCache = new Map();
function dateTimeFormatterFor(timeZone) {
  let f = dateTimeFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    dateTimeFormatterCache.set(timeZone, f);
  }
  return f;
}

export function formatMexicoDateTime(date, timeZone = BUSINESS_TIMEZONE) {
  if (!date) return "";
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (Number.isNaN(d?.getTime?.())) return "";
  const parts = Object.fromEntries(dateTimeFormatterFor(timeZone).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// Inverso de formatMexicoDateTime: toma "YYYY-MM-DD HH:mm:ss" (hora local de
// `timeZone`, sin offset) y devuelve el instante real (Date, en UTC
// internamente como cualquier Date de JS). No asume el offset a mano: calcula
// el offset real de esa zona en ese instante vía Intl, por si algún día
// cambia (o si la zona sí observa horario de verano).
export function parseMexicoDateTime(str, timeZone = BUSINESS_TIMEZONE) {
  if (!str) return null;
  const [datePart, timePart] = String(str).trim().split(" ");
  const [y, m, d] = (datePart || "").split("-").map(Number);
  const [h, min, s] = (timePart || "00:00:00").split(":").map(Number);
  if (!y || !m || !d) return null;
  const guessUtc = new Date(Date.UTC(y, m - 1, d, h || 0, min || 0, s || 0));
  const parts = Object.fromEntries(dateTimeFormatterFor(timeZone).formatToParts(guessUtc).map((p) => [p.type, p.value]));
  const guessAsLocalWallClock = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  const offsetMs = guessUtc.getTime() - guessAsLocalWallClock;
  return new Date(guessUtc.getTime() + offsetMs);
}

// Interpreta una fecha/hora tal como viene guardada en el Sheet, sin importar
// si es una fila vieja (ISO/UTC, con "T" y "Z") o una nueva (hora local en
// texto plano, escrita por formatMexicoDateTime) — para no romper filas
// escritas antes de este cambio. `timeZone` debe ser la MISMA zona con la que
// se escribió la fila (ver timeZoneForEstado) para reconstruir el instante
// real correctamente. Devuelve un Date real o null.
export function parseSheetDateTime(str, timeZone = BUSINESS_TIMEZONE) {
  if (!str) return null;
  if (String(str).includes("T")) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return parseMexicoDateTime(str, timeZone);
}

// Día de la semana (0=lunes ... 6=domingo) de una clave "YYYY-MM-DD". Se
// calcula con Date.UTC solo como truco aritmético sobre el triple año/mes/día
// (ya en hora de México); no representa un instante real, así que no hay
// conversión de zona horaria que pueda salir mal aquí.
function isoWeekdayOf(day) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo..6=sábado
  return (dow + 6) % 7; // 0=lunes..6=domingo
}

function startOfWeek(day) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - isoWeekdayOf(day));
  return date.toISOString().slice(0, 10);
}

function startOfMonth(day) {
  const [y, m] = day.split("-");
  return `${y}-${m}-01`;
}

function startOfYear(day) {
  const [y] = day.split("-");
  return `${y}-01-01`;
}

// Suma (o resta, con n negativo) días a una clave "YYYY-MM-DD". Mismo truco
// de Date.UTC que isoWeekdayOf/startOfWeek: es aritmética sobre el triple
// año/mes/día, no un instante real, así que no hay zona horaria que cuidar.
function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

function startOfPrevMonth(day) {
  const [y, m] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// "YYYY-MM-DD" válido (fecha real, no solo el formato) — usado para validar
// las fechas del rango "custom" antes de confiar en ellas. Aritmética pura de
// calendario (sin convertir a hora de México): solo confirma que el triple
// año/mes/día exista de verdad (rechaza cosas como "2026-02-30").
function isValidDayKey(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""))) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Resuelve las palabras clave del dropdown de rango del tablero del gerente a
// un rango de días [from, to] (ambos inclusive, en hora de México). Rango
// desconocido -> "today" (mismo comportamiento que antes de tener rangos).
// `rangeKey === "custom"` usa `custom.from`/`custom.to` tal cual (ambas deben
// ser "YYYY-MM-DD" válidas y from<=to) — si faltan o son inválidas, cae a
// "today" igual que cualquier otro rango desconocido.
export function resolveRange(rangeKey, custom = {}) {
  const today = todayKey();
  if (rangeKey === "custom") {
    const { from, to } = custom;
    if (isValidDayKey(from) && isValidDayKey(to) && from <= to) return { from, to };
    return { from: today, to: today };
  }
  switch (rangeKey) {
    case "week":
      return { from: startOfWeek(today), to: today };
    case "month":
      return { from: startOfMonth(today), to: today };
    case "year":
      return { from: startOfYear(today), to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "last_week": {
      const thisWeekStart = startOfWeek(today);
      return { from: addDays(thisWeekStart, -7), to: addDays(thisWeekStart, -1) };
    }
    case "last_month": {
      const from = startOfPrevMonth(today);
      return { from, to: addDays(startOfMonth(today), -1) };
    }
    case "last_year": {
      const prevYear = String(Number(today.slice(0, 4)) - 1);
      return { from: `${prevYear}-01-01`, to: `${prevYear}-12-31` };
    }
    case "today":
    default:
      return { from: today, to: today };
  }
}
