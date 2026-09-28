/**
 * Ancient City (V2): a huge, rare ruin deep in the deep dark. The city stands
 * in its own vast domed cavern. At its heart rises the Hollow Gate, a
 * colossal archway framing nothing at all, with a sealed vault beneath its
 * dais. Around it lie districts of houses, towers, libraries, ice vaults and
 * collapsed ruins, all overgrown with sculk and wired with sensors and
 * shriekers: a place to sneak through, not to fight in.
 *
 * Pieces only write the part that lies inside the chunk being built; the
 * cavern piece loops over that chunk's columns alone so building a city
 * stays cheap however big it is.
 */
import { Random, hashInts } from '../../math/rng';
import { stateOf } from '../../registry/blocks';
import type { DecorView } from '../decorate/view';
import { Builder, S, type Rotation } from './builder';
import { boxOf, unionBoxes, type Box, type Piece, type StructureType } from './manager';

/** City floor height and cavern size. */
export const CITY_FLOOR = 12;
const CITY_RADIUS = 46;
const CITY_HEIGHT = 28;

const hashRoll = (seed: number, x: number, y: number, z: number, salt: number): number => (hashInts(seed, x, y, z, salt) >>> 0) % 1000;

// ------------------------------------------------------------------ the cavern

function buildCavern(v: DecorView, cx: number, cz: number, seed: number): void {
  const floor = CITY_FLOOR;
  const air = S('cave_air');
  const pave = [S('deepslate_tiles'), S('deepslate_bricks'), S('polished_deepslate'), S('cracked_deepslate_bricks')];
  const deepslate = S('deepslate');
  const sculk = S('sculk');
  const veinDown = stateOf('sculk_vein', { down: true });
  const sensor = S('sculk_sensor');
  const shrieker = stateOf('sculk_shrieker', { can_summon: true });
  const catalyst = S('sculk_catalyst');
  const x0 = Math.max(v.bx, cx - CITY_RADIUS - 2);
  const x1 = Math.min(v.bx + 15, cx + CITY_RADIUS + 2);
  const z0 = Math.max(v.bz, cz - CITY_RADIUS - 2);
  const z1 = Math.min(v.bz + 15, cz + CITY_RADIUS + 2);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const dx = x - cx;
      const dz = z - cz;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r > CITY_RADIUS + 2) continue;
      const t = r / CITY_RADIUS;
      // Dome: high in the middle, lower towards the rim, with a rough ceiling
      const roof = floor + 1 + Math.round(CITY_HEIGHT * Math.sqrt(Math.max(0, 1 - t * t)) + ((hashRoll(seed, x, 0, z, 0xd0) % 3) - 1));
      // Solid ground under the whole city: no lava or pits under the streets
      for (let y = 5; y < floor; y++) v.set(x, y, z, deepslate);
      if (r <= CITY_RADIUS) {
        const h = hashRoll(seed, x, floor, z, 0xf1);
        v.set(x, floor, z, r > CITY_RADIUS - 4 ? (h < 700 ? sculk : deepslate) : h < 180 ? sculk : pave[h % 4]!);
        for (let y = floor + 1; y <= roof; y++) v.set(x, y, z, air);
        // Sculk grows over the streets; sensors and shriekers listen
        const g = hashRoll(seed, x, floor + 1, z, 0x5c);
        if (r < CITY_RADIUS - 3) {
          if (g < 8) v.set(x, floor + 1, z, sensor);
          else if (g < 10) v.set(x, floor + 1, z, shrieker);
          else if (g < 11) v.set(x, floor, z, catalyst);
          else if (g < 90) v.set(x, floor + 1, z, veinDown);
        }
        // Rough, sculk-stained ceiling
        if (roof + 1 < 250 && hashRoll(seed, x, roof + 1, z, 0xce) < 350) v.set(x, roof + 1, z, sculk);
      } else {
        // The rim: a steep sculk-covered wall
        for (let y = floor; y <= floor + 3; y++) v.set(x, y, z, hashRoll(seed, x, y, z, 0x71) < 500 ? sculk : deepslate);
      }
    }
}

// ------------------------------------------------------------------ the Hollow Gate

/** The gate's footprint (local): 26 wide, 14 deep; the vault hides under the dais. */
const GATE_W = 26;
const GATE_D = 14;

