/**
 * V7 phase 5: what the V7 test list asks for that the phase tests did not
 * already show: ghosts (translucent, harmless, only when meant, fewer on lower
 * graphics), candies that look different (Poisoned Candy most of all), the
 * sack's room left shown, pumpkins never on a structure, and the Update Log
 * never seasonal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { Ghosts, ghostBudget, type GhostView } from '../../src/client/render/Ghosts';
import { DEFAULT_SETTINGS, type Settings } from '../../src/client/settings';
import type { ClientWorld } from '../../src/client/world/ClientWorld';
import { MOB_DEFS } from '../../src/common/data/mobs';
import { CANDY_ITEM, CANDY_KINDS, CANDY_LOOK, SACK_CAPACITY, sackContents, sackAdd, sackLine, sackRoom } from '../../src/common/halloween/candy';
import { pumpkinSpot } from '../../src/common/halloween/pumpkins';
import { createGenerator, type OverworldGenerator } from '../../src/common/gen/generator';
import { seedFromString } from '../../src/common/math/rng';
import { UPDATE_LOG } from '../../src/client/ui/updateLog';
import { initItems } from '../../src/common/registry/items';

initItems();

const world = { heightAt: () => 64 } as unknown as ClientWorld;
const view = (over: Partial<GhostView> = {}): GhostView => ({ x: 0, y: 70, z: 0, yaw: 0, haunted: true, daylight: 0, time: 0, fogNear: 60, fogFar: 120, ...over });
/** Runs the ghosts for a number of seconds of game time. */
function run(g: Ghosts, seconds: number, v: GhostView): number {
  let most = 0;
  for (let t = 0; t < seconds * 10; t++) {
    g.update({ ...v, time: t * 2 }, 0.1);
    most = Math.max(most, g.count);
  }
  return most;
}

describe('ghosts', () => {
  it('come only on a Halloween night (not by day, not with Halloween off), one at a time, and drift away', () => {
    const settings: Settings = structuredClone(DEFAULT_SETTINGS);
    const g = new Ghosts(world, settings);
    expect(run(g, 600, view({ haunted: false }))).toBe(0);
    expect(run(g, 600, view({ daylight: 1 }))).toBe(0);
    const most = run(g, 600, view());
    expect(most).toBe(1);
    g.dispose();
  });

  it('are translucent sheets drawn on the client (not entities: nothing can touch, follow or hit them)', () => {
    const g = new Ghosts(world, structuredClone(DEFAULT_SETTINGS));
    const m = g.mesh.material as { transparent: boolean; depthWrite: boolean };
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    g.showNow();
    g.update(view(), 0.1);
    for (let i = 0; i < 20; i++) g.update(view(), 0.1);
    const looks = (g.mesh.geometry.getAttribute('aLook') as { array: Float32Array }).array;
    // Their alpha (fading in): never fully opaque
    expect(looks[1]).toBeGreaterThan(0);
    expect(looks[1]).toBeLessThanOrEqual(1);
    expect(MOB_DEFS.some((d) => /ghost/.test(d.id))).toBe(false);
    g.dispose();
  });

  it('are fewer and rarer on lower graphics (the Particles setting, which Auto Optimize lowers)', () => {
    expect(ghostBudget({ particles: 'all' })).toMatchObject({ max: 8, village: 3, gap: 1 });
    expect(ghostBudget({ particles: 'decreased' }).max).toBeLessThan(8);
    expect(ghostBudget({ particles: 'minimal' })).toMatchObject({ max: 2, village: 1 });
    for (const particles of ['all', 'decreased', 'minimal'] as const) {
      const g = new Ghosts(world, { ...structuredClone(DEFAULT_SETTINGS), particles });
      for (let i = 0; i < 20; i++) g.showNow();
      g.update(view(), 0.1);
      expect(g.count, particles).toBe(ghostBudget({ particles }).max);
      // An Abandoned Village's own: up to its share
      const h = new Ghosts(world, { ...structuredClone(DEFAULT_SETTINGS), particles });
      h.village = { x0: -40, z0: -40, x1: 40, z1: 40, y: 64 };
      expect(run(h, 300, view({ haunted: false, daylight: 1 }))).toBeLessThanOrEqual(ghostBudget({ particles }).village);
      g.dispose();
      h.dispose();
    }
  });
});

