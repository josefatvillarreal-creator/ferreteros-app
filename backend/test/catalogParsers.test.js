import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClientes, parseProductos, parseSucursales } from "../src/catalogParsers.js";

const SUC_HEADER = ["Num", "ClienteID", "Sucursal", "Dirección", "Latitud", "Longitud", "Estado"];
const clientes = new Set(["c1"]);

test("parseSucursales carga una fila válida", () => {
  const { items, skipped } = parseSucursales(
    [SUC_HEADER, ["1001", "c1", "Centro", "Av. Madero 1", "19.7008", "-101.1844", "Michoacán"]],
    clientes
  );
  assert.deepEqual(skipped, []);
  assert.deepEqual(items, [
    { id: "1001", clienteId: "c1", name: "Centro", address: "Av. Madero 1", lat: 19.7008, lng: -101.1844, estado: "Michoacán" },
  ]);
});

test("parseSucursales deja address vacío como cadena vacía y estado como null", () => {
  const { items } = parseSucursales([SUC_HEADER, ["1", "c1", "Norte", "", "19.7", "-101.1", ""]], clientes);
  assert.equal(items[0].address, "");
  assert.equal(items[0].estado, null);
});

test("parseSucursales acepta otro orden, mayúsculas y sin acentos en encabezados", () => {
  const rows = [
    ["LONGITUD", "LATITUD", "SUCURSAL", "CLIENTEID", "NUM", "DIRECCION"],
    ["-101.1", "19.7", "Norte", "c1", "7", "Calle 1"],
  ];
  const { items } = parseSucursales(rows, clientes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "7");
  assert.equal(items[0].address, "Calle 1");
});

test("parseSucursales omite coordenadas vacías (no las coloca en 0,0)", () => {
  const { items, skipped } = parseSucursales(
    [SUC_HEADER, ["1", "c1", "A", "", "", "", ""], ["2", "c1", "B", "", "19.7", "", ""], ["3", "c1", "C", "", "", "-101.1", ""]],
    clientes
  );
  assert.deepEqual(items, []);
  assert.equal(skipped.length, 3);
  for (const s of skipped) assert.match(s.reason, /coordenadas/);
});

test("parseSucursales omite coordenadas no numéricas o fuera de rango", () => {
  const { items, skipped } = parseSucursales(
    [SUC_HEADER, ["1", "c1", "A", "", "abc", "-101", ""], ["2", "c1", "B", "", "95", "-101", ""], ["3", "c1", "C", "", "19", "200", ""]],
    clientes
  );
  assert.deepEqual(items, []);
  assert.equal(skipped.length, 3);
});

test("parseSucursales omite ClienteID vacío o inexistente con el motivo", () => {
  const { items, skipped } = parseSucursales(
    [SUC_HEADER, ["1", "", "A", "", "19.7", "-101.1", ""], ["2", "zzz", "B", "", "19.7", "-101.1", ""], ["3", "c1", "C", "", "19.7", "-101.1", ""]],
    clientes
  );
  assert.deepEqual(items.map((i) => i.id), ["3"]);
  assert.equal(skipped.length, 2);
  for (const s of skipped) assert.match(s.reason, /cliente/);
});

test("parseSucursales omite Num vacío y Num duplicado (gana la primera)", () => {
  const { items, skipped } = parseSucursales(
    [SUC_HEADER, ["", "c1", "A", "", "19.7", "-101.1", ""], ["5", "c1", "B", "", "19.7", "-101.1", ""], ["5", "c1", "B2", "", "19.8", "-101.2", ""]],
    clientes
  );
  assert.deepEqual(items.map((i) => i.name), ["B"]);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /Num/);
  assert.match(skipped[1].reason, /duplicad/);
});

test("parseSucursales ignora filas vacías y reporta el número de fila de la hoja", () => {
  const { skipped } = parseSucursales(
    [["Reporte"], SUC_HEADER, ["", "", "", "", "", "", ""], ["9", "zzz", "A", "", "19.7", "-101.1", ""]],
    clientes
  );
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].row, 4);
});

test("parseSucursales sin encabezado lanza un error claro", () => {
  assert.throws(() => parseSucursales([["x", "y"]], clientes), /No se encontró el encabezado en la pestaña "Sucursales"/);
});

test("parseProductos aplica defaults y reconoce Activo = NO", () => {
  const { items, skipped } = parseProductos([
    ["ID", "Producto", "Unidad", "Equivalencia", "Precio", "Activo"],
    ["rollo", "Rollo", "rollo", "1", "850", "SI"],
    ["cubeta", "Cubeta", "", "", "", "no"],
    ["galon", "Galón", "gal", "0", "350", ""],
    ["viejo", "Viejo", "pza", "1", "10", "false"],
    ["cero", "Cero", "pza", "1", "10", "0"],
  ]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(items.map((p) => p.id), ["rollo", "cubeta", "galon", "viejo", "cero"]);
  assert.equal(items[1].equivalencia, 1);
  assert.equal(items[1].precio, 0);
  assert.equal(items[1].unidad, "pza");
  assert.deepEqual(items.map((p) => p.activo), [true, false, true, false, false]);
  assert.equal(items[2].equivalencia, 0);
  assert.deepEqual(items.map((p) => p.orden), [0, 1, 2, 3, 4]);
});

test("parseProductos omite equivalencia negativa o con texto y precio inválido", () => {
  const { items, skipped } = parseProductos([
    ["ID", "Producto", "Unidad", "Equivalencia", "Precio", "Activo"],
    ["a", "A", "pza", "-1", "10", ""],
    ["b", "B", "pza", "mucho", "10", ""],
    ["c", "C", "pza", "1", "caro", ""],
    ["d", "D", "pza", "1", "10", ""],
  ]);
  assert.deepEqual(items.map((p) => p.id), ["d"]);
  assert.equal(skipped.length, 3);
});

test("parseClientes deja Estado vacío como null y omite ID duplicado", () => {
  const { items, skipped } = parseClientes([
    ["ID", "Cliente", "Estado"],
    ["c1", "Ferretería Demo", ""],
    ["c1", "Repetido", "Jalisco"],
    ["c2", "Otra", "Jalisco"],
  ]);
  assert.deepEqual(items, [
    { id: "c1", nombre: "Ferretería Demo", estado: null },
    { id: "c2", nombre: "Otra", estado: "Jalisco" },
  ]);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /duplicad/);
});
