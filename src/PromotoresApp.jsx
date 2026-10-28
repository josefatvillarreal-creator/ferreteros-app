import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { LogOut, MapPin, ArrowLeft, Check, Minus, Plus, Navigation, AlertTriangle, Clock, WifiOff, RefreshCw, Camera, User, Lock, MessageSquare, Send, X, Home, BarChart3, GraduationCap, LifeBuoy, ImagePlus, Trophy, Zap, HelpCircle, Eye, EyeOff, KeyRound, Heart, HardDrive, Download, ChevronRight, ChevronLeft, Ticket } from "lucide-react";
import { useAuth } from "./auth/AuthProvider.jsx";
import { api, ApiError } from "./lib/api.js";
import { RANGE_METERS } from "./config.js";
import OnboardingTour, { useOnboarding } from "./OnboardingTour.jsx";
import { usePwaInstall } from "./lib/pwaInstall.js";
import { useLeaflet } from "./lib/useLeaflet.js";
import { attachBaseMap } from "./lib/mapTiles.js";
import CameraCapture, { cameraSupported } from "./CameraCapture.jsx";
import { processPickedFile } from "./lib/photoPipeline.js";
import { getDeviceProfile, formatForReport, TIER_LABEL, NETWORK_LABEL } from "./lib/deviceProfile.js";
import { useThreadsSummary } from "./lib/threads.js";
import PromoterTickets from "./PromoterTickets.jsx";
import TrainingSection from "./TrainingSection.jsx";
import {
  enqueueAction,
  listQueuedActions,
  removeQueuedAction,
  countQueued,
  cacheRecords,
  readCachedRecords,
} from "./lib/offlineStore.js";

// La paleta de marca Protexa (claro/oscuro) y el objeto de color "vivo" COLORS
// se movieron a ./theme.js para COMPARTIRLOS con la pantalla del gerente
// (ManagerDashboard.jsx). Aquí solo los importamos; el comportamiento es idéntico.
import { COLORS, detectScheme, applyScheme } from "./theme.js";

// NOTE: PROMOTERS, GOOGLE_ACCOUNTS and GOOGLE_DOMAIN have been removed.
// Identity now comes from Google Workspace (OIDC) and the promoter's assigned
// stores are loaded from the backend via `useAuth().user` / the API — never
// hardcoded in the client bundle.

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtTime(iso) {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(startIso, endIso) {
  if (!startIso) return "";
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((end - start) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// Encabezado de día legible ("Lunes 22 de septiembre") para el historial
// agrupado por día — mismo criterio que el historial que ve el admin/
// supervisor en PromoterProfile.jsx.
function fmtDayHeader(day) {
  const [y, m, d] = String(day).split("-").map(Number);
  if (!y || !m || !d) return day || "Sin fecha";
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtDistance(m) {
  if (m == null) return "--";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

// Mensaje claro para errores de geolocalización. El caso más común en móviles
// es no estar en un contexto seguro (HTTPS): los navegadores bloquean el GPS.
function gpsErrorMessage(err) {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "El GPS requiere conexión segura (HTTPS). Abre la app por https:// (o localhost).";
  }
  if (err && err.code === err.PERMISSION_DENIED) {
    return "Permiso de ubicación denegado. Actívalo en el navegador para continuar.";
  }
  if (err && err.code === err.TIMEOUT) {
    return "Tardó demasiado en obtener el GPS. Sal a cielo abierto e inténtalo de nuevo.";
  }
  return "No se pudo obtener tu ubicación GPS.";
}


// La tipografía de marca es Helvetica (fuente de sistema); no se cargan fuentes
// web. Se conserva el hook como no-op para no tocar el resto del componente.
function useGoogleFonts() {}

// Onboarding del PROMOTOR — sube la versión ("v1" -> "v2") cuando se agreguen
// features nuevas para que todos la vuelvan a ver una vez.
const ONBOARDING_KEY_PROMOTOR = "onboarding_seen_v2_promotor";
const ONBOARDING_STEPS_PROMOTOR_BASE = [
  {
    icon: Navigation,
    title: "Bienvenido a la nueva versión",
    body: "El registro de check-in y check-out sigue igual. Aquí te contamos rápido lo nuevo.",
  },
  {
    icon: Trophy,
    title: "Tu meta de ventas del mes",
    body: "Ahora ves tu meta real (asignada por tu administrador) y tu avance del mes, con niveles Bronce, Plata y Oro.",
  },
  {
    icon: BarChart3,
    title: "Reporta a la competencia",
    body: "Desde \"Competencia\" ya puedes subir hasta 5 fotos como evidencia; tu reporte se guarda automáticamente.",
  },
  {
    icon: HardDrive,
    title: "¿Se traba al tomar la foto?",
    body: "Si tu teléfono te dice \"memoria insuficiente\" al tomar o subir la foto, libera espacio: Ajustes > Apps > Chrome > Almacenamiento > \"Borrar caché\" (NO \"Borrar datos\": eso sí te cerraría la sesión). Hazlo cada semana si tu teléfono anda justo de espacio.",
  },
];

function Stepper({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderBottom: `1px solid ${COLORS.border}` }}>
      <span style={{ fontFamily: "Inter", fontSize: 15, color: COLORS.text }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <Minus size={16} />
        </button>
        <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, fontWeight: 600, color: COLORS.text, minWidth: 28, textAlign: "center" }}>{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.accent}`, background: COLORS.accentSoft, color: COLORS.accentText, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function Radar({ distance, inRange, gpsError, hasFix }) {
  // Sin fix GPS todavía (o error): estado neutro/alerta, no "fuera de rango".
  const waiting = !hasFix;
  const statusColor = gpsError ? COLORS.danger : inRange ? COLORS.success : waiting ? COLORS.textMuted : COLORS.accentText;
  const label = gpsError ? "SIN UBICACIÓN" : waiting ? "BUSCANDO GPS…" : inRange ? "DENTRO DEL RANGO" : "FUERA DE RANGO";
  return (
    <div style={{ position: "relative", width: 220, height: 220, margin: "0 auto" }}>
      <style>{`
        @keyframes radarPulse {
          0% { transform: scale(0.4); opacity: 0.55; }
          100% { transform: scale(1.15); opacity: 0; }
        }
        .radar-pulse { animation: radarPulse 2.2s ease-out infinite; transform-origin: center; }
      `}</style>
      <svg viewBox="0 0 220 220" style={{ width: "100%", height: "100%" }}>
        <circle cx="110" cy="110" r="100" fill="none" stroke={COLORS.border} strokeWidth="1" strokeDasharray="3 6" />
        <circle cx="110" cy="110" r="68" fill="none" stroke={COLORS.border} strokeWidth="1" strokeDasharray="3 6" />
        <circle cx="110" cy="110" r="36" fill="none" stroke={COLORS.border} strokeWidth="1" />
        {inRange && <circle className="radar-pulse" cx="110" cy="110" r="36" fill={statusColor} opacity="0.35" />}
        <circle cx="110" cy="110" r="26" fill={statusColor} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <span style={{ fontFamily: "JetBrains Mono", fontSize: 22, fontWeight: 600, color: COLORS.text }}>{hasFix ? fmtDistance(distance) : "--"}</span>
        <span style={{ fontFamily: "Inter", fontSize: 11, letterSpacing: "0.06em", color: statusColor, marginTop: 4, fontWeight: 600, textAlign: "center", padding: "0 10px" }}>
          {label}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapa (Leaflet empaquetado con la app; teselas con respaldo en lib/mapTiles.js).
// Muestra la ubicación real del promotor y, opcionalmente, las sucursales cercanas.
// ---------------------------------------------------------------------------
function MapView({ coords, sucursales = [] }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const userRef = useRef(null);
  const tilesRef = useRef(null);
  const [retryKey, setRetryKey] = useState(0);
  const { L, failed: loadFailed } = useLeaflet(retryKey); // Leaflet viene empaquetado con la app
  const [tilesFailed, setTilesFailed] = useState(false); // ningún proveedor de teselas respondió
  const failed = loadFailed || tilesFailed;

  function destroyMap() {
    if (tilesRef.current) { tilesRef.current.destroy(); tilesRef.current = null; }
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    userRef.current = null;
  }

  function retry() {
    destroyMap();
    setTilesFailed(false);
    setRetryKey((k) => k + 1);
  }

  // Limpieza al desmontar.
  useEffect(() => destroyMap, []);

  // Inicializa / actualiza el mapa cuando hay coordenadas.
  useEffect(() => {
    if (!L || !coords || !elRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(elRef.current, { zoomControl: false, attributionControl: true }).setView([coords.lat, coords.lng], 15);
      tilesRef.current = attachBaseMap(L, mapRef.current, { onFail: () => setTilesFailed(true) });
      const icon = L.divIcon({
        className: "",
        html: `<div style="color:${COLORS.accent};filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      userRef.current = L.marker([coords.lat, coords.lng], { icon }).addTo(mapRef.current);
    } else {
      mapRef.current.setView([coords.lat, coords.lng]);
      userRef.current.setLatLng([coords.lat, coords.lng]);
    }
    setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 150);
  }, [L, coords, retryKey]);

  // Marcadores de las sucursales.
  useEffect(() => {
    if (!L || !mapRef.current) return;
    mapRef.current.__stores = mapRef.current.__stores || L.layerGroup().addTo(mapRef.current);
    const layer = mapRef.current.__stores;
    layer.clearLayers();
    // Marcador de cada sucursal: círculo naranja (#F96302) con ícono de casa. El
    // tooltip muestra "Cliente – Sucursal (Num)".
    const hdHtml = `<div style="width:26px;height:26px;border-radius:50%;background:#F96302;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/></svg></div>`;
    for (const s of sucursales) {
      if (typeof s.lat !== "number" || typeof s.lng !== "number") continue;
      const icon = L.divIcon({ className: "", html: hdHtml, iconSize: [26, 26], iconAnchor: [13, 13] });
      const label = `${s.clienteNombre ? `${s.clienteNombre} – ` : ""}${s.name}${s.id ? ` (${s.id})` : ""}`;
      L.marker([s.lat, s.lng], { icon }).bindTooltip(label, { direction: "top" }).addTo(layer);
    }
  }, [L, sucursales, retryKey]);

  // Fallback si el mapa no cargó (sin red, o ningún proveedor de teselas
  // respondió): muestra las coordenadas en texto en lugar de un recuadro vacío.
  if (failed) {
    return (
      <div style={{ marginBottom: 14, height: 160, borderRadius: 14, border: `1px solid ${COLORS.border}`, background: COLORS.surface, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, textAlign: "center" }}>
        <MapPin size={22} color={COLORS.accentText} />
        <span style={{ fontSize: 13, color: COLORS.text, fontFamily: "JetBrains Mono" }}>
          {coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : "Ubicación no disponible"}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textMuted, lineHeight: 1.4 }}>
          El mapa no cargó con esta conexión. Puedes seguir registrando tu visita.
        </span>
        <button onClick={retry} style={{ marginTop: 2, padding: "6px 14px", borderRadius: 9, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", marginBottom: 14 }}>
      <div ref={elRef} style={{ height: 160, borderRadius: 14, overflow: "hidden", border: `1px solid ${COLORS.border}`, background: COLORS.surface2 }} />
      {!coords && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 12.5, pointerEvents: "none" }}>
          Obteniendo tu ubicación…
        </div>
      )}
    </div>
  );
}

