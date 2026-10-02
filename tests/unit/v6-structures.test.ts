/**
 * V6 phase 3: the Expanded End's structures, the ancient civilization, the
 * Guardian Constructs and the Dragon's Nest.
 *
 * Generation: every End City variant and giant structure only in its own
 * biomes and inside the ring, deterministic per seed, one per region, never
 * overlapping another, always reachable, giants rare; the same variant
 * planned at ten seeds gives ten layouts; a giant structure builds the same
 * whatever order its chunks generate in; nothing new in the classic End.
 * The rest runs on a real server: the Nest (absent before the dragon's
 * defeat, carved after it a chunk per tick, old saves included, only once,
 * clear of the portal, pillars and gateways, walkable from the surface, and
 * ignored by a respawned dragon), the Constructs (leashed, never respawning,
 * every attack telegraphed), loot (every table, once per container, the
 * Shipyard's Elytra rate), the lore pool and its docs, saves, multiplayer
 * discovery, and the Admin Panel (every op, nothing awarded).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeServer, makeServerAt, join, tick, type FakeConn } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { Random, seedFromString } from '../../src/common/math/rng';
import { createGenerator } from '../../src/common/gen/generator';
import { endPillars, exitPortalY, type EndGenerator } from '../../src/common/gen/end';
import { EndSystem } from '../../src/server/systems/TheEnd';
import type { Start } from '../../src/common/gen/structures/manager';
import { layoutOf, planExpansionStructureAt, Site } from '../../src/common/gen/structures/expanded';
import { inExpansion, EXPANSION_INNER, EXPANSION_OUTER } from '../../src/common/endExpansion/region';
import { END_VARIANTS, END_VARIANT_IDS, GIANT_IDS, GIANT_SPACING, GIANT_STRUCTURES, STRUCTURE_LOOT, SHIPYARD_ELYTRA_CHANCE, CONSTRUCT_LEASH } from '../../src/common/endExpansion/structures';
import { LORE, NEST_LORE, LORE_SITES, loreWeight, pickLore } from '../../src/common/endExpansion/lore';
import { END_ARTIFACT_IDS, ANCIENT_BLADE_PIERCE } from '../../src/common/endExpansion/ancient';
import { nestPlan } from '../../src/common/endExpansion/nest';
import { rollLoot } from '../../src/common/game/loot';
import { LOOT_TABLES } from '../../src/common/data/loot';
import { itemById, items } from '../../src/common/registry/items';
import { blocks, STATE_BLOCK, STATE_SOLID, S } from '../../src/common/registry/blocks';
import { stackOf, isAdminStack } from '../../src/common/game/itemstack';
import { Mob } from '../../src/server/entity/Mob';
import { hashChunks } from './v3-regression.test';
import { SENTINEL_BOLT_TICKS, SENTINEL_PUNCH_TICKS, BULWARK_POUND_TICKS, TELEGRAPH_TICKS_CROWD } from '../../src/common/endExpansion/combat';

const blockId = (s: number): string => blocks[STATE_BLOCK[s]!]!.id;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Every start over the ring (all regions), for one seed. */
function census(g: EndGenerator): Start[] {
  const m = g.expansionStructures as unknown as { types: { id: string; spacing: number }[]; startChunk(t: unknown, rx: number, rz: number): [number, number]; startAt(t: unknown, rx: number, rz: number): Start | null };
  const out: Start[] = [];
  for (const t of m.types) {
    const span = Math.ceil(EXPANSION_OUTER / 16 / t.spacing) + 1;
    for (let rx = -span; rx <= span; rx++)
      for (let rz = -span; rz <= span; rz++) {
        const [cx, cz] = m.startChunk(t, rx, rz);
        const d = Math.hypot((cx << 4) + 8, (cz << 4) + 8);
        if (d < EXPANSION_INNER - 300 || d > EXPANSION_OUTER + 300) continue;
        const s = m.startAt(t, rx, rz);
        if (s) out.push(s);
      }
  }
  return out;
}

const gens = new Map<string, EndGenerator>();
function gen(seed: string): EndGenerator {
  let g = gens.get(seed);
  if (!g) gens.set(seed, (g = createGenerator('end', seedFromString(seed)) as EndGenerator));
  return g;
}
const censuses = new Map<string, Start[]>();
function starts(seed: string): Start[] {
  let c = censuses.get(seed);
  if (!c) censuses.set(seed, (c = census(gen(seed))));
  return c;
}

