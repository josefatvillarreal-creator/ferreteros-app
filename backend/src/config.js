import "dotenv/config";

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    console.warn(`[config] Falta la variable de entorno ${name}`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  // Origen de autenticación de promotores: "db" (Prisma, por defecto) o "sheet"
  // (lee el promotor + su hash bcrypt directamente del Google Sheet).
  authSource: (process.env.AUTH_SOURCE ?? "db").toLowerCase(),

  // Origen del catálogo de tiendas: "db" (Prisma) o "sheet" (sincroniza la
  // pestaña Tiendas del Sheet hacia la base local).
  storesSource: (process.env.STORES_SOURCE ?? "db").toLowerCase(),

  // Origen de las VISITAS para el resumen del gerente: "db" (Prisma, la fuente
  // real en producción) o "sheet" (lee la pestaña de auditoría de check-out,
  // útil en desarrollo local donde la base local no tiene la actividad real).
  visitsSource: (process.env.VISITS_SOURCE ?? "db").toLowerCase(),

  session: {
    secret: required("SESSION_SECRET", "insecure-dev-secret"),
    ttlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 28800),
    cookieSecure: String(process.env.COOKIE_SECURE ?? "false") === "true",
    cookieName: "session",
  },

  // Radio máximo (m) permitido entre promotor y tienda para check-in/out.
  // FUENTE DE VERDAD: el servidor recalcula la distancia (Haversine) y rechaza
  // si se supera. Requisito Protexa: 100 m con GPS real.
  rangeMeters: Number(process.env.CHECK_IN_RADIUS_METERS ?? 100),

  // Radio (m) para listar tiendas cercanas en GET /api/sucursales?lat&lng.
  nearbyRadiusMeters: Number(process.env.NEARBY_RADIUS_METERS ?? 2000),

  // --- Precios de venta (para el resumen del gerente) ----------------------
  // El check-out solo captura CANTIDADES (rollos y cubetas). Para mostrar el
  // "dinero vendido" en la pantalla del gerente, multiplicamos cada cantidad por
  // su precio unitario. Se definen por variable de entorno para poder ajustarlos
  // sin tocar código. Si quedan en 0, el dashboard muestra $0 (recuerda ponerlos).
  prices: {
    rollo: Number(process.env.PRECIO_ROLLO ?? 0),
    cubeta: Number(process.env.PRECIO_CUBETA ?? 0),
  },

  // --- Google Sheets (solo para el administrador) --------------------------
  // Al hacer check-out, el backend agrega una fila con los datos de la visita.
  // Se autentica con un Service Account. Puedes darle las credenciales de dos
  // formas (cualquiera): el JSON completo en `GOOGLE_SERVICE_ACCOUNT_JSON`, o la
  // ruta a un archivo JSON en `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`. Si no hay
  // credenciales o spreadsheetId, la integración se omite (no bloquea nada).
  sheets: {
    json: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "", // JSON completo (env var)
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ?? "", // o ruta a un archivo JSON
    spreadsheetId: process.env.GOOGLE_SHEETS_ID ?? "",
    tab: process.env.GOOGLE_SHEETS_TAB ?? "Visitas",
    // Pestaña donde se guarda la retroalimentación (reportes de error) que
    // envían los asesores desde la app. Se crea sola si no existe.
    feedbackTab: process.env.GOOGLE_SHEETS_FEEDBACK_TAB ?? "Retroalimentacion",
    // Pestaña de promotores (usada cuando AUTH_SOURCE=sheet).
    promotersTab: process.env.GOOGLE_SHEETS_PROMOTERS_TAB ?? "Promotores",
    // Pestaña de tiendas (usada cuando STORES_SOURCE=sheet).
    tiendasTab: process.env.GOOGLE_SHEETS_TIENDAS_TAB ?? "Tiendas",
    // Pestaña de usuarios administrativos (admin/gerente), separada de los
    // promotores. Login de gerentes/admin se valida contra esta pestaña.
    usuariosTab: process.env.GOOGLE_SHEETS_USUARIOS_TAB ?? "Usuarios",
    // Pestaña de auditoría de check-out (usada cuando VISITS_SOURCE=sheet).
    actividadTab: process.env.GOOGLE_SHEETS_ACTIVIDAD_TAB ?? "Actividad Diaria",
    // Metas de venta mensuales (por promotor y por tienda, en unidades).
    metasTab: process.env.GOOGLE_SHEETS_METAS_TAB ?? "Metas",
    // Notificaciones (check-in, meta alcanzada) para supervisores/admin.
    notificacionesTab: process.env.GOOGLE_SHEETS_NOTIFICACIONES_TAB ?? "Notificaciones",
    // Reportes de competencia (marca, descripción) que envían los promotores.
    // Las fotos NO van aquí (ver CompetitionReport en la base de datos); esta
    // pestaña es solo un resumen para que el admin lo revise sin abrir la app.
    competenciaTab: process.env.GOOGLE_SHEETS_COMPETENCIA_TAB ?? "Competencia",
    // Confirmaciones de "sigo en tienda" (alerta aleatoria 10am-4pm, solo
    // promotores) — ver presenceSheet.js.
    confirmacionTab: process.env.GOOGLE_SHEETS_CONFIRMACION_TAB ?? "Confirmación en tienda",
    // Capacitación/Soporte (ver trainingSheet.js): bienvenida + bloques +
    // tooltips en una pestaña, quiz y flashcards Leitner en las otras dos.
    // Mismo contenido/estructura para ambas secciones ("capacitacion" |
    // "soporte"), discriminado por la columna "Seccion" de cada pestaña.
    capacitacionTab: process.env.GOOGLE_SHEETS_CAPACITACION_TAB ?? "Capacitacion",
    capacitacionQuizTab: process.env.GOOGLE_SHEETS_CAPACITACION_QUIZ_TAB ?? "Capacitacion_Quiz",
    capacitacionFlashcardsTab: process.env.GOOGLE_SHEETS_CAPACITACION_FLASHCARDS_TAB ?? "Capacitacion_Flashcards",
    // Alertas automáticas de Retroalimentación (correo + push vía ntfy.sh),
    // disparadas por un Google Apps Script atado al Sheet — ver
    // feedbackAlertsSheet.js y MANUAL_DESPLIEGUE.md para el script exacto.
    alertasRetroConfigTab: process.env.GOOGLE_SHEETS_ALERTAS_RETRO_CONFIG_TAB ?? "AlertasRetroConfig",
    alertasRetroDestinatariosTab: process.env.GOOGLE_SHEETS_ALERTAS_RETRO_DESTINATARIOS_TAB ?? "AlertasRetroDestinatarios",
  },

  // --- Correo (reporte semanal para el admin) -------------------------------
  // SMTP genérico (funciona con Google Workspace: host smtp.gmail.com, puerto
  // 587, usuario = la cuenta, contraseña = una "contraseña de aplicación", NO
  // la contraseña normal de la cuenta si tiene 2FA). Si falta cualquiera de
  // estos, el envío de correo se omite (best-effort): el reporte in-app sigue
  // funcionando igual.
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
  },
  // A quién se le manda el reporte semanal por correo (además de verlo in-app).
  adminReportEmail: process.env.ADMIN_REPORT_EMAIL ?? "",
};
