import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Configuration for the opt-in live provider tests: `npm run test:live`.
 *
 * A second configuration rather than a wider `include` in `vitest.config.mts`, so
 * that a test which calls a paid API cannot be reached by `npm test` even by
 * accident: the default suite scans `src/` only, and these tests live outside it
 * (`spec/TESTING.md` section 5).
 *
 * The tests here still refuse to run unless `STUDYBENCH_LIVE_AI_TESTS=1` is set, so
 * running this configuration without asking for it reports skipped tests rather than
 * spending money. Nothing in `tests/live` is a required gate for a milestone.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Node rather than jsdom: these exercise an AWS SDK client, not a component.
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    // A model call is slower than a unit test's budget allows.
    testTimeout: 120_000,
    css: false,
  },
});
