import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const target = process.env.VITE_API_URL || "http://localhost:8080";
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: "Gusto's POS",
          short_name: "Gusto's POS",
          theme_color: "#ffffff",
          display: "standalone",
          icons: [
            {
              src: "/icon-192.png",
              sizes: "192x192",
              type: "image/png"
            },
            {
              src: "/icon-512.png",
              sizes: "512x512",
              type: "image/png"
            },
            {
              src: "/logo.png",
              sizes: "425x354",
              type: "image/png"
            }
          ]
        }
      })
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: target.replace(/\/api$/, ""),
          changeOrigin: true,
        },
      },
    },
  };
});
