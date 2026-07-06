import { describe, test, expect } from 'bun:test';
import { postKeysOrder } from '../src/main/keys-order';
import { URLS } from '../src/urls';

const sb = { version: '1.0.0' } as any;

// Fake `sb.net.fetch` seam (replaces the old raw fetchImpl 3rd arg). Captures
// the url/init it was called with in `state` for assertions.
function fakeSb(body: unknown, ok = true, status = ok ? 200 : 500) {
  const state = { url: '', init: undefined as { method?: string; headers?: Record<string, string>; body?: string } | undefined };
  const netSb = {
    ...sb,
    net: {
      fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        state.url = url;
        state.init = init;
        return { ok, status, headers: {}, json: async () => body, text: async () => '' };
      },
    },
  } as any;
  return { sb: netSb, state };
}

describe('postKeysOrder', () => {
  test('success → redirectUrl + uid (nested); POST with JSON content-type', async () => {
    const { sb, state } = fakeSb({ success: true, data: { redirectUrl: 'https://pay.example/x', uid: 'u1' } });
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c', login: 'tester' });
    expect(r).toEqual({ ok: true, redirectUrl: 'https://pay.example/x', uid: 'u1' });
    expect(state.url).toBe(URLS.steamKeysApi);
    expect(state.init?.method).toBe('POST');
    expect(state.init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(state.init!.body as string)).toEqual({ paymentId: 'p', itemId: 5, account: 'a@b.c', login: 'tester' });
  });
  test('top-level redirectUrl also accepted', async () => {
    const { sb } = fakeSb({ redirectUrl: 'https://x/y' });
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c', login: 'tester' });
    expect(r.ok).toBe(true); expect(r.redirectUrl).toBe('https://x/y');
  });
  test('success=false → human message in `message`, machine code in `error`', async () => {
    const { sb } = fakeSb({ success: false, message: 'nope' });
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c', login: 'tester' });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('nope');          // server-supplied human text → user-facing
    expect(typeof r.error).toBe('string');   // machine code for logs
    expect(r.error).not.toBe('nope');        // never the human text
  });
  test('success=false without a message → no human message, only a machine code', async () => {
    const { sb } = fakeSb({ success: false });
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c', login: 'tester' });
    expect(r.ok).toBe(false);
    expect(r.message).toBeUndefined();
    expect(typeof r.error).toBe('string');
  });
  test('http error → ok:false', async () => {
    const { sb } = fakeSb(null, false);
    const r = await postKeysOrder(sb, { paymentId: 'p', itemId: 5, account: 'a@b.c', login: 'tester' });
    expect(r.ok).toBe(false);
  });
});
