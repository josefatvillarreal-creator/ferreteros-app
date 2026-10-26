// ---------------------------------------------------------------------------
// Diagnóstico del dispositivo y de la red.
// ---------------------------------------------------------------------------
// Mide qué tan holgado anda el teléfono (memoria, núcleos, red, historial de
// fotos recientes) y, con eso, recomienda cómo capturar las fotos: resolución,
// calidad y parámetros de la cámara. Es la base para adaptar la app a gama
// baja y para entender por qué falla algo en campo.
//
// Importante: casi todas las señales vienen de APIs que NO existen en todos los
// navegadores (navigator.deviceMemory y navigator.connection solo en Chrome/
// Android; performance.memory solo en Chromium; en iPhone/Safari casi nada).
// Cada señal ausente simplemente no suma ni resta: nunca se inventa un valor.
// Todo se queda en el dispositivo; solo se manda al servidor si el promotor
// envía un reporte (se agrega una línea corta al texto, ver formatForReport).

const METRICS_KEY = "device_photo_metrics_v1";
const MAX_METRICS = 20;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// --- Señales -----------------------------------------------------------------

export function readSnapshot() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection || null;
  const perfMem = typeof performance !== "undefined" ? performance.memory : null;
  const ua = nav.userAgent || "";
  const android = /Android (\d+)/.exec(ua);
  const ios = /OS (\d+)[._]\d+ like Mac OS X/.exec(ua);
  return {
    memoryGB: num(nav.deviceMemory), // redondeado por el navegador: 0.25, 0.5, 1, 2, 4, 8
    cores: num(nav.hardwareConcurrency),
    online: typeof nav.onLine === "boolean" ? nav.onLine : null,
    netType: conn?.effectiveType || null, // "slow-2g" | "2g" | "3g" | "4g"
    downlinkMbps: num(conn?.downlink),
    rttMs: num(conn?.rtt),
    saveData: conn ? Boolean(conn.saveData) : null,
    heapLimitMB: perfMem ? Math.round(perfMem.jsHeapSizeLimit / 1048576) : null,
    heapUsedMB: perfMem ? Math.round(perfMem.usedJSHeapSize / 1048576) : null,
    os: android ? `Android ${android[1]}` : ios ? `iOS ${ios[1]}` : null,
    osMajor: android ? Number(android[1]) : ios ? Number(ios[1]) : null,
    isAndroid: Boolean(android),
    screen: typeof window !== "undefined" && window.screen
      ? `${Math.round(window.screen.width * (window.devicePixelRatio || 1))}x${Math.round(window.screen.height * (window.devicePixelRatio || 1))}`
      : null,
    standalone: typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(display-mode: standalone)").matches
      : null,
    storageFreeMB: null, // se completa en getDeviceProfile (es asíncrono)
  };
}

// --- Historial de fotos (últimas 20, en el propio dispositivo) -----------------

