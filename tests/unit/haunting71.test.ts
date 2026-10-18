/**
 * V7.1: several hauntings at once (one of each character, all four if you
 * like), on a real server. Each runs on its own timeline; their ends take
 * turns (one plays, the others wait, and carry on when everyone is back);
 * Stop for one puts back only what that one changed; chat is answered by
 * the one named; old saves with one haunting carry on as the first.
 */
import { describe, it, expect } from 'vitest';
import { hauntOf } from '../helpers/haunt';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import { Mob } from '../../src/server/entity/Mob';
import { Random } from '../../src/common/math/rng';
import { HAUNT_CAST } from '../../src/common/game/hauntCast';
import { HAUNT_CHARACTERS, type HauntStatus, type HauntCharacter } from '../../src/common/game/haunting';
import type { HauntState } from '../../src/server/herobrine/haunts/types';
import { validateAdmin } from '../../src/common/game/admin';
import { sanitizeHauntFlags } from '../../src/server/herobrine/hauntSave';
import { S } from '../../src/common/registry/blocks';

let req = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: HauntStatus } {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
const chars = (server: GameServer): HauntCharacter[] => server.haunting!.states.map((s) => s.char ?? 'herobrine');
const figures = (server: GameServer): Mob[] => [...server.dims.values()].flatMap((d) => [...d.entities.values()]).filter((e): e is Mob => e instanceof Mob && !e.removed && !!e.data.haunting);
type Kick = { t: 'kick'; reason: string; ban?: unknown; corrupted?: boolean; screen?: { style?: string } };
/** Whose end threw a player out. */
const endOf = (k: Kick): HauntCharacter => {
  const style = k.screen?.style;
  return style === 'null' || style === 'green_steve' || style === 'cave_dweller' ? style : 'herobrine';
};

describe('several hauntings at once', () => {
  it('Start all four: each on its own timeline, each saying its own lines, and only one of each', async () => {
    const { server } = await makeServer({ seed: 'all-four', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
    server.haunting!.rng = new Random(71);
    const r = admin(server, conn, { a: 'haunt', op: 'start_all', minutes: 2 });
    expect(r.ok, r.text).toBe(true);
    expect(chars(server)).toEqual([...HAUNT_CHARACTERS]);
    expect(r.data!.hauntings!.map((h) => h.character)).toEqual([...HAUNT_CHARACTERS]);
    for (const h of r.data!.hauntings!) expect(h).toMatchObject({ total: 120, erase: false, auto: false, ending: HAUNT_CAST[h.character].endings[0]!.id });
    // There is only ever one of each
    expect(admin(server, conn, { a: 'haunt', op: 'start_all' }).ok).toBe(false);
    for (const c of HAUNT_CHARACTERS) expect(admin(server, conn, { a: 'haunt', op: 'start', minutes: 5, erase: false, character: c === 'herobrine' ? undefined : c }).ok, c).toBe(false);
    expect(server.haunting!.states).toHaveLength(4);
    // Each moves on, each in its own voice
    const speakers = new Set<string>();
    for (let t = 0; t < 2400 * 0.9; t++) {
      if (t % 15 === 0) player.yaw = (player.yaw + 0.9) % (Math.PI * 2);
      tick(server, 1);
      if (t % 50 === 0) await flush();
    }
    for (const m of conn.of('chat')) if (m.from) speakers.add(m.from);
    for (const c of HAUNT_CHARACTERS) {
      const st = hauntOf<HauntState>(server, c)!;
      expect(st.t / st.total, c).toBeGreaterThan(0.85);
      expect(speakers.has(HAUNT_CAST[c].speaker), `${c} spoke`).toBe(true);
    }
    expect(conn.closed).toBe(false);
  }, 120000);

  it('their ends take turns: one plays, the others wait at the edge of theirs, and each plays when everyone is back', async () => {
    const { server } = await makeServer({ seed: 'turns', cheats: true });
    let { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
    server.haunting!.rng = new Random(9);
    expect(admin(server, conn, { a: 'haunt', op: 'start_all', minutes: 1 }).ok).toBe(true);
    const ended: HauntCharacter[] = [];
    for (let round = 0; round < 4; round++) {
      let waited = false;
      for (let t = 0; t < 1200 + 2000 && !conn.closed; t++) {
        if (t % 15 === 0) player.yaw = (player.yaw + 0.9) % (Math.PI * 2);
        tick(server, 1);
        const st = server.haunting!.status(player);
        const playing = st.hauntings!.filter((h) => h.stage === 'finale' && !h.waiting);
        // Never two ends at once
        expect(playing.length).toBeLessThanOrEqual(1);
        if (st.hauntings!.some((h) => h.waiting)) waited = true;
        if (t % 50 === 0) await flush();
      }
      expect(conn.closed, `round ${round}`).toBe(true);
      const kick = conn.of('kick').pop() as unknown as Kick;
      ended.push(endOf(kick));
      // The ones still to come waited for this end (all four reach theirs together)
      if (round < 3) expect(waited, `round ${round}`).toBe(true);
      expect(server.haunting!.states).toHaveLength(3 - round);
      await flush();
      ({ conn, player } = await join(server, 'Steve', 'uuid-steve', 4));
    }
    // All four, each once, in the order they reached their ends
    expect(ended).toEqual([...HAUNT_CHARACTERS]);
    expect(server.haunting!.active).toBe(false);
    expect(figures(server)).toHaveLength(0);
  }, 240000);

  it('the end straight away while another plays: it waits, and the panel says so', async () => {
    const { server } = await makeServer({ seed: 'wait', cheats: true });
    const { conn } = await join(server, 'Steve', 'uuid-steve', 4);
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 10, erase: false, character: 'null' });
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 10, erase: false, character: 'green_steve' });
    expect(admin(server, conn, { a: 'haunt', op: 'finale', character: 'null' }).ok).toBe(true);
    tick(server, 5);
    const r = admin(server, conn, { a: 'haunt', op: 'finale', character: 'green_steve' });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/comes next/);
    const gs = hauntOf<HauntState>(server, 'green_steve')!;
    const at = gs.t;
    expect(at / gs.total).toBeLessThan(HAUNT_CAST.green_steve.finaleAt);
    tick(server, 100);
    // Null's end goes on; Green Steve's waits on its edge
    expect(hauntOf<HauntState>(server, 'green_steve')!.t).toBe(at);
    expect(hauntOf<HauntState>(server, 'null')!.t).toBeGreaterThan(Math.ceil(HAUNT_CAST.null.finaleAt * gs.total) + 100);
    const st = admin(server, conn, { a: 'haunt', op: 'status' }).data!;
    expect(st.hauntings!.find((h) => h.character === 'green_steve')!.waiting).toBe(true);
    expect(st.hauntings!.find((h) => h.character === 'null')!.waiting).toBeUndefined();
    // Null's end throws everyone out; back again, Green Steve's plays
    for (let i = 0; i < 600 && !conn.closed; i++) tick(server, 1);
    expect(conn.closed).toBe(true);
    expect(chars(server)).toEqual(['green_steve']);
    await flush();
    const again = await join(server, 'Steve', 'uuid-steve', 4);
    tick(server, 20);
    expect(hauntOf<HauntState>(server, 'green_steve')!.t).toBeGreaterThan(at);
    expect(admin(server, again.conn, { a: 'haunt', op: 'status' }).data!.hauntings![0]!.waiting).toBeUndefined();
  }, 60000);

  it('Stop for one puts back only what that one changed, and takes only its figures; the others go on', async () => {
    const { server } = await makeServer({ seed: 'stop-one', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 10, erase: false });
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 10, erase: false, character: 'null' });
    const h = server.haunting!;
    const as = (c: HauntCharacter, fn: () => void): void => (h as unknown as { as(st: HauntState, fn: () => void): void }).as(h.stateOf(c)!, fn);
    const dim = player.dim;
    const x = Math.floor(player.x) + 3;
    const z = Math.floor(player.z) + 3;
    const y = dim.getHeight(x, z) + 1;
    const before = [dim.getState(x, y, z), dim.getState(x + 1, y, z)];
    as('herobrine', () => {
      expect(h.set(dim, x, y, z, S('cobblestone'))).toBe(true);
      h.spawnFigure(player, 'stare', x, y + 1, z);
    });
    as('null', () => {
      expect(h.set(dim, x + 1, y, z, S('obsidian'))).toBe(true);
      h.spawnFigure(player, 'stare', x + 1, y + 1, z);
    });
    expect(admin(server, conn, { a: 'haunt', op: 'status' }).data!.hauntings!.map((r) => [r.character, r.changes])).toEqual([
      ['herobrine', 1],
      ['null', 1],
    ]);
    const types = figures(server).map((m) => m.type).sort();
    expect(types).toEqual([HAUNT_CAST.herobrine.mob, HAUNT_CAST.null.mob].sort());
    const r = admin(server, conn, { a: 'haunt', op: 'stop' });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toMatch(/1 still haunting/);
    expect(dim.getState(x, y, z)).toBe(before[0]);
    expect(dim.getState(x + 1, y, z)).toBe(S('obsidian'));
    expect(chars(server)).toEqual(['null']);
    expect(figures(server).map((m) => m.type)).toEqual([HAUNT_CAST.null.mob]);
    tick(server, 40);
    expect(hauntOf<HauntState>(server, 'null')!.t).toBeGreaterThan(40);
    // Stop all: the rest
    expect(admin(server, conn, { a: 'haunt', op: 'stop_all' }).ok).toBe(true);
    expect(dim.getState(x + 1, y, z)).toBe(before[1]);
    expect(h.active).toBe(false);
    expect(server.level.flags.haunts).toBeUndefined();
    expect(figures(server)).toHaveLength(0);
    expect(admin(server, conn, { a: 'haunt', op: 'stop_all' }).ok).toBe(false);
  }, 60000);

  it('chat: the one named answers (each its own speaker and lines)', async () => {
    const { server } = await makeServer({ seed: 'named', cheats: true });
    const { conn } = await join(server, 'Steve', 'uuid-steve', 4);
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 30, erase: false });
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 30, erase: false, character: 'green_steve' });
    for (const st of server.haunting!.states) st.t = Math.floor(st.total * 0.8);
    server.haunting!.rng = { next: () => 0, int: () => 0 };
    const asked: string[] = [];
    server.herobrineVoice = async (q) => {
      asked.push(q.character ?? 'herobrine');
      return 'hello brother';
    };
    server.handle(conn, { t: 'chat', text: 'green steve are you there?' });
    await flush();
    tick(server, 70);
    expect(asked).toEqual(['green_steve']);
    const said = conn.of('chat').filter((m) => m.text === 'hello brother');
    expect(said.map((m) => m.from)).toEqual(['Green Steve']);
    expect(said[0]!.kind).toBe('greensteve');
    // And Herobrine, named
    tick(server, 120);
    server.handle(conn, { t: 'chat', text: 'herobrine?' });
    await flush();
    tick(server, 70);
    expect(asked).toEqual(['green_steve', 'herobrine']);
    // (he shouts)
    expect(conn.of('chat').filter((m) => m.text.toLowerCase() === 'hello brother').map((m) => [m.from, m.text])).toEqual([
      ['Green Steve', 'hello brother'],
      ['Herobrine', 'HELLO BROTHER'],
    ]);
  }, 60000);

  it('old saves (one haunting) carry on as the first; their blocks are its', () => {
    const flags: Record<string, unknown> = {
      haunt: { t: 100, total: 2400, erase: false, by: 'x', done: [], ending: 'erased', char: 'null' },
      hauntBlocks: [
        ['overworld', 1, 2, 3, 0, 5],
        ['overworld', 4, 5, 6, 0, 7, 'cave_dweller'],
        ['overworld', 7, 8, 9, 0, 7, 'nobody'],
      ],
    };
    sanitizeHauntFlags(flags);
    expect(flags.haunt).toBeUndefined();
    expect((flags.haunts as HauntState[]).map((s) => [s.char, s.t])).toEqual([['null', 100]]);
    expect(flags.hauntBlocks).toEqual([
      ['overworld', 1, 2, 3, 0, 5, 'null'],
      ['overworld', 4, 5, 6, 0, 7, 'cave_dweller'],
    ]);
    // One of each, however many a save claims
    const many: Record<string, unknown> = {
      haunts: [
        { t: 1, total: 100, erase: false, by: 'x', done: [], char: 'null' },
        { t: 2, total: 100, erase: false, by: 'x', done: [], char: 'null' },
        { t: 3, total: 100, erase: false, by: 'x', done: [] },
        { t: 'bad', total: 100 },
      ],
    };
    sanitizeHauntFlags(many);
    expect((many.haunts as HauntState[]).map((s) => [s.char, s.t])).toEqual([
      ['null', 1],
      ['herobrine', 3],
    ]);
  });

  it('a world saved with several running loads with all of them, an end at a time', async () => {
    const { server, storage } = await makeServer({ seed: 'save-several', cheats: true });
    const { conn } = await join(server, 'Steve', 'uuid-steve', 4);
    admin(server, conn, { a: 'haunt', op: 'start_all', minutes: 3 });
    for (const c of ['null', 'cave_dweller'] as const) {
      const st = hauntOf<HauntState>(server, c)!;
      st.t = Math.ceil(st.total * 0.97);
    }
    await server.stop();
    const { GameServer } = await import('../../src/server/GameServer');
    const { installGameplay } = await import('../../src/server/gameplay');
    const again = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(again);
    const p2 = await join(again, 'Steve', 'uuid-steve', 4);
    tick(again, 1);
    expect(chars(again)).toEqual([...HAUNT_CHARACTERS]);
    const st = again.haunting!.status(p2.player);
    // The first of them in its end starts it again; the other waits on the edge of its own
    expect(st.hauntings!.filter((h) => h.stage === 'finale' && !h.waiting).map((h) => h.character)).toEqual(['null']);
    expect(st.hauntings!.find((h) => h.character === 'cave_dweller')!.waiting).toBe(true);
    await again.stop();
  }, 60000);

  it('the panel: character kept on stop, skip and finale; Start all four takes minutes in range', () => {
    expect(validateAdmin({ a: 'haunt', op: 'stop', character: 'null' })).toEqual({ a: 'haunt', op: 'stop', character: 'null' });
    expect(validateAdmin({ a: 'haunt', op: 'skip', character: 'cave_dweller' })).toEqual({ a: 'haunt', op: 'skip', character: 'cave_dweller' });
    expect(validateAdmin({ a: 'haunt', op: 'finale', character: 'green_steve' })).toEqual({ a: 'haunt', op: 'finale', character: 'green_steve' });
    expect(validateAdmin({ a: 'haunt', op: 'finale_in', minutes: 2, character: 'null' })).toMatchObject({ op: 'finale_in', minutes: 2, character: 'null' });
    expect(validateAdmin({ a: 'haunt', op: 'stop', character: 'bogus' })).toBeNull();
    expect(validateAdmin({ a: 'haunt', op: 'start_all' })).toEqual({ a: 'haunt', op: 'start_all' });
    expect(validateAdmin({ a: 'haunt', op: 'start_all', minutes: 5 })).toEqual({ a: 'haunt', op: 'start_all', minutes: 5 });
    expect(validateAdmin({ a: 'haunt', op: 'start_all', minutes: 0 })).toBeNull();
    expect(validateAdmin({ a: 'haunt', op: 'start_all', minutes: 1e9 })).toBeNull();
    expect(validateAdmin({ a: 'haunt', op: 'stop_all' })).toEqual({ a: 'haunt', op: 'stop_all' });
  });
});
