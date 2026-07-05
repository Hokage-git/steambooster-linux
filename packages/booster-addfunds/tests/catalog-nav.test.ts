import { test, expect } from 'bun:test';
import { registerCatalogNav } from '../src/pages/catalog-nav';
import { CATALOG_URL } from '../src/urls';

function makeSb() {
  const registered: any[] = [];
  const navCalls: any[] = [];
  const removed = { n: 0 };
  const sb = {
    pages: { register: (opts: any) => { registered.push(opts); return { unregister() {} }; } },
    ui: { addStoreNavButton: (opts: any) => { navCalls.push(opts); return { remove: () => { removed.n++; }, setLabel() {} }; } },
  } as any;
  return { sb, registered, navCalls, removed };
}

test('registers a store-wide page that adds the catalog nav button', () => {
  const { sb, registered, navCalls } = makeSb();
  registerCatalogNav(sb);
  expect(registered).toHaveLength(1);
  expect(registered[0].name).toBe('booster-addfunds-catalog-nav');
  // match covers store pages, not other hosts
  expect(registered[0].match.url.test('https://store.steampowered.com/wishlist/')).toBe(true);
  expect(registered[0].match.url.test('https://steamcommunity.com/')).toBe(false);

  const cleanup = registered[0].mount({ url: new URL('https://store.steampowered.com/'), signal: new AbortController().signal });
  expect(navCalls).toHaveLength(1);
  expect(navCalls[0]).toMatchObject({
    id: 'booster-catalog-nav', url: CATALOG_URL, variant: 'brand', placement: 'start',
  });
  expect(navCalls[0].label.length).toBeGreaterThan(0);
  expect(typeof cleanup).toBe('function');
});

test('mount cleanup removes the button handle', () => {
  const { sb, registered, removed } = makeSb();
  registerCatalogNav(sb);
  const cleanup = registered[0].mount({ url: new URL('https://store.steampowered.com/'), signal: new AbortController().signal });
  (cleanup as () => void)();
  expect(removed.n).toBe(1);
});
