// booster-plugins/packages/booster-addfunds/tests/cart-page.test.ts
//
// Tests for registerCartPage — the /cart/ page-router handler that
// renders the shared branded TopupBar AFTER the cart's "Ваша корзина"
// header, ONLY when the wallet balance is below the cart total, prefilled
// with the shortfall (ceil(total - balance)). The bar shows / hides /
// updates reactively as the cart total or the balance changes.
//
// Cross-target user data (currency/balance) arrives over the bus as
// `booster-checkout.user.snapshot` payloads, surfaced through the shared
// user-snapshot service (BC doesn't cross to store.steampowered.com).
//
// happy-dom does not run scripts; we drive mount/unmount directly and
// simulate main-shell's broadcast via `fireBus`. The reactive tests rely
// on happy-dom's MutationObserver firing on childList + characterData
// mutations (verified). To cross the 200ms render debounce, await
// tick(400).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { registerCartPage } from '../src/pages/cart';

function installDom(): Window {
  const w = new Window({ url: 'https://store.steampowered.com/cart/' });
  // happy-dom 20 leaves window.SyntaxError unset; querySelector parser needs it.
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    history: w.history,
    location: w.location,
    MutationObserver: w.MutationObserver,
    Event: w.Event,
    KeyboardEvent: w.KeyboardEvent,
    HTMLElement: w.HTMLElement,
    HTMLInputElement: w.HTMLInputElement,
    HTMLButtonElement: w.HTMLButtonElement,
    addEventListener: w.addEventListener.bind(w),
    removeEventListener: w.removeEventListener.bind(w),
  });
  return w;
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface SbStub {
  sb: any;
  pageReg: { name: string; match: { url: RegExp | ((u: URL) => boolean) }; mount: any }[];
  busPubs: { topic: string; data: unknown }[];
  fireBus: (topic: string, data: unknown) => void;
}

function makeSbStub(): SbStub {
  const pageReg: SbStub['pageReg'] = [];
  const busPubs: SbStub['busPubs'] = [];
  const busSubs = new Map<string, Set<(d: unknown) => void>>();
  const fireBus = (topic: string, data: unknown): void => {
    const set = busSubs.get(topic);
    if (!set) return;
    for (const cb of set) cb(data);
  };
  const scopeCtrl = new AbortController();
  return {
    sb: {
      context: { kind: 'web', url: location.href, onUrlChange: () => () => {} },
      pages: {
        register: (o: any) => { pageReg.push(o); return { unregister: () => {} }; },
      },
      bus: {
        publish: (topic: string, data: unknown) => { busPubs.push({ topic, data }); },
        subscribe: (topic: string, cb: (d: unknown) => void) => {
          let s = busSubs.get(topic);
          if (!s) { s = new Set(); busSubs.set(topic, s); }
          s.add(cb);
          return () => { s!.delete(cb); };
        },
      },
      steam: {
        getCurrentUser: () => null,
        getCurrentUserAsync: () => new Promise<unknown>(() => {}),
        onUserChange: () => () => {},
        openUrl: async () => {},
      },
      lifecycle: { ready: async () => {}, rollbackAll: () => {}, _markReady: () => {} },
      scope: {
        signal: scopeCtrl.signal,
        _abort: () => scopeCtrl.abort(),
      },
    } as any,
    pageReg,
    busPubs,
    fireBus,
  };
}

const SNAPSHOT_KEYS = [
  'window', 'document', 'history', 'location', 'MutationObserver',
  'Event', 'KeyboardEvent', 'HTMLElement', 'HTMLInputElement',
  'HTMLButtonElement', 'addEventListener', 'removeEventListener',
] as const;
let snapGlobals: Record<string, unknown> = {};

const findMount = (pageReg: SbStub['pageReg']) =>
  pageReg.find((p) => p.name === 'booster-addfunds-cart')!.mount;

