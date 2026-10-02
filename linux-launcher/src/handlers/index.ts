import { readConfig, writeConfig, getSetupId, getStoreCountry, setStoreCountry } from './config.js';

export interface NativeOp {
  op: string;
  args: Record<string, unknown>;
  requestId?: number;
  pluginId?: string;
  token?: string;
}

export function handleNativeOp(op: NativeOp): { ok: boolean; result?: unknown; error?: string } {
  try {
    switch (op.op) {
      case 'get_setup_id':
        return { ok: true, result: getSetupId() };

      case 'get_store_country':
        return { ok: true, result: { country: getStoreCountry(op.args.steamId) } };

      case 'set_store_country':
        setStoreCountry(op.args.steamId, op.args.country);
        return { ok: true, result: null };

      case 'config_read': {
        const name = op.args.name as string;
        const pluginId = op.pluginId ?? 'unknown';
        return { ok: true, result: readConfig(pluginId, name) };
      }

      case 'config_write': {
        const name = op.args.name as string;
        const value = op.args.value as unknown;
        const pluginId = op.pluginId ?? 'unknown';
        writeConfig(pluginId, name, value);
        return { ok: true, result: null };
      }

      case 'log':
        // Log envelope is handled as a notify, not a call; ignore here.
        return { ok: true, result: null };

      default:
        return { ok: false, error: `unhandled op: ${op.op}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
