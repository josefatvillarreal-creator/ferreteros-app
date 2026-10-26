// ---------------------------------------------------------------------------
// SupervisorDashboard — tablero del SUPERVISOR.
// ---------------------------------------------------------------------------
// Igual estructura que ManagerDashboard (mismo mapa, mismas gráficas, mismos
// filtros), pero:
//   - Solo ve a SUS promotores (el servidor ya los filtra por su ID de sesión
//     contra la columna SUPERVISOR de la pestaña Promotores).
//   - Cada promotor muestra su avance de META MENSUAL (unidades).
//   - La campana de notificaciones le avisa cuando alguno hace check-in y
//     cuando alguno alcanza su meta.
//   - Al final del día (todos con check-out) puede maximizar y ver el mismo
//     resumen con gráficas que usa el administrador, acotado a su equipo.
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  LogOut, RefreshCw, Search, HelpCircle,
  Users, MapPin, TrendingUp, AlertTriangle, DollarSign, Store, X, Download, Target, Bell, UserCheck, UserX,
} from "lucide-react";
import { useAuth } from "./auth/AuthProvider.jsx";
import { api, ApiError } from "./lib/api.js";
import { COLORS, detectScheme, applyScheme } from "./theme.js";
import {
  fmtMoney, fmtMoneyCompact, fmtNum, todayStamp, RANGE_OPTIONS, RANGE_LABELS, MEXICO_ESTADOS,
  bgTexture, Brand, NationalMap, BarChart, Kpi, ChartCard, PromoterRow, PanelHeader,
  buildExportRows, downloadCsv, downloadXlsx,
} from "./dashboardShared.jsx";
import NotificationBell from "./NotificationBell.jsx";
import PromoterProfile from "./PromoterProfile.jsx";
import CompetenciaPanel from "./CompetenciaPanel.jsx";
import SupervisorChat from "./SupervisorChat.jsx";
import OnboardingTour, { useOnboarding } from "./OnboardingTour.jsx";

// Onboarding del SUPERVISOR — sube la versión cuando se agreguen features.
const ONBOARDING_KEY_SUPERVISOR = "onboarding_seen_v1_supervisor";
const ONBOARDING_STEPS_SUPERVISOR = [
  {
    icon: Users,
    title: "Bienvenido, tienes tu propio tablero",
    body: "Como supervisor, ves el mismo mapa y resumen que el administrador, pero acotado a TU equipo.",
  },
  {
    icon: Target,
    title: "La meta de tu equipo",
    body: "Cada promotor muestra su meta semanal (30 rollos-equivalentes por defecto, o la que le fije el administrador) y su avance de la semana.",
  },
  {
    icon: Bell,
    title: "Notificaciones de tu equipo",
    body: "La campana te avisa cuando uno de tus promotores hace check-in (con la tienda y si llegó a tiempo) y cuando alcanza su meta de la semana.",
  },
  {
    icon: MapPin,
    title: "Perfil de cada promotor",
    body: "Haz clic en un promotor (lista o mapa) para ver su historial de check-in/check-out y las tiendas a las que suele ir.",
  },
];