describe('registerCartPage', () => {
  beforeEach(() => {
    snapGlobals = {};
    for (const k of SNAPSHOT_KEYS) {
      snapGlobals[k] = (globalThis as Record<string, unknown>)[k];
    }
    installDom();
  });

  afterEach(() => {
    for (const k of SNAPSHOT_KEYS) {
      const v = snapGlobals[k];
      if (v === undefined) delete (globalThis as Record<string, unknown>)[k];
      else (globalThis as Record<string, unknown>)[k] = v;
    }
  });

  test('balance < total → bar prefilled with ceil(shortfall) after "Ваша корзина"', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="panel"><div class="hdr">Ваша корзина</div></div>
             <div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    expect((bar.querySelector('.booster-topup-input') as HTMLInputElement).value).toBe('14031'); // ceil(19031-5000)
    expect(bar.querySelector('.booster-topup-label')!.textContent).toBe('Вам не хватает баланса');
  });

  test('balance >= total → no bar', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 99999 });
    setBody(`<div class="hdr">Ваша корзина</div><div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('no snapshot → no bar; no total → no bar', async () => {
    // With NO snapshot fired, no bar (balance unknown).
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    setBody(`<div class="hdr">Ваша корзина</div><div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
    // Snapshot present but no "Общая стоимость" total in the DOM → still no bar.
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="hdr">Ваша корзина</div><div class="t">no total here</div>`);
    await tick(400);
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  test('reactive: total drops below balance after mutation → bar removed', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="hdr">Ваша корзина</div><div class="t"><div>Общая стоимость</div><div class="val">19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    // user removes an item → total now below balance
    (document.querySelector('.val') as HTMLElement).textContent = '4 000,00₸';
    await tick(400); // cross the debounce
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

  // Steam now renders the cart header with an item counter and a breadcrumb
  // copy of the same text: "Ваша корзина (товаров: 3)". Real markup, captured
  // from store.steampowered.com/cart/ (class names are hashed CSS-modules).
  const CART_MARKUP = `
    <div class="Panel Focusable">
      <div class="crumbs"><a href="/">Домашняя страница</a><span>&gt; Ваша корзина (товаров: 3)</span></div>
      <div class="hdr">Ваша корзина (товаров: 3)</div>
      <div class="items">Life is Strange: Double Exposure20 000,00₸</div>
    </div>
    <div class="t"><div>Общая стоимость</div><div>28 930,00₸</div></div>`;

  test('header with item counter → bar still renders', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 17181.65 });
    setBody(CART_MARKUP);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    expect((bar.querySelector('.booster-topup-input') as HTMLInputElement).value).toBe('11749'); // ceil(28930-17181.65)
  }, 15000);

  test('bar anchors to the real header, not the breadcrumb', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 17181.65 });
    setBody(CART_MARKUP);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    expect(document.querySelector('.hdr')!.nextElementSibling).toBe(bar);
    expect(document.querySelector('.crumbs')!.contains(bar)).toBe(false);
  }, 15000);

  // Resilience: the header text is Steam's, not ours — it can be reworded or
  // localized. The total label is the ONE anchor the feature genuinely needs
  // (no total → no shortfall to show), so a missing header must degrade to
  // anchoring off the total block instead of silently rendering nothing.
  // Regression: the store supernav has its own "Корзина" link, and it comes
  // FIRST in document order. Matching the bare word put the bar inside that
  // <a> in the page header (observed live, rect y=-15, off-screen).
  test('supernav "Корзина" link is never used as the anchor', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="nav"><a class="cartlink" href="/cart/"><div>Корзина</div><div>3</div></a></div>
             <div class="panel">
               <div class="crumbs"><a href="/">Домашняя страница</a><span>&gt; Ваша корзина (товаров: 3)</span></div>
               <div class="hdr">Ваша корзина (товаров: 3)</div>
             </div>
             <div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    const bar = document.getElementById('booster-topup-bar')!;
    expect(bar).not.toBeNull();
    expect(document.querySelector('.cartlink')!.contains(bar)).toBe(false);
    expect(document.querySelector('.hdr')!.nextElementSibling).toBe(bar);
  }, 15000);

  test('header text changed entirely → bar falls back above the total block', async () => {
    const warned: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => { warned.push(a.join(' ')); };
    try {
      const { sb, pageReg, fireBus } = makeSbStub();
      registerCartPage(sb);
      fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
      setBody(`<div class="wrap">
                 <div class="hdr">Shopping Cart</div>
                 <div class="totalblock"><div>Общая стоимость</div><div>19 031,00₸</div></div>
               </div>`);
      await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
      await tick();
      const bar = document.getElementById('booster-topup-bar')!;
      expect(bar).not.toBeNull();
      expect(document.querySelector('.totalblock')!.previousElementSibling).toBe(bar);
      expect(warned.join('\n')).toContain('cart header not found');
    } finally {
      console.warn = origWarn;
    }
  }, 15000);

  test('neither header nor total → no bar, and it says so', async () => {
    const warned: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => { warned.push(a.join(' ')); };
    try {
      const { sb, pageReg, fireBus } = makeSbStub();
      registerCartPage(sb);
      fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
      setBody(`<div class="wrap">Steam redesigned this page</div>`);
      await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
      await tick();
      expect(document.getElementById('booster-topup-bar')).toBeNull();
      expect(warned.join('\n')).toContain('no anchor');
    } finally {
      console.warn = origWarn;
    }
  }, 15000);

  test('reactive: balance update via new snapshot recomputes', async () => {
    const { sb, pageReg, fireBus } = makeSbStub();
    registerCartPage(sb);
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
    setBody(`<div class="hdr">Ваша корзина</div><div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
    await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
    await tick();
    expect(document.getElementById('booster-topup-bar')).not.toBeNull();
    fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 99999 }); // topped up
    await tick();
    expect(document.getElementById('booster-topup-bar')).toBeNull();
  });

