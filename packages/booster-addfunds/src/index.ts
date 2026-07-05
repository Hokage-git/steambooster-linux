import {
  ContextKind,
  Capability,
  type PluginContext,
} from '@steambalance/booster-framework';
import { installAddFundsWeb } from './install';
import { installAddFundsMain } from './main/install';
import { ADDFUNDS_URL_PATTERNS } from './url-patterns';

declare const sb: { plugins: { register: (m: unknown) => void } };
declare const __SB_PLUGIN_VERSION__: string;

sb.plugins.register({
  id: 'booster-addfunds',
  version: __SB_PLUGIN_VERSION__,
  apiVersion: 1,
  displayName: 'SteamBalance — AddFunds',
  description: 'Дополнительная строка «Пополнить кошелёк» на Steam-странице /steamaccount/addfunds.', // strings-allow-cyrillic
  contextKinds: [ContextKind.Web, ContextKind.Main],
  urlPatterns: ADDFUNDS_URL_PATTERNS,
  capabilities: [
    Capability.Ui,
    Capability.Steam,
    Capability.Configs,
    Capability.Bus,
    Capability.Pages,
  ],
  async init(ctx: PluginContext): Promise<() => void> {
    // Main = desktop client shell -> inject the catalog item into the store
    // supernav. Web = store pages -> the existing AddFunds/App/Cart page
    // enhancements. (urlPatterns gate the Web context only; the framework
    // skips them in Main.)
    if (ctx.contextKind === ContextKind.Main) {
      return await installAddFundsMain(ctx);
    }
    return await installAddFundsWeb(ctx);
  },
});
