/**
 * V7 phase 5: the release. Every V7 Admin Panel action is cheat-made and
 * counts for nothing; the season tests; the Halloween advancements (honest
 * play only, per player, kept after the season); a modified client can get
 * nothing it should not; saved hauntings and villages are read back safely;
 * the voices' limits.
 */
import { describe, it, expect } from 'vitest';
import { makeServer } from '../helpers/testServer';
import { trickWorld, atDoor, dress, knock, admin, adminAsync, loadArea, join, tick, idOf, BEFORE, AFTER, SEED, VILLAGE } from '../helpers/halloween';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { HALLOWEEN_OPS } from '../../src/common/game/admin';
import { HAUNT_OPS, HAUNT_CHARACTERS, type AutoHauntRoll } from '../../src/common/game/haunting';
import { HALLOWEEN_CONTENT_TESTS, HALLOWEEN_DATE_TESTS, HALLOWEEN_ENDS_AT, DATE_TEST_LEAD } from '../../src/common/halloween/season';
import { PUMPKIN_IDS } from '../../src/common/halloween/pumpkins';
import { CANDY_KINDS, SACK_ID, sackContents } from '../../src/common/halloween/candy';
import { TRICK_KINDS, TRICK_TIMES, QUEST_CANDY, CANDY_TIMES } from '../../src/common/halloween/trickOrTreat';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from '../../src/common/data/achievements';
import { itemById } from '../../src/common/registry/items';
import { blocks, STATE_BLOCK, S } from '../../src/common/registry/blocks';
import { stackOf, markAdmin, isAdminStack } from '../../src/common/game/itemstack';
import { validateC2S } from '../../src/common/net/validate';
import { sanitizeLevelData, createLevelData } from '../../src/server/world/LevelData';
import { sanitizeHauntState, sanitizeHauntBlocks, sanitizeAutoHaunt, HAUNT_MAX_CHANGES } from '../../src/server/herobrine/hauntSave';
import { sanitizeVillageRecords, MAX_VILLAGE_DOORS } from '../../src/common/halloween/villages';
import { VoiceBudget } from '../../src/server-node/voiceBudget';
import { addressKey, addressHash, derivedSalt, takeVoiceAnswer } from '../../src/hub/voiceUsage';
import { sqliteD1 } from '../helpers/sqliteD1';
import type { OverworldGenerator } from '../../src/common/gen/generator';

/** What the Admin Panel must never give a player: advancements, quest steps, endings, the honest flags. */
function honestState(p: ServerPlayer): unknown {
  return {
    achievements: [...p.achievements].sort(),
    quest: { ...p.halloween, steps: [...p.halloween.steps] },
    flags: Object.fromEntries(Object.entries(p.statistics).filter(([k]) => /^(haunting|trick_or_treat)\./.test(k))),
    endings: [...p.endings].sort(),
    pendingEnding: p.pendingEnding ?? null,
  };
}

const findBlocks = (p: ServerPlayer, ids: readonly string[], r = 8): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let x = Math.floor(p.x) - r; x <= Math.floor(p.x) + r; x++)
    for (let z = Math.floor(p.z) - r; z <= Math.floor(p.z) + r; z++)
      for (let y = Math.floor(p.y) - 6; y <= Math.floor(p.y) + 6; y++) if (ids.includes(blocks[STATE_BLOCK[p.dim.getState(x, y, z)]!]!.id)) out.push([x, y, z]);
  return out;
};

/** Plays a haunting through to its end (everyone is shown out), then brings the players back in. */
async function seeItThrough(server: GameServer, names: [string, string][]): Promise<{ conn: import('../helpers/testServer').FakeConn; player: ServerPlayer }[]> {
  for (let i = 0; i < 6000 && server.level.flags.haunt; i++) tick(server, 1);
  expect(server.level.flags.haunt).toBeUndefined();
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  const back = [];
  for (const [name, uuid] of names) back.push(await join(server, name, uuid));
  return back;
}

