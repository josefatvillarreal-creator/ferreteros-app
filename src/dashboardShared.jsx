// ---------------------------------------------------------------------------
// Piezas compartidas entre ManagerDashboard (gerente/admin) y
// SupervisorDashboard (supervisor): formato, mapa nacional, gráficas, KPIs,
// fila de promotor, exportación CSV/Excel. Evita duplicar el mapa de Leaflet
// y las gráficas SVG entre ambos tableros.
import { useState, useEffect, useRef } from "react";
import { MapPin, Maximize2, Minimize2, ChevronUp, ChevronDown, ChevronLeft, Target } from "lucide-react";
import { COLORS } from "./theme.js";
import { useLeaflet } from "./lib/useLeaflet.js";
import { attachBaseMap } from "./lib/mapTiles.js";

// --- Formato ----------------------------------------------------------------
const moneyFmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("es-MX");
export const fmtMoney = (n) => moneyFmt.format(Number(n) || 0);
export const fmtNum = (n) => numFmt.format(Number(n) || 0);
// Versión compacta ($1.25K, $1.56M) para el KPI de "Vendido" — el detalle por
// promotor sigue mostrando el monto completo con fmtMoney.
export function fmtMoneyCompact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  return fmtMoney(v);
}
// `hour12` (default true) controla 12h "8:30 p. m." vs 24h "20:30" — el
// tablero de administrador lo pide en 24h; supervisor se queda con el
// default (12h) al no pasarlo.
export function fmtTime(iso, hour12 = true) {
  if (!iso) return "--:--";
  try { return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12 }); } catch { return "--:--"; }
}
// Fecha + hora completas (para el CSV/Excel exportado: un solo día no la
// necesita, pero en un rango de semana/mes/año es la única forma de saber
// A QUÉ día pertenece cada visita).
export function fmtDateTime(iso, hour12 = true) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short", hour12 }); } catch { return ""; }
}
// Fecha de hoy en la zona del navegador, para nombrar los archivos exportados.
export function todayStamp() {
  return new Date().toLocaleDateString("en-CA");
}

// Rango de fechas del tablero (dropdown en la vista maximizada).
export const RANGE_OPTIONS = [
  { key: "today", label: "Hoy" },
  { key: "yesterday", label: "Ayer" },
  { key: "week", label: "Esta semana" },
  { key: "last_week", label: "La semana pasada" },
  { key: "month", label: "Este mes" },
  { key: "last_month", label: "El mes pasado" },
  { key: "year", label: "Este año" },
  { key: "last_year", label: "El año pasado" },
  { key: "custom", label: "Personalizado…" },
];
export const RANGE_LABELS = Object.fromEntries(RANGE_OPTIONS.map((r) => [r.key, r.label]));

// Los 32 estados de México (31 + CDMX), para el filtro del tablero — se
// listan todos aunque el rango actual no tenga actividad en alguno de ellos.
export const MEXICO_ESTADOS = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche",
  "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango",
  "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco",
  "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla",
  "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora",
  "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
];

// Color del marcador/estado según ventas: verde si vendió, ámbar si está activo
// pero aún sin ventas.
export function salesColor(p) {
  return p.pieces > 0 ? COLORS.success : COLORS.accent;
}

// Piezas de un promotor (o fila de resumen) considerando solo los productos
// marcados en el filtro; sin selección (Set vacío) = todas. `byProduct` es
// { [productoId]: cantidad } (ver summary.promoters[].byProduct).
export function pieceCount(p, selectedIds) {
  if (!selectedIds || selectedIds.size === 0) return p.pieces || 0;
  let total = 0;
  for (const id of selectedIds) total += p.byProduct?.[id] || 0;
  return total;
}

// Fondo de textura de marca (igual que en la app del promotor).
export function bgTexture() {
  return {
    backgroundColor: COLORS.bg,
    backgroundImage: `linear-gradient(${COLORS.border}22 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}22 1px, transparent 1px)`,
    backgroundSize: "28px 28px",
  };
}

