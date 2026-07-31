import path from "node:path";
import babel from "@rolldown/plugin-babel";
import {
  lingui,
  linguiTransformerBabelPreset,
} from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    lingui({ failOnCompileError: true }),
    babel({
      presets: [linguiTransformerBabelPreset()],
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
      "/socket.io": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    setupFiles: ["./src/test-setup.ts"],
  },
});
