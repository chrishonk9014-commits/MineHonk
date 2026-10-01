/** V3 End: Endermen, the dragon's dives to the portal, crystal tracking and the gateways to the outer islands. */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { EndGenerator, endPillars, exitPortalY } from '../../src/common/gen/end';
import { EndSystem } from '../../src/server/systems/TheEnd';
import { Mob } from '../../src/server/entity/Mob';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';

async function settle(server: GameServer, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
}

/** Puts the player in the End next to the exit portal and lets the island load. */
async function toEndCentre(server: GameServer, player: ServerPlayer): Promise<number> {
  server.changeDimension(player, 'end', 0.5, 100, 20.5);
  await settle(server, 20);
  const y0 = exitPortalY((player.dim.generator as EndGenerator).terrain);
  server.teleport(player, 0.5, y0 + 1, 20.5);
  await settle(server, 80);
  return y0;
}

describe('endermen in the End', () => {
  it('spawn naturally across the End', async () => {
    const { server } = await makeServer({ seed: 'end-spawns' });
    const { player } = await join(server, 'Tester', 'uuid-t', 6);
    await toEndCentre(server, player);
    const mobs = server.mobs as unknown as { trySpawnAround(p: ServerPlayer, cat: string): void };
    for (let i = 0; i < 400; i++) mobs.trySpawnAround(player, 'monster');
    const endermen = [...player.dim.entities.values()].filter((e) => e instanceof Mob && e.type === 'enderman');
    expect(endermen.length).toBeGreaterThan(3);
    // Ordinary Endermen: none of them is special
    expect(endermen.every((e) => !(e as Mob).data.voidbound)).toBe(true);
  });
});

describe('the dragon fights from the centre', () => {
  it('dives to the portal regularly, attacks from there, can be struck, then flies again', async () => {
    const { server } = await makeServer({ seed: 'dragon-perch' });
    const { player } = await join(server);
    const y0 = await toEndCentre(server, player);
    const fight = server.theEnd!.fight;
    const dragon = fight.dragon!;
    expect(dragon).toBeTruthy();
    // Stand in the portal bowl, next to the pillar
    server.teleport(player, 3.5, y0, 0.5);
    player.spawnProtection = 0;
    const perches: number[] = [];
    let lastPhase = fight.phase;
    let hurtWhilePerched = false;
    let struck = false;
    for (let t = 0; t < 4800; t++) {
      player.health = 20;
      tick(server, 1);
      expect(player.dead).toBe(false);
      if (fight.phase === 'perch' && lastPhase !== 'perch') perches.push(t);
      if (fight.phase === 'perch') {
        // Perched on the pillar at the centre
        expect(Math.hypot(dragon.x, dragon.z)).toBeLessThan(1.5);
        expect(Math.abs(dragon.y - (y0 + 4))).toBeLessThan(1.5);
        if (player.health < 20) hurtWhilePerched = true;
        if (t % 20 === 0 && !struck) {
          const hp = dragon.health;
          server.mobs!.playerAttack(player, dragon);
          if (dragon.health < hp) struck = true;
        }
        // Stay in the bowl next to the pillar
        if (Math.hypot(player.x - 3.5, player.z - 0.5) > 1) server.teleport(player, 3.5, y0, 0.5);
      }
      if (lastPhase === 'perch' && fight.phase === 'takeoff') {
        // It leaves the portal again
        tick(server, 60);
        expect(dragon.y).toBeGreaterThan(y0 + 8);
      }
      lastPhase = fight.phase;
    }
    // Several dives in four minutes, the first well within the first minute and a half
    expect(perches.length).toBeGreaterThanOrEqual(5);
    expect(perches[0]!).toBeLessThan(1800);
    expect(struck).toBe(true);
    expect(hurtWhilePerched).toBe(true);
  }, 60000);
});

