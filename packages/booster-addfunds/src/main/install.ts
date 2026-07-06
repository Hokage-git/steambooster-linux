import type { PluginContext, MenuItemHandle } from '@steambalance/booster-framework';
import { SB_SWIRL_SVG } from '../lib/icons';
import { STORE_MENU_CATALOG_URL } from '../urls';
import { LL } from '../i18n';

/**
 * Main-context entry point (ContextKind.Main — the Steam desktop client
 * shell). Adds the catalog item to the top of Steam's store top-nav
 * dropdown; clicking it opens the SteamBalance catalog in the main window.
 * (Label text lives in strings/ru.json via LL.)
 *
 * The DOM work happens in the SharedJSContext relay (the supernav popup is
 * reachable only from there); `sb.ui.addMenuItem` relays the intent and the
 * relay keeps the item alive across menu open/close and framework re-inject.
 *
 * The returned teardown removes the item; `sb.ui.addMenuItem`'s handle also
 * registers a framework-registry undo, so rollback removes it even without
 * the explicit call.
 */
export async function installAddFundsMain(ctx: PluginContext): Promise<() => void> {
  const sb = ctx.sb;
  await sb.lifecycle.ready();

  let handle: MenuItemHandle | null = null;

  // add-menu-item is a one-shot BroadcastChannel RPC. On a fresh launch the
  // SharedJSContext relay may not have subscribed yet when we fire (and a menu
  // item, unlike a popup, has no user-triggered second chance) — so retry with
  // backoff, bailing early if the plugin scope aborts (rollback).
  const MAX_TRIES = 6;
  for (let attempt = 0; attempt < MAX_TRIES && !ctx.signal.aborted; attempt++) {
    try {
      handle = await sb.ui.addMenuItem({
        id: 'booster-catalog',
        menu: 'store',
        label: LL.addfunds.catalog_menu_item(),
        icon: SB_SWIRL_SVG,
        url: STORE_MENU_CATALOG_URL,
        variant: 'brand',
        placement: 'top',
      });
      break;
    } catch (e) {
      ctx.log.warn(`addMenuItem attempt ${attempt + 1}/${MAX_TRIES} failed`, { error: String(e) });
      if (attempt < MAX_TRIES - 1) {
        try { await delay(ctx, 300 * (attempt + 1)); } catch { break; }
      }
    }
  }

  return () => {
    if (handle) { handle.remove(); handle = null; }
  };
}

/** scope-bound delay that rejects on plugin-scope abort so a rollback mid-retry
 *  doesn't leave the loop awaiting a dead timer. */
function delay(ctx: PluginContext, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (ctx.signal.aborted) { reject(new Error('aborted')); return; }
    const id = ctx.scope.setTimeout(resolve, ms);
    ctx.signal.addEventListener('abort', () => {
      ctx.scope.clearTimeout(id);
      reject(new Error('aborted'));
    }, { once: true });
  });
}
