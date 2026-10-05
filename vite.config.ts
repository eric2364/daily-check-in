import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Public files are copied by Vite. Version the copied worker after every build so
// a changed app shell installs in a separate cache and waits for existing tabs.
function versionServiceWorker(): Plugin {
  let outDir = "";
  return {
    name: "version-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const workerPath = resolve(outDir, "sw.js");
      const worker = await readFile(workerPath, "utf8");
      const hash = createHash("sha256").update(worker);
      async function hashDirectory(directory: string) {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) await hashDirectory(path);
          else if (path !== workerPath) {
            hash.update(path.slice(outDir.length));
            hash.update(await readFile(path));
          }
        }
      }
      await hashDirectory(outDir);
      const version = hash.digest("hex").slice(0, 20);
      await writeFile(workerPath, worker.replace("__BUILD_VERSION__", version));
    },
  };
}

export default defineConfig({
  plugins: [react(), versionServiceWorker()],
  base: process.env.VITE_BASE_PATH || "./",
});
