/**
 * V6 phase 3: the five giant structures of the Expanded End.
 *
 * At most one stands in each giant region (GIANT_SPACING chunks square): the
 * region's plan looks for a spot in a biome that has one, picks which by the
 * biome's weights and plans it. Each is planned once and built chunk by
 * chunk from many small pieces; their loops are clipped to the chunk being
 * generated and take their randomness from position hashes, so any order of
 * generation gives the same blocks.
 *
 * - End Colossus: a broken statue in pieces (torso, head, an arm, a hand).
 * - Crystal Cathedral: nave, transept, apse, chapels and crystal spires.
 * - Void Observatory: telescope towers round a dome hung over a bored hole.
 * - End Fortress: curtain walls, towers, gatehouses, barracks and a keep.
 * - The Fallen City: dozens of tilted, sunk and broken towers and debris.
 */
import { Random, hash3, hashInts } from '../../../math/rng';
import { S, stateOf } from '../../../registry/blocks';
import { GIANT_STRUCTURES } from '../../../endExpansion/structures';
import type { DecorView } from '../../decorate/view';
import { Builder, type Rotation } from '../builder';
import { boxOf, type Box, type Start } from '../manager';
import { RuinBuilder, battlements, brokenPortal, chance, chest, doorway, dome, footing, footprint, glyphWall, lamp, organ, platform, rectOf, soft, st, storey, telescope, tower, walkway, type P3, type Palette, type Rect } from './kit';
import { DIRS, DXZ, FRONT_OF, Plan, rectBox, runBuilder, runFrame, type Anchor, type Site } from './plan';

export type GiantPlan = (site: Site, a: Anchor, rng: Random, seed: number) => Start | null;

const half = (n: number): number => n >> 1;

/** Runs `fn` over the columns of a rectangle that lie in the view's chunk. */
function cols(v: DecorView, x0: number, z0: number, x1: number, z1: number, fn: (x: number, z: number) => void): void {
  const a = Math.max(x0, v.bx);
  const b = Math.min(x1, v.bx + 15);
  const c = Math.max(z0, v.bz);
  const d = Math.min(z1, v.bz + 15);
  for (let z = c; z <= d; z++) for (let x = a; x <= b; x++) fn(x, z);
}

function baseFor(site: Site, a: Anchor, r: Rect, minShare: number, maxSpread: number, q = 0.5): number | null {
  if (a.force) return a.y ?? (site.level(r, 0, q) ?? 64) + 1;
  if (!site.fits(r, 12)) return null;
  const lv = site.level(r, minShare, q, 4);
  if (lv === null || site.spread(r, 4) > maxSpread) return null;
  return lv + 1;
}

// ---------------------------------------------------------------------------
// End Colossus
// ---------------------------------------------------------------------------

/** An oriented frame: world offsets from a centre into a part's own axes (yaw, then lean). */
class Orient {
  private readonly cy: number;
  private readonly sy: number;
  private readonly cp: number;
  private readonly sp: number;
  private readonly cr: number;
  private readonly sr: number;

  constructor(
    readonly cx: number,
    readonly cyy: number,
    readonly cz: number,
    yaw: number,
    pitch: number,
    roll: number,
  ) {
    this.cy = Math.cos(yaw);
    this.sy = Math.sin(yaw);
    this.cp = Math.cos(pitch);
    this.sp = Math.sin(pitch);
    this.cr = Math.cos(roll);
    this.sr = Math.sin(roll);
  }

  /** World point -> local (x right, y up, z forward). */
  local(x: number, y: number, z: number): P3 {
    const dx = x - this.cx;
    const dy = y - this.cyy;
    const dz = z - this.cz;
    // Undo yaw
    const x1 = dx * this.cy + dz * this.sy;
    const z1 = -dx * this.sy + dz * this.cy;
    // Undo pitch (about x)
    const y2 = dy * this.cp - z1 * this.sp;
    const z2 = dy * this.sp + z1 * this.cp;
    // Undo roll (about z)
    const x3 = x1 * this.cr + y2 * this.sr;
    const y3 = -x1 * this.sr + y2 * this.cr;
    return [x3, y3, z2];
  }

  /** Local -> world. */
  world(lx: number, ly: number, lz: number): P3 {
    const x1 = lx * this.cr - ly * this.sr;
    const y1 = lx * this.sr + ly * this.cr;
    const y2 = y1 * this.cp + lz * this.sp;
    const z2 = -y1 * this.sp + lz * this.cp;
    const x3 = x1 * this.cy - z2 * this.sy;
    const z3 = x1 * this.sy + z2 * this.cy;
    return [Math.round(this.cx + x3), Math.round(this.cyy + y2), Math.round(this.cz + z3)];
  }
}

/** Fills the voxels of a shape: `depth(local)` > 0 inside (blocks to its surface), `mat` picks the block. */
function voxel(v: DecorView, o: Orient, reach: number, depth: (l: P3) => number, mat: (l: P3, d: number, x: number, y: number, z: number) => number | null): void {
  const y0 = Math.max(1, Math.floor(o.cyy - reach));
  const y1 = Math.min(250, Math.ceil(o.cyy + reach));
  cols(v, Math.floor(o.cx - reach), Math.floor(o.cz - reach), Math.ceil(o.cx + reach), Math.ceil(o.cz + reach), (x, z) => {
    for (let y = y0; y <= y1; y++) {
      const l = o.local(x + 0.5, y + 0.5, z + 0.5);
      const d = depth(l);
      if (d <= 0) continue;
      const s = mat(l, d, x, y, z);
      if (s !== null) v.set(x, y, z, s);
    }
  });
}

const boxDepth = (hx: number, hy: number, hz: number) => (l: P3): number => Math.min(hx - Math.abs(l[0]), hy - Math.abs(l[1]), hz - Math.abs(l[2]));

