/**
 * V7 phase 4, the automatic haunting: Herobrine comes by himself, once, to
 * one world in ten made by a player who has beaten him for real. The roll
 * (made once, at creation, with a real random number, kept in the world),
 * the quiet start after a while of play, about 45 minutes, its place kept
 * through reloads (a reload in its end goes back to the start of the end),
 * one per world, both endings and never a deleted world, what he notices,
 * the Admin Panel's view of it, and the flag for having been through one.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { hauntOf } from '../helpers/haunt';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { Random } from '../../src/common/math/rng';
import { createLevelData } from '../../src/server/world/LevelData';
import { rollAutoHaunt, AUTO_HAUNT_CHANCE, AUTO_HAUNT_DELAY_MIN, AUTO_HAUNT_DELAY_MAX, AUTO_HAUNT_MINUTES, HAUNT_BAN, type AutoHauntRoll, type HauntStatus } from '../../src/common/game/haunting';
import { HEROBRINE_NOTICES } from '../../src/common/game/hauntCast';
import { S, blocks, STATE_BLOCK } from '../../src/common/registry/blocks';
import { herobrineBeaten, recordHerobrineBeaten, HEROBRINE_DEFEAT } from '../../src/client/hauntRecord';

let req = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: HauntStatus } {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}

type St = { t: number; total: number; auto?: boolean; erase: boolean; ending?: string; final?: string; touched?: boolean };
const haunt = (server: GameServer): St | undefined => hauntOf<St>(server);
const roll = (server: GameServer): AutoHauntRoll => server.level.flags.autoHaunt as AutoHauntRoll;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
/** A world whose roll came up: Herobrine comes after `after` ticks of play. */
const rolled = (server: GameServer, after = 100): void => {
  server.level.flags.autoHaunt = { haunted: true, after, played: 0, at: Date.now() } satisfies AutoHauntRoll;
};
const NEW_WORLD = { id: 'w', name: 'W', seed: 'same seed', mode: 'survival', difficulty: 'normal' } as const;

afterEach(() => vi.unstubAllGlobals());

describe('the automatic haunting: who it comes for', () => {
  it('is rolled once, when a player who beat Herobrine for real makes a world: one in ten, a real random number, kept in the world', async () => {
    // The roll itself
    expect(rollAutoHaunt(() => 0.05, 1).haunted).toBe(true);
    expect(rollAutoHaunt(() => AUTO_HAUNT_CHANCE, 1).haunted).toBe(false);
    expect(rollAutoHaunt(() => 0, 1).after).toBe(AUTO_HAUNT_DELAY_MIN);
    expect(rollAutoHaunt(() => 0.9999, 1).after).toBeLessThanOrEqual(AUTO_HAUNT_DELAY_MAX);
    // Nobody who has not beaten him gets one at all
    expect(createLevelData({ ...NEW_WORLD }).flags.autoHaunt).toBeUndefined();
    expect(createLevelData({ ...NEW_WORLD, hauntEligible: false }).flags.autoHaunt).toBeUndefined();
    // One in ten, and not from the seed: the same seed rolls differently each time
    let n = 0;
    const afters = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      const r = createLevelData({ ...NEW_WORLD, hauntEligible: true }).flags.autoHaunt as AutoHauntRoll;
      expect(r.played).toBe(0);
      expect(r.after).toBeGreaterThanOrEqual(AUTO_HAUNT_DELAY_MIN);
      expect(r.after).toBeLessThanOrEqual(AUTO_HAUNT_DELAY_MAX);
      if (r.haunted) n++;
      afters.add(r.after);
    }
    expect(n / 3000).toBeGreaterThan(0.07);
    expect(n / 3000).toBeLessThan(0.13);
    expect(afters.size).toBeGreaterThan(1000);
    // Kept in the world and never made again: the same roll after a reload
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'auto-roll', hauntEligible: true }, storage);
    const first = { ...roll(server) };
    expect(typeof first.haunted).toBe('boolean');
    await server.stop();
    for (let k = 0; k < 3; k++) {
      const { server: s2 } = await makeServer({}, storage);
      expect(roll(s2)).toEqual(first);
      await s2.stop();
    }
    // A world from before (no roll) never gets one later
    const old = new MemoryStorage();
    const { server: o1 } = await makeServer({ seed: 'auto-old' }, old);
    await o1.stop();
    const { server: o2 } = await makeServer({}, old);
    expect(o2.level.flags.autoHaunt).toBeUndefined();
  }, 120000);

  it('only a real win counts: the advancement is never given under cheats, and the device keeps it', async () => {
    const { server } = await makeServer({ seed: 'auto-legit', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve');
    // In a cheat game mode: nothing
    (player.cheat as { mode: unknown }).mode = 'creative';
    server.interaction.grant(player, HEROBRINE_DEFEAT);
    expect(player.achievements.has(HEROBRINE_DEFEAT)).toBe(false);
    expect(conn.of('achievement').some((m) => m.id === HEROBRINE_DEFEAT)).toBe(false);
    // For real: the advancement comes in (and the client records it on the device)
    (player.cheat as { mode: unknown }).mode = null;
    server.interaction.grant(player, HEROBRINE_DEFEAT);
    expect(conn.of('achievement').some((m) => m.id === HEROBRINE_DEFEAT)).toBe(true);
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(herobrineBeaten()).toBe(false);
    recordHerobrineBeaten();
    expect(herobrineBeaten()).toBe(true);
    // The App records it only when that advancement arrives, and makes worlds with it
    const app = await import('node:fs').then((fs) => fs.readFileSync('src/client/App.ts', 'utf8'));
    expect(app).toMatch(/m\.t === 'achievement' && m\.id === HEROBRINE_DEFEAT\) recordHerobrineBeaten\(\)/);
    expect(app.match(/hauntEligible: herobrineBeaten\(\)/g)?.length).toBe(2);
  }, 120000);
});

