const CACHE_NAME = "2025-06-22 03:20";
const urlsToCache = [
  "/tip-tap-notes/",
  "/tip-tap-notes/index.js",
  "/tip-tap-notes/abt.mid",
  "/tip-tap-notes/favicon/favicon.svg",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.7/dist/js/bootstrap.bundle.min.js",
  "https://cdn.jsdelivr.net/combine/npm/tone@14.7.77,npm/@magenta/music@1.23.1/es6/core.js",
  "https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/dist/js-synthesizer.min.js",
  "https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/dist/js-synthesizer.worklet.min.js",
  "https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/externals/libfluidsynth-2.3.0-with-libsndfile.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      );
    }),
  );
});