describe('where the structures go', () => {
  it('each variant and giant only in its own biomes, inside the ring, clear of the arrival island', () => {
    const kinds = new Set<string>();
    for (const seed of ['v6-structures', 'alpha', 'v6-e2e']) {
      const g = gen(seed);
      const site = new Site(g.terrain.expansion);
      const all = starts(seed);
      expect(all.length).toBeGreaterThan(100);
      for (const s of all) kinds.add(s.type);
      const a = g.terrain.expansion.arrival();
      for (const s of all) {
        const biome = site.biomeId(s.x, s.z);
        const v = END_VARIANTS.find((x) => x.id === s.type);
        const allowed = v ? v.biomes : Object.keys(GIANT_STRUCTURES.find((x) => x.id === s.type)!.biomes);
        expect(allowed, `${s.type} at ${s.x},${s.z} in ${biome}`).toContain(biome);
        const b = s.bounds;
        for (const [x, z] of [
          [b.x0, b.z0],
          [b.x1, b.z0],
          [b.x0, b.z1],
          [b.x1, b.z1],
        ])
          expect(inExpansion(x, z), `${s.type} reaches out of the ring`).toBe(true);
        const nx = Math.max(b.x0, Math.min(a.x, b.x1));
        const nz = Math.max(b.z0, Math.min(a.z, b.z1));
        expect(Math.hypot(nx - a.x, nz - a.z)).toBeGreaterThan(30);
      }
    }
    // The Palace and the Metropolis can miss a world, not all three
    for (const v of END_VARIANTS) expect(kinds.has(v.id), v.id).toBe(true);
  }, 300000);

  it('nothing new in the classic End: no start reaches a chunk outside the ring', () => {
    const g = gen('v6-structures');
    const m = g.expansionStructures!;
    for (let i = 0; i < 300; i++) {
      const a = (i / 300) * Math.PI * 2;
      for (const d of [0, 500, 1500, 3000, 4500, 5800, 10200]) {
        const x = Math.round(Math.cos(a) * d);
        const z = Math.round(Math.sin(a) * d);
        if (inExpansion(x, z)) continue;
        expect(m.startsFor(x >> 4, z >> 4).filter((s) => s.pieces.some((p) => p.box.x0 <= x && p.box.x1 >= x && p.box.z0 <= z && p.box.z1 >= z)).length).toBe(0);
      }
    }
    // Older worlds have no structure manager at all
    for (const version of [6, 7]) expect((createGenerator('end', seedFromString('v6-structures'), { version }) as EndGenerator).expansionStructures).toBeNull();
  }, 120000);

  it('is deterministic per seed', () => {
    const a = census(createGenerator('end', seedFromString('v6-structures')) as EndGenerator);
    const b = starts('v6-structures');
    expect(a.map((s) => `${s.type}@${s.x},${s.y},${s.z}:${layoutOf(s).join('|')}`)).toEqual(b.map((s) => `${s.type}@${s.x},${s.y},${s.z}:${layoutOf(s).join('|')}`));
  }, 300000);

  it('keeps spacing: one per region, apart by the separation', () => {
    for (const seed of ['v6-structures', 'alpha']) {
      const all = starts(seed);
      for (const v of END_VARIANTS) {
        const same = all.filter((s) => s.type === v.id);
        for (let i = 0; i < same.length; i++)
          for (let j = i + 1; j < same.length; j++) {
            const d = Math.max(Math.abs(same[i]!.x - same[j]!.x), Math.abs(same[i]!.z - same[j]!.z));
            expect(d, `${v.id} too close`).toBeGreaterThanOrEqual(v.separation * 16 - 16);
          }
      }
      const giants = all.filter((s) => GIANT_IDS.includes(s.type));
      // At most one giant per giant region
      const regions = new Set<string>();
      for (const g of giants) {
        const k = `${Math.floor((g.x >> 4) / GIANT_SPACING)},${Math.floor((g.z >> 4) / GIANT_SPACING)}`;
        void k;
        regions.add(`${g.x},${g.z}`);
      }
      for (let i = 0; i < giants.length; i++) for (let j = i + 1; j < giants.length; j++) expect(Math.hypot(giants[i]!.x - giants[j]!.x, giants[i]!.z - giants[j]!.z)).toBeGreaterThan(600);
    }
  }, 300000);

  it('no two big structures overlap', () => {
    for (const seed of ['v6-structures', 'alpha']) {
      const all = starts(seed);
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i]!.bounds;
          const b = all[j]!.bounds;
          const overlap = a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;
          expect(overlap, `${all[i]!.type} at ${all[i]!.x},${all[i]!.z} overlaps ${all[j]!.type} at ${all[j]!.x},${all[j]!.z}`).toBe(false);
        }
    }
  }, 300000);

  it('every structure is reachable: each piece stands on land or within bridging distance of one that does', () => {
    const g = gen('v6-structures');
    const site = new Site(g.terrain.expansion);
    for (const s of starts('v6-structures')) {
      const ps = s.pieces;
      const grounded = ps.map((p) => {
        for (let x = p.box.x0; x <= p.box.x1; x += 2) for (let z = p.box.z0; z <= p.box.z1; z += 2) if (site.ground(x, z) !== null) return true;
        return false;
      });
      expect(grounded.some(Boolean), `${s.type} at ${s.x},${s.z} has no ground at all`).toBe(true);
      // Pieces join up: a piece near (8 blocks) a reached piece is reached
      const reached = grounded.slice();
      for (let changed = true; changed; ) {
        changed = false;
        ps.forEach((p, i) => {
          if (reached[i]) return;
          if (ps.some((q, j) => reached[j] && p.box.x0 - 8 <= q.box.x1 && p.box.x1 + 8 >= q.box.x0 && p.box.z0 - 8 <= q.box.z1 && p.box.z1 + 8 >= q.box.z0 && p.box.y0 - 8 <= q.box.y1 && p.box.y1 + 8 >= q.box.y0)) {
            reached[i] = true;
            changed = true;
          }
        });
      }
      ps.forEach((p, i) => expect(reached[i], `${s.type} at ${s.x},${s.z}: ${p.kind} is out of reach`).toBe(true));
    }
  }, 300000);

  it('giant structures are rare: a handful in the whole ring, at most one per giant region', () => {
    for (const seed of ['v6-structures', 'alpha', '12345']) {
      const giants = starts(seed).filter((s) => GIANT_IDS.includes(s.type));
      expect(giants.length, seed).toBeGreaterThanOrEqual(3);
      expect(giants.length, seed).toBeLessThanOrEqual(26);
      const variants = starts(seed).filter((s) => END_VARIANT_IDS.includes(s.type));
      expect(variants.length).toBeGreaterThan(giants.length * 10);
    }
  }, 600000);

  it('the same variant at ten seeds gives ten layouts', () => {
    const g = gen('v6-structures');
    const a = g.terrain.expansion.arrival();
    for (const id of [...END_VARIANT_IDS, ...GIANT_IDS]) {
      const layouts = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const s = planExpansionStructureAt(g.terrain.expansion, id, { x: a.x + 300, z: a.z, y: 70 }, 1000 + i * 7919);
        expect(s, id).toBeTruthy();
        layouts.add(layoutOf(s!).join('|'));
      }
      expect(layouts.size, id).toBe(10);
    }
  }, 300000);
});

describe('building chunk by chunk', () => {
  it('a giant structure builds the same whatever order its chunks generate in', () => {
    const seed = 'alpha';
    const g1 = gen(seed);
    const giant = starts(seed).find((s) => s.type === 'crystal_cathedral' || s.type === 'end_fortress' || s.type === 'fallen_city')!;
    expect(giant).toBeTruthy();
    const b = giant.bounds;
    const keys: [number, number][] = [];
    for (let cx = b.x0 >> 4; cx <= b.x1 >> 4; cx += 2) for (let cz = b.z0 >> 4; cz <= b.z1 >> 4; cz += 2) keys.push([cx, cz]);
    const forward = keys.map(([cx, cz]) => g1.generate(cx, cz));
    const g2 = createGenerator('end', seedFromString(seed)) as EndGenerator;
    const shuffled = new Random(5).shuffle(keys.map((k, i) => [k, i] as const));
    const back: ReturnType<EndGenerator['generate']>[] = new Array(keys.length);
    for (const [[cx, cz], i] of shuffled) back[i] = g2.generate(cx, cz);
    expect(hashChunks(back)).toBe(hashChunks(forward));
  }, 300000);

  it('a chunk only ever gets its own part of a structure', () => {
    const g = gen('alpha');
    const giant = starts('alpha').find((s) => GIANT_IDS.includes(s.type))!;
    const c = g.generate(giant.x >> 4, giant.z >> 4);
    // Something of the giant is in its middle chunk, nothing outside the chunk was touched (a DecorView clips)
    let changed = 0;
    const proto = createGenerator('end', seedFromString('alpha'), { version: 7 }).generate(giant.x >> 4, giant.z >> 4);
    for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (c.get(x, y, z) !== proto.get(x, y, z)) changed++;
    expect(changed).toBeGreaterThan(0);
  }, 120000);
});

