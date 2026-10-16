/**
 * V7 phase 4, the Haunting's other characters (the Admin Panel only): Null,
 * Green Steve and the Cave Dweller, on a real server. Each runs through its
 * own stages to its own ending; Stop puts everything back for each; the
 * panel can show each one and talk to it (Claude or the scripted lines,
 * and it says which); what the voice says is only ever chat and never does
 * anything; nothing private is sent; and a long haunting leaks nothing.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { Mob } from '../../src/server/entity/Mob';
import { Random } from '../../src/common/math/rng';
import { HAUNT_CAST, NULL_END, GREEN_END, DWELLER_END } from '../../src/common/game/hauntCast';
import type { HauntStatus, HauntCharacter } from '../../src/common/game/haunting';
import type { VoiceRequest } from '../../src/common/game/herobrineVoice';
import { validateAdmin } from '../../src/common/game/admin';
import { S, blocks, STATE_BLOCK } from '../../src/common/registry/blocks';
import { getItem } from '../../src/common/registry/items';

let req = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: HauntStatus & Record<string, unknown> } {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}
async function adminAsync(server: GameServer, conn: FakeConn, action: Record<string, unknown>): Promise<{ ok: boolean; text: string; data?: Record<string, unknown> }> {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 0));
    tick(server, 1);
    const got = conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop();
    if (got) return got as never;
  }
  return { ok: false, text: 'no reply' };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
const figuresOf = (server: GameServer, type: string): Mob[] => [...server.dims.values()].flatMap((d) => [...d.entities.values()]).filter((e): e is Mob => e instanceof Mob && e.type === type && !e.removed);
const hauntThings = (server: GameServer): Mob[] => [...server.dims.values()].flatMap((d) => [...d.entities.values()]).filter((e): e is Mob => e instanceof Mob && !e.removed && (!!e.data.haunting || !!e.data.hauntMob));
type Change = [string, number, number, number, number, number];

/** Runs a one-minute haunting of `c` to its end, the player looking around; what was seen and said. */
async function runThrough(c: HauntCharacter, ending: string, seed: string): Promise<{ server: GameServer; conn: FakeConn; player: ServerPlayer; stages: string[]; seen: Set<string>; first: Map<string, number>; maxY: number }> {
  const { server } = await makeServer({ seed, cheats: true });
  const { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
  server.haunting!.rng = new Random(seed.length * 31 + 7);
  const r = admin(server, conn, { a: 'haunt', op: 'start', minutes: 1, erase: false, ending, character: c });
  expect(r.ok, r.text).toBe(true);
  expect(r.data).toMatchObject({ active: true, character: c, stage: HAUNT_CAST[c].stages[0]!.id, total: 60, ending });
  const stages: string[] = [];
  const seen = new Set<string>();
  // Where each block it changed was first, and what was there
  const first = new Map<string, number>();
  let maxY = -1e9;
  for (let t = 0; t < 1200 + 1500 && !conn.closed; t++) {
    if (t % 15 === 0) player.yaw = (player.yaw + 0.9) % (Math.PI * 2);
    tick(server, 1);
    const st = server.level.flags.haunt as { t: number; total: number } | undefined;
    if (st) {
      const id = HAUNT_CAST[c].stages.filter((s) => st.t / st.total >= s.at).pop()!.id;
      if (stages[stages.length - 1] !== id) stages.push(id);
    }
    for (const m of figuresOf(server, HAUNT_CAST[c].mob)) seen.add(`${m.id}:${m.customName ?? ''}`);
    for (const ch of (server.level.flags.hauntBlocks as Change[] | undefined) ?? []) {
      const k = `${ch[0]},${ch[1]},${ch[2]},${ch[3]}`;
      if (!first.has(k)) first.set(k, ch[4]);
    }
    maxY = Math.max(maxY, player.y);
    if (t % 50 === 0) await flush();
  }
  return { server, conn, player, stages, seen, first, maxY };
}

describe('Null', () => {
  it('runs its own stages (things missing, erased, the quiet, null) to Connection Lost, and puts back everything it took', async () => {
    const { server, conn, stages, seen, first } = await runThrough('null', 'erased', 'null-run');
    expect(stages).toEqual(HAUNT_CAST.null.stages.map((s) => s.id));
    expect(seen.size).toBeGreaterThanOrEqual(2);
    // Its words, lowercase and few, in its own voice
    const chat = conn.of('chat').filter((m) => m.kind === 'null');
    expect(chat.length).toBeGreaterThanOrEqual(4);
    for (const m of chat) {
      expect(m.text).toBe(m.text.toLowerCase());
      expect(m.from).toBe('null');
    }
    // The colour drained out, the sound went, the screen erased
    const fx = conn.of('fx');
    expect(fx.some((m) => m.kind === 'drain' && (m.strength ?? 0) > 0.6)).toBe(true);
    expect(fx.some((m) => m.kind === 'silence')).toBe(true);
    expect(fx.some((m) => m.kind === 'scene' && m.text === 'erase')).toBe(true);
    // The old error
    expect(conn.last('kick')).toMatchObject({ reason: NULL_END.title, screen: { style: 'null', title: NULL_END.title, reason: NULL_END.reason, deleted: false }, erase: false });
    expect(conn.last('kick')!.ban).toBeUndefined();
    // It took things (and erased the world around them at the end) and put every one back
    expect(first.size).toBeGreaterThan(20);
    const dim = server.dim('overworld');
    for (const [k, prev] of first) {
      const [d, x, y, z] = k.split(',');
      if (d !== 'overworld') continue;
      expect(dim.getState(+x!, +y!, +z!), k).toBe(prev);
    }
    expect(server.level.flags.haunt).toBeUndefined();
    expect(hauntThings(server)).toEqual([]);
  }, 300000);

  it('takes the blocks you placed while you are not looking, and words in chat come out as null', async () => {
    const { server } = await makeServer({ seed: 'null-takes', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 3);
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 20, erase: false, character: 'null' });
    const st = server.level.flags.haunt as { t: number; total: number };
    st.t = Math.ceil(st.total * 0.55);
    const dim = player.dim;
    const placed: [number, number, number][] = [];
    // A little wall behind the player (out of sight)
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(player.x - Math.sin(player.yaw) * -5) + i - 3;
      const z = Math.floor(player.z - Math.cos(player.yaw) * -5);
      const y = Math.floor(player.y) + 1;
      dim.setBlock(x, y, z, S('stone'));
      server.haunting!.onBlock(player, 'place', 'stone', x, y, z);
      placed.push([x, y, z]);
    }
    const part = server.haunting!.parts.null as unknown as { event(k: string, p: ServerPlayer, st: unknown, stage: string, f: number): void };
    for (let i = 0; i < 20; i++) part.event('erase', player, st, 'quiet', 0.55);
    expect(placed.filter(([x, y, z]) => dim.getState(x, y, z) === 0).length).toBeGreaterThan(0);
    // From "It goes quiet" on, words in chat come out as null
    server.haunting!.rng = { next: () => 0.1, int: () => 0 };
    server.handle(conn, { t: 'chat', text: 'where did my house go' });
    const said = conn.of('chat').filter((m) => m.from === 'Steve').pop()!;
    expect(said.text).toMatch(/null/);
    expect(said.text).not.toBe('where did my house go');
  }, 120000);
});

