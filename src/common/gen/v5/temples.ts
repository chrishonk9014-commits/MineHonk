/**
 * Generator 5 temples. Each temple has three chambers, each holding one
 * trial (awaken the altars, bring back the relic, light the braziers, set
 * the levers to the glyphs, or fight off waves of guardians). Clearing a
 * trial breaks the seal into the next chamber; the third opens the way up
 * to the arena on the roof, where the Champion's Trial decides who takes the
 * temple's prize: alone you fight the temple's champion, with others it is
 * a duel and the last one standing wins.
 *
 * The jungle temple is rebuilt this way, and there are new temples for the
 * snowy lands, swamps, badlands, forests and mountains, plus the desert
 * pyramid (the old desert temple stays as it was). Everything is authored
 * facing north (the door on the z = 0 side); the Builder rotates it.
 */
import type { Random } from '../../math/rng';
import { S, stateOf } from '../../registry/blocks';
import type { Biome } from '../../registry/biomes';
import { Builder, weathered, rotateFacing } from '../structures/builder';
import { single, lootSeed } from '../structures/misc';
import type { StructureType, TempleMission, TempleQuest, TempleSeal } from '../structures/manager';
import { at, localBox } from './common';

type MissionType = TempleMission['type'];

interface Champion {
  mob: string;
  name: string;
  hp: number;
  dmg: number;
}

export interface TempleStyle {
  id: string;
  name: string;
  biome: (b: Biome) => boolean;
  spacing: number;
  salt: number;
  /** How uneven the ground may be (default 7). */
  maxSlope?: number;
  wall: (rng: Random, y: number) => number;
  floor: (x: number, z: number) => number;
  roof: number;
  trim: number;
  glyph: number;
  pillar: number;
  foundation: string;
  stairs: string;
  lamp: string;
  /** Four candidate trials; three are used, always including the guardians. */
  missions: MissionType[];
  guardian: { mob: string; name: string };
  champion: Champion;
  /** Loot of the treasure chests in the last chamber. */
  loot: string;
  ornament: (b: Builder, rng: Random) => void;
}

// ---------------------------------------------------------------------------
// The plan: which trials, in which order (derived first from the seed)
// ---------------------------------------------------------------------------
export interface TemplePlan {
  missions: MissionType[];
  /** Levers: which must be on, per chamber. */
  glyphs: boolean[];
  waves: number;
}

function plan(rng: Random, pool: MissionType[]): TemplePlan {
  const others = pool.filter((m) => m !== 'guardians');
  others.splice(rng.int(others.length), 1);
  const missions: MissionType[] = [...others.slice(0, 2)];
  missions.splice(rng.int(3), 0, 'guardians');
  // Never start with the fight: the first chamber is where you arrive
  if (missions[0] === 'guardians') [missions[0], missions[1]] = [missions[1]!, missions[0]!];
  const glyphs = [rng.chance(0.5), rng.chance(0.5), rng.chance(0.5), rng.chance(0.5)];
  if (!glyphs.some(Boolean)) glyphs[rng.int(4)] = true;
  return { missions, glyphs, waves: 2 + rng.int(2) };
}

// ---------------------------------------------------------------------------
// The shared three-chamber temple (23 x 27)
// ---------------------------------------------------------------------------
const TW = 23;
const TD = 27;
/** The chambers: interior x 1..21, y 1..5, these z ranges. */
const ROOMS = [
  { z0: 1, z1: 8 },
  { z0: 10, z1: 17 },
  { z0: 19, z1: 25 },
];
const WALLS_Z = [0, 9, 18, 26];
const LEVER_XS = [4, 7, 15, 18];

const altarSpots = (r: number): [number, number][] => {
  const { z0, z1 } = ROOMS[r]!;
  return [
    [4, z0 + 1],
    [18, z0 + 1],
    [4, z1 - 1],
    [18, z1 - 1],
  ];
};
const midZ = (r: number): number => (ROOMS[r]!.z0 + ROOMS[r]!.z1) >> 1;
const guardSpots = (r: number): [number, number][] => {
  const { z0, z1 } = ROOMS[r]!;
  const m = midZ(r);
  return [
    [6, m],
    [16, m],
    [11, z0 + 1],
    [11, z1 - 1],
    [3, m],
    [17, m - 1],
  ];
};

