/**
 * V6 phase 3: the eight End City 2.0 variants.
 *
 * Each is assembled at plan time from the kit's pieces with random sizes,
 * rotations, lengths and branch counts, and dressed in the palette of the
 * biome it stands in. No two come out the same: tests compare the piece
 * lists of the same variant across seeds.
 *
 * - End Outpost: a watchtower with a lookout, bridge stubs, 1-2 platforms.
 * - End Settlement: houses around a plaza on raised walkways, chorus gardens.
 * - End Ruins: broken pieces of the other variants, some floating loose.
 * - End Library: floors of bookshelf halls and reading rooms, a sealed archive.
 * - End Observatory: a spire with a spiral stair up to a dome and its telescope.
 * - End Shipyard: a yard on the shore, a pier into the void, hulls and a crane.
 * - End Metropolis: towers around a plaza, sky bridges, a vault beneath.
 * - End Palace: one grand building: halls, courtyards, a throne, a sealed vault.
 */
import { Random } from '../../../math/rng';
import { S, stateOf } from '../../../registry/blocks';
import { SHIPYARD_ELYTRA_CHANCE } from '../../../endExpansion/structures';
import type { DecorView } from '../../decorate/view';
import { Builder, type Rotation } from '../builder';
import { boxOf, type Box, type Start } from '../manager';
import {
  RuinBuilder,
  battlements,
  brokenPortal,
  chance,
  chest,
  doorway,
  dome,
  footing,
  footprint,
  glyphWall,
  lamp,
  ladder,
  platform,
  pyramidRoof,
  rectOf,
  soft,
  st,
  stairway,
  storey,
  telescope,
  tower,
  walkway,
  type P3,
  type Palette,
  type Rect,
} from './kit';
import { DIRS, DXZ, FRONT_OF, OPPOSITE, Plan, ROT_TOWARD, boxIn, frameOf, rectBox, runBuilder, runFrame, sideOut, worldOf, type Anchor, type Dir, type Site } from './plan';

/** A variant's plan: null when the place doesn't suit it (unless forced). */
export type VariantPlan = (site: Site, a: Anchor, rng: Random, seed: number) => Start | null;

const half = (n: number): number => n >> 1;

/** The base level for a footprint, or null when the ground there won't do. */
function baseLevel(site: Site, a: Anchor, r: Rect, minShare: number, maxSpread: number, q = 0.5): number | null {
  if (a.force) return a.y ?? (site.level(r, 0, q) ?? 64) + 1;
  if (!site.fits(r)) return null;
  const lv = site.level(r, minShare, q);
  if (lv === null || site.spread(r) > maxSpread) return null;
  return lv + 1;
}

function biomeAt(site: Site, a: Anchor): string {
  return a.biome ?? site.biomeId(a.x, a.z);
}

/** A tower piece on a square footprint; returns its rectangle and roof level. */
function towerPiece(pl: Plan, kind: string, r: Rect, y: number, rot: Rotation, w: number, floors: number, fh: number, roof: 'terrace' | 'pyramid' | 'crown', seed: number, extra?: (b: Builder, top: number) => void): number {
  const top = floors * fh;
  pl.add(kind, rectBox(r, y - 16, y + top + 8, 2), (v) => {
    const b = new Builder(v, r.x0, y, r.z0, rot, w, w);
    tower(b, pl.pal, seed, w, floors, fh, roof);
    extra?.(b, top);
  });
  pl.occupy(r);
  return top;
}

/** A walkway piece leaving (sx, sz) towards d. */
function walkPiece(pl: Plan, kind: string, sx: number, sz: number, d: Dir, len: number, y0: number, y1: number, o: { w?: number; broken?: number; supports?: boolean; deck?: string } = {}): Rect {
  const hw = (o.w ?? 3) >> 1;
  const f = runFrame(sx, sz, d, len, hw + 1);
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const seed = pl.sub(sx, sz, len, 0xb12);
  pl.add(kind, rectBox(f.rect, lo - (o.supports ? 20 : 3), hi + 4, 0), (v) => walkway(runBuilder(v, f, 0), pl.pal, seed, hw + 1, 0, len - 1, y0, y1, o));
  return f.rect;
}

/** A round platform piece around (cx, cz) at height y. */
function platformPiece(pl: Plan, kind: string, cx: number, cz: number, y: number, r: number, extra?: (b: Builder) => void): Rect {
  const rect = rectOf(cx - r, cz - r, cx + r, cz + r);
  const seed = pl.sub(cx, cz, 0x91a7);
  pl.add(kind, rectBox(rect, y - r - 3, y + 4, 0), (v) => {
    const b = new Builder(v, rect.x0, y, rect.z0, 0, r * 2 + 1, r * 2 + 1);
    platform(b, pl.pal, seed, r);
    extra?.(b);
  });
  pl.occupy(rect);
  return rect;
}

// ---------------------------------------------------------------------------
// End Outpost
// ---------------------------------------------------------------------------
export const planOutpost: VariantPlan = (site, a, rng, seed) => {
  const w = rng.chance(0.5) ? 7 : 9;
  const floors = 3 + rng.int(3);
  const fh = 4;
  const rot = rng.int(4) as Rotation;
  const roof = rng.pick(['terrace', 'pyramid', 'crown'] as const);
  const r = rectOf(a.x - half(w), a.z - half(w), a.x - half(w) + w - 1, a.z - half(w) + w - 1);
  const y = baseLevel(site, a, r, 0.85, 6);
  if (y === null) return null;
  const pl = new Plan('end_outpost', seed, site, biomeAt(site, a), a.force);
  const front = FRONT_OF[rot];
  // The watchtower; its top storey is the lookout (a chest by the window)
  const top = towerPiece(pl, `tower:${w}x${floors}:${roof}`, r, y, rot, w, floors, fh, roof, pl.sub(1), (b, t) => {
    chest(b, 1, t - fh + 1, 1, 'south', 'chest/end_outpost', seed);
    b.set(w - 2, t - fh + 1, 1, S('barrel'));
  });
  void top;
  // A platform out in front, at the door, on a walkway: the Sentinels walk between them
  const sides = DIRS.filter((d) => d !== front);
  rng.shuffle(sides);
  const pr = 3 + rng.int(2);
  const len1 = 5 + rng.int(5);
  const [sx, sz] = sideOut(r, front);
  walkPiece(pl, `bridge:${len1}`, sx, sz, front, len1, y, y, { supports: true });
  const [dx, dz] = DXZ[front];
  const pcx = sx + dx * (len1 + pr);
  const pcz = sz + dz * (len1 + pr);
  platformPiece(pl, `platform:${pr}`, pcx, pcz, y - 1, pr, (b) => {
    if (rng.chance(0.5)) chest(b, pr, 0, pr + 1, 'north', 'chest/end_outpost', seed ^ 1);
  });
  // A second platform off another side, higher up (sometimes)
  if (rng.chance(0.5)) {
    const d = sides.pop()!;
    const f = 1 + rng.int(floors - 1);
    const len = 4 + rng.int(5);
    const p2 = 2 + rng.int(2);
    const [qx, qz] = sideOut(r, d);
    const yy = y + f * fh + 1;
    walkPiece(pl, `bridge_high:${f}:${len}`, qx, qz, d, len, yy, yy);
    const [ex, ez] = DXZ[d];
    platformPiece(pl, `platform_high:${p2}`, qx + ex * (len + p2), qz + ez * (len + p2), yy - 1, p2);
    pl.add('opening', rectBox(rectOf(qx - ex, qz - ez, qx - ex, qz - ez), yy - 1, yy + 2, 1), (v) => {
      for (let k = 0; k < 2; k++) for (let o = -1; o <= 1; o++) v.set(qx - ex + (ez ? o : 0), yy + k, qz - ez + (ex ? o : 0), 0);
    });
  }
  // Bridge stubs from the upper floors, ending in broken stone
  const stubs = 1 + rng.int(3);
  for (let i = 0; i < stubs && sides.length; i++) {
    const d = sides.pop()!;
    const f = 1 + rng.int(floors - 1);
    const len = 4 + rng.int(5);
    const [qx, qz] = sideOut(r, d);
    const yy = y + f * fh + 1;
    walkPiece(pl, `stub:${f}:${len}`, qx, qz, d, len, yy, yy, { broken: 2 + rng.int(2) });
  }
  // Sentinels pace between the door and the platform
  const door: P3 = [sx, y, sz];
  const plat: P3 = [pcx, y, pcz];
  pl.sentinel(door, [door, plat]);
  if (rng.chance(0.5)) pl.sentinel(plat, [plat, door]);
  return pl.start(a.x, y, a.z);
};

// ---------------------------------------------------------------------------
// End Settlement
// ---------------------------------------------------------------------------
type RoofKind = 'flat' | 'pyramid' | 'dome' | 'gable';