export function readPhotoMetrics() {
  try {
    const raw = localStorage.getItem(METRICS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// m: { kind: "visit"|"competition", via: "camera"|"file", ok, ms, bytes?, w?, h?, error? }
export function recordPhotoMetric(m) {
  try {
    const list = readPhotoMetrics();
    list.push({ t: Date.now(), ...m, error: m.error ? String(m.error).slice(0, 80) : undefined });
    localStorage.setItem(METRICS_KEY, JSON.stringify(list.slice(-MAX_METRICS)));
  } catch { /* sin storage: el diagnóstico simplemente no guarda historial */ }
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function summarizeMetrics(metrics = readPhotoMetrics()) {
  const recent = metrics.slice(-10);
  const ok = recent.filter((m) => m.ok);
  const failed = recent.length - ok.length;
  return {
    total: recent.length,
    ok: ok.length,
    failed,
    medianMs: median(ok.map((m) => m.ms).filter((v) => typeof v === "number")),
    medianKB: median(ok.map((m) => m.bytes).filter((v) => typeof v === "number").map((b) => Math.round(b / 1024))),
  };
}

// --- Clasificación -------------------------------------------------------------

// Puntos: negativo = limitado. Devuelve el nivel, la red y las razones (para
// mostrarlas en el panel de diagnóstico y en los reportes).
export function classify(snapshot, metrics = readPhotoMetrics()) {
  const reasons = [];
  let points = 0;
  const add = (p, why) => { points += p; if (why) reasons.push(why); };

  if (snapshot.memoryGB != null) {
    if (snapshot.memoryGB <= 1) add(-3, `RAM ${snapshot.memoryGB} GB`);
    else if (snapshot.memoryGB <= 2) add(-2, `RAM ${snapshot.memoryGB} GB`);
    else if (snapshot.memoryGB <= 4) add(-1, `RAM ${snapshot.memoryGB} GB`);
    else if (snapshot.memoryGB >= 8) add(1);
  }
  if (snapshot.cores != null) {
    if (snapshot.cores <= 2) add(-2, `${snapshot.cores} núcleos`);
    else if (snapshot.cores <= 4) add(-1, `${snapshot.cores} núcleos`);
    else if (snapshot.cores >= 8) add(1);
  }
  if (snapshot.heapLimitMB != null) {
    if (snapshot.heapLimitMB <= 256) add(-2, `límite de memoria del navegador ${snapshot.heapLimitMB} MB`);
    else if (snapshot.heapLimitMB <= 512) add(-1, `límite de memoria del navegador ${snapshot.heapLimitMB} MB`);
  }
  if (snapshot.osMajor != null && snapshot.isAndroid && snapshot.osMajor <= 8) add(-1, snapshot.os);
  if (snapshot.storageFreeMB != null && snapshot.storageFreeMB < 150) add(-1, `poco espacio libre (${snapshot.storageFreeMB} MB)`);

  // Lo que ya pasó en este teléfono pesa más que cualquier especificación.
  const hist = summarizeMetrics(metrics);
  if (hist.failed >= 2) add(-3, `${hist.failed} fotos fallidas de las últimas ${hist.total}`);
  if (hist.medianMs != null && hist.medianMs > 2500) add(-1, `fotos lentas (mediana ${Math.round(hist.medianMs)} ms)`);

  const tier = points <= -2 ? "low" : points >= 1 ? "high" : "mid";

  let network = "unknown";
  if (snapshot.online === false) network = "offline";
  else if (snapshot.netType || snapshot.downlinkMbps != null || snapshot.rttMs != null || snapshot.saveData) {
    const slow = ["slow-2g", "2g", "3g"].includes(snapshot.netType)
      || snapshot.saveData === true
      || (snapshot.downlinkMbps != null && snapshot.downlinkMbps < 1)
      || (snapshot.rttMs != null && snapshot.rttMs > 600);
    network = slow ? "poor" : "good";
  }
  return { tier, network, points, reasons };
}

// --- Recomendación -------------------------------------------------------------

// Resolución máxima (lado mayor, px) y calidad WebP/JPEG por nivel. El nivel
// "mid" conserva los valores que la app ya usaba (1024/0.7 visita, 900/0.6
// competencia), así que un teléfono normal no nota ningún cambio.
const TABLE = {
  visit: {
    low:  { maxDim: 800,  quality: 0.6 },
    mid:  { maxDim: 1024, quality: 0.7 },
    high: { maxDim: 1280, quality: 0.75 },
  },
  competition: {
    low:  { maxDim: 700,  quality: 0.5 },
    mid:  { maxDim: 900,  quality: 0.6 },
    high: { maxDim: 1100, quality: 0.65 },
  },
};

const VIDEO = {
  low:  { width: 640,  height: 480, frameRate: 15 },
  mid:  { width: 960,  height: 720, frameRate: 24 },
  high: { width: 1280, height: 720, frameRate: 30 },
};

export function recommend(classification, kind = "visit") {
  const { tier, network } = classification;
  const base = TABLE[kind]?.[tier] ?? TABLE.visit.mid;
  let { maxDim, quality } = base;
  // Red mala: fotos más livianas para que la subida no se quede colgada.
  if (network === "poor") {
    maxDim = Math.min(maxDim, kind === "visit" ? 800 : 700);
    quality = Math.max(0.5, +(quality - 0.05).toFixed(2));
  }
  return { tier, network, maxDim, quality, video: VIDEO[tier] ?? VIDEO.mid };
}

// Lectura rápida y síncrona (sin esperar la estimación de almacenamiento): es
// la que usa la cámara y el procesado de archivos en el momento de la foto.
export function currentRecommendation(kind = "visit") {
  return recommend(classify(readSnapshot()), kind);
}

// --- Perfil completo (para el panel de diagnóstico) -----------------------------

export async function getDeviceProfile() {
  const snapshot = readSnapshot();
  try {
    if (navigator.storage?.estimate) {
      const { quota, usage } = await navigator.storage.estimate();
      if (num(quota) != null && num(usage) != null) {
        snapshot.storageFreeMB = Math.max(0, Math.round((quota - usage) / 1048576));
      }
    }
  } catch { /* el navegador no da la estimación */ }
  const metrics = readPhotoMetrics();
  const classification = classify(snapshot, metrics);
  return {
    snapshot,
    metrics: summarizeMetrics(metrics),
    classification,
    visit: recommend(classification, "visit"),
    competition: recommend(classification, "competition"),
  };
}

export const TIER_LABEL = { low: "Gama baja", mid: "Gama media", high: "Gama alta" };
export const NETWORK_LABEL = { good: "Buena", poor: "Lenta", offline: "Sin conexión", unknown: "Sin datos" };

// Línea corta para pegar al final de un reporte (ticket de soporte).
export function formatForReport(profile) {
  const { snapshot: s, classification: c, metrics: m } = profile;
  const parts = [
    `${TIER_LABEL[c.tier]}`,
    s.os,
    s.memoryGB != null ? `RAM ${s.memoryGB} GB` : null,
    s.cores != null ? `${s.cores} núcleos` : null,
    `red ${NETWORK_LABEL[c.network].toLowerCase()}${s.netType ? ` (${s.netType})` : ""}`,
    s.saveData ? "ahorro de datos activo" : null,
    s.storageFreeMB != null ? `${s.storageFreeMB} MB libres` : null,
    m.total ? `fotos recientes: ${m.ok} ok / ${m.failed} fallidas${m.medianMs != null ? `, mediana ${Math.round(m.medianMs)} ms` : ""}` : null,
  ].filter(Boolean);
  return `[Diagnóstico del dispositivo] ${parts.join(" · ")}`;
}