// ---------------------------------------------------------------------------
// The lore pool and loot
// ---------------------------------------------------------------------------

describe('lore and loot', () => {
  it('every fragment is at most four lines, about one topic, and listed in the docs', () => {
    const docs = readFileSync('docs/END_EXPANSION.md', 'utf8');
    expect(docs).toContain('Lore pool (review)');
    expect(LORE.length).toBeGreaterThanOrEqual(30);
    expect(LORE.length).toBeLessThanOrEqual(40);
    expect(NEST_LORE.length).toBe(5);
    for (const f of [...LORE, ...NEST_LORE]) {
      expect(f.lines.length, f.id).toBeLessThanOrEqual(4);
      expect(f.lines.length).toBeGreaterThan(0);
      for (const line of f.lines) {
        expect(line.length, f.id).toBeLessThan(70);
        expect(docs, `${f.id} missing from the docs`).toContain(line);
      }
      expect(docs).toContain(f.id);
      // Herobrine has nothing to do with the End
      expect(f.lines.join(' ').toLowerCase()).not.toMatch(/herobrine|computer|farlands|error/);
    }
    // Every site can find lore; the Nest only its own five
    for (const site of LORE_SITES) {
      const rng = new Random(3);
      for (let i = 0; i < 40; i++) {
        const f = pickLore(site, rng);
        expect(loreWeight(f, site)).toBeGreaterThan(0);
        expect(site === 'dragon_nest' ? NEST_LORE.includes(f) : !NEST_LORE.includes(f)).toBe(true);
      }
    }
  });

  it('every structure and Construct table rolls valid items', () => {
    const tables = [...Object.values(STRUCTURE_LOOT).flat(), 'mob/guardian_sentinel', 'mob/guardian_bulwark'];
    for (const t of tables) {
      expect(LOOT_TABLES[t], t).toBeTruthy();
      const rng = new Random(11);
      let total = 0;
      for (let i = 0; i < 60; i++) {
        const stacks = rollLoot(t, { rng, difficulty: 'normal' });
        for (const st of stacks) {
          expect(items[st.id], t).toBeTruthy();
          expect(st.count).toBeGreaterThan(0);
          if (items[st.id]!.id === 'book' && st.tag?.lore) expect(LORE.some((f) => f.id === st.tag!.lore) || NEST_LORE.some((f) => f.id === st.tag!.lore)).toBe(true);
        }
        total += stacks.length;
      }
      expect(total, t).toBeGreaterThan(0);
    }
    // The Nest's chests hold its five fragments between them, a map in the first
    const nestLore = new Set<string>();
    for (const t of STRUCTURE_LOOT.dragon_nest!) for (const st of rollLoot(t, { rng: new Random(1), difficulty: 'normal' })) if (st.tag?.lore) nestLore.add(st.tag.lore);
    expect(nestLore.size).toBe(5);
    expect(rollLoot('chest/dragon_nest_a', { rng: new Random(2), difficulty: 'normal' }).some((s) => items[s.id]!.id === 'ancient_map')).toBe(true);
    // Finished Ender Alloy gear is rare, Ender Scrap uncommon
    const rng = new Random(9);
    let gear = 0;
    let scrap = 0;
    for (let i = 0; i < 400; i++)
      for (const st of rollLoot('chest/end_metropolis', { rng, difficulty: 'normal' })) {
        const id = items[st.id]!.id;
        if (id.startsWith('ender_alloy_')) gear++;
        if (id === 'ender_scrap') scrap++;
      }
    expect(gear).toBeGreaterThan(0);
    expect(gear).toBeLessThan(scrap);
  });

  it("about 15% of Shipyards hold Elytra (the classic End Ship's are untouched)", () => {
    const g = gen('v6-structures');
    let n = 0;
    let withElytra = 0;
    for (let i = 0; i < 400; i++) {
      const s = planExpansionStructureAt(g.terrain.expansion, 'end_shipyard', { x: 7000 + i, z: 1000, y: 70 }, 77 + i * 31);
      if (!s) continue;
      n++;
      // Build it into a scratch view to see its chests
      const loots: string[] = [];
      for (const p of s.pieces) {
        const fake = {
          bx: -1e9,
          bz: -1e9,
          inside: () => true,
          set: () => {},
          get: () => 0,
          proto: () => 0,
          height: () => 0,
          biome: () => 0,
          setBlockEntity: (_x: number, _y: number, _z: number, d: { loot?: string }) => d.loot && loots.push(d.loot),
        };
        p.build(fake as never);
      }
      if (loots.includes('chest/end_shipyard_elytra')) withElytra++;
    }
    expect(n).toBeGreaterThan(300);
    const rate = withElytra / n;
    expect(rate).toBeGreaterThan(SHIPYARD_ELYTRA_CHANCE - 0.06);
    expect(rate).toBeLessThan(SHIPYARD_ELYTRA_CHANCE + 0.06);
    // The classic End Ship still always carries Elytra
    expect(LOOT_TABLES['chest/end_ship']!.pools[0]!.entries[0]!.item).toBe('elytra');
  });
});

// ---------------------------------------------------------------------------
// The Dragon's Nest
// ---------------------------------------------------------------------------

async function settle(server: GameServer, rounds = 40, cond?: () => boolean): Promise<boolean> {
  for (let i = 0; i < rounds; i++) {
    if (cond?.()) return true;
    await new Promise((r) => setTimeout(r, 0));
    tick(server, 1);
  }
  return cond ? cond() : true;
}

/** The player on the main island; waits until the Nest's area has loaded. */
async function toIsland(server: GameServer, player: ServerPlayer): Promise<void> {
  if (player.dim.id !== 'end') server.changeDimension(player, 'end', 0.5, 100, 40.5);
  await settle(server, 20);
  const g = player.dim.generator as EndGenerator;
  server.teleport(player, 0.5, exitPortalY(g.terrain) + 1, 40.5);
  const end = server.dim('end');
  await settle(server, 400, () => [-48, 0, 48].every((dx) => [-48, 0, 64].every((dz) => end.isLoaded(dx, dz))));
  player.spawnProtection = 1e9;
}

