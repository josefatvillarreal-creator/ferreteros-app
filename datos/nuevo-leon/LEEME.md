# MVP Nuevo León — carga inicial (2026-10-28)

Fuente: `DISTRIBUIDORES MTY (2).xlsx` (10 distribuidores, solo dirección de matriz).

- `Clientes.csv`, `Sucursales.csv`, `Productos.csv`: listos para pegar en las pestañas del Sheet "BBDD Ferreteros".
- **Sucursales sin coordenadas a propósito.** Sin Latitud/Longitud exactas no hay check-in (radio de 100 m) y la sincronización omite esas filas con aviso. Llena Latitud/Longitud con el punto exacto del negocio (en Google Maps: clic derecho sobre el negocio → clic en las coordenadas para copiarlas).
- `Verificacion-sucursales.csv` (solo local, trae contactos, no se sube a git): enlace de Google Maps por dirección, contacto, teléfono, sucursales adicionales y una referencia OSM a nivel de calle (no sirve para check-in).
- Productos derivados de la columna "MATERIAL"; equivalencia 1 y precio 0 por defecto (las metas están desactivadas).
- La columna "SUCURSALES" del archivo es solo el número de sucursales adicionales (2–5), sin direcciones: se cargarán cuando haya direcciones.

## Actualización 2026-10-29

- **Material:** `Clientes.csv` ahora trae la columna **Material** (lo que vende cada distribuidor). En el Sheet, agrega la columna D "Material" a Clientes (pega `Clientes-columna-Material.tsv` en D1). La app lo muestra en la ventana "Material que vende".
- **Promotores:** los 10 contactos son los promotores (IDs 70100001 a 70100010). `Promotores-para-pegar.tsv` (solo local, tiene nombres y hashes; no va a git) se pega en la pestaña Promotores desde A2. Las contraseñas no se guardan en ningún archivo.
- Correcciones de ortografía hechas al transcribir: "Proveedora" (el archivo decía "Prooveedora") y "Gilberto" (decía "Glberto").
