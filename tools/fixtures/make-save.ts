/**
 * V7 phase 5: makes a save fixture with an older version of the game, for the
 * save-compatibility tests (tests/unit/v7-saves.test.ts). It plays a little in
 * a new world through that version's own server code, then writes everything
 * that version stored (the level, the players, the meta blobs and the
 * changed chunks, as base64) to one JSON file, with a list of what it put
 * where so the test can check it all came back.
 *
 *   npx tsx tools/fixtures/make-save.ts <checkout of the old version> <label> <out.json>
 *
 * The checkout needs node_modules (a link to this repository's is enough).
 * Everything is imported from the checkout, so its own code makes the save.
 * Features are used only if that version has them.
 */
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';

const [root, label, out] = process.argv.slice(2);
if (!root || !label || !out) throw new Error('usage: make-save.ts <checkout> <label> <out.json>');
const mod = async <T>(p: string): Promise<T> => (await import(path.resolve(root, p))) as T;

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const helpers = await mod<Any>('tests/helpers/testServer.ts');
const { MemoryStorage } = await mod<Any>('src/server/storage/Storage.ts');
const { stackOf } = await mod<Any>('src/common/game/itemstack.ts');
const { itemById } = await mod<Any>('src/common/registry/items.ts');
const { S, stateOf } = await mod<Any>('src/common/registry/blocks.ts');
const has = (id: string): boolean => itemById.has(id);
const pkg = (await import(path.resolve(root, 'package.json'), { with: { type: 'json' } })).default as { version: string };

const storage = new MemoryStorage();
const seed = 'v7-villages';
const opts: Any = { id: `fixture-${label}`, name: `Fixture ${label}`, seed, mode: 'survival', difficulty: 'normal', cheats: true };
const halloweenSetting = label === 'p2' || label === 'p4' ? 'always' : undefined;
if (halloweenSetting) opts.halloween = halloweenSetting;
if (label === 'p4') opts.hauntEligible = true;
// Before the Halloween cutoff (the season's content is made), with a fixed clock where the version has one
const clockMs = Date.parse('2026-10-20T12:00:00Z');
const { server } = await helpers.makeServer(opts, storage, { clock: () => clockMs });
const { conn, player: p } = await helpers.join(server, 'Fixer', 'uuid-fixer');
const tick = (n: number): void => helpers.tick(server, n);
const expect: Record<string, unknown> = { version: pkg.version, label, seed, generatorVersion: server.level.generatorVersion };
let req = 1;
const admin = (action: Record<string, unknown>): Any => {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action });
  tick(1);
  return conn.received.filter((m: Any) => m.t === 'admin_result' && m.req === r).pop();
};

// Everything since V0: a pillar of blocks (a changed chunk), items, an enchanted sword, armour, XP, effects, advancements, a spawn point
const bx = Math.floor(p.x) + 3;
const bz = Math.floor(p.z) + 3;
const by = p.dim.getHeight(bx, bz) + 1;
const pillar = ['stone', 'oak_planks', 'glass', 'gold_block'];
pillar.forEach((id, i) => p.dim.setBlock(bx, by + i, bz, S(id)));
expect.pillar = { dim: 'overworld', x: bx, y: by, z: bz, blocks: pillar };
const inv: { slot: number; id: string; count: number }[] = [];
const give = (slot: number, id: string, count = 1, tag?: Any): void => {
  const st = stackOf(id, count);
  if (tag) st.tag = tag;
  p.inventory.set(slot, st);
  inv.push({ slot, id, count });
};
give(1, 'diamond', 12);
give(2, 'diamond_sword', 1, { ench: { sharpness: 3 } });
give(3, 'oak_log', 40);
give(38, 'iron_chestplate');
if (has('elytra')) give(4, 'elytra');
p.xpTotal = 345;
p.effects.set('speed', { amp: 1, ticks: 2400 });
for (const a of ['mine_block', 'craft_table', 'enter_nether']) p.achievements.add(a);
p.addStat?.('blocks_mined', 99);
expect.xp = 345;
expect.achievements = ['mine_block', 'craft_table', 'enter_nether'];

// V7 phase 1: a dimension pumpkin placed (cheat-made), the world's Halloween setting
if (has('hallow_pumpkin')) {
  p.dim.setBlock(bx + 2, by, bz, stateOf('hallow_pumpkin', { facing: 'north' }));
  expect.pumpkin = { x: bx + 2, y: by, z: bz, id: 'hallow_pumpkin' };
}
expect.halloween = halloweenSetting ?? 'seasonal';

