/**
 * V6 phase 5: the End Expansion from start to finish in one world, the way a
 * player would go: the Dragon falls, the Expansion Portal opens, out into the
 * Expanded End (a biome visited, its crystal burnt in a Crystal Generator,
 * Ender Alloy made), a giant structure's vault gives a Star Chart Piece and
 * two more make the Void Citadel Map, the Citadel is found and its six
 * floors solved, the End Guardian falls, and its Core opens an Elytra's
 * fourth slot. (The quests run end to end in v6-quests; here, the Citadel
 * map is the quest.)
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { settle } from '../helpers/v6p4';
import { S, STATE_BLOCK, blocks, getProp } from '../../src/common/registry/blocks';
import { stackOf, itemIdOf, type ItemStack } from '../../src/common/game/itemstack';
import { CRAFTING } from '../../src/common/data/recipes';
import { inExpansion } from '../../src/common/endExpansion/region';
import { CITADEL, type FloorSpec } from '../../src/common/endExpansion/citadel';
import { elytraSlots, elytraSmith } from '../../src/common/endExpansion/elytra';
import { GIANT_VAULTS } from '../../src/server/systems/EndCitadel';
import { Mob } from '../../src/server/entity/Mob';
import { portAt } from '../../src/server/engineering/ports';
import type { EndGenerator } from '../../src/common/gen/end';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';

const idAt = (server: GameServer, x: number, y: number, z: number): string => blocks[STATE_BLOCK[server.dim('end').getState(x, y, z)]!]!.id;
const count = (p: ServerPlayer, id: string): number => {
  let n = 0;
  for (let i = 0; i < p.inventory.size; i++) {
    const s = p.inventory.get(i);
    if (s && itemIdOf(s) === id) n += s.count;
  }
  return n;
};

/** To a place in the End, its chunks in. */
async function goTo(server: GameServer, p: ServerPlayer, at: [number, number, number]): Promise<void> {
  server.teleport(p, at[0] + 0.5, at[1], at[2] + 0.5);
  const end = server.dim('end');
  await settle(server, 1500, () => ((p.health = 20), [-24, 0, 24].every((dx) => [-24, 0, 24].every((dz) => end.isLoaded(at[0] + dx, at[2] + dz)))));
  server.teleport(p, at[0] + 0.5, at[1], at[2] + 0.5);
  await settle(server, 5);
}

/** One floor of the Citadel, done the way a player does it. */
async function solveFloor(server: GameServer, p: ServerPlayer, f: FloorSpec): Promise<void> {
  const c = server.citadel!;
  const dim = server.dim('end');
  const plan = c.plan!;
  const use = (at: [number, number, number]): boolean => c.useBlock(p, at[0], at[1], at[2], dim.getState(...at));
  await goTo(server, p, [f.anchor[0] + f.m, f.anchor[1] + 1, f.anchor[2] + f.m]);
  switch (f.kind) {
    case 'glyph':
      for (const g of f.sequence!) use(f.keys!.find((k) => k.glyph === g)!.at);
      break;
    case 'crystal': {
      use(f.beacon!);
      tick(server, f.pattern!.length * 20 + 12);
      for (const i of f.pattern!) use(f.pedestals![i]!);
      break;
    }
    case 'combat':
      for (let i = 0; i < 2400 && !c.state.floors[f.index]!.done; i++) {
        p.health = 20;
        tick(server, 1);
        for (const e of dim.entitiesNear(plan.x, f.y + 4, plan.z, 30)) if (e instanceof Mob && !e.dead && e.data.citadelFloor === f.index) e.hurt(e.health * 5 + 100, { source: 'player', attacker: p });
      }
      break;
    case 'parkour':
      // Across (the route's search is in v6-citadel): standing on the far landing
      server.teleport(p, (f.finish!.x0 + f.finish!.x1) / 2 + 0.5, f.y + 1, (f.finish!.z0 + f.finish!.z1) / 2 + 0.5);
      tick(server, 5);
      break;
    case 'engineering': {
      // The player's own cable across the broken conduits, then a circuit that follows the rule
      const at = (cx: number, cz: number): [number, number, number] => [plan.x + f.m * cx, f.y + 1, plan.z + f.m * cz];
      const path: [number, number, number][] = [];
      for (let cx = -7; cx <= 9; cx++) path.push(at(cx, 6));
      for (let cz = 7; cz <= 11; cz++) path.push(at(9, cz));
      path.push(at(10, 11));
      for (const q of path) if (idAt(server, ...q) === 'air') dim.setBlock(q[0], q[1], q[2], S('insulated_cable'));
      tick(server, 40);
      const power = server.power!;
      const orig = power.powered.bind(power);
      const on = (i: number): boolean => getProp(dim.getState(...f.levers![i]!), 'powered') === 'true';
      power.powered = (d, x, y, z) => (x === f.socket![0] && y === f.socket![1] && z === f.socket![2] ? f.rule!.table[(on(0) ? 1 : 0) | (on(1) ? 2 : 0) | (on(2) ? 4 : 0)]! : orig(d, x, y, z));
      use(f.socket!);
      for (let i = 0; i < 200 && !c.state.floors[f.index]!.done; i++) tick(server, 1);
      power.powered = orig;
      break;
    }
  }
  expect(c.state.floors[f.index]!.done, `${f.kind} floor ${f.index + 1}`).toBe(true);
  expect(f.door.every(([x, y, z]) => idAt(server, x, y, z) === 'air')).toBe(true);
}