// Logo oficial Protexa (blanco en oscuro, negro en claro).
export function Brand() {
  return (
    <picture style={{ display: "flex", alignItems: "center" }}>
      <source srcSet="/protexa-logo-blanco.png" media="(prefers-color-scheme: dark)" />
      <img src="/protexa-logo-negro.png" alt="Protexa · Desde 1945" style={{ height: 26, width: "auto", display: "block" }} />
    </picture>
  );
}

// ---------------------------------------------------------------------------
// Mapa nacional (Leaflet empaquetado con la app; teselas con respaldo en lib/mapTiles.js).
// ---------------------------------------------------------------------------
export function NationalMap({ promoters, onSelect, products = [] }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const tilesRef = useRef(null);
  const [retryKey, setRetryKey] = useState(0);
  const { L, failed: loadFailed } = useLeaflet(retryKey); // Leaflet viene empaquetado con la app
  const [tilesFailed, setTilesFailed] = useState(false); // ningún proveedor de teselas respondió
  const failed = loadFailed || tilesFailed;

  function destroyMap() {
    if (tilesRef.current) { tilesRef.current.destroy(); tilesRef.current = null; }
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    layerRef.current = null;
  }

  function retry() {
    destroyMap();
    setTilesFailed(false);
    setRetryKey((k) => k + 1);
  }

  useEffect(() => destroyMap, []);

  // Inicializa el mapa centrado en México.
  useEffect(() => {
    if (!L || !elRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(elRef.current, { zoomControl: true, attributionControl: true }).setView([23.6, -102.5], 5);
      tilesRef.current = attachBaseMap(L, mapRef.current, { onFail: () => setTilesFailed(true) });
      layerRef.current = L.layerGroup().addTo(mapRef.current);
    }
    setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 150);
  }, [L, retryKey]);

  // Marcadores de promotores (se redibujan al cambiar el filtro).
  useEffect(() => {
    if (!L || !mapRef.current || !layerRef.current) return;
    const layer = layerRef.current;
    layer.clearLayers();
    const pts = [];
    for (const p of promoters) {
      if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
      const color = salesColor(p);
      const html = `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:800;font-family:Inter,system-ui">${p.sucursalesVisited || ""}</div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [22, 22], iconAnchor: [11, 11] });
      const popup = `<div style="font-family:Inter,system-ui;min-width:150px">
        <div style="font-weight:700;margin-bottom:2px">${p.name}</div>
        <div style="color:#666;font-size:12px;margin-bottom:6px">${p.estado || "Sin estado"} · ${p.status === "in" ? "En sucursal" : "Cerró visitas"}</div>
        <div style="font-size:12px">${products.filter((pr) => p.byProduct?.[pr.id]).map((pr) => `${pr.nombre}: <b>${fmtNum(p.byProduct[pr.id])}</b>`).join(" · ") || "Sin ventas"}</div>
        <div style="font-size:12px;margin-top:2px">Vendido: <b>${fmtMoney(p.money)}</b></div>
      </div>`;
      const marker = L.marker([p.lat, p.lng], { icon }).bindPopup(popup).addTo(layer);
      if (onSelect) marker.on("click", () => onSelect(p));
      pts.push([p.lat, p.lng]);
    }
    if (pts.length === 1) {
      mapRef.current.setView(pts[0], 9);
    } else if (pts.length > 1) {
      try { mapRef.current.fitBounds(pts, { padding: [40, 40], maxZoom: 11 }); } catch { /* noop */ }
    }
  }, [L, retryKey, promoters, onSelect, products]);

  if (failed) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 20, textAlign: "center", background: COLORS.surface }}>
        <MapPin size={24} color={COLORS.accentText} />
        <span style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.5 }}>
          El mapa no cargó con esta conexión. El listado y las gráficas sí funcionan.
        </span>
        <button onClick={retry} style={{ padding: "6px 14px", borderRadius: 9, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Reintentar
        </button>
      </div>
    );
  }
  return <div ref={elRef} style={{ height: "100%", width: "100%", background: COLORS.surface2 }} />;
}

// ---------------------------------------------------------------------------
// Gráfica de barras horizontales (SVG en línea, sin dependencias).
// ---------------------------------------------------------------------------
export function BarChart({ data, color, format }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) {
    return <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "8px 0" }}>Sin datos para mostrar.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {data.map((d, i) => (
        <div key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 8 }}>
            <span style={{ fontSize: 12, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, fontFamily: "JetBrains Mono", flexShrink: 0 }}>{format(d.value)}</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: COLORS.surface2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round((d.value / max) * 100)}%`, minWidth: d.value > 0 ? 4 : 0, borderRadius: 999, background: color || COLORS.accent, transition: "width .4s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Cuadrito con la cantidad de UN producto.
export function CountBox({ label, value }) {
  return (
    <div style={{ flex: 1, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "6px 8px", textAlign: "center", minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text, fontFamily: "JetBrains Mono", lineHeight: 1.1 }}>{fmtNum(value)}</div>
      <div style={{ fontSize: 9.5, letterSpacing: "0.06em", color: COLORS.textMuted, fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

// Un cuadrito por producto del catálogo (cantidad vendida por ese promotor).
export function ProductCountBoxes({ p, products = [] }) {
  if (!products.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, width: Math.min(products.length, 3) * 58, flexShrink: 0 }}>
      {products.map((pr) => (
        <CountBox key={pr.id} label={pr.nombre} value={p.byProduct?.[pr.id] || 0} />
      ))}
    </div>
  );
}

// KPI de la tira superior. `tooltip` (opcional) se muestra al hacer hover
// (title nativo del navegador) explicando qué mide el indicador. `onClick`
// (opcional) lo vuelve interactivo: al hacer clic filtra el listado/mapa por
// lo que representa ese KPI (ver `kpiFilter` en ManagerDashboard); `active`
// resalta el KPI cuando su filtro es el que está aplicado ahora mismo.
export function Kpi({ icon: Icon, label, value, accent, tooltip, onClick, active }) {
  return (
    <div
      onClick={onClick}
      title={tooltip}
      style={{
        flex: "1 0 auto", minWidth: 128, background: active ? COLORS.accentSoft : COLORS.surface,
        border: `1px solid ${active ? COLORS.accent : COLORS.border}`, borderRadius: 12, padding: "10px 12px",
        cursor: onClick ? "pointer" : "default", transition: "background .15s ease, border-color .15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Icon size={13} color={accent || active ? COLORS.accentText : COLORS.textMuted} />
        <span style={{ fontSize: 10, letterSpacing: "0.06em", color: COLORS.textMuted, fontWeight: 600, textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: accent || active ? COLORS.accentText : COLORS.text, fontFamily: "JetBrains Mono", lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

export function ChartCard({ title, children }) {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: COLORS.textMuted, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

// Barra de progreso de meta SEMANAL (unidades-equivalentes: cantidad × equivalencia
// de cada producto, ver Productos en el Sheet). `goal` = { target, achieved, reached } | null.
export function GoalBar({ goal }) {
  if (!goal) return null;
  const pct = Math.min(100, Math.round((goal.achieved / goal.target) * 100));
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: goal.reached ? COLORS.success : COLORS.textMuted, fontWeight: 700, marginBottom: 3 }}>
        <span>META DE LA SEMANA {goal.reached ? "· ¡ALCANZADA!" : ""}</span>
        <span>{fmtNum(goal.achieved)}/{fmtNum(goal.target)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: COLORS.surface2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, minWidth: pct > 0 ? 4 : 0, borderRadius: 999, background: goal.reached ? COLORS.success : COLORS.accent, transition: "width .4s ease" }} />
      </div>
    </div>
  );
}

// Fila de un promotor en el listado. `onClick` (opcional) abre su perfil.
// `onEditGoal` (opcional, SOLO lo pasa el tablero de admin/gerente) muestra un
// botón para fijar/cambiar su meta semanal — el supervisor solo la ve.
// `hour12` (default true): el tablero de admin pasa `false` para mostrar
// "entró/salió" en formato 24h; supervisor no lo pasa y se queda en 12h.
export function PromoterRow({ p, onClick, onEditGoal, hour12 = true, products = [] }) {
  const color = salesColor(p);
  const initials = (p.name || p.id || "?").split(" ").map((n) => n[0]).slice(0, 2).join("");
  return (
    <div
      onClick={onClick ? () => onClick(p) : undefined}
      style={{ display: "flex", alignItems: "center", gap: 11, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "10px 12px", cursor: onClick ? "pointer" : "default" }}
    >
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: COLORS.accentSoft, color: COLORS.accentText, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800 }}>
          {initials}
        </div>
        <span style={{ position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: "50%", background: color, border: `2px solid ${COLORS.surface}` }} title={p.pieces > 0 ? "Con ventas" : "Sin ventas"} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
          {onEditGoal && (
            <button
              onClick={(e) => { e.stopPropagation(); onEditGoal(p); }}
              title="Fijar meta semanal"
              style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 3, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 999, padding: "2px 7px", color: COLORS.textMuted, fontSize: 10, fontWeight: 700, cursor: "pointer" }}
            >
              <Target size={10} /> Meta
            </button>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: COLORS.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.status === "missing"
            ? `${p.estado || "Sin estado"} · Sin visita hoy`
            : `${p.estado || "Sin estado"} · ${p.status === "in" ? "En sucursal" : "Cerró"} · entró ${fmtTime(p.checkInTime, hour12)} · salió ${fmtTime(p.checkOutTime, hour12)}`}
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: COLORS.accentText, fontFamily: "JetBrains Mono", marginTop: 2 }}>{fmtMoney(p.money)}</div>
        <GoalBar goal={p.goal} />
      </div>
      <ProductCountBoxes p={p} products={products} />
    </div>
  );
}
// Modal para fijar la meta SEMANAL personalizada (en unidades equivalentes)
// de un promotor, como excepción al default de 30/semana. Solo lo abre
// unidad equivalente) de un promotor, como excepción al default de 30/semana. Solo lo abre
// el tablero de admin/gerente (ver el botón "Meta" en PromoterRow).
// `onSave(meta)` recibe el número ya validado; el llamador hace la petición y
// refresca.
export function EditGoalModal({ promoter, onSave, onClose, saving }) {
  const [value, setValue] = useState(String(promoter.goal?.target ?? ""));
  const [err, setErr] = useState("");

  function submit() {
    const meta = Number(value);
    if (!Number.isFinite(meta) || meta <= 0) {
      setErr("Ingresa un número mayor a 0.");
      return;
    }
    setErr("");
    onSave(meta);
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, width: "min(360px, 100%)", padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Target size={16} color={COLORS.accentText} />
          <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>Meta semanal</span>
        </div>
        <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "4px 0 14px" }}>{promoter.name} · unidades equivalentes en la semana (cada producto pesa según su equivalencia en la pestaña Productos). Default sin meta propia: 30.</p>
        <input
          type="number"
          min="1"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Ej. 40"
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 15, fontFamily: "JetBrains Mono" }}
        />
        {err && <p style={{ color: COLORS.danger, fontSize: 12, margin: "8px 0 0" }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.text, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontWeight: 700, fontSize: 13.5, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Exportación CSV / Excel -------------------------------------------------
// Encabezados del CSV/Excel: una columna por producto del catálogo.
export function buildExportHeaders(products = []) {
  return [
    "ID", "Promotor", "Supervisor", "Estado", "Cliente", "ID Sucursal", "Sucursal", "Día", "Entrada", "Salida",
    ...products.map((pr) => pr.nombre),
    "Unidades", "Dinero",
  ];
}

// Una fila (arreglo alineado con buildExportHeaders) por visita de cada promotor.
export function buildExportRows(promoters, products = [], hour12 = true) {
  return promoters.flatMap((p) =>
    (p.visits ?? []).map((v) => {
      const qty = new Map((v.items ?? []).map((i) => [i.productoId, i.cantidad]));
      return [
        p.id,
        p.name,
        p.supervisor || "Sin supervisor",
        // Estado DEL PROMOTOR (columna "Estado" de la pestaña Promotores, fijo
        // por promotor) — no el de la sucursal visitada (v.estado), a propósito:
        // mismo criterio que el filtro de estado del tablero.
        p.estado || "Sin estado",
        v.clienteNombre || "",
        v.sucursalId,
        v.sucursalName,
        v.day || "",
        fmtDateTime(v.checkInTime, hour12),
        fmtDateTime(v.checkOutTime, hour12),
        ...products.map((pr) => qty.get(pr.id) ?? 0),
        v.units,
        v.money,
      ];
    })
  );
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(headers, rows, filename) {
  if (!rows.length) return;
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const r of rows) lines.push(r.map(escape).join(","));
  // BOM al inicio: para que Excel detecte UTF-8 y no rompa los acentos/ñ.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  triggerBlobDownload(blob, filename);
}

// Carga la librería de Excel solo cuando se pide (nunca la descarga un
// promotor de campo: ninguno de estos componentes se monta para ellos).
export async function downloadXlsx(headers, rows, filename) {
  if (!rows.length) return;
  const XLSX = await import("xlsx");
  const data = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Visitas");
  XLSX.writeFile(wb, filename);
}

// Cabecera del panel (lista de promotores / colapsar / maximizar).
export function PanelHeader({ isDesktop, panelMode, count, total, onToggleCollapse, onToggleMax, title = "Promotores activos", icon: Icon }) {
  const isCollapsed = panelMode === "collapsed";
  const isMax = panelMode === "max";

  // Colapsado en escritorio: el panel se desliza fuera de la pantalla y solo
  // deja una franja de 46px visible (ver `panelStyle` en el tablero). La
  // cabecera normal (título a la izquierda, botones a la derecha en una fila
  // de 400px) queda con sus botones fuera de esa franja — inalcanzable. Esta
  // variante compacta, en columna, sí cabe dentro de los 46px visibles.
  if (isDesktop && isCollapsed) {
    return (
      <div style={{ width: 46, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "14px 0", flexShrink: 0 }}>
        <button
          onClick={onToggleCollapse}
          title="Mostrar listado"
          style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <ChevronLeft size={16} />
        </button>
        {Icon && <Icon size={16} color={COLORS.accentText} />}
        <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.accentText, background: COLORS.accentSoft, borderRadius: 999, padding: "2px 7px", writingMode: "vertical-rl" }}>
          {count}{count !== total ? `/${total}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: isCollapsed ? "none" : `1px solid ${COLORS.border}`, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {Icon && <Icon size={16} color={COLORS.accentText} />}
        <span style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.text, whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.accentText, background: COLORS.accentSoft, borderRadius: 999, padding: "2px 8px" }}>
          {count}{count !== total ? `/${total}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <MaximizeButton isMax={isMax} onClick={onToggleMax} />
        <CollapseButton isDesktop={isDesktop} isCollapsed={isCollapsed} onClick={onToggleCollapse} />
      </div>
    </div>
  );
}

function MaximizeButton({ isMax, onClick }) {
  return (
    <button
      onClick={onClick}
      title={isMax ? "Restaurar" : "Maximizar (ver gráficas)"}
      style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: isMax ? COLORS.accentSoft : COLORS.surface2, color: isMax ? COLORS.accentText : COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
    >
      {isMax ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
    </button>
  );
}
function CollapseButton({ isDesktop, isCollapsed, onClick }) {
  return (
    <button
      onClick={onClick}
      title={isCollapsed ? "Mostrar listado" : "Colapsar"}
      style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
    >
      {isDesktop
        ? (isCollapsed ? <ChevronDown size={15} style={{ transform: "rotate(90deg)" }} /> : <ChevronUp size={15} style={{ transform: "rotate(90deg)" }} />)
        : (isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
    </button>
  );
}
