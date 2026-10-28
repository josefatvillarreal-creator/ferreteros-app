import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../support/testDb.js";

// Sin GOALS_ENABLED: la meta de ventas está desactivada (estado por defecto, "hasta nuevo aviso").
delete process.env.GOALS_ENABLED;
const testDb = setupTestDb();
const { prisma } = await import("../src/prisma.js");
const { config } = await import("../src/config.js");
const db = await import("../src/db.js");

before(async () => {
  await prisma.cliente.create({ data: { id: "c1", nombre: "Cliente" } });
  await prisma.sucursal.create({ data: { id: "1001", clienteId: "c1", name: "Centro", address: "", lat: 19.7, lng: -101.1 } });
  await prisma.producto.create({ data: { id: "rollo", nombre: "Rollo", equivalencia: 1, precio: 0, orden: 0 } });
  await prisma.promoter.create({ data: { id: "p1", name: "Uno", supervisor: "Sup", password: "x" } });
  await db.submitVisitReport("p1", "1001", { status: "checked-in", checkInTime: new Date().toISOString() });
  await db.submitVisitReport("p1", "1001", { status: "checked-out", checkOutTime: new Date().toISOString() }, [{ productoId: "rollo", cantidad: 40 }]);
});

after(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

test("por defecto la meta de ventas está desactivada", () => {
  assert.equal(config.goalsEnabled, false);
});

test("getMyGoalProgress devuelve null aunque haya ventas que superarían la meta", async () => {
  assert.equal(await db.getMyGoalProgress("p1"), null);
});

test("el resumen avisa goalsEnabled=false y no trae meta por promotor", async () => {
  const s = await db.getManagerSummary("today");
  assert.equal(s.goalsEnabled, false);
  assert.equal(s.promoters.length, 1);
  assert.equal(s.promoters[0].goal, null);
  assert.equal(s.totals.units, 40); // las ventas siguen contando: solo se oculta la meta
});

test("fijar una meta con la función desactivada lanza un error claro", async () => {
  await assert.rejects(() => db.setPromoterGoal("p1", 50, "Uno"), /desactivadas/);
});
