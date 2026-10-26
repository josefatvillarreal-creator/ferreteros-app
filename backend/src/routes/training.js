// ---------------------------------------------------------------------------
// Capacitación / Soporte — mismo contenido y mecánica para las dos secciones
// ("capacitacion" = cómo hacer mejor el trabajo, "soporte" = información
// técnica de producto), diferenciadas solo por el parámetro `:seccion`.
// Cualquier rol con sesión puede verlo (admin/gerente/supervisor lo pueden
// previsualizar); el progreso se guarda bajo el ID de QUIEN esté logueado.
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getTrainingContent, getTrainingQuiz, getTrainingFlashcards } from "../trainingSheet.js";
import { getTrainingProgressSummary, ensurePromoterExistsLocally } from "../db.js";
import { prisma } from "../prisma.js";

const router = Router();
router.use(requireAuth);

const SECCIONES = ["capacitacion", "soporte"];

function validSeccion(req, res) {
  const seccion = String(req.params.seccion || "").toLowerCase();
  if (!SECCIONES.includes(seccion)) {
    res.status(404).json({ message: "Sección no encontrada" });
    return null;
  }
  return seccion;
}

// GET /api/training/:seccion/onboarding -> { bienvenida, bloques, tooltips }
router.get("/:seccion/onboarding", async (req, res) => {
  const seccion = validSeccion(req, res);
  if (!seccion) return;
  try {
    return res.json(await getTrainingContent(seccion));
  } catch (err) {
    console.error("[training/onboarding]", err);
    return res.status(500).json({ message: "No se pudo cargar el contenido" });
  }
});

// GET /api/training/:seccion/quiz -> [{ orden, pregunta, opciones, correcta,
// feedbackAcierto, feedbackError, progress: {attempts,correct,lastResult} }]
router.get("/:seccion/quiz", async (req, res) => {
  const seccion = validSeccion(req, res);
  if (!seccion) return;
  try {
    const [preguntas, progreso] = await Promise.all([
      getTrainingQuiz(seccion),
      prisma.trainingProgress.findMany({ where: { promoterId: req.promoter.id, seccion, tipo: "pregunta" } }),
    ]);
    const byOrden = new Map(progreso.map((p) => [p.itemKey, p]));
    return res.json(
      preguntas.map((p) => {
        const prev = byOrden.get(String(p.orden));
        return { ...p, progress: prev ? { attempts: prev.attempts, correct: prev.correct, lastResult: prev.lastResult } : null };
      })
    );
  } catch (err) {
    console.error("[training/quiz]", err);
    return res.status(500).json({ message: "No se pudo cargar el quiz" });
  }
});

// GET /api/training/:seccion/flashcards -> [{ orden, anverso, reverso, box }]
router.get("/:seccion/flashcards", async (req, res) => {
  const seccion = validSeccion(req, res);
  if (!seccion) return;
  try {
    const [tarjetas, progreso] = await Promise.all([
      getTrainingFlashcards(seccion),
      prisma.trainingProgress.findMany({ where: { promoterId: req.promoter.id, seccion, tipo: "flashcard" } }),
    ]);
    const byOrden = new Map(progreso.map((p) => [p.itemKey, p]));
    return res.json(
      tarjetas.map((t) => ({ ...t, box: byOrden.get(String(t.orden))?.box ?? 1 }))
    );
  } catch (err) {
    console.error("[training/flashcards]", err);
    return res.status(500).json({ message: "No se pudo cargar las tarjetas" });
  }
});

// GET /api/training/:seccion/progress-summary -> { aprender: {seen,total},
// practicar: {mastered,total}, repasar: {mastered,total} } — para que las
// pestañas Aprender/Practicar/Repasar se vean "llenándose" conforme avanza.
router.get("/:seccion/progress-summary", async (req, res) => {
  const seccion = validSeccion(req, res);
  if (!seccion) return;
  try {
    return res.json(await getTrainingProgressSummary(req.promoter.id, seccion));
  } catch (err) {
    console.error("[training/progress-summary]", err);
    return res.status(500).json({ message: "No se pudo cargar tu progreso" });
  }
});

// POST /api/training/:seccion/progress  { tipo: "bloque"|"pregunta"|"flashcard", orden, correct }
// Registra un intento (o, para "bloque", que ya vio ese concepto). Para
// "flashcard", ajusta la caja Leitner: acertó -> sube una caja (tope 5),
// falló -> vuelve a la caja 1.
router.post("/:seccion/progress", async (req, res) => {
  const seccion = validSeccion(req, res);
  if (!seccion) return;
  try {
    const { tipo, orden, correct } = req.body ?? {};
    if (!["bloque", "pregunta", "flashcard"].includes(tipo) || !Number.isFinite(Number(orden))) {
      return res.status(400).json({ message: "Faltan datos del intento (tipo, orden)" });
    }
    const itemKey = String(orden);
    const ok = Boolean(correct);

    // Solo los promotores tienen fila en la tabla Promoter (admin/gerente/
    // supervisor viven en la pestaña "Usuarios", no en "Promotores") — si
    // alguien de esos roles está solo previsualizando el contenido, su
    // intento no se puede guardar (no hay a quién asociarlo): respondemos
    // "guardado" sin escribir nada, en vez de tronar por la llave foránea.
    if (req.promoter.role !== "promotor") {
      return res.json({ attempts: 0, correct: 0, lastResult: ok, box: 1 });
    }

    await ensurePromoterExistsLocally(req.promoter.id);

    const existing = await prisma.trainingProgress.findUnique({
      where: { promoterId_seccion_tipo_itemKey: { promoterId: req.promoter.id, seccion, tipo, itemKey } },
    });
    const nextBox = tipo === "flashcard" ? (ok ? Math.min(5, (existing?.box ?? 1) + 1) : 1) : (existing?.box ?? 1);

    const saved = await prisma.trainingProgress.upsert({
      where: { promoterId_seccion_tipo_itemKey: { promoterId: req.promoter.id, seccion, tipo, itemKey } },
      update: {
        attempts: { increment: 1 },
        correct: { increment: ok ? 1 : 0 },
        lastResult: ok,
        box: nextBox,
      },
      create: {
        promoterId: req.promoter.id,
        seccion,
        tipo,
        itemKey,
        attempts: 1,
        correct: ok ? 1 : 0,
        lastResult: ok,
        box: nextBox,
      },
    });
    return res.json({ attempts: saved.attempts, correct: saved.correct, lastResult: saved.lastResult, box: saved.box });
  } catch (err) {
    console.error("[training/progress]", err);
    return res.status(500).json({ message: "No se pudo guardar tu progreso" });
  }
});

export default router;