describe('end crystals', () => {
  it('are tracked per pillar in the level data, so only real destruction counts', async () => {
    const { server, storage } = await makeServer({ seed: 'crystal-count' });
    const { player } = await join(server);
    await toEndCentre(server, player);
    const fight = server.theEnd!.fight;
    const pillars = endPillars(server.level.seedNum);
    expect(fight.pillarCrystals()!.filter(Boolean).length).toBe(pillars.length);
    expect(fight.allCrystalsDestroyed()).toBe(false);
    const crystals = fight.crystals();
    player.spawnProtection = 100000;
    for (const c of crystals.slice(0, crystals.length - 1)) server.mobs!.playerAttack(player, c);
    tick(server, 2);
    expect(fight.crystalsAlive()).toBe(1);
    expect(fight.allCrystalsDestroyed()).toBe(false);
    expect(player.achievements.has('destroy_end_crystal')).toBe(true);
    server.mobs!.playerAttack(player, fight.crystals()[0]!);
    tick(server, 2);
    expect(fight.allCrystalsDestroyed()).toBe(true);
    await server.stop();
    // Remembered across a restart
    const { server: s2 } = await makeServer({ seed: 'crystal-count' }, storage);
    expect(s2.theEnd!.fight.allCrystalsDestroyed()).toBe(true);
  }, 60000);

  it('never counts a pillar that has not loaded as destroyed', async () => {
    const { server } = await makeServer({ seed: 'crystal-unknown' });
    delete server.level.flags.pillarCrystals;
    // Nobody is in the End: its pillars are not loaded
    expect(server.theEnd!.fight.pillarCrystals()).toBeNull();
    expect(server.theEnd!.fight.allCrystalsDestroyed()).toBe(false);
  });
});

describe('end gateways', () => {
  async function killedDragonWorld(seed: string, vd = 8): Promise<{ server: GameServer; player: ServerPlayer; gw: { x: number; y: number; z: number } }> {
    const { server } = await makeServer({ seed });
    const { player } = await join(server, 'Tester', 'uuid-t', vd);
    await toEndCentre(server, player);
    server.level.flags.dragonKilled = true;
    server.theEnd!.fight.dragon?.remove();
    tick(server, 2);
    server.theEnd!.spawnGateway(player.dim);
    const gw = EndSystem.ringGateway(0);
    return { server, player, gw };
  }

  it('take a player who presses into one out to the outer islands and back again', async () => {
    const { server, player, gw } = await killedDragonWorld('gateway-walk');
    const end = player.dim;
    expect(end.blockId(gw.x, gw.y, gw.z)).toBe('end_gateway');
    // Stand on the bedrock beside it and press against its open side
    server.teleport(player, gw.x + 1.3, gw.y - 1, gw.z + 0.5);
    player.portalCooldown = 0;
    tick(server, 2);
    const d = Math.hypot(player.x, player.z);
    expect(d).toBeGreaterThan(700);
    await settle(server, 120);
    // Landed on solid ground on an outer island
    const below = end.blockId(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z));
    expect(below).not.toBe('air');
    // A return gateway was built nearby
    let back: [number, number, number] | null = null;
    for (let dx = -10; dx <= 10 && !back; dx++)
      for (let dz = -10; dz <= 10 && !back; dz++)
        for (let y = 0; y < 128; y++)
          if (end.blockId(Math.floor(player.x) + dx, y, Math.floor(player.z) + dz) === 'end_gateway') {
            back = [Math.floor(player.x) + dx, y, Math.floor(player.z) + dz];
            break;
          }
    expect(back).toBeTruthy();
    expect(server.level.flags.pendingGateways).toBeUndefined();
    // Walk into the return gateway from the ground beside it
    const [bx, by, bz] = back!;
    server.teleport(player, bx + 1.3, by - 1, bz + 0.5);
    player.portalCooldown = 0;
    tick(server, 2);
    expect(Math.hypot(player.x - gw.x, player.z - gw.z)).toBeLessThan(4);
  }, 60000);

  it('appear even when the dragon dies with the ring out of view', async () => {
    const { server, player, gw } = await killedDragonWorld('gateway-late', 3);
    const end = player.dim;
    // Not loaded yet: queued in the level data instead of lost
    expect(end.blockId(gw.x, gw.y, gw.z)).not.toBe('end_gateway');
    expect(server.level.flags.pendingGateways).toBeTruthy();
    server.teleport(player, gw.x * 0.55 + 0.5, 80, gw.z * 0.55 + 0.5);
    await settle(server, 80);
    expect(end.blockId(gw.x, gw.y, gw.z)).toBe('end_gateway');
    expect(server.level.flags.pendingGateways).toBeUndefined();
  }, 60000);

  it('carry the thrower of an ender pearl that flies through', async () => {
    const { server, player, gw } = await killedDragonWorld('gateway-pearl');
    server.teleport(player, gw.x + 6.5, gw.y, gw.z + 0.5);
    player.portalCooldown = 0;
    const pearl = server.mobs!.projectile(player.dim, 'ender_pearl', gw.x + 5.5, gw.y + 0.5, gw.z + 0.5, player);
    pearl.shoot(-1, 0.02, 0, 1.2, 0, () => 0.5);
    tick(server, 10);
    expect(Math.hypot(player.x, player.z)).toBeGreaterThan(700);
    expect(pearl.removed).toBe(true);
  }, 60000);
});
