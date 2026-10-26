// ---------------------------------------------------------------------------
// Helpers compartidos entre NotificationBell (hoy) y NotificationsHistory
// (días anteriores, paginado) — separados en su propio archivo para que
// ninguno de los dos tenga que importar del otro (import circular).
import { Bell, LogIn, Trophy, Store as StoreIcon, Mail, KeyRound } from "lucide-react";

export function iconFor(tipo) {
  if (tipo === "checkin") return LogIn;
  if (tipo === "promoter_goal") return Trophy;
  if (tipo === "store_goal") return StoreIcon;
  if (tipo === "weekly_report") return Mail;
  if (tipo === "password_recovery") return KeyRound;
  return Bell;
}

export function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}
