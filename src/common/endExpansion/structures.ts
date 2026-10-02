/**
 * V6 - The End Expansion, phase 3: what the Expanded End's structures are
 * and where they go (plain data shared by the generator, the server, the
 * client and the docs). The generator itself is in
 * src/common/gen/structures/expanded/.
 */

/** The eight End City 2.0 variants. Spacing and separation are in chunks (the structure manager's region grid). */
export interface VariantInfo {
  id: string;
  name: string;
  biomes: string[];
  spacing: number;
  separation: number;
  salt: number;
  size: string;
  guards: string;
  loot: string;
}

const ALL_BUT_ASTRAL = ['end_barrens', 'shattered_end', 'highlands', 'end_crystal_fields', 'chorus_forest', 'void_wastes'];

export const END_VARIANTS: VariantInfo[] = [
  { id: 'end_outpost', name: 'End Outpost', biomes: ALL_BUT_ASTRAL, spacing: 24, separation: 8, salt: 0x6e0071, size: 'Small: a watchtower, bridge stubs, 1-2 platforms', guards: '1-2 Sentinels', loot: 'Cooked Endling, arrows, Void Shards, End Crystal Fragments' },
  { id: 'end_settlement', name: 'End Settlement', biomes: ['chorus_forest', 'highlands'], spacing: 40, separation: 12, salt: 0x6e5e77, size: 'Medium: 4-8 houses around a plaza, joined by bridges, chorus gardens', guards: 'None (Endlings live here)', loot: 'Chorus materials, building blocks, Ender Glyph Stone, books' },
  { id: 'end_ruins', name: 'End Ruins', biomes: ['shattered_end', 'end_barrens', 'void_wastes'], spacing: 28, separation: 8, salt: 0x6e4a17, size: 'Small to medium: broken pieces of the other variants, some floating loose', guards: 'Void Stalkers nearby', loot: 'Ancient Fragments, Ender writings, damaged gear' },
  { id: 'end_library', name: 'End Library', biomes: ['highlands', 'chorus_forest'], spacing: 56, separation: 16, salt: 0x6e1b4a, size: 'Medium: 2-4 floors of bookshelf halls and reading rooms, a sealed archive', guards: '2 Sentinels', loot: 'Books and lore, enchanted books, Ancient Maps' },
  { id: 'end_observatory', name: 'End Observatory', biomes: ['highlands', 'astral_end'], spacing: 64, separation: 20, salt: 0x6e0b5e, size: 'Medium-tall: a spire with a spiral stair up to a dome and a dormant telescope', guards: '1 Bulwark', loot: 'Astral Dust, Ancient Maps, star charts' },
  { id: 'end_shipyard', name: 'End Shipyard', biomes: ['void_wastes', 'shattered_end'], spacing: 64, separation: 20, salt: 0x6e5419, size: 'Large: floating docks, 1-3 hulls (half-built and finished), a crane', guards: '2-3 Sentinels', loot: 'Elytra (about 15% of Shipyards), Phantom Membrane, Ender Scrap' },
  { id: 'end_metropolis', name: 'End Metropolis', biomes: ['highlands'], spacing: 96, separation: 32, salt: 0x6e3e70, size: 'Very large: 4-7 towers linked by sky bridges, a central plaza and a vault', guards: '4-6 Constructs (both kinds)', loot: 'Ender Scrap, enchanted Ender Alloy (rare), Astral Shards' },
  { id: 'end_palace', name: 'End Palace', biomes: ['end_crystal_fields', 'astral_end'], spacing: 128, separation: 40, salt: 0x6e9a1a, size: 'Large: one grand building with a throne hall, courtyards and a sealed crystal vault', guards: '3 Bulwarks', loot: 'Crystal goods, Astral Shards, Crystal Pillars and Astral Mosaic' },
];

/** The five giant structures: at most one per giant region (GIANT_SPACING chunks square). */
export interface GiantInfo {
  id: string;
  name: string;
  /** The one-time title shown on discovery. */
  title: string;
  /** Biomes and their weights (the Void Observatory is rare in the Void Wastes). */
  biomes: Record<string, number>;
  what: string;
  inside: string;
}

