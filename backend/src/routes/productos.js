// ---------------------------------------------------------------------------
// Catálogo de productos — GET /api/productos
// ---------------------------------------------------------------------------
// Solo los productos ACTIVOS: son los campos que el promotor llena en el
// check-out. Se configuran en la pestaña Productos del Sheet.
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getProductosActivos } from "../db.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const productos = await getProductosActivos();
  return res.json({ productos });
});

export default router;
