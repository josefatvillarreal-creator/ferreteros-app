# Ferreteros APP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clon independiente de APP-PROMOTORES para clientes ferreteros: `Cliente → Sucursal`, catálogo de `Producto` configurable y visitas con cantidades por producto.

**Architecture:** Se copia el código de promotoría a `Ferreteros APP` (repo, BD, Sheet y servicio propios). El dominio cambia en tres capas: Prisma (`Cliente`, `Sucursal`, `Producto`, `VisitItem`), una capa pura testeable (`units.js`, `catalogParsers.js`, `managerSummary.js`) y las pantallas, que pintan un campo/KPI por producto a partir del catálogo.

**Tech Stack:** Node ≥ 18 (probado en 24), Express, Prisma 6 (SQLite local / PostgreSQL en Render), React 18 + Vite, googleapis, `node:test` (sin dependencias nuevas).

**Spec:** `docs/superpowers/specs/2026-10-26-ferreteros-app-design.md`

**Origen del código:** `G:\Unidades compartidas\Inteligencia Comercial\APP\Backup\app-promotoria\APP-PROMOTORES` (rama `feature/camara-frontal`, la de trabajo). **Destino:** `G:\Unidades compartidas\Inteligencia Comercial\Ferreteros APP`. Este plan lo llama `ORIGEN` y `DESTINO`. Todas las rutas del plan son relativas a `DESTINO`.

## Global Constraints

- Proyecto aparte: nombre `ferreteros-app`; Render: web `ferreteros-app`, base `ferreteros-db`. No se toca la app de promotoría, su repo, servicio ni BD.
- Repo remoto: `https://github.com/josefatvillarreal-creator/ferreteros-app.git`. Se registra como `origin`; **no se hace `git push` sin autorización explícita del usuario**.
- No copiar: `node_modules`, `dist`, `.git`, `APP-PROMOTORES.git`, `.claude`, `dev.db`, `.env`, `backend/credentials`, `Promotores.csv`, `Tiendas.csv`, `ssh-keygen*`.
- Sin credenciales ni servicios externos creados por el agente (Render, GitHub Actions, Google Cloud, Sheet).
- `schema.prisma` versionado con `provider = "postgresql"`; **sin `skip-worktree`**. Para correr en local se cambia temporalmente a `sqlite` (ver Task 4).
- Valores heredados: `CHECK_IN_RADIUS_METERS=100`, `NEARBY_RADIUS_METERS=2000`, caché del Sheet 5 min, meta semanal default 30 unidades-equivalentes, paleta Protexa (`src/theme.js`), UI en español.
- Productos iniciales: Rollo (equivalencia 1.0), Cubeta (0.6). Meta = Σ(cantidad × `equivalencia`); dinero = Σ(cantidad × `precio`). Se eliminan `PRECIO_ROLLO`, `PRECIO_CUBETA`, `galones`, `CUBETA_WEIGHT`, `goalUnits`.
- Pestañas del Sheet: `Clientes` (ID, Cliente, Estado), `Sucursales` (Num, ClienteID, Sucursal, Dirección, Latitud, Longitud, Estado), `Productos` (ID, Producto, Unidad, Equivalencia, Precio, Activo). Encabezados detectados por nombre, sin distinguir mayúsculas ni acentos.
- Una visita por promotor, sucursal y día.
- Decisiones del plan que se apartan de la copia literal (a confirmar por el usuario al revisar): se elimina el modo de desarrollo `VISITS_SOURCE=sheet` (`activitySheet.js`), porque la BD es nueva y no hay actividad histórica que reconstruir; se agrega `DEV_USERS` para poder iniciar sesión como supervisor/gerente en local sin Sheet.

## Review Focus

Entradas que el spec implica pero ninguna tarea de pruebas "natural" cubriría; cada una tiene su prueba en la tarea indicada.

1. Celda de Latitud o Longitud **vacía** (`Number("")` es 0): la sucursal se omite, no se coloca en 0,0. → Task 3
2. Sucursal con `ClienteID` vacío o inexistente: se omite con motivo y el resto carga. → Task 3, Task 5
3. Check-out con producto desconocido/inactivo, cantidad negativa, decimal o texto, o sin ningún item: se ignora o se recorta; sin items se permite (todo 0). → Task 2, Task 6
4. Producto con `Activo = NO` que ya tiene ventas: no sale en el formulario, pero sus ventas siguen sumando en historial, metas y tableros. → Task 5, Task 7
5. Sheet vacío, sin pestañas o caído: `/api/sucursales` responde `[]` sin 500 y conserva lo sincronizado antes. → Task 5

## File Structure

