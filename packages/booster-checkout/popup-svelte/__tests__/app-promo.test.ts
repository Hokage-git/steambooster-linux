// Coverage for the detached «Каталог» promo block below the popup:
// renders when there's no pay-error, «Каталог» click posts open-catalog,
// and the whole promo is hidden while the pay-error modal is up (its scrim
// only covers the panel, so a visible/clickable promo underneath is wrong).

import { test, expect, afterEach } from 'bun:test';
import { renderPopup, closeAllPopups } from '../../tests/popup-render-helper';
import { ui } from '../lib/state.svelte';

afterEach(() => { ui.payError = null; closeAllPopups(); });

test('promo block renders with title + «Каталог» button when no pay-error', async () => {
  const h = await renderPopup();
  ui.payError = null;
  await h.flush();
  expect(h.document.querySelector('.promo')).toBeTruthy();
  expect((h.document.querySelector('.promo-title')?.textContent ?? '').trim())
    .toBe('Игры дешевле');                                                    // strings-allow-cyrillic
  const btn = h.document.querySelector('.promo-btn');
  expect(btn).toBeTruthy();
  expect((btn?.textContent ?? '').trim()).toContain('Каталог');              // strings-allow-cyrillic
  // Money illustration <img> is present (the chevron SVG + money src are
  // build-time defines, stubbed empty under bun test — their real inlining
  // is asserted in tests/popup-html.test.ts).
  expect(h.document.querySelector('.promo-money')).toBeTruthy();
  h.close();
});

test('«Каталог» click posts {kind:open-catalog}', async () => {
  const h = await renderPopup();
  ui.payError = null;
  await h.flush();
  const seen: any[] = [];
  const peer = new BroadcastChannel('sb_cmd');
  peer.addEventListener('message', (e: any) => seen.push(e.data));
  (h.document.querySelector('.promo-btn') as HTMLButtonElement).click();
  await h.flush();
  expect(seen.some(m => m?.kind === 'popup-message' && m?.data?.kind === 'open-catalog')).toBe(true);
  peer.close(); h.close();
});

test('promo is hidden while the pay-error modal is up', async () => {
  const h = await renderPopup();
  ui.payError = 'boom';
  await h.flush();
  expect(h.document.querySelector('.pe-overlay')).toBeTruthy();
  expect(h.document.querySelector('.promo')).toBeNull();
  expect(h.document.querySelector('.promo-money')).toBeNull();
  h.close();
});
