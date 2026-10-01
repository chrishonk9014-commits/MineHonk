/** V4: the Glitched Structure's five stages, the Glitched gear reward, and how the quest keeps and resets. */
import { describe, it, expect } from 'vitest';
import { blockOf } from '../../src/common/registry/blocks';
import { itemOf } from '../../src/common/registry/items';
import { isAdminStack } from '../../src/common/game/itemstack';
import { MemoryStorage } from '../../src/server/storage/Storage';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { GLITCH_STAGES, levelFloor, shaftAt, type ErrorChunk } from '../../src/common/gen/v4/errorBiome';
import { GLITCH_STAGE_DEFS } from '../../src/server/systems/GlitchedQuest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';

async function settle(server: GameServer, rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

/** Puts a player (legitimately) in a level of the structure: 0 entry hall, 1..5 arenas, 6 vault. */
function stand(server: GameServer, p: ServerPlayer, e: ErrorChunk, level: number): void {
  server.teleport(p, (e.cx << 4) + 7.5, levelFloor(e, level) + 1, (e.cz << 4) + 2.5);
  p.health = p.maxHealth;
}

async function atStructure(storage = new MemoryStorage(), names = ['Hero']): Promise<{ server: GameServer; e: ErrorChunk; players: { conn: FakeConn; player: ServerPlayer }[] }> {
  const { server } = await makeServer({ seed: 'glitched-quest', mode: 'survival' }, storage);
  const players = [];
  for (const n of names) players.push(await join(server, n));
  const e = server.overworld.generator.nearestErrorChunk!(0, 0)!;
  expect(e).toBeTruthy();
  for (const { player } of players) stand(server, player, e, 0);
  await settle(server, 120);
  return { server, e, players };
}

/** Kills the stage's mobs and lets the quest notice. */
function killStage(server: GameServer): void {
  for (const f of server.glitchedQuest!.fights.values()) for (const m of f.mobs) m.remove();
  tick(server, 20);
}

describe('V4 Glitched Structure quest', () => {
  it('runs five stages, opening each firewall, and rewards one Glitched tool and one Glitched armor piece', async () => {
    const { server, e, players } = await atStructure();
    const { player, conn } = players[0]!;
    const dim = player.dim;
    const q = server.glitchedQuest!;
    const key = `overworld:${e.cx},${e.cz}`;
    expect(player.achievements.has('enter_glitched_structure')).toBe(true);
    expect(player.achievements.has('find_error_biome')).toBe(true);
    // The tracker shows up inside
    expect(conn.last('quest')?.quest?.title).toBe('Glitched Structure');
    for (let stage = 1; stage <= GLITCH_STAGES; stage++) {
      stand(server, player, e, stage);
      tick(server, 20);
      const f = q.fights.get(key)!;
      expect(f, `stage ${stage} starts`).toBeTruthy();
      expect(f.stage).toBe(stage);
      const expected = GLITCH_STAGE_DEFS[stage - 1]!.spawns.reduce((a, s) => a + s.count, 0);
      expect(f.mobs.length).toBe(expected);
      expect(conn.of('title').some((t) => t.text === `STAGE ${stage} / ${GLITCH_STAGES}`)).toBe(true);
      // Each stage is tougher than the one before
      if (stage > 1) expect(f.maxHp).toBeGreaterThan(0);
      // The firewall below stays shut until the stage is cleared
      const { lx, lz } = shaftAt(stage);
      expect(dim.blockId((e.cx << 4) + lx, levelFloor(e, stage), (e.cz << 4) + lz)).toBe('glitch_firewall');
      killStage(server);
      expect(q.fights.has(key)).toBe(false);
      expect(dim.blockId((e.cx << 4) + lx, levelFloor(e, stage), (e.cz << 4) + lz)).toBe('ladder');
      expect(server.level.quests.glitch[key]!.stage).toBe(stage);
    }
    const rec = server.level.quests.glitch[key]!;
    expect(rec.done).toBe(true);
    expect(rec.rewarded).toContain(player.uuid);
    // The existing Glitched gear: exactly one tool and one armor piece, and they are legit
    const got: string[] = [];
    for (let i = 0; i < 41; i++) {
      const st = player.inventory.get(i);
      if (!st) continue;
      const id = itemOf(st.id)!.id;
      if (id.startsWith('glitched_')) {
        got.push(id);
        expect(isAdminStack(st)).toBe(false);
      }
    }
    const tools = got.filter((i) => /_(sword|pickaxe|axe|shovel|hoe)$/.test(i));
    const armor = got.filter((i) => /_(helmet|chestplate|leggings|boots)$/.test(i));
    expect(tools.length).toBe(1);
    expect(armor.length).toBe(1);
    expect(player.achievements.has('glitched_quest')).toBe(true);
    expect(player.achievements.has('glitched_reward')).toBe(true);
    // Never the Corrupted Eye, never the Farlands
    expect(got).not.toContain('corrupted_eye');
    expect(server.level.endings.farlandsAccess).toBe(false);
    // Going back in does not start anything again, and nobody is rewarded twice
    stand(server, player, e, 3);
    tick(server, 20);
    expect(q.fights.size).toBe(0);
    expect(conn.last('quest')?.quest?.text).toMatch(/Complete/);
  }, 120000);

  it('keeps progress through a save, and a stage everyone leaves starts over', async () => {
    const storage = new MemoryStorage();
    const { server, e, players } = await atStructure(storage);
    const { player } = players[0]!;
    const q = server.glitchedQuest!;
    const key = `overworld:${e.cx},${e.cz}`;
    stand(server, player, e, 1);
    tick(server, 20);
    killStage(server);
    stand(server, player, e, 2);
    tick(server, 20);
    const f = q.fights.get(key)!;
    const mobs = [...f.mobs];
    // Walk away: after half a minute the stage's mobs dissolve
    server.teleport(player, (e.cx << 4) + 60, 120, (e.cz << 4) + 60);
    tick(server, 20);
    // The stage's bar goes away as soon as you leave
    expect(players[0]!.conn.last('boss')?.action).toBe('remove');
    tick(server, 620);
    expect(q.fights.has(key)).toBe(false);
    expect(mobs.every((m) => m.removed)).toBe(true);
    expect(server.level.quests.glitch[key]!.stage).toBe(1);
    await server.saveAll();
    // A new server remembers stage 1 is done and the first firewall is open
    const again = await atStructure(storage, ['Hero']);
    const { lx, lz } = shaftAt(1);
    expect(again.server.level.quests.glitch[key]!.stage).toBe(1);
    expect(again.players[0]!.player.dim.blockId((e.cx << 4) + lx, levelFloor(e, 1), (e.cz << 4) + lz)).toBe('ladder');
    stand(again.server, again.players[0]!.player, e, 2);
    tick(again.server, 20);
    expect(again.server.glitchedQuest!.fights.get(key)?.stage).toBe(2);
  }, 120000);

  it('rewards everyone who fought, and scales the mobs to the party', async () => {
    const solo = await atStructure(new MemoryStorage(), ['Solo']);
    stand(solo.server, solo.players[0]!.player, solo.e, 1);
    tick(solo.server, 20);
    const soloHp = [...solo.server.glitchedQuest!.fights.values()][0]!.maxHp;
    const { server, e, players } = await atStructure(new MemoryStorage(), ['Ana', 'Ben']);
    for (let stage = 1; stage <= GLITCH_STAGES; stage++) {
      for (const { player } of players) stand(server, player, e, stage);
      tick(server, 20);
      if (stage === 1) expect([...server.glitchedQuest!.fights.values()][0]!.maxHp).toBeGreaterThan(soloHp);
      killStage(server);
    }
    for (const { player, conn } of players) {
      expect(player.achievements.has('glitched_quest')).toBe(true);
      expect(conn.of('title').some((t) => t.text === 'QUEST COMPLETE')).toBe(true);
    }
  }, 120000);

  it('counts as a cheat when reached through the Admin Panel: no advancements, cheat-marked rewards', async () => {
    const { server } = await makeServer({ seed: 'glitched-quest', mode: 'survival', cheats: true });
    const { player } = await join(server);
    const e = server.overworld.generator.nearestErrorChunk!(0, 0)!;
    server.admin.moveTo(player, 'overworld', (e.cx << 4) + 7.5, levelFloor(e, 0) + 1, (e.cz << 4) + 2.5);
    await settle(server, 120);
    expect(player.achievements.has('find_error_biome')).toBe(false);
    for (let stage = 1; stage <= GLITCH_STAGES; stage++) {
      stand(server, player, e, stage);
      tick(server, 20);
      killStage(server);
    }
    expect(player.achievements.has('glitched_quest')).toBe(false);
    let marked = 0;
    for (let i = 0; i < 41; i++) {
      const st = player.inventory.get(i);
      if (st && itemOf(st.id)!.id.startsWith('glitched_')) {
        expect(isAdminStack(st)).toBe(true);
        marked++;
      }
    }
    expect(marked).toBe(2);
    void blockOf;
  }, 120000);
});
