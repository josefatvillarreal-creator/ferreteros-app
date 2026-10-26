// ---------------------------------------------------------------------------
// Sincronización del catálogo de tiendas desde Google Sheets (pestaña Tiendas).
// ---------------------------------------------------------------------------
// Se activa con STORES_SOURCE=sheet. Lee la pestaña (por defecto "Tiendas"),
// detecta las columnas por su encabezado (Num / Tienda / Latitud / Longitud) y
// hace upsert de cada tienda en la base local. Así el Sheet es la fuente de
// verdad y el check-in (que referencia tiendas por relación) sigue funcionando.
// Cacheado por TTL para no llamar a la API en cada consulta.
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { prisma } from "./prisma.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const TTL_MS = Number(process.env.STORES_CACHE_TTL_MS ?? 5 * 60 * 1000);

let clientPromise = null;
let lastSync = 0;
let inFlight = null;

function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para leer las tiendas del Sheet.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

function slugify(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Parsea las filas de la pestaña Tiendas detectando columnas por encabezado.
function parseTiendas(rows) {
  let header = -1, numC = -1, nameC = -1, latC = -1, lngC = -1, estadoC = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((c) => String(c ?? "").trim());
    const lat = cells.findIndex((c) => /^lat|latitud/i.test(c));
    const lng = cells.findIndex((c) => /^lon|lng|longitud/i.test(c));
    if (lat !== -1 && lng !== -1) {
      header = r; latC = lat; lngC = lng;
      numC = cells.findIndex((c) => /n[uú]m/i.test(c));
      nameC = cells.findIndex((c, i) => i !== numC && /tienda|nombre|sucursal/i.test(c));
      // Columna ESTADO (opcional): la usa el filtro "por estado" del gerente.
      estadoC = cells.findIndex((c) => /^estado$|entidad/i.test(c));
      break;
    }
  }
  if (header === -1) throw new Error(`No se encontró el encabezado (Latitud/Longitud) en la pestaña "${config.sheets.tiendasTab}".`);

  const out = [];
  for (let r = header + 1; r < rows.length; r++) {
    const cells = rows[r] || [];
    const lat = Number(String(cells[latC] ?? "").trim());
    const lng = Number(String(cells[lngC] ?? "").trim());
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) continue; // fila inválida/vacía
    const num = numC !== -1 ? String(cells[numC] ?? "").trim() : "";
    const name = (nameC !== -1 ? String(cells[nameC] ?? "").trim() : "") || `Tienda ${num || ""}`.trim();
    const id = num || slugify(name);
    if (!id) continue;
    const estado = estadoC !== -1 ? String(cells[estadoC] ?? "").trim() || null : null;
    out.push({ id, name, address: num ? `Tienda #${num}` : name, lat, lng, estado });
  }
  return out;
}

// Sincroniza (upsert) las tiendas del Sheet a la base local. Best-effort:
// registra el error y no lanza, para no tumbar las consultas de tiendas.
export async function ensureStoresSynced() {
  if (Date.now() - lastSync < TTL_MS) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const sheets = await getClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: config.sheets.spreadsheetId,
        range: `${config.sheets.tiendasTab}!A1:Z3000`,
      });
      const stores = parseTiendas(res.data.values ?? []);
      for (const s of stores) {
        await prisma.store.upsert({ where: { id: s.id }, update: s, create: s });
      }
      lastSync = Date.now();
      console.log(`[storesSheet] Sincronizadas ${stores.length} tiendas desde el Sheet.`);
    } catch (e) {
      console.error("[storesSheet] No se pudo sincronizar tiendas:", e.message);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