function buildGate(b: Builder, seed: number): void {
  const tiles = S('deepslate_tiles');
  const bricks = S('deepslate_bricks');
  const chiseled = S('chiseled_deepslate');
  const polished = S('polished_deepslate');
  const reinforced = S('reinforced_deepslate');
  const air = S('cave_air');
  // Dais: three tiers
  for (let tier = 0; tier < 3; tier++) b.fill(tier, tier, tier, GATE_W - 1 - tier, tier, GATE_D - 1 - tier, tier === 2 ? tiles : polished);
  for (let x = 3; x < GATE_W - 3; x++) b.set(x, 1, 0, stateOf('deepslate_tiles_stairs', { facing: 'south' }));
  // Two colossal legs
  for (const lx of [3, GATE_W - 7])
    for (let y = 3; y < 19; y++)
      for (let z = 5; z < 9; z++)
        for (let x = lx; x < lx + 4; x++) {
          const band = y % 5 === 0;
          b.set(x, y, z, band ? chiseled : (x + y + z) % 7 === 0 ? tiles : bricks);
        }
  // Lintel and crown
  b.fill(3, 19, 5, GATE_W - 4, 21, 8, bricks);
  b.fill(3, 19, 5, GATE_W - 4, 19, 8, chiseled);
  for (let k = 0; k < 4; k++) b.fill(7 + k * 2, 22 + k, 6, GATE_W - 8 - k * 2, 22 + k, 7, k === 3 ? chiseled : tiles);
  // The frame: an unbreakable border around an empty opening
  for (let y = 3; y < 19; y++) {
    b.set(7, y, 6, reinforced);
    b.set(GATE_W - 8, y, 6, reinforced);
  }
  b.fill(7, 18, 6, GATE_W - 8, 18, 6, reinforced);
  b.fill(8, 3, 5, GATE_W - 9, 17, 8, air);
  // Sculk creeping up the frame
  for (let y = 3; y < 18; y++)
    for (const x of [8, GATE_W - 9]) if (hashRoll(seed, x, y, 0, 0x6a7e) < 300) b.set(x, y, 6, stateOf('sculk_vein', { [x === 8 ? 'west' : 'east']: true }));
  // Soul lights on chains either side
  for (const x of [1, GATE_W - 2]) {
    b.set(x, 3, 2, polished);
    b.set(x, 4, 2, stateOf('soul_lantern', { hanging: false }));
    b.set(x, 3, GATE_D - 3, polished);
    b.set(x, 4, GATE_D - 3, stateOf('soul_lantern', { hanging: false }));
  }
  // Candles left at the foot of the gate
  for (let x = 9; x < GATE_W - 9; x += 3) b.set(x, 3, 3, stateOf('candle', { candles: String(1 + (hashRoll(seed, x, 3, 3, 0xca) % 4)) }));
  // The sealed vault below the dais, entered by breaking the cracked tiles at the back
  b.box(9, -5, 4, GATE_W - 10, 0, 10, reinforced, air);
  b.fill(10, -4, 5, GATE_W - 11, -4, 9, polished);
  b.chest(GATE_W >> 1, -3, 7, 'south', 'chest/ancient_city_vault', hashInts(seed, b.wx(GATE_W >> 1, 7), b.oy - 3, b.wz(GATE_W >> 1, 7)));
  b.set((GATE_W >> 1) - 2, -3, 7, stateOf('soul_lantern', { hanging: false }));
  b.set((GATE_W >> 1) + 2, -3, 7, stateOf('soul_lantern', { hanging: false }));
  b.set(GATE_W >> 1, -1, 10, S('cracked_deepslate_bricks'));
  b.set(GATE_W >> 1, -2, 10, S('cracked_deepslate_bricks'));
  b.set(GATE_W >> 1, 0, 11, S('cracked_deepslate_bricks'));
  for (let y = -2; y <= 0; y++) b.set(GATE_W >> 1, y, 11, y === 0 ? S('cracked_deepslate_bricks') : air);
}

// ------------------------------------------------------------------ districts

type Kind = 'house' | 'tower' | 'ice' | 'library' | 'ruin' | 'bones';

function buildHouse(b: Builder, rng: Random, seed: number): void {
  const bricks = S('deepslate_bricks');
  b.box(0, 0, 0, 6, 5, 6, bricks, S('cave_air'));
  b.fill(1, 0, 1, 5, 0, 5, S('deepslate_tiles'));
  b.fill(1, 5, 1, 5, 5, 5, S('dark_oak_planks'));
  b.fill(0, 6, 0, 6, 6, 6, S('deepslate_tiles_slab'));
  b.fill(3, 1, 0, 3, 2, 0, S('cave_air'));
  for (let z = 1; z < 6; z++) for (let x = 1; x < 6; x++) if (rng.chance(0.6)) b.set(x, 1, z, S('gray_carpet'));
  b.set(1, 1, 5, stateOf('candle', { candles: String(1 + rng.int(4)) }));
  if (rng.chance(0.55)) b.chest(5, 1, 5, 'north', 'chest/ancient_city', lootSeed(b, 5, 1, 5, seed));
  if (rng.chance(0.4)) b.set(1, 1, 1, S('sculk_sensor'));
  for (let i = 0; i < 4; i++) b.set(rng.int(7), 1 + rng.int(5), rng.chance(0.5) ? 0 : 6, S('cracked_deepslate_bricks'));
}

