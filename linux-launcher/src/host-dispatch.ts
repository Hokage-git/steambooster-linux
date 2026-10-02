export async function dispatchHostRequest(
  request: { method?: unknown; args?: unknown },
  invoke: (delegate: string, args: unknown[]) => Promise<unknown>,
): Promise<unknown> {
  const args = Array.isArray(request.args) ? request.args : [];
  switch (request.method) {
    case 'getSteamId':
      return invoke('hostAccount', ['getSteamId']);
    case 'getStoreCountry':
      if (typeof args[0] !== 'string' || !/^\d{17}$/.test(args[0])) throw new Error('bad-args');
      return invoke('hostAccount', ['getStoreCountry', args[0]]);
    case 'getRateAccountData':
      return invoke('rateAccountData', []);
    case 'activateKey':
      if (typeof args[0] !== 'string' || args[0].length === 0 || args[0].length > 256)
        throw new Error('invalid product key');
      return invoke('keysActivate', [args[0]]);
    case 'purchaseKey': {
      if (typeof args[0] !== 'number' || !Number.isSafeInteger(args[0]) || args[0] <= 0)
        throw new Error('bad-args');
      const options = args[1] as { gameName?: unknown } | null | undefined;
      const name =
        typeof options?.gameName === 'string' ? options.gameName.slice(0, 150) : undefined;
      return invoke('keysPurchase', [args[0], name]);
    }
    default:
      throw new Error('unsupported host method');
  }
}
