// ---------------------------------------------------------------------------
// Prisma contra SQLite en LOCAL, sin tocar el schema versionado.
// ---------------------------------------------------------------------------
// schema.prisma se versiona con provider = "postgresql" (lo que despliega
// Render). Este script genera prisma/schema.local.prisma (ignorado por git) con
// provider = "sqlite" y le pasa a la CLI de Prisma esa copia:
//   node scripts/prisma-local.mjs generate
//   node scripts/prisma-local.mjs db push --skip-generate
// Así no hay que editar schema.prisma a mano ni acordarse de revertirlo.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../prisma/", import.meta.url));
const schema = readFileSync(dir + "schema.prisma", "utf8").replace(/(datasource db \{\s*provider = )"postgresql"/, '$1"sqlite"');
writeFileSync(dir + "schema.local.prisma", schema);

const args = process.argv.slice(2);
const res = spawnSync("npx", ["prisma", ...args, "--schema", dir + "schema.local.prisma"], { stdio: "inherit", shell: true });
process.exit(res.status ?? 1);
