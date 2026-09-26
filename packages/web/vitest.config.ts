import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    css: false,
    // jsdom + userEvent tests are wall-clock sensitive when the whole workspace suite runs in
    // parallel on one machine; the default 5 s regularly flakes under that load.
    testTimeout: 30000,
  },
});
