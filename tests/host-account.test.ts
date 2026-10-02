import { test, expect } from 'bun:test';
import { makeHostAccount } from '../src/host-account';
test('identity and region are scoped to current Steam account', async () => {
  const host = makeHostAccount({
    getCurrentUserAsync: async () => ({ steamId: '76561198000000000' }),
    getStoreCountry: async () => 'KZ',
  } as any);
  expect(await host('getSteamId')).toEqual({ steamId: '76561198000000000' });
  expect(await host('getStoreCountry', '76561198000000000')).toEqual({
    country: 'KZ',
  });
  await expect(host('getStoreCountry', '76561198000000001')).rejects.toThrow('account mismatch');
});
