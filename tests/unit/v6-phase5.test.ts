/**
 * V6 phase 5: the rewards and the finishing pieces. The Guardian Core's
 * fourth Elytra slot, the Eclipse Veil, the Guardian's Lance, the Citadel
 * Star Chart and its map, the new loot tables and lore, the advancements,
 * and the Admin Panel's tools (every one of them advancement-neutral).
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { endPad, settle, type Pad } from '../helpers/v6p4';
import { stackOf, itemIdOf, isAdminStack, type ItemStack } from '../../src/common/game/itemstack';
import { ELYTRA, elytraSlots, elytraUpgrades, withUpgrade, upgradeLines } from '../../src/common/endExpansion/elytra';
import { LANCE, VEIL, RARE_END_LOOT } from '../../src/common/endExpansion/guardian';
import { ECLIPSE_LORE, CITADEL_LORE } from '../../src/common/endExpansion/lore';
import { rollLoot } from '../../src/common/game/loot';
import { Random } from '../../src/common/math/rng';
import { CRAFTING } from '../../src/common/data/recipes';
import { ACHIEVEMENTS } from '../../src/common/data/achievements';
import { validateAdmin, V6_OPS } from '../../src/common/game/admin';
import { DRAGON_TESTS } from '../../src/common/endExpansion/dragon';
import { Mob } from '../../src/server/entity/Mob';
import type { GameServer } from '../../src/server/GameServer';

/** Elytra + something at a smithing table: what comes out (taken). */
function smith(p: Pad, base: ItemStack, addition: ItemStack): ItemStack | null {
  const ct = p.server.interaction.containers;
  ct.openSmithing(p.player, p.dim, p.X, p.Y, p.Z);
  const w = ct.windowFor(p.player)!;
  w.slots[0]!.set(base);
  w.slots[1]!.set(addition);
  w.refresh?.();
  const out = w.slots[2]!.get() as ItemStack | null;
  if (out) w.slots[2]!.onTake?.(p.player, out);
  w.slots[0]!.set(null);
  w.slots[1]!.set(null);
  p.server.interaction.closeWindow(p.player, w.id, true);
  return out;
}

describe('the Guardian Core: a fourth Elytra slot', () => {
  it('opens once at the smithing table; four modules then fit (and the advancement), a fifth never', async () => {
    const p = await endPad('p5-slots');
    let el = stackOf('elytra', 1);
    for (const m of ['reinforced_module', 'thrust_module', 'hover_module']) el = smith(p, el, stackOf(m, 1))!;
    expect(elytraUpgrades(el).length).toBe(3);
    expect(smith(p, el, stackOf('eclipse_veil_module', 1))).toBeNull();
    const four = smith(p, el, stackOf('guardian_core', 1))!;
    expect(elytraSlots(four)).toBe(ELYTRA.maxSlots);
    expect(elytraUpgrades(four)).toEqual(elytraUpgrades(el));
    // Once only
    expect(smith(p, four, stackOf('guardian_core', 1))).toBeNull();
    const full = smith(p, four, stackOf('eclipse_veil_module', 1))!;
    expect(elytraUpgrades(full)).toContain('eclipse_veil');
    expect(p.player.achievements.has('elytra_four_slots')).toBe(true);
    expect(smith(p, full, stackOf('burst_module', 1))).toBeNull();
    expect(upgradeLines(full)[0]).toBe('Upgrades (4/4):');
    // An ordinary Elytra still takes three
    expect(elytraSlots(stackOf('elytra', 1))).toBe(3);
  }, 120000);
});

describe('the Eclipse Veil', () => {
  it('gliding, the mobs after them lose them for five seconds; 60 seconds to recharge', async () => {
    const p = await endPad('p5-veil');
    const { server, player, dim } = p;
    let el = withUpgrade(stackOf('elytra', 1), 'eclipse_veil');
    el = { ...el };
    player.inventory.set(38, el);
    const z = server.mobs!.spawn(dim, 'zombie', p.X + 3.5, p.Y, p.Z + 0.5, { persistent: true })!;
    tick(server, 40);
    z.target = player;
    player.gliding = true;
    server.elytra!.action(player, 'veil');
    expect(player.veiledUntil).toBeGreaterThan(server.tickNo);
    expect(z.target).toBeNull();
    // Nothing picks them out while it lasts
    for (let i = 0; i < 40; i++) {
      tick(server, 1);
      expect(z.target).not.toBe(player);
    }
    // Recharging: a second use does nothing
    const until = player.veiledUntil;
    tick(server, VEIL.ticks);
    server.elytra!.action(player, 'veil');
    expect(player.veiledUntil).toBe(until);
  }, 120000);
});

