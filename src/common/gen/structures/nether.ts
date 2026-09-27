/**
 * Nether structures: fortresses (a grown network of bridges, corridors,
 * blaze spawner platforms, nether wart gardens and treasure rooms) and
 * bastion remnants (blackstone keeps guarded by piglins and hoglins).
 *
 * Both share one region grid and one salt so a region holds at most one of
 * them: the candidate roll decides which.
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, STATE_SOLID, STATE_FLUID } from '../../registry/blocks';
import { biomeNum } from '../../registry/biomes';
import type { DecorView } from '../decorate/view';
import { Builder, weathered, type Rotation } from './builder';
import { boxOf, unionBoxes, type Box, type Piece, type Start, type StructureType } from './manager';

const SPACING = 27;
const SEPARATION = 4;
const SALT = 0x4e7f0;
const FORTRESS_SHARE = 0.45;

// ---------------------------------------------------------------------------
// Fortress
// ---------------------------------------------------------------------------
const CELL = 7;
/** 0 north(-z) 1 east(+x) 2 south(+z) 3 west(-x) */
const DX = [0, 1, 0, -1];
const DZ = [-1, 0, 1, 0];

type CellKind = 'bridge' | 'corridor' | 'blaze' | 'wart' | 'treasure';

interface Cell {
  gx: number;
  gz: number;
  links: boolean[];
  kind: CellKind;
}

/** Whether local (lx, lz) is walkable floor for a cell. */
function inFootprint(c: Cell, lx: number, lz: number): boolean {
  if (lx < 0 || lz < 0 || lx >= CELL || lz >= CELL) return false;
  if (c.kind === 'blaze' || c.kind === 'wart' || c.kind === 'treasure') return true;
  if (lx >= 1 && lx <= 5 && lz >= 1 && lz <= 5) return true;
  if (c.links[0] && lz === 0 && lx >= 1 && lx <= 5) return true;
  if (c.links[2] && lz === CELL - 1 && lx >= 1 && lx <= 5) return true;
  if (c.links[3] && lx === 0 && lz >= 1 && lz <= 5) return true;
  if (c.links[1] && lx === CELL - 1 && lz >= 1 && lz <= 5) return true;
  return false;
}

/** Edge of the footprint that is not an opening towards a linked cell. */
function isBoundary(c: Cell, lx: number, lz: number): boolean {
  if (!inFootprint(c, lx, lz)) return false;
  for (let d = 0; d < 4; d++) {
    const nx = lx + DX[d]!;
    const nz = lz + DZ[d]!;
    const outside = nx < 0 || nz < 0 || nx >= CELL || nz >= CELL;
    if (outside) {
      const along = d === 0 || d === 2 ? lx : lz;
      if (!(c.links[d] && along >= 1 && along <= 5)) return true;
    } else if (!inFootprint(c, nx, nz)) return true;
  }
  return false;
}

function fenceState(c: Cell, lx: number, lz: number, isFence: (x: number, z: number) => boolean): number {
  return stateOf('nether_brick_fence', {
    north: isFence(lx, lz - 1),
    south: isFence(lx, lz + 1),
    west: isFence(lx - 1, lz),
    east: isFence(lx + 1, lz),
  });
  void c;
}

