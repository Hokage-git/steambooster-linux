import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let testHome = '';
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  testHome = mkdtempSync(join(tmpdir(), 'steambooster-country-'));
  process.env.HOME = testHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

async function freshHandler() {
  return await import(`../src/handlers/index.ts?test=${Date.now()}-${Math.random()}`);
}

test('set_store_country persists a country returned by get_store_country', async () => {
  const { handleNativeOp } = await freshHandler();
  const steamId = '76561199300265728';

  expect(handleNativeOp({ op: 'set_store_country', args: { steamId, country: 'RU' } }))
    .toEqual({ ok: true, result: null });
  expect(handleNativeOp({ op: 'get_store_country', args: { steamId } }))
    .toEqual({ ok: true, result: { country: 'RU' } });
});

test('store country is isolated per Steam account and missing values return null', async () => {
  const { handleNativeOp } = await freshHandler();
  expect(handleNativeOp({ op: 'set_store_country', args: { steamId: '76561198000000001', country: 'KZ' } }).ok).toBe(true);
  expect(handleNativeOp({ op: 'get_store_country', args: { steamId: '76561198000000002' } }))
    .toEqual({ ok: true, result: { country: null } });
});

test('store country rejects malformed account and country values', async () => {
  const { handleNativeOp } = await freshHandler();
  expect(handleNativeOp({ op: 'set_store_country', args: { steamId: '../escape', country: 'RU' } }).ok).toBe(false);
  expect(handleNativeOp({ op: 'set_store_country', args: { steamId: '76561198000000001', country: 'Russia' } }).ok).toBe(false);
  expect(handleNativeOp({ op: 'set_store_country', args: { steamId: '76561198000000001', country: 'r\n' } }).ok).toBe(false);
  expect(handleNativeOp({ op: 'get_store_country', args: { steamId: '' } }).ok).toBe(false);
});
