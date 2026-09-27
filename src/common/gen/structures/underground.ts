/**
 * Underground structures: abandoned mineshafts and strongholds. Both are
 * planned as a network of box pieces grown by a seeded random walk; pieces
 * never overlap (checked against the pieces already placed).
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf, STATE_SOLID, STATE_FLUID } from '../../registry/blocks';
import type { DecorView } from '../decorate/view';
import { Builder, weathered } from './builder';
import { boxOf, unionBoxes, type Box, type StructureType, type Start, type Piece } from './manager';

function overlaps(a: Box, list: Box[]): boolean {
  for (const b of list) if (a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0) return true;
  return false;
}

/** Direction helpers: 0 north(-z) 1 east(+x) 2 south(+z) 3 west(-x) */
const DX = [0, 1, 0, -1];
const DZ = [-1, 0, 1, 0];

// ---------------------------------------------------------------------------
// Mineshaft
// ---------------------------------------------------------------------------
interface Corridor {
  box: Box;
  dir: number;
}

function buildCorridor(v: DecorView, c: Corridor, seed: number): void {
  const planks = S('oak_planks');
  const fence = S('oak_fence');
  const { box, dir } = c;
  const alongX = dir === 1 || dir === 3;
  const len = alongX ? box.x1 - box.x0 + 1 : box.z1 - box.z0 + 1;
  for (let i = 0; i < len; i++) {
    for (let w = 0; w < 3; w++) {
      const x = alongX ? box.x0 + i : box.x0 + w;
      const z = alongX ? box.z0 + w : box.z0 + i;
      if (!v.inside(x, z)) continue;
      const floorY = box.y0;
      // Floor (bridge over caves)
      const below = v.get(x, floorY - 1, z);
      if (!STATE_SOLID[below] || STATE_FLUID[below]) {
        if (hashInts(seed, x, floorY, z) % 10 < 8) v.set(x, floorY - 1, z, planks);
      }
      for (let y = floorY; y < floorY + 3; y++) {
        const s = v.get(x, y, z);
        if (STATE_FLUID[s]) continue;
        v.set(x, y, z, S('cave_air'));
      }
      const h = hashInts(seed, x, floorY, z, 0x3c);
      // Supports every 4 blocks
      if (i % 4 === 2) {
        if (w !== 1) {
          v.set(x, floorY, z, fence);
          v.set(x, floorY + 1, z, fence);
        }
        v.set(x, floorY + 2, z, planks);
        if (w === 0 && h % 5 === 0) v.set(x, floorY + 1, z, 0);
      } else {
        if (h % 23 === 0) v.set(x, floorY + 2, z, S('cobweb'));
        if (w === 1 && i % 4 === 0 && h % 11 === 0) v.set(x, floorY, z, S('cobweb'));
      }
      if (i % 8 === 2 && w === 1) v.set(x, floorY + 1, z + (alongX ? 0 : 0), S('torch'));
    }
  }
  // Loot: a chest in some corridors
  const h = hashInts(seed, box.x0, box.y0, box.z0, 0xc1);
  if (h % 5 === 0) {
    const i = 1 + (h >> 4) % Math.max(1, len - 2);
    const x = alongX ? box.x0 + i : box.x0;
    const z = alongX ? box.z0 : box.z0 + i;
    if (v.inside(x, z) && (i % 4) !== 2) {
      v.set(x, box.y0, z, stateOf('chest', { facing: alongX ? 'south' : 'east' }));
      v.setBlockEntity(x, box.y0, z, { type: 'chest', loot: 'chest/mineshaft', lootSeed: hashInts(seed, x, box.y0, z) });
    }
  }
  if (h % 37 === 1) {
    const x = alongX ? box.x0 + (len >> 1) : box.x0 + 1;
    const z = alongX ? box.z0 + 1 : box.z0 + (len >> 1);
    if (v.inside(x, z)) {
      v.set(x, box.y0, z, S('spawner'));
      v.setBlockEntity(x, box.y0, z, { type: 'spawner', mob: 'cave_spider', delay: 20 });
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (v.get(x + dx, box.y0 + 1, z + dz) === S('cave_air') && hashInts(seed, dx, dz, x) % 3 === 0) v.set(x + dx, box.y0 + 1, z + dz, S('cobweb'));
    }
  }
}

