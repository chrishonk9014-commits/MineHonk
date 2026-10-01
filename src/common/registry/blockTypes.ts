/**
 * Type definitions for data-driven block definitions.
 * The concrete block list lives in src/common/data/blocks.ts.
 */

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';

export type SoundGroup =
  | 'stone'
  | 'wood'
  | 'gravel'
  | 'grass'
  | 'sand'
  | 'snow'
  | 'glass'
  | 'wool'
  | 'metal'
  | 'plant'
  | 'crop'
  | 'liquid'
  | 'netherrack'
  | 'nylium'
  | 'soul'
  | 'bone'
  | 'mud'
  | 'moss'
  | 'deepslate'
  | 'glitch'
  | 'none';

/** Render layer / pass used by the client mesher. */
export type RenderLayer = 'invisible' | 'opaque' | 'cutout' | 'translucent';

/**
 * Model kinds. The client bakes these into quads per block state;
 * the server/physics derive collision boxes from them.
 */
export type ModelKind =
  | 'none'
  | 'cube'
  | 'column' // logs/pillars with axis prop
  | 'cross' // flowers, saplings
  | 'crop' // # shaped crops
  | 'liquid'
  | 'slab'
  | 'stairs'
  | 'fence'
  | 'fence_gate'
  | 'wall'
  | 'pane'
  | 'door'
  | 'trapdoor'
  | 'torch'
  | 'wall_torch'
  | 'ladder'
  | 'carpet'
  | 'snow_layer'
  | 'farmland'
  | 'path'
  | 'cactus'
  | 'chest'
  | 'bed'
  | 'lantern'
  | 'portal'
  | 'end_portal'
  | 'end_portal_frame'
  | 'enchanting_table'
  | 'anvil'
  | 'brewing_stand'
  | 'cauldron'
  | 'sign'
  | 'wall_sign'
  | 'vine'
  | 'lily_pad'
  | 'double_plant'
  | 'fire'
  | 'button'
  | 'pressure_plate'
  | 'lever'
  | 'chain'
  | 'rod'
  | 'dragon_egg'
  | 'campfire'
  | 'dripstone'
  | 'hanging_plant'
  | 'layer'
  | 'bars'
  | 'mushroom_block'
  | 'custom';

export interface TexSpec {
  all?: string;
  top?: string;
  bottom?: string;
  side?: string;
  front?: string;
  /** texture used for particles / item icon fallback */
  particle?: string;
  [k: string]: string | undefined;
}

export type PropValue = string;
export type PropDefs = Record<string, readonly PropValue[]>;

export type BlockEntityKind =
  | 'chest'
  | 'furnace'
  | 'sign'
  | 'enchanting_table'
  | 'brewing_stand'
  | 'spawner'
  | 'end_portal'
  | 'jukebox'
  | 'campfire'
  | 'barrel'
  | 'ender_chest'
  | 'beacon'
  | 'conduit'
  | 'eng';

/** What happens when the player uses (right clicks) the block. */
export type InteractKind =
  | 'crafting'
  | 'furnace'
  | 'blast_furnace'
  | 'smoker'
  | 'chest'
  | 'barrel'
  | 'ender_chest'
  | 'door'
  | 'trapdoor'
  | 'fence_gate'
  | 'bed'
  | 'enchanting'
  | 'anvil'
  | 'brewing'
  | 'smithing'
  | 'lever'
  | 'button'
  | 'sign'
  | 'jukebox'
  | 'note_block'
  | 'cake'
  | 'composter'
  | 'respawn_anchor'
  | 'stonecutter'
  | 'bell'
  | 'beacon'
  | 'cauldron'
  | 'flower_pot'
  | 'candle'
  | 'keycard_reader'
  | 'bunker_generator'
  | 'temple_altar'
  | 'engineering'
  | 'engineering_table'
  /** V5.5: the computer world's old terminals (read their logs). */
  | 'terminal';

export type TintKind = 'none' | 'grass' | 'foliage' | 'water' | 'birch' | 'spruce' | 'stem' | 'lily';

export interface DropSpec {
  /** Item id dropped; defaults to the block's own item. 'none' for no drop. */
  item?: string;
  min?: number;
  max?: number;
  /** When set, the named loot table is used instead. */
  table?: string;
  /** Silk-touch/shears drop self instead of normal drop. */
  silkTouch?: boolean;
  /** Fortune applies (ores). */
  fortune?: boolean;
  /** Experience range dropped when mined (ores). */
  xp?: [number, number];
  /** Chance-based extra drops e.g. saplings from leaves. */
  extra?: { item: string; chance: number; min?: number; max?: number }[];
}

export interface BlockDef {
  id: string;
  name: string;
  props?: PropDefs;
  defaults?: Record<string, PropValue>;
  /** Hardness in the Minecraft-like sense. -1 = unbreakable. */
  hardness: number;
  resistance?: number;
  tool?: ToolType;
  /** Minimum tool tier needed to harvest drops (0 wood .. 4 netherite, 5 glitched). */
  harvestLevel?: number;
  /** When true (default for stone-like blocks with harvestLevel) no drop without the right tool. */
  requiresTool?: boolean;
  sound: SoundGroup;
  model: ModelKind;
  tex: TexSpec;
  layer?: RenderLayer;
  light?: number;
  /** Light opacity for non-opaque blocks (0-15). Opaque blocks are 15. */
  opacity?: number;
  /** Whether entities collide with the block. Defaults true unless model is cross/liquid/none etc. */
  collide?: boolean;
  /** Can be replaced by placing a block into it (air, water, tall grass). */
  replaceable?: boolean;
  gravity?: boolean;
  tint?: TintKind;
  drops?: DropSpec | 'none';
  flammable?: boolean;
  /** Horizontal slipperiness (default 0.6, ice 0.98). */
  slipperiness?: number;
  /** Movement speed multiplier while standing on/in (soul sand 0.4, cobweb 0.05). */
  speedFactor?: number;
  climbable?: boolean;
  /** Damage per second when touching (cactus, magma, fire). */
  contactDamage?: number;
  fluid?: 'water' | 'lava';
  /** Tags used by recipes, world gen and logic. */
  tags?: string[];
  entity?: BlockEntityKind;
  interact?: InteractKind;
  /** Placement rule identifiers checked by the server. */
  place?: 'standing' | 'needs_soil' | 'needs_farmland' | 'needs_sand' | 'needs_water_surface' | 'needs_solid_below' | 'wall' | 'hanging' | 'needs_nylium' | 'needs_soul_sand';
  /** Creative inventory tab; undefined -> auto. 'hidden' for technical blocks. */
  creative?: string;
  /** Whether a block item is auto registered (default true). */
  item?: boolean;
  /** Map colour used for the minimap / distant LOD (rgb hex). */
  mapColor?: number;
  /** Random ticks enabled (crops, grass spread, leaf decay, ice melt...). */
  randomTicks?: boolean;
  /** Extra free-form data for specialised logic. */
  data?: Record<string, unknown>;
  /** Side textures get the value of this prop as a suffix (battery charge bars). */
  texBy?: string;
  /** V5.5: the front texture gets the value of this prop as a suffix (a computer's screen). */
  frontBy?: string;
}