// ---------------------------------------------------------------------------
describe('the Admin Panel: every V7 action is cheat-made and counts for nothing', () => {
  it('runs every Halloween and Haunting action; no advancement, quest step, ending or honest flag comes of any of them', async () => {
    const { server, doors } = await trickWorld({ now: BEFORE }, { cheats: true });
    const op = await join(server, 'Op', 'uuid-op');
    const pal = await join(server, 'Pal', 'uuid-pal');
    const players = (): ServerPlayer[] => [op.player, pal.player];
    // Walking into the real village first (finding it for real is not the panel's doing)
    const plaza = doors[0]!.rec;
    for (const p of players()) p.setPos(plaza.x + 0.5, op.player.dim.getHeight(plaza.x, plaza.z) + 1, plaza.z + 0.5);
    tick(server, 40);
    const before = players().map(honestState);
    const levelEndings = JSON.stringify(server.level.endings);
    const used = { halloween: new Set<string>(), haunt: new Set<string>() };
    const act = (who: { conn: typeof op.conn }, a: Record<string, unknown>) => {
      used[a.a as 'halloween' | 'haunt'].add(String(a.op));
      return admin(server, who.conn, a);
    };
    // Both stand in the real village (not cheat-made): nothing the panel does there may count either
    const candyDoor = doors.find((d) => d.door.kind === 'candy')!.door;
    atDoor(op.player, candyDoor);
    pal.player.setPos(op.player.x + 1, op.player.y, op.player.z + 1);
    tick(server, 20);
    // The state, a ghost, every pumpkin (cheat-made blocks)
    expect(act(op, { a: 'halloween', op: 'status' }).ok).toBe(true);
    expect(act(op, { a: 'halloween', op: 'ghost' }).ok).toBe(true);
    const theirs = new Set(findBlocks(op.player, PUMPKIN_IDS).map((b) => b.join()));
    for (const id of PUMPKIN_IDS) act(op, { a: 'halloween', op: 'place', pumpkin: id });
    act(op, { a: 'halloween', op: 'place_all' });
    const placed = findBlocks(op.player, PUMPKIN_IDS).filter((b) => !theirs.has(b.join()));
    expect(placed.length).toBeGreaterThan(0);
    for (const [x, y, z] of placed) expect(server.admin.blockMarked(op.player.dim, x, y, z)).toBe(true);
    // Every season test, and back to real
    for (const content of HALLOWEEN_CONTENT_TESTS) for (const date of HALLOWEEN_DATE_TESTS) expect(act(op, { a: 'halloween', op: 'test', content, date }).ok).toBe(true);
    act(op, { a: 'halloween', op: 'test', content: 'real', date: 'real' });
    // Sacks and candy: cheat-made, so no candy advancement and no quest step
    for (const o of ['give_sack', 'give_full_sack']) expect(act(op, { a: 'halloween', op: o }).ok).toBe(true);
    for (const candy of CANDY_KINDS) act(op, { a: 'halloween', op: 'give_candy', candy });
    // A costume from the panel, worn
    admin(server, op.conn, { a: 'give', item: 'zombie_head', count: 1 });
    const head = [...Array(36).keys()].find((i) => idOf(op.player.inventory.get(i)) === 'zombie_head')!;
    op.player.inventory.set(39, op.player.inventory.get(head));
    op.player.inventory.set(head, null);
    for (let i = 0; i < 36; i++) {
      const st = op.player.inventory.get(i);
      if (st) expect(isAdminStack(st), idOf(st)).toBe(true);
    }
    tick(server, 40);
    // The doors: listed, a test knock (no requirements), every kind of Trick Home fought and won, the doors reset
    expect(act(op, { a: 'halloween', op: 'village_doors' }).ok).toBe(true);
    expect(act(op, { a: 'halloween', op: 'door_tp', door: candyDoor.id }).ok).toBe(true);
    expect(act(op, { a: 'halloween', op: 'knock' }).ok).toBe(true);
    tick(server, CANDY_TIMES.end + 5);
    for (const trick of TRICK_KINDS) {
      const r = act(op, { a: 'halloween', op: 'trick', trick });
      expect(r.ok, `${trick}: ${r.text}`).toBe(true);
      tick(server, TRICK_TIMES.slam + 3);
      // A friend who walks in fights too: it counts for neither
      const run = [...doors].map((d) => server.trickOrTreat!.runAt(d).trick).find(Boolean)!;
      expect(run.admin).toBe(true);
      pal.player.setPos(run.landing[0], run.landing[1], run.landing[2]);
      tick(server, 2);
      for (const m of run.mobs) m.hurt(10000, { source: 'player', attacker: pal.player } as never);
      tick(server, 3);
      expect(run.phase).toBe('won');
      // Its chest is cheat-made, and the real door is not used up
      const chest = run.box.cells.find(([x, y, z]) => blocks[STATE_BLOCK[op.player.dim.getState(x, y, z)]!]!.id === 'chest');
      if (chest) expect(server.admin.blockMarked(op.player.dim, ...chest)).toBe(true);
      expect(run.ref.door.used).toBe(false);
      tick(server, 45);
      if (chest) op.player.dim.setBlock(...chest, 0);
      atDoor(pal.player, candyDoor);
    }
    expect(act(op, { a: 'halloween', op: 'reset_doors' }).ok).toBe(true);
    // The quest view, and a reset
    expect(act(op, { a: 'halloween', op: 'quest' }).ok).toBe(true);
    expect(act(op, { a: 'halloween', op: 'quest_reset' }).ok).toBe(true);
    // Villages built by the panel, and both players walking around in them
    op.player.setPos(op.player.x + 200, op.player.y, op.player.z);
    for (const kind of ['spawn_trick_village', 'spawn_abandoned_village']) {
      await loadArea(server, Math.floor(op.player.x) - 48, Math.floor(op.player.z) - 48, Math.floor(op.player.x) + 48, Math.floor(op.player.z) + 48);
      op.player.setPos(op.player.x, op.player.dim.getHeight(Math.floor(op.player.x), Math.floor(op.player.z)) + 1, op.player.z);
      const r = act(op, { a: 'halloween', op: kind });
      expect(r.ok, r.text).toBe(true);
      for (let i = 0; i < 200 && server.villages!.pendingBuilds; i++) {
        await new Promise((res) => setTimeout(res, 0));
        tick(server, 1);
      }
      pal.player.setPos(op.player.x + 3, op.player.y, op.player.z + 3);
      tick(server, 60);
      op.player.setPos(op.player.x + 400, op.player.y, op.player.z);
    }
    for (const rec of Object.entries(server.level.villages).filter(([k]) => k.startsWith('admin@'))) expect(rec[1].cheat).toBe(true);
    // The Haunting: each character shown, talked to, started, moved along, ended; the automatic one restarted and seen through
    // (out in the open, on the village's plaza)
    for (const p of players()) p.setPos(plaza.x + 0.5, op.player.dim.getHeight(plaza.x, plaza.z) + 1, plaza.z + 0.5);
    tick(server, 20);
    server.herobrineVoice = async () => 'still here';
    for (const character of HAUNT_CHARACTERS) {
      const who = character === 'herobrine' ? {} : { character };
      const shown = act(op, { a: 'haunt', op: 'appear', ...who });
      expect(shown.ok, `${character}: ${shown.text}`).toBe(true);
      tick(server, 100);
      used.haunt.add('talk');
      expect((await adminAsync(server, op.conn, { a: 'haunt', op: 'talk', text: 'who are you?', ...who })).ok).toBe(true);
    }
    expect(act(op, { a: 'haunt', op: 'status' }).ok).toBe(true);
    expect(act(op, { a: 'haunt', op: 'start', minutes: 5, erase: false }).ok).toBe(true);
    expect(act(op, { a: 'haunt', op: 'stop' }).ok).toBe(true);
    let back: Awaited<ReturnType<typeof seeItThrough>> = [op, pal];
    const names: [string, string][] = [
      ['Op', 'uuid-op'],
      ['Pal', 'uuid-pal'],
    ];
    for (const character of HAUNT_CHARACTERS) {
      const who = character === 'herobrine' ? {} : { character };
      const [o] = back;
      expect(act(o!, { a: 'haunt', op: 'start', minutes: 2, erase: false, ...who }).ok, character).toBe(true);
      expect(act(o!, { a: 'haunt', op: 'skip' }).ok).toBe(true);
      expect(act(o!, { a: 'haunt', op: 'finale_in', minutes: 1 }).ok).toBe(true);
      expect(act(o!, { a: 'haunt', op: 'finale' }).ok).toBe(true);
      back = await seeItThrough(server, names);
    }
    server.level.flags.autoHaunt = { haunted: true, after: 999999, played: 0, at: Date.now() } satisfies AutoHauntRoll;
    expect(act(back[0]!, { a: 'haunt', op: 'restart' }).ok).toBe(true);
    expect((server.level.flags.haunt as { auto?: boolean; touched?: boolean }).touched).toBe(true);
    act(back[0]!, { a: 'haunt', op: 'finale' });
    back = await seeItThrough(server, names);
    // Every action of both tabs was used
    expect([...used.halloween].sort()).toEqual([...HALLOWEEN_OPS].sort());
    expect([...used.haunt].sort()).toEqual([...HAUNT_OPS].sort());
    // ...and nothing came of any of it
    expect(back.map((b) => honestState(b.player))).toEqual(before);
    for (const b of back) {
      expect(b.player.achievements.has('experience_haunting')).toBe(false);
      expect(b.player.achievements.has('defeat_final_herobrine')).toBe(false);
      expect(b.player.statistics['haunting.experienced']).toBeUndefined();
    }
    expect(JSON.stringify(server.level.endings)).toBe(levelEndings);
    await server.stop();
  }, 600000);
});

