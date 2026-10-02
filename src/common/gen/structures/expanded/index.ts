/**
 * V6 phase 3: the Expanded End's structure types, for the End generator's
 * second structure manager (generator 8 worlds only).
 *
 * The giant structures share one region grid (GIANT_SPACING chunks): each
 * region looks for a spot in a biome that has a giant and plans one there.
 * The eight variants have their own grids. Types are listed rarest and
 * largest first and the manager drops any start that would overlap one of an
 * earlier type, so two big structures never overlap.
 */
import { Random, hashInts } from '../../../math/rng';
import { EXPANSION_INNER, EXPANSION_OUTER, inExpansion } from '../../../endExpansion/region';
import { END_VARIANTS, GIANT_SALT, GIANT_SEPARATION, GIANT_SPACING, GIANT_TYPE } from '../../../endExpansion/structures';
import type { ExpansionTerrain } from '../../endExpansion';
import type { Start, StructureType } from '../manager';
import { GIANT_PLANS, giantFor } from './giants';
import { Site, type Anchor } from './plan';
import { VARIANT_PLANS, VARIANT_REACH } from './variants';

/** Blocks a giant's spot may move from its region's start chunk to find a biome that has one. */
const GIANT_SEARCH = 128;
/** Farthest a giant reaches from its spot. */
const GIANT_REACH = 132;

/**
 * Blocks a variant may move from its region's start chunk to find its biome
 * and room. Only the Metropolis searches: it lives in the End Highlands
 * alone and needs a lot of them, and without a search it would be rarer than
 * the Palace, which is meant to be the rarest.
 */
const VARIANT_SEARCH: Record<string, { reach: number; tries: number }> = {
  end_metropolis: { reach: 112, tries: 10 },
};

/** Variant order in the manager: rarest and largest first. */
const VARIANT_ORDER = ['end_palace', 'end_metropolis', 'end_shipyard', 'end_observatory', 'end_library', 'end_settlement', 'end_ruins', 'end_outpost'];

/** Within `pad` blocks of the ring. */
function nearRing(x: number, z: number, pad: number): boolean {
  const d = Math.hypot(x, z);
  return d > EXPANSION_INNER - pad && d < EXPANSION_OUTER + pad;
}

export function expansionStructureTypes(ex: ExpansionTerrain): StructureType[] {
  const site = new Site(ex);
  const giant: StructureType = {
    id: GIANT_TYPE,
    spacing: GIANT_SPACING,
    separation: GIANT_SEPARATION,
    salt: GIANT_SALT,
    radius: Math.ceil((GIANT_SEARCH + GIANT_REACH) / 16) + 1,
    candidate: () => true,
    plan(ctx, cx, cz, rng) {
      for (let t = 0; t < 12; t++) {
        const x = (cx << 4) + 8 + (t ? rng.int(GIANT_SEARCH * 2 + 1) - GIANT_SEARCH : 0);
        const z = (cz << 4) + 8 + (t ? rng.int(GIANT_SEARCH * 2 + 1) - GIANT_SEARCH : 0);
        if (!inExpansion(x, z) || site.edge(x, z) < 70) continue;
        const id = giantFor(site.biomeId(x, z), rng);
        if (!id) continue;
        const s = GIANT_PLANS[id]!(site, { x, z }, rng, hashInts(ctx.seed, x, z, GIANT_SALT));
        if (s) return s;
      }
      return null;
    },
  };
  const variants = VARIANT_ORDER.map((id): StructureType => {
    const info = END_VARIANTS.find((v) => v.id === id)!;
    const search = VARIANT_SEARCH[id];
    const fits = (x: number, z: number): boolean => inExpansion(x, z) && info.biomes.includes(site.biomeId(x, z));
    return {
      id,
      spacing: info.spacing,
      separation: info.separation,
      salt: info.salt,
      radius: Math.ceil((VARIANT_REACH[id]! + (search?.reach ?? 0)) / 16) + 1,
      candidate: (_ctx, x, z) => (search ? nearRing(x, z, search.reach) : fits(x, z)),
      plan(ctx, cx, cz, rng) {
        for (let t = 0; t < (search?.tries ?? 1); t++) {
          const x = (cx << 4) + 4 + rng.int(9) + (t ? rng.int(search!.reach * 2 + 1) - search!.reach : 0);
          const z = (cz << 4) + 4 + rng.int(9) + (t ? rng.int(search!.reach * 2 + 1) - search!.reach : 0);
          if (!fits(x, z)) continue;
          const s = VARIANT_PLANS[id]!(site, { x, z }, rng, hashInts(ctx.seed, x, z, info.salt));
          if (s) return s;
        }
        return null;
      },
    };
  });
  return [giant, ...variants];
}

/**
 * Plans a structure at a spot whatever the biome or land (Admin Panel:
 * "Generate a structure here"). Returns null for an unknown kind.
 */
export function planExpansionStructureAt(ex: ExpansionTerrain, kind: string, a: Anchor, seed: number): Start | null {
  const site = new Site(ex);
  const rngSeed = hashInts(seed, a.x, a.z, a.y ?? 0, 0xad31);
  const plan = VARIANT_PLANS[kind] ?? GIANT_PLANS[kind];
  if (!plan) return null;
  return plan(site, { ...a, force: true }, new Random(rngSeed), rngSeed);
}

/** A start's layout signature: its pieces' kinds and positions relative to its centre (tests compare these across seeds). */
export function layoutOf(s: Start): string[] {
  return s.pieces.map((p) => `${(p as { kind?: string }).kind ?? '?'}@${p.box.x0 - s.x},${p.box.y0 - s.y},${p.box.z0 - s.z}:${p.box.x1 - p.box.x0}x${p.box.z1 - p.box.z0}`);
}

export { Site };
