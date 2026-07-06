import { describe, it, expect } from 'bun:test';
import { createTestPluginContext, Capability } from '@steambalance/booster-framework/testing';
import { installMain } from '../src/main/install';
import { LL } from '../src/i18n';
import { RATE_ACCOUNT_URL } from '../src/urls';

interface Captured {
  opts?: any;
  removed: number;
}

// Replace mockUi.addSuperNavButton with a capturing spy returning a handle spy.
function wireUi(ctx: any): Captured {
  const cap: Captured = { removed: 0 };
  const handle = {
    remove: () => { cap.removed++; },
    setLabel: () => {},
    setEnabled: () => {},
    setLoading: () => {},
    flashError: () => {},
    getRect: () => ({} as any),
  };
  ctx.sb.ui.addSuperNavButton = (opts: any) => { cap.opts = opts; return handle; };
  return cap;
}

// Record openUrl calls.
function wireSteam(ctx: any): { opened: string[] } {
  const opened: string[] = [];
  ctx.sb.steam.openUrl = async (u: string) => { opened.push(u); };
  return { opened };
}

describe('installMain', () => {
  it('adds the supernav button with the brand after-profile pill', async () => {
    const { ctx } = createTestPluginContext({ granted: [Capability.Ui, Capability.Steam] });
    wireSteam(ctx);
    const cap = wireUi(ctx);

    await installMain(ctx);

    expect(cap.opts).toBeDefined();
    expect(cap.opts.id).toBe('button');
    expect(cap.opts.label).toBe(LL.rateaccount.supernav.button_label());
    expect(typeof cap.opts.label).toBe('string');
    expect(cap.opts.label.length).toBeGreaterThan(0);
    expect(cap.opts.variant).toBe('brand');
    expect(cap.opts.placement).toBe('after-profile');
    expect(typeof cap.opts.onClick).toBe('function');
  });

  it('click navigates to the rate-account page via openUrl', async () => {
    const { ctx } = createTestPluginContext({ granted: [Capability.Ui, Capability.Steam] });
    const steam = wireSteam(ctx);
    const cap = wireUi(ctx);

    await installMain(ctx);
    await cap.opts.onClick();

    expect(steam.opened).toEqual([RATE_ACCOUNT_URL]);
  });

  it('teardown removes the button handle', async () => {
    const { ctx } = createTestPluginContext({ granted: [Capability.Ui, Capability.Steam] });
    wireSteam(ctx);
    const cap = wireUi(ctx);

    const teardown = await installMain(ctx);
    teardown();
    expect(cap.removed).toBe(1);
  });
});
