// ---------------------------------------------------------------------------
// "Mis tickets" del promotor — cada reporte que abre con "Reportar" es un
// ticket con su propio hilo de seguimiento: el promotor puede agregar
// comentarios y un administrador le responde ahí mismo. No es un chat en vivo:
// se ve al abrirlo (o con "Actualizar"), y la lista marca con un punto los
// tickets con una respuesta nueva.
// ---------------------------------------------------------------------------
// Se renderiza DENTRO de una pantalla de PromotoresApp (que pone la barra
// superior y el botón de regresar); este componente solo es el contenido.
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { api, ApiError } from "./lib/api.js";
import { COLORS } from "./theme.js";
import ThreadView, { fmtStamp } from "./ThreadView.jsx";
import { threadNeedsAttention } from "./lib/threads.js";

function StatusChip({ status }) {
  const open = status === "abierto";
  const c = open ? COLORS.success : COLORS.textMuted;
  return <span style={{ fontSize: 10, fontWeight: 700, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "0 7px", flexShrink: 0 }}>{open ? "Abierto" : "Cerrado"}</span>;
}

export default function PromoterTickets({ user, initialTicketId, threads, onExit }) {
  const { seen, markSeen, reload } = threads;
  const [openId, setOpenId] = useState(initialTicketId || null);
  const [ticket, setTicket] = useState(null); // datos del ticket abierto (se refrescan al cargar el hilo)

  const [tickets, setTickets] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api.tickets();
      setTickets(r.tickets ?? []);
      setHasMore(Boolean(r.hasMore));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar tus tickets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!openId) loadList();
  }, [openId, loadList]);

  async function loadMore() {
    const last = tickets[tickets.length - 1];
    if (!last || loading) return;
    setLoading(true);
    try {
      const r = await api.tickets({ before: last.lastCommentAt });
      setTickets((prev) => [...prev, ...(r.tickets ?? [])]);
      setHasMore(Boolean(r.hasMore));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar más tickets.");
    } finally {
      setLoading(false);
    }
  }

  const loadThread = useCallback(
    ({ before, limit } = {}) =>
      api.ticket(openId, { before, limit }).then((r) => {
        setTicket(r.ticket);
        return { comments: r.comments, hasMore: r.hasMore };
      }),
    [openId]
  );
  const sendThread = useCallback((text) => api.sendTicketComment(openId, text), [openId]);

  function openTicket(t) {
    setTicket(t);
    setOpenId(t.id);
  }
  function back() {
    setOpenId(null);
    setTicket(null);
    reload();
  }

  // --- Detalle de un ticket ---
  if (openId) {
    const closed = ticket?.status === "cerrado";
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 190px)", minHeight: 380 }}>
        <button onClick={back} style={{ background: "none", border: "none", color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 12, alignSelf: "flex-start" }}>
          <ArrowLeft size={15} /> Mis tickets
        </button>
        {ticket && (
          <div style={{ marginBottom: 12, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ fontFamily: "Space Grotesk", fontSize: 17, fontWeight: 600, color: COLORS.text, margin: 0 }}>{ticket.sucursal || "Ticket"}</h2>
              <StatusChip status={ticket.status} />
            </div>
            <p style={{ fontSize: 11.5, color: COLORS.textMuted, margin: "3px 0 0" }}>Abierto el {fmtStamp(ticket.createdAt, true)}</p>
          </div>
        )}
        <ThreadView
          threadKey={`ticket:${openId}`}
          load={loadThread}
          send={sendThread}
          meId={user.id}
          canWrite={!closed}
          blockedMessage="Este ticket está cerrado. Si el problema sigue, abre uno nuevo con «Reportar»."
          placeholder="Agrega un comentario al ticket…"
          emptyText="Todavía no hay comentarios."
          onLatest={(iso) => markSeen(`ticket:${openId}`, iso)}
        />
      </div>
    );
  }

  // --- Lista de tickets ---
  return (
    <div>
      {onExit && (
        <button onClick={onExit} style={{ background: "none", border: "none", color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14 }}>
          <ArrowLeft size={15} /> Inicio
        </button>
      )}
      <h2 style={{ fontFamily: "Space Grotesk", fontSize: 20, fontWeight: 600, color: COLORS.text, margin: "0 0 4px" }}>Mis tickets</h2>
      <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "0 0 16px", lineHeight: 1.5 }}>
        Cada reporte que envías con «Reportar» abre un ticket. Aquí puedes darle seguimiento: agregas comentarios y un administrador te responde.
      </p>

      {loading && tickets.length === 0 && <p style={{ color: COLORS.textMuted, fontSize: 13 }}>Cargando…</p>}
      {error && <p style={{ color: COLORS.danger, fontSize: 13 }}>{error}</p>}
      {!loading && !error && tickets.length === 0 && (
        <p style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 1.5 }}>Todavía no tienes tickets. Cuando envíes un reporte con «Reportar», aparecerá aquí.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tickets.map((t) => {
          const unread = threadNeedsAttention(t, `ticket:${t.id}`, seen, "user");
          return (
            <button
              key={t.id}
              onClick={() => openTicket(t)}
              style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: COLORS.surface, border: `1px solid ${unread ? COLORS.accent : COLORS.border}`, borderRadius: 12, padding: "11px 13px", cursor: "pointer" }}
            >
              {unread ? <span style={{ width: 9, height: 9, borderRadius: 999, background: COLORS.danger, flexShrink: 0 }} title="Respuesta nueva" /> : <span style={{ width: 9, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.text }}>{t.sucursal}</span>
                  <StatusChip status={t.status} />
                </div>
                <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                <div style={{ fontSize: 10.5, color: COLORS.textMuted, marginTop: 3, fontFamily: "JetBrains Mono" }}>
                  {unread ? "Respuesta nueva · " : ""}{fmtStamp(t.lastCommentAt, true)}
                </div>
              </div>
              <ChevronRight size={15} color={COLORS.textMuted} />
            </button>
          );
        })}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loading}
            style={{ alignSelf: "center", padding: "7px 16px", borderRadius: 999, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.textMuted, fontSize: 12, fontWeight: 600, cursor: loading ? "default" : "pointer" }}
          >
            {loading ? "Cargando…" : "Ver más tickets"}
          </button>
        )}
      </div>
    </div>
  );
}
