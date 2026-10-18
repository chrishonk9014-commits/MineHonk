/**
 * V7 phase 5: save compatibility. Saves made by the real older versions
 * (tools/fixtures/make-save.ts run on each: V6.5, the last version before V7,
 * and each V7 phase whose save format changed) load in this version, keep
 * everything, get safe defaults for what they never had, keep running, and
 * save and load again. In memory (what single player and browser hosting
 * keep in IndexedDB) and through the dedicated server's file storage.
 */
import { describe, it, expect } from 'vitest';
import { hauntOf } from '../helpers/haunt';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { join, tick } from '../helpers/testServer';
import { GameServer } from '../../src/server/GameServer';
import { installGameplay } from '../../src/server/gameplay';
import { MemoryStorage, type WorldStorage } from '../../src/server/storage/Storage';
import { FileStorage } from '../../src/server-node/FileStorage';
import { items } from '../../src/common/registry/items';
import { blocks, STATE_BLOCK } from '../../src/common/registry/blocks';
import { sackContents, CANDY_KINDS } from '../../src/common/halloween/candy';
import { activeTemp } from '../../src/common/halloween/tempEnchant';
import { HALLOWEEN_ENDS_AT } from '../../src/common/halloween/season';
import type { DimensionId } from '../../src/common/data/biomes';

interface Fixture {
  made: { version: string; label: string };
  level: Record<string, unknown>;
  players: Record<string, unknown>;
  meta: Record<string, unknown>;
  chunks: Record<string, string>;
  expect: {
    version: string;
    label: string;
    generatorVersion: number;
    pillar: { dim: DimensionId; x: number; y: number; z: number; blocks: string[] };
    xp: number;
    achievements: string[];
    halloween: 'seasonal' | 'always';
    inventory: { slot: number; id: string; count: number }[];
    pumpkin?: { x: number; y: number; z: number; id: string };
    village?: { key: string; kind: string; doors: number };
    knock?: { ok: boolean; key: string; door: number };
    headwear?: string;
    sacks?: { slot: number; candy: Record<string, number> | null }[];
    temp?: { slot: number; id: string; lvl: number; until: number; at: number };
    progress?: { steps: string[]; knocks: number; candy: number; tricks: number; done: boolean };
    haunt?: { char: string; t: number; total: number };
    autoHaunt?: { haunted: boolean; after: number; played: number; at: number };
  };
}

const FIXTURES = ['v6.5', 'v7-p1', 'v7-p2', 'v7-p3', 'v7-p4'];
const load = (name: string): Fixture => JSON.parse(readFileSync(path.resolve('tests/fixtures/worlds', `${name}.json`), 'utf8')) as Fixture;
const BEFORE = HALLOWEEN_ENDS_AT - 86400_000;
const AFTER = HALLOWEEN_ENDS_AT + 86400_000;

/** Puts a fixture into a storage, record by record, the way that version wrote it. */
async function restore(fx: Fixture, storage: WorldStorage): Promise<void> {
  await storage.writeLevel(fx.level);
  for (const [uuid, data] of Object.entries(fx.players)) await storage.writePlayer(uuid, data);
  for (const [key, data] of Object.entries(fx.meta)) await storage.writeMeta(key, data);
  const byDim = new Map<DimensionId, { cx: number; cz: number; data: Uint8Array }[]>();
  for (const [key, b64] of Object.entries(fx.chunks)) {
    const [dim, cx, cz] = key.split(':') as [DimensionId, string, string];
    const list = byDim.get(dim) ?? [];
    list.push({ cx: Number(cx), cz: Number(cz), data: new Uint8Array(Buffer.from(b64, 'base64')) });
    byDim.set(dim, list);
  }
  for (const [dim, list] of byDim) await storage.writeChunks(dim, list);
  await storage.flush();
}

async function open(storage: WorldStorage, now = BEFORE): Promise<GameServer> {
  const server = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400, clock: () => now });
  installGameplay(server);
  server.level.rules.doMobSpawning = false;
  return server;
}

/** Loads the chunk around a block (from the save) and returns the block's id there. */
async function blockAt(server: GameServer, dim: DimensionId, x: number, y: number, z: number): Promise<string> {
  const d = server.dims.get(dim)!;
  for (let i = 0; i < 400 && !d.getChunk(x >> 4, z >> 4); i++) {
    d.want(x >> 4, z >> 4, 1, server.tickNo);
    await new Promise((r) => setTimeout(r, 0));
    d.processGeneration(5000);
  }
  return blocks[STATE_BLOCK[d.getState(x, y, z)]!]!.id;
}

const idOf = (s: { id: number } | null | undefined): string => (s ? items[s.id]!.id : '');

