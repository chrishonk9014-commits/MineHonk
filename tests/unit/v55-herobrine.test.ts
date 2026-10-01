/**
 * V5.5 - the Digital Corruption Update: the Herobrine story, step by step
 * along the canon path, and the rules around it (cheats, saves, the Admin
 * Panel, the computer world being the same seed everywhere).
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import { S, stateOf, blocks, STATE_BLOCK, STATE_SOLID } from '../../src/common/registry/blocks';
import { itemById, items } from '../../src/common/registry/items';
import { stackOf, isAdminStack, markAdmin } from '../../src/common/game/itemstack';
import { rollLoot } from '../../src/common/game/loot';
import { Random } from '../../src/common/math/rng';
import { EndGenerator, exitPortalY } from '../../src/common/gen/end';
import { ComputerWorldGenerator, resetComputerLayout } from '../../src/common/gen/computer';
import { HEROBRINE_SEED, herobrineSeedNum, TAKEOVER_LINES } from '../../src/common/digital/story';
import { seedFromString } from '../../src/common/math/rng';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { GameServer } from '../../src/server/GameServer';
import { installGameplay } from '../../src/server/gameplay';
import { Mob } from '../../src/server/entity/Mob';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { EngNode } from '../../src/server/engineering/Engineering';

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

function find(p: ServerPlayer, id: string): number {
  const num = itemById.get(id)!.num;
  for (let i = 0; i < 41; i++) if (p.inventory.get(i)?.id === num) return i;
  return -1;
}

async function toEndCentre(server: GameServer, player: ServerPlayer): Promise<number> {
  server.changeDimension(player, 'end', 0.5, 100, 20.5);
  await settle(server, 20);
  const y0 = exitPortalY((player.dim.generator as EndGenerator).terrain);
  server.teleport(player, 0.5, y0 + 1, 20.5);
  await settle(server, 80);
  return y0;
}

/** A computer with its core parts, powered, switched on, with a keyboard and monitor beside it. */
function buildComputer(server: GameServer, player: ServerPlayer): EngNode {
  const dim = player.dim;
  const x = Math.floor(player.x) + 3;
  const y = Math.floor(player.y);
  const z = Math.floor(player.z);
  for (let dx = -2; dx <= 3; dx++)
    for (let dz = -2; dz <= 4; dz++) {
      dim.setBlock(x + dx, y - 1, z + dz, S('stone'));
      for (let dy = 0; dy < 4; dy++) dim.setBlock(x + dx, y + dy, z + dz, 0);
    }
  dim.setBlock(x, y, z, stateOf('computer', { facing: 'south' }));
  dim.setBlock(x, y + 1, z, stateOf('monitor', { facing: 'south' }));
  dim.setBlock(x + 1, y, z, stateOf('keyboard', { facing: 'south' }));
  const eng = server.engineering!;
  const n = eng.node(dim, x, y, z)!;
  expect(n).toBeTruthy();
  const ct = server.interaction.containers;
  const inv = ct.containerAt(dim, x, y, z, 12, 'eng');
  ['power_supply', 'motherboard', 'cpu', 'ram_module'].forEach((id, i) => inv.set(i, stackOf(id, 1)));
  ct.persist(dim, x, y, z, inv);
  const be = n.be()!;
  be.energy = 4000;
  eng.computers.pcOf(be).on = true;
  eng.computers.invalidate(n);
  return n;
}

function keepPowered(n: EngNode): void {
  const be = n.be();
  if (be) be.energy = 4000;
}

function plugUsb(server: GameServer, n: EngNode, stack: ReturnType<typeof stackOf> | null): void {
  const ct = server.interaction.containers;
  const inv = ct.containerAt(n.dim, n.x, n.y, n.z, 12, 'eng');
  inv.set(11, stack);
  ct.persist(n.dim, n.x, n.y, n.z, inv);
  server.engineering!.computers.invalidate(n);
}

