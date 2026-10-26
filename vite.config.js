import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies /api to your backend so that the session cookie
// (HttpOnly, SameSite) is treated as first-party during local development.
const proxy = {
  "/api": {
    target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8080",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { 
    host:true, 
    allowedHost: true, 
    proxy, 
  }, // `npm run dev`
  preview: { proxy }, // `npm run preview` (build de producción + PWA)
});