function buildRoom(v: DecorView, box: Box): void {
  for (let x = box.x0; x <= box.x1; x++)
    for (let z = box.z0; z <= box.z1; z++) {
      if (!v.inside(x, z)) continue;
      v.set(x, box.y0 - 1, z, S('dirt'));
      for (let y = box.y0; y <= box.y1; y++) if (!STATE_FLUID[v.get(x, y, z)]) v.set(x, y, z, S('cave_air'));
    }
}

export const MINESHAFT: StructureType = {
  id: 'mineshaft',
  spacing: 12,
  separation: 2,
  salt: 0x3144,
  radius: 5,
  candidate(ctx, x, z, rng) {
    return rng.chance(0.35) && ctx.estimateBiome(x, z).dimension === 'overworld';
  },
  plan(ctx, cx, cz, rng) {
    const x = (cx << 4) + rng.int(16);
    const z = (cz << 4) + rng.int(16);
    const ground = ctx.groundY(x, z);
    const y = 12 + rng.int(Math.max(1, Math.min(40, ground - 20)));
    const seed = hashInts(ctx.seed, x, y, z, 0x3144);
    const room = boxOf(x - 4, y, z - 4, x + 4, y + 4, z + 4);
    const boxes: Box[] = [room];
    const pieces: Piece[] = [{ box: boxOf(room.x0, room.y0 - 1, room.z0, room.x1, room.y1, room.z1), build: (v) => buildRoom(v, room) }];
    const maxR = 64;
    const open: { x: number; y: number; z: number; dir: number; depth: number }[] = [];
    for (let d = 0; d < 4; d++) open.push({ x: x + DX[d]! * 5 - (DX[d] === 0 ? 1 : 0), y, z: z + DZ[d]! * 5 - (DZ[d] === 0 ? 1 : 0), dir: d, depth: 0 });
    let count = 0;
    while (open.length && count < 36) {
      const o = open.splice(rng.int(open.length), 1)[0]!;
      if (o.depth > 6) continue;
      const len = 8 + rng.int(4) * 4;
      const alongX = o.dir === 1 || o.dir === 3;
      const sx = o.x;
      const sz = o.z;
      const ex = sx + DX[o.dir]! * (len - 1);
      const ez = sz + DZ[o.dir]! * (len - 1);
      const box = alongX ? boxOf(sx, o.y, sz, ex, o.y + 2, sz + 2) : boxOf(sx, o.y, sz, sx + 2, o.y + 2, ez);
      if (Math.abs(box.x0 - x) > maxR || Math.abs(box.z0 - z) > maxR || Math.abs(box.x1 - x) > maxR || Math.abs(box.z1 - z) > maxR) continue;
      if (overlaps(box, boxes)) continue;
      // Skip corridors that would open into the sky or oceans (pure terrain check)
      const mx = (box.x0 + box.x1) >> 1;
      const mz = (box.z0 + box.z1) >> 1;
      if (ctx.groundY(mx, mz) < o.y + 8) continue;
      boxes.push(box);
      const corr: Corridor = { box, dir: o.dir };
      pieces.push({ box: boxOf(box.x0, box.y0 - 1, box.z0, box.x1, box.y1, box.z1), build: (v) => buildCorridor(v, corr, seed) });
      count++;
      // Continue straight, or branch left/right at the end
      const endX = alongX ? ex + DX[o.dir]! : sx;
      const endZ = alongX ? sz : ez + DZ[o.dir]!;
      if (rng.chance(0.7)) open.push({ x: endX, y: o.y, z: endZ, dir: o.dir, depth: o.depth + 1 });
      if (rng.chance(0.45)) {
        const nd = (o.dir + 1) & 3;
        open.push({ x: alongX ? ex - 1 - (nd === 3 ? 0 : 0) : sx + (nd === 1 ? 3 : -1), y: o.y, z: alongX ? (nd === 2 ? sz + 3 : sz - 1) : ez - 1, dir: nd, depth: o.depth + 1 });
      }
      if (rng.chance(0.45)) {
        const nd = (o.dir + 3) & 3;
        open.push({ x: alongX ? ex - 1 : sx + (nd === 1 ? 3 : -1), y: o.y, z: alongX ? (nd === 2 ? sz + 3 : sz - 1) : ez - 1, dir: nd, depth: o.depth + 1 });
      }
    }
    if (count < 4) return null;
    return { type: 'mineshaft', x, y, z, pieces, bounds: unionBoxes(pieces.map((p) => p.box)) };
  },
};

