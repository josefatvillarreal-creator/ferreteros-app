// ---------------------------------------------------------------------------
// Hilos de comentarios (estilo foro, no chat en vivo) — /api/threads
// ---------------------------------------------------------------------------
//   - Chat supervisor <-> administración: un hilo por supervisor. El supervisor
//     solo ve el SUYO; admin/gerente ven el de cualquier supervisor.
//   - Seguimiento de tickets (los reportes de "Reportar" del promotor): el
//     promotor solo ve y comenta los SUYOS; admin/gerente ven todos, responden
//     y pueden cerrarlos/reabrirlos.
// Ver threadsDb.js para el modelo y por qué se pagina.
import { Router } from "express";
import { requireAuth, requireRole } from "../auth.js";
import { findUserInSheet, getAllSupervisorsFromSheet } from "../usersSheet.js";
import {
  MAX_COMMENT, isAdminRole, normSupervisorId, addComment, getComments,
  getSupervisorThread, getOrCreateSupervisorThread, listSupervisorThreads,
  listTickets, getTicket, setTicketStatus, getSummary,
} from "../threadsDb.js";

const router = Router();
router.use(requireAuth);

const pageParams = (req) => ({
  before: req.query.before ? String(req.query.before) : undefined,
  limit: Number(req.query.limit) || undefined,
});

// Texto del comentario, validado. Devuelve null (y ya respondió 400) si no sirve.
function readText(req, res) {
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ message: "Escribe un comentario." });
    return null;
  }
  if (text.length > MAX_COMMENT) {
    res.status(400).json({ message: `El comentario es muy largo (máximo ${MAX_COMMENT} caracteres).` });
    return null;
  }
  return text;
}

const author = (req) => ({ authorId: req.promoter.id, authorName: req.promoter.name || req.promoter.id, authorRole: req.promoter.role });

function fail(res, tag, err, message) {
  console.error(`[threads${tag}]`, err);
  return res.status(500).json({ message });
}

// GET /api/threads/summary — lo mínimo de cada hilo del usuario, para los
// puntos de "sin leer" de los botones.
router.get("/summary", async (req, res) => {
  try {
    return res.json(await getSummary({ role: req.promoter.role, userId: req.promoter.id }));
  } catch (err) {
    return fail(res, "/summary", err, "No se pudo cargar el resumen");
  }
});

// --- Chat del SUPERVISOR con la administración -------------------------------

router.get("/supervisor-chat", requireRole("supervisor"), async (req, res) => {
  try {
    const thread = await getSupervisorThread(req.promoter.id);
    if (!thread) return res.json({ comments: [], hasMore: false });
    return res.json(await getComments(thread.id, pageParams(req)));
  } catch (err) {
    return fail(res, "/supervisor-chat", err, "No se pudo cargar el chat");
  }
});

router.post("/supervisor-chat", requireRole("supervisor"), async (req, res) => {
  const text = readText(req, res);
  if (text === null) return;
  try {
    const thread = await getOrCreateSupervisorThread(req.promoter.id);
    return res.status(201).json(await addComment(thread.id, { ...author(req), text }));
  } catch (err) {
    return fail(res, "/supervisor-chat POST", err, "No se pudo enviar el comentario");
  }
});

// --- Bandeja del ADMINISTRADOR: chats con supervisores -----------------------

// Todos los supervisores (de la pestaña "Usuarios"), con su último movimiento
// si ya hay hilo — así el admin también puede iniciar la conversación.
router.get("/supervisor-chats", requireRole("admin", "gerente"), async (req, res) => {
  try {
    const [supervisors, threads] = await Promise.all([getAllSupervisorsFromSheet(), listSupervisorThreads()]);
    const byId = new Map(threads.map((t) => [t.supervisorId, t]));
    const items = supervisors.map((u) => {
      const id = normSupervisorId(u.id);
      const t = byId.get(id);
      byId.delete(id);
      return { supervisorId: id, name: u.name || u.id, lastCommentAt: t?.lastCommentAt ?? null, lastAuthorRole: t?.lastAuthorRole ?? null };
    });
    // Hilos de supervisores que ya no están en "Usuarios": se conservan visibles.
    for (const t of byId.values()) {
      items.push({ supervisorId: t.supervisorId, name: t.supervisorId, lastCommentAt: t.lastCommentAt, lastAuthorRole: t.lastAuthorRole });
    }
    items.sort((a, b) => (b.lastCommentAt ? new Date(b.lastCommentAt).getTime() : 0) - (a.lastCommentAt ? new Date(a.lastCommentAt).getTime() : 0) || a.name.localeCompare(b.name));
    return res.json({ chats: items });
  } catch (err) {
    return fail(res, "/supervisor-chats", err, "No se pudieron cargar los chats");
  }
});