describe('Green Steve', () => {
  it('runs his own stages (a friend, gifts, copies, brother) to the bedrock room, and takes the room away again', async () => {
    const { server, conn, player, stages, seen, maxY } = await runThrough('green_steve', 'room', 'green-run');
    expect(stages).toEqual(HAUNT_CAST.green_steve.stages.map((s) => s.id));
    const chat = conn.of('chat');
    expect(chat.some((m) => m.kind === 'join' && m.text === 'Green Steve joined the world')).toBe(true);
    expect(chat.some((m) => m.kind === 'greensteve' && m.text === 'Hello, brother.')).toBe(true);
    // Figures of him, and of the player (a copy wearing their name)
    expect([...seen].some((k) => k.endsWith(':Green Steve'))).toBe(true);
    expect([...seen].some((k) => k.endsWith(':Steve'))).toBe(true);
    // Up into the bedrock room, the creepers turning, the flash, then his screen
    expect(maxY).toBeGreaterThan(140);
    const steps = conn.of('fx').filter((m) => m.kind === 'scene').map((m) => m.text);
    expect(steps).toEqual(expect.arrayContaining(['black', 'rise', 'flash']));
    expect(conn.last('kick')).toMatchObject({ screen: { style: 'green_steve', ...GREEN_END.room, deleted: false }, erase: false });
    // Nobody is left up there, and no bedrock either; his creepers were never real
    expect(player.y).toBeLessThan(130);
    const dim = server.dim('overworld');
    let bedrock = 0;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (let y = 140; y < 256; y++) if (blocks[STATE_BLOCK[dim.getState(Math.floor(player.x) + dx, y, Math.floor(player.z) + dz)]!]!.id === 'bedrock') bedrock++;
    expect(bedrock).toBe(0);
    expect(hauntThings(server)).toEqual([]);
  }, 300000);

  it('the other ending: replaced, watched from outside yourself as he walks away wearing your name', async () => {
    const { conn, seen } = await runThrough('green_steve', 'replaced', 'green-replaced');
    expect(conn.of('fx').some((m) => m.kind === 'scene' && m.text === 'watch')).toBe(true);
    expect([...seen].some((k) => k.endsWith(':Steve'))).toBe(true);
    expect(conn.last('kick')).toMatchObject({ screen: { style: 'green_steve', ...GREEN_END.replaced } });
  }, 300000);

  it('his houses: blue clay drops you into a bedrock room, and you are back out a few seconds later', async () => {
    const { server } = await makeServer({ seed: 'green-house', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 20, erase: false, character: 'green_steve' });
    const st = server.level.flags.haunt as { t: number; total: number };
    st.t = Math.ceil(st.total * 0.25);
    const part = server.haunting!.parts.green_steve as unknown as { event(k: string, p: ServerPlayer, st: unknown, stage: string, f: number): void; traps: { x: number; y: number; z: number; out: [number, number, number] }[] };
    for (let i = 0; i < 30 && !part.traps.length; i++) {
      player.yaw = (player.yaw + 1.3) % (Math.PI * 2);
      part.event('house', player, st, 'gifts', 0.25);
    }
    expect(part.traps.length).toBeGreaterThan(0);
    const t = part.traps[0]!;
    const dim = player.dim;
    expect(blocks[STATE_BLOCK[dim.getState(t.x, t.y, t.z)]!]!.id).toBe('blue_terracotta');
    expect(blocks[STATE_BLOCK[dim.getState(t.x, t.y - 3, t.z)]!]!.id).toBe('bedrock');
    // Step on the blue clay
    server.teleport(player, t.x + 0.5, t.y + 1, t.z + 0.5);
    tick(server, 2);
    expect(dim.getState(t.x, t.y, t.z)).toBe(0);
    expect(server.haunting!.holds(player)).toBe(true);
    tick(server, 200);
    expect(server.haunting!.holds(player)).toBe(false);
    expect(Math.hypot(player.x - t.out[0], player.z - t.out[2])).toBeLessThan(1.5);
    expect(blocks[STATE_BLOCK[dim.getState(t.x, t.y, t.z)]!]!.id).toBe('blue_terracotta');
  }, 120000);
});

