import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../support/testDb.js";

const testDb = setupTestDb();
const { prisma } = await import("../src/prisma.js");
const db = await import("../src/db.js");

before(async () => {
  await prisma.cliente.create({ data: { id: "c1", nombre: "Ferretería Demo" } });
  await prisma.sucursal.create({
    data: { id: "1001", clienteId: "c1", name: "Centro", address: "Madero 1", lat: 19.7008, lng: -101.1844 },
  });
  await prisma.producto.createMany({
    data: [
      { id: "rollo", nombre: "Rollo", equivalencia: 1, precio: 850, orden: 0 },
      { id: "cubeta", nombre: "Cubeta", equivalencia: 0.6, precio: 1200, orden: 1 },
      { id: "galon", nombre: "Galón", equivalencia: 0, precio: 350, orden: 2 },
    ],
  });
  await prisma.promoter.create({ data: { id: "p1", name: "Promotor Uno", password: "x" } });
});

after(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

const CHECK_IN = { status: "checked-in", checkInTime: new Date().toISOString(), checkInDistance: 5 };
const CHECK_OUT = { status: "checked-out", checkOutTime: new Date().toISOString(), checkOutDistance: 5 };

test("el check-in no crea items y el registro trae items: []", async () => {
  const rec = await db.submitVisitReport("p1", "1001", CHECK_IN);
  assert.equal(rec.status, "checked-in");
  assert.deepEqual(rec.items, []);
});

test("el check-out guarda los items y el registro del día los devuelve", async () => {
  const rec = await db.submitVisitReport("p1", "1001", CHECK_OUT, [
    { productoId: "rollo", cantidad: 3 },
    { productoId: "cubeta", cantidad: 5 },
  ]);
  assert.equal(rec.status, "checked-out");
  assert.deepEqual([...rec.items].sort((a, b) => a.productoId.localeCompare(b.productoId)), [
    { productoId: "cubeta", cantidad: 5 },
    { productoId: "rollo", cantidad: 3 },
  ]);
  const today = await db.fetchTodayVisits("p1");
  assert.equal(today["1001"].items.length, 2);
});

test("un segundo submitVisitReport con otros items reemplaza los anteriores", async () => {
  const rec = await db.submitVisitReport("p1", "1001", CHECK_OUT, [{ productoId: "rollo", cantidad: 3 }, { productoId: "cubeta", cantidad: 5 }]);
  assert.equal(rec.items.length, 2);
  const again = await db.submitVisitReport("p1", "1001", CHECK_OUT, [{ productoId: "rollo", cantidad: 1 }]);
  assert.deepEqual(again.items, [{ productoId: "rollo", cantidad: 1 }]);
  assert.equal(await prisma.visitItem.count(), 1);
  // restaurar para las pruebas siguientes
  await db.submitVisitReport("p1", "1001", CHECK_OUT, [{ productoId: "rollo", cantidad: 3 }, { productoId: "cubeta", cantidad: 5 }]);
});

test("getMyGoalProgress: 3 rollos + 5 cubetas = 6 unidades de 30; el galón no cambia la meta", async () => {
  let g = await db.getMyGoalProgress("p1");
  assert.deepEqual(g, { target: 30, achieved: 6, reached: false });
  await db.submitVisitReport("p1", "1001", CHECK_OUT, [
    { productoId: "rollo", cantidad: 3 },
    { productoId: "cubeta", cantidad: 5 },
    { productoId: "galon", cantidad: 9 },
  ]);
  g = await db.getMyGoalProgress("p1");
  assert.equal(g.achieved, 6);
});

test("un producto desactivado después de la venta sigue sumando en la meta", async () => {
  await prisma.producto.update({ where: { id: "cubeta" }, data: { activo: false } });
  const g = await db.getMyGoalProgress("p1");
  assert.equal(g.achieved, 6);
  await prisma.producto.update({ where: { id: "cubeta" }, data: { activo: true } });
});

test("resolveCheckoutItems deja solo productos activos, con cantidades válidas", async () => {
  await prisma.producto.update({ where: { id: "galon" }, data: { activo: false } });
  const items = await db.resolveCheckoutItems([
    { productoId: "galon", cantidad: 2 },
    { productoId: "rollo", cantidad: -3 },
    { productoId: "cubeta", cantidad: "abc" },
    { productoId: "rollo", cantidad: 2.9 },
  ]);
  assert.deepEqual(items, [{ productoId: "rollo", cantidad: 2 }]);
  assert.deepEqual(await db.resolveCheckoutItems(undefined), []);
});
