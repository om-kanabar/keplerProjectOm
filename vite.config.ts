import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dashboard",
    emptyOutDir: true,
    lib: { entry: "web/src/main.tsx", formats: ["es"], fileName: () => "dashboard.js" },
    rollupOptions: { output: { assetFileNames: "dashboard.css" } },
  },
});