// Diagnóstico del teléfono (pestaña Perfil): muestra qué detectó la app del
// dispositivo y la red, y qué tamaño/calidad de foto está usando por eso. Sirve
// de apoyo a soporte ("léeme lo que dice ahí") y se adjunta resumido a los
// reportes. Todo se calcula en el teléfono; ver lib/deviceProfile.js.
function DeviceDiagnostics() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getDeviceProfile().then((p) => { if (alive) setProfile(p); });
    return () => { alive = false; };
  }, [open]);

  const s = profile?.snapshot;
  const c = profile?.classification;
  const m = profile?.metrics;
  const rows = profile ? [
    ["Nivel del equipo", TIER_LABEL[c.tier]],
    ["Red", `${NETWORK_LABEL[c.network]}${s.netType ? ` (${s.netType})` : ""}${s.saveData ? " · ahorro de datos" : ""}`],
    ["Memoria RAM", s.memoryGB != null ? `${s.memoryGB} GB` : "No disponible"],
    ["Núcleos", s.cores != null ? String(s.cores) : "No disponible"],
    ["Sistema", s.os || "No disponible"],
    ["Espacio libre", s.storageFreeMB != null ? `${s.storageFreeMB} MB` : "No disponible"],
    ["Foto de visita", `${profile.visit.maxDim} px · calidad ${Math.round(profile.visit.quality * 100)}%`],
    ["Fotos recientes", m.total ? `${m.ok} bien · ${m.failed} con falla${m.medianMs != null ? ` · ${Math.round(m.medianMs)} ms` : ""}` : "Aún sin fotos"],
  ] : [];

  return (
    <div style={{ marginTop: 18 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left" }}
      >
        <HardDrive size={15} color={COLORS.accentText} />
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: COLORS.text }}>Diagnóstico de mi teléfono</span>
        <ChevronRight size={15} color={COLORS.textMuted} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div style={{ marginTop: 8, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "6px 14px" }}>
          {!profile ? (
            <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "10px 0" }}>Midiendo…</p>
          ) : (
            <>
              {rows.map(([k, v], i) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: i < rows.length - 1 ? `1px solid ${COLORS.border}` : "none" }}>
                  <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>{k}</span>
                  <span style={{ fontSize: 12.5, color: COLORS.text, fontWeight: 600, textAlign: "right" }}>{v}</span>
                </div>
              ))}
              {c.reasons.length > 0 && (
                <p style={{ fontSize: 11.5, color: COLORS.textMuted, margin: "4px 0 10px", lineHeight: 1.45 }}>
                  La app reduce el tamaño de tus fotos porque detectó: {c.reasons.join(", ")}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GoalBar({ label, actual, meta }) {
  const pct = Math.min(100, Math.round((actual / meta) * 100) || 0);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, color: COLORS.text, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, color: COLORS.textMuted }}>{actual} / {meta} · <b style={{ color: COLORS.accentText }}>{pct}%</b></span>
      </div>
      <div style={{ height: 12, borderRadius: 999, background: COLORS.surface2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: `linear-gradient(90deg, ${COLORS.accent}, #ffd84d)`, transition: "width .4s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {[25, 50, 75, 100].map((m) => (
          <span key={m} style={{ fontSize: 8.5, fontWeight: 600, color: pct >= m ? COLORS.accentText : COLORS.textMuted }}>{m === 100 ? "Meta" : `${m}%`}</span>
        ))}
      </div>
    </div>
  );
}

// Barra de meta de ventas con gamificación (nivel + mensaje motivacional).
// `goal` viene de GET /api/visits/my-goal: { target, achieved, reached }
// (unidades-equivalentes: cada producto pesa según su equivalencia, ACUMULADAS EN LA
// SEMANA — los galones no cuentan hacia la meta; personalizada o el default
// de 30) o `null` mientras todavía no llega la respuesta del servidor.
function SalesGoals({ goal }) {
  if (!goal) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <Trophy size={16} color={COLORS.textMuted} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 12.5, color: COLORS.textMuted, lineHeight: 1.45 }}>Cargando tu meta de ventas…</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((goal.achieved / goal.target) * 100) || 0);
  const level = pct >= 100 ? "Nivel Oro" : pct >= 50 ? "Nivel Plata" : "Nivel Bronce";
  const faltan = Math.max(0, goal.target - goal.achieved);
  const msg = goal.reached
    ? "¡Meta cumplida esta semana! Excelente trabajo."
    : pct >= 75 ? `¡Casi lo logras! Te faltan ${faltan.toFixed(1)} unidades esta semana.`
    : pct >= 40 ? `¡Vas muy bien! Te faltan ${faltan.toFixed(1)} unidades para tu meta de la semana.`
    : "¡Vamos con todo! Cada visita te acerca a tu meta de la semana.";
  return (
    <>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.1em", color: COLORS.textMuted, fontWeight: 600 }}>META DE VENTAS DE LA SEMANA</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, background: COLORS.accentSoft, color: COLORS.accentText, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
            <Trophy size={12} /> {level}
          </span>
        </div>
        <GoalBar label="Unidades equivalentes" actual={goal.achieved} meta={goal.target} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: COLORS.successSoft, border: `1px solid ${COLORS.success}55`, borderRadius: 12, padding: "10px 12px", marginBottom: 14 }}>
        <Zap size={16} color={COLORS.success} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.45 }}>{msg}</span>
      </div>
    </>
  );
}

