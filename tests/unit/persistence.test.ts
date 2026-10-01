import { GENERATOR_VERSION } from '../../src/server/world/LevelData';
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { GameServer } from '../../src/server/GameServer';

describe('persistence hardening', () => {
  it('restores a damaged level from the last good backup', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ name: 'Precious' }, storage);
    await join(server);
    await server.saveAll();
    await server.stop();
    expect(storage.meta.get('level_backup')).toBeTruthy();
    // Damage the main copy
    storage.level = { garbage: true };
    const logs: string[] = [];
    const again = await GameServer.open(storage, null, { log: (m) => logs.push(m) });
    expect(again.level.name).toBe('Precious');
    expect(logs.some((l) => l.includes('restored from the last backup'))).toBe(true);
    // The repaired level was written back
    expect((storage.level as { name?: string }).name).toBe('Precious');
  });

  it('refuses to open a world with no usable data instead of silently making a new one', async () => {
    const storage = new MemoryStorage();
    storage.level = 'not a level';
    await expect(GameServer.open(storage, null, {})).rejects.toThrow(/corrupted/);
  });

  it('warns players when saving fails, e.g. when storage is full', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({}, storage);
    const { conn } = await join(server);
    storage.writeLevel = async () => {
      const e = new Error('The quota has been exceeded.');
      e.name = 'QuotaExceededError';
      throw e;
    };
    await server.saveAll().catch((e) => server.saveFailed(e));
    expect(conn.of('chat').some((m) => m.kind === 'error' && m.text.includes('storage is full'))).toBe(true);
    // Not spammed on every attempt
    const n = conn.of('chat').length;
    await server.saveAll().catch((e) => server.saveFailed(e));
    expect(conn.of('chat').length).toBe(n);
  });

  it('keeps world edits and player state across restarts', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({}, storage);
    const { player } = await join(server, 'Keeper');
    player.xpTotal = 1234;
    player.achievements.add('mine_block');
    server.level.flags.dragonKilled = true;
    await server.stop();
    const { server: s2 } = await makeServer({}, storage);
    const { player: p2 } = await join(s2, 'Keeper');
    expect(p2.xpTotal).toBe(1234);
    expect(p2.achievements.has('mine_block')).toBe(true);
    expect(s2.level.flags.dragonKilled).toBe(true);
  });

  it('keeps the V2 generator, Warden warnings and visited cave biomes across restarts', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({}, storage);
    expect(server.level.generatorVersion).toBe(GENERATOR_VERSION);
    expect(server.overworld.generator.caves).toBe(true);
    const { player } = await join(server, 'Caver');
    player.wardenWarning = 2;
    player.visitedCaveBiomes.add(3);
    player.visitedCaveBiomes.add(9);
    await server.stop();
    const { server: s2 } = await makeServer({}, storage);
    expect(s2.level.generatorVersion).toBe(GENERATOR_VERSION);
    const { player: p2 } = await join(s2, 'Caver');
    expect(p2.wardenWarning).toBe(2);
    expect([...p2.visitedCaveBiomes].sort()).toEqual([3, 9]);
  });

  it('opens worlds saved before the Caves Update with the V1 generator', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ name: 'Old' }, storage);
    await server.stop();
    // A V1 save has no generator version
    delete (storage.level as { generatorVersion?: number }).generatorVersion;
    const again = await GameServer.open(storage, null, {});
    expect(again.level.generatorVersion).toBe(1);
    expect(again.overworld.generator.caves).toBe(false);
    // Saving again keeps it a V1 world
    await again.saveAll();
    expect((storage.level as { generatorVersion?: number }).generatorVersion).toBe(1);
  });

  it('keeps V3 state across restarts: endings, freezing, a fight in progress and blocks to restore', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({}, storage);
    const { player } = await join(server, 'Hero');
    server.endings!.state.farlandsAccess = true;
    server.endings!.reach(player, 'dragon');
    const m = server.mobs!.spawn(player.dim, 'the_error', player.x + 10, player.y, player.z, { reason: 'boss' })!;
    tick(server, 25);
    const f = server.errorBoss!.fight!;
    expect(f.boss).toBe(m);
    m.health = 250;
    // A hole the fight opened, not yet put back
    const [hx, hy, hz] = [Math.floor(player.x) + 3, Math.floor(player.y) - 1, Math.floor(player.z)];
    const stone = player.dim.getState(hx, hy, hz);
    (server.level.flags as Record<string, unknown>).errorRestore = { dim: 'overworld', blocks: [[`${hx},${hy},${hz}`, stone]] };
    player.dim.setBlock(hx, hy, hz, 0);
    player.freezeTicks = 90;
    await server.stop();

    const { server: s2 } = await makeServer({}, storage);
    const { player: p2 } = await join(s2, 'Hero');
    expect(s2.endings!.state.farlandsAccess).toBe(true);
    expect(s2.endings!.state.reached.dragon).toBeGreaterThan(0);
    expect(p2.endings.has('dragon')).toBe(true);
    // Saved at 90; joining runs a few ticks, which thaw it a little
    expect(p2.freezeTicks).toBeGreaterThan(50);
    tick(s2, 25);
    const f2 = s2.errorBoss!.fight!;
    expect(f2.boss?.type).toBe('the_error');
    expect(f2.boss!.health).toBe(250);
    expect(p2.dim.getState(hx, hy, hz)).toBe(stone);
  });

  it('keeps a V2 world a V2 world (no corrupted caves or arenas)', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ name: 'Caves' }, storage);
    await server.stop();
    (storage.level as { generatorVersion?: number }).generatorVersion = 2;
    const again = await GameServer.open(storage, null, {});
    expect(again.level.generatorVersion).toBe(2);
    expect(again.overworld.generator.caves).toBe(true);
    expect(again.overworld.generator.structureTypes!()).not.toContain('glitched_portal');
    expect(again.dim('farlands').generator.structureTypes!()).not.toContain('error_arena');
  });
});