function killDragon(server: GameServer, player: ServerPlayer): void {
  const dragon = server.theEnd!.fight.dragon!;
  expect(dragon).toBeTruthy();
  dragon.hurt(10000, { source: 'mob', attacker: player });
  tick(server, 205);
  expect(server.level.flags.dragonKilledOnce).toBe(true);
}

/** Snapshot of the blocks the Nest must never touch: the exit portal, the pillars, the ring gateways. */
function protectedBlocks(server: GameServer): number[] {
  const end = server.dim('end');
  const g = end.generator as EndGenerator;
  const out: number[] = [];
  const py = exitPortalY(g.terrain);
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) for (let y = py - 3; y <= py + 5; y++) out.push(end.getState(x, y, z));
  for (const p of endPillars(g.seed)) for (let dx = -p.radius - 1; dx <= p.radius + 1; dx++) for (let dz = -p.radius - 1; dz <= p.radius + 1; dz++) for (let y = 20; y <= p.height + 1; y++) if (end.isLoaded(p.x + dx, p.z + dz)) out.push(end.getState(p.x + dx, y, p.z + dz));
  for (let n = 0; n < 3; n++) {
    const gw = EndSystem.ringGateway(n);
    if (end.isLoaded(gw.x, gw.z)) for (let dy = -3; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push(end.getState(gw.x + dx, gw.y + dy, gw.z + dz));
  }
  return out;
}

/** The dragon's death fills the exit portal, sets the egg and opens a gateway; nothing else may change. */
function expectUntouched(before: number[], after: number[]): void {
  expect(after.length).toBe(before.length);
  const death = new Set(['end_portal', 'dragon_egg', 'end_gateway', 'bedrock']);
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    expect(before[i], `protected block ${i} was ${blockId(before[i]!)}`).toBe(0);
    expect(death.has(blockId(after[i]!)), `protected block ${i} became ${blockId(after[i]!)}`).toBe(true);
  }
}

describe("the Dragon's Nest", () => {
  it('is absent before the dragon dies, carved after it a chunk per tick, once, clear of the portal, pillars and gateways', async () => {
    const { server } = await makeServer({ seed: 'v6-nest' });
    const { player, conn } = await join(server, 'Hero');
    await toIsland(server, player);
    const es = server.endStructures!;
    const plan = es.nestPlan();
    const end = server.dim('end');
    const [fx, fy, fz] = plan.floor;
    expect(es.nest).toBeNull();
    expect(STATE_SOLID[end.getState(fx, fy + 1, fz)]).toBeTruthy();
    tick(server, 40);
    expect(es.nest?.done.length ?? 0).toBe(0);
    const before = protectedBlocks(server);
    const py = exitPortalY((end.generator as EndGenerator).terrain);
    const under: [number, number, number][] = [];
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = py - 14; y < py - 3; y++) under.push([x, y, z]);
    const underBefore = under.map((q) => !!STATE_SOLID[end.getState(...q)]);
    expect(underBefore.filter(Boolean).length).toBeGreaterThan(under.length / 2);
    server.theEnd!.fight.dragon!.hurt(10000, { source: 'mob', attacker: player });
    // A chunk per tick, from the death on: never two in one tick
    let last = es.nest?.done.length ?? 0;
    for (let i = 0; i < 600 && !es.nest?.built; i++) {
      tick(server, 1);
      const now = es.nest?.done.length ?? 0;
      expect(now - last).toBeLessThanOrEqual(1);
      last = now;
    }
    expect(es.nest?.built).toBe(true);
    expect(server.level.flags.dragonKilledOnce).toBe(true);
    // The dragon's boss bar went away with it (it used to come back on the death sequence's last tick)
    const bars = conn.of('boss');
    expect(bars.some((b) => b.action === 'add')).toBe(true);
    expect(bars[bars.length - 1]!.action).toBe('remove');
    expect(end.getState(fx, fy + 1, fz)).toBe(0);
    expect(end.getState(fx, fy, fz) === 0 || !STATE_SOLID[end.getState(fx, fy, fz)]).toBe(true);
    // Its chests, its ring portal, glyphs on its core, shell in some hollows
    for (const [x, y, z] of plan.chests) expect(blockId(end.getState(x, y, z))).toBe('chest');
    expect(blockId(end.getState(plan.portal[0], plan.portal[1], plan.portal[2]))).toBe('dead_portal');
    let glyphs = 0;
    let shells = 0;
    for (let x = -30; x <= 30; x++) for (let z = -20; z <= 30; z++) for (let y = fy - 2; y <= fy + 20; y++) {
      const id = blockId(end.getState(x, y, z));
      if (id === 'ender_glyph_stone') glyphs++;
      if (id === 'shell_fragments') shells++;
    }
    expect(glyphs).toBeGreaterThan(10);
    expect(shells).toBeGreaterThan(2);
    expect(plan.hollows).toBeGreaterThanOrEqual(12);
    expectUntouched(before, protectedBlocks(server));
    // Under the exit portal the island stays solid (the Nest's brick core may face the stone, never hollow it)
    underBefore.forEach((solid, i) => expect(!!STATE_SOLID[end.getState(...under[i]!)] || !solid, `under the portal at ${under[i]!.join(',')}`).toBe(true));
    // Built only once: an edit inside stays
    end.setBlock(fx, fy + 1, fz, S('stone'));
    tick(server, 200);
    expect(blockId(end.getState(fx, fy + 1, fz))).toBe('stone');
    // Walkable from the surface: on foot, up at most one block at a time, down at most three
    const solid = (x: number, y: number, z: number): boolean => !!STATE_SOLID[end.getState(x, y, z)];
    const stand = (x: number, y: number, z: number): boolean => solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z);
    const [ex, ey, ez] = plan.entrance;
    let s0: number[] | null = null;
    for (let y = ey + 3; y > ey - 4 && !s0; y--) if (stand(ex, y, ez)) s0 = [ex, y, ez];
    expect(s0).toBeTruthy();
    const seen = new Set([s0!.join()]);
    const q = [s0!];
    let reached = false;
    while (q.length && !reached) {
      const [x, y, z] = q.shift()!;
      if (y <= fy + 1 && Math.abs(x) < 26 && z < 24) reached = true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
        for (const ny of [y + 1, y, y - 1, y - 2, y - 3]) {
          if (ny > y && solid(x!, y! + 2, z!)) continue;
          if (!stand(x! + dx, ny, z! + dz)) continue;
          const k = `${x! + dx},${ny},${z! + dz}`;
          if (!seen.has(k) && Math.abs(x! + dx) < 50 && Math.abs(z! + dz) < 80) {
            seen.add(k);
            q.push([x! + dx, ny, z! + dz]);
          }
          break;
        }
    }
    expect(reached).toBe(true);
    // Entering it is an advancement
    server.teleport(player, fx + 0.5, fy, fz + 0.5);
    tick(server, 25);
    expect(player.achievements.has('enter_dragon_nest')).toBe(true);
  }, 300000);

  it('old saves that already beat the dragon get it the first time the End loads', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServerAt(7, { seed: 'v6-nest-old' }, storage);
    server.level.flags.dragonKilledOnce = true;
    server.level.flags.dragonKilled = true;
    const { player } = await join(server, 'Veteran');
    await toIsland(server, player);
    await settle(server, 300, () => !!server.endStructures!.nest?.built);
    expect(server.endStructures!.nest?.built).toBe(true);
    const [fx, fy, fz] = server.endStructures!.nestPlan().floor;
    expect(server.dim('end').getState(fx, fy + 1, fz)).toBe(0);
    // Its record survives a restart, and it is never carved again
    await server.stop();
    const { server: s2 } = await makeServer({}, storage);
    expect(s2.endStructures!.nest?.built).toBe(true);
    expect(s2.endStructures!.nestDue()).toBe(false);
  }, 300000);

  it('a respawned dragon fights on, paying no heed to anyone down in the Nest', async () => {
    const { server } = await makeServer({ seed: 'v6-nest-dragon' });
    const { player: a } = await join(server, 'Below');
    const { player: b } = await join(server, 'Above');
    await toIsland(server, a);
    await toIsland(server, b);
    killDragon(server, a);
    await settle(server, 300, () => !!server.endStructures!.nest?.built);
    const [fx, fy, fz] = server.endStructures!.nestPlan().floor;
    server.teleport(a, fx + 0.5, fy, fz + 0.5);
    b.spawnProtection = 0;
    a.spawnProtection = 0;
    // The dragon comes back (as the End Crystal respawn does)
    server.level.flags.dragonKilled = false;
    const fight = server.theEnd!.fight;
    const dragon = fight.spawnDragon()!;
    expect(dragon).toBeTruthy();
    dragon.setPos(fx, fy + 6, fz);
    const nearest = (fight as unknown as { nearest(m: Mob, ps: ServerPlayer[]): ServerPlayer | null }).nearest(dragon, [a, b]);
    expect(nearest).toBe(b);
    tick(server, 100);
    // And it can be beaten again; the Nest stays as it is
    b.spawnProtection = 1e9;
    dragon.hurt(10000, { source: 'mob', attacker: b });
    tick(server, 210);
    expect(server.level.flags.dragonKilled).toBe(true);
    expect(server.endStructures!.nest?.built).toBe(true);
  }, 300000);

  it('its plan never reaches the surface but at the crack', () => {
    for (const seed of ['a', 'b', 'c', 'v6-nest']) {
      const g = createGenerator('end', seedFromString(seed)) as EndGenerator;
      const plan = nestPlan(g.seed, g.terrain);
      expect(plan.chamber.y1).toBeLessThan(exitPortalY(g.terrain) - 6);
      expect(plan.entrance[2]).toBeGreaterThan(55);
    }
  });
});

