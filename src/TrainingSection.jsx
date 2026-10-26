// ---------------------------------------------------------------------------
// Contenido de la sección de Capacitación/Soporte del promotor.
// ---------------------------------------------------------------------------
// Componente genérico: `seccion` es "capacitacion" | "soporte" (mismo tablero
// de aprendizaje, distinto tema — "capacitacion" es cómo hacer mejor el
// trabajo, "soporte" es información técnica de producto). Lo monta
// PromotoresApp.jsx dentro de su mismo TopBar/FooterNav, como la pantalla de
// Competencia — este componente solo pinta el CONTENIDO.
//
// Tres pasos, uno a la vez (Principio de Segmentación): Aprender (mensaje de
// bienvenida + conceptos en bloques + micro-guías) -> Practicar (preguntas de
// opción múltiple con retroalimentación empática) -> Repasar (tarjetas
// Leitner de repetición espaciada). El contenido vive en un Google Sheet que
// llena el equipo de Protexa después — si todavía no hay nada, se muestra un
// estado vacío amable en vez de romperse.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BookOpen, ListChecks, Layers, ChevronRight, ChevronLeft, HelpCircle, Check, X, RotateCcw, Sparkles, Shuffle } from "lucide-react";
import { api, ApiError } from "./lib/api.js";
import { COLORS } from "./theme.js";

const STEPS = [
  { key: "aprender", label: "Aprender", Icon: BookOpen },
  { key: "practicar", label: "Practicar", Icon: ListChecks },
  { key: "repasar", label: "Repasar", Icon: Layers },
];

