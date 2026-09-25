/**
 * Vitest configuration.
 * File path: /vitest.config.ts
 *
 * Unit tests live next to the code they test (`*.test.ts`) and under
 * /test. The geometry fixtures (customer DXFs) are read from
 * /test/fixtures. Node environment only — the engines are pure TS.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "test/**/*.test.ts", "content/**/*.test.ts"],
    reporters: "default",
  },
});