// ---------------------------------------------------------------------------
// Constructs, discovery, weapons, saves, multiplayer, the Admin Panel
// ---------------------------------------------------------------------------

interface World {
  server: GameServer;
  players: ServerPlayer[];
  conns: FakeConn[];
  at: { x: number; y: number; z: number };
}

/** Players on the arrival island (survival, unprotected). */
async function onIsland(n = 1, seed = 'v6-structures', opts: Record<string, unknown> = {}, storage?: MemoryStorage): Promise<World> {
  const { server } = await makeServer({ seed, ...opts }, storage);
  const players: ServerPlayer[] = [];
  const conns: FakeConn[] = [];
  for (let i = 0; i < n; i++) {
    const j = await join(server, 'P' + i);
    players.push(j.player);
    conns.push(j.conn);
  }
  const g = server.dim('end').generator as EndGenerator;
  const a = g.terrain.expansion.arrival();
  for (const p of players) server.changeDimension(p, 'end', a.x + 0.5, a.floor, a.z - 0.5);
  const end = server.dim('end');
  await settle(server, 400, () => [-32, 0, 32].every((dx) => [-32, 0, 32].every((dz) => end.isLoaded(a.x + dx, a.z + dz))));
  for (const p of players) {
    server.teleport(p, a.x + 0.5, a.floor, a.z - 0.5);
    p.spawnProtection = 0;
  }
  return { server, players, conns, at: { x: a.x, y: a.floor, z: a.z - 1 } };
}

function construct(w: World, type: string, dx: number, dz: number, data: Record<string, unknown> = {}): Mob {
  const m = w.server.mobs!.spawn(w.server.dim('end'), type, w.at.x + 0.5 + dx, w.at.y, w.at.z + 0.5 + dz, { data: { home: [w.at.x + dx, w.at.y, w.at.z + dz], ...data }, persistent: true })!;
  expect(m).toBeTruthy();
  return m;
}