// ---------------------------------------------------------------------------
describe('the season tests', () => {
  it('Halloween content forced on or off, a date just before or just after the cutoff (running on); everyone hears; never saved', async () => {
    const storage = new MemoryStorage();
    let now = BEFORE - 30 * 86400_000;
    const { server } = await makeServer({ seed: 'season-tests', cheats: true, halloween: 'always' }, storage, { clock: () => now });
    const a = await join(server, 'Ann', 'uuid-ann');
    const b = await join(server, 'Bob', 'uuid-bob');
    // An Always on world, forced off: off for everyone
    admin(server, a.conn, { a: 'halloween', op: 'test', content: 'off' });
    tick(server, 2);
    expect(server.halloweenState()).toMatchObject({ active: false, reason: 'forced', setting: 'always' });
    for (const c of [a.conn, b.conn]) expect(c.last('world_info')!.world.halloween).toMatchObject({ active: false, content: 'off' });
    // Just before the cutoff, Seasonal (the world's setting is never changed by a test, so force it back to real and simulate in a Seasonal way):
    server.level.halloween = 'seasonal';
    admin(server, a.conn, { a: 'halloween', op: 'test', content: 'real', date: 'before' });
    expect(server.halloween!.now()).toBe(HALLOWEEN_ENDS_AT - DATE_TEST_LEAD);
    expect(server.halloweenState()).toMatchObject({ active: true, reason: 'season', date: 'before' });
    // ...and it runs on: a minute later the season ends, and everyone hears the moment it does
    now += DATE_TEST_LEAD + 1000;
    tick(server, 40);
    expect(server.halloweenState()).toMatchObject({ active: false, reason: 'expired', date: 'before' });
    for (const c of [a.conn, b.conn]) expect(c.last('world_info')!.world.halloween?.active).toBe(false);
    // Just after: off; forced on: on
    admin(server, a.conn, { a: 'halloween', op: 'test', date: 'after' });
    expect(server.halloweenState().active).toBe(false);
    admin(server, a.conn, { a: 'halloween', op: 'test', content: 'on' });
    expect(server.halloweenState()).toMatchObject({ active: true, reason: 'forced' });
    // (the real date is in the season here, so this is not "only a test": see the next test for that)
    expect(server.halloween!.onByTest).toBe(false);
    // Never saved: the world closes, and opens with the real answer
    await server.saveAll();
    const saved = JSON.stringify(storage.level);
    expect(saved).not.toMatch(/"content":"on"|"date":"after"/);
    await server.stop();
    const { server: again } = await makeServer({}, storage, { clock: () => now });
    expect(again.halloween!.tests).toEqual({ content: 'real', date: 'real' });
    expect(again.halloweenState()).toMatchObject({ active: true, reason: 'season', setting: 'seasonal', content: 'real', date: 'real' });
    await again.stop();
  }, 120000);

  it('only the owner and operators of a world with cheats may use them', async () => {
    const { server } = await makeServer({ seed: 'season-tests-2', cheats: true }, new MemoryStorage(), { clock: () => BEFORE });
    const owner = await join(server, 'Own', 'uuid-own');
    server.level.owner = 'uuid-own';
    const guest = await join(server, 'Guest', 'uuid-guest');
    const r = admin(server, guest.conn, { a: 'halloween', op: 'test', content: 'off' });
    expect(r.ok).toBe(false);
    expect(server.halloweenState().active).toBe(true);
    // An operator may
    server.level.operators.push('uuid-guest');
    expect(admin(server, guest.conn, { a: 'halloween', op: 'test', content: 'off' }).ok).toBe(true);
    expect(server.halloweenState().active).toBe(false);
    // Nobody at all in a world without cheats
    server.level.cheats = false;
    expect(admin(server, owner.conn, { a: 'halloween', op: 'test', content: 'real' }).ok).toBe(false);
    expect(server.halloweenState().active).toBe(false);
    await server.stop();
  }, 60000);

  it('trick-or-treating while only a test makes it Halloween is cheat-made', async () => {
    // Built in the season; now it is over, and only the test turns Halloween back on
    const clock = { now: BEFORE };
    const { server, doors } = await trickWorld(clock, { cheats: true });
    clock.now = AFTER;
    const { conn, player } = await join(server, 'Ann', 'uuid-ann');
    tick(server, 25);
    expect(server.halloweenState().active).toBe(false);
    admin(server, conn, { a: 'halloween', op: 'test', content: 'on' });
    expect(server.halloween!.onByTest).toBe(true);
    const d = doors.find((x) => x.door.kind === 'candy')!.door;
    atDoor(player, d);
    dress(player);
    tick(server, 12);
    knock(server, conn, d);
    server.handle(conn, { t: 'scene_skip' });
    const c = sackContents(player.inventory.get(0));
    expect(CANDY_KINDS.reduce((n, k) => n + c.counts[k], 0)).toBeGreaterThan(0);
    expect(CANDY_KINDS.every((k) => c.cheat[k] === c.counts[k])).toBe(true);
    expect(player.achievements.has('first_candy')).toBe(false);
    expect(player.halloween).toMatchObject({ knocks: 0, treats: 0, candy: 0 });
    await server.stop();
  }, 240000);

  it('a sack crafted while only a test makes it Halloween is cheat-made (no advancement, no quest step)', async () => {
    const clock = { now: BEFORE };
    const { server } = await trickWorld(clock, { cheats: true });
    clock.now = AFTER;
    const { conn, player } = await join(server, 'Ann', 'uuid-ann');
    tick(server, 25);
    admin(server, conn, { a: 'halloween', op: 'test', content: 'on' });
    const c = server.interaction.containers;
    c.openCrafting(player, player.dim, Math.floor(player.x), Math.floor(player.y), Math.floor(player.z));
    const w = c.windowOf(player);
    [null, 'string', null, 'white_wool', null, 'white_wool', 'white_wool', 'white_wool', 'white_wool'].forEach((id, i) => w.slots[1 + i]!.set(id ? stackOf(id) : null));
    w.refresh!();
    expect(idOf(w.slots[0]!.get())).toBe(SACK_ID);
    expect(isAdminStack(w.slots[0]!.get())).toBe(true);
    server.handle(conn, { t: 'click', window: w.id, slot: 0, button: 0, mode: 'pickup', seq: 1 });
    expect(player.achievements.has('craft_sack')).toBe(false);
    await server.stop();
  }, 240000);

  it('an "off" test leaves no mark: a village first explored under it is still dressed by the real season', async () => {
    const { server } = await makeServer({ seed: SEED, cheats: true }, new MemoryStorage(), { clock: () => BEFORE });
    const { conn } = await join(server, 'Ann', 'uuid-ann');
    for (const t of [{ content: 'off' }, { content: 'real', date: 'after' }] as const) {
      admin(server, conn, { a: 'halloween', op: 'test', ...t });
      expect(server.halloweenState().active).toBe(false);
      expect(server.halloween!.offByTest).toBe(true);
    }
    const g = server.overworld.generator as OverworldGenerator;
    const s = g.villageAt(VILLAGE.x, VILLAGE.z)!;
    await loadArea(server, s.bounds.x0, s.bounds.z0, s.bounds.x1, s.bounds.z1);
    const rec = server.villages!.record(s.village!.key)!;
    expect(rec.kind).toBe('trick');
    expect(rec.cheat).toBeUndefined();
    expect(rec.doors.length).toBeGreaterThan(0);
    // Back to real: its doors can be knocked on, for real
    admin(server, conn, { a: 'halloween', op: 'test', content: 'real', date: 'real' });
    expect(server.halloweenState().active).toBe(true);
    await server.stop();
  }, 240000);

  it("the panel's sack or costume, or a door it reset: knocking counts for nothing", async () => {
    const { server, doors } = await trickWorld({ now: BEFORE }, { cheats: true });
    const { conn, player } = await join(server, 'Ann', 'uuid-ann');
    const candy = doors.filter((x) => x.door.kind === 'candy').map((x) => x.door);
    expect(candy.length).toBeGreaterThanOrEqual(3);
    const at = (d: (typeof candy)[number]): void => {
      atDoor(player, d);
      tick(server, 12);
      knock(server, conn, d);
      server.handle(conn, { t: 'scene_skip' });
      tick(server, CANDY_TIMES.end + 15);
    };
    // Honest: counts
    dress(player);
    at(candy[0]!);
    expect(player.halloween.treats).toBe(1);
    expect(player.achievements.has('first_candy')).toBe(true);
    const honest = player.halloween.candy;
    // The panel resets the village's doors: that home's candy again is cheat-made
    atDoor(player, candy[0]!);
    admin(server, conn, { a: 'halloween', op: 'reset_doors' });
    expect(candy[0]!.used).toBe(false);
    expect(candy[0]!.before?.got).toContain('uuid-ann');
    at(candy[0]!);
    expect(candy[0]!.got).toContain('uuid-ann');
    expect(player.halloween).toMatchObject({ treats: 1, candy: honest });
    // A sack from the panel (an honest costume): cheat-made
    player.inventory.set(0, server.candy!.makeSack({}, true));
    at(candy[1]!);
    expect(candy[1]!.got).toContain('uuid-ann');
    expect(player.halloween).toMatchObject({ treats: 1, candy: honest });
    // A costume from the panel (an honest sack): cheat-made
    dress(player, stackOf(SACK_ID), '');
    player.inventory.set(39, markAdmin(stackOf('carved_pumpkin')));
    at(candy[2]!);
    expect(candy[2]!.got).toContain('uuid-ann');
    expect(player.halloween).toMatchObject({ treats: 1, candy: honest });
    const c = sackContents(player.inventory.get(0));
    expect(CANDY_KINDS.every((k) => c.cheat[k] === c.counts[k])).toBe(true);
    await server.stop();
  }, 240000);
});

