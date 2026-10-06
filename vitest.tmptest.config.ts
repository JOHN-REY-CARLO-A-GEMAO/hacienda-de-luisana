import { defineConfig } from "vitest/config"
export default defineConfig({
  envDir: "test/phase0/empty-env",
  test: {
    fileParallelism: false, maxWorkers: 1, environment: "node", globals: true,
    include: ["test/phase0/emulator/auth-review.characterization.test.ts"],
  },
})