/** A small End house (front door on local z = 0), dressed by the palette and a roof style. */
function house(b: Builder, p: Palette, seed: number, w: number, d: number, h: number, roof: RoofKind, wall: string, chestLoot: string | null): void {
  footing(b, 0, 0, w - 1, d - 1, S(p.accent), 12);
  storey(b, p, seed, 0, 0, 0, w - 1, d - 1, h, { wall, floor: p.wood, ceiling: roof === 'dome' ? null : p.accent });
  doorway(b, half(w), 1, 0);
  // The rail in front of the door (the walkway's) gives way to a step
  b.set(half(w), 1, -1, 0);
  b.set(half(w), 2, -1, 0);
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) if ((x + z) % 3 === 0) b.set(x, 1, z, S(p.cloth === 'chorus_cloth' ? 'purple_carpet' : p.cloth.replace('_wool', '_carpet')));
  b.set(w - 2, 1, d - 2, S('barrel'));
  b.set(1, 1, d - 2, stateOf('chorus_flower', { age: '5' }));
  b.set(half(w), h - 1, half(d), lamp(p, true));
  if (chestLoot) chest(b, w - 2, 1, 1, 'west', chestLoot, seed);
  switch (roof) {
    case 'flat':
      battlements(b, p, 0, h + 1, 0, w - 1, d - 1);
      b.set(half(w), h + 1, half(d), lamp(p));
      break;
    case 'pyramid':
      pyramidRoof(b, p, -1, h + 1, -1, w, d, 'wood');
      break;
    case 'dome':
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) b.set(x, h, z, x === 0 || z === 0 || x === w - 1 || z === d - 1 ? S(p.accent) : 0);
      dome(b, half(w), h, half(d), Math.min(half(w), half(d)), S(p.accent), S(p.glass), null);
      break;
    case 'gable': {
      // Ridge along z; slopes face east and west
      for (let i = 0; i <= half(w); i++)
        for (let z = -1; z <= d; z++) {
          const xl = -1 + i;
          const xr = w - i;
          if (xl < xr) {
            b.set(xl, h + 1 + i, z, st.stair(p.woodStairs, 'east'));
            b.set(xr, h + 1 + i, z, st.stair(p.woodStairs, 'west'));
          } else b.set(xl, h + 1 + i, z, st.slab(p.woodSlab));
          if (z === 0 || z === d - 1) for (let x = xl + 1; x < xr; x++) b.set(x, h + 1 + i, z, S(p.wood));
        }
      break;
    }
  }
}

function garden(v: DecorView, seed: number, r: Rect, y: number): void {
  for (let z = r.z0; z <= r.z1; z++)
    for (let x = r.x0; x <= r.x1; x++) {
      v.set(x, y - 1, z, S('end_stone'));
      for (let k = 0; k < 4; k++) if (soft(v.get(x, y + k, z))) v.set(x, y + k, z, 0);
      const c = chance(seed, x, y, z);
      if (c < 0.3) {
        const h = 1 + Math.floor(c * 10);
        for (let k = 0; k < h; k++) v.set(x, y + k, z, stateOf('chorus_plant', { up: 'true', down: 'true' }));
        v.set(x, y + h, z, stateOf('chorus_flower', { age: c < 0.15 ? '5' : '2' }));
      }
    }
}

export const planSettlement: VariantPlan = (site, a, rng, seed) => {
  const pr = 5 + rng.int(3);
  const plaza = rectOf(a.x - pr, a.z - pr, a.x + pr, a.z + pr);
  const y = baseLevel(site, a, plaza, 0.8, 5);
  if (y === null) return null;
  const pl = new Plan('end_settlement', seed, site, biomeAt(site, a), a.force);
  const p = pl.pal;
  pl.occupy(plaza);
  pl.add(`plaza:${pr}`, rectBox(plaza, y - 14, y + 5, 0), (v) => {
    const b = new Builder(v, plaza.x0, y, plaza.z0, 0, pr * 2 + 1, pr * 2 + 1);
    footing(b, 0, 0, pr * 2, pr * 2, S(p.accent), 12);
    for (let z = 0; z <= pr * 2; z++)
      for (let x = 0; x <= pr * 2; x++) {
        const d = Math.hypot(x - pr, z - pr);
        b.set(x, -1, z, d < 2.5 ? S('crystal_glass') : (x + z) % 2 ? S(p.floor) : S(p.accent));
        for (let k = 0; k < 4; k++) if (d >= 1.5) b.set(x, k, z, 0);
      }
    // A lamp well in the middle, ringed by chorus
    b.set(pr, -2, pr, S('crystal_lamp'));
    b.set(pr, 0, pr, S(p.rail));
    b.set(pr, 1, pr, lamp(p));
  });
  let houses = 0;
  let gardens = 0;
  const houseSpots: P3[] = [];
  const dirs = rng.shuffle([...DIRS]);
  const routes: P3[] = [];
  for (const d of dirs) {
    if (!a.force && rng.chance(0.15)) continue;
    const len = 12 + rng.int(13);
    const [sx, sz] = sideOut(plaza, d);
    const [dx, dz] = DXZ[d];
    const endG = site.ground(sx + dx * len, sz + dz * len);
    const y1 = Math.max(y - Math.floor(len / 3), Math.min(y + Math.floor(len / 3), (endG ?? y - 1) + 1));
    const arm = walkPiece(pl, `arm:${d}:${len}`, sx, sz, d, len, y, a.force ? y : y1, { supports: true });
    pl.occupy(arm);
    routes.push([sx + dx * (len - 1), a.force ? y : y1, sz + dz * (len - 1)]);
    // Houses branch off the arm on either side, facing it
    for (let t = 5; t < len - 2 && houses < 8; t += 6 + rng.int(3)) {
      const yt = Math.round(y + ((a.force ? 0 : y1 - y) * t) / Math.max(1, len - 1));
      for (const sideSign of rng.shuffle([1, -1])) {
        if (houses >= 8 || rng.chance(0.3)) continue;
        const w = 5 + rng.int(3);
        const dd = 5 + rng.int(3);
        const hh = 4 + rng.int(2);
        // The house's front faces the arm: its local +z points away from it
        const away: Dir = dx !== 0 ? (sideSign > 0 ? 'S' : 'N') : sideSign > 0 ? 'E' : 'W';
        const rot = ROT_TOWARD[away];
        const cxw = sx + dx * t + DXZ[away][0] * 3;
        const czw = sz + dz * t + DXZ[away][1] * 3;
        // Frame origin: the footprint's corner that puts the door (local w/2, 0) at (cxw, czw)
        const probe = new Builder(null as unknown as DecorView, 0, 0, 0, rot, w, dd);
        const x0 = cxw - probe.wx(half(w), 0);
        const z0 = czw - probe.wz(half(w), 0);
        const fr = footprint(0, 0, rot, w, dd);
        const fw = fr.x1 + 1;
        const fd = fr.z1 + 1;
        const hr = rectOf(x0, z0, x0 + fw - 1, z0 + fd - 1);
        // (it may touch its own walkway's rail, never another house)
        if (!pl.free(hr, 0)) continue;
        if (!a.force && site.level(hr, 0.6) === null) continue;
        pl.occupy(hr);
        const roof = rng.pick(['flat', 'pyramid', 'dome', 'gable'] as const);
        const wall = rng.pick([p.main, p.accent, p.wood]);
        const hseed = pl.sub(houses, 0x4005);
        const loot = houses % 2 === 0 ? 'chest/end_settlement' : null;
        pl.add(`house:${roof}:${w}x${dd}x${hh}`, rectBox(hr, yt - 14, yt + hh + 8, 2), (v) => house(new Builder(v, hr.x0, yt, hr.z0, rot, w, dd), p, hseed, w, dd, hh, roof, wall, loot));
        houseSpots.push([(hr.x0 + hr.x1) >> 1, yt + 1, (hr.z0 + hr.z1) >> 1]);
        houses++;
      }
    }
    // A chorus garden beside the arm's end
    if (gardens < 4 && rng.chance(0.7)) {
      const gx = sx + dx * (len - 3) + (dz !== 0 ? 4 : 0);
      const gz = sz + dz * (len - 3) + (dx !== 0 ? 4 : 0);
      const gr = rectOf(gx - 2, gz - 2, gx + 2, gz + 1);
      const gy = (site.ground(gx, gz) ?? y - 1) + 1;
      if (pl.free(gr, 0)) {
        pl.occupy(gr);
        const gseed = pl.sub(gardens, 0x6a2d);
        pl.add('garden', rectBox(gr, gy - 2, gy + 8, 0), (v) => garden(v, gseed, gr, gy));
        gardens++;
      }
    }
  }
  if (houses < 4 && !a.force) return null;
  // Endlings live here (no guards)
  const n = 3 + rng.int(4);
  for (let i = 0; i < n; i++) pl.mob('endling', [a.x + rng.int(5) - 2, y, a.z + rng.int(5) - 2]);
  void routes;
  // The Silent City, where no Fallen City lies near: the sealed hall would stand on the plaza (its floor), the shards in the houses
  pl.quest.silent = { hall: [a.x, y - 1, a.z], spots: houseSpots };
  return pl.start(a.x, y, a.z);
};

// ---------------------------------------------------------------------------
// End Ruins
// ---------------------------------------------------------------------------
type Fragment = 'tower' | 'hall' | 'house' | 'bridge' | 'platform' | 'portal' | 'glyphs' | 'shelves';

