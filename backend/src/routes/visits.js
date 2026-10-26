import { Router } from "express";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { distanceMeters, isValidCoords } from "../geo.js";
import { getSucursal, getVisit, fetchTodayVisits, submitVisitReport } from "../db.js";
import { findPromoterById, notifyCheckIn, checkAndNotifyGoals, getMyGoalProgress } from "../db.js";
import { appendVisitRow } from "../sheets.js";
import { appendPresenceConfirmation } from "../presenceSheet.js";

const router = Router();
router.use(requireAuth); // todas las rutas de visitas exigen sesión válida

// Quita la foto cruda de un registro y expone solo `hasPhoto` para no inflar
// las respuestas (la imagen se recupera bajo demanda desde el blob storage).
function stripPhoto(rec) {
  if (!rec) return rec;
  const { photo, ...rest } = rec;
  return { ...rest, hasPhoto: !!photo };
}

// GET /api/visits/today -> { records: { [sucursalId]: registro } }
router.get("/today", async (req, res) => {
  const records = await fetchTodayVisits(req.promoter.id);
  const clean = {};
  for (const [k, v] of Object.entries(records)) clean[k] = stripPhoto(v);
  return res.json({ records: clean });
});

// GET /api/visits/my-goal -> { target, achieved, reached } | null
// La meta mensual (unidades) del promotor logueado y su avance del mes,
// siempre desde la base de datos real (sus propios check-outs).
router.get("/my-goal", async (req, res) => {
  try {
    const goal = await getMyGoalProgress(req.promoter.id);
    return res.json(goal);
  } catch (err) {
    console.error("[visits/my-goal]", err);
    return res.status(500).json({ message: "No se pudo cargar tu meta" });
  }
});

// Valida que el promotor está dentro del rango de la tienda. El SERVIDOR es la
// autoridad: recalcula la distancia con Haversine usando sus propias coordenadas
// de tienda y las coordenadas GPS reales que envía el cliente.
async function assertInRange(promoterId, sucursalId, coords) {
  const store = await getSucursal(sucursalId);
  if (!store) {
    const e = new Error("Tienda no encontrada en el catálogo");
    e.status = 404;
    throw e;
  }
  // 400: el cliente no envió coordenadas GPS válidas.
  if (!isValidCoords(coords)) {
    const e = new Error("Se requieren coordenadas GPS válidas (lat, lng)");
    e.status = 400;
    throw e;
  }
  const dist = distanceMeters(coords.lat, coords.lng, store.lat, store.lng);
  // 403: fuera del radio permitido (Protexa: 100 m). Incluimos la distancia
  // calculada por el servidor para que el cliente pueda mostrarla.
  if (dist > config.rangeMeters) {
    const e = new Error(
      `Estás a ${Math.round(dist)} m de la tienda; debes estar a ${config.rangeMeters} m o menos.`
    );
    e.status = 403;
    e.distance = Math.round(dist);
    throw e;
  }
  return { store, distance: Math.round(dist) };
}

// Valida que la foto sea un data URL de imagen y no exceda un tamaño razonable.
function assertValidPhoto(photo) {
  if (typeof photo !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) {
    const e = new Error("Se requiere una foto válida de la visita");
    e.status = 422;
    throw e;
  }
  // ~8MB de límite (el body ya está acotado en server.js).
  if (photo.length > 8 * 1024 * 1024) {
    const e = new Error("La foto es demasiado grande");
    e.status = 413;
    throw e;
  }
}

// POST /api/visits/:sucursalId/check-in  { coords, photo }
// La foto (Base64) es OBLIGATORIA. Se guarda en el servidor; en la respuesta
// solo se indica `hasPhoto` para no inflar los payloads posteriores.
router.post("/:sucursalId/check-in", async (req, res) => {
  try {
    const { coords, photo } = req.body ?? {};
    assertValidPhoto(photo);
    const { store, distance } = await assertInRange(req.promoter.id, req.params.sucursalId, coords);

    const existing = await getVisit(req.promoter.id, req.params.sucursalId);
    if (existing?.status === "checked-in" || existing?.status === "checked-out") {
      return res.status(409).json({ message: "La visita ya fue iniciada" });
    }

    const promoter = await findPromoterById(req.promoter.id);
    const checkInTime = new Date().toISOString();

    // Postgres (fuente de verdad de la app) y el Sheet (auditoría humana en
    // "Actividad Diaria") se disparan EN PARALELO — el Sheet no espera a que
    // Postgres termine. La fila del check-in queda con hora_salida = "0"
    // (visita todavía abierta); el check-out agrega su PROPIA fila después.
    const dbWrite = submitVisitReport(req.promoter.id, req.params.sucursalId, {
      status: "checked-in",
      checkInTime,
      checkInDistance: distance,
      photo, // persistida en el servidor (en real: blob storage)
    });
    const sheetWrite = appendVisitRow({
      promoter, store, sucursalId: req.params.sucursalId,
      checkInTime, checkOutTime: null,
      rollos: 0, cubetas: 0,
    }).then((result) => {
      if (result?.error) console.error("[check-in] Falló el registro en Sheets:", result.error);
      else console.log(`[check-in] OK en Sheet promotor=${req.promoter.id} tienda=${req.params.sucursalId}`);
    });

    await dbWrite;
    console.log(`[check-in] OK en Postgres promotor=${req.promoter.id} tienda=${req.params.sucursalId}`);
    sheetWrite.catch(() => {});

    // Avisa a su supervisor (si tiene uno) que este promotor hizo check-in,
    // con la tienda y si llegó a tiempo. Best-effort: no bloquea el check-in.
    notifyCheckIn(req.promoter.id, req.params.sucursalId, checkInTime).catch(() => {});

    // No devolvemos la foto cruda; solo metadatos.
    const record = await getVisit(req.promoter.id, req.params.sucursalId);
    return res.status(201).json(stripPhoto(record));
  } catch (err) {
    console.error(`[check-in] FALLÓ promotor=${req.promoter?.id} tienda=${req.params.sucursalId} status=${err?.status} code=${err?.code}:`, err?.message);
    if (err?.code === "P2002") return res.status(409).json({ message: "La visita ya fue registrada" });
    return res.status(err.status ?? 400).json({ message: err.message, distance: err.distance });
  }
});