export const planColossus: GiantPlan = (site, a, rng, seed) => {
  const r = rectOf(a.x - 14, a.z - 14, a.x + 14, a.z + 14);
  const y = baseFor(site, a, r, 0.6, 16);
  if (y === null) return null;
  if (!a.force && !site.fits(rectOf(a.x - 60, a.z - 60, a.x + 60, a.z + 60), 4)) return null;
  const pl = new Plan('end_colossus', seed, site, a.biome ?? site.biomeId(a.x, a.z), a.force);
  const yaw = rng.next() * Math.PI * 2;
  const brick = S('ancient_end_bricks');
  const cracked = S('cracked_ancient_end_bricks');
  const chis = S('chiseled_ancient_end_bricks');
  const core = S('dark_end_stone');
  const shellOf = (x: number, y2: number, z: number, d: number): number => (d < 1.6 ? (chance(seed, x, y2, z) < 0.28 ? cracked : brick) : core);
  // The torso: a broad, tilted block, sunk into the island, broken off at the waist
  const tHx = 10 + rng.int(3);
  const tHy = 13 + rng.int(3);
  const tHz = 6;
  const torso = new Orient(a.x, y + tHy - 5, a.z, yaw, (rng.next() - 0.5) * 0.35, (rng.next() - 0.5) * 0.3);
  const tReach = Math.hypot(tHx, tHy + 4, tHz) + 1;
  pl.add('torso', boxOf(a.x - tReach, y - 8, a.z - tReach, a.x + tReach, y + tHy * 2 + 4, a.z + tReach), (v) => {
    voxel(
      v,
      torso,
      tReach,
      (l) => {
        // Shoulders slope in towards the neck; the waist ends in a ragged break
        const [lx, ly, lz] = l;
        if (ly < -tHy + 2 + Math.floor(chance(seed ^ 0xb7, Math.round(lx / 2), 0, Math.round(lz / 2)) * 4)) return 0;
        if (ly > tHy && Math.abs(lx) < 3.5 && Math.abs(lz) < 3.5 && ly < tHy + 3) return Math.min(3.5 - Math.abs(lx), 3.5 - Math.abs(lz), tHy + 3 - ly);
        const sh = ly > tHy - 4 ? (ly - (tHy - 4)) * 1.4 : 0;
        return Math.min(tHx - sh - Math.abs(lx), tHy - Math.abs(ly), tHz - Math.abs(lz));
      },
      (l, d, x, yy, z) => {
        // A band of glyphs across the chest
        if (d < 1.6 && l[2] > tHz - 1.6 && l[1] > tHy - 9 && l[1] < tHy - 5) return st.glyph(seed, x, yy, z);
        if (d < 1.6 && Math.abs(l[1] - (tHy - 3)) < 0.5) return chis;
        return shellOf(x, yy, z, d);
      },
    );
    // Rope down its back, from shoulder to ground: a way up
    const back = torso.world(tHx - 4, tHy - 4, -tHz - 1);
    for (let yy = back[1]; yy > y - 6; yy--) if (v.inside(back[0], back[2]) && soft(v.get(back[0], yy, back[2]))) v.set(back[0], yy, back[2], stateOf('chorus_rope', { axis: 'y' }));
  });
  // The head floats over the neck, drifted to one side: a hollow chamber with two slits for eyes
  const gap = 5 + rng.int(3);
  const neck = torso.world(0, tHy + 3, 0);
  const hH = 8;
  const head = new Orient(neck[0] + Math.round(Math.cos(yaw + 1.2) * 3), neck[1] + gap + hH, neck[2] + Math.round(Math.sin(yaw + 1.2) * 3), yaw + (rng.next() - 0.5) * 0.8, (rng.next() - 0.5) * 0.4, (rng.next() - 0.5) * 0.5);
  const hReach = 13;
  const cseed = pl.sub(0xcac4e);
  pl.add('head', boxOf(head.cx - hReach, head.cyy - hReach - gap - 2, head.cz - hReach, head.cx + hReach, head.cyy + hReach, head.cz + hReach), (v) => {
    voxel(
      v,
      head,
      hReach,
      (l) => {
        const outer = boxDepth(7, hH, 7)(l);
        if (outer <= 0) return 0;
        // The chamber, and a way in from below (where the neck once was)
        if (Math.abs(l[0]) < 4.5 && Math.abs(l[1]) < 5.5 && Math.abs(l[2]) < 4.5) return 0;
        if (l[1] < -4 && Math.abs(l[0]) < 1.6 && Math.abs(l[2]) < 1.6) return 0;
        // Eye slits on the face
        if (l[2] > 5 && Math.abs(l[1] - 2) < 0.8 && Math.abs(Math.abs(l[0]) - 3) < 1.6) return 0;
        return outer;
      },
      (l, d, x, yy, z) => {
        const inner = Math.abs(l[0]) < 5.6 && Math.abs(l[1]) < 6.6 && Math.abs(l[2]) < 5.6;
        if (inner && l[1] > -5) return st.glyph(seed, x, yy, z);
        return shellOf(x, yy, z, d);
      },
    );
    // The chamber's floor holds the weapon cache
    const c = head.world(0, -5, 2);
    const c2 = head.world(2, -5, -1);
    for (const [px, py, pz] of [c, c2]) if (v.inside(px, pz)) v.set(px, py - 1, pz, brick);
    if (v.inside(c[0], c[2])) {
      v.set(c[0], c[1], c[2], stateOf('chest', { facing: 'south' }));
      v.setBlockEntity(c[0], c[1], c[2], { type: 'chest', loot: 'chest/end_colossus_cache', lootSeed: hashInts(cseed, 1) });
    }
    if (v.inside(c2[0], c2[2])) {
      v.set(c2[0], c2[1], c2[2], stateOf('chest', { facing: 'north' }));
      v.setBlockEntity(c2[0], c2[1], c2[2], { type: 'chest', loot: 'chest/end_colossus', lootSeed: hashInts(cseed, 2) });
    }
    // A rope hangs from the hole under the head down to the neck
    const hole = head.world(0, -hH - 0.5, 0);
    for (let yy = hole[1]; yy >= neck[1] - 1; yy--) if (v.inside(hole[0], hole[2]) && soft(v.get(hole[0], yy, hole[2]))) v.set(hole[0], yy, hole[2], stateOf('chorus_rope', { axis: 'y' }));
    const lampAt = head.world(0, 4, 0);
    if (v.inside(lampAt[0], lampAt[2])) v.set(lampAt[0], lampAt[1], lampAt[2], S('astral_lantern'));
  });
  // An arm, broken off, floating beside the torso
  const side = rng.chance(0.5) ? 1 : -1;
  const sh = torso.world(side * (tHx + 7), tHy - 6, 0);
  const elbowLen = 20 + rng.int(6);
  const aYaw = yaw + side * (0.6 + rng.next() * 0.6);
  const armEnd: P3 = [sh[0] + Math.round(Math.cos(aYaw) * elbowLen), sh[1] - 4 - rng.int(5), sh[2] + Math.round(Math.sin(aYaw) * elbowLen)];
  const armR = 3.5;
  const capsule = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, rad: number) => (x: number, yy: number, z: number): number => {
    const vx = bx - ax;
    const vy = by - ay;
    const vz = bz - az;
    const L2 = vx * vx + vy * vy + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (yy - ay) * vy + (z - az) * vz) / L2));
    return rad - Math.hypot(x - (ax + vx * t), yy - (ay + vy * t), z - (az + vz * t));
  };
  const armD = capsule(sh[0], sh[1], sh[2], armEnd[0], armEnd[1], armEnd[2], armR);
  const armBox = boxOf(Math.min(sh[0], armEnd[0]) - 5, Math.min(sh[1], armEnd[1]) - 5, Math.min(sh[2], armEnd[2]) - 5, Math.max(sh[0], armEnd[0]) + 5, Math.max(sh[1], armEnd[1]) + 5, Math.max(sh[2], armEnd[2]) + 5);
  pl.add('arm', armBox, (v) => {
    cols(v, armBox.x0, armBox.z0, armBox.x1, armBox.z1, (x, z) => {
      for (let yy = armBox.y0; yy <= armBox.y1; yy++) {
        const d = armD(x + 0.5, yy + 0.5, z + 0.5);
        if (d > 0) v.set(x, yy, z, shellOf(x, yy, z, d));
      }
    });
  });
  // The hand: a palm and four fingers, lower down near the arm's end
  const hand = new Orient(armEnd[0] + Math.round(Math.cos(aYaw) * 9), Math.max(y + 2, armEnd[1] - 6), armEnd[2] + Math.round(Math.sin(aYaw) * 9), aYaw + Math.PI / 2, 0.6 + rng.next() * 0.6, (rng.next() - 0.5) * 0.6);
  pl.add('hand', boxOf(hand.cx - 12, hand.cyy - 12, hand.cz - 12, hand.cx + 12, hand.cyy + 12, hand.cz + 12), (v) => {
    voxel(
      v,
      hand,
      12,
      (l) => {
        const palm = boxDepth(5, 6, 2.5)(l);
        let best = palm;
        for (let f = 0; f < 4; f++) {
          const fx = -3.6 + f * 2.4;
          const len = f === 1 || f === 2 ? 6 : 5;
          best = Math.max(best, Math.min(1.1 - Math.abs(l[0] - fx), len - Math.abs(l[1] - (6 + len / 2)), 1.2 - Math.abs(l[2])));
        }
        best = Math.max(best, Math.min(1.2 - Math.abs(l[0] - 6.5), 3 - Math.abs(l[1] - 1), 1.2 - Math.abs(l[2] - 1)));
        return best;
      },
      (_l, d, x, yy, z) => shellOf(x, yy, z, d),
    );
  });
  return pl.start(a.x, y, a.z);
};

