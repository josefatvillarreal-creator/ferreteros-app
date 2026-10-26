// Instancia única del cliente Prisma para toda la app.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// --- Concurrencia -----------------------------------------------------------
// PostgreSQL ya maneja escrituras concurrentes (MVCC), así que no requiere
// ajustes. Las PRAGMA WAL/busy_timeout solo aplican a SQLite; se ejecutan
// únicamente si el DATABASE_URL apunta a un archivo SQLite (`file:`).
const isSqlite = String(process.env.DATABASE_URL || "").startsWith("file:");

export async function initDb() {
  if (!isSqlite) {
    console.log("[db] PostgreSQL: concurrencia nativa (MVCC), sin PRAGMA.");
    return;
  }
  for (const pragma of ["PRAGMA journal_mode=WAL;", "PRAGMA busy_timeout=8000;", "PRAGMA synchronous=NORMAL;"]) {
    try {
      const r = await prisma.$queryRawUnsafe(pragma);
      if (pragma.includes("journal_mode")) console.log("[db] journal_mode:", JSON.stringify(r));
    } catch (e) {
      console.warn(`[db] ${pragma} no aplicada:`, e.message);
    }
  }
}

// Reintenta una operación de escritura ante errores transitorios de bloqueo
// (SQLITE_BUSY / write conflict). Backoff corto con pequeño jitter por intento.
export async function withWriteRetry(fn, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || "");
      const transient =
        e?.code === "P2034" || // write conflict / deadlock
        /database is locked|SQLITE_BUSY|locked/i.test(msg);
      if (!transient) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 40 * (i + 1) + (i * 7) % 23));
    }
  }
  throw lastErr;
}

// Cierre limpio de la conexión al terminar el proceso.
async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