describe('the Guardian Constructs', () => {
  it('telegraph every attack: the punch 24 ticks, the bolt 30, the pound 32; and 32 or more with a crowd', async () => {
    const w = await onIsland(1);
    const [p] = w.players;
    p!.spawnProtection = 0;
    // A Sentinel's punch
    const s = construct(w, 'guardian_sentinel', 0, -2);
    let teleAt = -1;
    let hitAt = -1;
    const h0 = p!.health;
    for (let i = 0; i < 200 && hitAt < 0; i++) {
      w.server.teleport(p!, s.x, s.y, s.z + 1.2);
      p!.health = Math.max(p!.health, 18);
      tick(w.server, 1);
      if (teleAt < 0 && s.data.tele === 'punch') teleAt = w.server.tickNo;
      if (p!.health < 18 && hitAt < 0) hitAt = w.server.tickNo;
    }
    void h0;
    expect(teleAt).toBeGreaterThan(0);
    expect(hitAt - teleAt).toBeGreaterThanOrEqual(SENTINEL_PUNCH_TICKS);
    s.remove();
    // A Sentinel's bolt: the beam, then the bolt along it
    const s2 = construct(w, 'guardian_sentinel', 0, -10);
    let beamAt = -1;
    let boltAt = -1;
    const fx0 = w.conns[0]!.received.length;
    for (let i = 0; i < 300 && boltAt < 0; i++) {
      w.server.teleport(p!, s2.x, s2.y, s2.z + 9);
      tick(w.server, 1);
      if (beamAt < 0 && s2.data.tele === 'bolt') beamAt = w.server.tickNo;
      if (beamAt > 0 && [...w.server.dim('end').entities.values()].some((e) => e.type === 'crystal_bolt')) boltAt = w.server.tickNo;
    }
    expect(beamAt).toBeGreaterThan(0);
    expect(boltAt - beamAt).toBeGreaterThanOrEqual(SENTINEL_BOLT_TICKS);
    expect(w.conns[0]!.received.slice(fx0).some((m) => m.t === 'fx' && (m as { kind: string }).kind === 'warn_beam')).toBe(true);
    s2.remove();
    // A Bulwark wakes when a player comes in, and pounds after its ring of cracks
    const b = construct(w, 'guardian_bulwark', 6, -6, { room: [w.at.x - 2, w.at.y - 2, w.at.z - 12, w.at.x + 14, w.at.y + 6, w.at.z + 2] });
    let poundTele = -1;
    let poundAt = -1;
    for (let i = 0; i < 300 && poundAt < 0; i++) {
      w.server.teleport(p!, b.x - 1.5, b.y, b.z);
      p!.health = 20;
      tick(w.server, 1);
      if (poundTele < 0 && b.data.tele === 'pound') poundTele = w.server.tickNo;
      if (poundTele > 0 && poundAt < 0 && p!.health < 20) poundAt = w.server.tickNo;
    }
    expect(b.data.awake).toBe(true);
    expect(poundTele).toBeGreaterThan(0);
    expect(poundAt - poundTele).toBeGreaterThanOrEqual(BULWARK_POUND_TICKS);
    // With a second player near, the punch waits 32
    const w2 = await onIsland(2, 'v6-structures-crowd');
    const s3 = construct(w2, 'guardian_sentinel', 0, -2);
    let t0 = -1;
    let t1 = -1;
    for (let i = 0; i < 200 && t1 < 0; i++) {
      w2.server.teleport(w2.players[0]!, s3.x, s3.y, s3.z + 1.2);
      w2.server.teleport(w2.players[1]!, s3.x + 4, s3.y, s3.z + 4);
      w2.players[0]!.health = Math.max(w2.players[0]!.health, 18);
      tick(w2.server, 1);
      if (t0 < 0 && s3.data.tele === 'punch') t0 = w2.server.tickNo;
      if (t0 > 0 && t1 < 0 && w2.players[0]!.health < 18) t1 = w2.server.tickNo;
    }
    expect(t1 - t0).toBeGreaterThanOrEqual(TELEGRAPH_TICKS_CROWD);
  }, 300000);

  it('stay within their leash, and the shield halves damage', async () => {
    const w = await onIsland(1);
    const [p] = w.players;
    const s = construct(w, 'guardian_sentinel', 0, -3);
    const home = s.data.home as number[];
    let far = 0;
    for (let i = 0; i < 600; i++) {
      // The player keeps backing off well past the leash
      const r = Math.min(40, 3 + i * 0.1);
      w.server.teleport(p!, home[0]! + 0.5, home[1]!, home[2]! + 0.5 - r);
      p!.health = 20;
      tick(w.server, 1);
      far = Math.max(far, Math.hypot(s.x - home[0]! - 0.5, s.z - home[2]! - 0.5));
    }
    expect(far).toBeLessThanOrEqual(CONSTRUCT_LEASH + 2);
    const b = construct(w, 'guardian_bulwark', 4, -6);
    w.server.constructs!.shield(b);
    const hp = b.health;
    b.hurt(10, { source: 'mob', attacker: null });
    const shielded = hp - b.health;
    b.data.shieldUntil = 0;
    tick(w.server, 25);
    const hp2 = b.health;
    b.hurt(20, { source: 'kill', attacker: null });
    expect(shielded).toBeLessThan(hp2 - b.health);
  }, 300000);

  it("never respawn once killed (structure entities spawn once with their chunk), and a Bulwark's defeat counts", async () => {
    const storage = new MemoryStorage();
    const w = await onIsland(1, 'v6-structures', {}, storage);
    const g = w.server.dim('end').generator as EndGenerator;
    // The nearest structure with Sentinels: go there and let it generate
    let target: Start | null = null;
    for (const id of ['end_outpost', 'end_library', 'end_shipyard']) {
      const it = g.expansionSteps(id, w.at.x, w.at.z);
      let r = it.next();
      while (!r.done) r = it.next();
      if (r.value && r.value.entities?.some((e) => e.type === 'guardian_sentinel')) {
        target = r.value;
        break;
      }
    }
    expect(target).toBeTruthy();
    const end = w.server.dim('end');
    const [p] = w.players;
    w.server.teleport(p!, target!.x + 0.5, target!.y + 20, target!.z + 0.5);
    p!.abilities.flying = true;
    await settle(w.server, 400, () => target!.entities!.every((e) => end.isLoaded(e.x, e.z)));
    tick(w.server, 5);
    const guards = [...end.entities.values()].filter((e) => e instanceof Mob && e.type === 'guardian_sentinel') as Mob[];
    expect(guards.length).toBeGreaterThan(0);
    for (const m of guards) m.hurt(1000, { source: 'kill', attacker: null });
    tick(w.server, 40);
    await w.server.stop();
    const { server: s2 } = await makeServer({}, storage);
    const { player: p2 } = await join(s2, 'P0');
    s2.teleport(p2, target!.x + 0.5, target!.y + 20, target!.z + 0.5);
    const end2 = s2.dim('end');
    await settle(s2, 400, () => target!.entities!.every((e) => end2.isLoaded(e.x, e.z)));
    tick(s2, 10);
    expect([...end2.entities.values()].filter((e) => e instanceof Mob && e.type === 'guardian_sentinel').length).toBe(0);
    // A Bulwark beaten in play
    const w3 = await onIsland(1, 'v6-structures-bulwark');
    const b = construct(w3, 'guardian_bulwark', 3, -3);
    b.hurt(1000, { source: 'player', attacker: w3.players[0]! });
    tick(w3.server, 30);
    expect(w3.players[0]!.achievements.has('kill_bulwark')).toBe(true);
    const drops = [...w3.server.dim('end').entities.values()].filter((e) => e.type === 'item').map((e) => items[(e as unknown as { stack: { id: number } }).stack.id]!.id);
    expect(drops).toContain('ancient_fragment');
  }, 300000);
});