function ruinFragment(b: Builder, p: Palette, seed: number, kind: Fragment, w: number, d: number, h: number, loot: string | null): void {
  switch (kind) {
    case 'tower':
      tower(b, p, seed, w, Math.max(2, Math.floor(h / 4)), 4, 'terrace');
      break;
    case 'hall':
      footing(b, 0, 0, w - 1, d - 1, S(p.accent), 10);
      storey(b, p, seed, 0, 0, 0, w - 1, d - 1, h);
      doorway(b, half(w), 1, 0, 3);
      break;
    case 'house':
      house(b, p, seed, w, d, Math.min(h, 5), 'flat', p.main, null);
      break;
    case 'bridge':
      walkway(b, p, seed, half(w), 0, d - 1, 3, 3, { supports: true });
      break;
    case 'platform':
      platform(b, p, seed, half(Math.min(w, d)));
      break;
    case 'portal':
      footing(b, 0, 0, w - 1, 2, S('ancient_end_bricks'), 8);
      for (let x = 0; x < w; x++) for (let z = 0; z < 3; z++) b.set(x, 0, z, S('ancient_end_bricks'));
      brokenPortal(b, seed, half(w) - 2, 1, 1, 3, 4, 0.3);
      break;
    case 'glyphs':
      footing(b, 0, 0, w - 1, 1, S('ancient_end_bricks'), 8);
      for (let x = 0; x < w; x++) b.set(x, 0, 0, S('chiseled_ancient_end_bricks'));
      glyphWall(b, seed, 0, 1, 0, w - 1, Math.min(h, 5), 0);
      break;
    case 'shelves':
      footing(b, 0, 0, w - 1, 2, S(p.accent), 8);
      for (let x = 0; x < w; x++)
        for (let y = 0; y <= 3; y++) {
          b.set(x, y, 1, y === 0 ? S(p.accent) : S('bookshelf'));
          b.set(x, y, 0, y === 0 ? S(p.floor) : 0);
        }
      break;
  }
  if (loot) chest(b, 1, 1, 1, 'south', loot, seed);
}

export const planRuins: VariantPlan = (site, a, rng, seed) => {
  const y = baseLevel(site, a, rectOf(a.x - 4, a.z - 4, a.x + 4, a.z + 4), 0.8, 8);
  if (y === null) return null;
  const pl = new Plan('end_ruins', seed, site, biomeAt(site, a), a.force);
  const p = pl.pal;
  const n = 3 + rng.int(4);
  const kinds: Fragment[] = ['tower', 'tower', 'hall', 'hall', 'house', 'house', 'bridge', 'platform', 'portal', 'glyphs', 'shelves'];
  // Always something of the old ones: a glyph wall or a broken portal
  const chosen: Fragment[] = [rng.chance(0.5) ? 'glyphs' : 'portal'];
  while (chosen.length < n) chosen.push(rng.pick(kinds));
  let chests = 1 + rng.int(2);
  const placed: { r: Rect; y: number }[] = [];
  chosen.forEach((kind, i) => {
    for (let tries = 0; tries < 8; tries++) {
      const ang = rng.next() * Math.PI * 2;
      const dist = i === 0 ? 0 : 6 + rng.int(11);
      const w = kind === 'glyphs' || kind === 'shelves' ? 5 + rng.int(4) : 5 + rng.int(5);
      const d = kind === 'glyphs' ? 2 : kind === 'shelves' ? 3 : kind === 'bridge' ? 9 + rng.int(6) : 5 + rng.int(5);
      const h = kind === 'tower' ? 12 + rng.int(10) : 5 + rng.int(6);
      const rot = rng.int(4) as Rotation;
      const cx = a.x + Math.round(Math.cos(ang) * dist);
      const cz = a.z + Math.round(Math.sin(ang) * dist);
      const fr = footprint(cx - half(w), cz - half(d), rot, w, d);
      if (!pl.free(fr, 1)) continue;
      const fy = a.force ? y : site.level(fr, 0.6);
      if (fy === null) continue;
      const yy = a.force ? y : fy + 1;
      pl.occupy(fr);
      placed.push({ r: fr, y: yy });
      const fseed = pl.sub(i, 0x7a1d);
      const collapse = Math.max(3, Math.floor(h * (0.5 + rng.next() * 0.45)));
      const loot = chests > 0 && kind !== 'glyphs' && kind !== 'bridge' ? 'chest/end_ruins' : null;
      if (loot) chests--;
      pl.add(`ruin:${kind}:${w}x${d}`, rectBox(fr, yy - 14, yy + h + 10, 2), (v) => ruinFragment(new RuinBuilder(v, fr.x0, yy, fr.z0, rot, w, d, fseed, 0.1, collapse, 4), p, fseed, kind, w, d, h, loot));
      if (kind === 'portal') pl.portal(frameOf(fr.x0, yy, fr.z0, rot, w, d), [half(w) - 2, 1, 1]);
      return;
    }
  });
  // Loose pieces float a few blocks over the ruin (close enough to bridge)
  const floats = 1 + rng.int(2);
  for (let i = 0; i < floats && placed.length; i++) {
    const base = placed[rng.int(placed.length)]!;
    const w = 3 + rng.int(3);
    const fx = base.r.x0 + rng.int(Math.max(1, base.r.x1 - base.r.x0 + 1));
    const fz = base.r.z0 + rng.int(Math.max(1, base.r.z1 - base.r.z0 + 1));
    const fy = base.y + 6 + rng.int(4);
    const fr = rectOf(fx, fz, fx + w - 1, fz + w - 1);
    const fseed = pl.sub(i, 0xf10a);
    pl.add(`float:${w}`, rectBox(fr, fy - 3, fy + 4, 1), (v) => {
      const b = new RuinBuilder(v, fr.x0, fy, fr.z0, 0, w, w, fseed, 0.22, 3, 2);
      for (let x = 0; x < w; x++)
        for (let z = 0; z < w; z++) {
          b.set(x, 0, z, S(p.accent));
          if (chance(fseed, x, 0, z) < 0.6) b.set(x, -1, z, S(p.main));
          if ((x === 0 || x === w - 1) && chance(fseed, x, 1, z) < 0.5) b.set(x, 1, z, S(p.main));
        }
      if (w >= 4) b.set(1, 1, 1, st.glyph(fseed, fr.x0 + 1, fy + 1, fr.z0 + 1));
    });
  }
  // Void Stalkers haunt the rubble
  const stalkers = 1 + rng.int(2);
  for (let i = 0; i < stalkers; i++) pl.mob('void_stalker', [a.x + rng.int(9) - 4, y, a.z + rng.int(9) - 4]);
  return pl.start(a.x, y, a.z);
};

// ---------------------------------------------------------------------------
// End Library
// ---------------------------------------------------------------------------
type LibFloor = 'shelves' | 'reading' | 'archive';

