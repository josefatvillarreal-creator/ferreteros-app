import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../support/testDb.js";

const testDb = setupTestDb();
const { prisma } = await import("../src/prisma.js");
const { syncCatalog } = await import("../src/catalogSync.js");
const { getAllSucursales, getSucursal, getProductosActivos, getCatalogoProductos } = await import("../src/db.js");

after(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

const CLIENTES = [["ID", "Cliente", "Estado"], ["c1", "Ferretería Demo", "Michoacán"]];
const PRODUCTOS = [
  ["ID", "Producto", "Unidad", "Equivalencia", "Precio", "Activo"],
  ["rollo", "Rollo", "rollo", "1", "850", "SI"],
  ["cubeta", "Cubeta", "cubeta", "0.6", "1200", "SI"],
];
const SUC_HEADER = ["Num", "ClienteID", "Sucursal", "Dirección", "Latitud", "Longitud", "Estado"];

test("syncCatalog carga clientes, productos y sucursales válidas", async () => {
  const r = await syncCatalog({
    clientes: CLIENTES,
    productos: PRODUCTOS,
    sucursales: [SUC_HEADER, ["1001", "c1", "Centro", "Madero 1", "19.7008", "-101.1844", "Michoacán"]],
  });
  assert.deepEqual({ c: r.clientes, p: r.productos, s: r.sucursales }, { c: 1, p: 2, s: 1 });
  assert.deepEqual(r.skipped, []);
});

test("syncCatalog omite sucursales sin coordenadas o con cliente inexistente y carga el resto", async () => {
  const r = await syncCatalog({
    clientes: CLIENTES,
    productos: PRODUCTOS,
    sucursales: [
      SUC_HEADER,
      ["1001", "c1", "Centro", "Madero 1", "19.7008", "-101.1844", ""],
      ["1002", "c1", "Sin coords", "", "", "", ""],
      ["1003", "zzz", "Sin cliente", "", "19.7", "-101.1", ""],
    ],
  });
  assert.equal(r.sucursales, 1);
  assert.equal(r.skipped.length, 2);
  assert.deepEqual(r.skipped.map((s) => [s.tab, s.row]), [["Sucursales", 3], ["Sucursales", 4]]);
  assert.equal(await prisma.sucursal.findUnique({ where: { id: "1002" } }), null);
});

test("un producto con Activo = NO se desactiva pero no se borra", async () => {
  await syncCatalog({
    clientes: CLIENTES,
    productos: [PRODUCTOS[0], PRODUCTOS[1], ["cubeta", "Cubeta", "cubeta", "0.6", "1200", "NO"]],
    sucursales: [SUC_HEADER],
  });
  const cubeta = await prisma.producto.findUnique({ where: { id: "cubeta" } });
  assert.equal(cubeta.activo, false);
  assert.deepEqual((await getProductosActivos()).map((p) => p.id), ["rollo"]);
  const catalogo = await getCatalogoProductos();
  assert.deepEqual([...catalogo.keys()].sort(), ["cubeta", "rollo"]);
  assert.equal(catalogo.get("cubeta").equivalencia, 0.6);
});

test("syncCatalog con sucursales vacías conserva lo sincronizado y lo reporta", async () => {
  await syncCatalog({
    clientes: CLIENTES,
    productos: PRODUCTOS,
    sucursales: [SUC_HEADER, ["1001", "c1", "Centro", "Madero 1", "19.7008", "-101.1844", ""]],
  });
  const r = await syncCatalog({ clientes: CLIENTES, productos: PRODUCTOS, sucursales: [] });
  assert.equal(r.sucursales, 0);
  assert.deepEqual(r.skipped.map((s) => [s.tab, s.row]), [["Sucursales", 0]]);
  assert.equal((await getAllSucursales()).length, 1);
});

test("getAllSucursales y getSucursal traen el nombre del cliente", async () => {
  const todas = await getAllSucursales();
  assert.equal(todas[0].clienteNombre, "Ferretería Demo");
  assert.equal(todas[0].clienteId, "c1");
  const una = await getSucursal("1001");
  assert.equal(una.clienteNombre, "Ferretería Demo");
  assert.equal(await getSucursal("no-existe"), null);
});

test("getAllSucursales devuelve [] cuando no hay sucursales", async () => {
  await prisma.sucursal.deleteMany();
  assert.deepEqual(await getAllSucursales(), []);
});

test("un producto que ya no aparece en la pestaña Productos se desactiva (no se borra)", async () => {
  await prisma.sucursal.deleteMany();
  await syncCatalog({ clientes: CLIENTES, productos: PRODUCTOS, sucursales: [SUC_HEADER] });
  await prisma.producto.updateMany({ data: { activo: true } });
  const r = await syncCatalog({ clientes: CLIENTES, productos: [PRODUCTOS[0], PRODUCTOS[1]], sucursales: [SUC_HEADER] });
  assert.deepEqual(r.skipped, []);
  const rollo = await prisma.producto.findUnique({ where: { id: "rollo" } });
  const cubeta = await prisma.producto.findUnique({ where: { id: "cubeta" } });
  assert.equal(rollo.activo, true);
  assert.equal(cubeta.activo, false);
  assert.deepEqual((await getProductosActivos()).map((p) => p.id), ["rollo"]);
});

test("una sucursal que ya no aparece (o queda inválida) se desactiva y deja de listarse", async () => {
  const dos = [
    SUC_HEADER,
    ["2001", "c1", "Una", "", "19.7", "-101.1", ""],
    ["2002", "c1", "Dos", "", "19.8", "-101.2", ""],
  ];
  await syncCatalog({ clientes: CLIENTES, productos: PRODUCTOS, sucursales: dos });
  assert.equal((await getAllSucursales()).length, 2);
  // 2002 desaparece de la hoja; 2001 queda con coordenadas vacías (inválida) y la única válida es otra
  const r = await syncCatalog({
    clientes: CLIENTES,
    productos: PRODUCTOS,
    sucursales: [SUC_HEADER, ["2001", "c1", "Una", "", "", "", ""], ["2003", "c1", "Tres", "", "19.9", "-101.3", ""]],
  });
  assert.equal(r.sucursales, 1);
  assert.deepEqual((await getAllSucursales()).map((s) => s.id), ["2003"]);
  assert.equal((await getSucursal("2002")).activa, false);
  // si vuelve a la hoja, se reactiva
  await syncCatalog({ clientes: CLIENTES, productos: PRODUCTOS, sucursales: dos });
  assert.deepEqual((await getAllSucursales()).map((s) => s.id).sort(), ["2001", "2002"]);
  assert.equal((await getSucursal("2002")).activa, true);
});

test("una pestaña de sucursales con solo encabezado no desactiva el catálogo existente", async () => {
  await syncCatalog({
    clientes: CLIENTES,
    productos: PRODUCTOS,
    sucursales: [SUC_HEADER, ["3001", "c1", "Estable", "", "19.7", "-101.1", ""]],
  });
  await syncCatalog({ clientes: CLIENTES, productos: PRODUCTOS, sucursales: [SUC_HEADER] });
  assert.equal((await getSucursal("3001")).activa, true);
});
