// Region-games carousel (store /app/ right column, top). Plain DOM, scoped via
// #booster-region-games. A CSS-var-driven seamless marquee: the track holds K
// copies of the item set (K >= 2) so the CSS keyframe animation can translate
// exactly one set-width and loop without a visible seam.
import type { Item } from '../lib/catalogue-api';
import { LL } from '../i18n';
import { SB_LOGO_TWOTONE_SVG } from '../lib/icons';
import SB_REGION_GAMES_CSS_RAW from './region-games-block.css' with { type: 'text' };

declare const __SB_REGION_GAMES_CSS__: string | undefined;
const SB_REGION_GAMES_CSS = typeof __SB_REGION_GAMES_CSS__ !== 'undefined' ? __SB_REGION_GAMES_CSS__ : SB_REGION_GAMES_CSS_RAW;

const CARD_WIDTH = 89;
const CARD_GAP = 8;
// Upper bound on the real `.rightcol` inner width (~348px after 24px padding) —
// deliberately generous so K never under-covers the viewport (M-3).
const VIEWPORT_EST = 396;
const SPEED_PX_S = 17.3; // ~26/1.5 — slow, calm drift (1.5× slower per client)

export interface RegionGamesBlockOptions {
  onBackgroundClick: () => void;
}

export function ensureRegionGamesStyles(): void {
  if (document.getElementById('booster-region-games-style')) return;
  const s = document.createElement('style');
  s.id = 'booster-region-games-style';
  s.textContent = SB_REGION_GAMES_CSS;
  document.head.appendChild(s);
}

export function buildRegionGamesBlock(items: Item[], opts: RegionGamesBlockOptions): HTMLElement {
  const root = document.createElement('div');
  root.id = 'booster-region-games';
  root.setAttribute('data-sb', '1');
  root.setAttribute('aria-label', LL.addfunds.region_games_aria_label());
  root.addEventListener('click', () => { opts.onBackgroundClick(); });

  const header = document.createElement('div');
  header.className = 'rg-header';
  const title = document.createElement('div');
  title.className = 'rg-title';
  title.textContent = LL.addfunds.region_games_title();
  header.appendChild(title);
  const logo = document.createElement('span');
  logo.className = 'rg-logo';
  logo.innerHTML = SB_LOGO_TWOTONE_SVG;
  header.appendChild(logo);
  root.appendChild(header);

  // Guard the empty case: setWidth would be 0 and setCount ceil(x/0) = Infinity,
  // freezing the store thread in the copy loop below. Unreachable today (callers
  // only pass non-empty item sets) but the failure mode is a hang, not a
  // misrender, so keep the guard.
  if (items.length === 0) return root;

  const viewport = document.createElement('div');
  viewport.className = 'rg-viewport';

  const track = document.createElement('div');
  track.className = 'rg-track';

  const setWidth = items.length * (CARD_WIDTH + CARD_GAP);
  const setCount = Math.max(2, Math.ceil((VIEWPORT_EST + setWidth) / setWidth));
  for (let i = 0; i < setCount; i++) {
    for (const item of items) track.appendChild(buildCard(item));
  }
  track.style.setProperty('--rg-shift', `${setWidth}px`);
  track.style.animationDuration = `${setWidth / SPEED_PX_S}s`;
  viewport.appendChild(track);

  const fadeL = document.createElement('div');
  fadeL.className = 'rg-fade-l';
  viewport.appendChild(fadeL);
  const fadeR = document.createElement('div');
  fadeR.className = 'rg-fade-r';
  viewport.appendChild(fadeR);

  root.appendChild(viewport);
  return root;
}

function buildCard(item: Item): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'rg-card';
  card.href = item.link;
  card.addEventListener('click', (e) => { e.stopPropagation(); });

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.draggable = false;
  img.alt = '';
  img.src = item.cover;
  card.appendChild(img);

  return card;
}
