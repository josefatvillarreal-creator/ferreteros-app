// Semilla desde los CSV reales de Protexa.
//  - Promotores.csv (UTF-8, coma): id, nombre, ubicacion, supervisor, contraseña.
//    La contraseña se HASHEA con bcrypt; nunca se guarda/loguea en claro.
//  - Tiendas.csv (Latin-1/CP1252, punto y coma): num, nombre, lat, lng.
//    Catálogo GLOBAL de tiendas (la cercanía se resuelve en GET /api/sucursales).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

const promotersPath = process.env.SEED_CSV_PATH
  ? process.env.SEED_CSV_PATH
  : fileURLToPath(new URL("../../Promotores.csv", import.meta.url));
const storesPath = process.env.SEED_STORES_CSV_PATH
  ? process.env.SEED_STORES_CSV_PATH
  : fileURLToPath(new URL("../../Tiendas.csv", import.meta.url));

function slugify(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos combinados
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Lee un CSV con la codificación correcta (UTF-8; si los bytes no son UTF-8
// válido, cae a Latin-1/Windows-1252, para no romper acentos como "Revolución").
function readTextSmart(path) {
  const buf = readFileSync(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("latin1").decode(buf);
  }
}

// Detecta el separador (',' o ';') mirando la primera línea con contenido.
function detectDelim(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const semis = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semis > commas ? ";" : ",";
}

// --- Promotores (id, nombre, ubicacion, supervisor, contraseña) ------------
function parsePromoters(text) {
  const delim = detectDelim(text);
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(delim).map((c) => c.trim());
    const [id, name, location, supervisor, password] = cols;
    if (!id || !/^\d+$/.test(id)) continue; // salta encabezado / filas inválidas
    if (!name || !password) continue;
    rows.push({ id, name, location, supervisor, password });
  }
  return rows;
}

// --- Tiendas (num, nombre, lat, lng) ---------------------------------------
// Detección por CONTENIDO (no por posición): así funciona con ',' o ';', con o
// sin columna vacía inicial, con o sin encabezado, y con tiendas sin número.
function parseStores(text) {
  const delim = detectDelim(text);
  const numeric = (s) => /^-?\d+(\.\d+)?$/.test(s);
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(delim).map((c) => c.trim());
    // Coordenadas = valores numéricos dentro del rango geográfico (|v| <= 180).
    // Los números de tienda (4+ dígitos, > 180) quedan fuera automáticamente.
    const coords = cols.filter((c) => numeric(c) && Math.abs(Number(c)) <= 180).map(Number);
    if (coords.length < 2) continue; // encabezado o fila sin coordenadas → se salta
    const [lat, lng] = coords; // lat y lng vienen en ese orden
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) continue;
    const num = cols.find((c) => /^\d{3,}$/.test(c)); // número de tienda (entero de 3+ dígitos)
    const name = cols.find((c) => c && !numeric(c) && !/^(num.*|tienda|latitud|longitud)$/i.test(c));
    if (!name) continue;
    const id = num || slugify(name);
    rows.push({ id, name, address: num ? `Tienda #${num}` : name, lat, lng });
  }
  return rows;
}

async function main() {
  // Optimización para la nube: si ya hay datos y no se fuerza, no re-sembramos
  // (evita re-hashear bcrypt en cada arranque en frío / reinicio).
  const already = await prisma.promoter.count().catch(() => 0);
  if (already > 0 && process.env.SEED_FORCE !== "true") {
    console.log(`Seed omitido: ya hay ${already} promotores (usa SEED_FORCE=true para forzar).`);
    return;
  }

  // Promotores (tolerante a archivo ausente, p.ej. antes de subir el Secret File).
  const promoters = existsSync(promotersPath)
    ? parsePromoters(readTextSmart(promotersPath))
    : [];
  if (!promoters.length) console.warn(`AVISO: no se encontró/leyó ${promotersPath} — 0 promotores sembrados.`);
  const seen = new Set();
  const dupPromoters = [];
  let promoterCount = 0;
  for (const r of promoters) {
    if (seen.has(r.id)) {
      dupPromoters.push(r.id);
      continue;
    }
    seen.add(r.id);
    const passwordHash = await bcrypt.hash(r.password, BCRYPT_ROUNDS);
    await prisma.promoter.upsert({
      where: { id: r.id },
      update: { name: r.name, location: r.location, supervisor: r.supervisor, password: passwordHash },
      create: { id: r.id, name: r.name, location: r.location, supervisor: r.supervisor, password: passwordHash },
    });
    promoterCount++;
  }

  // Tiendas (catálogo global). Tolerante a archivo ausente.
  const stores = existsSync(storesPath) ? parseStores(readTextSmart(storesPath)) : [];
  if (!stores.length) console.warn(`AVISO: no se encontró/leyó ${storesPath} — 0 tiendas sembradas.`);
  const seenStores = new Set();
  const dupStores = [];
  let storeCount = 0;
  for (const s of stores) {
    if (seenStores.has(s.id)) {
      dupStores.push(s.id);
      continue;
    }
    seenStores.add(s.id);
    await prisma.store.upsert({ where: { id: s.id }, update: s, create: s });
    storeCount++;
  }

  console.log(
    `Seed OK: ${promoterCount} promotores (bcrypt), ${storeCount} tiendas en el catálogo global.`
  );
  if (dupPromoters.length)
    console.warn(`AVISO: IDs de promotor duplicados (se conservó el primero): ${[...new Set(dupPromoters)].join(", ")}`);
  if (dupStores.length)
    console.warn(`AVISO: números de tienda duplicados (se conservó el primero): ${[...new Set(dupStores)].join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
