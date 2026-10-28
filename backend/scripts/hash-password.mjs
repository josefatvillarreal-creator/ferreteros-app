// ---------------------------------------------------------------------------
// Genera la fila de la pestaña "Usuarios" (ID, Nombre, Rol, Contraseña=HASH) SIN
// necesitar acceso al Sheet: la contraseña la escribes tú aquí y nunca se imprime.
// ---------------------------------------------------------------------------
// USO (desde backend/):
//   node scripts/hash-password.mjs <ID> <admin|gerente|supervisor> "<Nombre>"
//   (te pide la contraseña sin mostrarla; o define la variable PASSWORD)
// La salida es una fila separada por TABULADORES: cópiala y pégala en la pestaña
// Usuarios del Sheet (encabezados: ID | Nombre | Rol | Contraseña).
// Para supervisores, el ID debe ser su nombre en minúsculas tal como aparece en
// la columna Supervisor de la pestaña Promotores.
import bcrypt from "bcryptjs";
import readline from "node:readline";

const COST = 12;
const [id, rolRaw, nombre] = process.argv.slice(2);
const ROLES = ["admin", "gerente", "supervisor"];
const rol = String(rolRaw || "").trim().toLowerCase();

if (!id || !nombre || !ROLES.includes(rol)) {
  console.error('Uso: node scripts/hash-password.mjs <ID> <admin|gerente|supervisor> "<Nombre>"');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); }; // no hace eco de lo que se escribe
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const password = process.env.PASSWORD ?? (await askHidden("Contraseña (mínimo 10 caracteres): "));
if (password.length < 10) {
  console.error("La contraseña debe tener al menos 10 caracteres.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, COST);
console.log("\nPega esta fila en la pestaña Usuarios del Sheet (columnas ID | Nombre | Rol | Contraseña):\n");
console.log([id.trim(), nombre.trim(), rol, hash].join("\t"));
console.log("\nEl Sheet solo guarda el hash; la contraseña no se puede recuperar, solo reemplazar.");
