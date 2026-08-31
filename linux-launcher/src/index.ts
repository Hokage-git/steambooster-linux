#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { CATALOG_LINK_BRIDGE_SCRIPT } from './catalog-link-bridge.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'node:http';
import { handleNativeOp } from './handlers/index.js';

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
  -p, --cdp-port <number>    CDP port (default: 8080)
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

function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = get(url, { family: 4 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5_000, () => { req.destroy(new Error('timeout')); });
  });
}

async function waitForCDP(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await httpGetJson<Record<string, unknown>>(`http://127.0.0.1:${port}/json/version`);
      console.log(`[linux-launcher] CDP /json/version responded`);
      return;
    } catch (e) {
      console.log(`[linux-launcher] CDP probe error: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(250);
  }
  throw new Error(`CDP port ${port} did not become available within ${timeoutMs}ms`);
}

async function listTargets(port: number, timeoutMs = 60_000): Promise<CDPTarget[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await httpGetJson<CDPTarget[]>(`http://127.0.0.1:${port}/json/list`);
      if (list.length > 0) return list;
    } catch (e) {
      console.log(`[linux-launcher] listTargets error: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(500);
  }
  throw new Error(`CDP target list stayed empty for ${timeoutMs}ms`);
}

function pickSteamMainTarget(targets: CDPTarget[]): CDPTarget | undefined {
  // Steam's main shell target has title "Steam" and an about:blank URL with
  // createflags. On Linux its webSocketDebuggerUrl actually routes to the
  // SharedJSContext renderer, so we must attach via Target.attachToTarget
  // (flattened) to reach the main shell's own JS execution context.
  return targets.find((t) =>
    t.title === 'Steam' &&
    (t.url.startsWith('about:blank') || t.url.startsWith('https://store.steampowered.com')),
  ) ?? targets.find((t) => t.title === 'Steam');
}

function pickSharedContextTarget(targets: CDPTarget[]): CDPTarget | undefined {
  return targets.find((t) => t.title === 'SharedJSContext' || t.url.includes('IN_STEAMUI_SHARED_CONTEXT=true'));
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
  subscribeTopics?: string[];
  allowedHosts?: string[];
  urlPatterns?: string[];
}

interface PluginsManifest {
  injectorVersion: string;
  contextKind: string;
  userDisabledPlugins: string[];
  plugins: ManifestEntry[];
  _sec: Record<string, string>;
}

function readPluginMeta(path: string): Partial<ManifestEntry> | undefined {
  const metaPath = path.replace(/\.js$/, '.meta.json');
  if (!existsSync(metaPath)) return undefined;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<ManifestEntry>;
  } catch {
    return undefined;
  }
}

function buildManifest(args: LauncherArgs, contextKind: string, plugins: ManifestEntry[]): PluginsManifest {
  return {
    injectorVersion: 'linux-dev-0.0.1',
    contextKind,
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

function buildPluginEntries(devPlugins: string[]): ManifestEntry[] {
  return devPlugins.map((path) => {
    const name = path.split('/').pop()!.replace(/\.js$/, '');
    const meta = readPluginMeta(path);
    const id = meta?.id ?? name.replace(/^(booster-plugin-)?/, '');
    return {
      id,
      version: meta?.version ?? '0.0.1',
      apiVersion: meta?.apiVersion ?? 1,
      contextKinds: meta?.contextKinds ?? ['main'],
      grantedCapabilities: meta?.grantedCapabilities ?? ['ui', 'steam', 'configs', 'bus', 'pages', 'keys', 'net'],
      subscribeTopics: meta?.subscribeTopics,
      allowedHosts: meta?.allowedHosts,
      urlPatterns: meta?.urlPatterns,
      required: false,
      url: `file://${resolve(path)}`,
      sha256: '0'.repeat(64), // dev only; framework may warn but should allow
      token: `token-${id}-${Math.random().toString(36).slice(2)}`,
    };
  });
}

