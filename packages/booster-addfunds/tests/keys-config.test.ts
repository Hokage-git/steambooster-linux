import { test, expect } from 'bun:test';
import { ensureKeysConfigService } from '../src/lib/keys-config';

function makeSb() {
  const subs = new Map<string, Set<(d: unknown) => void>>();
  const pubs: { topic: string; data: unknown }[] = [];
  const ctrl = new AbortController();
  const sb = {
    bus: {
      publish: (topic: string, data: unknown) => pubs.push({ topic, data }),
      subscribe: (t: string, cb: (d: unknown) => void) => {
        let s = subs.get(t); if (!s) { s = new Set(); subs.set(t, s); } s.add(cb);
        return () => s!.delete(cb);
      },
    },
    scope: { signal: ctrl.signal },
  } as any;
  const fire = (t: string, d: unknown) => subs.get(t)?.forEach((cb) => cb(d));
  return { sb, pubs, fire, subs };
}

test('subscribes once, nudges checkout, caches the broadcast config', () => {
  const { sb, pubs, fire, subs } = makeSb();
  const svc = ensureKeysConfigService(sb);
  expect(pubs).toEqual([{ topic: 'booster-addfunds.keys.config.request', data: null }]);
  expect(svc.get()).toBeNull();
  fire('booster-checkout.keys.config', { paymentId: 'paypalych-sbp', storeCountry: 'RU' });
  expect(svc.get()).toEqual({ paymentId: 'paypalych-sbp', storeCountry: 'RU' });
  const svc2 = ensureKeysConfigService(sb);
  expect(svc2).toBe(svc);
  expect(subs.get('booster-checkout.keys.config')!.size).toBe(1);
});

test('paymentId:null (no usable payment method) is cached as-is, not coerced to missing', () => {
  const { sb, fire } = makeSb();
  const svc = ensureKeysConfigService(sb);
  fire('booster-checkout.keys.config', { paymentId: null, storeCountry: 'KZ' });
  expect(svc.get()).toEqual({ paymentId: null, storeCountry: 'KZ' });
});

test('ignores malformed / null broadcasts, keeps the last good cache', () => {
  const { sb, fire } = makeSb();
  const svc = ensureKeysConfigService(sb);
  fire('booster-checkout.keys.config', { paymentId: 'p', storeCountry: 'RU' });
  fire('booster-checkout.keys.config', null);
  expect(svc.get()).toEqual({ paymentId: 'p', storeCountry: 'RU' });
});

test('non-string paymentId/storeCountry fields fall back to null', () => {
  const { sb, fire } = makeSb();
  const svc = ensureKeysConfigService(sb);
  fire('booster-checkout.keys.config', { paymentId: 42, storeCountry: undefined });
  expect(svc.get()).toEqual({ paymentId: null, storeCountry: null });
});
