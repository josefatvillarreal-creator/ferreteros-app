// ---------------------------------------------------------------------------
// Protección CSRF — double-submit cookie ligado a la sesión.
// ---------------------------------------------------------------------------
// Estándar de Protexa: protección CSRF explícita (no confiar solo en SameSite).
//
// Cómo funciona:
//   - Al iniciar sesión se genera un token CSRF aleatorio que se guarda en DOS
//     sitios: (a) como claim `csrf` dentro del JWT de sesión (cookie HttpOnly,
//     infalsificable) y (b) en una cookie `csrf_token` LEGIBLE por JS.
//   - El SPA lee la cookie `csrf_token` y la reenvía en el header X-CSRF-Token
//     en toda petición que modifique estado (POST/PUT/PATCH/DELETE).
//   - El servidor compara (timing-safe) el header contra el claim `csrf` del
//     JWT verificado. Coinciden ⇒ la petición proviene de nuestro SPA.
//
// Por qué es seguro: un sitio atacante en otro origen NO puede leer la cookie
// `csrf_token` (Same-Origin Policy) ni forjar el claim dentro del JWT firmado.
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Cookie legible por JS (httpOnly:false) — es solo un espejo del claim firmado,
// no un secreto de sesión, así que exponerla al SPA es seguro por diseño.
export function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: config.session.cookieSecure,
    sameSite: "strict",
    maxAge: config.session.ttlSeconds * 1000,
    path: "/",
  });
}

export function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE, {
    secure: config.session.cookieSecure,
    sameSite: "strict",
    path: "/",
  });
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Middleware global: exige un token CSRF válido en métodos que cambian estado,
// pero SOLO cuando ya existe una sesión (el login aún no tiene token y se salta).
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const sessionToken = req.cookies?.[config.session.cookieName];
  if (!sessionToken) return next(); // sin sesión no hay acción autenticada que proteger

  let claims;
  try {
    claims = jwt.verify(sessionToken, config.session.secret);
  } catch {
    // Sesión inválida/expirada: deja que requireAuth la rechace con 401.
    return next();
  }

  const headerToken = req.get(CSRF_HEADER) || "";
  if (!claims.csrf || !timingSafeEqual(headerToken, claims.csrf)) {
    return res.status(403).json({ message: "Token CSRF inválido o ausente" });
  }
  next();
}
