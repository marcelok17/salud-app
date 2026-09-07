/* Service worker de la app de salud.
   Tres cachés con vidas distintas:
     - CACHE_CONCHA: el HTML, el manifest y los iconos. Se reemplaza entero al subir VERSION.
     - CACHE_FUENTES: Google Fonts (Fraunces / Instrument Sans), para que el diseño no se caiga sin señal.
     - CACHE_DATOS:  las lecturas GET a api.github.com — el último estado conocido del repo.

   Regla dura: las escrituras (PUT de registros, POST de dispatch) NUNCA pasan por caché.
   Regla dura: nada que se guarde lleva el token — se cachea por URL, con cabeceras propias. */

const VERSION = "v19.8.0";
const CACHE_CONCHA  = `salud-concha-${VERSION}`;
const CACHE_FUENTES = "salud-fuentes-v1";
const CACHE_DATOS   = "salud-datos-v1";

const CONCHA = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./iconos/icono.svg",
  "./iconos/icono-192.png",
  "./iconos/icono-512.png",
  "./iconos/icono-maskable-512.png",
  "./iconos/apple-touch-icon-180.png",
];

self.addEventListener("install", ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE_CONCHA);
    // addAll es todo-o-nada; uno por uno tolera que falte un icono suelto.
    await Promise.all(CONCHA.map(u => c.add(new Request(u, {cache: "reload"})).catch(() => {})));
  })());
});

self.addEventListener("activate", ev => {
  ev.waitUntil((async () => {
    const vivas = [CACHE_CONCHA, CACHE_FUENTES, CACHE_DATOS];
    for (const nombre of await caches.keys()) {
      if (!vivas.includes(nombre)) await caches.delete(nombre);
    }
    if (self.registration.navigationPreload) await self.registration.navigationPreload.disable();
    await self.clients.claim();
  })());
});

self.addEventListener("message", ev => {
  if (ev.data && ev.data.tipo === "actualizar") self.skipWaiting();
});

/* Reconstruye una respuesta sin Vary y con sello de tiempo propio.
   GitHub responde con `Vary: Authorization, Accept…`; guardada tal cual, la caché
   nunca volvería a hacer match (la petición de rescate no lleva esas cabeceras). */
async function paraCache(res, marcaOffline) {
  const cuerpo = await res.clone().arrayBuffer();
  const cab = new Headers();
  cab.set("Content-Type", res.headers.get("Content-Type") || "application/json");
  cab.set("X-Salud-Cacheado", String(Date.now()));
  if (marcaOffline) cab.set("X-Salud-Offline", "1");
  return new Response(cuerpo, {status: res.status, statusText: res.statusText, headers: cab});
}

function sinConexion() {
  return new Response(JSON.stringify({error: "sin-conexion"}), {
    status: 504,
    headers: {"Content-Type": "application/json", "X-Salud-Offline": "1"},
  });
}

/* Datos del repo: la red manda; la caché es la red de seguridad. */
async function datos(req) {
  const clave = req.url;
  const cache = await caches.open(CACHE_DATOS);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(clave, await paraCache(res)).catch(() => {});
    // Un 404 real (aún no hay registro de ese día) es información: se deja pasar sin cachear.
    return res;
  } catch (e) {
    const guardada = await cache.match(clave, {ignoreVary: true});
    if (guardada) {
      const cab = new Headers(guardada.headers);
      cab.set("X-Salud-Offline", "1");
      return new Response(await guardada.arrayBuffer(), {status: guardada.status, headers: cab});
    }
    return sinConexion();
  }
}

/* Concha y fuentes: la caché manda para que abra al instante; se refresca por detrás. */
async function cacheYRefresca(req, nombreCache) {
  const cache = await caches.open(nombreCache);
  const guardada = await cache.match(req, {ignoreVary: true});
  const enRed = fetch(req).then(res => {
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return guardada || (await enRed) || sinConexion();
}

/* Abrir la app: si hay red, la última versión; si no, la que quedó guardada. */
async function navegacion(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_CONCHA);
    cache.put("./index.html", res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const cache = await caches.open(CACHE_CONCHA);
    return (await cache.match("./index.html", {ignoreVary: true}))
        || (await cache.match("./", {ignoreVary: true}))
        || sinConexion();
  }
}

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;                 // registrar y despertar al agente: siempre en vivo
  const url = new URL(req.url);

  if (req.mode === "navigate")            return ev.respondWith(navegacion(req));
  if (url.hostname === "api.github.com")  return ev.respondWith(datos(req));
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com")
                                          return ev.respondWith(cacheYRefresca(req, CACHE_FUENTES));
  if (url.origin === self.location.origin) return ev.respondWith(cacheYRefresca(req, CACHE_CONCHA));
});
