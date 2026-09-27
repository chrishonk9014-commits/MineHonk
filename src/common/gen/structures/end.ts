/**
 * End cities: purpur towers on the outer End islands with a ladder shaft,
 * loot rooms guarded by shulkers, end rod lighting and sometimes an end
 * ship moored alongside whose hold always carries elytra.
 */
import { Random, hashInts } from '../../math/rng';
import { S, stateOf } from '../../registry/blocks';
import { Builder, type Rotation } from './builder';
import { boxOf, type Start, type StructureType } from './manager';
import type { DecorView } from '../decorate/view';

const TOWER = 11;
const SHIP_X = 14;
const SHIP_W = 7;
const SHIP_L = 15;
const FOOT_X = SHIP_X + SHIP_W;
const FOOT_Z = SHIP_L;

function buildCity(b: Builder, rng: Random, seed: number, floors: number, ship: boolean, shipY: number): void {
  const purpur = S('purpur_block');
  const pillar = stateOf('purpur_pillar', { axis: 'y' });
  const bricks = S('end_stone_bricks');
  const glass = S('magenta_stained_glass');
  const rod = (facing: string): number => stateOf('end_rod', { facing });
  // Base hall (11x11, 6 high)
  const room = (x0: number, y0: number, x1: number, z1: number, h: number, withDoor: boolean): void => {
    for (let y = y0; y <= y0 + h; y++)
      for (let z = x0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const edgeX = x === x0 || x === x1;
          const edgeZ = z === x0 || z === z1;
          if (y === y0) b.set(x, y, z, bricks);
          else if (y === y0 + h) b.set(x, y, z, purpur);
          else if (edgeX && edgeZ) b.set(x, y, z, pillar);
          else if (edgeX || edgeZ) {
            const mid = (x0 + x1) >> 1;
            const window = y === y0 + 2 && ((edgeZ && Math.abs(x - mid) === 2) || (edgeX && Math.abs(z - mid) === 2));
            b.set(x, y, z, window ? glass : purpur);
          } else b.set(x, y, z, 0);
        }
    if (withDoor) {
      const mid = (x0 + x1) >> 1;
      for (let y = y0 + 1; y <= y0 + 3; y++) for (let x = mid - 1; x <= mid + 1; x++) b.set(x, y, x1, 0);
    }
  };
  // Foundation into the island
  for (let z = 0; z < TOWER; z++) for (let x = 0; x < TOWER; x++) b.foundation(x, z, -1, bricks, 12);
  room(0, 0, TOWER - 1, TOWER - 1, 6, true);
  let y = 6;
  for (let f = 0; f < floors; f++) {
    room(2, y, 8, 8, 5, false);
    // Balcony rods at the corners
    for (const [x, z] of [
      [2, 2],
      [8, 2],
      [2, 8],
      [8, 8],
    ] as const)
      b.set(x, y + 6, z, rod('up'));
    if (f % 2 === 0) b.chest(6, y + 1, 6, 'west', 'chest/end_city', hashInts(seed, f, 0xc17));
    y += 5;
  }
  // Roof terrace with battlements
  for (let z = 1; z <= 9; z++)
    for (let x = 1; x <= 9; x++) {
      b.set(x, y, z, purpur);
      const edge = x === 1 || x === 9 || z === 1 || z === 9;
      if (edge) b.set(x, y + 1, z, (x + z) % 2 === 0 ? stateOf('purpur_block_slab', {}) : 0);
    }
  b.set(5, y + 1, 5, rod('up'));
  // Ladder shaft from the hall to the roof (with openings through each floor)
  for (let yy = 1; yy <= y; yy++) {
    b.set(4, yy, 2, purpur);
    b.set(4, yy, 3, stateOf('ladder', { facing: 'south' }));
  }
  b.chest(8, 1, 2, 'south', 'chest/end_city', hashInts(seed, 0x51, 0xc17));
  void rng;
  if (!ship) return;
  // End ship moored beside the tower
  const sy = shipY;
  const sx = SHIP_X;
  for (let z = 0; z < SHIP_L; z++) {
    const taper = z < 3 ? 3 - z : z > SHIP_L - 3 ? z - (SHIP_L - 3) : 0;
    for (let x = sx + taper; x < sx + SHIP_W - taper; x++) {
      const side = x === sx + taper || x === sx + SHIP_W - 1 - taper;
      b.set(x, sy, z, purpur);
      if (side) {
        b.set(x, sy + 1, z, purpur);
        b.set(x, sy + 2, z, stateOf('purpur_block_slab', {}));
      } else b.set(x, sy + 1, z, 0);
    }
    if (z > 1 && z < SHIP_L - 2) for (let x = sx + taper + 1; x < sx + SHIP_W - taper - 1; x++) b.set(x, sy - 1, z, purpur);
  }
  // Mast and sail
  const mx = sx + (SHIP_W >> 1);
  for (let h = 1; h <= 9; h++) b.set(mx, sy + h, 7, pillar);
  for (let h = 4; h <= 8; h++) for (let d = -2; d <= 2; d++) if (d !== 0) b.set(mx + d, sy + h, 7, S('black_wool'));
  b.set(mx, sy + 10, 7, rod('up'));
  // Hold with the elytra chest
  b.chest(mx, sy + 1, 11, 'north', 'chest/end_ship', hashInts(seed, 0x5419));
  b.set(mx, sy + 1, 3, S('brewing_stand'));
}

