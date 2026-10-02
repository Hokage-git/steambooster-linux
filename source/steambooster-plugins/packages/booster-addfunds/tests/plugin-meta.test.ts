import { test, expect } from 'bun:test';
import { pluginMeta } from '../src/plugin-meta';

test('addfunds declares net + steambalance.cc host', () => {
  expect(pluginMeta.grantedCapabilities).toContain('net');
  expect(pluginMeta.allowedHosts).toContain('steambalance.cc');
});
