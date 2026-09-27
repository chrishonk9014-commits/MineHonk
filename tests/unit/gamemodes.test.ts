import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { normalizeGodHearts, maxHealthFor, formatHearts } from '../../src/common/game/gamemode';
import { breakTicks } from '../../src/common/game/mining';
import { S } from '../../src/common/registry/blocks';
import { stackOf } from '../../src/common/game/itemstack';
import { MemoryStorage } from '../../src/server/storage/Storage';

describe('god mode hearts', () => {
  it('normalizes chosen maximum hearts', () => {
    expect(normalizeGodHearts(1)).toBe(1);
    expect(normalizeGodHearts(50)).toBe(50);
    expect(normalizeGodHearts(99)).toBe(99);
    expect(normalizeGodHearts(100)).toBe('infinite');
    expect(normalizeGodHearts('250')).toBe('infinite');
    expect(normalizeGodHearts('infinite')).toBe('infinite');
    expect(normalizeGodHearts(0)).toBe(10);
    expect(normalizeGodHearts('nonsense')).toBe(10);
    expect(maxHealthFor('god', 3)).toBe(6);
    expect(maxHealthFor('god', 'infinite')).toBe(Infinity);
    expect(maxHealthFor('survival', 50)).toBe(20);
    expect(formatHearts(Infinity)).toBe('∞');
    expect(formatHearts(198)).toBe('99');
  });

  it('a 3-heart god player dies to a hit that exceeds 3 hearts', async () => {
    const { server } = await makeServer({ mode: 'god', godHearts: 3 });
    const { player } = await join(server);
    expect(player.maxHealth).toBe(6);
    expect(player.health).toBe(6);
    player.spawnProtection = 0;
    server.interaction.survival.damage(player, 7, { source: 'mob' });
    expect(player.dead).toBe(true);
  });

  it('a 99-heart god player survives heavy damage', async () => {
    const { server } = await makeServer({ mode: 'god', godHearts: 99 });
    const { player } = await join(server);
    expect(player.maxHealth).toBe(198);
    player.spawnProtection = 0;
    server.interaction.survival.damage(player, 50, { source: 'mob' });
    expect(player.dead).toBe(false);
    expect(player.health).toBeLessThan(198);
    expect(player.health).toBeGreaterThan(100);
  });

  it('infinite health ignores damage but keeps knockback, effects and hunger', async () => {
    const { server } = await makeServer({ mode: 'god', godHearts: 'infinite' });
    const { conn, player } = await join(server);
    expect(player.maxHealth).toBe(Infinity);
    player.spawnProtection = 0;
    const before = conn.of('velocity').length;
    server.interaction.survival.damage(player, 1e6, { source: 'mob', knockback: 0.4, kbx: 1, kbz: 0 });
    expect(player.dead).toBe(false);
    expect(conn.of('velocity').length).toBe(before + 1);
    server.interaction.survival.addEffect(player, 'poison', 0, 100);
    expect(player.effects.has('poison')).toBe(true);
    const ex = player.exhaustion;
    server.interaction.survival.exhaust(player, 1);
    expect(player.exhaustion).toBeGreaterThan(ex);
  });

  it('hazards and hunger can be disabled', async () => {
    const { server } = await makeServer({ mode: 'god', godHearts: 5, rules: { godHazards: false, godHunger: false } });
    const { player } = await join(server);
    player.spawnProtection = 0;
    expect(server.interaction.survival.damage(player, 8, { source: 'lava' })).toBe(0);
    expect(server.interaction.survival.damage(player, 8, { source: 'fall' })).toBe(0);
    expect(player.health).toBe(10);
    const ex = player.exhaustion;
    server.interaction.survival.exhaust(player, 2);
    expect(player.exhaustion).toBe(ex);
    // Mobs still hurt
    expect(server.interaction.survival.damage(player, 3, { source: 'mob' })).toBeGreaterThan(0);
  });

  it('rescues infinite-health players from the void instead of letting them fall forever', async () => {
    const { server } = await makeServer({ mode: 'god', godHearts: 'infinite' });
    const { player } = await join(server);
    server.teleport(player, player.x, -120, player.z);
    tick(server, 12);
    expect(player.y).toBeGreaterThan(0);
    expect(player.dead).toBe(false);
  });

  it('persists infinite health', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ mode: 'god', godHearts: 'infinite' }, storage);
    const { player } = await join(server, 'Keeper');
    expect(player.maxHealth).toBe(Infinity);
    await server.stop();
    const { server: again } = await makeServer({ mode: 'god', godHearts: 'infinite' }, storage);
    const { player: p2 } = await join(again, 'Keeper');
    expect(p2.gamemode).toBe('god');
    expect(p2.maxHealth).toBe(Infinity);
    expect(Number.isFinite(p2.health)).toBe(true);
  });
});

