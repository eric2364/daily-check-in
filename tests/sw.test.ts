import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const scope = "https://example.com/diet/";

function worker(failAsset?: string) {
  const handlers: Record<string, (event: any) => void> = {};
  const stored = new Map<string, Response>();
  const cache = {
    put: vi.fn(async (key: string | Request, response: Response) =>
      stored.set(typeof key === "string" ? key : key.url, response),
    ),
    match: vi.fn(async (key: string | Request) =>
      stored.get(typeof key === "string" ? key : key.url)?.clone(),
    ),
  };
  const focus = vi.fn();
  const postMessage = vi.fn();
  const showNotification = vi.fn();
  const fetch = vi.fn(async (request: Request) => {
    if (request.url.endsWith(failAsset || "never-match"))
      throw new Error("Download failed");
    const body =
      request.url === scope
        ? '<script src="/diet/assets/main.js"></script><link href="/diet/assets/main.css">'
        : request.url.endsWith("main.js")
          ? 'import "./chunk.js"; const preload = ["assets/lazy.js"];'
          : request.url.endsWith("main.css")
            ? "@font-face{src:url(./font.woff2)}"
            : "asset";
    return new Response(body);
  });
  const removeCache = vi.fn();
  const claim = vi.fn();
  const openWindow = vi.fn();
  runInNewContext(workerSource, {
    URL,
    Request,
    Response,
    Map,
    Set,
    Promise,
    fetch,
    self: {
      addEventListener: (name: string, callback: (typeof handlers)[string]) =>
        (handlers[name] = callback),
      registration: { scope, showNotification },
      clients: {
        claim,
        matchAll: async () => [{ url: scope, focus, postMessage }],
        openWindow,
      },
    },
    caches: {
      open: async () => cache,
      keys: async () => ["daily-check-in-shell-old", "other-app"],
      delete: removeCache,
    },
  });
  async function dispatch(name: string, event = {}) {
    let pending: Promise<unknown> | undefined;
    handlers[name]({
      ...event,
      waitUntil: (promise: Promise<unknown>) => (pending = promise),
      respondWith: (promise: Promise<unknown>) => (pending = promise),
    });
    return pending;
  }
  return {
    dispatch,
    handlers,
    stored,
    cache,
    fetch,
    focus,
    postMessage,
    showNotification,
    removeCache,
    claim,
    openWindow,
  };
}

describe("offline worker", () => {
  it("precaches app assets and Vite dependencies under the repository subpath", async () => {
    const app = worker();
    await app.dispatch("install");
    expect(app.stored.has(scope)).toBe(true);
    expect(app.stored.has(scope + "assets/chunk.js")).toBe(true);
    expect(app.stored.has(scope + "assets/lazy.js")).toBe(true);
    expect(app.stored.has(scope + "fonts/manrope-latin.woff2")).toBe(true);
    expect(app.stored.has(scope + "assets/font.woff2")).toBe(true);
  });

  it("keeps the current cached shell when a newer deployment is online", async () => {
    const app = worker();
    await app.dispatch("install");
    app.fetch.mockClear();
    const request = { url: scope, method: "GET", mode: "navigate" };
    const response = (await app.dispatch("fetch", { request })) as Response;
    expect(await response.text()).toContain("assets/main.js");
    expect(app.fetch).not.toHaveBeenCalled();
  });

  it("does not replace the document when an installation dependency fails", async () => {
    const app = worker("chunk.js");
    await expect(app.dispatch("install")).rejects.toThrow("Download failed");
    expect(app.stored.has(scope)).toBe(false);
  });

  it("cleans only previous app cache versions during activation", async () => {
    const app = worker();
    await app.dispatch("activate");
    expect(app.removeCache).toHaveBeenCalledWith("daily-check-in-shell-old");
    expect(app.removeCache).not.toHaveBeenCalledWith("other-app");
    expect(app.claim).toHaveBeenCalled();
    expect(workerSource).not.toContain("self.skipWaiting(");
  });

  it("does not cache backend requests or other origins", () => {
    const app = worker();
    const respondWith = vi.fn();
    app.handlers.fetch({
      request: new Request("https://example.com/diet/api/reminders"),
      respondWith,
    });
    app.handlers.fetch({
      request: new Request("https://backend.example.com/private.js"),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it("uses generic notification defaults and always focuses Today", async () => {
    const app = worker();
    await app.dispatch("push", {
      data: {
        json: () => {
          throw new Error("Invalid JSON");
        },
      },
    });
    expect(app.showNotification).toHaveBeenCalledWith(
      "Daily Check-in",
      expect.objectContaining({ data: { url: scope } }),
    );
    const close = vi.fn();
    await app.dispatch("notificationclick", {
      notification: { close, data: { url: "https://external.example/" } },
    });
    expect(close).toHaveBeenCalled();
    expect(app.postMessage).toHaveBeenCalledWith({ type: "OPEN_TODAY" });
    expect(app.focus).toHaveBeenCalled();
    expect(app.openWindow).not.toHaveBeenCalled();
  });
});
