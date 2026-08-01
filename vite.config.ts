import path from "node:path";
import babel from "@rolldown/plugin-babel";
import {
  lingui,
  linguiTransformerBabelPreset,
} from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const productionOnlyScriptPattern =
  /(?:\r?\n)?\s*<script\b[^>]*\bdata-production-only\b[^>]*>[\s\S]*?<\/script>/g;

export default defineConfig({
  plugins: [
    {
      name: "production-only-scripts",
      transformIndexHtml(html, context) {
        if (context.server) {
          return html.replace(productionOnlyScriptPattern, "");
        }
        return html.replace(/\sdata-production-only(?=[\s>])/g, "");
      },
    },
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
    alias: [
      {
        find: /^@\/data\/players$/,
        replacement: path.resolve(
          import.meta.dirname,
          "./src/data/players-test-support.ts",
        ),
      },
    ],
    setupFiles: ["./src/test-setup.ts"],
  },
});
