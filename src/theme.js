// ---------------------------------------------------------------------------
// Tema de marca Protexa (Manual 2026) — módulo COMPARTIDO.
// ---------------------------------------------------------------------------
// Antes vivía dentro de PromotoresApp.jsx. Se extrajo aquí para que TANTO la app
// del promotor COMO la pantalla del gerente (ManagerDashboard.jsx) usen la MISMA
// paleta y el MISMO objeto de color "vivo".
//
// Amarillo #F8C000 · Negro #221F1C · Blanco #FFFFFF. Dos temas (oscuro/claro)
// que la app hereda del dispositivo vía `prefers-color-scheme`.
//
// Tokens de contraste importantes:
//   - `accent`     = Amarillo Protexa, SOLO como FONDO de botones/acciones.
//   - `onAccent`   = texto/ícono SOBRE el amarillo (Negro Protexa).
//   - `accentText` = color del acento cuando se usa como TEXTO/ícono/borde.
//                    En oscuro es el amarillo; en claro se oscurece para no
//                    violar la regla de marca "nunca amarillo sobre blanco".
// ---------------------------------------------------------------------------
export const PALETTES = {
  dark: {
    bg: "#1A1714",
    surface: "#221F1C", // Negro Protexa
    surface2: "#2E2A25",
    border: "#3B352E",
    text: "#FFFFFF",
    textMuted: "#B6AE9F",
    accent: "#F8C000", // Amarillo Protexa
    accentSoft: "rgba(248,192,0,0.15)",
    accentText: "#F8C000", // legible sobre superficies oscuras
    onAccent: "#221F1C", // texto sobre botones amarillos
    success: "#2DD9A8",
    successSoft: "rgba(45,217,168,0.14)",
    onSuccess: "#05231B",
    danger: "#F2545B",
    dangerSoft: "rgba(242,84,91,0.14)",
  },
  light: {
    bg: "#FFFFFF",
    surface: "#FFFFFF",
    surface2: "#F4F2EE",
    border: "#E4DFD6",
    text: "#221F1C", // Negro Protexa
    textMuted: "#6E675E",
    accent: "#F8C000", // Amarillo Protexa (fondo de acciones)
    accentSoft: "rgba(248,192,0,0.20)",
    accentText: "#221F1C", // en claro el acento-texto es negro (regla: no amarillo sobre blanco)
    onAccent: "#221F1C", // texto sobre botones amarillos (negro, alto contraste)
    success: "#137A5B",
    successSoft: "rgba(19,122,91,0.12)",
    onSuccess: "#FFFFFF",
    danger: "#C0343E",
    dangerSoft: "rgba(192,52,62,0.10)",
  },
};

// Detecta el esquema del dispositivo (claro/oscuro). Por defecto: oscuro.
export function detectScheme() {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

// Objeto de color VIVO: mantiene la MISMA referencia y se actualiza in-place al
// cambiar el tema, de modo que todos los estilos en línea (que leen COLORS.x en
// cada render) tomen los nuevos valores cuando el árbol se vuelve a renderizar.
export const COLORS = { ...PALETTES[detectScheme()] };

export function applyScheme(scheme) {
  Object.assign(COLORS, PALETTES[scheme] || PALETTES.dark);
}
