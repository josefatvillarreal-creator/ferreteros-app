// ---------------------------------------------------------------------------
// Capa de datos — consultas reales con Prisma (SQLite por defecto).
// ---------------------------------------------------------------------------
// Sustituye a la versión estática en memoria. Mantiene la MISMA interfaz que
// consumen las rutas, así que routes/auth no cambian. La foto de la visita se
// persiste (Base64) en la columna VisitRecord.photo.
import { prisma, withWriteRetry } from "./prisma.js";
import { config } from "./config.js";
import { findPromoterInSheet, getAllPromotersFromSheet } from "./promotersSheet.js";
import { ensureCatalogSynced } from "./catalogSync.js";
import { summarizeVisitRows } from "./managerSummary.js";
import { todayKey, resolveRange, formatMexicoDateTime, dayKeyOf, timeZoneForEstado } from "./businessDay.js";
import { getPromoterGoal, getSucursalGoal, setPromoterGoal as setPromoterGoalInSheet, DEFAULT_WEEKLY_GOAL_UNITS } from "./goalsSheet.js";
import { unitsOf, normalizeItems } from "./units.js";
import { appendNotification, hasGoalNotification } from "./notificationsSheet.js";
import { appendCompetitionRow } from "./competitionSheet.js";
import { getTrainingContent, getTrainingQuiz, getTrainingFlashcards } from "./trainingSheet.js";

// --- Promotores ------------------------------------------------------------

// Devuelve el promotor con su hash de contraseña (para verificar el login).
// Con AUTH_SOURCE=sheet lee del Google Sheet (hash bcrypt en la columna
// CONTRASEÑA); de lo contrario, de la base local (Prisma). En ambos casos
// devuelve la misma forma { id, name, location, supervisor, password }.
export async function findPromoterById(promoterId) {
  if (config.authSource === "sheet") {
    return findPromoterInSheet(promoterId);
  }
  return prisma.promoter.findUnique({ where: { id: promoterId } });
}

// --- Catálogo: sucursales (de un cliente) y productos --------------------------

// Aplana una sucursal con el nombre de su cliente.
function flattenSucursal({ cliente, ...s }) {
  return { ...s, clienteNombre: cliente?.nombre ?? s.clienteId };
}

// Todas las sucursales del catálogo. El filtrado por cercanía se hace en la ruta.
// Con CATALOG_SOURCE=sheet, primero sincroniza desde las pestañas del Sheet.
export async function getAllSucursales() {
  if (config.catalogSource === "sheet") await ensureCatalogSynced();
  const rows = await prisma.sucursal.findMany({ orderBy: { id: "asc" }, include: { cliente: true } });
  return rows.map(flattenSucursal);
}

export async function getSucursal(sucursalId) {
  if (config.catalogSource === "sheet") await ensureCatalogSynced();
  const row = await prisma.sucursal.findUnique({ where: { id: sucursalId }, include: { cliente: true } });
  return row ? flattenSucursal(row) : null;
}

// Productos que el promotor puede capturar en un check-out (solo activos).
export async function getProductosActivos() {
  if (config.catalogSource === "sheet") await ensureCatalogSynced();
  return prisma.producto.findMany({
    where: { activo: true },
    orderBy: [{ orden: "asc" }, { id: "asc" }],
    select: { id: true, nombre: true, unidad: true, orden: true },
  });
}

// TODOS los productos (activos o no) con su equivalencia y precio: las ventas
// históricas de un producto desactivado siguen sumando en metas y tableros.
// Map<productoId, { nombre, equivalencia, precio }> para unitsOf/moneyOf/describeItems (units.js).
export async function getCatalogoProductos() {
  const rows = await prisma.producto.findMany({ select: { id: true, nombre: true, equivalencia: true, precio: true } });
  return new Map(rows.map((p) => [p.id, { nombre: p.nombre, equivalencia: p.equivalencia, precio: p.precio }]));
}

// --- Visitas ---------------------------------------------------------------