describe('the grimoire', () => {
  it("lies in every witch's hut chest, beside the potion", () => {
    for (let i = 0; i < 20; i++) {
      const loot = rollLoot('chest/witch_hut', { rng: new Random(i) }).map((s) => items[s.id]!.id);
      expect(loot).toContain('witch_grimoire');
      expect(loot).toContain('mysterious_potion');
    }
  });

  it('reading it is an advancement (not for a cheat copy)', async () => {
    const { server } = await makeServer();
    const { conn, player } = await join(server);
    player.inventory.set(player.selectedSlot, markAdmin(stackOf('witch_grimoire', 1)));
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(player.achievements.has('read_grimoire')).toBe(false);
    player.inventory.set(player.selectedSlot, stackOf('witch_grimoire', 1));
    server.handle(conn, { t: 'use', hand: 0, action: 'start' });
    expect(player.achievements.has('read_grimoire')).toBe(true);
  });
});

describe('the computer world', () => {
  it('is the seed where Herobrine was first found, whatever the world', () => {
    expect(herobrineSeedNum()).toBe(seedFromString(HEROBRINE_SEED));
    resetComputerLayout();
    const a = new ComputerWorldGenerator(1);
    const ca = a.generate(3, -2);
    resetComputerLayout();
    const b = new ComputerWorldGenerator(987654321);
    const cb = b.generate(3, -2);
    expect(b.seed).toBe(a.seed);
    let same = true;
    for (let y = 0; y < 256 && same; y++)
      for (let z = 0; z < 16 && same; z++)
        for (let x = 0; x < 16; x++)
          if (ca.get(x, y, z) !== cb.get(x, y, z)) {
            same = false;
            break;
          }
    expect(same).toBe(true);
    // The same terrain a world made with that seed starts from (MineHonk's first terrain, no structures)
    expect(a.inner.seed).toBe(seedFromString(HEROBRINE_SEED));
  });

  it('has the arrival hill, the exit terminal, the cave and its core', () => {
    resetComputerLayout();
    const g = new ComputerWorldGenerator(42);
    const L = g.layout();
    const id = (x: number, y: number, z: number): string => {
      const c = g.generate(x >> 4, z >> 4);
      return blockId(c.get(x & 15, y, z & 15));
    };
    expect(id(L.spawn.x, L.spawn.y - 1, L.spawn.z)).not.toBe('air');
    expect(id(L.spawn.x, L.spawn.y, L.spawn.z)).toBe('air');
    expect(id(L.exitTerminal.x, L.exitTerminal.y, L.exitTerminal.z)).toBe('old_terminal');
    expect(id(L.hall.x, L.hall.y, L.hall.z)).toBe('air');
    expect(id(L.core.x, L.core.y, L.core.z)).toBe('herobrine_core');
    for (const k of L.coils) expect(id(k.x, k.y, k.z)).toBe('tesla_coil');
  });
});

function blockId(state: number): string {
  return blocks[STATE_BLOCK[state]!]!.id;
}

