// ---------------------------------------------------------------------------
// Rutas del GERENTE / ADMIN — resumen nacional del día.
// ---------------------------------------------------------------------------
// Todas exigen sesión válida (requireAuth) Y rol gerente o admin (requireRole).
// Un promotor de campo que intente llamarlas recibe 403.
import { Router } from "express";
import { requireAuth, requireRole } from "../auth.js";
import { getManagerSummary, setPromoterGoal, getCompetitionReports, getCompetitionReportPhotos } from "../db.js";

const router = Router();
router.use(requireAuth, requireRole("gerente", "admin"));

const RANGE_KEYS = ["today", "yesterday", "week", "last_week", "month", "last_month", "year", "last_year", "custom"];

// GET /api/manager/summary?range=today|yesterday|week|last_week|month|last_month|year|last_year|custom&from=&to=
// Sin `range` (o uno inválido) usa "today". `range=custom` requiere
// `from`/`to` ("YYYY-MM-DD"); si faltan o son inválidas, resolveRange cae a
// "today". Devuelve totales, desglose por estado y el arreglo de promotores
// activos (con rollos, cubetas, dinero, ubicación y sus visitas individuales)
// para ese rango.
router.get("/summary", async (req, res) => {
  try {
    const range = RANGE_KEYS.includes(String(req.query.range)) ? String(req.query.range) : "today";
    const summary = await getManagerSummary(range, { from: req.query.from, to: req.query.to });
    return res.json(summary);
  } catch (err) {
    console.error("[manager/summary]", err);
    return res.status(500).json({ message: "No se pudo generar el resumen" });
  }
});

// PUT /api/manager/promoter/:id/goal  { meta, nombre? }
// Fija la meta SEMANAL personalizada (unidades-equivalentes de rollo) de un
// promotor, como excepción al default de 30. Solo admin/gerente pueden
// asignar metas (los supervisores solo las VEN en su tablero).
router.put("/promoter/:id/goal", async (req, res) => {
  try {
    const meta = Number(req.body?.meta);
    if (!Number.isFinite(meta) || meta <= 0) {
      return res.status(400).json({ message: "La meta debe ser un número mayor a 0" });
    }
    await setPromoterGoal(req.params.id, meta, req.body?.nombre);
    return res.status(204).end();
  } catch (err) {
    console.error("[manager/promoter/goal]", err);
    return res.status(500).json({ message: "No se pudo guardar la meta" });
  }
});

// GET /api/manager/competencia — reportes de Competencia de TODOS los
// promotores (marca, descripción), más recientes primero. Las fotos NO
// vienen aquí (ver /competencia/:id/photos) — es solo el listado.
router.get("/competencia", async (req, res) => {
  try {
    const reports = await getCompetitionReports();
    return res.json({ reports });
  } catch (err) {
    console.error("[manager/competencia]", err);
    return res.status(500).json({ message: "No se pudieron cargar los reportes de competencia" });
  }
});

// GET /api/manager/competencia/:id/photos — fotos de UN reporte, pedidas al
// abrir su detalle (no en el listado, ver comentario arriba).
router.get("/competencia/:id/photos", async (req, res) => {
  try {
    const photos = await getCompetitionReportPhotos(req.params.id);
    if (photos === null) return res.status(404).json({ message: "Reporte no encontrado" });
    return res.json({ photos });
  } catch (err) {
    console.error("[manager/competencia/photos]", err);
    return res.status(500).json({ message: "No se pudieron cargar las fotos" });
  }
});

export default router;
