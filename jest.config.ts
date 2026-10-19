import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/fixtures/**'],
  coverageThreshold: {
    // Jest applies `global` to every covered file NOT matched by another
    // key, so the zero-valued `./src/react/` entry carves the R3F layer out
    // and `global` ends up gating the pure core (`src/*.ts`) on its own.
    // TODO: give `./src/react/` real numbers once it has broader tests.
    global: { lines: 98, statements: 98, functions: 98, branches: 90 },
    './src/react/': { lines: 0, statements: 0, functions: 0, branches: 0 },
  },
  passWithNoTests: true,
}

export default config