| Archivo (DESTINO) | Responsabilidad |
|---|---|
| `backend/src/units.js` (nuevo, puro) | Unidades-equivalentes, dinero y validación de items |
| `backend/src/catalogParsers.js` (nuevo, puro) | Filas de Sheet/CSV → clientes, productos, sucursales + omitidos |
| `backend/src/csvRows.js` (nuevo, puro) | Texto CSV → `string[][]` (lo usan el seed y las plantillas) |
| `backend/src/catalogSync.js` (nuevo; reemplaza `storesSheet.js`) | Upsert del catálogo a la BD y lectura del Sheet con caché |
| `backend/src/managerSummary.js` (reescrito, puro) | Agregación por promotor, estado y cliente |
| `backend/src/devUsers.js` (nuevo) | Usuarios admin/gerente/supervisor de desarrollo sin Sheet |
| `backend/src/routes/sucursales.js`, `routes/productos.js` | API de catálogo (reemplazan `routes/stores.js`) |
| `backend/prisma/schema.prisma`, `seed.js`, `seed-data/*.csv` | Modelo y datos demo |
| `plantillas/*.csv` | Plantillas para llenar el Sheet |
| `backend/test/*.test.js` | Pruebas `node:test` |
| `src/lib/api.js`, `src/PromotoresApp.jsx`, `src/dashboardShared.jsx`, `src/PromoterProfile.jsx`, `src/ManagerDashboard.jsx`, `src/SupervisorDashboard.jsx` | Pantallas |

## Contratos compartidos (los consumen varias tareas)

```js
// units.js
// catalog: Map<productoId, { equivalencia: number, precio: number }>
// items:   Array<{ productoId: string, cantidad: number }>
unitsOf(items, catalog): number
moneyOf(items, catalog): number
piecesOf(items): number                                  // Σ cantidad
normalizeItems(raw: unknown, activeIds: Set<string>): Array<{ productoId: string, cantidad: number }>

// catalogParsers.js — todas devuelven { items, skipped: Array<{ row: number, reason: string }> }; `row` es el número de fila 1-based
parseClientes(rows: string[][])    -> items: { id, nombre, estado: string|null }
parseProductos(rows: string[][])   -> items: { id, nombre, unidad, equivalencia, precio, activo, orden }
parseSucursales(rows: string[][], clienteIds: Set<string>) -> items: { id, clienteId, name, address, lat, lng, estado: string|null }
// Sin fila de encabezado reconocible: lanza Error(`No se encontró el encabezado en la pestaña "<nombre>"`)
```

API HTTP (todas con sesión):
- `GET /api/sucursales?lat&lng[&radius]` → `{ radius, sucursales: [{ id, name, address, lat, lng, estado, clienteId, clienteNombre, distance }] }`
- `GET /api/sucursales/all` → `{ sucursales }` (mismos campos sin `distance`)
- `GET /api/productos` → `{ productos: [{ id, nombre, unidad, orden }] }` (solo activos)
- `POST /api/visits/:sucursalId/check-in { coords, photo }` · `POST /api/visits/:sucursalId/check-out { coords, items: [{ productoId, cantidad }] }` · `POST /api/visits/:sucursalId/confirm-presence`
- `GET /api/visits/today` → `{ records: { [sucursalId]: { …visita, items: [{ productoId, cantidad }], hasPhoto } } }`
- `GET /api/manager/summary`, `GET /api/supervisor/summary`:
  `{ range, products: [{ id, nombre, unidad, precio }], totals: { promoters, sucursalesVisited, pieces, units, money, byProduct: {[id]: cantidad}, checkedIn, withoutSales, rosterTotal }, byEstado: [{ estado, promoters, pieces, units, money }], byCliente: [{ clienteId, cliente, sucursales, visits, pieces, units, money }], promoters: [{ id, name, supervisor, estado, pieces, units, money, byProduct, sucursalesVisited, status: "in"|"done", lastActivity, checkInTime, checkOutTime, lat, lng, goal: { target, achieved, reached }, visits: [{ day, sucursalId, sucursalName, clienteId, clienteNombre, estado, lat, lng, status, items, units, money, checkInTime, checkOutTime }] }], roster }`
  `products` incluye los activos y los inactivos con ventas en el rango. "Sin ventas" = `pieces === 0`.

---

### Task 1: Copia limpia, identidad del proyecto y repo

**Files:**
- Create: todo `DESTINO` copiado desde `ORIGEN` (lista exacta en Global Constraints), más `backend/test/.gitkeep`
- Modify: `package.json`, `backend/package.json`, `index.html`, `public/manifest.webmanifest`, `render.yaml`, `Dockerfile` y `docker-compose.yml` (solo nombres), `.gitignore`, `backend/package.json` (script de pruebas)

**Interfaces:**
- Produces: proyecto que instala y compila; `npm test` (en `backend/`) corre `node --test`; renombre mecánico de identificadores del dominio ya aplicado.