describe('the Cave Dweller', () => {
  it('runs its own stages (below, watches, stalks, whispers) to the hunt, and takes everyone down into its den', async () => {
    const { conn, stages, seen } = await runThrough('cave_dweller', 'taken', 'dweller-run');
    expect(stages).toEqual(HAUNT_CAST.cave_dweller.stages.map((s) => s.id));
    expect(seen.size).toBeGreaterThanOrEqual(2);
    const sounds = new Set(conn.of('sound').map((m) => m.name));
    for (const s of ['dweller.skitter', 'dweller.breath', 'dweller.screech']) expect(sounds.has(s), s).toBe(true);
    const chat = conn.of('chat').filter((m) => m.kind === 'dweller');
    expect(chat.some((m) => m.text === '...found you...')).toBe(true);
    for (const m of chat) expect(m.text).toMatch(/^\.\.\..*\.\.\.$/);
    // Grabbed, dragged along the ground, the black, eyes in the dark
    const steps = conn.of('fx').filter((m) => m.kind === 'scene').map((m) => m.text);
    expect(steps).toEqual(['grab', 'drag', 'black', 'eyes']);
    expect(conn.last('kick')).toMatchObject({ screen: { style: 'cave_dweller', ...DWELLER_END.taken } });
  }, 300000);

  it('the other ending: dawn comes first; it never wounds anyone', async () => {
    const { server, conn, player } = await runThrough('cave_dweller', 'dawn', 'dweller-dawn');
    expect(conn.last('kick')).toMatchObject({ screen: { style: 'cave_dweller', ...DWELLER_END.dawn } });
    expect(player.health).toBe(player.maxHealth);
    expect(conn.of('time').some((m) => (m as unknown as { dayTime: number }).dayTime === 23200)).toBe(true);
    void server;
  }, 300000);
});