// Zona horaria REAL del promotor (según su "Estado" en el Sheet/Postgres), no
// la de Ciudad de México a secas — ver comentario en timeZoneForEstado. Se usa
// para que el "día" de negocio de un check-in/check-out de, por ejemplo,
// Sonora o Baja California, se calcule con SU medianoche, no la de la CDMX.
// Barata: el Sheet ya está cacheado (promotersSheet.js) y en Postgres es un
// solo SELECT por id.
async function getPromoterTimeZone(promoterId) {
  let estado = null;
  if (config.authSource === "sheet") {
    const p = await findPromoterInSheet(promoterId);
    estado = p?.estado ?? null;
  } else {
    const p = await prisma.promoter.findUnique({ where: { id: promoterId }, select: { estado: true } });
    estado = p?.estado ?? null;
  }
  return timeZoneForEstado(estado);
}

// Las cantidades por producto de una visita viajan siempre como
// items: [{ productoId, cantidad }].
const ITEMS_INCLUDE = { items: { select: { productoId: true, cantidad: true } } };

export async function fetchTodayVisits(promoterId) {
  const tz = await getPromoterTimeZone(promoterId);
  const rows = await prisma.visitRecord.findMany({
    where: { promoterId, day: todayKey(tz) },
    include: ITEMS_INCLUDE,
  });
  const out = {};
  for (const r of rows) out[r.sucursalId] = r;
  return out;
}

export async function getVisit(promoterId, sucursalId) {
  const tz = await getPromoterTimeZone(promoterId);
  return prisma.visitRecord.findUnique({
    where: { promoterId_sucursalId_day: { promoterId, sucursalId, day: todayKey(tz) } },
    include: ITEMS_INCLUDE,
  });
}

// Items válidos de un check-out: solo productos ACTIVOS, cantidades enteras >= 0.
export async function resolveCheckoutItems(rawItems) {
  const activos = await getProductosActivos();
  return normalizeItems(rawItems, new Set(activos.map((p) => p.id)));
}

// Con AUTH_SOURCE=sheet los promotores viven en el Google Sheet, no en
// Postgres, pero VisitRecord/CompetitionReport/TrainingProgress tienen una
// llave foránea a Promoter. Asegura que exista su fila local (con el hash del
// Sheet) para no violar esa restricción al guardar — se necesita antes de
// CUALQUIER escritura con esa llave foránea, no solo check-in/check-out (ver
// routes/training.js: un promotor puede entrar a Capacitación antes de su
// primer check-in). Idempotente: si ya existe, no toca nada más que refrescar.
export async function ensurePromoterExistsLocally(promoterId) {
  if (config.authSource !== "sheet") return;
  const p = await findPromoterInSheet(promoterId);
  if (!p) return;
  // `update` refleja los mismos campos que `create`: así, si el promotor ya
  // tenía fila local (de un login anterior), cambios posteriores en el Sheet
  // (ubicación, supervisor, estado) sí se propagan en el siguiente check-in.
  const fields = {
    name: p.name || p.id,
    location: p.location ?? null,
    supervisor: p.supervisor ?? null,
    estado: p.estado ?? null,
  };
  await prisma.promoter.upsert({
    where: { id: p.id },
    update: fields,
    create: { id: p.id, password: p.password ?? "", ...fields },
  });
}

// Crea o actualiza (upsert) el registro de visita del día. Convierte los campos
// de fecha a Date para Prisma. Si se pasan `items` (check-out), REEMPLAZAN los
// anteriores de la visita en la misma transacción. Devuelve el registro con sus items.
export async function submitVisitReport(promoterId, sucursalId, patch, items) {
  const tz = await getPromoterTimeZone(promoterId);
  const day = todayKey(tz);
  const data = { ...patch };
  if (typeof data.checkInTime === "string") data.checkInTime = new Date(data.checkInTime);
  if (typeof data.checkOutTime === "string") data.checkOutTime = new Date(data.checkOutTime);

  await ensurePromoterExistsLocally(promoterId);

  // withWriteRetry: reintenta ante bloqueos de SQLite bajo carga concurrente.
  return withWriteRetry(() =>
    prisma.$transaction(async (tx) => {
      const rec = await tx.visitRecord.upsert({
        where: { promoterId_sucursalId_day: { promoterId, sucursalId, day } },
        create: { promoterId, sucursalId, day, status: "checked-in", ...data },
        update: { ...data },
      });
      if (items) {
        await tx.visitItem.deleteMany({ where: { visitId: rec.id } });
        if (items.length) {
          await tx.visitItem.createMany({
            data: items.map((i) => ({ visitId: rec.id, productoId: i.productoId, cantidad: i.cantidad })),
          });
        }
      }
      return tx.visitRecord.findUnique({ where: { id: rec.id }, include: ITEMS_INCLUDE });
    })
  );
}

