import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      src: resolve(import.meta.dirname, "src"),
      shared: resolve(import.meta.dirname, "shared"),
    },
  },
  build: { outDir: "build", emptyOutDir: true },
});