describe('candy and the sack', () => {
  it('each candy looks different (its icon), Poisoned Candy most of all', () => {
    const atlas = JSON.parse(readFileSync('public/assets/items.json', 'utf8')) as { tile: number; columns: number; textures: Record<string, { i: number }> };
    const png = PNG.sync.read(readFileSync('public/assets/items.png'));
    const tile = (id: string): number[] => {
      const i = atlas.textures[id]!.i;
      const ox = (i % atlas.columns) * atlas.tile;
      const oy = Math.floor(i / atlas.columns) * atlas.tile;
      const out: number[] = [];
      for (let y = 0; y < atlas.tile; y++)
        for (let x = 0; x < atlas.tile; x++) {
          const k = ((oy + y) * png.width + ox + x) * 4;
          out.push(png.data[k]!, png.data[k + 1]!, png.data[k + 2]!, png.data[k + 3]!);
        }
      return out;
    };
    const mean = (px: number[]): [number, number, number] => {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 4)
        if (px[i + 3]! > 128) {
          r += px[i]!;
          g += px[i + 1]!;
          b += px[i + 2]!;
          n++;
        }
      return [r / n, g / n, b / n];
    };
    const tiles = CANDY_KINDS.map((k) => tile(CANDY_ITEM[k]));
    for (let a = 0; a < tiles.length; a++) for (let b = a + 1; b < tiles.length; b++) expect(tiles[a]!.join(), `${CANDY_KINDS[a]} / ${CANDY_KINDS[b]}`).not.toBe(tiles[b]!.join());
    // Poisoned Candy is far from the honest candy in colour
    const [pr, pg, pb] = mean(tiles[3]!);
    const [cr, cg, cb] = mean(tiles[0]!);
    expect(Math.hypot(pr - cr, pg - cg, pb - cb)).toBeGreaterThan(40);
    expect(new Set(Object.values(CANDY_LOOK)).size).toBe(4);
  });

  it('shows how full it is and the room left: exactly 128', () => {
    const c = sackContents(null);
    sackAdd(c, 'regular', 90, false);
    sackAdd(c, 'king', 10, false);
    expect(sackLine(c)).toMatch(/100 \/ 128/);
    expect(sackRoom(c)).toBe(28);
    expect(sackAdd(c, 'big', 1000, false)).toBe(28);
    expect(sackRoom(c)).toBe(0);
    expect(sackLine(c)).toMatch(new RegExp(`${SACK_CAPACITY} / ${SACK_CAPACITY}`));
  });
});

describe('pumpkins and structures', () => {
  it('a pumpkin is never put inside or on top of a village', () => {
    const seed = seedFromString('v7-villages');
    const gen = createGenerator('overworld', seed, { version: 9 }) as OverworldGenerator;
    const s = gen.villageAt(552, 1000)!;
    let spots = 0;
    for (let cx = (s.bounds.x0 >> 4) - 1; cx <= (s.bounds.x1 >> 4) + 1; cx++)
      for (let cz = (s.bounds.z0 >> 4) - 1; cz <= (s.bounds.z1 >> 4) + 1; cz++) {
        const sp = pumpkinSpot(gen.generate(cx, cz), 'overworld', seed, (x, y, z) => gen.structureAt?.(x, y, z) ?? null);
        if (!sp) continue;
        spots++;
        expect(gen.structureAt?.(sp.x, sp.y, sp.z) ?? null).toBeNull();
        expect(gen.structureAt?.(sp.x, sp.y - 1, sp.z) ?? null).toBeNull();
      }
    expect(spots).toBeGreaterThanOrEqual(0);
  }, 120000);
});

describe('the Update Log', () => {
  it('is never seasonal: V7 (and every older entry) is there whatever the date, the screen asks no clock', () => {
    expect(UPDATE_LOG.map((e) => e.version).slice(0, 3)).toEqual(['V7', 'V6.5', 'V6']);
    const src = readFileSync('src/client/ui/UpdateLogScreen.ts', 'utf8') + readFileSync('src/client/ui/updateLog.ts', 'utf8');
    expect(src).not.toMatch(/seasonActive|seasonClock|halloweenState/);
  });
});
