import { test, expect } from 'bun:test';
import { CATALOGUE_API, REGION_GAMES_PROMO_URL } from '../src/urls';

test('CATALOGUE_API points at the catalogue endpoint', () => {
  expect(CATALOGUE_API).toBe('https://steambalance.cc/api/booster/catalogue');
});

test('REGION_GAMES_PROMO_URL points at the promo link', () => {
  expect(REGION_GAMES_PROMO_URL).toBe('https://steambalance.cc/c/5533');
});