describe('the ways down to the cave', () => {
  it('several torch-lit tunnels lead from the surface to the hall, each one walkable', () => {
    resetComputerLayout();
    const g = new ComputerWorldGenerator(7);
    const L = g.layout();
    expect(L.entrances.length).toBeGreaterThanOrEqual(5);
    const cache = new Map<string, ReturnType<typeof g.generate>>();
    const ch = (x: number, z: number): ReturnType<typeof g.generate> => {
      const k = `${x >> 4},${z >> 4}`;
      let c = cache.get(k);
      if (!c) cache.set(k, (c = g.generate(x >> 4, z >> 4)));
      return c;
    };
    const solid = (x: number, y: number, z: number): boolean => !!STATE_SOLID[ch(x, z).get(x & 15, y, z & 15)];
    const stand = (x: number, y: number, z: number): boolean => solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z);
    for (const path of L.branches) {
      // On foot, staying inside the hall and this tunnel: step up at most one block, drop at most three
      const inside = (x: number, z: number): boolean => Math.hypot(x - L.hall.x, z - L.hall.z) < L.hall.r || path.some(([px, pz]) => Math.abs(px - x) <= 1 && Math.abs(pz - z) <= 1);
      const s0 = [path[0]![0], L.hall.y, path[0]![1]] as [number, number, number];
      const seen = new Set([s0.join()]);
      const q = [s0];
      let sky = false;
      let torches = 0;
      while (q.length && !sky) {
        const [x, y, z] = q.shift()!;
        let open = true;
        for (let yy = y; yy < 200 && open; yy++) if (solid(x, yy, z)) open = false;
        if (open) sky = true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (!inside(nx, nz)) continue;
          for (const ny of [y + 1, y, y - 1, y - 2, y - 3]) {
            if (ny > y && solid(x, y + 2, z)) continue;
            if (!stand(nx, ny, nz)) continue;
            const k = `${nx},${ny},${nz}`;
            if (!seen.has(k)) {
              seen.add(k);
              q.push([nx, ny, nz]);
            }
            break;
          }
        }
      }
      for (const [x, z, f] of path) for (let y = f - 3; y <= f + 1; y++) if (blockId(ch(x, z).get(x & 15, y, z & 15)) === 'redstone_torch') torches++;
      expect(sky).toBe(true);
      expect(torches).toBeGreaterThan(3);
    }
  }, 120000);
});