describe('the automatic haunting: how it goes', () => {
  it('begins quietly after its time of play (only time with someone there counts), runs about 45 minutes, and never comes twice', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'auto-begin', cheats: true }, storage);
    rolled(server, 200);
    // Nobody here: no time passes for it
    tick(server, 300);
    expect(roll(server).played).toBe(0);
    const { conn } = await join(server, 'Steve', 'uuid-steve', 3);
    server.level.owner = 'uuid-steve';
    const before = conn.received.length;
    tick(server, 150);
    expect(haunt(server)).toBeUndefined();
    tick(server, 80);
    const st = haunt(server)!;
    expect(st).toBeTruthy();
    expect(st.auto).toBe(true);
    expect(st.total).toBe(AUTO_HAUNT_MINUTES * 60 * 20);
    expect(st.erase).toBe(false);
    // Nothing announces it
    const said = conn.received.slice(before).filter((m) => m.t === 'chat');
    expect(said).toEqual([]);
    expect(admin(server, conn, { a: 'haunt', op: 'status' }).data).toMatchObject({ active: true, auto: true, autoState: 'running', character: 'herobrine', stage: 'watching', total: 2700 });
    // Through to the end (the chase and the fake ban): the world is kept, even for its owner
    st.ending = 'ban';
    st.erase = true; // (even if something set it: an automatic haunting never deletes)
    st.t = Math.ceil(st.total * 0.965);
    for (let i = 0; i < 900 && !conn.closed; i++) {
      tick(server, 1);
      if (i % 50 === 0) await flush();
    }
    expect(conn.last('kick')).toMatchObject({ ban: { ...HAUNT_BAN, deleted: false }, erase: false });
    expect(haunt(server)).toBeUndefined();
    expect(roll(server).over).toBe(true);
    // Over for good: never again in this world, not after a reload either
    await server.stop();
    const { server: s2 } = await makeServer({}, storage);
    await join(s2, 'Steve', 'uuid-steve', 3);
    tick(s2, 400);
    expect(haunt(s2)).toBeUndefined();
    // And a manual haunting still works there exactly as before
    const j = await join(s2, 'Alex', 'uuid-alex', 3);
    s2.level.operators.push('uuid-alex');
    expect(admin(s2, j.conn, { a: 'haunt', op: 'start', minutes: 10, erase: false }).data).toMatchObject({ active: true, auto: false, autoState: 'over', character: 'herobrine' });
  }, 300000);

  it('waits behind Herobrine started from the panel (there is only ever one Herobrine); the others may haunt alongside', async () => {
    const { server } = await makeServer({ seed: 'auto-one', cheats: true });
    const { conn } = await join(server, 'Steve', 'uuid-steve', 3);
    rolled(server, 50);
    expect(admin(server, conn, { a: 'haunt', op: 'start', minutes: 5, erase: false }).ok).toBe(true);
    tick(server, 100);
    expect(haunt(server)!.auto).toBeUndefined();
    expect(roll(server).begun).toBeUndefined();
    // V7.1: another character alongside; Herobrine twice, never
    expect(admin(server, conn, { a: 'haunt', op: 'start', minutes: 5, erase: false, character: 'null' }).ok).toBe(true);
    expect(admin(server, conn, { a: 'haunt', op: 'start', minutes: 5, erase: false }).ok).toBe(false);
    expect(server.haunting!.states.map((s) => s.char)).toEqual(['herobrine', 'null']);
    admin(server, conn, { a: 'haunt', op: 'stop' });
    tick(server, 2);
    // Herobrine's own haunting comes now, with Null still there
    expect(hauntOf<{ auto?: boolean }>(server, 'herobrine')!.auto).toBe(true);
    expect(hauntOf(server, 'null')).toBeDefined();
  }, 120000);

  it('keeps its place through a reload; a reload in its end goes back to the start of the end, with the ending kept', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'auto-save', cheats: true }, storage);
    rolled(server, 10);
    const { conn } = await join(server, 'Steve', 'uuid-steve', 3);
    tick(server, 300);
    const t = haunt(server)!.t;
    expect(t).toBeGreaterThan(250);
    await server.disconnect(conn);
    await server.stop();
    const { server: s2 } = await makeServer({}, storage);
    expect(haunt(s2)!.t).toBe(t);
    await join(s2, 'Steve', 'uuid-steve', 3);
    tick(s2, 20);
    expect(haunt(s2)!.t).toBeGreaterThan(t);
    // Into the middle of the end (his lair already chosen), then a reload
    const st = haunt(s2)!;
    st.final = 'corrupted';
    st.t = Math.ceil(st.total * 0.98);
    await s2.stop();
    const { server: s3 } = await makeServer({}, storage);
    await join(s3, 'Steve', 'uuid-steve', 3);
    const st3 = haunt(s3)!;
    expect(st3.t).toBeLessThanOrEqual(Math.ceil(st3.total * 0.94) + 30);
    expect(st3.t).toBeGreaterThanOrEqual(Math.ceil(st3.total * 0.94));
    expect(st3.final).toBe('corrupted');
    // It never starts over: still the same haunting, still automatic
    expect(st3.auto).toBe(true);
    expect(roll(s3).begun).toBe(true);
  }, 300000);

  it('ends the usual way (his lair one time in four), always keeps the world, and counts for those who saw it through honestly', async () => {
    const { server } = await makeServer({ seed: 'auto-end', cheats: true });
    const { player } = await join(server, 'Steve', 'uuid-steve', 3);
    let lair = 0;
    for (let k = 0; k < 200; k++) {
      rolled(server, 0);
      server.haunting!.rng = new Random(k * 104729 + 7);
      tick(server, 2);
      const st = haunt(server)!;
      expect(st.auto).toBe(true);
      expect(st.ending).toBe('random');
      st.t = Math.ceil(st.total * 0.94);
      tick(server, 1);
      if (st.final === 'corrupted') lair++;
      server.haunting!.stop();
    }
    expect(lair / 200).toBeGreaterThan(0.14);
    expect(lair / 200).toBeLessThan(0.36);
    // Seen through, untouched: the flag for having been through a haunting
    rolled(server, 0);
    tick(server, 2);
    const st = haunt(server)!;
    st.ending = 'ban';
    st.t = Math.ceil(st.total * 0.965);
    for (let i = 0; i < 900 && haunt(server); i++) tick(server, 1);
    expect(player.statistics['haunting.experienced']).toBe(1);
    // Moved along from the Admin Panel: it counts for nothing
    const { server: s2 } = await makeServer({ seed: 'auto-end-2', cheats: true });
    const j = await join(s2, 'Alex', 'uuid-alex', 3);
    rolled(s2, 0);
    tick(s2, 2);
    expect(admin(s2, j.conn, { a: 'haunt', op: 'finale' }).ok).toBe(true);
    expect(haunt(s2)!.touched).toBe(true);
    haunt(s2)!.ending = 'ban';
    for (let i = 0; i < 1200 && haunt(s2); i++) tick(s2, 1);
    expect(haunt(s2)).toBeUndefined();
    expect(j.player.statistics['haunting.experienced']).toBeUndefined();
    // And a haunting started from the panel never counts
    const { server: s3 } = await makeServer({ seed: 'auto-end-3', cheats: true });
    const k3 = await join(s3, 'Max', 'uuid-max', 3);
    admin(s3, k3.conn, { a: 'haunt', op: 'start', minutes: 1, erase: false, ending: 'ban' });
    for (let i = 0; i < 2500 && haunt(s3); i++) tick(s3, 1);
    expect(k3.player.statistics['haunting.experienced']).toBeUndefined();
  }, 300000);
});

