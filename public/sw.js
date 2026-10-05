/* Relative paths keep the same worker usable at / and GitHub Pages /repo/. */
const CACHE_NAME = "daily-check-in-shell-__BUILD_VERSION__";
const SCOPE = new URL(self.registration.scope);
const SHELL_URL = new URL("./", SCOPE).href;
const ASSET_EXTENSION = /\.(?:js|css|png|svg|ico|webmanifest|woff2?)$/i;

function isAppAsset(url) {
  return (
    url.origin === SCOPE.origin &&
    url.pathname.startsWith(SCOPE.pathname) &&
    ASSET_EXTENSION.test(url.pathname)
  );
}

async function collectShell() {
  const responses = new Map();
  const shell = await fetch(new Request(SHELL_URL, { cache: "reload" }));
  if (!shell.ok) throw new Error("Unable to download the offline app shell.");
  const html = await shell.clone().text();
  const queue = [
    new URL("manifest.webmanifest", SCOPE).href,
    new URL("icons/apple-touch-icon.png", SCOPE).href,
    new URL("icons/icon-192.png", SCOPE).href,
    new URL("icons/icon-512.png", SCOPE).href,
    new URL("icons/icon-maskable-512.png", SCOPE).href,
    new URL("fonts/dm-sans-latin.woff2", SCOPE).href,
    new URL("fonts/manrope-latin.woff2", SCOPE).href,
  ];
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1], SHELL_URL);
    if (isAppAsset(url)) queue.push(url.href);
  }
  const visited = new Set();
  while (queue.length) {
    const href = queue.shift();
    if (visited.has(href)) continue;
    visited.add(href);
    const response = await fetch(new Request(href, { cache: "reload" }));
    if (!response.ok)
      throw new Error(`Unable to download offline asset: ${href}`);
    responses.set(href, response);
    if (/\.(?:js|css)$/.test(new URL(href).pathname)) {
      const source = await response.clone().text();
      if (new URL(href).pathname.endsWith(".css")) {
        for (const match of source.matchAll(
          /url\(\s*["']?([^"'\s)]+)["']?\s*\)/g,
        )) {
          const url = new URL(match[1], href);
          if (isAppAsset(url)) queue.push(url.href);
        }
      }
      // Covers Vite imports and its dynamic-import preload dependency list.
      for (const match of source.matchAll(
        /["']([^"'\s]+\.(?:js|css|woff2?|png|svg)(?:\?[^"'\s]*)?)["']/g,
      )) {
        const ref = match[1];
        if (!(
          ref.startsWith(".") ||
          ref.startsWith("/") ||
          ref.startsWith("assets/")
        ))
          continue;
        const url = new URL(ref, ref.startsWith("assets/") ? SHELL_URL : href);
        if (isAppAsset(url)) queue.push(url.href);
      }
    }
  }
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    [...responses].map(([url, response]) => cache.put(url, response)),
  );
  // Save the document only when all dependencies are available.
  await cache.put(SHELL_URL, shell);
}

self.addEventListener("install", (event) => {
  event.waitUntil(collectShell());
  // A new worker waits for existing tabs to close; it does not reload unsaved forms.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith("daily-check-in-shell-") && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== SCOPE.origin ||
    !url.pathname.startsWith(SCOPE.pathname)
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        // Serve the shell belonging to this worker, even online. A new deployment
        // gets its own worker/cache and activates only when existing tabs close.
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(SHELL_URL);
        if (cached) return cached;
        return fetch(request);
      })(),
    );
  } else if (isAppAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type !== "opaque")
          await cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* Generic notification covers malformed payloads. */
  }
  event.waitUntil(
    self.registration.showNotification(
      typeof data.title === "string" ? data.title : "Daily Check-in",
      {
        body:
          typeof data.body === "string"
            ? data.body
            : "Take a moment to record your intake and weight today.",
        icon: new URL("icons/icon-192.png", SCOPE).href,
        badge: new URL("icons/icon-192.png", SCOPE).href,
        tag: "daily-check-in-reminder",
        data: { url: SHELL_URL },
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        const url = new URL(client.url);
        if (
          url.origin === SCOPE.origin &&
          url.pathname.startsWith(SCOPE.pathname)
        ) {
          client.postMessage({ type: "OPEN_TODAY" });
          return client.focus();
        }
      }
      // The frontend defaults to Today when opened from a new notification.
      return self.clients.openWindow(SHELL_URL);
    })(),
  );
});
