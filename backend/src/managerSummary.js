// ---------------------------------------------------------------------------
// Agregación PURA del resumen del gerente (sin acceso a base de datos).
// ---------------------------------------------------------------------------
// Recibe las filas de VisitRecord de un rango de días (con `promoter`,
// `sucursal` -con su `cliente`- e `items` incluidos) y el catálogo completo de
// productos, y devuelve el objeto que consumen los tableros de gerente y
// supervisor. Se mantiene separado de db.js (que hace la consulta Prisma) para
// poder probarlo de forma aislada. El `range` recibido ({from,to}) solo se
// devuelve tal cual para que el frontend sepa qué período está viendo.
//
// Forma esperada de cada fila:
//   { promoterId, promoter:{name,supervisor,estado},
//     sucursalId, sucursal:{name,estado,lat,lng,clienteId,cliente:{nombre}},
//     status, items:[{productoId,cantidad}], day, checkInTime, checkOutTime }
//
// Forma de cada producto del catálogo:
//   { id, nombre, unidad, equivalencia, precio, activo, orden }
//
// El `estado` del PROMOTOR (usado para el filtro y "Ventas por estado") es un
// dato fijo asignado al promotor (promoter.estado, columna "Estado" de la
// pestaña Promotores) — no se deriva de en qué estado están las sucursales que
// visitó, para que un promotor sin actividad hoy o que cubre sucursales de otro
// estado igual aparezca en SU estado. `sucursal.estado` (por visita) se conserva
// tal cual, es información de la sucursal, no del promotor.
//
// Un producto desactivado sigue sumando en las ventas que ya tiene (historial);
// solo se oculta de `products` si no tuvo ventas en el rango.
import { unitsOf, moneyOf, piecesOf } from "./units.js";

const sum = (target, items) => {
  for (const it of items) target[it.productoId] = (target[it.productoId] || 0) + (Number(it.cantidad) || 0);
};