// ---------------------------------------------------------------------------
// Stronghold
// ---------------------------------------------------------------------------
type RoomKind = 'entrance' | 'corridor' | 'crossing' | 'library' | 'storage' | 'fountain' | 'portal' | 'prison';

interface Room {
  kind: RoomKind;
  box: Box;
  gx: number;
  gz: number;
  doors: number[];
}

const CELL = 12;

function brick(rng: Random): number {
  return weathered(rng, 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 0.35);
}

function buildStrongholdRoom(v: DecorView, r: Room, seed: number): void {
  const b = new Builder(v, r.box.x0, r.box.y0, r.box.z0, 0, CELL, CELL);
  const rng = new Random(hashInts(seed, r.box.x0, r.box.y0, r.box.z0));
  const h = r.box.y1 - r.box.y0;
  // Shell (skip where the shell would float in open caves is fine: strongholds are self-contained)
  for (let y = 0; y <= h; y++)
    for (let z = 0; z < CELL; z++)
      for (let x = 0; x < CELL; x++) {
        const edge = x === 0 || x === CELL - 1 || z === 0 || z === CELL - 1 || y === 0 || y === h;
        b.set(x, y, z, edge ? brick(rng) : S('cave_air'));
      }
  // Doorways towards connected neighbours (centre of each wall)
  for (const d of r.doors) {
    const cx = d === 1 ? CELL - 1 : d === 3 ? 0 : CELL / 2;
    const cz = d === 0 ? 0 : d === 2 ? CELL - 1 : CELL / 2;
    for (let y = 1; y <= 3; y++)
      for (let w = -1; w <= 0; w++) {
        const x = d === 0 || d === 2 ? cx + w : cx;
        const z = d === 1 || d === 3 ? cz + w : cz;
        b.set(x, y, z, S('cave_air'));
      }
    if (rng.chance(0.3) && r.kind !== 'portal') {
      const x = d === 0 || d === 2 ? cx - 1 : cx;
      const z = d === 1 || d === 3 ? cz - 1 : cz;
      const facing = d === 0 ? 'north' : d === 1 ? 'east' : d === 2 ? 'south' : 'west';
      b.set(x, 1, z, stateOf('iron_door', { facing, half: 'lower' }));
      b.set(x, 2, z, stateOf('iron_door', { facing, half: 'upper' }));
    }
  }
  const mid = CELL / 2;
  switch (r.kind) {
    case 'entrance':
      // Spiral staircase column hint and a torch
      b.fill(mid - 1, 1, mid - 1, mid, h - 1, mid, S('stone_bricks'));
      b.set(mid - 2, 2, mid, stateOf('wall_torch', { facing: 'west' }));
      break;
    case 'crossing':
      for (const [x, z] of [
        [3, 3],
        [8, 3],
        [3, 8],
        [8, 8],
      ] as const)
        b.fill(x, 1, z, x, h - 1, z, S('chiseled_stone_bricks'));
      b.set(mid, h - 1, mid, stateOf('lantern', { hanging: true }));
      break;
    case 'library': {
      for (let x = 1; x < CELL - 1; x++)
        for (let y = 1; y < h; y++) {
          b.set(x, y, 1, S('bookshelf'));
          b.set(x, y, CELL - 2, S('bookshelf'));
        }
      for (let z = 3; z < CELL - 3; z += 2) for (let y = 1; y <= 3; y++) {
        b.set(3, y, z, S('bookshelf'));
        b.set(CELL - 4, y, z, S('bookshelf'));
      }
      for (let i = 0; i < 6; i++) b.set(1 + rng.int(CELL - 2), 1 + rng.int(h - 1), 2 + rng.int(CELL - 4), S('cobweb'));
      b.chest(mid, 1, CELL - 3, 'north', 'chest/stronghold_library', hashInts(seed, b.wx(mid, CELL - 3), b.oy + 1, b.wz(mid, CELL - 3)));
      b.set(mid, 4, mid, stateOf('lantern', { hanging: true }));
      break;
    }
    case 'storage':
      b.chest(2, 1, 2, 'south', 'chest/stronghold_corridor', hashInts(seed, b.wx(2, 2), b.oy + 1, b.wz(2, 2)));
      b.chest(CELL - 3, 1, CELL - 3, 'north', 'chest/stronghold_corridor', hashInts(seed, b.wx(CELL - 3, CELL - 3), b.oy + 1, b.wz(CELL - 3, CELL - 3)));
      b.set(mid, 1, mid, S('crafting_table'));
      b.set(mid, 3, 1, stateOf('wall_torch', { facing: 'south' }));
      break;
    case 'fountain':
      b.fill(3, 0, 3, 8, 0, 8, S('smooth_stone'));
      b.fill(4, 1, 4, 7, 1, 7, S('stone_bricks'));
      b.fill(5, 1, 5, 6, 1, 6, S('water'));
      b.fill(5, 2, 5, 6, 3, 6, S('stone_bricks_wall'));
      b.set(5, 4, 5, S('water'));
      break;
    case 'prison':
      for (let x = 2; x < CELL - 2; x++) for (let y = 1; y <= 3; y++) b.set(x, y, 5, x % 3 === 0 ? S('stone_bricks') : S('iron_bars'));
      b.set(mid, 1, 5, stateOf('iron_door', { facing: 'south', half: 'lower' }));
      b.set(mid, 2, 5, stateOf('iron_door', { facing: 'south', half: 'upper' }));
      break;
    case 'portal': {
      // A 3x3 portal opening (x/z 5..7, y 2) ringed by 12 frames over a lava pool
      b.fill(3, 0, 3, 9, 0, 9, S('stone_bricks'));
      b.fill(4, 1, 4, 8, 1, 8, S('stone_bricks'));
      b.fill(5, 1, 5, 7, 1, 7, S('lava'));
      const eyes = rng.int(4);
      let placed = 0;
      const frame = (x: number, z: number, facing: string): void => {
        const eye = placed < eyes && rng.chance(0.3);
        if (eye) placed++;
        b.set(x, 2, z, stateOf('end_portal_frame', { facing, eye }));
      };
      for (let i = 5; i <= 7; i++) {
        frame(i, 4, 'south');
        frame(i, 8, 'north');
        frame(4, i, 'east');
        frame(8, i, 'west');
      }
      // Stairs up to the platform and a silverfish spawner
      b.fill(5, 1, 2, 7, 1, 3, stateOf('stone_bricks_stairs', { facing: 'south' }));
      b.spawner(mid, 1, CELL - 2, 'silverfish');
      b.set(1, 3, 1, stateOf('wall_torch', { facing: 'south' }));
      b.set(CELL - 2, 3, 1, stateOf('wall_torch', { facing: 'south' }));
      break;
    }
    default:
      b.set(mid, 3, 1, stateOf('wall_torch', { facing: 'south' }));
  }
}