export const planLibrary: VariantPlan = (site, a, rng, seed) => {
  const w = 13 + 2 * rng.int(3);
  const d = 15 + 2 * rng.int(3);
  const floors = 2 + rng.int(3);
  const fh = 5;
  const rot = rng.int(4) as Rotation;
  const r = footprint(a.x - half(rot & 1 ? d : w), a.z - half(rot & 1 ? w : d), rot, w, d);
  const y = baseLevel(site, a, r, 0.85, 7);
  if (y === null) return null;
  const pl = new Plan('end_library', seed, site, biomeAt(site, a), a.force);
  const p = pl.pal;
  const archiveFloor = 1 + rng.int(floors - 1 || 1);
  const kinds: LibFloor[] = [];
  for (let f = 0; f < floors; f++) kinds.push(f === 0 ? 'shelves' : f === archiveFloor ? 'archive' : rng.chance(0.5) ? 'reading' : 'shelves');
  const roof = rng.pick(['terrace', 'pyramid', 'dome'] as const);
  const aisle = 3 + rng.int(2);
  const top = floors * fh;
  pl.occupy(r);
  const bseed = pl.sub(0x11b);
  {
    // The sealed archive (the Ancient Key opens it)
    const B = frameOf(r.x0, y, r.z0, rot, w, d);
    const fy = archiveFloor * fh;
    const backZ = d - 8;
    pl.seal('archive', [worldOf(B, half(w), fy + 1, backZ), worldOf(B, half(w), fy + 2, backZ)], boxIn(B, 2, fy + 1, backZ + 1, w - 3, fy + fh - 2, d - 2));
  }
  pl.add(`library:${w}x${d}x${floors}:${kinds.join('-')}:${roof}`, rectBox(r, y - 16, y + top + Math.max(w, d) / 2 + 4, 2), (v) => {
    const b = new Builder(v, r.x0, y, r.z0, rot, w, d);
    footing(b, 0, 0, w - 1, d - 1, S(p.accent), 14);
    for (let f = 0; f < floors; f++) storey(b, p, bseed, 0, f * fh, 0, w - 1, d - 1, fh, { floor: f === 0 ? p.floor : p.wood, ceiling: f === floors - 1 ? p.accent : null });
    for (let f = 0; f < floors; f++) {
      const fy = f * fh;
      // The stair up the left wall, opening the floor above it
      if (f < floors - 1) {
        for (let i = 0; i < fh; i++)
          for (const x of [1, 2]) {
            b.set(x, fy + 1 + i, 2 + i, st.stair(p.woodStairs, 'south'));
            for (let k = 1; k <= 3; k++) b.set(x, fy + 1 + i + k, 2 + i, 0);
          }
      }
      const kind = kinds[f]!;
      const backZ = kind === 'archive' ? d - 8 : d - 2;
      if (kind === 'shelves') {
        // Rows of shelves with an aisle down the middle
        for (let x = 4; x < w - 1; x += aisle) {
          if (Math.abs(x - half(w)) < 2) continue;
          for (let z = 4; z <= backZ - 1; z++) for (let k = 1; k <= 3; k++) if (z % 7 !== 0) b.set(x, fy + k, z, S('bookshelf'));
        }
        for (let z = 2; z < d - 1; z++) for (let k = 1; k <= 3; k++) b.set(w - 1, fy + k, z, k === 2 && z % 3 === 1 ? S(p.glass) : S('bookshelf'));
      } else if (kind === 'reading') {
        for (let x = 4; x < w - 2; x += 4)
          for (let z = 4; z < d - 3; z += 4) {
            b.set(x, fy + 1, z, S(p.rail));
            b.set(x, fy + 2, z, st.slab(p.woodSlab, 'bottom'));
            b.set(x - 1, fy + 1, z, st.stair(p.woodStairs, 'east'));
            b.set(x + 1, fy + 1, z, st.stair(p.woodStairs, 'west'));
            b.set(x, fy + fh - 1, z, lamp(p, true));
          }
        for (let z = 2; z < d - 1; z++) b.set(w - 2, fy + 1, z, S('bookshelf'));
        chest(b, w - 2, fy + 1, d - 2, 'west', 'chest/end_library', bseed + f);
      }
      if (kind === 'archive') {
        // The sealed archive: Ward Stone all round, a vault door no key here opens
        for (let x = 1; x < w - 1; x++)
          for (let k = 1; k < fh; k++)
            for (let z = backZ; z < d - 1; z++) {
              const shell = x === 1 || x === w - 2 || z === backZ || k === fh - 1;
              b.set(x, fy + k, z, shell ? S('ancient_ward_stone') : k === 1 || x === 2 || x === w - 3 ? S('bookshelf') : 0);
            }
        b.set(half(w), fy + 1, backZ, stateOf('ancient_vault_door', { facing: 'north' }));
        b.set(half(w), fy + 2, backZ, stateOf('ancient_vault_door', { facing: 'north' }));
        glyphWall(b, bseed, half(w) - 2, fy + 3, backZ, half(w) + 2, fy + 3, backZ);
        chest(b, w - 3, fy + 1, backZ - 2, 'west', 'chest/end_library', bseed + 77);
      }
    }
    // The way in, and the old script over it inside
    doorway(b, half(w), 1, 0, 3);
    glyphWall(b, bseed, half(w) - 2, fh - 1, 1, half(w) + 2, fh - 1, 1);
    chest(b, w - 3, 1, 2, 'west', 'chest/end_library', bseed + 3);
    // Roof
    if (roof === 'terrace') battlements(b, p, 0, top + 1, 0, w - 1, d - 1);
    else if (roof === 'pyramid') pyramidRoof(b, p, -1, top + 1, -1, w, d);
    else dome(b, half(w), top, half(d), Math.min(half(w), half(d)) - 1, S(p.accent), S(p.glass), null);
  });
  // Wings: one-storey reading rooms off the sides
  const wings = rng.int(3);
  const sides: [number, Dir][] = [
    [0, FRONT_OF[(rot + 1) & 3]],
    [1, FRONT_OF[(rot + 3) & 3]],
  ];
  for (let i = 0; i < wings; i++) {
    const [, side] = sides[i]!;
    const ww = 7;
    const wd = 7 + rng.int(3);
    const [sx, sz] = sideOut(r, side, 1);
    const f = runFrame(sx, sz, side, wd, half(ww));
    if (!pl.free(f.rect, 0)) continue;
    pl.occupy(f.rect);
    const wseed = pl.sub(i, 0x3149);
    pl.add(`wing:${side}:${wd}`, rectBox(f.rect, y - 14, y + 10, 1), (v) => {
      const b = runBuilder(v, f, y);
      footing(b, 0, 0, ww - 1, wd - 1, S(p.accent), 12);
      storey(b, p, wseed, 0, 0, 0, ww - 1, wd - 1, 5, { floor: p.wood });
      for (let z = 2; z < wd - 1; z += 2) b.set(ww - 2, 1, z, S('bookshelf'));
      b.set(half(ww), 4, half(wd), lamp(p, true));
      // Opening into the main building
      for (let k = 1; k <= 3; k++) {
        b.set(half(ww), k, 0, 0);
        b.set(half(ww), k, -1, 0);
      }
      battlements(b, p, 0, 6, 0, ww - 1, wd - 1);
    });
  }
  // Two Sentinels walk the central aisle
  const L = (lx: number, lz: number): P3 => {
    const b = new Builder(null as unknown as DecorView, r.x0, y, r.z0, rot, w, d);
    return [b.wx(lx, lz), y + 1, b.wz(lx, lz)];
  };
  const p1 = L(half(w), 3);
  const p2 = L(half(w), d - 4);
  pl.sentinel(p1, [p1, p2]);
  pl.sentinel(p2, [p2, p1]);
  return pl.start(a.x, y, a.z);
};

// ---------------------------------------------------------------------------
// End Observatory
// ---------------------------------------------------------------------------
/** Ring positions around (0, 0) at radius r, in angle order (a spiral stair's steps). */
function ringSteps(r: number): [number, number][] {
  const out: { x: number; z: number; a: number }[] = [];
  const R = Math.ceil(r) + 1;
  for (let z = -R; z <= R; z++)
    for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, z);
      if (d >= r - 0.5 && d < r + 0.5) out.push({ x, z, a: Math.atan2(z, x) });
    }
  out.sort((p, q) => p.a - q.a);
  return out.map((p) => [p.x, p.z]);
}

function facingOf(dx: number, dz: number): string {
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
}

