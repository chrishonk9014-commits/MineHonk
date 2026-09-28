/** Sculk sensors, shriekers, catalysts, the Darkness effect and the Warden. */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S, getProp, stateOf } from '../../src/common/registry/blocks';
import { stackOf } from '../../src/common/game/itemstack';
import { Mob } from '../../src/server/entity/Mob';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { GameServer } from '../../src/server/GameServer';

function arena(player: ServerPlayer, r = 14): number {
  const cx = Math.floor(player.x);
  const cz = Math.floor(player.z);
  const y = Math.floor(player.y);
  for (let x = cx - r; x <= cx + r; x++)
    for (let z = cz - r; z <= cz + r; z++) {
      player.dim.setBlock(x, y - 1, z, S('stone'));
      for (let h = 0; h < 6; h++) player.dim.setBlock(x, y + h, z, 0);
    }
  return y;
}

/** Walks the player a few blocks (as the client would report it). */
function walk(server: GameServer, conn: Parameters<GameServer['handle']>[0], p: ServerPlayer, dx: number, sneak = false): void {
  for (let i = 0; i < 12; i++) {
    server.handle(conn, { t: 'move', x: p.x + dx / 12, y: p.y, z: p.z, yaw: 0, pitch: 0, onGround: true, sneak, sprint: false, flying: false, seq: p.teleportSeq + 1 } as never);
    tick(server, 1);
  }
}

describe('sculk', () => {
  it('a sensor hears footsteps, glows and resets; sneaking and wool keep it quiet', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const sx = Math.floor(player.x) + 4;
    const sz = Math.floor(player.z) + 2;
    player.dim.setBlock(sx, y, sz, S('sculk_sensor'));
    walk(server, conn, player, 2, true);
    expect(getProp(player.dim.getState(sx, y, sz), 'phase')).toBe('inactive');
    walk(server, conn, player, 2);
    expect(getProp(player.dim.getState(sx, y, sz), 'phase')).not.toBe('inactive');
    expect(conn.of('trail').some((m) => m.kind === 'vibration')).toBe(true);
    tick(server, 60);
    expect(getProp(player.dim.getState(sx, y, sz), 'phase')).toBe('inactive');
    // A wool wall between the player and the sensor soaks up the steps
    for (let dz = -3; dz <= 3; dz++) for (let h = 0; h < 4; h++) player.dim.setBlock(sx - 1, y + h, sz + dz, S('white_wool'));
    player.setPos(sx - 3.5, y, sz + 0.5);
    tick(server, 60);
    walk(server, conn, player, -1.5);
    expect(getProp(player.dim.getState(sx, y, sz), 'phase')).toBe('inactive');
  });

  it('an active sensor powers redstone next to it', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    const sx = Math.floor(player.x) + 3;
    const sz = Math.floor(player.z) + 2;
    player.dim.setBlock(sx, y, sz, S('sculk_sensor'));
    player.dim.setBlock(sx + 1, y, sz, S('redstone_lamp'));
    walk(server, conn, player, 2);
    tick(server, 2);
    expect(getProp(player.dim.getState(sx + 1, y, sz), 'lit')).toBe('true');
  });

  it('shriekers warn, darken the view and the fourth warning calls the Warden', async () => {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player);
    player.spawnProtection = 0;
    const sx = Math.floor(player.x) + 3;
    const sz = Math.floor(player.z) + 2;
    player.dim.setBlock(sx, y, sz, S('sculk_sensor'));
    player.dim.setBlock(sx + 1, y, sz, stateOf('sculk_shrieker', { can_summon: true }));
    for (let i = 1; i <= 4; i++) {
      walk(server, conn, player, i % 2 ? 2 : -2);
      if (i < 4) {
        expect(player.wardenWarning).toBe(i);
        expect(player.effects.has('darkness')).toBe(true);
      }
      tick(server, 220);
    }
    const warden = [...player.dim.entities.values()].find((e) => e instanceof Mob && e.type === 'warden') as Mob | undefined;
    expect(warden).toBeTruthy();
    // It has finished climbing out by now
    expect(warden!.data.untouchable).toBeUndefined();
  });

  it('a shrieker that cannot summon only shrieks', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    const sx = Math.floor(player.x) + 3;
    const sz = Math.floor(player.z);
    player.dim.setBlock(sx, y, sz, stateOf('sculk_shrieker', { can_summon: false }));
    expect(server.sculk!.shriek(player.dim, sx, y, sz, player)).toBe(true);
    expect(player.wardenWarning).toBe(0);
    expect(getProp(player.dim.getState(sx, y, sz), 'shrieking')).toBe('true');
  });

  it('a catalyst drinks the experience of a death nearby and spreads sculk', async () => {
    const { server } = await makeServer();
    const { player } = await join(server);
    const y = arena(player);
    const cx = Math.floor(player.x) + 4;
    const cz = Math.floor(player.z);
    player.dim.setBlock(cx, y - 1, cz, S('sculk_catalyst'));
    const cow = server.mobs!.spawn(player.dim, 'cow', cx + 2.5, y, cz + 0.5)!;
    cow.hurt(100, { source: 'player', attacker: player });
    tick(server, 2);
    expect(getProp(player.dim.getState(cx, y - 1, cz), 'bloom')).toBe('true');
    let sculk = 0;
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) if (player.dim.blockId(cx + 2 + dx, y - 1, cz + dz) === 'sculk') sculk++;
    expect(sculk).toBeGreaterThan(0);
    expect([...player.dim.entities.values()].some((e) => e.type === 'xp_orb')).toBe(false);
  });
});

