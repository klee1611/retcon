import path from "node:path"
import react from "@vitejs/plugin-react"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  // Fold the flag at build time so the mock is tree-shaken from builds without VITE_MOCK_API=1.
  define: {
    "import.meta.env.VITE_MOCK_API": JSON.stringify(process.env.VITE_MOCK_API === "1" ? "1" : "0"),
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    proxy: { "/api": "http://localhost:8000" },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
})