// ---------------------------------------------------------------------------
// Crystal Cathedral
// ---------------------------------------------------------------------------
export const planCathedral: GiantPlan = (site, a, rng, seed) => {
  const Wn = 15 + 2 * rng.int(3);
  const Ln = 44 + 2 * rng.int(9);
  const Hn = 20 + rng.int(9);
  const arm = 8 + rng.int(5);
  const St = Wn + arm * 2;
  const Wt = 11 + 2 * rng.int(2);
  const zt = Math.floor(Ln * 0.62);
  const apse = half(Wn);
  const W = St;
  const D = Ln + apse + 1;
  const rot = rng.int(4) as Rotation;
  const r = footprint(a.x - half(rot & 1 ? D : W), a.z - half(rot & 1 ? W : D), rot, W, D);
  const y = baseFor(site, a, r, 0.45, 18, 0.6);
  if (y === null) return null;
  const pl = new Plan('crystal_cathedral', seed, site, 'end_crystal_fields', a.force);
  const p = pl.pal;
  const crystal = S('crystalline_end_stone_bricks');
  const pol = S('polished_crystalline_end_stone');
  const glass = S('crystal_glass');
  const nx0 = half(W) - half(Wn);
  const nx1 = nx0 + Wn - 1;
  const fb = (v: DecorView): Builder => new Builder(v, r.x0, y, r.z0, rot, W, D);
  const local = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => {
    const b = fb(null as unknown as DecorView);
    const xs = [b.wx(x0, z0), b.wx(x1, z1)];
    const zs = [b.wz(x0, z0), b.wz(x1, z1)];
    return boxOf(Math.min(...xs) - 1, y + y0, Math.min(...zs) - 1, Math.max(...xs) + 1, y + y1, Math.max(...zs) + 1);
  };
  const L = (lx: number, ly: number, lz: number): P3 => {
    const b = fb(null as unknown as DecorView);
    return [b.wx(lx, lz), y + ly, b.wz(lx, lz)];
  };
  /** A pointed roof over a span along z, x0..x1 wide, starting at height h. */
  const roofOver = (b: Builder, x0: number, x1: number, z0: number, z1: number, h: number): void => {
    const span = x1 - x0;
    for (let i = 0; i <= half(span); i++)
      for (let z = z0; z <= z1; z++) {
        b.set(x0 + i, h + i, z, glass);
        b.set(x1 - i, h + i, z, glass);
        if (z === z0 || z === z1) for (let x = x0 + i + 1; x < x1 - i; x++) b.set(x, h + i, z, crystal);
        if (i === half(span)) b.set(x0 + i, h + i + 1, z, crystal);
      }
  };
  // The nave, in segments: tall walls of crystal glass windows between buttresses
  const segs = Math.ceil(Ln / 16);
  for (let sgi = 0; sgi < segs; sgi++) {
    const z0 = sgi * 16;
    const z1 = Math.min(Ln, z0 + 15);
    pl.add(`nave:${sgi}`, local(nx0 - 2, -18, z0, nx1 + 2, Hn + half(Wn) + 3, z1), (v) => {
      const b = fb(v);
      for (let z = z0; z <= z1; z++) {
        for (let x = nx0; x <= nx1; x++) {
          b.foundation(x, z, -1, crystal, 18);
          b.set(x, 0, z, (x + z) % 2 ? pol : crystal);
          for (let k = 1; k < Hn; k++) {
            const wall = x === nx0 || x === nx1;
            if (!wall) b.set(x, k, z, 0);
            else if (z % 4 === 0) b.set(x, k, z, crystal);
            else b.set(x, k, z, k > 2 && k < Hn - 2 ? glass : crystal);
          }
        }
        if (z % 4 === 0) {
          // Buttresses outside the walls
          for (let k = 0; k < Hn - 4; k++) {
            b.set(nx0 - 1, k, z, crystal);
            b.set(nx1 + 1, k, z, crystal);
            if (k < Hn / 2) {
              b.set(nx0 - 2, k, z, crystal);
              b.set(nx1 + 2, k, z, crystal);
            }
          }
          b.set(half(W), Hn - 3, z, S('crystal_lamp'));
        }
      }
      roofOver(b, nx0, nx1, z0, z1, Hn);
      if (z0 === 0) {
        // The great doors and a rose window
        doorway(b, half(W), 1, 0, 3, 5);
        for (let k = 0; k <= 3; k++) for (let dx = -k; dx <= k; dx++) b.set(half(W) + dx, Hn - 3 - k, 0, glass);
      }
    });
  }
  // The transept arms
  pl.add('transept', local(0, -18, zt - half(Wt), W - 1, Hn + half(Wt) + 3, zt + half(Wt)), (v) => {
    const b = fb(v);
    for (let x = 0; x < W; x++)
      for (let z = zt - half(Wt); z <= zt + half(Wt); z++) {
        b.foundation(x, z, -1, crystal, 18);
        b.set(x, 0, z, pol);
        const wall = x === 0 || x === W - 1 || ((z === zt - half(Wt) || z === zt + half(Wt)) && (x < nx0 || x > nx1));
        for (let k = 1; k < Hn; k++) {
          if (wall) b.set(x, k, z, k > 2 && k < Hn - 3 && (x + z) % 3 ? glass : crystal);
          else b.set(x, k, z, 0);
        }
      }
    for (let x = 0; x < W; x++)
      for (let i = 0; i <= half(Wt); i++) {
        b.set(x, Hn + i, zt - half(Wt) + i, glass);
        b.set(x, Hn + i, zt + half(Wt) - i, glass);
      }
  });
  // The apse, where the organ stands
  const oseed = pl.sub(0x04a2);
  pl.add('apse', local(nx0 - 1, -18, Ln, nx1 + 1, Hn + apse + 2, D - 1), (v) => {
    const b = fb(v);
    for (let z = Ln; z <= D - 1; z++)
      for (let x = nx0; x <= nx1; x++) {
        const d = Math.hypot(x - half(W), z - Ln);
        if (d > apse + 0.4) continue;
        b.foundation(x, z, -1, crystal, 18);
        b.set(x, 0, z, pol);
        for (let k = 1; k < Hn + Math.max(0, apse - d); k++) b.set(x, k, z, d > apse - 0.8 ? (k % 4 === 0 ? crystal : glass) : 0);
      }
    organ(b, half(W) - 5, 1, Ln + apse - 2, 11, oseed);
    chest(b, half(W) + 6, 1, Ln + 1, 'north', 'chest/crystal_cathedral', oseed);
  });
  // Side chapels with mite nests
  const chapels = 3 + rng.int(3);
  const step = Math.floor((zt - half(Wt) - 6) / chapels);
  let chests = 0;
  for (let i = 0; i < chapels; i++)
    for (const sgn of [-1, 1]) {
      const cz = 4 + i * step + half(step);
      const cx0 = sgn < 0 ? nx0 - 6 : nx1 + 1;
      const cseed = pl.sub(i, sgn, 0xc4a9);
      const nest = chance(cseed, 1, 2, 3) < 0.7;
      const loot = chests < 4 && chance(cseed, 3, 2, 1) < 0.55;
      if (loot) chests++;
      pl.add(`chapel:${i}:${sgn}`, local(cx0 - 1, -18, cz - 3, cx0 + 6, 11, cz + 3), (v) => {
        const b = fb(v);
        for (let x = cx0; x < cx0 + 6; x++)
          for (let z = cz - 2; z <= cz + 2; z++) {
            b.foundation(x, z, -1, crystal, 18);
            b.set(x, 0, z, pol);
            const outer = (sgn < 0 ? x === cx0 : x === cx0 + 5) || z === cz - 2 || z === cz + 2;
            for (let k = 1; k <= 8; k++) b.set(x, k, z, outer ? (k > 2 && k < 7 && (x + k) % 2 ? glass : crystal) : k === 8 ? crystal : 0);
          }
        // Open to the nave
        for (let k = 1; k <= 6; k++) for (let dz = -1; dz <= 1; dz++) b.set(sgn < 0 ? nx0 : nx1, k, cz + dz, 0);
        if (nest)
          for (let x = cx0 + 1; x < cx0 + 5; x++)
            for (let z = cz - 1; z <= cz + 1; z++) {
              if (chance(cseed, x, 1, z) < 0.55) b.set(x, 1, z, S('end_crystal_cluster'));
              if (chance(cseed, x, 7, z) < 0.3) b.set(x, 7, z, S('end_crystal_cluster'));
            }
        if (loot) chest(b, sgn < 0 ? cx0 + 1 : cx0 + 4, 1, cz, sgn < 0 ? 'east' : 'west', 'chest/crystal_cathedral', cseed);
        b.set(sgn < 0 ? cx0 + 2 : cx0 + 3, 7, cz, S('crystal_lamp'));
      });
      if (nest) {
        const n = 2 + (hash3(cseed, 0, 0, 0) % 3);
        for (let m = 0; m < n; m++) pl.mob('end_crystal_mite', L(sgn < 0 ? cx0 + 2 : cx0 + 3, 1, cz + (m % 3) - 1));
      }
    }
  // Spires: two at the front, a taller one over the crossing
  const spire = (kind: string, lx: number, lz: number, rr: number, base: number, h: number): void => {
    pl.add(kind, local(lx - rr, base - 1, lz - rr, lx + rr, base + h + 2, lz + rr), (v) => {
      const b = fb(v);
      for (let k = 0; k <= h; k++) {
        const rad = rr * (1 - (k / h) ** 1.6);
        for (let z = -rr; z <= rr; z++)
          for (let x = -rr; x <= rr; x++) {
            const d = Math.hypot(x, z);
            if (d > rad + 0.4) continue;
            b.set(lx + x, base + k, lz + z, d > rad - 1 ? (k % 6 === 0 ? crystal : glass) : k < 2 ? crystal : 0);
          }
      }
      b.set(lx, base + h + 1, lz, S('end_crystal_cluster'));
    });
  };
  const hf = 40 + rng.int(21);
  spire('spire_front', nx0 - 1, 1, 4, 0, hf);
  spire('spire_front', nx1 + 1, 1, 4, 0, hf - rng.int(6));
  spire('spire_crossing', half(W), zt, 5, Hn + half(Wn) - 2, 30 + rng.int(20));
  return pl.start(a.x, y, a.z);
};

