// Tests for installAddFundsMain — the ContextKind.Main entry that injects the
// "Каталог игр" item into Steam's store supernav via sb.ui.addMenuItem.
// strings-allow-cyrillic: file

import { test, expect } from 'bun:test';
import { installAddFundsMain } from '../src/main/install';
import { STORE_MENU_CATALOG_URL } from '../src/urls';
import { LL } from '../src/i18n';

interface Ctx {
  ctx: any;
  calls: any[];
  removed: string[];
  abort: () => void;
}

function makeCtx(addMenuItem?: (o: any) => Promise<any>): Ctx {
  const calls: any[] = [];
  const removed: string[] = [];
  const ac = new AbortController();
  const ctx: any = {
    contextKind: 'main',
    signal: ac.signal,
    scope: {
      // fire immediately so retry backoff doesn't slow the test
      setTimeout: (cb: () => void) => setTimeout(cb, 0) as unknown as number,
      clearTimeout: (id: number) => clearTimeout(id),
    },
    log: { warn: () => {}, info: () => {}, error: () => {} },
    sb: {
      lifecycle: { ready: async () => {} },
      ui: {
        addMenuItem: addMenuItem ?? (async (o: any) => { calls.push(o); return { remove: () => removed.push(o.id) }; }),
      },
    },
  };
  return { ctx, calls, removed, abort: () => ac.abort() };
}

test('adds the catalog item to the store menu with the brand variant', async () => {
  const { ctx, calls } = makeCtx();
  const teardown = await installAddFundsMain(ctx);
  expect(calls).toHaveLength(1);
  expect(calls[0].menu).toBe('store');
  expect(calls[0].id).toBe('booster-catalog');
  expect(calls[0].url).toBe(STORE_MENU_CATALOG_URL);
  expect(calls[0].variant).toBe('brand');
  expect(calls[0].placement).toBe('top');
  expect(calls[0].label).toBe(LL.addfunds.catalog_menu_item());
  expect(typeof calls[0].icon).toBe('string');
  teardown();
});

test('teardown removes the injected item', async () => {
  const { ctx, removed } = makeCtx();
  const teardown = await installAddFundsMain(ctx);
  teardown();
  expect(removed).toEqual(['booster-catalog']);
});

test('retries addMenuItem on transient failure then succeeds', async () => {
  let attempts = 0;
  const calls: any[] = [];
  const { ctx } = makeCtx(async (o: any) => {
    attempts++;
    if (attempts < 3) throw new Error('relay not ready');
    calls.push(o);
    return { remove: () => {} };
  });
  await installAddFundsMain(ctx);
  expect(attempts).toBe(3);
  expect(calls).toHaveLength(1);
});
