/**
 * V6 phase 3 browser check helper: where the Expanded End's structures
 * generated in the e2e world (seed given as the argument), and where to
 * stand to look at each. Prints JSON:
 *
 * - `structures`: the start nearest the arrival platform of each End City
 *   variant and giant structure (missing kinds are left out: the e2e builds
 *   those from the Admin Panel), each with a camera spot outside it whose
 *   line of sight to its middle is clear of terrain, and a spot inside it
 *   (on top of its biggest piece);
 * - `glyphs`: a wall of Ender Glyph Stone in one of them, with a spot to
 *   stand in front of it.
 *
 *   npx tsx tests/e2e/v6-structure-sites.ts v6-e2e
 */
import { initItems } from '../../src/common/registry/items';
import { blockOf } from '../../src/common/registry/blocks';
import { seedFromString } from '../../src/common/math/rng';
import { createGenerator } from '../../src/common/gen/generator';
import type { EndGenerator } from '../../src/common/gen/end';
import type { Start } from '../../src/common/gen/structures/manager';
import { Site } from '../../src/common/gen/structures/expanded/plan';
import { EXPANSION_STRUCTURE_IDS } from '../../src/common/endExpansion/structures';

initItems();
const g = createGenerator('end', seedFromString(process.argv[2] ?? 'v6-e2e')) as EndGenerator;
const ex = g.terrain.expansion;
const site = new Site(ex);
const a = ex.arrival();

function nearest(id: string): Start | null {
  const it = g.expansionSteps(id, a.x, a.z);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/** A camera spot outside a start, looking at its middle over open air. */
function camera(s: Start): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const b = s.bounds;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const size = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  const ty = s.y + Math.min(18, (b.y1 - s.y) * 0.4);
  const dist = Math.min(105, Math.max(26, size * 0.75));
  let best = { score: -1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const x = cx + Math.cos(ang) * dist;
    const z = cz + Math.sin(ang) * dist;
    const y = ty + dist * 0.32;
    let score = 0;
    // Clear sight: terrain below the line all the way in, and the camera itself in the open
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const lx = x + (cx - x) * t * 0.85;
      const lz = z + (cz - z) * t * 0.85;
      const ly = y + (ty - y) * t * 0.85;
      const top = site.ground(Math.floor(lx), Math.floor(lz));
      if (top === null || top < ly - 2) score++;
    }
    // Rather looking over land than from out in the void
    if (site.ground(Math.floor(x), Math.floor(z)) !== null) score += 0.5;
    if (score > best.score) {
      const yaw = Math.atan2(-(cx - x), -(cz - z));
      const pitch = Math.atan2(y + 1.62 - ty, dist);
      best = { score, x: Math.round(x * 2) / 2, y: Math.round(y), z: Math.round(z * 2) / 2, yaw, pitch };
    }
  }
  const { score: _s, ...cam } = best;
  return cam;
}

/** A spot standing on top of a start's biggest piece (inside the structure, for discovery). */
function inside(s: Start): { x: number; y: number; z: number } {
  const vol = (b: Start['bounds']): number => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) * (b.z1 - b.z0 + 1);
  const p = [...s.pieces].sort((a, b) => vol(b.box) - vol(a.box))[0]!;
  return { x: Math.floor((p.box.x0 + p.box.x1) / 2) + 0.5, y: p.box.y1 + 1, z: Math.floor((p.box.z0 + p.box.z1) / 2) + 0.5 };
}

const structures: Record<string, { x: number; y: number; z: number; bounds: Start['bounds']; cam: ReturnType<typeof camera>; inside: ReturnType<typeof inside> }> = {};
for (const id of EXPANSION_STRUCTURE_IDS) {
  const s = nearest(id);
  if (s) structures[id] = { x: s.x, y: s.y, z: s.z, bounds: s.bounds, cam: camera(s), inside: inside(s) };
}

/** The densest patch of Ender Glyph Stone with open air in front, in the given starts. */
function glyphWall(kinds: string[]): { x: number; y: number; z: number; cam: { x: number; y: number; z: number; yaw: number; pitch: number } } | null {
  for (const kind of kinds) {
    const s = nearest(kind);
    if (!s) continue;
    const glyph = new Set<string>();
    const air = new Set<string>();
    const b = s.bounds;
    for (let cx = b.x0 >> 4; cx <= b.x1 >> 4; cx++)
      for (let cz = b.z0 >> 4; cz <= b.z1 >> 4; cz++) {
        const c = g.generate(cx, cz);
        for (let y = Math.max(1, b.y0); y <= Math.min(250, b.y1); y++)
          for (let z = 0; z < 16; z++)
            for (let x = 0; x < 16; x++) {
              const id = blockOf(c.get(x, y, z)).id;
              const k = `${(cx << 4) + x},${y},${(cz << 4) + z}`;
              if (id === 'ender_glyph_stone') glyph.add(k);
              else if (id === 'air') air.add(k);
            }
      }
    let best: { n: number; x: number; y: number; z: number; dx: number; dz: number } | null = null;
    for (const k of glyph) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        let open = true;
        for (let d = 1; d <= 4 && open; d++) for (const dy of [-1, 0, 1]) if (!air.has(`${x + dx * d},${y + dy},${z + dz * d}`)) open = false;
        if (!open) continue;
        // Glyphs in the wall's plane around it
        let n = 0;
        for (let u = -3; u <= 3; u++) for (let v = -2; v <= 2; v++) if (glyph.has(`${x + (dz ? u : 0)},${y + v},${z + (dx ? u : 0)}`)) n++;
        if (!best || n > best.n) best = { n, x, y, z, dx, dz };
      }
    }
    if (best && best.n >= 4) {
      const cam = { x: best.x + 0.5 + best.dx * 3.5, y: best.y - 1, z: best.z + 0.5 + best.dz * 3.5, yaw: Math.atan2(best.dx, best.dz), pitch: 0.12 };
      return { x: best.x, y: best.y, z: best.z, cam };
    }
  }
  return null;
}

console.log(JSON.stringify({ arrival: { x: a.x, y: a.floor, z: a.z }, structures, glyphs: glyphWall(['end_library', 'end_ruins', 'end_colossus', 'fallen_city', 'end_fortress']) }));