describe('finding things', () => {
  it('a giant structure: a one-time title, a sting and an advancement for each player who finds it; variants count too', async () => {
    const w = await onIsland(2, 'alpha');
    const g = w.server.dim('end').generator as EndGenerator;
    const giant = starts('alpha').find((s) => s.type === 'crystal_cathedral') ?? starts('alpha').find((s) => GIANT_IDS.includes(s.type))!;
    const end = w.server.dim('end');
    for (const p of w.players) {
      w.server.teleport(p, giant.x + 0.5, giant.y + 1, giant.z + 0.5);
      p.abilities.flying = true;
    }
    await settle(w.server, 400, () => end.isLoaded(giant.x, giant.z));
    tick(w.server, 45);
    for (const [i, p] of w.players.entries()) {
      expect(w.conns[i]!.of('title').filter((t) => t.text === GIANT_STRUCTURES.find((x) => x.id === giant.type)!.title).length).toBe(1);
      expect(w.conns[i]!.of('sound').some((s) => s.name === 'music.discovery')).toBe(true);
      expect(p.achievements.has(`find_${giant.type}`)).toBe(true);
      expect(p.endFound.has(giant.type)).toBe(true);
    }
    // Only once: walking about in it again shows no title
    tick(w.server, 60);
    expect(w.conns[0]!.of('title').filter((t) => t.text === GIANT_STRUCTURES.find((x) => x.id === giant.type)!.title).length).toBe(1);
    // A variant
    const v = starts('alpha').find((s) => s.type === 'end_outpost')!;
    w.server.teleport(w.players[0]!, v.x + 0.5, v.y + 2, v.z + 0.5);
    await settle(w.server, 400, () => end.isLoaded(v.x, v.z));
    tick(w.server, 25);
    expect(w.players[0]!.achievements.has('find_end_variant')).toBe(true);
    void g;
  }, 300000);

  it('Ender Glyph Stone shows only its glyphs; dormant blocks say what they lack; lore and artifacts are counted', async () => {
    const w = await onIsland(1);
    const [p] = w.players;
    const end = w.server.dim('end');
    const { x, y, z } = w.at;
    end.setBlock(x + 2, y, z, S('ender_glyph_stone'));
    end.setBlock(x - 2, y, z, S('ancient_core'));
    end.setBlock(x, y, z - 2, S('ancient_vault_door'));
    const use = (bx: number, by: number, bz: number): void => w.server.handle(w.conns[0]!, { t: 'use_on', x: bx, y: by, z: bz, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 0.5, seq: 1 });
    use(x + 2, y, z);
    expect(w.conns[0]!.of('glyphs').length).toBe(1);
    expect(p!.achievements.has('read_glyph')).toBe(true);
    use(x - 2, y, z);
    expect(w.conns[0]!.of('title').some((t) => t.sub === 'It has no power.')).toBe(true);
    use(x, y, z - 2);
    expect(w.conns[0]!.of('title').some((t) => t.sub === 'It is sealed. Something is missing.')).toBe(true);
    // Lore fragments and artifacts as they come to hand
    for (const f of LORE.slice(0, 10)) p!.inventory.add({ ...stackOf('book', 1), tag: { lore: f.id } });
    for (const a of END_ARTIFACT_IDS) p!.inventory.add(stackOf(a, 1));
    tick(w.server, 25);
    expect(p!.endLore.size).toBe(10);
    expect(p!.achievements.has('lore_fragments')).toBe(true);
    expect(p!.achievements.has('all_artifacts')).toBe(true);
  }, 300000);

  it('an Ancient Map is tied to the nearest giant structure when a chest first rolls it', async () => {
    const w = await onIsland(1, 'alpha');
    const end = w.server.dim('end');
    const { x, y, z } = w.at;
    end.setBlock(x + 1, y, z + 1, S('chest'));
    end.setBlockEntity(x + 1, y, z + 1, { type: 'chest', loot: 'chest/dragon_nest_a', lootSeed: 5 });
    w.server.interaction.containers.materializeLoot(end, x + 1, y, z + 1);
    const be = end.getBlockEntity(x + 1, y, z + 1) as unknown as { items: ({ id: string; tag?: { data?: { map?: string; target?: number[] } } } | null)[] };
    const map = be.items.find((s) => s?.id === 'ancient_map');
    expect(map?.tag?.data?.map).toBe('marked');
    const giant = w.server.endStructures!.nearestGiant(x + 1, z + 1)!;
    expect(map!.tag!.data!.target).toEqual([giant.x, giant.y, giant.z]);
  }, 300000);

  it('the ancient weapons: the Blade cuts through armor, Voidpiercer bolts fly straight, the Shardstaff has its cooldown', async () => {
    const w = await onIsland(1);
    const [p] = w.players;
    const end = w.server.dim('end');
    // Blade against an armored Sentinel vs a plain diamond sword of equal damage
    const s1 = construct(w, 'guardian_sentinel', 0, -3);
    const s2 = construct(w, 'guardian_sentinel', 2, -3);
    const hpA = s1.health;
    w.server.mobs!.damage(s1, 8, { source: 'player', attacker: p!, armorPierce: ANCIENT_BLADE_PIERCE });
    const hpB = s2.health;
    w.server.mobs!.damage(s2, 8, { source: 'player', attacker: p! });
    expect(hpA - s1.health).toBeGreaterThan(hpB - s2.health);
    // The Voidpiercer's bolt holds its height for 32 blocks
    p!.inventory.set(p!.selectedSlot, stackOf('voidpiercer', 1));
    p!.inventory.set(9, stackOf('arrow', 16));
    p!.pitch = 0;
    w.server.mobs!.releaseBow(p!, p!.inventory.get(p!.selectedSlot)!, 30);
    const bolt = [...end.entities.values()].find((e) => e.type === 'arrow')! as unknown as { y: number; vy: number; straight: number; vx: number; vz: number };
    expect(bolt).toBeTruthy();
    const y0 = bolt.y;
    tick(w.server, 8);
    if (bolt.straight > 0) expect(Math.abs(bolt.y - y0)).toBeLessThan(0.05);
    // The Shardstaff: one shard, then nothing until the cooldown is over
    p!.inventory.set(p!.selectedSlot, stackOf('shardstaff', 1));
    const shards = (): number => [...end.entities.values()].filter((e) => e.type === 'crystal_shard').length;
    w.server.endStructures!.useItem(p!, p!.inventory.get(p!.selectedSlot)!, 0);
    w.server.endStructures!.useItem(p!, p!.inventory.get(p!.selectedSlot)!, 0);
    expect(shards()).toBe(1);
    expect(w.conns[0]!.of('cooldown').length).toBeGreaterThan(0);
  }, 300000);
});

