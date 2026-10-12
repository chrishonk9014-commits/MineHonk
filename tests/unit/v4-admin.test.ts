/** V4 Admin Panel: finding V4 places, driving the Glitched Structure quest and the fluid rig, all as cheats. */
import { describe, it, expect } from 'vitest';
import { itemOf } from '../../src/common/registry/items';
import { isAdminStack } from '../../src/common/game/itemstack';
import { levelFloor } from '../../src/common/gen/v4/errorBiome';
import type { GameServer } from '../../src/server/GameServer';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';

let reqNo = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): number {
  const req = reqNo++;
  server.handle(conn, { t: 'admin', req, action });
  return req;
}
type Result = { req: number; ok: boolean; text: string; data?: unknown };
function result(conn: FakeConn, req: number): Result | undefined {
  return (conn.of('admin_result') as Result[]).filter((r) => r.req === req).pop();
}
async function settle(server: GameServer, cond: () => boolean, maxTicks = 3000): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
  return cond();
}

describe('V4 Admin Panel', () => {
  it('finds and teleports to the Glitched Structure, runs its stages as cheats, and lists V4 structures', async () => {
    const { server } = await makeServer({ seed: 'glitched-quest', cheats: true });
    const { conn, player } = await join(server);
    const cat = admin(server, conn, { a: 'catalog' });
    const structures = (result(conn, cat)!.data as { structures: Record<string, string[]> }).structures;
    for (const t of ['bunker', 'sun_monument', 'jungle_shrine', 'error_biome', 'glitched_structure']) expect(structures.overworld).toContain(t);
    expect(structures.nether).toContain('glitched_structure');
    expect(structures.end).not.toContain('error_biome');
    expect(structures.farlands).not.toContain('error_biome');
    const tp = admin(server, conn, { a: 'tp_structure', dim: 'overworld', structure: 'glitched_structure' });
    expect(await settle(server, () => !!result(conn, tp))).toBe(true);
    expect(result(conn, tp)!.ok).toBe(true);
    await settle(server, () => false, 120);
    const e = server.glitchedQuest!.errorAt(player)!;
    expect(e).toBeTruthy();
    // Arriving by admin teleport never counts as a discovery
    expect(player.achievements.has('find_error_biome')).toBe(false);
    const start = admin(server, conn, { a: 'v4', op: 'glitch_start' });
    expect(result(conn, start)!.ok).toBe(true);
    const f = [...server.glitchedQuest!.fights.values()][0]!;
    expect(f.cheat).toBe(true);
    expect(f.mobs.every((m) => m.admin)).toBe(true);
    for (let stage = 1; stage <= 5; stage++) {
      if (stage > 1) expect(result(conn, admin(server, conn, { a: 'v4', op: 'glitch_start' }))!.ok).toBe(true);
      expect(result(conn, admin(server, conn, { a: 'v4', op: 'glitch_clear' }))!.ok).toBe(true);
      tick(server, 20);
    }
    expect(server.level.quests.glitch[`overworld:${e.cx},${e.cz}`]!.done).toBe(true);
    expect(player.achievements.has('glitched_quest')).toBe(false);
    // Reset shuts every firewall again
    expect(result(conn, admin(server, conn, { a: 'v4', op: 'glitch_reset' }))!.ok).toBe(true);
    expect(server.level.quests.glitch[`overworld:${e.cx},${e.cz}`]).toBeUndefined();
    expect(player.dim.blockId((e.cx << 4) + 14, levelFloor(e, 1), (e.cz << 4) + 7)).toBe('glitch_firewall');
  }, 120000);

  it('gives a cheat-marked Glitched reward roll and builds a fluid rig where water and lava react', async () => {
    const { server } = await makeServer({ seed: 'admin-v4', cheats: true });
    const { conn, player } = await join(server);
    expect(result(conn, admin(server, conn, { a: 'v4', op: 'glitch_reward' }))!.ok).toBe(true);
    const glitched = [];
    for (let i = 0; i < 41; i++) {
      const st = player.inventory.get(i);
      if (st && itemOf(st.id)!.id.startsWith('glitched_')) glitched.push(st);
    }
    expect(glitched.length).toBe(2);
    expect(glitched.every((s) => isAdminStack(s))).toBe(true);
    player.setPos(Math.floor(player.x) + 0.5, 180, Math.floor(player.z) + 0.5);
    const rig = result(conn, admin(server, conn, { a: 'v4', op: 'fluid_rig' }))!;
    expect(rig.text).toContain('rig');
    tick(server, 200);
    const x0 = Math.floor(player.x) + 3;
    const z0 = Math.floor(player.z) - 4;
    const ids = new Set<string>();
    for (let x = 1; x < 8; x++) for (let z = 1; z < 8; z++) for (let y = 0; y < 3; y++) ids.add(player.dim.blockId(x0 + x, 180 + y, z0 + z));
    expect([...ids].join(',')).toContain('obsidian');
    expect(ids.has('cobblestone')).toBe(true);
    expect(player.achievements.has('form_obsidian')).toBe(false);
  }, 120000);

  it('refuses V4 operations in worlds made before V4', async () => {
    const { server } = await makeServer({ seed: 'admin-old', cheats: true });
    server.level.generatorVersion = 3;
    const { conn } = await join(server);
    expect(result(conn, admin(server, conn, { a: 'v4', op: 'status' }))!.ok).toBe(false);
  });
});
