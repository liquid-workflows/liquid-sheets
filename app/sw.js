/* Offline-first service worker. Caches the app shell so a draft survives dead
 * ballroom wifi (non-negotiable constraint #4). Bump CACHE on any shell change.
 * Same-origin shell files are served cache-first; everything else (the user's
 * own Sleeper/import fetches, and any self-host copilot server) goes to the
 * network and is never cached. */

const CACHE = "liquid-sheets-v56";
/* copilot.js is deliberately NOT precached: the hosted build (config.AI_ENDPOINT
 * null) never imports it, so shipping it in the shell would cache an AI module
 * the app never runs. A self-hoster who sets AI_ENDPOINT gets it via the runtime
 * dynamic import() in app.js, which the network handler below serves and caches
 * on demand. This keeps the hosted cache genuinely AI-free. */
const SHELL = [
  "/app/",
  "/app/index.html",
  "/app/app.js",
  "/app/config.js",
  "/app/plan.js",
  "/app/storage.js",
  "/app/importers.js",
  "/app/draft.js",
  "/app/sleeper.js",
  "/app/prior_2026.js",
  "/engine/engine.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never cache cross-origin
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match("/app/index.html"))));
});
