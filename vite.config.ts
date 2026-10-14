import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
  },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
