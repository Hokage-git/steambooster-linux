type Listener = (message: {
  method: string;
  sessionId?: string;
  params: Record<string, any>;
}) => void;
export class MasterCDPSession {
  private ws: WebSocket;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private opened: Promise<void>;
  private listeners = new Set<Listener>();
  closed = false;
  constructor(
    url: string,
    private timeoutMs = 45000,
  ) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('CDP connection timed out'));
        this.close();
      }, 10000);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('CDP connection failed'));
      };
    });
    this.ws.onclose = () => this.dispose();
    this.ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) for (const listener of this.listeners) listener(msg);
    };
  }
  ready() {
    return this.opened;
  }
  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('CDP session closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        },
        method === 'Runtime.evaluate' ? this.timeoutMs : Math.min(this.timeoutMs, 5000),
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async attachToTarget(targetId: string): Promise<string> {
    return (
      (await this.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      })) as { sessionId: string }
    ).sessionId;
  }
  private dispose() {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('CDP session closed'));
    }
    this.pending.clear();
    this.listeners.clear();
  }
  close() {
    this.dispose();
    this.ws.close();
  }
}