// V7 phase 2: costume heads, and a Trick-or-Treat Village built (its record and doors)
if (has('zombie_head')) {
  give(5, 'zombie_head', 2);
  give(39, 'creeper_head');
}
const villageAt = { x: 552, z: 1000 };
const gen = server.overworld.generator as Any;
const v = typeof gen.villageAt === 'function' ? gen.villageAt(villageAt.x, villageAt.z) : null;
if (v?.village && server.villages) {
  const dim = server.overworld;
  const b = v.bounds;
  const all = (): boolean => {
    for (let x = b.x0 >> 4; x <= b.x1 >> 4; x++) for (let z = b.z0 >> 4; z <= b.z1 >> 4; z++) if (!dim.getChunk(x, z)) return false;
    return true;
  };
  for (let i = 0; i < 400 && !all(); i++) {
    dim.want(((b.x0 + b.x1) >> 1) >> 4, ((b.z0 + b.z1) >> 1) >> 4, Math.ceil(Math.max((b.x1 - b.x0) >> 4, (b.z1 - b.z0) >> 4) / 2 + 2), server.tickNo);
    await new Promise((r) => setTimeout(r, 0));
    dim.processGeneration(5000);
  }
  const rec = server.villages.record(v.village.key);
  expect.village = { key: v.village.key, kind: rec?.kind, doors: rec?.doors.length ?? 0 };
  // V7 phase 3: trick-or-treating at one of its Candy Homes (a sack, a costume on, a knock)
  if (rec?.kind === 'trick' && server.trickOrTreat && server.candy) {
    const d = rec.doors.find((x: Any) => x.kind === 'candy');
    const F: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
    const [fx, fz] = F[d.facing];
    p.setPos(d.out[0] + 0.5, d.out[1], d.out[2] + 0.5);
    p.yaw = Math.atan2(fx, fz);
    p.inventory.set(0, stackOf('trick_or_treat_sack'));
    p.inventory.set(39, stackOf('carved_pumpkin'));
    // (those two slots are checked as a sack and a costume below)
    for (const slot of [0, 39]) inv.splice(0, inv.length, ...inv.filter((x) => x.slot !== slot));
    p.selectedSlot = 0;
    const r = server.trickOrTreat.knock(p, d.x, d.y, d.z);
    server.trickOrTreat.skip(p);
    tick(5);
    expect.knock = { ok: r.ok, key: v.village.key, door: d.id };
    expect.headwear = 'carved_pumpkin';
    // The sack the knock filled (in slot 0), and another sack in the backpack
    const sack0 = p.inventory.get(0);
    const sack2 = server.candy.makeSack({ regular: 20, big: 6, king: 2, poisoned: 3 }, false);
    p.inventory.set(9, sack2);
    expect.sacks = [
      { slot: 0, candy: sack0?.tag?.data?.candy ?? null },
      { slot: 9, candy: { regular: 20, big: 6, king: 2, poisoned: 3 } },
    ];
    // Candy, and a temporary enchantment (a King-Sized Candy's) still running
    give(6, 'candy', 7);
    give(7, 'poisoned_candy', 2);
    const until = server.level.time + 2400;
    give(8, 'iron_pickaxe', 1, { temp: { id: 'efficiency', lvl: 2, until } });
    expect.temp = { slot: 8, id: 'efficiency', lvl: 2, until, at: server.level.time };
    expect.progress = { ...p.halloween };
  }
}

// V7 phase 4 (and the Herobrine haunting before it): a haunting running, part way in
const hauntAction: Record<string, unknown> = { a: 'haunt', op: 'start', minutes: 10, erase: false };
if (label === 'p4') hauntAction.character = 'green_steve';
const hr = admin(hauntAction);
if (hr?.ok) {
  tick(200);
  const st = server.level.flags.haunt as Any;
  expect.haunt = { char: st?.char ?? 'herobrine', t: st?.t ?? 0, total: st?.total ?? 0 };
}
if (server.level.flags.autoHaunt) expect.autoHaunt = { ...(server.level.flags.autoHaunt as Any) };
expect.inventory = inv.filter((e) => p.inventory.get(e.slot));
expect.player = { uuid: 'uuid-fixer', name: 'Fixer' };

await server.disconnect(conn);
await server.saveAll();
await server.stop();

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const dump = {
  fixture: 'MineHonk save',
  made: { version: pkg.version, label, by: 'tools/fixtures/make-save.ts' },
  level: storage.level,
  players: Object.fromEntries(storage.players),
  meta: Object.fromEntries(storage.meta),
  chunks: Object.fromEntries([...storage.chunks].map(([k, u]: [string, Uint8Array]) => [k, b64(u)])),
  expect,
};
writeFileSync(out, JSON.stringify(dump));
console.log(`${label}: version ${pkg.version}, ${storage.chunks.size} chunks, ${Math.round(JSON.stringify(dump).length / 1024)} KB`);
process.exit(0);
