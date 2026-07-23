import type { SbApi } from '@steambalance/booster-framework/api-types';

/** Holds the store-country currency fallback for the popup/bus. `refresh()`
 *  queries sb.steam.getStoreCurrency() (which reads the live native store-country
 *  cache) and invokes onResolved ONLY when the value changes to a new non-null
 *  currency — so a new user who just visited the store gets the right currency
 *  the next time the popup seeds/shows, without a relaunch. Never throws. */
export function installStoreCurrencyFallback(
  sb: Pick<SbApi, 'steam'>,
  onResolved: (currency: string) => void,
): { get(): string | null; refresh(): Promise<void> } {
  let storeCurrency: string | null = null;
  async function refresh(): Promise<void> {
    try {
      const c = await sb.steam.getStoreCurrency?.();
      if (c && c !== storeCurrency) {
        storeCurrency = c;
        onResolved(c);
      }
    } catch { /* best-effort */ }
  }
  return { get: () => storeCurrency, refresh };
}
