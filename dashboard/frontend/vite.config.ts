import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env["VITE_API_PROXY"] ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/auth": { target: api, changeOrigin: false },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
