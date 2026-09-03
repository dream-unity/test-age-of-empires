import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const pages = process.env.GITHUB_PAGES === "1";
const rootDir = dirname(fileURLToPath(import.meta.url));

function spaFallback(): Plugin {
  return {
    name: "spa-fallback",
    closeBundle() {
      const index = resolve(rootDir, "dist/index.html");
      if (existsSync(index)) {
        copyFileSync(index, resolve(rootDir, "dist/404.html"));
        writeFileSync(resolve(rootDir, "dist/.nojekyll"), "");
      }
    },
  };
}

export default defineConfig({
  base: pages ? "/test-age-of-empires/" : "/",
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: {
    alias: { "@": resolve(rootDir, "src") },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "www/game-[hash].js",
        chunkFileNames: "www/[name]-[hash].js",
        assetFileNames: (info) => {
          const name = info.names?.[0] ?? info.name ?? "";
          if (name.endsWith(".css")) return "www/game-[hash][extname]";
          return "www/[name]-[hash][extname]";
        },
      },
    },
  },
  plugins: [tailwindcss(), react(), spaFallback()],
});
