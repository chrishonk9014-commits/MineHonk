/**
 * The Haunting, part two, on a real server: what he does to players
 * (glitches, admin tricks, monsters), nobody losing their things while he is
 * there, talking to him (an answer from the voice the game was given, his
 * scripted brain when there is none or it says something it should not),
 * and the lair ending inside the computer (dragged, wired into a chair,
 * shocked, SERVER MEMORY CORRUPTED), with Stop undoing it all.
 */
import { describe, it, expect } from 'vitest';
import { hauntOf } from '../helpers/haunt';
import { makeServer, join, tick, type FakeConn } from '../helpers/testServer';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { Mob } from '../../src/server/entity/Mob';
import { Random } from '../../src/common/math/rng';
import { HAUNT_SCENE, type HauntStatus } from '../../src/common/game/haunting';
import type { VoiceRequest } from '../../src/common/game/herobrineVoice';
import { stackOf } from '../../src/common/game/itemstack';
import { blocks, STATE_BLOCK } from '../../src/common/registry/blocks';

let req = 1;
function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): { ok: boolean; text: string; data?: HauntStatus } {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}

/** The haunting's private parts, for calling one trick at a time. */
type Inner = {
  rng: Random | { next(): number; int(n: number): number };
  glitchy(p: ServerPlayer): void;
  chaos(p: ServerPlayer, st: unknown, stage: string): void;
  summon(p: ServerPlayer, st: unknown, f: number): void;
  state: { t: number; total: number; sky?: unknown } | null;
};
const inner = (server: GameServer): Inner => server.haunting as unknown as Inner;
const hauntMobs = (server: GameServer): Mob[] => [...server.dims.values()].flatMap((d) => [...d.entities.values()]).filter((e): e is Mob => e instanceof Mob && !!e.data.hauntMob && !e.removed);
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('the Haunting: his tricks', () => {
  it('glitches players, plays admin, sends monsters (that drop nothing), and Stop takes it all back', async () => {
    const { server } = await makeServer({ seed: 'haunting-tricks', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 4);
    const other = await join(server, 'Alex', 'uuid-alex', 4);
    expect(admin(server, conn, { a: 'haunt', op: 'start', minutes: 10, erase: false, ending: 'ban' }).ok).toBe(true);
    const h = inner(server);
    h.rng = new Random(7);
    const st = h.state!;
    const dayBefore = server.level.dayTime;
    for (let i = 0; i < 6; i++) player.inventory.set(i, stackOf(['dirt', 'stone', 'torch', 'bread', 'stick', 'apple'][i]!, 1 + i));
    // Every trick, many times
    for (let i = 0; i < 60; i++) {
      h.glitchy(player);
      h.chaos(player, st, 'speaks');
      if (i % 3 === 0) tick(server, 10);
    }
    const fx = new Set<string>(conn.of('fx').map((m) => m.kind));
    for (const k of ['controls_reversed', 'hack', 'corrupt_world', 'player_glitch']) expect(fx.has(k), k).toBe(true);
    const chat = [...conn.of('chat'), ...other.conn.of('chat')].map((m) => m.text);
    expect(chat.some((t) => /^\[Admin\] Herobrine used: /.test(t))).toBe(true);
    expect(chat.some((t) => /^Herobrine (is now an operator|changed the difficulty)/.test(t))).toBe(true);
    // Midnight, thunder and lightning (only a flash and a sound)
    expect(server.level.dayTime).not.toBe(dayBefore);
    expect(conn.of('particles').some((m) => m.kind === 'lightning')).toBe(true);
    // The hotbar was shuffled, nothing lost
    const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => player.inventory.get(i)).filter(Boolean).map((s) => s!.count).sort();
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
    // A glitched name in chat
    (server.haunting as unknown as { glitchedNames: Map<string, number> }).glitchedNames.set(player.uuid, server.tickNo + 1000);
    server.handle(conn, { t: 'chat', text: 'hello?' });
    const said = other.conn.of('chat').filter((m) => m.text === 'hello?').pop()!;
    expect(said.from).not.toBe('Steve');

    // His monsters: glitched ones, then worse; they drop nothing
    for (let i = 0; i < 12; i++) h.summon(player, st, i < 4 ? 0.5 : 0.8);
    const mobs = hauntMobs(server);
    expect(mobs.length).toBeGreaterThan(0);
    expect(mobs.length).toBeLessThanOrEqual(6);
    expect(mobs.every((m) => m.admin)).toBe(true);
    const types = new Set(mobs.map((m) => m.type));
    expect([...types].some((t) => /glitch|zombie|skeleton|warden/.test(t))).toBe(true);
    const victim = mobs.find((m) => m.type !== 'warden')!;
    const dim = victim.dim;
    const at = { x: victim.x, y: victim.y, z: victim.z };
    // (Anything else in the world may drop things meanwhile: only what lands where it fell counts)
    const dropsThere = (): number => dim.entitiesNear(at.x, at.y, at.z, 2.5, (e) => e.type === 'item' || e.type === 'xp_orb').length;
    const before = dropsThere();
    server.interaction.hurtEntity(victim, 10000, 'player', player);
    tick(server, 3);
    expect(victim.dead || victim.removed).toBe(true);
    expect(dropsThere()).toBe(before);

    // Nobody loses their things while he is here
    const kept = player.inventory.slots.filter(Boolean).length;
    server.interaction.survival.die(player, { source: 'magic' });
    tick(server, 2);
    expect(player.dead).toBe(true);
    expect(player.inventory.slots.filter(Boolean).length).toBe(kept);
    server.handle(conn, { t: 'respawn' });
    tick(server, 2);

    // Stop: his monsters gone, the time and the weather put back
    const r = admin(server, conn, { a: 'haunt', op: 'stop' });
    expect(r.ok).toBe(true);
    expect(hauntMobs(server)).toEqual([]);
    expect(Math.abs(server.level.dayTime - dayBefore)).toBeLessThan(200);
  }, 300000);
});

