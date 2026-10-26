// ---------------------------------------------------------------------------
// In-memory token store.
// ---------------------------------------------------------------------------
// This is the ONLY place an access token may live on the client, and it lives
// exclusively in a module-scoped variable (JS heap). It is:
//   - NEVER written to localStorage / sessionStorage (XSS-exfiltratable).
//   - NEVER written to a non-HttpOnly cookie (also XSS-readable).
//   - Cleared automatically on a full page reload (memory is wiped).
//
// PREFERRED MODE: don't use this at all. In the Authorization-Code flow the
// backend keeps the tokens and hands the browser an HttpOnly session cookie,
// so the SPA holds no token whatsoever (see src/lib/api.js — `credentials`).
// This store exists only for a pure-SPA fallback where a short-lived access
// token must be attached as a Bearer header from memory.

let accessToken = null;

export function setAccessToken(token) {
  accessToken = token || null;
}

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
}
