# Ferreteros APP — Diseño

Fecha: 2026-10-26
Estado: pendiente de revisión del usuario

## 1. Objetivo

Crear una copia independiente de la app de promotoría (APP-PROMOTORES), orientada a
**clientes ferreteros**, en `Ferreteros APP`. El usuario cargará poco a poco la
información de clientes y sucursales, por lo que el sistema debe funcionar con datos
parciales.

Éxito = un promotor puede hacer check-in/out por GPS en la sucursal de un cliente
ferretero y registrar cantidades por producto; supervisor y gerente ven el avance por
sucursal, cliente y estado; y todo se alimenta de un Google Sheet propio.

## 2. Decisiones del usuario

| Tema | Decisión |
|---|---|
| Relación cliente/sucursal | Un **cliente** ferretero tiene varias **sucursales**; el check-in se hace en la sucursal |
| Qué registra la visita | **Catálogo de productos configurable** (no rollos/cubetas fijos) |
| Carga de datos | **Google Sheet propio**, igual que la app original |
| Aislamiento | Proyecto aparte: repo, BD, Sheet y servicio Render propios |

Supuestos (no confirmados explícitamente): se conserva la paleta/marca Protexa; los
datos reales llegan después, así que se arranca con datos de ejemplo.

## 3. Alcance

### Dentro
- Copiar `src/`, `backend/`, `public/`, `Dockerfile`, `Caddyfile`, `docker-compose.yml`,
  `render.yaml`, `index.html`, `vite.config.js`, `package*.json`, `.gitignore`,
  `.dockerignore`, `.env.example` y los manuales, ajustados al dominio ferretero.
- Conservar: login por ID + bcrypt + JWT en cookie HttpOnly con CSRF; roles promotor,
  supervisor, gerente/admin; check-in/out con GPS y foto; mapa; metas; competencia;
  tickets y chat; capacitación; notificaciones; PWA.
- Nuevo modelo `Cliente → Sucursal`, catálogo `Producto` y `VisitItem`.

### Fuera
- No se copia: `node_modules`, `dist`, `.git`, `APP-PROMOTORES.git`, `dev.db`,
  credenciales, `.env`, historial de git, CSV con datos reales.
- No se modifica la app de promotoría ni su repo/servicio/BD.
- No se crean servicios externos (Render, GitHub, Google Cloud, Sheet). Se entregan
  pasos y archivos de ejemplo; las altas las hace el usuario o las autoriza aparte.
- Asignación de clientes por promotor (posible fase posterior).

## 4. Arquitectura

Misma arquitectura que el origen: SPA React 18 + Vite (PWA) y backend Node/Express con
Prisma (SQLite local, PostgreSQL en Render). `AppRouter.jsx` ramifica por rol.
`backend/src/db.js` sigue siendo la única capa que toca Prisma. Google Sheets alimenta
catálogos y configuración; las fotos siguen en la BD, nunca en el Sheet.

## 5. Modelo de datos (Prisma)

- `Cliente`: `id`, `nombre`, `estado?`.
- `Sucursal` (reemplaza `Store`): `id`, `clienteId` → `Cliente`, `nombre`, `address`,
  `lat`, `lng`, `estado?`.
- `Producto`: `id`, `nombre`, `unidad`, `equivalencia` (Float, peso en la meta),
  `precio` (Float, default 0), `activo` (Boolean), `orden` (Int). Inicial: Rollo
  (equivalencia 1.0) y Cubeta (0.6).
- `VisitRecord`: se eliminan `rollos`, `cubetas`, `galones`; `storeId` pasa a
  `sucursalId`. Unicidad `[promoterId, sucursalId, day]`.
- `VisitItem`: `id`, `visitId` → `VisitRecord` (cascade), `productoId` → `Producto`,
  `cantidad` (Int). Unicidad `[visitId, productoId]`.
- Sin cambios: `Promoter`, `CompetitionReport`, `TrainingProgress`, `Thread`,
  `ThreadComment` (`Thread.sucursal` ya es texto libre).
