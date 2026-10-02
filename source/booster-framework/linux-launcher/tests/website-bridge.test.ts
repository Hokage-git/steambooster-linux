import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { websiteBridgeScript, trustedWebsiteOrigin } from '../src/website-bridge';
import { dispatchHostRequest } from '../src/host-dispatch';

test('trust only the exact HTTPS website origin', () => {
  expect(trustedWebsiteOrigin('https://steambalance.cc')).toBe(true);
  for (const origin of [
    'http://steambalance.cc',
    'https://steambalance.cc.evil.test',
    'null',
    'https://steambalance.cc:8080',
  ])
    expect(trustedWebsiteOrigin(origin)).toBe(false);
});

test('website API correlates replies and preserves purchase options', async () => {
  const w = new Window({ url: 'https://steambalance.cc/booster/catalogue' });
  const requests: any[] = [];
  (w as any).nativeBinding = (s: string) => requests.push(JSON.parse(s));
  new Function('globalThis', websiteBridgeScript('nativeBinding', 'reply'))(w);
  const api = (w as any).SteamBooster;
  expect(api.isSteamBooster).toBe(true);
  const result = api.purchaseKey(42, { gameName: 'Example' });
  expect(requests[0]).toMatchObject({
    method: 'purchaseKey',
    args: [42, { gameName: 'Example' }],
  });
  (w as any).reply({ id: requests[0].id, ok: true, result: { ok: true } });
  expect(await result).toEqual({ ok: true });
  await w.happyDOM.close();
});

test('bridge is absent on other sites', async () => {
  const w = new Window({ url: 'https://example.com' });
  new Function('globalThis', websiteBridgeScript('nativeBinding', 'reply'))(w);
  expect((w as any).SteamBooster).toBeUndefined();
  await w.happyDOM.close();
});

test('valuation errors reject the page promise', async () => {
  const w = new Window({ url: 'https://steambalance.cc/booster/viral' });
  let request: any;
  (w as any).nativeBinding = (s: string) => {
    request = JSON.parse(s);
  };
  new Function('globalThis', websiteBridgeScript('nativeBinding', 'reply'))(w);
  const result = (w as any).SteamBooster.getRateAccountData();
  const outcome = result.catch((e: Error) => e.message);
  (w as any).reply({
    id: request.id,
    ok: false,
    error: 'sb_family_view_locked',
  });
  expect(await outcome).toBe('sb_family_view_locked');
  await w.happyDOM.close();
});

test('host routes methods and rejects unknown or malformed requests', async () => {
  const calls: any[] = [];
  const invoke = async (method: string, args: unknown[]) => {
    calls.push([method, args]);
    return { ok: true };
  };
  await dispatchHostRequest({ method: 'purchaseKey', args: [42, { gameName: 'Example' }] }, invoke);
  expect(calls).toEqual([['keysPurchase', [42, 'Example']]]);
  await expect(dispatchHostRequest({ method: 'purchaseKey', args: [-1] }, invoke)).rejects.toThrow(
    'bad-args',
  );
  await expect(dispatchHostRequest({ method: 'eval', args: ['secret'] }, invoke)).rejects.toThrow(
    'unsupported',
  );
  await dispatchHostRequest({ method: 'getSteamId', args: [] }, invoke);
  expect(calls.at(-1)).toEqual(['hostAccount', ['getSteamId']]);
  await dispatchHostRequest({ method: 'getRateAccountData', args: [] }, invoke);
  expect(calls.at(-1)).toEqual(['rateAccountData', []]);
});

test('key activation routes once and rejects invalid keys without submitting', async () => {
  const calls: any[] = [];
  const invoke = async (name: string, args: unknown[]) => {
    calls.push([name, args]);
    return { ok: false, code: 'already-owned' };
  };
  expect(
    await dispatchHostRequest({ method: 'activateKey', args: ['XXXXX-XXXXX-XXXXX'] }, invoke),
  ).toEqual({ ok: false, code: 'already-owned' });
  expect(calls).toEqual([['keysActivate', ['XXXXX-XXXXX-XXXXX']]]);
  for (const key of ['', 42, 'x'.repeat(257)])
    await expect(
      dispatchHostRequest({ method: 'activateKey', args: [key] }, invoke),
    ).rejects.toThrow('invalid product key');
  expect(calls.length).toBe(1);
});