describe('the canon path', () => {
  it('potion -> dragon -> malware -> corrupted drive -> the dragon dies -> a computer -> Herobrine -> the computer world -> the cave -> the ending', async () => {
    const { server } = await makeServer({ seed: 'herobrine-canon' });
    const { conn, player } = await join(server, 'Tester', 'uuid-t', 6);
    const hb = server.herobrine!;
    const ow = player.dim;
    const home = { x: player.x, y: player.y, z: player.z };
    player.spawnProtection = 1e9;

    // 1-2: a potion and a flash drive
    player.inventory.set(1, stackOf('flash_drive', 1));
    tick(server, 21);
    expect(player.achievements.has('obtain_flash_drive')).toBe(true);

    // 3: the End
    const y0 = await toEndCentre(server, player);
    const fight = server.theEnd!.fight;
    const dragon = fight.dragon!;
    expect(dragon).toBeTruthy();

    // An Enderman would take the potion the V3 way; the dragon is what this story needs
    // 4: fed to the dragon (it must be close enough to reach)
    player.selectedSlot = 0;
    player.inventory.set(0, stackOf('mysterious_potion', 1));
    dragon.setPos(player.x + 3, player.y, player.z);
    server.handle(conn, { t: 'interact', id: dragon.id, hand: 0 });
    expect(count(player, 'mysterious_potion')).toBe(0);
    expect(dragon.data.malware).toBe(true);
    expect(dragon.meta().malware).toBe(true);
    expect(server.level.herobrine.infected).toBe(true);
    expect(player.achievements.has('feed_dragon')).toBe(true);
    // A second bottle isn't taken
    player.inventory.set(0, stackOf('mysterious_potion', 1));
    server.handle(conn, { t: 'interact', id: dragon.id, hand: 0 });
    expect(count(player, 'mysterious_potion')).toBe(1);
    player.inventory.set(0, null);

    // 5: it coughs up malware: shots that burst into clouds
    for (let i = 0; i < 1200 && hb.malware.clouds.length === 0; i++) {
      player.health = 20;
      tick(server, 1);
    }
    expect(hb.malware.clouds.length).toBeGreaterThan(0);
    expect(player.achievements.has('witness_malware')).toBe(true);
    const cloud = hb.malware.clouds[0]!;

    // 6-7: a flash drive held in the malware becomes the Corrupted Flash Drive
    player.selectedSlot = 1;
    server.teleport(player, cloud.x, cloud.y, cloud.z);
    for (let i = 0; i < 120 && count(player, 'corrupted_flash_drive') === 0; i++) {
      player.health = 20;
      server.teleport(player, cloud.x, cloud.y, cloud.z);
      cloud.until = server.tickNo + 500;
      tick(server, 1);
    }
    expect(count(player, 'flash_drive')).toBe(0);
    expect(count(player, 'corrupted_flash_drive')).toBe(1);
    const drive = player.inventory.get(find(player, 'corrupted_flash_drive'))!;
    expect(isAdminStack(drive)).toBe(false);
    expect((drive.tag?.data as { born: number }).born).toBe(0);
    expect(player.achievements.has('corrupt_flash_drive')).toBe(true);
    expect(player.achievements.has('obtain_corrupted_drive')).toBe(true);
    const disk = server.engineering!.computers.disks.get((drive.tag?.data as { disk: string }).disk)!;
    expect(disk.kind).toBe('corrupted');
    expect(disk.files.map((f) => f.name)).toContain('HER0BRINE.EXE');

    // Before the dragon dies the drive is dormant
    server.changeDimension(player, 'overworld', home.x, home.y, home.z);
    await settle(server, 60);
    let pc = buildComputer(server, player);
    plugUsb(server, pc, drive);
    for (let i = 0; i < 120; i++) {
      keepPowered(pc);
      tick(server, 1);
    }
    expect(server.level.herobrine.stage).toBe('none');
    expect(server.engineering!.computers.pcOf(pc.be()!).log.some((l) => l.includes('dormant'))).toBe(true);
    plugUsb(server, pc, null);
    tick(server, 8);

    // 8: the dragon defeated, the ordinary way
    await toEndCentre(server, player);
    const d2 = server.theEnd!.fight.dragon!;
    d2.hurt(10000, { source: 'mob', attacker: player });
    await settle(server, 220);
    expect(server.level.herobrine.dragonKills).toBe(1);
    expect(server.level.herobrine.legitKills).toBe(1);
    expect(hb.malware.clouds.length).toBe(0);
    expect(server.level.herobrine.infected).toBe(false);

    // 9-11: back in the Overworld, into a working computer (no hard drive needed)
    server.teleport(player, 2.5, y0, 0.5);
    player.portalCooldown = 0;
    tick(server, 2);
    expect(player.dim.id).toBe('overworld');
    server.teleport(player, home.x, home.y, home.z);
    await settle(server, 60);
    pc = buildComputer(server, player);
    for (let i = 0; i < 80; i++) {
      keepPowered(pc);
      tick(server, 1);
    }
    expect(server.engineering!.computers.state(pc)).toBe('bios');
    plugUsb(server, pc, drive);
    const mark = conn.received.length;
    let herobrine: Mob | null = null;
    for (let i = 0; i < 400 && !herobrine; i++) {
      keepPowered(pc);
      player.health = 20;
      tick(server, 1);
      herobrine = (hb.fights.fight?.boss as Mob | null) ?? null;
    }
    const seen = conn.received.slice(mark).flatMap((m) => (m.t === 'fx' && m.kind === 'takeover' && m.text ? [m.text] : []));
    expect(server.level.herobrine.stage === 'emerging' || server.level.herobrine.stage === 'fight1').toBe(true);
    expect(seen).toEqual(TAKEOVER_LINES);
    expect(player.achievements.has('insert_corrupted_drive')).toBe(true);
    // 12: he comes out of the screen
    expect(herobrine).toBeTruthy();
    expect(herobrine!.data.hbAnim).toBe('emerge');
    expect(player.achievements.has('witness_herobrine')).toBe(true);
    expect(server.engineering!.computers.locked(pc)).toBe(true);
    // The computer can't be broken while he has it
    expect(server.interaction.canModify(player, ow, pc.x, pc.y, pc.z, true)).toBe(false);

    // 13: the first fight; 14: low on health he goes back in, he doesn't die
    for (let i = 0; i < 2400 && server.level.herobrine.stage !== 'gateway'; i++) {
      keepPowered(pc);
      player.health = 20;
      if (hb.fights.fight?.state === 'fight' && i % 10 === 0) herobrine!.hurt(25, { source: 'mob', attacker: player });
      tick(server, 1);
    }
    expect(server.level.herobrine.stage).toBe('gateway');
    expect(herobrine!.dead).toBe(false);
    expect(herobrine!.removed).toBe(true);
    expect(player.achievements.has('defeat_first_herobrine')).toBe(true);
    expect(server.engineering!.computers.state(pc)).toBe('gateway');
    const usb = server.interaction.containers.containerAt(pc.dim, pc.x, pc.y, pc.z, 12, 'eng').get(11)!;
    expect((usb.tag?.data as { spent?: boolean }).spent).toBe(true);

    // 15: through the screen
    server.engineering!.computers.openFor(player, pc);
    server.handle(conn, { t: 'pc_cmd', window: player.windowId, cmd: 'enter' });
    await settle(server, 50);
    expect(player.dim.id).toBe('computer');
    expect(player.achievements.has('enter_computer')).toBe(true);
    const cw = player.dim;
    const L = (cw.generator as ComputerWorldGenerator).layout();
    expect(Math.hypot(player.x - L.spawn.x, player.z - L.spawn.z)).toBeLessThan(3);

    // 16: he is standing across the lake, where he was first seen; he's gone once you've looked at him
    let appeared: Mob | null = null;
    for (let i = 0; i < 400 && !player.achievements.has('discover_herobrine_seed'); i++) {
      await new Promise((r) => setTimeout(r, 0));
      tick(server, 1);
      const a = [...cw.entities.values()].find((e) => e instanceof Mob && e.type === 'herobrine' && e.data.apparition) as Mob | undefined;
      if (a) appeared = a;
    }
    expect(appeared).toBeTruthy();
    expect(Math.hypot(appeared!.x - L.sighting.x - 0.5, appeared!.z - L.sighting.z - 0.5)).toBeLessThan(1);
    expect(appeared!.removed).toBe(true);
    expect(player.achievements.has('discover_herobrine_seed')).toBe(true);

    // The terminal where you arrived: the seed, and the way out
    server.teleport(player, L.spawn.x + 0.5, L.spawn.y, L.spawn.z + 0.5);
    await settle(server, 10);
    const term = L.exitTerminal;
    expect(hb.useBlock(player, term.x, term.y, term.z, cw.getState(term.x, term.y, term.z))).toBe(true);
    const tw = conn.last('open_window')!;
    expect(JSON.stringify(tw)).toContain(HEROBRINE_SEED);

    // 17-18: the cave: the hall wakes him
    server.teleport(player, L.hall.x - L.hall.r + 6 + 0.5, L.hall.y, L.hall.z + 0.5);
    await settle(server, 40);
    expect(player.achievements.has('find_herobrine_cave')).toBe(true);
    expect(server.level.herobrine.stage).toBe('final');
    for (let i = 0; i < 200 && hb.fights.fight?.state !== 'fight'; i++) {
      player.health = 20;
      tick(server, 1);
    }
    const f = hb.fights.fight!;
    expect(f.kind).toBe('final');
    expect(f.state).toBe('fight');
    // Every warning gives at least 24 ticks
    const before = conn.received.length;
    for (let i = 0; i < 600; i++) {
      player.health = 20;
      player.food = 20;
      tick(server, 1);
    }
    const warns = conn.received.slice(before).filter((m) => m.t === 'fx' && (m.kind === 'warn_circle' || (m.kind === 'hack' && m.strength === 0)));
    expect(warns.length).toBeGreaterThan(3);
    for (const m of warns) expect((m as { ticks: number }).ticks).toBeGreaterThanOrEqual(24);

    // 19: defeated for real; the digital world collapses; 20: the ending
    const boss = f.boss!;
    for (let i = 0; i < 400 && !boss.dead; i++) {
      player.health = 20;
      if (f.state === 'fight') boss.hurt(60, { source: 'mob', attacker: player });
      tick(server, 1);
    }
    expect(boss.dead).toBe(true);
    expect(player.achievements.has('defeat_final_herobrine')).toBe(true);
    await settle(server, 300);
    expect(player.dim.id).toBe('overworld');
    const card = (conn as FakeConn).of('ending').pop();
    expect(card?.id).toBe('herobrine');
    expect(card?.style).toBe('herobrine');
    expect(card?.title).toBe('HEROBRINE');
    expect(player.endings.has('herobrine')).toBe(true);
    expect(server.level.endings.reached.herobrine).toBeTruthy();
    expect(player.achievements.has('herobrine_ending')).toBe(true);
    // The world's story starts over; the computer is just a computer again
    expect(server.level.herobrine.stage).toBe('none');
    expect(server.level.herobrine.completions).toBe(1);
    expect(server.level.herobrine.epoch).toBe(1);
    tick(server, 8);
    expect(server.engineering!.computers.locked(pc)).toBe(false);
    expect(['bios', 'desktop', 'post']).toContain(server.engineering!.computers.state(pc));
  }, 240000);
});

