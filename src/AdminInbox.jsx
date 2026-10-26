// ---------------------------------------------------------------------------
// Bandeja de la ADMINISTRACIÓN — un botón en el encabezado que abre dos
// listas: los chats con cada supervisor y los tickets de los promotores.
// Cada uno se abre como un hilo tipo foro (comentarios con fecha y hora, no
// chat en vivo) donde el administrador lee y responde. El punto del botón
// cuenta lo PENDIENTE de responder (el último en hablar fue un supervisor o un
// promotor), y los tickets se pueden cerrar y reabrir.
import { useState, useEffect, useCallback } from "react";
import { Inbox, X, ArrowLeft, ChevronRight, Lock, Unlock } from "lucide-react";
import { api, ApiError } from "./lib/api.js";
import { COLORS } from "./theme.js";
import ThreadView, { fmtStamp } from "./ThreadView.jsx";
import { useThreadsSummary, threadNeedsAttention } from "./lib/threads.js";

const dot = { width: 9, height: 9, borderRadius: 999, background: COLORS.danger, flexShrink: 0 };

function Chip({ children, tone }) {
  const c = tone === "ok" ? COLORS.success : COLORS.textMuted;
  return <span style={{ fontSize: 10, fontWeight: 700, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "0 7px", flexShrink: 0 }}>{children}</span>;
}