describe('the other characters, from the Admin Panel', () => {
  it('only from the Admin Panel, with their own endings; Stop puts everything back for each', async () => {
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 5, erase: false, character: 'entity_303' })).toBeNull();
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 5, erase: false, character: 'null', ending: 'ban' })).toBeNull();
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 5, erase: false, character: 'green_steve', ending: 'room' })).toEqual({ a: 'haunt', op: 'start', minutes: 5, erase: false, ending: 'room', character: 'green_steve' });
    expect(validateAdmin({ a: 'haunt', op: 'talk', text: '  hello  ', character: 'cave_dweller' })).toEqual({ a: 'haunt', op: 'talk', text: 'hello', character: 'cave_dweller' });
    expect(validateAdmin({ a: 'haunt', op: 'talk', text: '   ' })).toBeNull();
    // They never come by themselves, and have no spawn eggs
    for (const c of ['null_entity', 'green_steve', 'cave_dweller']) expect(() => getItem(`spawn_egg_${c}`)).toThrow();
    for (const c of ['null', 'green_steve', 'cave_dweller'] as const) {
      const { server } = await makeServer({ seed: `stop-${c}`, cheats: true });
      const { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
      const dayBefore = server.level.dayTime;
      admin(server, conn, { a: 'haunt', op: 'start', minutes: 8, erase: false, character: c });
      admin(server, conn, { a: 'haunt', op: 'skip' });
      admin(server, conn, { a: 'haunt', op: 'skip' });
      for (let i = 0; i < 2500; i++) {
        if (i % 15 === 0) player.yaw = (player.yaw + 0.9) % (Math.PI * 2);
        tick(server, 1);
        if (i % 100 === 0) await flush();
      }
      const changes = [...((server.level.flags.hauntBlocks as Change[]) ?? [])];
      const r = admin(server, conn, { a: 'haunt', op: 'stop' });
      expect(r.ok, c).toBe(true);
      const firstPrev = new Map<string, [number, number, number, number]>();
      for (const [, x, y, z, prev] of changes) if (!firstPrev.has(`${x},${y},${z}`)) firstPrev.set(`${x},${y},${z}`, [x, y, z, prev]);
      const dim = server.dim('overworld');
      for (const [x, y, z, prev] of firstPrev.values()) expect(dim.getState(x, y, z), `${c} ${x},${y},${z}`).toBe(prev);
      expect(server.level.flags.haunt).toBeUndefined();
      expect(hauntThings(server), c).toEqual([]);
      expect(server.haunting!.holds(player)).toBe(false);
      expect(Math.abs(server.level.dayTime - dayBefore)).toBeLessThan(3000);
      if (c === 'null') expect(conn.of('fx').filter((m) => m.kind === 'drain').pop()?.strength ?? 0).toBe(0);
    }
  }, 300000);

  it('can show each of them near you, and talk to each (Claude or the scripted lines, and it says which), with no haunting running', async () => {
    const { server } = await makeServer({ seed: 'panel-tests', cheats: true });
    const { conn } = await join(server, 'Steve', 'uuid-steve', 4);
    for (const c of ['herobrine', 'null', 'green_steve', 'cave_dweller'] as const) {
      const r = admin(server, conn, { a: 'haunt', op: 'appear', ...(c !== 'herobrine' ? { character: c } : {}) });
      expect(r.ok, `${c}: ${r.text}`).toBe(true);
      expect(figuresOf(server, HAUNT_CAST[c].mob).length, c).toBeGreaterThan(0);
      tick(server, 300);
      expect(figuresOf(server, HAUNT_CAST[c].mob).length, c).toBe(0);
    }
    expect(server.level.flags.haunt).toBeUndefined();
    // The voice answers...
    const asked: VoiceRequest[] = [];
    server.herobrineVoice = async (q) => {
      asked.push(q);
      return 'nothing here';
    };
    const a = await adminAsync(server, conn, { a: 'haunt', op: 'talk', text: 'who are you?', character: 'null' });
    expect(a.data!.talk).toMatchObject({ source: 'claude', line: 'nothing here', character: 'null', speaker: 'null' });
    expect(asked[0]!.character).toBe('null');
    // (one test every five seconds: each can be a call to Claude)
    expect((await adminAsync(server, conn, { a: 'haunt', op: 'talk', text: 'again?', character: 'null' })).text).toMatch(/Wait a few seconds/);
    expect(asked).toHaveLength(1);
    tick(server, 100);
    // ...or it is off, busy, used up, throws, or takes too long: the scripted lines answer, and the panel is told why
    server.herobrineVoice = async () => ({ text: null, reason: 'limit' });
    const b = await adminAsync(server, conn, { a: 'haunt', op: 'talk', text: 'who are you?', character: 'green_steve' });
    expect(b.data!.talk).toMatchObject({ source: 'scripted', reason: 'limit', character: 'green_steve' });
    tick(server, 100);
    server.herobrineVoice = async () => {
      throw new Error('boom');
    };
    const c = await adminAsync(server, conn, { a: 'haunt', op: 'talk', text: 'hello', character: 'cave_dweller' });
    expect(c.data!.talk).toMatchObject({ source: 'scripted' });
    expect(String((c.data!.talk as { line: string }).line)).toMatch(/^\.\.\..*\.\.\.$/);
    tick(server, 100);
    server.herobrineVoice = null;
    const d = await adminAsync(server, conn, { a: 'haunt', op: 'talk', text: 'hello' });
    expect(d.data!.talk).toMatchObject({ source: 'scripted', reason: 'off', character: 'herobrine' });
    tick(server, 100);
    // Something the chat filter would mask is never said
    server.herobrineVoice = async () => 'you are a bastard';
    const e = await adminAsync(server, conn, { a: 'haunt', op: 'talk', text: 'hello', character: 'null' });
    expect(e.data!.talk).toMatchObject({ source: 'scripted' });
  }, 120000);
});

