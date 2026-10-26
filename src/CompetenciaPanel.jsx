// ---------------------------------------------------------------------------
// Botón-menú de Competencia — admin/gerente ve todos los reportes, supervisor
// solo los de su equipo. Mismo patrón que NotificationBell: un ícono en el
// encabezado abre un desplegable anclado (no un modal centrado), que primero
// muestra un LISTADO compacto (promotor, marca, fecha) y, al hacer clic en
// una fila, cambia a el DETALLE de ese reporte (descripción + fotos). `fetcher`
// es la función de api.js a usar (managerCompetencia | supervisorCompetencia)
// para no duplicar este componente por rol.
//
// Las fotos (hasta 5 por reporte, Base64) NO vienen en el listado — se piden
// aparte con `photosFetcher` (managerCompetenciaPhotos | supervisorCompetenciaPhotos)
// SOLO del reporte que se abre, y se cachean en memoria mientras el panel
// sigue abierto para no volver a pedirlas si el admin entra y sale del mismo
// reporte. Antes se traían las fotos de los 200 reportes de golpe con el
// listado — era el mayor consumo de memoria del backend.
import { useState, useEffect, useRef, useCallback } from "react";
import { Flag, User, ZoomIn, ChevronRight, ArrowLeft } from "lucide-react";
import { ApiError } from "./lib/api.js";
import { COLORS } from "./theme.js";
import { fmtDateTime } from "./dashboardShared.jsx";

export default function CompetenciaPanel({ fetcher, photosFetcher }) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); // reporte elegido, o null = listado
  const [photosById, setPhotosById] = useState({}); // cache: reportId -> [dataUrl, ...]
  const [photosLoadingId, setPhotosLoadingId] = useState(null);
  const [photosError, setPhotosError] = useState("");
  const [zoomSrc, setZoomSrc] = useState(null);
  const boxRef = useRef(null);

  const load = useCallback(() => {
    fetcher()
      .then((res) => setReports(res.reports ?? []))
      .catch((e) => setError(e instanceof ApiError ? e.message : "No se pudieron cargar los reportes."))
      .finally(() => setLoaded(true));
  }, [fetcher]);

  function selectReport(r) {
    setSelected(r);
    setPhotosError("");
    if (photosById[r.id]) return; // ya en caché, no se vuelve a pedir
    setPhotosLoadingId(r.id);
    photosFetcher(r.id)
      .then((res) => setPhotosById((prev) => ({ ...prev, [r.id]: res.photos ?? [] })))
      .catch((e) => setPhotosError(e instanceof ApiError ? e.message : "No se pudieron cargar las fotos."))
      .finally(() => setPhotosLoadingId(null));
  }

  // Carga solo la primera vez que se abre (no en cada render) — igual de
  // económico que la campana, que sí hace polling porque cambia seguido; los
  // reportes de Competencia no son tan urgentes como para refrescar solos.
  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setSelected(null);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function toggle() {
    setOpen((o) => !o);
    setSelected(null);
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={toggle}
        title="Competencia"
        style={{ position: "relative", width: 36, height: 36, borderRadius: 9, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <Flag size={16} />
        {loaded && reports.length > 0 && (
          <span style={{ position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 999, background: COLORS.accent, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {reports.length > 9 ? "9+" : reports.length}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", top: 44, right: 0, width: 320, maxHeight: 440, display: "flex", flexDirection: "column", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.28)", zIndex: 900 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
            {selected && (
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, display: "flex", padding: 0 }}>
                <ArrowLeft size={16} />
              </button>
            )}
            <Flag size={13} color={COLORS.accentText} />
            <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{selected ? "Detalle del reporte" : "Competencia"}</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {!loaded && <p style={{ fontSize: 12.5, color: COLORS.textMuted, padding: "20px 14px", textAlign: "center", margin: 0 }}>Cargando…</p>}
            {error && <p style={{ fontSize: 12.5, color: COLORS.danger, padding: "20px 14px", margin: 0 }}>{error}</p>}

            {loaded && !error && reports.length === 0 && (
              <p style={{ fontSize: 12.5, color: COLORS.textMuted, padding: "20px 14px", textAlign: "center", margin: 0 }}>Aún no hay reportes de competencia.</p>
            )}

            {loaded && !error && !selected && reports.map((r) => (
              <button
                key={r.id}
                onClick={() => selectReport(r)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "none", border: "none", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer", textAlign: "left" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <User size={11} color={COLORS.textMuted} />
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.promoterName}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.accentText, background: COLORS.accentSoft, borderRadius: 999, padding: "1px 7px" }}>{r.marca}</span>
                    <span style={{ fontSize: 10.5, color: COLORS.textMuted }}>{fmtDateTime(r.createdAt)}</span>
                  </div>
                </div>
                <ChevronRight size={14} color={COLORS.textMuted} style={{ flexShrink: 0 }} />
              </button>
            ))}

            {selected && (
              <div style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <User size={12} color={COLORS.textMuted} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.text }}>{selected.promoterName}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.accentText, background: COLORS.accentSoft, borderRadius: 999, padding: "2px 9px" }}>{selected.marca}</span>
                  <span style={{ fontSize: 10.5, color: COLORS.textMuted }}>{fmtDateTime(selected.createdAt)}</span>
                </div>
                <p style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5, margin: "0 0 10px" }}>{selected.descripcion}</p>
                {photosLoadingId === selected.id && (
                  <p style={{ fontSize: 12, color: COLORS.textMuted, margin: 0 }}>Cargando fotos…</p>
                )}
                {photosError && photosLoadingId !== selected.id && !photosById[selected.id] && (
                  <p style={{ fontSize: 12, color: COLORS.danger, margin: 0 }}>{photosError}</p>
                )}
                {(photosById[selected.id]?.length ?? 0) > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {photosById[selected.id].map((src, i) => (
                      <button
                        key={i}
                        onClick={() => setZoomSrc(src)}
                        style={{ position: "relative", width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: `1px solid ${COLORS.border}`, padding: 0, cursor: "pointer", background: COLORS.surface2 }}
                      >
                        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.15)", opacity: 0, transition: "opacity .15s" }}>
                          <ZoomIn size={14} color="#fff" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {zoomSrc && (
        <div
          onClick={(e) => { e.stopPropagation(); setZoomSrc(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}
        >
          <img src={zoomSrc} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
