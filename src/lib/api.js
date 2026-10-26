// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
// All requests use `credentials: "include"` so the browser sends the HttpOnly
// session cookie issued by the backend. The SPA reads no token to do this —
// the cookie is invisible to JS, which is exactly what protects it from XSS.
//
// `getAccessToken()` is consulted only as a fallback for the pure-SPA/in-memory
// mode; when the backend uses cookie sessions it returns null and no Authorization
// header is sent.

import { API_BASE } from "../config.js";
import { getAccessToken } from "./tokenStore.js";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Query string a partir de un objeto, omitiendo lo que venga vacío.
function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  const str = p.toString();
  return str ? `?${str}` : "";
}

// Arma el query string `?range=...` de los resúmenes de gerente/supervisor,
// agregando `from`/`to` solo cuando range="custom" (fecha personalizada).
function rangeQuery(range, from, to) {
  if (!range) return "";
  const params = new URLSearchParams({ range });
  if (range === "custom") {
    if (from) params.set("from", from);
    if (to) params.set("to", to);
  }
  return `?${params.toString()}`;
}

// Lee la cookie CSRF (legible por JS a propósito) para reenviarla en un header.
function readCsrfCookie() {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function request(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  // Protección CSRF (double-submit): en métodos que cambian estado, envía el
  // token de la cookie en el header X-CSRF-Token; el backend lo compara con el
  // claim firmado dentro del JWT de sesión.
  if (!SAFE_METHODS.has(method.toUpperCase())) {
    const csrf = readCsrfCookie();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  // Fallback only: cookie-session mode leaves this null.
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "include", // send/receive the HttpOnly session cookie
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (res.status === 204) return null;

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = (data && data.message) || res.statusText || "Error de red";
    throw new ApiError(res.status, message);
  }
  return data;
}

export const api = {
  // --- Auth ---------------------------------------------------------------
  // Login con ID de promotor + contraseña. El backend verifica con bcrypt y
  // responde `Set-Cookie: session=...; HttpOnly; Secure; SameSite=Strict`.
  login: (promoterId, password) =>
    request("/login", { method: "POST", body: { promoterId, password } }),

  // Solicita recuperación de contraseña: no resetea nada, solo avisa a quien
  // puede hacerlo (el supervisor del promotor, o admin). Pública — se llama
  // desde la pantalla de login, sin sesión.
  recoverRequest: (promoterId) =>
    request("/auth/recover-request", { method: "POST", body: { promoterId } }),

  // NOTE: check-in ahora recibe { coords, photo } — la foto (Base64) es
  // obligatoria y viaja cifrada en la cola si se genera sin red.

  // Who am I? Returns the current promoter (sin tiendas — ver nearbySucursales).
  session: (signal) => request("/auth/session", { signal }),

  logout: () => request("/auth/logout", { method: "POST" }),

  // Tiendas cercanas a la ubicación GPS del promotor (Haversine en el servidor,
  // radio ~2 km). Devuelve { radius, stores: [{...store, distance}] }.
  nearbySucursales: (lat, lng, signal) =>
    request(`/sucursales?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`, { signal }),

  // Todas las tiendas del catálogo (para pintarlas en el mapa de Inicio).
  allSucursales: (signal) => request("/sucursales/all", { signal }),

  // --- Visits (server-authoritative) -------------------------------------
  // The client sends its coordinates, but the SERVER re-validates distance,
  // time, and identity before persisting. Never trust the browser for this.
  checkIn: (sucursalId, { coords, photo }) =>
    request(`/visits/${encodeURIComponent(sucursalId)}/check-in`, {
      method: "POST",
      body: { coords, photo },
    }),

  checkOut: (sucursalId, { coords, rollos, cubetas }) =>
    request(`/visits/${encodeURIComponent(sucursalId)}/check-out`, {
      method: "POST",
      body: { coords, rollos, cubetas },
    }),

  // Today's visit records for the signed-in promoter.
  visitsToday: (signal) => request("/visits/today", { signal }),

  // Confirma "sigo en tienda" (alerta aleatoria 10am-4pm): responde Sí/No y,
  // si se pudo tomar, la ubicación GPS del momento. Requiere que el promotor
  // tenga un check-in abierto en esa tienda.
  confirmPresence: (sucursalId, { coords, sigueEnTienda }) =>
    request(`/visits/${encodeURIComponent(sucursalId)}/confirm-presence`, {
      method: "POST",
      body: { coords, sigueEnTienda },
    }),

  // Meta mensual (unidades) del promotor logueado y su avance del mes.
  // { target, achieved, reached } o null si no tiene meta asignada.
  myGoal: (signal) => request("/visits/my-goal", { signal }),

  // --- Retroalimentación --------------------------------------------------
  // Envía un reporte de error/problema del asesor. Se guarda como una fila en
  // la pestaña de retroalimentación del Google Sheet del administrador.
  sendFeedback: ({ idPromotor, nombre, sucursal, descripcion, ubicacion }) =>
    request("/feedback", {
      method: "POST",
      body: { idPromotor, nombre, sucursal, descripcion, ubicacion },
    }),

  // --- Competencia ---------------------------------------------------------
  // Reporta una acción/estrategia de la competencia (marca, descripción, hasta
  // 5 fotos como data URL). Se guarda en la base de datos y en una pestaña del
  // Sheet ("Competencia") como resumen.
  sendCompetitionReport: ({ marca, descripcion, fotos }) =>
    request("/competition", {
      method: "POST",
      body: { marca, descripcion, fotos },
    }),

  // --- Gerente / Admin ----------------------------------------------------
  // Resumen para el tablero del gerente (requiere rol gerente/admin en el
  // servidor). `range` es "today" | "week" | "month" | "year" | "custom"; sin
  // él usa "today". Con `range="custom"`, pasa `{from, to}` ("YYYY-MM-DD").
  managerSummary: (range, signal, { from, to } = {}) =>
    request(`/manager/summary${rangeQuery(range, from, to)}`, { signal }),

  // Fija la meta semanal (unidades-equivalentes) de un promotor. Solo admin/gerente.
  setPromoterGoal: (promoterId, meta, nombre) =>
    request(`/manager/promoter/${encodeURIComponent(promoterId)}/goal`, {
      method: "PUT",
      body: { meta, nombre },
    }),

  // Reportes de Competencia (marca, descripción) que enviaron los promotores
  // — panel de revisión del gerente/admin. Las fotos NO vienen en el listado
  // (ver managerCompetenciaPhotos) — se piden aparte, al abrir un reporte.
  managerCompetencia: (signal) => request("/manager/competencia", { signal }),
  managerCompetenciaPhotos: (reportId, signal) => request(`/manager/competencia/${encodeURIComponent(reportId)}/photos`, { signal }),

  // --- Supervisor -----------------------------------------------------------
  // Mismo resumen que el del gerente, pero acotado a SUS promotores (lo filtra
  // el servidor por el ID de sesión del supervisor).
  supervisorSummary: (range, signal, { from, to } = {}) =>
    request(`/supervisor/summary${rangeQuery(range, from, to)}`, { signal }),

  // Mismos reportes de Competencia, acotados a SU equipo (fotos aparte, igual que arriba).
  supervisorCompetencia: (signal) => request("/supervisor/competencia", { signal }),
  supervisorCompetenciaPhotos: (reportId, signal) => request(`/supervisor/competencia/${encodeURIComponent(reportId)}/photos`, { signal }),

  // --- Notificaciones (campana) ---------------------------------------------
  // Admin/gerente reciben las de "admin" + un insight de Top 5 en vivo;
  // supervisor recibe las suyas (check-in de sus promotores, metas alcanzadas).
  // Solo las de HOY — el historial completo es notificationsHistory, aparte.
  notifications: (signal) => request("/notifications", { signal }),

  // Historial de notificaciones paginado POR DÍA (7 días por página por
  // default) — pantalla aparte, para cuando se quiere ver más que hoy.
  notificationsHistory: ({ page = 1, daysPerPage = 7 } = {}, signal) =>
    request(`/notifications/history?page=${page}&daysPerPage=${daysPerPage}`, { signal }),

  // --- Perfil de promotor (historial) ---------------------------------------
  promoterProfile: (promoterId, signal) =>
    request(`/promoters/${encodeURIComponent(promoterId)}/profile`, { signal }),

  // Historial de check-in/check-out paginado POR DÍA (no por fila) — cada
  // página trae `daysPerPage` días distintos, más recientes primero.
  promoterHistory: (promoterId, { page = 1, daysPerPage = 7 } = {}, signal) =>
    request(`/promoters/${encodeURIComponent(promoterId)}/history?page=${page}&daysPerPage=${daysPerPage}`, { signal }),

  // Reporta un comportamiento extraño sobre una visita puntual del historial
  // (admin/gerente/supervisor). Se guarda igual que la retroalimentación.
  reportBehavior: (promoterId, { day, sucursalName, descripcion }) =>
    request(`/promoters/${encodeURIComponent(promoterId)}/report-behavior`, {
      method: "POST",
      body: { day, sucursalName, descripcion },
    }),

  // --- Capacitación / Soporte -------------------------------------------------
  // `seccion` es "capacitacion" | "soporte" — mismo contenido/mecánica, distinto tema.
  trainingOnboarding: (seccion, signal) => request(`/training/${seccion}/onboarding`, { signal }),
  trainingQuiz: (seccion, signal) => request(`/training/${seccion}/quiz`, { signal }),
  trainingFlashcards: (seccion, signal) => request(`/training/${seccion}/flashcards`, { signal }),
  trainingProgressSummary: (seccion, signal) => request(`/training/${seccion}/progress-summary`, { signal }),
  trainingProgress: (seccion, { tipo, orden, correct }) =>
    request(`/training/${seccion}/progress`, { method: "POST", body: { tipo, orden, correct } }),

  // --- Hilos tipo foro (no chat en vivo): chat supervisor<->administración y
  // seguimiento de tickets. Los comentarios se piden por páginas (`before` =
  // fecha del comentario más viejo ya cargado) para no traer hilos largos de golpe.
  threadsSummary: (signal) => request("/threads/summary", { signal }),

  supervisorChat: ({ before, limit } = {}, signal) => request(`/threads/supervisor-chat${qs({ before, limit })}`, { signal }),
  sendSupervisorChat: (text) => request("/threads/supervisor-chat", { method: "POST", body: { text } }),

  adminChats: (signal) => request("/threads/supervisor-chats", { signal }),
  adminChat: (supervisorId, { before, limit } = {}, signal) =>
    request(`/threads/supervisor-chats/${encodeURIComponent(supervisorId)}${qs({ before, limit })}`, { signal }),
  sendAdminChat: (supervisorId, text) =>
    request(`/threads/supervisor-chats/${encodeURIComponent(supervisorId)}`, { method: "POST", body: { text } }),

  tickets: ({ status, before, limit } = {}, signal) => request(`/threads/tickets${qs({ status, before, limit })}`, { signal }),
  ticket: (id, { before, limit } = {}, signal) => request(`/threads/tickets/${encodeURIComponent(id)}${qs({ before, limit })}`, { signal }),
  sendTicketComment: (id, text) => request(`/threads/tickets/${encodeURIComponent(id)}/comments`, { method: "POST", body: { text } }),
  setTicketStatus: (id, status) => request(`/threads/tickets/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } }),

  // --- Alertas automáticas de Retroalimentación (correo + push ntfy.sh) -----
  feedbackAlerts: (signal) => request("/feedback-alerts", { signal }),
  setFeedbackAlerts: ({ activo, temaNtfy }) =>
    request("/feedback-alerts", { method: "PUT", body: { activo, temaNtfy } }),
  addFeedbackAlertRecipient: (nombre, email) =>
    request("/feedback-alerts/destinatarios", { method: "POST", body: { nombre, email } }),
  removeFeedbackAlertRecipient: (email) =>
    request(`/feedback-alerts/destinatarios/${encodeURIComponent(email)}`, { method: "DELETE" }),
};

export { ApiError };