describe("the Guardian's Lance", () => {
  it('fires a short Crystal Lance (then a 40-tick cooldown) and reaches two blocks further', async () => {
    const p = await endPad('p5-lance');
    const { server, player, dim } = p;
    player.inventory.set(player.selectedSlot, stackOf('guardians_lance', 1));
    player.yaw = -Math.PI / 2; // looking east (+x)
    player.pitch = 0;
    const z = server.mobs!.spawn(dim, 'zombie', p.X + 6.5, p.Y, p.Z + 0.5, { persistent: true })!;
    z.noAi = true;
    tick(server, 2);
    const hp = z.health;
    expect(server.guardian!.useItem(player, player.inventory.get(player.selectedSlot)!, 0)).toBe(true);
    expect(z.health).toBeLessThan(hp);
    expect(hp - z.health).toBeLessThanOrEqual(LANCE.damage);
    const after = z.health;
    tick(server, 12);
    server.guardian!.useItem(player, player.inventory.get(player.selectedSlot)!, 0);
    expect(z.health).toBe(after);
    // Reach: a zombie 5.5 blocks away can be struck with the lance, not with a sword
    const near = server.mobs!.spawn(dim, 'zombie', p.X + 5.8, p.Y, p.Z + 0.5, { persistent: true })!;
    near.noAi = true;
    tick(server, 12);
    player.inventory.set(player.selectedSlot, stackOf('diamond_sword', 1));
    const h0 = near.health;
    server.mobs!.playerAttack(player, near);
    expect(near.health).toBe(h0);
    player.inventory.set(player.selectedSlot, stackOf('guardians_lance', 1));
    server.mobs!.playerAttack(player, near);
    expect(near.health).toBeLessThan(h0);
  }, 120000);
});

describe('the way to the Citadel', () => {
  it('Star Chart Pieces: the first looting of each giant vault, the Sanctum always; three make the map', async () => {
    const { server } = await makeServer({ seed: 'p5-charts' });
    await server.citadel!.ready;
    const c = server.citadel!;
    const gen = server.dim('end').generator as unknown as { expansionStartsAt(x: number, z: number): { type: string; x: number; z: number }[] };
    gen.expansionStartsAt = () => [{ type: 'end_colossus', x: 100, z: 200 }];
    const roll = (): ItemStack[] => {
      const out: ItemStack[] = [];
      c.onLootRolled(server.dim('end'), 100, 80, 200, 'chest/end_colossus_cache', out);
      return out;
    };
    expect(roll().map((s) => itemIdOf(s))).toEqual(['citadel_star_chart_piece']);
    expect(roll()).toEqual([]);
    // The Sanctum always holds one
    for (let i = 0; i < 5; i++) expect(rollLoot('chest/dragon_sanctum', { rng: new Random(i), difficulty: 'normal' }).some((s) => itemIdOf(s) === 'citadel_star_chart_piece')).toBe(true);
    // Three pieces: the Void Citadel Map
    const r = CRAFTING.find((x) => x.type === 'shapeless' && x.result === 'void_citadel_map') as { ingredients: string[] } | undefined;
    expect(r?.ingredients).toEqual(['citadel_star_chart_piece', 'citadel_star_chart_piece', 'citadel_star_chart_piece']);
    // A map in anyone's inventory is marked with the Citadel (its needle points there in the End)
    const { player } = await join(server);
    player.inventory.set(0, stackOf('void_citadel_map', 1));
    tick(server, 25);
    const m = player.inventory.get(0)!;
    expect(m.tag?.data?.target).toEqual(c.plan!.entrance);
    expect(m.tag?.data?.dim).toBe('end');
  }, 120000);

  it('during an eclipse the Citadel shows where it is (the beam)', async () => {
    const { server } = await makeServer({ seed: 'p5-beam' });
    await server.citadel!.ready;
    const ev = server.endEvents!;
    expect(ev.view().citadel).toBeUndefined();
    ev.startEclipse(true);
    expect(ev.view().citadel).toEqual(server.citadel!.plan!.entrance);
  }, 60000);
});

