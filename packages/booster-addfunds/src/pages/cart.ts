// booster-plugins/packages/booster-addfunds/src/pages/cart.ts
//
// Store-context page handler for Steam's cart page
// (`store.steampowered.com/cart/`). Renders the shared branded TopupBar
// immediately AFTER the cart's "Ваша корзина" header — but ONLY when the
// wallet balance is below the cart total — prefilled with the shortfall
// (ceil(total - balance)). The bar shows / hides / updates REACTIVELY as
// the cart total or the wallet balance changes.
//
// Cross-target user data (currency/balance) arrives over the bus as
// `booster-checkout.user.snapshot` payloads, surfaced through the shared
// user-snapshot service (BC doesn't cross to store.steampowered.com).
// The cart total is read from the live DOM via findCartTotal.
//
// Reactivity: a debounced MutationObserver on the cart container re-runs
// `render` on DOM mutations (item add/remove changes the total text), and
// the snapshot subscription re-runs it on balance/currency updates.
//
// Plain DOM by design (store BrowserView has no Svelte runtime); CSS is
// scoped via #booster-topup-bar so it can't leak onto Steam's own layout.

import type { SbApi, PageContext } from '@steambalance/booster-framework/api-types';
import { findCartTotal, findCartTotalLabel } from '../lib/cart-total';
import { ensureSnapshotService } from '../lib/user-snapshot';
import { buildTopupBar, ensureTopupStyles, type TopupBar } from '../components/topup-bar';
import { currencySym } from '../lib/currency';
import { waitForElementBy } from '../lib/wait-for-element';
import { LL } from '../i18n';

// Build-time-inlined PNG logo (data:image/png;base64,…). Bypasses
// store.steampowered.com's img-src CSP that would block our CDN URL.
// Resolved via typeof guard so the bun `define` substitution can be
// absent (e.g. when imported by a `bun test` run that loads source
// directly). Empty-string fallback keeps tests deterministic.
declare const __SB_ADDFUNDS_LOGO_DATA_URI__: string;
const LOGO = typeof __SB_ADDFUNDS_LOGO_DATA_URI__ !== 'undefined' ? __SB_ADDFUNDS_LOGO_DATA_URI__ : '';
const DEBOUNCE_MS = 200;

// Steam appends an item counter ("Ваша корзина (товаров: 3)"), so match by
// PREFIX — an exact compare silently stops matching. Keep the FULL phrase:
// the bare word "Корзина" also labels the supernav cart link, which comes
// first in document order and swallowed the bar when we matched on it.
// Two link guards, for the two ways Steam repeats this text:
//   - inside a link  → the supernav cart button
//   - next to a link → the breadcrumb trail ("Домашняя страница > …")
// Rewording beyond this is handled by the total-block fallback, NOT by
// loosening the match — a looser match lands the bar somewhere absurd.
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const CART_HEADING = 'Ваша корзина'; // strings-allow-cyrillic

function findCartHeaderNow(): HTMLElement | null {
  return ([...document.querySelectorAll('div,h1,h2,span')] as HTMLElement[]).find((el) => {
    const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
    if (!own.startsWith(CART_HEADING)) return false;
    if (el.closest('a')) return false;
    return ![...(el.parentElement?.children ?? [])].some((c) => c.tagName === 'A');
  }) ?? null;
}

interface Anchor { parent: HTMLElement; before: Node | null }

// Steam lays the cart out as a flex row: [items column | summary column]. Given
// the total's label, walk up to the row child that CONTAINS it — that is the
// summary column — and return its sibling, the items column.
function isColumnRow(el: HTMLElement): boolean {
  // Only a real flex/grid row splits the cart into columns. Without this check
  // any parent with two children qualifies — including the total block itself,
  // whose second child is just the price text.
  try {
    // Resolve through the element's OWN window, not the global: the global is
    // absent in some hosts (and in tests), where a bare getComputedStyle throws
    // and the catch would silently answer "not a row".
    const view = el.ownerDocument?.defaultView as (Window & typeof globalThis) | null;
    const d = view?.getComputedStyle(el).display ?? el.style?.display ?? '';
    return d === 'flex' || d === 'grid' || d === 'inline-flex' || d === 'inline-grid';
  } catch { return false; }
}

