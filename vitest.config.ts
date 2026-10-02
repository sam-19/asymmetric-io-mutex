import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: [
            {
                // Resolved to source rather than to the sibling package's `dist`, so this suite runs
                // without that package having been built first. The real logger is needed, not a stub:
                // some tests assert that a failure reaches console.error.
                find: /^scoped-event-log$/,
                replacement: fileURLToPath(new URL('../scoped-event-log/src/index.ts', import.meta.url)),
            },
        ],
    },
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'tests/coverage',
        },
    },
})
