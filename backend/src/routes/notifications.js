// ---------------------------------------------------------------------------
// Centro de notificaciones (campana) — admin/gerente y supervisor.
// ---------------------------------------------------------------------------
// Admin/gerente reciben las dirigidas a "admin" (check-in no aplica para
// ellos; sí "meta de tienda alcanzada") + un "insight" en vivo con el Top 5 de
// vendedores del día (no se guarda en el Sheet: se recalcula cada vez).
// Supervisor recibe las dirigidas a su propio ID (check-in de sus promotores
// y "meta de promotor alcanzada").
import { Router } from "express";
import { requireAuth, requireRole } from "../auth.js";
import { listNotificationsForToday, listNotificationsPage } from "../notificationsSheet.js";
import { getManagerSummary, getCheckinPhoto } from "../db.js";
import { maybeSendWeeklyReports } from "../weeklyReport.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "gerente", "supervisor"));

// Resuelve, EN PARALELO, la foto de check-in de cada notificación tipo
// "checkin" de una lista — ver getCheckinPhoto. Se usa tanto para la campana
// (hoy) como para el historial paginado (una página de días a la vez), así
// que el tamaño de `raw` siempre está acotado por diseño, nunca es "todo el
// historial de golpe".
async function withCheckinPhotos(raw) {
  return Promise.all(
    raw.map(async (n) => {
      if (n.tipo !== "checkin") return n;
      const photo = await getCheckinPhoto(n.idPromotor, n.idSucursal, n.fecha);
      return photo ? { ...n, photo } : n;
    })
  );
}

// GET /api/notifications — SOLO las de HOY (antes traía las últimas 50 sin
// importar el día; con polling cada 30s desde la campana, eso era leer y
// resolver fotos de notificaciones de hace semanas una y otra vez). El
// historial completo vive en GET /notifications/history, paginado por día.
router.get("/", async (req, res) => {
  try {
    // Best-effort y en segundo plano: si ya pasó una semana, genera y entrega
    // el reporte semanal (admin + supervisores). No retrasa esta respuesta.
    maybeSendWeeklyReports().catch(() => {});

    const role = req.promoter.role;
    const para = role === "supervisor" ? req.promoter.id : "admin";
    const raw = await listNotificationsForToday(para);
    const notifications = await withCheckinPhotos(raw);

    let insight = null;
    if (role === "admin" || role === "gerente") {
      const today = await getManagerSummary("today");
      insight = {
        label: "Top 5 vendedores de hoy",
        top: today.promoters.slice(0, 5).map((p) => ({ id: p.id, name: p.name, money: p.money, units: p.rollos + p.cubetas })),
      };
    }

    return res.json({ notifications, insight });
  } catch (err) {
    console.error("[notifications]", err);
    return res.status(500).json({ message: "No se pudieron cargar las notificaciones" });
  }
});

// GET /api/notifications/history?page=1&daysPerPage=7 — historial completo,
// paginado POR DÍA (ver listNotificationsPage), 7 días por default.
router.get("/history", async (req, res) => {
  try {
    const role = req.promoter.role;
    const para = role === "supervisor" ? req.promoter.id : "admin";
    const page = Math.max(1, Number(req.query.page) || 1);
    const daysPerPage = Math.min(30, Math.max(1, Number(req.query.daysPerPage) || 7));

    const result = await listNotificationsPage(para, { page, daysPerPage });
    const days = await Promise.all(
      result.days.map(async (d) => ({ day: d.day, notifications: await withCheckinPhotos(d.notifications) }))
    );
    return res.json({ ...result, days });
  } catch (err) {
    console.error("[notifications/history]", err);
    return res.status(500).json({ message: "No se pudo cargar el historial de notificaciones" });
  }
});

export default router;
