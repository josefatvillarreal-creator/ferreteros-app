# MVP Nuevo León — carga inicial (2026-10-28)

Fuente: `DISTRIBUIDORES MTY (2).xlsx` (10 distribuidores, solo dirección de matriz).

- `Clientes.csv`, `Sucursales.csv`, `Productos.csv`: listos para pegar en las pestañas del Sheet "BBDD Ferreteros".
- **Sucursales sin coordenadas a propósito.** Sin Latitud/Longitud exactas no hay check-in (radio de 100 m) y la sincronización omite esas filas con aviso. Llena Latitud/Longitud con el punto exacto del negocio (en Google Maps: clic derecho sobre el negocio → clic en las coordenadas para copiarlas).
- `Verificacion-sucursales.csv` (solo local, trae contactos, no se sube a git): enlace de Google Maps por dirección, contacto, teléfono, sucursales adicionales y una referencia OSM a nivel de calle (no sirve para check-in).
- Productos derivados de la columna "MATERIAL"; equivalencia 1 y precio 0 por defecto (las metas están desactivadas).
- La columna "SUCURSALES" del archivo es solo el número de sucursales adicionales (2–5), sin direcciones: se cargarán cuando haya direcciones.
