import { test, expect } from 'bun:test';
import { SB_LOGO_TWOTONE_SVG } from '../src/lib/icons';

test('SB_LOGO_TWOTONE_SVG carries both brand colors and the expected viewBox', () => {
  expect(SB_LOGO_TWOTONE_SVG).toContain('#664CFE');
  expect(SB_LOGO_TWOTONE_SVG).toContain('#42D299');
  expect(SB_LOGO_TWOTONE_SVG).toContain('viewBox="0 0 30 24"');
});
