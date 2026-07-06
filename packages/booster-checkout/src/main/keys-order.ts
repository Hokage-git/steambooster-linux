import type { SbApi } from '@steambalance/booster-framework/api-types';
import { URLS } from '../urls';

// `message` is a human, server-supplied (RU) string safe to show the user.
// `error` is a machine code for logs/telemetry — never user-facing.
export interface KeysOrderResult { ok: boolean; redirectUrl?: string; uid?: string; error?: string; message?: string }

export async function postKeysOrder(
  sb: SbApi,
  args: { paymentId: string; itemId: number; account: string; login: string },
): Promise<KeysOrderResult> {
  try {
    const r = await sb.net.fetch(URLS.steamKeysApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId: args.paymentId, itemId: args.itemId, account: args.account, login: args.login }),
    });
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    const data = (body.data && typeof body.data === 'object') ? body.data as Record<string, unknown> : {};
    const redirectUrl = (typeof data.redirectUrl === 'string' ? data.redirectUrl : undefined)
      ?? (typeof body.redirectUrl === 'string' ? body.redirectUrl : undefined);
    const uid = (typeof data.uid === 'string' ? data.uid : undefined)
      ?? (typeof body.uid === 'string' ? body.uid : undefined);
    if (!r.ok || body.success === false || !redirectUrl) {
      const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : undefined;
      return { ok: false, error: `http-${r.status}`, message };
    }
    return { ok: true, redirectUrl, uid };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}
