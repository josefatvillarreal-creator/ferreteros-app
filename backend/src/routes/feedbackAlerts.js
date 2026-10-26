// ---------------------------------------------------------------------------
// Configuración de las alertas automáticas de Retroalimentación (correo +
// push vía ntfy.sh) — solo admin/gerente. El envío real lo hace un Google
// Apps Script atado al Sheet (ver MANUAL_DESPLIEGUE.md); estas rutas solo
// leen/escriben su configuración para que se pueda administrar desde el
// tablero, en vez de editar el Sheet a mano.
import { Router } from "express";
import { requireAuth, requireRole } from "../auth.js";
import {
  getFeedbackAlertsConfig,
  setFeedbackAlertsConfig,
  getFeedbackAlertsRecipients,
  addFeedbackAlertsRecipient,
  removeFeedbackAlertsRecipient,
} from "../feedbackAlertsSheet.js";

const router = Router();
router.use(requireAuth, requireRole("gerente", "admin"));

// GET /api/feedback-alerts -> { activo, temaNtfy, destinatarios: [{nombre,email}] }
router.get("/", async (req, res) => {
  try {
    const [cfg, destinatarios] = await Promise.all([getFeedbackAlertsConfig(), getFeedbackAlertsRecipients()]);
    return res.json({ ...cfg, destinatarios });
  } catch (err) {
    console.error("[feedback-alerts]", err);
    return res.status(500).json({ message: "No se pudo cargar la configuración de alertas" });
  }
});

// PUT /api/feedback-alerts  { activo, temaNtfy }
router.put("/", async (req, res) => {
  try {
    const { activo, temaNtfy } = req.body ?? {};
    if (!String(temaNtfy ?? "").trim()) {
      return res.status(400).json({ message: "El tema de ntfy no puede quedar vacío" });
    }
    const cfg = await setFeedbackAlertsConfig({ activo: Boolean(activo), temaNtfy });
    return res.json(cfg);
  } catch (err) {
    console.error("[feedback-alerts/put]", err);
    return res.status(500).json({ message: "No se pudo guardar la configuración" });
  }
});

// POST /api/feedback-alerts/destinatarios  { nombre, email }
router.post("/destinatarios", async (req, res) => {
  try {
    const { nombre, email } = req.body ?? {};
    await addFeedbackAlertsRecipient(nombre, email);
    return res.status(204).end();
  } catch (err) {
    return res.status(err.message === "Correo inválido" ? 400 : 500).json({ message: err.message || "No se pudo agregar el destinatario" });
  }
});

// DELETE /api/feedback-alerts/destinatarios/:email
router.delete("/destinatarios/:email", async (req, res) => {
  try {
    await removeFeedbackAlertsRecipient(req.params.email);
    return res.status(204).end();
  } catch (err) {
    console.error("[feedback-alerts/delete]", err);
    return res.status(500).json({ message: "No se pudo quitar el destinatario" });
  }
});

export default router;
