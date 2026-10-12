/**
 * A test client for the cloud hub (running under wrangler dev): the JSON API,
 * the lobby WebSocket and the relay, as the game uses them.
 */
import WebSocket from 'ws';
import { stretchPassword } from '../../src/hub/crypto';

export const ORIGIN = 'http://localhost:5173';

export class HubClient {
  token = '';
  uuid = '';
  constructor(
    readonly base: string,
    readonly name: string,
    readonly password = 'correct horse battery',
  ) {}

  async call<T = Record<string, unknown>>(method: string, route: string, body?: unknown, token = this.token): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.base}/api${route}`, {
      method,
      headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: (await res.json()) as T };
  }

  async signUp(): Promise<this> {
    // Fewer rounds than the game (tests only): the hub cannot tell the difference
    const pw = await stretchPassword(this.name, this.password, 1000);
    const r = await this.call<{ token: string; account: { uuid: string } }>('POST', '/register', { name: this.name, password: pw });
    if (r.status !== 200) throw new Error(`register ${this.name}: ${JSON.stringify(r.data)}`);
    this.token = r.data.token;
    this.uuid = r.data.account.uuid;
    return this;
  }

  socket(path: string, protocols: string[]): Promise<{ ws: WebSocket; msgs: unknown[]; next: (pred: (m: any) => boolean, ms?: number) => Promise<any> }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.base.replace(/^http/, 'ws')}/api${path}`, protocols, { headers: { Origin: ORIGIN } });
      const msgs: unknown[] = [];
      const waiters: { pred: (m: any) => boolean; res: (m: unknown) => void }[] = [];
      ws.on('message', (data, isBinary) => {
        const m = isBinary ? new Uint8Array(data as Buffer) : JSON.parse(String(data));
        msgs.push(m);
        for (const w of [...waiters]) if (w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.res(m);
        }
      });
      const next = (pred: (m: any) => boolean, ms = 10000): Promise<any> =>
        new Promise((res, rej) => {
          const found = msgs.find(pred);
          if (found) return res(found);
          const t = setTimeout(() => rej(new Error('timed out waiting for a message')), ms);
          waiters.push({ pred, res: (m) => (clearTimeout(t), res(m)) });
        });
      ws.on('open', () => resolve({ ws, msgs, next }));
      ws.on('error', reject);
      ws.on('unexpected-response', (_req, res) => reject(new Error(`socket refused: ${res.statusCode}`)));
    });
  }

  lobby() {
    return this.socket('/lobby', ['minehonk', `auth.${this.token}`]);
  }
}