function buildCell(v: DecorView, c: Cell, ox: number, y0: number, oz: number, seed: number): void {
  const bricks = S('nether_bricks');
  const cracked = S('cracked_nether_bricks');
  const x0 = ox + c.gx * CELL;
  const z0 = oz + c.gz * CELL;
  const enclosed = c.kind === 'corridor' || c.kind === 'wart' || c.kind === 'treasure';
  const brick = (x: number, y: number, z: number): number => (hashInts(seed, x, y, z) % 9 === 0 ? cracked : bricks);
  const isFence = (lx: number, lz: number): boolean => !enclosed && isBoundary(c, lx, lz);
  for (let lz = 0; lz < CELL; lz++)
    for (let lx = 0; lx < CELL; lx++) {
      if (!inFootprint(c, lx, lz)) continue;
      const x = x0 + lx;
      const z = z0 + lz;
      if (!v.inside(x, z)) continue;
      const edge = isBoundary(c, lx, lz);
      v.set(x, y0 - 1, z, brick(x, y0 - 1, z));
      v.set(x, y0, z, brick(x, y0, z));
      for (let y = y0 + 1; y <= y0 + 5; y++) v.set(x, y, z, 0);
      if (enclosed) {
        if (edge) {
          for (let y = y0 + 1; y <= y0 + 4; y++) {
            const window = (y === y0 + 2 || y === y0 + 3) && (lx + lz) % 2 === 1 && lx !== 0 && lz !== 0 && lx !== CELL - 1 && lz !== CELL - 1;
            v.set(x, y, z, window ? fenceState(c, lx, lz, () => false) : brick(x, y, z));
          }
        }
        v.set(x, y0 + 5, z, brick(x, y0 + 5, z));
      } else if (edge) {
        v.set(x, y0 + 1, z, fenceState(c, lx, lz, isFence));
      }
      // Pillars under the corners of the platform down to the ground (or lava floor)
      const corner = (lx === 1 || lx === 5) && (lz === 1 || lz === 5);
      if (corner || ((c.kind === 'blaze' || c.kind === 'wart' || c.kind === 'treasure') && (lx === 0 || lx === 6) && (lz === 0 || lz === 6))) {
        for (let y = y0 - 2; y > 4; y--) {
          const s = v.proto(x, y, z);
          if (STATE_SOLID[s] && !STATE_FLUID[s]) break;
          v.set(x, y, z, bricks);
        }
      }
    }
  // Room contents
  const at = (lx: number, lz: number): [number, number] => [x0 + lx, z0 + lz];
  if (c.kind === 'blaze') {
    for (let lz = 2; lz <= 4; lz++) for (let lx = 2; lx <= 4; lx++) {
      const [x, z] = at(lx, lz);
      v.set(x, y0 + 1, z, bricks);
    }
    const [sx, sz] = at(3, 3);
    if (v.inside(sx, sz)) {
      v.set(sx, y0 + 2, sz, S('spawner'));
      v.setBlockEntity(sx, y0 + 2, sz, { type: 'spawner', mob: 'blaze', delay: 20 });
    }
    const stairs: [number, number, string][] = [
      [3, 1, 'south'],
      [3, 5, 'north'],
      [1, 3, 'east'],
      [5, 3, 'west'],
    ];
    for (const [lx, lz, facing] of stairs) {
      const [x, z] = at(lx, lz);
      v.set(x, y0 + 1, z, stateOf('nether_bricks_stairs', { facing }));
    }
  } else if (c.kind === 'wart') {
    const sand = S('soul_sand');
    for (let lz = 2; lz <= 4; lz++)
      for (let lx = 1; lx <= 5; lx++) {
        const [x, z] = at(lx, lz);
        v.set(x, y0, z, sand);
        v.set(x, y0 + 1, z, stateOf('nether_wart', { age: String(hashInts(seed, x, z, 0x3a) % 4) }));
      }
  } else if (c.kind === 'treasure') {
    const chests: [number, number, string][] = [
      [1, 3, 'east'],
      [5, 3, 'west'],
    ];
    chests.forEach(([lx, lz, facing], i) => {
      const [x, z] = at(lx, lz);
      if (!v.inside(x, z) || (i === 1 && hashInts(seed, x0, z0) % 2 === 0)) return;
      v.set(x, y0 + 1, z, stateOf('chest', { facing }));
      v.setBlockEntity(x, y0 + 1, z, { type: 'chest', loot: 'chest/nether_fortress', lootSeed: hashInts(seed, x, y0 + 1, z) });
    });
  }
}

