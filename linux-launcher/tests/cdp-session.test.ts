import { test, expect } from 'bun:test';
import { MasterCDPSession } from '../src/cdp-session';

test('CDP requests time out instead of hanging the recovery loop', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, s) {
      if (s.upgrade(req)) return;
      return new Response('no');
    },
    websocket: { message() {} },
  });
  const c = new MasterCDPSession(`ws://127.0.0.1:${server.port}`, 30);
  await c.ready();
  try {
    await expect(c.send('Runtime.evaluate')).rejects.toThrow('timed out');
  } finally {
    c.close();
    server.stop(true);
  }
});
test('closing a CDP session rejects pending requests', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, s) {
      if (s.upgrade(req)) return;
      return new Response('no');
    },
    websocket: { message() {} },
  });
  const c = new MasterCDPSession(`ws://127.0.0.1:${server.port}`, 1000);
  await c.ready();
  const result = c.send('Runtime.evaluate').catch((e) => e.message);
  c.close();
  expect(await result).toContain('closed');
  server.stop(true);
});