describe('loot and lore', () => {
  it('every new table rolls; monoliths hold eclipse lore, the Citadel its own', async () => {
    const lore = (stacks: ItemStack[]): string[] => stacks.map((s) => s.tag?.lore as string | undefined).filter((x): x is string => !!x);
    for (const t of ['chest/storm_remnant', 'chest/eclipse_monolith', 'chest/citadel_library', 'chest/citadel_vault', 'chest/end_guardian']) {
      for (let i = 0; i < 8; i++) expect(rollLoot(t, { rng: new Random(i * 31), difficulty: 'normal' }).length).toBeGreaterThan(0);
    }
    const eclipse = new Set(ECLIPSE_LORE.map((l) => l.id));
    const citadel = new Set(CITADEL_LORE.map((l) => l.id));
    for (let i = 0; i < 20; i++) {
      const m = lore(rollLoot('chest/eclipse_monolith', { rng: new Random(i), difficulty: 'normal' }));
      expect(m.length).toBe(1);
      expect(eclipse.has(m[0]!)).toBe(true);
      const l = lore(rollLoot('chest/citadel_library', { rng: new Random(i), difficulty: 'normal' }));
      expect(l.length).toBe(1);
      expect(citadel.has(l[0]!)).toBe(true);
      expect(rollLoot('chest/eclipse_monolith', { rng: new Random(i), difficulty: 'normal' }).some((s) => itemIdOf(s) === 'eclipse_shard')).toBe(true);
    }
  });
});

describe('advancements', () => {
  it('the phase\'s advancements are on the End tab, each under one that exists', () => {
    const ids = ['survive_void_storm', 'loot_storm_remnant', 'witness_end_eclipse', 'mine_eclipse_shard', 'find_void_citadel', 'clear_citadel_combat', 'clear_citadel_glyph', 'clear_citadel_crystal', 'clear_citadel_parkour', 'clear_citadel_engineering', 'reach_guardian_arena', 'defeat_end_guardian', 'guardian_no_final_lance', 'elytra_four_slots'];
    const all = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
    for (const id of ids) {
      const a = all.get(id);
      expect(a, id).toBeTruthy();
      expect(a!.category).toBe('end');
      expect(all.has(a!.parent!)).toBe(true);
    }
  });
});

let reqNo = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: unknown }[] {
  const req = reqNo++;
  server.handle(conn, { t: 'admin', req, action });
  return (conn.of('admin_result') as { req: number; ok: boolean; text: string; data?: unknown }[]).filter((r) => r.req === req);
}

