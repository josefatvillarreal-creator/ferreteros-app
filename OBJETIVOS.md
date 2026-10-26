# Objetivos — App Promotores

> Última revisión: 15-oct-2026, contra el código de la rama `pruebas`
> (commit `dbb14d3`).

## Objetivo general

Dar visibilidad **en tiempo real** de la operación de los promotores de campo
de Protexa — dónde están, qué venden, cómo va cada uno contra su meta, y qué
está haciendo la competencia — para que supervisores y gerencia puedan actuar
sobre datos del día, no sobre reportes que llegan días después.

## Objetivos por rol

### Promotor (campo)

- Registrar sus visitas (check-in/out) de forma confiable: con foto de
  evidencia y ubicación **validada por el servidor** (no por el teléfono, que
  se puede falsificar).
- Confirmar que sigue en la tienda: una vez al día, en un momento aleatorio
  entre 10 am y 4 pm (solo con un check-in abierto), la app le pregunta Sí/No
  y guarda su ubicación del momento.
- Ver su propio avance hacia su **meta semanal** de ventas, con
  retroalimentación que motive (niveles Bronce/Plata/Oro), sin depender de que
  alguien más se lo reporte.
- Reportar acciones de la competencia (marca, qué observó, evidencia
  fotográfica) sin fricción, desde el celular.
- Reportar un problema ("algo no funciona") y **darle seguimiento**: ve sus
  tickets, lee la respuesta de administración, puede comentar y ve cuándo se
  cierra.
- Capacitarse desde la app: secciones de **Capacitación** (cómo hacer mejor el
  trabajo) y **Soporte** (información técnica de producto), con quiz y
  tarjetas de repaso; su progreso queda guardado.
- Seguir funcionando sin señal (zonas sin cobertura), sin perder registros ni
  exponer datos sensibles en el dispositivo.
- Poder pedir una contraseña nueva si la olvida, sin depender de encontrar a
  alguien de TI — el aviso le llega directo a su supervisor.

### Supervisor

- Ver, en tiempo real, **únicamente** a los promotores que tiene a su cargo —
  no la operación completa del país.
- Enterarse de inmediato cuándo uno de sus promotores hace check-in (en qué
  tienda y si llegó a tiempo o tarde, con 15 min de tolerancia sobre su hora de
  entrada) y cuándo alcanza su meta, sin tener que revisarlo a mano.
- Cerrar el día con el mismo tipo de resumen que usa gerencia, acotado a su
  equipo, y recibir el **reporte semanal** de KPIs de su equipo.
- Revisar lo que sus promotores reportan de la competencia, sin abrir el Sheet.
- Hablar con administración en un **hilo propio** (estilo foro, no chat en
  vivo) para dudas y seguimiento.
- Levantar un reporte cuando nota un comportamiento extraño en el historial de
  uno de los suyos (ej. checkout casi inmediato al check-in).
- Enterarse cuando uno de sus promotores pide recuperar su cuenta, para
  asignarle una contraseña nueva.

### Gerente / Administrador

- Visibilidad nacional en tiempo real: quién está activo, qué vendió cada uno,
  quién todavía no ha vendido, asistencia y puntualidad — con filtros de fecha
  (incluye períodos anteriores: ayer, semana/mes/año pasado, y rango
  personalizado) y por estado del país.
- Fijar y ajustar la meta semanal de cualquier promotor directamente desde el
  tablero, sin depender de una hoja de cálculo aparte.
- Detectar oportunidades y riesgos rápido: Top 5 vendedores del día, tiendas
  que alcanzan su meta, y un clic en cualquier indicador para ver en el mapa
  exactamente a quién representa.
- Exportar la información (CSV/Excel, incluye el ID de la tienda) para reportes
  o análisis fuera de la app, también por supervisor.
- Poder auditar a cualquier promotor: su historial de visitas agrupado por
  día, quién lo supervisa, a qué tiendas suele ir, y reportar un
  comportamiento extraño puntual si lo nota.
