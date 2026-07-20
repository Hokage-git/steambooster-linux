import type { SbApi } from '@steambalance/booster-framework/api-types';
import { CATALOGUE_API } from '../urls';

export interface Item { link: string; cover: string; }
export type FetchResult = { status: 'ok'; items: Item[] } | { status: 'empty' } | { status: 'error' };
export interface CacheRecord { items: Item[]; fetchedAt: number; attemptedAt: number; }

export const TTL_MS = 10 * 60 * 1000;
export const CACHE_KEY = 'sb.addfunds.catalogue.v1';   // exported so tests can seed (M-4)

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export interface CatalogueParams {
  /** Store country, ISO 3166-1 alpha-2 upper (e.g. 'KZ'). */
  country?: string | null;
  /** Wallet currency, ISO 4217 (e.g. 'KZT'). */
  currency?: string | null;
  signal?: AbortSignal;
}

// Region + currency ride along as query params so the backend can tailor the
// carousel to the account. Empty/unknown values are omitted, not sent blank.
function buildCatalogueUrl(params?: CatalogueParams): string {
  const q = new URLSearchParams();
  if (params?.country) q.set('country', params.country);
  if (params?.currency) q.set('currency', params.currency);
  const qs = q.toString();
  return qs ? `${CATALOGUE_API}?${qs}` : CATALOGUE_API;
}

export async function fetchCatalogue(sb: SbApi, params?: CatalogueParams): Promise<FetchResult> {
  try {
    if (!sb || !sb.net) return { status: 'error' };
    const signal = params?.signal;
    const r = await sb.net.fetch(buildCatalogueUrl(params), signal ? { signal } : undefined);
    if (!r.ok) return { status: 'error' };
    const body = await r.json() as { success?: boolean; data?: unknown };
    if (body.success !== true || !Array.isArray(body.data)) return { status: 'error' };
    const items: Item[] = [];
    for (const e of body.data) {
      if (e && typeof e === 'object'
        && typeof (e as any).link === 'string' && typeof (e as any).cover === 'string'
        // Defense-in-depth: link becomes an <a href> click target inside the
        // store BrowserView — only allow http(s) so a compromised/malformed
        // first-party response can't smuggle a javascript:/data: href. cover is
        // an <img src>, same http(s) guard.
        && isHttpUrl((e as any).link) && isHttpUrl((e as any).cover)) {
        items.push({ link: (e as any).link, cover: (e as any).cover });
      }
    }
    return items.length ? { status: 'ok', items } : { status: 'empty' };
  } catch { return { status: 'error' }; }
}

export function readCache(): CacheRecord | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as CacheRecord;
    if (!o || !Array.isArray(o.items) || typeof o.fetchedAt !== 'number' || typeof o.attemptedAt !== 'number') return null;
    return o;
  } catch { return null; }
}
export function writeCache(rec: CacheRecord): void {
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(rec)); } catch { /* quota / unavailable */ }
}

/** Pure decision: what to render synchronously, and whether to (re)fetch. */
export function decide(now: number, cache: CacheRecord | null): { render: Item[] | null; shouldFetch: boolean } {
  if (!cache) return { render: null, shouldFetch: true };
  const hasItems = cache.items.length > 0;
  const fresh = now - cache.fetchedAt < TTL_MS;
  const backoff = now - cache.attemptedAt < TTL_MS;
  if (hasItems && fresh) return { render: cache.items, shouldFetch: false };
  if (hasItems && !fresh) return { render: cache.items, shouldFetch: !backoff };
  // no items (empty-marker or empty): render nothing; fetch only if backoff expired
  return { render: null, shouldFetch: !backoff };
}