// --- Reportes de competencia -------------------------------------------------
// Guarda el reporte COMPLETO (con fotos) en la base de datos y, best-effort,
// una fila-resumen en el Sheet "Competencia" para que el admin lo revise sin
// abrir la app.
export async function createCompetitionReport(promoterId, { marca, descripcion, photos }) {
  await ensurePromoterExistsLocally(promoterId);

  const report = await withWriteRetry(() =>
    prisma.competitionReport.create({
      data: { promoterId, marca, descripcion, photos: photos?.length ? JSON.stringify(photos) : null },
    })
  );

  // appendCompetitionRow nunca lanza (best-effort): el reporte ya quedó a
  // salvo en la base de datos aunque el Sheet falle.
  const promoter = await findPromoterById(promoterId);
  await appendCompetitionRow({
    promoterId,
    promoterName: promoter?.name || promoterId,
    marca,
    descripcion,
    photoCount: photos?.length || 0,
  });

  return report;
}

// Reportes de Competencia para el panel del gerente/admin (o de un supervisor,
// acotado a SU equipo). Más recientes primero. Las fotos (hasta 5 por
// reporte, Base64) NO se traen aquí a propósito: es solo el LISTADO (fila
// compacta por reporte), y con hasta `limit` reportes de golpe, traer las
// fotos de los 200 para mostrar un renglón de texto era el mayor consumo de
// memoria del backend — se cargaban decenas de MB para un panel que el admin
// ni siquiera había abierto. El detalle (con fotos) se pide aparte, uno por
// uno, con getCompetitionReportPhotos — ver rutas /competencia/:id/photos.
export async function getCompetitionReports({ supervisorId, limit = 200 } = {}) {
  const reports = await prisma.competitionReport.findMany({
    include: { promoter: true },
    orderBy: { createdAt: "desc" },
    take: limit,
    omit: { photos: true },
  });
  const filtered = supervisorId
    ? reports.filter((r) => (r.promoter?.supervisor || "").trim().toLowerCase() === supervisorId)
    : reports;
  return filtered.map((r) => ({
    id: r.id,
    promoterId: r.promoterId,
    promoterName: r.promoter?.name || r.promoterId,
    supervisor: r.promoter?.supervisor || null,
    marca: r.marca,
    descripcion: r.descripcion,
    createdAt: r.createdAt,
  }));
}

// Fotos de UN reporte de Competencia (para el detalle, pedido bajo demanda al
// hacer clic en una fila del listado de arriba). `supervisorId` (opcional)
// revalida que el reporte sea de SU equipo — mismo criterio de acceso que
// getCompetitionReports, para no dejar ver el detalle de un reporte ajeno
// aunque se conozca el id. Devuelve null si no existe o no le pertenece.
export async function getCompetitionReportPhotos(reportId, { supervisorId } = {}) {
  const report = await prisma.competitionReport.findUnique({
    where: { id: reportId },
    include: { promoter: true },
  });
  if (!report) return null;
  if (supervisorId && (report.promoter?.supervisor || "").trim().toLowerCase() !== supervisorId) return null;
  return report.photos ? JSON.parse(report.photos) : [];
}