function buildTower(b: Builder, rng: Random, seed: number): void {
  const h = 10 + rng.int(6);
  b.box(0, 0, 0, 4, h, 4, S('deepslate_bricks'), S('cave_air'));
  for (let y = 3; y < h; y += 4) {
    b.set(2, y, 0, S('cave_air'));
    b.set(4, y, 2, S('cave_air'));
  }
  b.fill(2, 1, 0, 2, 2, 0, S('cave_air'));
  for (let y = 1; y < h; y++) b.set(1, y, 3, stateOf('ladder', { facing: 'north' }));
  b.fill(0, h + 1, 0, 4, h + 1, 4, S('polished_deepslate'));
  b.set(2, h + 2, 2, stateOf('soul_lantern', { hanging: false }));
  for (const [x, z] of [
    [0, 0],
    [4, 0],
    [0, 4],
    [4, 4],
  ] as const)
    b.set(x, h + 2, z, S('deepslate_bricks_wall'));
  if (rng.chance(0.5)) b.chest(3, 1, 1, 'west', 'chest/ancient_city', lootSeed(b, 3, 1, 1, seed));
}

function buildIceVault(b: Builder, rng: Random, seed: number): void {
  b.box(0, 0, 0, 6, 4, 6, S('polished_deepslate'), S('cave_air'));
  b.fill(1, 1, 1, 5, 3, 5, S('packed_ice'));
  b.fill(2, 1, 2, 4, 2, 4, S('cave_air'));
  b.fill(2, 1, 1, 4, 2, 1, S('cave_air'));
  b.fill(3, 1, 0, 3, 2, 0, S('cave_air'));
  b.set(3, 3, 3, S('blue_ice'));
  b.chest(3, 1, 4, 'north', 'chest/ancient_city_ice', lootSeed(b, 3, 1, 4, seed));
  if (rng.chance(0.5)) b.set(2, 1, 4, S('snow_block'));
}

function buildLibrary(b: Builder, rng: Random, seed: number): void {
  b.box(0, 0, 0, 8, 5, 6, S('deepslate_tiles'), S('cave_air'));
  b.fill(4, 1, 0, 4, 2, 0, S('cave_air'));
  for (let x = 1; x < 8; x++) {
    if (x === 4) continue;
    for (let y = 1; y < 4; y++) b.set(x, y, 5, rng.chance(0.8) ? S('bookshelf') : S('cave_air'));
  }
  b.set(2, 1, 2, S('gray_wool'));
  b.set(6, 1, 2, S('gray_wool'));
  b.set(4, 1, 3, stateOf('candle', { candles: '4' }));
  if (rng.chance(0.7)) b.chest(1, 1, 1, 'east', 'chest/ancient_city', lootSeed(b, 1, 1, 1, seed));
}

function buildRuin(b: Builder, rng: Random, seed: number): void {
  for (let i = 0; i < 9; i++)
    for (const [x, z] of [
      [i, 0],
      [0, i],
      [8, i],
    ] as const) {
      const h = rng.int(4);
      for (let y = 0; y < h; y++) b.set(x, y + 1, z, rng.chance(0.3) ? S('cracked_deepslate_bricks') : S('deepslate_bricks'));
    }
  for (let i = 0; i < 12; i++) b.set(1 + rng.int(7), 1, 1 + rng.int(7), rng.chance(0.5) ? S('cobbled_deepslate') : S('sculk'));
  if (rng.chance(0.3)) b.chest(4, 1, 4, 'south', 'chest/ancient_city', lootSeed(b, 4, 1, 4, seed));
}

/** A heap of bones by a shrieker: whoever set it off never left. */
function buildBones(b: Builder, rng: Random): void {
  b.set(2, 1, 2, stateOf('sculk_shrieker', { can_summon: true }));
  for (let i = 0; i < 6; i++) b.set(rng.int(5), 1, rng.int(5), S('bone_block'));
  b.set(1, 1, 3, S('sculk_sensor'));
  b.set(3, 1, 1, S('sculk_sensor'));
}