/** Stronghold starts on concentric rings around the world origin. */
function strongholdPositions(seed: number): [number, number][] {
  const rng = new Random(hashInts(seed, 0x5708, 0x9));
  const out: [number, number][] = [];
  const rings = [
    { n: 3, min: 600, max: 1100 },
    { n: 6, min: 1800, max: 2600 },
    { n: 10, min: 3200, max: 4200 },
    { n: 15, min: 4800, max: 5800 },
  ];
  for (const r of rings) {
    const a0 = rng.next() * Math.PI * 2;
    for (let i = 0; i < r.n; i++) {
      const a = a0 + (i / r.n) * Math.PI * 2 + (rng.next() - 0.5) * 0.3;
      const d = r.min + rng.next() * (r.max - r.min);
      out.push([Math.round((Math.cos(a) * d) / 16), Math.round((Math.sin(a) * d) / 16)]);
    }
  }
  return out;
}

export const STRONGHOLD: StructureType = {
  id: 'stronghold',
  spacing: 1,
  separation: 0,
  salt: 0x5708,
  radius: 6,
  fixed: strongholdPositions,
  candidate: () => true,
  plan(ctx, cx, cz, rng) {
    const x0 = (cx << 4) + 2;
    const z0 = (cz << 4) + 2;
    const ground = ctx.groundY(x0, z0);
    const y = Math.max(10, Math.min(40, ground - 30));
    const seed = hashInts(ctx.seed, cx, cz, 0x5708);
    const rooms = new Map<string, Room>();
    const key = (gx: number, gz: number): string => gx + ',' + gz;
    const kinds: RoomKind[] = ['corridor', 'corridor', 'crossing', 'library', 'storage', 'fountain', 'prison', 'corridor', 'crossing'];
    const add = (gx: number, gz: number, kind: RoomKind): Room => {
      const r: Room = { kind, gx, gz, doors: [], box: boxOf(x0 + gx * CELL, y, z0 + gz * CELL, x0 + gx * CELL + CELL - 1, y + (kind === 'library' ? 7 : kind === 'portal' ? 7 : 5), z0 + gz * CELL + CELL - 1) };
      rooms.set(key(gx, gz), r);
      return r;
    };
    const start = add(0, 0, 'entrance');
    const frontier: Room[] = [start];
    const maxRooms = 14 + rng.int(8);
    while (frontier.length && rooms.size < maxRooms) {
      const r = frontier[rng.int(frontier.length)]!;
      const d = rng.int(4);
      const gx = r.gx + DX[d]!;
      const gz = r.gz + DZ[d]!;
      if (Math.abs(gx) > 4 || Math.abs(gz) > 4 || rooms.has(key(gx, gz))) {
        if (rng.chance(0.2)) frontier.splice(frontier.indexOf(r), 1);
        continue;
      }
      const n = add(gx, gz, kinds[rng.int(kinds.length)]!);
      r.doors.push(d);
      n.doors.push((d + 2) & 3);
      frontier.push(n);
    }
    // The room farthest from the entrance becomes the portal room
    let far: Room = start;
    for (const r of rooms.values()) if (Math.abs(r.gx) + Math.abs(r.gz) > Math.abs(far.gx) + Math.abs(far.gz)) far = r;
    if (far === start) {
      const n = add(1, 0, 'portal');
      start.doors.push(1);
      n.doors.push(3);
      far = n;
    }
    far.kind = 'portal';
    far.box = { ...far.box, y1: far.box.y0 + 7 };
    // Entrance shaft up towards the surface is not dug (strongholds are found with Eyes of Ender)
    const pieces: Piece[] = [...rooms.values()].map((r) => ({ box: r.box, build: (v: DecorView) => buildStrongholdRoom(v, r, seed) }));
    const portal = far;
    const start2: Start = {
      type: 'stronghold',
      x: portal.box.x0 + CELL / 2,
      y: portal.box.y0 + 2,
      z: portal.box.z0 + CELL / 2,
      pieces,
      bounds: unionBoxes(pieces.map((p) => p.box)),
    };
    return start2;
  },
};