// --- Resumen para el GERENTE -------------------------------------------------
// Agrega TODAS las visitas de un RANGO de días ("today" | "week" | "month" |
// "year", por defecto "today") y las agrupa por promotor. Calcula el "dinero
// vendido" multiplicando cantidades por los precios de config (PRECIO_ROLLO /
// PRECIO_CUBETA). Devuelve totales globales, el desglose por estado (para las
// gráficas) y un arreglo de promotores activos.
//
// "PROMOTOR ACTIVO" = tiene al menos un registro de visita en el rango (el
// check-in crea el registro), sin importar si ya cerró o sigue en tienda.
//
// `supervisorId` (opcional) restringe el resultado a los promotores de ESE
// supervisor (comparando, sin distinguir mayúsculas, contra la columna
// SUPERVISOR de la pestaña Promotores) — así el tablero de supervisor
// reutiliza exactamente la misma agregación que el del gerente.
export async function getManagerSummary(rangeKey = "today", { supervisorId, from, to } = {}) {
  // Asegura que las sucursales (con su ESTADO) estén sincronizadas desde el Sheet.
  if (config.catalogSource === "sheet") await ensureCatalogSynced();

  const range = resolveRange(rangeKey, { from, to });

  let rows = await prisma.visitRecord.findMany({
    where: { day: { gte: range.from, lte: range.to } },
    include: { promoter: true, sucursal: { include: { cliente: true } }, ...ITEMS_INCLUDE },
    // summarizeVisitRows nunca lee `photo` (foto de check-in, Base64):
    // omitirla aquí es la diferencia entre traer unos KB por fila y traer
    // cientos de KB por fila — en un rango de mes/año, con decenas de
    // promotores, eso es la causa más probable de quedarse sin memoria.
    omit: { photo: true },
  });

  // Con AUTH_SOURCE=sheet, `promoter` viene del mirror local en Postgres, que
  // solo se refresca en el SIGUIENTE check-in/check-out de cada promotor (ver
  // ensurePromoterExistsLocally) — una visita ya abierta antes de que el admin
  // llenara/corrigiera el estado en el Sheet se quedaría con estado/supervisor
  // desactualizados hasta que esa visita se cierre. Para que el filtro de
  // estado siempre refleje lo que el Sheet dice AHORA (fuente de verdad,
  // editable por el admin), sobreescribimos con una lectura fresca del Sheet
  // (cacheada unos minutos, no golpea la API en cada carga del tablero).
  if (config.authSource === "sheet") {
    const sheetPromoters = await getAllPromotersFromSheet();
    rows = rows.map((r) => {
      const sp = sheetPromoters.get(r.promoterId);
      if (!sp) return r;
      return { ...r, promoter: { ...r.promoter, name: sp.name || r.promoter?.name, supervisor: sp.supervisor ?? r.promoter?.supervisor ?? null, estado: sp.estado ?? null } };
    });
  }

  if (supervisorId) {
    rows = rows.filter((r) => (r.promoter?.supervisor || "").trim().toLowerCase() === supervisorId);
  }

  // La agregación pura vive en managerSummary.js (testeable sin base de datos).
  const summary = summarizeVisitRows(rows, config.prices, range);
  await attachGoalProgress(summary);
  // Plantilla completa (todos los promotores registrados, o solo los de ESE
  // supervisor) — a diferencia de `summary.promoters`, que solo incluye a
  // quien tuvo actividad en el rango. Con esto el tablero puede mostrar
  // "cuántos faltan de estar en tienda" (y quiénes son) contra el total real,
  // no solo contra los que ya hicieron algo hoy.
  const roster = await getRoster(supervisorId);
  summary.roster = roster.map((p) => ({ id: p.id, name: p.name, estado: p.estado ?? null }));
  summary.totals.rosterTotal = roster.length;
  return summary;
}

// Mismo resumen, pero acotado a los promotores de un supervisor.
export async function getSupervisorSummary(supervisorId, rangeKey = "today", { from, to } = {}) {
  return getManagerSummary(rangeKey, { supervisorId, from, to });
}

// TODOS los promotores registrados (o solo los de un supervisor dado),
// { id, name, estado }, sin importar si tuvieron actividad hoy — para poder
// mostrar la lista de "quién falta de estar en tienda" (roster completo menos
// quien tiene check-in abierto ahora, ver summary.roster). Con AUTH_SOURCE=sheet
// (el modo real) lee el Sheet directo; si no, los promotores locales conocidos.
async function getRoster(supervisorId) {
  if (config.authSource === "sheet") {
    const all = await getAllPromotersFromSheet();
    const list = [...all.values()];
    return supervisorId
      ? list.filter((p) => (p.supervisor || "").trim().toLowerCase() === supervisorId)
      : list;
  }
  const all = await prisma.promoter.findMany({ select: { id: true, name: true, supervisor: true, estado: true } });
  return supervisorId
    ? all.filter((p) => (p.supervisor || "").trim().toLowerCase() === supervisorId)
    : all;
}

