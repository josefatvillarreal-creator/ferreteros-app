// ---------------------------------------------------------------------------
// Herramientas de imagen compartidas (selector de archivos y cámara integrada).
// ---------------------------------------------------------------------------
// Antes vivían dentro de PromotoresApp.jsx; se movieron aquí para que la cámara
// integrada (CameraCapture.jsx) use exactamente el mismo redimensionado/WebP.

// ¿El navegador codifica WebP de verdad? Algunos navegadores viejos ignoran
// el mime type pedido y devuelven PNG en silencio (sin comprimir nada) en vez
// de fallar — hay que revisar el resultado, no solo asumir que funcionó. Se
// calcula una sola vez y se cachea (canvas.toDataURL no es gratis).
let webpSupported = null;
export function supportsWebP() {
  if (webpSupported === null) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    webpSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupported;
}

// Dibuja una imagen ya decodificada (ImageBitmap, HTMLImageElement o un
// <video> con un cuadro de la cámara; todos son válidos para drawImage) en un
// canvas de a lo más `maxDim` px de lado mayor, y la codifica a WebP (respaldo
// a JPEG si el navegador no lo soporta de verdad). Un <video> expone su tamaño
// real en videoWidth/videoHeight (su width/height son atributos de maquetación).
export function drawResized(source, maxDim, quality) {
  let width = source.videoWidth || source.width;
  let height = source.videoHeight || source.height;
  if (width >= height && width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round((width * maxDim) / height);
    height = maxDim;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  const format = supportsWebP() ? "image/webp" : "image/jpeg";
  return canvas.toDataURL(format, quality);
}

// Camino rápido: createImageBitmap decodifica directo del archivo (sin pasar
// por un <img> del DOM ni por un string Base64 intermedio) y bitmap.close()
// libera esa memoria de inmediato en cuanto ya se copió al canvas chico, en
// vez de esperar a que el garbage collector se acuerde.
//
// `resizeWidth` es la parte que más importa para la memoria: sin esto,
// createImageBitmap decodifica la foto a su resolución ORIGINAL completa
// (una cámara de 48-108 MP son cientos de MB de píxeles crudos sin comprimir)
// y RECIÉN AHÍ la dibujamos chica — ese pico de decodificar a resolución
// completa, aunque sea un instante, es lo que sigue tronando "memoria
// insuficiente" en los equipos más limitados. Con el hint, Chrome decodifica
// ya achicado (aprovecha el downscale nativo del propio decodificador JPEG),
// sin pasar nunca por el tamaño completo. Se da SOLO el ancho (no alto): así
// el navegador calcula el alto preservando el aspect ratio real, sin deformar
// la imagen sin importar si la foto es vertical u horizontal — drawResized
// abajo hace el recorte EXACTO al tamaño final con ese aspect ratio ya
// correcto. `imageOrientation: "from-image"` mantiene el mismo auto-rotado
// por EXIF que ya hacía <img> por su cuenta.
async function resizeImageViaBitmap(file, maxDim, quality) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: maxDim, resizeQuality: "medium" });
  } catch {
    // Navegador sin soporte para los hints de resize -> decodifica a
    // resolución completa como respaldo (mejor que fallar el check-in).
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  }
  try {
    return drawResized(bitmap, maxDim, quality);
  } finally {
    bitmap.close();
  }
}

// Respaldo para navegadores sin createImageBitmap (o que fallan al decodificar
// con él). Usa un object URL — no FileReader.readAsDataURL — para no duplicar
// el archivo ORIGINAL completo como un string Base64 en memoria solo para
// decodificarlo.
function resizeImageViaImageElement(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Imagen inválida"));
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl); // ya decodificada: el archivo original ya no hace falta
      resolve(drawResized(img, maxDim, quality));
    };
    img.src = objectUrl;
  });
}

// Intenta procesar la foto a UN tamaño: primero con createImageBitmap (más
// liviano), con el <img>+object URL como respaldo si falla o no está
// disponible (formato raro, navegador viejo, etc.) — mismo tamaño en ambos.
async function resizeImageAtSize(file, maxDim, quality) {
  if (typeof createImageBitmap === "function") {
    try {
      return await resizeImageViaBitmap(file, maxDim, quality);
    } catch {
      // cae al respaldo de abajo con el MISMO tamaño antes de probar uno más chico
    }
  }
  return resizeImageViaImageElement(file, maxDim, quality);
}

// Redimensiona la imagen capturada a un máximo de `maxDim` px (lado mayor) y
// la comprime a WebP (25-35% más liviano que JPEG a la misma calidad visual).
// Reduce el peso antes de guardarla/enviarla — menos datos móviles del
// promotor y menos espacio en Postgres (donde queda tal cual, en Base64).
//
// Si el tamaño pedido sigue siendo demasiado para el teléfono (equipos muy
// limitados, el "memoria insuficiente" que reportan los últimos rezagados),
// reintenta con tamaños cada vez más chicos antes de rendirse — más vale una
// foto más chica que ningún check-in.
export async function resizeImage(file, maxDim = 1024, quality = 0.7) {
  const sizes = [...new Set([maxDim, 640, 400].filter((d) => d <= maxDim))];
  for (const size of sizes) {
    try {
      return await resizeImageAtSize(file, size, quality);
    } catch {
      // intenta con el siguiente tamaño, más chico
    }
  }
  throw new Error("No se pudo procesar la foto — puede ser falta de memoria en el teléfono. Cierra otras apps (o libera espacio: Ajustes > Apps > Chrome > Almacenamiento > Borrar caché) e intenta de nuevo.");
}