- Revisar los reportes de Competencia (marca, descripción, fotos) que
  capturan los promotores, sin abrir el Sheet.
- Atender el **buzón** de tickets de los promotores (responder, cerrar y
  reabrir) y los hilos de cada supervisor.
- Administrar desde el tablero las **alertas de retroalimentación** (correo +
  push): encenderlas/apagarlas y agregar o quitar destinatarios.

## Objetivos de mejora (roadmap)

Dos mejoras técnicas nuevas, ordenadas por prioridad. Describen el resultado
esperado, no la implementación; el diseño se define al empezar cada una.

### 1. Reemplazar el mapa que falla en producción

**Problema.** El mapa actual (Leaflet con teselas de OpenStreetMap, ambos
cargados desde un CDN: `dashboardShared.jsx` en los tableros y
`PromotoresApp.jsx` en la app del promotor) falla en producción. *Causa confirmada
(15-oct-2026, captura del tablero de admin):* el servidor público de teselas de
OpenStreetMap responde **403 "Access blocked — App is not following the tile
usage policy"** para esta app. Ese 403 llega como una imagen (el cartel de
bloqueo), que el navegador dibuja como si fuera una tesela normal, por eso el
mapa se ve lleno de carteles amarillos y negros y el aviso de respaldo nunca
aparecía. Además, Leaflet se descargaba de un CDN externo, que depende de que la
red del celular o de la oficina lo deje pasar, y el service worker guardaba las
teselas de otros dominios para siempre y sin límite.

**Objetivo.** Un mapa que cargue de forma confiable en producción, en el
tablero de gerente/supervisor y en la pantalla de tiendas cercanas del
promotor, sin depender de un servidor gratuito sin garantía de servicio.

**Cómo sabremos que se logró:**
- El mapa carga en producción en las redes y dispositivos que usa el equipo
  (datos móviles, Wi-Fi de oficina, gama baja), sin mostrar el aviso de respaldo.
- Se conservan los marcadores, el filtro por segmento y el clic en un KPI que
  resalta a los promotores en el mapa.
- Si el proveedor falla, la app sigue funcionando con el listado y degrada el
  mapa sin romper la pantalla.
- Costo y límites de uso del proveedor documentados, y la llave (si se
  requiere) fuera del código.

**Estado (15-oct-2026): implementado en la rama local `feature/mapa-camara`,
pendiente de probar en producción.** Leaflet ahora viaja dentro del build
(chunk aparte, solo se descarga al abrir un mapa); OpenStreetMap salió de la
lista; las teselas vienen de Esri y, si no responde, de CARTO, con aviso de
respaldo y botón "Reintentar" si ninguna carga; el service worker ya no toca
dominios ajenos. Detalle en README, sección "Mapa".

**A definir con el negocio:** esos dos proveedores son gratuitos y **sin
garantía de servicio**. Para una garantía real hay que contratar uno con llave
(MapTiler, Mapbox, Stadia, ArcGIS...) y definir `VITE_MAP_TILE_URL` en Render;
el código ya lo soporta sin cambios.

### 2. Cámara nativa de la app, para celulares de gama baja

**Problema.** La foto de check-in y las de Competencia se toman con el
selector de archivos del sistema (`<input type="file" capture>`), que abre la
app de cámara del teléfono. En equipos de gama baja eso consume mucha memoria,
puede cerrar o recargar la app mientras el promotor toma la foto, y la imagen
llega en resolución completa y hay que reducirla después (ya hay un parche de
memoria en `PromotoresApp.jsx`, commits `86eb337` y `5c4eb60`).

**Objetivo.** Una cámara integrada a la app que capture directamente a un
tamaño y calidad ya reducidos, para que cualquier promotor pueda subir su foto
de evidencia sin importar su teléfono.

**Cómo sabremos que se logró:**
- La foto de check-in y las de Competencia se toman dentro de la app, sin
  salir a la cámara del sistema.
