/**
 * The cloud hub's lobby connection, kept open while a player is signed in to
 * play online: presence, hosting, invites and WebRTC signaling. It
 * reconnects by itself and re-announces a hosted world after a drop.
 */
import type { HubApi } from './HubApi';
import type { LobbyIn, LobbyOut } from '../../common/net/hubProtocol';

type Listener = (m: LobbyOut) => void;

export class HubLobby {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private queue: string[] = [];
  private closed = false;
  private retry = 0;
  private ping: ReturnType<typeof setInterval> | null = null;
  /** Re-sent after every reconnect (the world this player hosts, the world they play in). */
  private sticky: { host?: LobbyIn; playing?: LobbyIn } = {};
  connected = false;
  onState: (connected: boolean) => void = () => {};

  constructor(private readonly api: HubApi) {
    this.open();
  }

  private open(): void {
    if (this.closed || !this.api.token) return;
    const ws = new WebSocket(this.api.socketUrl('/lobby'), ['minehonk', `auth.${this.api.token}`]);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.onState(true);
      for (const m of [this.sticky.host, this.sticky.playing]) if (m) ws.send(JSON.stringify(m));
      for (const m of this.queue) ws.send(m);
      this.queue = [];
      this.ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 30_000);
    };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      let m: LobbyOut;
      try {
        m = JSON.parse(String(ev.data)) as LobbyOut;
      } catch {
        return;
      }
      for (const l of [...this.listeners]) l(m);
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      this.connected = false;
      this.onState(false);
      if (this.closed) return;
      // Back off: 1 s, 2 s, 4 s ... up to 30 s
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }

  send(m: LobbyIn): void {
    if (m.t === 'host') this.sticky.host = m;
    if (m.t === 'unhost') delete this.sticky.host;
    if (m.t === 'playing') this.sticky.playing = m.world ? m : undefined;
    const text = JSON.stringify(m);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else if (m.t === 'signal') this.queue.push(text);
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Resolves with the first message matching `pred`, or rejects after `ms`. */
  wait<T extends LobbyOut>(pred: (m: LobbyOut) => m is T, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const off = this.on((m) => {
        if (!pred(m)) return;
        off();
        clearTimeout(t);
        resolve(m);
      });
      const t = setTimeout(() => {
        off();
        reject(new Error('timeout'));
      }, ms);
    });
  }

  close(): void {
    this.closed = true;
    if (this.ping) clearInterval(this.ping);
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }
}