// --- Metas: progreso SEMANAL por promotor ------------------------------------
// Le agrega `goal: { target, achieved, reached }` a cada promotor del resumen,
// en "unidades-equivalentes" (cantidad × equivalencia de cada producto, ver
// units.js). Todo promotor tiene meta: la personalizada del Sheet si existe, si
// no el default (DEFAULT_WEEKLY_GOAL_UNITS). El acumulado de la SEMANA sale de la
// base de datos real e incluye productos desactivados (su historial cuenta).
async function attachGoalProgress(summary) {
  const week = resolveRange("week");
  const [weekRows, catalog] = await Promise.all([
    prisma.visitRecord.findMany({
      where: { day: { gte: week.from, lte: week.to } },
      select: { promoterId: true, ...ITEMS_INCLUDE },
    }),
    getCatalogoProductos(),
  ]);

  const achievedByPromoter = new Map();
  for (const r of weekRows) {
    achievedByPromoter.set(r.promoterId, (achievedByPromoter.get(r.promoterId) || 0) + unitsOf(r.items, catalog));
  }

  for (const p of summary.promoters) {
    const target = (await getPromoterGoal(p.id)) ?? DEFAULT_WEEKLY_GOAL_UNITS;
    const achieved = achievedByPromoter.get(p.id) ?? 0;
    p.goal = { target, achieved, reached: achieved >= target };
  }
}

// --- Notificaciones disparadas por check-in / check-out ---------------------

// Tolerancia (minutos) sobre la hora de "Entrada" del promotor (pestaña
// Promotores) para seguir considerándolo puntual.
const LATE_TOLERANCE_MINUTES = 15;

// "H:MM"/"HH:MM" -> minutos desde medianoche, o null si no es un horario
// válido (promotor sin horario asignado en el Sheet).
function minutesOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Texto de puntualidad para la notificación de check-in, comparando la hora
// real EN LA ZONA HORARIA DEL PROMOTOR (no la de Ciudad de México a secas:
// "Entrada" es un horario local, así que hay que compararlo contra la hora
// local real del promotor — de lo contrario, un promotor en Sonora o Baja
// California siempre saldría "tarde" o "temprano" por el desfase de zona)
// contra la "Entrada" esperada del promotor, con LATE_TOLERANCE_MINUTES de
// tolerancia. Cadena vacía si el promotor no tiene horario configurado (no se
// le exige nada).
function puntualidadTexto(promoter, checkInTime) {
  const entradaMin = minutesOfDay(promoter?.entrada);
  if (entradaMin == null) return "";
  const horaLocal = formatMexicoDateTime(checkInTime, timeZoneForEstado(promoter?.estado)).slice(11, 16); // "HH:mm"
  const checkInMin = minutesOfDay(horaLocal);
  if (checkInMin == null) return "";
  const diff = checkInMin - entradaMin;
  if (diff <= LATE_TOLERANCE_MINUTES) return " Llegó a tiempo.";
  return ` Llegó ${diff} min tarde (entrada esperada ${promoter.entrada}, tolerancia ${LATE_TOLERANCE_MINUTES} min).`;
}

