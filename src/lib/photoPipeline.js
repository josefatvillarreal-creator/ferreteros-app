// ---------------------------------------------------------------------------
// Procesado de una foto elegida con el selector de archivos (la cámara del
// sistema o la galería): usa el tamaño y la calidad que recomienda el
// diagnóstico del dispositivo y deja registrado cuánto tardó o por qué falló.
// ---------------------------------------------------------------------------
import { resizeImage } from "./imageTools.js";
import { currentRecommendation, recordPhotoMetric } from "./deviceProfile.js";

// kind: "visit" | "competition". Devuelve el data URL ya reducido.
export async function processPickedFile(file, kind = "visit") {
  const rec = currentRecommendation(kind);
  const t0 = performance.now();
  try {
    const dataUrl = await resizeImage(file, rec.maxDim, rec.quality);
    recordPhotoMetric({
      kind,
      via: "file",
      ok: true,
      ms: Math.round(performance.now() - t0),
      bytes: Math.round(dataUrl.length * 0.75),
    });
    return dataUrl;
  } catch (err) {
    recordPhotoMetric({ kind, via: "file", ok: false, ms: Math.round(performance.now() - t0), error: err?.message });
    throw err;
  }
}
