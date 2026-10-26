// ---------------------------------------------------------------------------
// Campana de notificaciones — admin/gerente y supervisor.
// ---------------------------------------------------------------------------
// Pide GET /api/notifications al montar y cada 30s (centro de notificaciones
// "en la app": no hay push real al teléfono, ver decisión en el chat). Muestra
// un punto rojo cuando hay algo nuevo desde la última vez que se abrió.
//
// Solo trae las notificaciones de HOY (antes traía hasta 50 sin importar el
// día — con el polling cada 30s eso era releer y re-resolver fotos de
// notificaciones de hace semanas, todo el tiempo). "Ver historial completo"
// abre NotificationsHistory, con los días anteriores paginados aparte.
import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, TrendingUp, History } from "lucide-react";
import { api } from "./lib/api.js";
import { COLORS } from "./theme.js";
import { fmtMoney, fmtNum } from "./dashboardShared.jsx";
import { iconFor, timeAgo } from "./lib/notificationsFormat.js";
import NotificationsHistory from "./NotificationsHistory.jsx";

const POLL_MS = 30000;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], insight: null });
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const [zoomSrc, setZoomSrc] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const boxRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.notifications();
      setData(res);
    } catch {
      // Silencioso: la campana no debe mostrar errores encima del tablero.
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const unseenCount = data.notifications.filter((n) => new Date(n.fecha).getTime() > seenAt).length;

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) setSeenAt(Date.now());
      return next;
    });
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={toggle}
        title="Notificaciones"
        style={{ position: "relative", width: 36, height: 36, borderRadius: 9, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <Bell size={16} />
        {unseenCount > 0 && (
          <span style={{ position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 999, background: COLORS.danger, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", top: 44, right: 0, width: 320, maxHeight: 420, overflowY: "auto", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.28)", zIndex: 900 }}>
          {data.insight && (
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.accentSoft }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: COLORS.accentText, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                <TrendingUp size={13} /> {data.insight.label}
              </div>
              {data.insight.top.length === 0 ? (
                <p style={{ fontSize: 12, color: COLORS.textMuted, margin: 0 }}>Aún no hay ventas hoy.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {data.insight.top.map((p, i) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }}>{i + 1}. {p.name}</span>
                      <span style={{ fontWeight: 700, color: COLORS.text, fontFamily: "JetBrains Mono" }}>{p.money > 0 ? fmtMoney(p.money) : `${fmtNum(p.units)} u.`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {data.notifications.length === 0 ? (
            <p style={{ fontSize: 12.5, color: COLORS.textMuted, padding: "20px 14px", textAlign: "center", margin: 0 }}>Sin notificaciones todavía.</p>
          ) : (
            data.notifications.map((n, i) => {
              const Icon = iconFor(n.tipo);
              return (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ width: 26, height: 26, borderRadius: 999, background: COLORS.surface2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    <Icon size={13} color={COLORS.accentText} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12.5, color: COLORS.text, margin: 0, lineHeight: 1.4 }}>{n.detalle}</p>
                    <span style={{ fontSize: 10.5, color: COLORS.textMuted }}>{timeAgo(n.fecha)}</span>
                  </div>
                  {n.photo && (
                    <button
                      onClick={() => setZoomSrc(n.photo)}
                      title="Ver foto del check-in"
                      style={{ position: "relative", width: 36, height: 36, borderRadius: 8, overflow: "hidden", border: `1px solid ${COLORS.border}`, padding: 0, cursor: "pointer", background: COLORS.surface2, flexShrink: 0 }}
                    >
                      <img src={n.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </button>
                  )}
                </div>
              );
            })
          )}

          <button
            onClick={() => { setShowHistory(true); setOpen(false); }}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", background: "none", border: "none", borderTop: `1px solid ${COLORS.border}`, color: COLORS.accentText, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            <History size={13} /> Ver historial completo
          </button>
        </div>
      )}

      {zoomSrc && (
        <div
          onClick={(e) => { e.stopPropagation(); setZoomSrc(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}
        >
          <img src={zoomSrc} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}

      {showHistory && <NotificationsHistory onClose={() => setShowHistory(false)} />}
    </div>
  );
}
