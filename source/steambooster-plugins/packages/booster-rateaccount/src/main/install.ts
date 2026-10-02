import type { PluginContext } from '@steambalance/booster-framework';
import { LL } from '../i18n';
import { RATE_ACCOUNT_URL } from '../urls';

export async function installMain(ctx: PluginContext): Promise<() => void> {
  const sb = ctx.sb;
  await sb.lifecycle.ready();
  const handle = sb.ui.addSuperNavButton({
    id: 'button',
    label: LL.rateaccount.supernav.button_label(),
    variant: 'brand',
    placement: 'after-profile',
    onClick: () => { void sb.steam.openUrl(RATE_ACCOUNT_URL).catch(() => { ctx.log.warn('[booster-rateaccount] navigate failed'); }); },
  });
  return () => handle.remove();
}
