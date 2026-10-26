// ---------------------------------------------------------------------------
// Agregación PURA del resumen del gerente (sin acceso a base de datos).
// ---------------------------------------------------------------------------
// Recibe las filas de VisitRecord de un rango de días (con `promoter` y
// `store` incluidos) y los precios, y devuelve el objeto que consume el
// tablero del gerente. Se mantiene separado de db.js (que hace la consulta
// Prisma) para poder probarlo de forma aislada. El `range` recibido ({from,to})
// solo se devuelve tal cual para que el frontend sepa qué período está viendo.
//
// Forma esperada de cada fila:
//   { promoterId, promoter:{name,supervisor,estado}, sucursalId, store:{name,estado,lat,lng},
//     status, rollos, cubetas, day, checkInTime, checkOutTime }
//
// El `estado` del PROMOTOR (usado para el filtro y "Ventas por estado") es un
// dato fijo asignado al promotor (promoter.estado, columna "Estado" de la
// pestaña Promotores) — no se deriva de en qué estado están las tiendas que
// visitó, para que un promotor sin actividad hoy o que cubre tiendas de otro
// estado igual aparezca en SU estado. `store.estado` (por visita) se conserva
// tal cual, es información de la tienda, no del promotor.

export function summarizeVisitRows(rows, prices = {}, range) {
  const priceRollo = Number(prices.rollo || 0);
  const priceCubeta = Number(prices.cubeta || 0);
  const money = (rollos, cubetas) => rollos * priceRollo + cubetas * priceCubeta;

  const byPromoter = new Map();
  for (const r of rows) {
    const pid = r.promoterId;
    if (!byPromoter.has(pid)) {
      byPromoter.set(pid, {
        id: pid, name: r.promoter?.name || pid, supervisor: r.promoter?.supervisor || null,
        estado: r.promoter?.estado || null,
        rollos: 0, cubetas: 0, visits: [],
        lastActivity: null, lastCheckInTime: null, lastCheckOutTime: null,
        openCount: 0, lat: null, lng: null, _lastTs: 0,
      });
    }
    const p = byPromoter.get(pid);
    const rollos = r.rollos || 0;
    const cubetas = r.cubetas || 0;
    p.rollos += rollos;
    p.cubetas += cubetas;
    if (r.status === "checked-in") p.openCount += 1;

    const inTs = r.checkInTime ? new Date(r.checkInTime).getTime() : 0;
    const outTs = r.checkOutTime ? new Date(r.checkOutTime).getTime() : 0;
    const lastTs = Math.max(inTs, outTs);
    if (lastTs >= p._lastTs) {
      p._lastTs = lastTs;
      p.lastActivity = r.checkOutTime || r.checkInTime || p.lastActivity;
      p.lastCheckInTime = r.checkInTime || null;
      p.lastCheckOutTime = r.checkOutTime || null;
      if (typeof r.store?.lat === "number" && typeof r.store?.lng === "number") {
        p.lat = r.store.lat;
        p.lng = r.store.lng;
      }
    }

    p.visits.push({
      day: r.day || null,
      sucursalId: r.sucursalId,
      sucursalName: r.store?.name || r.sucursalId,
      estado: r.store?.estado || null,
      lat: typeof r.store?.lat === "number" ? r.store.lat : null,
      lng: typeof r.store?.lng === "number" ? r.store.lng : null,
      status: r.status,
      rollos, cubetas, money: money(rollos, cubetas),
      checkInTime: r.checkInTime, checkOutTime: r.checkOutTime,
    });
  }

  const promoters = [...byPromoter.values()].map((p) => {
    return {
      id: p.id, name: p.name, supervisor: p.supervisor,
      estado: p.estado,
      rollos: p.rollos, cubetas: p.cubetas, money: money(p.rollos, p.cubetas),
      sucursalesVisited: p.visits.length,
      status: p.openCount > 0 ? "in" : "done",
      lastActivity: p.lastActivity,
      checkInTime: p.lastCheckInTime, checkOutTime: p.lastCheckOutTime,
      lat: p.lat, lng: p.lng,
      visits: p.visits,
    };
  });

  promoters.sort((a, b) => b.money - a.money || (b.rollos + b.cubetas) - (a.rollos + a.cubetas));

  const estadoMap = new Map();
  for (const p of promoters) {
    const est = p.estado || "Sin estado";
    if (!estadoMap.has(est)) estadoMap.set(est, { estado: est, promoters: 0, rollos: 0, cubetas: 0, money: 0 });
    const e = estadoMap.get(est);
    e.promoters += 1;
    e.rollos += p.rollos;
    e.cubetas += p.cubetas;
    e.money += p.money;
  }
  const byEstado = [...estadoMap.values()].sort((a, b) => b.money - a.money);

  const totals = promoters.reduce(
    (a, p) => ({
      promoters: a.promoters + 1,
      sucursalesVisited: a.sucursalesVisited + p.sucursalesVisited,
      rollos: a.rollos + p.rollos,
      cubetas: a.cubetas + p.cubetas,
      money: a.money + p.money,
      checkedIn: a.checkedIn + (p.status === "in" ? 1 : 0),
      withoutSales: a.withoutSales + (p.rollos + p.cubetas === 0 ? 1 : 0),
    }),
    { promoters: 0, sucursalesVisited: 0, rollos: 0, cubetas: 0, money: 0, checkedIn: 0, withoutSales: 0 }
  );

  return { range, prices: { rollo: priceRollo, cubeta: priceCubeta }, totals, byEstado, promoters };
}