describe('the automatic haunting: he notices', () => {
  it('notices block breaking, torches, and the rest, with scripted lines (never the AI), from "Closer" on', async () => {
    const { server } = await makeServer({ seed: 'auto-notice', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 3);
    let asked = 0;
    server.herobrineVoice = async () => {
      asked++;
      return 'FROM THE AI';
    };
    rolled(server, 0);
    tick(server, 2);
    const st = haunt(server)!;
    st.t = Math.ceil(st.total * 0.5);
    const dim = player.dim;
    const x0 = Math.floor(player.x) + 3;
    const z0 = Math.floor(player.z);
    const y0 = Math.floor(player.y) + 1;
    // Twelve blocks broken in a minute
    const n0 = conn.of('chat').length;
    for (let i = 0; i < 12; i++) {
      dim.setBlock(x0, y0 + (i % 3), z0 + Math.floor(i / 3), S('dirt'));
      server.mining.breakBlock(player, x0, y0 + (i % 3), z0 + Math.floor(i / 3), S('dirt'));
      tick(server, 1);
    }
    const lines = conn.of('chat').slice(n0).filter((m) => m.from === 'Herobrine');
    const breakLines = HEROBRINE_NOTICES.break.map((l) => l.replace('{name}', 'STEVE'));
    expect(lines.some((m) => breakLines.includes(m.text) && m.kind === 'herobrine')).toBe(true);
    // A torch: he turns it red (and his next remark has to wait a minute)
    const tx = Math.floor(player.x) + 2;
    const tz = Math.floor(player.z) + 2;
    const ty = server.haunting!.floorNear(dim, tx, tz, Math.floor(player.y), 6)!;
    dim.setBlock(tx, ty, tz, S('torch'));
    server.haunting!.onBlock(player, 'place', 'torch', tx, ty, tz);
    expect(blocks[STATE_BLOCK[dim.getState(tx, ty, tz)]!]!.id).toBe('redstone_torch');
    // Sprinting for a while, being underground, sleeping are noticed too (each at most every few minutes)
    player.sprinting = true;
    tick(server, 20 * 10);
    player.sprinting = false;
    // Never the AI for any of it
    await flush();
    expect(asked).toBe(0);
    expect(conn.of('chat').some((m) => m.text === 'FROM THE AI')).toBe(false);
    // A haunting from the panel notices nothing (it behaves exactly as it always has)
    const { server: s2 } = await makeServer({ seed: 'auto-notice-2', cheats: true });
    const j = await join(s2, 'Alex', 'uuid-alex', 3);
    admin(s2, j.conn, { a: 'haunt', op: 'start', minutes: 30, erase: false });
    hauntOf<St>(s2)!.t = 900 * 20;
    const m0 = j.conn.of('chat').length;
    const d2 = j.player.dim;
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(j.player.x) + 3;
      d2.setBlock(x, Math.floor(j.player.y) + 1 + (i % 3), Math.floor(j.player.z) + Math.floor(i / 3), S('dirt'));
      s2.mining.breakBlock(j.player, x, Math.floor(j.player.y) + 1 + (i % 3), Math.floor(j.player.z) + Math.floor(i / 3), S('dirt'));
      tick(s2, 1);
    }
    const all = HEROBRINE_NOTICES.break.map((l) => l.replace('{name}', 'ALEX'));
    expect(j.conn.of('chat').slice(m0).some((m) => all.includes(m.text))).toBe(false);
  }, 120000);
});

