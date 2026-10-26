import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { findDevUser, listDevSupervisors } from "../src/devUsers.js";

const env = (over = {}) => ({ NODE_ENV: "development", DEV_USERS: "admin:admin:Admin Demo:demo1234;sup:supervisor:Supervisor Demo:clave1", ...over });

test("findDevUser devuelve el usuario con la contraseña hasheada con bcrypt", async () => {
  const u = await findDevUser("admin", env());
  assert.equal(u.id, "admin");
  assert.equal(u.name, "Admin Demo");
  assert.equal(u.role, "admin");
  assert.notEqual(u.password, "demo1234");
  assert.equal(await bcrypt.compare("demo1234", u.password), true);
});

test("findDevUser devuelve null para un id desconocido", async () => {
  assert.equal(await findDevUser("nadie", env()), null);
});

test("findDevUser no funciona en producción aunque DEV_USERS exista", async () => {
  assert.equal(await findDevUser("admin", env({ NODE_ENV: "production" })), null);
});

test("DEV_USERS vacío o malformado devuelve null sin lanzar", async () => {
  assert.equal(await findDevUser("admin", env({ DEV_USERS: "" })), null);
  assert.equal(await findDevUser("x", env({ DEV_USERS: "x" })), null);
  assert.equal(await findDevUser("x", env({ DEV_USERS: undefined })), null);
});

test("un rol desconocido cae a gerente", async () => {
  const u = await findDevUser("raro", env({ DEV_USERS: "raro:jefe:Raro:pw" }));
  assert.equal(u.role, "gerente");
});

test("listDevSupervisors devuelve solo los supervisores", async () => {
  const sups = await listDevSupervisors(env());
  assert.deepEqual(sups.map((s) => s.id), ["sup"]);
  assert.equal(await listDevSupervisors(env({ NODE_ENV: "production" })).then((l) => l.length), 0);
});