describe('cheats and the Admin Panel', () => {
  it('a cheat drive runs the same story but awards nothing, and its ending is only forced', async () => {
    const { server } = await makeServer({ seed: 'herobrine-cheat', cheats: true } as never);
    server.level.cheats = true;
    const { conn, player } = await join(server, 'Owner', 'uuid-owner');
    player.spawnProtection = 1e9;
    const admin = (op: string): { ok: boolean; text: string; data?: unknown } => {
      server.handle(conn, { t: 'admin', req: 1, action: { a: 'v55', op } } as never);
      const r = conn.last('admin_result')!;
      return r;
    };
    expect(admin('give_corrupted').ok).toBe(true);
    const slot = find(player, 'corrupted_flash_drive');
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(isAdminStack(player.inventory.get(slot))).toBe(true);
    expect(player.achievements.has('obtain_corrupted_drive')).toBe(false);
    tick(server, 21);
    expect(player.achievements.has('obtain_corrupted_drive')).toBe(false);
    const pc = buildComputer(server, player);
    for (let i = 0; i < 80; i++) {
      keepPowered(pc);
      tick(server, 1);
    }
    plugUsb(server, pc, player.inventory.get(slot));
    for (let i = 0; i < 400 && !server.herobrine!.fights.fight; i++) {
      keepPowered(pc);
      tick(server, 1);
    }
    expect(server.level.herobrine.cheat).toBe(true);
    expect(server.herobrine!.fights.fight).toBeTruthy();
    expect(player.achievements.has('insert_corrupted_drive')).toBe(false);
    expect(player.achievements.has('witness_herobrine')).toBe(false);
    expect(admin('force_ending').ok).toBe(true);
    expect(server.level.endings.forced).toContain('herobrine');
    expect(server.level.endings.reached.herobrine).toBeUndefined();
    expect(player.achievements.has('herobrine_ending')).toBe(false);
    expect(admin('reset_progress').ok).toBe(true);
    expect(server.level.herobrine.stage).toBe('none');
    expect(server.herobrine!.fights.fight).toBeNull();
    expect(admin('reset_ending').ok).toBe(true);
    expect(server.level.endings.forced).not.toContain('herobrine');
    // Every tool answers, and none of them is an advancement
    for (const op of ['status', 'give_potion', 'give_hard_drive', 'give_flash_drive', 'trigger_malware', 'trigger_event', 'reset_progress', 'spawn_first', 'reset_progress', 'enter_world', 'tp_seed', 'tp_cave', 'spawn_final']) {
      const r = admin(op);
      expect(r.ok, `${op}: ${r.text}`).toBe(true);
      await settle(server, 30);
    }
    for (const a of ['feed_dragon', 'witness_malware', 'corrupt_flash_drive', 'obtain_corrupted_drive', 'insert_corrupted_drive', 'witness_herobrine', 'defeat_first_herobrine', 'enter_computer', 'discover_herobrine_seed', 'find_herobrine_cave', 'defeat_final_herobrine', 'herobrine_ending']) expect(player.achievements.has(a), a).toBe(false);
    expect(player.dim.id).toBe('computer');
    expect(server.level.herobrine.cheat).toBe(true);
  }, 120000);
});

