import { test, expect } from 'bun:test';
import { pluginMeta } from '../src/plugin-meta';

// pluginMeta.urlPatterns is the ELIGIBILITY gate: the framework applies it ONCE
// at bootstrap (bootstrap.ts::filterEligiblePlugins against location.href) to
// decide whether the plugin runs on this page. It must match every URL form
// Steam actually loads — crucially an app page opened at `app/<id>?snr=...`
// (query string present BEFORE Steam client-side adds the SEO slug). That
// no-slug form is how /app/ pages reached from the store home first load
// (live CDP, Blasphemous 2: nav url = app/2114740?snr=1_4_4__40_1).
const matchesAny = (url: string): boolean =>
  pluginMeta.urlPatterns.some((p) => new RegExp(p).test(url));

test('matches all store.steampowered.com pages (whole-site eligibility)', () => {
  for (const u of [
    'https://store.steampowered.com/',
    'https://store.steampowered.com/wishlist/',
    'https://store.steampowered.com/search/?term=x',
    'https://store.steampowered.com/app/2114740/Blasphemous_2/',
    'https://store.steampowered.com/app/2114740?snr=1_4_4__40_1',
    'https://store.steampowered.com/steamaccount/addfunds',
    'https://store.steampowered.com/cart/',
    'https://store.steampowered.com',
  ]) expect(matchesAny(u)).toBe(true);
});

test('does NOT match other hosts or look-alike suffixes', () => {
  expect(matchesAny('https://steamcommunity.com/')).toBe(false);
  expect(matchesAny('https://evil.com/app/123')).toBe(false);
  expect(matchesAny('https://store.steampowered.com.evil.com/')).toBe(false);
  expect(matchesAny('http://store.steampowered.com/')).toBe(false); // http, not https
});