export default function SupervisorDashboard() {
  const { user, logout } = useAuth();
  const onboarding = useOnboarding(ONBOARDING_KEY_SUPERVISOR);

  const [, setScheme] = useState(detectScheme());
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e) => { const s = e.matches ? "light" : "dark"; applyScheme(s); setScheme(s); };
    applyScheme(detectScheme());
    if (mq.addEventListener) mq.addEventListener("change", onChange); else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);

  const [isDesktop, setIsDesktop] = useState(typeof window !== "undefined" ? window.innerWidth >= 900 : true);
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [, setUpdatedAt] = useState(null);
  const [profileId, setProfileId] = useState(null);

  const [panelMode, setPanelMode] = useState("open");
  const [segment, setSegment] = useState("todos");
  const [estado, setEstado] = useState("todos");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("today");
  // Fechas del rango "Personalizado…" (YYYY-MM-DD, del <input type="date">).
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Rollos/cubetas: multi-select (no excluyentes) — ver ManagerDashboard.
  const [unitFilter, setUnitFilter] = useState(() => new Set());
  const toggleUnit = (u) => setUnitFilter((prev) => {
    const next = new Set(prev);
    next.has(u) ? next.delete(u) : next.add(u);
    return next;
  });

  const load = useCallback(async (signal) => {
    if (range === "custom" && (!customFrom || !customTo)) return; // esperando ambas fechas
    setLoading(true);
    setError("");
    try {
      const data = await api.supervisorSummary(range, signal, { from: customFrom, to: customTo });
      setSummary(data);
      setUpdatedAt(new Date());
    } catch (e) {
      if (e?.name === "AbortError") return;
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el resumen. Revisa tu conexión.");
    } finally {
      setLoading(false);
    }
  }, [range, customFrom, customTo]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const promoters = summary?.promoters ?? [];
  const totals = summary?.totals ?? { promoters: 0, sucursalesVisited: 0, rollos: 0, cubetas: 0, money: 0, checkedIn: 0, withoutSales: 0, rosterTotal: 0 };
  const prices = summary?.prices ?? { rollo: 0, cubeta: 0 };
  const useMoney = totals.money > 0;
  // "En su lugar" = con check-in abierto AHORA MISMO, contra el total de
  // promotores de TU equipo (no solo los que tuvieron actividad en el rango).
  const faltanEnTienda = Math.max(0, (totals.rosterTotal || 0) - totals.checkedIn);
  const pctEnTienda = totals.rosterTotal > 0 ? Math.round((totals.checkedIn / totals.rosterTotal) * 100) : 0;

  // Los 32 estados de México siempre completos en el dropdown (no solo los
  // que tengan actividad en el rango actual) — igual que ManagerDashboard.
  const estados = MEXICO_ESTADOS;

  // Promotores de tu equipo SIN check-in abierto ahora mismo — para el
  // listado que abre el KPI "Faltan en tienda". Ver ManagerDashboard.
  const missingPromoters = useMemo(() => {
    const checkedInIds = new Set(promoters.filter((p) => p.status === "in").map((p) => p.id));
    return (summary?.roster ?? [])
      .filter((r) => !checkedInIds.has(r.id))
      .map((r) => ({
        id: r.id, name: r.name, estado: r.estado, supervisor: null,
        rollos: 0, cubetas: 0, money: 0, status: "missing",
        checkInTime: null, checkOutTime: null, goal: null,
        lat: null, lng: null, visits: [],
      }));
  }, [promoters, summary]);

  const filtered = useMemo(() => {
    let list = segment === "faltantes" ? missingPromoters : promoters;
    if (estado !== "todos") list = list.filter((p) => (p.estado || "Sin estado") === estado);
    if (segment === "con") list = list.filter((p) => p.rollos + p.cubetas > 0);
    else if (segment === "sin") list = list.filter((p) => p.rollos + p.cubetas === 0);
    else if (segment === "meta") list = list.filter((p) => p.goal?.reached);
    else if (segment === "in") list = list.filter((p) => p.status === "in");
    if (unitFilter.size > 0) list = list.filter((p) => [...unitFilter].some((u) => p[u] > 0));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => (p.name || "").toLowerCase().includes(q) || String(p.id).includes(q));
    }
    return list;
  }, [promoters, missingPromoters, estado, segment, query, unitFilter]);

  const metric = unitFilter.size > 0
    ? (p) => [...unitFilter].reduce((sum, u) => sum + (p[u] || 0), 0)
    : (p) => (useMoney ? p.money : p.rollos + p.cubetas);
  const metricFmt = unitFilter.size > 0 ? fmtNum : (useMoney ? fmtMoney : fmtNum);
  const UNIT_LABELS = { rollos: "rollos", cubetas: "cubetas" };
  const unitLabel = unitFilter.size > 0
    ? [...unitFilter].map((u) => UNIT_LABELS[u]).join(" + ")
    : (useMoney ? "dinero" : "unidades");
  const topData = useMemo(
    () => [...filtered].sort((a, b) => metric(b) - metric(a)).slice(0, 8).map((p) => ({ label: p.name, value: metric(p) })),
    [filtered, useMoney, unitFilter]
  );
  const estadoData = useMemo(() => {
    const m = new Map();
    for (const p of filtered) {
      const k = p.estado || "Sin estado";
      m.set(k, (m.get(k) || 0) + metric(p));
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [filtered, useMoney, unitFilter]);
  const composicion = useMoney
    ? [
        { label: "Rollos ($)", value: totals.rollos * prices.rollo },
        { label: "Cubetas ($)", value: totals.cubetas * prices.cubeta },
      ]
    : [
        { label: "Rollos", value: totals.rollos },
        { label: "Cubetas", value: totals.cubetas },
      ];
  const metasAlcanzadas = promoters.filter((p) => p.goal?.reached).length;

  const segments = [
    { key: "todos", label: "Todos" },
    { key: "con", label: "Con ventas" },
    { key: "sin", label: "Sin ventas" },
    { key: "in", label: "En tienda" },
    { key: "meta", label: "Con meta alcanzada" },
  ];

  const exportRows = useMemo(() => buildExportRows(filtered), [filtered]);
  const exportFilename = (ext) => `mi-equipo-${range}-${todayStamp()}.${ext}`;

  const isMax = panelMode === "max";
  const isCollapsed = panelMode === "collapsed";
  let panelStyle;
  if (isDesktop) {
    panelStyle = {
      position: "absolute", top: 0, right: 0, bottom: 0,
      width: isMax ? "min(760px, 100%)" : 400,
      transform: isCollapsed ? "translateX(calc(100% - 46px))" : "translateX(0)",
      transition: "transform .28s ease, width .28s ease",
      display: "flex", flexDirection: "column",
      background: COLORS.surface, borderLeft: `1px solid ${COLORS.border}`,
      boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", zIndex: 500,
    };
  } else {
    const h = isMax ? "100%" : isCollapsed ? 132 : "62%";
    panelStyle = {
      position: "absolute", left: 0, right: 0, bottom: 0, height: h,
      transition: "height .28s ease",
      display: "flex", flexDirection: "column",
      background: COLORS.surface, borderTop: `1px solid ${COLORS.border}`,
      borderTopLeftRadius: isMax ? 0 : 18, borderTopRightRadius: isMax ? 0 : 18,
      boxShadow: "0 -8px 24px rgba(0,0,0,0.22)", zIndex: 500,
    };
  }

  function cyclePrimary() {
    setPanelMode((m) => (m === "collapsed" ? "open" : "collapsed"));
  }

  return (
    <div style={{ ...bgTexture(), height: "100dvh", display: "flex", flexDirection: "column", fontFamily: "Inter", overflow: "hidden" }}>
      {/* Encabezado */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Brand />
          <div style={{ borderLeft: `1px solid ${COLORS.border}`, paddingLeft: 12, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.text, whiteSpace: "nowrap" }}>Mi equipo · {RANGE_LABELS[range]}</div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.name || "Supervisor"} · Supervisor
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onboarding.show}
            title="Ver novedades"
            style={{ width: 36, height: 36, borderRadius: 9, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <HelpCircle size={16} />
          </button>
          <NotificationBell />
          <CompetenciaPanel fetcher={api.supervisorCompetencia} photosFetcher={api.supervisorCompetenciaPhotos} />
          <SupervisorChat userId={user.id} />
          <button
            onClick={() => load()}
            disabled={loading}
            title="Actualizar"
            style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.accentSoft, border: `1px solid ${COLORS.accent}`, borderRadius: 9, padding: "7px 11px", color: COLORS.accentText, fontSize: 12.5, fontWeight: 600, cursor: loading ? "default" : "pointer" }}
          >
            <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
            <span style={{ display: isDesktop ? "inline" : "none" }}>{loading ? "Cargando…" : "Actualizar"}</span>
          </button>
          <button
            onClick={logout}
            title="Cerrar sesión"
            style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: "7px 11px", color: COLORS.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            <LogOut size={14} />
            <span style={{ display: isDesktop ? "inline" : "none" }}>Salir</span>
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

      {/* Tira de KPIs — hover explica qué mide; clic filtra el listado (y con
          eso, el mapa) por lo que representa ese indicador. */}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px", overflowX: "auto", flexShrink: 0, borderBottom: `1px solid ${COLORS.border}` }}>
        <Kpi
          icon={DollarSign} label={`Vendido · ${RANGE_LABELS[range]}`} value={fmtMoneyCompact(totals.money)} accent
          tooltip={`${fmtMoney(totals.money)} · suma en dinero de todas las ventas (rollos + cubetas) de tu equipo en este período.`}
          onClick={() => setSegment("con")} active={segment === "con"}
        />
        <Kpi
          icon={TrendingUp} label="Rollos" value={fmtNum(totals.rollos)}
          tooltip="Total de rollos vendidos por tu equipo en este período. Clic para filtrar — puedes combinarlo con cubetas."
          onClick={() => toggleUnit("rollos")} active={unitFilter.has("rollos")}
        />
        <Kpi
          icon={TrendingUp} label="Cubetas" value={fmtNum(totals.cubetas)}
          tooltip="Total de cubetas vendidas por tu equipo en este período. Clic para filtrar — puedes combinarlo con rollos."
          onClick={() => toggleUnit("cubetas")} active={unitFilter.has("cubetas")}
        />
        <Kpi
          icon={Users} label="Mi equipo activo" value={fmtNum(totals.promoters)}
          tooltip="Promotores de tu equipo con al menos una visita registrada en este período."
          onClick={() => setSegment("todos")} active={segment === "todos"}
        />
        <Kpi
          icon={MapPin} label="En tienda" value={fmtNum(totals.checkedIn)}
          tooltip="Promotores de tu equipo que ya hicieron check-in y siguen sin hacer check-out."
          onClick={() => setSegment("in")} active={segment === "in"}
        />
        <Kpi
          icon={Store} label="Tiendas" value={fmtNum(totals.sucursalesVisited)}
          tooltip="Número de tiendas distintas visitadas por tu equipo en este período."
          onClick={() => setSegment("todos")}
        />
        <Kpi
          icon={AlertTriangle} label="Metas alcanzadas" value={fmtNum(metasAlcanzadas)} accent={metasAlcanzadas > 0}
          tooltip="Promotores de tu equipo que ya llegaron a su meta semanal de unidades."
          onClick={() => setSegment("meta")} active={segment === "meta"}
        />
        <Kpi
          icon={UserX} label="Faltan en tienda" value={fmtNum(faltanEnTienda)}
          tooltip="Promotores de tu equipo que AHORA MISMO no tienen un check-in abierto (sobre el total de tu equipo, no solo los activos en este período). Clic para ver quiénes son."
          onClick={() => setSegment("faltantes")} active={segment === "faltantes"}
        />
        <Kpi
          icon={UserCheck} label="% en su lugar" value={`${pctEnTienda}%`}
          tooltip={`${fmtNum(totals.checkedIn)} de ${fmtNum(totals.rosterTotal)} promotores de tu equipo tienen un check-in abierto ahora mismo.`}
          onClick={() => setSegment("in")} active={segment === "in"}
        />
      </div>

      {/* Cuerpo: mapa + panel */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <NationalMap promoters={filtered} onSelect={(p) => setProfileId(p.id)} />
        </div>

        {error && (
          <div style={{ position: "absolute", top: 12, left: 12, right: isDesktop ? 420 : 12, zIndex: 400, display: "flex", gap: 8, alignItems: "flex-start", background: COLORS.dangerSoft, color: COLORS.danger, borderRadius: 10, padding: "10px 12px", fontSize: 12.5 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Panel de listado / gráficas */}
        <div style={panelStyle}>
          <PanelHeader
            isDesktop={isDesktop}
            panelMode={panelMode}
            count={filtered.length}
            total={segment === "faltantes" ? missingPromoters.length : promoters.length}
            icon={segment === "faltantes" ? UserX : Users}
            title={segment === "faltantes" ? "Promotores faltantes" : "Mis promotores"}
            onToggleCollapse={cyclePrimary}
            onToggleMax={() => setPanelMode((m) => (m === "max" ? "open" : "max"))}
          />

          {!isCollapsed && (
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 14px 16px" }}>
              {/* Filtros */}
              <div style={{ position: "sticky", top: 0, background: COLORS.surface, paddingTop: 10, paddingBottom: 10, zIndex: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "8px 10px", marginBottom: 8 }}>
                  <Search size={15} color={COLORS.textMuted} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar promotor por nombre o ID"
                    style={{ background: "transparent", border: "none", outline: "none", color: COLORS.text, fontSize: 13.5, width: "100%" }}
                  />
                  {query && (
                    <button onClick={() => setQuery("")} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, display: "flex" }}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {segments.map((s) => {
                    const active = segment === s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => setSegment(s.key)}
                        style={{ padding: "6px 11px", borderRadius: 999, border: `1px solid ${active ? COLORS.accent : COLORS.border}`, background: active ? COLORS.accentSoft : "transparent", color: active ? COLORS.accentText : COLORS.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                  <select
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                    style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 12, fontWeight: 600, cursor: "pointer", maxWidth: 160 }}
                  >
                    <option value="todos">Todos los estados</option>
                    {estados.map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Gráficas (solo en vista maximizada): el "resumen del día" que
                  ve el supervisor cuando su equipo ya cerró, igual que admin. */}
              {isMax && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <select
                      value={range}
                      onChange={(e) => setRange(e.target.value)}
                      style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      {RANGE_OPTIONS.map((r) => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                    {range === "custom" && (
                      <>
                        <input
                          type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} max={customTo || undefined}
                          style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 12.5 }}
                        />
                        <span style={{ color: COLORS.textMuted, fontSize: 12 }}>a</span>
                        <input
                          type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} min={customFrom || undefined}
                          style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 12.5 }}
                        />
                      </>
                    )}
                    <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                      <button
                        onClick={() => downloadCsv(exportRows, exportFilename("csv"))}
                        disabled={!exportRows.length}
                        title="Descargar CSV de lo que se está viendo"
                        style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "7px 11px", color: exportRows.length ? COLORS.text : COLORS.textMuted, fontSize: 12, fontWeight: 600, cursor: exportRows.length ? "pointer" : "default", opacity: exportRows.length ? 1 : 0.5 }}
                      >
                        <Download size={13} /> CSV
                      </button>
                      <button
                        onClick={() => downloadXlsx(exportRows, exportFilename("xlsx"))}
                        disabled={!exportRows.length}
                        title="Descargar Excel de lo que se está viendo"
                        style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "7px 11px", color: exportRows.length ? COLORS.text : COLORS.textMuted, fontSize: 12, fontWeight: 600, cursor: exportRows.length ? "pointer" : "default", opacity: exportRows.length ? 1 : 0.5 }}
                      >
                        <Download size={13} /> Excel
                      </button>
                    </div>
                  </div>
                  <ChartCard title={`Top de mi equipo (${unitLabel})`}>
                    <BarChart data={topData} color={COLORS.accent} format={metricFmt} />
                  </ChartCard>
                  <ChartCard title={`Ventas por estado (${unitLabel})`}>
                    <BarChart data={estadoData} color={COLORS.success} format={metricFmt} />
                  </ChartCard>
                  <ChartCard title="Composición del período">
                    <BarChart data={composicion} color={COLORS.accentText} format={useMoney ? fmtMoney : fmtNum} />
                  </ChartCard>
                </div>
              )}

              {/* Listado de promotores */}
              {loading && promoters.length === 0 ? (
                <p style={{ color: COLORS.textMuted, fontSize: 13, padding: "12px 2px" }}>Cargando tu equipo…</p>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "28px 12px", color: COLORS.textMuted }}>
                  <Users size={26} style={{ opacity: 0.5 }} />
                  <p style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
                    {promoters.length === 0 ? "Ninguno de tus promotores tiene actividad en este período." : "Ningún promotor coincide con el filtro."}
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filtered.map((p) => (
                    <PromoterRow key={p.id} p={p} onClick={(pp) => setProfileId(pp.id)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {profileId && <PromoterProfile promoterId={profileId} onClose={() => setProfileId(null)} />}
      {onboarding.open && <OnboardingTour steps={ONBOARDING_STEPS_SUPERVISOR} onClose={onboarding.dismiss} />}
    </div>
  );
}
