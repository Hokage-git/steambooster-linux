#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CDPTarget {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface LauncherArgs {
  steamPath: string;
  cdpPort: number;
  frameworkPath: string;
  devPlugins: string[];
  waitForSteam: boolean;
}

function parseArgs(argv: string[]): LauncherArgs {
  const args: LauncherArgs = {
    steamPath: process.env.SB_STEAM_PATH ?? findSteamExecutable(),
    cdpPort: Number(process.env.SB_CDP_PORT ?? 8080),
    frameworkPath: process.env.SB_FRAMEWORK_PATH ?? resolve(__dirname, '../../out/booster-framework.js'),
    devPlugins: [],
    waitForSteam: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--steam-path' || arg === '-s') {
      args.steamPath = argv[++i];
    } else if (arg === '--cdp-port' || arg === '-p') {
      args.cdpPort = Number(argv[++i]);
    } else if (arg === '--framework' || arg === '-f') {
      args.frameworkPath = argv[++i];
    } else if (arg === '--dev-plugin' || arg === '-d') {
      args.devPlugins.push(argv[++i]);
    } else if (arg === '--wait-for-steam' || arg === '-w') {
      args.waitForSteam = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: steambooster-linux [options]

Options:
  -s, --steam-path <path>    Path to steam executable (default: auto-detect)
  -p, --cdp-port <number>    CDP port (default: 9222)
  -f, --framework <path>     Path to booster-framework.js IIFE bundle
                             (default: ../../out/booster-framework.js)
  -d, --dev-plugin <path>    Dev plugin bundle (repeatable)
  -w, --wait-for-steam       Attach to already-running Steam instead of launching
  -h, --help                 Show this help

Environment variables:
  SB_STEAM_PATH, SB_CDP_PORT, SB_FRAMEWORK_PATH
`);
}

function findSteamExecutable(): string {
  const candidates = [
    '/usr/bin/steam',
    '/usr/games/steam',
    `${process.env.HOME}/.local/share/Steam/steam.sh`,
    `${process.env.HOME}/.steam/steam/steam.sh`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'steam';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForCDP(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(250);
  }
  throw new Error(`CDP port ${port} did not become available within ${timeoutMs}ms`);
}

async function listTargets(port: number, timeoutMs = 60_000): Promise<CDPTarget[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!res.ok) throw new Error(`failed to list CDP targets: ${res.status}`);
      const list = (await res.json()) as CDPTarget[];
      if (list.length > 0) return list;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  throw new Error(`CDP target list stayed empty for ${timeoutMs}ms`);
}

function pickSteamMainTarget(targets: CDPTarget[]): CDPTarget | undefined {
  // Steam's main shell title varies by skin; prefer the target whose URL
  // looks like the client shell (about:blank with createflags) or simply
  // the one titled "Steam".
  return targets.find((t) =>
    t.title === 'Steam' &&
    (t.url.startsWith('about:blank') || t.url.startsWith('https://store.steampowered.com')),
  ) ?? targets.find((t) => t.title === 'Steam');
}

interface ManifestEntry {
  id: string;
  version: string;
  apiVersion: number;
  contextKinds: string[];
  grantedCapabilities: string[];
  required: boolean;
  url: string;
  sha256: string;
  token: string;
}

interface PluginsManifest {
  injectorVersion: string;
  contextKind: string;
  userDisabledPlugins: string[];
  plugins: ManifestEntry[];
  _sec: Record<string, string>;
}

function buildManifest(args: LauncherArgs): PluginsManifest {
  const plugins: ManifestEntry[] = args.devPlugins.map((path) => {
    const name = path.split('/').pop()!.replace(/\.js$/, '');
    const id = name.replace(/^(booster-plugin-)?/, '');
    return {
      id,
      version: '0.0.1',
      apiVersion: 1,
      contextKinds: ['main'],
      grantedCapabilities: ['ui', 'steam', 'configs', 'bus', 'pages', 'keys', 'net'],
      required: false,
      url: `file://${resolve(path)}`,
      sha256: '0'.repeat(64), // dev only; framework may warn but should allow
      token: `token-${id}-${Math.random().toString(36).slice(2)}`,
    };
  });

  return {
    injectorVersion: 'linux-dev-0.0.1',
    contextKind: 'main',
    userDisabledPlugins: [],
    plugins,
    _sec: {
      frameworkToken: 'linux-framework-token',
      resolverName: '__sb_resolve',
      busDispatchName: '__sb_bus_dispatch',
      relaySecret: 'linux-relay-secret',
    },
  };
}

function buildBootstrapPrefix(manifest: PluginsManifest): string {
  return `
(function(){
  globalThis.__SB_PLUGINS_MANIFEST__ = ${JSON.stringify(manifest)};
  globalThis.__sb_native = function(payload) {
    const envelope = JSON.parse(payload);
    console.log('[sb-native]', JSON.stringify(envelope));
    // Linux MVP: most native ops are not implemented. Answer get_setup_id
    // so prefetchSetupId does not hang; everything else is left pending.
    if (envelope.op === 'get_setup_id' && typeof envelope.requestId === 'number') {
      if (typeof globalThis.__sb_resolve === 'function') {
        globalThis.__sb_resolve(envelope.requestId, { ok: true, result: null });
      }
    }
  };
  globalThis.__sb_resolve = function(requestId, response) {
    console.log('[sb-resolve]', requestId, JSON.stringify(response));
  };
})();
`;
}