/** Everything about a mission that the build and the quest both need, in local coordinates. */
function missionSpec(b: Builder, r: number, type: MissionType, p: TemplePlan, st: TempleStyle): TempleMission {
  const { z0, z1 } = ROOMS[r]!;
  const room = localBox(b, 1, 1, z0, 21, 5, z1);
  switch (type) {
    case 'altars':
      return { type, altars: altarSpots(r).map(([x, z]) => at(b, x, 1, z)), room };
    case 'braziers':
      return { type, braziers: altarSpots(r).map(([x, z]) => at(b, x, 2, z)), room };
    case 'relic':
      return { type, altar: at(b, 11, 1, midZ(r)), chest: at(b, 1, 4, 6), room };
    case 'levers':
      return { type, levers: LEVER_XS.map((x, i) => ({ at: at(b, x, 2, z1), on: p.glyphs[i]! })), room };
    default:
      return { type: 'guardians', spawns: guardSpots(r).map(([x, z]) => at(b, x, 1, z)), waves: p.waves, mob: st.guardian.mob, name: st.guardian.name, room };
  }
}

function buildMission(b: Builder, r: number, type: MissionType, p: TemplePlan, st: TempleStyle, seed: number): void {
  const { z1 } = ROOMS[r]!;
  switch (type) {
    case 'altars':
      for (const [x, z] of altarSpots(r)) {
        b.set(x, 1, z, stateOf('temple_altar', { lit: 'false' }));
        b.set(x, 5, z, stateOf(st.lamp, { hanging: 'true' }));
      }
      break;
    case 'braziers':
      for (const [x, z] of altarSpots(r)) {
        b.set(x, 1, z, st.pillar);
        b.set(x, 2, z, stateOf('campfire', { lit: 'false', facing: 'north' }));
      }
      break;
    case 'relic':
      b.set(11, 1, midZ(r), stateOf('temple_altar', { lit: 'false' }));
      for (const [dx, dz] of [
        [-1, 0],
        [1, 0],
      ] as const)
        b.set(11 + dx, 1, midZ(r) + dz, st.trim);
      break;
    case 'levers':
      LEVER_XS.forEach((x, i) => {
        b.set(x, 2, z1, stateOf('lever', { face: 'wall', facing: 'north', powered: 'false' }));
        b.set(x, 3, z1 + 1, p.glyphs[i] ? st.glyph : st.trim);
      });
      break;
    default:
      // The guardians' hall: statues of them along the walls
      for (const z of [ROOMS[r]!.z0 + 2, ROOMS[r]!.z1 - 2]) {
        b.set(1, 1, z, st.pillar);
        b.set(1, 2, z, st.glyph);
        b.set(21, 1, z, st.pillar);
        b.set(21, 2, z, st.glyph);
      }
  }
  void seed;
}

function templeSeals(b: Builder): TempleSeal[][] {
  const doorway = (z: number): TempleSeal[] => [10, 11, 12].flatMap((x) => [1, 2, 3].map((y) => ({ at: at(b, x, y, z) })));
  const roof: TempleSeal[] = [20, 21].flatMap((x) => [20, 21, 22].map((z) => ({ at: at(b, x, 6, z) })));
  return [doorway(9), doorway(18), roof];
}

