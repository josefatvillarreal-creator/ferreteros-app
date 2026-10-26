// Semilla desde CSV (DEMO en prisma/seed-data; en producción, la carpeta SEED_DIR).
//  - Promotores.csv: ID, Nombre, Ubicación, Supervisor, Estado, Contraseña.
//    La contraseña se HASHEA con bcrypt; nunca se guarda/loguea en claro.
//  - Clientes.csv / Sucursales.csv / Productos.csv: mismo formato que las
//    pestañas del Sheet (se leen con los MISMOS parsers que la sincronización).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { parseCsv } from "../src/csvRows.js";
import { parseClientes, parseProductos, parseSucursales } from "../src/catalogParsers.js";

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

const seedDir = process.env.SEED_DIR
  ? process.env.SEED_DIR
  : fileURLToPath(new URL("./seed-data/", import.meta.url));

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Lee un CSV con la codificación correcta (UTF-8; si los bytes no son UTF-8
// válido, cae a Latin-1/Windows-1252, para no romper acentos).
function readRows(name) {
  const path = join(seedDir, name);
  if (!existsSync(path)) {
    console.warn(`AVISO: no se encontró ${path} — se omite.`);
    return [];
  }
  const buf = readFileSync(path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("latin1").decode(buf);
  }
  return parseCsv(text);
}

// Promotores: columnas por encabezado (id, nombre, ubicacion, supervisor, estado, contrasena).
function parsePromoters(rows) {
  const h = rows.findIndex((r) => r.map(norm).includes("id") && r.map(norm).includes("contrasena"));
  if (h === -1) return [];
  const cols = rows[h].map(norm);
  const at = (...names) => cols.findIndex((c) => names.includes(c));
  const [iId, iName, iLoc, iSup, iEstado, iPass] = [at("id"), at("nombre"), at("ubicacion"), at("supervisor"), at("estado"), at("contrasena")];
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const id = r[iId], name = r[iName], password = r[iPass];
    if (!id || !name || !password) continue;
    out.push({
      id, name, password,
      location: iLoc === -1 ? null : r[iLoc] || null,
      supervisor: iSup === -1 ? null : r[iSup] || null,
      estado: iEstado === -1 ? null : r[iEstado] || null,
    });
  }
  return out;
}

async function main() {
  // Optimización para la nube: si ya hay datos y no se fuerza, no re-sembramos
  // (evita re-hashear bcrypt en cada arranque en frío / reinicio).
  const already = await prisma.promoter.count().catch(() => 0);
  if (already > 0 && process.env.SEED_FORCE !== "true") {
    console.log(`Seed omitido: ya hay ${already} promotores (usa SEED_FORCE=true para forzar).`);
    return;
  }

  const skipped = [];

  const promoters = parsePromoters(readRows("Promotores.csv"));
  const seen = new Set();
  let promoterCount = 0;
  for (const p of promoters) {
    if (seen.has(p.id)) { skipped.push(`Promotores: ID duplicado ${p.id}`); continue; }
    seen.add(p.id);
    const { password, ...fields } = p;
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await prisma.promoter.upsert({
      where: { id: p.id },
      update: { ...fields, password: hash },
      create: { ...fields, password: hash },
    });
    promoterCount++;
  }

  const clientes = parseClientes(readRows("Clientes.csv"));
  for (const c of clientes.items) await prisma.cliente.upsert({ where: { id: c.id }, update: c, create: c });
  const productos = parseProductos(readRows("Productos.csv"));
  for (const p of productos.items) await prisma.producto.upsert({ where: { id: p.id }, update: p, create: p });
  const sucursales = parseSucursales(readRows("Sucursales.csv"), new Set(clientes.items.map((c) => c.id)));
  for (const s of sucursales.items) await prisma.sucursal.upsert({ where: { id: s.id }, update: s, create: s });

  for (const [tab, r] of [["Clientes", clientes], ["Productos", productos], ["Sucursales", sucursales]]) {
    for (const s of r.skipped) skipped.push(`${tab} fila ${s.row}: ${s.reason}`);
  }

  console.log(
    `Seed OK: ${promoterCount} promotores (bcrypt), ${clientes.items.length} clientes, ${sucursales.items.length} sucursales, ${productos.items.length} productos.`
  );
  if (skipped.length) console.warn(`AVISO: ${skipped.length} fila(s) omitida(s):\n - ${skipped.join("\n - ")}`);
}

main()
  .catch((e) => {
    console.error("Seed falló:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