export const planObservatory: VariantPlan = (site, a, rng, seed) => {
  const R0 = 6 + rng.int(3);
  const r = 3 + rng.int(2);
  const H = 20 + rng.int(14);
  const Rd = r + 3 + rng.int(2);
  const plinth = rectOf(a.x - R0, a.z - R0, a.x + R0, a.z + R0);
  const y = baseLevel(site, a, plinth, 0.8, 6);
  if (y === null) return null;
  const pl = new Plan('end_observatory', seed, site, biomeAt(site, a), a.force);
  const p = pl.pal;
  pl.occupy(plinth);
  const cx = a.x;
  const cz = a.z;
  const front = rng.pick(DIRS);
  const [fx, fz] = DXZ[front];
  pl.add(`plinth:${R0}`, rectBox(plinth, y - 16, y + 3, 1), (v) => {
    const b = new Builder(v, cx, y, cz, 0, 1, 1);
    for (let z = -R0; z <= R0; z++)
      for (let x = -R0; x <= R0; x++) {
        const d = Math.hypot(x, z);
        if (d > R0 + 0.4) continue;
        b.foundation(x, z, -1, S(p.accent), 14);
        b.set(x, -1, z, d > R0 - 1 ? S(p.accent) : S(p.floor));
        for (let k = 0; k < 3; k++) if (d > r) b.set(x, k, z, 0);
        if (d > R0 - 0.6 && (Math.round(Math.atan2(z, x) * 8) % 2 === 0)) b.set(x, 0, z, S(p.rail));
      }
  });
  // The spire: a hollow round tower with a spiral stair, opening at the front
  const steps = ringSteps(r - 1.5);
  const sseed = pl.sub(0x5b1e);
  pl.add(`spire:${r}x${H}`, rectBox(rectOf(cx - r, cz - r, cx + r, cz + r), y - 1, y + H + 1, 1), (v) => {
    const b = new Builder(v, cx, y, cz, 0, 1, 1);
    for (let k = 0; k <= H; k++)
      for (let z = -r; z <= r; z++)
        for (let x = -r; x <= r; x++) {
          const d = Math.hypot(x, z);
          if (d > r + 0.4) continue;
          if (d > r - 0.6) {
            const win = k % 6 === 3 && (x === 0 || z === 0);
            b.set(x, k, z, k % 8 === 0 ? S(p.accent) : win ? S(p.glass) : S(p.main));
          } else b.set(x, k, z, k === 0 ? S(p.floor) : 0);
        }
    // Centre column and the spiral of stairs around it
    for (let k = 0; k <= H; k++) b.set(0, k, 0, st.pillar(p));
    const n = steps.length;
    for (let i = 0; i < H; i++) {
      const [sx, sz] = steps[i % n]!;
      const [nx, nz] = steps[(i + 1) % n]!;
      b.set(sx, i + 1, sz, st.stair(p.stairs, facingOf(nx - sx, nz - sz)));
      if (i > 0) b.set(sx, i, sz, S(p.accent));
    }
    for (let k = 1; k <= 3; k++) b.set(fx * r, k, fz * r, 0);
    for (let k = 1; k < H; k += 7) b.set(-fx * (r - 1), k + 2, -fz * (r - 1), lamp(p));
  });
  // The dome room on top with the dormant telescope
  const domeY = y + H;
  const dr = rectOf(cx - Rd, cz - Rd, cx + Rd, cz + Rd);
  const dseed = pl.sub(0xd0e);
  pl.add(`dome:${Rd}`, rectBox(dr, domeY - 3, domeY + Rd + 2, 1), (v) => {
    const b = new Builder(v, cx, domeY, cz, 0, 1, 1);
    for (let z = -Rd; z <= Rd; z++)
      for (let x = -Rd; x <= Rd; x++) {
        const d = Math.hypot(x, z);
        if (d > Rd + 0.4) continue;
        // The stairwell stays open: the spire's last steps come up through it
        if (d < r - 0.5) continue;
        if (d > r + 0.4) b.set(x, -1, z, S(p.accent));
        b.set(x, 0, z, (x + z) % 2 ? S(p.floor) : S(p.accent));
      }
    dome(b, 0, 0, 0, Rd, S(p.accent), S(p.glass), null);
    telescope(b, Math.round(Rd / 2), 1, 0);
    chest(b, -Math.round(Rd / 2), 1, 1, 'east', 'chest/end_observatory', dseed);
    b.set(0, Rd - 1, 0, lamp(p, true));
  });
  {
    // The Lost Observatory: the telescope's lens, the core at its foot, and the gaps a repair closes in its tube
    const D = frameOf(cx, domeY, cz, 0, 1, 1);
    const X = Math.round(Rd / 2);
    pl.quest.lens = { lens: worldOf(D, X, 8, -4), core: worldOf(D, X, 2, 0), mend: [worldOf(D, X, 5, 0), worldOf(D, X, 6, -1), worldOf(D, X, 7, -2), worldOf(D, X, 8, -3)] };
  }
  // Buttress fins and balconies
  const fins = rng.int(5);
  const fdirs = rng.shuffle([...DIRS]).slice(0, fins);
  for (const d of fdirs) {
    const [ex, ez] = DXZ[d];
    const fhh = Math.floor(H * (0.3 + rng.next() * 0.2));
    pl.add(`fin:${d}:${fhh}`, rectBox(rectOf(cx + ex * r, cz + ez * r, cx + ex * (R0 - 1), cz + ez * (R0 - 1)), y - 1, y + fhh + 1, 1), (v) => {
      for (let i = r; i < R0; i++) {
        const top = Math.floor(fhh * (1 - (i - r) / (R0 - r)));
        for (let k = 0; k <= top; k++) v.set(cx + ex * i, y + k, cz + ez * i, S(p.accent));
      }
    });
  }
  const balconies = 1 + rng.int(2);
  // Where the stair passes the front: a door there leads out onto a balcony
  let frontIdx = 0;
  steps.forEach(([sx, sz], i) => {
    const [bx, bz] = steps[frontIdx]!;
    if ((sx - fx * r) ** 2 + (sz - fz * r) ** 2 < (bx - fx * r) ** 2 + (bz - fz * r) ** 2) frontIdx = i;
  });
  for (let i = 0; i < balconies; i++) {
    const want = Math.floor(H * (0.4 + i * 0.3));
    const by = y + frontIdx + Math.max(0, Math.round((want - frontIdx) / steps.length)) * steps.length;
    if (by >= y + H - 2) continue;
    pl.add(`balcony:${by - y}`, rectBox(rectOf(cx - r - 2, cz - r - 2, cx + r + 2, cz + r + 2), by - 1, by + 2, 0), (v) => {
      for (let z = -r - 2; z <= r + 2; z++)
        for (let x = -r - 2; x <= r + 2; x++) {
          const d = Math.hypot(x, z);
          if (d <= r + 0.4 || d > r + 2.4) continue;
          v.set(cx + x, by, cz + z, S(p.accent));
          if (d > r + 1.5) v.set(cx + x, by + 1, cz + z, S(p.rail));
        }
      // A door out from the stair
      v.set(cx + fx * r, by + 1, cz + fz * r, 0);
      v.set(cx + fx * r, by + 2, cz + fz * r, 0);
    });
  }
  // Annex rooms against the plinth
  const annexes = rng.int(3);
  for (let i = 0; i < annexes; i++) {
    const d = DIRS[(DIRS.indexOf(front) + 1 + i * 2) % 4]!;
    const [sx, sz] = sideOut(plinth, d, 1);
    const f = runFrame(sx, sz, d, 6, 3);
    if (!pl.free(f.rect, 0)) continue;
    pl.occupy(f.rect);
    const aseed = pl.sub(i, 0xa77e);
    pl.add(`annex:${d}`, rectBox(f.rect, y - 14, y + 7, 1), (v) => {
      const b = runBuilder(v, f, y - 1);
      footing(b, 0, 0, 6, 5, S(p.accent), 12);
      storey(b, p, aseed, 0, 0, 0, 6, 5, 4);
      battlements(b, p, 0, 5, 0, 6, 5);
      doorway(b, 3, 1, 0);
      b.set(1, 1, 4, st.glyph(aseed, f.rect.x0, y, f.rect.z0));
    });
  }
  // A Bulwark guards the dome
  pl.bulwark([cx + Math.round(Rd / 2) - 2, domeY + 1, cz], boxOf(cx - Rd, domeY, cz - Rd, cx + Rd, domeY + Rd, cz + Rd));
  return pl.start(cx, y, cz);
};

// ---------------------------------------------------------------------------
// End Shipyard
// ---------------------------------------------------------------------------
/** A classic End Ship hull along local +z (bow at z = 0), deck at y = 0. */
function hull(b: Builder, p: Palette, seed: number, len: number, w: number, finished: boolean, masts: number, sail: string, loot: string | null): void {
  const purpur = S('purpur_block');
  const pil = stateOf('purpur_pillar', { axis: 'y' });
  const slab = st.slab('purpur_block_slab');
  const hw = half(w);
  for (let z = 0; z < len; z++) {
    const taper = z < 3 ? 3 - z : z > len - 3 ? z - (len - 3) : 0;
    const x0 = Math.min(hw, taper);
    const x1 = w - 1 - x0;
    const frame = !finished && z % 2 === 1;
    for (let x = x0; x <= x1; x++) {
      const side = x === x0 || x === x1;
      if (!finished) {
        // Keel and ribs only: a frame waiting for its planks
        if (x === hw || (frame && side)) b.set(x, -1, z, purpur);
        if (frame && side) b.set(x, 0, z, pil);
        if (frame && side && z % 4 === 1) b.set(x, 1, z, pil);
        if (chance(seed, b.wx(x, z), 0, b.wz(x, z)) < 0.25) b.set(x, 0, z, S('scaffolding'));
        continue;
      }
      b.set(x, -1, z, purpur);
      if (z > 1 && z < len - 2 && x > x0 && x < x1) b.set(x, -2, z, purpur);
      if (side) {
        b.set(x, 0, z, purpur);
        b.set(x, 1, z, slab);
      } else b.set(x, 0, z, 0);
    }
  }
  if (!finished) return;
  // Masts and sails
  for (let m = 0; m < masts; m++) {
    const mz = Math.floor(((m + 1) * len) / (masts + 1));
    for (let h = 1; h <= 8; h++) b.set(hw, h, mz, pil);
    for (let h = 4; h <= 7; h++) for (let dx = -2; dx <= 2; dx++) if (dx !== 0) b.set(hw + dx, h, mz, S(sail));
    b.set(hw, 9, mz, st.rod());
  }
  b.set(hw, 0, 1, S('brewing_stand'));
  b.set(hw, 1, len - 1, st.rod());
  if (loot) chest(b, hw, 0, len - 3, 'north', loot, seed);
}