class CDPSession {
  private ws: WebSocket;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private id = 0;
  private openPromise: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
    });
    this.ws.onmessage = (event) => this.handleMessage(event.data as string);
    this.ws.onclose = () => {
      for (const p of this.pending.values()) {
        p.reject(new Error('CDP session closed'));
      }
      this.pending.clear();
    };
  }

  async ready(): Promise<void> {
    await this.openPromise;
    // Enable runtime events so we can see framework/plugin logs and exceptions.
    await this.send('Runtime.enable', {});
  }

  private handleMessage(data: string): void {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const params = msg.params as { type?: string; args?: { value?: unknown }[] };
      const text = params.args?.map((a) => (typeof a.value === 'string' ? a.value : JSON.stringify(a.value))).join(' ') ?? '';
      console.log(`[steam-console:${params.type ?? 'log'}]`, text);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = (msg.params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }).exceptionDetails;
      console.error('[steam-exception]', details?.text, details?.exception?.description ?? '');
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function evaluate(session: CDPSession, expression: string): Promise<unknown> {
  return session.send('Runtime.evaluate', {
    expression,
    includeCommandLineAPI: true,
    returnByValue: true,
    awaitPromise: true,
  });
}

async function injectBundle(session: CDPSession, frameworkPath: string, manifest: PluginsManifest): Promise<void> {
  const bundle = readFileSync(frameworkPath, 'utf8');
  const prefix = buildBootstrapPrefix(manifest);

  console.log('[linux-launcher] injecting manifest + bridge stubs...');
  const prefixResult = await evaluate(session, prefix);
  if ((prefixResult as Record<string, unknown>)?.exceptionDetails) {
    throw new Error(`manifest injection failed: ${JSON.stringify(prefixResult)}`);
  }

  console.log('[linux-launcher] injecting booster-framework bundle...');
  const bundleResult = await evaluate(session, bundle);
  if ((bundleResult as Record<string, unknown>)?.exceptionDetails) {
    throw new Error(`framework injection failed: ${JSON.stringify(bundleResult)}`);
  }

  console.log('[linux-launcher] verifying window.sb...');
  const verify = await evaluate(session, `typeof window.sb`);
  const verifyResult = verify as { result?: { value?: unknown } } | undefined;
  console.log('[linux-launcher] window.sb =', verifyResult?.result?.value);
}

async function injectDevPlugins(session: CDPSession, manifest: PluginsManifest): Promise<void> {
  for (const entry of manifest.plugins) {
    const path = entry.url.replace('file://', '');
    const code = readFileSync(path, 'utf8');
    console.log(`[linux-launcher] injecting dev plugin ${entry.id}...`);
    const bootPrefix = `
(function(){
  globalThis.__SB_PLUGIN_BOOT__ = ${JSON.stringify({ id: entry.id, token: entry.token })};
})();
`;
    const bootResult = await evaluate(session, bootPrefix);
    if ((bootResult as Record<string, unknown>)?.exceptionDetails) {
      console.warn(`[linux-launcher] plugin boot prefix failed: ${JSON.stringify(bootResult)}`);
      continue;
    }
    const result = await evaluate(session, code);
    if ((result as Record<string, unknown>)?.exceptionDetails) {
      console.warn(`[linux-launcher] plugin injection failed: ${JSON.stringify(result)}`);
    }
  }
}

async function launchSteam(args: LauncherArgs): Promise<ChildProcess | undefined> {
  if (args.waitForSteam) return undefined;
  console.log(`[linux-launcher] launching Steam: ${args.steamPath}`);
  const child = spawn(args.steamPath, [`-cef-enable-debugging`, `--remote-debugging-port=${args.cdpPort}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => console.error('[linux-launcher] Steam spawn error:', err));
  child.on('exit', (code) => console.log('[linux-launcher] Steam exited with code', code));
  return child;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.frameworkPath)) {
    console.error(`framework bundle not found: ${args.frameworkPath}`);
    process.exit(1);
  }

  for (const p of args.devPlugins) {
    if (!existsSync(p)) {
      console.error(`dev plugin not found: ${p}`);
      process.exit(1);
    }
  }

  await launchSteam(args);
  console.log(`[linux-launcher] waiting for CDP on port ${args.cdpPort}...`);
  await waitForCDP(args.cdpPort);

  const targets = await listTargets(args.cdpPort);
  console.log(`[linux-launcher] found ${targets.length} CDP targets`);
  for (const t of targets) {
    console.log(`  - [${t.type}] "${t.title}" ${t.url}`);
  }

  const target = pickSteamMainTarget(targets);
  if (!target?.webSocketDebuggerUrl) {
    console.error('[linux-launcher] could not find Steam main shell target');
    process.exit(1);
  }
  console.log(`[linux-launcher] attaching to target: ${target.title} (${target.url})`);

  const session = new CDPSession(target.webSocketDebuggerUrl);
  await session.ready();
  console.log('[linux-launcher] CDP session ready');

  const manifest = buildManifest(args);
  await injectBundle(session, args.frameworkPath, manifest);
  await injectDevPlugins(session, manifest);

  console.log('[linux-launcher] injection complete; keeping alive (Ctrl+C to stop)');
  // Keep process alive so the session persists; in future we will route
  // __sb_native calls back through CDP here.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('[linux-launcher] fatal:', err);
  process.exit(1);
});
