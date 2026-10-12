/**
 * V2 cave decoration: dresses every cave by its 3D cave biome (floors, walls,
 * ceilings, plants, crystals, ice, sculk...) and adds waterfalls and
 * lavafalls. Replaces the V1 per-column cave decoration in V2 worlds.
 *
 * Decisions read only proto terrain (and the proto's cave biome grid) so a
 * chunk decorates identically whatever its neighbours have done. Wall blocks
 * on the chunk border facing a cave in the neighbour are handled by also
 * scanning a one block ring of neighbouring columns.
 */
import type { DecorView } from '../decorate/view';
import type { Chunk } from '../../world/chunk';
import { S, stateOf, STATE_SOLID, STATE_OPAQUE, STATE_FLUID } from '../../registry/blocks';
import { hash3 } from '../../math/rng';
import { CaveBiome } from './caveBiomes';
import { BIOME_CELLS_Y } from './carver';

let B: ReturnType<typeof makeStates> | undefined;
function makeStates() {
  const lichen = (face: string): number => stateOf('glow_lichen', { [face]: true });
  const drip = (id: string, dir: 'up' | 'down', thick: string): number => stateOf(id, { vertical_direction: dir, thickness: thick });
  return {
    caveAir: S('cave_air'),
    water: S('water'),
    waterFalling: stateOf('water', { level: '8' }),
    lava: S('lava'),
    lavaFalling: stateOf('lava', { level: '8' }),
    stone: S('stone'),
    deepslate: S('deepslate'),
    granite: S('granite'),
    diorite: S('diorite'),
    andesite: S('andesite'),
    tuff: S('tuff'),
    gravel: S('gravel'),
    clay: S('clay'),
    sand: S('sand'),
    cobbledDeepslate: S('cobbled_deepslate'),
    cobweb: S('cobweb'),
    lichenUp: lichen('up'),
    lichenDown: lichen('down'),
    lichenSide: { north: lichen('south'), south: lichen('north'), west: lichen('east'), east: lichen('west') } as Record<string, number>,
    brownMushroom: S('brown_mushroom'),
    redMushroom: S('red_mushroom'),
    // lush
    moss: S('moss_block'),
    mossCarpet: S('moss_carpet'),
    azalea: S('azalea'),
    shortGrass: S('short_grass'),
    caveVines: S('cave_vines'),
    caveVinesBerries: stateOf('cave_vines', { berries: true }),
    sporeBlossom: S('spore_blossom'),
    smallDripleaf: S('small_dripleaf'),
    bigDripleaf: S('big_dripleaf'),
    bigDripleafStem: S('big_dripleaf_stem'),
    rootedDirt: S('rooted_dirt'),
    hangingRoots: S('hanging_roots'),
    // mushroom
    mycelium: S('mycelium'),
    glowshroom: S('glowshroom'),
    glowshroomBlock: S('glowshroom_block'),
    redMushroomBlock: S('red_mushroom_block'),
    mushroomStem: S('mushroom_stem'),
    // crystal
    amethyst: S('amethyst_block'),
    budding: S('budding_amethyst'),
    calcite: S('calcite'),
    cluster: S('amethyst_cluster'),
    bud: S('amethyst_bud'),
    lumen: S('lumen_crystal'),
    smoothBasalt: S('smooth_basalt'),
    // dripstone
    dripBlock: S('dripstone_block'),
    stalactite: ['tip', 'frustum', 'middle', 'base'].map((t) => drip('pointed_dripstone', 'down', t)),
    stalagmite: ['tip', 'frustum', 'middle', 'base'].map((t) => drip('pointed_dripstone', 'up', t)),
    // lava
    magma: S('magma_block'),
    basalt: S('basalt'),
    blackstone: S('blackstone'),
    obsidian: S('obsidian'),
    // frozen
    snowBlock: S('snow_block'),
    snow: stateOf('snow', { layers: 1 }),
    snow2: stateOf('snow', { layers: 2 }),
    packedIce: S('packed_ice'),
    blueIce: S('blue_ice'),
    ice: S('ice'),
    powderSnow: S('powder_snow'),
    icicle: ['tip', 'frustum', 'middle', 'base'].map((t) => drip('icicle', 'down', t)),
    // deep dark
    sculk: S('sculk'),
    sculkVeinDown: stateOf('sculk_vein', { down: true }),
    sculkVeinUp: stateOf('sculk_vein', { up: true }),
    sculkSensor: S('sculk_sensor'),
    shrieker: stateOf('sculk_shrieker', { can_summon: true }),
    catalyst: S('sculk_catalyst'),
  };
}
function states(): ReturnType<typeof makeStates> {
  return (B ??= makeStates());
}

