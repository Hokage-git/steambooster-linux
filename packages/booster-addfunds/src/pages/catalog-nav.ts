import type { SbApi } from '@steambalance/booster-framework/api-types';
import { SB_SWIRL_SVG } from '../lib/icons';
import { CATALOG_URL } from '../urls';
import { LL } from '../i18n';

// Registers the persistent catalog button into the Steam store top-nav bar
// (left of the first store-nav tab), on every store page. The framework's
// sb.ui.addStoreNavButton owns the durable anchor + reconcile across React
// re-renders; this module just supplies the catalog specifics. Coexists with
// the store-supernav dropdown catalog item (main context, main/install.ts).
//
// NOTE: keep this file free of Cyrillic literals (plugins-repo convention:
// comments in English; Cyrillic only in strings/*.json or behind a
// // strings-allow-cyrillic pragma). The visible label comes from LL.
export function registerCatalogNav(sb: SbApi): void {
  sb.pages.register({
    name: 'booster-addfunds-catalog-nav',
    match: { url: /^https:\/\/store\.steampowered\.com(\/|$)/ },
    mount: () => {
      const handle = sb.ui.addStoreNavButton({
        id: 'booster-catalog-nav',
        label: LL.addfunds.catalog_menu_item(),
        icon: SB_SWIRL_SVG,
        url: CATALOG_URL,
        variant: 'brand',
        placement: 'start',
      });
      return () => handle.remove();
    },
  });
}