- [ ] **Step 1: Copiar con exclusiones.** `robocopy "<ORIGEN>" "<DESTINO>" /E /XD node_modules dist .git APP-PROMOTORES.git .claude credentials /XF dev.db .env Promotores.csv Tiendas.csv "ssh-keygen*"` (el `docs/` ya existente en `DESTINO` no se toca). Verificar que `DESTINO\backend\credentials` y `DESTINO\.git` **no** existen.
- [ ] **Step 2: Renombrar identidad.** `name` → `ferreteros-app` / `ferreteros-backend`; título y `manifest.webmanifest` (`name`, `short_name`) → "Ferreteros"; `render.yaml`: servicio `ferreteros-app`, base `ferreteros-db`, `SEED_CSV_PATH`/`SEED_STORES_CSV_PATH` → `SEED_DIR` apuntando a `/etc/secrets`; eliminar de `render.yaml` y `.env.example` las claves `PRECIO_ROLLO`, `PRECIO_CUBETA`, `STORES_SOURCE`, `VISITS_SOURCE` (se reemplazan por `CATALOG_SOURCE` en Task 5).
- [ ] **Step 3: Renombre mecánico de identificadores** (solo estos tokens, con límites de palabra, en `src/` y `backend/src/`, `backend/scripts/`, `backend/prisma/`): `storeId→sucursalId`, `storeName→sucursalName`, `storesVisited→sucursalesVisited`, `frequentStores→frequentSucursales`, `nearbyStores→nearbySucursales`, `allStores→allSucursales`, `getAllStores→getAllSucursales`, `getStore→getSucursal`, `getStoreGoal→getSucursalGoal`, `setStoreGoal→setSucursalGoal`, `idTienda→idSucursal`, `/stores→/sucursales`. Las variables locales `store`/`stores` y los textos en español se ajustan en la tarea que edita cada archivo, no aquí.
- [ ] **Step 4: Dependencias de pruebas y `.gitignore`.** En `backend/package.json` agregar `"test": "node --test"`. En `.gitignore` conservar las exclusiones y agregar excepciones `!backend/prisma/seed-data/*.csv` y `!plantillas/*.csv`.
- [ ] **Step 5: Instalar y compilar.** `npm install && npm run build` en la raíz y `npm install` en `backend/`. Esperado: `vite build` termina sin error. (El backend aún no arranca: los modelos Prisma cambian en Task 4.)
- [ ] **Step 6: Inicializar git.** `git init -b main`, `git remote add origin https://github.com/josefatvillarreal-creator/ferreteros-app.git`, `git add -A`, `git commit -m "chore: copia inicial de APP-PROMOTORES para Ferreteros"`. **No hacer push.** Avisar al usuario de que la carpeta está en Drive y `node_modules` se sincroniza.

### Task 2: Unidades-equivalentes, dinero y validación de items (puro)

**Files:**
- Create: `backend/src/units.js`
- Test: `backend/test/units.test.js`

**Interfaces:**
- Produces: `unitsOf`, `moneyOf`, `piecesOf`, `normalizeItems` (firmas arriba).

- [ ] **Step 1: Escribir las pruebas** con el catálogo `{ rollo: {equivalencia:1, precio:850}, cubeta: {equivalencia:0.6, precio:1200}, galon: {equivalencia:0, precio:350} }`:
  - `unitsOf([{productoId:"rollo",cantidad:3},{productoId:"cubeta",cantidad:5}], catalog) === 6`
  - `moneyOf` de esos mismos items `=== 3*850 + 5*1200` (8550)
  - producto fuera del catálogo aporta 0 a `unitsOf` y `moneyOf`; `galon` aporta 0 a unidades pero sí dinero
  - `piecesOf` suma cantidades (`galon` cuenta)
  - `normalizeItems([{productoId:"rollo",cantidad:2},{productoId:"rollo",cantidad:3}], ids)` → un solo item `{rollo, 5}`
  - `normalizeItems` descarta ids fuera de `activeIds`, y recorta `-4`, `"abc"`, `NaN`, `null` a 0 y trunca `2.7` a 2; con `raw` no-array o `[]` → `[]`; no devuelve items de cantidad 0
- [ ] **Step 2: Ejecutar** `npm test -- test/units.test.js` en `backend/`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** las cuatro funciones en `backend/src/units.js`; `catalog` acepta un `Map`.
- [ ] **Step 4: Ejecutar** la misma prueba. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: unidades-equivalentes y validación de items`.

### Task 3: Parsers del catálogo (Sheet y CSV) (puro)

**Files:**
- Create: `backend/src/catalogParsers.js`, `backend/src/csvRows.js`
- Test: `backend/test/catalogParsers.test.js`, `backend/test/csvRows.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `parseClientes`, `parseProductos`, `parseSucursales` (contrato arriba); `parseCsv(text: string): string[][]` (detecta `,` o `;`, soporta comillas dobles, ignora líneas vacías, quita BOM).

