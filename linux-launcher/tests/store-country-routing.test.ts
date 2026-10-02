import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

test('launcher routes store-country native operations through the persistent handler', () => {
  expect(source).toContain("import { handleNativeOp } from './handlers/index.js';");
  expect(source).toMatch(/op === 'get_store_country'[\s\S]*op === 'set_store_country'/);
  expect(source).toContain('return handleNativeOp');
});
