// ---------------------------------------------------------------------------
// Hilo de comentarios estilo FORO — lo usan el chat supervisor<->administración
// y el seguimiento de tickets. NO es un chat en vivo: carga al abrir, trae los
// comentarios más recientes (los anteriores se piden con "Ver anteriores") y
// tiene un botón "Actualizar" para ver respuestas nuevas.
// ---------------------------------------------------------------------------
// El componente padre le da el alto (este llena el espacio disponible) y las
// funciones para leer/escribir (`load`, `send`); `threadKey` identifica el hilo
// — al cambiar, se vuelve a cargar desde cero.
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Send, RefreshCw, ChevronUp } from "lucide-react";
import { ApiError } from "./lib/api.js";
import { COLORS } from "./theme.js";
import { isAdminRole, ROLE_LABEL } from "./lib/threads.js";

const MAX_COMMENT = 2000;

// Fecha y hora de un comentario. `hour12` false = 24 h (el tablero de
// administración las muestra así, igual que el resto de sus horas).
export function fmtStamp(iso, hour12 = true) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", hour12 }); } catch { return ""; }
}

export default function ThreadView({
  threadKey, load, send, meId, hour12 = true,
  canWrite = true, blockedMessage = "", placeholder = "Escribe un comentario…", emptyText = "Todavía no hay comentarios.",
  onLatest,
}) {
  const loadRef = useRef(load);
  const sendRef = useRef(send);
  const onLatestRef = useRef(onLatest);
  loadRef.current = load;
  sendRef.current = send;
  onLatestRef.current = onLatest;

  const listRef = useRef(null);
  const stickBottom = useRef(true); // true = tras cambiar la lista, bajar al último comentario
  const prevHeight = useRef(0); // alto antes de anteponer comentarios viejos (para no perder el lugar)

  const [comments, setComments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await loadRef.current({});
      stickBottom.current = true;
      setComments(r.comments);
      setHasMore(r.hasMore);
      onLatestRef.current?.(r.comments[r.comments.length - 1]?.createdAt);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar la conversación.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setComments([]);
    setText("");
    setSendError("");
    fetchLatest();
  }, [threadKey, fetchLatest]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickBottom.current) el.scrollTop = el.scrollHeight;
    else if (prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = 0;
    }
  }, [comments]);

  async function loadOlder() {
    if (loadingOlder || !comments.length) return;
    setLoadingOlder(true);
    try {
      prevHeight.current = listRef.current?.scrollHeight ?? 0;
      stickBottom.current = false;
      const r = await loadRef.current({ before: comments[0].createdAt });
      setComments((prev) => [...r.comments, ...prev]);
      setHasMore(r.hasMore);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar los anteriores.");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function submit() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setSendError("");
    try {
      const c = await sendRef.current(t);
      stickBottom.current = true;
      setComments((prev) => [...prev, c]);
      setText("");
      onLatestRef.current?.(c.createdAt);
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : "No hay conexión. Intenta de nuevo en un momento.");
    } finally {
      setSending(false);
    }
  }

  const canSend = text.trim().length > 0 && !sending;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 0 8px" }}>
        <button
          onClick={fetchLatest}
          disabled={loading}
          title="Ver comentarios nuevos"
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: COLORS.accentText, fontSize: 11.5, fontWeight: 700, cursor: loading ? "default" : "pointer", padding: 0 }}
        >
          <RefreshCw size={12} style={loading ? { animation: "spin 1s linear infinite" } : undefined} /> Actualizar
        </button>
        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 2 }}>
        {hasMore && (
          <button
            onClick={loadOlder}
            disabled={loadingOlder}
            style={{ alignSelf: "center", display: "flex", alignItems: "center", gap: 4, padding: "5px 11px", borderRadius: 999, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.textMuted, fontSize: 11.5, fontWeight: 600, cursor: loadingOlder ? "default" : "pointer", flexShrink: 0 }}
          >
            <ChevronUp size={13} /> {loadingOlder ? "Cargando…" : "Ver anteriores"}
          </button>
        )}

        {loading && comments.length === 0 && <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0, textAlign: "center", padding: "18px 0" }}>Cargando…</p>}
        {error && <p style={{ fontSize: 12.5, color: COLORS.danger, margin: 0 }}>{error}</p>}
        {!loading && !error && comments.length === 0 && (
          <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0, textAlign: "center", padding: "18px 12px", lineHeight: 1.5 }}>{emptyText}</p>
        )}

        {comments.map((c) => {
          const fromAdmin = isAdminRole(c.authorRole);
          return (
            <div
              key={c.id}
              style={{ flexShrink: 0, background: fromAdmin ? COLORS.accentSoft : COLORS.surface2, border: `1px solid ${fromAdmin ? COLORS.accent : COLORS.border}`, borderRadius: 12, padding: "9px 12px" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.authorName}{c.authorId === meId ? " (tú)" : ""}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: fromAdmin ? COLORS.accentText : COLORS.textMuted, border: `1px solid ${fromAdmin ? COLORS.accent : COLORS.border}`, borderRadius: 999, padding: "0 6px", flexShrink: 0 }}>
                    {ROLE_LABEL[c.authorRole] || c.authorRole}
                  </span>
                </div>
                <span style={{ fontSize: 10.5, color: COLORS.textMuted, fontFamily: "JetBrains Mono" }}>{fmtStamp(c.createdAt, hour12)}</span>
              </div>
              <p style={{ fontSize: 13, color: COLORS.text, margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</p>
            </div>
          );
        })}
      </div>

      <div style={{ flexShrink: 0, paddingTop: 10, marginTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
        {canWrite ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_COMMENT))}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
              placeholder={placeholder}
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", resize: "none", padding: "9px 11px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 13.5, fontFamily: "Inter", lineHeight: 1.45 }}
            />
            {sendError && <p style={{ color: COLORS.danger, fontSize: 12, margin: "6px 0 0" }}>{sendError}</p>}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontSize: 10.5, color: COLORS.textMuted }}>{text.length}/{MAX_COMMENT}</span>
              <button
                onClick={submit}
                disabled={!canSend}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, border: "none", background: canSend ? COLORS.accent : COLORS.surface2, color: canSend ? COLORS.onAccent : COLORS.textMuted, fontSize: 12.5, fontWeight: 700, cursor: canSend ? "pointer" : "not-allowed" }}
              >
                <Send size={13} /> {sending ? "Enviando…" : "Enviar comentario"}
              </button>
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0, lineHeight: 1.5 }}>{blockedMessage}</p>
        )}
      </div>
    </div>
  );
}
