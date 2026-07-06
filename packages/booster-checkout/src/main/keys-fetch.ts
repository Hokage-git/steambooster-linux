import type { SbApi } from '@steambalance/booster-framework/api-types';
import { URLS } from '../urls';

export interface KeyItem {
  itemId: number;
  name: string;
  isActive: boolean;
  regionLabel: string;
  packageId: number | null;
  productType: string | null;
  price: number;
  oldPrice: number | null;
  discountPercent: number;
}

function toKeyItem(raw: unknown): KeyItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || typeof r.price !== 'number') return null;
  const pkg = (r.package && typeof r.package === 'object') ? r.package as Record<string, unknown> : null;
  return {
    itemId: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    isActive: r.is_active === true,
    regionLabel: typeof r.region_label === 'string' ? r.region_label : '',
    packageId: pkg && typeof pkg.id === 'number' ? pkg.id : null,
    productType: pkg && typeof pkg.product_type === 'string' ? pkg.product_type : null,
    price: r.price,
    oldPrice: typeof r.old_price === 'number' ? r.old_price : null,
    discountPercent: typeof r.discount_percent === 'number' ? r.discount_percent : 0,
  };
}

export async function fetchKeys(
  sb: SbApi,
  args: { appid: number; paymentId: string; storeCountry?: string },
): Promise<KeyItem[]> {
  try {
    const q = new URLSearchParams({ paymentId: args.paymentId, appid: String(args.appid) });
    if (args.storeCountry) q.set('store_country', args.storeCountry);
    const r = await sb.net.fetch(`${URLS.steamKeysApi}?${q.toString()}`, { method: 'GET' });
    if (!r.ok) return [];
    const body = await r.json() as unknown;
    const items = (body as { data?: { items?: unknown } })?.data?.items;
    if (!Array.isArray(items)) return [];
    return items.map(toKeyItem).filter((x): x is KeyItem => x !== null);
  } catch { return []; }
}
