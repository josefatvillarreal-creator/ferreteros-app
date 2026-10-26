// ---------------------------------------------------------------------------
// Capa base del mapa: proveedores de teselas con respaldo automático.
// ---------------------------------------------------------------------------
// POR QUÉ NO OpenStreetMap: en producción tile.openstreetmap.org respondió
// 403 "Access blocked — App is not following the tile usage policy" para esta
// app. Ese 403 llega con una IMAGEN (el cartel de bloqueo), que el navegador
// dibuja como si fuera una tesela normal: Leaflet no dispara `tileerror` y no
// hay forma de detectarlo desde el cliente. Por eso OSM ya no está en la lista:
// no se puede usar como respaldo porque no se sabe cuándo falla.
//
// Orden de proveedores (el primero que cargue una tesela gana y se recuerda):
//   1. Proveedor propio, si se define VITE_MAP_TILE_URL en el build (ej. uno
//      con llave y contrato: MapTiler, Mapbox, Stadia, ArcGIS con llave...).
//   2. Esri World Street Map (sin llave).
//   3. CARTO Voyager (sin llave).
// Esri y CARTO son gratuitos pero sin garantía de servicio; para una garantía
// real hay que definir el proveedor propio (ver README, sección "Mapa").
const env = import.meta.env ?? {};

const BUILTIN = [
  {
    id: "esri",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
    maxZoom: 19,
  },
  {
    id: "carto",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    subdomains: "abcd",
    attribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 19,
  },
];

const STORAGE_KEY = "map_tile_provider_v1";

export function getTileProviders() {
  const list = [];
  if (env.VITE_MAP_TILE_URL) {
    list.push({
      id: "custom",
      url: env.VITE_MAP_TILE_URL,
      attribution: env.VITE_MAP_TILE_ATTRIBUTION || "",
      maxZoom: Number(env.VITE_MAP_TILE_MAX_ZOOM) || 19,
    });
  }
  list.push(...BUILTIN);
  // Arranca por el último proveedor que funcionó en este dispositivo.
  try {
    const last = localStorage.getItem(STORAGE_KEY);
    const i = list.findIndex((p) => p.id === last);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  } catch { /* sin storage: se usa el orden por defecto */ }
  return list;
}

function remember(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* noop */ }
}

const FIRST_TILE_TIMEOUT_MS = 8000;
const ERRORS_BEFORE_SWITCH = 4;

// Agrega la capa base al mapa. Si el proveedor actual no entrega ninguna
// tesela (errores de red/HTTP, o nada en 8 s) pasa al siguiente; si ninguno
// funciona llama a `onFail` para que la pantalla muestre su aviso de respaldo.
// Devuelve { destroy }.
export function attachBaseMap(L, map, { onFail } = {}) {
  const providers = getTileProviders();
  let idx = 0;
  let layer = null;
  let timer = null;
  let loaded = 0;
  let errors = 0;
  let finished = false;

  function dropLayer() {
    clearTimeout(timer);
    if (layer) {
      layer.off();
      map.removeLayer(layer);
      layer = null;
    }
  }

  function next() {
    dropLayer();
    idx += 1;
    start();
  }

  function start() {
    if (finished) return;
    if (idx >= providers.length) {
      finished = true;
      if (onFail) onFail();
      return;
    }
    const p = providers[idx];
    loaded = 0;
    errors = 0;
    layer = L.tileLayer(p.url, {
      maxZoom: p.maxZoom,
      subdomains: p.subdomains || "abc",
      attribution: p.attribution,
      referrerPolicy: "origin", // la app manda Referrer-Policy: no-referrer; algunos proveedores piden el origen
    });
    layer.on("tileload", () => {
      loaded += 1;
      if (loaded === 1) {
        clearTimeout(timer);
        remember(p.id);
      }
    });
    layer.on("tileerror", () => {
      errors += 1;
      if (loaded === 0 && errors >= ERRORS_BEFORE_SWITCH) next();
    });
    layer.addTo(map);
    timer = setTimeout(() => { if (loaded === 0) next(); }, FIRST_TILE_TIMEOUT_MS);
  }

  start();
  return {
    destroy() {
      finished = true;
      dropLayer();
    },
  };
}
