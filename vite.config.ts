import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub project pages are served from /<repo-name>/.
// This repo is "Mesh", so assets must resolve under /Mesh/.
// Override with VITE_BASE (e.g. "/" for a custom domain) at build time.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/Mesh/",
  plugins: [react()],
  build: {
    target: "es2022",
    // Keep heavy CV/ML libraries in their own lazily-loaded chunks so the
    // hub page stays light. Each demo dynamic-imports what it needs.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          mediapipe: ["@mediapipe/tasks-vision"],
        },
      },
    },
  },
});
