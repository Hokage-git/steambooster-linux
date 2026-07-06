// Business-facing URLs owned by this plugin. Per project convention plugins
// hardcode their own URLs here; framework code never hardcodes URLs.

/** SteamBalance games catalog, opened in the main Steam window from the
 *  "Каталог игр" item injected into Steam's МАГАЗИН supernav. */
export const CATALOG_URL = 'https://steambalance.cc/booster/catalog';

/** Backend endpoint for the region-games carousel, fetched via sb.net. */
export const CATALOGUE_API = 'https://steambalance.cc/api/booster/catalogue';

/** Promo link opened when the region-games carousel background is clicked. */
export const REGION_GAMES_PROMO_URL = 'https://steambalance.cc/c/5533';

/** Steam-keys list endpoint, fetched directly via sb.net once checkout has
 *  broadcast paymentId + storeCountry (see lib/keys-config.ts). Same
 *  endpoint booster-checkout's main-shell fetches for the bus fallback. */
export const STEAM_KEYS_API = 'https://steambalance.cc/api/services/steam_keys';