- [ ] **Step 1: Escribir las pruebas** de `parseSucursales(rows, new Set(["c1"]))` con encabezado `["Num","ClienteID","Sucursal","Dirección","Latitud","Longitud","Estado"]`:
  - fila válida → item `{id:"1001", clienteId:"c1", name, address, lat:19.7008, lng:-101.1844, estado}`; `address` vacío → `""`
  - encabezados en otro orden, en mayúsculas y sin acento (`DIRECCION`) también funcionan
  - **Latitud o Longitud vacía → omitida** con `reason` que contenga `coordenadas` (no se coloca en 0,0); también texto no numérico y `lat=95`
  - `ClienteID` vacío o no incluido en el set → omitida con `reason` que contenga `cliente`
  - `Num` vacío → omitida (`reason` contiene `Num`); `Num` duplicado → la primera gana, la segunda omitida (`reason` contiene `duplicad`)
  - filas totalmente vacías se ignoran sin aparecer en `skipped`; `skipped[i].row` es el número de fila 1-based de la hoja (incluyendo el encabezado y filas previas)
  - sin encabezado → lanza `No se encontró el encabezado en la pestaña "Sucursales"`
  - `parseProductos`: `Equivalencia` vacía → 1; `Precio` vacío → 0; `Activo` en `NO`/`no`/`false`/`0` → `false`, vacío u otro valor → `true`; equivalencia negativa o texto → omitida; `orden` = posición (0, 1, …) entre las filas válidas; `Equivalencia` `0` es válida
  - `parseClientes`: `Estado` vacío → `null`; `ID` duplicado → omitida
  - `parseCsv`: `"a;b\n1;2"` y `"a,b\n1,2"` → `[["a","b"],["1","2"]]`; campo con comillas y coma `"x, y",z` se respeta; BOM inicial no contamina el primer encabezado
- [ ] **Step 2: Ejecutar** `npm test -- test/catalogParsers.test.js test/csvRows.test.js`. Esperado: FAIL.
- [ ] **Step 3: Implementar** los parsers. Normalizar encabezados con `NFD`, quitar diacríticos, minúsculas y trim. Encabezado = primera fila que contiene todas las columnas obligatorias (Clientes: `id`,`cliente`; Productos: `id`,`producto`; Sucursales: `num`,`clienteid`,`latitud`,`longitud`). Coordenadas: celda vacía o no numérica es inválida **antes** de convertir a `Number`.
- [ ] **Step 4: Ejecutar** las pruebas. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: parsers del catálogo ferretero`.

### Task 4: Modelo Prisma y datos demo

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/prisma/seed.js`
- Create: `backend/prisma/seed-data/Clientes.csv`, `Sucursales.csv`, `Productos.csv`, `Promotores.csv`
- Modify: `backend/.env.example`, `README.md` (sección Base de datos)

**Interfaces:**
- Consumes: `parseCsv`, `parseClientes`, `parseProductos`, `parseSucursales`.
- Produces: modelos `Cliente`, `Sucursal`, `Producto`, `VisitItem`; `VisitRecord.sucursalId` y `items`; clave compuesta `promoterId_sucursalId_day`.

- [ ] **Step 1: Reescribir el esquema** (`provider = "postgresql"` en el archivo versionado):
  - `Cliente { id String @id, nombre String, estado String?, sucursales Sucursal[] }`
  - `Sucursal { id String @id, clienteId String → Cliente, name String, address String, lat Float, lng Float, estado String?, visits VisitRecord[] }` con `@@index([clienteId])`
  - `Producto { id String @id, nombre String, unidad String @default("pza"), equivalencia Float @default(1), precio Float @default(0), activo Boolean @default(true), orden Int @default(0), items VisitItem[] }`
  - `VisitRecord`: quitar `rollos`, `cubetas`, `galones`; `storeId→sucursalId` → `Sucursal`; `items VisitItem[]`; `@@unique([promoterId, sucursalId, day])`
  - `VisitItem { id String @id @default(uuid()), visit VisitRecord @relation(onDelete: Cascade), visitId String, producto Producto, productoId String, cantidad Int }` con `@@unique([visitId, productoId])`
  - `Promoter`, `CompetitionReport`, `TrainingProgress`, `Thread`, `ThreadComment` sin cambios.
- [ ] **Step 2: Datos demo** (marcados como demo en un comentario del README): Clientes `c1 Ferretería Demo del Centro`, `c2 Ferretería Demo del Norte`; 4 sucursales en Morelia (Num 1001–1004, 2 por cliente, coordenadas reales de Morelia); Productos `rollo` (1.0, $850), `cubeta` (0.6, $1200), `galon` (0, $350); 1 promotor `90500276` con supervisor `Supervisor Demo` y contraseña `demo1234`.
- [ ] **Step 3: Reescribir `seed.js`** para leer los 4 CSV de `SEED_DIR` (por defecto `prisma/seed-data`), reutilizar los parsers, hashear con bcrypt y hacer upsert. Idempotente: se omite si ya hay promotores y `SEED_FORCE !== "true"`. Imprime conteos y los `skipped`.
- [ ] **Step 4: Verificar local.** En `backend/`: cambiar temporalmente `provider` a `sqlite`, `.env` con `DATABASE_URL="file:./dev.db"`, `npx prisma generate && npx prisma db push && node prisma/seed.js`. Esperado: `Seed OK: 1 promotores, 2 clientes, 4 sucursales, 3 productos`. Restaurar `provider = "postgresql"` antes del commit (`git diff backend/prisma/schema.prisma` no debe mostrar `sqlite`).
- [ ] **Step 5: Commit** `feat: modelo Cliente/Sucursal/Producto y datos demo`.

### Task 5: Catálogo en BD y Sheet, rutas de sucursales y productos

