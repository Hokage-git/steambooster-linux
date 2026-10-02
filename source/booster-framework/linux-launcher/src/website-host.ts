import { CATALOG_LINK_BRIDGE_SCRIPT } from './catalog-link-bridge.js';
import { randomBytes } from 'node:crypto';
import { MasterCDPSession } from './cdp-session.js';
import { trustedWebsiteOrigin, websiteBridgeScript } from './website-bridge.js';
import { dispatchHostRequest } from './host-dispatch.js';

type Context = {
  id: number;
  origin: string;
  sessionId: string;
  pending: Set<number>;
};
/** A generation owns all frame contexts; replies never cross a navigation. */
export class WebsiteHost {
  private binding = '__sb_host_' + randomBytes(12).toString('hex');
  private resolver = '__sb_reply_' + randomBytes(12).toString('hex');
  private contexts = new Map<string, Context>();
  private sessions = new Map<string, string>();
  private attaching = new Set<string>();
  private unsubscribe: () => void;
  constructor(
    private session: MasterCDPSession,
    private invoke: (delegate: string, args: unknown[]) => Promise<unknown>,
  ) {
    this.unsubscribe = session.onEvent((msg) => {
      const sid = msg.sessionId;
      if (!sid) return;
      if (![...this.sessions.values()].includes(sid)) return;
      const p = msg.params;
      if (msg.method === 'Runtime.executionContextCreated') {
        const c = p.context;
        if (!c?.auxData?.isDefault || !trustedWebsiteOrigin(c.origin)) return;
        this.contexts.set(`${sid}:${c.id}`, {
          id: c.id,
          origin: c.origin,
          sessionId: sid,
          pending: new Set(),
        });
        void session
          .send(
            'Runtime.evaluate',
            {
              expression:
                websiteBridgeScript(this.binding, this.resolver) + ';' + CATALOG_LINK_BRIDGE_SCRIPT,
              contextId: c.id,
            },
            sid,
          )
          .then((r) => {
            if ((r as any)?.exceptionDetails)
              console.warn('[linux-host] injection failed', JSON.stringify(r));
            else console.log('[linux-host] website attached');
          })
          .catch((e) => console.warn('[linux-host] injection', String(e)));
      } else if (msg.method === 'Runtime.executionContextDestroyed') {
        this.contexts.delete(`${sid}:${p.executionContextId}`);
      } else if (msg.method === 'Runtime.executionContextsCleared') {
        for (const [key, c] of this.contexts) if (c.sessionId === sid) this.contexts.delete(key);
      } else if (msg.method === 'Runtime.bindingCalled' && p.name === this.binding) {
        void this.receive(sid, p.executionContextId, p.payload);
      }
    });
  }
  async attach(targetId: string) {
    if (this.sessions.has(targetId) || this.attaching.has(targetId)) return;
    this.attaching.add(targetId);
    let sid: string | undefined;
    try {
      sid = await this.session.attachToTarget(targetId);
      this.sessions.set(targetId, sid);
      await this.session.send('Runtime.addBinding', { name: this.binding }, sid);
      await this.session.send(
        'Page.addScriptToEvaluateOnNewDocument',
        {
          source:
            websiteBridgeScript(this.binding, this.resolver) + ';' + CATALOG_LINK_BRIDGE_SCRIPT,
        },
        sid,
      );
      await this.session.send('Runtime.enable', {}, sid);
    } catch (e) {
      this.sessions.delete(targetId);
      if (sid)
        void this.session.send('Target.detachFromTarget', { sessionId: sid }).catch(() => {});
      throw e;
    } finally {
      this.attaching.delete(targetId);
    }
  }
  prune(targetIds: Set<string>) {
    for (const [id, sid] of this.sessions)
      if (!targetIds.has(id)) {
        this.sessions.delete(id);
        for (const [key, c] of this.contexts) if (c.sessionId === sid) this.contexts.delete(key);
        void this.session.send('Target.detachFromTarget', { sessionId: sid }).catch(() => {});
      }
  }
  private async receive(sid: string, contextId: number, payload: unknown) {
    const key = `${sid}:${contextId}`,
      context = this.contexts.get(key);
    if (
      !context ||
      !trustedWebsiteOrigin(context.origin) ||
      typeof payload !== 'string' ||
      payload.length > 16384
    )
      return;
    let req: any;
    try {
      req = JSON.parse(payload);
    } catch {
      return;
    }
    if (
      !req ||
      !Number.isSafeInteger(req.id) ||
      req.id < 1 ||
      context.pending.has(req.id) ||
      context.pending.size >= 32
    )
      return;
    context.pending.add(req.id);
    let response: unknown;
    try {
      response = {
        id: req.id,
        ok: true,
        result: await dispatchHostRequest(req, this.invoke),
      };
    } catch (e) {
      response = {
        id: req.id,
        ok: false,
        error: e instanceof Error ? e.message : 'host error',
      };
    }
    context.pending.delete(req.id);
    if (this.contexts.get(key) !== context || this.session.closed) return;
    const expression = `globalThis[${JSON.stringify(this.resolver)}]?.(${JSON.stringify(response)})`;
    await this.session.send('Runtime.evaluate', { expression, contextId }, sid).catch(() => {});
  }
  close() {
    this.unsubscribe();
    this.contexts.clear();
    this.sessions.clear();
  }
}