export const planShipyard: VariantPlan = (site, a, rng, seed) => {
  // Find a shore: land here, the void a few blocks away in one direction and beyond
  let found: { x: number; z: number; d: Dir; edge: number } | null = null;
  const dirs = rng.shuffle([...DIRS]);
  outer: for (let tries = 0; tries < 12; tries++) {
    const x = a.x + (tries ? rng.int(33) - 16 : 0);
    const z = a.z + (tries ? rng.int(33) - 16 : 0);
    if (site.ground(x, z) === null) continue;
    for (const d of dirs) {
      const [dx, dz] = DXZ[d];
      let edge = -1;
      for (let i = 4; i <= 18; i++)
        if (site.ground(x + dx * i, z + dz * i) === null) {
          edge = i;
          break;
        }
      if (edge < 0) continue;
      let open = true;
      for (let i = edge; i < edge + 34 && open; i += 2) for (const o of [-8, 0, 8]) if (site.ground(x + dx * i + (dz ? o : 0), z + dz * i + (dx ? o : 0)) !== null) open = false;
      if (open) {
        found = { x, z, d, edge };
        break outer;
      }
    }
  }
  if (!found) {
    if (!a.force) return null;
    found = { x: a.x, z: a.z, d: dirs[0]!, edge: 6 };
  }
  const { d, edge } = found;
  const [dx, dz] = DXZ[d];
  const yw = 9 + 2 * rng.int(3);
  const yd = 7 + 2 * rng.int(2);
  // The yard sits on the shore, its front edge at the island's edge
  const yf = runFrame(found.x + dx * Math.max(0, edge - yd), found.z + dz * Math.max(0, edge - yd), d, yd, half(yw));
  const y = a.force ? (a.y ?? 64) : (() => {
    const lv = site.level(yf.rect, 0.5);
    return lv === null ? null : lv + 1;
  })();
  if (y === null || (!a.force && !site.fits(yf.rect, 40))) return null;
  const pl = new Plan('end_shipyard', seed, site, biomeAt(site, { ...a, x: found.x, z: found.z }), a.force);
  const p = pl.pal;
  pl.occupy(yf.rect);
  const yseed = pl.sub(0x7a2d);
  pl.add(`yard:${yw}x${yd}`, rectBox(yf.rect, y - 16, y + 6, 1), (v) => {
    const b = runBuilder(v, yf, y);
    footing(b, 0, 0, yf.sx - 1, yd - 1, S(p.accent), 14);
    for (let x = 0; x < yf.sx; x++)
      for (let z = 0; z < yd; z++) {
        b.set(x, -1, z, (x + z) % 3 ? S(p.floor) : S('purpur_block'));
        for (let k = 0; k < 4; k++) b.set(x, k, z, 0);
      }
    for (let x = 0; x < yf.sx; x += 2) b.set(x, 0, 0, S(p.rail));
    b.set(1, 0, 1, S('barrel'));
    b.set(2, 0, 1, S('purpur_block'));
    b.set(yf.sx - 2, 0, 1, S('chorus_rope'));
    chest(b, yf.sx - 2, 0, 2, 'west', 'chest/end_shipyard', yseed);
    b.set(half(yf.sx), 0, 1, lamp(p));
  });
  // The pier runs out over the void
  const pierLen = 24 + rng.int(13);
  const [px, pz] = [found.x + dx * edge, found.z + dz * edge];
  const pf = runFrame(px, pz, d, pierLen, 3);
  pl.occupy(pf.rect);
  const pseed = pl.sub(0x9137);
  pl.add(`pier:${pierLen}`, rectBox(pf.rect, y - 6, y + 4, 1), (v) => {
    const b = runBuilder(v, pf, y);
    for (let z = 0; z < pierLen; z++) {
      for (let x = 0; x < 7; x++) {
        b.set(x, -1, z, x === 0 || x === 6 ? S(p.accent) : S(p.wood));
        if (x > 1 && x < 5 && z % 6 === 0) for (let k = 2; k <= 4; k++) b.set(x, -k, z, S(p.accent));
        for (let k = 0; k < 3; k++) b.set(x, k, z, 0);
      }
      if (z % 4 === 2) {
        b.set(0, 0, z, z % 8 === 2 ? lamp(p) : S(p.rail));
        b.set(6, 0, z, z % 8 === 6 ? lamp(p) : S(p.rail));
      }
    }
    void pseed;
  });
  // Hulls berthed along the pier: always one finished and one half-built
  const hulls = 2 + rng.int(2);
  const elytra = rng.chance(SHIPYARD_ELYTRA_CHANCE);
  const plan: boolean[] = [true, false, rng.chance(0.5)];
  let elytraPlaced = false;
  for (let i = 0; i < hulls; i++) {
    const finished = plan[i]!;
    const len = 13 + 2 * rng.int(4);
    const w = 5 + 2 * rng.int(2);
    const side = i % 2 === 0 ? 1 : -1;
    const along = 4 + i * Math.floor((pierLen - 8) / hulls) + rng.int(3);
    // The berth: alongside the pier, the bow towards the pier's end
    const off = 3 + 2 + half(w);
    const bx = px + dx * along + (dz !== 0 ? side * off : 0);
    const bz = pz + dz * along + (dx !== 0 ? side * off : 0);
    const hf = runFrame(bx, bz, d, len, half(w));
    if (!pl.free(hf.rect, 0)) continue;
    pl.occupy(hf.rect);
    const masts = 1 + rng.int(2);
    const sail = rng.pick(['black_wool', 'purple_wool', 'magenta_wool', 'white_wool']);
    const loot = finished ? (elytra && !elytraPlaced ? 'chest/end_shipyard_elytra' : 'chest/end_shipyard_ship') : null;
    if (loot === 'chest/end_shipyard_elytra') elytraPlaced = true;
    const hseed = pl.sub(i, 0x5419);
    pl.add(`${finished ? 'ship' : 'frame'}:${len}x${w}:${masts}`, rectBox(hf.rect, y - 4, y + 12, 1), (v) => hull(runBuilder(v, hf, y), p, hseed, len, w, finished, masts, sail, loot));
    // A gangplank from the pier to the deck
    const gx = px + dx * (along + 3);
    const gz = pz + dz * (along + 3);
    pl.add('gangplank', rectBox(rectOf(gx - 6, gz - 6, gx + 6, gz + 6), y - 2, y + 2, 0), (v) => {
      for (let k = 4; k <= 5; k++) {
        const x = gx + (dz !== 0 ? side * k : 0);
        const z = gz + (dx !== 0 ? side * k : 0);
        v.set(x, y - 1, z, S(p.wood));
        v.set(x, y, z, 0);
        v.set(x, y + 1, z, 0);
      }
    });
    // A crane over the half-built hull
    if (!finished) {
      const ch = 12 + rng.int(5);
      const cx0 = px + dx * (along + half(len)) + (dz !== 0 ? -side * 2 : 0);
      const cz0 = pz + dz * (along + half(len)) + (dx !== 0 ? -side * 2 : 0);
      const ox = dz !== 0 ? side : 0;
      const oz = dx !== 0 ? side : 0;
      pl.add(`crane:${ch}`, rectBox(rectOf(cx0 - 9, cz0 - 9, cx0 + 9, cz0 + 9), y - 1, y + ch + 2, 0), (v) => {
        for (let k = 0; k <= ch; k++) v.set(cx0, y + k, cz0, stateOf('purpur_pillar', { axis: 'y' }));
        for (let i2 = -1; i2 <= off + 1; i2++) v.set(cx0 + ox * i2, y + ch, cz0 + oz * i2, S(p.accent));
        for (let k = 1; k <= 5; k++) v.set(cx0 + ox * (off + 1), y + ch - k, cz0 + oz * (off + 1), stateOf('chain', { axis: 'y' }));
        v.set(cx0 + ox * (off + 1), y + ch - 6, cz0 + oz * (off + 1), S('purpur_block'));
        v.set(cx0 - ox, y + ch - 1, cz0 - oz, S('purpur_block'));
      });
    }
  }
  // Sentinels walk the pier
  const s0: P3 = [px - dx, y, pz - dz];
  const s1: P3 = [px + dx * (pierLen - 3), y, pz + dz * (pierLen - 3)];
  const sm: P3 = [px + dx * half(pierLen), y, pz + dz * half(pierLen)];
  pl.sentinel(s0, [s0, s1]);
  pl.sentinel(s1, [s1, s0]);
  if (rng.chance(0.5)) pl.sentinel(sm, [sm, s0, sm, s1]);
  return pl.start(found.x, y, found.z);
};

// ---------------------------------------------------------------------------
// End Metropolis
// ---------------------------------------------------------------------------
/** A straight bridge between two points (any direction), `w` wide, rising evenly. */
function lineBridge(v: DecorView, p: Palette, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): void {
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const x0 = Math.floor(Math.min(ax, bx) - w - 1);
  const x1 = Math.ceil(Math.max(ax, bx) + w + 1);
  const z0 = Math.floor(Math.min(az, bz) - w - 1);
  const z1 = Math.ceil(Math.max(az, bz) + w + 1);
  const hw = w / 2;
  for (let z = Math.max(z0, v.bz); z <= Math.min(z1, v.bz + 15); z++)
    for (let x = Math.max(x0, v.bx); x <= Math.min(x1, v.bx + 15); x++) {
      const rx = x + 0.5 - ax;
      const rz = z + 0.5 - az;
      const t = rx * ux + rz * uz;
      if (t < -0.5 || t > len + 0.5) continue;
      const side = Math.abs(rx * uz - rz * ux);
      const y = Math.round(ay + (by - ay) * Math.max(0, Math.min(1, t / len)));
      if (side <= hw) {
        v.set(x, y - 1, z, S(p.accent));
        for (let k = 0; k < 3; k++) v.set(x, y + k, z, 0);
      } else if (side <= hw + 1) {
        if (soft(v.get(x, y - 1, z))) v.set(x, y - 1, z, S(p.accent));
        if (soft(v.get(x, y, z))) v.set(x, y, z, Math.round(t) % 7 === 3 ? lamp(p) : S(p.rail));
      }
    }
}