- Se captura ya reducida (resolución y peso objetivo definidos), sin pasar por
  la imagen en resolución completa.
- Funciona sin señal: la foto entra a la cola offline cifrada que ya existe y
  se sincroniza al reconectar.
- Si el navegador niega el permiso o no soporta la cámara integrada, queda
  la opción actual como respaldo, para que nadie se quede sin poder registrar
  su visita.
- Se prueba en al menos un teléfono de gama baja representativo del equipo.

**Estado (15-oct-2026): implementado en la rama local `feature/mapa-camara`,
falta probarlo en teléfonos reales.** Cámara integrada (`CameraCapture.jsx`)
en la foto de check-in y en Competencia (varias fotos seguidas), con la cámara
del sistema como respaldo y un botón para usar la **cámara frontal** (la foto
se guarda sin invertir y por el mismo camino que las demás). Probada en un navegador con una cámara simulada
(captura reducida, permiso denegado, varias fotos, liberación de la cámara);
**no se ha probado con una cámara real ni en un teléfono de gama baja**.

**A definir:** el peso máximo por foto (hoy se fija por resolución y calidad
según el nivel del equipo: de 700 a 1,280 px) y si se agrega una marca de agua
con fecha, hora y ubicación (refuerza la evidencia de que la foto se tomó en la
tienda).

#### 2.1 Diagnóstico del dispositivo y la red (base para mejoras futuras)

Ligado al anterior: medir las condiciones reales de cada teléfono para
adaptar la app y entender por qué falla en campo.

- **Qué medir:** tipo y calidad de conexión (Wi-Fi, 4G, 3G, modo ahorro de
  datos), memoria del dispositivo, memoria usada por la app, núcleos de CPU,
  versión de sistema y navegador, y cuánto tardan la captura, el
  procesamiento y la subida de cada foto. Se apoya en las capacidades que
  exponga el navegador; no todas existen en todos los equipos y en iPhone
  son limitadas.
- **Qué hacer con eso:**
  1. *Adaptar automáticamente:* elegir la resolución y la calidad de la foto
     según el equipo y la red (menos pixeles y más compresión en gama baja o
     conexión lenta), y diferir la subida a una red mejor.
  2. *Detectar fallas antes de que ocurran:* avisar al promotor y registrar el
     problema cuando la memoria es crítica o la subida falla repetidamente.
  3. *Informar a gerencia:* un resumen de qué dispositivos y redes presentan
     más problemas, para decidir mejoras con datos.
- **Privacidad:** se guardan solo métricas técnicas del equipo, sin contenido
  personal, y se documenta qué se recolecta. Se confirma con el negocio antes
  de activarlo.
- **Estado (15-oct-2026): primera versión implementada en la rama local
  `feature/mapa-camara`.** Detecta nivel del equipo (gama baja/media/alta) y
  calidad de la red, ajusta resolución y calidad de la foto y los parámetros
  de la cámara, guarda localmente las últimas 20 fotos (tiempo, peso, fallas),
  muestra todo en Perfil → "Diagnóstico de mi teléfono" y adjunta un resumen
  de una línea a cada reporte de problema (ticket). **Todo se queda en el
  teléfono**: aún no hay envío automático al servidor ni resumen para gerencia
  (punto 3), y falta el aviso proactivo al promotor cuando la memoria es
  crítica (parte del punto 2; hoy las fallas repetidas solo bajan la calidad
  de las fotos siguientes).

## Qué mide la app hoy

- **Actividad**: check-in/out por tienda y por día (hora, ubicación validada,
  foto), y confirmaciones de "sigo en tienda".
- **Asistencia y puntualidad**: contra la hora de "Entrada" de cada promotor
  (en su zona horaria), con 15 min de tolerancia.
- **Ventas**: rollos y cubetas vendidos por visita, acumulados por promotor y
  por tienda (los galones ya no se usan en ningún flujo).