function planFortress(seed: number, cx: number, cz: number, rng: Random): Start {
  const cx0 = (cx << 4) + 8;
  const cz0 = (cz << 4) + 8;
  const y0 = 62 + rng.int(12);
  const R = 5;
  const cells = new Map<string, Cell>();
  const key = (gx: number, gz: number): string => gx + ',' + gz;
  const add = (gx: number, gz: number): Cell => {
    const c: Cell = { gx, gz, links: [false, false, false, false], kind: 'bridge' };
    cells.set(key(gx, gz), c);
    return c;
  };
  add(0, 0);
  const frontier: { c: Cell; dir: number }[] = [];
  for (let d = 0; d < 4; d++) frontier.push({ c: cells.get('0,0')!, dir: d });
  const target = 18 + rng.int(10);
  while (frontier.length && cells.size < target) {
    const i = rng.int(frontier.length);
    const { c, dir } = frontier.splice(i, 1)[0]!;
    const nx = c.gx + DX[dir]!;
    const nz = c.gz + DZ[dir]!;
    if (Math.abs(nx) > R || Math.abs(nz) > R || cells.has(key(nx, nz))) continue;
    const n = add(nx, nz);
    c.links[dir] = true;
    n.links[(dir + 2) & 3] = true;
    // Prefer to continue straight; sometimes branch
    frontier.push({ c: n, dir });
    if (rng.chance(0.35)) frontier.push({ c: n, dir: (dir + 1) & 3 });
    if (rng.chance(0.35)) frontier.push({ c: n, dir: (dir + 3) & 3 });
  }
  const list = [...cells.values()];
  for (const c of list) c.kind = Math.max(Math.abs(c.gx), Math.abs(c.gz)) <= 2 ? 'bridge' : 'corridor';
  // Dead ends become rooms: at least one blaze platform and one wart garden
  const leaves = list.filter((c) => c.links.filter(Boolean).length === 1 && (c.gx !== 0 || c.gz !== 0));
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [leaves[i], leaves[j]] = [leaves[j]!, leaves[i]!];
  }
  const rooms: CellKind[] = ['blaze', 'wart', 'treasure', 'blaze', 'treasure'];
  leaves.forEach((c, i) => {
    if (i < rooms.length) c.kind = rooms[i]!;
  });
  if (!list.some((c) => c.kind === 'blaze')) list[list.length - 1]!.kind = 'blaze';

  const ox = cx0 - 3;
  const oz = cz0 - 3;
  const pieces: Piece[] = [];
  const boxes: Box[] = [];
  const entities: NonNullable<Start['entities']> = [];
  const pseed = hashInts(seed, cx, cz, 0xf047);
  for (const c of list) {
    const x = ox + c.gx * CELL;
    const z = oz + c.gz * CELL;
    const box = boxOf(x, y0 - 1, z, x + CELL - 1, y0 + 6, z + CELL - 1);
    boxes.push(box);
    pieces.push({ box, build: (v) => buildCell(v, c, ox, y0, oz, pseed) });
    if (c.kind === 'blaze') entities.push({ type: 'blaze', x: x + 1.5, y: y0 + 1, z: z + 1.5 });
    else if (c.kind === 'corridor' && rng.chance(0.3)) entities.push({ type: 'wither_skeleton', x: x + 3.5, y: y0 + 1, z: z + 3.5 });
  }
  return { type: 'nether_fortress', x: cx0, y: y0, z: cz0, pieces, bounds: unionBoxes(boxes), entities };
}

export const FORTRESS: StructureType = {
  id: 'nether_fortress',
  spacing: SPACING,
  separation: SEPARATION,
  salt: SALT,
  radius: 4,
  candidate(ctx, x, z, rng) {
    return rng.next() < FORTRESS_SHARE && ctx.estimateBiome(x, z).dimension === 'nether';
  },
  plan(ctx, cx, cz, rng) {
    return planFortress(ctx.seed, cx, cz, rng);
  },
};

// ---------------------------------------------------------------------------
// Bastion remnant
// ---------------------------------------------------------------------------
const BW = 23;