export const END_CITY: StructureType = {
  id: 'end_city',
  spacing: 20,
  separation: 11,
  salt: 0xe0dc17,
  radius: 3,
  candidate(ctx, x, z) {
    if (Math.hypot(x, z) < 1100) return false;
    const b = ctx.estimateBiome(x, z);
    return b.dimension === 'end' && (b.id === 'end_highlands' || b.id === 'end_midlands') && ctx.estimateHeight(x, z) >= 58;
  },
  plan(ctx, cx, cz, rng) {
    const rot = rng.int(4) as Rotation;
    const wx = rot & 1 ? FOOT_Z : FOOT_X;
    const wz = rot & 1 ? FOOT_X : FOOT_Z;
    const x0 = (cx << 4) + rng.int(4);
    const z0 = (cz << 4) + rng.int(4);
    const y = ctx.groundY(x0 + 5, z0 + 5) + 1;
    if (y < 50) return null;
    const floors = 2 + rng.int(3);
    const ship = rng.chance(0.55);
    const shipY = y + 6 + floors * 5 + 4;
    const seed = hashInts(ctx.seed, x0, y, z0, 0xe0dc);
    const box = boxOf(x0, y - 12, z0, x0 + wx - 1, shipY + 12, z0 + wz - 1);
    const entities: NonNullable<Start['entities']> = [];
    const local = new Builder(null as unknown as DecorView, x0, y, z0, rot, FOOT_X, FOOT_Z);
    const at = (lx: number, ly: number, lz: number): { x: number; y: number; z: number } => ({ x: local.wx(lx, lz) + 0.5, y: y + ly, z: local.wz(lx, lz) + 0.5 });
    entities.push({ type: 'shulker', ...at(1, 1, 1) });
    for (let f = 0; f < floors; f++) entities.push({ type: 'shulker', ...at(f % 2 ? 3 : 7, 7 + f * 5, 7) });
    if (ship) entities.push({ type: 'shulker', ...at(SHIP_X + 3, shipY - y + 1, 9) });
    return {
      type: 'end_city',
      x: x0 + (wx >> 1),
      y,
      z: z0 + (wz >> 1),
      pieces: [{ box, build: (v) => buildCity(new Builder(v, x0, y, z0, rot, FOOT_X, FOOT_Z), new Random(seed), seed, floors, ship, shipY - y) }],
      bounds: box,
      entities,
    };
  },
};