**Files:**
- Create: `backend/src/catalogSync.js`, `backend/src/routes/sucursales.js`, `backend/src/routes/productos.js`
- Delete: `backend/src/storesSheet.js`, `backend/src/routes/stores.js`
- Modify: `backend/src/config.js`, `backend/src/db.js` (sección catálogo), `backend/src/server.js`
- Test: `backend/test/catalogSync.test.js`

**Interfaces:**
- Consumes: parsers de Task 3; modelos de Task 4.
- Produces:
  - `syncCatalog(tabs: { clientes: string[][], productos: string[][], sucursales: string[][] }, db = prisma): Promise<{ clientes: number, productos: number, sucursales: number, skipped: Array<{ tab: string, row: number, reason: string }> }>` — orden Clientes → Productos → Sucursales; las sucursales se validan contra los `Cliente` ya existentes en la BD.
  - `ensureCatalogSynced(): Promise<void>` — lee las tres pestañas con TTL (`CATALOG_CACHE_TTL_MS`, 5 min), nunca lanza; si una pestaña falla se registra y se conserva lo ya sincronizado.
  - `config.catalogSource` (`"db" | "sheet"`, env `CATALOG_SOURCE`) y `config.sheets.clientesTab/sucursalesTab/productosTab` (defaults `Clientes`, `Sucursales`, `Productos`); se eliminan `storesSource`, `tiendasTab`, `prices`, `visitsSource`.
  - En `db.js`: `getAllSucursales()`, `getSucursal(id)` (incluye `clienteNombre`), `getProductosActivos()`, `getCatalogoProductos(): Promise<Map<string,{equivalencia,precio}>>` (todos, activos o no).

- [ ] **Step 1: Escribir las pruebas** contra SQLite temporal (`DATABASE_URL=file:./test.db`, creado con `prisma db push` en un `before`, borrado en `after`):
  - tabs válidas → 1 cliente, 1 producto, 1 sucursal creados y `skipped = []`
  - sucursal con coordenadas vacías y otra con `ClienteID` inexistente → solo se carga la válida y `skipped` contiene ambas con su `tab: "Sucursales"` y número de fila
  - segundo `syncCatalog` con un producto cambiado a `Activo = NO` → `activo = false` en la BD y el producto no se borra
  - `syncCatalog` con `sucursales: []` (pestaña vacía o sin encabezado) no lanza: conserva las sucursales ya sincronizadas y reporta un `skipped` con `tab: "Sucursales"` y `row: 0`; el error de encabezado de cualquier pestaña se maneja así, por pestaña
  - `getProductosActivos()` excluye inactivos y respeta `orden`; `getCatalogoProductos()` incluye los inactivos
- [ ] **Step 2: Ejecutar** `npm test -- test/catalogSync.test.js`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `catalogSync.js` (credenciales y cliente de Sheets con el mismo patrón que `usersSheet.js`) y las funciones de `db.js`. En `db.js` reemplazar `ensureStoresSynced`/`storesSource` por `ensureCatalogSynced`/`catalogSource`.
- [ ] **Step 4: Rutas.** `sucursales.js` conserva la lógica de `stores.js` (Haversine, radio acotado a `nearbyRadiusMeters`) y devuelve la forma del contrato; `productos.js` devuelve `getProductosActivos()`. En `server.js`, montar `/api/sucursales` y `/api/productos` y quitar `/api/stores`. Si no hay sucursales, responder `{ radius, sucursales: [] }` con 200.
- [ ] **Step 5: Ejecutar** `npm test`. Esperado: PASS. Arrancar `npm run dev` y comprobar con `curl` tras iniciar sesión (cookie + CSRF, ver `routes/auth.js`) que `GET /api/sucursales/all` devuelve las 4 sucursales demo con `clienteNombre`.
- [ ] **Step 6: Commit** `feat: catálogo de clientes, sucursales y productos`.

### Task 6: Visitas con productos, metas por equivalencia y reglas del Sheet de actividad

**Files:**
- Modify: `backend/src/db.js` (visitas, metas, historial, perfil, notificaciones), `backend/src/routes/visits.js`, `backend/src/goalsSheet.js`, `backend/src/sheets.js`, `backend/src/notificationsSheet.js`, `backend/src/routes/promoterProfile.js`, `backend/scripts/set-goal.mjs`, `backend/scripts/seed-promoter-goals.mjs`
- Delete: `backend/src/activitySheet.js`
- Test: `backend/test/visits.test.js`

**Interfaces:**
- Consumes: `normalizeItems`, `unitsOf` (Task 2); `getProductosActivos`, `getCatalogoProductos` (Task 5).
- Produces:
  - `submitVisitReport(promoterId: string, sucursalId: string, patch: object, items?: Array<{productoId,cantidad}>): Promise<VisitRecord & { items }>` — si se pasa `items`, reemplaza los de la visita dentro de una transacción.
  - `fetchTodayVisits`/`getVisit` devuelven el registro con `items: [{ productoId, cantidad }]`.
  - `getMyGoalProgress(promoterId): Promise<{ target, achieved, reached }>` con `achieved = unitsOf(itemsDeLaSemana, catálogo)`.
  - `DEFAULT_WEEKLY_GOAL_UNITS = 30` (exportado por `goalsSheet.js`; reemplaza `DEFAULT_WEEKLY_GOAL_ROLLOS`).

