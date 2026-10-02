import type { SteamApi } from './api/api-types';
/** Lightweight identity access: avoid collecting library/inventory for catalog filters. */
export function makeHostAccount(steam: SteamApi) {
  return async (method: string, steamId?: string) => {
    const user = await steam.getCurrentUserAsync(5000);
    if (method === 'getSteamId') return { steamId: user.steamId ?? null };
    if (method === 'getStoreCountry') {
      if (!user.steamId || steamId !== user.steamId) throw new Error('account mismatch');
      return { country: (await steam.getStoreCountry()) ?? null };
    }
    throw new Error('unsupported account method');
  };
}
