// ---------------------------------------------------------------------------
// Router por ROL — decide qué app se muestra según quién inició sesión.
// ---------------------------------------------------------------------------
// - GERENTE o ADMIN  -> ManagerDashboard (tablero nacional).
// - SUPERVISOR        -> SupervisorDashboard (mismo tablero, acotado a SUS
//   promotores).
// - PROMOTOR (o sin sesión / cargando) -> PromotoresApp (app de campo, que ya
//   maneja el login, la carga y todas las pantallas del promotor).
//
// Hacemos el corte AQUÍ (arriba de PromotoresApp) a propósito: así, cuando entra
// un gerente o supervisor, NUNCA se montan los hooks del promotor (GPS, tiendas
// cercanas, cola offline). Todos inician sesión con la misma pantalla de login
// de PromotoresApp; al autenticarse, este router cambia de pantalla según el rol.
import { useAuth } from "./auth/AuthProvider.jsx";
import PromotoresApp from "./PromotoresApp.jsx";
import ManagerDashboard from "./ManagerDashboard.jsx";
import SupervisorDashboard from "./SupervisorDashboard.jsx";

export default function AppRouter() {
  const { status, user } = useAuth();
  const role = user?.role;

  if (status === "authed" && user && (role === "gerente" || role === "admin")) {
    return <ManagerDashboard />;
  }
  if (status === "authed" && user && role === "supervisor") {
    return <SupervisorDashboard />;
  }

  // Promotor, anónimo o cargando: la app de campo maneja esos estados.
  return <PromotoresApp />;
}
