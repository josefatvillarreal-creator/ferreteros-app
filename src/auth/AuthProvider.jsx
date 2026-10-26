// ---------------------------------------------------------------------------
// AuthProvider — login con ID de promotor + contraseña.
// ---------------------------------------------------------------------------
// Flujo:
//   1. El promotor ingresa su ID y contraseña.
//   2. POST /api/login → el backend verifica con bcrypt y, si es correcto,
//      responde con una cookie de sesión HttpOnly (+ token CSRF).
//   3. GET /api/auth/session carga el promotor + sus tiendas asignadas.
//
// El JWT nunca es accesible desde JavaScript (cookie HttpOnly); no se usa
// localStorage. Misma seguridad que el flujo anterior.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { clearAccessToken } from "../lib/tokenStore.js";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("loading"); // loading | anon | authed
  const [user, setUser] = useState(null); // { id, name, location, supervisor, stores }
  const [error, setError] = useState("");

  // Al montar, comprueba si ya existe una sesión válida (cookie).
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .session(ctrl.signal)
      .then((data) => {
        setUser(data);
        setStatus("authed");
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setStatus("anon");
      });
    return () => ctrl.abort();
  }, []);

  const login = useCallback(async (promoterId, password) => {
    setError("");
    try {
      await api.login(promoterId, password); // backend emite cookie HttpOnly
      const data = await api.session();
      setUser(data);
      setStatus("authed");
      return true;
    } catch (e) {
      setStatus("anon");
      setError(
        e instanceof ApiError && e.status === 401
          ? "ID o contraseña incorrectos."
          : "No se pudo iniciar sesión. Intenta de nuevo."
      );
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Aunque falle la red, limpiamos el estado local.
    }
    clearAccessToken();
    setUser(null);
    setStatus("anon");
  }, []);

  const value = { status, user, error, login, logout, setUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
