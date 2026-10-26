import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../support/testDb.js";

const testDb = setupTestDb();
const { prisma } = await import("../src/prisma.js");
const db = await import("../src/db.js");

before(async () => {
  await prisma.cliente.create({ data: { id: "c1", nombre: "Ferretería Demo" } });
  await prisma.sucursal.create({
    data: { id: "1001", clienteId: "c1", name: "Centro", address: "", lat: 19.7, lng: -101.1, estado: "Michoacán" },
  });
  await prisma.producto.createMany({
    data: [
      { id: "rollo", nombre: "Rollo", equivalencia: 1, precio: 850, orden: 0 },
      { id: "cubeta", nombre: "Cubeta", equivalencia: 0.6, precio: 1200, orden: 1 },
    ],
  });
  await prisma.promoter.create({ data: { id: "p1", name: "Promotor Uno", supervisor: "Sup Uno", password: "x" } });
  await prisma.promoter.create({ data: { id: "p2", name: "Promotor Dos", supervisor: "Otro", password: "x" } });
  await db.submitVisitReport("p1", "1001", { status: "checked-in", checkInTime: new Date().toISOString() });
  await db.submitVisitReport("p1", "1001", { status: "checked-out", checkOutTime: new Date().toISOString() }, [
    { productoId: "rollo", cantidad: 2 },
    { productoId: "cubeta", cantidad: 5 },
  ]);
});

after(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

test("getManagerSummary agrega por producto, cliente, meta semanal y plantilla", async () => {
  const s = await db.getManagerSummary("today");
  assert.deepEqual(s.totals.byProduct, { rollo: 2, cubeta: 5 });
  assert.equal(s.totals.units, 5);
  assert.equal(s.totals.money, 2 * 850 + 5 * 1200);
  assert.deepEqual(s.products.map((p) => p.id), ["rollo", "cubeta"]);
  assert.equal(s.byCliente[0].cliente, "Ferretería Demo");
  assert.deepEqual(s.promoters[0].goal, { target: 30, achieved: 5, reached: false });
  assert.equal(s.totals.rosterTotal, 2);
});

test("getSupervisorSummary solo incluye a los promotores de ese supervisor", async () => {
  const mine = await db.getSupervisorSummary("sup uno", "today");
  assert.equal(mine.totals.promoters, 1);
  assert.equal(mine.totals.rosterTotal, 1);
  const other = await db.getSupervisorSummary("otro", "today");
  assert.equal(other.totals.promoters, 0);
});

test("getPromoterHistoryPage trae sucursal, cliente, items y unidades por visita", async () => {
  const page = await db.getPromoterHistoryPage("p1");
  const v = page.days[0].visits[0];
  assert.equal(v.sucursalName, "Centro");
  assert.equal(v.clienteNombre, "Ferretería Demo");
  assert.equal(v.units, 5);
  assert.equal(v.items.length, 2);
  assert.equal(v.items.find((i) => i.productoId === "rollo").nombre, "Rollo");
});
