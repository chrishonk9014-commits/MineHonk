/**
 * The Haunting (Admin Panel, every world), on a real server: the whole
 * timeline in a one-minute haunting (sightings, the signs he leaves, the
 * dark, his words, the fake joins, the chase, the jumpscare and the fake
 * ban), who may arm the world's deletion, Stop putting the world back, and
 * the timeline surviving a restart and waiting while nobody is there.
 */
import { describe, it, expect } from 'vitest';
import { hauntOf } from '../helpers/haunt';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { validateAdmin } from '../../src/common/game/admin';
import { HAUNT_BAN, type HauntStatus } from '../../src/common/game/haunting';
import { Mob } from '../../src/server/entity/Mob';
import { blocks, STATE_BLOCK } from '../../src/common/registry/blocks';

let req = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: HauntStatus } {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}

const figures = (server: GameServer): Mob[] => [...server.dims.values()].flatMap((d) => [...d.entities.values()]).filter((e): e is Mob => e instanceof Mob && e.type === 'herobrine' && !!e.data.haunting && !e.removed);

describe('the Haunting', () => {
  it('runs the whole timeline: sightings, signs, the dark, his words, the chase, the jumpscare and the fake ban', async () => {
    const { server } = await makeServer({ seed: 'haunting', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
    const r = admin(server, conn, { a: 'haunt', op: 'start', minutes: 1, erase: true, ending: 'ban' });
    expect(r.ok, r.text).toBe(true);
    expect(r.data).toMatchObject({ active: true, stage: 'watching', total: 60, erase: true, canErase: true, ending: 'ban' });
    expect(conn.received.some((m) => m.t === 'chat' && /\[Admin\]/.test((m as { text: string }).text))).toBe(false);
    const seen = new Set<number>();
    const kinds = new Set<string>();
    let maxChanges = 0;
    let maxDark = 0;
    let t = 0;
    for (; t < 1200 + 900 && !conn.closed; t++) {
      // Looking around, as a player does
      if (t % 15 === 0) player.yaw = (player.yaw + 0.9) % (Math.PI * 2);
      tick(server, 1);
      for (const m of figures(server)) seen.add(m.id);
      maxChanges = Math.max(maxChanges, (server.level.flags.hauntBlocks as unknown[] | undefined)?.length ?? 0);
      if (t % 50 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    for (const m of conn.received) if (m.t === 'fx') kinds.add(m.kind);
    for (const m of conn.of('fx')) if (m.kind === 'haunt') maxDark = Math.max(maxDark, m.strength ?? 0);
    const chat = conn.of('chat');
    const said = (re: RegExp, kind?: string): boolean => chat.some((m) => re.test(m.text) && (!kind || m.kind === kind));
    // His figure, many times, each one gone again
    expect(seen.size).toBeGreaterThanOrEqual(4);
    // The signs he leaves
    expect(maxChanges).toBeGreaterThanOrEqual(5);
    // His words: the quiet first one, then the glitched ones (one with the reader's name)
    expect(said(/^stop$/, 'chat') && chat.find((m) => m.text === 'stop')!.from === 'Herobrine').toBe(true);
    expect(said(/^YOU ARE NOT SAFE$/, 'herobrine')).toBe(true);
    expect(said(/^I SEE YOU, STEVE$/, 'herobrine')).toBe(true);
    expect(said(/^FOUND YOU$/, 'herobrine')).toBe(true);
    // Somebody nobody invited
    expect(said(/^Herobrine joined the world$/, 'join')).toBe(true);
    expect(said(/^Herobrine left the world$/, 'leave')).toBe(true);
    // The dark closes in, he vanishes, he reaches you; the sound never cuts out
    for (const k of ['haunt', 'afterimage', 'glitch', 'jumpscare']) expect(kinds.has(k), k).toBe(true);
    expect(kinds.has('silence')).toBe(false);
    expect(maxDark).toBeGreaterThan(0.8);
    // The end: thrown out with a fake ban, the world to be deleted by its owner's client
    const kick = conn.last('kick')!;
    expect(kick).toMatchObject({ reason: HAUNT_BAN.title, ban: HAUNT_BAN, erase: true });
    expect(conn.closed).toBe(true);
    expect(t).toBeGreaterThan(1200 * 0.95);
    expect(t).toBeLessThan(1200 + 600);
    // The jumpscare came before the kick
    const iScare = conn.received.findIndex((m) => m.t === 'fx' && m.kind === 'jumpscare');
    const iKick = conn.received.findIndex((m) => m.t === 'kick');
    expect(iScare).toBeGreaterThan(-1);
    expect(iScare).toBeLessThan(iKick);
    // Nothing of him is left
    expect(hauntOf(server)).toBeUndefined();
    expect(figures(server)).toEqual([]);
  }, 300000);

  it('only the world owner can have the world deleted; an operator can still start a haunting', async () => {
    const { server } = await makeServer({ seed: 'haunting-ops', cheats: true });
    const owner = await join(server, 'Owner', 'uuid-owner');
    server.level.owner = 'uuid-owner';
    const op = await join(server, 'Oppy', 'uuid-op');
    server.level.operators.push('uuid-op');
    const denied = admin(server, op.conn, { a: 'haunt', op: 'start', minutes: 30, erase: true });
    expect(denied.ok).toBe(false);
    expect(denied.text).toMatch(/owner/);
    expect(denied.data!.canErase).toBe(false);
    expect(admin(server, op.conn, { a: 'haunt', op: 'start', minutes: 30, erase: false }).ok).toBe(true);
    expect(admin(server, owner.conn, { a: 'haunt', op: 'status' }).data).toMatchObject({ active: true, erase: false, canErase: true, total: 1800 });
    // Only one at a time
    expect(admin(server, owner.conn, { a: 'haunt', op: 'start', minutes: 10, erase: false }).ok).toBe(false);
    // Out of range is refused before it reaches the server
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 0, erase: false })).toBeNull();
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 181, erase: false })).toBeNull();
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 5 })).toBeNull();
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 5, erase: true })).toEqual({ a: 'haunt', op: 'start', minutes: 5, erase: true });
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 5, erase: false, ending: 'corrupted' })).toEqual({ a: 'haunt', op: 'start', minutes: 5, erase: false, ending: 'corrupted' });
    expect(validateAdmin({ a: 'haunt', op: 'start', minutes: 5, erase: false, ending: 'nope' })).toBeNull();
    // A builder gets nothing at all
    const builder = await join(server, 'Bob', 'uuid-bob');
    expect(admin(server, builder.conn, { a: 'haunt', op: 'stop' }).ok).toBe(false);
    expect(hauntOf(server)).toBeTruthy();
    // When the end comes, only the owner's client is told to delete the world
    const st = hauntOf<{ total: number }>(server)!;
    server.level.flags.haunt = { ...st, erase: true, ending: 'ban', t: Math.ceil(st.total * 0.965) };
    for (let i = 0; i < 900 && !owner.conn.closed; i++) {
      tick(server, 1);
      if (i % 50 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    expect(owner.conn.last('kick')).toMatchObject({ ban: HAUNT_BAN, erase: true });
    expect(op.conn.last('kick')).toMatchObject({ ban: HAUNT_BAN, erase: false });
    expect(builder.conn.last('kick')).toMatchObject({ ban: HAUNT_BAN, erase: false });
  }, 300000);

  it('Stop puts back every block he changed, and the light', async () => {
    const { server } = await makeServer({ seed: 'haunting-stop', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
    // Four minutes, from "closer" on: the signs come thick and fast
    expect(admin(server, conn, { a: 'haunt', op: 'start', minutes: 4, erase: false }).ok).toBe(true);
    expect(admin(server, conn, { a: 'haunt', op: 'skip' }).text).toMatch(/Signs/);
    expect(admin(server, conn, { a: 'haunt', op: 'skip' }).text).toMatch(/Closer/);
    for (let i = 0; i < 2000; i++) {
      if (i % 15 === 0) player.yaw = (player.yaw + 0.9) % (Math.PI * 2);
      tick(server, 1);
      if (i % 100 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    const changes = [...((server.level.flags.hauntBlocks as [string, number, number, number, number, number][]) ?? [])];
    expect(changes.length).toBeGreaterThan(5);
    const placed = changes.filter((c) => c[5] !== 0).map((c) => blocks[STATE_BLOCK[c[5]]!]!.id);
    expect(placed.some((id) => /redstone|cobblestone|sign|sand|gold/.test(id))).toBe(true);
    // Everything he placed counts as cheat-made
    const dim = server.dim('overworld');
    const c0 = changes.find((c) => c[5] !== 0)!;
    expect(server.admin.blockMarked(dim, c0[1], c0[2], c0[3])).toBe(true);
    const r = admin(server, conn, { a: 'haunt', op: 'stop' });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Put back \d+ block/);
    // The first record of each position holds what was there before him
    const firstPrev = new Map<string, [number, number, number, number]>();
    for (const [, x, y, z, prev] of changes) if (!firstPrev.has(`${x},${y},${z}`)) firstPrev.set(`${x},${y},${z}`, [x, y, z, prev]);
    for (const [x, y, z, prev] of firstPrev.values()) expect(dim.getState(x, y, z), `${x},${y},${z}`).toBe(prev);
    expect(hauntOf(server)).toBeUndefined();
    expect(figures(server)).toEqual([]);
    expect(conn.last('fx')).toMatchObject({ kind: 'haunt', strength: 0 });
  }, 300000);

  it('keeps its place through a restart, and waits while nobody is there', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'haunting-save', cheats: true }, storage);
    const { conn } = await join(server, 'Steve', 'uuid-steve');
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 5, erase: false });
    tick(server, 200);
    const t = hauntOf<{ t: number }>(server)!.t;
    expect(t).toBeGreaterThan(190);
    await server.disconnect(conn);
    tick(server, 300);
    expect(hauntOf<{ t: number }>(server)!.t).toBe(t);
    await server.stop();
    const { server: s2 } = await makeServer({}, storage);
    expect(hauntOf<{ t: number; total: number }>(s2)!.t).toBe(t);
    expect(hauntOf<{ total: number }>(s2)!.total).toBe(6000);
    const j = await join(s2, 'Steve', 'uuid-steve');
    tick(s2, 20);
    expect(hauntOf<{ t: number }>(s2)!.t).toBeGreaterThan(t);
    expect(admin(s2, j.conn, { a: 'haunt', op: 'status' }).data).toMatchObject({ active: true, stage: 'watching' });
  }, 300000);
});
