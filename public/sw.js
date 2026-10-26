// Service worker mínimo para que la app sea instalable (PWA) y funcione el
// "shell" sin conexión. NO intercepta /api (esas peticiones van siempre a la
// red; la lógica offline de visitas ya la maneja la app con IndexedDB cifrado).
const CACHE = "promotores-shell-v4";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // No tocar peticiones a la API ni métodos que cambian estado.
  if (req.method !== "GET" || url.pathname.startsWith("/api")) return;
  // Solo recursos PROPIOS. Las teselas del mapa (y cualquier otro dominio) las
  // maneja el navegador: antes se cacheaban aquí para siempre y sin límite
  // (respuestas opacas, incluso las que fallaron), lo que llenaba el almacenamiento
  // de los teléfonos de gama baja y dejaba el mapa roto aunque el proveedor volviera.
  if (url.origin !== self.location.origin) return;

  // Navegaciones: red primero, con fallback al shell cacheado (offline).
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }

  // Recursos estáticos: cache primero, luego red (y se cachea la respuesta).
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
          .catch(() => cached)
    )
  );
});
