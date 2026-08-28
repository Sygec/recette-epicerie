import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Proxy /api and /photos to the local Worker during `npm run dev`.
// In production, Pages routes these to the deployed Worker directly.
// A short stamp for the build the browser is actually running. Three separate
// investigations have been spent on a stale service worker serving old code
// while the Worker ran new code — the app reported numbers neither version
// would produce, and nothing on screen said which build was talking. Showing
// it makes that visible in one glance instead of an afternoon.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // Take over as soon as a new build is fetched, rather than waiting for
        // every tab to close. An installed PWA on a phone is rarely "closed",
        // so the default left people running a build from days earlier.
        skipWaiting: true,
        clientsClaim: true,
        // Never serve a cached index.html: it is what pins a client to an old
        // set of hashed assets.
        cleanupOutdatedCaches: true,
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
