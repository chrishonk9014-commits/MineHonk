import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import WebSocket from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import { initItems } from '../../src/common/registry/items';
import { Hub } from '../../src/server-node/Hub';
import { FileStorage } from '../../src/server-node/FileStorage';
import { PROTOCOL_VERSION, type S2C } from '../../src/common/net/protocol';
import { registryHash } from '../../src/common/registry/hash';

initItems();

let dataDir = '';
let hub: Hub;
let base = '';

async function startHub(): Promise<void> {
  hub = await Hub.create({ port: 0, host: '127.0.0.1', dataDir, log: () => {}, serverOptions: { genBudgetMs: 200, chunksPerTick: 64 } });
  const port = await hub.listen();
  base = `http://127.0.0.1:${port}`;
}

async function api(method: string, route: string, token?: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + '/api' + route, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

interface Client {
  ws: WebSocket;
  msgs: S2C[];
  wait<T extends S2C['t']>(t: T, pred?: (m: Extract<S2C, { t: T }>) => boolean, ms?: number): Promise<Extract<S2C, { t: T }>>;
  send(m: unknown): void;
  closed: Promise<void>;
}

function play(token: string, world: string, name = 'x'): Client {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/play?world=${world}`);
  const msgs: S2C[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    msgs.push(decode(d as Buffer) as S2C);
    for (const w of waiters.splice(0)) w();
  });
  const closed = new Promise<void>((r) => ws.on('close', () => r()));
  ws.on('open', () => ws.send(encode({ t: 'hello', version: PROTOCOL_VERSION, name, token, viewDistance: 2, registryHash: registryHash() })));
  const c: Client = {
    ws,
    msgs,
    closed,
    send: (m) => ws.send(encode(m)),
    wait(t, pred = () => true, ms = 20000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), ms);
        const check = (): void => {
          const m = msgs.find((x) => x.t === t && pred(x as never));
          if (m) {
            clearTimeout(timer);
            resolve(m as never);
          } else waiters.push(check);
        };
        check();
      });
    },
  };
  return c;
}

describe('multiplayer hub', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'minehonk-hub-'));
    await startHub();
  });
  afterAll(async () => {
    await hub.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  let alice = '';
  let bob = '';
  let carol = '';
  let bobUuid = '';
  let carolUuid = '';
  let worldId = '';
  let code = '';

  it('registers and logs in accounts safely', async () => {
    expect((await api('GET', '/health')).data.ok).toBe(true);
    const a = await api('POST', '/register', undefined, { name: 'Alice', password: 'correct horse' });
    expect(a.status).toBe(200);
    alice = String(a.data.token);
    expect((await api('POST', '/register', undefined, { name: 'alice', password: 'another pass' })).data.error).toMatch(/taken/);
    expect((await api('POST', '/register', undefined, { name: 'Bob', password: 'short' })).status).toBe(400);
    const b = await api('POST', '/register', undefined, { name: 'Bob', password: 'bob password' });
    bob = String(b.data.token);
    bobUuid = String((b.data.account as { uuid: string }).uuid);
    const c = await api('POST', '/register', undefined, { name: 'Carol', password: 'carol password' });
    carol = String(c.data.token);
    carolUuid = String((c.data.account as { uuid: string }).uuid);
    expect((await api('POST', '/login', undefined, { name: 'Bob', password: 'wrong password' })).data.error).toMatch(/Wrong/);
    const login = await api('POST', '/login', undefined, { name: 'BOB', password: 'bob password' });
    expect(login.status).toBe(200);
    expect((await api('GET', '/me', 'not-a-token')).status).toBe(401);
    expect((await api('GET', '/me', bob)).data.name).toBe('Bob');
    // Passwords are never stored in plain text
    await new Promise((r) => setTimeout(r, 400));
    const stored = readFileSync(path.join(dataDir, 'accounts.json'), 'utf8');
    expect(stored).toContain('Carol');
    expect(stored).not.toContain('carol password');
    expect(stored).not.toContain(carol);
  });

  it('manages friend requests', async () => {
    await api('POST', '/friends/request', alice, { name: 'bob' });
    const bf = await api('GET', '/friends', bob);
    expect((bf.data.incoming as { name: string }[]).map((x) => x.name)).toEqual(['Alice']);
    const aliceUuid = (bf.data.incoming as { uuid: string }[])[0]!.uuid;
    const after = await api('POST', '/friends/accept', bob, { uuid: aliceUuid });
    expect((after.data.friends as { name: string }[]).map((x) => x.name)).toEqual(['Alice']);
    expect(((await api('GET', '/friends', alice)).data.friends as { name: string }[]).map((x) => x.name)).toEqual(['Bob']);
  });

  it('creates worlds visible to friends and joinable by code', async () => {
    const w = await api('POST', '/worlds', alice, { name: 'Alice Land', mode: 'survival', visibility: 'friends', seed: 'hub-test' });
    expect(w.status).toBe(200);
    worldId = String(w.data.id);
    code = String(w.data.joinCode);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const bl = await api('GET', '/worlds', bob);
    expect((bl.data.friends as { id: string }[]).map((x) => x.id)).toContain(worldId);
    const cl = await api('GET', '/worlds', carol);
    expect(JSON.stringify(cl.data)).not.toContain(worldId);
    expect((await api('GET', `/worlds/${worldId}`, carol)).status).toBe(404);
    // Bob can see the world but not its join code
    expect((await api('GET', `/worlds/${worldId}`, bob)).data.joinCode).toBeUndefined();
    expect((await api('POST', '/join', carol, { code: 'ZZZZ-ZZZZ' })).status).toBe(400);
    const joined = await api('POST', '/join', carol, { code: code.toLowerCase().replace('-', ' ') });
    expect(joined.data.id).toBe(worldId);
    expect(((await api('GET', '/worlds', carol)).data.mine as { id: string }[]).map((x) => x.id)).toContain(worldId);
  });

  it('plays together over websockets with moderated chat and live roles', async () => {
    const a = play(alice, worldId, 'spoofed-name');
    const welcome = await a.wait('welcome');
    // The account name is used, not whatever the client claims
    expect(welcome.name).toBe('Alice');
    expect(welcome.world.joinCode).toBe(code);
    const b = play(bob, worldId);
    const bw = await b.wait('welcome');
    expect(bw.world.joinCode).toBeFalsy();
    await a.wait('player_list', (m) => m.players.length === 2);
    b.send({ t: 'chat', text: 'hello alice, what the fuck' });
    const heard = await a.wait('chat', (m) => m.from === 'Bob');
    expect(heard.text).toContain('***');
    expect(heard.text).not.toContain('fuck');
    // Owner makes Bob a visitor through the API: his client is told immediately
    const r = await api('POST', `/worlds/${worldId}/role`, alice, { uuid: bobUuid, role: 'visitor' });
    expect((r.data.members as { name: string; role: string }[]).find((m) => m.name === 'Bob')?.role).toBe('visitor');
    await b.wait('world_info', (m) => m.world.role === 'visitor');
    // Bob cannot change roles
    expect((await api('POST', `/worlds/${worldId}/role`, bob, { uuid: carolUuid, role: 'operator' })).status).toBe(400);
    // Friends see where Bob is playing
    const af = await api('GET', '/friends', alice);
    expect((af.data.friends as { online: boolean; world?: string }[])[0]).toMatchObject({ online: true, world: 'Alice Land' });
    // Banning Carol keeps her out
    await api('POST', `/worlds/${worldId}/ban`, alice, { uuid: carolUuid, banned: true });
    const c = play(carol, worldId);
    const kick = await c.wait('kick');
    expect(kick.reason).toMatch(/banned/);
    a.ws.close();
    b.ws.close();
    await Promise.all([a.closed, b.closed]);
  });

  it('keeps accounts, friends and worlds across a restart', async () => {
    await new Promise((r) => setTimeout(r, 300));
    await hub.close();
    await startHub();
    expect((await api('GET', '/me', alice)).data.name).toBe('Alice');
    expect(((await api('GET', '/friends', bob)).data.friends as { name: string }[]).map((x) => x.name)).toEqual(['Alice']);
    const d = await api('GET', `/worlds/${worldId}`, alice);
    expect(d.data.name).toBe('Alice Land');
    expect(d.data.joinCode).toBe(code);
    expect((d.data.members as { name: string; role: string }[]).find((m) => m.name === 'Bob')?.role).toBe('visitor');
    expect(existsSync(path.join(dataDir, 'worlds', worldId, 'level.json'))).toBe(true);
    const a = play(alice, worldId);
    await a.wait('welcome');
    a.ws.close();
    await a.closed;
  });
});

describe('file storage', () => {
  it('round-trips chunks and recovers from damaged files', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'minehonk-fs-'));
    try {
      const s = new FileStorage(dir);
      await s.writeLevel({ name: 'A' });
      await s.writeLevel({ name: 'B' });
      await s.writeChunks('overworld', [
        { cx: 0, cz: 0, data: new Uint8Array([1, 2, 3]) },
        { cx: -33, cz: 40, data: new Uint8Array([9, 8]) },
      ]);
      await s.writePlayer('abc', { hp: 5 });
      await s.close();
      const s2 = new FileStorage(dir);
      expect(await s2.readChunk('overworld', -33, 40)).toEqual(new Uint8Array([9, 8]));
      expect(await s2.readChunk('overworld', 1, 0)).toBeNull();
      expect(await s2.readPlayer('abc')).toEqual({ hp: 5 });
      expect(await s2.readLevel()).toEqual({ name: 'B' });
      // Damaged level falls back to the previous copy
      writeFileSync(path.join(dir, 'level.json'), '{ not json');
      expect(await new FileStorage(dir).readLevel()).toEqual({ name: 'A' });
      // Damaged region is set aside and reads as empty
      const region = readdirSync(path.join(dir, 'overworld')).find((f) => f.endsWith('.mhr'))!;
      writeFileSync(path.join(dir, 'overworld', region), 'garbage');
      const s3 = new FileStorage(dir);
      const cx = region.startsWith('r.0.0') ? 0 : -33;
      const cz = region.startsWith('r.0.0') ? 0 : 40;
      expect(await s3.readChunk('overworld', cx, cz)).toBeNull();
      expect(readdirSync(path.join(dir, 'overworld')).some((f) => f.endsWith('.corrupt'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