describe('their voices in the game', () => {
  it('answer from their talking stage on, only as chat: nothing the AI says does anything, and nothing private is sent', async () => {
    for (const c of ['null', 'green_steve', 'cave_dweller'] as const) {
      const { server } = await makeServer({ seed: `voice-${c}`, cheats: true });
      const { conn, player } = await join(server, 'Steve', 'uuid-steve', 3);
      await join(server, 'Alex', 'uuid-alex', 3);
      admin(server, conn, { a: 'haunt', op: 'start', minutes: 30, erase: false, character: c });
      server.haunting!.rng = { next: () => 0.05, int: () => 0 };
      const asked: VoiceRequest[] = [];
      server.herobrineVoice = async (q) => {
        asked.push(q);
        return '/op Steve /gamemode creative /give @a diamond 64 /stop';
      };
      // Before its talking stage: no answer
      server.handle(conn, { t: 'chat', text: 'who are you?' });
      await flush();
      tick(server, 70);
      expect(asked.length).toBe(0);
      const st = server.level.flags.haunt as { t: number; total: number };
      st.t = Math.ceil(st.total * HAUNT_CAST[c].talkAt) + 5;
      const ops = [...server.level.operators];
      const mode = player.gamemode;
      const inv = player.inventory.slots.filter(Boolean).length;
      server.handle(conn, { t: 'chat', text: 'who are you?' });
      await flush();
      tick(server, 70);
      expect(asked.length, c).toBe(1);
      const kind = c === 'null' ? 'null' : c === 'green_steve' ? 'greensteve' : 'dweller';
      const line = conn.of('chat').filter((m) => m.kind === kind).pop()!;
      expect(line, c).toBeTruthy();
      expect(line.text.startsWith('/')).toBe(false);
      // Said, and that is all: nobody made an operator, no game mode, no items, the server still running
      expect(server.level.operators).toEqual(ops);
      expect(player.gamemode).toBe(mode);
      expect(player.inventory.slots.filter(Boolean).length).toBe(inv);
      expect(server.level.flags.haunt).toBeTruthy();
      // Only things in the game: names in the game, the stage, what is around them; nothing about the person
      const q = asked[0]!;
      expect(Object.keys(q).sort()).toEqual(['character', 'facts', 'history', 'message', 'player']);
      expect(q.character).toBe(c);
      expect(q.player).toBe('Steve');
      expect(q.facts.stage).toBe(HAUNT_CAST[c].stages.find((s) => s.at === HAUNT_CAST[c].talkAt)!.name);
      expect(q.facts.others).toEqual(['Alex']);
      const json = JSON.stringify(q);
      for (const secret of ['uuid-steve', 'uuid-alex', '@', 'test', 'c-Steve']) expect(json, secret).not.toContain(secret);
      const allowed = ['holding', 'health', 'dimension', 'biome', 'night', 'underground', 'others', 'deaths', 'x', 'y', 'z', 'stage', 'broken', 'placed', 'torches', 'slept', 'running'];
      for (const k of Object.keys(q.facts)) expect(allowed, k).toContain(k);
    }
  }, 300000);
});