- [ ] **Step 1: Escribir las pruebas** (SQLite temporal, mismo montaje que Task 5; sin tocar Sheets: no configurado):
  - check-out con `items` válidos → el registro devuelto trae `items` y `status: "checked-out"`
  - un segundo `submitVisitReport` con otros items **reemplaza** los anteriores (no duplica; respeta `@@unique([visitId, productoId])`)
  - sin `items` en el patch (`check-in`) no crea `VisitItem`
  - `getMyGoalProgress` con 3 rollos + 5 cubetas esta semana → `achieved === 6`, `target === 30`, `reached === false`; con un `galon` extra, `achieved` no cambia
  - un producto marcado `activo = false` después de la venta **sigue** sumando en `achieved`
  - ruta de check-out: `normalizeItems` recibe solo ids de `getProductosActivos()`; un body con producto inactivo, cantidad `-3` y texto produce `items: []` y el check-out igual se registra
- [ ] **Step 2: Ejecutar** `npm test -- test/visits.test.js`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** `visits.js`: rutas `/:sucursalId/...`, mensajes "Sucursal no encontrada en el catálogo" y "Estás a N m de la sucursal…"; check-out lee `req.body.items`. `db.js`: eliminar `rollos`/`cubetas`/`galones`, calcular semanas con `visitItem`. `goalsSheet.js`: `tipo` acepta `sucursal` y el alias `tienda`; quitar `CUBETA_WEIGHT`, `goalUnits`, `DEFAULT_WEEKLY_GOAL_CUBETAS`. `sheets.js` → `HEADERS` de "Actividad Diaria": `registrado_en`, `id_promotor`, `nombre`, `cliente`, `sucursal`, `hora_entrada`, `hora_salida`, `productos` (texto `"Rollo: 3; Cubeta: 2"`), `unidades`; `appendVisitRow({ promoter, sucursal, sucursalId, checkInTime, checkOutTime, items, units })`. `notificationsSheet.js`: columnas `id_sucursal`, `sucursal`; tipo `store_goal` → `sucursal_goal`. Quitar `activitySheet` de `db.js`, `VISITS_SOURCE` de la configuración y sus menciones en `.env.example`.
- [ ] **Step 4: Ejecutar** `npm test`. Esperado: PASS. Verificación manual: check-in y check-out en la sucursal demo con `curl` y confirmar en la respuesta de `/api/visits/today` los `items`.
- [ ] **Step 5: Commit** `feat: visitas con cantidades por producto y metas por equivalencia`.

### Task 7: Resumen de gerente/supervisor por producto, estado y cliente (puro + db)

**Files:**
- Modify: `backend/src/managerSummary.js`, `backend/src/db.js` (`getManagerSummary`, `getSupervisorSummary`, `attachGoalProgress`, `getPromoterHistoryPage`), `backend/src/weeklyReport.js`, `backend/src/routes/notifications.js`
- Test: `backend/test/managerSummary.test.js`

**Interfaces:**
- Consumes: `unitsOf`, `moneyOf`, `piecesOf` (Task 2).
- Produces: `summarizeVisitRows(rows, products, range)` donde `rows` = `VisitRecord` con `items: [{productoId,cantidad}]`, `promoter: {name,supervisor,estado}` y `sucursal: {name,estado,lat,lng,clienteId,cliente:{nombre}}`, y `products` = **todos** los productos (`{id,nombre,unidad,equivalencia,precio,activo}`). Devuelve la forma de `/api/manager/summary` del contrato (sin `goal` ni `roster`, que agrega `db.js`).

- [ ] **Step 1: Escribir las pruebas** con 2 promotores, 2 clientes y los 3 productos demo:
  - `totals.byProduct`, `totals.pieces`, `totals.units`, `totals.money` coinciden con la suma manual
  - `byCliente` agrupa por `clienteId` con `sucursales` = número de sucursales distintas y `visits` = número de visitas
  - `byEstado` agrupa por el estado **del promotor** (`"Sin estado"` si falta)
  - `products` incluye los activos y también un producto inactivo que tenga ventas en el rango, pero no uno inactivo sin ventas
  - un promotor con visita abierta (`status: "checked-in"`) da `status: "in"` y cuenta en `totals.checkedIn`; uno con `pieces === 0` cuenta en `withoutSales`
  - ordena promotores por `money` y luego por `units` descendente
  - `rows: []` → totales en 0 y listas vacías, sin lanzar
