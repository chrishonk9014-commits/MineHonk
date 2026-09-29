/** V3 hidden endgame: the witch's potion, Voidbound Endermen, the secret ending, the Corrupted Eye and the endings. */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { S, blockOf } from '../../src/common/registry/blocks';
import { itemById, items } from '../../src/common/registry/items';
import { stackOf, isAdminStack, markAdmin } from '../../src/common/game/itemstack';
import { rollLoot } from '../../src/common/game/loot';
import { Random } from '../../src/common/math/rng';
import { EndGenerator, exitPortalY } from '../../src/common/gen/end';
import { craftingRemainder } from '../../src/common/game/crafting';
import { Mob } from '../../src/server/entity/Mob';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';

async function settle(server: GameServer, rounds = 40, each?: () => void): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
    each?.();
  }
}

function count(p: ServerPlayer, id: string): number {
  const num = itemById.get(id)!.num;
  let n = 0;
  for (let i = 0; i < 41; i++) if (p.inventory.get(i)?.id === num) n += p.inventory.get(i)!.count;
  return n;
}

/** Walks the player through an End portal next to them (so the game knows where they came in). */
async function enterEnd(server: GameServer, player: ServerPlayer): Promise<{ y0: number; entry: { x: number; y: number; z: number } }> {
  const ow = player.dim;
  const x = Math.floor(player.x) + 3;
  const y = Math.floor(player.y);
  const z = Math.floor(player.z);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) ow.setBlock(x + dx, y - 1, z + dz, S('stone'));
  ow.setBlock(x, y, z, S('end_portal'));
  server.teleport(player, x + 0.5, y, z + 0.5);
  player.portalCooldown = 0;
  tick(server, 2);
  expect(player.dim.id).toBe('end');
  await settle(server, 40);
  const y0 = exitPortalY((player.dim.generator as EndGenerator).terrain);
  server.teleport(player, 0.5, y0 + 1, 20.5);
  await settle(server, 80);
  return { y0, entry: { x, y, z } };
}

function holdPotion(player: ServerPlayer, admin = false): void {
  const st = stackOf('mysterious_potion', 1);
  player.inventory.set(player.selectedSlot, admin ? markAdmin(st) : st);
}

function spawnEnderman(server: GameServer, player: ServerPlayer): Mob {
  const m = server.mobs!.spawn(player.dim, 'enderman', player.x + 2, player.y, player.z, { persistent: true })!;
  expect(m).toBeTruthy();
  return m;
}

describe("the witch's potion", () => {
  it('waits in every witch hut chest', () => {
    for (let i = 0; i < 20; i++) {
      const loot = rollLoot('chest/witch_hut', { rng: new Random(i) });
      expect(loot.filter((s) => items[s.id]!.id === 'mysterious_potion').length).toBe(1);
    }
  });

  it('witch huts now hold that chest', async () => {
    const { server } = await makeServer({ seed: 'witch-chest' });
    const g = server.overworld.generator;
    const hut = g.locate!('witch_hut', 0, 0);
    expect(hut).toBeTruthy();
    let found = false;
    for (let cx = (hut!.x >> 4) - 1; cx <= (hut!.x >> 4) + 1 && !found; cx++)
      for (let cz = (hut!.z >> 4) - 1; cz <= (hut!.z >> 4) + 1 && !found; cz++) {
        const c = g.generate(cx, cz);
        for (const be of c.blockEntities.values()) if (be.type === 'chest' && be.loot === 'chest/witch_hut') found = true;
      }
    expect(found).toBe(true);
  });

  it('changes an Enderman, startles other mobs, and will not be drunk', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    // In the air: nothing is used up
    holdPotion(player);
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(count(player, 'mysterious_potion')).toBe(1);
    tick(server, 21);
    expect(player.achievements.has('mysterious_potion')).toBe(true);
    // On a cow: a glitch, and the bottle is gone
    const cow = server.mobs!.spawn(player.dim, 'cow', player.x + 2, player.y, player.z, { persistent: true })!;
    server.handle(conn, { t: 'interact', id: cow.id, hand: 0 });
    expect(count(player, 'mysterious_potion')).toBe(0);
    expect(cow.data.voidbound).toBeUndefined();
    // On an Enderman: it becomes Voidbound
    holdPotion(player);
    const e = spawnEnderman(server, player);
    server.handle(conn, { t: 'interact', id: e.id, hand: 0 });
    expect(count(player, 'mysterious_potion')).toBe(0);
    expect(e.data.voidbound).toBe(true);
    expect(e.data.voidOwner).toBe(player.uuid);
    expect(e.maxHealth).toBe(80);
    expect(e.meta().voidbound).toBe(true);
    // It no longer cares about being stared at
    tick(server, 40);
    expect(e.target).toBeNull();
  });
});