function buildBootstrapPrefix(manifest: PluginsManifest): string {
  return `
(function(){
  globalThis.__SB_PLUGINS_MANIFEST__ = ${JSON.stringify(manifest)};

  function sbResolve(requestId, response) {
    if (typeof globalThis.__sb_resolve === 'function') {
      globalThis.__sb_resolve(requestId, response);
    }
  }

  function setupId() {
    const key = '__sb_setup_id';
    let id = null;
    try { id = localStorage.getItem(key); } catch {}
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('');
      try { localStorage.setItem(key, id); } catch {}
    }
    return id;
  }

  function configKey(pluginId, name) {
    return '__sb_config_' + pluginId + '_' + name;
  }

  function configRead(pluginId, name) {
    try {
      const raw = localStorage.getItem(configKey(pluginId, name));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.v === 1 ? parsed.d : null;
    } catch { return null; }
  }

  function configWrite(pluginId, name, value) {
    localStorage.setItem(configKey(pluginId, name), JSON.stringify({ v: 1, d: value }));
  }

  globalThis.__sb_native_queue = [];
  globalThis.__sb_native = function(payload) {
    const envelope = JSON.parse(payload);
    const reqId = envelope.requestId;
    if (typeof reqId !== 'number') return;

    switch (envelope.op) {
      case 'get_setup_id':
        sbResolve(reqId, { ok: true, result: setupId() });
        return;
      case 'config_read':
        sbResolve(reqId, { ok: true, result: { data: configRead(envelope.pluginId, envelope.args.name) } });
        return;
      case 'config_write':
        configWrite(envelope.pluginId, envelope.args.name, envelope.args.value);
        sbResolve(reqId, { ok: true, result: null });
        return;
      case 'log':
        return;
      default:
        globalThis.__sb_native_queue.push(envelope);
        return;
    }
  };

  globalThis.__sb_resolve = function(requestId, response) {
    console.log('[sb-resolve]', requestId, JSON.stringify(response));
  };
})();
`;
}

/**
 * A single WebSocket connection to one renderer target that is used as a
 * transport for flattened Target.attachToTarget sessions. On Linux Steam the
 * main shell target's webSocketDebuggerUrl routes to the SharedJSContext
 * renderer; attaching via Target.attachToTarget is the only way to reach the
 * main shell's own JS context.
 */
class MasterCDPSession {
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
  }

  private handleMessage(data: string): void {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const params = msg.params as { type?: string; args?: { value?: unknown }[] };
      const text = params.args?.map((a) => (typeof a.value === 'string' ? a.value : JSON.stringify(a.value))).join(' ') ?? '';
      const tag = msg.sessionId ? `[steam-console:${params.type ?? 'log'}:${msg.sessionId.slice(0, 8)}]` : `[steam-console:${params.type ?? 'log'}]`;
      console.log(tag, text);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = (msg.params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }).exceptionDetails;
      const tag = msg.sessionId ? `[steam-exception:${msg.sessionId.slice(0, 8)}]` : '[steam-exception]';
      console.error(tag, details?.text, details?.exception?.description ?? '');
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  }

  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      const envelope: Record<string, unknown> = { id, method, params };
      if (sessionId) envelope.sessionId = sessionId;
      this.ws.send(JSON.stringify(envelope));
    });
  }

  async attachToTarget(targetId: string): Promise<string> {
    const result = (await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    return result.sessionId;
  }

  close(): void {
    this.ws.close();
  }
}

