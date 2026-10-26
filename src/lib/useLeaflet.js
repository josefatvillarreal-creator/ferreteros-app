// ---------------------------------------------------------------------------
// Carga de Leaflet empaquetado con la app (ya no desde un CDN externo).
// ---------------------------------------------------------------------------
// Antes Leaflet se inyectaba como <script> desde unpkg.com: si la red del
// teléfono u oficina bloqueaba ese dominio, el mapa no aparecía. Ahora viaja
// dentro del propio build (Vite lo separa en un chunk que solo se descarga al
// abrir un mapa) y el service worker lo cachea como cualquier archivo propio.
import { useEffect, useState } from "react";

let pending = null;

export function loadLeaflet() {
  if (!pending) {
    pending = Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(([mod]) => mod.default ?? mod)
      .catch((err) => {
        pending = null; // permite reintentar (p. ej. el chunk no llegó sin red)
        throw err;
      });
  }
  return pending;
}

// { L, failed }: L es null mientras carga; failed = no se pudo cargar el chunk.
export function useLeaflet(retryKey = 0) {
  const [L, setL] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    loadLeaflet().then(
      (lib) => alive && setL(lib),
      () => alive && setFailed(true),
    );
    return () => { alive = false; };
  }, [retryKey]);
  return { L, failed };
}