function buildTemple(b: Builder, rng: Random, seed: number, st: TempleStyle): void {
  const p = plan(rng, st.missions);
  // Ground, clearance and the body
  for (let z = 0; z < TD; z++)
    for (let x = 0; x < TW; x++) {
      b.foundation(x, z, -1, S(st.foundation), 14);
      b.set(x, 0, z, st.floor(x, z));
    }
  b.clearAbove(0, 0, TW - 1, TD - 1, 1, 16);
  for (let y = 1; y <= 6; y++)
    for (let z = 0; z < TD; z++)
      for (let x = 0; x < TW; x++) {
        if (y === 6) b.set(x, y, z, st.roof);
        else if (x === 0 || x === TW - 1 || WALLS_Z.includes(z)) b.set(x, y, z, st.wall(rng, y));
      }
  // Trim along the top of the walls and pillars inside
  for (let x = 0; x < TW; x++) for (const z of [0, TD - 1]) b.set(x, 5, z, st.trim);
  for (let z = 0; z < TD; z++) for (const x of [0, TW - 1]) b.set(x, 5, z, st.trim);
  for (const r of [0, 1, 2]) for (const x of [7, 15]) for (let y = 1; y <= 5; y++) b.set(x, y, ROOMS[r]!.z0 + 3, st.pillar);
  // Entrance with a carved lintel
  b.fill(10, 1, 0, 12, 3, 0, 0);
  for (let x = 9; x <= 13; x++) b.set(x, 4, 0, st.glyph);
  // Seals between the chambers
  for (const z of [9, 18]) {
    b.fill(10, 1, z, 12, 3, z, S('temple_seal'));
    for (let x = 9; x <= 13; x++) b.set(x, 4, z, st.trim);
  }
  // The stairs up to the roof in the last chamber, under the roof seal
  for (let k = 0; k < 5; k++)
    for (const x of [20, 21]) {
      for (let y = 1; y <= k; y++) b.set(x, y, 25 - k, st.wall(rng, y));
      b.set(x, 1 + k, 25 - k, stateOf(st.stairs, { facing: 'north' }));
    }
  for (const x of [20, 21]) for (const z of [20, 21, 22]) b.set(x, 6, z, S('temple_seal'));
  // Lights
  for (const r of [0, 1, 2]) for (const x of [5, 17]) b.set(x, 5, midZ(r), stateOf(st.lamp, { hanging: 'true' }));
  // The supply chest by the door (flint and steel for the braziers)
  b.chest(1, 1, 1, 'south', 'chest/temple_supplies', lootSeed(b, 1, 1, 1, seed));
  // The trials
  p.missions.forEach((m, r) => buildMission(b, r, m, p, st, seed));
  if (p.missions.includes('relic')) {
    // The relic waits on a ledge in the first chamber, up a ladder
    b.fill(1, 1, 5, 2, 3, 7, st.pillar);
    b.chest(1, 4, 6, 'east', 'chest/temple_relic', lootSeed(b, 1, 4, 6, seed));
    for (let y = 1; y <= 3; y++) b.set(3, y, 6, stateOf('ladder', { facing: 'east' }));
  }
  // Treasure in the last chamber
  b.chest(1, 1, 25, 'east', st.loot, lootSeed(b, 1, 1, 25, seed));
  b.chest(1, 1, 19, 'east', st.loot, lootSeed(b, 1, 1, 19, seed));
  // The arena on the roof: a parapet, corner pillars with lights, and the champion's dais
  for (let x = 0; x < TW; x++)
    for (const z of [0, TD - 1]) b.set(x, 7, z, st.trim);
  for (let z = 0; z < TD; z++) for (const x of [0, TW - 1]) b.set(x, 7, z, st.trim);
  for (const [x, z] of [
    [0, 0],
    [TW - 1, 0],
    [0, TD - 1],
    [TW - 1, TD - 1],
  ] as const) {
    for (let y = 7; y <= 9; y++) b.set(x, y, z, st.pillar);
    b.set(x, 10, z, stateOf(st.lamp, { hanging: 'false' }));
  }
  for (let x = 9; x <= 13; x++) for (let z = 11; z <= 15; z++) b.set(x, 6, z, (x + z) % 2 ? st.glyph : st.trim);
  st.ornament(b, rng);
}

function templeQuest(b: Builder, rng: Random, st: TempleStyle): TempleQuest {
  const p = plan(rng, st.missions);
  return {
    kind: 'temple',
    name: st.name,
    missions: p.missions.map((m, r) => missionSpec(b, r, m, p, st)),
    seals: templeSeals(b),
    arena: localBox(b, 0, 7, 0, TW - 1, 13, TD - 1),
    center: at(b, 11, 7, 13),
    champion: st.champion,
    exit: at(b, 11, 1, 3),
    area: localBox(b, 0, 0, 0, TW - 1, 13, TD - 1),
    reward: 'quest/temple_' + st.id,
  };
}

function temple(st: TempleStyle): StructureType {
  return single({
    id: st.id,
    spacing: st.spacing,
    separation: 8,
    salt: st.salt,
    sx: TW,
    sz: TD,
    height: 17,
    below: 14,
    y: 'surface',
    maxSlope: st.maxSlope ?? 7,
    biome: st.biome,
    build: (b, rng, seed) => buildTemple(b, rng, seed, st),
    quest: (b, rng) => templeQuest(b, rng, st),
  });
}

