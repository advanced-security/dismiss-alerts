module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      diagnostics: {
        // Ignore TS151002: hybrid module kind warning for NodeNext with ts-jest
        ignoreCodes: [151002]
      }
    }]
  },
  verbose: true
}