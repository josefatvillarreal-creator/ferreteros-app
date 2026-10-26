// ---------------------------------------------------------------------------
// Helpers de los hilos tipo foro (chat supervisor<->administración y
// seguimiento de tickets): quién escribió, y los puntos de "sin leer".
// ---------------------------------------------------------------------------
// No hay chat en vivo: el resumen (qué hilos hay y quién habló último) se pide
// al abrir la app, al volver a ella y cada tanto, y con eso se calculan los
// puntos de los botones.
//   - Administración: lo que importa es qué está PENDIENTE de responder (el
//     último en hablar fue un supervisor/promotor) — no depende de qué navegador.
//   - Supervisor y promotor: lo que importa es si hay una respuesta de
//     administración que todavía no han visto. "Visto" se guarda en este
//     navegador (localStorage), no en el servidor.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

export const isAdminRole = (role) => role === "admin" || role === "gerente";
// "admin" = administración; "user" = supervisor o promotor.
export const sideOf = (role) => (isAdminRole(role) ? "admin" : "user");

export const ROLE_LABEL = { admin: "Administración", gerente: "Administración", supervisor: "Supervisor", promotor: "Promotor" };

const seenKey = (userId) => `threads_seen_v1_${userId}`;

function readSeen(userId) {
  try {
    return JSON.parse(window.localStorage.getItem(seenKey(userId)) || "{}");
  } catch {
    return {};
  }
}

// ¿Este hilo tiene algo nuevo para MÍ? `mySide` = "admin" | "user".
export function threadNeedsAttention(thread, key, seen, mySide) {
  if (!thread?.lastCommentAt || !thread.lastAuthorRole) return false;
  if (sideOf(thread.lastAuthorRole) === mySide) return false; // el último fui yo (o mi lado)
  if (mySide === "admin") return true; // pendiente de responder, sin importar si ya lo vi
  return new Date(thread.lastCommentAt).getTime() > new Date(seen[key] || 0).getTime();
}

// Resumen de hilos + puntos de "sin leer". `enabled` en false no pide nada
// (p. ej. antes de que haya sesión). Se refresca al montar, al volver a la
// pestaña y cada `pollMs` — y con `reload()` cuando el usuario actúa.
export function useThreadsSummary({ userId, role, enabled = true, pollMs = 60000 }) {
  const [summary, setSummary] = useState(null);
  const [seen, setSeen] = useState(() => (userId ? readSeen(userId) : {}));
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const s = await api.threadsSummary();
      if (alive.current) setSummary(s);
    } catch {
      // Silencioso: los puntos no deben mostrar errores encima de la pantalla.
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (userId) setSeen(readSeen(userId));
    return () => { alive.current = false; };
  }, [userId]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    reload();
    const t = setInterval(reload, pollMs);
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, userId, pollMs, reload]);

  // Marca un hilo como visto hasta `iso` (fecha de su último comentario).
  const markSeen = useCallback((key, iso) => {
    if (!userId || !iso) return;
    setSeen((prev) => {
      if (new Date(prev[key] || 0).getTime() >= new Date(iso).getTime()) return prev;
      const next = { ...prev, [key]: iso };
      try { window.localStorage.setItem(seenKey(userId), JSON.stringify(next)); } catch { /* sin storage: solo se pierde el "visto" al recargar */ }
      return next;
    });
  }, [userId]);

  const mySide = sideOf(role);
  let chatsPending = 0;
  let ticketsPending = 0;
  if (summary) {
    if (role === "supervisor") {
      chatsPending = threadNeedsAttention(summary.chat, "chat", seen, mySide) ? 1 : 0;
    } else if (isAdminRole(role)) {
      chatsPending = (summary.chats ?? []).filter((c) => threadNeedsAttention(c, `chat:${c.supervisorId}`, seen, mySide)).length;
    }
    ticketsPending = (summary.tickets ?? []).filter((t) => t.status === "abierto" && threadNeedsAttention(t, `ticket:${t.id}`, seen, mySide)).length;
  }

  return { summary, seen, markSeen, reload, mySide, chatsPending, ticketsPending, total: chatsPending + ticketsPending };
}
