import { test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { buildRegionGamesBlock } from '../src/components/region-games-block';

beforeEach(() => {
  const w = new Window({ url: 'https://store.steampowered.com/app/1/' });
  (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
  Object.assign(globalThis, {
    document: w.document, HTMLElement: w.HTMLElement,
    HTMLAnchorElement: w.HTMLAnchorElement, HTMLImageElement: w.HTMLImageElement,
    Event: w.Event,
  });
});

const items = [
  { link: 'https://steambalance.cc/a', cover: 'https://cdn/a.jpg' },
  { link: 'https://steambalance.cc/b', cover: 'https://cdn/b.jpg' },
];

test('builds block with title, icon, and anchor cards (duplicated for loop)', () => {
  const el = buildRegionGamesBlock(items, { onBackgroundClick: () => {} });
  expect(el.id).toBe('booster-region-games');
  const anchors = el.querySelectorAll('a.rg-card');
  // K copies (>= 2 sets) → at least 2*items
  expect(anchors.length).toBeGreaterThanOrEqual(items.length * 2);
  const first = anchors[0] as HTMLAnchorElement;
  expect(first.getAttribute('href')).toBe('https://steambalance.cc/a');
  expect((first.querySelector('img') as HTMLImageElement).src).toContain('a.jpg');
  // --rg-shift set on the track
  const track = el.querySelector('.rg-track') as HTMLElement;
  expect(track.style.getPropertyValue('--rg-shift')).toMatch(/\d+px/);
});

test('background click fires onBackgroundClick; card click does not', () => {
  let bg = 0;
  const el = buildRegionGamesBlock(items, { onBackgroundClick: () => { bg++; } });
  el.click(); expect(bg).toBe(1);
  const card = el.querySelector('a.rg-card') as HTMLAnchorElement;
  // prevent jsdom navigation
  card.addEventListener('click', (e) => e.preventDefault());
  card.click();
  expect(bg).toBe(1); // stopPropagation kept bg from firing again
});