export const GIANT_STRUCTURES: GiantInfo[] = [
  { id: 'end_colossus', name: 'End Colossus', title: 'THE END COLOSSUS', biomes: { void_wastes: 3, shattered_end: 2 }, what: 'A giant broken statue floating in pieces: head, torso, an arm and a hand', inside: 'Climbable surfaces, a hollow chamber in the head with a weapon cache, glyph inscriptions' },
  { id: 'crystal_cathedral', name: 'Crystal Cathedral', title: 'THE CRYSTAL CATHEDRAL', biomes: { end_crystal_fields: 1 }, what: 'A massive cathedral of Crystal Glass, End Crystal Clusters and Crystalline End Stone under huge crystal spires', inside: 'A nave, side chapels, a dormant crystal organ, End Crystal Mite nests, crystal hoards' },
  { id: 'void_observatory', name: 'Void Observatory', title: 'THE VOID OBSERVATORY', biomes: { astral_end: 3, void_wastes: 1 }, what: 'A ring of telescope towers around a dome hanging over open void', inside: 'Star charts, a dormant giant lens, Astral Shards, Ancient Maps' },
  { id: 'end_fortress', name: 'End Fortress', title: 'THE END FORTRESS', biomes: { highlands: 1, end_barrens: 1 }, what: 'Walls, gatehouses, towers and a keep', inside: 'Construct patrols, armories (Ender Alloy, ancient weapons), a sealed inner keep' },
  { id: 'fallen_city', name: 'The Fallen City', title: 'THE FALLEN CITY', biomes: { shattered_end: 4 }, what: 'Dozens of collapsed End City towers over a debris field, tilted, half sunk and broken apart', inside: 'The densest lore: Ender writings, books, artifacts, Ancient End Fragments; Void Stalkers' },
];

/** Giant regions: one structure at most in each GIANT_SPACING x GIANT_SPACING chunks. */
export const GIANT_SPACING = 200;
export const GIANT_SEPARATION = 60;
export const GIANT_SALT = 0x6e61a7;
/** The structure manager's type id shared by all five (each start carries its own type). */
export const GIANT_TYPE = 'end_giant';

export const END_VARIANT_IDS = END_VARIANTS.map((v) => v.id);
export const GIANT_IDS = GIANT_STRUCTURES.map((g) => g.id);
export const EXPANSION_STRUCTURE_IDS = [...END_VARIANT_IDS, ...GIANT_IDS];

export function expansionStructureName(id: string): string {
  return END_VARIANTS.find((v) => v.id === id)?.name ?? GIANT_STRUCTURES.find((g) => g.id === id)?.name ?? (id === 'dragon_nest' ? "Dragon's Nest" : id);
}

/** Loot tables of each structure (docs and tests). */
export const STRUCTURE_LOOT: Record<string, string[]> = {
  end_outpost: ['chest/end_outpost'],
  end_settlement: ['chest/end_settlement'],
  end_ruins: ['chest/end_ruins'],
  end_library: ['chest/end_library'],
  end_observatory: ['chest/end_observatory'],
  end_shipyard: ['chest/end_shipyard', 'chest/end_shipyard_elytra'],
  end_metropolis: ['chest/end_metropolis', 'chest/end_metropolis_vault'],
  end_palace: ['chest/end_palace'],
  end_colossus: ['chest/end_colossus', 'chest/end_colossus_cache'],
  crystal_cathedral: ['chest/crystal_cathedral'],
  void_observatory: ['chest/void_observatory'],
  end_fortress: ['chest/end_fortress', 'chest/end_fortress_armory'],
  fallen_city: ['chest/fallen_city'],
  dragon_nest: ['chest/dragon_nest_a', 'chest/dragon_nest_b', 'chest/dragon_nest_c', 'chest/dragon_nest_d'],
};

/** Chance that a Shipyard's finished ship carries Elytra. */
export const SHIPYARD_ELYTRA_CHANCE = 0.15;
/** How far a Guardian Construct may stray from its post (blocks). */
export const CONSTRUCT_LEASH = 24;

/** The Guardian Constructs (placed by structures, never spawned naturally). */
export const CONSTRUCTS = ['guardian_sentinel', 'guardian_bulwark'] as const;
export function isConstruct(type: string): boolean {
  return type === 'guardian_sentinel' || type === 'guardian_bulwark';
}