// ---------------------------------------------------------------------------
// Void Observatory
// ---------------------------------------------------------------------------
export const planVoidObservatory: GiantPlan = (site, a, rng, seed) => {
  const Rr = 28 + rng.int(8);
  const Rh = 12 + rng.int(3);
  const Rd = 8 + rng.int(3);
  // Its towers may stand on separate islands: the dome and its bridges tie them together
  const r = rectOf(a.x - Rr - 6, a.z - Rr - 6, a.x + Rr + 6, a.z + Rr + 6);
  const y = baseFor(site, a, r, 0.3, 24);
  if (y === null) return null;
  const pl = new Plan('void_observatory', seed, site, a.biome ?? site.biomeId(a.x, a.z), a.force);
  const p = pl.pal;
  const astral = S('astral_end_stone_bricks');
  const cx = a.x;
  const cz = a.z;
  // The bored hole: the land under the dome is cut away down to the void
  const out: number[] = [];
  pl.add(`hole:${Rh}`, boxOf(cx - Rh - 1, 1, cz - Rh - 1, cx + Rh + 1, y + 8, cz + Rh + 1), (v) => {
    cols(v, cx - Rh, cz - Rh, cx + Rh, cz + Rh, (x, z) => {
      if (Math.hypot(x - cx, z - cz) > Rh + 0.4) return;
      const n = site.ex.spans(x, z, out);
      for (let i = 0; i < n; i++) for (let yy = out[i * 2]!; yy <= out[i * 2 + 1]!; yy++) v.set(x, yy, z, 0);
      // A rim of astral stone round the edge
      if (Math.hypot(x - cx, z - cz) > Rh - 1) for (let yy = y - 4; yy < y; yy++) v.set(x, yy, z, astral);
    });
  });
  // The dome: a bowl hung over the hole, glass above the floor
  const dseed = pl.sub(0xd03e);
  pl.add(`dome:${Rd}`, boxOf(cx - Rd - 1, y - Rd - 1, cz - Rd - 1, cx + Rd + 1, y + Rd + 2, cz + Rd + 1), (v) => {
    const b = new Builder(v, cx, y, cz, 0, 1, 1);
    for (let k = -Rd; k <= 0; k++)
      for (let z = -Rd; z <= Rd; z++)
        for (let x = -Rd; x <= Rd; x++) {
          const d = Math.hypot(x, k * 1.3, z);
          if (d > Rd + 0.4) continue;
          b.set(x, k - 1, z, k === 0 ? ((x + z) % 2 ? S('astral_mosaic') : astral) : astral);
        }
    dome(b, 0, 0, 0, Rd, astral, S('astral_glass'), null);
    // The giant lens under the apex, held by conduits, a dormant core below
    for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) if (Math.hypot(x, z) <= 3.2) b.set(x, Rd - 3, z, S('ancient_lens'));
    for (let k = 0; k < Rd - 3; k++) b.set(0, k, 0, k === 0 ? S('ancient_core') : stateOf('ancient_conduit', { axis: 'y' }));
    for (const [dx, dz] of [
      [4, 0],
      [-4, 0],
      [0, 4],
      [0, -4],
    ] as const)
      b.set(dx, Rd - 3, dz, stateOf('ancient_conduit', { axis: dx ? 'x' : 'z' }));
    // Star charts round the floor
    const n = 2 + rng.int(2);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + 0.4;
      chest(b, Math.round(Math.cos(ang) * (Rd - 2)), 0, Math.round(Math.sin(ang) * (Rd - 2)), 'north', 'chest/void_observatory', dseed + i);
    }
    b.set(0, Rd - 1, 0, S('astral_lantern'));
  });
  // The ring of telescope towers, each with a bridge to the dome
  const n = 5 + rng.int(3);
  const base = rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const ang = base + (i / n) * Math.PI * 2;
    const tx = cx + Math.round(Math.cos(ang) * Rr);
    const tz = cz + Math.round(Math.sin(ang) * Rr);
    const tr = 3;
    const th = 18 + rng.int(10);
    const ty = a.force ? y : (site.ground(tx, tz) ?? y - 1) + 1;
    const tseed = pl.sub(i, 0x7e1e);
    const loot = i % 2 === 0;
    pl.add(`tower:${th}`, boxOf(tx - tr - 3, ty - 16, tz - tr - 3, tx + tr + 3, ty + th + 10, tz + tr + 3), (v) => {
      const b = new Builder(v, tx, ty, tz, 0, 1, 1);
      for (let k = -1; k <= th; k++)
        for (let z = -tr; z <= tr; z++)
          for (let x = -tr; x <= tr; x++) {
            const d = Math.hypot(x, z);
            if (d > tr + 0.4) continue;
            if (k === -1) {
              b.foundation(x, z, -1, astral, 16);
              continue;
            }
            b.set(x, k, z, d > tr - 0.6 ? (k % 5 === 4 ? S('astral_glass') : astral) : k === 0 ? S(p.floor) : 0);
          }
      // Ladder up the inside, a platform and the telescope on top
      for (let k = 1; k <= th; k++) b.set(0, k, -tr + 1, st.ladder('south'));
      for (let z = -tr - 2; z <= tr + 2; z++)
        for (let x = -tr - 2; x <= tr + 2; x++) {
          const d = Math.hypot(x, z);
          if (d > tr + 2.4) continue;
          if (!(x === 0 && z === -tr + 1)) b.set(x, th, z, astral);
          if (d > tr + 1.5) b.set(x, th + 1, z, S(p.rail));
        }
      telescope(b, 1, th + 1, 1);
      if (loot) chest(b, -1, th + 1, 1, 'south', 'chest/void_observatory', tseed);
      // A door towards the dome
      const dx = Math.round(-Math.cos(ang) * tr);
      const dz = Math.round(-Math.sin(ang) * tr);
      for (let k = 1; k <= 3; k++) b.set(dx, k, dz, 0);
    });
    // The bridge from the tower's door across the hole to the dome
    const ax = tx - Math.cos(ang) * (tr + 0.5);
    const az = tz - Math.sin(ang) * (tr + 0.5);
    const bx = cx + Math.cos(ang) * (Rd - 0.5);
    const bz = cz + Math.sin(ang) * (Rd - 0.5);
    pl.add('bridge', boxOf(Math.min(ax, bx) - 3, Math.min(ty, y) - 3, Math.min(az, bz) - 3, Math.max(ax, bx) + 3, Math.max(ty, y) + 4, Math.max(az, bz) + 3), (v) => {
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      cols(v, Math.floor(Math.min(ax, bx)) - 3, Math.floor(Math.min(az, bz)) - 3, Math.ceil(Math.max(ax, bx)) + 3, Math.ceil(Math.max(az, bz)) + 3, (x, z) => {
        const rx = x + 0.5 - ax;
        const rz = z + 0.5 - az;
        const t = rx * ux + rz * uz;
        if (t < 0 || t > len + 1) return;
        const sd = Math.abs(rx * uz - rz * ux);
        const yy = Math.round(ty + (y - ty) * Math.min(1, t / len));
        if (sd <= 1) {
          v.set(x, yy - 1, z, astral);
          for (let k = 0; k < 3; k++) v.set(x, yy + k, z, 0);
        } else if (sd <= 2 && soft(v.get(x, yy, z))) {
          if (soft(v.get(x, yy - 1, z))) v.set(x, yy - 1, z, astral);
          v.set(x, yy, z, Math.round(t) % 6 === 3 ? S('astral_lantern') : S(p.rail));
        }
      });
    });
  }
  return pl.start(cx, y, cz);
};

