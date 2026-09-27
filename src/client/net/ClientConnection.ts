/** Client transports: integrated server worker or remote WebSocket server. */
import { encode, decode } from '@msgpack/msgpack';
import type { C2S, S2C } from '../../common/net/protocol';
import type { NewWorldOptions } from '../../server/world/LevelData';
import type { Identity } from '../../server/net/Connection';

export interface ClientConnection {
  send(msg: C2S): void;
  close(): void;
  onMessage: (msg: S2C) => void;
  onClose: (reason: string) => void;
  readonly local: boolean;
}

export class WorkerConnection implements ClientConnection {
  readonly local = true;
  onMessage: (msg: S2C) => void = () => {};
  onClose: (reason: string) => void = () => {};
  onLog: (text: string) => void = (t) => console.log(t);
  private readonly worker: Worker;
  private stopped: Promise<void> | null = null;
  private stopResolve: (() => void) | null = null;
  private saveResolve: (() => void) | null = null;

  constructor(worldId: string, create: NewWorldOptions | null, identity: Identity, hello: C2S & { t: 'hello' }) {
    this.worker = new Worker(new URL('../../worker/serverWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => {
      const m = ev.data as { type: string; msg?: S2C; text?: string; message?: string; stack?: string };
      switch (m.type) {
        case 's2c':
          this.onMessage(m.msg!);
          break;
        case 'log':
          this.onLog(m.text!);
          break;
        case 'error':
          console.error('[integrated server]', m.message, m.stack);
          this.onClose(`Server error: ${m.message}`);
          break;
        case 'stopped':
          this.stopResolve?.();
          break;
        case 'saved':
          this.saveResolve?.();
          break;
      }
    };
    this.worker.onerror = (e) => {
      console.error('server worker error', e);
      this.onClose('The integrated server crashed');
    };
    this.worker.postMessage({ type: 'start', worldId, create, identity, hello, viewDistance: hello.viewDistance });
  }

  send(msg: C2S): void {
    this.worker.postMessage({ type: 'c2s', msg });
  }

  save(): Promise<void> {
    return new Promise((resolve) => {
      this.saveResolve = resolve;
      this.worker.postMessage({ type: 'save' });
    });
  }

  /** Saves and shuts the integrated server down. */
  stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = new Promise<void>((resolve) => {
        this.stopResolve = resolve;
        this.worker.postMessage({ type: 'stop' });
        setTimeout(resolve, 8000);
      }).then(() => this.worker.terminate());
    }
    return this.stopped;
  }

  close(): void {
    void this.stop();
  }
}

export class SocketConnection implements ClientConnection {
  readonly local = false;
  onMessage: (msg: S2C) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private readonly ws: WebSocket;
  private readonly queue: C2S[] = [];
  private open = false;
  private closedByUs = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.open = true;
      for (const m of this.queue) this.ws.send(encode(m));
      this.queue.length = 0;
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = decode(new Uint8Array(ev.data as ArrayBuffer)) as S2C;
        this.onMessage(msg);
      } catch (e) {
        console.warn('bad packet', e);
      }
    };
    this.ws.onclose = (ev) => {
      if (!this.closedByUs) this.onClose(ev.reason || 'Connection lost');
    };
  }

  send(msg: C2S): void {
    if (!this.open) {
      this.queue.push(msg);
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  close(): void {
    this.closedByUs = true;
    this.ws.close();
  }
}