describe('the Admin Panel', () => {
  it('validates the new operations', () => {
    for (const op of ['storm_start', 'storm_stop', 'eclipse_start', 'eclipse_stop', 'citadel_solve', 'citadel_reset', 'guardian_spawn', 'guardian_defeat', 'guardian_reset']) expect(validateAdmin({ a: 'v6', op })).toEqual({ a: 'v6', op });
    expect(validateAdmin({ a: 'v6', op: 'citadel_tp', spot: 'arena' })).toEqual({ a: 'v6', op: 'citadel_tp', spot: 'arena' });
    expect(validateAdmin({ a: 'v6', op: 'citadel_tp', spot: '9' })).toBeNull();
    expect(validateAdmin({ a: 'v6', op: 'give_rare', set: 'guardian_core' })).toEqual({ a: 'v6', op: 'give_rare', set: 'guardian_core' });
    expect(validateAdmin({ a: 'v6', op: 'give_rare', set: 'netherite_ingot' })).toBeNull();
    for (const t of DRAGON_TESTS) expect(validateAdmin({ a: 'v6', op: 'dragon_test', test: t })).toEqual({ a: 'v6', op: 'dragon_test', test: t });
    expect(validateAdmin({ a: 'v6', op: 'dragon_test', test: 'meteor' })).toBeNull();
    expect(V6_OPS.length).toBeGreaterThan(30);
  });

  it('every tool works and awards nothing', async () => {
    const { server } = await makeServer({ seed: 'p5-admin', cheats: true });
    await server.citadel!.ready;
    const { player, conn } = await join(server, 'Owner', 'uuid-owner', 3);
    const ach0 = player.achievements.size;
    const run = (action: Record<string, unknown>): { ok: boolean; text: string } => {
      const r = admin(server, conn, action);
      expect(r.length, JSON.stringify(action)).toBeGreaterThan(0);
      return r[0]!;
    };
    expect(run({ a: 'v6', op: 'storm_start' }).ok).toBe(true);
    tick(server, 80);
    expect(server.endEvents!.state.storm.phase).toBe('active');
    expect(server.endEvents!.state.storm.cheat).toBe(true);
    expect(run({ a: 'v6', op: 'storm_stop' }).ok).toBe(true);
    expect(server.endEvents!.state.storm.phase).toBe('calm');
    expect(run({ a: 'v6', op: 'eclipse_start' }).ok).toBe(true);
    expect(server.endEvents!.state.eclipse.active).toBe(true);
    expect(run({ a: 'v6', op: 'eclipse_stop' }).ok).toBe(true);
    expect(server.endEvents!.state.eclipse.active).toBe(false);
    for (const g of RARE_END_LOOT) expect(run({ a: 'v6', op: 'give_rare', set: g.id }).ok).toBe(true);
    let cheatItems = 0;
    for (let i = 0; i < player.inventory.size; i++) {
      const s = player.inventory.get(i);
      if (s) {
        expect(isAdminStack(s)).toBe(true);
        cheatItems++;
      }
    }
    expect(cheatItems).toBeGreaterThanOrEqual(RARE_END_LOOT.length);
    // To the arena (the teleport lands once its chunks are in)
    expect(run({ a: 'v6', op: 'citadel_tp', spot: 'arena' }).ok).toBe(true);
    await settle(server, 400, () => player.dim.id === 'end' && Math.abs(player.x - server.citadel!.plan!.x) < 20);
    await settle(server, 60);
    expect(player.dim.id).toBe('end');
    expect(run({ a: 'v6', op: 'guardian_spawn' }).ok).toBe(true);
    expect(server.guardian!.fight).toBeTruthy();
    tick(server, 70);
    expect(run({ a: 'v6', op: 'guardian_defeat' }).ok).toBe(true);
    tick(server, 70);
    expect(server.guardian!.fight).toBeNull();
    expect(run({ a: 'v6', op: 'guardian_reset' }).ok).toBe(true);
    expect(server.guardian!.state.charged).toBe(true);
    // A floor
    expect(run({ a: 'v6', op: 'citadel_tp', spot: '1' }).ok).toBe(true);
    await settle(server, 300, () => Math.abs(player.y - server.citadel!.plan!.floors[0]!.y) < 4);
    expect(run({ a: 'v6', op: 'citadel_solve' }).ok).toBe(true);
    expect(server.citadel!.state.floors[0]!.done).toBe(true);
    expect(server.citadel!.state.floors[0]!.cheat).toBe(true);
    expect(run({ a: 'v6', op: 'citadel_reset' }).ok).toBe(true);
    expect(server.citadel!.state.floors[0]!.done).toBe(false);
    // Nothing done here counted
    const gained = [...player.achievements].slice(ach0);
    expect(gained.filter((a) => /storm|eclipse|citadel|guardian|elytra/.test(a))).toEqual([]);
    expect(player.inventory.get(0) && itemIdOf(player.inventory.get(0)!)).toBeTruthy();
    void Mob;
  }, 240000);

  it("the Dragon's new moves one at a time, the fight then a cheat", async () => {
    const { server } = await makeServer({ seed: 'p5-admin-dragon', cheats: true });
    const { player, conn } = await join(server, 'Owner', 'uuid-owner', 6);
    server.changeDimension(player, 'end', 0.5, 100, 20.5);
    await settle(server, 160);
    expect(server.theEnd!.fight.dragon).toBeTruthy();
    for (const t of DRAGON_TESTS) {
      const r = admin(server, conn, { a: 'v6', op: 'dragon_test', test: t })[0]!;
      expect(r.text.length).toBeGreaterThan(0);
      tick(server, 3);
    }
    expect(server.theEnd!.fight.dragon!.admin).toBe(true);
    expect(server.level.flags.dragonAdmin).toBe(true);
  }, 120000);
});