- [ ] **Step 2: Ejecutar** `npm test -- test/managerSummary.test.js`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `summarizeVisitRows` y adaptar `db.js`: consultar `visitRecord` con `items`, `promoter`, `sucursal: { include: { cliente } }` y `omit: { photo: true }`; `attachGoalProgress` suma `unitsOf` de la semana con `getCatalogoProductos()`. `weeklyReport.js`: "hay precios" = `summary.products.some((p) => p.precio > 0)`, y las cantidades usan `summary.totals.units`/`p.units`. `notifications.js`: `units: p.units`. `getPromoterHistoryPage`: cada visita lleva `sucursalName`, `clienteNombre`, `items` y `units`.
- [ ] **Step 4: Ejecutar** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: resumen por producto, estado y cliente`.

### Task 8: Usuarios de desarrollo sin Sheet

**Files:**
- Create: `backend/src/devUsers.js`
- Modify: `backend/src/usersSheet.js` (`findUserInSheet`, `getAllSupervisorsFromSheet`), `backend/.env.example`
- Test: `backend/test/devUsers.test.js`

**Interfaces:**
- Produces: `findDevUser(id: string, env = process.env): Promise<{ id, name, role, password } | null>` donde `password` es hash bcrypt. Lee `DEV_USERS` con formato `id:rol:Nombre:contraseña;id:rol:Nombre:contraseña`. Solo activo si `NODE_ENV !== "production"` y el Sheet **no** está configurado.

- [ ] **Step 1: Escribir las pruebas:** `DEV_USERS="admin:admin:Admin Demo:demo1234"` → `findDevUser("admin")` devuelve rol `admin` y `bcrypt.compare("demo1234", password)` verdadero; `findDevUser("nadie")` → `null`; con `NODE_ENV="production"` → `null` aunque `DEV_USERS` exista; `DEV_USERS` vacío o malformado (`"x"`) → `null` sin lanzar; el rol desconocido cae a `gerente`.
- [ ] **Step 2: Ejecutar** `npm test -- test/devUsers.test.js`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `findDevUser` y llamarla desde `findUserInSheet` cuando `isConfigured()` es falso; `getAllSupervisorsFromSheet` también incluye supervisores de desarrollo bajo esa misma condición.
- [ ] **Step 4: Ejecutar** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: usuarios de desarrollo (DEV_USERS) para pruebas sin Sheet`.

### Task 9: App del promotor (sucursales y productos)

**Files:**
- Modify: `src/lib/api.js`, `src/PromotoresApp.jsx`, `src/lib/offlineStore.js` (solo si referencia el payload de check-out), `src/AppRouter.jsx`

**Interfaces:**
- Consumes: API HTTP del contrato.
- Produces: `api.nearbySucursales(lat, lng, signal)`, `api.allSucursales(signal)`, `api.productos(signal)`, `api.checkOut(sucursalId, { coords, items })`.

- [ ] **Step 1: Cliente HTTP.** Actualizar `api.js` a los endpoints nuevos; `checkOut` envía `{ coords, items }`.
- [ ] **Step 2: Formulario de check-out.** Reemplazar los estados `rollos`/`cubetas` y los dos `Stepper` fijos por `cantidades: Record<productoId, number>` y un `Stepper` por cada producto de `api.productos()` (etiqueta = `nombre`). `items` enviados = solo cantidades > 0. La cola offline (`queueOffline("check-out", …)`) guarda `{ coords, items }`. El resumen de visita (líneas de `Rollos vendidos`/`Cubetas vendidas` y `{v.rollos}R · {v.cubetas}C`) lista cada item con el nombre del producto, resolviendo `productoId` contra la lista cargada y mostrando el id si el producto ya no está.
- [ ] **Step 3: Textos.** "Tiendas"/"tienda" → "Sucursales"/"sucursal" en la interfaz del promotor y en `AppRouter.jsx`; en las listas y el mapa mostrar `clienteNombre – name`. `GoalBar label` → `"Unidades equivalentes"`. Renombrar las variables locales `store`/`stores` que representan sucursales en las funciones que se editen.
- [ ] **Step 4: Compilar.** `npm run build` en la raíz. Esperado: sin errores.
- [ ] **Step 5: Verificar en el navegador** (backend con `DEV_USERS`, frontend con `npm run dev`): entrar como `90500276`; con el GPS emulado en las coordenadas de la sucursal 1001 (DevTools → Sensors) hacer check-in con foto, check-out con 2 rollos y 1 cubeta; la barra de meta marca 2.6 y el resumen de la visita lista "Rollo: 2" y "Cubeta: 1". Sin errores en consola.
- [ ] **Step 6: Commit** `feat: app del promotor con sucursales y productos`.

### Task 10: Piezas compartidas de tableros, exportes y perfil

**Files:**
- Modify: `src/dashboardShared.jsx`, `src/PromoterProfile.jsx`

**Interfaces:**
- Consumes: forma de `summary` del contrato.
- Produces: `buildExportHeaders(products): string[]` (`ID, Promotor, Supervisor, Estado, Cliente, ID Sucursal, Sucursal, Día, Entrada, Salida, <un nombre por producto>, Unidades, Dinero`); `buildExportRows(promoters, products)` para el CSV/Excel; `ProductCountBoxes({ p, products })` (un cuadrito por producto); `pieceCount(p, selectedIds: Set<string>)` = Σ `p.byProduct[id]` de los seleccionados, o `p.pieces` si el set está vacío.

