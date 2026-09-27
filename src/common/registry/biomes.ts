import { BIOME_DEFS, type BiomeDef } from '../data/biomes';

export interface Biome extends BiomeDef {
  readonly num: number;
}

export const biomes: Biome[] = BIOME_DEFS.map((d, i) => ({ ...d, num: i }));
const byId = new Map(biomes.map((b) => [b.id, b]));

export function biome(id: string): Biome {
  const b = byId.get(id);
  if (!b) throw new Error(`Unknown biome ${id}`);
  return b;
}

export function biomeNum(id: string): number {
  return biome(id).num;
}

export function biomeOf(num: number): Biome {
  return biomes[num] ?? biomes[0]!;
}
