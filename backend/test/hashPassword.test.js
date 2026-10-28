import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const script = fileURLToPath(new URL("../scripts/hash-password.mjs", import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });

test("imprime la fila de la pestaña Usuarios con hash bcrypt de la contraseña (separada por tabuladores)", async () => {
  const r = run(["admin", "admin", "Administrador Ferreteros"], { PASSWORD: "Clave-de-prueba-1" });
  assert.equal(r.status, 0, r.stderr);
  const row = r.stdout.split("\n").find((l) => l.startsWith("admin\t"));
  assert.ok(row, r.stdout);
  const [id, nombre, rol, hash] = row.split("\t");
  assert.deepEqual([id, nombre, rol], ["admin", "Administrador Ferreteros", "admin"]);
  assert.equal(await bcrypt.compare("Clave-de-prueba-1", hash.trim()), true);
  assert.ok(!r.stdout.includes("Clave-de-prueba-1"), "la contraseña no debe imprimirse");
});

test("rechaza un rol desconocido y contraseñas cortas", () => {
  assert.notEqual(run(["x", "jefe", "X"], { PASSWORD: "Clave-de-prueba-1" }).status, 0);
  assert.notEqual(run(["x", "admin", "X"], { PASSWORD: "corta" }).status, 0);
});
