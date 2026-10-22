import { defineConfig } from 'vitest/config';

// M2b: the parser's former RED tests are GREEN and part of `npm test`. This config only runs those two files
// on their own so the old `test:red` script still works; the lead deletes this file and the script
// (docs/m1/m2b-notes.md).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/parser/fixtures.red.test.ts', 'tests/parser/real-titles.smoke.test.ts'],
  },
});
