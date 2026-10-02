import { test, expect } from 'bun:test';
import { pluginMeta } from '../src/plugin-meta';

// Manifest-sidecar coverage for the sb.net migration: the checkout main-shell
// now calls sb.net.fetch (keys-fetch.ts / keys-order.ts), so the plugin must
// declare Capability.Net + the host it's allowed to reach.
test('grants Capability.Net and allows the steambalance.cc host', () => {
  expect(pluginMeta.grantedCapabilities).toContain('net');
  expect(pluginMeta.allowedHosts).toContain('steambalance.cc');
});