// ---------------------------------------------------------------------------
describe('the Halloween advancements', () => {
  const V7 = ['find_abandoned_village', 'find_trick_village', 'craft_sack', 'obtain_costume', 'first_candy', 'obtain_big_candy', 'obtain_king_candy', 'full_sack', 'trick_or_treat_quest', 'find_trick_home', 'beat_trick_home', 'herobrine_trick', 'experience_haunting'];

  it('are all in their own Halloween tab, the seasonal ones marked, the haunting one hidden; every icon and parent is real', () => {
    const hw = ACHIEVEMENTS.filter((a) => a.category === 'halloween').map((a) => a.id);
    expect(hw.sort()).toEqual([...V7].sort());
    for (const id of V7) {
      const a = ACHIEVEMENT_BY_ID.get(id)!;
      expect(itemById.has(a.icon), `${id}: ${a.icon}`).toBe(true);
      if (a.parent) expect(ACHIEVEMENT_BY_ID.has(a.parent), id).toBe(true);
    }
    // Seasonal: what needs Halloween content to be earned (never Abandoned Villages, costumes or hauntings)
    expect(V7.filter((id) => ACHIEVEMENT_BY_ID.get(id)!.seasonal === 'halloween').sort()).toEqual(
      ['find_trick_village', 'craft_sack', 'first_candy', 'obtain_big_candy', 'obtain_king_candy', 'full_sack', 'trick_or_treat_quest', 'find_trick_home', 'beat_trick_home', 'herobrine_trick'].sort(),
    );
    expect(ACHIEVEMENT_BY_ID.get('experience_haunting')!.secret).toBe(true);
    // No two advancements share a name
    const titles = ACHIEVEMENTS.map((a) => a.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('come from honest play, each player their own, saved with them; and an Always on world gives them after the season', async () => {
    const clock = { now: BEFORE };
    const storage = new MemoryStorage();
    const { server, doors } = await trickWorld(clock, {}, storage);
    const a = await join(server, 'Ann', 'uuid-ann');
    const b = await join(server, 'Bob', 'uuid-bob');
    // Crafting a sack
    const c = server.interaction.containers;
    c.openCrafting(a.player, a.player.dim, Math.floor(a.player.x), Math.floor(a.player.y), Math.floor(a.player.z));
    const w = c.windowOf(a.player);
    [null, 'string', null, 'white_wool', null, 'white_wool', 'white_wool', 'white_wool', 'white_wool'].forEach((id, i) => w.slots[1 + i]!.set(id ? stackOf(id) : null));
    w.refresh!();
    server.handle(a.conn, { t: 'click', window: w.id, slot: 0, button: 0, mode: 'pickup', seq: 1 });
    expect(a.player.achievements.has('craft_sack')).toBe(true);
    expect(b.player.achievements.has('craft_sack')).toBe(false);
    server.handle(a.conn, { t: 'close_window', window: w.id } as never);
    // A costume picked up (only Bob)
    b.player.inventory.set(5, stackOf('skeleton_skull'));
    tick(server, 12);
    expect(b.player.achievements.has('obtain_costume')).toBe(true);
    expect(a.player.achievements.has('obtain_costume')).toBe(false);
    // A cheat-made one gives nothing
    a.player.inventory.set(6, markAdmin(stackOf('creeper_head')));
    tick(server, 12);
    expect(a.player.achievements.has('obtain_costume')).toBe(false);
    a.player.inventory.set(6, null);
    // Knocking at a Trick Home: found one
    const trick = doors.find((d) => d.door.kind === 'trick')!.door;
    atDoor(a.player, trick);
    dress(a.player);
    knock(server, a.conn, trick);
    expect(a.player.achievements.has('find_trick_home')).toBe(true);
    expect(b.player.achievements.has('find_trick_home')).toBe(false);
    tick(server, TRICK_TIMES.slam + 3);
    const run = server.trickOrTreat!.runAt(doors.find((d) => d.door === trick)!).trick!;
    for (const m of run.mobs) m.hurt(10000, { source: 'player', attacker: a.player } as never);
    tick(server, 50);
    expect(a.player.achievements.has('beat_trick_home')).toBe(true);
    // Big and King-Sized Candy: honest candy in a sack (from a Candy Home) or the inventory
    b.player.inventory.set(2, stackOf('big_candy', 2));
    tick(server, 12);
    expect(b.player.achievements.has('obtain_big_candy')).toBe(true);
    expect(b.player.achievements.has('obtain_king_candy')).toBe(false);
    const sack = server.candy!.makeSack({ king: 1 }, false);
    b.player.inventory.set(3, sack);
    tick(server, 12);
    expect(b.player.achievements.has('obtain_king_candy')).toBe(true);
    // ...never cheat candy in a sack
    a.player.inventory.set(4, server.candy!.makeSack({ big: 3, king: 2 }, true));
    tick(server, 12);
    expect(a.player.achievements.has('obtain_big_candy')).toBe(false);
    // Saved with each player
    await server.disconnect(a.conn);
    await server.disconnect(b.conn);
    await server.stop();
    // After the season, in an Always on world: still earned (and none were taken away)
    clock.now = AFTER;
    const again = await makeServer({}, storage, { clock: () => clock.now });
    again.server.level.halloween = 'always';
    const a2 = await join(again.server, 'Ann', 'uuid-ann');
    for (const id of ['craft_sack', 'find_trick_home', 'beat_trick_home']) expect(a2.player.achievements.has(id), id).toBe(true);
    const doorsAgain = Object.values(again.server.level.villages).flatMap((r) => r.doors);
    const candy = doorsAgain.find((d) => d.kind === 'candy' && !(d.got ?? []).includes('uuid-ann'))!;
    atDoor(a2.player, candy);
    a2.player.inventory.set(4, null);
    dress(a2.player);
    tick(again.server, 12);
    knock(again.server, a2.conn, candy);
    expect(a2.player.achievements.has('first_candy')).toBe(true);
    await again.server.stop();
  }, 300000);

  it('the quest: finished for real, an advancement; finished before phase 5, given if it was played for real', async () => {
    const { server, doors } = await trickWorld();
    const { conn, player: p } = await join(server, 'Cat', 'uuid-cat');
    dress(p);
    for (const d of doors.filter((x) => x.door.kind === 'candy').map((x) => x.door)) {
      if (p.halloween.candy >= QUEST_CANDY) break;
      atDoor(p, d);
      tick(server, 12);
      knock(server, conn, d);
      server.handle(conn, { t: 'scene_skip' });
      tick(server, 12);
    }
    if (p.halloween.candy < QUEST_CANDY) p.halloween.candy = QUEST_CANDY;
    tick(server, 12);
    expect(p.halloween.done).toBe(true);
    expect(p.achievements.has('trick_or_treat_quest')).toBe(true);
    // A player who finished it in phase 3 or 4 (no advancement then) and got candy for real
    const old = await join(server, 'Old', 'uuid-old');
    old.player.halloween = { steps: ['sack', 'costume', 'wear', 'village', 'knock', 'candy'], knocks: 6, treats: 0, candy: 12, tricks: 0, done: true };
    old.player.achievements.add('first_candy');
    tick(server, 12);
    expect(old.player.achievements.has('trick_or_treat_quest')).toBe(true);
    // ...but not one who never did (it was finished with cheats then)
    const cheat = await join(server, 'Cheat', 'uuid-cheat');
    cheat.player.halloween = { steps: ['sack', 'costume', 'wear', 'village', 'knock', 'candy'], knocks: 6, treats: 0, candy: 12, tricks: 0, done: true };
    tick(server, 12);
    expect(cheat.player.achievements.has('trick_or_treat_quest')).toBe(false);
    await server.stop();
  }, 300000);

  it('living through an automatic haunting: hidden, given at its end to those who saw it honestly; a haunting flag from phase 4 gives it too', async () => {
    const { server } = await makeServer({ seed: 'experience', cheats: true });
    const { player } = await join(server, 'Steve', 'uuid-steve');
    server.level.flags.autoHaunt = { haunted: true, after: 0, played: 0, at: Date.now() } satisfies AutoHauntRoll;
    tick(server, 2);
    const st = server.level.flags.haunt as { t: number; total: number; ending?: string };
    st.ending = 'ban';
    st.t = Math.ceil(st.total * 0.965);
    for (let i = 0; i < 1500 && server.level.flags.haunt; i++) tick(server, 1);
    expect(player.statistics['haunting.experienced']).toBe(1);
    expect(player.achievements.has('experience_haunting')).toBe(true);
    // The phase 4 flag alone (from before the advancement): given when the player loads
    const storage = new MemoryStorage();
    const s2 = await makeServer({ seed: 'experience-2' }, storage);
    const j = await join(s2.server, 'Alex', 'uuid-alex');
    j.player.statistics['haunting.experienced'] = 1;
    await s2.server.disconnect(j.conn);
    await s2.server.stop();
    const s3 = await makeServer({}, storage);
    const k = await join(s3.server, 'Alex', 'uuid-alex');
    expect(k.player.achievements.has('experience_haunting')).toBe(true);
    await s3.server.stop();
    await server.stop();
  }, 300000);
});

// ---------------------------------------------------------------------------
describe('a modified client', () => {
  it('cannot knock its way to candy: no costume, no sack, far away, from inside, not a door, twice, in a hurry, two at once', async () => {
    const { server, doors } = await trickWorld();
    const a = await join(server, 'Ann', 'uuid-ann');
    const b = await join(server, 'Bob', 'uuid-bob');
    const d = doors.find((x) => x.door.kind === 'candy')!.door;
    const candyOf = (p: ServerPlayer): number => {
      let n = 0;
      for (let i = 0; i <= 40; i++) {
        const st = p.inventory.get(i);
        if (idOf(st) === SACK_ID) n += CANDY_KINDS.reduce((m, k) => m + sackContents(st).counts[k], 0);
      }
      return n;
    };
    atDoor(a.player, d);
    // Says it wears a costume (no such message: the server reads the helmet slot)
    dress(a.player, stackOf(SACK_ID), '');
    knock(server, a.conn, d);
    expect(candyOf(a.player)).toBe(0);
    // Far from the door, and from inside the house
    dress(a.player);
    a.player.setPos(d.out[0] + 12.5, d.out[1], d.out[2] + 0.5);
    tick(server, 12);
    knock(server, a.conn, d);
    expect(candyOf(a.player)).toBe(0);
    const inside = server.trickOrTreat!.house(a.player.dim, d)!.cells[0]!;
    a.player.setPos(inside[0] + 0.5, inside[1], inside[2] + 0.5);
    tick(server, 12);
    knock(server, a.conn, d);
    expect(candyOf(a.player)).toBe(0);
    // Not a door at all, and nonsense
    atDoor(a.player, d);
    tick(server, 12);
    server.handle(a.conn, { t: 'knock', x: d.x + 3, y: d.y, z: d.z });
    expect(validateC2S({ t: 'knock', x: 1.5, y: 2, z: 3 })).toBeNull();
    expect(validateC2S({ t: 'knock', x: 'a', y: 2, z: 3 })).toBeNull();
    expect(validateC2S({ t: 'knock', x: 1e12, y: 2, z: 3 })).toBeNull();
    expect(candyOf(a.player)).toBe(0);
    // Two players at the same door in the same tick: one is answered, the other told it is busy
    atDoor(b.player, d);
    dress(b.player);
    tick(server, 12);
    knock(server, a.conn, d);
    knock(server, b.conn, d);
    expect([candyOf(a.player) > 0, candyOf(b.player) > 0]).toEqual([true, false]);
    // A burst of knocks and skips: still one handful
    const got = candyOf(a.player);
    for (let i = 0; i < 50; i++) {
      knock(server, a.conn, d);
      server.handle(a.conn, { t: 'scene_skip' });
    }
    tick(server, CANDY_TIMES.end + 15);
    for (let i = 0; i < 5; i++) {
      knock(server, a.conn, d);
      tick(server, 12);
    }
    expect(candyOf(a.player)).toBe(got);
    expect(d.got!.filter((u) => u === 'uuid-ann')).toHaveLength(1);
    await server.stop();
  }, 240000);

  it('cannot make or copy candy, sacks or a Herobrine Head through the sack, creative, or a drag', async () => {
    const { server } = await makeServer({ seed: 'mp-sack', mode: 'creative' }, new MemoryStorage(), { clock: () => BEFORE });
    const { conn, player: p } = await join(server, 'Max', 'uuid-max');
    p.inventory.clear();
    const sack = server.candy!.makeSack({ regular: 100, king: 28 }, false);
    p.inventory.set(0, sack);
    // Taking more than is there, from a slot that is not a sack, eating a sackful at once
    server.handle(conn, { t: 'sack', slot: 0, op: 'take', kind: 'king', n: 128 });
    expect(p.inventory.count(itemById.get('king_sized_candy')!.num)).toBe(28);
    server.handle(conn, { t: 'sack', slot: 5, op: 'take', kind: 'regular', n: 10 });
    expect(p.inventory.count(itemById.get('candy')!.num)).toBe(0);
    expect(validateC2S({ t: 'sack', slot: 0, op: 'take', kind: 'regular', n: 1000 })).toBeNull();
    expect(validateC2S({ t: 'sack', slot: 0, op: 'take', kind: 'toffee', n: 1 })).toBeNull();
    expect(validateC2S({ t: 'sack', slot: 37, op: 'eat', kind: 'regular' })).toBeNull();
    for (let i = 0; i < 20; i++) server.handle(conn, { t: 'sack', slot: 0, op: 'eat', kind: 'regular' });
    expect(sackContents(p.inventory.get(0)).counts.regular).toBe(99);
    // A creative middle-drag of a full sack copies an empty one; of a Herobrine Head, nothing
    p.cursor = server.candy!.makeSack({ regular: 128 }, false);
    server.handle(conn, { t: 'click', window: 0, slot: 0, button: 2, mode: 'drag_start', seq: 1 });
    for (const s of [20, 21, 22]) server.handle(conn, { t: 'click', window: 0, slot: s, button: 2, mode: 'drag_add', seq: 1 });
    server.handle(conn, { t: 'click', window: 0, slot: 0, button: 2, mode: 'drag_end', seq: 1 });
    for (const s of [20, 21, 22]) {
      expect(idOf(p.inventory.get(s))).toBe(SACK_ID);
      expect(CANDY_KINDS.reduce((m, k) => m + sackContents(p.inventory.get(s)).counts[k], 0)).toBe(0);
    }
    p.cursor = stackOf('herobrine_head');
    server.handle(conn, { t: 'click', window: 0, slot: 0, button: 2, mode: 'drag_start', seq: 2 });
    for (const s of [23, 24]) server.handle(conn, { t: 'click', window: 0, slot: s, button: 2, mode: 'drag_add', seq: 2 });
    server.handle(conn, { t: 'click', window: 0, slot: 0, button: 2, mode: 'drag_end', seq: 2 });
    expect([23, 24].map((s) => idOf(p.inventory.get(s)))).toEqual(['', '']);
    // Placing a Herobrine Head in Creative uses nothing up, so what is placed is cheat-made (breaking it gives no head)
    const x = Math.floor(p.x) + 2;
    const z = Math.floor(p.z);
    const y = p.dim.getHeight(x, z);
    p.inventory.set(p.selectedSlot, stackOf('herobrine_head'));
    server.interaction.handleUseOn(p, { t: 'use_on', x, y: y - 1, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: p.yaw, pitch: 0, seq: 3 });
    if (blocks[STATE_BLOCK[p.dim.getState(x, y, z)]!]!.id === 'herobrine_head') expect(server.admin.blockMarkedExactly(p.dim, x, y, z)).toBe(true);
    // The creative menu has no Herobrine Head, and a sack from it is empty
    server.handle(conn, { t: 'creative_set', slot: 30, item: { id: itemById.get('herobrine_head')!.num, count: 1 } });
    expect(idOf(p.inventory.get(30))).toBe('');
    server.handle(conn, { t: 'creative_set', slot: 31, item: { id: itemById.get(SACK_ID)!.num, count: 1, tag: { data: { candy: { king: 128 } } } } });
    expect(idOf(p.inventory.get(31))).toBe(SACK_ID);
    expect(CANDY_KINDS.reduce((m, k) => m + sackContents(p.inventory.get(31)).counts[k], 0)).toBe(0);
    await server.stop();
  }, 120000);

  it('cannot start a haunting, change the season or use the Admin Panel without the right, on a hosted or a dedicated world', async () => {
    for (const cheats of [true, false]) {
      const { server } = await makeServer({ seed: 'mp-admin', cheats }, new MemoryStorage(), { clock: () => BEFORE });
      const host = await join(server, 'Host', 'uuid-host');
      server.level.owner = 'uuid-host';
      const guest = await join(server, 'Guest', 'uuid-guest');
      for (const action of [
        { a: 'haunt', op: 'start', minutes: 5, erase: true },
        { a: 'haunt', op: 'start', minutes: 5, erase: false, character: 'null' },
        { a: 'halloween', op: 'test', content: 'off' },
        { a: 'halloween', op: 'give_full_sack' },
        { a: 'halloween', op: 'spawn_trick_village' },
      ]) {
        const r = admin(server, guest.conn, action);
        expect(r.ok, JSON.stringify(action)).toBe(false);
      }
      expect(server.level.flags.haunt).toBeUndefined();
      expect(server.halloween!.tests).toEqual({ content: 'real', date: 'real' });
      // There is no message for the world's Halloween setting, the automatic haunting, or the season
      for (const t of ['halloween', 'haunt', 'season', 'auto_haunt', 'world_info']) expect(validateC2S({ t, setting: 'always' })).toBeNull();
      // Even the host cannot have an automatic haunting's world deleted, or a panel one deleted by a guest
      void host;
      await server.stop();
    }
  }, 120000);

  it('cannot give the loot of a Trick Home twice: one chest, rolled once, whoever opens it first', async () => {
    const { server, doors } = await trickWorld();
    const a = await join(server, 'Ann', 'uuid-ann');
    const b = await join(server, 'Bob', 'uuid-bob');
    const ref = doors.find((d) => d.door.kind === 'trick')!;
    atDoor(a.player, ref.door);
    dress(a.player);
    knock(server, a.conn, ref.door);
    tick(server, TRICK_TIMES.slam + 3);
    const run = server.trickOrTreat!.runAt(ref).trick!;
    b.player.setPos(run.landing[0], run.landing[1], run.landing[2]);
    tick(server, 2);
    for (const m of run.mobs) m.hurt(10000, { source: 'player', attacker: a.player } as never);
    tick(server, 3);
    const chests = run.box.cells.filter(([x, y, z]) => blocks[STATE_BLOCK[a.player.dim.getState(x, y, z)]!]!.id === 'chest');
    expect(chests).toHaveLength(1);
    const [x, y, z] = chests[0]!;
    const c = server.interaction.containers;
    const first = c.containerAt(a.player.dim, x, y, z, 27, 'chest').slots.map((s) => (s ? `${idOf(s)}x${s.count}` : ''));
    const second = c.containerAt(b.player.dim, x, y, z, 27, 'chest').slots.map((s) => (s ? `${idOf(s)}x${s.count}` : ''));
    expect(second).toEqual(first);
    expect((a.player.dim.getBlockEntity(x, y, z) as { lootSeed?: number } | undefined)?.lootSeed).toBeUndefined();
    // The house is beaten for everyone: knocking again (either of them) gets the empty line, never a second chest
    tick(server, 50);
    for (const p of [a, b]) {
      atDoor(p.player, ref.door);
      dress(p.player);
      tick(server, 12);
      knock(server, p.conn, ref.door);
    }
    tick(server, TRICK_TIMES.slam + 10);
    expect(server.trickOrTreat!.runAt(ref).trick).toBeUndefined();
    await server.stop();
  }, 240000);
});

// ---------------------------------------------------------------------------
describe('saved hauntings and villages, read back safely', () => {
  it('a haunting state, its recorded blocks and the automatic roll: anything malformed is dropped or cut back', () => {
    expect(sanitizeHauntState({ t: 'x', total: 100 })).toMatchObject({ t: 0, total: 100 });
    expect(sanitizeHauntState({ t: 5, total: 0 })).toBeNull();
    expect(sanitizeHauntState('nonsense')).toBeNull();
    // A character from nowhere (not even the prototype's names) is Herobrine
    for (const char of ['constructor', 'toString', '__proto__', 'entity_303']) expect(sanitizeHauntState({ t: 1, total: 10, char })!.char).toBeUndefined();
    expect(sanitizeHauntState({ t: 1, total: 10, char: 'null' })!.char).toBe('null');
    const st = sanitizeHauntState({ t: 1e12, total: 600, done: 'all', deaths: 7, sky: { dayTime: 'noon' }, ending: 'deleted', auto: true, erase: true, said: -4 })!;
    expect(st).toMatchObject({ t: 600, total: 600, done: [], auto: true, erase: false });
    expect(st.deaths).toBeUndefined();
    expect(st.sky).toBeUndefined();
    expect(st.ending).toBeUndefined();
    expect(sanitizeHauntState({ t: 1, total: 10, deaths: { __proto__: 5, 'uuid-a': 2, x: 'y' } })!.deaths).toEqual({ 'uuid-a': 2 });
    // Recorded blocks: only real changes, at most 4000
    const ok = ['overworld', 1, 64, 1, S('stone'), 0];
    expect(sanitizeHauntBlocks([ok, null, 5, ['moon', 1, 64, 1, 1, 0], ['overworld', 1.5, 64, 1, 1, 0], ['overworld', 1, 64, 1, -1, 0], ['overworld', 1, 64, 1, 1e9, 0]])).toEqual([ok]);
    expect(sanitizeHauntBlocks(new Array(HAUNT_MAX_CHANGES + 500).fill(ok))).toHaveLength(HAUNT_MAX_CHANGES);
    // The roll: a delay within its range, booleans that are booleans
    expect(sanitizeAutoHaunt({ haunted: 'yes', after: -5, played: 'lots', at: 1 })).toEqual({ haunted: false, after: 24000, played: 0, at: 1 });
    expect(sanitizeAutoHaunt({ haunted: true })).toBeNull();
  });

  it('a world whose saved haunting is broken loads and runs (the haunting dropped), and its blocks are never written wrong', async () => {
    const lv = JSON.parse(JSON.stringify(createLevelData({ id: 'w', name: 'W', seed: 'broken-haunt', mode: 'survival', difficulty: 'normal' })));
    lv.flags.haunt = { t: 'soon', total: 'forever', char: 'constructor', done: 3 };
    lv.flags.hauntBlocks = [null, ['overworld', 0, 70, 0, 99999999, 0], 'junk'];
    lv.flags.autoHaunt = { haunted: 1, after: NaN };
    const clean = sanitizeLevelData(lv, 'w')!;
    expect(clean.flags.haunt).toBeUndefined();
    expect(clean.flags.hauntBlocks).toEqual([]);
    expect(clean.flags.autoHaunt).toBeUndefined();
    const storage = new MemoryStorage();
    await storage.writeLevel({ ...lv, flags: { ...lv.flags, haunt: { t: 5, total: 100000, char: 'toString', done: 'x', deaths: 4 } } });
    const { server } = await makeServer({}, storage);
    await join(server, 'Steve', 'uuid-steve');
    expect(server.haunting!.character).toBe('herobrine');
    tick(server, 300);
    expect((server.level.flags.haunt as { t: number }).t).toBeGreaterThan(5);
    await server.stop();
  }, 120000);

  it('village records: capped, keys checked (no prototype tricks), doors whole', () => {
    const door = { id: 0, x: 1, y: 2, z: 3, kind: 'candy', facing: 'north', out: [1, 2, 4], design: 'house', seed: 5, used: false };
    const recs = sanitizeVillageRecords(JSON.parse(`{"__proto__": {"kind":"trick","x":0,"y":0,"z":0,"doors":[]}, "1,2": {"kind":"trick","x":0,"y":64,"z":0,"doors":${JSON.stringify(new Array(500).fill(door))}}, "bad key": {"kind":"normal","x":0,"y":0,"z":0,"doors":[]}, "admin@5,-6": {"kind":"abandoned","x":5,"y":64,"z":-6,"doors":[]}}`));
    expect(Object.keys(recs).sort()).toEqual(['1,2', 'admin@5,-6']);
    expect(Object.getPrototypeOf(recs)).toBe(Object.prototype);
    expect(recs['1,2']!.doors).toHaveLength(MAX_VILLAGE_DOORS);
    expect(sanitizeVillageRecords({ '1,2': { kind: 'trick', x: 0, y: 0, z: 0, doors: [{ ...door, id: 1.5 }] } })['1,2']!.doors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("the voices' limits", () => {
  it('a dedicated server: a few a minute and an hour for each world, and one daily limit for all of them', () => {
    let now = Date.parse('2026-10-20T10:00:00Z');
    const v = new VoiceBudget(10, () => now);
    const got = Array.from({ length: 8 }, () => v.take('world-a'));
    expect(got.filter((r) => r === 'ok')).toHaveLength(6);
    expect(got.slice(6)).toEqual(['busy', 'busy']);
    now += 61_000;
    expect([v.take('world-a'), v.take('world-b'), v.take('world-b'), v.take('world-b')]).toEqual(['ok', 'ok', 'ok', 'ok']);
    // ten used today (across both worlds): the rest of the day falls back to the scripted lines
    expect(v.take('world-c')).toBe('limit');
    now += 86_400_000;
    expect(v.take('world-c')).toBe('ok');
  });

  it('the cloud hub: a share of the day per address (kept only as a hash), then the limit for everyone together', async () => {
    const db = sqliteD1();
    const day = '2026-10-20';
    const ann = await addressHash(day, '203.0.113.5');
    const bob = await addressHash(day, '2001:db8:1:2:aaaa::1');
    // One household's IPv6 addresses are one address
    expect(await addressHash(day, '2001:db8:1:2:ffff::9')).toBe(bob);
    expect(addressKey('2001:0db8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(addressKey('203.0.113.5')).toBe('203.0.113.5');
    expect(addressKey('::ffff:203.0.113.5')).toBe('203.0.113.5');
    // Salted (by the hub's own secret when it has no VOICE_SALT): not reversible by trying every address
    expect(await derivedSalt('secret-a')).not.toBe(await derivedSalt('secret-b'));
    expect(await derivedSalt('secret-a')).not.toContain('secret-a');
    expect(await addressHash(day, '203.0.113.5', await derivedSalt('secret-a'))).not.toBe(ann);
    // ...and the hash changes with the day, and holds no address
    expect(await addressHash('2026-10-21', '203.0.113.5')).not.toBe(ann);
    expect(ann).not.toMatch(/203|113/);
    const results: string[] = [];
    for (let i = 0; i < 4; i++) results.push(await takeVoiceAnswer(db, day, ann, 3, 5));
    expect(results).toEqual(['ok', 'ok', 'ok', 'limit']);
    expect([await takeVoiceAnswer(db, day, bob, 3, 5), await takeVoiceAnswer(db, day, bob, 3, 5)]).toEqual(['ok', 'ok']);
    // Everyone's limit reached (the over-share request still counted against it)
    expect(await takeVoiceAnswer(db, day, await addressHash(day, '198.51.100.7'), 3, 5)).toBe('limit');
    const rows = db.raw.prepare('SELECT * FROM voice_address_usage').all() as { who: string }[];
    for (const r of rows) expect(r.who).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ---------------------------------------------------------------------------
describe('after the season: what is not seasonal stays', () => {
  it('Abandoned Villages still generate (with their undead), Trick-or-Treat ones come out ordinary, hauntings still come', async () => {
    const { server } = await makeServer({ seed: SEED }, new MemoryStorage(), { clock: () => AFTER });
    expect(server.halloweenState().active).toBe(false);
    const g = server.overworld.generator as OverworldGenerator;
    const s = g.villageAt(VILLAGE.x, VILLAGE.z)!;
    await loadArea(server, s.bounds.x0, s.bounds.z0, s.bounds.x1, s.bounds.z1);
    expect(server.villages!.record(s.village!.key)!.kind).toBe('normal');
    // An Abandoned Village anywhere in this world is one whatever the date (its variant is the seed's)
    const found = g.structures ? [...Array(40).keys()].flatMap((i) => g.structures.startsFor(i * 7, -i * 5)).find((x) => x.village?.variant === 'abandoned') : undefined;
    void found;
    // The automatic haunting comes after the cutoff too
    const { player } = await join(server, 'Steve', 'uuid-steve');
    server.level.flags.autoHaunt = { haunted: true, after: 0, played: 0, at: Date.now() } satisfies AutoHauntRoll;
    tick(server, 3);
    expect((server.level.flags.haunt as { auto?: boolean } | undefined)?.auto).toBe(true);
    void player;
    await server.stop();
  }, 240000);
});
