// ---------------------------------------------------------------------------
// Reporte semanal de KPIs — admin (in-app + correo) y cada supervisor (in-app).
// ---------------------------------------------------------------------------
// SIN cron ni worker aparte (no hay infraestructura de Render para eso todavía):
// se dispara "de paso" cada vez que alguien pide sus notificaciones
// (GET /api/notifications), si ya pasó una semana desde el último. Un
// cooldown en memoria evita re-consultar el Sheet en cada poll de 30s de la
// campana — como mucho se revisa cada CHECK_COOLDOWN_MS.
//
// LIMITACIÓN A PROPÓSITO: no llega a una hora fija (llega la próxima vez que
// alguien use la app tras cumplirse la semana). Si se necesita una hora
// exacta, hace falta un Cron Job real en Render — ver MANUAL_DESPLIEGUE.md.
import { getManagerSummary } from "./db.js";
import { getAllSupervisorsFromSheet } from "./usersSheet.js";
import { appendNotification, getLatestNotification } from "./notificationsSheet.js";
import { sendMail } from "./mailer.js";
import { config } from "./config.js";

const moneyFmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("es-MX");
const fmtMoney = (n) => moneyFmt.format(Number(n) || 0);
const fmtNum = (n) => numFmt.format(Number(n) || 0);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_COOLDOWN_MS = 30 * 60 * 1000; // no repetir la consulta al Sheet más de 1 vez cada 30 min
let lastCheckedAt = 0;

function useMoney(summary) {
  return summary.products.some((p) => p.precio > 0);
}

// Una línea compacta para el centro de notificaciones (campana).
function summaryLine(summary, label) {
  const t = summary.totals;
  const money = useMoney(summary);
  const monto = money ? fmtMoney(t.money) : `${fmtNum(t.units)} unidades`;
  const top = summary.promoters[0];
  const topText = top ? ` Top: ${top.name} (${money ? fmtMoney(top.money) : `${fmtNum(top.units)} u.`}).` : "";
  return `Resumen semanal${label ? ` de ${label}` : ""}: ${monto} vendido · ${t.promoters} activos · ${t.withoutSales} sin ventas · ${t.sucursalesVisited} sucursales.${topText}`;
}

// Correo más detallado (tabla con cada promotor) — solo para admin.
function summaryHtml(summary, title) {
  const t = summary.totals;
  const money = useMoney(summary);
  const rows = summary.promoters
    .slice(0, 15)
    .map((p) => `<tr><td>${p.name}</td><td align="right">${fmtNum(p.units)}</td><td align="right">${money ? fmtMoney(p.money) : "—"}</td></tr>`)
    .join("");
  return `
    <h2 style="font-family:sans-serif">${title}</h2>
    <p style="font-family:sans-serif">
      <b>Vendido:</b> ${money ? fmtMoney(t.money) : `${fmtNum(t.units)} unidades`} ·
      <b>Activos:</b> ${t.promoters} · <b>Sin ventas:</b> ${t.withoutSales} ·
      <b>Sucursales visitadas:</b> ${t.sucursalesVisited}
    </p>
    <table cellpadding="6" style="border-collapse:collapse;width:100%;font-family:sans-serif">
      <thead><tr><th align="left">Promotor</th><th align="right">Unidades</th><th align="right">Vendido</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function alreadySentThisWeek() {
  const latest = await getLatestNotification({ tipo: "weekly_report", para: "admin" });
  if (!latest?.fecha) return false;
  return Date.now() - new Date(latest.fecha).getTime() < SEVEN_DAYS_MS;
}

// Genera y entrega el reporte semanal si corresponde. Best-effort en todo:
// nunca lanza (no debe romper la carga de notificaciones de nadie).
export async function maybeSendWeeklyReports() {
  if (Date.now() - lastCheckedAt < CHECK_COOLDOWN_MS) return;
  lastCheckedAt = Date.now();

  try {
    if (await alreadySentThisWeek()) return;

    const adminSummary = await getManagerSummary("week");
    await appendNotification({ tipo: "weekly_report", para: "admin", detalle: summaryLine(adminSummary) });
    await sendMail({
      to: config.adminReportEmail,
      subject: "Reporte semanal — Ferreteros APP",
      html: summaryHtml(adminSummary, "Resumen semanal (nacional)"),
    });

    const supervisors = await getAllSupervisorsFromSheet();
    for (const sup of supervisors) {
      const supSummary = await getManagerSummary("week", { supervisorId: sup.id });
      await appendNotification({ tipo: "weekly_report", para: sup.id, detalle: summaryLine(supSummary, `tu equipo (${sup.name})`) });
    }
  } catch (e) {
    console.error("[weeklyReport] Falló la generación del reporte semanal:", e.message);
  }
}
