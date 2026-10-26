import { Router } from "express";
import { authenticate, issueSession, clearSession, requireAuth } from "../auth.js";
import { findPromoterById } from "../db.js";
import { findUserInSheet } from "../usersSheet.js";
import { appendNotification } from "../notificationsSheet.js";
import { config } from "../config.js";

const router = Router();

// POST /api/login  { promoterId, password }
// Verifica ID + contraseña (bcrypt) y emite la cookie de sesión HttpOnly.
router.post("/login", async (req, res) => {
  const { promoterId, password } = req.body ?? {};
  try {
    const promoter = await authenticate(promoterId, password);
    issueSession(res, promoter);
    return res.status(204).end();
  } catch (err) {
    return res.status(err.status ?? 401).json({ message: err.message ?? "No autorizado" });
  }
});

// POST /api/auth/recover-request  { promoterId }
// Ruta PÚBLICA (nadie tiene sesión todavía en la pantalla de login): no
// resetea nada por sí sola, solo AVISA a quien puede resetearla. Si el ID es
// de un promotor, notifica a su supervisor (o a "admin" si no tiene uno); si
// es de un admin/gerente/supervisor, notifica a "admin". Responde el MISMO
// mensaje exista o no el ID, para no revelar qué IDs son válidos (mismo
// criterio que authenticate() en auth.js).
router.post("/auth/recover-request", async (req, res) => {
  const id = String(req.body?.promoterId || "").trim();
  if (id) {
    try {
      const user = await findUserInSheet(id);
      if (user) {
        await appendNotification({
          tipo: "password_recovery",
          para: "admin",
          idPromotor: user.id,
          promotor: user.name || user.id,
          detalle: `${user.name || user.id} (${user.role}) solicitó recuperar su contraseña.`,
        });
      } else {
        const promoter = await findPromoterById(id);
        if (promoter) {
          const supervisorId = (promoter.supervisor || "").trim().toLowerCase();
          await appendNotification({
            tipo: "password_recovery",
            para: supervisorId || "admin",
            idPromotor: promoter.id,
            promotor: promoter.name || promoter.id,
            detalle: `${promoter.name || promoter.id} solicitó una contraseña nueva para su cuenta.`,
          });
        }
        // Si el ID no coincide con nadie, no se notifica a nadie, pero la
        // respuesta al cliente es idéntica (ver comentario arriba).
      }
    } catch (err) {
      console.error("[auth/recover-request]", err.message);
    }
  }
  return res.json({ message: "Si tu ID es válido, tu supervisor recibirá la solicitud en breve." });
});

// GET /api/auth/session -> { id, name, role, location?, supervisor?, checkInRadiusMeters }
// Las tiendas ya NO vienen aquí: se obtienen por cercanía en GET /api/sucursales.
// El `role` (del JWT) le dice al frontend qué pantalla mostrar: gerente/admin →
// tablero del gerente; promotor → app de campo.
router.get("/auth/session", requireAuth, async (req, res) => {
  const role = req.promoter.role || "promotor";

  // ADMIN / GERENTE / SUPERVISOR viven en la pestaña "Usuarios", NO en el
  // listado de promotores. No exigimos una ficha de promotor para ellos.
  if (role === "gerente" || role === "admin" || role === "supervisor") {
    return res.json({
      id: req.promoter.id,
      name: req.promoter.name,
      role,
      checkInRadiusMeters: config.rangeMeters,
    });
  }

  const promoter = await findPromoterById(req.promoter.id);
  if (!promoter) return res.status(401).json({ message: "Sesión inválida" });
  return res.json({
    id: promoter.id,
    name: promoter.name,
    role,
    location: promoter.location,
    supervisor: promoter.supervisor,
    // Radio de check-in/out (m) que aplica el servidor. El frontend lo usa para
    // que su UI coincida con la regla real (configurable con CHECK_IN_RADIUS_METERS).
    checkInRadiusMeters: config.rangeMeters,
  });
});

// POST /api/auth/logout
router.post("/auth/logout", requireAuth, (req, res) => {
  clearSession(res);
  return res.status(204).end();
});

export default router;