/** Everything the fixture says it saved is there. */
async function checkAll(server: GameServer, fx: Fixture): Promise<void> {
  const e = fx.expect;
  const lv = server.level;
  // The world: its generator kept (old worlds' terrain and villages never change), its Halloween setting (Seasonal when it had none)
  expect(lv.generatorVersion).toBe(e.generatorVersion);
  expect(lv.halloween).toBe(e.halloween);
  // Old worlds never get an automatic haunting's roll; a roll a world has is kept
  if (e.autoHaunt) expect(lv.flags.autoHaunt).toEqual(e.autoHaunt);
  else expect(lv.flags.autoHaunt).toBeUndefined();
  // The haunting that was running goes on (Herobrine for one from before the characters)
  if (e.haunt) {
    // (V7.1: kept in the list of hauntings running, as the first)
    expect(lv.flags.haunt).toBeUndefined();
    const st = hauntOf<{ t: number; total: number; char?: string }>(server)!;
    expect(st.total).toBe(e.haunt.total);
    expect(st.t).toBeGreaterThanOrEqual(e.haunt.t);
    expect(st.char ?? 'herobrine').toBe(e.haunt.char);
    expect(server.haunting!.character).toBe(e.haunt.char);
  }
  // Villages: the record and every door, with who got candy where
  if (e.village) {
    const rec = lv.villages[e.village.key]!;
    expect(rec).toBeDefined();
    expect(rec.kind).toBe(e.village.kind);
    expect(rec.doors).toHaveLength(e.village.doors);
    if (e.knock?.ok) expect(rec.doors.find((d) => d.id === e.knock!.door)!.got).toContain('uuid-fixer');
  } else expect(Object.keys(lv.villages)).toHaveLength(0);
  // The blocks
  for (const [i, id] of e.pillar.blocks.entries()) expect(await blockAt(server, e.pillar.dim, e.pillar.x, e.pillar.y + i, e.pillar.z)).toBe(id);
  if (e.pumpkin) expect(await blockAt(server, 'overworld', e.pumpkin.x, e.pumpkin.y, e.pumpkin.z)).toBe(e.pumpkin.id);
  // The player: everything they carried, their progress, their effects
  const { player: p } = await join(server, 'Fixer', 'uuid-fixer');
  for (const it of e.inventory) {
    const st = p.inventory.get(it.slot);
    expect(idOf(st), `slot ${it.slot}`).toBe(it.id);
    expect(st!.count, `slot ${it.slot}`).toBe(it.count);
  }
  expect(p.inventory.get(2)!.tag?.ench).toEqual({ sharpness: 3 });
  expect(p.xpTotal).toBe(e.xp);
  for (const a of e.achievements) expect(p.achievements.has(a), a).toBe(true);
  expect(p.effects.has('speed')).toBe(true);
  if (e.headwear) {
    expect(idOf(p.inventory.get(39))).toBe(e.headwear);
    expect(p.meta().headwear).toBe(e.headwear);
  }
  for (const s of e.sacks ?? []) {
    const c = sackContents(p.inventory.get(s.slot));
    for (const k of CANDY_KINDS) expect(c.counts[k], `sack ${s.slot} ${k}`).toBe(s.candy?.[k] ?? 0);
  }
  if (e.temp) {
    const st = p.inventory.get(e.temp.slot)!;
    expect(st.tag?.temp).toEqual({ id: e.temp.id, lvl: e.temp.lvl, until: e.temp.until });
    expect(activeTemp(st, lv.time)).not.toBeNull();
  }
  if (e.progress) expect(p.halloween).toEqual({ ...e.progress, treats: 0 });
  else expect(p.halloween).toEqual({ steps: [], knocks: 0, treats: 0, candy: 0, tricks: 0, done: false });
}

describe('saves from V6.5 and every V7 phase', () => {
  it('the fixtures were made by those versions', () => {
    expect(FIXTURES.map((f) => load(f).made.version)).toEqual(['6.0.0', '7.0.0-phase1', '7.0.0-phase2', '7.0.0-phase3', '7.0.0-phase4']);
  });

  for (const name of FIXTURES) {
    it(`${name}: loads with everything kept and safe defaults, runs, and saves and loads again`, async () => {
      const fx = load(name);
      const storage = new MemoryStorage();
      await restore(fx, storage);
      const server = await open(storage);
      await checkAll(server, fx);
      // It runs (the haunting going on, the season, villages, quests): nothing in the old save stops the tick
      const t0 = hauntOf<{ t: number }>(server)?.t ?? 0;
      tick(server, 200);
      if (fx.expect.haunt) expect(hauntOf<{ t: number }>(server)!.t).toBeGreaterThan(t0);
      await server.stop();
      // Saved by this version and loaded again: the same
      const again = await open(storage);
      expect(again.level.halloween).toBe(fx.expect.halloween);
      const { player } = await join(again, 'Fixer', 'uuid-fixer');
      for (const it of fx.expect.inventory) expect(idOf(player.inventory.get(it.slot))).toBe(it.id);
      if (fx.expect.village) expect(again.level.villages[fx.expect.village.key]!.doors).toHaveLength(fx.expect.village.doors);
      await again.stop();
    }, 240000);
  }

  it('on the dedicated server: each loads from its file storage the same', async () => {
    for (const name of FIXTURES) {
      const fx = load(name);
      const dir = mkdtempSync(path.join(tmpdir(), `minehonk-save-${name}-`));
      try {
        const files = new FileStorage(dir);
        await restore(fx, files);
        await files.close();
        const server = await open(new FileStorage(dir));
        await checkAll(server, fx);
        await server.stop();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 600000);

  it('after the cutoff: Seasonal ones turn Halloween off, Always on ones keep it, and nothing is removed', async () => {
    for (const name of ['v6.5', 'v7-p3', 'v7-p4']) {
      const fx = load(name);
      const storage = new MemoryStorage();
      await restore(fx, storage);
      const server = await open(storage, AFTER);
      expect(server.halloweenState().active, name).toBe(fx.expect.halloween === 'always');
      // Everything is still there: pumpkins, villages and their doors, sacks and candy, costumes
      await checkAll(server, fx);
      await server.stop();
    }
  }, 600000);
});