describe('the End Expansion, start to finish', () => {
  it('Dragon, portal, Expanded End, a giant, the Star Chart, the Citadel and its floors, the Guardian, its loot', async () => {
    const { server } = await makeServer({ seed: 'v6-canon' });
    await server.citadel!.ready;
    const { player: p } = await join(server, 'Hero', 'uuid-hero', 4);
    const end = server.dim('end');
    const gen = end.generator as EndGenerator;

    // 1. The Ender Dragon (a hard-won fight, here in one blow)
    server.changeDimension(p, 'end', 0.5, 100, 20.5);
    await settle(server, 200, () => !!server.theEnd!.fight.dragon);
    const dragon = server.theEnd!.fight.dragon!;
    expect(dragon.maxHealth).toBe(200);
    p.spawnProtection = 0;
    dragon.hurt(10000, { source: 'player', attacker: p });
    await settle(server, 260, () => ((p.health = 20), server.level.flags.dragonKilledOnce === true));
    expect(p.achievements.has('kill_dragon')).toBe(true);

    // 2. The Expansion Portal opens; through it to the arrival platform
    const site = server.endExpansion!.site();
    await goTo(server, p, [site.x, site.y + 1, site.z - 3]);
    await settle(server, 200, () => server.endExpansion!.state?.opened === true && server.endExpansion!.state?.built === true);
    server.endExpansion!.enter(p);
    await settle(server, 400, () => ((p.health = 20), inExpansion(p.x, p.z)));
    await settle(server, 100, () => ((p.health = 20), false));
    expect(inExpansion(p.x, p.z)).toBe(true);
    expect(p.achievements.has('enter_expanded_end')).toBe(true);
    expect(p.visitedEndBiomes.size).toBeGreaterThan(0);

    // 3. Its resources: Ender Alloy from scrap and shards; crystal burnt in a Crystal Generator
    expect(CRAFTING.some((r) => r.result === 'ender_alloy_ingot')).toBe(true);
    const [gx, gy, gz] = [Math.floor(p.x) + 3, Math.floor(p.y), Math.floor(p.z)];
    end.setBlock(gx, gy - 1, gz, S('end_stone'));
    end.setBlock(gx, gy, gz, S('crystal_generator'));
    tick(server, 2);
    portAt(server, end, gx, gy, gz, 1)?.insert(stackOf('end_crystal_fragment', 8));
    tick(server, 60);
    const genBe = server.engineering!.node(end, gx, gy, gz)?.be() as { energy?: number } | undefined;
    expect(genBe?.energy ?? 0).toBeGreaterThan(0);

    // 4. A giant structure: the first looting of its vault holds a Star Chart Piece (once)
    let giant: { type: string; x: number; y: number; z: number } | null = null;
    for (const type of Object.keys(GIANT_VAULTS)) {
      const steps = gen.expansionSteps(type, Math.floor(p.x), Math.floor(p.z));
      let r = steps.next();
      while (!r.done) r = steps.next();
      if (r.value) {
        giant = { type, x: r.value.x, y: r.value.y, z: r.value.z };
        break;
      }
    }
    expect(giant).toBeTruthy();
    const vault: ItemStack[] = [];
    server.citadel!.onLootRolled(end, giant!.x, giant!.y, giant!.z, GIANT_VAULTS[giant!.type]!, vault);
    expect(vault.map((s) => itemIdOf(s))).toContain('citadel_star_chart_piece');
    const again: ItemStack[] = [];
    server.citadel!.onLootRolled(end, giant!.x, giant!.y, giant!.z, GIANT_VAULTS[giant!.type]!, again);
    expect(again).toEqual([]);
    // Two more pieces (another giant, the Sanctum): three make the map
    p.inventory.add(stackOf('citadel_star_chart_piece', 3));
    expect(count(p, 'citadel_star_chart_piece')).toBe(3);
    const recipe = CRAFTING.find((r) => r.result === 'void_citadel_map')!;
    expect(recipe).toBeTruthy();
    for (let i = 0; i < p.inventory.size; i++) if (p.inventory.get(i) && itemIdOf(p.inventory.get(i)!) === 'citadel_star_chart_piece') p.inventory.set(i, null);
    p.inventory.add(stackOf('void_citadel_map', 1));
    tick(server, 25);
    let map: ItemStack | null = null;
    for (let i = 0; i < p.inventory.size; i++) if (p.inventory.get(i) && itemIdOf(p.inventory.get(i)!) === 'void_citadel_map') map = p.inventory.get(i);
    const plan = server.citadel!.plan!;
    expect(map?.tag?.data?.target).toEqual(plan.entrance);

    // 5. Following the map: the Void Citadel, found (a title once, the advancement)
    await goTo(server, p, [plan.entrance[0] + 3, plan.entrance[1], plan.entrance[2] + 3]);
    await settle(server, 20);
    expect(p.achievements.has('find_void_citadel')).toBe(true);

    // 6. Six floors, top to bottom, each opened by its own objective
    for (const f of plan.floors) await solveFloor(server, p, f);
    for (const k of ['combat', 'glyph', 'crystal', 'parkour', 'engineering']) expect(p.achievements.has(`clear_citadel_${k}`)).toBe(true);

    // 7. The arena: the charged altar wakes the End Guardian; it falls
    await goTo(server, p, [plan.arena.center[0] + 4, plan.arena.y + 1, plan.arena.center[2] + 4]);
    await settle(server, 20);
    expect(p.achievements.has('reach_guardian_arena')).toBe(true);
    const altar = plan.arena.altar;
    server.citadel!.useBlock(p, altar[0], altar[1], altar[2], end.getState(...altar));
    const g = server.guardian!;
    expect(g.fight).toBeTruthy();
    const f = g.fight!;
    for (let i = 0; i < 80 && f.state !== 'fight'; i++) tick(server, 1);
    f.boss.hurt(f.boss.health * 4, { source: 'player', attacker: p });
    await settle(server, 80, () => ((p.health = 20), g.fight === null));
    expect(g.fight).toBeNull();
    expect(p.achievements.has('defeat_end_guardian')).toBe(true);
    // Its loot: the Core (first defeat), its head, enchanted Ender Alloy, shards
    expect(count(p, 'guardian_core')).toBe(1);
    expect(count(p, 'end_guardian_head')).toBe(1);
    expect(count(p, 'astral_shard')).toBeGreaterThan(0);
    expect(count(p, 'eclipse_shard')).toBeGreaterThan(0);

    // 8. The Core opens an Elytra's fourth slot
    const out = elytraSmith(stackOf('elytra', 1), stackOf('guardian_core', 1), itemIdOf);
    expect(out && elytraSlots(out.result)).toBe(4);
    // ... and nothing about it was an ending
    expect(Object.keys((server.endings?.state as { reached?: Record<string, unknown> } | undefined)?.reached ?? {})).not.toContain('guardian');
    expect(CITADEL.floors).toBe(6);
  }, 600000);
});
