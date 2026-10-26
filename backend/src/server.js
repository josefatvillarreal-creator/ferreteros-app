import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.js";
import { initDb } from "./prisma.js";
import { csrfProtection } from "./csrf.js";
import { requireAuth } from "./auth.js";
import { checkSheetsConnection } from "./sheets.js";
import authRoutes from "./routes/auth.js";
import storeRoutes from "./routes/stores.js";
import visitRoutes from "./routes/visits.js";
import feedbackRoutes from "./routes/feedback.js";
import managerRoutes from "./routes/manager.js";
import supervisorRoutes from "./routes/supervisor.js";
import notificationsRoutes from "./routes/notifications.js";
import promoterProfileRoutes from "./routes/promoterProfile.js";
import competitionRoutes from "./routes/competition.js";
import trainingRoutes from "./routes/training.js";
import feedbackAlertsRoutes from "./routes/feedbackAlerts.js";
import threadsRoutes from "./routes/threads.js";

// Robustez: un error no capturado en una petición NO debe tumbar el servidor
// (si se cae, TODOS los promotores pierden el servicio). Registramos y seguimos.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1); // detrás de un reverse proxy (HTTPS): IP/proto reales
// Límite amplio para la foto en Base64 (ya redimensionada en el cliente a
// ~100-200 KB). El tope solo protege de payloads anómalos.
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

// CORS con credenciales (solo relevante si el frontend corre en otro origen).
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);

// Cabeceras de seguridad básicas (equivalente mínimo a helmet).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// Protección CSRF explícita en toda petición que cambie estado (Protexa).
app.use(csrfProtection);

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api", authRoutes); // expone /api/login, /api/auth/session, /api/auth/logout
app.use("/api/sucursales", storeRoutes); // GET /api/sucursales?lat&lng (tiendas cercanas)
app.use("/api/visits", visitRoutes);
app.use("/api/feedback", feedbackRoutes); // POST /api/feedback (retroalimentación)
app.use("/api/manager", managerRoutes); // GET /api/manager/summary (gerente/admin)
app.use("/api/supervisor", supervisorRoutes); // GET /api/supervisor/summary (solo sus promotores)
app.use("/api/notifications", notificationsRoutes); // GET /api/notifications (campana)
app.use("/api/promoters", promoterProfileRoutes); // GET /api/promoters/:id/profile (historial)
app.use("/api/competition", competitionRoutes); // POST /api/competition (reportes de competencia)
app.use("/api/training", trainingRoutes); // Capacitación/Soporte (onboarding, quiz, flashcards)
app.use("/api/feedback-alerts", feedbackAlertsRoutes); // config de alertas automáticas de Retroalimentación
app.use("/api/threads", threadsRoutes); // hilos tipo foro: chat supervisor<->admin y seguimiento de tickets

// Diagnóstico de Google Sheets (requiere sesión): verifica credenciales y acceso
// al documento sin necesidad de un check-out real.
app.get("/api/sheets/status", requireAuth, async (req, res) => {
  res.json(await checkSheetsConnection());
});

// --- Servir el frontend estático (producción, mismo origen) ----------------
// Si existe el build del frontend (../../dist), lo servimos desde este mismo
// servidor. Ventajas: un solo origen (cookies/CSRF first-party sin proxy) y un
// único proceso detrás de HTTPS. Se activa con SERVE_STATIC=true o si el build
// existe. En dev (Vite en :5173) no aplica.
const distDir = fileURLToPath(new URL("../../dist/", import.meta.url));
const serveStatic = process.env.SERVE_STATIC === "true" || existsSync(distDir);
if (serveStatic && existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: cualquier ruta que no sea /api devuelve index.html.
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, "index.html")));
}

// 404 (solo para /api si se sirve estático) y manejador de errores.
app.use((req, res) => res.status(404).json({ message: "No encontrado" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[error]", err);
  if (res.headersSent) return;
  res.status(err.status ?? 500).json({ message: "Error interno" });
});

initDb().finally(() => {
  app.listen(config.port, () => {
    console.log(
      `Backend Promotores en http://localhost:${config.port} (auth: ID + contraseña bcrypt${serveStatic ? "; sirviendo frontend estático" : ""})`
    );
  });
});
