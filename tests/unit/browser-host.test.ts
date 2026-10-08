/**
 * Browser hosting, the server side (src/worker/hosting.ts): who gets into a
 * world hosted in a player's browser. Real signed tickets, a real GameServer:
 * forged, expired and foreign tickets, other game versions, bans, private
 * worlds and codes, a full world, and visitors, operators and cheats.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { encode, decode } from '@msgpack/msgpack';
import { makeServer, join, hello, tick } from '../helpers/testServer';
import { BrowserHost, type HostOut } from '../../src/worker/hosting';
import { generateTicketKeys, importSigningKey, signTicket, type TicketClaims } from '../../src/hub/tickets';
import { toPieces, PieceJoiner } from '../../src/common/net/hubProtocol';
import { fromB64url, toB64url } from '../../src/hub/crypto';
import type { GameServer } from '../../src/server/GameServer';
import type { S2C } from '../../src/common/net/protocol';

const WORLD = '0123456789abcdef';
const HOST = 'host-uuid';

interface Remote {
  cid: number;
  msgs: S2C[];
  kicked: string | null;
}

let server: GameServer;
let host: BrowserHost;
let signKey: CryptoKey;
let pub: JsonWebKey;
const remotes = new Map<number, Remote & { joiner: PieceJoiner }>();
const settings: unknown[] = [];

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

function onPost(m: HostOut): void {
  if (m.type === 'level_settings') settings.push(m.settings);
  if (m.type !== 'remote_send' && m.type !== 'remote_kick') return;
  const r = remotes.get(m.cid);
  if (!r) return;
  // The reason a player sees is the kick message; the close that follows may be plainer
  if (m.type === 'remote_kick') r.kicked ??= m.reason;
  else
    for (const p of m.pieces) {
      const whole = r.joiner.push(p);
      if (!whole) continue;
      for (const msg of decode(whole) as S2C[]) {
        r.msgs.push(msg);
        if (msg.t === 'kick') r.kicked ??= msg.reason;
      }
    }
}

let nextCid = 1;
async function ticket(over: Partial<TicketClaims> = {}): Promise<string> {
  return signTicket({ v: 1, uuid: 'joiner-uuid', name: 'Joiny', world: WORLD, exp: Date.now() + 60_000, via: 'friend', relay: false, ...over }, signKey);
}

async function remoteJoin(t: string, h = hello()): Promise<Remote> {
  const cid = nextCid++;
  const r = { cid, msgs: [] as S2C[], kicked: null as string | null, joiner: new PieceJoiner() };
  remotes.set(cid, r);
  host.open(cid, 'test');
  for (const p of toPieces(encode({ t: 'join', ticket: t, hello: h }))) host.data(cid, p);
  await settle();
  return r;
}

function sendAs(r: Remote, msgs: unknown[]): void {
  for (const p of toPieces(encode(msgs))) host.data(r.cid, p);
}

beforeEach(async () => {
  ({ server } = await makeServer({ owner: HOST, mode: 'survival', cheats: false }));
  server.level.visibility = 'friends';
  await join(server, 'Hosty', HOST);
  const keys = await generateTicketKeys();
  signKey = await importSigningKey(keys.privateJwk);
  pub = keys.publicJwk;
  remotes.clear();
  settings.length = 0;
  host = new BrowserHost(() => server, (m) => onPost(m));
  await host.start({ hubWorldId: WORLD, hubKey: pub, maxPlayers: 3, hostUuid: HOST, hostName: 'Hosty' });
});

describe('a world hosted in the browser', () => {
  it('lets in a friend with a good ticket, under the name the hub signed', async () => {
    const r = await remoteJoin(await ticket(), { ...hello(), name: 'SomeoneElse' });
    expect(r.kicked).toBeNull();
    const w = r.msgs.find((m) => m.t === 'welcome') as Extract<S2C, { t: 'welcome' }>;
    expect(w.name).toBe('Joiny');
    expect(w.uuid).toBe('joiner-uuid');
    expect([...server.players.values()].map((p) => p.name).sort()).toEqual(['Hosty', 'Joiny']);
    // The host shows up under their account name, and as the owner
    const list = r.msgs.filter((m) => m.t === 'player_list').pop() as Extract<S2C, { t: 'player_list' }>;
    expect(list.players.find((p) => p.uuid === HOST)?.role).toBe('owner');
    expect(list.players.find((p) => p.uuid === 'joiner-uuid')?.role).toBe('builder');
  });

  it('turns away forged, expired and other worlds’ tickets, and other game versions', async () => {
    const good = await ticket();
    const [body, sig] = good.split('.');
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body!)));
    claims.name = 'Hosty';
    const forged = `${toB64url(new TextEncoder().encode(JSON.stringify(claims)))}.${sig}`;
    expect((await remoteJoin(forged)).kicked).toBe('Your join ticket expired. Try again.');
    expect((await remoteJoin(await ticket({ exp: Date.now() - 1 }))).kicked).toBe('Your join ticket expired. Try again.');
    expect((await remoteJoin(await ticket({ world: 'fedcba9876543210' }))).kicked).toBe('Your join ticket expired. Try again.');
    // Signed by some other key
    const other = await importSigningKey((await generateTicketKeys()).privateJwk);
    expect((await remoteJoin(await signTicket({ v: 1, uuid: 'x', name: 'X', world: WORLD, exp: Date.now() + 60000, via: 'public', relay: true }, other))).kicked).toBe('Your join ticket expired. Try again.');
    expect((await remoteJoin(await ticket(), { ...hello(), version: 999 })).kicked).toBe('Version mismatch — refresh the page');
    expect((await remoteJoin(await ticket(), { ...hello(), registryHash: 'old' })).kicked).toBe('Version mismatch — refresh the page');
    // Anything but a join first is refused
    const cid = nextCid++;
    remotes.set(cid, { cid, msgs: [], kicked: null, joiner: new PieceJoiner() });
    host.open(cid, 'test');
    for (const p of toPieces(encode([{ t: 'chat', text: 'hi' }]))) host.data(cid, p);
    await settle();
    expect(remotes.get(cid)!.kicked).toBe('Expected a join ticket');
    expect(server.players.size).toBe(1);
  });

  it('keeps out banned players and private worlds, and remembers code joins', async () => {
    server.level.banned.push('joiner-uuid');
    expect((await remoteJoin(await ticket())).kicked).toBe('You are banned from this world.');
    server.level.banned = [];
    server.level.visibility = 'private';
    // A friend's ticket is not enough for a private world...
    expect((await remoteJoin(await ticket({ via: 'friend' }))).kicked).toBe('This world is private. Ask the owner for a join code.');
    // ...a code is (and they stay invited)
    expect((await remoteJoin(await ticket({ via: 'code' }))).kicked).toBeNull();
    expect(server.level.allowlist).toContain('joiner-uuid');
  });

  it('fills up', async () => {
    await remoteJoin(await ticket({ uuid: 'a', name: 'Aaa' }));
    await remoteJoin(await ticket({ uuid: 'b', name: 'Bbb' }));
    expect((await remoteJoin(await ticket({ uuid: 'c', name: 'Ccc' }))).kicked).toBe('World is full.');
  });

  it('keeps the Admin Panel to the owner and operators, and only with cheats on', async () => {
    server.level.defaultRole = 'visitor';
    const r = await remoteJoin(await ticket());
    const adminResult = async (): Promise<Extract<S2C, { t: 'admin_result' }>> => {
      sendAs(r, [{ t: 'admin', req: 7, action: { a: 'give', item: 'diamond', count: 64 } }]);
      await settle();
      return r.msgs.filter((m) => m.t === 'admin_result').pop() as Extract<S2C, { t: 'admin_result' }>;
    };
    // A visitor's modified client gets nowhere
    expect((await adminResult()).ok).toBe(false);
    server.level.cheats = true;
    expect((await adminResult()).ok).toBe(false);
    sendAs(r, [{ t: 'chat', text: '/give Joiny diamond 64' }]);
    await settle();
    const joiner = [...server.players.values()].find((p) => p.uuid === 'joiner-uuid')!;
    expect(joiner.inventory.slots.some((s) => s && s.count > 0)).toBe(false);
    // An operator with cheats on may, and everyone else hears about it
    server.level.operators.push('joiner-uuid');
    const hostConn = [...server.players.values()].find((p) => p.uuid === HOST)!.conn as unknown as { received: S2C[] };
    expect((await adminResult()).ok).toBe(true);
    expect(hostConn.received.some((m) => m.t === 'chat' && m.text === '[Admin] Joiny used: give diamond ×64')).toBe(true);
    // Not with cheats off
    server.level.cheats = false;
    expect((await adminResult()).ok).toBe(false);
  });

  it('keeps the hub in step with the world, and follows the hub’s changes', async () => {
    await settle();
    expect(settings.length).toBeGreaterThan(0);
    const r = await remoteJoin(await ticket());
    expect(r.kicked).toBeNull();
    host.applySettings({ name: 'Renamed', visibility: 'public', joinCode: 'ABCD-EFGH', allowlist: [], banned: ['joiner-uuid'], operators: [], roles: {}, defaultRole: 'builder', pvp: true, cheats: true, announceAdmin: false, maxPlayers: 6 });
    await settle();
    expect(server.level.name).toBe('Renamed');
    expect(server.level.cheats).toBe(true);
    expect(server.level.joinCode).toBe('ABCD-EFGH');
    // The ban takes effect at once
    expect(r.msgs.some((m) => m.t === 'kick' && /banned/.test(m.reason))).toBe(true);
    expect([...server.players.values()].some((p) => p.uuid === 'joiner-uuid')).toBe(false);
    // The host's own local id never goes to the hub as an operator
    host.syncSettings(true);
    expect((settings[settings.length - 1] as { operators: string[] }).operators).not.toContain(HOST);
  });
});
