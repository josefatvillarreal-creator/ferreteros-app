// ---------------------------------------------------------------------------
// Envío de correo (reporte semanal al admin) por SMTP genérico.
// ---------------------------------------------------------------------------
// Funciona con Google Workspace/Gmail (smtp.gmail.com:587 + una "contraseña de
// aplicación") o cualquier otro proveedor SMTP. Si falta configuración, el
// envío se omite (best-effort): el reporte in-app sigue funcionando igual —
// nunca debe romper nada por no tener correo configurado.
import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporterPromise = null;

function isConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465, // 587 usa STARTTLS, no TLS directo
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      })
    );
  }
  return transporterPromise;
}

// Envía un correo. Nunca lanza: si no está configurado o falla, registra y
// devuelve { sent: false }.
export async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) {
    console.warn("[mailer] SMTP no configurado (faltan SMTP_HOST/USER/PASS); se omite el correo.");
    return { sent: false, reason: "not-configured" };
  }
  if (!to) {
    console.warn("[mailer] Sin destinatario; se omite el correo.");
    return { sent: false, reason: "no-recipient" };
  }
  try {
    const transporter = await getTransporter();
    await transporter.sendMail({ from: config.smtp.from, to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error("[mailer] No se pudo enviar el correo:", e.message);
    return { sent: false, reason: e.message };
  }
}
