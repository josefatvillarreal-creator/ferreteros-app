// ---------------------------------------------------------------------------
// Hilos de comentarios estilo foro (chat supervisor<->administración y
// seguimiento de tickets de promotores) — capa de datos.
// ---------------------------------------------------------------------------
// Un "hilo" es una lista de comentarios con autor, fecha y hora que se va
// agregando y respondiendo (NO es un chat en vivo: el cliente carga al abrir y
// con un botón "Actualizar"). Ver el modelo Thread en prisma/schema.prisma.
import { prisma } from "./prisma.js";
import { ensurePromoterExistsLocally } from "./db.js";

export const MAX_COMMENT = 2000;
export const PAGE_SIZE = 50;

const ADMIN_ROLES = new Set(["admin", "gerente"]);
export const isAdminRole = (role) => ADMIN_ROLES.has(role);

const commentSelect = { id: true, authorId: true, authorName: true, authorRole: true, text: true, createdAt: true };

// Normaliza el ID de un supervisor igual que el resto del sistema (minúsculas,
// sin espacios) para que un solo supervisor nunca tenga dos hilos.
export const normSupervisorId = (id) => String(id ?? "").trim().toLowerCase();

// Agrega un comentario y actualiza, en la misma transacción, "quién habló
// último y cuándo" del hilo (así listar hilos / calcular "sin leer" no
// necesita leer los comentarios).
export async function addComment(threadId, { authorId, authorName, authorRole, text }) {
  const [comment] = await prisma.$transaction([
    prisma.threadComment.create({
      data: { threadId, authorId, authorName, authorRole, text },
      select: commentSelect,
    }),
    prisma.thread.update({
      where: { id: threadId },
      data: { lastCommentAt: new Date(), lastAuthorRole: authorRole },
    }),
  ]);
  return comment;
}

// Comentarios de un hilo, de más viejo a más nuevo, en páginas: devuelve los
// últimos `limit` (o los `limit` anteriores a `before`) para no traer un hilo
// largo completo de golpe. `hasMore` indica si hay comentarios más viejos.
export async function getComments(threadId, { before, limit = PAGE_SIZE } = {}) {
  const take = Math.min(100, Math.max(1, limit));
  const rows = await prisma.threadComment.findMany({
    where: { threadId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    select: commentSelect,
  });
  const hasMore = rows.length > take;
  return { comments: rows.slice(0, take).reverse(), hasMore };
}

// --- Chat supervisor <-> administración --------------------------------------

export async function getSupervisorThread(supervisorId) {
  return prisma.thread.findUnique({ where: { supervisorId: normSupervisorId(supervisorId) } });
}

// Un solo hilo por supervisor, creado la primera vez que alguien escribe.
export async function getOrCreateSupervisorThread(supervisorId) {
  const id = normSupervisorId(supervisorId);
  return prisma.thread.upsert({
    where: { supervisorId: id },
    update: {},
    create: { kind: "supervisor", supervisorId: id, title: `Chat con ${id}` },
  });
}

// Todos los hilos de supervisores con su último movimiento (para la bandeja
// del administrador). Pocos (uno por supervisor), así que no se pagina.
export async function listSupervisorThreads() {
  return prisma.thread.findMany({
    where: { kind: "supervisor" },
    orderBy: { lastCommentAt: "desc" },
    select: { id: true, supervisorId: true, lastCommentAt: true, lastAuthorRole: true },
  });
}

// --- Tickets de promotores ----------------------------------------------------

const ticketSelect = {
  id: true, title: true, sucursal: true, status: true, promoterId: true,
  createdAt: true, lastCommentAt: true, lastAuthorRole: true,
  promoter: { select: { name: true } },
};

const shapeTicket = (t) => ({
  id: t.id, title: t.title, sucursal: t.sucursal, status: t.status, promoterId: t.promoterId,
  promoterName: t.promoter?.name || t.promoterId, createdAt: t.createdAt,
  lastCommentAt: t.lastCommentAt, lastAuthorRole: t.lastAuthorRole,
});

// Crea el ticket de un reporte: el hilo + su primer comentario (el texto del
// reporte, a nombre del promotor). `id` viene de afuera para poder guardarlo
// también en la fila del Sheet antes de crear el ticket.
export async function createTicket({ id, promoterId, promoterName, sucursal, descripcion }) {
  await ensurePromoterExistsLocally(promoterId);
  const title = descripcion.length > 80 ? `${descripcion.slice(0, 77)}…` : descripcion;
  const t = await prisma.thread.create({
    data: {
      id, kind: "ticket", promoterId, sucursal, title,
      lastAuthorRole: "promotor",
      comments: { create: { authorId: promoterId, authorName: promoterName || promoterId, authorRole: "promotor", text: descripcion } },
    },
    select: ticketSelect,
  });
  return shapeTicket(t);
}

// Tickets (más recientes primero, por último movimiento), de UN promotor o de
// todos, con filtro de estado y paginación por cursor (`before` = lastCommentAt).
export async function listTickets({ promoterId, status, before, limit = PAGE_SIZE } = {}) {
  const take = Math.min(100, Math.max(1, limit));
  const rows = await prisma.thread.findMany({
    where: {
      kind: "ticket",
      ...(promoterId ? { promoterId } : {}),
      ...(status === "abierto" || status === "cerrado" ? { status } : {}),
      ...(before ? { lastCommentAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { lastCommentAt: "desc" },
    take: take + 1,
    select: ticketSelect,
  });
  return { tickets: rows.slice(0, take).map(shapeTicket), hasMore: rows.length > take };
}

export async function getTicket(id) {
  const t = await prisma.thread.findFirst({ where: { id, kind: "ticket" }, select: ticketSelect });
  return t ? shapeTicket(t) : null;
}

export async function setTicketStatus(id, status) {
  const r = await prisma.thread.updateMany({ where: { id, kind: "ticket" }, data: { status } });
  return r.count > 0;
}

// --- Resumen para los puntos de "sin leer" -----------------------------------
// Solo lo mínimo de cada hilo (id, último movimiento, quién habló último): el
// cliente decide qué está "sin leer" comparando contra lo que ya vio.
export async function getSummary({ role, userId }) {
  if (role === "promotor") {
    const tickets = await prisma.thread.findMany({
      where: { kind: "ticket", promoterId: userId },
      orderBy: { lastCommentAt: "desc" },
      take: 100,
      select: { id: true, status: true, lastCommentAt: true, lastAuthorRole: true },
    });
    return { tickets };
  }
  if (role === "supervisor") {
    const chat = await prisma.thread.findUnique({
      where: { supervisorId: normSupervisorId(userId) },
      select: { id: true, lastCommentAt: true, lastAuthorRole: true },
    });
    return { chat };
  }
  // admin / gerente
  const [chats, tickets] = await Promise.all([
    prisma.thread.findMany({
      where: { kind: "supervisor" },
      select: { supervisorId: true, lastCommentAt: true, lastAuthorRole: true },
    }),
    prisma.thread.findMany({
      where: { kind: "ticket", status: "abierto" },
      orderBy: { lastCommentAt: "desc" },
      take: 300,
      select: { id: true, status: true, lastCommentAt: true, lastAuthorRole: true },
    }),
  ]);
  return { chats, tickets };
}