export default function PromotoresApp() {
  useGoogleFonts();

  // Tema claro/oscuro heredado del dispositivo (prefers-color-scheme). Al
  // cambiar el esquema del sistema, se actualiza la paleta VIVA (in-place) y se
  // fuerza un re-render para que toda la UI adopte el nuevo tema al instante.
  const [scheme, setScheme] = useState(detectScheme());
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e) => {
      const s = e.matches ? "light" : "dark";
      applyScheme(s);
      setScheme(s);
    };
    applyScheme(scheme); // asegura sincronía inicial
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange); // Safari antiguo
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { status, user, error: authError, login, logout } = useAuth();
  const onboarding = useOnboarding(ONBOARDING_KEY_PROMOTOR);
  const { canInstall, isStandalone, promptInstall } = usePwaInstall();

  // Seguimiento de tickets (cada reporte de "Reportar" abre uno): resumen para
  // el punto de "respuesta nueva" del botón de la barra superior. No es en
  // vivo — se pide al entrar, al volver a la app y cada 2 minutos.
  const threads = useThreadsSummary({ userId: user?.id, role: "promotor", enabled: status === "authed" && Boolean(user), pollMs: 120000 });
  const [ticketsInitialId, setTicketsInitialId] = useState(null);
  function openTickets(id) {
    setTicketsInitialId(typeof id === "string" ? id : null); // onClick pasa el evento: solo cuenta un ID de ticket
    setScreen("tickets");
  }

  // Último paso del onboarding: instalar la app a la pantalla de inicio.
  // Se arma aparte (no en la lista estática) porque su texto y su botón
  // dependen de si el navegador puede ofrecer el instalado con un clic
  // (Chrome/Android) o si ya está instalada — ninguno de los otros pasos
  // depende de estado en vivo.
  // Meta de ventas: { target, achieved, reached } | { enabled: false } (metas desactivadas) | null (cargando)
  const [myGoal, setMyGoal] = useState(null);
  const goalsOff = myGoal?.enabled === false;
  const onboardingStepsPromotor = useMemo(() => {
    const installStep = isStandalone
      ? {
          icon: Download,
          title: "Ya la tienes instalada",
          body: "Perfecto: al abrirla desde el ícono de tu pantalla de inicio usa menos memoria que un tab de Chrome más.",
        }
      : canInstall
        ? {
            icon: Download,
            title: "Agrégala a tu pantalla de inicio",
            body: "Así abre como una app aparte (no como una pestaña más de Chrome) — arranca más rápido y usa menos memoria de tu teléfono.",
            action: { label: "Agregar a pantalla de inicio", icon: Download, onClick: promptInstall },
          }
        : {
            icon: Download,
            title: "Agrégala a tu pantalla de inicio",
            body: "Abre el menú (⋮) de Chrome y elige \"Instalar app\" o \"Agregar a pantalla de inicio\". Así abre como una app aparte y usa menos memoria de tu teléfono.",
          };
    const base = goalsOff ? ONBOARDING_STEPS_PROMOTOR_BASE.filter((st) => st.title !== "Tu meta de ventas del mes") : ONBOARDING_STEPS_PROMOTOR_BASE;
    return [...base, installStep];
  }, [canInstall, isStandalone, promptInstall, goalsOff]);

  const [screen, setScreen] = useState("dashboard");
  const [records, setRecords] = useState({});
  const [myHistory, setMyHistory] = useState(null); // perfil completo (sucursales frecuentes, foto) | null

  // Mi historial de check-in/check-out (pantalla aparte, ver screen ===
  // "historial") — paginado POR DÍA, 7 días por default. Antes vivía dentro
  // de "Perfil" sin paginar; con meses de uso eso era cada vez más datos.
  const [historyPage, setHistoryPage] = useState(1);
  const [historyDaysPerPage, setHistoryDaysPerPage] = useState(7);
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [selectedSucursal, setSelectedSucursal] = useState(null);
  const [busy, setBusy] = useState(false);

  // Sucursales cercanas (por GPS). No hay asignación fija por promotor.
  const [nearbySucursales, setNearbySucursales] = useState([]);
  const [allSucursales, setAllSucursales] = useState([]); // catálogo completo (para el mapa)
  const [nearbyRadius, setNearbyRadius] = useState(2000); // m; lo confirma el server
  const [dashCoords, setDashCoords] = useState(null);
  const [sucursalesLoading, setSucursalesLoading] = useState(false);
  const [sucursalesError, setSucursalesError] = useState(null);

  // Formulario de login (ID de promotor + contraseña).
  const [promoterId, setPromoterId] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Flujo de "recuperar mi cuenta": no resetea nada aquí — solo avisa al
  // supervisor (o admin) de que hace falta una contraseña nueva.
  const [authView, setAuthView] = useState("login"); // "login" | "recover"
  const [recoverId, setRecoverId] = useState("");
  const [recoverSending, setRecoverSending] = useState(false);
  const [recoverDone, setRecoverDone] = useState(false);
  const [recoverError, setRecoverError] = useState("");

  const [gpsCoords, setGpsCoords] = useState(null);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [showSheet, setShowSheet] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false); // modal de retroalimentación

  // Formulario de Competencia: se guarda en la base de datos (con fotos) y en
  // una pestaña del Sheet ("Competencia") como resumen para el admin.
  const [compMarca, setCompMarca] = useState("");
  const [compDesc, setCompDesc] = useState("");
  const [compFotos, setCompFotos] = useState([]); // [{ name, dataUrl }] — dataUrl sirve para previsualizar Y para enviar
  const [compSent, setCompSent] = useState(false);
  const [compSending, setCompSending] = useState(false);
  const [compError, setCompError] = useState("");
  const compFileRef = useRef(null); // galería (varias fotos)
  const compCaptureRef = useRef(null); // cámara del sistema (respaldo si no abre la integrada)
  const [cameraFor, setCameraFor] = useState(null); // cámara integrada abierta: "visit" | "competition" | null
  const MAX_COMP_FOTOS = 5;
  // Catálogo activo [{ id, nombre, unidad, orden }]. Se cachea en el dispositivo para poder
  // capturar la salida aun sin red; `productosError` distingue "no cargó" de "catálogo vacío".
  const [productos, setProductos] = useState(() => {
    try { return JSON.parse(localStorage.getItem("productos_cache") || "[]"); } catch { return []; }
  });
  const [productosError, setProductosError] = useState(false);
  const [cantidades, setCantidades] = useState({}); // { [productoId]: cantidad } del check-out en curso
  const [photo, setPhoto] = useState(null); // foto de check-in (Base64), obligatoria
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef(null);
  const watchIdRef = useRef(null);

  // Estado de conectividad y cola offline cifrada.
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const sucursales = nearbySucursales;
  const sucursal = selectedSucursal;
  const record = sucursal ? records[sucursal.id] : null;

  // Recordatorio: sigue "en la sucursal" (check-in sin check-out) y ya es tarde.
  // Solo un aviso visual al abrir el dashboard — no hay push real todavía.
  const openVisit = Object.values(records).find((r) => r?.status === "checked-in");
  const openVisitSucursal = openVisit ? allSucursales.find((s) => s.id === openVisit.sucursalId) : null;
  const showCheckoutReminder = Boolean(openVisit) && new Date().getHours() >= 19;

  // Confirmación "sigo en la sucursal": una vez al día, en un momento aleatorio
  // entre 10am y 4pm (hora del dispositivo), mientras tenga un check-in
  // abierto. El momento se calcula con una semilla (ID + día) para que sea el
  // mismo durante todo el día aunque recargue la app, sin backend nuevo para
  // decidir CUÁNDO mostrarlo — solo para GUARDAR la confirmación.
  const [presenceModalOpen, setPresenceModalOpen] = useState(false);
  const [presenceSending, setPresenceSending] = useState(false);
  const [presenceError, setPresenceError] = useState("");

  useEffect(() => {
    if (status !== "authed" || !user) return;
    const check = () => {
      if (presenceModalOpen || !openVisit) return;
      const dayKey = new Date().toLocaleDateString("en-CA");
      const doneKey = `presence_confirmed_${user.id}_${dayKey}`;
      if (localStorage.getItem(doneKey)) return;
      let h = 0;
      const seed = `${user.id}-${dayKey}`;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
      const startMin = 10 * 60, endMin = 16 * 60;
      const targetMin = startMin + (Math.abs(h) % (endMin - startMin));
      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(targetMin / 60), targetMin % 60);
      if (now >= target) setPresenceModalOpen(true);
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [status, user, openVisit, presenceModalOpen]);

  // Intenta tomar el GPS en el momento en que el promotor responde — best-
  // effort: si falla o lo niega, se sigue adelante sin ubicación en vez de
  // bloquear la respuesta (a diferencia del check-in, aquí la ubicación es
  // un dato adicional para el registro, no un requisito de la operación).
  function getBestEffortCoords() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  async function handleConfirmPresence(sigueEnTienda) {
    if (presenceSending || !openVisit) return;
    setPresenceSending(true);
    setPresenceError("");
    try {
      const coords = await getBestEffortCoords();
      await api.confirmPresence(openVisit.sucursalId, { coords, sigueEnTienda });
      localStorage.setItem(`presence_confirmed_${user.id}_${new Date().toLocaleDateString("en-CA")}`, "1");
      setPresenceModalOpen(false);
    } catch (e) {
      setPresenceError(e instanceof ApiError ? e.message : "No hay conexión. Intenta de nuevo en un momento.");
    } finally {
      setPresenceSending(false);
    }
  }

  // Se muestra en las 4 pantallas donde también vive FeedbackModal (dashboard,
  // detalle de sucursal, competencia, perfil) — es una alerta que debe alcanzar
  // al promotor sin importar en qué pantalla esté.
  const presenceModalNode = presenceModalOpen && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,8,12,0.6)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 360, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24, textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: COLORS.accentSoft, color: COLORS.accentText, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <Heart size={24} />
        </div>
        <h3 style={{ fontFamily: "Space Grotesk", fontSize: 17, fontWeight: 600, color: COLORS.text, margin: "0 0 8px" }}>¿Sigues en la sucursal?</h3>
        <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, margin: "0 0 18px" }}>
          Solo queremos confirmar que sigues en{openVisitSucursal ? ` ${openVisitSucursal.name}` : " tu punto de venta"}. Al responder tomamos tu ubicación actual.
        </p>
        {presenceError && <p style={{ color: COLORS.danger, fontSize: 12.5, margin: "0 0 12px" }}>{presenceError}</p>}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => handleConfirmPresence(false)}
            disabled={presenceSending}
            style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.text, fontFamily: "Inter", fontWeight: 700, fontSize: 14.5, cursor: presenceSending ? "default" : "pointer", opacity: presenceSending ? 0.7 : 1 }}
          >
            No, ya me fui
          </button>
          <button
            onClick={() => handleConfirmPresence(true)}
            disabled={presenceSending}
            style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontFamily: "Inter", fontWeight: 700, fontSize: 14.5, cursor: presenceSending ? "default" : "pointer", opacity: presenceSending ? 0.7 : 1 }}
          >
            {presenceSending ? "Enviando…" : "Sí, sigo aquí"}
          </button>
        </div>
      </div>
    </div>
  );

  // Reenvía al backend las acciones que se encolaron (cifradas) sin red.
  const flushQueue = useCallback(async () => {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    try {
      const actions = await listQueuedActions();
      for (const a of actions) {
        try {
          if (a.type === "check-in") {
            await api.checkIn(a.sucursalId, a.payload); // { coords, photo }
          } else if (a.type === "check-out") {
            await api.checkOut(a.sucursalId, a.payload);
          }
          await removeQueuedAction(a.id); // solo se borra si el servidor la aceptó
        } catch (e) {
          // 4xx = el servidor la rechazó (p.ej. fuera de rango): descartar para
          // no reintentar en bucle. Error de red: se deja para el próximo flush.
          if (e instanceof ApiError) await removeQueuedAction(a.id);
          else break;
        }
      }
      // Refresca desde el servidor y actualiza la caché cifrada.
      try {
        const data = await api.visitsToday();
        setRecords(data?.records ?? {});
        await cacheRecords(data?.records ?? {});
      } catch {
        /* sin red: conservamos lo que haya en memoria */
      }
    } finally {
      setPending(await countQueued());
      setSyncing(false);
    }
  }, [syncing]);

  // Escucha cambios de conectividad del navegador.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      flushQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flushQueue]);

  // Load today's visit records: del backend si hay red (y se cachea cifrado),
  // o de la caché cifrada local si estamos offline.
  useEffect(() => {
    if (status !== "authed") return;
    let active = true;
    (async () => {
      setPending(await countQueued());
      try {
        const data = await api.visitsToday();
        if (!active) return;
        setRecords(data?.records ?? {});
        await cacheRecords(data?.records ?? {});
        await flushQueue();
      } catch {
        // Sin red: usar la copia local cifrada.
        const cached = await readCachedRecords();
        if (active) setRecords(cached ?? {});
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Meta de ventas del mes (la fija el admin desde su tablero). Se recarga
  // cada vez que cambian los registros de hoy, para reflejar un check-out
  // recién hecho sin esperar a recargar la página.
  useEffect(() => {
    if (status !== "authed") return;
    let active = true;
    api
      .myGoal()
      .then((g) => { if (active) setMyGoal(g); })
      .catch(() => {}); // sin meta asignada o sin red: se queda en null
    return () => { active = false; };
  }, [status, records]);

  // Sucursales frecuentes + foto — solo se pide al entrar a "Perfil", no en cada
  // carga del dashboard.
  useEffect(() => {
    if (status !== "authed" || screen !== "perfil" || !user) return;
    let active = true;
    api
      .promoterProfile(user.id)
      .then((p) => { if (active) setMyHistory(p); })
      .catch(() => {});
    return () => { active = false; };
  }, [status, screen, user]);

  // Mi historial paginado — solo se pide al entrar a "historial", y de nuevo
  // si cambia la página o los días por página.
  useEffect(() => {
    if (status !== "authed" || screen !== "historial" || !user) return;
    let active = true;
    setHistoryLoading(true);
    setHistoryError("");
    api
      .promoterHistory(user.id, { page: historyPage, daysPerPage: historyDaysPerPage })
      .then((res) => { if (active) setHistoryData(res); })
      .catch((e) => { if (active) setHistoryError(e instanceof ApiError ? e.message : "No se pudo cargar tu historial."); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [status, screen, user, historyPage, historyDaysPerPage]);

  function openHistorial() {
    setHistoryPage(1);
    setScreen("historial");
  }
  function changeHistoryDaysPerPage(n) {
    setHistoryDaysPerPage(n);
    setHistoryPage(1);
  }

  // Obtiene la ubicación GPS real y pide al backend las sucursales cercanas
  // (Haversine, radio ~2 km). No hay asignación fija por promotor.
  const loadNearbySucursales = useCallback(async () => {
    if (!("geolocation" in navigator)) {
      setSucursalesError("Este dispositivo no soporta geolocalización.");
      return;
    }
    setSucursalesLoading(true);
    setSucursalesError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setDashCoords(coords);
        try {
          const data = await api.nearbySucursales(coords.lat, coords.lng);
          setNearbySucursales(data?.sucursales ?? []);
          if (typeof data?.radius === "number") setNearbyRadius(data.radius);
        } catch (e) {
          setSucursalesError(
            e instanceof ApiError ? e.message : "No se pudieron cargar las sucursales cercanas."
          );
        } finally {
          setSucursalesLoading(false);
        }
      },
      (err) => {
        setSucursalesLoading(false);
        setSucursalesError(gpsErrorMessage(err));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
  }, []);

  // Al entrar al dashboard con sesión, carga las sucursales cercanas.
  useEffect(() => {
    if (status === "authed" && screen === "dashboard") loadNearbySucursales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, screen]);

  // Carga el catálogo COMPLETO de sucursales (para pintarlas todas en el mapa).
  useEffect(() => {
    if (status !== "authed") return;
    const ctrl = new AbortController();
    api
      .allSucursales(ctrl.signal)
      .then((data) => setAllSucursales(data?.sucursales ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [status]);

  // Catálogo de productos ACTIVOS: uno de los campos del reporte del día por cada uno.
  // Se pide al autenticarse y de nuevo al abrir la hoja de salida si no se pudo cargar.
  const loadProductos = useCallback(async (signal) => {
    try {
      const data = await api.productos(signal);
      const list = data?.productos ?? [];
      setProductos(list);
      setProductosError(false);
      try { localStorage.setItem("productos_cache", JSON.stringify(list)); } catch { /* sin almacenamiento: no pasa nada */ }
    } catch (e) {
      if (e?.name !== "AbortError") setProductosError(true);
    }
  }, []);
  useEffect(() => {
    if (status !== "authed") return;
    const ctrl = new AbortController();
    loadProductos(ctrl.signal);
    return () => ctrl.abort();
  }, [status, loadProductos]);

  // GPS REAL únicamente (sin modo simulación). Observa la ubicación del
  // dispositivo mientras se está en la pantalla de una sucursal.
  useEffect(() => {
    if (screen !== "sucursalDetail" || !sucursal) return;
    setGpsCoords(null);
    setGpsAccuracy(null);
    setGpsError(null);
    if (!("geolocation" in navigator)) {
      setGpsError("Este dispositivo no soporta geolocalización.");
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsAccuracy(pos.coords.accuracy);
        setGpsError(null);
      },
      (err) => {
        setGpsCoords(null);
        setGpsError(gpsErrorMessage(err));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
    return () => {
      if (watchIdRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, [screen, sucursal]);

  // Radio real que aplica el servidor (configurable con CHECK_IN_RADIUS_METERS).
  // Lo envía la sesión; si aún no llegó, usa el valor por defecto del cliente.
  const radiusMeters = user?.checkInRadiusMeters ?? RANGE_METERS;

  // Distancia INFORMATIVA para la UI (el servidor es la autoridad). Se calcula
  // solo si hay un fix GPS real.
  const distance = sucursal && gpsCoords
    ? distanceMeters(gpsCoords.lat, gpsCoords.lng, sucursal.lat, sucursal.lng)
    : null;
  const inRange = distance != null && distance <= radiusMeters;
  // Nombre del producto para mostrar un item guardado (si ya no está en el catálogo activo, su id).
  const productoNombre = (id) => productos.find((p) => p.id === id)?.nombre ?? id;
  // Items en el orden del catálogo (los productos que ya no están activos, al final).
  const ordenarItems = (items) => {
    const pos = (id) => { const i = productos.findIndex((p) => p.id === id); return i === -1 ? productos.length : i; };
    return [...items].sort((a, b) => pos(a.productoId) - pos(b.productoId));
  };

  function openSucursal(sucursalObj) {
    setSelectedSucursal(sucursalObj);
    setCantidades({});
    setPhoto(null);
    setGpsCoords(null);
    setGpsAccuracy(null);
    setGpsError(null);
    setScreen("sucursalDetail");
  }

  async function handlePhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file) return;
    setPhotoBusy(true);
    try {
      setPhoto(await processPickedFile(file, "visit"));
    } catch (err) {
      alert(err.message || "No se pudo procesar la foto.");
    } finally {
      setPhotoBusy(false);
    }
  }

  // Abre la cámara integrada de la app; si el navegador no la soporta, cae al
  // selector de archivos del sistema (la cámara del teléfono de siempre).
  function openCamera(kind) {
    if (cameraSupported()) setCameraFor(kind);
    else openSystemCamera(kind);
  }

  function openSystemCamera(kind) {
    setCameraFor(null);
    const ref = kind === "visit" ? fileInputRef : compCaptureRef;
    setTimeout(() => ref.current && ref.current.click(), 0);
  }

  // Actualiza el estado en memoria y refresca la caché cifrada en disco.
  async function persistRecords(next) {
    setRecords(next);
    await cacheRecords(next);
  }

  // Guarda una acción sin red: la encola CIFRADA y refleja el estado optimista.
  async function queueOffline(type, payload, optimisticRecord) {
    await enqueueAction({ type, sucursalId: sucursal.id, payload });
    setPending(await countQueued());
    await persistRecords({ ...records, [sucursal.id]: { ...optimisticRecord, pendingSync: true } });
  }

  async function handleCheckIn() {
    if (busy) return;
    if (!gpsCoords) {
      alert("Esperando tu ubicación GPS. Actívala e inténtalo de nuevo.");
      return;
    }
    if (!photo) {
      alert("Debes tomar la foto de la visita antes de registrar la entrada.");
      return;
    }
    setBusy(true);
    const coords = gpsCoords; // coordenadas GPS reales; el servidor valida la distancia
    // La foto (Base64) va en el payload. Offline: se cifra con AES-GCM en la
    // bóveda antes de tocar IndexedDB. hasPhoto marca el registro optimista.
    const payload = { coords, photo };
    const optimistic = {
      sucursalId: sucursal.id,
      status: "checked-in",
      checkInTime: new Date().toISOString(),
      checkInDistance: Math.round(distance),
      hasPhoto: true,
    };
    try {
      if (!navigator.onLine) {
        await queueOffline("check-in", payload, optimistic);
        setPhoto(null);
        return;
      }
      // El backend revalida identidad, distancia, hora y la foto obligatoria.
      const rec = await api.checkIn(sucursal.id, payload);
      await persistRecords({ ...records, [sucursal.id]: rec });
      setPhoto(null);
    } catch (e) {
      if (e instanceof ApiError) {
        alert(e.message || "No se pudo registrar la entrada."); // rechazo del servidor
      } else {
        await queueOffline("check-in", payload, optimistic); // fallo de red → offline
        setPhoto(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmCheckout() {
    if (busy) return;
    if (!gpsCoords) {
      alert("Esperando tu ubicación GPS. Actívala e inténtalo de nuevo.");
      return;
    }
    setBusy(true);
    const coords = gpsCoords; // coordenadas GPS reales
    const items = productos
      .map((p) => ({ productoId: p.id, cantidad: Math.max(0, Math.floor(cantidades[p.id] || 0)) }))
      .filter((i) => i.cantidad > 0);
    const optimistic = {
      ...(record || { sucursalId: sucursal.id }),
      status: "checked-out",
      checkOutTime: new Date().toISOString(),
      checkOutDistance: Math.round(distance),
      items,
    };
    try {
      if (!navigator.onLine) {
        await queueOffline("check-out", { coords, items }, optimistic);
        setShowSheet(false);
        return;
      }
      const rec = await api.checkOut(sucursal.id, { coords, items });
      await persistRecords({ ...records, [sucursal.id]: rec });
      setShowSheet(false);
    } catch (e) {
      if (e instanceof ApiError) {
        alert(e.message || "No se pudo registrar la salida.");
      } else {
        await queueOffline("check-out", { coords, items }, optimistic);
        setShowSheet(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    if (loggingIn) return;
    if (!promoterId.trim() || !password) return;
    setLoggingIn(true);
    try {
      const ok = await login(promoterId.trim(), password);
      if (ok) setPassword("");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleRecoverRequest() {
    if (recoverSending || !recoverId.trim()) return;
    setRecoverSending(true);
    setRecoverError("");
    try {
      await api.recoverRequest(recoverId.trim());
      setRecoverDone(true);
    } catch (e) {
      setRecoverError(e instanceof ApiError ? e.message : "No hay conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
      setRecoverSending(false);
    }
  }

  function backToLogin() {
    setAuthView("login");
    setRecoverId("");
    setRecoverDone(false);
    setRecoverError("");
  }

  async function handleLogout() {
    await logout();
    setRecords({});
    setMyGoal(null);
    setMyHistory(null);
    setSelectedSucursal(null);
    setNearbySucursales([]);
    setDashCoords(null);
    setScreen("dashboard");
    setPromoterId("");
    setPassword("");
  }

  // Navegación entre las secciones del footer.
  function goTab(key) {
    setSelectedSucursal(null);
    setScreen(key);
  }

  // Fotos del formulario de Competencia: se redimensionan a data URL (igual
  // que la foto de check-in) porque son las que realmente se envían al
  // servidor — no un blob URL, que solo existe en esta pestaña del navegador.
  async function handleCompFotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const room = MAX_COMP_FOTOS - compFotos.length;
    for (const file of files.slice(0, room)) {
      try {
        const dataUrl = await processPickedFile(file, "competition");
        setCompFotos((prev) => [...prev, { name: file.name, dataUrl }]);
      } catch {
        /* ignora archivos inválidos */
      }
    }
  }

  async function handleSendCompetition() {
    if (compSending || !compMarca.trim() || !compDesc.trim()) return;
    setCompSending(true);
    setCompError("");
    try {
      await api.sendCompetitionReport({
        marca: compMarca.trim(),
        descripcion: compDesc.trim(),
        fotos: compFotos.map((f) => f.dataUrl),
      });
      setCompSent(true);
    } catch (e) {
      setCompError(e instanceof ApiError ? e.message : "No hay conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
      setCompSending(false);
    }
  }

  const bgTexture = {
    backgroundColor: COLORS.bg,
    backgroundImage: `linear-gradient(${COLORS.border}22 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}22 1px, transparent 1px)`,
    backgroundSize: "28px 28px",
  };

  // --- Session bootstrap ----------------------------------------------------
  if (status === "loading") {
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter", color: COLORS.textMuted, fontSize: 14 }}>
        Cargando sesión…
      </div>
    );
  }

  // --- Login (ID de promotor + contraseña) ----------------------------------
  if (status !== "authed" || !user) {
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "Inter" }}>
        <div style={{ width: "100%", maxWidth: 360, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: "32px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
            <img src="/icon-192.png" alt="Protexa" style={{ width: 34, height: 34, borderRadius: 9, display: "block" }} />
            <span style={{ fontFamily: "Inter", fontSize: 11, letterSpacing: "0.1em", color: COLORS.textMuted, fontWeight: 600 }}>FERRETEROS PROTEXA</span>
          </div>

          {authView === "login" ? (
            <>
              <h1 style={{ fontFamily: "Space Grotesk", fontSize: 24, fontWeight: 600, color: COLORS.text, margin: "0 0 6px" }}>Registro de visitas</h1>
              <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "0 0 24px", lineHeight: 1.5 }}>
                Ingresa tu ID de promotor y contraseña para ver las sucursales cercanas a tu ubicación.
              </p>

              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>ID de promotor</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
                <User size={16} color={COLORS.textMuted} />
                <input
                  value={promoterId}
                  onChange={(e) => setPromoterId(e.target.value)}
                  placeholder="90500276"
                  inputMode="numeric"
                  style={{ background: "transparent", border: "none", outline: "none", color: COLORS.text, fontFamily: "JetBrains Mono", fontSize: 16, width: "100%" }}
                />
              </div>

              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Contraseña</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <Lock size={16} color={COLORS.textMuted} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="••••••••"
                  style={{ background: "transparent", border: "none", outline: "none", color: COLORS.text, fontFamily: "Inter", fontSize: 16, width: "100%" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: COLORS.textMuted, display: "flex", flexShrink: 0 }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {authError && <p style={{ color: COLORS.danger, fontSize: 12.5, margin: "6px 0 0" }}>{authError}</p>}

              <button
                onClick={handleLogin}
                disabled={loggingIn || !promoterId.trim() || !password}
                style={{ width: "100%", marginTop: 18, padding: "12px 0", borderRadius: 10, border: "none", background: promoterId.trim() && password ? COLORS.accent : COLORS.surface2, color: promoterId.trim() && password ? COLORS.onAccent : COLORS.textMuted, fontFamily: "Inter", fontWeight: 600, fontSize: 14.5, cursor: loggingIn || !promoterId.trim() || !password ? "not-allowed" : "pointer" }}
              >
                {loggingIn ? "Ingresando…" : "Iniciar sesión"}
              </button>

              <div style={{ textAlign: "center", marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setAuthView("recover")}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: COLORS.textMuted, fontSize: 11.5, textDecoration: "underline", textUnderlineOffset: 2 }}
                >
                  recuperar mi cuenta
                </button>
              </div>

              <p style={{ fontSize: 11.5, color: COLORS.textMuted, marginTop: 22, lineHeight: 1.6 }}>
                Tu contraseña se verifica en el servidor (hash bcrypt). La sesión se guarda en una cookie HttpOnly; ningún token queda expuesto en el navegador.
              </p>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <KeyRound size={18} color={COLORS.accentText} />
                <h1 style={{ fontFamily: "Space Grotesk", fontSize: 20, fontWeight: 600, color: COLORS.text, margin: 0 }}>Recuperar mi cuenta</h1>
              </div>

              {recoverDone ? (
                <>
                  <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "10px 0 22px", lineHeight: 1.55 }}>
                    Si tu ID es válido, tu supervisor ya recibió la solicitud y te asignará una contraseña nueva.
                  </p>
                  <button
                    onClick={backToLogin}
                    style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontFamily: "Inter", fontWeight: 600, fontSize: 14.5, cursor: "pointer" }}
                  >
                    Volver a iniciar sesión
                  </button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "0 0 22px", lineHeight: 1.55 }}>
                    Ingresa tu ID de promotor. Le avisaremos a tu supervisor para que te asigne una contraseña nueva.
                  </p>

                  <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>ID de promotor</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                    <User size={16} color={COLORS.textMuted} />
                    <input
                      value={recoverId}
                      onChange={(e) => setRecoverId(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRecoverRequest()}
                      placeholder="90500276"
                      inputMode="numeric"
                      style={{ background: "transparent", border: "none", outline: "none", color: COLORS.text, fontFamily: "JetBrains Mono", fontSize: 16, width: "100%" }}
                    />
                  </div>

                  {recoverError && <p style={{ color: COLORS.danger, fontSize: 12.5, margin: "6px 0 0" }}>{recoverError}</p>}

                  <button
                    onClick={handleRecoverRequest}
                    disabled={recoverSending || !recoverId.trim()}
                    style={{ width: "100%", marginTop: 18, padding: "12px 0", borderRadius: 10, border: "none", background: recoverId.trim() ? COLORS.accent : COLORS.surface2, color: recoverId.trim() ? COLORS.onAccent : COLORS.textMuted, fontFamily: "Inter", fontWeight: 600, fontSize: 14.5, cursor: recoverSending || !recoverId.trim() ? "not-allowed" : "pointer" }}
                  >
                    {recoverSending ? "Enviando…" : "Enviar solicitud"}
                  </button>

                  <div style={{ textAlign: "center", marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={backToLogin}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: COLORS.textMuted, fontSize: 11.5, textDecoration: "underline", textUnderlineOffset: 2 }}
                    >
                      volver a iniciar sesión
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // --- Dashboard ------------------------------------------------------------
  if (screen === "dashboard") {
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh", fontFamily: "Inter" }}>
        <TopBar user={user} onTickets={openTickets} ticketsUnread={threads.ticketsPending} onFeedback={() => setShowFeedback(true)} onProfile={() => goTab("perfil")} onHelp={onboarding.show} />
        <ConnectivityBanner online={online} pending={pending} syncing={syncing} onSync={flushQueue} />
        {showFeedback && <FeedbackModal user={user} onClose={() => setShowFeedback(false)} onTrack={(id) => { setShowFeedback(false); openTickets(id); }} />}
        {presenceModalNode}
        {onboarding.open && <OnboardingTour steps={onboardingStepsPromotor} onClose={onboarding.dismiss} />}
        <div style={{ padding: "20px 20px 96px", maxWidth: 480, margin: "0 auto" }}>
          {showCheckoutReminder && (
            <button
              onClick={() => openVisitSucursal && openSucursal(openVisitSucursal)}
              style={{ width: "100%", textAlign: "left", display: "flex", gap: 10, alignItems: "flex-start", background: COLORS.accentSoft, border: `1px solid ${COLORS.accent}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14, cursor: openVisitSucursal ? "pointer" : "default" }}
            >
              <Clock size={17} color={COLORS.accentText} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.45 }}>
                Sigues marcado como "en sucursal"{openVisitSucursal ? ` en ${openVisitSucursal.name}` : ""}. Si ya terminaste,
                no olvides registrar tu salida.
              </span>
            </button>
          )}
          <span style={{ fontSize: 11, letterSpacing: "0.1em", color: COLORS.textMuted, fontWeight: 600 }}>TU UBICACIÓN</span>
          <MapView coords={dashCoords} sucursales={allSucursales} />

          {!goalsOff && <SalesGoals goal={myGoal} />}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, letterSpacing: "0.1em", color: COLORS.textMuted, fontWeight: 600 }}>
              SUCURSALES CERCANAS {dashCoords ? `(${(nearbyRadius / 1000).toFixed(nearbyRadius % 1000 ? 1 : 0)} km)` : ""}
            </span>
            <button
              onClick={loadNearbySucursales}
              disabled={sucursalesLoading}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "5px 10px", color: COLORS.textMuted, fontSize: 11.5, cursor: sucursalesLoading ? "default" : "pointer" }}
            >
              <RefreshCw size={13} /> {sucursalesLoading ? "Buscando…" : "Actualizar"}
            </button>
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {sucursalesError && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: COLORS.dangerSoft, color: COLORS.danger, borderRadius: 10, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.4 }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{sucursalesError}</span>
              </div>
            )}
            {!sucursalesError && sucursalesLoading && sucursales.length === 0 && (
              <p style={{ color: COLORS.textMuted, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <Navigation size={15} /> Obteniendo tu ubicación y buscando sucursales cercanas…
              </p>
            )}
            {!sucursalesError && !sucursalesLoading && sucursales.length === 0 && dashCoords && (
              <p style={{ color: COLORS.textMuted, fontSize: 13 }}>
                No hay sucursales dentro de {(nearbyRadius / 1000).toFixed(nearbyRadius % 1000 ? 1 : 0)} km de tu ubicación.
              </p>
            )}
            {sucursales.map((s) => {
              const rec = records[s.id];
              const status2 = rec?.status === "checked-out" ? "done" : rec?.status === "checked-in" ? "in" : "none";
              return (
                <button
                  key={s.id}
                  onClick={() => openSucursal(s)}
                  style={{ textAlign: "left", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: "16px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: COLORS.surface2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <MapPin size={18} color={COLORS.textMuted} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, color: COLORS.text, fontSize: 14.5, fontWeight: 600 }}>{s.clienteNombre} – {s.name}</p>
                    <p style={{ margin: "2px 0 0", color: COLORS.textMuted, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{s.id}{s.address ? ` · ${s.address}` : ""}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    {typeof s.distance === "number" && (
                      <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "JetBrains Mono" }}>{fmtDistance(s.distance)}</span>
                    )}
                    <StatusPill status={status2} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <FooterNav current="dashboard" onNavigate={goTab} />
      </div>
    );
  }

  // --- Store detail ---------------------------------------------------------
  if (screen === "sucursalDetail" && sucursal) {
    const isDone = record?.status === "checked-out";
    const isCheckedIn = record?.status === "checked-in";
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh", fontFamily: "Inter" }}>
        <TopBar user={user} onTickets={openTickets} ticketsUnread={threads.ticketsPending} onFeedback={() => setShowFeedback(true)} onProfile={() => goTab("perfil")} />
        <ConnectivityBanner online={online} pending={pending} syncing={syncing} onSync={flushQueue} />
        {showFeedback && <FeedbackModal user={user} onClose={() => setShowFeedback(false)} onTrack={(id) => { setShowFeedback(false); openTickets(id); }} />}
        {presenceModalNode}
        <div style={{ padding: "18px 20px 40px", maxWidth: 460, margin: "0 auto" }}>
          <button onClick={() => setScreen("dashboard")} style={{ background: "none", border: "none", color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14 }}>
            <ArrowLeft size={15} /> Sucursales
          </button>

          <h2 style={{ fontFamily: "Space Grotesk", fontSize: 20, fontWeight: 600, color: COLORS.text, margin: "0 0 2px" }}>{sucursal.clienteNombre ? `${sucursal.clienteNombre} – ` : ""}{sucursal.name}</h2>
          <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "0 0 22px" }}>{sucursal.address}</p>

          {!isDone && (
            <>
              <Radar distance={distance} inRange={inRange} gpsError={gpsError} hasFix={!!gpsCoords} />

              <div style={{ marginTop: 18, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
                <Navigation size={16} color={gpsError ? COLORS.danger : gpsCoords ? COLORS.success : COLORS.textMuted} />
                <span style={{ fontSize: 12.5, color: gpsError ? COLORS.danger : COLORS.textMuted, lineHeight: 1.4 }}>
                  {gpsError
                    ? gpsError
                    : gpsCoords
                    ? `Ubicación GPS activa${gpsAccuracy ? ` · precisión ±${Math.round(gpsAccuracy)} m` : ""}`
                    : "Obteniendo tu ubicación GPS…"}
                </span>
              </div>

              {isCheckedIn && (
                <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, color: COLORS.textMuted, fontSize: 13 }}>
                  <Clock size={15} />
                  <span>En la sucursal desde las {fmtTime(record.checkInTime)} · {fmtDuration(record.checkInTime)}</span>
                </div>
              )}

              {!isCheckedIn && (
                <div style={{ marginTop: 18 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.08em", color: COLORS.textMuted, fontWeight: 600 }}>
                    FOTO DE LA VISITA (OBLIGATORIA)
                  </span>
                  {/* Respaldo: la cámara del sistema (se usa solo si la integrada no está disponible) */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoChange}
                    style={{ display: "none" }}
                  />
                  {cameraFor === "visit" && (
                    <CameraCapture
                      kind="visit"
                      onCapture={(dataUrl) => setPhoto(dataUrl)}
                      onClose={() => setCameraFor(null)}
                      onUnavailable={() => openSystemCamera("visit")}
                    />
                  )}
                  {!photo ? (
                    <button
                      onClick={() => openCamera("visit")}
                      disabled={photoBusy}
                      style={{ width: "100%", marginTop: 10, padding: "13px 0", borderRadius: 12, border: `1px dashed ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontFamily: "Inter", fontWeight: 600, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                    >
                      <Camera size={16} color={COLORS.accentText} />
                      {photoBusy ? "Procesando…" : "Tomar foto"}
                    </button>
                  ) : (
                    <div style={{ marginTop: 10, position: "relative", borderRadius: 12, overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
                      <img src={photo} alt="Foto de la visita" style={{ width: "100%", display: "block", maxHeight: 220, objectFit: "cover" }} />
                      <button
                        onClick={() => openCamera("visit")}
                        style={{ position: "absolute", right: 10, bottom: 10, padding: "7px 12px", borderRadius: 9, border: "none", background: "rgba(15,22,32,0.82)", color: COLORS.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <Camera size={14} /> Retomar
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!isCheckedIn && (
                <button
                  onClick={handleCheckIn}
                  disabled={!gpsCoords || !photo || busy}
                  style={{
                    width: "100%", marginTop: 16, padding: "14px 0", borderRadius: 12, border: "none",
                    background: gpsCoords && photo ? COLORS.accent : COLORS.surface2,
                    color: gpsCoords && photo ? COLORS.onAccent : COLORS.textMuted,
                    fontFamily: "Inter", fontWeight: 600, fontSize: 15, cursor: gpsCoords && photo && !busy ? "pointer" : "not-allowed",
                  }}
                >
                  {busy ? "Registrando…" : "Registrar entrada"}
                </button>
              )}

              {!isCheckedIn && gpsCoords && !photo && (
                <p style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: COLORS.textMuted, marginTop: 10, lineHeight: 1.5 }}>
                  <Camera size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  Toma la foto de la visita para habilitar el registro de entrada.
                </p>
              )}

              {isCheckedIn && (
                <button
                  onClick={() => { setShowSheet(true); if (productosError || productos.length === 0) loadProductos(); }}
                  disabled={!gpsCoords}
                  style={{
                    width: "100%", marginTop: 20, padding: "14px 0", borderRadius: 12, border: "none",
                    background: gpsCoords ? COLORS.success : COLORS.surface2,
                    color: gpsCoords ? COLORS.onSuccess : COLORS.textMuted,
                    fontFamily: "Inter", fontWeight: 600, fontSize: 15, cursor: gpsCoords ? "pointer" : "not-allowed",
                  }}
                >
                  Registrar salida
                </button>
              )}

              {/* Aviso informativo: el servidor es quien valida el radio real. */}
              {gpsCoords && !inRange && (
                <p style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: COLORS.textMuted, marginTop: 12, lineHeight: 1.5 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  Parece que estás a {fmtDistance(distance)} de la sucursal. Debes estar a {fmtDistance(radiusMeters)} o menos; el servidor validará tu ubicación al registrar.
                </p>
              )}
            </>
          )}

          {isDone && (
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: COLORS.successSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={18} color={COLORS.success} />
                </div>
                <span style={{ fontFamily: "Space Grotesk", fontSize: 16, fontWeight: 600, color: COLORS.text }}>Visita completada</span>
              </div>
              <Row label="Entrada" value={`${fmtTime(record.checkInTime)}`} />
              <Row label="Salida" value={`${fmtTime(record.checkOutTime)}`} />
              <Row label="Duracion" value={fmtDuration(record.checkInTime, record.checkOutTime)} />
              {(record.items ?? []).length > 0 ? (
                ordenarItems(record.items).map((it, i, arr) => (
                  <Row key={it.productoId} label={productoNombre(it.productoId)} value={it.cantidad} last={i === arr.length - 1} />
                ))
              ) : (
                <Row label="Productos vendidos" value="Ninguno" last />
              )}
              <button
                onClick={() => setScreen("dashboard")}
                style={{ width: "100%", marginTop: 18, padding: "12px 0", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontFamily: "Inter", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
              >
                Volver a sucursales
              </button>
            </div>
          )}
        </div>

        {showSheet && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(5,8,12,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
            <div style={{ width: "100%", maxWidth: 460, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "22px 22px 26px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 18px" }} />
              <h3 style={{ fontFamily: "Space Grotesk", fontSize: 17, fontWeight: 600, color: COLORS.text, margin: "0 0 4px" }}>Reporte del dia</h3>
              <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "0 0 6px" }}>Captura lo vendido antes de confirmar tu salida.</p>

              {productos.map((p) => (
                <Stepper
                  key={p.id}
                  label={p.nombre}
                  value={cantidades[p.id] || 0}
                  onChange={(v) => setCantidades((c) => ({ ...c, [p.id]: v }))}
                />
              ))}
              {productos.length === 0 && productosError && (
                <p style={{ fontSize: 12.5, color: COLORS.danger, margin: "12px 0 0", lineHeight: 1.5 }}>
                  No se pudo cargar la lista de productos. Revisa tu conexión e inténtalo de nuevo; no confirmes la salida sin ella o se registrará sin ventas.{" "}
                  <button onClick={() => loadProductos()} style={{ background: "none", border: "none", color: COLORS.accentText, fontWeight: 700, cursor: "pointer", padding: 0 }}>Reintentar</button>
                </p>
              )}
              {productos.length === 0 && !productosError && (
                <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "12px 0 0" }}>
                  Aún no hay productos configurados; puedes registrar la salida sin cantidades.
                </p>
              )}

              {/* Aviso informativo (no bloquea): el servidor valida la distancia real. */}
              {gpsCoords && !inRange && (
                <p style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: COLORS.textMuted, marginTop: 14, lineHeight: 1.5 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  Debes estar en la sucursal (a {fmtDistance(radiusMeters)} o menos). El servidor validará tu ubicación al confirmar.
                </p>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button
                  onClick={() => setShowSheet(false)}
                  style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.textMuted, fontFamily: "Inter", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmCheckout}
                  disabled={!gpsCoords || busy || (productosError && productos.length === 0)}
                  style={{
                    flex: 2, padding: "12px 0", borderRadius: 10, border: "none",
                    background: gpsCoords ? COLORS.success : COLORS.surface2,
                    color: gpsCoords ? COLORS.onSuccess : COLORS.textMuted,
                    fontFamily: "Inter", fontWeight: 600, fontSize: 14, cursor: gpsCoords && !busy && !(productosError && productos.length === 0) ? "pointer" : "not-allowed",
                  }}
                >
                  {busy ? "Confirmando…" : "Confirmar salida"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Competencia (formulario de acciones/estrategias de la competencia) ---
  if (screen === "competencia") {
    const canSendComp = compMarca.trim() && compDesc.trim();
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh" }}>
        <TopBar user={user} onTickets={openTickets} ticketsUnread={threads.ticketsPending} onFeedback={() => setShowFeedback(true)} onProfile={() => goTab("perfil")} />
        <ConnectivityBanner online={online} pending={pending} syncing={syncing} onSync={flushQueue} />
        {showFeedback && <FeedbackModal user={user} onClose={() => setShowFeedback(false)} onTrack={(id) => { setShowFeedback(false); openTickets(id); }} />}
        {presenceModalNode}
        <div style={{ padding: "20px 20px 96px", maxWidth: 480, margin: "0 auto" }}>
          <span style={{ fontSize: 11, letterSpacing: "0.1em", color: COLORS.textMuted, fontWeight: 600 }}>COMPETENCIA</span>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, margin: "2px 0 4px" }}>Reportar acción</h2>
          <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "0 0 18px", lineHeight: 1.5 }}>
            Sube estrategias, material gráfico o acciones de la competencia.
          </p>

          {compSent ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: COLORS.successSoft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <Check size={24} color={COLORS.success} />
              </div>
              <p style={{ color: COLORS.text, fontWeight: 600, margin: "0 0 6px" }}>¡Reporte capturado!</p>
              <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "0 0 18px", lineHeight: 1.5 }}>
                Gracias, tu reporte de competencia ya se guardó.
              </p>
              <button
                onClick={() => { setCompSent(false); setCompMarca(""); setCompDesc(""); setCompFotos([]); setCompError(""); }}
                style={{ padding: "11px 20px", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
              >
                Nuevo reporte
              </button>
            </div>
          ) : (
            <>
              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 }}>Marca / competidor</label>
              <div style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                <input value={compMarca} onChange={(e) => setCompMarca(e.target.value)} placeholder="Ej. Impermeabilizante XYZ" style={{ background: "transparent", border: "none", outline: "none", color: COLORS.text, fontSize: 15, width: "100%" }} />
              </div>

              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 }}>Descripción</label>
              <div style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                <textarea value={compDesc} onChange={(e) => setCompDesc(e.target.value)} rows={4} maxLength={2000} placeholder="Qué observaste: precio, promoción, material…" style={{ background: "transparent", border: "none", outline: "none", color: COLORS.text, fontSize: 15, width: "100%", resize: "vertical", minHeight: 80, lineHeight: 1.5, display: "block" }} />
              </div>

              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 }}>Evidencia (fotos, hasta {MAX_COMP_FOTOS})</label>
              <input ref={compFileRef} type="file" accept="image/*" multiple onChange={handleCompFotos} style={{ display: "none" }} />
              <input ref={compCaptureRef} type="file" accept="image/*" capture="environment" onChange={handleCompFotos} style={{ display: "none" }} />
              {cameraFor === "competition" && (
                <CameraCapture
                  kind="competition"
                  multi
                  max={MAX_COMP_FOTOS}
                  count={compFotos.length}
                  onCapture={(dataUrl) => setCompFotos((prev) => [...prev, { name: `foto-${Date.now()}.webp`, dataUrl }])}
                  onClose={() => setCameraFor(null)}
                  onUnavailable={() => openSystemCamera("competition")}
                />
              )}
              {compFotos.length < MAX_COMP_FOTOS && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => openCamera("competition")}
                    style={{ flex: 1, padding: "16px 0", borderRadius: 12, border: `1.5px dashed ${COLORS.border}`, background: COLORS.surface2, color: COLORS.textMuted, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  >
                    <Camera size={16} color={COLORS.accentText} /> Tomar foto
                  </button>
                  <button
                    onClick={() => compFileRef.current && compFileRef.current.click()}
                    style={{ flex: 1, padding: "16px 0", borderRadius: 12, border: `1.5px dashed ${COLORS.border}`, background: COLORS.surface2, color: COLORS.textMuted, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  >
                    <ImagePlus size={16} color={COLORS.accentText} /> Galería
                  </button>
                </div>
              )}
              {compFotos.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {compFotos.map((f, i) => (
                    <div key={i} style={{ position: "relative", width: 72, height: 72, borderRadius: 10, overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
                      <img src={f.dataUrl} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button
                        onClick={() => setCompFotos((prev) => prev.filter((_, j) => j !== i))}
                        style={{ position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {compError && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: COLORS.dangerSoft, color: COLORS.danger, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, marginTop: 14, lineHeight: 1.4 }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{compError}</span>
                </div>
              )}

              <button
                onClick={handleSendCompetition}
                disabled={!canSendComp || compSending}
                style={{ width: "100%", marginTop: 18, padding: "14px 0", borderRadius: 12, border: "none", background: canSendComp && !compSending ? COLORS.accent : COLORS.surface2, color: canSendComp && !compSending ? COLORS.onAccent : COLORS.textMuted, fontWeight: 700, fontSize: 15, cursor: canSendComp && !compSending ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <Send size={16} /> {compSending ? "Enviando…" : "Enviar reporte"}
              </button>
            </>
          )}
        </div>
        <FooterNav current="competencia" onNavigate={goTab} />
      </div>
    );
  }

  // --- Capacitación / Soporte -------------------------------------------------
  // Mismo componente (TrainingSection) para las dos, solo cambia `seccion`.
  if (screen === "capacitacion" || screen === "soporte") {
    const seccion = screen;
    const title = seccion === "capacitacion" ? "Capacitación" : "Soporte";
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh" }}>
        <TopBar user={user} onTickets={openTickets} ticketsUnread={threads.ticketsPending} onFeedback={() => setShowFeedback(true)} onProfile={() => goTab("perfil")} />
        <ConnectivityBanner online={online} pending={pending} syncing={syncing} onSync={flushQueue} />
        {showFeedback && <FeedbackModal user={user} onClose={() => setShowFeedback(false)} onTrack={(id) => { setShowFeedback(false); openTickets(id); }} />}
        {presenceModalNode}
        <div style={{ padding: "20px 20px 96px", maxWidth: 480, margin: "0 auto" }}>
          <TrainingSection seccion={seccion} title={title} />
        </div>
        <FooterNav current={seccion} onNavigate={goTab} />
      </div>
    );
  }

  // --- Perfil ---------------------------------------------------------------
  if (screen === "perfil") {
    const initials = (user.name || user.id || "?").split(" ").map((n) => n[0]).slice(0, 2).join("");
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh" }}>
        <TopBar user={user} onTickets={openTickets} ticketsUnread={threads.ticketsPending} onFeedback={() => setShowFeedback(true)} onProfile={() => goTab("perfil")} />
        <ConnectivityBanner online={online} pending={pending} syncing={syncing} onSync={flushQueue} />
        {showFeedback && <FeedbackModal user={user} onClose={() => setShowFeedback(false)} onTrack={(id) => { setShowFeedback(false); openTickets(id); }} />}
        {presenceModalNode}
        <div style={{ padding: "28px 20px 96px", maxWidth: 480, margin: "0 auto" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: COLORS.accentSoft, color: COLORS.accentText, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, margin: "0 auto 12px" }}>
            {initials}
          </div>
          <h2 style={{ textAlign: "center", fontSize: 19, fontWeight: 700, color: COLORS.text, margin: "0 0 2px" }}>{user.name}</h2>
          <p style={{ textAlign: "center", fontSize: 12.5, color: COLORS.textMuted, margin: "0 0 22px" }}>Promotor de campo</p>
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: "6px 16px" }}>
            <Row label="ID" value={user.id} />
            <Row label="Ubicación" value={user.location || "—"} />
            <Row label="Supervisor" value={user.supervisor || "—"} last />
          </div>

          {myHistory?.frequentSucursales?.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <span style={{ fontSize: 11, letterSpacing: "0.1em", color: COLORS.textMuted, fontWeight: 600 }}>SUCURSALES FRECUENTES</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {myHistory.frequentSucursales.map((s) => (
                  <span key={s.sucursalId} style={{ fontSize: 12, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 999, padding: "5px 10px", color: COLORS.text }}>
                    {s.sucursalName} <b>·{s.visits}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={openHistorial}
            style={{ width: "100%", marginTop: 18, display: "flex", alignItems: "center", gap: 8, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left" }}
          >
            <Clock size={15} color={COLORS.accentText} />
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: COLORS.text }}>Mi historial de check-in / check-out</span>
            <ChevronRight size={15} color={COLORS.textMuted} />
          </button>

          <DeviceDiagnostics />

          <button
            onClick={handleLogout}
            style={{ width: "100%", marginTop: 18, padding: "13px 0", borderRadius: 12, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.text, fontWeight: 600, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
        <FooterNav current="perfil" onNavigate={goTab} />
      </div>
    );
  }

  if (screen === "tickets") {
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh", fontFamily: "Inter" }}>
        <TopBar user={user} onTickets={openTickets} ticketsUnread={threads.ticketsPending} onFeedback={() => setShowFeedback(true)} onProfile={() => goTab("perfil")} />
        <ConnectivityBanner online={online} pending={pending} syncing={syncing} onSync={flushQueue} />
        {showFeedback && <FeedbackModal user={user} onClose={() => setShowFeedback(false)} onTrack={(id) => { setShowFeedback(false); openTickets(id); }} />}
        {presenceModalNode}
        <div style={{ padding: "18px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
          <PromoterTickets key={ticketsInitialId ?? "lista"} user={user} initialTicketId={ticketsInitialId} threads={threads} onExit={() => setScreen("dashboard")} />
        </div>
      </div>
    );
  }

  if (screen === "historial") {
    return (
      <div style={{ ...bgTexture, minHeight: "100dvh", fontFamily: "Inter" }}>
        <TopBar user={user} onTickets={openTickets} ticketsUnread={threads.ticketsPending} onFeedback={() => setShowFeedback(true)} onProfile={() => goTab("perfil")} />
        <ConnectivityBanner online={online} pending={pending} syncing={syncing} onSync={flushQueue} />
        {showFeedback && <FeedbackModal user={user} onClose={() => setShowFeedback(false)} onTrack={(id) => { setShowFeedback(false); openTickets(id); }} />}
        {presenceModalNode}
        <div style={{ padding: "18px 20px 96px", maxWidth: 480, margin: "0 auto" }}>
          <button onClick={() => setScreen("perfil")} style={{ background: "none", border: "none", color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14 }}>
            <ArrowLeft size={15} /> Perfil
          </button>

          <h2 style={{ fontFamily: "Space Grotesk", fontSize: 20, fontWeight: 600, color: COLORS.text, margin: "0 0 16px" }}>Mi historial</h2>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.08em", color: COLORS.textMuted, fontWeight: 600 }}>DÍAS POR PÁGINA</span>
            <select
              value={historyDaysPerPage}
              onChange={(e) => changeHistoryDaysPerPage(Number(e.target.value))}
              style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "6px 9px", color: COLORS.text, fontSize: 12.5, fontWeight: 600 }}
            >
              {[7, 14, 30].map((n) => (
                <option key={n} value={n}>{n} días</option>
              ))}
            </select>
          </div>

          {historyLoading && <p style={{ color: COLORS.textMuted, fontSize: 13 }}>Cargando…</p>}
          {historyError && <p style={{ color: COLORS.danger, fontSize: 13 }}>{historyError}</p>}

          {!historyLoading && !historyError && historyData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {historyData.days.length === 0 ? (
                <p style={{ color: COLORS.textMuted, fontSize: 13 }}>
                  {historyPage === 1 ? "Aún no tienes visitas registradas." : "No hay más historial."}
                </p>
              ) : (
                historyData.days.map(({ day, visits }) => (
                  <div key={day}>
                    <span style={{ fontSize: 11, letterSpacing: "0.08em", color: COLORS.textMuted, fontWeight: 600 }}>{fmtDayHeader(day).toUpperCase()}</span>
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                      {visits.map((v, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "10px 12px" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.clienteNombre ? `${v.clienteNombre} – ` : ""}{v.sucursalName}</div>
                            <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginTop: 2 }}>
                              Entró {fmtTime(v.checkInTime)} · Salió {v.checkOutTime ? fmtTime(v.checkOutTime) : "--:--"}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0, color: COLORS.accentText, fontFamily: "JetBrains Mono", fontWeight: 800, fontSize: 13 }}>
                            {ordenarItems(v.items ?? []).map((it) => `${it.cantidad} ${it.nombre ?? productoNombre(it.productoId)}`).join(" · ") || "Sin ventas"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {(historyPage > 1 || historyData.hasMore) && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage === 1}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "transparent", color: historyPage === 1 ? COLORS.textMuted : COLORS.text, fontSize: 12.5, fontWeight: 600, cursor: historyPage === 1 ? "default" : "pointer", opacity: historyPage === 1 ? 0.5 : 1 }}
                  >
                    <ChevronLeft size={14} /> Anterior
                  </button>
                  <span style={{ fontSize: 12, color: COLORS.textMuted }}>Página {historyPage}</span>
                  <button
                    onClick={() => setHistoryPage((p) => p + 1)}
                    disabled={!historyData.hasMore}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "transparent", color: !historyData.hasMore ? COLORS.textMuted : COLORS.text, fontSize: 12.5, fontWeight: 600, cursor: !historyData.hasMore ? "default" : "pointer", opacity: !historyData.hasMore ? 0.5 : 1 }}
                  >
                    Siguiente <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// Wordmark de marca. PROVISIONAL: cuando llegue el logo oficial de Protexa
// (SVG/PNG positivo y negativo) se reemplaza SOLO aquí por un <img>.
function Brand() {
  // Logo oficial Protexa. El navegador elige la versión según el tema del
  // dispositivo: blanca en modo oscuro, negra en modo claro.
  return (
    <picture style={{ display: "flex", alignItems: "center" }}>
      <source srcSet="/protexa-logo-blanco.png" media="(prefers-color-scheme: dark)" />
      <img src="/protexa-logo-negro.png" alt="Protexa · Desde 1945" style={{ height: 28, width: "auto", display: "block" }} />
    </picture>
  );
}

function TopBar({ user, onFeedback, onProfile, onHelp, onTickets, ticketsUnread = 0 }) {
  const initials = (user.name || user.id || "?").split(" ").map((n) => n[0]).slice(0, 2).join("");
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${COLORS.border}` }}>
      <Brand />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onHelp && (
          <button
            onClick={onHelp}
            title="Ver novedades"
            style={{ width: 34, height: 34, borderRadius: "50%", background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <HelpCircle size={16} />
          </button>
        )}
        {onTickets && (
          <button
            onClick={onTickets}
            title="Mis tickets: seguimiento de tus reportes"
            style={{ position: "relative", width: 34, height: 34, borderRadius: "50%", background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <Ticket size={16} />
            {ticketsUnread > 0 && <span style={{ position: "absolute", top: -2, right: -2, width: 11, height: 11, borderRadius: 999, background: COLORS.danger, border: `2px solid ${COLORS.surface}` }} />}
          </button>
        )}
        {onFeedback && (
          <button
            onClick={onFeedback}
            title="Reportar un problema"
            style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.accentSoft, border: `1px solid ${COLORS.accent}`, borderRadius: 9, padding: "7px 12px", color: COLORS.accentText, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            <MessageSquare size={14} /> Reportar
          </button>
        )}
        <button
          onClick={onProfile}
          title="Mi perfil"
          style={{ width: 34, height: 34, borderRadius: "50%", background: COLORS.accentSoft, color: COLORS.accentText, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer" }}
        >
          {initials}
        </button>
      </div>
    </div>
  );
}

// Barra de navegación inferior (footer).
function FooterNav({ current, onNavigate }) {
  const items = [
    { key: "dashboard", label: "Inicio", Icon: Home },
    { key: "competencia", label: "Competencia", Icon: BarChart3 },
    { key: "capacitacion", label: "Capacitación", Icon: GraduationCap },
    { key: "soporte", label: "Soporte", Icon: LifeBuoy },
    { key: "perfil", label: "Perfil", Icon: User },
  ];
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: COLORS.surface, borderTop: `1px solid ${COLORS.border}`, zIndex: 40, paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", display: "flex" }}>
        {items.map(({ key, label, Icon }) => {
          const active = current === key;
          const color = active ? COLORS.accentText : COLORS.textMuted;
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              title={label}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "9px 0 11px", background: "none", border: "none", color, cursor: "pointer" }}
            >
              <Icon size={20} />
              <span style={{ fontSize: 9.5, fontWeight: 600 }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConnectivityBanner({ online, pending, syncing, onSync }) {
  if (online && pending === 0) return null; // todo sincronizado y con red: sin banner
  const offline = !online;
  const bg = offline ? COLORS.dangerSoft : COLORS.accentSoft;
  const color = offline ? COLORS.danger : COLORS.accentText;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 14px", background: bg, color, fontSize: 12.5, fontWeight: 600 }}>
      {offline ? <WifiOff size={14} /> : <RefreshCw size={14} />}
      <span>
        {offline
          ? pending > 0
            ? `Sin conexión · ${pending} visita(s) guardada(s) cifradas, se sincronizarán al reconectar`
            : "Sin conexión · los registros se guardarán cifrados en el dispositivo"
          : `${pending} visita(s) pendiente(s) de sincronizar`}
      </span>
      {online && pending > 0 && (
        <button
          onClick={onSync}
          disabled={syncing}
          style={{ marginLeft: 6, background: "none", border: `1px solid ${color}`, color, borderRadius: 8, padding: "2px 8px", fontSize: 11.5, cursor: syncing ? "default" : "pointer" }}
        >
          {syncing ? "Sincronizando…" : "Sincronizar"}
        </button>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    none: { label: "Sin visitar", color: COLORS.textMuted, bg: COLORS.surface2 },
    in: { label: "En sucursal", color: COLORS.accentText, bg: COLORS.accentSoft },
    done: { label: "Completada", color: COLORS.success, bg: COLORS.successSoft },
  };
  const s = map[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: s.color, background: s.bg, padding: "5px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

function Row({ label, value, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: last ? "none" : `1px solid ${COLORS.border}` }}>
      <span style={{ fontSize: 13, color: COLORS.textMuted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, fontFamily: "JetBrains Mono" }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeedbackModal — reporte de retroalimentación del asesor.
// ---------------------------------------------------------------------------
// Modal (bottom-sheet, como el reporte de salida) donde el asesor describe un
// problema. ID y nombre vienen autollenados desde la sesión pero son editables;
// la sucursal se escribe a mano (para poder reportar sucursales que no aparecen
// en el catálogo) y la descripción es un campo amplio. Al enviar, se guarda una
// fila en la pestaña de retroalimentación del Google Sheet.
function FeedbackModal({ user, onClose, onTrack }) {
  const [idPromotor, setIdPromotor] = useState(user?.id ?? "");
  const [nombre, setNombre] = useState(user?.name ?? "");
  const [sucursal, setSucursal] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const [ticketId, setTicketId] = useState(null); // ticket que abrió el reporte (para darle seguimiento)
  const [errorMsg, setErrorMsg] = useState("");
  const [loc, setLoc] = useState({ status: "loading", coords: null }); // ubicación en tiempo real

  // Captura la ubicación GPS real al abrir el modal.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLoc({ status: "error", coords: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLoc({ status: "ok", coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      () => setLoc({ status: "error", coords: null }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  }, []);

  const canSend = sucursal.trim().length > 0 && descripcion.trim().length > 0 && state !== "sending";

  async function handleSubmit() {
    if (!canSend) return;
    setState("sending");
    setErrorMsg("");
    try {
      // Resumen técnico del teléfono (memoria, red, fotos recientes) para que
      // soporte entienda problemas de campo; nunca bloquea el envío.
      let diagnostico = "";
      try { diagnostico = `\n\n${formatForReport(await getDeviceProfile())}`; } catch { /* sin diagnóstico */ }
      const res = await api.sendFeedback({
        idPromotor: idPromotor.trim(),
        nombre: nombre.trim(),
        sucursal: sucursal.trim(),
        descripcion: `${descripcion.trim()}${diagnostico}`,
        ubicacion: loc.coords ? `${loc.coords.lat.toFixed(6)},${loc.coords.lng.toFixed(6)}` : "",
      });
      setTicketId(res?.ticketId ?? null);
      setState("sent");
    } catch (e) {
      setState("error");
      setErrorMsg(
        e instanceof ApiError
          ? e.message
          : "No hay conexión. Revisa tu internet e inténtalo de nuevo."
      );
    }
  }

  const labelStyle = { fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 };
  const fieldWrap = { background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 14 };
  const inputStyle = { background: "transparent", border: "none", outline: "none", color: COLORS.text, fontFamily: "Inter", fontSize: 15, width: "100%" };

  return (
    <div
      onClick={() => state !== "sending" && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(5,8,12,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 60 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, maxHeight: "92dvh", overflowY: "auto", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "22px 22px 26px" }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 18px" }} />

        {state === "sent" ? (
          <div style={{ textAlign: "center", padding: "10px 0 6px" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: COLORS.successSoft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <Check size={24} color={COLORS.success} />
            </div>
            <h3 style={{ fontFamily: "Space Grotesk", fontSize: 18, fontWeight: 600, color: COLORS.text, margin: "0 0 6px" }}>¡Gracias por tu reporte!</h3>
            <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "0 0 20px", lineHeight: 1.5 }}>
              Tu retroalimentación se registró. El equipo de Inteligencia Comercial la revisará.
              {ticketId ? " Abrimos un ticket para que le des seguimiento: ahí puedes agregar comentarios y un administrador te responde." : ""}
            </p>
            {ticketId && onTrack && (
              <button
                onClick={() => onTrack(ticketId)}
                style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontFamily: "Inter", fontWeight: 600, fontSize: 14.5, cursor: "pointer", marginBottom: 10 }}
              >
                Ver seguimiento de mi reporte
              </button>
            )}
            <button
              onClick={onClose}
              style={ticketId && onTrack
                ? { width: "100%", padding: "12px 0", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.text, fontFamily: "Inter", fontWeight: 600, fontSize: 14.5, cursor: "pointer" }
                : { width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontFamily: "Inter", fontWeight: 600, fontSize: 14.5, cursor: "pointer" }}
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
              <div>
                <h3 style={{ fontFamily: "Space Grotesk", fontSize: 17, fontWeight: 600, color: COLORS.text, margin: "0 0 4px" }}>Reportar un problema</h3>
                <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: "0 0 18px", lineHeight: 1.5 }}>
                  Cuéntanos qué pasó con el mayor detalle posible para poder ayudarte. Se adjunta un resumen técnico de tu teléfono (memoria y red).
                </p>
              </div>
              <button
                onClick={() => state !== "sending" && onClose()}
                aria-label="Cerrar"
                style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>ID del promotor</label>
                <div style={fieldWrap}>
                  <input
                    value={idPromotor}
                    onChange={(e) => setIdPromotor(e.target.value)}
                    inputMode="numeric"
                    placeholder="987654"
                    style={{ ...inputStyle, fontFamily: "JetBrains Mono", fontSize: 15 }}
                  />
                </div>
              </div>
              <div style={{ flex: 1.4 }}>
                <label style={labelStyle}>Nombre</label>
                <div style={fieldWrap}>
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Nombre del asesor"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>

            <label style={labelStyle}>Sucursal</label>
            <div style={fieldWrap}>
              <input
                value={sucursal}
                onChange={(e) => setSucursal(e.target.value)}
                placeholder="Ej. Morelia, Michoacán"
                style={inputStyle}
              />
            </div>

            <label style={labelStyle}>Ubicación (en tiempo real)</label>
            <div style={{ ...fieldWrap, display: "flex", alignItems: "center", gap: 9 }}>
              <MapPin size={16} color={loc.status === "ok" ? COLORS.accentText : COLORS.textMuted} style={{ flexShrink: 0 }} />
              <span style={{ color: loc.status === "ok" ? COLORS.text : COLORS.textMuted, fontSize: 13.5, fontFamily: "JetBrains Mono" }}>
                {loc.status === "ok"
                  ? `${loc.coords.lat.toFixed(4)}, ${loc.coords.lng.toFixed(4)}`
                  : loc.status === "loading"
                  ? "Obteniendo ubicación…"
                  : "Ubicación no disponible"}
              </span>
              {loc.status === "ok" && (
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, color: COLORS.success, fontSize: 11, fontWeight: 700 }}>
                  <Check size={13} /> Capturada
                </span>
              )}
            </div>

            <label style={labelStyle}>Describe el problema</label>
            <div style={{ ...fieldWrap, padding: "10px 12px" }}>
              <textarea
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                rows={5}
                maxLength={4000}
                placeholder="Ej. Estoy en la sucursal de Morelia en Michoacán y no he logrado hacer el check in porque no me aparece mi sucursal. ¿Qué puedo hacer?"
                style={{ ...inputStyle, resize: "vertical", minHeight: 96, lineHeight: 1.5, display: "block" }}
              />
            </div>

            {state === "error" && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: COLORS.dangerSoft, color: COLORS.danger, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.4, marginBottom: 14 }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{errorMsg}</span>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button
                onClick={() => state !== "sending" && onClose()}
                style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.textMuted, fontFamily: "Inter", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSend}
                style={{
                  flex: 2, padding: "12px 0", borderRadius: 10, border: "none",
                  background: canSend ? COLORS.accent : COLORS.surface2,
                  color: canSend ? COLORS.onAccent : COLORS.textMuted,
                  fontFamily: "Inter", fontWeight: 600, fontSize: 14, cursor: canSend ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {state === "sending" ? "Enviando…" : (<><Send size={15} /> Enviar reporte</>)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