// ---------------------------------------------------------------------------
// The temples
// ---------------------------------------------------------------------------
const cat = (...c: string[]) => (b: Biome): boolean => c.includes(b.category);
const checker = (a: string, c: string) => (x: number, z: number): number => S((x + z) % 2 ? a : c);

/** A random spot on the roof, clear of the parapet, the corner towers, the dais and the hatch. */
function roofSpot(rng: Random): [number, number] {
  for (;;) {
    const x = 3 + rng.int(TW - 6);
    const z = 3 + rng.int(TD - 6);
    if (x >= 8 && x <= 14 && z >= 10 && z <= 16) continue;
    if (x >= 19 && z >= 19) continue;
    return [x, z];
  }
}

/** Vines hanging down the outer walls. */
function vines(b: Builder, rng: Random, chance: number): void {
  for (let z = 1; z < TD - 1; z++)
    for (const [x, side] of [
      [-1, 'east'],
      [TW, 'west'],
    ] as const)
      if (rng.chance(chance)) for (let y = 5 - rng.int(3); y <= 5; y++) b.set(x, y, z, stateOf('vine', { [side]: 'true' }));
}

/** Towers on the roof's corners, with a crown of `top`. */
function cornerTowers(b: Builder, block: number, top: number, height: number): void {
  for (const [x0, z0] of [
    [0, 0],
    [TW - 3, 0],
    [0, TD - 3],
    [TW - 3, TD - 3],
  ] as const)
    for (let x = x0; x < x0 + 3; x++)
      for (let z = z0; z < z0 + 3; z++) {
        for (let y = 7; y < 7 + height; y++) if (x === x0 + 1 && z === z0 + 1) b.set(x, y, z, block);
        b.set(x, 7 + height, z, top);
      }
}

export const JUNGLE_TEMPLE_STYLE: TempleStyle = {
  id: 'jungle_temple',
  name: 'Jungle Temple',
  biome: cat('jungle'),
  spacing: 26,
  salt: 0x1a91e5,
  wall: (rng) => weathered(rng, 'mossy_stone_bricks', 'cracked_stone_bricks', 'mossy_cobblestone', 0.45),
  floor: checker('mossy_stone_bricks', 'stone_bricks'),
  get roof() {
    return S('mossy_stone_bricks');
  },
  get trim() {
    return S('chiseled_stone_bricks');
  },
  get glyph() {
    return S('gold_block');
  },
  get pillar() {
    return S('mossy_cobblestone');
  },
  foundation: 'mossy_cobblestone',
  stairs: 'mossy_stone_bricks_stairs',
  lamp: 'lantern',
  missions: ['altars', 'guardians', 'braziers', 'relic'],
  guardian: { mob: 'zombie,cave_spider', name: 'Temple Guardian' },
  champion: { mob: 'zombie', name: 'Jaguar Champion', hp: 7, dmg: 5 },
  loot: 'chest/jungle_temple',
  ornament: (b, rng) => {
    vines(b, rng, 0.45);
    cornerTowers(b, S('mossy_stone_bricks'), S('jungle_leaves'), 3);
    for (let i = 0; i < 12; i++) {
      const [x, z] = roofSpot(rng);
      b.set(x, 7, z, S('leaf_litter'));
    }
  },
};

