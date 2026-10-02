import { test, expect } from 'bun:test';
import { WebsiteHost } from '../src/website-host';

test('host rejects untrusted binding calls and drops replies to destroyed contexts', async () => {
  let listener: any;
  const sent: any[] = [];
  let invokeCount = 0;
  let finish: any;
  const session: any = {
    closed: false,
    onEvent(fn: any) {
      listener = fn;
      return () => {};
    },
    async attachToTarget() {
      return 's';
    },
    async send(method: string, params: any, sessionId: string) {
      sent.push({ method, params, sessionId });
      return {};
    },
  };
  const host = new WebsiteHost(session, async () => {
    invokeCount++;
    return new Promise((r) => (finish = r));
  });
  await host.attach('target');
  const binding = sent.find((x) => x.method === 'Runtime.addBinding').params.name;
  listener({
    method: 'Runtime.executionContextCreated',
    sessionId: 's',
    params: {
      context: {
        id: 1,
        origin: 'https://evil.test',
        auxData: { isDefault: true },
      },
    },
  });
  listener({
    method: 'Runtime.bindingCalled',
    sessionId: 's',
    params: {
      name: binding,
      executionContextId: 1,
      payload: JSON.stringify({ id: 1, method: 'getSteamId', args: [] }),
    },
  });
  expect(invokeCount).toBe(0);
  listener({
    method: 'Runtime.executionContextCreated',
    sessionId: 's',
    params: {
      context: {
        id: 2,
        origin: 'https://steambalance.cc',
        auxData: { isDefault: true },
      },
    },
  });
  listener({
    method: 'Runtime.bindingCalled',
    sessionId: 's',
    params: {
      name: binding,
      executionContextId: 2,
      payload: JSON.stringify({ id: 2, method: 'getSteamId', args: [] }),
    },
  });
  expect(invokeCount).toBe(1);
  listener({
    method: 'Runtime.executionContextDestroyed',
    sessionId: 's',
    params: { executionContextId: 2 },
  });
  const before = sent.length;
  finish({ steamId: '76561198000000000' });
  await new Promise((r) => setTimeout(r, 0));
  expect(sent.length).toBe(before);
  host.close();
});