const lootSeed = (b: Builder, x: number, y: number, z: number, seed: number): number => hashInts(seed, b.wx(x, z), b.oy + y, b.wz(x, z));

const KIND_SIZE: Record<Kind, [number, number, number]> = {
  house: [7, 7, 8],
  tower: [5, 5, 20],
  ice: [7, 7, 6],
  library: [9, 7, 7],
  ruin: [9, 9, 5],
  bones: [5, 5, 3],
};

function buildKind(kind: Kind, b: Builder, rng: Random, seed: number): void {
  switch (kind) {
    case 'house':
      return buildHouse(b, rng, seed);
    case 'tower':
      return buildTower(b, rng, seed);
    case 'ice':
      return buildIceVault(b, rng, seed);
    case 'library':
      return buildLibrary(b, rng, seed);
    case 'ruin':
      return buildRuin(b, rng, seed);
    case 'bones':
      return buildBones(b, rng);
  }
}

// ------------------------------------------------------------------ the structure type

export const ANCIENT_CITY: StructureType = {
  id: 'ancient_city',
  spacing: 26,
  separation: 8,
  salt: 0xa7c17,
  radius: 4,
  candidate(ctx, x, z) {
    // Only under solid, high enough ground, and only where the deep dark lies
    if ((ctx.deepDark?.(x, z) ?? -1) < 0.3) return false;
    const r = CITY_RADIUS;
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const)
      if (ctx.estimateHeight(x + dx, z + dz) < CITY_FLOOR + CITY_HEIGHT + 22) return false;
    return ctx.estimateBiome(x, z).dimension === 'overworld';
  },
  plan(ctx, cx, cz, rng) {
    const x = (cx << 4) + 8;
    const z = (cz << 4) + 8;
    const seed = hashInts(ctx.seed, x, CITY_FLOOR, z, 0xa7c17);
    const floor = CITY_FLOOR;
    const pieces: Piece[] = [];
    const cavernBox = boxOf(x - CITY_RADIUS - 2, 5, z - CITY_RADIUS - 2, x + CITY_RADIUS + 2, floor + CITY_HEIGHT + 3, z + CITY_RADIUS + 2);
    pieces.push({ box: cavernBox, build: (v) => buildCavern(v, x, z, seed) });
    // The gate in the middle, rotated to one of four facings
    const rot = rng.int(4) as Rotation;
    const gw = rot & 1 ? GATE_D : GATE_W;
    const gd = rot & 1 ? GATE_W : GATE_D;
    const gx = x - (gw >> 1);
    const gz = z - (gd >> 1);
    const gateBox = boxOf(gx, floor - 5, gz, gx + gw - 1, floor + 27, gz + gd - 1);
    pieces.push({ box: gateBox, build: (v) => buildGate(new Builder(v, gx, floor + 1, gz, rot, GATE_W, GATE_D), seed) });
    // Districts on a grid of plots around the gate
    const kinds: Kind[] = ['house', 'house', 'house', 'tower', 'ice', 'library', 'ruin', 'ruin', 'bones'];
    const taken: Box[] = [gateBox];
    const plot = 12;
    for (let px = -3; px <= 3; px++)
      for (let pz = -3; pz <= 3; pz++) {
        const ox = x + px * plot - 4 + rng.int(3);
        const oz = z + pz * plot - 4 + rng.int(3);
        const dist = Math.hypot(ox + 4 - x, oz + 4 - z);
        const kind = kinds[rng.int(kinds.length)]!;
        const keep = rng.chance(0.72);
        if (!keep || dist > CITY_RADIUS - 10) continue;
        const [sx, sz, h] = KIND_SIZE[kind];
        const r = rng.int(4) as Rotation;
        const wsx = r & 1 ? sz : sx;
        const wsz = r & 1 ? sx : sz;
        const box = boxOf(ox, floor, oz, ox + wsx - 1, floor + h + 2, oz + wsz - 1);
        if (taken.some((t) => box.x0 <= t.x1 + 1 && box.x1 >= t.x0 - 1 && box.z0 <= t.z1 + 1 && box.z1 >= t.z0 - 1)) continue;
        taken.push(box);
        const pseed = hashInts(seed, ox, oz, 0xb1d);
        pieces.push({ box, build: (v) => buildKind(kind, new Builder(v, ox, floor, oz, r, sx, sz), new Random(pseed), pseed) });
      }
    // Pieces are built in order: the cavern first, buildings on top of it
    return { type: 'ancient_city', x, y: floor + 1, z, pieces, bounds: unionBoxes(pieces.map((p) => p.box)) };
  },
};