export const FROST_TEMPLE_STYLE: TempleStyle = {
  id: 'frost_temple',
  name: 'Frost Temple',
  biome: (b) => b.category === 'icy' || (b.precipitation === 'snow' && (b.category === 'taiga' || b.category === 'mountain')),
  spacing: 30,
  salt: 0xf4057,
  wall: (rng, y) => (y === 3 ? S('blue_ice') : weathered(rng, 'frosted_stone_bricks', 'cracked_stone_bricks', undefined, 0.15)),
  floor: checker('packed_ice', 'polished_andesite'),
  get roof() {
    return S('frosted_stone_bricks');
  },
  get trim() {
    return S('polished_andesite');
  },
  get glyph() {
    return S('blue_ice');
  },
  get pillar() {
    return S('packed_ice');
  },
  foundation: 'stone_bricks',
  stairs: 'polished_andesite_stairs',
  lamp: 'soul_lantern',
  missions: ['levers', 'guardians', 'altars', 'relic'],
  guardian: { mob: 'stray,zombie', name: 'Frost Guardian' },
  champion: { mob: 'stray', name: 'Frost Champion', hp: 7, dmg: 3 },
  loot: 'chest/frozen_ruins',
  ornament: (b, rng) => {
    // Ice spires on the corners, and snow drifts on the roof
    for (const [x, z] of [
      [0, 0],
      [TW - 1, 0],
      [0, TD - 1],
      [TW - 1, TD - 1],
    ] as const)
      for (let y = 11; y <= 13 + rng.int(3); y++) b.set(x, y, z, S('packed_ice'));
    for (let i = 0; i < 20; i++) {
      const [x, z] = roofSpot(rng);
      b.set(x, 7, z, stateOf('snow', { layers: String(1 + rng.int(2)) }));
    }
  },
};

export const SWAMP_TEMPLE_STYLE: TempleStyle = {
  id: 'swamp_temple',
  name: 'Swamp Temple',
  biome: cat('swamp'),
  spacing: 28,
  salt: 0x5a3b7,
  wall: (rng) => weathered(rng, 'mud_bricks', undefined, 'mossy_cobblestone', 0.3),
  floor: checker('mud_bricks', 'packed_mud'),
  get roof() {
    return S('mud_bricks');
  },
  get trim() {
    return S('dark_oak_planks');
  },
  get glyph() {
    return S('glowstone');
  },
  get pillar() {
    return stateOf('dark_oak_log', { axis: 'y' });
  },
  foundation: 'mud',
  stairs: 'mud_bricks_stairs',
  lamp: 'lantern',
  missions: ['relic', 'guardians', 'braziers', 'altars'],
  guardian: { mob: 'zombie,slime', name: 'Bog Guardian' },
  champion: { mob: 'witch', name: 'Bog Champion', hp: 6, dmg: 0 },
  loot: 'chest/swamp_shack',
  ornament: (b, rng) => {
    vines(b, rng, 0.35);
    for (let i = 0; i < 14; i++) {
      const [x, z] = roofSpot(rng);
      b.set(x, 7, z, S('moss_carpet'));
    }
  },
};

export const BADLANDS_TEMPLE_STYLE: TempleStyle = {
  id: 'badlands_temple',
  name: 'Canyon Temple',
  biome: cat('mesa', 'savanna'),
  spacing: 30,
  salt: 0xbad17,
  wall: (_rng, y) => S(['terracotta', 'orange_terracotta', 'red_terracotta', 'yellow_terracotta', 'orange_terracotta', 'terracotta'][y % 6]!),
  floor: checker('cut_red_sandstone', 'red_sandstone'),
  get roof() {
    return S('cut_red_sandstone');
  },
  get trim() {
    return S('chiseled_red_sandstone');
  },
  get glyph() {
    return S('gold_block');
  },
  get pillar() {
    return S('red_sandstone');
  },
  foundation: 'red_sandstone',
  stairs: 'red_sandstone_stairs',
  lamp: 'lantern',
  missions: ['levers', 'guardians', 'braziers', 'relic'],
  guardian: { mob: 'husk,skeleton', name: 'Canyon Guardian' },
  champion: { mob: 'husk', name: 'Canyon Champion', hp: 7, dmg: 5 },
  loot: 'chest/prospector_camp',
  ornament: (b, rng) => {
    // Obelisks on the corners
    for (const [x, z] of [
      [0, 0],
      [TW - 1, 0],
      [0, TD - 1],
      [TW - 1, TD - 1],
    ] as const) {
      for (let y = 11; y <= 13; y++) b.set(x, y, z, S('red_sandstone'));
      b.set(x, 14, z, S('gold_block'));
    }
    for (let i = 0; i < 6; i++) b.set(-1 + rng.int(2) * (TW + 1), 1, rng.int(TD), S('dead_bush'));
  },
};

