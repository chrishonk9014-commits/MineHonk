/**
 * Version 4.5 temples: every temple generates with its trials and seals, the
 * trials run in order, the Champion's Trial rewards a lone player who beats
 * the champion, and a duel between players rewards the last one standing
 * (knocked-out contestants survive). V4 worlds keep their old temples.
 */
import { describe, it, expect } from 'vitest';
import { initItems, itemOf } from '../../src/common/registry/items';
import { blockOf, withProp, getProp } from '../../src/common/registry/blocks';
import { stackOf } from '../../src/common/game/itemstack';
import { seedFromString } from '../../src/common/math/rng';
import { OverworldGenerator } from '../../src/common/gen/generator';
import { TEMPLE_IDS } from '../../src/common/gen/v5/temples';
import type { Start, TempleQuest } from '../../src/common/gen/structures/manager';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { TempleTrials } from '../../src/server/systems/TempleTrials';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';

initItems();

type P3 = [number, number, number];
const SEED = 'v5-probe';

async function settle(server: GameServer, rounds = 120): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

function templeStart(gen: OverworldGenerator, type: string): Start {
  const loc = gen.locate(type, 0, 0)!;
  expect(loc, type).toBeTruthy();
  return gen.structures.startsFor(loc.x >> 4, loc.z >> 4).find((t) => t.type === type)!;
}

async function atTemple(names: string[], type = 'jungle_temple'): Promise<{ server: GameServer; s: Start; q: TempleQuest; players: { conn: FakeConn; player: ServerPlayer }[] }> {
  const { server } = await makeServer({ seed: SEED });
  const players = [];
  for (const n of names) players.push(await join(server, n));
  const s = templeStart(server.overworld.generator as OverworldGenerator, type);
  const q = s.quest as TempleQuest;
  for (const { player } of players) server.teleport(player, q.exit[0] + 0.5, q.exit[1], q.exit[2] + 0.5);
  await settle(server, 150);
  return { server, s, q, players };
}

const inv = (p: ServerPlayer): string[] => {
  const out: string[] = [];
  for (let i = 0; i < 41; i++) {
    const st = p.inventory.get(i);
    if (st) out.push(itemOf(st.id)!.id);
  }
  return out;
};

/** Does trial i the way a player would. */
async function solve(server: GameServer, player: ServerPlayer, s: Start, i: number): Promise<void> {
  const q = s.quest as TempleQuest;
  const m = q.missions[i]!;
  const dim = player.dim;
  const tt = server.templeTrials!;
  const use = (p: P3): void => void tt.useBlock(player, ...p, dim.getState(...p));
  switch (m.type) {
    case 'altars':
      for (const a of m.altars) use(a);
      break;
    case 'relic':
      player.inventory.set(player.selectedSlot, stackOf('temple_relic', 1));
      use(m.altar);
      expect(inv(player)).not.toContain('temple_relic');
      break;
    case 'braziers':
      for (const b of m.braziers) dim.setBlock(...b, withProp(dim.getState(...b), 'lit', 'true'));
      tick(server, 2);
      break;
    case 'levers':
      for (const l of m.levers) dim.setBlock(...l.at, withProp(dim.getState(...l.at), 'powered', l.on ? 'true' : 'false'));
      tick(server, 2);
      break;
    case 'guardians': {
      const sp = m.spawns[0]!;
      server.teleport(player, sp[0] + 0.5, sp[1], sp[2] + 0.5);
      tick(server, 20);
      const key = TempleTrials.key(s);
      expect(tt.runs.get(key)?.kind).toBe('guardians');
      for (let w = 0; w < 10 && tt.runs.has(key); w++) {
        const r = tt.runs.get(key)!;
        expect(r.mobs.length).toBeGreaterThan(0);
        for (const mob of r.mobs) mob.remove();
        tick(server, 20);
      }
      expect(tt.runs.has(key)).toBe(false);
      break;
    }
  }
}

