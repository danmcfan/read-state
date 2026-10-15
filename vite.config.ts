// The site: site/index.html plus React components in site/src/. Files in
// site/public/ (the WASM builds, og.png) are served and copied as they are.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "site",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("site/src", import.meta.url)) } },
  worker: { format: "es" },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2023" },
  server: { port: 3000 },
});