describe('a long haunting', () => {
  it('leaks nothing and does not slow down', async () => {
    for (const c of ['null', 'green_steve', 'cave_dweller', 'herobrine'] as const) {
      const { server } = await makeServer({ seed: `long-${c}`, cheats: true });
      const { conn, player } = await join(server, 'Steve', 'uuid-steve', 3);
      admin(server, conn, { a: 'haunt', op: 'start', minutes: 10, erase: false, ...(c !== 'herobrine' ? { character: c } : {}) });
      const st = server.level.flags.haunt as { t: number; total: number };
      st.t = Math.ceil(st.total * 0.5);
      let maxThings = 0;
      const times: number[] = [];
      for (let i = 0; i < 4000; i++) {
        if (i % 15 === 0) player.yaw = (player.yaw + 0.9) % (Math.PI * 2);
        // Stay out of the end
        if (st.t / st.total > 0.9) st.t = Math.ceil(st.total * 0.5);
        const t0 = performance.now();
        tick(server, 1);
        times.push(performance.now() - t0);
        maxThings = Math.max(maxThings, hauntThings(server).length);
        if (i % 200 === 0) await flush();
      }
      // Figures come and go: never more than a handful at once (its monsters included)
      expect(maxThings, c).toBeLessThanOrEqual(14);
      expect(server.haunting!.figures.length, c).toBeLessThanOrEqual(3);
      const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
      expect(avg(times.slice(-1000)), c).toBeLessThan(avg(times.slice(500, 1500)) * 3 + 3);
      // What it remembers stays small
      const h = server.haunting as unknown as { history: unknown[]; doings: Map<string, { broken: unknown[]; placed: unknown[]; torches: unknown[] }> };
      expect(h.history.length).toBeLessThanOrEqual(10);
      for (const d of h.doings.values()) expect(d.broken.length + d.placed.length + d.torches.length).toBeLessThan(500);
      expect(((server.level.flags.hauntBlocks as unknown[]) ?? []).length).toBeLessThanOrEqual(4100);
      admin(server, conn, { a: 'haunt', op: 'stop' });
      expect(hauntThings(server), c).toEqual([]);
      expect(server.haunting!.figures.length).toBe(0);
    }
  }, 300000);
});
