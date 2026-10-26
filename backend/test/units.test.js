import { test } from "node:test";
import assert from "node:assert/strict";
import { unitsOf, moneyOf, piecesOf, normalizeItems } from "../src/units.js";

const catalog = new Map([
  ["rollo", { equivalencia: 1, precio: 850 }],
  ["cubeta", { equivalencia: 0.6, precio: 1200 }],
  ["galon", { equivalencia: 0, precio: 350 }],
]);

test("unitsOf pondera cada producto por su equivalencia", () => {
  const items = [{ productoId: "rollo", cantidad: 3 }, { productoId: "cubeta", cantidad: 5 }];
  assert.equal(unitsOf(items, catalog), 6);
});

test("moneyOf suma cantidad por precio", () => {
  const items = [{ productoId: "rollo", cantidad: 3 }, { productoId: "cubeta", cantidad: 5 }];
  assert.equal(moneyOf(items, catalog), 3 * 850 + 5 * 1200);
});

test("un producto fuera del catálogo no aporta unidades ni dinero", () => {
  const items = [{ productoId: "fantasma", cantidad: 9 }];
  assert.equal(unitsOf(items, catalog), 0);
  assert.equal(moneyOf(items, catalog), 0);
});

test("equivalencia 0 no suma unidades pero sí dinero", () => {
  const items = [{ productoId: "galon", cantidad: 4 }];
  assert.equal(unitsOf(items, catalog), 0);
  assert.equal(moneyOf(items, catalog), 1400);
});

test("piecesOf suma cantidades de todos los productos", () => {
  const items = [{ productoId: "rollo", cantidad: 2 }, { productoId: "galon", cantidad: 4 }];
  assert.equal(piecesOf(items), 6);
});

test("las funciones toleran items ausentes", () => {
  assert.equal(unitsOf(undefined, catalog), 0);
  assert.equal(moneyOf(null, catalog), 0);
  assert.equal(piecesOf(undefined), 0);
});

const active = new Set(["rollo", "cubeta"]);

test("normalizeItems fusiona productos repetidos", () => {
  const out = normalizeItems([{ productoId: "rollo", cantidad: 2 }, { productoId: "rollo", cantidad: 3 }], active);
  assert.deepEqual(out, [{ productoId: "rollo", cantidad: 5 }]);
});

test("normalizeItems descarta ids que no están activos", () => {
  const out = normalizeItems([{ productoId: "galon", cantidad: 2 }, { productoId: "rollo", cantidad: 1 }], active);
  assert.deepEqual(out, [{ productoId: "rollo", cantidad: 1 }]);
});

test("normalizeItems recorta negativos y valores no numéricos a 0 y trunca decimales", () => {
  const out = normalizeItems(
    [
      { productoId: "rollo", cantidad: -4 },
      { productoId: "cubeta", cantidad: "abc" },
      { productoId: "rollo", cantidad: NaN },
      { productoId: "cubeta", cantidad: null },
      { productoId: "rollo", cantidad: 2.7 },
    ],
    active
  );
  assert.deepEqual(out, [{ productoId: "rollo", cantidad: 2 }]);
});

test("normalizeItems devuelve [] con entradas que no son arreglo o vacías", () => {
  assert.deepEqual(normalizeItems(undefined, active), []);
  assert.deepEqual(normalizeItems("x", active), []);
  assert.deepEqual(normalizeItems({}, active), []);
  assert.deepEqual(normalizeItems([], active), []);
});

test("normalizeItems ignora entradas que no son objeto", () => {
  assert.deepEqual(normalizeItems([null, 5, "rollo"], active), []);
});

test("describeItems lista producto: cantidad separados por punto y coma", async () => {
  const { describeItems } = await import("../src/units.js");
  const cat = new Map([["rollo", { nombre: "Rollo", equivalencia: 1, precio: 0 }], ["cubeta", { nombre: "Cubeta", equivalencia: 0.6, precio: 0 }]]);
  assert.equal(describeItems([{ productoId: "rollo", cantidad: 3 }, { productoId: "cubeta", cantidad: 2 }], cat), "Rollo: 3; Cubeta: 2");
  assert.equal(describeItems([{ productoId: "viejo", cantidad: 1 }], cat), "viejo: 1");
  assert.equal(describeItems([], cat), "");
});