export default function AdminInbox({ userId, role }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("tickets"); // "tickets" | "chats"
  const [view, setView] = useState(null); // null = lista | { type: "chat", supervisor } | { type: "ticket", ticket }
  const threads = useThreadsSummary({ userId, role });
  const { seen, markSeen } = threads;

  const [chats, setChats] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketsHasMore, setTicketsHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState("abierto");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError("");
    try {
      if (tab === "chats") {
        const r = await api.adminChats();
        setChats(r.chats ?? []);
      } else {
        const r = await api.tickets({ status: statusFilter });
        setTickets(r.tickets ?? []);
        setTicketsHasMore(Boolean(r.hasMore));
      }
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : "No se pudo cargar la lista.");
    } finally {
      setListLoading(false);
    }
  }, [tab, statusFilter]);

  // La lista se recarga al abrir, al cambiar de pestaña/filtro y al volver
  // desde un hilo (para que se vea quién ya no está pendiente).
  useEffect(() => {
    if (open && !view) loadList();
  }, [open, view, loadList]);

  async function loadMoreTickets() {
    const last = tickets[tickets.length - 1];
    if (!last || listLoading) return;
    setListLoading(true);
    try {
      const r = await api.tickets({ status: statusFilter, before: last.lastCommentAt });
      setTickets((prev) => [...prev, ...(r.tickets ?? [])]);
      setTicketsHasMore(Boolean(r.hasMore));
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : "No se pudieron cargar más tickets.");
    } finally {
      setListLoading(false);
    }
  }

  function openModal() {
    setView(null);
    setTab(threads.chatsPending > 0 && threads.ticketsPending === 0 ? "chats" : "tickets");
    setOpen(true);
  }
  function closeModal() {
    setOpen(false);
    setView(null);
    threads.reload();
  }
  function back() {
    setView(null);
    threads.reload();
  }

  async function toggleStatus() {
    if (view?.type !== "ticket" || statusBusy) return;
    const next = view.ticket.status === "abierto" ? "cerrado" : "abierto";
    setStatusBusy(true);
    try {
      await api.setTicketStatus(view.ticket.id, next);
      setView({ type: "ticket", ticket: { ...view.ticket, status: next } });
    } catch {
      // Se queda como estaba; el botón sigue disponible para reintentar.
    } finally {
      setStatusBusy(false);
    }
  }

  // --- funciones de lectura/escritura del hilo abierto ---
  const chatId = view?.type === "chat" ? view.supervisor.supervisorId : null;
  const ticketId = view?.type === "ticket" ? view.ticket.id : null;
  const loadThread = useCallback(
    ({ before, limit } = {}) =>
      chatId
        ? api.adminChat(chatId, { before, limit })
        : api.ticket(ticketId, { before, limit }).then((r) => ({ comments: r.comments, hasMore: r.hasMore })),
    [chatId, ticketId]
  );
  const sendThread = useCallback((text) => (chatId ? api.sendAdminChat(chatId, text) : api.sendTicketComment(ticketId, text)), [chatId, ticketId]);

  const pendingTotal = threads.total;

  return (
    <>
      <button
        onClick={openModal}
        title="Mensajes de supervisores y tickets de promotores"
        style={{ position: "relative", width: 36, height: 36, borderRadius: 9, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <Inbox size={16} />
        {pendingTotal > 0 && (
          <span style={{ position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 999, background: COLORS.danger, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {pendingTotal > 9 ? "9+" : pendingTotal}
          </span>
        )}
      </button>

      {open && (
        <div
          onClick={closeModal}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: COLORS.surface, borderRadius: 16, width: "min(560px, 100%)", height: "min(660px, 90vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {view ? (
                  <button onClick={back} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, display: "flex", padding: 0 }}>
                    <ArrowLeft size={18} />
                  </button>
                ) : (
                  <Inbox size={16} color={COLORS.accentText} />
                )}
                <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {view?.type === "chat" ? `Chat con ${view.supervisor.name}` : view?.type === "ticket" ? "Ticket de promotor" : "Mensajes y tickets"}
                </span>
              </div>
              <button onClick={closeModal} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, display: "flex" }}>
                <X size={18} />
              </button>
            </div>

            {!view && (
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 16 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexShrink: 0 }}>
                  {[["tickets", "Tickets de promotores", threads.ticketsPending], ["chats", "Chats con supervisores", threads.chatsPending]].map(([key, label, n]) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 9, border: `1px solid ${tab === key ? COLORS.accent : COLORS.border}`, background: tab === key ? COLORS.accentSoft : "transparent", color: tab === key ? COLORS.accentText : COLORS.textMuted, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                    >
                      {label}
                      {n > 0 && <span style={{ minWidth: 16, height: 16, borderRadius: 999, background: COLORS.danger, color: "#fff", fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{n}</span>}
                    </button>
                  ))}
                </div>

                {tab === "tickets" && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 10, flexShrink: 0 }}>
                    {[["abierto", "Abiertos"], ["cerrado", "Cerrados"]].map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setStatusFilter(key)}
                        style={{ padding: "4px 11px", borderRadius: 999, border: `1px solid ${statusFilter === key ? COLORS.accent : COLORS.border}`, background: statusFilter === key ? COLORS.accentSoft : "transparent", color: statusFilter === key ? COLORS.accentText : COLORS.textMuted, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {listLoading && (tab === "chats" ? chats : tickets).length === 0 && <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0, textAlign: "center", padding: "18px 0" }}>Cargando…</p>}
                  {listError && <p style={{ fontSize: 12.5, color: COLORS.danger, margin: 0 }}>{listError}</p>}

                  {tab === "chats" && !listError && !listLoading && chats.length === 0 && (
                    <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0, textAlign: "center", padding: "18px 0" }}>No hay supervisores registrados.</p>
                  )}
                  {tab === "chats" && chats.map((c) => {
                    const pending = threadNeedsAttention(c, `chat:${c.supervisorId}`, seen, "admin");
                    return (
                      <button
                        key={c.supervisorId}
                        onClick={() => setView({ type: "chat", supervisor: c })}
                        style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 11, padding: "10px 12px", cursor: "pointer" }}
                      >
                        {pending ? <span style={dot} title="Pendiente de responder" /> : <span style={{ width: 9, flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
                            {c.lastCommentAt ? `Último comentario: ${fmtStamp(c.lastCommentAt, false)}` : "Sin comentarios todavía"}
                          </div>
                        </div>
                        <ChevronRight size={15} color={COLORS.textMuted} />
                      </button>
                    );
                  })}

                  {tab === "tickets" && !listError && !listLoading && tickets.length === 0 && (
                    <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0, textAlign: "center", padding: "18px 0" }}>
                      {statusFilter === "abierto" ? "No hay tickets abiertos." : "No hay tickets cerrados."}
                    </p>
                  )}
                  {tab === "tickets" && tickets.map((t) => {
                    const pending = t.status === "abierto" && threadNeedsAttention(t, `ticket:${t.id}`, seen, "admin");
                    return (
                      <button
                        key={t.id}
                        onClick={() => setView({ type: "ticket", ticket: t })}
                        style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 11, padding: "10px 12px", cursor: "pointer" }}
                      >
                        {pending ? <span style={dot} title="Pendiente de responder" /> : <span style={{ width: 9, flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{t.promoterName}</span>
                            <span style={{ fontSize: 11, color: COLORS.textMuted }}>· {t.sucursal}</span>
                            <Chip tone={t.status === "abierto" ? "ok" : undefined}>{t.status === "abierto" ? "Abierto" : "Cerrado"}</Chip>
                          </div>
                          <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                          <div style={{ fontSize: 10.5, color: COLORS.textMuted, marginTop: 2, fontFamily: "JetBrains Mono" }}>{fmtStamp(t.lastCommentAt, false)}</div>
                        </div>
                        <ChevronRight size={15} color={COLORS.textMuted} />
                      </button>
                    );
                  })}
                  {tab === "tickets" && ticketsHasMore && (
                    <button
                      onClick={loadMoreTickets}
                      disabled={listLoading}
                      style={{ flexShrink: 0, alignSelf: "center", padding: "6px 14px", borderRadius: 999, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.textMuted, fontSize: 11.5, fontWeight: 600, cursor: listLoading ? "default" : "pointer" }}
                    >
                      {listLoading ? "Cargando…" : "Ver más tickets"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {view && (
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 16 }}>
                {view.type === "ticket" && (
                  <div style={{ marginBottom: 10, flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: COLORS.text }}>{view.ticket.promoterName}</div>
                        <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginTop: 1 }}>ID {view.ticket.promoterId} · {view.ticket.sucursal}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <Chip tone={view.ticket.status === "abierto" ? "ok" : undefined}>{view.ticket.status === "abierto" ? "Abierto" : "Cerrado"}</Chip>
                        <button
                          onClick={toggleStatus}
                          disabled={statusBusy}
                          style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.text, fontSize: 11.5, fontWeight: 700, cursor: statusBusy ? "default" : "pointer" }}
                        >
                          {view.ticket.status === "abierto" ? <><Lock size={12} /> Cerrar ticket</> : <><Unlock size={12} /> Reabrir</>}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <ThreadView
                  threadKey={chatId ? `chat:${chatId}` : `ticket:${ticketId}`}
                  load={loadThread}
                  send={sendThread}
                  meId={userId}
                  hour12={false}
                  placeholder={view.type === "chat" ? `Escribe una respuesta para ${view.supervisor.name}…` : "Escribe una respuesta para el promotor…"}
                  emptyText={view.type === "chat" ? "Todavía no hay comentarios con este supervisor. Puedes escribir el primero." : "Todavía no hay comentarios."}
                  onLatest={(iso) => markSeen(chatId ? `chat:${chatId}` : `ticket:${ticketId}`, iso)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