function buildBastion(b: Builder, rng: Random, seed: number): void {
  const wall = (): number => weathered(rng, 'polished_blackstone_bricks', 'cracked_polished_blackstone_bricks', undefined, 0.25);
  const floorBlock = (): number => (rng.chance(0.15) ? S('blackstone') : S('polished_blackstone'));
  const gilded = S('gilded_blackstone');
  const H = 17;
  // Hollow the volume and lay a foundation under the whole footprint
  for (let z = 0; z < BW; z++)
    for (let x = 0; x < BW; x++) {
      for (let y = 1; y <= H + 4; y++) b.set(x, y, z, 0);
      b.set(x, 0, z, floorBlock());
      b.foundation(x, z, -1, S('blackstone'), 40);
    }
  // Outer walls with corner towers
  for (let y = 1; y <= H; y++)
    for (let i = 0; i < BW; i++) {
      for (const [x, z] of [
        [i, 0],
        [i, BW - 1],
        [0, i],
        [BW - 1, i],
      ] as const) {
        const window = y % 6 === 3 && i % 4 === 2 && i > 2 && i < BW - 3;
        b.set(x, y, z, window ? 0 : rng.chance(0.03) ? gilded : wall());
      }
    }
  for (const [tx, tz] of [
    [0, 0],
    [BW - 5, 0],
    [0, BW - 5],
    [BW - 5, BW - 5],
  ] as const) {
    for (let y = 1; y <= H + 4; y++)
      for (let z = tz; z < tz + 5; z++)
        for (let x = tx; x < tx + 5; x++) {
          const edge = x === tx || x === tx + 4 || z === tz || z === tz + 4;
          if (edge && !(y === H + 4 && (x + z) % 2 === 1)) b.set(x, y, z, wall());
        }
  }
  // Entrance on the south face
  for (let y = 1; y <= 4; y++) for (let x = 10; x <= 12; x++) b.set(x, y, BW - 1, 0);
  // Upper floors with an open atrium in the middle
  for (const fy of [6, 12]) {
    for (let z = 1; z < BW - 1; z++)
      for (let x = 1; x < BW - 1; x++) {
        const atrium = x >= 8 && x <= 14 && z >= 8 && z <= 14;
        if (!atrium) b.set(x, fy, z, floorBlock());
      }
    // Railing around the atrium
    for (let i = 7; i <= 15; i++)
      for (const [x, z] of [
        [i, 7],
        [i, 15],
        [7, i],
        [15, i],
      ] as const)
        b.set(x, fy + 1, z, stateOf('polished_blackstone_bricks_wall', {}));
  }
  // Staircases between floors (west wall up to floor 2, east wall up to floor 3)
  for (let i = 0; i < 6; i++) {
    b.set(2, 1 + i, 4 + i, S('polished_blackstone_bricks'));
    for (let y = 2 + i; y <= 5 + i; y++) if (y !== 6) b.set(2, y, 4 + i, 0);
    b.set(2, 6, 4 + i, 0);
    b.set(20, 7 + i, 4 + i, S('polished_blackstone_bricks'));
    for (let y = 8 + i; y <= 11 + i; y++) if (y !== 12) b.set(20, y, 4 + i, 0);
    b.set(20, 12, 4 + i, 0);
  }
  // Treasure: gold and magma around the ground-floor centre
  for (let z = 9; z <= 13; z++)
    for (let x = 9; x <= 13; x++) {
      const d = Math.max(Math.abs(x - 11), Math.abs(z - 11));
      if (d === 2) b.set(x, 1, z, rng.chance(0.3) ? S('magma_block') : wall());
      else if (d <= 1 && rng.chance(0.55)) b.set(x, 1, z, S('gold_block'));
    }
  b.chest(11, 2, 11, 'south', 'chest/bastion', hashInts(seed, 11, 2, 11, 0xba));
  // Chests on every floor
  b.chest(4, 1, 18, 'north', 'chest/bastion', hashInts(seed, 4, 1, 18));
  b.chest(18, 7, 18, 'west', 'chest/bastion', hashInts(seed, 18, 7, 18));
  b.chest(4, 13, 4, 'east', 'chest/bastion', hashInts(seed, 4, 13, 4));
  // Soul lanterns hanging in the atrium
  for (const [x, z] of [
    [8, 8],
    [14, 14],
  ] as const) {
    b.set(x, 17, z, S('chain'));
    b.set(x, 16, z, stateOf('soul_lantern', { hanging: true }));
  }
  // Roof over the tower rooms only; the keep stays open to the ceiling
  void seed;
}

export const BASTION: StructureType = {
  id: 'bastion',
  spacing: SPACING,
  separation: SEPARATION,
  salt: SALT,
  radius: 3,
  candidate(ctx, x, z, rng) {
    if (rng.next() < FORTRESS_SHARE) return false;
    const b = ctx.estimateBiome(x, z);
    return b.dimension === 'nether' && b.num !== biomeNum('basalt_deltas');
  },
  plan(ctx, cx, cz, rng) {
    const rot = rng.int(4) as Rotation;
    const x0 = (cx << 4) + rng.int(8) - 4;
    const z0 = (cz << 4) + rng.int(8) - 4;
    let y = ctx.groundY(x0 + (BW >> 1), z0 + (BW >> 1));
    if (y < 0) y = 40;
    y = Math.max(33, Math.min(92, y));
    const seed = hashInts(ctx.seed, x0, y, z0, 0xba57);
    const box = boxOf(x0, y - 40, z0, x0 + BW - 1, y + 22, z0 + BW - 1);
    const buildRng = (): Random => new Random(seed);
    const entities: NonNullable<Start['entities']> = [];
    const erng = new Random(seed ^ 0x9e);
    const local = (lx: number, lz: number): [number, number] => {
      const bld = new Builder(null as unknown as DecorView, x0, y, z0, rot, BW, BW);
      return [bld.wx(lx, lz) + 0.5, bld.wz(lx, lz) + 0.5];
    };
    const spots: [number, number, number, string][] = [
      [6, 1, 12, 'piglin'],
      [16, 1, 6, 'piglin'],
      [11, 1, 18, 'hoglin'],
      [5, 7, 17, 'piglin'],
      [17, 13, 5, 'piglin'],
    ];
    for (const [lx, ly, lz, type] of spots) {
      if (type === 'piglin' && erng.chance(0.2)) continue;
      const [wx, wz] = local(lx, lz);
      entities.push({ type, x: wx, y: y + ly, z: wz });
    }
    return {
      type: 'bastion',
      x: x0 + (BW >> 1),
      y,
      z: z0 + (BW >> 1),
      pieces: [{ box, build: (v) => buildBastion(new Builder(v, x0, y, z0, rot, BW, BW), buildRng(), seed) }],
      bounds: box,
      entities,
    };
  },
};

export const NETHER_STRUCTURES: StructureType[] = [FORTRESS, BASTION];
