import { test, expect } from 'bun:test';
import { fetchKeysDirect } from '../src/lib/keys-fetch';

function makeSb(fetchImpl: any) {
  return { net: { fetch: fetchImpl } } as any;
}

test('parses items from the same shape checkout\'s toKeyItem parses, and builds the right query', async () => {
  const body = { success: true, data: { items: [
    { id: 7, name: 'X', is_active: true, region_label: 'Global', package: { id: 99, product_type: 'base' }, price: 10, old_price: null, discount_percent: 0 },
  ] } };
  let gotUrl = '';
  const sb = makeSb(async (url: string) => { gotUrl = url; return { ok: true, json: async () => body }; });
  const items = await fetchKeysDirect(sb, { appid: 1909950, paymentId: 'paypalych-sbp', storeCountry: 'RU' });
  expect(items).toEqual([{
    itemId: 7, name: 'X', isActive: true, regionLabel: 'Global',
    packageId: 99, productType: 'base', price: 10, oldPrice: null, discountPercent: 0,
  }]);
  expect(gotUrl).toContain('paymentId=paypalych-sbp');
  expect(gotUrl).toContain('appid=1909950');
  expect(gotUrl).toContain('store_country=RU');
});

test('omits store_country from the query when not provided', async () => {
  let gotUrl = '';
  const sb = makeSb(async (url: string) => { gotUrl = url; return { ok: true, json: async () => ({ success: true, data: { items: [] } }) }; });
  await fetchKeysDirect(sb, { appid: 1, paymentId: 'p' });
  expect(gotUrl).not.toContain('store_country');
});

test('empty items array is a valid final answer, not a failure', async () => {
  const sb = makeSb(async () => ({ ok: true, json: async () => ({ success: true, data: { items: [] } }) }));
  const items = await fetchKeysDirect(sb, { appid: 1, paymentId: 'p' });
  expect(items).toEqual([]);
});

test('returns [] when the response is !ok', async () => {
  const sb = makeSb(async () => ({ ok: false, json: async () => ({}) }));
  const items = await fetchKeysDirect(sb, { appid: 1, paymentId: 'p' });
  expect(items).toEqual([]);
});

test('returns [] on a malformed body (no data.items array)', async () => {
  const sb = makeSb(async () => ({ ok: true, json: async () => ({ success: true }) }));
  const items = await fetchKeysDirect(sb, { appid: 1, paymentId: 'p' });
  expect(items).toEqual([]);
});

test('never throws — swallows network / json-parse errors', async () => {
  const sb = makeSb(async () => { throw new Error('network down'); });
  const items = await fetchKeysDirect(sb, { appid: 1, paymentId: 'p' });
  expect(items).toEqual([]);
});
