import type { PluginMeta } from '@steambalance/booster-framework/testing';

// version is a placeholder; overridden at build time by reading
// package.json::version (see build.ts). One source of truth — no env override.
export const pluginMeta: PluginMeta = {
  id: 'booster-rateaccount',
  version: '0.0.0',
  apiVersion: 1,
  contextKinds: ['main'],
  urlPatterns: [],
  grantedCapabilities: ['ui', 'steam'],
};