describe('saves', () => {
  it('keep the story and the drives; a restart mid-fight puts the story back a step', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'herobrine-save' }, storage);
    const { player } = await join(server);
    const hb = server.herobrine!;
    const st = hb.makeCorruptedDrive();
    player.inventory.set(0, st);
    server.level.herobrine.dragonKills = 3;
    server.level.herobrine.legitKills = 2;
    server.level.herobrine.stage = 'fight1';
    server.level.herobrine.gateway = { x: 1, y: 70, z: 2 };
    await server.stop();
    const s2 = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(s2);
    expect(s2.level.herobrine.dragonKills).toBe(3);
    expect(s2.level.herobrine.legitKills).toBe(2);
    // Herobrine isn't saved: the fight can't go on, the story waits for the drive again
    expect(s2.level.herobrine.stage).toBe('none');
    const id = (st.tag?.data as { disk: string }).disk;
    expect(s2.level.digital.disks[id]?.files.some((f) => f.name === 'HER0BRINE.EXE')).toBe(true);
  });

  it('an old world (before V5.5) loads with the story untouched', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'herobrine-old' }, storage);
    await server.stop();
    const lvl = storage.level as Record<string, unknown>;
    delete lvl.herobrine;
    delete lvl.digital;
    const s2 = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(s2);
    expect(s2.level.herobrine.stage).toBe('none');
    expect(s2.level.herobrine.dragonKills).toBe(0);
    expect(s2.level.digital.disks).toEqual({});
  });
});