// Steam lays the cart out as a flex row: [items column | summary column].
// Inserting the bar as a sibling ABOVE that row pushed BOTH columns down, so
// the "Общая стоимость / Перейти к оплате" panel sank by the bar's height.
// The bar belongs INSIDE the items column instead.
const TWO_COLUMN_MARKUP = `
  <div class="Panel">
    <div class="hdr">Ваша корзина (товаров: 3)</div>
    <div class="row" style="display:flex">
      <div class="items"><div class="game">Life is Strange</div></div>
      <div class="summary"><div class="hidden-copy" style="display:none"><div>Общая стоимость</div><div>28 930,00₸</div></div><div><div>Общая стоимость</div><div>28 930,00₸</div></div></div>
    </div>
  </div>`;

test('bar goes inside the items column, leaving the summary column in place', async () => {
  const { sb, pageReg, fireBus } = makeSbStub();
  registerCartPage(sb);
  fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 17181.65 });
  setBody(TWO_COLUMN_MARKUP);
  await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
  await tick();
  const bar = document.getElementById('booster-topup-bar')!;
  expect(bar).not.toBeNull();
  // Inside the items column, first child — above the game list.
  expect(document.querySelector('.items')!.contains(bar)).toBe(true);
  expect(document.querySelector('.items')!.firstElementChild).toBe(bar);
  // NOT a sibling of the flex row, which is what pushed the summary down.
  expect(document.querySelector('.row')!.previousElementSibling).not.toBe(bar);
  expect(document.querySelector('.summary')!.contains(bar)).toBe(false);
});

test('falls back to the header anchor when there is no two-column row', async () => {
  const { sb, pageReg, fireBus } = makeSbStub();
  registerCartPage(sb);
  fireBus('booster-checkout.user.snapshot', { accountName: 'u', currency: 'KZT', balance: 5000 });
  setBody(`<div class="panel"><div class="hdr">Ваша корзина</div></div>
           <div class="t"><div>Общая стоимость</div><div>19 031,00₸</div></div>`);
  await findMount(pageReg)({ url: new URL('https://store.steampowered.com/cart/'), signal: new AbortController().signal });
  await tick();
  const bar = document.getElementById('booster-topup-bar')!;
  expect(bar).not.toBeNull();
  expect(document.querySelector('.hdr')!.nextElementSibling).toBe(bar);
});
});
