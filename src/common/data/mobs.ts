/**
 * Mob definitions (data-driven). The server builds AI brains from `ai`, the
 * client picks a model from `model`, spawn eggs are generated from `egg`.
 * Stats are in half-hearts (health) and blocks/tick (speed).
 */
import { registerEntityInfo } from './entities';

export type MobCategory = 'creature' | 'monster' | 'water' | 'ambient' | 'npc' | 'boss';

export type Brain =
  | 'passive'
  | 'chicken'
  | 'sheep'
  | 'wolf'
  | 'cat'
  | 'fox'
  | 'neutral_bear'
  | 'goat'
  | 'fish'
  | 'squid'
  | 'bat'
  | 'villager'
  | 'golem'
  | 'zombie'
  | 'skeleton'
  | 'creeper'
  | 'spider'
  | 'enderman'
  | 'witch'
  | 'slime'
  | 'blaze'
  | 'ghast'
  | 'piglin'
  | 'zombified_piglin'
  | 'hoglin'
  | 'silverfish'
  | 'shulker'
  | 'pillager'
  | 'phantom'
  | 'cave_stalker'
  | 'sky_ray'
  | 'ember_beast'
  | 'rift_walker'
  | 'wanderer'
  | 'void_wisp'
  | 'glitch_beast'
  | 'dragon'
  | 'the_error'
  | 'herobrine'
  | 'turtle'
  | 'parrot'
  | 'ocelot'
  | 'panda'
  | 'llama'
  | 'camel'
  | 'frog'
  | 'axolotl'
  | 'warden'
  | 'sporeling'
  // V6 phase 2: the Expanded End's mobs (src/server/ai/endGoals.ts)
  | 'endling'
  | 'void_stalker'
  | 'chorus_beast'
  | 'end_crystal_mite'
  | 'end_phantom';

export interface MobDef {
  id: string;
  name: string;
  category: MobCategory;
  width: number;
  height: number;
  eye?: number;
  health: number;
  /** Walking speed in blocks per tick. */
  speed: number;
  damage?: number;
  armor?: number;
  knockbackRes?: number;
  followRange?: number;
  brain: Brain;
  model: string;
  /** Spawn egg colours (base, spots). */
  egg: [number, number];
  undead?: boolean;
  arthropod?: boolean;
  farlands?: boolean;
  burnsInDay?: boolean;
  fireImmune?: boolean;
  flying?: boolean;
  aquatic?: boolean;
  /** Breathes air and water: walks on land and swims freely in water. */
  amphibious?: boolean;
  /** Can be bred with these items (and tempted by them). */
  breedItems?: string[];
  /** Held item given at spawn: [item id, chance]. */
  equipment?: [string, number][];
  /** Can spawn as a baby (chance). */
  babyChance?: number;
  /** Max light level for natural spawning (monsters). */
  maxSpawnLight?: number;
  /** Plays idle sounds every ~N ticks (average). */
  idleInterval?: number;
  xp?: number;
  /** Rideable: rider feet height above the mob, who steers ('client': the rider; 'carrot': a Carrot on a Stick), and whether it must be tamed first. */
  mount?: { seat: number; control: 'client' | 'carrot'; tame: boolean };
  /** V6: treats void edges as walls (never walks off an island). */
  edgeGuard?: boolean;
}

const M: MobDef[] = [];
function mob(d: MobDef): void {
  M.push(d);
}

