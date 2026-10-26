import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csvRows.js";

test("parseCsv detecta ; y , como separador", () => {
  assert.deepEqual(parseCsv("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("parseCsv respeta campos entre comillas con separador dentro", () => {
  assert.deepEqual(parseCsv('"x, y",z\n1,2'), [["x, y", "z"], ["1", "2"]]);
});

test("parseCsv ignora líneas vacías y fin de línea CRLF", () => {
  assert.deepEqual(parseCsv("a,b\r\n\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
});

test("parseCsv quita el BOM inicial", () => {
  assert.deepEqual(parseCsv("﻿ID,Cliente\n1,X")[0], ["ID", "Cliente"]);
});