// Se llama al hacer CHECK-IN: avisa al supervisor del promotor (si tiene uno)
// con la sucursal, el nombre del asesor, y si llegó a tiempo o tarde (según su
// horario de "Entrada" en el Sheet, con 15 min de tolerancia). Best-effort:
// nunca lanza.
export async function notifyCheckIn(promoterId, sucursalId, checkInTime = new Date()) {
  try {
    const [promoter, sucursal] = await Promise.all([findPromoterById(promoterId), getSucursal(sucursalId)]);
    const supervisorId = (promoter?.supervisor || "").trim().toLowerCase();
    if (!supervisorId) return; // sin supervisor asignado, no hay a quién avisar
    await appendNotification({
      tipo: "checkin",
      para: supervisorId,
      idPromotor: promoterId,
      promotor: promoter?.name || promoterId,
      idSucursal: sucursalId,
      sucursal: sucursal ? `${sucursal.clienteNombre} – ${sucursal.name}` : sucursalId,
      detalle: `${promoter?.name || promoterId} hizo check-in en ${sucursal ? `${sucursal.clienteNombre} – ${sucursal.name}` : sucursalId}.${puntualidadTexto(promoter, checkInTime)}`,
    });
  } catch (e) {
    console.error("[db] notifyCheckIn falló:", e.message);
  }
}

// Foto del check-in correspondiente a una notificación "checkin". La
// notificación (Google Sheets) no guarda el id de la visita, así que se
// reconstruye la búsqueda con la MISMA llave única de VisitRecord
// (promoterId+sucursalId+day, ver @@unique en schema.prisma) — el día se deriva
// de `fecha` con la MISMA zona horaria del promotor que usó submitVisitReport
// al guardar (ver getPromoterTimeZone), para que la llave coincida incluso en
// estados con otra zona horaria (Sonora, Baja California, etc.). Best-effort:
// null si no hay match o algo falla, nunca lanza (no debe romper la campana
// de notificaciones).
export async function getCheckinPhoto(promoterId, sucursalId, fecha) {
  if (!promoterId || !sucursalId || !fecha) return null;
  try {
    const tz = await getPromoterTimeZone(promoterId);
    const day = dayKeyOf(new Date(fecha), tz);
    const rec = await prisma.visitRecord.findUnique({
      where: { promoterId_sucursalId_day: { promoterId, sucursalId, day } },
      select: { photo: true },
    });
    return rec?.photo ?? null;
  } catch (e) {
    console.error("[db] getCheckinPhoto falló:", e.message);
    return null;
  }
}

// Unidades-equivalentes que un promotor o una sucursal llevan vendidas ESTA
// SEMANA (cantidad × equivalencia por producto, incluyendo productos ya
// desactivados). `where` filtra las visitas: { promoterId } o { sucursalId }.
async function weekToDateUnits(where, week = resolveRange("week")) {
  const grouped = await prisma.visitItem.groupBy({
    by: ["productoId"],
    where: { visit: { ...where, day: { gte: week.from, lte: week.to } } },
    _sum: { cantidad: true },
  });
  const items = grouped.map((g) => ({ productoId: g.productoId, cantidad: g._sum.cantidad || 0 }));
  return unitsOf(items, await getCatalogoProductos());
}

// Meta y avance de la SEMANA del promotor logueado (personalizada o el
// default) — lo consume su propia app ("Mi meta de ventas" en el dashboard
// de campo).
export async function getMyGoalProgress(promoterId) {
  const target = (await getPromoterGoal(promoterId)) ?? DEFAULT_WEEKLY_GOAL_UNITS;
  const achieved = await weekToDateUnits({ promoterId });
  return { target, achieved, reached: achieved >= target };
}

// Fija (crea o reemplaza) la meta SEMANAL personalizada de un promotor, en
// unidades-equivalentes de rollo. Lo usa el botón "Meta" del tablero del
// gerente/admin, como EXCEPCIÓN al default (DEFAULT_WEEKLY_GOAL_UNITS).
// `nombre` es solo para que la fila del Sheet sea legible a simple vista.
export async function setPromoterGoal(promoterId, meta, nombre) {
  await setPromoterGoalInSheet(promoterId, meta, nombre);
}

