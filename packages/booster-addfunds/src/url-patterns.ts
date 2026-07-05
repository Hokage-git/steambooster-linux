// Single source of truth for the plugin's eligibility urlPatterns. Imported by
// BOTH index.ts (sb.plugins.register bundle metadata) and plugin-meta.ts
// (manifest sidecar). crossValidate requires bundle.urlPatterns ⊆
// manifest.urlPatterns by STRING equality — one shared constant makes drift
// impossible.
//
// WHOLE-SITE match: the plugin is eligible on ANY store.steampowered.com page.
// The framework checks eligibility ONCE at bootstrap against location.href
// (bootstrap.ts::filterEligiblePlugins), so a narrow gate would skip the plugin
// entirely on a session that entered at the store home / wishlist / search —
// where the catalog store-nav button must still appear. Per-feature
// scoping (topup bar → /addfunds, keys offer → /app/<id>, cart → /cart,
// catalog button → all store pages) is done INSIDE the plugin via sb.pages.
//
// Shape note: `(/.*)?$`, NOT the `([/?#].*)?$` tail used on concrete-path
// patterns — as a whole-site matcher that tail would match ONLY the bare home
// and fail on `/wishlist`, `/search`, `/app/…`. The anchored `$` + optional
// `/…` also rejects the `store.steampowered.com.evil.com` suffix attack.
export const ADDFUNDS_URL_PATTERNS: string[] = [
  '^https://store\\.steampowered\\.com(/.*)?$',
];
