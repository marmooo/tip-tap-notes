var CACHE_NAME="2023-01-19 22:15",urlsToCache=["/tip-tap-notes/","/tip-tap-notes/index.js","/tip-tap-notes/abt.mid","/tip-tap-notes/favicon/favicon.svg","https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/css/bootstrap.min.css","https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/js/bootstrap.bundle.min.js","https://cdn.jsdelivr.net/combine/npm/tone@14.7.77,npm/@magenta/music@1.23.1/es6/core.js"];self.addEventListener("install",function(a){a.waitUntil(caches.open(CACHE_NAME).then(function(a){return a.addAll(urlsToCache)}))}),self.addEventListener("fetch",function(a){a.respondWith(caches.match(a.request).then(function(b){return b||fetch(a.request)}))}),self.addEventListener("activate",function(a){var b=[CACHE_NAME];a.waitUntil(caches.keys().then(function(a){return Promise.all(a.map(function(a){if(b.indexOf(a)===-1)return caches.delete(a)}))}))})