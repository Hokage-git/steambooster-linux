// Direct sb.net fetch of the steam-keys list — mirrors booster-checkout's
// main/keys-fetch.ts::fetchKeys byte-for-byte (same endpoint, same query
// shape, same never-throw contract). Used by lib/keys-client.ts's requestKeys
// when checkout has broadcast a usable paymentId (lib/keys-config.ts);
// otherwise the bus round-trip (requestKeysViaBus) stays the source of truth.
import type { SbApi } from '@steambalance/booster-framework/api-types';
import { STEAM_KEYS_API } from '../urls';
import { toKeyItem, type KeyItem } from './keys-api';

export async function fetchKeysDirect(
  sb: SbApi,
  args: { appid: number; paymentId: string; storeCountry?: string | null },
  signal?: AbortSignal,
): Promise<KeyItem[]> {
  try {
    const q = new URLSearchParams({ paymentId: args.paymentId, appid: String(args.appid) });
    if (args.storeCountry) q.set('store_country', args.storeCountry);
    const r = await sb.net.fetch(`${STEAM_KEYS_API}?${q.toString()}`, { method: 'GET', ...(signal ? { signal } : {}) });
    if (!r.ok) return [];
    const body = await r.json() as unknown;
    const items = (body as { data?: { items?: unknown } })?.data?.items;
    if (!Array.isArray(items)) return [];
    return items.map(toKeyItem).filter((x): x is KeyItem => x !== null);
  } catch { return []; }
}