describe('the Haunting: talking to him', () => {
  async function talking(): Promise<{ server: GameServer; conn: FakeConn; player: ServerPlayer }> {
    const { server } = await makeServer({ seed: 'haunting-talk', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 3);
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 30, erase: false, ending: 'ban' });
    // Always answers, no waiting about
    inner(server).rng = { next: () => 0.05, int: () => 0 };
    return { server, conn, player };
  }
  const say = async (server: GameServer, conn: FakeConn, text: string): Promise<string | undefined> => {
    const n = conn.of('chat').length;
    server.handle(conn, { t: 'chat', text });
    await flush();
    tick(server, 70);
    return conn
      .of('chat')
      .slice(n)
      .find((m) => m.kind === 'herobrine' && m.from === 'Herobrine')?.text;
  };

  it('answers from "He speaks" on, through the voice it was given, with what he knows', async () => {
    const { server, conn, player } = await talking();
    let asked: VoiceRequest | null = null;
    server.herobrineVoice = async (r) => {
      asked = r;
      return '  "i see you, steve."  ';
    };
    player.inventory.set(player.selectedSlot, stackOf('iron_sword', 1));
    // Too early: he only listens
    expect(await say(server, conn, 'herobrine are you there?')).toBeUndefined();
    expect(asked).toBeNull();
    inner(server).state!.t = Math.ceil(inner(server).state!.total * 0.705);
    tick(server, 3);
    expect(await say(server, conn, 'who are you?')).toBe('I SEE YOU, STEVE.');
    expect(asked!.player).toBe('Steve');
    expect(asked!.message).toBe('who are you?');
    expect(asked!.facts.holding).toBe('Iron Sword');
    expect(asked!.facts.health).toBe(20);
    expect(asked!.history.some((h) => h.text === 'herobrine are you there?')).toBe(true);
  }, 300000);

  it('falls back to his scripted lines when there is no voice, it says nothing, or it says something it should not', async () => {
    const { server, conn } = await talking();
    inner(server).state!.t = Math.ceil(inner(server).state!.total * 0.705);
    tick(server, 3);
    server.herobrineVoice = null;
    expect(await say(server, conn, 'who are you')).toMatch(/^(YOU KNOW WHO I AM|I AM HEROBRINE|I WAS HERE BEFORE YOU|THE ONE WHO WATCHES)$/);
    tick(server, 120);
    server.herobrineVoice = async () => null;
    expect(await say(server, conn, 'please go away')).toMatch(/[A-Z]/);
    tick(server, 120);
    server.herobrineVoice = async () => 'SHIT HAPPENS';
    const line = await say(server, conn, 'are you real?');
    expect(line).toBeDefined();
    expect(line).not.toMatch(/SHIT/);
    // Stopped: he says nothing more
    admin(server, conn, { a: 'haunt', op: 'stop' });
    tick(server, 120);
    expect(await say(server, conn, 'herobrine?')).toBeUndefined();
  }, 300000);
});