let HOST: Uint8Array | undefined;
/** Natural rock that decoration may re-surface (1). */
function hostTable(): Uint8Array {
  if (HOST) return HOST;
  const b = states();
  const t = new Uint8Array(65536);
  for (const s of [b.stone, b.deepslate, b.granite, b.diorite, b.andesite, b.tuff, b.gravel, S('dirt'), S('coarse_dirt')]) t[s] = 1;
  HOST = t;
  return t;
}

/** Per-mille roll for a position and purpose. */
function roll(seed: number, x: number, y: number, z: number, salt: number): number {
  return (hash3(seed ^ salt, x, y, z) >>> 0) % 1000;
}

const SIDES: [number, number, string][] = [
  [0, -1, 'north'],
  [0, 1, 'south'],
  [-1, 0, 'west'],
  [1, 0, 'east'],
];

/** `v3`: V3 worlds, whose frozen caves get powder snow pits, ice spikes and frozen waterfalls. */
export function caveDecorV2(v: DecorView, seed: number, cx: number, cz: number, v3 = false): void {
  if (v.target.cx !== cx || v.target.cz !== cz) return;
  const b = states();
  const host = hostTable();
  const bx = cx << 4;
  const bz = cz << 4;
  // The 3x3 proto chunks, looked up once, and the 18x18 proto neighbourhood
  // (this chunk plus a one block ring) copied into a flat array for fast reads
  const protos: Chunk[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) protos.push(v.protoChunk(cx + dx, cz + dz));
  const H = BIOME_CELLS_Y * 4;
  const buf = BUF;
  const tops = TOPS;
  for (let lz = -1; lz <= 16; lz++)
    for (let lx = -1; lx <= 16; lx++) {
      const pc = protos[((lz >> 4) + 1) * 3 + (lx >> 4) + 1]!;
      const qx = (bx + lx) & 15;
      const qz = (bz + lz) & 15;
      const top = Math.min(pc.getHeight(qx, qz), H - 1);
      tops[(lz + 1) * 18 + lx + 1] = top;
      const col = (lz + 1) * 18 + lx + 1;
      for (let y = 0; y <= top + 1 && y < H; y++) buf[y * 324 + col] = pc.get(qx, y, qz);
      for (let y = top + 2; y < H; y++) buf[y * 324 + col] = 0;
    }
  const P = (x: number, y: number, z: number): number => (y < 0 || y >= H ? 0 : buf[y * 324 + (z - bz + 1) * 18 + (x - bx + 1)]!);
  const biomeAt = (x: number, y: number, z: number): CaveBiome => {
    const lx = x - bx;
    const lz = z - bz;
    const c = protos[((lz >> 4) + 1) * 3 + (lx >> 4) + 1]!;
    const g = c.caveBiomes;
    const cy = y >> 2;
    if (!g || cy >= BIOME_CELLS_Y) return CaveBiome.None;
    return g[(cy * 4 + ((z & 15) >> 2)) * 4 + ((x & 15) >> 2)]! as CaveBiome;
  };
  const target = v.target;
  const T = (x: number, y: number, z: number): number => target.get(x - bx, y, z - bz);
  const set = (x: number, y: number, z: number, s: number): void => target.setRaw(x - bx, y, z - bz, s);
  const inside = (x: number, z: number): boolean => x >= bx && x < bx + 16 && z >= bz && z < bz + 16;
  const isAir = (s: number): boolean => s === b.caveAir;

  // 1. Re-surface the rock around caves by biome (floors, walls, ceilings)
  const surface = (x: number, y: number, z: number, biome: CaveBiome): void => {
    const cur = T(x, y, z);
    if (!host[cur]) return;
    const floor = isAir(P(x, y + 1, z));
    const ceil = !floor && isAir(P(x, y - 1, z));
    const r = roll(seed, x, y, z, 0x5f1);
    let s = -1;
    switch (biome) {
      case CaveBiome.Lush:
        if (floor) s = r < 900 ? b.moss : b.rootedDirt;
        else if (ceil) s = r < 350 ? b.moss : r < 420 ? b.rootedDirt : -1;
        else if (r < 180) s = b.moss;
        break;
      case CaveBiome.Mushroom:
        if (floor) s = r < 780 ? b.mycelium : -1;
        else if (r < 60) s = b.mycelium;
        break;
      case CaveBiome.Crystal:
        if (r < 280) s = b.amethyst;
        else if (r < 520) s = b.calcite;
        else if (r < 560 && !floor) s = b.budding;
        else if (r < 600) s = b.smoothBasalt;
        break;
      case CaveBiome.Dripstone:
        if (floor || ceil) s = r < 520 ? b.dripBlock : -1;
        else if (r < 260) s = b.dripBlock;
        break;
      case CaveBiome.Lava:
        if (floor) s = r < 260 ? b.magma : r < 480 ? b.basalt : r < 600 ? b.blackstone : -1;
        else if (r < 320) s = b.blackstone;
        else if (r < 460) s = b.basalt;
        break;
      case CaveBiome.Frozen:
        if (floor) s = r < 360 ? b.snowBlock : r < 660 ? b.packedIce : r < 690 ? b.powderSnow : -1;
        else if (r < 340) s = b.packedIce;
        else if (r < 380) s = b.blueIce;
        else if (r < 480) s = b.snowBlock;
        break;
      case CaveBiome.DeepDark:
        if (floor) s = r < 860 ? b.sculk : -1;
        else if (ceil) s = r < 220 ? b.sculk : -1;
        else if (r < 260) s = b.sculk;
        break;
      case CaveBiome.Deep:
        if (r < 170) s = b.tuff;
        else if (floor && r < 260) s = b.cobbledDeepslate;
        break;
      case CaveBiome.Caves:
        if (floor && r < 60) s = b.gravel;
        break;
    }
    // Powder snow only where it is walled in on all sides (a hidden trap, not a leak)
    if (s === b.powderSnow) for (const [dx, dz] of SIDES) if (!STATE_SOLID[P(x + dx, y, z + dz)]) s = b.snowBlock;
    if (s >= 0) set(x, y, z, s);
  };

  // 2. Scan cave air in the chunk and a one-block ring around it
  for (let lz = -1; lz <= 16; lz++) {
    for (let lx = -1; lx <= 16; lx++) {
      const x = bx + lx;
      const z = bz + lz;
      const ring = lx < 0 || lz < 0 || lx > 15 || lz > 15;
      const col = (lz + 1) * 18 + lx + 1;
      const top = tops[col]!;
      for (let y = 6; y < top; y++) {
        const s = buf[y * 324 + col]!;
        if (s !== b.caveAir) {
          // Frozen caves ice their pools over
          if (!ring && s === b.water && buf[(y + 1) * 324 + col] === b.caveAir && biomeAt(x, y, z) === CaveBiome.Frozen) set(x, y, z, b.ice);
          continue;
        }
        // Open air in the middle of a cavern has nothing to decorate
        const i = y * 324 + col;
        if (!STATE_SOLID[buf[i - 324]!] && !STATE_SOLID[buf[i + 324]!] && !STATE_SOLID[buf[i - 18]!] && !STATE_SOLID[buf[i + 18]!] && !STATE_SOLID[buf[i - 1]!] && !STATE_SOLID[buf[i + 1]!]) continue;
        const biome = biomeAt(x, y, z);
        if (biome === CaveBiome.None) continue;
        if (ring) {
          // Only the rock just inside this chunk matters
          const nx = lx < 0 ? x + 1 : lx > 15 ? x - 1 : x;
          const nz = lz < 0 ? z + 1 : lz > 15 ? z - 1 : z;
          if ((nx !== x) !== (nz !== z) && host[P(nx, y, nz)]) surface(nx, y, nz, biome);
          continue;
        }
        // Neighbouring rock inside the target (the Caves biome only re-surfaces floors)
        if (biome === CaveBiome.Caves) {
          if (y > 1 && host[buf[(y - 1) * 324 + col]!]) surface(x, y - 1, z, biome);
        } else {
          for (const [dx, dy, dz] of NEIGH6) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            if (!inside(nx, nz) || ny < 1) continue;
            if (host[P(nx, ny, nz)]) surface(nx, ny, nz, biome);
          }
        }
        decorateAir(x, y, z, biome);
      }
    }
  }

  // 3. Things in the air: plants, crystals, sculk, icicles, dripstone, falls
  function decorateAir(x: number, y: number, z: number, biome: CaveBiome): void {
    if (T(x, y, z) !== b.caveAir) return;
    const below = P(x, y - 1, z);
    const above = P(x, y + 1, z);
    const floor = STATE_SOLID[below] === 1 && STATE_OPAQUE[below] === 1;
    const ceil = STATE_SOLID[above] === 1 && STATE_OPAQUE[above] === 1;
    const r = roll(seed, x, y, z, 0xa17);
    const fb = T(x, y - 1, z);
    const cb = T(x, y + 1, z);
    // Waterfalls and lavafalls out of cave walls
    if (!floor && y < 60 && roll(seed, x, y, z, 0xfa11) < 1 && (hash3(seed ^ 0xfa12, x >> 2, y >> 3, z >> 2) & 7) === 0) {
      for (const [dx, dz] of SIDES) {
        const wx = x + dx;
        const wz = z + dz;
        if (!inside(wx, wz) || !host[P(wx, y, wz)] || !STATE_SOLID[P(wx, y + 1, wz)]) continue;
        const lava = biome === CaveBiome.Lava || biome === CaveBiome.DeepDark ? biome === CaveBiome.Lava : biome === CaveBiome.Deep && roll(seed, x, y, z, 0x1a7a) < 400;
        if (biome === CaveBiome.Frozen && v3) {
          // A frozen waterfall: blue ice where the spring was, a column of ice below
          set(wx, y, wz, b.blueIce);
          for (let yy = y; yy > 5; yy--) {
            if (T(x, yy, z) !== b.caveAir) break;
            set(x, yy, z, (yy + x + z) % 3 === 0 ? b.packedIce : b.ice);
          }
          return;
        }
        if (biome === CaveBiome.DeepDark || biome === CaveBiome.Frozen || biome === CaveBiome.Corrupted) return;
        set(wx, y, wz, lava ? b.lava : b.water);
        for (let yy = y; yy > 5; yy--) {
          const cur = T(x, yy, z);
          if (cur !== b.caveAir) break;
          set(x, yy, z, lava ? b.lavaFalling : b.waterFalling);
        }
        return;
      }
    }
    switch (biome) {
      case CaveBiome.Lush: {
        if (floor && (fb === b.moss || fb === b.rootedDirt)) {
          const nearWater = SIDES.some(([dx, dz]) => P(x + dx, y - 1, z + dz) === b.water || P(x + dx, y, z + dz) === b.water);
          if (nearWater && r < 120 && isAir(P(x, y + 1, z)) && inside(x, z)) {
            set(x, y, z, b.bigDripleafStem);
            set(x, y + 1, z, b.bigDripleaf);
          } else if (r < 250) set(x, y, z, b.mossCarpet);
          else if (r < 290) set(x, y, z, b.azalea);
          else if (r < 360) set(x, y, z, b.shortGrass);
          else if (r < 400) set(x, y, z, b.smallDripleaf);
        } else if (ceil && (cb === b.moss || cb === b.rootedDirt || host[cb])) {
          if (r < 110) {
            const len = 1 + (r % 6);
            for (let k = 0; k < len; k++) {
              if (T(x, y - k, z) !== b.caveAir) break;
              set(x, y - k, z, k === len - 1 || (r + k) % 3 === 0 ? b.caveVinesBerries : b.caveVines);
            }
          } else if (r < 122) set(x, y, z, b.sporeBlossom);
          else if (r < 170 && cb === b.rootedDirt) set(x, y, z, b.hangingRoots);
        }
        // Clay beds under lush pools
        if (P(x, y - 1, z) === b.water) {
          for (let yy = y - 1; yy > 5 && P(x, yy, z) === b.water; yy--) if (host[P(x, yy - 1, z)] && roll(seed, x, yy, z, 0xc1a) < 600) set(x, yy - 1, z, b.clay);
        }
        break;
      }
      case CaveBiome.Mushroom:
        if (floor && fb === b.mycelium) {
          if (r < 5 && x - bx >= 2 && x - bx <= 13 && z - bz >= 2 && z - bz <= 13) giantMushroom(x, y, z, r);
          else if (r < 80) set(x, y, z, b.glowshroom);
          else if (r < 130) set(x, y, z, r & 1 ? b.brownMushroom : b.redMushroom);
        } else if (ceil && r < 25) set(x, y, z, b.lichenUp);
        break;
      case CaveBiome.Crystal:
        if (floor && r < 30) set(x, y, z, b.lumen);
        else if (fb === b.budding && r < 600) set(x, y, z, r < 300 ? b.cluster : b.bud);
        else if (floor && (fb === b.amethyst || fb === b.calcite) && r < 70) set(x, y, z, b.bud);
        else if (SIDES.some(([dx, dz]) => T(x + dx, y, z + dz) === b.budding) && r < 180 && floor) set(x, y, z, b.cluster);
        break;
      case CaveBiome.Dripstone:
        if (ceil && r < 130) hang(x, y, z, 1 + (r % 5), b.stalactite);
        else if (floor && r < 90) grow(x, y, z, 1 + (r % 4), b.stalagmite);
        else if (floor && r < 97) {
          // A full column where floor and ceiling are close
          let h = 0;
          while (h < 10 && T(x, y + h, z) === b.caveAir) h++;
          if (h >= 3 && h < 10 && STATE_SOLID[P(x, y + h, z)]) for (let k = 0; k < h; k++) set(x, y + k, z, b.dripBlock);
        }
        break;
      case CaveBiome.Lava:
        if (floor && r < 15 && fb === b.magma) set(x, y - 1, z, b.obsidian);
        break;
      case CaveBiome.Frozen:
        if (v3 && floor && inside(x, z) && x - bx >= 2 && x - bx <= 13 && z - bz >= 2 && z - bz <= 13 && roll(seed, x, y, z, 0x9175) < 7 && powderPit(x, y, z)) break;
        if (ceil && r < (v3 ? 140 : 100)) hang(x, y, z, 1 + (r % (v3 ? 6 : 4)), b.icicle);
        else if (v3 && floor && r < 400 && r >= 385) grow(x, y, z, 2 + (r % 4), [b.ice, b.packedIce, b.packedIce, b.packedIce]);
        else if (floor && (fb === b.snowBlock || fb === b.packedIce) && r < 380) set(x, y, z, r < 120 ? b.snow2 : b.snow);
        break;
      case CaveBiome.DeepDark:
        if (floor && fb === b.sculk) {
          if (r < 14) set(x, y, z, b.sculkSensor);
          else if (r < 17 && isAir(P(x, y + 1, z))) set(x, y, z, b.shrieker);
          else if (r < 19) set(x, y - 1, z, b.catalyst);
        } else if (floor && r < 160) set(x, y, z, b.sculkVeinDown);
        else if (ceil && r < 60) set(x, y, z, b.sculkVeinUp);
        break;
      case CaveBiome.Deep:
        if (ceil && r < 16) set(x, y, z, b.lichenUp);
        else if (y < 40 && r < 26 && corner(x, y, z)) set(x, y, z, b.cobweb);
        else if (floor && r < 32) set(x, y, z, b.lichenDown);
        break;
      case CaveBiome.Caves:
        if (ceil && r < 13) set(x, y, z, b.lichenUp);
        else if (ceil && r < 18) hang(x, y, z, 1 + (r % 3), b.stalactite);
        else if (floor && r < 5) set(x, y, z, r & 1 ? b.brownMushroom : b.redMushroom);
        else if (y < 40 && r < 12 && corner(x, y, z)) set(x, y, z, b.cobweb);
        else if (r < 20) {
          for (const [dx, dz, face] of SIDES) {
            if (STATE_SOLID[P(x + dx, y, z + dz)] && STATE_OPAQUE[P(x + dx, y, z + dz)]) {
              set(x, y, z, b.lichenSide[face]!);
              break;
            }
          }
        }
        break;
    }
    void STATE_FLUID;
  }

  /**
   * V3: a hidden pit of powder snow dug into a frozen floor, flush with it.
   * Only dug where rock walls it in on every side (nothing leaks into caves
   * below). Returns whether a pit was made.
   */
  function powderPit(x: number, y: number, z: number): boolean {
    const r0 = roll(seed, x, y, z, 0x9176);
    const r = r0 < 500 ? 1 : 2;
    const depth = r0 % 10 === 0 ? 8 + (r0 % 4) : 3 + (r0 % 5);
    const rr = r * r + 0.5;
    for (let dz = -r - 1; dz <= r + 1; dz++)
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (r + 1) * (r + 1) + 0.5) continue;
        for (let k = 1; k <= depth + 1; k++) {
          const s = P(x + dx, y - k, z + dz);
          if (!STATE_SOLID[s] || STATE_FLUID[s]) return false;
        }
        if (d2 <= rr && !STATE_SOLID[P(x + dx, y - 1, z + dz)]) return false;
      }
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > rr) continue;
        for (let k = 1; k <= depth; k++) set(x + dx, y - k, z + dz, b.powderSnow);
        if (T(x + dx, y, z + dz) !== b.caveAir) set(x + dx, y, z + dz, b.caveAir);
      }
    return true;
  }

  function corner(x: number, y: number, z: number): boolean {
    let n = 0;
    for (const [dx, dz] of SIDES) if (STATE_SOLID[P(x + dx, y, z + dz)]) n++;
    return n >= 2 && STATE_SOLID[P(x, y + 1, z)] === 1;
  }

  /** A hanging spike (stalactite / icicle) of up to `len` blocks. */
  function hang(x: number, y: number, z: number, len: number, parts: number[]): void {
    let n = 0;
    while (n < len && T(x, y - n, z) === b.caveAir) n++;
    for (let k = 0; k < n; k++) set(x, y - k, z, parts[k === n - 1 ? 0 : k === n - 2 ? 1 : k === 0 && n > 2 ? 3 : 2]!);
  }

  /** A standing spike (stalagmite) of up to `len` blocks. */
  function grow(x: number, y: number, z: number, len: number, parts: number[]): void {
    let n = 0;
    while (n < len && T(x, y + n, z) === b.caveAir && n < 6) n++;
    for (let k = 0; k < n; k++) set(x, y + k, z, parts[k === n - 1 ? 0 : k === n - 2 ? 1 : k === 0 && n > 2 ? 3 : 2]!);
  }

  function giantMushroom(x: number, y: number, z: number, r: number): void {
    const h = 4 + (r % 3);
    for (let k = 0; k <= h + 1; k++) if (T(x, y + k, z) !== b.caveAir) return;
    const cap = r & 1 ? b.glowshroomBlock : b.redMushroomBlock;
    for (let k = 0; k < h; k++) set(x, y + k, z, b.mushroomStem);
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (T(x + dx, y + h, z + dz) === b.caveAir) set(x + dx, y + h, z + dz, cap);
        if ((Math.abs(dx) === 2 || Math.abs(dz) === 2) && T(x + dx, y + h - 1, z + dz) === b.caveAir) set(x + dx, y + h - 1, z + dz, cap);
      }
  }
}

const BUF = new Uint16Array(18 * 18 * BIOME_CELLS_Y * 4);
const TOPS = new Int16Array(18 * 18);

const NEIGH6: [number, number, number][] = [
  [0, -1, 0],
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];
