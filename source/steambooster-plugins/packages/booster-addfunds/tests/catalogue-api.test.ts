import { test, expect } from 'bun:test';
import { fetchCatalogue, decide, TTL_MS, type CacheRecord } from '../src/lib/catalogue-api';

function sbWith(reply: any): any {
  return { net: { fetch: async () => reply } };
}
const okBody = JSON.stringify({ success: true, data: [{ link: 'https://steambalance.cc/g', cover: 'https://shared.fastly.steamstatic.com/x.jpg' }] });

test('fetch: ok maps items', async () => {
  const r = await fetchCatalogue(sbWith({ ok: true, status: 200, headers: {}, text: async () => okBody, json: async () => JSON.parse(okBody) }));
  expect(r).toEqual({ status: 'ok', items: [{ link: 'https://steambalance.cc/g', cover: 'https://shared.fastly.steamstatic.com/x.jpg' }] });
});
test('fetch: empty data → empty', async () => {
  const body = JSON.stringify({ success: true, data: [] });
  const r = await fetchCatalogue(sbWith({ ok: true, status: 200, headers: {}, json: async () => JSON.parse(body) }));
  expect(r).toEqual({ status: 'empty' });
});
test('fetch: all-invalid entries → empty', async () => {
  const body = JSON.stringify({ success: true, data: [{ link: 1 }, { cover: 2 }] });
  const r = await fetchCatalogue(sbWith({ ok: true, status: 200, headers: {}, json: async () => JSON.parse(body) }));
  expect(r).toEqual({ status: 'empty' });
});
test('fetch: non-http(s) link/cover entries are dropped (defense-in-depth)', async () => {
  const body = JSON.stringify({ success: true, data: [
    { link: 'javascript:alert(1)', cover: 'https://cdn/a.jpg' },       // bad href → dropped
    { link: 'https://steambalance.cc/g', cover: 'data:text/html,x' },  // bad cover → dropped
    { link: 'https://steambalance.cc/ok', cover: 'https://cdn/ok.jpg' }, // valid → kept
  ] });
  const r = await fetchCatalogue(sbWith({ ok: true, status: 200, headers: {}, json: async () => JSON.parse(body) }));
  expect(r).toEqual({ status: 'ok', items: [{ link: 'https://steambalance.cc/ok', cover: 'https://cdn/ok.jpg' }] });
});
test('fetch: only a javascript: link → empty', async () => {
  const body = JSON.stringify({ success: true, data: [{ link: 'javascript:evil()', cover: 'https://cdn/a.jpg' }] });
  const r = await fetchCatalogue(sbWith({ ok: true, status: 200, headers: {}, json: async () => JSON.parse(body) }));
  expect(r).toEqual({ status: 'empty' });
});
test('fetch: non-200 → error', async () => {
  const r = await fetchCatalogue(sbWith({ ok: false, status: 500, headers: {}, json: async () => ({}) }));
  expect(r).toEqual({ status: 'error' });
});
test('fetch: sb.net undefined → error (no throw)', async () => {
  const r = await fetchCatalogue({} as any);
  expect(r).toEqual({ status: 'error' });
});
test('fetch: thrown → error (no throw)', async () => {
  const r = await fetchCatalogue({ net: { fetch: async () => { throw new Error('x'); } } } as any);
  expect(r).toEqual({ status: 'error' });
});

const rec = (items: number, fetchedAgo: number, attemptedAgo: number): CacheRecord =>
  ({ items: Array(items).fill({ link: 'a', cover: 'b' }), fetchedAt: 1_000_000 - fetchedAgo, attemptedAt: 1_000_000 - attemptedAgo });

test('decide: fresh non-empty → render, no fetch', () => {
  expect(decide(1_000_000, rec(3, TTL_MS - 1, TTL_MS - 1))).toEqual({ render: expect.any(Array), shouldFetch: false });
});
test('decide: stale non-empty → render + fetch', () => {
  const d = decide(1_000_000, rec(3, TTL_MS + 1, TTL_MS + 1));
  expect(d.render).toHaveLength(3); expect(d.shouldFetch).toBe(true);
});
test('decide: stale but attempted recently → render, no fetch (backoff)', () => {
  const d = decide(1_000_000, rec(3, TTL_MS + 1, TTL_MS - 1));
  expect(d.render).toHaveLength(3); expect(d.shouldFetch).toBe(false);
});
test('decide: no cache → no render, fetch', () => {
  expect(decide(1_000_000, null)).toEqual({ render: null, shouldFetch: true });
});
test('decide: empty-marker fresh → no render, no fetch', () => {
  expect(decide(1_000_000, rec(0, TTL_MS - 1, TTL_MS - 1))).toEqual({ render: null, shouldFetch: false });
});

// The carousel API must receive the account's region + currency so the backend
// can tailor the game list. Values are ISO: country alpha-2 upper (KZ), currency
// ISO-4217 (KZT). Contract with the backend — see the region-games doc.
function sbCapture(reply: any): { sb: any; urls: string[] } {
  const urls: string[] = [];
  return { sb: { net: { fetch: async (u: string) => { urls.push(u); return reply; } } }, urls };
}
const OK = { ok: true, status: 200, headers: {}, json: async () => ({ success: true, data: [{ link: 'https://steambalance.cc/g', cover: 'https://cdn/x.jpg' }] }) };

test('fetch: appends country + currency as query params', async () => {
  const { sb, urls } = sbCapture(OK);
  await fetchCatalogue(sb, { country: 'KZ', currency: 'KZT' });
  expect(urls[0]).toContain('?');
  const q = new URL(urls[0]!).searchParams;
  expect(q.get('country')).toBe('KZ');
  expect(q.get('currency')).toBe('KZT');
});

test('fetch: omits a missing param rather than sending empty', async () => {
  const { sb, urls } = sbCapture(OK);
  await fetchCatalogue(sb, { country: 'KZ', currency: null });
  const q = new URL(urls[0]!).searchParams;
  expect(q.get('country')).toBe('KZ');
  expect(q.has('currency')).toBe(false);
});

test('fetch: no params → bare url, no query string', async () => {
  const { sb, urls } = sbCapture(OK);
  await fetchCatalogue(sb);
  expect(urls[0]).not.toContain('?');
});

test('fetch: forwards the abort signal in the fetch init alongside params', async () => {
  const inits: any[] = [];
  const sb = { net: { fetch: async (_u: string, init?: any) => { inits.push(init); return OK; } } } as any;
  const ac = new AbortController();
  const r = await fetchCatalogue(sb, { country: 'KZ', currency: 'KZT', signal: ac.signal });
  expect(r.status).toBe('ok');
  expect(inits[0]?.signal).toBe(ac.signal);
});
