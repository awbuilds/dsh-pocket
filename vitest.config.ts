import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/dsh-pocket/test/**/*.spec.ts', 'packages/dsh-pocket/test/**/*.spec.tsx'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Each gateway test binds an ephemeral loopback port; serial files keep logs readable.
    fileParallelism: true,
    pool: 'forks',
  },
})
