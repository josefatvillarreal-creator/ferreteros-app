// ---------------------------------------------------------------------------
// Historial completo de notificaciones — modal aparte, abierto desde "Ver
// historial completo" en NotificationBell. La campana solo muestra HOY; este
// modal trae los días anteriores, PAGINADOS POR DÍA (no por notificación),
// 7 días por página por default, con selector para cambiar cuántos días trae
// cada página. Mismo patrón que el historial de check-in/check-out del
// promotor y del PromoterProfile — ver esos dos para la razón de fondo
// (evitar traer meses de datos de golpe).
import { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft, Bell } from "lucide-react";
import { api, ApiError } from "./lib/api.js";
import { COLORS } from "./theme.js";
import { iconFor, timeAgo } from "./lib/notificationsFormat.js";

const DAYS_PER_PAGE_OPTIONS = [7, 14, 30];

function fmtDayHeader(day) {
  const [y, m, d] = String(day).split("-").map(Number);
  if (!y || !m || !d) return day || "Sin fecha";
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function NotificationsHistory({ onClose }) {
  const [page, setPage] = useState(1);
  const [daysPerPage, setDaysPerPage] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [zoomSrc, setZoomSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .notificationsHistory({ page, daysPerPage })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "No se pudo cargar el historial."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, daysPerPage]);

  function changeDaysPerPage(n) {
    setDaysPerPage(n);
    setPage(1);
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.surface, borderRadius: 16, width: "min(440px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bell size={16} color={COLORS.accentText} />
            <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>Historial de notificaciones</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, display: "flex" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Días por página</span>
            <select
              value={daysPerPage}
              onChange={(e) => changeDaysPerPage(Number(e.target.value))}
              style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "5px 8px", color: COLORS.text, fontSize: 12, fontWeight: 600 }}
            >
              {DAYS_PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} días</option>
              ))}
            </select>
          </div>

          {loading && <p style={{ color: COLORS.textMuted, fontSize: 13 }}>Cargando…</p>}
          {error && <p style={{ color: COLORS.danger, fontSize: 13 }}>{error}</p>}

          {!loading && !error && data && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {data.days.length === 0 ? (
                <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0 }}>
                  {page === 1 ? "Sin notificaciones registradas." : "No hay más historial."}
                </p>
              ) : (
                data.days.map(({ day, notifications }) => (
                  <div key={day}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                      {fmtDayHeader(day)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {notifications.map((n, i) => {
                        const Icon = iconFor(n.tipo);
                        return (
                          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: COLORS.surface2, borderRadius: 10, padding: "9px 11px" }}>
                            <div style={{ width: 24, height: 24, borderRadius: 999, background: COLORS.surface, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                              <Icon size={12} color={COLORS.accentText} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 12.5, color: COLORS.text, margin: 0, lineHeight: 1.4 }}>{n.detalle}</p>
                              <span style={{ fontSize: 10.5, color: COLORS.textMuted }}>{timeAgo(n.fecha)}</span>
                            </div>
                            {n.photo && (
                              <button
                                onClick={() => setZoomSrc(n.photo)}
                                title="Ver foto del check-in"
                                style={{ position: "relative", width: 32, height: 32, borderRadius: 8, overflow: "hidden", border: `1px solid ${COLORS.border}`, padding: 0, cursor: "pointer", background: COLORS.surface, flexShrink: 0 }}
                              >
                                <img src={n.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}

              {(page > 1 || data.hasMore) && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${COLORS.border}` }}>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 10px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "transparent", color: page === 1 ? COLORS.textMuted : COLORS.text, fontSize: 12, fontWeight: 600, cursor: page === 1 ? "default" : "pointer", opacity: page === 1 ? 0.5 : 1 }}
                  >
                    <ChevronLeft size={14} /> Anterior
                  </button>
                  <span style={{ fontSize: 11.5, color: COLORS.textMuted }}>Página {page}</span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!data.hasMore}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 10px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "transparent", color: !data.hasMore ? COLORS.textMuted : COLORS.text, fontSize: 12, fontWeight: 600, cursor: !data.hasMore ? "default" : "pointer", opacity: !data.hasMore ? 0.5 : 1 }}
                  >
                    Siguiente <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {zoomSrc && (
        <div
          onClick={(e) => { e.stopPropagation(); setZoomSrc(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}
        >
          <img src={zoomSrc} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
