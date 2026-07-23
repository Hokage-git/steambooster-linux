import { describe, test, expect } from 'bun:test';
import { installStoreCurrencyFallback } from '../src/main/store-currency-fallback';

function makeSb(getStoreCurrency: () => Promise<string | undefined>) {
  return { steam: { getStoreCurrency } } as any;
}

describe('installStoreCurrencyFallback', () => {
  test('refresh resolves currency and fires onResolved once', async () => {
    const fired: string[] = [];
    const h = installStoreCurrencyFallback(makeSb(async () => 'USD'), (c) => fired.push(c));
    expect(h.get()).toBeNull();
    await h.refresh();
    expect(h.get()).toBe('USD');
    expect(fired).toEqual(['USD']);
    await h.refresh();                 // unchanged → no second fire
    expect(fired).toEqual(['USD']);
  });

  test('refresh with no resolvable currency leaves null, no fire', async () => {
    const fired: string[] = [];
    const h = installStoreCurrencyFallback(makeSb(async () => undefined), (c) => fired.push(c));
    await h.refresh();
    expect(h.get()).toBeNull();
    expect(fired).toEqual([]);
  });

  test('refresh swallows a throwing getStoreCurrency', async () => {
    const h = installStoreCurrencyFallback(makeSb(async () => { throw new Error('x'); }), () => {});
    await h.refresh();                 // must not reject
    expect(h.get()).toBeNull();
  });
});