- Metas: unidades-equivalentes = Σ(cantidad × `Producto.equivalencia`); default
  30/semana si no hay fila en `Metas`. Dinero vendido = Σ(cantidad × `Producto.precio`).
  Se eliminan `PRECIO_ROLLO` y `PRECIO_CUBETA` de la configuración.
- La BD es nueva: no hay migración de datos históricos.
- `schema.prisma` se versiona con `provider = "postgresql"` (lo que despliega Render).
  Para desarrollo local se documenta el cambio temporal a `sqlite`; el proyecto nuevo
  **no** usa `skip-worktree`, para evitar el riesgo de divergencia que tiene el origen.

## 6. Google Sheet propio

Pestañas nuevas (encabezados detectados por nombre, como `storesSheet.js`):

| Pestaña | Columnas |
|---|---|
| `Clientes` | ID, Cliente, Estado |
| `Sucursales` | Num, ClienteID, Sucursal, Dirección, Latitud, Longitud, Estado |
| `Productos` | ID, Producto, Unidad, Equivalencia, Precio, Activo |

Pestañas heredadas con el mismo formato: `Promotores`, `Usuarios`, `Metas`,
`Notificaciones`, `Competencia`, `Actividad Diaria`, `Retroalimentacion`,
`Confirmación en tienda`, `Capacitacion*`, `AlertasRetro*`.

Sincronización: lectura con caché TTL (5 min, configurable) y upsert en la BD local.

Reglas para carga gradual:
- Sucursal sin Latitud/Longitud válidas, o con `ClienteID` inexistente: se **omite** y
  se registra un warning (id y motivo). No rompe la sincronización.
- `Producto.Activo = NO`: se oculta del formulario; las visitas históricas lo conservan.
- Orden de sincronización: Clientes → Productos → Sucursales.
- Se entregan plantillas CSV por pestaña con encabezados y filas de ejemplo.

## 7. Pantallas y reportes

- "Tiendas" → "Sucursales"; mapa y listas muestran "Cliente – Sucursal".
- Tableros de supervisor y gerente: filtro y agrupación por cliente, además de estado.
- Promotor: el check-out muestra un campo de cantidad por cada producto activo.
- Exportes CSV/Excel y reporte semanal: columnas por producto.
- Huella estimada del cambio rollos/cubetas: ~170 menciones en 19 archivos
  (`PromotoresApp`, `SupervisorDashboard`, `ManagerDashboard`, `dashboardShared`,
  `db.js`, `managerSummary`, `goalsSheet`, `visits.js`, `weeklyReport`, `config.js`,
  `activitySheet`, `sheets.js`, scripts, entre otros).

## 8. Manejo de errores

- Fallo de lectura del Sheet: se usa la última sincronización en caché y se registra el
  error; la app sigue operando.
- Check-in en una sucursal sin coordenadas: no es posible (no existe en la BD).
- Check-out sin ninguna cantidad: se permite con todo en 0, igual que hoy.

## 9. Pruebas

- Backend local con SQLite y datos demo: 2 clientes, 4 sucursales, 3 productos, un
  promotor, un supervisor y un gerente.
- Flujo completo promotor → supervisor → gerente verificado en el navegador.
- `vite build` sin errores.
- Sincronización del Sheet con filas incompletas (sin coordenadas, cliente inexistente,
  producto inactivo): se omiten con warning y el resto se carga.
- Pruebas unitarias de la agregación pura (`managerSummary`, metas por equivalencia).

## 10. Fases de implementación

1. Copia limpia, renombre del proyecto y arranque local.
2. Modelo de datos y backend (`Cliente`, `Sucursal`, `Producto`, `VisitItem`).
3. Sincronización del Sheet y plantillas CSV.
4. Pantallas (promotor, supervisor, gerente) y reportes.
5. Manuales (`README`, `OBJETIVOS`, `MANUAL_DESPLIEGUE`) y variables de entorno.

## 11. Pendientes fuera del código (del usuario)

- Crear el Sheet nuevo y compartirlo con el Service Account.
- Crear repo, servicio y Postgres en Render para este proyecto.
- Entregar el catálogo real de productos y, poco a poco, clientes y sucursales.
