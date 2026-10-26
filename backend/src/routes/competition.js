// ---------------------------------------------------------------------------
// Reportes de competencia — pantalla "Competencia" de la app del promotor.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { createCompetitionReport } from "../db.js";

const router = Router();
router.use(requireAuth);

const MAX_MARCA = 160;
const MAX_DESCRIPCION = 2000;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // ~2MB por foto (ya redimensionada en el cliente)

function clean(v, max) {
  return String(v ?? "").trim().slice(0, max);
}

function assertValidPhotos(photos) {
  if (photos === undefined || photos === null) return [];
  if (!Array.isArray(photos)) {
    const e = new Error("Las fotos deben venir como una lista");
    e.status = 400;
    throw e;
  }
  if (photos.length > MAX_PHOTOS) {
    const e = new Error(`Máximo ${MAX_PHOTOS} fotos por reporte`);
    e.status = 422;
    throw e;
  }
  for (const photo of photos) {
    if (typeof photo !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) {
      const e = new Error("Una de las fotos no es válida");
      e.status = 422;
      throw e;
    }
    if (photo.length > MAX_PHOTO_BYTES) {
      const e = new Error("Una de las fotos es demasiado grande");
      e.status = 413;
      throw e;
    }
  }
  return photos;
}

// POST /api/competition  { marca, descripcion, fotos? }
router.post("/", async (req, res) => {
  try {
    const marca = clean(req.body?.marca, MAX_MARCA);
    const descripcion = clean(req.body?.descripcion, MAX_DESCRIPCION);
    if (!marca) return res.status(400).json({ message: "Indica la marca o competidor." });
    if (!descripcion) return res.status(400).json({ message: "Describe lo que observaste." });
    const photos = assertValidPhotos(req.body?.fotos);

    const report = await createCompetitionReport(req.promoter.id, { marca, descripcion, photos });
    return res.status(201).json({ id: report.id, hasPhotos: photos.length > 0, photoCount: photos.length });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("[competition]", err);
    return res.status(502).json({ message: "No se pudo guardar tu reporte de competencia. Intenta de nuevo." });
  }
});

export default router;
