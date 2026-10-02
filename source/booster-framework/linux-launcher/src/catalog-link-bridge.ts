/**
 * Script installed before navigation in Steam web targets.  The SteamBalance
 * catalogue is intentionally embedded in the framework window, but Steam
 * Store refuses to render inside a cross-origin iframe.  The catalogue page
 * itself cannot know about our wrapper, so promote ordinary game-card clicks
 * to the top-level browsing context.
 *
 * Keep this script self-contained: CDP serialises it and executes it in every
 * frame, including the cross-origin catalogue iframe.
 */
export const CATALOG_LINK_BRIDGE_SCRIPT = `
(function () {
  if (window.__sbCatalogueLinkBridgeInstalled) return;
  if (location.hostname !== 'steambalance.cc' ||
      !location.pathname.startsWith('/booster/catalogue')) return;
  window.__sbCatalogueLinkBridgeInstalled = true;
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey) return;
    var node = event.target;
    if (!(node instanceof Element)) return;
    // The official catalogue handles purchase buttons through purchaseKey.
    if (node.closest('button, [role=button]')) return;
    var anchor = node.closest('a[href]');
    if (!anchor) return;
    var href;
    try { href = new URL(anchor.href, location.href); } catch (_) { return; }
    if (href.protocol !== 'https:' || href.hostname !== 'store.steampowered.com' ||
        !/^\\/app\\/\\d+(?:\\/|$)/.test(href.pathname)) return;
    // The default target is this iframe.  A top-level navigation keeps the
    // same Steam window and lets Store apply its normal frame policy.
    event.preventDefault();
    window.top.location.assign(href.href);
  }, true);
})();
`;
