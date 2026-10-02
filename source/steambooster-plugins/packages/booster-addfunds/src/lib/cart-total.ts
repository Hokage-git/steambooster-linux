import { parseAmount } from './amount';

// Locate the cart "Общая стоимость" total. Anchor on the label TEXT (Steam's
// total/value CSS classes are hashed CSS-modules — unstable). The value is the
// first sibling in the label's parent that parseAmount-s to a finite number.
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

// The "Общая стоимость" label element. Exported so the cart page can anchor
// its UI off the total block when Steam's header text moves out from under us.
export function findCartTotalLabel(doc: Document): HTMLElement | null {
  return ([...doc.querySelectorAll('div')] as HTMLElement[]).find((d) => {
    const own = norm([...d.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
    return own.startsWith('Общая стоимость'); // strings-allow-cyrillic
  }) ?? null;
}

export function findCartTotal(doc: Document): number | null {
  const label = findCartTotalLabel(doc);
  const parent = label?.parentElement;
  if (!parent) return null;
  for (const child of parent.children) {
    if (child === label) continue;
    const v = parseAmount(child.textContent ?? '');
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}