// Se llama al hacer CHECK-OUT: si el promotor o la sucursal ya llegaron a su
// meta SEMANAL (unidades-equivalentes, ver units.js), notifica UNA sola vez
// por semana (idempotente vía hasGoalNotification, no por detección exacta
// del cruce). El promotor SIEMPRE tiene meta (personalizada o el default); la
// sucursal solo si tiene una personalizada en el Sheet.
export async function checkAndNotifyGoals(promoterId, sucursalId) {
  try {
    const week = resolveRange("week");
    const periodo = week.from; // "YYYY-MM-DD" del lunes de esa semana

    const promoterGoal = (await getPromoterGoal(promoterId)) ?? DEFAULT_WEEKLY_GOAL_UNITS;
    const achieved = await weekToDateUnits({ promoterId }, week);
    if (achieved >= promoterGoal && !(await hasGoalNotification({ tipo: "promoter_goal", id: promoterId, periodo }))) {
      const promoter = await findPromoterById(promoterId);
      const supervisorId = (promoter?.supervisor || "").trim().toLowerCase();
      await appendNotification({
        tipo: "promoter_goal",
        para: supervisorId || "admin",
        idPromotor: promoterId,
        promotor: promoter?.name || promoterId,
        periodo,
        detalle: `${promoter?.name || promoterId} alcanzó su meta semanal (${achieved.toFixed(1)}/${promoterGoal} unidades).`,
      });
    }

    const sucursalGoal = await getSucursalGoal(sucursalId);
    if (sucursalGoal) {
      const sucursalAchieved = await weekToDateUnits({ sucursalId }, week);
      if (sucursalAchieved >= sucursalGoal && !(await hasGoalNotification({ tipo: "sucursal_goal", id: sucursalId, periodo }))) {
        const sucursal = await getSucursal(sucursalId);
        const nombre = sucursal ? `${sucursal.clienteNombre} – ${sucursal.name}` : sucursalId;
        await appendNotification({
          tipo: "sucursal_goal",
          para: "admin",
          idSucursal: sucursalId,
          sucursal: nombre,
          periodo,
          detalle: `${nombre} alcanzó su meta semanal (${sucursalAchieved.toFixed(1)}/${sucursalGoal} unidades).`,
        });
      }
    }
  } catch (e) {
    console.error("[db] checkAndNotifyGoals falló:", e.message);
  }
}

// --- Perfil del promotor (resumen) -------------------------------------------
// Datos + sucursales frecuentes + última foto. YA NO trae el historial completo
// (ver getPromoterHistoryPage abajo, paginado por día) — antes traía hasta
// 200 visitas completas solo para sacar de ahí las sucursales más frecuentes y
// la foto más reciente, cuando eso se puede calcular en la base de datos sin
// traer las filas a memoria. Se usa desde el tablero del gerente/admin, del
// supervisor (solo SUS promotores) y del propio promotor (su "Perfil").
export async function getPromoterProfile(promoterId) {
  const promoter = await findPromoterById(promoterId);
  if (!promoter) return null;

  // Sucursales más frecuentes: se agrupa y cuenta EN LA BASE DE DATOS
  // (groupBy), no trayendo cada visita a memoria para contarlas en JS.
  const grouped = await prisma.visitRecord.groupBy({
    by: ["sucursalId"],
    where: { promoterId },
    _count: { sucursalId: true },
    orderBy: { _count: { sucursalId: "desc" } },
    take: 8,
  });
  const sucursalIds = grouped.map((g) => g.sucursalId);
  const sucursales = sucursalIds.length ? await prisma.sucursal.findMany({ where: { id: { in: sucursalIds } }, select: { id: true, name: true } }) : [];
  const sucursalNameById = new Map(sucursales.map((s) => [s.id, s.name]));
  const frequentSucursales = grouped.map((g) => ({
    sucursalId: g.sucursalId,
    sucursalName: sucursalNameById.get(g.sucursalId) || g.sucursalId,
    visits: g._count.sucursalId,
  }));

  // Foto de la visita MÁS RECIENTE: una sola fila, una sola columna — no las
  // 200 que se traían antes para usar solo esta.
  const latest = await prisma.visitRecord.findFirst({
    where: { promoterId },
    orderBy: [{ day: "desc" }, { checkInTime: "desc" }],
    select: { photo: true },
  });

  return {
    id: promoter.id,
    name: promoter.name,
    location: promoter.location ?? null,
    supervisor: promoter.supervisor ?? null,
    frequentSucursales,
    latestPhoto: latest?.photo ?? null,
  };
}