export const planMetropolis: VariantPlan = (site, a, rng, seed) => {
  const pr = 8 + rng.int(4);
  const plaza = rectOf(a.x - pr, a.z - pr, a.x + pr, a.z + pr);
  const y = baseLevel(site, a, plaza, 0.85, 6);
  if (y === null) return null;
  if (!a.force && !site.fits(rectOf(a.x - 48, a.z - 48, a.x + 48, a.z + 48), 4)) return null;
  const pl = new Plan('end_metropolis', seed, site, biomeAt(site, a), a.force);
  const p = pl.pal;
  pl.occupy(plaza);
  const fh = 5;
  // Towers around the plaza
  const n = 4 + rng.int(4);
  const base = rng.next() * Math.PI * 2;
  const towers: { r: Rect; y: number; w: number; floors: number; top: number; cx: number; cz: number; door: Dir; ang: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = base + (i / n) * Math.PI * 2 + (rng.next() - 0.5) * 0.4;
    const dist = 24 + rng.int(10);
    const w = 9 + 2 * rng.int(3);
    const floors = 4 + rng.int(5);
    const cx = a.x + Math.round(Math.cos(ang) * dist);
    const cz = a.z + Math.round(Math.sin(ang) * dist);
    const r = rectOf(cx - half(w), cz - half(w), cx - half(w) + w - 1, cz - half(w) + w - 1);
    if (!pl.free(r, 3)) continue;
    const ty = a.force ? y : site.level(r, 0.7);
    if (ty === null) continue;
    const yy = a.force ? y : ty + 1;
    // The door faces the plaza
    const door: Dir = Math.abs(cx - a.x) > Math.abs(cz - a.z) ? (cx > a.x ? 'W' : 'E') : cz > a.z ? 'N' : 'S';
    const rot = DIRS.indexOf(door) as Rotation;
    const roof = rng.pick(['terrace', 'pyramid', 'crown'] as const);
    const tseed = pl.sub(i, 0x7e2);
    const top = towerPiece(pl, `tower:${w}x${floors}:${roof}`, r, yy, rot, w, floors, fh, roof, tseed, (b, t) => chest(b, 1, t - fh + 1, 1, 'south', 'chest/end_metropolis', tseed));
    towers.push({ r, y: yy, w, floors, top, cx, cz, door, ang });
  }
  if (towers.length < 4 && !a.force) return null;
  // The plaza, with a crystal monument
  pl.add(`plaza:${pr}`, rectBox(plaza, y - 16, y + 9, 0), (v) => {
    const b = new Builder(v, a.x, y, a.z, 0, 1, 1);
    for (let z = -pr; z <= pr; z++)
      for (let x = -pr; x <= pr; x++) {
        const d = Math.hypot(x, z);
        if (d > pr + 0.4) continue;
        b.foundation(x, z, -1, S(p.accent), 14);
        b.set(x, -1, z, d < 2 ? S(p.glass) : Math.round(d) % 3 === 0 ? S(p.accent) : S(p.floor));
        for (let k = 0; k < 6; k++) if (Math.abs(x) > 1 || Math.abs(z) > 1) b.set(x, k, z, 0);
      }
    for (let k = 0; k < 6; k++) b.set(0, k, 0, k === 5 ? S('crystal_lamp') : st.pillar(p));
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      b.set(x, 0, z, S(p.accent));
      b.set(x, 1, z, lamp(p));
    }
  });
  // Paths from the plaza to each door, and sky bridges between neighbours
  towers.sort((p1, p2) => p1.ang - p2.ang);
  towers.forEach((t, i) => {
    const [dx2, dz2] = sideOut(t.r, t.door, 1);
    const ang = Math.atan2(dz2 - a.z, dx2 - a.x);
    const sx = a.x + Math.cos(ang) * pr;
    const sz = a.z + Math.sin(ang) * pr;
    const box = boxOf(Math.min(sx, dx2) - 3, Math.min(y, t.y) - 3, Math.min(sz, dz2) - 3, Math.max(sx, dx2) + 3, Math.max(y, t.y) + 4, Math.max(sz, dz2) + 3);
    pl.add('path', box, (v) => lineBridge(v, p, sx, y, sz, dx2 + 0.5, t.y, dz2 + 0.5, 3));
    const u = towers[(i + 1) % towers.length]!;
    if (u === t || towers.length < 2) return;
    // A floor both towers share (within a few blocks), two below the lower roof
    const ka = Math.max(1, t.floors - 2);
    const ya = t.y + ka * fh + 1;
    const kb = Math.max(1, Math.min(u.floors - 1, Math.round((ya - 1 - u.y) / fh)));
    const yb = u.y + kb * fh + 1;
    const dist = Math.hypot(u.cx - t.cx, u.cz - t.cz);
    if (Math.abs(ya - yb) > dist / 3) return;
    // From wall to wall, through doorways
    const ux = (u.cx - t.cx) / dist;
    const uz = (u.cz - t.cz) / dist;
    const fa = half(t.w) + 0.5;
    const fb = half(u.w) + 0.5;
    const ax = t.cx + 0.5 + ux * fa;
    const az = t.cz + 0.5 + uz * fa;
    const bx = u.cx + 0.5 - ux * fb;
    const bz = u.cz + 0.5 - uz * fb;
    const box2 = boxOf(Math.min(ax, bx) - 3, Math.min(ya, yb) - 2, Math.min(az, bz) - 3, Math.max(ax, bx) + 3, Math.max(ya, yb) + 4, Math.max(az, bz) + 3);
    pl.add(`skybridge:${Math.round(dist)}`, box2, (v) => {
      lineBridge(v, p, ax - ux * 1.5, ya, az - uz * 1.5, bx + ux * 1.5, yb, bz + uz * 1.5, 3);
      for (let k = 0; k < 3; k++) {
        v.set(Math.floor(ax - ux * 0.6), ya + k, Math.floor(az - uz * 0.6), 0);
        v.set(Math.floor(bx + ux * 0.6), yb + k, Math.floor(bz + uz * 0.6), 0);
      }
    });
  });
  // The vault under the plaza, down a stair, guarded by Bulwarks
  const vy = y - 10;
  const vr = rectOf(a.x - 5, a.z - 5, a.x + 5, a.z + 5);
  const vseed = pl.sub(0xa017);
  const sd = rng.pick(DIRS);
  const [sdx, sdz] = DXZ[sd];
  pl.add('vault', rectBox(vr, vy - 2, y + 1, 1), (v) => {
    const b = new Builder(v, vr.x0, vy, vr.z0, 0, 11, 11);
    for (let x = -1; x <= 11; x++)
      for (let z = -1; z <= 11; z++)
        for (let k = -1; k <= 7; k++) {
          const shell = x <= 0 || x >= 10 || z <= 0 || z >= 10 || k <= 0 || k >= 6;
          b.set(x, k, z, shell ? (k === 0 && x > 0 && x < 10 && z > 0 && z < 10 ? S('chiseled_ancient_end_bricks') : S('ancient_end_bricks')) : 0);
        }
    glyphWall(b, vseed, 2, 2, 1, 8, 4, 1);
    for (const [x, z, f] of [
      [2, 9, 'north'],
      [8, 9, 'north'],
      [5, 9, 'north'],
    ] as const)
      chest(b, x, 1, z, f, 'chest/end_metropolis_vault', vseed + x);
    b.set(5, 5, 5, lamp(p, true));
  });
  // The stair down: from the plaza's edge into the vault's side
  const stf = runFrame(a.x + sdx * (pr - 1), a.z + sdz * (pr - 1), OPPOSITE[sd], 11, 1);
  pl.add('vault_stair', rectBox(stf.rect, vy - 1, y + 3, 1), (v) => {
    const b = runBuilder(v, stf, vy);
    for (let i = 0; i < 10; i++)
      for (let x = 0; x < 3; x++) {
        // Going down towards the vault is local +z: the stairs rise towards local -z
        b.set(x, 10 - i, i, st.stair(p.stairs, 'north'));
        for (let k = 1; k <= 3; k++) b.set(x, 10 - i + k, i, 0);
      }
  });
  const room = boxOf(vr.x0, vy, vr.z0, vr.x1, vy + 6, vr.z1);
  pl.bulwark([a.x, vy + 1, a.z], room);
  const constructs = 4 + rng.int(3);
  if (constructs >= 5) pl.bulwark([a.x + 2, vy + 1, a.z + 2], room);
  const ring: P3[] = [
    [a.x + pr - 2, y, a.z],
    [a.x, y, a.z + pr - 2],
    [a.x - pr + 2, y, a.z],
    [a.x, y, a.z - pr + 2],
  ];
  for (let i = 0; i < constructs - (constructs >= 5 ? 2 : 1); i++) pl.sentinel(ring[i % 4]!, [...ring.slice(i % 4), ...ring.slice(0, i % 4)]);
  return pl.start(a.x, y, a.z);
};

