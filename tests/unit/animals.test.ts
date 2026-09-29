/** The ten animals that biomes listed but V1 never had. */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S } from '../../src/common/registry/blocks';
import { items } from '../../src/common/registry/items';
import { stackOf } from '../../src/common/game/itemstack';
import { ItemEntity } from '../../src/server/entity/ItemEntity';
import { MOB_BY_ID } from '../../src/common/data/mobs';
import { BIOME_DEFS as BIOMES } from '../../src/common/data/biomes';
import { rollLoot } from '../../src/common/game/loot';
import { Random } from '../../src/common/math/rng';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { Mob } from '../../src/server/entity/Mob';

function arena(player: ServerPlayer, r = 10, fill = 0): number {
  const cx = Math.floor(player.x);
  const cz = Math.floor(player.z);
  const y = Math.floor(player.y);
  for (let x = cx - r; x <= cx + r; x++)
    for (let z = cz - r; z <= cz + r; z++) {
      player.dim.setBlock(x, y - 1, z, S('stone'));
      for (let h = 0; h < 6; h++) player.dim.setBlock(x, y + h, z, fill);
    }
  return y;
}

const drops = (p: ServerPlayer): string[] => [...p.dim.entities.values()].filter((e): e is ItemEntity => e instanceof ItemEntity).map((e) => items[e.stack.id]!.id);

describe('animals', () => {
  it('every mob a biome spawns is defined', () => {
    for (const b of BIOMES) for (const cat of Object.values(b.spawns ?? {})) for (const e of cat ?? []) expect(MOB_BY_ID.has(e.mob), `${b.id}: ${e.mob}`).toBe(true);
  });

  it('each new animal spawns, has a variant where it should, and drops its loot', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    for (const id of ['turtle', 'parrot', 'ocelot', 'panda', 'llama', 'camel', 'frog', 'axolotl', 'tropical_fish', 'pufferfish']) {
      const m = server.mobs!.spawn(player.dim, id, player.x + 3, y, player.z)!;
      expect(m, id).toBeTruthy();
      if (['parrot', 'llama', 'panda', 'axolotl', 'tropical_fish', 'frog'].includes(id)) expect(m.data.variant, id).toBeTruthy();
      m.remove();
    }
    const r = new Random(1);
    expect(rollLoot('mob/parrot', { rng: r, looting: 0, killedByPlayer: true, onFire: false, difficulty: 'normal' }).map((s) => items[s.id]!.id)).toContain('feather');
    expect(rollLoot('mob/pufferfish', { rng: r, looting: 0, killedByPlayer: true, onFire: false, difficulty: 'normal' }).map((s) => items[s.id]!.id)).toContain('pufferfish');
  });

  it('a pufferfish puffs up and stings a player who swims close', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player, 6, S('water'));
    player.spawnProtection = 0;
    const f = server.mobs!.spawn(player.dim, 'pufferfish', player.x + 0.5, y + 1, player.z)!;
    f.noAi = true;
    const hp = player.health;
    tick(server, 30);
    expect(Number(f.data.puff)).toBeGreaterThan(0);
    expect(player.health).toBeLessThan(hp);
    expect(player.effects.has('poison')).toBe(true);
  });

  it('a frog swallows a small slime and leaves a slime ball, and turns magma cubes into froglights', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    const frog = server.mobs!.spawn(player.dim, 'frog', player.x + 4, y, player.z, { data: { variant: 'cold' } })!;
    const slime = server.mobs!.spawn(player.dim, 'slime', player.x + 5, y, player.z, { data: { size: 1 } })!;
    server.mobs!.meleeAttack(frog, slime);
    expect(slime.removed).toBe(true);
    expect(drops(player)).toContain('slime_ball');
    const cube = server.mobs!.spawn(player.dim, 'magma_cube', player.x + 5, y, player.z, { data: { size: 1 } })!;
    server.mobs!.meleeAttack(frog, cube);
    expect(drops(player)).toContain('verdant_froglight');
  });

  it('ocelots learn to trust and parrots can be tamed with seeds', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const oc = server.mobs!.spawn(player.dim, 'ocelot', player.x + 2, y, player.z)!;
    oc.noAi = true;
    player.inventory.set(player.selectedSlot, stackOf('cod', 64));
    for (let i = 0; i < 40 && !oc.data.trusting; i++) server.handle(conn, { t: 'interact', id: oc.id, hand: 0 });
    expect(oc.data.trusting).toBe(true);
    const parrot = server.mobs!.spawn(player.dim, 'parrot', player.x + 2, y, player.z + 1)!;
    parrot.noAi = true;
    player.inventory.set(player.selectedSlot, stackOf('wheat_seeds', 64));
    for (let i = 0; i < 40 && !parrot.owner; i++) server.handle(conn, { t: 'interact', id: parrot.id, hand: 0 });
    expect(parrot.owner).toBe(player.uuid);
  });

  it('an axolotl plays dead when badly hurt and heals while it does', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player, 6, S('water'));
    const ax = server.mobs!.spawn(player.dim, 'axolotl', player.x + 2, y + 1, player.z)! as Mob;
    let played = false;
    for (let i = 0; i < 30 && !played; i++) {
      ax.health = 6;
      ax.invulnerableTicks = 0;
      ax.hurt(0.5, { source: 'mob', attacker: null });
      tick(server, 1);
      played = !!ax.data.playDead;
    }
    expect(played).toBe(true);
    const hp = ax.health;
    tick(server, 60);
    expect(ax.health).toBeGreaterThan(hp);
    expect(ax.target).toBeNull();
  });

  it('a baby turtle drops a scute when it grows up', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    const t = server.mobs!.spawn(player.dim, 'turtle', player.x + 3, y, player.z, { baby: true })!;
    t.noAi = true;
    t.growTicks = 23999;
    tick(server, 2);
    expect(t.baby).toBe(false);
    expect(drops(player)).toContain('scute');
  });

  it('pandas sit down to eat bamboo lying nearby', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    const p = server.mobs!.spawn(player.dim, 'panda', player.x + 4, y, player.z, { data: { variant: 'normal' } })!;
    p.noAi = true;
    server.mining.dropItem(player.dim, p.x, y + 0.2, p.z, stackOf('bamboo', 1));
    tick(server, 40);
    expect(p.data.eating).toBeTruthy();
    expect(drops(player)).not.toContain('bamboo');
  });
});