// Historial de check-in/check-out de un promotor, PAGINADO POR DÍA (no por
// fila): cada página trae `daysPerPage` días distintos (con TODAS sus
// visitas de esos días, normalmente 1 por día), más recientes primero. Con
// esto, un promotor con meses de historial ya no manda todo de golpe — ni
// aquí ni en el Sheet, nada limitaba antes cuántas filas podía traer.
// `hasMore` indica si hay días más viejos que la página actual.
export async function getPromoterHistoryPage(promoterId, { page = 1, daysPerPage = 7 } = {}) {
  const skip = Math.max(0, (page - 1) * daysPerPage);

  // Un día de más (`daysPerPage + 1`) para saber si hay más páginas sin
  // tener que contar el total de días por separado.
  const distinctDays = await prisma.visitRecord.findMany({
    where: { promoterId },
    distinct: ["day"],
    select: { day: true },
    orderBy: { day: "desc" },
    skip,
    take: daysPerPage + 1,
  });
  const hasMore = distinctDays.length > daysPerPage;
  const pageDays = distinctDays.slice(0, daysPerPage).map((d) => d.day);
  if (pageDays.length === 0) return { days: [], page, daysPerPage, hasMore: false };

  const rows = await prisma.visitRecord.findMany({
    where: { promoterId, day: { in: pageDays } },
    include: { sucursal: { include: { cliente: true } }, ...ITEMS_INCLUDE },
    orderBy: [{ day: "desc" }, { checkInTime: "desc" }],
    omit: { photo: true },
  });
  const catalog = await getCatalogoProductos();

  const byDay = new Map(pageDays.map((d) => [d, []]));
  for (const v of rows) {
    byDay.get(v.day)?.push({
      sucursalId: v.sucursalId,
      sucursalName: v.sucursal?.name || v.sucursalId,
      clienteNombre: v.sucursal?.cliente?.nombre ?? null,
      status: v.status,
      checkInTime: v.checkInTime,
      checkOutTime: v.checkOutTime,
      items: v.items,
      units: unitsOf(v.items, catalog),
    });
  }
  const days = pageDays.map((d) => ({ day: d, visits: byDay.get(d) ?? [] }));
  return { days, page, daysPerPage, hasMore };
}

// ¿El promotor `promoterId` es supervisado por `supervisorId` (ID del
// supervisor, ya en minúsculas)? Se usa para que un supervisor no pueda ver
// el perfil de un promotor que no es suyo.
export async function promoterBelongsToSupervisor(promoterId, supervisorId) {
  const promoter = await findPromoterById(promoterId);
  return (promoter?.supervisor || "").trim().toLowerCase() === supervisorId;
}

// --- Capacitación / Soporte: resumen de progreso ---------------------------
// Cuánto ha avanzado ESTE promotor en cada paso (Aprender/Practicar/Repasar)
// de una sección, contra el total real de contenido — para que las pestañas
// se vean "llenándose" conforme usa la app. "Dominada" para preguntas =
// acertó al menos una vez; para flashcards = llegó a la caja 3 de 5 (Leitner:
// ya no la olvida tan seguido). "Vista" para bloques = ya la mostró una vez.
export async function getTrainingProgressSummary(promoterId, seccion) {
  const [content, quiz, flashcards, progreso] = await Promise.all([
    getTrainingContent(seccion),
    getTrainingQuiz(seccion),
    getTrainingFlashcards(seccion),
    prisma.trainingProgress.findMany({ where: { promoterId, seccion } }),
  ]);
  const seenBlocks = new Set(progreso.filter((p) => p.tipo === "bloque").map((p) => p.itemKey));
  const masteredQuiz = new Set(progreso.filter((p) => p.tipo === "pregunta" && p.correct > 0).map((p) => p.itemKey));
  const masteredCards = new Set(progreso.filter((p) => p.tipo === "flashcard" && p.box >= 3).map((p) => p.itemKey));
  return {
    aprender: { seen: seenBlocks.size, total: content.bloques.length },
    practicar: { mastered: masteredQuiz.size, total: quiz.length },
    repasar: { mastered: masteredCards.size, total: flashcards.length },
  };
}