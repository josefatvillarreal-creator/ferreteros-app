// ---------------------------------------------------------------------------
// Retroalimentación — POST /api/feedback
// ---------------------------------------------------------------------------
// Los asesores reportan errores o problemas desde la app (p. ej. "no me aparece
// mi sucursal para el check-in"). Cada reporte se guarda como una fila en la
// pestaña de retroalimentación del Google Sheet.
//
// Requiere sesión válida (requireAuth). El ID y el nombre vienen precargados en
// el form desde la sesión, pero el asesor puede editarlos, así que además
// guardamos `enviado_por` = ID real de la sesión como dato de auditoría.
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { appendFeedbackRow } from "../sheets.js";
import { createTicket } from "../threadsDb.js";
 
const router = Router();
router.use(requireAuth);
 
// Límites defensivos para no aceptar payloads anómalos.
const MAX_ID = 40;
const MAX_NOMBRE = 120;
const MAX_SUCURSAL = 160;
const MAX_DESCRIPCION = 4000;
const MAX_UBICACION = 60; // "lat,lng"
 
function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}
 
// POST /api/feedback  { idPromotor, nombre, sucursal, descripcion }
router.post("/", async (req, res) => {
  const idPromotor = clean(req.body?.idPromotor, MAX_ID);
  const nombre = clean(req.body?.nombre, MAX_NOMBRE);
  const sucursal = clean(req.body?.sucursal, MAX_SUCURSAL);
  const descripcion = clean(req.body?.descripcion, MAX_DESCRIPCION);
  const ubicacion = clean(req.body?.ubicacion, MAX_UBICACION);
 
  // La descripción es el corazón del reporte: es obligatoria. La sucursal
  // también, para poder canalizar el problema. ID y nombre se autollenan.
  if (!descripcion) {
    return res.status(400).json({ message: "Describe el problema para poder ayudarte." });
  }
  if (!sucursal) {
    return res.status(400).json({ message: "Indica la sucursal relacionada con el problema." });
  }
 
  // Cada reporte de un PROMOTOR abre un ticket con hilo de seguimiento (ver
  // threadsDb.js). El ID se genera aquí para guardarlo también en la fila del
  // Sheet y poder cruzar una con el otro.
  const ticketId = req.promoter.role === "promotor" ? randomUUID() : "";

  try {
    await appendFeedbackRow({
      idPromotor: idPromotor || req.promoter.id,
      nombre: nombre || req.promoter.name || "",
      sucursal,
      descripcion,
      enviadoPor: req.promoter.id, // auditoría: quién está realmente logueado
      ubicacion, // coordenadas GPS capturadas al enviar el reporte
      idTicket: ticketId,
    });

    // El reporte (fila del Sheet, que dispara las alertas a administración) ya
    // quedó guardado; abrir el ticket es un extra — si falla, no se le niega
    // al promotor que su reporte se registró, solo se queda sin seguimiento.
    let ticket = null;
    if (ticketId) {
      try {
        // El ticket va ligado a la SESIÓN (no al ID editable del form): de eso
        // depende que cada promotor solo vea sus propios tickets.
        ticket = await createTicket({ id: ticketId, promoterId: req.promoter.id, promoterName: nombre || req.promoter.name, sucursal, descripcion });
      } catch (e) {
        console.error("[feedback] El reporte se guardó pero no se pudo abrir el ticket:", e.message);
      }
    }
    return res.status(201).json({ message: "¡Gracias! Tu retroalimentación fue registrada.", ticketId: ticket?.id ?? null });
  } catch (err) {
    console.error("[feedback] No se pudo guardar el reporte:", err.message);
    return res
      .status(502)
      .json({ message: "No se pudo guardar tu retroalimentación en este momento. Intenta de nuevo." });
  }
});
 
export default router;
 