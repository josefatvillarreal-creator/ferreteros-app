// Base SQLite temporal para pruebas de integración (una por archivo de prueba:
// node --test corre cada archivo en su propio proceso). Debe llamarse ANTES de
// importar cualquier módulo de src/ que cree el cliente Prisma.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "ferreteros-test-"));
  const url = "file:" + join(dir, "test.db").split("\\").join("/");
  process.env.DATABASE_URL = url;
  const script = fileURLToPath(new URL("../scripts/prisma-local.mjs", import.meta.url));
  const res = spawnSync(process.execPath, [script, "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error("No se pudo crear la BD de prueba:\n" + res.stdout + res.stderr);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