describe('other game modes', () => {
  it('hardcore death turns the player into a spectator', async () => {
    const { server } = await makeServer({ mode: 'hardcore' });
    const { conn, player } = await join(server);
    expect(server.level.difficulty).toBe('hard');
    player.spawnProtection = 0;
    server.interaction.survival.damage(player, 100, { source: 'mob' });
    expect(player.dead).toBe(true);
    expect(conn.last('death')?.hardcore).toBe(true);
    server.handle(conn, { t: 'respawn' });
    expect(player.dead).toBe(false);
    expect(player.gamemode).toBe('spectator');
  });

  it('creative players are invulnerable', async () => {
    const { server } = await makeServer({ mode: 'creative' });
    const { player } = await join(server);
    player.spawnProtection = 0;
    expect(server.interaction.survival.damage(player, 100, { source: 'mob' })).toBe(0);
    expect(server.interaction.survival.damage(player, 100, { source: 'lava' })).toBe(0);
    expect(player.dead).toBe(false);
  });

  it('adventure players need the right tool to break and cannot place', async () => {
    const { server } = await makeServer({ mode: 'adventure' });
    const { conn, player } = await join(server);
    const dim = player.dim;
    const x = Math.floor(player.x);
    const y = Math.floor(player.y) - 1;
    const z = Math.floor(player.z);
    player.body.onGround = true;
    const dig = (): void => {
      const need = breakTicks(dim.getState(x, y, z), { tool: player.heldItem(), onGround: true, underwater: false, aquaAffinity: false, haste: 0, fatigue: 0, creative: false });
      server.handle(conn, { t: 'dig', action: 'start', x, y, z, face: 1 });
      tick(server, Number.isFinite(need) ? need + 1 : 40);
      server.handle(conn, { t: 'dig', action: 'finish', x, y, z, face: 1 });
    };
    // By hand: rejected
    dim.setBlock(x, y, z, S('stone'));
    dig();
    expect(dim.getState(x, y, z)).toBe(S('stone'));
    // Wrong tool (shovel on stone): rejected
    player.inventory.set(player.selectedSlot, stackOf('iron_shovel', 1));
    dig();
    expect(dim.getState(x, y, z)).toBe(S('stone'));
    // Proper pickaxe: allowed
    player.inventory.set(player.selectedSlot, stackOf('iron_pickaxe', 1));
    dig();
    expect(dim.getState(x, y, z)).toBe(0);
    // Placing is not allowed
    dim.setBlock(x, y, z, S('stone'));
    player.inventory.set(player.selectedSlot, stackOf('dirt', 4));
    server.handle(conn, { t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.4, seq: 1 });
    expect(dim.getState(x, y + 1, z)).toBe(0);
    expect(player.inventory.get(player.selectedSlot)?.count).toBe(4);
  });

  it('spectators cannot dig or place', async () => {
    const { server } = await makeServer({ mode: 'survival' });
    const { conn, player } = await join(server);
    player.setGamemode('spectator');
    const dim = player.dim;
    const x = Math.floor(player.x);
    const y = Math.floor(player.y) - 1;
    const z = Math.floor(player.z);
    dim.setBlock(x, y, z, S('dirt'));
    server.handle(conn, { t: 'dig', action: 'start', x, y, z, face: 1 });
    tick(server, 40);
    server.handle(conn, { t: 'dig', action: 'finish', x, y, z, face: 1 });
    expect(dim.getState(x, y, z)).toBe(S('dirt'));
    player.inventory.set(player.selectedSlot, stackOf('dirt', 4));
    server.handle(conn, { t: 'use_on', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.4, seq: 1 });
    expect(dim.getState(x, y + 1, z)).toBe(0);
  });
});