export function summarizeVisitRows(rows, products = [], range) {
  const catalog = new Map(products.map((p) => [p.id, { equivalencia: p.equivalencia, precio: p.precio }]));

  const byPromoter = new Map();
  const byClienteMap = new Map();
  const usedProducts = new Set();

  for (const r of rows) {
    const items = (r.items || []).filter((i) => Number(i.cantidad) > 0);
    for (const it of items) usedProducts.add(it.productoId);
    const units = unitsOf(items, catalog);
    const money = moneyOf(items, catalog);
    const pieces = piecesOf(items);

    const pid = r.promoterId;
    if (!byPromoter.has(pid)) {
      byPromoter.set(pid, {
        id: pid, name: r.promoter?.name || pid, supervisor: r.promoter?.supervisor || null,
        estado: r.promoter?.estado || null,
        byProduct: {}, visits: [],
        lastActivity: null, lastCheckInTime: null, lastCheckOutTime: null,
        openCount: 0, lat: null, lng: null, _lastTs: 0,
      });
    }
    const p = byPromoter.get(pid);
    sum(p.byProduct, items);
    if (r.status === "checked-in") p.openCount += 1;

    const inTs = r.checkInTime ? new Date(r.checkInTime).getTime() : 0;
    const outTs = r.checkOutTime ? new Date(r.checkOutTime).getTime() : 0;
    const lastTs = Math.max(inTs, outTs);
    if (lastTs >= p._lastTs) {
      p._lastTs = lastTs;
      p.lastActivity = r.checkOutTime || r.checkInTime || p.lastActivity;
      p.lastCheckInTime = r.checkInTime || null;
      p.lastCheckOutTime = r.checkOutTime || null;
      if (typeof r.sucursal?.lat === "number" && typeof r.sucursal?.lng === "number") {
        p.lat = r.sucursal.lat;
        p.lng = r.sucursal.lng;
      }
    }

    const clienteId = r.sucursal?.clienteId ?? null;
    const clienteNombre = r.sucursal?.cliente?.nombre ?? clienteId;
    p.visits.push({
      day: r.day || null,
      sucursalId: r.sucursalId,
      sucursalName: r.sucursal?.name || r.sucursalId,
      clienteId,
      clienteNombre,
      estado: r.sucursal?.estado || null,
      lat: typeof r.sucursal?.lat === "number" ? r.sucursal.lat : null,
      lng: typeof r.sucursal?.lng === "number" ? r.sucursal.lng : null,
      status: r.status,
      items, units, money,
      checkInTime: r.checkInTime, checkOutTime: r.checkOutTime,
    });

    const ckey = clienteId ?? "sin-cliente";
    if (!byClienteMap.has(ckey)) {
      byClienteMap.set(ckey, { clienteId, cliente: clienteNombre || "Sin cliente", _sucursales: new Set(), visits: 0, pieces: 0, units: 0, money: 0 });
    }
    const c = byClienteMap.get(ckey);
    c._sucursales.add(r.sucursalId);
    c.visits += 1;
    c.pieces += pieces;
    c.units += units;
    c.money += money;
  }

  const promoters = [...byPromoter.values()].map((p) => {
    const allItems = p.visits.flatMap((v) => v.items);
    return {
      id: p.id, name: p.name, supervisor: p.supervisor,
      estado: p.estado,
      byProduct: p.byProduct,
      pieces: piecesOf(allItems),
      units: p.visits.reduce((a, v) => a + v.units, 0),
      money: p.visits.reduce((a, v) => a + v.money, 0),
      sucursalesVisited: p.visits.length,
      status: p.openCount > 0 ? "in" : "done",
      lastActivity: p.lastActivity,
      checkInTime: p.lastCheckInTime, checkOutTime: p.lastCheckOutTime,
      lat: p.lat, lng: p.lng,
      visits: p.visits,
    };
  });

  promoters.sort((a, b) => b.money - a.money || b.units - a.units);

  const estadoMap = new Map();
  for (const p of promoters) {
    const est = p.estado || "Sin estado";
    if (!estadoMap.has(est)) estadoMap.set(est, { estado: est, promoters: 0, pieces: 0, units: 0, money: 0 });
    const e = estadoMap.get(est);
    e.promoters += 1;
    e.pieces += p.pieces;
    e.units += p.units;
    e.money += p.money;
  }
  const byEstado = [...estadoMap.values()].sort((a, b) => b.money - a.money || b.units - a.units);

  const byCliente = [...byClienteMap.values()]
    .map(({ _sucursales, ...c }) => ({ ...c, sucursales: _sucursales.size }))
    .sort((a, b) => b.money - a.money || b.units - a.units);

  const byProduct = {};
  for (const p of promoters) for (const [id, q] of Object.entries(p.byProduct)) byProduct[id] = (byProduct[id] || 0) + q;

  const totals = promoters.reduce(
    (a, p) => ({
      promoters: a.promoters + 1,
      sucursalesVisited: a.sucursalesVisited + p.sucursalesVisited,
      pieces: a.pieces + p.pieces,
      units: a.units + p.units,
      money: a.money + p.money,
      byProduct: a.byProduct,
      checkedIn: a.checkedIn + (p.status === "in" ? 1 : 0),
      withoutSales: a.withoutSales + (p.pieces === 0 ? 1 : 0),
    }),
    { promoters: 0, sucursalesVisited: 0, pieces: 0, units: 0, money: 0, byProduct, checkedIn: 0, withoutSales: 0 }
  );

  const shownProducts = products
    .filter((p) => p.activo || usedProducts.has(p.id))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.id).localeCompare(String(b.id)))
    .map((p) => ({ id: p.id, nombre: p.nombre, unidad: p.unidad, precio: p.precio }));

  return { range, products: shownProducts, totals, byEstado, byCliente, promoters };
}
