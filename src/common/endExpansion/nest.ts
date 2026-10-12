/**
 * V6 - The End Expansion, phase 3: the Dragon's Nest.
 *
 * A hollow chamber inside the main End island, carved by the server after
 * the dragon's first defeat (src/server/systems/EndStructures.ts). It is
 * never part of terrain generation: the classic End generates as before and
 * the Nest is cut into it afterwards, chunk by chunk, like the Expansion
 * Portal is built.
 *
 * Its plan is deterministic from the seed and the island's shape:
 * - the chamber: a wide, low hollow under the island's middle, wrapped round
 *   a core of Ancient End Bricks that rises under the exit portal (the island
 *   was built around something older), lit dimly by Astral Lanterns and old
 *   crystal growths;
 * - nest hollows in its walls, too many for one dragon, every one empty, some
 *   holding broken shell;
 * - Ender Glyph murals on the core, a broken portal unlike any other (a ring),
 *   3-4 chests (dragon_nest_a..d: the Nest's five lore fragments among them);
 * - the entrance: a crack opening in the ground just in front of the
 *   Expansion Portal, a steep walkable descent into the chamber.
 *
 * It never cuts the island's surface anywhere but the crack, never reaches
 * its underside, and keeps clear of the exit portal, the obsidian pillars,
 * the ring gateways and the Expansion Portal.
 */
import { hash3, hashInts } from '../math/rng';
import { S, stateOf } from '../registry/blocks';
import type { DecorView } from '../gen/decorate/view';
import { boxOf, unionBoxes, type Box } from '../gen/structures/manager';
import { endPillars, exitPortalY, type EndTerrain } from '../gen/end';
import { GLYPH_FACES } from './ancient';
import { EXPANSION_PORTAL_SITE } from './region';

type P3 = [number, number, number];

export interface NestPiece {
  kind: string;
  box: Box;
  build(v: DecorView): void;
}

export interface NestPlan {
  pieces: NestPiece[];
  /** The chamber's extent (players inside it are in the Nest). */
  chamber: Box;
  /** Everything the Nest touches. */
  bounds: Box;
  /** Top of the crack, on the surface in front of the Expansion Portal. */
  entrance: P3;
  /** A place to stand on the chamber floor. */
  floor: P3;
  /** The Nest's broken portal (the centre of its ring; phase 4's "The Dragon's History"). */
  portal: P3;
  chests: P3[];
  hollows: number;
}

/** Room kept round each pillar, under the exit portal and under the Expansion Portal. */
const PILLAR_CLEAR = 4;
const PORTAL_CORE = 7;
const EXPANSION_CLEAR = 7;
/** Solid stone kept under the island's surface and above its underside. */
const ROOF = 8;
const FLOOR = 4;

const chance = (seed: number, x: number, y: number, z: number): number => hash3(seed, x, y, z) / 4294967296;