describe('multiplayer', () => {
  it('the first fight scales with the players in it and every attack is warned first', async () => {
    const { server } = await makeServer({ seed: 'herobrine-mp' });
    const a = await join(server, 'A', 'uuid-a');
    const b = await join(server, 'B', 'uuid-b');
    for (const p of [a.player, b.player]) p.spawnProtection = 1e9;
    server.teleport(b.player, a.player.x + 2, a.player.y, a.player.z);
    const pc = buildComputer(server, a.player);
    for (let i = 0; i < 80; i++) {
      keepPowered(pc);
      tick(server, 1);
    }
    const hb = server.herobrine!;
    hb.startTakeover(pc, a.player, false);
    hb.skipTakeover();
    for (let i = 0; i < 100 && hb.fights.fight?.state !== 'fight'; i++) {
      keepPowered(pc);
      tick(server, 1);
    }
    const f = hb.fights.fight!;
    expect(f.boss!.maxHealth).toBe(450);
    const before = b.conn.received.length;
    for (let i = 0; i < 600; i++) {
      for (const p of [a.player, b.player]) p.health = 20;
      keepPowered(pc);
      tick(server, 1);
    }
    const warns = b.conn.received.slice(before).filter((m) => m.t === 'fx' && m.kind === 'warn_circle');
    expect(warns.length).toBeGreaterThan(2);
    // With company the warnings are longer
    for (const m of warns) expect((m as { ticks: number }).ticks).toBeGreaterThanOrEqual(32);
    // Both of them are in it
    expect(f.party.has('uuid-a') && f.party.has('uuid-b')).toBe(true);
  }, 60000);
});
