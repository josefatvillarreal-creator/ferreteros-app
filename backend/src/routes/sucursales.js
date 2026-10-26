// ---------------------------------------------------------------------------
// Sucursales cercanas — GET /api/sucursales?lat=&lng=
// ---------------------------------------------------------------------------
// El frontend envía su ubicación GPS real. El SERVIDOR calcula la distancia
// (Haversine) desde cada sucursal del catálogo global y devuelve solo las que
// están dentro de `nearbyRadiusMeters` (2 km por defecto), ordenadas por
// cercanía. No hay asignación fija de sucursales por promotor.
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { distanceMeters, isValidCoords } from "../geo.js";
import { getAllSucursales } from "../db.js";

const router = Router();
router.use(requireAuth);

// GET /api/sucursales?lat=..&lng=..[&radius=..]
router.get("/", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!isValidCoords({ lat, lng })) {
    return res.status(400).json({ message: "Se requieren coordenadas GPS válidas (lat, lng)" });
  }
  // Radio opcional acotado al máximo del servidor (evita que el cliente lo infle).
  const requested = Number(req.query.radius);
  const radius = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 0), config.nearbyRadiusMeters)
    : config.nearbyRadiusMeters;

  const sucursales = await getAllSucursales();
  const nearby = sucursales
    .map((s) => ({ ...s, distance: Math.round(distanceMeters(lat, lng, s.lat, s.lng)) }))
    .filter((s) => s.distance <= radius)
    .sort((a, b) => a.distance - b.distance);

  return res.json({ radius, sucursales: nearby });
});

// GET /api/sucursales/all -> TODAS las sucursales del catálogo (para pintarlas
// en el mapa de Inicio, sin filtro de distancia).
router.get("/all", async (req, res) => {
  const sucursales = await getAllSucursales();
  return res.json({ sucursales });
});

export default router;
