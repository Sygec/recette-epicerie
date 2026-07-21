import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Proxy /api and /photos to the local Worker during `npm run dev`.
// In production, Pages routes these to the deployed Worker directly.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Recettes & Courses",
        short_name: "Recettes",
        description: "Catalogue de recettes et liste de courses",
        theme_color: "#4B6154",
        background_color: "#F1EEE4",
        display: "standalone",
        icons: [],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/photos": "http://localhost:8787",
    },
  },
});