export const FOREST_TEMPLE_STYLE: TempleStyle = {
  id: 'forest_temple',
  name: 'Grove Temple',
  biome: (b) => b.category === 'forest' || (b.category === 'taiga' && b.precipitation !== 'snow'),
  spacing: 32,
  salt: 0xf0e57,
  wall: (rng) => weathered(rng, 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 0.35),
  floor: (x, z) => S((x * 3 + z) % 5 === 0 ? 'moss_block' : 'stone_bricks'),
  get roof() {
    return S('dark_oak_planks');
  },
  get trim() {
    return stateOf('dark_oak_log', { axis: 'x' });
  },
  get glyph() {
    return S('emerald_block');
  },
  get pillar() {
    return stateOf('dark_oak_log', { axis: 'y' });
  },
  foundation: 'cobblestone',
  stairs: 'stone_bricks_stairs',
  lamp: 'lantern',
  missions: ['altars', 'guardians', 'relic', 'levers'],
  guardian: { mob: 'zombie,skeleton', name: 'Grove Guardian' },
  champion: { mob: 'zombie', name: 'Grove Champion', hp: 7, dmg: 5 },
  loot: 'chest/ranger_tower',
  ornament: (b, rng) => {
    vines(b, rng, 0.25);
    cornerTowers(b, stateOf('dark_oak_log', { axis: 'y' }), S('dark_oak_leaves'), 3);
    for (let i = 0; i < 10; i++) {
      const [x, z] = roofSpot(rng);
      b.set(x, 7, z, S('moss_carpet'));
    }
  },
};

export const MOUNTAIN_TEMPLE_STYLE: TempleStyle = {
  id: 'mountain_temple',
  name: 'Mountain Temple',
  biome: (b) => b.category === 'mountain' && b.precipitation !== 'snow',
  spacing: 30,
  salt: 0x307e7,
  maxSlope: 14,
  wall: (rng) => weathered(rng, 'deepslate_bricks', 'cracked_deepslate_bricks', undefined, 0.2),
  floor: checker('polished_deepslate', 'deepslate_tiles'),
  get roof() {
    return S('polished_deepslate');
  },
  get trim() {
    return S('chiseled_deepslate');
  },
  get glyph() {
    return S('amethyst_block');
  },
  get pillar() {
    return S('polished_deepslate');
  },
  foundation: 'cobbled_deepslate',
  stairs: 'polished_deepslate_stairs',
  lamp: 'soul_lantern',
  missions: ['levers', 'guardians', 'altars', 'braziers'],
  guardian: { mob: 'skeleton,zombie', name: 'Stone Guardian' },
  champion: { mob: 'wither_skeleton', name: 'Stone Champion', hp: 5, dmg: 4 },
  loot: 'chest/mountain_lookout',
  ornament: (b) => cornerTowers(b, S('deepslate_bricks'), S('polished_deepslate_slab'), 4),
};

export const TEMPLE_STYLES: TempleStyle[] = [JUNGLE_TEMPLE_STYLE, FROST_TEMPLE_STYLE, SWAMP_TEMPLE_STYLE, BADLANDS_TEMPLE_STYLE, FOREST_TEMPLE_STYLE, MOUNTAIN_TEMPLE_STYLE];

export const JUNGLE_TEMPLE_V5 = temple(JUNGLE_TEMPLE_STYLE);
export const FROST_TEMPLE = temple(FROST_TEMPLE_STYLE);
export const SWAMP_TEMPLE = temple(SWAMP_TEMPLE_STYLE);
export const BADLANDS_TEMPLE = temple(BADLANDS_TEMPLE_STYLE);
export const FOREST_TEMPLE = temple(FOREST_TEMPLE_STYLE);
export const MOUNTAIN_TEMPLE = temple(MOUNTAIN_TEMPLE_STYLE);

// ---------------------------------------------------------------------------
// The desert pyramid (33 x 33): three burial chambers inside a stepped
// pyramid, a ladder shaft to the summit, and the arena on the top platform
// ---------------------------------------------------------------------------
const PW = 33;
/** Chambers: interior x 5..27, y 1..5, these z ranges; walls at z 13, 22 and 29. */
const P_ROOMS = [
  { z0: 4, z1: 12 },
  { z0: 14, z1: 21 },
  { z0: 23, z1: 28 },
];
const P_LEVER_XS = [8, 11, 21, 24];
const P_SHAFT: [number, number] = [9, 21];

