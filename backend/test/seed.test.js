import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setupTestDb } from "../support/testDb.js";

const testDb = setupTestDb();
const seedScript = fileURLToPath(new URL("../prisma/seed.js", import.meta.url));
const dirs = [];
after(() => { testDb.cleanup(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function runSeed(seedDir) {
  return spawnSync(process.execPath, [seedScript], {
    env: { ...process.env, SEED_DIR: seedDir, SEED_FORCE: "true" },
    encoding: "utf8",
  });
}

test("el seed no falla (código 0) cuando faltan los CSV del catálogo", () => {
  const dir = mkdtempSync(join(tmpdir(), "ferreteros-seed-"));
  dirs.push(dir);
  const r = runSeed(dir); // carpeta vacía: no hay ningún CSV
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /Seed OK: 0 promotores/);
});

test("el seed carga el catálogo disponible aunque otro CSV falte o venga sin encabezado", () => {
  const dir = mkdtempSync(join(tmpdir(), "ferreteros-seed-"));
  dirs.push(dir);
  writeFileSync(join(dir, "Clientes.csv"), "ID,Cliente,Estado\nc1,Cliente Uno,Jalisco\n");
  writeFileSync(join(dir, "Productos.csv"), "basura sin encabezado\n");
  const r = runSeed(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 clientes, 0 sucursales, 0 productos/);
});
