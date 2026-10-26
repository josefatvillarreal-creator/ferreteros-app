import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeVisitRows } from "../src/managerSummary.js";

const products = [
  { id: "rollo", nombre: "Rollo", unidad: "rollo", equivalencia: 1, precio: 850, activo: true, orden: 0 },
  { id: "cubeta", nombre: "Cubeta", unidad: "cubeta", equivalencia: 0.6, precio: 1200, activo: true, orden: 1 },
  { id: "galon", nombre: "Galón", unidad: "galón", equivalencia: 0, precio: 350, activo: true, orden: 2 },
  { id: "viejo", nombre: "Viejo", unidad: "pza", equivalencia: 1, precio: 10, activo: false, orden: 3 },
  { id: "retirado", nombre: "Retirado", unidad: "pza", equivalencia: 1, precio: 5, activo: false, orden: 4 },
];
const range = { from: "2026-10-26", to: "2026-10-26" };

const suc = (id, clienteId, nombre, estado = "Michoacán") => ({
  name: `Sucursal ${id}`, estado, lat: 19.7, lng: -101.1, clienteId, cliente: { nombre },
});
const visit = (over) => ({
  promoterId: "p1", promoter: { name: "Uno", supervisor: "Sup", estado: "Michoacán" },
  sucursalId: "1001", sucursal: suc("1001", "c1", "Cliente Uno"),
  status: "checked-out", items: [], day: "2026-10-26",
  checkInTime: "2026-10-26T15:00:00Z", checkOutTime: "2026-10-26T16:00:00Z", ...over,
});

const rows = [
  visit({ items: [{ productoId: "rollo", cantidad: 3 }, { productoId: "cubeta", cantidad: 5 }] }),
  visit({ sucursalId: "1002", sucursal: suc("1002", "c1", "Cliente Uno"), items: [{ productoId: "galon", cantidad: 2 }] }),
  visit({
    promoterId: "p2", promoter: { name: "Dos", supervisor: "Sup", estado: null },
    sucursalId: "1003", sucursal: suc("1003", "c2", "Cliente Dos", "Jalisco"),
    status: "checked-in", items: [], checkOutTime: null, checkInTime: "2026-10-26T17:00:00Z",
  }),
];

test("totales por producto, piezas, unidades y dinero coinciden con la suma manual", () => {
  const s = summarizeVisitRows(rows, products, range);
  assert.deepEqual(s.totals.byProduct, { rollo: 3, cubeta: 5, galon: 2 });
  assert.equal(s.totals.pieces, 10);
  assert.equal(s.totals.units, 6);
  assert.equal(s.totals.money, 3 * 850 + 5 * 1200 + 2 * 350);
  assert.equal(s.totals.promoters, 2);
  assert.equal(s.totals.sucursalesVisited, 3);
  assert.deepEqual(s.range, range);
});

test("byCliente agrupa por cliente con sucursales distintas y visitas", () => {
  const s = summarizeVisitRows(rows, products, range);
  const c1 = s.byCliente.find((c) => c.clienteId === "c1");
  assert.deepEqual(
    { cliente: c1.cliente, sucursales: c1.sucursales, visits: c1.visits, pieces: c1.pieces, units: c1.units, money: c1.money },
    { cliente: "Cliente Uno", sucursales: 2, visits: 2, pieces: 10, units: 6, money: 3 * 850 + 5 * 1200 + 700 }
  );
  const c2 = s.byCliente.find((c) => c.clienteId === "c2");
  assert.deepEqual({ sucursales: c2.sucursales, visits: c2.visits, pieces: c2.pieces }, { sucursales: 1, visits: 1, pieces: 0 });
  assert.equal(s.byCliente[0].clienteId, "c1"); // más dinero primero
});

test("byEstado agrupa por el estado del promotor y usa 'Sin estado' si falta", () => {
  const s = summarizeVisitRows(rows, products, range);
  const mich = s.byEstado.find((e) => e.estado === "Michoacán");
  assert.deepEqual({ promoters: mich.promoters, units: mich.units }, { promoters: 1, units: 6 });
  assert.equal(s.byEstado.find((e) => e.estado === "Sin estado").promoters, 1);
});

test("products incluye activos y los inactivos con ventas en el rango, no los inactivos sin ventas", () => {
  const withViejo = [...rows, visit({ promoterId: "p3", promoter: { name: "Tres" }, items: [{ productoId: "viejo", cantidad: 4 }] })];
  const s = summarizeVisitRows(withViejo, products, range);
  assert.deepEqual(s.products.map((p) => p.id), ["rollo", "cubeta", "galon", "viejo"]);
  assert.equal(s.products[0].precio, 850);
  assert.equal(s.totals.byProduct.viejo, 4);
  assert.equal(s.totals.units, 10); // el producto desactivado sigue contando
  const sinViejo = summarizeVisitRows(rows, products, range);
  assert.deepEqual(sinViejo.products.map((p) => p.id), ["rollo", "cubeta", "galon"]);
});

test("promotor con visita abierta es 'in'; sin piezas cuenta en withoutSales", () => {
  const s = summarizeVisitRows(rows, products, range);
  const p2 = s.promoters.find((p) => p.id === "p2");
  assert.equal(p2.status, "in");
  assert.equal(s.promoters.find((p) => p.id === "p1").status, "done");
  assert.equal(s.totals.checkedIn, 1);
  assert.equal(s.totals.withoutSales, 1);
  assert.equal(p2.lat, 19.7);
});

test("cada visita del promotor trae cliente, items, unidades y dinero", () => {
  const s = summarizeVisitRows(rows, products, range);
  const v = s.promoters.find((p) => p.id === "p1").visits.find((x) => x.sucursalId === "1001");
  assert.equal(v.clienteNombre, "Cliente Uno");
  assert.equal(v.sucursalName, "Sucursal 1001");
  assert.equal(v.units, 3 + 5 * 0.6);
  assert.equal(v.money, 3 * 850 + 5 * 1200);
  assert.deepEqual(v.items, [{ productoId: "rollo", cantidad: 3 }, { productoId: "cubeta", cantidad: 5 }]);
});

test("ordena promotores por dinero y luego por unidades, descendente", () => {
  const s = summarizeVisitRows(rows, products, range);
  assert.deepEqual(s.promoters.map((p) => p.id), ["p1", "p2"]);
});

test("sin filas devuelve totales en 0 y listas vacías sin lanzar", () => {
  const s = summarizeVisitRows([], products, range);
  assert.equal(s.totals.units, 0);
  assert.equal(s.totals.money, 0);
  assert.deepEqual(s.promoters, []);
  assert.deepEqual(s.byCliente, []);
  assert.deepEqual(s.byEstado, []);
  assert.deepEqual(s.products.map((p) => p.id), ["rollo", "cubeta", "galon"]);
});