// POST /api/visits/:sucursalId/check-out  { coords, rollos, cubetas }
router.post("/:sucursalId/check-out", async (req, res) => {
  try {
    const { coords, rollos, cubetas } = req.body ?? {};
    const { store, distance } = await assertInRange(req.promoter.id, req.params.sucursalId, coords);

    const existing = await getVisit(req.promoter.id, req.params.sucursalId);
    if (existing?.status !== "checked-in") {
      return res.status(409).json({ message: "No hay una entrada activa para cerrar" });
    }

    const promoter = await findPromoterById(req.promoter.id);
    const checkOutTime = new Date().toISOString();
    const rollosNum = Math.max(0, Number(rollos) || 0);
    const cubetasNum = Math.max(0, Number(cubetas) || 0);

    // Postgres y el Sheet en PARALELO, igual que en el check-in. La fila del
    // Sheet REPITE checkInTime (de la visita ya abierta) para que, ella sola,
    // ya tenga entrada y salida — sin esperar a que Postgres confirme el cierre.
    const dbWrite = submitVisitReport(req.promoter.id, req.params.sucursalId, {
      status: "checked-out",
      checkOutTime,
      checkOutDistance: distance,
      rollos: rollosNum,
      cubetas: cubetasNum,
    });
    const sheetWrite = appendVisitRow({
      promoter, store, sucursalId: req.params.sucursalId,
      checkInTime: existing.checkInTime, checkOutTime,
      rollos: rollosNum, cubetas: cubetasNum,
    }).then((result) => {
      if (result?.error) console.error("[check-out] Falló el registro en Sheets:", result.error);
      else console.log(`[check-out] OK en Sheet promotor=${req.promoter.id} tienda=${req.params.sucursalId}`);
    });

    const record = await dbWrite;
    console.log(`[check-out] OK en Postgres promotor=${req.promoter.id} tienda=${req.params.sucursalId} id=${record?.id}`);
    sheetWrite.catch(() => {});

    // ¿Este check-out hace que el promotor o la tienda lleguen a su meta
    // mensual? Best-effort y en segundo plano: no retrasa la respuesta.
    checkAndNotifyGoals(req.promoter.id, req.params.sucursalId).catch(() => {});

    return res.json(stripPhoto(record));
  } catch (err) {
    console.error(`[check-out] FALLÓ promotor=${req.promoter?.id} tienda=${req.params.sucursalId} status=${err?.status} code=${err?.code}:`, err?.message);
    if (err?.code === "P2002") return res.status(409).json({ message: "La visita ya fue registrada" });
    return res.status(err.status ?? 400).json({ message: err.message, distance: err.distance });
  }
});

// POST /api/visits/:sucursalId/confirm-presence  { coords?, sigueEnTienda }
// Confirmación de "sigo en tienda" — la dispara el cliente una vez al día, en
// un momento aleatorio entre 10am y 4pm, solo mientras el promotor tiene un
// check-in abierto en esa tienda, preguntándole Sí/No. `coords` es best-effort
// (el cliente intenta tomar el GPS al responder, pero si falla o lo niega, NO
// se bloquea la respuesta) y no se revalida contra el radio de la tienda: si
// contesta "No", lo esperable es que ya esté fuera de rango.
router.post("/:sucursalId/confirm-presence", async (req, res) => {
  try {
    const { coords, sigueEnTienda } = req.body ?? {};
    if (typeof sigueEnTienda !== "boolean") {
      return res.status(400).json({ message: "Falta indicar si sigue en la tienda (sí/no)." });
    }
    const existing = await getVisit(req.promoter.id, req.params.sucursalId);
    if (existing?.status !== "checked-in") {
      return res.status(409).json({ message: "No tienes una visita abierta en esa tienda" });
    }
    const [promoter, store] = await Promise.all([
      findPromoterById(req.promoter.id),
      getSucursal(req.params.sucursalId),
    ]);
    await appendPresenceConfirmation({
      promoterId: req.promoter.id,
      promoterName: promoter?.name || req.promoter.id,
      supervisor: promoter?.supervisor || "",
      sucursalId: req.params.sucursalId,
      sucursalName: store?.name || req.params.sucursalId,
      coords: isValidCoords(coords) ? coords : null,
      sigueEnTienda,
    });
    console.log(`[confirm-presence] OK promotor=${req.promoter.id} tienda=${req.params.sucursalId} sigueEnTienda=${sigueEnTienda}`);
    return res.status(204).end();
  } catch (err) {
    console.error(`[confirm-presence] FALLÓ promotor=${req.promoter?.id} tienda=${req.params.sucursalId}:`, err?.message);
    return res.status(err.status ?? 500).json({ message: err.message || "No se pudo guardar la confirmación" });
  }
});

export default router;
