/**
 * Minimal Service Worker for cross-origin isolation (COOP / COEP).
 * No caching — only rewrites response headers so SharedArrayBuffer /
 * wasm-threaded-simd (midy) can run on GitHub Pages.
 */
const COOP = "same-origin";
// credentialless is more compatible with third-party scripts (gtag, ads, CDNs)
// while still enabling SharedArrayBuffer in modern browsers.
const COEP = "credentialless";

self.addEventListener("install", (event) => {
  // Activate immediately on first register / update.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Only same-origin navigations and same-origin resources.
  // Cross-origin requests are left to the browser (CORS / CORP handled by CDNs).
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      const response = await fetch(event.request);
      // Opaque / error responses cannot be rewritten.
      if (!response || response.type === "opaque" || response.status === 0) {
        return response;
      }

      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", COOP);
      headers.set("Cross-Origin-Embedder-Policy", COEP);
      // Help same-origin resources be embeddable under COEP.
      if (!headers.has("Cross-Origin-Resource-Policy")) {
        headers.set("Cross-Origin-Resource-Policy", "same-origin");
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })(),
  );
});
