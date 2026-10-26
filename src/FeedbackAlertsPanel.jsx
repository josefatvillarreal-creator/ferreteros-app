// ---------------------------------------------------------------------------
// Botón-menú de "Alertas de Retroalimentación" — SOLO admin/gerente. Mismo
// patrón que NotificationBell/CompetenciaPanel: un ícono en el encabezado
// abre un desplegable anclado con el interruptor de encendido/apagado, el
// tema de ntfy.sh (push) y la lista de correos que reciben la alerta.
//
// Quien REALMENTE manda el correo/push es un Google Apps Script atado al
// Sheet (ver MANUAL_DESPLIEGUE.md) — este panel solo edita su configuración
// (guardada en dos pestañas del Sheet) para no tener que editarlas a mano.
import { useState, useEffect, useRef, useCallback } from "react";
import { BellRing, X, Trash2, Plus, Copy, Check } from "lucide-react";
import { api, ApiError } from "./lib/api.js";
import { COLORS } from "./theme.js";

export default function FeedbackAlertsPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); // { activo, temaNtfy, destinatarios } | null
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [temaDraft, setTemaDraft] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [addError, setAddError] = useState("");
  const [copied, setCopied] = useState(false);
  const boxRef = useRef(null);

  const load = useCallback(() => {
    api.feedbackAlerts()
      .then((d) => { setData(d); setTemaDraft(d.temaNtfy); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "No se pudo cargar la configuración."));
  }, []);

  useEffect(() => {
    if (open && !data) load();
  }, [open, data, load]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function toggleActivo() {
    if (!data || saving) return;
    setSaving(true);
    try {
      const next = await api.setFeedbackAlerts({ activo: !data.activo, temaNtfy: data.temaNtfy });
      setData((d) => ({ ...d, ...next }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTema() {
    if (!temaDraft.trim() || saving) return;
    setSaving(true);
    try {
      const next = await api.setFeedbackAlerts({ activo: data.activo, temaNtfy: temaDraft.trim() });
      setData((d) => ({ ...d, ...next }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function addRecipient() {
    if (!email.trim() || saving) return;
    setSaving(true);
    setAddError("");
    try {
      await api.addFeedbackAlertRecipient(nombre.trim(), email.trim());
      setNombre("");
      setEmail("");
      load();
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : "No se pudo agregar.");
    } finally {
      setSaving(false);
    }
  }

  async function removeRecipient(recipientEmail) {
    setSaving(true);
    try {
      await api.removeFeedbackAlertRecipient(recipientEmail);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo quitar.");
    } finally {
      setSaving(false);
    }
  }

  function copyNtfyUrl() {
    const url = `https://ntfy.sh/${data.temaNtfy}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Alertas de Retroalimentación"
        style={{ position: "relative", width: 36, height: 36, borderRadius: 9, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <BellRing size={16} />
        {data?.activo && (
          <span style={{ position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: 999, background: COLORS.success, border: `2px solid ${COLORS.surface}` }} />
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", top: 44, right: 0, width: 320, maxHeight: 480, display: "flex", flexDirection: "column", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.28)", zIndex: 900 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
            <BellRing size={13} color={COLORS.accentText} />
            <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, flex: 1 }}>Alertas de Retroalimentación</span>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, display: "flex", padding: 0 }}>
              <X size={16} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {!data && !error && <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0 }}>Cargando…</p>}
            {error && <p style={{ fontSize: 12.5, color: COLORS.danger, margin: "0 0 10px" }}>{error}</p>}

            {data && (
              <>
                <p style={{ fontSize: 11.5, color: COLORS.textMuted, lineHeight: 1.5, margin: "0 0 12px" }}>
                  Cuando llega un reporte nuevo en "Retroalimentación", se manda correo y push a quien esté en la lista de abajo. Lo dispara un Apps Script del Sheet, no este servidor.
                </p>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.text }}>{data.activo ? "Activas" : "Apagadas"}</span>
                  <button
                    onClick={toggleActivo}
                    disabled={saving}
                    style={{ width: 40, height: 22, borderRadius: 999, border: "none", background: data.activo ? COLORS.success : COLORS.border, position: "relative", cursor: saving ? "default" : "pointer", padding: 0 }}
                  >
                    <span style={{ position: "absolute", top: 2, left: data.activo ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s ease" }} />
                  </button>
                </div>

                <label style={{ fontSize: 11, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
                  Tema de ntfy.sh (push)
                </label>
                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <input
                    value={temaDraft}
                    onChange={(e) => setTemaDraft(e.target.value)}
                    style={{ flex: 1, minWidth: 0, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 10px", color: COLORS.text, fontSize: 12.5, fontFamily: "JetBrains Mono" }}
                  />
                  {temaDraft.trim() !== data.temaNtfy && (
                    <button onClick={saveTema} disabled={saving} style={{ padding: "0 12px", borderRadius: 8, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                      Guardar
                    </button>
                  )}
                </div>
                <button
                  onClick={copyNtfyUrl}
                  style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: COLORS.accentText, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: "2px 0 14px" }}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "Copiado" : `Copiar ntfy.sh/${data.temaNtfy}`}
                </button>
                <p style={{ fontSize: 10.5, color: COLORS.textMuted, lineHeight: 1.5, margin: "-8px 0 14px" }}>
                  Instala la app ntfy (iOS/Android) y suscríbete a ese tema para recibir el push en tu teléfono.
                </p>

                <label style={{ fontSize: 11, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
                  Reciben el correo
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {data.destinatarios.length === 0 && (
                    <p style={{ fontSize: 12, color: COLORS.textMuted, margin: 0 }}>Nadie configurado todavía.</p>
                  )}
                  {data.destinatarios.map((d) => (
                    <div key={d.email} style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "7px 10px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.nombre || d.email}</div>
                        {d.nombre && <div style={{ fontSize: 10.5, color: COLORS.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.email}</div>}
                      </div>
                      <button onClick={() => removeRecipient(d.email)} disabled={saving} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", display: "flex", padding: 2, flexShrink: 0 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Nombre"
                    style={{ width: 90, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 10px", color: COLORS.text, fontSize: 12 }}
                  />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    style={{ flex: 1, minWidth: 0, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 10px", color: COLORS.text, fontSize: 12 }}
                  />
                  <button
                    onClick={addRecipient}
                    disabled={saving || !email.trim()}
                    style={{ width: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "none", background: COLORS.accent, color: COLORS.onAccent, cursor: "pointer" }}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {addError && <p style={{ fontSize: 11, color: COLORS.danger, margin: "6px 0 0" }}>{addError}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