// ---------------------------------------------------------------------------
// End Fortress
// ---------------------------------------------------------------------------
export const planFortress: GiantPlan = (site, a, rng, seed) => {
  const Sd = 56 + 8 * rng.int(3);
  const Hw = 12 + rng.int(4);
  const rot = rng.int(4) as Rotation;
  const r = footprint(a.x - half(Sd), a.z - half(Sd), rot, Sd, Sd);
  const y = baseFor(site, a, r, 0.6, 14);
  if (y === null) return null;
  const pl = new Plan('end_fortress', seed, site, a.biome ?? site.biomeId(a.x, a.z), a.force);
  const p = pl.pal;
  const wallB = S(p.accent);
  const brick = S('ancient_end_bricks');
  const fb = (v: DecorView): Builder => new Builder(v, r.x0, y, r.z0, rot, Sd, Sd);
  const local = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => {
    const b = fb(null as unknown as DecorView);
    const xs = [b.wx(x0, z0), b.wx(x1, z1)];
    const zs = [b.wz(x0, z0), b.wz(x1, z1)];
    return boxOf(Math.min(...xs) - 1, y + y0, Math.min(...zs) - 1, Math.max(...xs) + 1, y + y1, Math.max(...zs) + 1);
  };
  const L = (lx: number, ly: number, lz: number): P3 => {
    const b = fb(null as unknown as DecorView);
    return [b.wx(lx, lz), y + ly, b.wz(lx, lz)];
  };
  const m = Sd - 1;
  const backGate = rng.chance(0.5);
  // Curtain walls, a side at a time (in two halves), with a walkway and crenellations on top
  const sides: [string, number, number, number, number][] = [
    ['front', 0, 0, m, 2],
    ['back', 0, m - 2, m, m],
    ['left', 0, 0, 2, m],
    ['right', m - 2, 0, m, m],
  ];
  for (const [name, x0, z0, x1, z1] of sides) {
    const alongX = name === 'front' || name === 'back';
    const n0 = alongX ? x0 : z0;
    const n1 = alongX ? x1 : z1;
    for (const [h0, h1] of [
      [n0, (n0 + n1) >> 1],
      [((n0 + n1) >> 1) + 1, n1],
    ] as const) {
      const bx0 = alongX ? h0 : x0;
      const bx1 = alongX ? h1 : x1;
      const bz0 = alongX ? z0 : h0;
      const bz1 = alongX ? z1 : h1;
      pl.add(`wall:${name}`, local(bx0, -16, bz0, bx1, Hw + 2, bz1), (v) => {
        const b = fb(v);
        for (let x = bx0; x <= bx1; x++)
          for (let z = bz0; z <= bz1; z++) {
            b.foundation(x, z, -1, wallB, 16);
            for (let k = 0; k <= Hw; k++) b.set(x, k, z, k === Hw ? S(p.floor) : wallB);
            const outer = name === 'front' ? z === z0 : name === 'back' ? z === z1 : name === 'left' ? x === x0 : x === x1;
            if (outer && (x + z) % 2 === 0) b.set(x, Hw + 1, z, S(p.rail));
            if (outer && (x + z) % 9 === 4) b.set(x, Hw - 4, z, 0);
          }
      });
    }
  }
  // Corner towers
  for (const [cxl, czl] of [
    [0, 0],
    [m - 8, 0],
    [0, m - 8],
    [m - 8, m - 8],
  ] as const) {
    const tseed = pl.sub(cxl, czl, 0x7044);
    // A square tower needs no rotation: build it world-aligned on the corner's square
    const f0 = fb(null as unknown as DecorView);
    const ox = Math.min(f0.wx(cxl, czl), f0.wx(cxl + 8, czl + 8));
    const oz = Math.min(f0.wz(cxl, czl), f0.wz(cxl + 8, czl + 8));
    pl.add('corner_tower', local(cxl - 1, -16, czl - 1, cxl + 9, Hw + 12, czl + 9), (v) => {
      const tb = new Builder(v, ox, y, oz, 0, 9, 9);
      tower(tb, p, tseed, 9, 2, Math.ceil((Hw + 6) / 2), 'terrace', { door: false });
      // Open into the wall walk
      for (const [x, z] of [
        [4, 0],
        [4, 8],
        [0, 4],
        [8, 4],
      ] as const)
        for (let k = Hw + 1; k <= Hw + 2; k++) tb.set(x, k, z, 0);
    });
  }
  // Gatehouses: a passage through the front wall (and sometimes the back) under a tower
  const gates: [number, string][] = [[0, 'north']];
  if (backGate) gates.push([m - 2, 'south']);
  for (const [gz] of gates) {
    const gx0 = half(Sd) - 4;
    pl.add('gatehouse', local(gx0 - 1, -2, gz - 3, gx0 + 9, Hw + 9, gz + 5), (v) => {
      const b = fb(v);
      for (let x = gx0; x <= gx0 + 8; x++)
        for (let z = gz - 2; z <= gz + 4; z++) {
          for (let k = 0; k <= Hw + 6; k++) {
            const shell = x === gx0 || x === gx0 + 8 || z === gz - 2 || z === gz + 4 || k === Hw + 6;
            b.set(x, k, z, shell || k === 0 ? brick : 0);
          }
        }
      // The passage
      for (let z = gz - 2; z <= gz + 4; z++) for (let x = half(Sd) - 1; x <= half(Sd) + 1; x++) for (let k = 1; k <= 5; k++) b.set(x, k, z, 0);
      for (let x = half(Sd) - 1; x <= half(Sd) + 1; x++) b.set(x, 6, gz - 2, S('iron_bars'));
      battlements(b, p, gx0, Hw + 7, gz - 2, gx0 + 8, gz + 4);
      b.set(half(Sd), 4, gz + 1, lamp(p, true));
    });
  }
  // The keep, in the middle: armories round a sealed core, a great hall above
  const K = 21 + 2 * rng.int(3);
  const Hk = 22 + rng.int(8);
  const kx0 = half(Sd) - half(K);
  const kz0 = half(Sd) - half(K) + 4;
  const kseed = pl.sub(0x4ee9);
  const floorsK = 2 + rng.int(2);
  const fhK = Math.floor(Hk / floorsK);
  pl.add(`keep:${K}x${Hk}:${floorsK}`, local(kx0 - 1, -16, kz0 - 1, kx0 + K, Hk + 4, kz0 + K), (v) => {
    const b = fb(v);
    footing(b, kx0, kz0, kx0 + K - 1, kz0 + K - 1, brick, 16);
    for (let f = 0; f < floorsK; f++) storey(b, p, kseed, kx0, f * fhK, kz0, kx0 + K - 1, kz0 + K - 1, fhK, { wall: 'ancient_end_bricks', floor: p.floor, ceiling: f === floorsK - 1 ? 'ancient_end_bricks' : p.floor });
    doorway(b, kx0 + half(K), 1, kz0, 3, 4);
    // Stairs up the left side through every floor
    for (let f = 0; f < floorsK - 1; f++)
      for (let i = 0; i < fhK; i++) {
        b.set(kx0 + 1, f * fhK + 1 + i, kz0 + 2 + i, st.stair(p.stairs, 'south'));
        for (let k = 1; k <= 3; k++) b.set(kx0 + 1, f * fhK + 1 + i + k, kz0 + 2 + i, 0);
      }
    // The sealed inner keep: Ward Stone round a vault door
    const c0 = half(K) - 5;
    for (let x = c0; x <= c0 + 10; x++)
      for (let z = c0 + 2; z <= c0 + 12; z++)
        for (let k = 1; k < fhK; k++) {
          const shell = x === c0 || x === c0 + 10 || z === c0 + 2 || z === c0 + 12 || k === fhK - 1;
          b.set(kx0 + x, k, kz0 + z, shell ? S('ancient_ward_stone') : 0);
        }
    b.set(kx0 + half(K), 1, kz0 + c0 + 2, stateOf('ancient_vault_door', { facing: 'north' }));
    b.set(kx0 + half(K), 2, kz0 + c0 + 2, stateOf('ancient_vault_door', { facing: 'north' }));
    glyphWall(b, kseed, kx0 + half(K) - 3, 3, kz0 + c0 + 1, kx0 + half(K) + 3, 4, kz0 + c0 + 1);
    // Armories either side of the core
    chest(b, kx0 + 2, 1, kz0 + K - 3, 'east', 'chest/end_fortress_armory', kseed);
    chest(b, kx0 + K - 3, 1, kz0 + K - 3, 'west', 'chest/end_fortress_armory', kseed + 1);
    for (let i = 3; i < K - 3; i += 3) {
      b.set(kx0 + 1, 1, kz0 + i, S('anvil'));
      b.set(kx0 + K - 2, 2, kz0 + i, lamp(p));
    }
    // The great hall above
    chest(b, kx0 + half(K), fhK + 1, kz0 + K - 3, 'north', 'chest/end_fortress', kseed + 2);
    battlements(b, p, kx0, floorsK * fhK + 1, kz0, kx0 + K - 1, kz0 + K - 1);
    for (let i = 2; i < K - 2; i += 4) b.set(kx0 + i, floorsK * fhK + 2, kz0 + 1, lamp(p));
  });
  // Barracks in the courtyard
  const barracks = 1 + rng.int(3);
  for (let i = 0; i < barracks; i++) {
    const bx0 = i % 2 ? Sd - 16 : 6;
    const bz0 = 8 + Math.floor(i / 2) * 14 + rng.int(3);
    const bseed = pl.sub(i, 0xba22);
    pl.add('barracks', local(bx0 - 1, -12, bz0 - 1, bx0 + 10, 9, bz0 + 8), (v) => {
      const b = fb(v);
      footing(b, bx0, bz0, bx0 + 9, bz0 + 7, S(p.accent), 12);
      storey(b, p, bseed, bx0, 0, bz0, bx0 + 9, bz0 + 7, 5);
      doorway(b, bx0 + 4, 1, bz0 + 7, 1, 3);
      for (let x = bx0 + 1; x < bx0 + 9; x += 2) b.set(x, 1, bz0 + 1, S('barrel'));
      chest(b, bx0 + 8, 1, bz0 + 3, 'west', 'chest/end_fortress', bseed);
      battlements(b, p, bx0, 6, bz0, bx0 + 9, bz0 + 7);
    });
  }
  // Guards: Sentinels patrol the courtyard, Bulwarks hold the gate and the keep's door
  const ring: P3[] = [L(6, 1, 6), L(Sd - 7, 1, 6), L(Sd - 7, 1, Sd - 7), L(6, 1, Sd - 7)];
  const sentinels = 4 + rng.int(3);
  for (let i = 0; i < sentinels; i++) pl.sentinel(ring[i % 4]!, [...ring.slice(i % 4), ...ring.slice(0, i % 4)]);
  pl.bulwark(L(half(Sd), 1, 4), local(half(Sd) - 4, 0, 0, half(Sd) + 4, 6, 6));
  pl.bulwark(L(kx0 + half(K), 1, kz0 + 3), local(kx0, 0, kz0, kx0 + K - 1, fhK, kz0 + K - 1));
  void FRONT_OF;
  return pl.start(a.x, y, a.z);
};

