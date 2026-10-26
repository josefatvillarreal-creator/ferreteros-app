// ---------------------------------------------------------------------------
// Autenticación: ID de promotor + contraseña (bcrypt) + sesión en cookie HttpOnly.
// ---------------------------------------------------------------------------
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { findPromoterById } from "./db.js";
import { findUserInSheet } from "./usersSheet.js";
import { generateCsrfToken, setCsrfCookie, clearCsrfCookie } from "./csrf.js";

// ---------------------------------------------------------------------------
// Verifica ID + contraseña contra el hash bcrypt almacenado. Devuelve la cuenta
// (sin el hash) o lanza un error 401 genérico (no revela si falló el ID o la
// contraseña, para no filtrar qué IDs existen).
//
// ORDEN DE BÚSQUEDA:
//   1) Pestaña "Usuarios" (ADMIN / GERENTE). Si el ID está aquí, el rol viene
//      de ahí (admin o gerente).
//   2) Listado de promotores. Cualquier cuenta que no esté en "Usuarios" es un
//      PROMOTOR de campo (rol "promotor").
//
// El objeto devuelto SIEMPRE incluye `role`, que viaja dentro del JWT firmado.
// ---------------------------------------------------------------------------
export async function authenticate(promoterId, password) {
  const unauthorized = () => {
    const e = new Error("ID o contraseña incorrectos");
    e.status = 401;
    return e;
  };

  if (!promoterId || !password) throw unauthorized();
  const id = String(promoterId).trim();

  // 1) ¿Es un usuario administrativo (admin/gerente)?
  const user = await findUserInSheet(id);
  if (user) {
    const ok = await bcrypt.compare(password, user.password || "");
    if (!ok) throw unauthorized();
    return { id: user.id, name: user.name, role: user.role };
  }

  // 2) Si no, se trata como promotor de campo.
  const promoter = await findPromoterById(id);
  if (!promoter) {
    // Comparación "dummy" para igualar el tiempo de respuesta y mitigar
    // ataques de enumeración por temporización.
    await bcrypt.compare(password, "$2a$10$abcdefghijklmnopqrstuv");
    throw unauthorized();
  }

  const ok = await bcrypt.compare(password, promoter.password);
  if (!ok) throw unauthorized();

  return {
    id: promoter.id,
    name: promoter.name,
    location: promoter.location,
    supervisor: promoter.supervisor,
    role: "promotor",
  };
}

// ---------------------------------------------------------------------------
// Sesión: JWT propio firmado, transportado SIEMPRE en cookie HttpOnly, con
// token CSRF ligado (double-submit).
// ---------------------------------------------------------------------------
export function issueSession(res, promoter) {
  const csrfToken = generateCsrfToken();

  const token = jwt.sign(
    // `role` va firmado dentro del JWT: el cliente no puede alterarlo.
    { sub: promoter.id, name: promoter.name, role: promoter.role || "promotor", csrf: csrfToken },
    config.session.secret,
    { expiresIn: config.session.ttlSeconds }
  );

  res.cookie(config.session.cookieName, token, {
    httpOnly: true, // invisible a JavaScript → protege de XSS
    secure: config.session.cookieSecure, // solo HTTPS en producción
    sameSite: "strict", // mitiga CSRF (defensa en profundidad junto al token)
    maxAge: config.session.ttlSeconds * 1000,
    path: "/",
  });

  setCsrfCookie(res, csrfToken);
}

export function clearSession(res) {
  res.clearCookie(config.session.cookieName, {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: "strict",
    path: "/",
  });
  clearCsrfCookie(res);
}

// Middleware: exige una cookie de sesión válida. Deja req.promoter listo.
export function requireAuth(req, res, next) {
  const token = req.cookies?.[config.session.cookieName];
  if (!token) return res.status(401).json({ message: "No autenticado" });
  try {
    const claims = jwt.verify(token, config.session.secret);
    req.promoter = { id: claims.sub, name: claims.name, role: claims.role || "promotor" };
    next();
  } catch {
    clearSession(res);
    return res.status(401).json({ message: "Sesión inválida o expirada" });
  }
}

// ---------------------------------------------------------------------------
// Middleware de autorización por ROL. Úsalo DESPUÉS de requireAuth.
// Ej.: router.get("/summary", requireAuth, requireRole("gerente", "admin"), ...)
// Responde 403 si el rol de la sesión no está en la lista permitida.
// ---------------------------------------------------------------------------
export function requireRole(...allowed) {
  return (req, res, next) => {
    const role = req.promoter?.role || "promotor";
    if (!allowed.includes(role)) {
      return res.status(403).json({ message: "No tienes permiso para esta acción" });
    }
    next();
  };
}