function findItemsColumn(label: HTMLElement): HTMLElement | null {
  let summary: HTMLElement = label;
  while (summary.parentElement) {
    const row = summary.parentElement;
    const siblings = [...row.children] as HTMLElement[];
    if (siblings.length >= 2 && isColumnRow(row)) {
      const items = siblings.find((c) => c !== summary && !c.contains(label) && c.children.length > 0);
      if (items) return items;
    }
    summary = row;
  }
  return null;
}

// Anchor INSIDE the items column. Inserting above the row instead pushed both
// columns down, so the "Общая стоимость / Перейти к оплате" panel sank by the
// bar's height. Falls back to the header, then to the total block, so a layout
// change degrades the bar's POSITION rather than removing it.
function findAnchorNow(): Anchor | null {
  const label = findCartTotalLabel(document);
  if (label) {
    const items = findItemsColumn(label);
    if (items) return { parent: items, before: items.firstChild };
  }
  const header = findCartHeaderNow();
  if (header?.parentElement) return { parent: header.parentElement, before: header.nextSibling };
  const block = label?.parentElement;
  if (block?.parentElement) return { parent: block.parentElement, before: block };
  return null;
}

export function registerCartPage(sb: SbApi): void {
  const snap = ensureSnapshotService(sb);

  sb.pages.register({
    name: 'booster-addfunds-cart',
    match: { url: /store\.steampowered\.com\/cart\/?($|\?|#)/ },
    mount: async (ctx: PageContext) => {
      if (document.readyState === 'loading') {
        await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true, signal: ctx.signal }));
      }
      if (ctx.signal.aborted) return;

      // Warn on every miss: a silent no-op is how the last Steam reword went
      // unnoticed until a user reported it.
      const anchor = await waitForElementBy(findAnchorNow, ctx.signal);
      if (ctx.signal.aborted) return;
      if (!anchor) {
        console.warn('[booster-addfunds] cart: no anchor — header and total both missing, bar not rendered');
        return;
      }
      if (!findCartHeaderNow()) {
        console.warn('[booster-addfunds] cart header not found — anchoring above the total block');
      }

      ensureTopupStyles();
      const root = (document.querySelector('.responsive_page_content') as HTMLElement) ?? document.body;
      const OPTS: MutationObserverInit = { subtree: true, childList: true, characterData: true };

      let bar: TopupBar | null = null;
      let lastAmount: number | null = null;

      // Shortfall, or null when no bar should show.
      const desired = (): number | null => {
        const total = findCartTotal(document);
        const s = snap.get();
        if (total == null || s == null || s.balance == null) return null;
        if (s.balance >= total) return null;
        return Math.ceil(total - s.balance);
      };

      // Loop-guard: every DOM write (insert/remove) is bracketed by
      // observer.disconnect() → write → observer.observe(...). setAmount /
      // setCurrency only touch the input value/symbol (which the total
      // doesn't depend on) so they don't need bracketing. render reads the
      // total BEFORE any write.
      const render = (): void => {
        const amount = desired();
        const sym = currencySym(snap.get()?.currency ?? null);
        if (amount == null) {
          if (bar) {
            observer.disconnect();
            bar.root.remove();
            bar = null;
            lastAmount = null;
            observer.observe(root, OPTS);
          }
          return;
        }
        if (!bar) {
          bar = buildTopupBar({
            heading: LL.addfunds.cart_heading(),
            amount,
            currencySymbol: sym,
            logoUrl: LOGO,
            onSubmit: (a) => { sb.bus.publish('booster-addfunds.topup-requested', { amount: a }); },
          });
          observer.disconnect();
          anchor.parent.insertBefore(bar.root, anchor.before);
          observer.observe(root, OPTS);
          lastAmount = amount;
        } else if (amount !== lastAmount) {
          bar.setAmount(amount);
          // Only touch the symbol when it actually changed — an unconditional
          // setCurrency rewrites symbol.textContent, emitting a spurious
          // mutation record that triggers one extra (no-op) debounced render.
          if (bar.symbol.textContent !== sym) bar.setCurrency(sym, '');
          lastAmount = amount;
        }
      };

      let timer: ReturnType<typeof setTimeout> | null = null;
      const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(render, DEBOUNCE_MS);
      });

      render();
      observer.observe(root, OPTS);
      const unsub = snap.subscribe(render);
      ctx.signal.addEventListener('abort', () => { if (timer) clearTimeout(timer); }, { once: true });

      return () => {
        observer.disconnect();
        if (timer) clearTimeout(timer);
        unsub();
        try { bar?.root.remove(); } catch { /* detached */ }
        document.getElementById('booster-topup-style')?.remove();
      };
    },
  });
}