describe('Version 4.5 temples', () => {
  it('each temple generates with three trials, its seals, altars and relic', () => {
    const gen = new OverworldGenerator(seedFromString(SEED));
    for (const type of TEMPLE_IDS) {
      const s = templeStart(gen, type);
      const q = s.quest as TempleQuest;
      expect(q.kind, type).toBe('temple');
      expect(q.missions.length).toBe(3);
      expect(q.missions.map((m) => m.type)).toContain('guardians');
      expect(q.missions[0]!.type).not.toBe('guardians');
      expect(q.seals.length).toBe(3);
      const chunks = new Map<string, ReturnType<OverworldGenerator['generate']>>();
      const id = (x: number, y: number, z: number): string => {
        const k = (x >> 4) + ',' + (z >> 4);
        if (!chunks.has(k)) chunks.set(k, gen.generate(x >> 4, z >> 4));
        return blockOf(chunks.get(k)!.get(x & 15, y, z & 15)).id;
      };
      for (const group of q.seals) for (const seal of group) expect(id(...seal.at), type + ' seal').toBe('temple_seal');
      for (const m of q.missions) {
        if (m.type === 'altars') for (const a of m.altars) expect(id(...a)).toBe('temple_altar');
        if (m.type === 'relic') {
          expect(id(...m.altar)).toBe('temple_altar');
          expect(id(...m.chest)).toBe('chest');
          const be = chunks.get((m.chest[0] >> 4) + ',' + (m.chest[2] >> 4))!.blockEntities;
          expect([...be.values()].some((e) => (e as { loot?: string }).loot === 'chest/temple_relic')).toBe(true);
        }
        if (m.type === 'braziers') for (const b of m.braziers) expect(id(...b)).toBe('campfire');
        if (m.type === 'levers') for (const l of m.levers) expect(id(...l.at)).toBe('lever');
      }
      // The arena is open sky over solid floor
      expect(id(q.center[0], q.center[1] - 1, q.center[2])).not.toBe('air');
      expect(id(q.center[0], q.center[1] + 1, q.center[2])).toBe('air');
    }
  }, 600000);

  it('V4 worlds keep their old temples; Version 4.5 worlds have the new ones', () => {
    const v4 = new OverworldGenerator(seedFromString(SEED), { version: 4 });
    const v5 = new OverworldGenerator(seedFromString(SEED));
    for (const t of ['frost_temple', 'desert_pyramid', 'mountain_temple']) {
      expect(v4.structureTypes()).not.toContain(t);
      expect(v5.structureTypes()).toContain(t);
    }
    expect(templeStart(v4, 'jungle_temple').quest).toBeUndefined();
    expect(templeStart(v5, 'jungle_temple').quest?.kind).toBe('temple');
  }, 240000);

  it('runs the trials in order, then a lone player fights the champion for the prize', async () => {
    const { server, s, q, players } = await atTemple(['Hero']);
    const { player, conn } = players[0]!;
    const tt = server.templeTrials!;
    const dim = player.dim;
    const rec = (): { stage: number; done: boolean } => server.level.quests.temple[TempleTrials.key(s)]!;
    expect(player.achievements.has('find_temple')).toBe(true);
    expect(conn.last('quest')?.quest?.title).toBe(q.name);
    // A later trial's altar is dormant
    const later = q.missions.findIndex((m, i) => i > 0 && (m.type === 'altars' || m.type === 'relic'));
    if (later > 0) {
      const m = q.missions[later]!;
      const a = m.type === 'altars' ? m.altars[0]! : m.type === 'relic' ? m.altar : null;
      player.inventory.set(player.selectedSlot, stackOf('temple_relic', 1));
      tt.useBlock(player, ...a!, dim.getState(...a!));
      expect(getProp(dim.getState(...a!), 'lit')).toBe('false');
    }
    for (let i = 0; i < 3; i++) {
      expect(dim.blockId(...q.seals[i]![0]!.at)).toBe('temple_seal');
      await solve(server, player, s, i);
      expect(rec().stage, `trial ${i + 1} (${q.missions[i]!.type})`).toBe(i + 1);
      expect(dim.blockId(...q.seals[i]![0]!.at)).not.toBe('temple_seal');
    }
    expect(player.achievements.has('temple_trial')).toBe(true);
    // The Champion's Trial
    server.teleport(player, q.center[0] + 3.5, q.center[1], q.center[2] + 0.5);
    tick(server, 20);
    const key = TempleTrials.key(s);
    expect(tt.runs.get(key)?.kind).toBe('countdown');
    tick(server, 110);
    const r = tt.runs.get(key)!;
    expect(r.kind).toBe('champion');
    expect(r.mobs[0]!.customName).toBe(q.champion.name);
    expect(tt.pvpBetween(player, player)).toBe(false);
    r.mobs[0]!.remove();
    tick(server, 20);
    expect(rec().done).toBe(true);
    expect(player.achievements.has('temple_champion')).toBe(true);
    expect(player.achievements.has('temple_duel')).toBe(false);
    expect(inv(player).length).toBeGreaterThan(0);
    expect(conn.of('title').some((t) => t.text === 'CHAMPION')).toBe(true);
    // Done is done: stepping back into the arena starts nothing
    tick(server, 40);
    expect(tt.runs.has(key)).toBe(false);
  }, 300000);

  it('with several players the Champion\'s Trial is a duel: knocked out, not killed, and the last one standing wins', async () => {
    const { server, s, q, players } = await atTemple(['Ana', 'Ben'], 'desert_pyramid');
    const [ana, ben] = [players[0]!.player, players[1]!.player];
    const tt = server.templeTrials!;
    server.level.pvp = false;
    for (let i = 0; i < 3; i++) tt.completeMission(ana.dim, s, i);
    for (const p of [ana, ben]) server.teleport(p, q.center[0] + 0.5, q.center[1], q.center[2] + 0.5);
    tick(server, 20);
    tick(server, 110);
    const key = TempleTrials.key(s);
    expect(tt.runs.get(key)?.kind).toBe('duel');
    // PvP is on between the contestants, even with the world's PvP off
    expect(tt.pvpBetween(ana, ben)).toBe(true);
    // (the join's spawn protection only wears off as a real client moves)
    ben.spawnProtection = 0;
    const hit = server.mobs!.damage(ben, 1000, { source: 'player', attacker: ana });
    expect(hit).toBeGreaterThan(0);
    expect(ben.dead).toBe(false);
    expect(ben.health).toBeGreaterThan(0);
    // Ben woke up down by the entrance, out of the arena
    expect(Math.abs(ben.x - (q.exit[0] + 0.5))).toBeLessThan(2);
    tick(server, 20);
    expect(server.level.quests.temple[key]!.done).toBe(true);
    expect(ana.achievements.has('temple_champion')).toBe(true);
    expect(ana.achievements.has('temple_duel')).toBe(true);
    expect(inv(ana).length).toBeGreaterThan(0);
    expect(inv(ben).length).toBe(0);
    // The duel is over: PvP is back to the world's rule
    expect(tt.pvpBetween(ana, ben)).toBe(false);
    expect(server.mobs!.damage(ben, 5, { source: 'player', attacker: ana })).toBe(0);
  }, 300000);

  it('keeps progress through a save and counts Admin Panel trials as cheats', async () => {
    const { server, s, q, players } = await atTemple(['Hero']);
    const { player } = players[0]!;
    await solve(server, player, s, 0);
    await server.saveAll();
    expect(server.level.quests.temple[TempleTrials.key(s)]!.stage).toBe(1);
    expect(player.dim.blockId(...q.seals[0]![0]!.at)).toBe('air');
    // Admin: complete a trial and reset
    const res = server.templeTrials!.adminAdvance(player.dim, s);
    expect(res).toMatch(/trial 2|Cleared/);
    expect(server.level.quests.temple[TempleTrials.key(s)]!.stage).toBe(2);
    server.templeTrials!.adminReset(player.dim, s);
    expect(server.level.quests.temple[TempleTrials.key(s)]).toBeUndefined();
    expect(player.dim.blockId(...q.seals[0]![0]!.at)).toBe('temple_seal');
  }, 300000);
});
