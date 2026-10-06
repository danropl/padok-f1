import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ścieżki względne, żeby ta sama paczka działała na GitHub Pages (podkatalog) i na dowolnym hostingu.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