// ---------------------------------------------------------------------------
// End Palace
// ---------------------------------------------------------------------------
export const planPalace: VariantPlan = (site, a, rng, seed) => {
  const W = 27 + 2 * rng.int(4);
  const D = 35 + 2 * rng.int(5);
  const rot = rng.int(4) as Rotation;
  const r = footprint(a.x - half(rot & 1 ? D : W), a.z - half(rot & 1 ? W : D), rot, W, D);
  const y = baseLevel(site, a, r, 0.65, 12, 0.7);
  if (y === null) return null;
  const pl = new Plan('end_palace', seed, site, biomeAt(site, a), a.force);
  const p = pl.pal;
  pl.occupy(r);
  const Le = 7 + rng.int(3);
  const courts = 1 + rng.int(2);
  const Lc = 9 + 2 * rng.int(2);
  const Lv = 6;
  const zHall = 3;
  const zCourt = zHall + Le;
  const zThrone = zCourt + Lc;
  const zVault = D - 1 - Lv;
  const Ht = 12 + rng.int(5);
  const towersN = 2 + rng.int(3);
  const crystal = S('crystalline_end_stone_bricks');
  const glass = S('crystal_glass');
  const pseed = pl.sub(0x9a1);
  const frameAt = (v: DecorView): Builder => new Builder(v, r.x0, y, r.z0, rot, W, D);
  const local = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => {
    const b = frameAt(null as unknown as DecorView);
    const xs = [b.wx(x0, z0), b.wx(x1, z1)];
    const zs = [b.wz(x0, z0), b.wz(x1, z1)];
    return boxOf(Math.min(...xs) - 1, y + y0, Math.min(...zs) - 1, Math.max(...xs) + 1, y + y1, Math.max(...zs) + 1);
  };
  const L = (lx: number, ly: number, lz: number): P3 => {
    const b = frameAt(null as unknown as DecorView);
    return [b.wx(lx, lz), y + ly, b.wz(lx, lz)];
  };
  // Foundations and the front steps
  pl.add('foundation', local(-1, -16, -1, W, 0, D), (v) => {
    const b = frameAt(v);
    footing(b, 0, 0, W - 1, D - 1, crystal, 16);
    for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) b.set(x, 0, z, (x + z) % 2 ? S('polished_crystalline_end_stone') : crystal);
    for (let i = 0; i < 3; i++) for (let x = half(W) - 4 + i; x <= half(W) + 4 - i; x++) b.set(x, 0 - 0, i, st.stair('crystalline_end_stone_bricks_stairs', 'south'));
  });
  // Entrance hall with wings either side
  pl.add(`hall:${Le}`, local(0, 0, zHall, W - 1, 12, zCourt), (v) => {
    const b = frameAt(v);
    storey(b, p, pseed, 0, 0, zHall, W - 1, zCourt, 9, { wall: 'crystalline_end_stone_bricks', glass: 'crystal_glass', floor: 'polished_crystalline_end_stone', ceiling: 'crystalline_end_stone_bricks' });
    doorway(b, half(W), 1, zHall, 3, 4);
    // Wings: rooms behind inner walls, with chests
    for (const [x0, x1] of [
      [1, 6],
      [W - 7, W - 2],
    ] as const) {
      for (let z = zHall + 1; z < zCourt; z++) for (let k = 1; k <= 8; k++) b.set(x0 === 1 ? x1 + 1 : x0 - 1, k, z, k <= 3 && z === zHall + half(Le) ? 0 : crystal);
      chest(b, x0 === 1 ? 2 : W - 3, 1, zCourt - 2, x0 === 1 ? 'east' : 'west', 'chest/end_palace', pseed + x0);
    }
    for (let x = 8; x < W - 8; x += 4) b.set(x, 8, zHall + half(Le), lamp(p, true));
    battlements(b, p, 0, 10, zHall, W - 1, zCourt);
  });
  // Courtyards: open to the sky, crystal growing in their beds
  pl.add(`court:${courts}:${Lc}`, local(0, 0, zCourt, W - 1, 12, zThrone), (v) => {
    const b = frameAt(v);
    for (let z = zCourt; z <= zThrone; z++)
      for (let x = 0; x < W; x++) {
        const wall = x === 0 || x === W - 1 || z === zCourt || z === zThrone;
        const mid = courts === 2 && Math.abs(x - half(W)) <= 1;
        for (let k = 1; k <= 8; k++) b.set(x, k, z, wall || (mid && k > 4) ? (k % 3 === 2 && !mid ? glass : crystal) : 0);
        if (!wall && !mid && (x + z) % 5 === 0) b.set(x, 1, z, S('end_crystal_cluster'));
      }
    // Ways through: from the hall, and on to the throne
    for (let k = 1; k <= 4; k++)
      for (let dx = -1; dx <= 1; dx++) {
        b.set(half(W) + dx, k, zCourt, 0);
        b.set(half(W) + dx, k, zThrone, 0);
        if (courts === 2) for (let z = zCourt; z <= zThrone; z++) b.set(half(W) + dx, k, z, 0);
      }
    b.set(courts === 2 ? 4 : half(W), 1, zCourt + half(Lc), S('crystal_lamp'));
    battlements(b, p, 0, 9, zCourt, W - 1, zThrone);
  });
  // The throne hall: crystal pillars, a dais, and behind the throne the sealed vault
  pl.add(`throne:${Ht}`, local(0, 0, zThrone, W - 1, Ht + 3, D - 1), (v) => {
    const b = frameAt(v);
    storey(b, p, pseed, 0, 0, zThrone, W - 1, D - 1, Ht, { wall: 'crystalline_end_stone_bricks', glass: 'crystal_glass', floor: 'astral_mosaic', ceiling: 'crystalline_end_stone_bricks' });
    for (let k = 1; k <= 4; k++) for (let dx = -1; dx <= 1; dx++) b.set(half(W) + dx, k, zThrone, 0);
    for (let z = zThrone + 3; z < zVault - 3; z += 4)
      for (const x of [4, W - 5]) for (let k = 1; k < Ht; k++) b.set(x, k, z, stateOf('crystal_pillar', { axis: 'y' }));
    // Dais and throne
    for (let x = half(W) - 3; x <= half(W) + 3; x++) for (let z = zVault - 4; z < zVault; z++) b.set(x, 1, z, z === zVault - 4 ? st.stair('crystalline_end_stone_bricks_stairs', 'south') : crystal);
    b.set(half(W), 2, zVault - 2, st.stair('crystalline_end_stone_bricks_stairs', 'north'));
    b.set(half(W) - 1, 2, zVault - 2, S('crystal_glass'));
    b.set(half(W) + 1, 2, zVault - 2, S('crystal_glass'));
    b.set(half(W), 3, zVault - 1, S('crystal_lamp'));
    for (let x = 6; x < W - 6; x += 5) b.set(x, Ht - 1, zThrone + 4, lamp(p, true));
    // The vault, sealed: Ward Stone round a crystal door
    for (let x = 1; x < W - 1; x++) for (let k = 1; k < Ht; k++) for (let z = zVault; z < D - 1; z++) b.set(x, k, z, x === 1 || x === W - 2 || z === zVault || z === D - 2 || k >= 6 ? S('ancient_ward_stone') : 0);
    b.set(half(W), 1, zVault, stateOf('crystal_vault_door', { facing: 'north' }));
    b.set(half(W), 2, zVault, stateOf('crystal_vault_door', { facing: 'north' }));
    chest(b, 2, 1, zVault - 2, 'east', 'chest/end_palace', pseed + 0x7f);
    battlements(b, p, 0, Ht + 1, zThrone, W - 1, D - 1);
  });
  // Corner towers with crystal spires
  const corners = rng.shuffle<[number, number]>([
    [0, 0],
    [W - 1, 0],
    [0, D - 1],
    [W - 1, D - 1],
  ]).slice(0, towersN);
  corners.forEach(([lx, lz], i) => {
    const tr = 3 + rng.int(2);
    const th = 16 + rng.int(8);
    const sh = 8 + rng.int(8);
    pl.add(`spire_tower:${tr}x${th}`, local(lx - tr, -1, lz - tr, lx + tr, th + sh + 1, lz + tr), (v) => {
      const b = frameAt(v);
      for (let k = 0; k <= th + sh; k++)
        for (let z = -tr; z <= tr; z++)
          for (let x = -tr; x <= tr; x++) {
            const d = Math.hypot(x, z);
            const rr = k <= th ? tr : tr * (1 - (k - th) / sh);
            if (d > rr + 0.4) continue;
            b.set(lx + x, k, lz + z, k <= th ? (d > rr - 0.6 ? (k % 5 === 3 ? glass : crystal) : k % 6 === 0 ? crystal : 0) : glass);
          }
      b.set(lx, th + sh + 1, lz, S('end_crystal_cluster'));
      void i;
    });
  });
  // Three Bulwarks: hall, court, throne
  pl.bulwark(L(half(W), 1, zHall + half(Le)), local(0, 0, zHall, W - 1, 9, zCourt));
  pl.bulwark(L(courts === 2 ? half(W) : half(W) + 3, 1, zCourt + half(Lc)), local(0, 0, zCourt, W - 1, 9, zThrone));
  pl.bulwark(L(half(W), 1, zVault - 6), local(0, 0, zThrone, W - 1, Ht, zVault));
  // The Crystal Vault: its door, the room behind it, four pedestals on the dais, and where its Bulwark wakes
  {
    const B = frameOf(r.x0, y, r.z0, rot, W, D);
    pl.seal('vault', [L(half(W), 1, zVault), L(half(W), 2, zVault)], boxIn(B, 2, 1, zVault + 1, W - 3, 5, D - 3));
    pl.quest.vault = { pedestals: [L(half(W) - 3, 2, zVault - 1), L(half(W) + 3, 2, zVault - 1), L(half(W) - 3, 2, zVault - 3), L(half(W) + 3, 2, zVault - 3)], bulwark: L(half(W), 1, zVault + 3) };
  }
  return pl.start(a.x, y, a.z);
};

/** Plans by variant id. */
export const VARIANT_PLANS: Record<string, VariantPlan> = {
  end_outpost: planOutpost,
  end_settlement: planSettlement,
  end_ruins: planRuins,
  end_library: planLibrary,
  end_observatory: planObservatory,
  end_shipyard: planShipyard,
  end_metropolis: planMetropolis,
  end_palace: planPalace,
};

/** Farthest a variant's pieces reach from its anchor (blocks). */
export const VARIANT_REACH: Record<string, number> = {
  end_outpost: 32,
  end_settlement: 48,
  end_ruins: 32,
  end_library: 32,
  end_observatory: 24,
  end_shipyard: 88,
  end_metropolis: 64,
  end_palace: 40,
};

void st.ladder;
void ladder;
void stairway;
void brokenPortal;
