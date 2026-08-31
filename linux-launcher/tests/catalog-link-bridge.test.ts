import { test, expect } from 'bun:test';
import { CATALOG_LINK_BRIDGE_SCRIPT } from '../src/catalog-link-bridge.js';

test('catalogue bridge is scoped to the catalogue origin and route', () => {
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain("location.hostname !== 'steambalance.cc'");
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain("location.pathname.startsWith('/booster/catalogue')");
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain("href.hostname !== 'store.steampowered.com'");
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('window.top.location.assign(href.href)');
});

test('catalogue bridge preserves modified and non-left clicks', () => {
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('event.button !== 0');
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('event.metaKey');
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('event.ctrlKey');
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('event.preventDefault()');
});
