// ---------------------------------------------------------------------------
// Unidades-equivalentes, dinero y validación de items de una visita (PURO).
// ---------------------------------------------------------------------------
// Una visita registra cantidades por producto: items = [{ productoId, cantidad }].
// El catálogo (Map<productoId, { equivalencia, precio }>) dice cuánto pesa cada
// producto en la meta y cuánto cuesta. Un producto que ya no está en el
// catálogo aporta 0 (no rompe totales históricos).

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function unitsOf(items, catalog) {
  let total = 0;
  for (const it of items || []) {
    const p = catalog.get(it?.productoId);
    if (p) total += num(it.cantidad) * num(p.equivalencia);
  }
  return total;
}

export function moneyOf(items, catalog) {
  let total = 0;
  for (const it of items || []) {
    const p = catalog.get(it?.productoId);
    if (p) total += num(it.cantidad) * num(p.precio);
  }
  return total;
}

export function piecesOf(items) {
  let total = 0;
  for (const it of items || []) total += num(it?.cantidad);
  return total;
}

// Valida el cuerpo de un check-out: solo productos activos, cantidades enteras
// >= 0, productos repetidos fusionados y sin items de cantidad 0.
export function normalizeItems(raw, activeIds) {
  if (!Array.isArray(raw)) return [];
  const sums = new Map();
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const id = String(it.productoId ?? "");
    if (!activeIds.has(id)) continue;
    const qty = Math.max(0, Math.floor(num(it.cantidad)));
    if (qty > 0) sums.set(id, (sums.get(id) || 0) + qty);
  }
  return [...sums].map(([productoId, cantidad]) => ({ productoId, cantidad }));
}
