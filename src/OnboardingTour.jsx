// ---------------------------------------------------------------------------
// Onboarding simple — guía en pasos para mostrar las novedades según el rol.
// ---------------------------------------------------------------------------
// Un modal con 3-5 tarjetas (título + texto + ícono), navegación Anterior/
// Siguiente y puntos de progreso. Cada pantalla (PromotoresApp, Supervisor/
// ManagerDashboard) decide SU propio contenido (`steps`) y cuándo mostrarlo:
// la convención es una llave en localStorage tipo "onboarding_seen_v1_<rol>"
// — se marca vista al cerrarla, y subir el "v1" a "v2" el día que se agreguen
// features nuevas hace que todos la vuelvan a ver una vez. Simple a propósito:
// sin backend, sin tabla nueva — ver el chat para la decisión.
import { useState } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { COLORS } from "./theme.js";

export default function OnboardingTour({ steps, onClose }) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const isLast = i === steps.length - 1;
  const Icon = step.icon;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.surface, borderRadius: 18, width: "min(400px, 100%)", padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,0.45)", position: "relative" }}
      >
        <button
          onClick={onClose}
          title="Cerrar"
          style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", display: "flex" }}
        >
          <X size={18} />
        </button>

        <div style={{ width: 52, height: 52, borderRadius: 14, background: COLORS.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          {Icon && <Icon size={24} color={COLORS.accentText} />}
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: COLORS.text, margin: "0 0 8px", fontFamily: "Space Grotesk" }}>{step.title}</h3>
        <p style={{ fontSize: 13.5, color: COLORS.textMuted, lineHeight: 1.55, margin: step.action ? "0 0 16px" : "0 0 20px" }}>{step.body}</p>

        {/* Acción opcional del paso (ej. "Agregar a pantalla de inicio") —
            la mayoría de los pasos no la traen, así que casi nunca se pinta. */}
        {step.action && (
          <button
            onClick={step.action.onClick}
            style={{ width: "100%", padding: "10px 0", borderRadius: 10, border: `1px solid ${COLORS.accent}`, background: COLORS.accentSoft, color: COLORS.accentText, fontWeight: 700, fontSize: 13.5, cursor: "pointer", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          >
            {step.action.icon && <step.action.icon size={15} />}
            {step.action.label}
          </button>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 5 }}>
            {steps.map((_, idx) => (
              <span
                key={idx}
                style={{ width: idx === i ? 18 : 6, height: 6, borderRadius: 999, background: idx === i ? COLORS.accent : COLORS.border, transition: "width .2s ease" }}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {i > 0 && (
              <button
                onClick={() => setI((n) => n - 1)}
                title="Anterior"
                style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <button
              onClick={() => (isLast ? onClose() : setI((n) => n + 1))}
              style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              {isLast ? "Entendido" : "Siguiente"} {!isLast && <ChevronRight size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook chico: decide si hay que mostrar el onboarding de este rol (no se ha
// visto esta versión) y da una función para reabrirlo manualmente (botón de
// ayuda) sin que eso cuente como "ya lo vio" hasta que lo cierre.
export function useOnboarding(storageKey) {
  const [open, setOpen] = useState(() => {
    try {
      return typeof window !== "undefined" && !window.localStorage.getItem(storageKey);
    } catch {
      return false; // localStorage bloqueado (modo privado, etc.): no molestar
    }
  });

  function dismiss() {
    try { window.localStorage.setItem(storageKey, "1"); } catch { /* noop */ }
    setOpen(false);
  }

  return { open, show: () => setOpen(true), dismiss };
}
