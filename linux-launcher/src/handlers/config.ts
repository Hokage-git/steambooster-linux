import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

function configDir(): string {
  return resolve(process.env.HOME ?? '/tmp', '.config', 'steambooster-linux');
}

function configPath(pluginId: string, name: string): string {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
    throw new Error('invalid config name');
  }
  return resolve(configDir(), `${pluginId}_${name}.json`);
}

export function readConfig(pluginId: string, name: string): unknown {
  const path = configPath(pluginId, name);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { v?: number; d?: unknown };
    if (parsed.v !== 1) return null;
    return parsed.d ?? null;
  } catch {
    return null;
  }
}

export function writeConfig(pluginId: string, name: string, value: unknown): void {
  const path = configPath(pluginId, name);
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const envelope = { v: 1, d: value };
  writeFileSync(path, JSON.stringify(envelope), 'utf8');
}

export function getSetupId(): string {
  const dir = configDir();
  const setupIdPath = resolve(dir, 'setup_id');
  if (existsSync(setupIdPath)) {
    return readFileSync(setupIdPath, 'utf8').trim();
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = randomBytes(16).toString('hex');
  writeFileSync(setupIdPath, id, 'utf8');
  return id;
}

type StoreCountries = Record<string, string>;

function storeCountriesPath(): string {
  return resolve(configDir(), 'store-countries.json');
}

function validateSteamId(steamId: unknown): steamId is string {
  return typeof steamId === 'string' && /^\d{17}$/.test(steamId);
}

function validateCountry(country: unknown): country is string {
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country);
}

function readStoreCountries(): StoreCountries {
  try {
    const parsed = JSON.parse(readFileSync(storeCountriesPath(), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([steamId, country]) =>
      validateSteamId(steamId) && validateCountry(country),
    ));
  } catch {
    return {};
  }
}

export function getStoreCountry(steamId: unknown): string | null {
  if (!validateSteamId(steamId)) throw new Error('invalid steamId');
  return readStoreCountries()[steamId] ?? null;
}

export function setStoreCountry(steamId: unknown, country: unknown): void {
  if (!validateSteamId(steamId)) throw new Error('invalid steamId');
  if (!validateCountry(country)) throw new Error('invalid country');
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = storeCountriesPath();
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, JSON.stringify({ ...readStoreCountries(), [steamId]: country }), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, path);
}