describe('the Haunting: the lair ending', () => {
  it('drags everyone into his hall in the computer, wires them up, shocks them, and ends with SERVER MEMORY CORRUPTED', async () => {
    const { server } = await makeServer({ seed: 'haunting-lair', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 3);
    server.level.owner = 'uuid-steve';
    const start = { x: player.x, y: player.y, z: player.z };
    expect(admin(server, conn, { a: 'haunt', op: 'start', minutes: 5, erase: true, ending: 'corrupted' }).data).toMatchObject({ ending: 'corrupted' });
    const st = inner(server).state!;
    st.t = Math.ceil(st.total * 0.965) - 2;
    const steps: string[] = [];
    let inComputer = false;
    let chair: string | null = null;
    let hbStage = '';
    for (let i = 0; i < HAUNT_SCENE.end + 200 && !conn.closed; i++) {
      tick(server, 1);
      if (i % 20 === 0) await flush();
      if (player.dim.id === 'computer') {
        inComputer = true;
        const below = player.dim.getState(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z));
        chair ??= blocks[STATE_BLOCK[below]!]!.id;
        hbStage = String((server.herobrine!.status() as { stage: string }).stage);
      }
    }
    for (const m of conn.of('fx')) if (m.kind === ('scene' as typeof m.kind)) steps.push(m.text!);
    expect(steps).toEqual(['grab', 'drag', 'black', 'wake', 'shock', 'shock', 'shock', 'die', 'corrupt']);
    expect(inComputer).toBe(true);
    expect(chair).toBe('dark_oak_stairs');
    // The Herobrine story left them alone: no lost connection, no fight
    expect(conn.of('fx').some((m) => m.kind === 'hack' && m.text === 'CONNECTION LOST')).toBe(false);
    expect(hbStage).toBe('none');
    // Wires (arcs from above) and the pull into the computer
    expect(conn.of('fx').some((m) => m.kind === 'arc')).toBe(true);
    expect(conn.of('fx').some((m) => m.kind === 'enter_computer')).toBe(true);
    // Back where they were before the kick, so a kept world finds them there
    const dims = conn.of('dimension').map((m) => m.dimension);
    expect(dims).toEqual(['computer', 'overworld']);
    expect(Math.hypot(player.x - start.x, player.z - start.z)).toBeLessThan(1);
    // Straight back to the title, the world deleted by its owner
    expect(conn.last('kick')).toMatchObject({ reason: 'SERVER MEMORY CORRUPTED', corrupted: true, erase: true });
    expect(conn.last('kick')!.ban).toBeUndefined();
    expect(hauntOf(server)).toBeUndefined();
  }, 300000);

  it('one time in four when left to chance; Stop in the middle of it brings everyone back', async () => {
    const { server } = await makeServer({ seed: 'haunting-lair-stop', cheats: true });
    const { conn, player } = await join(server, 'Steve', 'uuid-steve', 3);
    // Left to chance, decided as the end begins
    let lair = 0;
    for (let k = 0; k < 400; k++) {
      server.haunting!.admin(player, 'start', 5, false);
      const h = inner(server);
      h.rng = new Random(k * 7919 + 1);
      const s = h.state! as { t: number; total: number; final?: string };
      s.t = Math.ceil(s.total * 0.94);
      tick(server, 1);
      if (s.final === 'corrupted') lair++;
      server.haunting!.stop();
    }
    expect(lair / 400).toBeGreaterThan(0.17);
    expect(lair / 400).toBeLessThan(0.33);
    // Stop while wired into the chair
    const from = { x: player.x, z: player.z };
    admin(server, conn, { a: 'haunt', op: 'start', minutes: 5, erase: false, ending: 'corrupted' });
    const st = inner(server).state!;
    st.t = Math.ceil(st.total * 0.965);
    for (let i = 0; i < HAUNT_SCENE.wake + 20; i++) {
      tick(server, 1);
      if (i % 20 === 0) await flush();
    }
    expect(player.dim.id).toBe('computer');
    const r = admin(server, conn, { a: 'haunt', op: 'stop' });
    expect(r.ok).toBe(true);
    expect(player.dim.id).toBe('overworld');
    expect(Math.hypot(player.x - from.x, player.z - from.z)).toBeLessThan(1);
    expect(conn.of('fx').some((m) => m.kind === 'scene' && m.text === 'end')).toBe(true);
    expect(conn.closed).toBe(false);
    // His chairs in the hall are taken away too
    const cw = server.dim('computer');
    let chairs = 0;
    const L = (cw.generator as unknown as { layout(): { throne: { x: number; z: number }; hall: { y: number } } }).layout();
    for (let dz = -8; dz <= 8; dz++) if (blocks[STATE_BLOCK[cw.getState(L.throne.x - 8, L.hall.y, L.throne.z + dz)]!]!.id === 'dark_oak_stairs') chairs++;
    expect(chairs).toBe(0);
  }, 300000);
});
