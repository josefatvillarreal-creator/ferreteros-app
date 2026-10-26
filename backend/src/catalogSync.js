// ---------------------------------------------------------------------------
// Sincronización del catálogo (clientes, productos y sucursales) desde el Sheet.
// ---------------------------------------------------------------------------
// Se activa con CATALOG_SOURCE=sheet. Lee las pestañas Clientes, Productos y
// Sucursales, las parsea con catalogParsers.js (una fila inválida se omite y se
// reporta, no rompe la carga) y hace upsert en la base local: el Sheet es la
// fuente de verdad y las visitas referencian sucursales/productos por relación.
// Cacheado por TTL para no llamar a la API en cada consulta. Es best-effort:
// ante un error registra y conserva lo ya sincronizado.
import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { prisma } from "./prisma.js";
import { parseClientes, parseProductos, parseSucursales } from "./catalogParsers.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS ?? 5 * 60 * 1000);

// Upsert del catálogo a partir de las filas de cada pestaña. Orden: Clientes →
// Productos → Sucursales (estas se validan contra los clientes de la BD, así
// una pestaña Clientes caída no invalida las sucursales ya conocidas).
// Devuelve cuántas filas se cargaron por pestaña y las omitidas con su motivo;
// el error de una pestaña (p. ej. sin encabezado) se reporta con row 0.
export async function syncCatalog(tabs, db = prisma) {
  const result = { clientes: 0, productos: 0, sucursales: 0, skipped: [] };
  const run = async (tab, key, parse, upsert) => {
    let parsed;
    try {
      parsed = parse();
    } catch (e) {
      result.skipped.push({ tab, row: 0, reason: e.message });
      return;
    }
    for (const it of parsed.items) await upsert(it);
    result[key] = parsed.items.length;
    for (const s of parsed.skipped) result.skipped.push({ tab, ...s });
  };

  await run("Clientes", "clientes", () => parseClientes(tabs.clientes), (c) =>
    db.cliente.upsert({ where: { id: c.id }, update: c, create: c })
  );
  await run("Productos", "productos", () => parseProductos(tabs.productos), (p) =>
    db.producto.upsert({ where: { id: p.id }, update: p, create: p })
  );
  const clienteIds = new Set((await db.cliente.findMany({ select: { id: true } })).map((c) => c.id));
  await run("Sucursales", "sucursales", () => parseSucursales(tabs.sucursales, clienteIds), (s) =>
    db.sucursal.upsert({ where: { id: s.id }, update: s, create: s })
  );
  return result;
}

let clientPromise = null;
let lastSync = 0;
let inFlight = null;

function loadCredentials() {
  if (config.sheets.json) return JSON.parse(config.sheets.json);
  if (config.sheets.keyFile) {
    if (!existsSync(config.sheets.keyFile)) throw new Error(`No se encontró ${config.sheets.keyFile}`);
    return JSON.parse(readFileSync(config.sheets.keyFile, "utf8"));
  }
  throw new Error("Sin credenciales de Service Account para leer el catálogo del Sheet.");
}

function getClient() {
  if (!clientPromise) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    clientPromise = auth.getClient().then((c) => google.sheets({ version: "v4", auth: c }));
  }
  return clientPromise;
}

// Una pestaña ausente o ilegible se trata como vacía (queda reportada por
// syncCatalog) en lugar de abortar toda la sincronización.
async function readTab(sheets, tab) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${tab}!A1:Z3000`,
    });
    return res.data.values ?? [];
  } catch (e) {
    console.warn(`[catalogSync] No se pudo leer la pestaña "${tab}":`, e.message);
    return [];
  }
}

export async function ensureCatalogSynced() {
  if (Date.now() - lastSync < TTL_MS) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const sheets = await getClient();
      const [clientes, productos, sucursales] = await Promise.all([
        readTab(sheets, config.sheets.clientesTab),
        readTab(sheets, config.sheets.productosTab),
        readTab(sheets, config.sheets.sucursalesTab),
      ]);
      const r = await syncCatalog({ clientes, productos, sucursales });
      lastSync = Date.now();
      console.log(`[catalogSync] Sincronizados ${r.clientes} clientes, ${r.productos} productos, ${r.sucursales} sucursales.`);
      if (r.skipped.length) {
        console.warn(`[catalogSync] ${r.skipped.length} fila(s) omitida(s):`);
        for (const s of r.skipped) console.warn(`  - ${s.tab} fila ${s.row}: ${s.reason}`);
      }
    } catch (e) {
      console.error("[catalogSync] No se pudo sincronizar el catálogo:", e.message);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