- **Metas**: unidades-equivalentes vendidas (rollos + cubetas ponderadas)
  contra una **meta semanal**, por promotor y por tienda. Sin meta
  personalizada se usa el default de 30 unidades por semana.
- **Inteligencia de competencia**: reportes cualitativos (marca, descripción,
  fotos) capturados por los propios promotores en campo, con un panel para
  que gerencia/supervisor los revise sin abrir el Sheet.
- **Comportamiento**: gerencia/supervisor pueden dejar un reporte sobre una
  visita puntual del historial de un promotor cuando notan algo extraño.
- **Capacitación**: progreso de cada persona en quiz y tarjetas de repaso.

## Pendiente de definir con el negocio

Esto **no** son decisiones técnicas — son datos/reglas que le corresponden al
negocio, no al código:

- **Precios reales** de rollo y cubeta (`PRECIO_ROLLO` / `PRECIO_CUBETA`): el
  código los lee de variables de entorno con default `0`; sin ellos, los
  tableros muestran unidades en vez de dinero vendido. *Verificar en Render
  qué valor tienen hoy.*
- **Metas de venta reales** por promotor y por tienda: el script
  `seed-promoter-goals.mjs` siembra un valor de **prueba** para quien no tenga
  meta (la versión anterior de este documento hablaba de 40 unidades). Hay que
  revisar la pestaña "Metas" del Sheet y sustituir esos valores por las metas
  reales (pestaña "Metas" o botón "Meta" del tablero de admin). Definir
  también si el default de 30 por semana sigue siendo el correcto.
- **Contenido de Capacitación y Soporte**: las pestañas `Capacitacion`,
  `Capacitacion_Quiz` y `Capacitacion_Flashcards` se crean solas pero vacías;
  sin contenido, la sección muestra "todavía no hay contenido". Lo redacta el
  negocio.
- **Alertas de retroalimentación**: quién debe recibir el correo y el push
  (pestaña `AlertasRetroDestinatarios`, tema de ntfy.sh) y si se encienden
  (`Activo = SI`). Requiere además instalar el Google Apps Script descrito en
  MANUAL_DESPLIEGUE.md.
- **Correo del reporte semanal**: sin `SMTP_HOST/USER/PASS` el reporte semanal
  solo llega dentro de la app. Falta definir la cuenta que lo enviará.
- Si los reportes de competencia necesitan un flujo de seguimiento (¿alguien
  los debe marcar como "revisado"?) — hoy hay un panel para verlos, pero es
  de **solo lectura**, sin ese estado.
- La columna **ESTADO** de las pestañas "Promotores" y "Tiendas": el filtro de
  estado del tablero ya lista los 32 estados de México, pero si esa columna no
  está capturada, la actividad cae en "Sin estado" — es captura de datos, no
  una limitación del código.
- Qué pasa con los reportes de "comportamiento extraño" después de
  levantarse: siguen en la pestaña `Retroalimentacion`, sin flujo de
  seguimiento/cierre propio. (Los tickets con estado abierto/cerrado cubren
  los reportes que hacen los promotores, no estos.)

## Fuera de alcance (por decisión, no por limitación técnica)

- **Notificaciones push reales al sistema operativo** para el resto de los
  avisos: se decidió un centro de notificaciones dentro de la app (campana).
  La única excepción es el push vía ntfy.sh de las alertas de
  retroalimentación.
- **Chat en vivo**: los hilos de supervisor↔administración y de tickets son
  estilo foro (se cargan al abrir y con el botón "Actualizar").
- **Asignación fija de tiendas por promotor**: el catálogo es global; qué
  tiendas ve cada promotor se calcula por cercanía GPS en tiempo real, no por
  una relación fija en la base de datos.
- **Reportes automáticos programados con hora fija**: la exportación
  (CSV/Excel) es manual; el reporte semanal se dispara cuando alguien abre la
  campana después de cumplirse la semana, no a una hora fija.