describe('the Voidbound Enderman and the dragon', () => {
  it('cannot finish the dragon while any crystal stands', async () => {
    const { server } = await makeServer({ seed: 'void-crystals' });
    const { conn, player } = await join(server);
    await enterEnd(server, player);
    const fight = server.theEnd!.fight;
    const dragon = fight.dragon!;
    expect(fight.crystalsAlive()).toBeGreaterThan(0);
    holdPotion(player);
    const e = spawnEnderman(server, player);
    server.handle(conn, { t: 'interact', id: e.id, hand: 0 });
    dragon.health = 20;
    let struck = false;
    for (let t = 0; t < 1200; t++) {
      player.health = 20;
      const hp = dragon.health;
      tick(server, 1);
      if (dragon.health < hp) struck = true;
      expect(dragon.dead).toBe(false);
      expect(dragon.health).toBeGreaterThanOrEqual(1);
    }
    expect(struck).toBe(true);
  }, 90000);

  it('with every crystal gone, kills the dragon and the End breaks', async () => {
    const { server } = await makeServer({ seed: 'secret-ending' });
    const { conn, player } = await join(server);
    const { entry } = await enterEnd(server, player);
    const fight = server.theEnd!.fight;
    const dragon = fight.dragon!;
    player.spawnProtection = 100000;
    for (const c of fight.crystals()) server.mobs!.playerAttack(player, c);
    tick(server, 2);
    expect(fight.allCrystalsDestroyed()).toBe(true);
    holdPotion(player);
    const e = spawnEnderman(server, player);
    server.handle(conn, { t: 'interact', id: e.id, hand: 0 });
    dragon.health = 30;
    let t = 0;
    while (!dragon.dead && t++ < 2400) {
      player.health = 20;
      tick(server, 1);
    }
    expect(dragon.dead).toBe(true);
    expect(fight.secretRun).toBe(true);
    // The world falls silent, corrupts and fails
    const fx = (): string[] => (conn as FakeConn).of('fx').map((m) => m.kind);
    await settle(server, 260, () => (player.health = 20));
    expect(fx()).toContain('silence');
    expect(fx()).toContain('corrupt_world');
    expect((conn as FakeConn).of('fx').some((m) => m.kind === 'integrity' && m.text === 'WORLD INTEGRITY FAILURE')).toBe(true);
    // ...and throws the player back to the stronghold portal they came through
    expect(player.dim.id).toBe('overworld');
    await settle(server, 120);
    expect(Math.hypot(player.x - entry.x, player.z - entry.z)).toBeLessThan(12);
    expect(fx()).toContain('unsilence');
    // The secret ending, the Eye, the advancements
    const card = (conn as FakeConn).of('ending').pop();
    expect(card?.id).toBe('farlands_remains');
    expect(card?.title).toBe('The Farlands Remains');
    expect(count(player, 'corrupted_eye')).toBe(1);
    expect(player.achievements.has('enderman_kills_dragon')).toBe(true);
    expect(player.achievements.has('corrupted_eye')).toBe(true);
    expect(player.endings.has('farlands_remains')).toBe(true);
    expect(player.endings.has('dragon')).toBe(false);
    const st = server.level.endings;
    expect(st.dragonDeath).toBe('enderman');
    expect(st.eyeAwarded).toBe(true);
    // The End is left defeated, quietly
    expect(server.level.flags.dragonKilled).toBe(true);
    const end = server.dim('end');
    const y0 = exitPortalY((end.generator as EndGenerator).terrain);
    expect(blockOf(end.getState(2, y0, 0)).id).toBe('end_portal');
    expect(server.level.flags.secretPending).toBeUndefined();
    // Not a word of the normal victory
    expect((conn as FakeConn).of('chat').some((m) => m.text.includes('has been defeated'))).toBe(false);
  }, 120000);
});

describe('endings', () => {
  it('a normal kill is Ending 1: no Corrupted Eye, and the card waits for the way home', async () => {
    const { server } = await makeServer({ seed: 'ending-one' });
    const { conn, player } = await join(server);
    const { y0 } = await enterEnd(server, player);
    const dragon = server.theEnd!.fight.dragon!;
    player.spawnProtection = 100000;
    dragon.hurt(10000, { source: 'mob', attacker: player });
    await settle(server, 210);
    const end = player.dim;
    const drops = [...end.entities.values()].filter((e) => e.type === 'item').map((e) => items[(e as unknown as { stack: { id: number } }).stack.id]!.id);
    expect(drops).not.toContain('corrupted_eye');
    expect(count(player, 'corrupted_eye')).toBe(0);
    expect(server.level.endings.dragonDeath).toBe('player');
    expect(player.endings.has('dragon')).toBe(true);
    expect((conn as FakeConn).of('ending').length).toBe(0);
    // Walk out through the exit portal: the card
    server.teleport(player, 2.5, y0, 0.5);
    player.portalCooldown = 0;
    tick(server, 2);
    expect(player.dim.id).toBe('overworld');
    await settle(server, 60);
    const card = (conn as FakeConn).of('ending').pop();
    expect(card?.id).toBe('dragon');
    expect(card?.line).toBe('You have reached Ending 1 of MineHonk: The Ender Dragon');
    expect((conn as FakeConn).of('ending').some((m) => m.title === 'The Farlands Remains')).toBe(false);
  }, 90000);

  it('are saved with the world and the player', async () => {
    const { server, storage } = await makeServer({ seed: 'ending-save' });
    const { player } = await join(server, 'Saver');
    server.endings!.reach(player, 'dragon', { show: 'on_exit' });
    server.level.endings.dragonDeath = 'player';
    server.level.endings.errorDefeated = true;
    await server.stop();
    const { server: s2 } = await makeServer({ seed: 'ending-save' }, storage);
    const { player: p2 } = await join(s2, 'Saver');
    expect(s2.level.endings.dragonDeath).toBe('player');
    expect(s2.level.endings.errorDefeated).toBe(true);
    expect(s2.level.endings.reached.dragon).toBeGreaterThan(0);
    expect(p2.endings.has('dragon')).toBe(true);
    expect(p2.pendingEnding).toBe('dragon');
  });

  it('the Farlands Compass only borrows the Corrupted Eye', () => {
    const eye = stackOf('corrupted_eye', 1);
    expect(craftingRemainder(eye)?.id).toBe(eye.id);
    const cheat = markAdmin(stackOf('corrupted_eye', 1));
    expect(isAdminStack(craftingRemainder(cheat)!)).toBe(true);
  });
});
