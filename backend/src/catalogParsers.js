// ---------------------------------------------------------------------------
// Parsers PUROS del catálogo ferretero (pestañas del Sheet o CSV -> objetos).
// ---------------------------------------------------------------------------
// Reciben filas (string[][]) y devuelven { items, skipped }. Una fila inválida
// NO rompe la carga: se omite y queda en `skipped` con su número de fila
// (1-based, el de la hoja) y el motivo — el catálogo se va llenando poco a
// poco, así que las filas incompletas son normales. Los encabezados se detectan
// por nombre, sin distinguir mayúsculas ni acentos.

const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Primera fila que trae TODAS las columnas obligatorias. `columns` mapea cada
// clave a sus nombres aceptados. Devuelve { headerRow, index: {clave: col|-1} }.
function findHeader(rows, tab, required, columns) {
  for (let r = 0; r < rows.length; r++) {
    const cells = (rows[r] || []).map(norm);
    const index = {};
    for (const [key, names] of Object.entries(columns)) {
      index[key] = cells.findIndex((c) => names.includes(c));
    }
    if (required.every((k) => index[k] !== -1)) return { headerRow: r, index };
  }
  throw new Error(`No se encontró el encabezado en la pestaña "${tab}".`);
}

const cell = (cells, i) => (i === -1 ? "" : String(cells?.[i] ?? "").trim());
const isEmptyRow = (cells) => !(cells || []).some((c) => String(c ?? "").trim() !== "");

// "", "abc" -> NaN. Quita "$", espacios y comas de miles ("1,200.50").
function parseNumber(raw) {
  const s = String(raw ?? "").trim().replace(/[$\s]/g, "");
  if (s === "") return NaN;
  const t = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, "") : s;
  return Number(t);
}

export function parseClientes(rows) {
  const { headerRow, index } = findHeader(rows, "Clientes", ["id", "nombre"], {
    id: ["id"],
    nombre: ["cliente", "nombre"],
    estado: ["estado", "entidad"],
  });
  const items = [];
  const skipped = [];
  const seen = new Set();
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r];
    if (isEmptyRow(cells)) continue;
    const id = cell(cells, index.id);
    const nombre = cell(cells, index.nombre);
    if (!id) { skipped.push({ row: r + 1, reason: "sin ID" }); continue; }
    if (!nombre) { skipped.push({ row: r + 1, reason: "sin nombre de cliente" }); continue; }
    if (seen.has(id)) { skipped.push({ row: r + 1, reason: `ID duplicado (${id})` }); continue; }
    seen.add(id);
    items.push({ id, nombre, estado: cell(cells, index.estado) || null });
  }
  return { items, skipped };
}

const FALSE_VALUES = new Set(["no", "false", "0"]);

export function parseProductos(rows) {
  const { headerRow, index } = findHeader(rows, "Productos", ["id", "nombre"], {
    id: ["id"],
    nombre: ["producto", "nombre"],
    unidad: ["unidad"],
    equivalencia: ["equivalencia"],
    precio: ["precio"],
    activo: ["activo"],
  });
  const items = [];
  const skipped = [];
  const seen = new Set();
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r];
    if (isEmptyRow(cells)) continue;
    const id = cell(cells, index.id);
    const nombre = cell(cells, index.nombre);
    if (!id) { skipped.push({ row: r + 1, reason: "sin ID" }); continue; }
    if (!nombre) { skipped.push({ row: r + 1, reason: "sin nombre de producto" }); continue; }
    if (seen.has(id)) { skipped.push({ row: r + 1, reason: `ID duplicado (${id})` }); continue; }

    const eqRaw = cell(cells, index.equivalencia);
    const equivalencia = eqRaw === "" ? 1 : parseNumber(eqRaw);
    if (!(equivalencia >= 0)) { skipped.push({ row: r + 1, reason: `equivalencia inválida (${eqRaw})` }); continue; }
    const precioRaw = cell(cells, index.precio);
    const precio = precioRaw === "" ? 0 : parseNumber(precioRaw);
    if (!(precio >= 0)) { skipped.push({ row: r + 1, reason: `precio inválido (${precioRaw})` }); continue; }

    seen.add(id);
    items.push({
      id,
      nombre,
      unidad: cell(cells, index.unidad) || "pza",
      equivalencia,
      precio,
      activo: !FALSE_VALUES.has(norm(cell(cells, index.activo))),
      orden: items.length,
    });
  }
  return { items, skipped };
}

export function parseSucursales(rows, clienteIds) {
  const { headerRow, index } = findHeader(rows, "Sucursales", ["num", "clienteId", "lat", "lng"], {
    num: ["num", "numero", "id"],
    clienteId: ["clienteid", "cliente id", "id cliente"],
    nombre: ["sucursal", "nombre"],
    direccion: ["direccion"],
    lat: ["latitud", "lat"],
    lng: ["longitud", "lng", "lon"],
    estado: ["estado", "entidad"],
  });
  const items = [];
  const skipped = [];
  const seen = new Set();
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r];
    if (isEmptyRow(cells)) continue;
    const skip = (reason) => skipped.push({ row: r + 1, reason });

    const id = cell(cells, index.num);
    if (!id) { skip("sin Num"); continue; }
    if (seen.has(id)) { skip(`Num duplicado (${id})`); continue; }

    const clienteId = cell(cells, index.clienteId);
    if (!clienteId) { skip("cliente vacío (ClienteID)"); continue; }
    if (!clienteIds.has(clienteId)) { skip(`cliente inexistente (${clienteId})`); continue; }

    // Una celda vacía NO es 0: se valida el texto antes de convertir.
    const lat = parseNumber(cell(cells, index.lat));
    const lng = parseNumber(cell(cells, index.lng));
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) { skip("coordenadas inválidas (Latitud/Longitud)"); continue; }

    seen.add(id);
    items.push({
      id,
      clienteId,
      name: cell(cells, index.nombre) || `Sucursal ${id}`,
      address: cell(cells, index.direccion),
      lat,
      lng,
      estado: cell(cells, index.estado) || null,
    });
  }
  return { items, skipped };
}