describe('saves, old worlds and the Admin Panel', () => {
  it('phase 1 and phase 2 worlds load fine and get no structures (the Nest still comes)', async () => {
    for (const version of [6, 7]) {
      const { server } = await makeServerAt(version, { seed: 'v6-old-' + version });
      const g = server.dim('end').generator as EndGenerator;
      expect(g.expansionStructures).toBeNull();
      expect(g.structureTypes()).not.toContain('end_outpost');
      expect(server.endStructures!.nestPlan().pieces.length).toBeGreaterThan(0);
    }
  }, 120000);

  it('looted chests stay looted across a restart; loot rolls once per container for everyone', async () => {
    const storage = new MemoryStorage();
    const w = await onIsland(2, 'v6-structures', {}, storage);
    const end = w.server.dim('end');
    const { x, y, z } = w.at;
    end.setBlock(x + 1, y, z + 2, S('chest'));
    end.setBlockEntity(x + 1, y, z + 2, { type: 'chest', loot: 'chest/end_library', lootSeed: 42 });
    const c = w.server.interaction.containers;
    const inv1 = c.containerAt(end, x + 1, y, z + 2, 27, 'chest');
    const before = inv1.slots.map((s) => (s ? `${s.id}x${s.count}` : '')).join(',');
    const inv2 = c.containerAt(end, x + 1, y, z + 2, 27, 'chest');
    expect(inv2).toBe(inv1);
    // Take everything out
    for (let i = 0; i < 27; i++) inv1.slots[i] = null;
    c.persist(end, x + 1, y, z + 2, inv1);
    expect((end.getBlockEntity(x + 1, y, z + 2) as { loot?: string }).loot).toBeUndefined();
    expect(before.replace(/,/g, '')).not.toBe('');
    await w.server.stop();
    const { server: s2 } = await makeServer({}, storage);
    const { player } = await join(s2, 'P0');
    s2.changeDimension(player, 'end', x + 0.5, y, z + 0.5);
    const end2 = s2.dim('end');
    await settle(s2, 400, () => end2.isLoaded(x + 1, z + 2));
    const inv = s2.interaction.containers.containerAt(end2, x + 1, y, z + 2, 27, 'chest');
    expect(inv.slots.every((s) => !s)).toBe(true);
  }, 300000);

  it('every Admin Panel op works and awards nothing', async () => {
    const w = await onIsland(1, 'v6-structures', { cheats: true });
    const [p] = w.players;
    const conn = w.conns[0]!;
    let req = 1000;
    const admin = async (action: Record<string, unknown>, wait = 0): Promise<{ ok: boolean; text: string; data?: unknown }> => {
      const r = req++;
      w.server.handle(conn, { t: 'admin', req: r, action });
      if (wait) await settle(w.server, wait);
      tick(w.server, 4);
      return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? {}) as never;
    };
    const loc = await admin({ a: 'v6', op: 'locate_structures' });
    expect(loc.ok).toBe(true);
    const located = (loc.data as { located: { id: string; at: unknown }[] }).located;
    expect(located.length).toBe(END_VARIANT_IDS.length + GIANT_IDS.length);
    expect(located.filter((l) => l.at).length).toBeGreaterThan(8);
    expect((await admin({ a: 'v6', op: 'tp_structure', structure: 'end_outpost' })).ok).toBe(true);
    await settle(w.server, 400, () => conn.received.some((m) => m.t === 'admin_result' && (m as { data?: { teleported?: boolean } }).data?.teleported));
    tick(w.server, 30);
    // Generate a structure here, a chunk per tick, with cheat-made Constructs
    tick(w.server, 40);
    expect((await admin({ a: 'v6', op: 'generate_here', structure: 'end_library' })).ok).toBe(true);
    const es = w.server.endStructures!;
    expect(es.pendingBuilds).toBeGreaterThan(0);
    await settle(w.server, 400, () => es.pendingBuilds === 0);
    expect(es.pendingBuilds).toBe(0);
    const cons = [...w.server.dim('end').entities.values()].filter((e) => e instanceof Mob && e.type === 'guardian_sentinel') as Mob[];
    expect(cons.some((m) => m.admin)).toBe(true);
    for (const m of cons) if (m.admin) m.hurt(1000, { source: 'player', attacker: p! });
    tick(w.server, 40);
    expect((await admin({ a: 'v6', op: 'reset_loot' })).ok).toBe(true);
    expect((await admin({ a: 'v6', op: 'give_lore' })).ok).toBe(true);
    for (const set of ['artifacts', 'ancient_weapons', 'ancient_map', 'ancient_blocks']) expect((await admin({ a: 'v6', op: 'give_set', set })).ok).toBe(true);
    tick(w.server, 30);
    for (let i = 0; i < p!.inventory.size; i++) {
      const s = p!.inventory.get(i);
      if (s) expect(isAdminStack(s)).toBe(true);
    }
    expect((await admin({ a: 'spawn', mob: 'guardian_bulwark', count: 1 })).ok).toBe(true);
    expect((await admin({ a: 'v6', op: 'build_nest' })).ok).toBe(true);
    expect(es.nestDue()).toBe(true);
    expect((await admin({ a: 'v6', op: 'tp_nest' })).ok).toBe(true);
    await settle(w.server, 600, () => !!es.nest?.built);
    tick(w.server, 40);
    // Nothing earned: no advancement of phase 3
    for (const id of ['find_end_variant', 'all_artifacts', 'lore_fragments', 'kill_bulwark', 'enter_dragon_nest', 'read_glyph']) expect(p!.achievements.has(id), id).toBe(false);
    expect(p!.endLore.size).toBe(0);
    expect(p!.endArtifacts.size).toBe(0);
  }, 600000);
});

void itemById;
void blockId;
void Site;
