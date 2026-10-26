// ---------------------------------------------------------------------------
// Usuarios administrativos de DESARROLLO (sin Google Sheet).
// ---------------------------------------------------------------------------
// En producción admin/gerente/supervisor viven en la pestaña "Usuarios" del
// Sheet (usersSheet.js). Para probar los tableros en local sin credenciales de
// Google, DEV_USERS define usuarios así:
//   DEV_USERS="admin:admin:Admin Demo:demo1234;sup:supervisor:Supervisor Demo:clave1"
//   (id:rol:Nombre:contraseña, separados por ';'; sin ':' ni ';' dentro de los campos)
// Solo funciona con NODE_ENV distinto de "production" (y usersSheet.js solo lo
// consulta cuando el Sheet NO está configurado).
import bcrypt from "bcryptjs";

function normalizeRole(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (/admin/.test(v)) return "admin";
  if (/supervisor/.test(v)) return "supervisor";
  return "gerente";
}

function parse(env) {
  if (env.NODE_ENV === "production") return [];
  return String(env.DEV_USERS ?? "")
    .split(";")
    .map((entry) => entry.split(":").map((p) => p.trim()))
    .filter(([id, , name, pw]) => id && name && pw)
    .map(([id, role, name, pw]) => ({ id, name, role: normalizeRole(role), plain: pw }));
}

async function toUser({ plain, ...u }) {
  return { ...u, password: await bcrypt.hash(plain, 4) };
}

// { id, name, role, password(hash bcrypt) } o null.
export async function findDevUser(id, env = process.env) {
  const u = parse(env).find((x) => x.id === String(id).trim());
  return u ? toUser(u) : null;
}

export async function listDevSupervisors(env = process.env) {
  return Promise.all(parse(env).filter((u) => u.role === "supervisor").map(toUser));
}
