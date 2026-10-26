// Centralised, environment-driven configuration.
// No secrets here — only public client values (see .env.example).

export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

// Radio (metros) para el indicador de la UI. SOLO es informativo: el BACKEND
// recalcula la distancia (Haversine) con las coordenadas GPS reales y es la
// única autoridad que acepta o rechaza el check-in (Protexa: 100 m).
export const RANGE_METERS = 100;