- [ ] **Step 1: Reemplazar** `EXPORT_HEADERS` por `buildExportHeaders` y adaptar las funciones de exportación CSV/Excel; los `CountBox` fijos de rollos/cubetas por `ProductCountBoxes`; el indicador "Con ventas / Sin ventas" y el color usan `p.pieces`; el popup del mapa lista los productos con cantidad > 0; el texto del modal de meta pasa a "unidades equivalentes en la semana (cada producto pesa según su equivalencia; default sin meta propia: 30)".
- [ ] **Step 2: Perfil.** `PromoterProfile.jsx`: cada visita del historial lista `cliente – sucursal` y los items con nombre (reusar la resolución `productoId → nombre` con `summary.products`/catálogo).
- [ ] **Step 3: Compilar.** `npm run build`. Esperado: sin errores.
- [ ] **Step 4: Commit** `feat: componentes compartidos de tablero por producto`.

### Task 11: Tableros de gerente y supervisor (productos y cliente)

**Files:**
- Modify: `src/ManagerDashboard.jsx`, `src/SupervisorDashboard.jsx`

**Interfaces:**
- Consumes: `summary.products`, `summary.byCliente`, helpers de Task 10.

- [ ] **Step 1: KPIs por producto.** Reemplazar los KPI fijos de Rollos/Cubetas por uno por cada `summary.products`, con el valor `totals.byProduct[id]`; el filtro `unitFilter` pasa a ser un `Set` de `productoId`; el valor por promotor para ordenar/graficar usa `pieceCount` (cantidad) o `p.money`; quitar `prices`, `UNIT_LABELS` y el aviso de `PRECIO_ROLLO`/`PRECIO_CUBETA` (mostrar en su lugar "Configura el precio de cada producto en la pestaña Productos del Sheet").
- [ ] **Step 2: Filtro y gráfica por cliente.** Agregar un selector de cliente junto al de estado (mismo patrón que `estado`, valores de `summary.byCliente`, opción "Todos los clientes") que filtra promotores con al menos una visita al cliente elegido, y una `ChartCard` "Ventas por cliente" con `byCliente`. El mapa muestra `cliente – sucursal`.
- [ ] **Step 3: Textos.** "Tiendas visitadas" → "Sucursales visitadas" (`totals.sucursalesVisited`); descripciones de ayuda y de la guía de novedades ya no mencionan rollos/cubetas ni "30 rollos-equivalentes".
- [ ] **Step 4: Compilar.** `npm run build`. Esperado: sin errores.
- [ ] **Step 5: Verificar en el navegador** con `DEV_USERS` de gerente y supervisor: tras la visita de Task 9 el gerente ve los KPI Rollo, Cubeta y Galón, el filtro por cliente reduce la lista y la gráfica "Ventas por cliente" muestra el cliente de la sucursal 1001; el supervisor ve solo a su equipo. Exportar CSV: contiene una columna por producto. Sin errores en consola.
- [ ] **Step 6: Commit** `feat: tableros con productos y filtro por cliente`.

### Task 12: Plantillas, documentación y verificación final

**Files:**
- Create: `plantillas/Clientes.csv`, `Sucursales.csv`, `Productos.csv`, `Promotores.csv`, `Usuarios.csv` (encabezados + 1–2 filas de ejemplo claramente marcadas)
- Modify: `README.md`, `OBJETIVOS.md`, `MANUAL_DESPLIEGUE.md`, `.env.example`, `backend/.env.example`, `DEPLOY.md`, `DEPLOY-RENDER.md`, `render.yaml`

- [ ] **Step 1: Plantillas** con los encabezados exactos de Global Constraints (y `ID,Nombre,Rol,Contraseña` / `ID,Nombre,Ubicación,Supervisor,Estado,Contraseña` para usuarios y promotores, comprobando contra `usersSheet.js` y `promotersSheet.js`).
- [ ] **Step 2: Documentación.** README: arquitectura, pestañas del Sheet nuevas, modelo `Cliente → Sucursal → Producto`, `CATALOG_SOURCE`, `DEV_USERS`, regla de carga gradual (filas omitidas y dónde ver el aviso), aviso del `provider` de Prisma sin `skip-worktree`. OBJETIVOS/MANUAL: sustituir tiendas por sucursales y rollos/cubetas por productos, y la lista de pendientes del spec §11 (crear Sheet y compartirlo con el Service Account, crear servicio y Postgres en Render, cargar catálogo real).
- [ ] **Step 3: Búsqueda de residuos.** `rg -n -i "rollo|cubeta|PRECIO_|tienda|STORES_SOURCE|VISITS_SOURCE" src backend/src backend/scripts` solo puede devolver: nombres de productos demo en `seed-data`, la pestaña heredada `Confirmación en tienda`, y mensajes que digan "sucursal". Corregir el resto.
- [ ] **Step 4: Verificación completa.** `cd backend && npm test` (todo PASS); `npm run build` en la raíz sin errores; recorrido en el navegador promotor → supervisor → gerente repetido de principio a fin sobre una BD recién sembrada; y una sincronización de catálogo con una pestaña de sucursales que mezcla filas válidas, sin coordenadas y con cliente inexistente: la app arranca, lista solo las válidas y registra los avisos.
- [ ] **Step 5: Commit** `docs: plantillas, manuales y variables de entorno`. **No hacer push**: pedir autorización al usuario.