describe('the automatic haunting in the Admin Panel', () => {
  it('shows it (waiting, running, over), and End and Reset work', async () => {
    const { server } = await makeServer({ seed: 'auto-panel', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 3);
    rolled(server, 20 * 60 * 25);
    const w = admin(server, conn, { a: 'haunt', op: 'status' }).data!;
    expect(w).toMatchObject({ active: false, autoState: 'waiting' });
    expect(w.autoIn).toBeGreaterThan(20 * 60);
    // Start it now (from the beginning), skip ahead, then Reset: back to the start, the world put back
    expect(admin(server, conn, { a: 'haunt', op: 'restart' }).data).toMatchObject({ active: true, auto: true, stage: 'watching' });
    expect(admin(server, conn, { a: 'haunt', op: 'skip' }).ok).toBe(true);
    expect(admin(server, conn, { a: 'haunt', op: 'skip' }).ok).toBe(true);
    for (let i = 0; i < 1500; i++) {
      if (i % 15 === 0) player.yaw = (player.yaw + 0.9) % (Math.PI * 2);
      tick(server, 1);
    }
    const r = admin(server, conn, { a: 'haunt', op: 'restart' });
    expect(r.data).toMatchObject({ active: true, auto: true, stage: 'watching', changes: 0 });
    expect(haunt(server)!.t).toBeLessThan(10);
    // The end in a set time
    expect(admin(server, conn, { a: 'haunt', op: 'finale_in', minutes: 2 }).ok).toBe(true);
    const st = haunt(server)!;
    expect(Math.abs(st.total * 0.94 - st.t - 2 * 60 * 20)).toBeLessThan(25);
    // End: over for good
    expect(admin(server, conn, { a: 'haunt', op: 'stop' }).data).toMatchObject({ active: false, autoState: 'over' });
    tick(server, 200);
    expect(haunt(server)).toBeUndefined();
  }, 120000);
});