export function nestPlan(seed: number, terrain: EndTerrain): NestPlan {
  const s = hashInts(seed, 0x4e57);
  const pillars = endPillars(seed);
  const portalY = exitPortalY(terrain);
  const cx = 0;
  const cz = 6;
  const rx = 22;
  const rz = 18;
  // The chamber's height follows the island: a level the middle of it can hold
  let lowTop = 999;
  let highBottom = -1;
  for (let z = cz - rz; z <= cz + rz; z += 3)
    for (let x = cx - rx; x <= cx + rx; x += 3) {
      if (((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 > 0.5) continue;
      const col = terrain.column(x, z);
      if (!col) continue;
      lowTop = Math.min(lowTop, col.top);
      highBottom = Math.max(highBottom, col.bottom);
    }
  const floorY = Math.max(highBottom + FLOOR + 1, 22);
  const ceilY = Math.max(floorY + 8, lowTop - ROOF);
  const cy = (floorY + ceilY) / 2;
  const ry = (ceilY - floorY) / 2;

  /** Whether a block may be cut: never near the pillars, the portals, the surface or the underside. */
  const allowed = (x: number, y: number, z: number, roof = ROOF): boolean => {
    if (Math.hypot(x, z) < PORTAL_CORE) return false;
    if (Math.hypot(x - EXPANSION_PORTAL_SITE.x, z - EXPANSION_PORTAL_SITE.z) < EXPANSION_CLEAR) return false;
    for (const p of pillars) if (Math.hypot(x - p.x, z - p.z) < p.radius + 1 + PILLAR_CLEAR) return false;
    const col = terrain.column(x, z);
    if (!col) return false;
    return y >= col.bottom + FLOOR && y <= col.top - roof;
  };
  /** Inside the chamber's hollow: a flat floor under a low dome whose walls wander a little. */
  const inChamber = (x: number, y: number, z: number): boolean => {
    if (y < floorY || y > ceilY) return false;
    const wob = (chance(s, x >> 2, y >> 2, z >> 2) - 0.5) * 0.16;
    const t = (y - floorY) / (ceilY - floorY);
    return ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 < 1 - t * t + wob;
  };

  // The hollows: round niches round the wall, at two heights
  const hollows: { x: number; y: number; z: number; r: number; shell: boolean }[] = [];
  const n = 16 + (hashInts(s, 1) % 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (chance(s, i, 0, 1) - 0.5) * 0.25;
    const tier = i % 2;
    const hy = Math.round(floorY + 2 + tier * Math.max(3, Math.floor((ceilY - floorY) * 0.4)));
    // In the wall at that height (the dome draws in as it rises)
    const k = Math.sqrt(Math.max(0.05, 1 - ((hy - floorY) / (ceilY - floorY)) ** 2));
    const hx = Math.round(cx + Math.cos(a) * (rx * k + 1.2));
    const hz = Math.round(cz + Math.sin(a) * (rz * k + 1.2));
    if (!allowed(hx, hy, hz, ROOF + 2)) continue;
    hollows.push({ x: hx, y: hy, z: hz, r: 2.6, shell: chance(s, i, 2, 3) < 0.4 });
  }

  // The crack: from the surface in front of the Expansion Portal down into the chamber's far side
  const z0 = EXPANSION_PORTAL_SITE.z - 9;
  const z1 = Math.round(cz + rz * 0.55);
  const top0 = (terrain.column(0, z0)?.top ?? 60) + 1;
  const end = floorY + 1;
  const crackY = (z: number): number => Math.round(top0 + ((end - top0) * (z0 - z)) / (z0 - z1));
  const crackHalf = (z: number, y: number): number => 1 + (chance(s ^ 0xc4ac, 0, y >> 1, z) < 0.35 ? 1 : 0);

  const brick = S('ancient_end_bricks');
  const cracked = S('cracked_ancient_end_bricks');
  const chis = S('chiseled_ancient_end_bricks');
  const glyph = (x: number, y: number, z: number): number => stateOf('ender_glyph_stone', { glyph: String(hash3(s ^ 0x61f, x, y, z) % GLYPH_FACES) });
  const R = Math.max(rx, rz) + 6;
  const pieces: NestPiece[] = [];
  const cols = (v: DecorView, x0: number, z0b: number, x1: number, z1b: number, fn: (x: number, z: number) => void): void => {
    for (let z = Math.max(z0b, v.bz); z <= Math.min(z1b, v.bz + 15); z++) for (let x = Math.max(x0, v.bx); x <= Math.min(x1, v.bx + 15); x++) fn(x, z);
  };

  // 1. The chamber, its hollows, and the old stonework showing through its walls
  pieces.push({
    kind: 'chamber',
    box: boxOf(cx - R, floorY - 3, cz - R, cx + R, ceilY + 3, cz + R),
    build: (v) => {
      cols(v, cx - R, cz - R, cx + R, cz + R, (x, z) => {
        for (let y = floorY - 2; y <= ceilY + 2; y++) {
          if (!allowed(x, y, z, ROOF - 2)) continue;
          let open = inChamber(x, y, z) && allowed(x, y, z);
          if (!open) for (const h of hollows) if (Math.hypot(x - h.x, (y - h.y) * 1.3, z - h.z) < h.r && y >= h.y - 1) open = true;
          if (open) {
            v.set(x, y, z, 0);
            continue;
          }
          // The wall just outside the hollow: here and there the old bricks show
          const near = inChamber(x + 1, y, z) || inChamber(x - 1, y, z) || inChamber(x, y, z + 1) || inChamber(x, y, z - 1) || inChamber(x, y + 1, z);
          if (near && v.get(x, y, z) !== 0 && chance(s ^ 0xb21c, x >> 1, y >> 1, z >> 1) < 0.3) v.set(x, y, z, chance(s, x, y, z) < 0.3 ? cracked : brick);
        }
        // Old brick paving round the core
        const d = Math.hypot(x, z);
        if (d >= PORTAL_CORE && d < PORTAL_CORE + 6 && inChamber(x, floorY, z) && allowed(x, floorY, z) && chance(s ^ 0x9a7e, x, 0, z) < 0.7) v.set(x, floorY - 1, z, chance(s, x, 1, z) < 0.2 ? cracked : brick);
      });
    },
  });
  // 2. The core under the exit portal: faced with Ancient End Bricks, murals of glyphs towards the entrance
  pieces.push({
    kind: 'core',
    box: boxOf(-PORTAL_CORE - 1, floorY - 1, -PORTAL_CORE - 1, PORTAL_CORE + 1, ceilY + 1, PORTAL_CORE + 1),
    build: (v) => {
      cols(v, -PORTAL_CORE - 1, -PORTAL_CORE - 1, PORTAL_CORE + 1, PORTAL_CORE + 1, (x, z) => {
        const d = Math.hypot(x, z);
        if (d < PORTAL_CORE - 1 || d >= PORTAL_CORE + 0.6) return;
        for (let y = floorY; y <= ceilY; y++) {
          // Only where the chamber meets it (its face), never into the stone over the portal
          if (!inChamber(x + Math.sign(x), y, z + Math.sign(z)) || y > portalY - 10) continue;
          const toward = z > 0 && Math.abs(x) < z * 0.9;
          const band = y >= floorY + 2 && y <= floorY + 6;
          v.set(x, y, z, toward && band ? glyph(x, y, z) : y === floorY + 1 || y === floorY + 7 ? chis : chance(s, x, y, z) < 0.25 ? cracked : brick);
        }
      });
    },
  });
  // 3. The crack: open to the sky, three or so blocks wide, stepping down into the chamber
  const crackBox = boxOf(-3, end - 2, z1 - 1, 3, top0 + 4, z0 + 1);
  pieces.push({
    kind: 'crack',
    box: crackBox,
    build: (v) => {
      cols(v, -3, z1, 3, z0, (x, z) => {
        if (Math.hypot(x - EXPANSION_PORTAL_SITE.x, z - EXPANSION_PORTAL_SITE.z) < EXPANSION_CLEAR) return;
        const y = crackY(z);
        const hw = crackHalf(z, y);
        if (Math.abs(x) > hw) return;
        const col = terrain.column(x, z);
        const surf = col ? col.top : y;
        const path = Math.abs(x) <= 1;
        for (let yy = y; yy <= Math.max(surf + 2, y + 3); yy++) v.set(x, yy, z, 0);
        if (path) {
          // A floor to walk on, with a stair where it steps
          const next = crackY(z + 1);
          v.set(x, y - 1, z, next > y ? stateOf('end_stone_bricks_stairs', { facing: 'south' }) : S('end_stone'));
          if (v.get(x, y - 2, z) === 0) v.set(x, y - 2, z, S('end_stone'));
        }
      });
    },
  });
  // 4. Inside: hollows' shells, crystal growths, dim lanterns, the ring portal and the chests
  const portal: P3 = [cx - 12, floorY + 4, cz - 10];
  const chests: P3[] = [];
  const chestN = 3 + (hashInts(s, 2) % 2);
  for (let i = 0; i < chestN; i++) {
    const a = (i / chestN) * Math.PI * 2 + 0.6;
    const x = Math.round(cx + Math.cos(a) * (rx - 4));
    const z = Math.round(cz + Math.sin(a) * (rz - 4));
    chests.push([x, floorY, z]);
  }
  const lanterns: P3[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    lanterns.push([Math.round(cx + Math.cos(a) * rx * 0.6), Math.round(cy + ry * 0.55), Math.round(cz + Math.sin(a) * rz * 0.6)]);
  }
  pieces.push({
    kind: 'contents',
    box: boxOf(cx - R, floorY - 2, cz - R, cx + R, ceilY + 2, cz + R),
    build: (v) => {
      // Shell fragments in some hollows; crystal growths on the floor
      for (const h of hollows) {
        if (!v.inside(h.x, h.z)) continue;
        if (h.shell) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]] as const) if (v.inside(h.x + dx, h.z + dz) && v.get(h.x + dx, h.y - 1, h.z + dz) === 0 && v.get(h.x + dx, h.y - 2, h.z + dz) !== 0) v.set(h.x + dx, h.y - 1, h.z + dz, S('shell_fragments'));
      }
      cols(v, cx - R, cz - R, cx + R, cz + R, (x, z) => {
        if (!inChamber(x, floorY, z) || !allowed(x, floorY, z)) return;
        if (Math.hypot(x, z) < PORTAL_CORE + 1) return;
        if (chance(s ^ 0x6a0, x, floorY, z) < 0.035 && v.get(x, floorY, z) === 0 && v.get(x, floorY - 1, z) !== 0) v.set(x, floorY, z, S('old_crystal_growth'));
      });
      for (const [x, y, z] of lanterns) {
        if (!v.inside(x, z)) continue;
        let yy = y;
        while (yy < ceilY + 2 && v.get(x, yy + 1, z) === 0) yy++;
        if (v.get(x, yy + 1, z) !== 0 && v.get(x, yy, z) === 0) {
          v.set(x, yy, z, stateOf('chain', { axis: 'y' }));
          v.set(x, yy - 1, z, stateOf('astral_lantern', { hanging: 'true' }));
        }
      }
      // The broken portal: a ring, not a frame (no other portal looks like it)
      const [px, py, pz] = portal;
      const ringR = 3.6;
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (!v.inside(x, pz)) continue;
          const d = Math.hypot(dx, dy);
          if (d >= ringR - 0.5 && d < ringR + 0.7) {
            if (chance(s ^ 0x4091, dx, dy, 0) < 0.18 && dy > -2) continue;
            const c = chance(s ^ 0x9071, dx, dy, 1);
            v.set(x, y, pz, c < 0.35 ? S('crying_obsidian') : c < 0.7 ? S('obsidian') : chis);
          } else if (d < ringR - 0.5 && chance(s ^ 0x5e, dx, dy, 2) > 0.12) v.set(x, y, pz, stateOf('dead_portal', { axis: 'x' }));
        }
      for (let dx = -3; dx <= 3; dx++) if (v.inside(px + dx, pz)) for (let dz = -1; dz <= 1; dz++) if (v.inside(px + dx, pz + dz)) v.set(px + dx, floorY - 1, pz + dz, chis);
      // The chests
      chests.forEach(([x, y, z], i) => {
        if (!v.inside(x, z)) return;
        v.set(x, y - 1, z, brick);
        v.set(x, y, z, stateOf('chest', { facing: 'north' }));
        v.setBlockEntity(x, y, z, { type: 'chest', loot: `chest/dragon_nest_${'abcd'[i]}`, lootSeed: hashInts(s, x, y, z) });
      });
    },
  });
  const chamber = boxOf(cx - rx - 3, floorY - 1, cz - rz - 3, cx + rx + 3, ceilY + 1, cz + rz + 3);
  return {
    pieces,
    chamber,
    bounds: unionBoxes(pieces.map((p) => p.box)),
    entrance: [0, top0, z0],
    floor: [cx + rx - 6, floorY, cz],
    portal,
    chests,
    hollows: hollows.length,
  };
}

/** Whether a position lies inside the Nest's chamber (or its crack below the surface). */
export function inNest(plan: NestPlan, x: number, y: number, z: number): boolean {
  const b = plan.chamber;
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;
}
