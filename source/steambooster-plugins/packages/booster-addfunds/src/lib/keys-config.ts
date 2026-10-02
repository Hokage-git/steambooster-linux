// Caches the paymentId + storeCountry booster-checkout's main-shell owns and
// proactively broadcasts (see checkout's main/keys-install.ts). Lets
// lib/keys-client.ts fetch the keys list directly via sb.net instead of the
// booster-addfunds.keys.request bus round-trip, without duplicating
// payment-method resolution here. Mirrors lib/user-snapshot.ts's
// ensureSnapshotService shape (WeakMap-per-scope singleton + cold-boot nudge).
import type { SbApi } from '@steambalance/booster-framework/api-types';

export interface KeysConfig {
  paymentId: string | null;
  storeCountry: string | null;
}

export interface KeysConfigService {
  get(): KeysConfig | null;
}

// One service per injection scope — see user-snapshot.ts's identical rationale.
const services = new WeakMap<AbortSignal, KeysConfigService>();

export function ensureKeysConfigService(sb: SbApi): KeysConfigService {
  const existing = services.get(sb.scope.signal);
  if (existing) return existing;

  let cached: KeysConfig | null = null;

  sb.bus.subscribe('booster-checkout.keys.config', (data) => {
    const d = data as Partial<KeysConfig> | null;
    if (!d) return;
    cached = {
      paymentId: typeof d.paymentId === 'string' && d.paymentId ? d.paymentId : null,
      storeCountry: typeof d.storeCountry === 'string' && d.storeCountry ? d.storeCountry : null,
    };
  });
  // Nudge checkout's main-shell to (re-)publish current config. Covers the
  // cold-boot race where addfunds attaches before checkout's first
  // broadcast lands (same rationale as user.snapshot.request).
  sb.bus.publish('booster-addfunds.keys.config.request', null);

  const svc: KeysConfigService = { get: () => cached };
  services.set(sb.scope.signal, svc);
  return svc;
}