describe('the Warden', () => {
  async function wardenArena(): Promise<{ server: GameServer; player: ServerPlayer; conn: Parameters<GameServer['handle']>[0]; w: Mob; y: number }> {
    const { server } = await makeServer();
    const { player, conn } = await join(server);
    const y = arena(player, 20);
    player.spawnProtection = 0;
    const w = server.warden!.summon(player.dim, Math.floor(player.x) + 6, y, Math.floor(player.z), null, { admin: true })!;
    tick(server, 140);
    return { server, player, conn, w, y };
  }

  it('emerges untouchable, then can be hurt', async () => {
    const { w } = await wardenArena();
    expect(w.data.untouchable).toBeUndefined();
    const hp = w.health;
    w.hurt(5, { source: 'mob', attacker: null });
    expect(w.health).toBeLessThan(hp);
  });

  it('is blind: it only notices what it hears or smells, and anger builds up', async () => {
    const { server, player, conn, w } = await wardenArena();
    const mind = server.warden!.mind(w);
    mind.anger.clear();
    mind.sniffAt = server.tickNo + 10000;
    w.setPos(player.x + 12, player.y, player.z);
    w.noAi = true;
    // Standing still in plain sight: nothing
    tick(server, 20);
    expect(server.warden!.target(w)).toBeNull();
    // Footsteps add anger until it hunts
    for (let i = 0; i < 4; i++) walk(server, conn, player, i % 2 ? 1.8 : -1.8);
    expect(mind.anger.get(player) ?? 0).toBeGreaterThanOrEqual(80);
    expect(server.warden!.target(w)).toBe(player);
  });

  it('hits hard enough to knock a shield aside', async () => {
    const { server, player, w } = await wardenArena();
    player.inventory.set(40, stackOf('shield', 1));
    w.setPos(player.x + 1.5, player.y, player.z);
    server.warden!.hurtBy(w, player);
    for (let i = 0; i < 20 && player.health === player.maxHealth; i++) tick(server, 2);
    expect(player.health).toBeLessThan(player.maxHealth);
  });

  it('its sonic boom goes through walls', async () => {
    const { server, player, w } = await wardenArena();
    w.setPos(player.x + 8, player.y, player.z);
    for (let dz = -2; dz <= 2; dz++) for (let h = 0; h < 4; h++) player.dim.setBlock(Math.floor(player.x) + 4, Math.floor(player.y) + h, Math.floor(player.z) + dz, S('stone'));
    server.warden!.hurtBy(w, player);
    const mind = server.warden!.mind(w);
    mind.sonicReadyAt = 0;
    mind.stuckSince = server.tickNo - 100;
    const hp = player.health;
    for (let i = 0; i < 60 && player.health === hp; i++) tick(server, 2);
    expect(player.health).toBeLessThan(hp);
  });

  it('a landed projectile draws it to the spot instead of the shooter', async () => {
    const { server, player, w } = await wardenArena();
    const mind = server.warden!.mind(w);
    const before = mind.anger.get(player) ?? 0;
    server.sculk!.vibrate(player.dim, w.x + 6, w.y, w.z + 6, player, 'projectile');
    expect(mind.investigate).toEqual({ x: w.x + 6, y: w.y, z: w.z + 6 });
    expect(mind.anger.get(player) ?? 0).toBe(before);
  });

  it('calms down and burrows away after the configured time', async () => {
    const { server, w } = await wardenArena();
    server.level.rules.wardenCalmSeconds = 10;
    const mind = server.warden!.mind(w);
    mind.anger.clear();
    mind.investigate = null;
    mind.heardAt = server.tickNo - 300;
    mind.sniffAt = server.tickNo + 10000;
    tick(server, 6);
    expect(mind.dig).toBeGreaterThan(0);
    tick(server, 110);
    expect(w.removed).toBe(true);
  });
});