const PYRAMID_STYLE = {
  id: 'desert_pyramid',
  name: 'Desert Pyramid',
  guardian: { mob: 'husk', name: 'Mummy' },
  champion: { mob: 'husk', name: "Pharaoh's Champion", hp: 9, dmg: 6 },
};

function pyramidPlan(rng: Random): TemplePlan {
  const glyphs = [rng.chance(0.5), rng.chance(0.5), rng.chance(0.5), rng.chance(0.5)];
  if (!glyphs.some(Boolean)) glyphs[rng.int(4)] = true;
  return { missions: ['levers', 'guardians', 'relic'], glyphs, waves: 3 };
}

function pyramidMissions(b: Builder, p: TemplePlan): TempleMission[] {
  const room = (r: number) => localBox(b, 5, 1, P_ROOMS[r]!.z0, 27, 5, P_ROOMS[r]!.z1);
  const m = (r: number): number => (P_ROOMS[r]!.z0 + P_ROOMS[r]!.z1) >> 1;
  return [
    { type: 'levers', levers: P_LEVER_XS.map((x, i) => ({ at: at(b, x, 2, P_ROOMS[0]!.z1), on: p.glyphs[i]! })), room: room(0) },
    {
      type: 'guardians',
      spawns: [
        [8, m(1)],
        [24, m(1)],
        [12, 15],
        [20, 15],
        [16, 20],
        [13, m(1)],
      ].map(([x, z]) => at(b, x!, 1, z!)),
      waves: p.waves,
      mob: PYRAMID_STYLE.guardian.mob,
      name: PYRAMID_STYLE.guardian.name,
      room: room(1),
    },
    { type: 'relic', altar: at(b, 16, 1, 27), chest: at(b, 26, 1, 17), room: room(2) },
  ];
}

