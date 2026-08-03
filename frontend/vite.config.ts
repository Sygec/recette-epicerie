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
      workbox: {
        // pdf.js is only pulled in when someone imports a PDF, and between the
        // library and its worker it dwarfs the rest of the app. Precaching it
        // would make every install pay for a feature most visits never touch,
        // so it stays a network fetch at the moment it's needed.
        globIgnores: ["**/pdf-*.js", "**/pdf.worker*.mjs"],
      },
      manifest: {
        name: "Recettes & Courses",
        short_name: "Recettes",
        description: "Catalogue de recettes et liste de courses",
        theme_color: "#4B6154",
        background_color: "#F1EEE4",
        display: "standalone",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
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