router.get("/supervisor-chats/:supervisorId", requireRole("admin", "gerente"), async (req, res) => {
  try {
    const thread = await getSupervisorThread(req.params.supervisorId);
    if (!thread) return res.json({ comments: [], hasMore: false });
    return res.json(await getComments(thread.id, pageParams(req)));
  } catch (err) {
    return fail(res, "/supervisor-chats/:id", err, "No se pudo cargar el chat");
  }
});

router.post("/supervisor-chats/:supervisorId", requireRole("admin", "gerente"), async (req, res) => {
  const text = readText(req, res);
  if (text === null) return;
  try {
    const supervisorId = normSupervisorId(req.params.supervisorId);
    const u = await findUserInSheet(supervisorId);
    const existing = await getSupervisorThread(supervisorId);
    if ((!u || u.role !== "supervisor") && !existing) return res.status(404).json({ message: "Supervisor no encontrado" });
    const thread = existing ?? (await getOrCreateSupervisorThread(supervisorId));
    return res.status(201).json(await addComment(thread.id, { ...author(req), text }));
  } catch (err) {
    return fail(res, "/supervisor-chats/:id POST", err, "No se pudo enviar el comentario");
  }
});

// --- Tickets -----------------------------------------------------------------

// El promotor solo puede tocar SUS tickets; admin/gerente, cualquiera.
// Devuelve el ticket, o null (y ya respondió 403/404) si no se puede.
async function loadTicketFor(req, res) {
  const ticket = await getTicket(req.params.id);
  if (!ticket) {
    res.status(404).json({ message: "Ticket no encontrado" });
    return null;
  }
  const { role, id } = req.promoter;
  if (role === "promotor" && ticket.promoterId !== id) {
    res.status(403).json({ message: "Ese ticket no es tuyo" });
    return null;
  }
  if (role !== "promotor" && !isAdminRole(role)) {
    res.status(403).json({ message: "No tienes acceso a los tickets" });
    return null;
  }
  return ticket;
}

router.get("/tickets", requireRole("promotor", "admin", "gerente"), async (req, res) => {
  try {
    const { role, id } = req.promoter;
    const status = ["abierto", "cerrado"].includes(req.query.status) ? req.query.status : undefined;
    return res.json(await listTickets({ promoterId: role === "promotor" ? id : undefined, status, ...pageParams(req) }));
  } catch (err) {
    return fail(res, "/tickets", err, "No se pudieron cargar los tickets");
  }
});

router.get("/tickets/:id", async (req, res) => {
  try {
    const ticket = await loadTicketFor(req, res);
    if (!ticket) return;
    return res.json({ ticket, ...(await getComments(ticket.id, pageParams(req))) });
  } catch (err) {
    return fail(res, "/tickets/:id", err, "No se pudo cargar el ticket");
  }
});

router.post("/tickets/:id/comments", async (req, res) => {
  const text = readText(req, res);
  if (text === null) return;
  try {
    const ticket = await loadTicketFor(req, res);
    if (!ticket) return;
    if (ticket.status === "cerrado" && req.promoter.role === "promotor") {
      return res.status(409).json({ message: "Este ticket está cerrado. Si el problema sigue, abre uno nuevo con \"Reportar\"." });
    }
    return res.status(201).json(await addComment(ticket.id, { ...author(req), text }));
  } catch (err) {
    return fail(res, "/tickets/:id/comments", err, "No se pudo enviar el comentario");
  }
});

// Cerrar / reabrir un ticket — solo administración.
router.patch("/tickets/:id", requireRole("admin", "gerente"), async (req, res) => {
  try {
    const status = req.body?.status;
    if (status !== "abierto" && status !== "cerrado") return res.status(400).json({ message: "Estado inválido" });
    const ok = await setTicketStatus(req.params.id, status);
    if (!ok) return res.status(404).json({ message: "Ticket no encontrado" });
    return res.json({ status });
  } catch (err) {
    return fail(res, "/tickets/:id PATCH", err, "No se pudo actualizar el ticket");
  }
});

export default router;