// ---------------------------------------------------------------------------
// The Fallen City
// ---------------------------------------------------------------------------
/** A RuinBuilder that also leans what it builds: each block shifts sideways with its height. */
class LeaningBuilder extends RuinBuilder {
  constructor(v: DecorView, ox: number, oy: number, oz: number, sx: number, private readonly tx: number, private readonly tz: number, seed: number, holes: number, collapse: number) {
    super(v, ox, oy, oz, 0, sx, sx, seed, holes, collapse, 6);
  }

  override set(x: number, y: number, z: number, state: number): void {
    super.set(x + Math.round(y * this.tx), y, z + Math.round(y * this.tz), state);
  }

  override chest(x: number, y: number, z: number, facing: string, loot: string, seed: number): void {
    super.chest(x + Math.round(y * this.tx), y, z + Math.round(y * this.tz), facing, loot, seed);
  }
}

export const planFallenCity: GiantPlan = (site, a, rng, seed) => {
  const Rf = 70 + rng.int(31);
  const r = rectOf(a.x - Rf, a.z - Rf, a.x + Rf, a.z + Rf);
  if (!a.force && !site.fits(r, 6)) return null;
  const y = a.force ? (a.y ?? 64) : (() => {
    const lv = site.level(rectOf(a.x - 20, a.z - 20, a.x + 20, a.z + 20), 0.35, 0.5, 4);
    return lv === null ? null : lv + 1;
  })();
  if (y === null) return null;
  const pl = new Plan('fallen_city', seed, site, 'shattered_end', a.force);
  const p = pl.pal;
  const groundAt = (x: number, z: number): number | null => (a.force ? y - 1 : site.ground(x, z));
  // Towers, tilted, sunk and broken
  const target = 22 + rng.int(15);
  let towers = 0;
  let chests = 8 + rng.int(7);
  for (let tries = 0; tries < 260 && towers < target; tries++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = Math.sqrt(rng.next()) * (Rf - 8);
    const w = rng.pick([7, 9, 11]);
    const cx = a.x + Math.round(Math.cos(ang) * dist);
    const cz = a.z + Math.round(Math.sin(ang) * dist);
    const g = groundAt(cx, cz);
    if (g === null) continue;
    const tr = rectOf(cx - half(w), cz - half(w), cx - half(w) + w - 1, cz - half(w) + w - 1);
    if (!pl.free(tr, 3)) continue;
    const floors = 4 + rng.int(5);
    const fh = 5;
    const sink = 3 + rng.int(8);
    const by = g + 1 - sink;
    const tseed = pl.sub(towers, 0xfa11);
    const loot = chests > 0 && rng.chance(0.45);
    if (loot) chests--;
    pl.occupy(tr);
    if (rng.chance(0.15)) {
      // Fallen over: a broken hollow shaft lying along the ground
      const d = rng.pick(DIRS);
      const len = floors * fh - rng.int(8);
      const f = runFrame(cx, cz, d, len, half(w));
      pl.add(`fallen_tower:${w}x${len}`, rectBox(f.rect, by - 2, g + w + 2, 2), (v) => {
        const b = new RuinBuilder(v, f.rect.x0, g - 1, f.rect.z0, f.rot, f.sx, f.sz, tseed, 0.2, w, 2);
        for (let z = 0; z < len; z++)
          for (let x = 0; x < w; x++)
            for (let k = 0; k < w; k++) {
              const shell = x === 0 || x === w - 1 || k === 0 || k === w - 1 || z % fh === 0;
              b.set(x, k, z, shell ? (k === 0 ? S(p.accent) : S('purpur_block')) : 0);
            }
        if (loot) chest(b, half(w), 1, 2, 'south', 'chest/fallen_city', tseed);
      });
    } else {
      const lean = rng.next() * 0.35;
      const la = rng.next() * Math.PI * 2;
      const tx = Math.cos(la) * lean;
      const tz = Math.sin(la) * lean;
      const H = floors * fh;
      const collapse = Math.floor(H * (0.3 + rng.next() * 0.45));
      const reach = Math.ceil(H * lean) + 2;
      pl.add(`tower:${w}x${floors}:${Math.round(lean * 100)}`, rectBox(tr, by - 8, by + collapse + 10, reach + 2), (v) => {
        const b = new LeaningBuilder(v, tr.x0, by, tr.z0, w, tx, tz, tseed, 0.18, collapse);
        tower(b, p, tseed, w, floors, fh, 'terrace', { base: 6 });
        // Its loot lies on the bottom floor, sunk with it (down the ladder)
        if (loot) chest(b, 1, 1, 1, 'south', 'chest/fallen_city', tseed);
        glyphWall(b, tseed, 1, sink + 2, 1, w - 2, sink + 3, 1);
      });
    }
    towers++;
  }
  if (towers < 12 && !a.force) return null;
  // Debris: rubble, broken bridges, glyph walls and broken portals between the towers
  const rubble = 20 + rng.int(21);
  for (let i = 0; i < rubble; i++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = Math.sqrt(rng.next()) * Rf;
    const x = a.x + Math.round(Math.cos(ang) * dist);
    const z = a.z + Math.round(Math.sin(ang) * dist);
    const g = groundAt(x, z);
    if (g === null) continue;
    const rr = 1.5 + rng.next() * 2;
    const rs = pl.sub(i, 0x2bb1);
    pl.add('rubble', boxOf(x - 4, g - 3, z - 4, x + 4, g + 5, z + 4), (v) => {
      cols(v, x - 4, z - 4, x + 4, z + 4, (px, pz) => {
        for (let k = -1; k <= 4; k++) {
          const d = Math.hypot(px - x, k * 1.4, pz - z);
          if (d > rr + chance(rs, px, k, pz)) continue;
          const c = chance(rs ^ 0x5, px, g + k, pz);
          v.set(px, g + k, pz, c < 0.1 ? S('ancient_end_fragment') : c < 0.35 ? S('purpur_block') : c < 0.6 ? S('cracked_ancient_end_bricks') : c < 0.8 ? S('ancient_end_bricks') : S(p.accent));
        }
      });
    });
  }
  const bridges = 6 + rng.int(5);
  for (let i = 0; i < bridges; i++) {
    const x = a.x + rng.int(Rf * 2) - Rf;
    const z = a.z + rng.int(Rf * 2) - Rf;
    const g = groundAt(x, z);
    if (g === null) continue;
    const d = rng.pick(DIRS);
    const len = 5 + rng.int(5);
    const by = g + 3 + rng.int(6);
    const f = runFrame(x, z, d, len, 2);
    const bs = pl.sub(i, 0xb21d);
    pl.add(`bridge_fragment:${len}`, rectBox(f.rect, by - 4, by + 4, 1), (v) => walkway(runBuilder(v, f, 0), p, bs, 2, 0, len - 1, by, by, { broken: 2 }));
  }
  const walls = 6 + rng.int(5);
  for (let i = 0; i < walls; i++) {
    const x = a.x + rng.int(Rf * 2) - Rf;
    const z = a.z + rng.int(Rf * 2) - Rf;
    const g = groundAt(x, z);
    if (g === null) continue;
    const ww = 4 + rng.int(5);
    const hh = 3 + rng.int(4);
    const rot = rng.int(4) as Rotation;
    const fr = footprint(x, z, rot, ww, 1);
    const ws = pl.sub(i, 0x9a11);
    pl.add('glyph_wall', rectBox(fr, g - 2, g + hh + 2, 1), (v) => {
      const b = new Builder(v, fr.x0, g, fr.z0, rot, ww, 1);
      for (let xx = 0; xx < ww; xx++) b.set(xx, 0, 0, S('chiseled_ancient_end_bricks'));
      glyphWall(b, ws, 0, 1, 0, ww - 1, hh, 0);
    });
  }
  const portals = 1 + rng.int(3);
  for (let i = 0; i < portals; i++) {
    const x = a.x + rng.int(Rf) - half(Rf);
    const z = a.z + rng.int(Rf) - half(Rf);
    const g = groundAt(x, z);
    if (g === null) continue;
    const rot = rng.int(4) as Rotation;
    const fr = footprint(x, z, rot, 7, 3);
    const ps = pl.sub(i, 0x9047);
    pl.add('broken_portal', rectBox(fr, g - 3, g + 9, 1), (v) => {
      const b = new Builder(v, fr.x0, g, fr.z0, rot, 7, 3);
      for (let xx = 0; xx < 7; xx++) for (let zz = 0; zz < 3; zz++) b.set(xx, 0, zz, S('ancient_end_bricks'));
      brokenPortal(b, ps, 1, 1, 1, 3, 4, 0.35);
    });
  }
  // A last platform at the heart, and Void Stalkers among the stones
  pl.add('heart', rectBox(rectOf(a.x - 4, a.z - 4, a.x + 4, a.z + 4), y - 6, y + 4, 0), (v) => platform(new Builder(v, a.x - 4, y, a.z - 4, 0, 9, 9), p, seed, 4));
  const stalkers = 4 + rng.int(5);
  for (let i = 0; i < stalkers; i++) {
    const x = a.x + rng.int(41) - 20;
    const z = a.z + rng.int(41) - 20;
    const g = groundAt(x, z);
    if (g !== null) pl.mob('void_stalker', [x, g + 1, z]);
  }
  return pl.start(a.x, y, a.z);
};

/** Plans by giant id. */
export const GIANT_PLANS: Record<string, GiantPlan> = {
  end_colossus: planColossus,
  crystal_cathedral: planCathedral,
  void_observatory: planVoidObservatory,
  end_fortress: planFortress,
  fallen_city: planFallenCity,
};

/** Which giant (if any) a region builds at a spot, by the biome's weights. */
export function giantFor(biome: string, rng: Random): string | null {
  const opts = GIANT_STRUCTURES.filter((g) => g.biomes[biome]).map((g) => ({ id: g.id, weight: g.biomes[biome]! }));
  return opts.length ? rng.weighted(opts).id : null;
}

void hash3;
void soft;