// --- Passive / farm ----------------------------------------------------------
mob({ id: 'cow', name: 'Cow', category: 'creature', width: 0.9, height: 1.4, health: 10, speed: 0.1, brain: 'passive', model: 'cow', egg: [0x443626, 0xa1a1a1], breedItems: ['wheat'], babyChance: 0 });
mob({ id: 'mooshroom', name: 'Mooshroom', category: 'creature', width: 0.9, height: 1.4, health: 10, speed: 0.1, brain: 'passive', model: 'mooshroom', egg: [0xa00f10, 0xb7b7b7], breedItems: ['wheat'] });
mob({ id: 'pig', name: 'Pig', category: 'creature', width: 0.9, height: 0.9, health: 10, speed: 0.1, brain: 'passive', model: 'pig', egg: [0xf0a5a2, 0xdb635f], breedItems: ['carrot', 'potato', 'beetroot'], mount: { seat: 0.3, control: 'carrot', tame: false } });
mob({ id: 'sheep', name: 'Sheep', category: 'creature', width: 0.9, height: 1.3, health: 8, speed: 0.1, brain: 'sheep', model: 'sheep', egg: [0xe7e7e7, 0xffb5b5], breedItems: ['wheat'] });
mob({ id: 'chicken', name: 'Chicken', category: 'creature', width: 0.4, height: 0.7, health: 4, speed: 0.1, brain: 'chicken', model: 'chicken', egg: [0xa1a1a1, 0xff0000], breedItems: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'] });
mob({ id: 'rabbit', name: 'Rabbit', category: 'creature', width: 0.4, height: 0.5, health: 3, speed: 0.13, brain: 'passive', model: 'rabbit', egg: [0x995f40, 0x734831], breedItems: ['carrot', 'golden_carrot', 'dandelion'] });
mob({ id: 'horse', name: 'Horse', category: 'creature', width: 1.4, height: 1.6, health: 22, speed: 0.17, brain: 'passive', model: 'horse', egg: [0xc09e7d, 0xeee500], breedItems: ['golden_apple', 'golden_carrot'], mount: { seat: 0.7, control: 'client', tame: true } });
mob({ id: 'goat', name: 'Goat', category: 'creature', width: 0.9, height: 1.3, health: 10, speed: 0.1, damage: 2, brain: 'goat', model: 'goat', egg: [0xa5947c, 0x55493e], breedItems: ['wheat'] });
mob({ id: 'fox', name: 'Fox', category: 'creature', width: 0.6, height: 0.7, health: 10, speed: 0.15, damage: 2, brain: 'fox', model: 'fox', egg: [0xd5b69f, 0xcc6920], breedItems: ['sweet_berries'] });
mob({ id: 'wolf', name: 'Wolf', category: 'creature', width: 0.6, height: 0.85, health: 8, speed: 0.15, damage: 4, brain: 'wolf', model: 'wolf', egg: [0xd7d3d3, 0xceaf96], breedItems: ['beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton', 'rotten_flesh'] });
mob({ id: 'cat', name: 'Cat', category: 'creature', width: 0.6, height: 0.7, health: 10, speed: 0.15, damage: 3, brain: 'cat', model: 'cat', egg: [0xefc88e, 0x957256], breedItems: ['cod', 'salmon'] });
mob({ id: 'polar_bear', name: 'Polar Bear', category: 'creature', width: 1.4, height: 1.4, health: 30, speed: 0.12, damage: 6, brain: 'neutral_bear', model: 'polar_bear', egg: [0xf2f2f2, 0x959590] });
mob({ id: 'squid', name: 'Squid', category: 'water', width: 0.8, height: 0.8, health: 10, speed: 0.05, brain: 'squid', model: 'squid', egg: [0x223b4d, 0x708899], aquatic: true });
mob({ id: 'cod', name: 'Cod', category: 'water', width: 0.5, height: 0.3, health: 3, speed: 0.08, brain: 'fish', model: 'fish', egg: [0xc1a76a, 0xe5c48b], aquatic: true });
mob({ id: 'salmon', name: 'Salmon', category: 'water', width: 0.7, height: 0.4, health: 3, speed: 0.08, brain: 'fish', model: 'fish', egg: [0xa00f10, 0x0e8474], aquatic: true });
mob({ id: 'bat', name: 'Bat', category: 'ambient', width: 0.5, height: 0.9, health: 6, speed: 0.1, brain: 'bat', model: 'bat', egg: [0x4c3e30, 0x0f0f0f], flying: true, idleInterval: 400 });
mob({ id: 'villager', name: 'Villager', category: 'npc', width: 0.6, height: 1.95, health: 20, speed: 0.08, brain: 'villager', model: 'villager', egg: [0x563c33, 0xbd8b72], babyChance: 0.1 });
mob({ id: 'iron_golem', name: 'Iron Golem', category: 'npc', width: 1.4, height: 2.7, health: 100, speed: 0.08, damage: 12, knockbackRes: 1, brain: 'golem', model: 'iron_golem', egg: [0xdbcdc1, 0x74a332] });
mob({ id: 'glitched_cow', name: 'Glitched Cow', category: 'creature', width: 0.9, height: 1.4, health: 12, speed: 0.1, brain: 'passive', model: 'cow', egg: [0x2a9d8f, 0xff00ff], farlands: true, breedItems: ['glitch_berry'] });
mob({ id: 'glitched_sheep', name: 'Glitched Sheep', category: 'creature', width: 0.9, height: 1.3, health: 10, speed: 0.1, brain: 'sheep', model: 'sheep', egg: [0x7a3fe4, 0x00ffcc], farlands: true, breedItems: ['glitch_berry'] });
mob({ id: 'turtle', name: 'Turtle', category: 'creature', width: 1.2, height: 0.4, health: 30, speed: 0.05, brain: 'turtle', model: 'turtle', egg: [0xe7e7e7, 0x00afaf], amphibious: true, breedItems: ['seagrass'], idleInterval: 400 });
mob({ id: 'parrot', name: 'Parrot', category: 'creature', width: 0.5, height: 0.9, health: 6, speed: 0.2, brain: 'parrot', model: 'parrot', egg: [0x0da70b, 0xff0000], flying: true, breedItems: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'] });
mob({ id: 'ocelot', name: 'Ocelot', category: 'creature', width: 0.6, height: 0.7, health: 10, speed: 0.2, damage: 3, brain: 'ocelot', model: 'ocelot', egg: [0xefde7d, 0x564434], breedItems: ['cod', 'salmon'] });
mob({ id: 'panda', name: 'Panda', category: 'creature', width: 1.3, height: 1.25, health: 20, speed: 0.1, damage: 6, brain: 'panda', model: 'panda', egg: [0xe7e7e7, 0x1b1b22], breedItems: ['bamboo'], idleInterval: 300 });
mob({ id: 'llama', name: 'Llama', category: 'creature', width: 0.9, height: 1.87, health: 22, speed: 0.12, damage: 1, brain: 'llama', model: 'llama', egg: [0xc09e7d, 0x995f40], breedItems: ['hay_block', 'wheat'] });
mob({ id: 'camel', name: 'Camel', category: 'creature', width: 1.7, height: 2.375, health: 32, speed: 0.09, brain: 'camel', model: 'camel', egg: [0xfcc369, 0xcb9337], breedItems: ['cactus'], mount: { seat: 1.6, control: 'client', tame: false }, idleInterval: 400 });
mob({ id: 'frog', name: 'Frog', category: 'creature', width: 0.5, height: 0.5, health: 10, speed: 0.1, brain: 'frog', model: 'frog', egg: [0xd07444, 0xffc77c], amphibious: true, breedItems: ['slime_ball'] });
mob({ id: 'axolotl', name: 'Axolotl', category: 'water', width: 0.75, height: 0.42, health: 14, speed: 0.1, damage: 2, brain: 'axolotl', model: 'axolotl', egg: [0xfbc1e3, 0xa62d74], amphibious: true, breedItems: ['tropical_fish'] });
mob({ id: 'tropical_fish', name: 'Tropical Fish', category: 'water', width: 0.5, height: 0.4, health: 3, speed: 0.08, brain: 'fish', model: 'tropical_fish', egg: [0xef6915, 0xfff9ef], aquatic: true });
mob({ id: 'pufferfish', name: 'Pufferfish', category: 'water', width: 0.7, height: 0.7, health: 3, speed: 0.06, brain: 'fish', model: 'pufferfish', egg: [0xf6b201, 0x37c3f2], aquatic: true });

// --- Hostile --------------------------------------------------------------------
mob({ id: 'zombie', name: 'Zombie', category: 'monster', width: 0.6, height: 1.95, health: 20, speed: 0.1, damage: 3, armor: 2, followRange: 35, brain: 'zombie', model: 'zombie', egg: [0x00afaf, 0x799c65], undead: true, burnsInDay: true, babyChance: 0.05, equipment: [['iron_shovel', 0.02], ['iron_sword', 0.01]], maxSpawnLight: 0 });
mob({ id: 'husk', name: 'Husk', category: 'monster', width: 0.6, height: 1.95, health: 20, speed: 0.1, damage: 3, armor: 2, followRange: 35, brain: 'zombie', model: 'husk', egg: [0x797061, 0xe6cc94], undead: true, babyChance: 0.05, maxSpawnLight: 0 });
mob({ id: 'drowned', name: 'Drowned', category: 'monster', width: 0.6, height: 1.95, health: 20, speed: 0.1, damage: 3, armor: 2, brain: 'zombie', model: 'drowned', egg: [0x8ff1d7, 0x799c65], undead: true, burnsInDay: true, aquatic: true, equipment: [['trident', 0.06]], maxSpawnLight: 0 });
mob({ id: 'skeleton', name: 'Skeleton', category: 'monster', width: 0.6, height: 1.99, health: 20, speed: 0.1, damage: 2, brain: 'skeleton', model: 'skeleton', egg: [0xc1c1c1, 0x494949], undead: true, burnsInDay: true, equipment: [['bow', 1]], maxSpawnLight: 0 });
mob({ id: 'stray', name: 'Stray', category: 'monster', width: 0.6, height: 1.99, health: 20, speed: 0.1, damage: 2, brain: 'skeleton', model: 'stray', egg: [0x617677, 0xddeaea], undead: true, burnsInDay: true, equipment: [['bow', 1]], maxSpawnLight: 0 });
mob({ id: 'creeper', name: 'Creeper', category: 'monster', width: 0.6, height: 1.7, health: 20, speed: 0.1, brain: 'creeper', model: 'creeper', egg: [0x0da70b, 0x000000], maxSpawnLight: 0 });
mob({ id: 'spider', name: 'Spider', category: 'monster', width: 1.4, height: 0.9, health: 16, speed: 0.13, damage: 2, brain: 'spider', model: 'spider', egg: [0x342d27, 0xa80e0e], arthropod: true, maxSpawnLight: 0 });
mob({ id: 'cave_spider', name: 'Cave Spider', category: 'monster', width: 0.7, height: 0.5, health: 12, speed: 0.13, damage: 2, brain: 'spider', model: 'cave_spider', egg: [0x0c424e, 0xa80e0e], arthropod: true });
mob({ id: 'enderman', name: 'Enderman', category: 'monster', width: 0.6, height: 2.9, health: 40, speed: 0.13, damage: 7, followRange: 64, brain: 'enderman', model: 'enderman', egg: [0x161616, 0x000000], maxSpawnLight: 0 });
mob({ id: 'witch', name: 'Witch', category: 'monster', width: 0.6, height: 1.95, health: 26, speed: 0.1, brain: 'witch', model: 'witch', egg: [0x340000, 0x51a03e], maxSpawnLight: 0 });
mob({ id: 'slime', name: 'Slime', category: 'monster', width: 1.04, height: 1.04, health: 16, speed: 0.1, damage: 4, brain: 'slime', model: 'slime', egg: [0x51a03e, 0x7ebf6e] });
mob({ id: 'magma_cube', name: 'Magma Cube', category: 'monster', width: 1.04, height: 1.04, health: 16, speed: 0.12, damage: 6, armor: 3, brain: 'slime', model: 'magma_cube', egg: [0x340000, 0xfcfc00], fireImmune: true });
mob({ id: 'blaze', name: 'Blaze', category: 'monster', width: 0.6, height: 1.8, health: 20, speed: 0.1, damage: 6, brain: 'blaze', model: 'blaze', egg: [0xf6b201, 0xfff87e], fireImmune: true, flying: true, maxSpawnLight: 11 });
mob({ id: 'ghast', name: 'Ghast', category: 'monster', width: 4, height: 4, health: 10, speed: 0.05, brain: 'ghast', model: 'ghast', egg: [0xf9f9f9, 0xbcbcbc], fireImmune: true, flying: true, followRange: 100, idleInterval: 200 });
mob({ id: 'zombified_piglin', name: 'Zombified Piglin', category: 'monster', width: 0.6, height: 1.95, health: 20, speed: 0.1, damage: 5, armor: 2, brain: 'zombified_piglin', model: 'zombified_piglin', egg: [0xea9393, 0x4c7129], undead: true, fireImmune: true, equipment: [['golden_sword', 1]], maxSpawnLight: 11 });
mob({ id: 'piglin', name: 'Piglin', category: 'monster', width: 0.6, height: 1.95, health: 16, speed: 0.1, damage: 5, brain: 'piglin', model: 'piglin', egg: [0x995f40, 0xf9f3a4], equipment: [['golden_sword', 0.5], ['crossbow', 0.5]], maxSpawnLight: 11 });
mob({ id: 'hoglin', name: 'Hoglin', category: 'monster', width: 1.4, height: 1.4, health: 40, speed: 0.1, damage: 6, knockbackRes: 0.6, brain: 'hoglin', model: 'hoglin', egg: [0xc66e55, 0x5f6464], breedItems: ['crimson_fungus'], maxSpawnLight: 11 });
mob({ id: 'wither_skeleton', name: 'Wither Skeleton', category: 'monster', width: 0.7, height: 2.4, health: 20, speed: 0.1, damage: 8, brain: 'skeleton', model: 'wither_skeleton', egg: [0x141414, 0x474d4d], undead: true, fireImmune: true, equipment: [['stone_sword', 1]], maxSpawnLight: 11 });
mob({ id: 'silverfish', name: 'Silverfish', category: 'monster', width: 0.4, height: 0.3, health: 8, speed: 0.1, damage: 1, brain: 'silverfish', model: 'silverfish', egg: [0x6e6e6e, 0x303030], arthropod: true });
mob({ id: 'shulker', name: 'Shulker', category: 'monster', width: 1, height: 1, health: 30, speed: 0, armor: 20, knockbackRes: 1, brain: 'shulker', model: 'shulker', egg: [0x946794, 0x4d3852] });
mob({ id: 'pillager', name: 'Pillager', category: 'monster', width: 0.6, height: 1.95, health: 24, speed: 0.1, damage: 5, brain: 'pillager', model: 'pillager', egg: [0x532f36, 0x959b9b], equipment: [['crossbow', 1]] });
mob({ id: 'phantom', name: 'Phantom', category: 'monster', width: 0.9, height: 0.5, health: 20, speed: 0.2, damage: 6, brain: 'phantom', model: 'phantom', egg: [0x43518a, 0x88ff00], undead: true, burnsInDay: true, flying: true });

// --- Original MineHonk mobs --------------------------------------------------------
/** Hunts in total darkness deep underground; it cannot stand light. */
mob({ id: 'cave_stalker', name: 'Cave Stalker', category: 'monster', width: 0.8, height: 2.2, eye: 2, health: 36, speed: 0.12, damage: 7, armor: 4, followRange: 28, brain: 'cave_stalker', model: 'cave_stalker', egg: [0x1d1f2b, 0x9ef0ff], maxSpawnLight: 0, idleInterval: 300 });
/** Gentle manta-like flyer of the high mountains; retaliates when attacked. */
mob({ id: 'sky_ray', name: 'Sky Ray', category: 'creature', width: 1.6, height: 0.5, health: 18, speed: 0.12, damage: 4, brain: 'sky_ray', model: 'sky_ray', egg: [0x6fa9d8, 0xf4f9ff], flying: true, idleInterval: 250 });
/** A molten hound of the Ember Wastes that sets its prey alight. */
mob({ id: 'ember_beast', name: 'Ember Beast', category: 'monster', width: 1.2, height: 1.3, health: 44, speed: 0.14, damage: 8, armor: 6, knockbackRes: 0.4, brain: 'ember_beast', model: 'ember_beast', egg: [0x3a1206, 0xff7a1a], fireImmune: true, maxSpawnLight: 15 });
/** Tears short rifts through space to strike from behind. */
mob({ id: 'rift_walker', name: 'Rift Walker', category: 'monster', width: 0.6, height: 2.4, health: 30, speed: 0.13, damage: 6, followRange: 40, brain: 'rift_walker', model: 'rift_walker', egg: [0x120a24, 0xd13fff], maxSpawnLight: 7 });
/** Lost soul of the Farlands; wanders in broken loops. */
mob({ id: 'farlands_wanderer', name: 'Farlands Wanderer', category: 'monster', width: 0.6, height: 1.95, health: 24, speed: 0.1, damage: 4, brain: 'wanderer', model: 'wanderer', egg: [0x5b6f72, 0xff40ff], farlands: true, maxSpawnLight: 15 });
mob({ id: 'glitch_zombie', name: 'Glitched Zombie', category: 'monster', width: 0.6, height: 1.95, health: 24, speed: 0.11, damage: 4, armor: 2, brain: 'zombie', model: 'glitch_zombie', egg: [0x00afaf, 0xff00ff], undead: true, farlands: true, maxSpawnLight: 7 });
mob({ id: 'glitch_skeleton', name: 'Glitched Skeleton', category: 'monster', width: 0.6, height: 1.99, health: 22, speed: 0.1, damage: 3, brain: 'skeleton', model: 'glitch_skeleton', egg: [0xc1c1c1, 0xff00ff], undead: true, farlands: true, equipment: [['bow', 1]], maxSpawnLight: 7 });
mob({ id: 'void_wisp', name: 'Void Wisp', category: 'monster', width: 0.5, height: 0.5, health: 8, speed: 0.12, damage: 3, brain: 'void_wisp', model: 'void_wisp', egg: [0x05030a, 0x9a4dff], flying: true, farlands: true, maxSpawnLight: 15 });
// --- Cave mobs (V2) ---------------------------------------------------------------
mob({ id: 'glow_squid', name: 'Glow Squid', category: 'water', width: 0.8, height: 0.8, health: 10, speed: 0.05, brain: 'squid', model: 'glow_squid', egg: [0x095656, 0x85f1bc], aquatic: true, idleInterval: 400 });
/** Crystal caves: small crystal-backed critters that swarm when one is hit. */
mob({ id: 'crystal_mite', name: 'Crystal Mite', category: 'monster', width: 0.5, height: 0.4, health: 8, speed: 0.13, damage: 2, brain: 'silverfish', model: 'crystal_mite', egg: [0x5c3f99, 0xc6a8ff], arthropod: true, maxSpawnLight: 12 });
/** Mushroom caves: a shy walking mushroom that puffs a dizzying spore cloud when hurt. */
mob({ id: 'sporeling', name: 'Sporeling', category: 'creature', width: 0.6, height: 1.1, health: 14, speed: 0.08, damage: 3, brain: 'sporeling', model: 'sporeling', egg: [0xd8d0c0, 0x2a8a9a], idleInterval: 300 });
/** Blind guardian of the deep dark, called up by sculk shriekers. */
mob({ id: 'warden', name: 'Warden', category: 'monster', width: 0.9, height: 2.9, eye: 2.6, health: 500, speed: 0.13, damage: 30, knockbackRes: 1, followRange: 48, brain: 'warden', model: 'warden', egg: [0x0f4649, 0x39d6e0], idleInterval: 160, xp: 5 });
/** The Farlands' corrupted guardian. */
mob({ id: 'glitch_beast', name: 'Glitch Beast', category: 'boss', width: 2.2, height: 3.4, health: 400, speed: 0.12, damage: 14, armor: 12, knockbackRes: 1, followRange: 64, brain: 'glitch_beast', model: 'glitch_beast', egg: [0x0b0b12, 0x00ffd0], farlands: true, fireImmune: true });
// V3: the Farlands boss, a giant glitched figure driven by its own controller (ErrorBoss.ts)
mob({ id: 'the_error', name: 'The Error', category: 'boss', width: 3.4, height: 18, health: 600, speed: 0, damage: 12, armor: 8, knockbackRes: 1, followRange: 96, brain: 'the_error', model: 'the_error', egg: [0x07030c, 0xff2bd6], fireImmune: true, farlands: true });
// V5.5: he comes out of a computer (driven by the Herobrine system, never spawned naturally)
mob({ id: 'herobrine', name: 'Herobrine', category: 'boss', width: 0.6, height: 1.95, eye: 1.62, health: 300, speed: 0.12, damage: 6, armor: 6, knockbackRes: 0.85, followRange: 64, brain: 'herobrine', model: 'herobrine', egg: [0x1e8a8a, 0xffffff], fireImmune: true });
// V6 phase 2: the Expanded End (spawned only in its biomes, see src/common/endExpansion/mobs.ts)
/** Small and shy; hops away when hit and scatters from Void Stalkers. Breeds on chorus fruit. */
mob({ id: 'endling', name: 'Endling', category: 'creature', width: 0.5, height: 0.6, health: 8, speed: 0.1, brain: 'endling', model: 'endling', egg: [0xd8c8f0, 0x2a2040], breedItems: ['chorus_fruit'], babyChance: 0, idleInterval: 240, edgeGuard: true });
/** Lunges after a long crouch; slips into the void when hurt or stared at, and climbs back behind you. */
mob({ id: 'void_stalker', name: 'Void Stalker', category: 'monster', width: 0.7, height: 2.2, eye: 2, health: 30, speed: 0.16, damage: 7, armor: 4, followRange: 32, brain: 'void_stalker', model: 'void_stalker', egg: [0x120c1c, 0x9a4dff], maxSpawnLight: 15, xp: 8, idleInterval: 260, edgeGuard: true });
/** Neutral giant of the Chorus Forest: slams the ground and throws chorus. */
mob({ id: 'chorus_beast', name: 'Chorus Beast', category: 'monster', width: 2.4, height: 3, eye: 2.6, health: 80, speed: 0.07, damage: 12, armor: 8, knockbackRes: 0.8, followRange: 24, brain: 'chorus_beast', model: 'chorus_beast', egg: [0x8a5a9a, 0xe0c0f0], maxSpawnLight: 15, xp: 15, idleInterval: 300, edgeGuard: true });
/** Tiny swarming crystal-backs of the End Crystal Fields (not the caves' Crystal Mite). */
mob({ id: 'end_crystal_mite', name: 'End Crystal Mite', category: 'monster', width: 0.4, height: 0.3, health: 6, speed: 0.14, damage: 2, followRange: 16, brain: 'end_crystal_mite', model: 'end_crystal_mite', egg: [0xe8d8f8, 0x8a5ad0], arthropod: true, maxSpawnLight: 15, xp: 3, idleInterval: 200, edgeGuard: true });
/** Circles high over the outer Expanded End and dives on players, gliders too. */
mob({ id: 'end_phantom', name: 'End Phantom', category: 'monster', width: 2, height: 0.8, health: 40, speed: 0.22, damage: 9, followRange: 64, brain: 'end_phantom', model: 'end_phantom', egg: [0x1a1a3a, 0xf0f4ff], flying: true, maxSpawnLight: 15, xp: 20, idleInterval: 220 });
mob({ id: 'ender_dragon', name: 'Ender Dragon', category: 'boss', width: 16, height: 8, health: 200, speed: 0.3, damage: 10, knockbackRes: 1, followRange: 150, brain: 'dragon', model: 'ender_dragon', egg: [0x1c1c1c, 0xe079fa], fireImmune: true, flying: true });

export const MOB_DEFS: readonly MobDef[] = M;
export const MOB_BY_ID = new Map(M.map((d) => [d.id, d]));

export function mobDef(id: string): MobDef | undefined {
  return MOB_BY_ID.get(id);
}

for (const d of M) registerEntityInfo(d.id, { width: d.width, height: d.height, eye: d.eye ?? d.height * 0.85, attackable: true, interactable: true });