export const DESERT_PYRAMID = single({
  id: 'desert_pyramid',
  spacing: 34,
  separation: 10,
  salt: 0x9d3a7,
  sx: PW,
  sz: PW,
  height: 26,
  below: 12,
  y: 'surface',
  maxSlope: 8,
  biome: cat('desert'),
  build(b, rng, seed) {
    const p = pyramidPlan(rng);
    const sand = S('sandstone');
    const cut = S('cut_sandstone');
    const smooth = S('smooth_sandstone');
    const chis = S('chiseled_sandstone');
    const orange = S('orange_terracotta');
    const blue = S('blue_terracotta');
    for (let z = 0; z < PW; z++) for (let x = 0; x < PW; x++) b.foundation(x, z, -1, sand, 12);
    b.clearAbove(0, 0, PW - 1, PW - 1, 0, 28);
    // Stepped tiers, two blocks high, with a painted band on each
    for (let k = 0; k < 10; k++)
      for (let y = 2 * k; y <= 2 * k + 1; y++)
        for (let z = k; z < PW - k; z++)
          for (let x = k; x < PW - k; x++) {
            const edge = x === k || z === k || x === PW - 1 - k || z === PW - 1 - k;
            b.set(x, y, z, edge && y === 2 * k + 1 ? ((x + z) % 4 === 0 ? blue : orange) : y === 0 ? smooth : k === 9 ? cut : sand);
          }
    // The entrance tunnel and its chiseled frame
    b.fill(15, 1, 0, 17, 3, 3, 0);
    for (let x = 14; x <= 18; x++) b.set(x, 4, 0, chis);
    b.set(14, 1, 0, chis);
    b.set(18, 1, 0, chis);
    // The chambers and the seals between them
    for (const { z0, z1 } of P_ROOMS) {
      b.fill(5, 1, z0, 27, 5, z1, 0);
      for (let x = 5; x <= 27; x++) for (let z = z0; z <= z1; z++) b.set(x, 0, z, (x + z) % 2 ? smooth : cut);
      for (const x of [9, 23]) for (let y = 1; y <= 5; y++) b.set(x, y, z0 + ((z1 - z0) >> 1), y === 5 ? chis : cut);
      for (const x of [7, 25]) b.set(x, 5, (z0 + z1) >> 1, stateOf('lantern', { hanging: 'true' }));
    }
    for (const z of [13, 22]) {
      b.fill(15, 1, z, 17, 3, z, S('temple_seal'));
      for (let x = 14; x <= 18; x++) b.set(x, 4, z, chis);
    }
    // First chamber: the sun glyph levers on its back wall, and the supply chest
    P_LEVER_XS.forEach((x, i) => {
      b.set(x, 2, 12, stateOf('lever', { face: 'wall', facing: 'north', powered: 'false' }));
      b.set(x, 3, 13, p.glyphs[i] ? chis : cut);
    });
    b.chest(5, 1, 5, 'south', 'chest/temple_supplies', lootSeed(b, 5, 1, 5, seed));
    // Second chamber: the burial hall of the mummies, and the sarcophagus holding the relic
    for (const x of [12, 20])
      for (const z of [16, 19]) {
        b.set(x, 1, z, cut);
        b.set(x + 1, 1, z, cut);
      }
    b.chest(26, 1, 17, 'west', 'chest/temple_relic', lootSeed(b, 26, 1, 17, seed));
    b.set(26, 2, 17, chis);
    b.set(26, 1, 16, cut);
    b.set(26, 1, 18, cut);
    // The shaft to the summit, sealed at its foot
    const [sx, sz] = P_SHAFT;
    for (let y = 1; y <= 19; y++) {
      b.set(sx, y, sz, y <= 3 ? S('temple_seal') : stateOf('ladder', { facing: 'north' }));
      if (y > 5) b.set(sx, y, sz + 1, sand);
    }
    // Last chamber: the relic's altar, the treasure and the urns
    b.set(16, 1, 27, stateOf('temple_altar', { lit: 'false' }));
    b.set(15, 1, 27, chis);
    b.set(17, 1, 27, chis);
    b.chest(6, 1, 28, 'east', 'chest/pyramid', lootSeed(b, 6, 1, 28, seed));
    b.chest(26, 1, 28, 'west', 'chest/pyramid', lootSeed(b, 26, 1, 28, seed));
    for (const [x, z] of [
      [6, 24],
      [26, 24],
      [10, 28],
      [22, 28],
    ] as const)
      b.set(x, 1, z, S('ancient_urn'));
    // The summit: corner obelisks with gold caps around the arena
    for (const [x, z] of [
      [9, 9],
      [23, 9],
      [9, 23],
      [23, 23],
    ] as const) {
      for (let y = 20; y <= 22; y++) b.set(x, y, z, cut);
      b.set(x, 23, z, S('gold_block'));
    }
    for (let x = 14; x <= 18; x++) for (let z = 14; z <= 18; z++) b.set(x, 19, z, (x + z) % 2 ? orange : blue);
    b.set(16, 19, 16, S('gold_block'));
    b.set(16, 20, 16, stateOf('lantern', { hanging: 'false' }));
    void rng;
  },
  quest(b, rng) {
    const p = pyramidPlan(rng);
    const doorway = (z: number): TempleSeal[] => [15, 16, 17].flatMap((x) => [1, 2, 3].map((y) => ({ at: at(b, x, y, z) })));
    const ladder = rotateFacing('north', b.rot);
    const shaft: TempleSeal[] = [1, 2, 3].map((y) => ({ at: at(b, P_SHAFT[0], y, P_SHAFT[1]), ladder }));
    const q: TempleQuest = {
      kind: 'temple',
      name: PYRAMID_STYLE.name,
      missions: pyramidMissions(b, p),
      seals: [doorway(13), doorway(22), shaft],
      arena: localBox(b, 9, 20, 9, 23, 26, 23),
      center: at(b, 13, 20, 16),
      champion: PYRAMID_STYLE.champion,
      exit: at(b, 16, 1, 6),
      area: localBox(b, 0, 0, 0, PW - 1, 26, PW - 1),
      reward: 'quest/temple_desert_pyramid',
    };
    return q;
  },
});

/** Generator 5 temples, in priority order. */
export const V5_TEMPLES: StructureType[] = [DESERT_PYRAMID, FROST_TEMPLE, SWAMP_TEMPLE, BADLANDS_TEMPLE, FOREST_TEMPLE, MOUNTAIN_TEMPLE];
export const TEMPLE_IDS = ['jungle_temple', ...TEMPLE_STYLES.slice(1).map((s) => s.id), 'desert_pyramid'];