async function evaluate(session: MasterCDPSession, expression: string, sessionId: string): Promise<unknown> {
  return session.send('Runtime.evaluate', {
    expression,
    includeCommandLineAPI: true,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
}

// Active bus dispatch targets: every context we have injected framework into.
// The Linux launcher acts as the native bus router: when any context publishes
// a bus topic, we forward it to all other injected contexts via their secret
// dispatch function name.
const activeBusTargets = new Map<string, { session: MasterCDPSession; sessionId: string }>();
// Install the catalogue click bridge once per page target. It is a no-op
// outside steambalance.cc/booster/catalogue and also covers popup wrappers.
const catalogueBridgeTargets = new Set<string>();

function registerBusTarget(targetId: string, session: MasterCDPSession, sessionId: string): void {
  activeBusTargets.set(targetId, { session, sessionId });
}

async function injectBundle(
  session: MasterCDPSession,
  sessionId: string,
  targetId: string,
  frameworkPath: string,
  manifest: PluginsManifest,
): Promise<void> {
  console.log(`[linux-launcher] injectBundle start target=${targetId.slice(0, 8)} session=${sessionId.slice(0, 8)} ctx=${manifest.contextKind}`);
  const bundle = readFileSync(frameworkPath, 'utf8');
  const prefix = buildBootstrapPrefix(manifest);

  await session.send('Runtime.enable', {}, sessionId);

  console.log('[linux-launcher] injecting manifest + bridge stubs...');
  const prefixResult = await evaluate(session, prefix, sessionId);
  if ((prefixResult as Record<string, unknown>)?.exceptionDetails) {
    throw new Error(`manifest injection failed: ${JSON.stringify(prefixResult)}`);
  }

  console.log('[linux-launcher] injecting booster-framework bundle...');
  const bundleResult = await evaluate(session, bundle, sessionId);
  console.log('[linux-launcher] bundle result:', JSON.stringify(bundleResult).slice(0, 400));
  if ((bundleResult as Record<string, unknown>)?.exceptionDetails) {
    throw new Error(`framework injection failed: ${JSON.stringify(bundleResult)}`);
  }

  console.log('[linux-launcher] verifying window.sb...');
  const verify = await evaluate(session, `typeof window.sb`, sessionId);
  const verifyResult = verify as { result?: { value?: unknown } } | undefined;
  console.log('[linux-launcher] window.sb =', verifyResult?.result?.value);
  await evaluate(session, `console.log('[launcher-test] context check for ${sessionId.slice(0,8)} target ${targetId.slice(0,8)}] ctx=${manifest.contextKind}', window.location.href, document.title)`, sessionId);
}

async function sendBridgeResolve(
  session: MasterCDPSession,
  sessionId: string,
  requestId: number,
  response: { ok: boolean; result?: unknown; error?: string },
): Promise<void> {
  const expr = `typeof globalThis.__sb_resolve === 'function' && globalThis.__sb_resolve(${requestId}, ${JSON.stringify(response)})`;
  await session.send('Runtime.evaluate', {
    expression: expr,
    includeCommandLineAPI: true,
    returnByValue: true,
  }, sessionId);
}

async function processNativeRequest(
  req: Record<string, unknown>,
  allowedHostsByPlugin: Map<string, Set<string>>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const op = req.op as string;
  const pluginId = req.pluginId as string | undefined;
  console.log('[linux-launcher] native op:', op, 'pluginId:', pluginId);

  if (op === 'get_store_country' || op === 'set_store_country') {
    return handleNativeOp({
      op,
      args: (req.args as Record<string, unknown> | undefined) ?? {},
      requestId: req.requestId as number | undefined,
      pluginId,
    });
  }

  if (op === 'bus.publish') {
    const topic = String((req.args as Record<string, unknown> | undefined)?.topic ?? '');
    const data = (req.args as Record<string, unknown> | undefined)?.data ?? null;
    if (!topic) {
      return { ok: false, error: 'missing topic' };
    }
    console.log(`[linux-launcher] bus.publish forward topic='${topic}' to ${activeBusTargets.size} target(s)`);
    const expr = `typeof __sb_bus_dispatch === 'function' && __sb_bus_dispatch(${JSON.stringify(topic)}, ${JSON.stringify(data)})`;
    for (const [targetId, { session, sessionId }] of activeBusTargets) {
      try {
        await session.send('Runtime.evaluate', {
          expression: expr,
          includeCommandLineAPI: true,
          returnByValue: true,
        }, sessionId);
      } catch (e) {
        console.warn(`[linux-launcher] bus.publish forward failed for target ${targetId.slice(0, 8)}:`, e instanceof Error ? e.message : e);
      }
    }
    return { ok: true, result: null };
  }

  if (op === 'net_fetch') {
    const args = req.args as Record<string, unknown> | undefined;
    const url = String(args?.url ?? '');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'invalid url' };
    }
    const allowed = allowedHostsByPlugin.get(pluginId ?? '');
    if (!allowed || !allowed.has(parsed.hostname.toLowerCase())) {
      return { ok: false, error: `host not allowed: ${parsed.hostname}` };
    }

    const method = String(args?.method ?? 'GET').toUpperCase();
    const headers = args?.headers as Record<string, string> | undefined;
    const body = args?.body as string | undefined;
    const timeoutMs = typeof args?.timeoutMs === 'number' ? args.timeoutMs : 30_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const init: RequestInit = { method, signal: controller.signal, headers, body };
      const resp = await fetch(url, init);
      clearTimeout(timer);
      const respBody = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((value, key) => { respHeaders[key] = value; });
      return {
        ok: true,
        result: {
          status: resp.status,
          ok: resp.ok,
          headers: respHeaders,
          body: respBody,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Stub implementations for native bridge ops that the Windows native host
  // handles but the Linux CDP launcher does not (yet). Returning fast keeps
  // the external-window relay from blocking on 10s bridge timeouts.
  if (op === 'listPageTargetIds') {
    return { ok: true, result: { targetIds: [] } };
  }
  if (op === 'injectTabTitleOverride') {
    return { ok: true, result: null };
  }
  if (op === 'setNativeWindowTitle') {
    return { ok: true, result: null };
  }

  return { ok: false, error: `unsupported native op: ${op}` };
}

async function startNativeBridgeLoop(
  session: MasterCDPSession,
  sessionId: string,
  manifest: PluginsManifest,
): Promise<void> {
  const allowedHostsByPlugin = new Map<string, Set<string>>();
  for (const p of manifest.plugins) {
    if (p.allowedHosts) {
      allowedHostsByPlugin.set(p.id, new Set(p.allowedHosts.map((h) => h.toLowerCase())));
    }
  }

  const pollExpr = `(function(){ const q = globalThis.__sb_native_queue || []; globalThis.__sb_native_queue = []; return q; })()`;
  while (true) {
    await sleep(50);
    try {
      const raw = await session.send('Runtime.evaluate', {
        expression: pollExpr,
        includeCommandLineAPI: true,
        returnByValue: true,
      }, sessionId);
      const queue = (raw as { result?: { value?: unknown } })?.result?.value as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(queue) || queue.length === 0) continue;
      for (const req of queue) {
        void processNativeRequest(req, allowedHostsByPlugin).then((response) => {
          void sendBridgeResolve(session, sessionId, req.requestId as number, response);
        });
      }
    } catch (e) {
      // Session may have closed; keep looping until process exits.
    }
  }
}

async function injectDevPlugins(session: MasterCDPSession, sessionId: string, manifest: PluginsManifest): Promise<void> {
  for (const entry of manifest.plugins) {
    const path = entry.url.replace('file://', '');
    const code = readFileSync(path, 'utf8');
    console.log(`[linux-launcher] injecting dev plugin ${entry.id}...`);
    const bootPrefix = `
(function(){
  globalThis.__SB_PLUGIN_BOOT__ = ${JSON.stringify({ id: entry.id, token: entry.token })};
})();
`;
    const bootResult = await evaluate(session, bootPrefix, sessionId);
    if ((bootResult as Record<string, unknown>)?.exceptionDetails) {
      console.warn(`[linux-launcher] plugin boot prefix failed: ${JSON.stringify(bootResult)}`);
      continue;
    }
    const result = await evaluate(session, code, sessionId);
    if ((result as Record<string, unknown>)?.exceptionDetails) {
      console.warn(`[linux-launcher] plugin injection failed: ${JSON.stringify(result)}`);
    }
  }
}

function matchesUrlPatterns(url: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  for (const p of patterns) {
    try {
      if (new RegExp(p).test(url)) return true;
    } catch {
      // ignore malformed patterns
    }
  }
  return false;
}

function filterWebPlugins(entries: ManifestEntry[], url: string): ManifestEntry[] {
  return entries.filter(
    (e) => e.contextKinds.includes('web') && matchesUrlPatterns(url, e.urlPatterns),
  );
}

async function injectWebTargets(
  master: MasterCDPSession,
  args: LauncherArgs,
  pluginEntries: ManifestEntry[],
  frameworkPath: string,
  lastSeenUrls: Map<string, string>,
): Promise<void> {
  let targets: CDPTarget[];
  try {
    targets = await listTargets(args.cdpPort, 5_000);
  } catch {
    return;
  }

  for (const t of targets) {
    if (t.type !== 'page') continue;
    if (!t.id) continue;
    if (t.title === 'SharedJSContext') continue;
    if (t.title === 'Steam' && t.url.startsWith('about:blank')) continue;

    if (!catalogueBridgeTargets.has(t.id)) {
      try {
        const bridgeSessionId = await master.attachToTarget(t.id);
        await master.send('Page.addScriptToEvaluateOnNewDocument', {
          source: CATALOG_LINK_BRIDGE_SCRIPT,
        }, bridgeSessionId);
        catalogueBridgeTargets.add(t.id);
      } catch (e) {
        console.warn(`[linux-launcher] catalogue link bridge unavailable for ${t.title}:`,
          e instanceof Error ? e.message : e);
      }
    }

    const eligible = filterWebPlugins(pluginEntries, t.url);
    if (eligible.length === 0) {
      lastSeenUrls.set(t.id, t.url);
      continue;
    }

    // Skip only if we already injected into this target at the same URL.
    if (lastSeenUrls.get(t.id) === t.url) continue;

    console.log(`[linux-launcher] web target eligible: ${t.title} (${t.url})`);
    try {
      const sessionId = await master.attachToTarget(t.id);
      const webManifest = buildManifest(args, 'web', eligible);
      await injectBundle(master, sessionId, t.id, frameworkPath, webManifest);
      registerBusTarget(t.id, master, sessionId);
      await injectDevPlugins(master, sessionId, webManifest);
      void startNativeBridgeLoop(master, sessionId, webManifest);
      lastSeenUrls.set(t.id, t.url);
      console.log(`[linux-launcher] injected web target ${t.id.slice(0, 8)}`);
    } catch (e) {
      console.warn(
        `[linux-launcher] failed to inject web target ${t.title}:`,
        e instanceof Error ? e.message : e,
      );
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

  let targets = await listTargets(args.cdpPort);
  console.log(`[linux-launcher] found ${targets.length} CDP targets`);
  for (const t of targets) {
    console.log(`  - [${t.type}] "${t.title}" ${t.url}`);
  }

  const pluginEntries = buildPluginEntries(args.devPlugins);
  const injectedTargetIds = new Set<string>();

  // Wait for SharedJSContext to appear. It is the authoritative renderer we
  // use as the master transport; attaching through a transient empty target
  // would route us to the wrong context.
  const sharedTarget = await (async (): Promise<CDPTarget> => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const current = await listTargets(args.cdpPort, 5_000);
      const t = pickSharedContextTarget(current);
      if (t?.webSocketDebuggerUrl) return t;
      await sleep(250);
    }
    throw new Error('SharedJSContext target did not appear within 60s');
  })();
  console.log(`[linux-launcher] SharedJSContext target ready: ${sharedTarget.title} (${sharedTarget.id.slice(0, 8)})`);

  // Use SharedJSContext's renderer as the master transport; we attach to
  // individual targets through it.
  const masterUrl = sharedTarget.webSocketDebuggerUrl!;
  const master = new MasterCDPSession(masterUrl);
  await master.ready();
  await master.send('Target.setDiscoverTargets', { discover: true });

  // 1. Inject framework into SharedJSContext so relay (user-data, popups,
  //    navigation, external windows) becomes available to the main shell.
  console.log(`[linux-launcher] attaching to SharedJSContext: ${sharedTarget.title}`);
  const sharedSessionId = await master.attachToTarget(sharedTarget.id);
  if (!injectedTargetIds.has(sharedTarget.id)) {
    injectedTargetIds.add(sharedTarget.id);
    const sharedManifest = buildManifest(args, 'shared', []);
    await injectBundle(master, sharedSessionId, sharedTarget.id, args.frameworkPath, sharedManifest);
    registerBusTarget(sharedTarget.id, master, sharedSessionId);
    // The relay inside SharedJSContext issues native bridge calls (title override,
    // page target listing) that the Windows native host would handle. On Linux
    // these are stubbed in processNativeRequest, so pump the shared context queue
    // just like the main shell queue.
    void startNativeBridgeLoop(master, sharedSessionId, sharedManifest);
    console.log('[linux-launcher] SharedJSContext framework injected');
  } else {
    console.log('[linux-launcher] SharedJSContext already injected, skipping');
  }

  // 2. Wait for the main Steam shell target (it appears after login on a
  // fresh boot, so we wait long enough for the user to type credentials).
  const mainTarget = await (async (): Promise<CDPTarget> => {
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      const current = await listTargets(args.cdpPort, 5_000);
      const t = pickSteamMainTarget(current);
      if (t?.id) return t;
      await sleep(500);
    }
    throw new Error('could not find Steam main shell target within 10 minutes');
  })();

  let mainShellInjecting = false;
  async function injectMainShell(target: CDPTarget): Promise<void> {
    if (mainShellInjecting) {
      console.log('[linux-launcher] main shell injection already in progress, skipping duplicate');
      return;
    }
    if (injectedTargetIds.has(target.id)) {
      console.log('[linux-launcher] main shell already injected, skipping');
      return;
    }
    mainShellInjecting = true;
    try {
      console.log(`[linux-launcher] attaching to main shell: ${target.title} (${target.url}) id=${target.id.slice(0, 8)}`);
      const mainSessionId = await master.attachToTarget(target.id);
      // Re-check after await in case another tick raced us.
      if (injectedTargetIds.has(target.id)) {
        console.log('[linux-launcher] main shell already injected after attach, skipping');
        return;
      }
      injectedTargetIds.add(target.id);
      const mainManifest = buildManifest(args, 'main', pluginEntries);
      await injectBundle(master, mainSessionId, target.id, args.frameworkPath, mainManifest);
      registerBusTarget(target.id, master, mainSessionId);
      await injectDevPlugins(master, mainSessionId, mainManifest);

      // Start polling the main-shell native request queue so operations that the
      // Windows native host would normally handle (net_fetch, etc.) run through
      // the launcher Node process on Linux.
      void startNativeBridgeLoop(master, mainSessionId, mainManifest);
      console.log('[linux-launcher] main shell injected');
    } finally {
      mainShellInjecting = false;
    }
  }

  await injectMainShell(mainTarget);

  // 3. Inject framework + plugins into Steam web contexts (store/community
  //    BrowserViews) so page-router plugins like booster-addfunds can run on
  //    store.steampowered.com. New targets are rescanned every few seconds.
  const webLastSeenUrls = new Map<string, string>();
  await injectWebTargets(master, args, pluginEntries, args.frameworkPath, webLastSeenUrls);
  const webScanInterval = setInterval(() => {
    void injectWebTargets(master, args, pluginEntries, args.frameworkPath, webLastSeenUrls);
  }, 1_500);

  // 4. Re-inject the main shell after Steam restarts. The main shell target
  //    disappears when Steam closes and reappears with a new ID on relaunch.
  //    We poll for a new main target and inject when we see one we haven't
  //    handled yet.
  const mainShellCheckInterval = setInterval(async () => {
    try {
      const current = await listTargets(args.cdpPort, 5_000);
      const t = pickSteamMainTarget(current);
      if (t?.id && !injectedTargetIds.has(t.id) && !mainShellInjecting) {
        console.log('[linux-launcher] new main shell target detected after restart');
        await injectMainShell(t);
      }
    } catch (e) {
      // CDP may be briefly unavailable during restart; ignore and retry.
    }
  }, 3_000);

  console.log('[linux-launcher] injection complete; keeping alive (Ctrl+C to stop)');
  await new Promise(() => {});
  clearInterval(webScanInterval);
  clearInterval(mainShellCheckInterval);
}

main().catch((err) => {
  console.error('[linux-launcher] fatal:', err);
  process.exit(1);
});
