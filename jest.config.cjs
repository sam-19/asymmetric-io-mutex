/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    // Use the test tsconfig (build options + Jest ambient types) instead of the build one.
    // isolatedModules = transpile-only: avoids type-checking the cross-package
    // scoped-event-log source (compiled under this package's stricter lib), and is faster.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.spec.json', isolatedModules: true }],
  },
  moduleNameMapper: {
    // scoped-event-log ships as pure ESM, which the CJS Jest runtime can't require().
    // Map it to its TypeScript source so ts-jest compiles the real logger inline (some
    // tests assert that failures route to console.error, so a no-op stub won't do).
    '^scoped-event-log$': '<rootDir>/../scoped-event-log/src/index.ts',
    // The mapped source uses ESM-style './Foo.js' relative imports; strip the extension
    // so the CJS resolver finds the './Foo.ts' source. Test files use no '.js' imports.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
