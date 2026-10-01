/**
 * V5.5: a colour for each block as seen from above (the Map Viewer).
 * Blocks with a mapColor use it; the rest are guessed once from their name.
 */
import { blocks, STATE_BLOCK } from '../registry/blocks';

let CACHE: (number | undefined)[] = [];

const RULES: [RegExp, number][] = [
  [/water|kelp|seagrass/, 0x3a5ad8],
  [/lava|magma/, 0xd8601a],
  [/snow|powder_snow|ice/, 0xe8f0ff],
  [/leaves|vine|moss/, 0x3a7a2a],
  [/grass_block|grass|fern|azalea/, 0x5a9a3a],
  [/sand|sandstone/, 0xd8cc90],
  [/terracotta|red_sand/, 0xb06a3a],
  [/log|wood|planks|stem|hyphae/, 0x7a5a32],
  [/dirt|farmland|path|mud|podzol|mycelium/, 0x7a5a3a],
  [/gravel|stone|cobble|andesite|diorite|granite|tuff|deepslate|ore/, 0x7c7c7c],
  [/netherrack|nylium|nether/, 0x7a2a2a],
  [/end_stone|purpur/, 0xd8d898],
  [/obsidian|bedrock|blackstone|basalt/, 0x2a2232],
  [/flower|tulip|poppy|dandelion|orchid|allium|daisy/, 0xd85a8a],
  [/clay/, 0x9aa2b0],
  [/glass/, 0xc8e0e8],
  [/wool|concrete|carpet/, 0xc8c8c8],
];

/** RGB colour of a block state seen from above. */
export function mapColorOf(state: number): number {
  const num = STATE_BLOCK[state]!;
  let c = CACHE[num];
  if (c !== undefined) return c;
  const def = blocks[num]!.def;
  c = def.mapColor ?? RULES.find(([re]) => re.test(def.id))?.[1] ?? 0x8a8a8a;
  CACHE[num] = c;
  return c;
}

export function resetMapColors(): void {
  CACHE = [];
}
