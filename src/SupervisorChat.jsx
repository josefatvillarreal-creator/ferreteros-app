// ---------------------------------------------------------------------------
// Chat del SUPERVISOR con la administración — botón en el encabezado del
// tablero de supervisor que abre un hilo tipo foro (comentarios con fecha y
// hora, no chat en vivo). Cualquier administrador lo lee y responde ahí mismo;
// el botón muestra un punto cuando hay una respuesta que el supervisor aún no
// ha visto.
import { useState, useCallback } from "react";
import { MessageSquare, X } from "lucide-react";
import { api } from "./lib/api.js";
import { COLORS } from "./theme.js";
import ThreadView from "./ThreadView.jsx";
import { useThreadsSummary } from "./lib/threads.js";

export default function SupervisorChat({ userId }) {
  const [open, setOpen] = useState(false);
  const threads = useThreadsSummary({ userId, role: "supervisor" });
  const unread = threads.chatsPending > 0;

  const load = useCallback(({ before, limit } = {}) => api.supervisorChat({ before, limit }), []);
  const send = useCallback((text) => api.sendSupervisorChat(text), []);

  function close() {
    setOpen(false);
    threads.reload();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Chat con administración"
        style={{ position: "relative", width: 36, height: 36, borderRadius: 9, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <MessageSquare size={16} />
        {unread && <span style={{ position: "absolute", top: -3, right: -3, width: 11, height: 11, borderRadius: 999, background: COLORS.danger, border: `2px solid ${COLORS.surface}` }} />}
      </button>

      {open && (
        <div
          onClick={close}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: COLORS.surface, borderRadius: 16, width: "min(480px, 100%)", height: "min(620px, 88vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MessageSquare size={16} color={COLORS.accentText} />
                <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>Chat con administración</span>
              </div>
              <button onClick={close} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, display: "flex" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 16 }}>
              <p style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5, margin: "0 0 10px" }}>
                Deja aquí lo que necesites que revise un administrador. No es en vivo: te responden en este mismo hilo y lo ves al abrirlo.
              </p>
              <ThreadView
                threadKey="supervisor-chat"
                load={load}
                send={send}
                meId={userId}
                placeholder="Escribe un comentario para administración…"
                emptyText="Todavía no hay comentarios. Escribe el primero abajo."
                onLatest={(iso) => threads.markSeen("chat", iso)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
