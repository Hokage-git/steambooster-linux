// Стратегия поиска Steam header (Spike-4 + reference prototype):
// PRIMARY: .avatarHolder (профиль) → walk-up до родителя с >=3 .Focusable детьми = toolbar.
//   Это структурный приём, переживает CSS-modules рестайлинг лучше чем класс-префиксы.
// FALLBACK: классические class-prefix selectors на случай если структура поменяется.

const STRUCTURAL = '.avatarHolder';

const FALLBACK_SELECTORS: ReadonlyArray<string> = [
  '[class*="topbar_TopBar_"]',
  '[class*="topbar_Topbar_"]',
  '[class^="topbar_"]',
  'header[role="banner"]',
] as const;

let lastToolbarLog = '';

export function findToolbar(): HTMLElement | null {
  const avatars = Array.from(document.querySelectorAll(STRUCTURAL));
  let best: { parent: HTMLElement; score: number } | null = null;
  let any: HTMLElement | null = null;
  for (const avatar of avatars) {
    const focusable = avatar.closest('.Focusable');
    const parent = focusable?.parentElement as HTMLElement | null | undefined;
    const focusables = parent ? Array.from(parent.querySelectorAll(':scope > .Focusable')) : [];
    const avatarRect = avatar.getBoundingClientRect();
    const toolbarRect = parent ? parent.getBoundingClientRect() : new DOMRect();
    const visible = avatarRect.width > 0 && avatarRect.height > 0 && toolbarRect.width > 0 && toolbarRect.height > 0;
    const inTop = toolbarRect.y >= 0 && toolbarRect.y < 100;
    const score = toolbarRect.y;
    if (parent && focusables.length >= 3) {
      if (!any) any = parent;
      if (visible && inTop && (best === null || score < best.score)) {
        best = { parent, score };
      }
    }
  }
  const result = best?.parent ?? any ?? null;
  const logKey = result ? result.className : (avatars.length === 0 ? 'no-avatars' : 'no-toolbar');
  if (logKey !== lastToolbarLog) {
    lastToolbarLog = logKey;
    if (best) {
      console.log('[sb-findToolbar] picked best toolbar at y=', best.score, 'classes=', best.parent.className);
    } else if (any) {
      console.log('[sb-findToolbar] picked first available toolbar classes=', any.className);
    } else if (avatars.length === 0) {
      console.log('[sb-findToolbar] avatar not found');
    } else {
      console.log('[sb-findToolbar] no toolbar found');
    }
  }
  if (result) return result;
  for (const sel of FALLBACK_SELECTORS) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      console.log('[sb-findToolbar] fallback matched:', sel, 'tag:', el.tagName, 'classes:', el.className);
      return el;
    }
  }
  return null;
}

export async function waitForToolbar(timeoutMs = 10000): Promise<HTMLElement | null> {
  const found = findToolbar();
  if (found) return found;

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const el = findToolbar();
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}
