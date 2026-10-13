// The site: site/index.html plus Solid components in site/src/. Files in
// site/public/ (the WASM builds, og.png) are served and copied as they are.
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "site",
  plugins: [solid()],
  worker: { format: "es" },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2023" },
  server: { port: 3000 },
});
