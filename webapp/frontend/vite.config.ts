import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": { target: "http://127.0.0.1:11056", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:11056", changeOrigin: true },
      "/mcp": { target: "http://127.0.0.1:11056", changeOrigin: true },
    },
  },
});