// Baraja una copia de `arr` (Fisher-Yates) y devuelve los primeros `n` — para
// que los tooltips mostrados varíen entre visitas sin ser siempre los mismos.
function pickRandom(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// `progress` = { aprender: {seen,total}, practicar: {mastered,total}, repasar:
// {mastered,total} } | null — cada pestaña pinta una barra delgada abajo que
// se va llenando conforme el promotor avanza en esa sección de contenido.
function StepTabs({ step, onChange, progress }) {
  const pct = (key) => {
    const p = progress?.[key];
    if (!p || !p.total) return 0;
    const done = key === "aprender" ? p.seen : p.mastered;
    return Math.min(100, Math.round((done / p.total) * 100));
  };
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
      {STEPS.map((s) => {
        const active = step === s.key;
        const p = pct(s.key);
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 6px 12px", borderRadius: 10, border: `1px solid ${active ? COLORS.accent : COLORS.border}`, background: active ? COLORS.accentSoft : COLORS.surface2, color: active ? COLORS.accentText : COLORS.textMuted, cursor: "pointer" }}
          >
            <s.Icon size={16} />
            <span style={{ fontSize: 11, fontWeight: 700 }}>{s.label}</span>
            {progress && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: COLORS.border }}>
                <div style={{ height: "100%", width: `${p}%`, background: COLORS.accent, transition: "width .4s ease" }} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 12px", color: COLORS.textMuted }}>
      <Sparkles size={26} style={{ opacity: 0.5 }} />
      <p style={{ fontSize: 13, marginTop: 10, lineHeight: 1.55 }}>{text}</p>
    </div>
  );
}

// --- Paso 1: Aprender — bienvenida + bloques (uno a la vez) + tooltips -----
function LearnStep({ seccion, onProgress }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [blockIdx, setBlockIdx] = useState(0); // -1 = pantalla de bienvenida
  const [openTooltip, setOpenTooltip] = useState(null);
  const [tooltipTick, setTooltipTick] = useState(0); // sube para volver a barajar los tooltips visibles
  const seenRef = useRef(new Set()); // ordenes de bloque ya reportados como vistos en ESTA visita

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setBlockIdx(-1);
    seenRef.current = new Set();
    api.trainingOnboarding(seccion)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "No se pudo cargar el contenido."); });
    return () => { cancelled = true; };
  }, [seccion]);

  // Marca el bloque actual como "visto" (una sola vez por bloque en esta
  // visita) — así la barra de "Aprender" se va llenando conforme avanza.
  useEffect(() => {
    if (!data || blockIdx < 0) return;
    const block = data.bloques[blockIdx];
    if (!block) return;
    const key = String(block.orden);
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);
    api.trainingProgress(seccion, { tipo: "bloque", orden: block.orden, correct: true })
      .then(() => onProgress?.())
      .catch(() => {});
  }, [data, blockIdx, seccion, onProgress]);

  // Siempre 3 tooltips a la vista, elegidos al azar del total — cambian entre
  // visitas (y con el botón "Ver otros") en vez de ser siempre los mismos 3.
  const visibleTooltips = useMemo(() => pickRandom(data?.tooltips ?? [], 3), [data, tooltipTick]);

  if (error) return <p style={{ fontSize: 13, color: COLORS.danger }}>{error}</p>;
  if (!data) return <p style={{ fontSize: 13, color: COLORS.textMuted }}>Cargando…</p>;

  const hasWelcome = Boolean(data.bienvenida);
  const hasBlocks = data.bloques.length > 0;
  if (!hasWelcome && !hasBlocks) return <EmptyState text="Todavía no hay contenido de aprendizaje aquí — vuelve pronto." />;

  // -1 = bienvenida, 0..n-1 = bloques.
  const showingWelcome = blockIdx === -1 && hasWelcome;
  const block = blockIdx >= 0 ? data.bloques[blockIdx] : null;
  const isLast = blockIdx >= data.bloques.length - 1;

  function next() {
    setBlockIdx((i) => Math.min(data.bloques.length - 1, i + 1));
  }
  function back() {
    setBlockIdx((i) => Math.max(hasWelcome ? -1 : 0, i - 1));
  }

  return (
    <div>
      {showingWelcome ? (
        <div style={{ background: COLORS.surface2, borderRadius: 14, padding: 18, marginBottom: 14 }}>
          <p style={{ fontSize: 14.5, color: COLORS.text, lineHeight: 1.6, margin: 0, whiteSpace: "pre-line" }}>{data.bienvenida}</p>
        </div>
      ) : block ? (
        <div style={{ background: COLORS.surface2, borderRadius: 14, padding: 18, marginBottom: 14 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.accentText, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Concepto {blockIdx + 1} de {data.bloques.length}
          </span>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: COLORS.text, margin: "6px 0 8px" }}>{block.titulo}</h3>
          <p style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.6, margin: 0, whiteSpace: "pre-line" }}>{block.texto}</p>
        </div>
      ) : (
        <EmptyState text="Todavía no hay conceptos aquí — vuelve pronto." />
      )}

      {(hasWelcome || hasBlocks) && (block || showingWelcome) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {!showingWelcome && (
            <button onClick={back} style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 14px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.textMuted, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              <ChevronLeft size={15} /> Atrás
            </button>
          )}
          {hasBlocks && !(showingWelcome ? false : isLast) && (
            <button
              onClick={showingWelcome ? () => setBlockIdx(0) : next}
              style={{ marginLeft: showingWelcome ? 0 : "auto", flex: showingWelcome ? 1 : undefined, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "10px 14px", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              {showingWelcome ? "Empecemos" : "Siguiente"} <ChevronRight size={15} />
            </button>
          )}
        </div>
      )}

      {data.tooltips.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <HelpCircle size={13} /> Términos que quizá no conozcas
            </div>
            {data.tooltips.length > 3 && (
              <button
                onClick={() => { setTooltipTick((t) => t + 1); setOpenTooltip(null); }}
                title="Ver otros términos"
                style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: COLORS.accentText, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}
              >
                <Shuffle size={12} /> Ver otros
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleTooltips.map((t, i) => {
              const open = openTooltip === i;
              return (
                <button
                  key={`${t.titulo}-${tooltipTick}`}
                  onClick={() => setOpenTooltip(open ? null : i)}
                  style={{ textAlign: "left", background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.accentText }}>{t.titulo}</div>
                  {open && <p style={{ fontSize: 12.5, color: COLORS.text, margin: "5px 0 0", lineHeight: 1.5 }}>{t.texto}</p>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Paso 2: Practicar — preguntas de opción múltiple, un intento a la vez -
function QuizStep({ seccion, onProgress }) {
  const [preguntas, setPreguntas] = useState(null);
  const [error, setError] = useState("");
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null); // índice (0-2) de la opción elegida en ESTE intento
  const [answeredCorrectly, setAnsweredCorrectly] = useState(false);

  const load = useCallback(() => {
    setPreguntas(null);
    setIdx(0);
    setPicked(null);
    setAnsweredCorrectly(false);
    api.trainingQuiz(seccion)
      .then(setPreguntas)
      .catch((e) => setError(e instanceof ApiError ? e.message : "No se pudo cargar el quiz."));
  }, [seccion]);

  useEffect(() => { load(); }, [load]);

  if (error) return <p style={{ fontSize: 13, color: COLORS.danger }}>{error}</p>;
  if (!preguntas) return <p style={{ fontSize: 13, color: COLORS.textMuted }}>Cargando…</p>;
  if (preguntas.length === 0) return <EmptyState text="Todavía no hay preguntas aquí — vuelve pronto." />;

  const p = preguntas[idx];
  const isLast = idx >= preguntas.length - 1;

  async function choose(optIdx) {
    if (answeredCorrectly) return; // ya la resolvió, solo falta avanzar
    const correct = optIdx + 1 === p.correcta;
    setPicked(optIdx);
    setAnsweredCorrectly(correct);
    try {
      await api.trainingProgress(seccion, { tipo: "pregunta", orden: p.orden, correct });
      onProgress?.();
    } catch {
      // Best-effort: si falla el guardado, el promotor sigue practicando igual.
    }
  }

  function next() {
    setIdx((i) => Math.min(preguntas.length - 1, i + 1));
    setPicked(null);
    setAnsweredCorrectly(false);
  }

  return (
    <div>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.accentText, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Pregunta {idx + 1} de {preguntas.length}
      </span>
      <h3 style={{ fontSize: 15.5, fontWeight: 700, color: COLORS.text, margin: "6px 0 14px", lineHeight: 1.4 }}>{p.pregunta}</h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {p.opciones.map((op, i) => {
          if (!op) return null;
          const isPicked = picked === i;
          const isCorrectOpt = i + 1 === p.correcta;
          let bg = COLORS.surface2, border = COLORS.border, color = COLORS.text;
          if (picked !== null && isPicked) {
            bg = answeredCorrectly ? COLORS.successSoft : COLORS.dangerSoft;
            border = answeredCorrectly ? COLORS.success : COLORS.danger;
          } else if (answeredCorrectly && isCorrectOpt) {
            bg = COLORS.successSoft;
            border = COLORS.success;
          }
          return (
            <button
              key={i}
              onClick={() => choose(i)}
              disabled={answeredCorrectly}
              style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "11px 13px", borderRadius: 10, border: `1px solid ${border}`, background: bg, color, fontSize: 13.5, cursor: answeredCorrectly ? "default" : "pointer" }}
            >
              {picked !== null && isPicked && (answeredCorrectly ? <Check size={15} color={COLORS.success} /> : <X size={15} color={COLORS.danger} />)}
              <span>{op}</span>
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: answeredCorrectly ? COLORS.successSoft : COLORS.dangerSoft, borderRadius: 10, padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>
          {answeredCorrectly ? <Check size={15} color={COLORS.success} style={{ flexShrink: 0, marginTop: 1 }} /> : <RotateCcw size={15} color={COLORS.danger} style={{ flexShrink: 0, marginTop: 1 }} />}
          <p style={{ fontSize: 12.5, color: COLORS.text, margin: 0 }}>
            {answeredCorrectly ? (p.feedbackAcierto || "¡Muy bien!") : (p.feedbackError || "No es esa — vuelve a intentarlo, tú puedes.")}
          </p>
        </div>
      )}

      {answeredCorrectly && !isLast && (
        <button onClick={next} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "11px 0", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
          Siguiente pregunta <ChevronRight size={15} />
        </button>
      )}
      {answeredCorrectly && isLast && (
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <p style={{ fontSize: 13, color: COLORS.success, fontWeight: 700, margin: "0 0 10px" }}>¡Terminaste el quiz!</p>
          <button onClick={load} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
            <RotateCcw size={13} /> Repasar de nuevo
          </button>
        </div>
      )}
    </div>
  );
}

// --- Paso 3: Repasar — tarjetas Leitner (anverso/reverso, ¿lo recordaste?) --
function FlashcardsStep({ seccion, onProgress }) {
  const [cards, setCards] = useState(null);
  const [error, setError] = useState("");
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const load = useCallback(() => {
    setCards(null);
    setIdx(0);
    setFlipped(false);
    api.trainingFlashcards(seccion)
      .then(setCards)
      .catch((e) => setError(e instanceof ApiError ? e.message : "No se pudieron cargar las tarjetas."));
  }, [seccion]);

  useEffect(() => { load(); }, [load]);

  if (error) return <p style={{ fontSize: 13, color: COLORS.danger }}>{error}</p>;
  if (!cards) return <p style={{ fontSize: 13, color: COLORS.textMuted }}>Cargando…</p>;
  if (cards.length === 0) return <EmptyState text="Todavía no hay tarjetas de repaso aquí — vuelve pronto." />;

  const c = cards[idx];
  const isLast = idx >= cards.length - 1;

  async function remembered(ok) {
    try {
      await api.trainingProgress(seccion, { tipo: "flashcard", orden: c.orden, correct: ok });
      onProgress?.();
    } catch {
      // Best-effort.
    }
    if (isLast) {
      load(); // termina la vuelta -> empieza otra, ya con las cajas actualizadas
    } else {
      setIdx((i) => i + 1);
      setFlipped(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.accentText, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Tarjeta {idx + 1} de {cards.length}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.textMuted, background: COLORS.surface2, borderRadius: 999, padding: "2px 9px" }}>Caja {c.box} de 5</span>
      </div>

      <button
        onClick={() => setFlipped((f) => !f)}
        style={{ width: "100%", minHeight: 150, borderRadius: 14, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, padding: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}
      >
        <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0, fontWeight: flipped ? 400 : 700 }}>{flipped ? c.reverso : c.anverso}</p>
      </button>
      <p style={{ fontSize: 11.5, color: COLORS.textMuted, textAlign: "center", margin: "8px 0 16px" }}>
        {flipped ? "Toca la tarjeta para ver la pregunta de nuevo" : "Toca la tarjeta para ver la respuesta"}
      </p>

      {flipped && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => remembered(false)}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.text, fontWeight: 600, fontSize: 13, cursor: "pointer" }}
          >
            <X size={15} /> No la recordé
          </button>
          <button
            onClick={() => remembered(true)}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", borderRadius: 10, border: "none", background: COLORS.accent, color: COLORS.onAccent, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
          >
            <Check size={15} /> Sí la recordé
          </button>
        </div>
      )}
    </div>
  );
}

export default function TrainingSection({ seccion, title }) {
  const [step, setStep] = useState("aprender");
  const [progress, setProgress] = useState(null); // { aprender, practicar, repasar } | null

  const refreshProgress = useCallback(() => {
    api.trainingProgressSummary(seccion).then(setProgress).catch(() => {});
  }, [seccion]);

  useEffect(() => {
    setProgress(null);
    refreshProgress();
  }, [seccion, refreshProgress]);

  return (
    <div>
      <span style={{ fontSize: 11, letterSpacing: "0.1em", color: COLORS.textMuted, fontWeight: 600 }}>{title.toUpperCase()}</span>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, margin: "2px 0 14px" }}>{title}</h2>

      <StepTabs step={step} onChange={setStep} progress={progress} />

      {step === "aprender" && <LearnStep seccion={seccion} onProgress={refreshProgress} />}
      {step === "practicar" && <QuizStep seccion={seccion} onProgress={refreshProgress} />}
      {step === "repasar" && <FlashcardsStep seccion={seccion} onProgress={refreshProgress} />}
    </div>
  );
}
