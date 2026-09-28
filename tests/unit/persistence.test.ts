import { describe, it, expect } from 'vitest';
import { makeServer, join } from '../helpers/testServer';
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
    expect(server.level.generatorVersion).toBe(2);
    expect(server.overworld.generator.caves).toBe(true);
    const { player } = await join(server, 'Caver');
    player.wardenWarning = 2;
    player.visitedCaveBiomes.add(3);
    player.visitedCaveBiomes.add(9);
    await server.stop();
    const { server: s2 } = await makeServer({}, storage);
    expect(s2.level.generatorVersion).toBe(2);
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
});
