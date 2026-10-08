/**
 * V6 - The End Expansion, phase 4: the five End quests, on the V4 quest
 * architecture (the structure plans' QuestSpec of kind 'end' says where the
 * parts are; records live in `level.quests.end`; the next step shows in the
 * quest tracker). The server checks every step.
 *
 * - THE LOST OBSERVATORY: find the dormant lens, mend it (8 Ancient
 *   Fragments), power it (256 EU/t for 30 s, engineering/end.ts), look
 *   through it: an Ancient Map to the nearest giant structure the looker
 *   hasn't found, once an in-game day.
 * - THE BROKEN GATEWAY: every broken portal (in End Ruins and the Fallen
 *   City) has a pair far round the band, found by a census of every broken
 *   portal the band's plan holds (seed-determined, so the same in every world
 *   with that seed; with an odd count, one is left over). Mend one (12
 *   Ancient End Bricks and an End Crystal), follow the map to the other, mend
 *   that: a gateway both ways for good (the network is `level.flags.endGates`).
 * - THE SILENT CITY: one per world (`level.flags.silentCity`): the Fallen
 *   City nearest the arrival island, or with none within 4,000 blocks the
 *   nearest End Settlement, or failing that End Ruins. Its sealed hall and
 *   four reliquaries are built into the city once its chunks load. Four
 *   Ancient Key Shards make the Ancient Key; the key opens the hall (the
 *   Silent Bell), the End Fortress's inner keep and the End Library's archive.
 * - THE CRYSTAL VAULT: an End Palace's vault. Four End Crystals on four
 *   pedestals, powered from a working Crystal Generator, light up one by one
 *   and the door opens; the vault's Bulwark wakes.
 * - THE DRAGON'S HISTORY: the Dragon's Nest. Read its five fragments and
 *   three more about the Dragon, gather four Dragon Scale Fragments and mend
 *   the Nest's ring with them: it opens one way into the Sanctum, built deep
 *   in the band the first time anyone goes through.
 *
 * Restoring an Ancient Core (8 Ancient Fragments and an Astral Shard) works
 * at one core per giant structure.
 *
 * Rewards: loot once per world (a cheat completion's loot is cheat-made and
 * doesn't use that up), advancements once per player and never under a
 * cheat. Everyone near when a step is done shares it.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { QuestRecord } from '../world/LevelData';
import type { Start, Box } from '../../common/gen/structures/manager';
import type { EndGenerator } from '../../common/gen/end';
import type { QuestInfo } from '../../common/net/protocol';
import { Mob } from '../entity/Mob';
import { S, blocks, STATE_BLOCK, STATE_SOLID, STATE_FLUID, getProp, withProp, stateOf } from '../../common/registry/blocks';
import { itemIdOf, stackOf, markAdmin, type ItemStack } from '../../common/game/itemstack';
import { hashInts, Random } from '../../common/math/rng';
import { END_QUESTS, END_QUEST_IDS, QUEST, pairPortals, portalCells, portalKey, type EndQuestId, type EndQuestSpec, type PortalSite } from '../../common/endExpansion/quests';
import { LORE, LORE_BY_ID, NEST_LORE } from '../../common/endExpansion/lore';
import { GIANT_TYPE, isConstruct } from '../../common/endExpansion/structures';
import { EXPANSION_INNER, EXPANSION_OUTER, inExpansion } from '../../common/endExpansion/region';
import { collisionShape } from '../../common/physics/shapes';
import { raycastBlocks } from '../../common/physics/raycast';
import { lookDir } from './Interaction';

type P3 = [number, number, number];

const k3 = (p: P3): string => `${p[0]},${p[1]},${p[2]}`;
const same = (a: P3, x: number, y: number, z: number): boolean => a[0] === x && a[1] === y && a[2] === z;
const P = (s: string): P3 => s.split(',').map(Number) as P3;

/** "about 90 blocks north-east" from one place to another. */
function where(from: { x: number; z: number }, to: P3): string {
  const dx = to[0] - from.x;
  const dz = to[2] - from.z;
  const d = Math.round(Math.hypot(dx, dz));
  const ns = dz < -Math.abs(dx) / 2 ? 'north' : dz > Math.abs(dx) / 2 ? 'south' : '';
  const ew = dx > Math.abs(dz) / 2 ? 'east' : dx < -Math.abs(dz) / 2 ? 'west' : '';
  return `about ${d.toLocaleString('en-US')} blocks ${ns}${ns && ew ? '-' : ''}${ew}`;
}

/** Runs a step generator to its end (admin and tests). */
function drain<T>(g: Generator<void, T>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/** A broken portal in the gateway network (`level.flags.endGates`, by portal key). */
export interface GateState {
  site: PortalSite;
  /** Its pair (null: it has none); absent until the census has run. */
  pair?: string | null;
  pairSite?: PortalSite;
  /** Its frame is mended. */
  repaired?: boolean;
  /** Both ends are mended: a gateway. `open`: its sheet has been lit (its chunk may not have been loaded when it linked). */
  linked?: boolean;
  open?: boolean;
  /** Someone has gone through. */
  used?: boolean;
}

/** The world's Silent City (`level.flags.silentCity`). */
export interface SilentHost {
  type: string;
  /** The host structure's anchor. */
  at: P3;
  /** The middle of the sealed hall's floor. */
  hall: P3;
  /** Where the four reliquaries go (moved onto a floor when built). */
  spots: P3[];
  /** Built so far: 'hall', and 'rel<i>' for each reliquary (its position in `rel`). */
  built: string[];
  rel: (P3 | null)[];
  door?: P3[];
}

/** The Sanctum (`level.flags.dragonSanctum`). */
interface SanctumState {
  at: P3;
  built: boolean;
}

interface Job {
  gen: Generator<void, unknown>;
  done: (r: unknown) => void;
}

const NEST_IDS = NEST_LORE.map((f) => f.id);
/** Dragon fragments beyond the Nest's own (the quest lore excluded). */
const DRAGON_IDS = LORE.filter((f) => f.topic === 'dragon').map((f) => f.id);
const QUEST_TITLE = Object.fromEntries(END_QUESTS.map((q) => [q.id, q.title])) as Record<EndQuestId, string>;
const QUEST_STEPS = Object.fromEntries(END_QUESTS.map((q) => [q.id, q.steps.length])) as Record<EndQuestId, number>;
/** The Sanctum: a box this wide and tall, its return portal in the front wall. */
const SANCTUM = { w: 13, h: 9 } as const;

export class EndQuestsSystem {
  private readonly shown = new Map<ServerPlayer, string>();
  /** Pointers to quests just finished: shown as complete for a while, then dropped. */
  private readonly doneSince = new Map<ServerPlayer, number>();
  private readonly jobs: Job[] = [];
  /** The census of the band's broken portals: portal key -> its site and pair (null until it has run). */
  private portals: Map<string, { site: PortalSite; pair: string | null }> | null = null;
  private censusRunning: Generator<void, Map<string, { site: PortalSite; pair: string | null }>> | null = null;
  private sheets: Map<string, string> | null = null;
  private hostJob = false;
  /** Crystal Vaults lighting up: record key -> pedestals lit so far and when the next lights. */
  private readonly lighting = new Map<string, { n: number; next: number }>();
  private readonly bellReady = new Map<string, number>();

  constructor(private readonly server: GameServer) {}

  // ------------------------------------------------------------------ plumbing

  private get end(): Dimension {
    return this.server.dim('end');
  }

  private get gen(): EndGenerator {
    return this.end.generator as EndGenerator;
  }

  /** Worlds with the Expanded End's structures (generator 8+). */
  get on(): boolean {
    return !!this.gen.expansionStructures;
  }

  private get flags(): Record<string, unknown> {
    return this.server.level.flags;
  }

  rec(key: string): QuestRecord {
    const r = (this.server.level.quests.end[key] ??= { stage: 0, done: false, rewarded: [], flags: [] });
    r.flags ??= [];
    return r;
  }

  /** A record to read (a blank one, not saved, when there is none yet: looking never creates records). */
  private peek(key: string): QuestRecord {
    const r = this.server.level.quests.end[key];
    return r ? { ...r, flags: r.flags ?? [] } : { stage: 0, done: false, rewarded: [], flags: [] };
  }

  private flag(r: QuestRecord, f: string): void {
    if (!r.flags!.includes(f) && r.flags!.length < 64) r.flags!.push(f);
  }

  private has(r: QuestRecord, f: string): boolean {
    return !!r.flags?.includes(f);
  }

  private questOf(s: Start): EndQuestSpec | null {
    return s.quest?.kind === 'end' ? (s.quest as EndQuestSpec) : null;
  }

  /** Quest structures whose pieces hold a block. */
  private startsAt(x: number, y: number, z: number): Start[] {
    const es = this.server.endStructures;
    if (!es) return [];
    return [...es.structuresAt(x, y, z), ...es.generatedAt(x, y, z)].filter((s) => this.questOf(s));
  }

  /**
   * The Admin Panel built a structure: its quests work (to try them out), but
   * their records start cheat-flagged, so nothing there ever earns anything.
   */
  onGenerated(s: Start): void {
    const q = this.questOf(s);
    if (!q) return;
    const keys: string[] = [];
    if (q.lens) keys.push(`obs:${k3(q.lens.lens)}`);
    if (q.vault) keys.push(`vault:${k3(q.vault.pedestals[0]!)}`);
    for (const site of q.portals ?? []) keys.push(`gate:${portalKey(site)}`);
    for (const seal of q.seals ?? []) if (seal.kind !== 'vault') keys.push(`seal:${k3(seal.door[0]!)}`);
    if (q.cores?.length) keys.push(`core:${s.type}@${s.x},${s.z}`);
    for (const k of keys) this.flag(this.rec(k), 'cheat');
  }

  /** Quest structures around a player (their bounds, a little padded upwards and downwards). */
  private startsNear(p: ServerPlayer): Start[] {
    if (!this.on || p.dim.id !== 'end') return [];
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    const natural = inExpansion(x, z) ? this.gen.expansionStartsAt(x, z) : [];
    const built = this.server.endStructures?.generatedStarts().filter((s) => x >= s.bounds.x0 && x <= s.bounds.x1 && z >= s.bounds.z0 && z <= s.bounds.z1) ?? [];
    return [...natural, ...built].filter((s) => this.questOf(s) && p.y >= s.bounds.y0 - 8 && p.y <= s.bounds.y1 + 8);
  }

  private present(dim: Dimension, at: P3, r = 32): ServerPlayer[] {
    return [...this.server.players.values()].filter((p) => p.dim === dim && !p.dead && p.gamemode !== 'spectator' && (p.x - at[0] - 0.5) ** 2 + (p.y - at[1]) ** 2 + (p.z - at[2] - 0.5) ** 2 <= r * r);
  }

  private cheatOf(p: ServerPlayer, stack?: ItemStack | null): boolean {
    return this.server.interaction.isCheat(p, stack ?? undefined);
  }

  private visitor(p: ServerPlayer): boolean {
    return this.server.roleOf(p) === 'visitor';
  }

  /** Items of a kind in the main inventory and the offhand. */
  count(p: ServerPlayer, id: string): number {
    let n = 0;
    for (let i = 0; i < 36; i++) {
      const s = p.inventory.get(i);
      if (s && itemIdOf(s) === id) n += s.count;
    }
    const o = p.inventory.get(40);
    if (o && itemIdOf(o) === id) n += o.count;
    return n;
  }

  /** Takes n items of a kind (nothing in creative). Returns whether any taken were cheat-made, or null when there aren't enough. */
  private take(p: ServerPlayer, id: string, n: number): { cheat: boolean } | null {
    if (this.count(p, id) < n) return null;
    let cheat = this.server.admin.inContext(p);
    if (p.gamemode === 'creative') return { cheat };
    for (const i of [...Array(36).keys(), 40]) {
      if (n <= 0) break;
      const s = p.inventory.get(i);
      if (!s || itemIdOf(s) !== id) continue;
      if (this.cheatOf(p, s)) cheat = true;
      const t = Math.min(n, s.count);
      n -= t;
      p.inventory.set(i, s.count > t ? { ...s, count: s.count - t } : null);
    }
    return { cheat };
  }

  private holding(p: ServerPlayer, id: string): ItemStack | null {
    for (const s of [p.inventory.get(p.selectedSlot), p.inventory.get(40)]) if (s && itemIdOf(s) === id) return s;
    return null;
  }

  private give(p: ServerPlayer, st: ItemStack, cheat: boolean): void {
    const rem = p.inventory.add(cheat ? markAdmin(st) : st);
    if (rem) this.server.interaction.dropStack(p, rem);
  }

  private say(p: ServerPlayer, text: string): void {
    p.send({ t: 'title', text: '', sub: text, ticks: 60 });
  }

  /** The quest a player follows in the tracker. */
  private follow(p: ServerPlayer, key: string): void {
    if (p.endQuest === key) return;
    p.endQuest = key;
    this.doneSince.delete(p);
  }

  /** The world's one reward for a quest (false once given; a cheat completion never uses it up). */
  private worldReward(q: EndQuestId, cheat: boolean): boolean {
    if (cheat) return true;
    const r = this.rec('rewards');
    if (this.has(r, q)) return false;
    this.flag(r, q);
    return true;
  }

  /** A quest is complete: everyone near shares it (advancements once each, never under a cheat). */
  private finish(q: EndQuestId, r: QuestRecord, dim: Dimension, at: P3, extra?: (p: ServerPlayer, cheat: boolean) => void): void {
    r.done = true;
    r.stage = QUEST_STEPS[q];
    for (const p of this.present(dim, at)) this.award(q, r, p, extra);
  }

  private award(q: EndQuestId, r: QuestRecord, p: ServerPlayer, extra?: (p: ServerPlayer, cheat: boolean) => void): void {
    if (r.rewarded.includes(p.uuid)) return;
    if (r.rewarded.length < 64) r.rewarded.push(p.uuid);
    const cheat = this.has(r, 'cheat') || this.server.admin.inContext(p);
    p.send({ t: 'title', text: 'QUEST COMPLETE', sub: QUEST_TITLE[q], ticks: 80 });
    this.server.playSound(p.dim, 'quest.complete', p.x, p.y + 1, p.z, 1, 1);
    extra?.(p, cheat);
    if (cheat) return;
    const it = this.server.interaction;
    it.grant(p, `quest_${q}`);
    if (END_QUEST_IDS.every((id) => p.achievements.has(`quest_${id}`))) it.grant(p, 'all_end_quests');
  }

  // ------------------------------------------------------------------ jobs (searches spread over ticks)

  private job<T>(gen: Generator<void, T>, done: (r: T) => void): void {
    this.jobs.push({ gen, done: done as (r: unknown) => void });
  }

  private runJobs(budgetMs = 6): void {
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < budgetMs) {
      const j = this.jobs[0]!;
      const r = j.gen.next();
      if (r.done) {
        this.jobs.shift();
        j.done(r.value);
      }
    }
    if (this.censusRunning && performance.now() - t0 < budgetMs) {
      let r = this.censusRunning.next();
      while (!r.done && performance.now() - t0 < budgetMs) r = this.censusRunning.next();
      if (r.done) {
        this.censusRunning = null;
        this.portals = r.value;
      }
    }
  }

  // ------------------------------------------------------------------ using blocks

  /** Right-clicks on the quests' blocks. True when handled. */
  useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    if (p.dim.id !== 'end') return false;
    const id = blocks[STATE_BLOCK[state]!]!.id;
    switch (id) {
      case 'ancient_lens':
        return this.useLens(p, x, y, z);
      case 'restored_ancient_lens':
        return this.lookThrough(p, x, y, z);
      case 'dead_portal':
        return this.useBrokenPortal(p, x, y, z, true) || this.useNestRing(p, x, y, z);
      case 'ancient_end_bricks':
      case 'cracked_ancient_end_bricks':
      case 'chiseled_ancient_end_bricks':
      case 'obsidian':
      case 'crying_obsidian':
        // A frame: only with what mends it in hand (anything else places blocks against it as usual)
        if (!this.holding(p, 'ancient_end_bricks') && !this.holding(p, 'end_crystal') && !this.holding(p, 'dragon_scale_fragment')) return false;
        return this.useBrokenPortal(p, x, y, z, false) || this.useNestRing(p, x, y, z);
      case 'ancient_core':
        return this.useCore(p, x, y, z);
      case 'ancient_vault_door':
        return this.useSealDoor(p, x, y, z);
      case 'crystal_vault_door':
        return this.useVaultDoor(p, x, y, z);
      case 'crystal_pedestal':
        return this.usePedestal(p, x, y, z, state);
      case 'ancient_reliquary':
        return this.useReliquary(p, x, y, z, state);
    }
    return false;
  }

  // ------------------------------------------------------------------ THE LOST OBSERVATORY

  private obsAt(x: number, y: number, z: number): { q: NonNullable<EndQuestSpec['lens']>; key: string } | null {
    for (const s of this.startsAt(x, y, z)) {
      const q = this.questOf(s)!.lens;
      if (q && (same(q.lens, x, y, z) || q.disc?.some((d) => same(d, x, y, z)))) return { q, key: `obs:${k3(q.lens)}` };
    }
    return null;
  }

  private useLens(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const o = this.obsAt(x, y, z);
    if (!o) return false;
    const dim = p.dim;
    const r = this.rec(o.key);
    this.follow(p, o.key);
    if (r.stage < 1) r.stage = 1;
    if (blocks[STATE_BLOCK[dim.getState(...o.q.lens)]!]!.id !== 'ancient_lens') return true;
    if (this.visitor(p)) return false;
    const have = this.count(p, 'ancient_fragment');
    if (have < QUEST.lensFragments) {
      this.say(p, `The lens is cracked. (${have}/${QUEST.lensFragments} Ancient Fragments)`);
      this.server.playSound(dim, 'block.dormant', x + 0.5, y + 0.5, z + 0.5, 0.6, 1);
      return true;
    }
    const t = this.take(p, 'ancient_fragment', QUEST.lensFragments)!;
    if (t.cheat) this.flag(r, 'cheat');
    this.repairLens(dim, o.q);
    r.stage = 2;
    this.say(p, 'The lens is whole. It is dark.');
    return true;
  }

  private repairLens(dim: Dimension, q: NonNullable<EndQuestSpec['lens']>): void {
    const [lx, ly, lz] = q.lens;
    dim.setBlock(lx, ly, lz, S('restored_ancient_lens'));
    // The tube's gaps close and the core at its foot is back (it may have been mined)
    for (const m of q.mend) if (blocks[STATE_BLOCK[dim.getState(...m)]!]!.id !== 'ancient_conduit') dim.setBlock(m[0], m[1], m[2], stateOf('ancient_conduit', { axis: 'y' }));
    if (dim.getState(...q.core) === 0) dim.setBlock(q.core[0], q.core[1], q.core[2], S('ancient_core'));
    this.server.playSound(dim, 'block.lens_repair', lx + 0.5, ly + 0.5, lz + 0.5, 1, 1);
    this.server.particles(dim, 'end_rod', lx + 0.5, ly + 0.5, lz + 0.5, 20, 0.6);
  }

  /** The restored lens has woken (30 seconds of power): the telescope can be used. */
  onLensAwake(dim: Dimension, x: number, y: number, z: number): void {
    const key = `obs:${x},${y},${z}`;
    const r = this.rec(key);
    if ((dim.getBlockEntity(x, y, z) as { cheat?: number } | undefined)?.cheat) this.flag(r, 'cheat');
    r.stage = Math.max(r.stage, 3);
    const o = this.obsAt(x, y, z);
    for (const d of o?.q.disc ?? []) {
      const st = dim.getState(...d);
      if (blocks[STATE_BLOCK[st]!]!.id === 'ancient_lens') dim.setBlock(d[0], d[1], d[2], withProp(st, 'lit', 'true'));
    }
    for (const p of this.present(dim, [x, y, z], 48)) this.say(p, 'The lens wakes.');
  }

  private lookThrough(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const o = this.obsAt(x, y, z);
    const be = p.dim.getBlockEntity(...(o?.q.lens ?? [x, y, z])) as { awake?: boolean } | undefined;
    if (!o || !be?.awake) return false;
    const r = this.rec(o.key);
    this.follow(p, o.key);
    const day = Math.floor(this.server.level.time / QUEST.lookEvery);
    const cheat = this.has(r, 'cheat') || this.server.admin.inContext(p);
    this.server.playSound(p.dim, 'block.telescope', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    if (this.has(r, `day:${day}`)) {
      this.say(p, 'The stars have nothing more to show tonight.');
      return true;
    }
    r.flags = r.flags!.filter((f) => !f.startsWith('day:'));
    this.flag(r, `day:${day}`);
    this.say(p, 'Something far away is marked.');
    this.mapToUnfound(p, cheat);
    if (!r.done) {
      if (this.worldReward('lost_observatory', cheat)) {
        this.give(p, stackOf('astral_shard', 2), cheat);
        this.give(p, stackOf('book', 1, { tag: { lore: 'stars_circle' } }), cheat);
      }
      this.finish('lost_observatory', r, p.dim, [x, y, z]);
    }
    return true;
  }

  /** An Ancient Map to the nearest giant structure a player hasn't found (searched over the next ticks). */
  private mapToUnfound(p: ServerPlayer, cheat: boolean): void {
    const m = this.gen.expansionStructures;
    if (!m) return;
    const accept = (s: Start): boolean => !p.endTitles.has(`${s.type}@${s.x},${s.z}`);
    this.job(m.nearestSteps(GIANT_TYPE, Math.floor(p.x), Math.floor(p.z), 8, accept), (s) => {
      if (!this.server.players.has(p.conn.id)) return;
      if (!s) {
        p.send({ t: 'chat', text: 'The telescope shows nothing you haven\'t already found.', kind: 'system' });
        return;
      }
      this.give(p, this.mapTo([s.x, s.y, s.z]), cheat);
    });
  }

  private mapTo(at: P3): ItemStack {
    return stackOf('ancient_map', 1, { tag: { data: { map: 'marked', target: at, dim: 'end' } } });
  }

  // ------------------------------------------------------------------ THE BROKEN GATEWAY

  get gates(): Record<string, GateState> {
    const f = this.flags as { endGates?: Record<string, GateState> };
    return (f.endGates ??= {});
  }

  /** The broken portal a block belongs to (its frame or its sheet). */
  portalAt(x: number, y: number, z: number): { key: string; site: PortalSite } | null {
    for (const s of this.startsAt(x, y, z))
      for (const site of this.questOf(s)!.portals ?? []) {
        const c = portalCells(site);
        if (c.frame.some((q) => same(q, x, y, z)) || c.sheet.some((q) => same(q, x, y, z))) return { key: portalKey(site), site };
      }
    return null;
  }

  private gateOf(key: string, site: PortalSite): GateState {
    return (this.gates[key] ??= { site });
  }

  /** The census: every broken portal in the band, and their pairs (cheap: a fraction of a second, once). */
  private *census(): Generator<void, Map<string, { site: PortalSite; pair: string | null }>> {
    const out = new Map<string, { site: PortalSite; pair: string | null }>();
    const m = this.gen.censusManager();
    if (!m) return out;
    const margin = 400;
    const found = new Map<string, { site: PortalSite; x: number; z: number }>();
    for (const type of ['end_ruins', GIANT_TYPE]) {
      const span = m.spacingOf(type) * 16;
      if (!span) continue;
      const n = Math.ceil((EXPANSION_OUTER + margin) / span) + 1;
      for (let rx = -n; rx <= n; rx++) {
        for (let rz = -n; rz <= n; rz++) {
          // Regions wholly inside the band's hole or outside it have nothing
          const nx = Math.max(rx * span, Math.min(0, (rx + 1) * span));
          const nz = Math.max(rz * span, Math.min(0, (rz + 1) * span));
          const fx = Math.max(Math.abs(rx * span), Math.abs((rx + 1) * span));
          const fz = Math.max(Math.abs(rz * span), Math.abs((rz + 1) * span));
          if (Math.hypot(nx, nz) > EXPANSION_OUTER + margin || Math.hypot(fx, fz) < EXPANSION_INNER - margin) continue;
          const s = m.regionStart(type, rx, rz);
          for (const site of (s && this.questOf(s)?.portals) || []) {
            const b = portalCells(site).base;
            found.set(portalKey(site), { site, x: b[0], z: b[2] });
          }
        }
        yield;
      }
    }
    // Where the sorting starts round the band (so which portal is left over) is the seed's
    const turn = ((hashInts(this.server.level.seedNum, 0x6a7e) >>> 0) / 4294967296) * Math.PI * 2;
    const pairs = pairPortals([...found].map(([key, f]) => ({ key, x: f.x, z: f.z })), turn);
    for (const [key, f] of found) out.set(key, { site: f.site, pair: pairs.get(key) ?? null });
    return out;
  }

  /** Starts the census in the background (an inspected portal will soon want its pair). */
  private startCensus(): void {
    if (this.portals || this.censusRunning) return;
    this.censusRunning = this.census();
  }

  /** The census, finished now if it has to be. */
  censusNow(): Map<string, { site: PortalSite; pair: string | null }> {
    if (this.portals) return this.portals;
    const g = this.censusRunning ?? this.census();
    this.censusRunning = null;
    return (this.portals = drain(g));
  }

  /** A portal's pair (running the census if need be). Both ends learn of each other. */
  pairOf(key: string, site: PortalSite): string | null {
    const st = this.gateOf(key, site);
    if (st.pair !== undefined) return st.pair;
    const c = this.censusNow();
    const pair = c.get(key)?.pair ?? null;
    st.pair = pair;
    if (pair) {
      const ps = c.get(pair)!.site;
      st.pairSite = ps;
      const other = this.gateOf(pair, ps);
      other.pair = key;
      other.pairSite = site;
    }
    return pair;
  }

  private useBrokenPortal(p: ServerPlayer, x: number, y: number, z: number, sheet: boolean): boolean {
    const pt = this.portalAt(x, y, z);
    if (!pt) return false;
    const st = this.gateOf(pt.key, pt.site);
    const r = this.rec(`gate:${pt.key}`);
    // Following this portal's pair keeps the quest as it is
    const mine = p.endQuest?.startsWith('gate:') && this.gates[p.endQuest.slice(5)]?.pair === pt.key;
    if (!mine) this.follow(p, `gate:${pt.key}`);
    if (st.linked) {
      if (!sheet) this.say(p, 'The gateway is open.');
      return true;
    }
    if (r.stage < 1) {
      r.stage = 1;
      this.startCensus();
    }
    const bricks = this.count(p, 'ancient_end_bricks');
    const crystals = this.count(p, 'end_crystal');
    if (st.repaired) {
      this.say(p, 'Its frame is whole. Its pair is not.');
      return true;
    }
    if (this.visitor(p) || bricks < QUEST.frameBricks || crystals < QUEST.frameCrystals) {
      this.say(p, `The frame is broken. (${Math.min(bricks, QUEST.frameBricks)}/${QUEST.frameBricks} Ancient End Bricks, ${Math.min(crystals, 1)}/1 End Crystal)`);
      this.server.playSound(p.dim, 'block.dead_portal', x + 0.5, y + 0.5, z + 0.5, 0.6, 1);
      return true;
    }
    const pair = this.pairOf(pt.key, pt.site);
    if (!pair) {
      this.flag(r, 'nopair');
      this.say(p, 'Nothing answers from the other side.');
      return true;
    }
    const a = this.take(p, 'ancient_end_bricks', QUEST.frameBricks)!;
    const b = this.take(p, 'end_crystal', QUEST.frameCrystals)!;
    if (a.cheat || b.cheat) this.flag(r, 'cheat');
    this.mendFrame(p.dim, pt.site);
    st.repaired = true;
    r.stage = Math.max(r.stage, 2);
    const other = this.gates[pair]!;
    if (other.repaired) this.link(pt.key, pair, p.dim, portalCells(pt.site).base);
    else {
      this.give(p, this.mapTo(portalCells(other.site).base), this.has(r, 'cheat') || this.server.admin.inContext(p));
      this.say(p, 'The frame is whole. Somewhere, its pair is not.');
    }
    return true;
  }

  /** Puts a broken portal's frame back (and fills its dead sheet). */
  private mendFrame(dim: Dimension, site: PortalSite): void {
    const c = portalCells(site);
    for (const f of c.frame) dim.setBlock(f[0], f[1], f[2], c.corners.some((q) => same(q, ...f)) ? S('chiseled_ancient_end_bricks') : S('ancient_end_bricks'));
    for (const q of c.sheet) dim.setBlock(q[0], q[1], q[2], stateOf('dead_portal', { axis: c.axis }));
    const [bx, by, bz] = c.base;
    this.server.playSound(dim, 'block.portal_repair', bx + 0.5, by + 1, bz + 0.5, 1, 1);
    this.server.particles(dim, 'portal', bx + 0.5, by + 1.5, bz + 0.5, 30, 1);
  }

  /** Both ends are mended: they become a gateway, both ways, for good. */
  private link(a: string, b: string, dim: Dimension, at: P3): void {
    for (const k of [a, b]) {
      const st = this.gates[k]!;
      st.linked = true;
      st.repaired = true;
      st.open = this.openSheet(dim, st.site);
      const r = this.rec(`gate:${k}`);
      r.stage = Math.max(r.stage, 4);
    }
    this.sheets = null;
    const cheat = this.has(this.rec(`gate:${a}`), 'cheat') || this.has(this.rec(`gate:${b}`), 'cheat');
    if (cheat) for (const k of [a, b]) this.flag(this.rec(`gate:${k}`), 'cheat');
    this.server.playSound(dim, 'block.gateway_open', at[0] + 0.5, at[1] + 1, at[2] + 0.5, 1.5, 1);
    for (const p of this.present(dim, at)) {
      p.send({ t: 'title', text: '', sub: 'The portal wakes. Its pair answers.', ticks: 70 });
      if (!cheat && !this.server.admin.inContext(p)) this.server.interaction.grant(p, 'repair_gateway_pair');
    }
  }

  /** Lights a linked portal's sheet (false while its chunk isn't loaded: the tick tries again). */
  private openSheet(dim: Dimension, site: PortalSite): boolean {
    const c = portalCells(site);
    if (!c.sheet.every((q) => dim.isLoaded(q[0], q[2]))) return false;
    for (const q of c.sheet) dim.setBlock(q[0], q[1], q[2], stateOf('ancient_gateway', { axis: c.axis }));
    return true;
  }

  /** Every lit gateway sheet cell -> its portal. */
  private sheetIndex(): Map<string, string> {
    if (this.sheets) return this.sheets;
    const m = new Map<string, string>();
    for (const [k, st] of Object.entries(this.gates)) if (st.linked) for (const q of portalCells(st.site).sheet) m.set(k3(q), k);
    return (this.sheets = m);
  }

  /** Where stepping into an ancient gateway's sheet takes a player (null: nowhere). */
  gatewayExit(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number): P3 | null {
    if (dim.id !== 'end') return null;
    const d = this.dragonExit(p, x, y, z);
    if (d) return d;
    const key = this.sheetIndex().get(`${x},${y},${z}`);
    const st = key ? this.gates[key] : undefined;
    if (!key || !st?.linked || !st.pair) return null;
    const other = this.gates[st.pair];
    if (!other) return null;
    const c = portalCells(other.site);
    // Out the far side's face, away from the sheet
    const to: P3 = [c.base[0] + c.normal[0] * 2, c.base[1], c.base[2] + c.normal[1] * 2];
    if (!st.used || !other.used) {
      st.used = true;
      other.used = true;
      const r = this.rec(`gate:${key}`);
      const r2 = this.rec(`gate:${st.pair}`);
      const cheat = this.has(r, 'cheat') || this.has(r2, 'cheat');
      if (this.worldReward('broken_gateway', cheat || this.server.admin.inContext(p))) this.give(p, stackOf('book', 1, { tag: { lore: 'gateways_stitches' } }), cheat || this.server.admin.inContext(p));
      r2.done = true;
      r2.stage = QUEST_STEPS.broken_gateway;
      this.finish('broken_gateway', r, dim, [x, y, z], undefined);
      for (const pl of this.present(dim, [x, y, z], 16)) r2.rewarded.includes(pl.uuid) || r2.rewarded.push(pl.uuid);
    } else {
      // Later travellers who never went through get the advancement on their first trip
      const r = this.rec(`gate:${key}`);
      this.award('broken_gateway', r, p);
    }
    return to;
  }

  /** A safe place to arrive near a gateway's way out (null: its chunks aren't ready yet). */
  landing(dim: Dimension, to: P3): P3 | null {
    const sanctum = this.sanctumState();
    if (sanctum && same(this.sanctumEntry(sanctum.at), ...to)) {
      if (!sanctum.built && !this.buildSanctum(dim, sanctum)) return null;
    }
    if (!dim.isLoaded(to[0], to[2])) return null;
    const ok = (x: number, y: number, z: number): boolean => {
      const below = dim.getState(x, y - 1, z);
      return STATE_SOLID[below] === 1 && this.clear(dim, x, y, z) && this.clear(dim, x, y + 1, z);
    };
    for (let r = 0; r <= 3; r++)
      for (let dy = 2; dy >= -6; dy--)
        for (let dx = -r; dx <= r; dx++)
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = to[0] + dx;
            const y = to[1] + dy;
            const z = to[2] + dz;
            if (ok(x, y, z)) return [x, y, z];
          }
    return to;
  }

  private clear(dim: Dimension, x: number, y: number, z: number): boolean {
    const st = dim.getState(x, y, z);
    if (STATE_FLUID[st] || collisionShape(st).length) return false;
    const id = blocks[STATE_BLOCK[st]!]!.id;
    return id !== 'ancient_gateway' && id !== 'end_portal' && id !== 'end_gateway' && !id.includes('fire');
  }

  // ------------------------------------------------------------------ ancient cores and sealed rooms

  private useCore(p: ServerPlayer, x: number, y: number, z: number): boolean {
    for (const s of this.startsAt(x, y, z)) {
      const cores = this.questOf(s)!.cores ?? [];
      if (!cores.some((c) => same(c, x, y, z))) continue;
      const r = this.rec(`core:${s.type}@${s.x},${s.z}`);
      if (r.done) {
        this.say(p, 'This place\'s power was already woken elsewhere.');
        return true;
      }
      const frags = this.count(p, 'ancient_fragment');
      const shards = this.count(p, 'astral_shard');
      if (this.visitor(p) || frags < QUEST.coreFragments || shards < QUEST.coreShards) {
        this.say(p, `It has no power. (${Math.min(frags, QUEST.coreFragments)}/${QUEST.coreFragments} Ancient Fragments, ${Math.min(shards, 1)}/1 Astral Shard)`);
        this.server.playSound(p.dim, 'block.dormant', x + 0.5, y + 0.5, z + 0.5, 0.6, 1);
        return true;
      }
      const a = this.take(p, 'ancient_fragment', QUEST.coreFragments)!;
      const b = this.take(p, 'astral_shard', QUEST.coreShards)!;
      const cheat = a.cheat || b.cheat || this.has(r, 'cheat');
      this.restoreCore(p.dim, x, y, z, p.uuid, cheat);
      r.done = true;
      this.flag(r, `at:${x},${y},${z}`);
      if (cheat) this.flag(r, 'cheat');
      this.say(p, 'The core wakes. It will not run out.');
      if (!cheat) this.server.interaction.grant(p, 'restore_ancient_core');
      return true;
    }
    return false;
  }

  private restoreCore(dim: Dimension, x: number, y: number, z: number, by: string, cheat: boolean): void {
    dim.setBlock(x, y, z, S('restored_ancient_core'));
    const be = dim.getBlockEntity(x, y, z) as { by?: string; cheat?: number } | undefined;
    if (be) {
      be.by = by;
      if (cheat) be.cheat = 1;
    }
    this.server.playSound(dim, 'block.core_wake', x + 0.5, y + 0.5, z + 0.5, 1.2, 1);
    this.server.particles(dim, 'end_rod', x + 0.5, y + 0.5, z + 0.5, 30, 0.7);
  }

  /** The sealed room a vault door belongs to (the Silent City's hall, an archive or an inner keep). */
  private sealAt(x: number, y: number, z: number): { kind: 'hall' | 'archive' | 'keep'; door: P3[]; room: Box | null; key: string; core?: P3 } | null {
    const host = this.host;
    if (host?.door?.some((d) => same(d, x, y, z))) return { kind: 'hall', door: host.door, room: null, key: 'silent' };
    for (const s of this.startsAt(x, y, z))
      for (const seal of this.questOf(s)!.seals ?? []) {
        if (seal.kind === 'vault' || !seal.door.some((d) => same(d, x, y, z))) continue;
        const room = seal.room;
        const core = (this.questOf(s)!.cores ?? []).find((c) => c[0] >= room.x0 && c[0] <= room.x1 && c[1] >= room.y0 && c[1] <= room.y1 && c[2] >= room.z0 && c[2] <= room.z1);
        return { kind: seal.kind, door: seal.door, room, key: `seal:${k3(seal.door[0]!)}`, core };
      }
    return null;
  }

  private useSealDoor(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const seal = this.sealAt(x, y, z);
    if (!seal) return false;
    if (seal.kind === 'hall') this.follow(p, 'silent');
    if (!this.holding(p, 'ancient_key') || this.visitor(p)) {
      this.say(p, 'It is sealed. It wants a key.');
      this.server.playSound(p.dim, 'block.dormant', x + 0.5, y + 0.5, z + 0.5, 0.6, 0.8);
      return true;
    }
    const cheat = this.cheatOf(p, this.holding(p, 'ancient_key'));
    this.openDoor(p.dim, seal.door);
    if (seal.kind === 'hall') {
      const r = this.rec('silent');
      this.flag(r, 'opened');
      if (cheat) this.flag(r, 'cheat');
      r.stage = Math.max(r.stage, 3);
      this.say(p, 'The hall opens. It is very quiet inside.');
      return true;
    }
    const r = this.rec(seal.key);
    if (!r.done) {
      r.done = true;
      if (cheat) this.flag(r, 'cheat');
      // What waits inside (phase 3 worlds sealed these rooms empty)
      if (seal.room) {
        this.placeChest(p.dim, seal.room, seal.kind === 'archive' ? 'chest/end_library_archive' : 'chest/end_fortress_keep', seal.core ? 2 : 0);
        if (seal.core && p.dim.getState(...seal.core) === 0) p.dim.setBlock(seal.core[0], seal.core[1], seal.core[2], S('ancient_core'));
      }
    }
    this.say(p, seal.kind === 'archive' ? 'The archive opens.' : 'The inner keep opens.');
    return true;
  }

  private openDoor(dim: Dimension, door: P3[]): void {
    for (const d of door) {
      dim.setBlock(d[0], d[1], d[2], 0);
      this.server.particles(dim, 'end_rod', d[0] + 0.5, d[1] + 0.5, d[2] + 0.5, 10, 0.4);
    }
    const [x, y, z] = door[0]!;
    this.server.playSound(dim, 'block.vault_open', x + 0.5, y + 0.5, z + 0.5, 1.4, 0.8);
  }

  /** A loot chest on the floor of a room, near its middle (offset `side` blocks along x). */
  private placeChest(dim: Dimension, room: Box, loot: string, side = 0): P3 | null {
    const cx = Math.floor((room.x0 + room.x1) / 2);
    const cz = Math.floor((room.z0 + room.z1) / 2);
    for (const [dx, dz] of [[side, 0], [side + 1, 0], [side, 1], [-side - 1, 0], [0, -1]] as const) {
      const x = cx + dx;
      const z = cz + dz;
      for (let y = room.y0; y <= room.y1; y++) {
        if (dim.getState(x, y, z) !== 0 || !STATE_SOLID[dim.getState(x, y - 1, z)]) continue;
        dim.setBlock(x, y, z, stateOf('chest', { facing: 'north' }));
        dim.setBlockEntity(x, y, z, { type: 'chest', loot, lootSeed: hashInts(this.server.level.seedNum, x, y, z, 0x5ea1) });
        return [x, y, z];
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ THE SILENT CITY

  get host(): SilentHost | null {
    const h = this.flags.silentCity as SilentHost | undefined;
    return h && Array.isArray(h.hall) ? h : null;
  }

  /** The world's Silent City: the Fallen City near the arrival island, else the nearest settlement, else ruins. */
  *chooseHost(): Generator<void, SilentHost | null> {
    const m = this.gen.censusManager();
    if (!m) return null;
    const a = this.gen.terrain.expansion.arrival();
    const fc = yield* m.nearestSteps(GIANT_TYPE, a.x, a.z, 2, (s) => s.type === 'fallen_city' && !!this.questOf(s)?.silent);
    if (fc && Math.hypot(fc.x - a.x, fc.z - a.z) <= QUEST.fallenCityRange) return this.hostOf(fc, this.questOf(fc)!.silent!.hall, this.questOf(fc)!.silent!.spots);
    const st = yield* m.nearestSteps('end_settlement', a.x, a.z, 24, (s) => !!this.questOf(s)?.silent);
    if (st) return this.hostOf(st, this.questOf(st)!.silent!.hall, this.questOf(st)!.silent!.spots);
    const ru = yield* m.nearestSteps('end_ruins', a.x, a.z, 24);
    if (ru) {
      const hall = this.ruinsHall(ru);
      if (hall) return this.hostOf(ru, hall, ru.pieces.map((pc): P3 => [(pc.box.x0 + pc.box.x1) >> 1, ru.y, (pc.box.z0 + pc.box.z1) >> 1]));
    }
    return null;
  }

  /** Beside some End Ruins: a 7x7 patch of level ground clear of the ruins. */
  private ruinsHall(s: Start): P3 | null {
    const ex = this.gen.terrain.expansion;
    for (let d = 14; d <= 30; d += 4)
      for (let i = 0; i < 12; i++) {
        const x = Math.round(s.x + Math.cos((i / 12) * Math.PI * 2) * d);
        const z = Math.round(s.z + Math.sin((i / 12) * Math.PI * 2) * d);
        if (s.pieces.some((pc) => pc.box.x0 - 4 <= x + 3 && pc.box.x1 + 4 >= x - 3 && pc.box.z0 - 4 <= z + 3 && pc.box.z1 + 4 >= z - 3)) continue;
        let lo = Infinity;
        let hi = -Infinity;
        for (let dx = -3; dx <= 3; dx += 3)
          for (let dz = -3; dz <= 3; dz += 3) {
            const t = ex.topColumn(x + dx, z + dz)?.top ?? -1;
            lo = Math.min(lo, t);
            hi = Math.max(hi, t);
          }
        if (lo > 0 && hi - lo <= 1) return [x, hi, z];
      }
    return null;
  }

  private hostOf(s: Start, hall: P3, spots: P3[]): SilentHost {
    const rng = new Random(hashInts(this.server.level.seedNum, s.x, s.z, 0x511e));
    const far = spots.filter((q) => Math.hypot(q[0] - hall[0], q[2] - hall[2]) > 6);
    const pick = rng.shuffle([...far]).slice(0, QUEST.shards);
    // Too few places in the city: round the hall
    for (let i = pick.length; i < QUEST.shards; i++) {
      const ang = (i / QUEST.shards) * Math.PI * 2 + 0.6;
      pick.push([Math.round(hall[0] + Math.cos(ang) * 10), hall[1] + 1, Math.round(hall[2] + Math.sin(ang) * 10)]);
    }
    return { type: s.type, at: [s.x, s.y, s.z], hall, spots: pick, built: [], rel: pick.map(() => null) };
  }

  /** Builds the hall and the reliquaries into the city as its chunks load (each part once). */
  private buildSilent(): void {
    const h = this.host;
    if (!h || h.built.length >= 1 + h.spots.length) return;
    const dim = this.end;
    const [hx, fy, hz] = h.hall;
    if (!h.built.includes('hall') && [-3, 3].every((dx) => [-3, 3].every((dz) => dim.isLoaded(hx + dx, hz + dz)))) {
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++) {
          dim.setBlock(hx + dx, fy, hz + dz, S('ancient_end_bricks'));
          for (let k = 1; k <= 5; k++) {
            const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
            const corner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
            dim.setBlock(hx + dx, fy + k, hz + dz, k === 5 ? S('ancient_end_bricks') : corner ? S('chiseled_ancient_end_bricks') : edge ? S('ancient_ward_stone') : 0);
          }
        }
      h.door = [
        [hx, fy + 1, hz + 3],
        [hx, fy + 2, hz + 3],
      ];
      for (const d of h.door) dim.setBlock(d[0], d[1], d[2], stateOf('ancient_vault_door', { facing: 'south' }));
      dim.setBlock(hx, fy + 4, hz, stateOf('astral_lantern', { hanging: 'true' }));
      dim.setBlock(hx, fy + 1, hz - 2, stateOf('chest', { facing: 'south' }));
      dim.setBlockEntity(hx, fy + 1, hz - 2, { type: 'chest', loot: 'chest/silent_hall', lootSeed: hashInts(this.server.level.seedNum, hx, fy, hz, 0xbe11) });
      h.built.push('hall');
    }
    h.spots.forEach((q, i) => {
      if (h.built.includes(`rel${i}`) || !dim.isLoaded(q[0], q[2])) return;
      h.built.push(`rel${i}`);
      // On a floor near the spot
      for (let dy = -2; dy <= 6; dy++) {
        const y = q[1] + dy;
        if (dim.getState(q[0], y, q[2]) === 0 && STATE_SOLID[dim.getState(q[0], y - 1, q[2])]) {
          dim.setBlock(q[0], y, q[2], stateOf('ancient_reliquary', { open: 'false' }));
          h.rel[i] = [q[0], y, q[2]];
          return;
        }
      }
    });
  }

  private useReliquary(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const h = this.host;
    const i = h?.rel.findIndex((q) => q && same(q, x, y, z)) ?? -1;
    if (i < 0) return false;
    this.follow(p, 'silent');
    const r = this.rec('silent');
    this.flag(r, 'found');
    if (getProp(state, 'open') === 'true' || this.has(r, `rel:${i}`)) {
      this.say(p, 'It is empty.');
      return true;
    }
    if (this.visitor(p)) return false;
    p.dim.setBlock(x, y, z, withProp(state, 'open', 'true'));
    this.flag(r, `rel:${i}`);
    const cheat = this.server.admin.inContext(p);
    this.give(p, stackOf('ancient_key_shard', 1), cheat);
    this.server.playSound(p.dim, 'block.reliquary', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    const n = h!.rel.filter((_, j) => this.has(r, `rel:${j}`)).length;
    this.say(p, `An Ancient Key Shard. (${n}/${QUEST.shards})`);
    return true;
  }

  /** The Silent Bell: every Guardian Construct within 64 blocks stands still for 10 seconds. */
  ringBell(p: ServerPlayer, stack: ItemStack): boolean {
    if (itemIdOf(stack) !== 'silent_bell') return false;
    const s = this.server;
    if ((this.bellReady.get(p.uuid) ?? 0) > s.tickNo) return true;
    this.bellReady.set(p.uuid, s.tickNo + QUEST.bellCooldown);
    p.send({ t: 'cooldown', item: stack.id, ticks: QUEST.bellCooldown });
    s.playSound(p.dim, 'item.silent_bell', p.x, p.y + 1.5, p.z, 2, 1);
    let n = 0;
    for (const e of p.dim.entitiesNear(p.x, p.y, p.z, QUEST.bellRadius)) {
      if (!(e instanceof Mob) || !isConstruct(e.type) || e.dead) continue;
      e.data.silenced = s.tickNo + QUEST.bellTicks;
      n++;
    }
    if (n) this.say(p, 'Everything made by them stands still.');
    return true;
  }

  // ------------------------------------------------------------------ THE CRYSTAL VAULT

  private vaultOf(s: Start): { q: NonNullable<EndQuestSpec['vault']>; door: P3[]; room: Box; key: string } | null {
    const qs = this.questOf(s);
    const seal = qs?.seals?.find((x) => x.kind === 'vault');
    if (!qs?.vault || !seal) return null;
    return { q: qs.vault, door: seal.door, room: seal.room, key: `vault:${k3(qs.vault.pedestals[0]!)}` };
  }

  private vaultAt(x: number, y: number, z: number): ReturnType<EndQuestsSystem['vaultOf']> {
    for (const s of this.startsAt(x, y, z)) {
      const v = this.vaultOf(s);
      if (v && (v.door.some((d) => same(d, x, y, z)) || v.q.pedestals.some((d) => same(d, x, y, z)))) return v;
    }
    return null;
  }

  private useVaultDoor(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const v = this.vaultAt(x, y, z);
    if (!v) return false;
    this.follow(p, v.key);
    const r = this.rec(v.key);
    if (r.stage < 1) r.stage = 1;
    this.placePedestals(p.dim, v.q.pedestals);
    const n = v.q.pedestals.filter((q) => getProp(p.dim.getState(...q), 'crystal') === 'true').length;
    this.say(p, n ? `It is sealed. (${n}/${QUEST.pedestals} crystals placed)` : 'It is sealed. Four empty pedestals face it.');
    this.server.playSound(p.dim, 'block.dormant', x + 0.5, y + 0.5, z + 0.5, 0.6, 1.2);
    return true;
  }

  /** The vault's pedestals stand on the dais (phase 3 palaces had none: they rise when the door is first inspected). */
  private placePedestals(dim: Dimension, ps: P3[]): void {
    for (const q of ps) if (blocks[STATE_BLOCK[dim.getState(...q)]!]!.id !== 'crystal_pedestal') dim.setBlock(q[0], q[1], q[2], S('crystal_pedestal'));
  }

  private usePedestal(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const v = this.vaultAt(x, y, z);
    if (!v) return false;
    const held = this.holding(p, 'end_crystal');
    if (getProp(state, 'crystal') === 'true' || !held || this.visitor(p)) return false;
    this.follow(p, v.key);
    const r = this.rec(v.key);
    r.stage = Math.max(r.stage, 1);
    const t = this.take(p, 'end_crystal', 1)!;
    if (t.cheat) this.flag(r, 'cheat');
    p.dim.setBlock(x, y, z, withProp(state, 'crystal', 'true'));
    this.server.playSound(p.dim, 'block.crystal_place', x + 0.5, y + 1, z + 0.5, 1, 1);
    const n = v.q.pedestals.filter((q) => getProp(p.dim.getState(...q), 'crystal') === 'true').length;
    if (n >= QUEST.pedestals) r.stage = Math.max(r.stage, 2);
    return true;
  }

  /** Vaults near players: four powered crystals light up one by one, then the door opens and the Bulwark wakes. */
  private tickVault(dim: Dimension, s: Start): void {
    const v = this.vaultOf(s);
    if (!v) return;
    const r = this.rec(v.key);
    if (r.stage < 1 || this.has(r, 'open') || !v.q.pedestals.every((q) => dim.isLoaded(q[0], q[2]))) return;
    const eng = this.server.engineering;
    const ready = v.q.pedestals.every((q) => {
      const st = dim.getState(...q);
      const be = dim.getBlockEntity(...q) as { powered?: boolean } | undefined;
      return getProp(st, 'crystal') === 'true' && !!be?.powered;
    });
    const l = this.lighting.get(v.key);
    if (!ready) {
      if (l) {
        // Power lost: they go dark again
        for (const q of v.q.pedestals) {
          const st = dim.getState(...q);
          if (getProp(st, 'lit') === 'true') dim.setBlock(q[0], q[1], q[2], withProp(st, 'lit', 'false'), { keepBlockEntity: true });
        }
        this.lighting.delete(v.key);
      }
      return;
    }
    r.stage = Math.max(r.stage, 2);
    const now = this.server.tickNo;
    if (!l) {
      this.lighting.set(v.key, { n: 0, next: now });
      return;
    }
    if (now < l.next) return;
    if (l.n < v.q.pedestals.length) {
      const q = v.q.pedestals[l.n]!;
      dim.setBlock(q[0], q[1], q[2], withProp(dim.getState(...q), 'lit', 'true'), { keepBlockEntity: true });
      this.server.playSound(dim, 'block.crystal_light', q[0] + 0.5, q[1] + 1, q[2] + 0.5, 1, 0.8 + l.n * 0.15);
      this.server.particles(dim, 'end_rod', q[0] + 0.5, q[1] + 1.2, q[2] + 0.5, 10, 0.3);
      l.n++;
      l.next = now + QUEST.lightEvery;
      return;
    }
    this.lighting.delete(v.key);
    // Was any of the power a cheat's? (A vault the Admin Panel built is a cheat's from the start.)
    if (v.q.pedestals.some((q) => (dim.getBlockEntity(...q) as { cheat?: number } | undefined)?.cheat) || eng?.energy.netAt(dim, ...v.q.pedestals[0]!)?.devices.some((d) => d.be()?.cheat)) this.flag(r, 'cheat');
    this.openVault(dim, v, r, true);
  }

  private openVault(dim: Dimension, v: NonNullable<ReturnType<EndQuestsSystem['vaultOf']>>, r: QuestRecord, bulwark: boolean): void {
    this.flag(r, 'open');
    r.stage = Math.max(r.stage, 3);
    this.openDoor(dim, v.door);
    this.placeChest(dim, v.room, 'chest/end_palace_vault', 2);
    this.placeChest(dim, v.room, 'chest/end_palace_vault', -3);
    const at = v.door[0]!;
    if (bulwark) {
      const [bx, by, bz] = v.q.bulwark;
      const m = this.server.mobs?.spawn(dim, 'guardian_bulwark', bx + 0.5, by, bz + 0.5, { persistent: true, reason: 'structure', data: { home: [bx, by, bz], vault: v.key } });
      if (m) {
        if (this.has(r, 'cheat')) m.admin = true;
        this.server.constructs?.wake(m);
        this.flag(r, 'bulwark');
      } else this.clearVault(dim, v.key, at);
    }
    for (const p of this.present(dim, at)) p.send({ t: 'title', text: '', sub: 'The vault opens. Something inside wakes.', ticks: 70 });
  }

  /** The vault's Bulwark is down: the vault is cleared. */
  private clearVault(dim: Dimension, key: string, at: P3): void {
    const r = this.rec(key);
    if (r.done) return;
    this.flag(r, 'cleared');
    this.finish('crystal_vault', r, dim, at, (p, cheat) => {
      // The first vault each player clears gives them Ender Blink
      if (p.endRewards.has('vault_blink')) return;
      if (!cheat) p.endRewards.add('vault_blink');
      this.give(p, stackOf('ender_blink_module', 1), cheat);
    });
  }

  onMobDeath(m: Mob): void {
    const key = m.data.vault;
    if (typeof key !== 'string' || !key.startsWith('vault:')) return;
    if (m.admin) this.flag(this.rec(key), 'cheat');
    this.clearVault(m.dim, key, [Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)]);
  }

  // ------------------------------------------------------------------ THE DRAGON'S HISTORY

  /** The Nest's ring: its middle, and the cells inside it (the sheet) and on it (the frame). */
  private ring(): { c: P3; sheet: P3[]; frame: P3[] } | null {
    const es = this.server.endStructures;
    const st = es?.nest;
    if (!es || !st || (!st.built && !st.done.length)) return null;
    const c = es.nestPlan().portal;
    const sheet: P3[] = [];
    const frame: P3[] = [];
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < 3.1) sheet.push([c[0] + dx, c[1] + dy, c[2]]);
        else if (d < 4.3) frame.push([c[0] + dx, c[1] + dy, c[2]]);
      }
    return { c, sheet, frame };
  }

  /** How far the Dragon's History has come: 0-3 the steps before the repair (for a viewer, who carries the scale fragments). */
  private dragonStep(r: QuestRecord, viewer: ServerPlayer | null): { step: number; nest: number; more: number; scales: number } {
    const nest = NEST_IDS.filter((id) => this.has(r, `read:${id}`)).length;
    const more = Math.min(QUEST.dragonFragments, DRAGON_IDS.filter((id) => this.has(r, `read:${id}`)).length);
    const scales = viewer ? this.count(viewer, 'dragon_scale_fragment') : 0;
    const step = this.has(r, 'repaired') ? 4 : nest < NEST_IDS.length ? 0 : more < QUEST.dragonFragments ? 1 : scales < QUEST.scales ? 2 : 3;
    return { step, nest, more, scales };
  }

  /** A lore book read (the client opens it and tells us). */
  onRead(p: ServerPlayer, id: string): void {
    if (!LORE_BY_ID.has(id)) return;
    const r = this.rec('dragon');
    if (NEST_IDS.includes(id) || DRAGON_IDS.includes(id)) this.flag(r, `read:${id}`);
    if (NEST_IDS.includes(id) && this.ring()) {
      this.flag(r, 'started');
      this.follow(p, 'dragon');
    }
  }

  private useNestRing(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const ring = this.ring();
    if (!ring || (!ring.sheet.some((q) => same(q, x, y, z)) && !ring.frame.some((q) => same(q, x, y, z)))) return false;
    const r = this.rec('dragon');
    this.flag(r, 'started');
    this.follow(p, 'dragon');
    if (this.has(r, 'repaired')) return true;
    const d = this.dragonStep(r, p);
    if (d.step < 3 || this.visitor(p)) {
      this.say(p, d.step < 2 ? 'The ring is broken. Its story isn\'t known yet.' : `The ring is broken. (${Math.min(d.scales, QUEST.scales)}/${QUEST.scales} Dragon Scale Fragments)`);
      this.server.playSound(p.dim, 'block.dead_portal', x + 0.5, y + 0.5, z + 0.5, 0.6, 0.8);
      return true;
    }
    const t = this.take(p, 'dragon_scale_fragment', QUEST.scales)!;
    if (t.cheat) this.flag(r, 'cheat');
    this.mendRing(p.dim, ring);
    this.say(p, 'The ring wakes. It opens one way.');
    return true;
  }

  private mendRing(dim: Dimension, ring: NonNullable<ReturnType<EndQuestsSystem['ring']>>): void {
    const r = this.rec('dragon');
    this.flag(r, 'repaired');
    r.stage = Math.max(r.stage, 4);
    for (const q of ring.frame) if (dim.getState(...q) === 0) dim.setBlock(q[0], q[1], q[2], S('chiseled_ancient_end_bricks'));
    for (const q of ring.sheet) dim.setBlock(q[0], q[1], q[2], stateOf('ancient_gateway', { axis: 'x' }));
    this.sanctumState(true);
    this.server.playSound(dim, 'block.gateway_open', ring.c[0] + 0.5, ring.c[1], ring.c[2] + 0.5, 1.5, 0.7);
    this.server.particles(dim, 'portal', ring.c[0] + 0.5, ring.c[1], ring.c[2] + 0.5, 60, 2);
  }

  /** The Sanctum's place (chosen, from the seed, when the ring is first mended). */
  private sanctumState(make = false): SanctumState | null {
    const f = this.flags as { dragonSanctum?: SanctumState };
    if (f.dragonSanctum || !make) return f.dragonSanctum ?? null;
    const seed = this.server.level.seedNum;
    const ang = ((hashInts(seed, 0x5a7c) >>> 0) / 4294967296) * Math.PI * 2;
    const rad = (EXPANSION_INNER + EXPANSION_OUTER) / 2 + 600;
    const x = Math.round(Math.cos(ang) * rad);
    const z = Math.round(Math.sin(ang) * rad);
    // Deep in the band, in the open, over whatever is below
    let top = -1;
    const ex = this.gen.terrain.expansion;
    for (let dx = -12; dx <= 12; dx += 4) for (let dz = -12; dz <= 12; dz += 4) top = Math.max(top, ex.topColumn(x + dx, z + dz)?.top ?? -1);
    const y = Math.min(220, Math.max(140, top + 24));
    return (f.dragonSanctum = { at: [x, y, z], built: false });
  }

  private sanctumEntry(at: P3): P3 {
    return [at[0], at[1] + 1, at[2] + 1];
  }

  /** The Sanctum's return portal: a 3x4 sheet just inside its front wall (the -z side). */
  private sanctumReturn(at: P3): P3[] {
    const out: P3[] = [];
    const z = at[2] - (SANCTUM.w >> 1) + 1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = 1; dy <= 4; dy++) out.push([at[0] + dx, at[1] + dy, z]);
    return out;
  }

  /** Builds the Sanctum (once its chunks are loaded). */
  private buildSanctum(dim: Dimension, st: SanctumState): boolean {
    const [cx, y0, cz] = st.at;
    const h = SANCTUM.w >> 1;
    for (const dx of [-h, h]) for (const dz of [-h, h]) if (!dim.isLoaded(cx + dx, cz + dz)) return false;
    const brick = S('ancient_end_bricks');
    const chis = S('chiseled_ancient_end_bricks');
    for (let dx = -h; dx <= h; dx++)
      for (let dz = -h; dz <= h; dz++)
        for (let k = 0; k < SANCTUM.h; k++) {
          const ex = Math.abs(dx) === h;
          const ez = Math.abs(dz) === h;
          const shell = ex || ez || k === 0 || k === SANCTUM.h - 1;
          let s = 0;
          if (shell) {
            s = (ex && ez) || ((ex || ez) && (k === 0 || k === SANCTUM.h - 1)) ? chis : brick;
            if (k === 0 && !ex && !ez) s = S('astral_mosaic');
            if ((ex || ez) && !(ex && ez) && k === 4 && (dx + dz) % 3 === 0) s = S('astral_glass');
          }
          dim.setBlock(cx + dx, y0 + k, cz + dz, s, { updateNeighbors: false });
        }
    // A tapered underside, so it hangs rather than sits
    for (let k = 1; k <= 4; k++) for (let dx = -h + k; dx <= h - k; dx++) for (let dz = -h + k; dz <= h - k; dz++) if (Math.abs(dx) === h - k || Math.abs(dz) === h - k) dim.setBlock(cx + dx, y0 - k, cz + dz, brick, { updateNeighbors: false });
    // The way back: a chiseled frame round a lit sheet
    const ret = this.sanctumReturn(st.at);
    const fz = ret[0]![2];
    for (let dx = -2; dx <= 2; dx++) for (let dy = 1; dy <= 5; dy++) if (Math.abs(dx) === 2 || dy === 5) dim.setBlock(cx + dx, y0 + dy, fz, chis);
    for (const q of ret) dim.setBlock(q[0], q[1], q[2], stateOf('ancient_gateway', { axis: 'x' }));
    // What it keeps: the chest, glyphs on the far wall, old crystal, a lamp
    const back = cz + h - 1;
    dim.setBlock(cx, y0 + 1, back - 1, stateOf('chest', { facing: 'north' }));
    dim.setBlockEntity(cx, y0 + 1, back - 1, { type: 'chest', loot: 'chest/dragon_sanctum', lootSeed: hashInts(this.server.level.seedNum, cx, y0, cz, 0x5a7c) });
    for (let dx = -3; dx <= 3; dx++) for (let dy = 2; dy <= 5; dy++) dim.setBlock(cx + dx, y0 + dy, cz + h, stateOf('ender_glyph_stone', { glyph: String((hashInts(dx, dy, 0x91) >>> 0) % 6) }));
    for (const [dx, dz] of [[-h + 1, -h + 2], [h - 1, -h + 2], [-h + 1, h - 2], [h - 1, h - 2]] as const) dim.setBlock(cx + dx, y0 + 1, cz + dz, S('old_crystal_growth'));
    dim.setBlock(cx, y0 + SANCTUM.h - 2, cz, stateOf('astral_lantern', { hanging: 'true' }));
    st.built = true;
    this.sheets = null;
    return true;
  }

  /** Stepping into the Nest's mended ring (to the Sanctum) or the Sanctum's way back (to the Nest). */
  private dragonExit(p: ServerPlayer, x: number, y: number, z: number): P3 | null {
    const r = this.peek('dragon');
    if (!this.has(r, 'repaired')) return null;
    const st = this.sanctumState(true)!;
    const ring = this.ring();
    if (ring?.sheet.some((q) => same(q, x, y, z))) {
      this.follow(p, 'dragon');
      return this.sanctumEntry(st.at);
    }
    if (st.built && this.sanctumReturn(st.at).some((q) => same(q, x, y, z))) {
      const c = this.server.endStructures!.nestPlan().portal;
      return [c[0], c[1] - 3, c[2] + 2];
    }
    return null;
  }

  private inSanctum(p: ServerPlayer): boolean {
    const st = this.sanctumState();
    if (!st?.built || p.dim.id !== 'end') return false;
    const h = SANCTUM.w >> 1;
    return Math.abs(p.x - st.at[0] - 0.5) <= h && Math.abs(p.z - st.at[2] - 0.5) <= h && p.y >= st.at[1] && p.y <= st.at[1] + SANCTUM.h;
  }

  // ------------------------------------------------------------------ the tracker

  private info(q: EndQuestId, text: string, stage: number): QuestInfo {
    return { title: QUEST_TITLE[q], text, stage, stages: QUEST_STEPS[q], style: 'end' };
  }

  /** What the tracker shows for a quest record key (null: nothing to show). */
  private infoFor(key: string, p: ServerPlayer): QuestInfo | null {
    if (key.startsWith('obs:')) {
      const r = this.peek(key);
      if (r.done) return this.info('lost_observatory', 'The telescope works. It shows something new each day.', 4);
      if (r.stage < 1) return this.info('lost_observatory', 'Find the observatory\'s dormant Ancient Lens.', 0);
      if (r.stage < 2) return this.info('lost_observatory', `Repair the lens: ${QUEST.lensFragments} Ancient Fragments (${Math.min(this.count(p, 'ancient_fragment'), QUEST.lensFragments)}/${QUEST.lensFragments}).`, 1);
      if (r.stage < 3) {
        const be = this.end.getBlockEntity(...P(key.slice(4))) as { charge?: number } | undefined;
        const pc = Math.floor((Math.min(QUEST.lensTicks, Number(be?.charge ?? 0)) / QUEST.lensTicks) * 100);
        return this.info('lost_observatory', `Power the telescope: ${QUEST.lensEU} EU/t into the core at its foot for 30 seconds (${pc}%).`, 2);
      }
      return this.info('lost_observatory', 'Look through the telescope.', 3);
    }
    if (key.startsWith('gate:')) {
      const k = key.slice(5);
      const st = this.gates[k];
      const r = this.peek(key);
      if (!st) return this.info('broken_gateway', 'Inspect the broken portal.', 0);
      if (st.used) return this.info('broken_gateway', 'The gateway is open, both ways.', 5);
      if (st.linked) return this.info('broken_gateway', 'Step through.', 4);
      if (this.has(r, 'nopair')) return this.info('broken_gateway', 'Nothing answers this portal. Try another.', 1);
      if (!st.repaired) {
        // This might be the far end of someone's pair
        if (st.pair && this.gates[st.pair]?.repaired) return this.info('broken_gateway', `Repair the pair: ${QUEST.frameBricks} Ancient End Bricks and an End Crystal.`, 3);
        if (r.stage < 1) return this.info('broken_gateway', 'Inspect the broken portal.', 0);
        return this.info('broken_gateway', `Repair its frame: ${QUEST.frameBricks} Ancient End Bricks (${Math.min(this.count(p, 'ancient_end_bricks'), QUEST.frameBricks)}/${QUEST.frameBricks}) and an End Crystal (${Math.min(this.count(p, 'end_crystal'), 1)}/1).`, 1);
      }
      const other = st.pair ? this.gates[st.pair] : undefined;
      if (!other) return this.info('broken_gateway', 'Follow the map to its pair.', 2);
      const b = portalCells(other.site).base;
      if (Math.hypot(p.x - b[0], p.z - b[2]) > QUEST.pairNear || p.dim.id !== 'end') return this.info('broken_gateway', `Follow the map to its pair (${where(p, b)}).`, 2);
      return this.info('broken_gateway', `Repair the pair: ${QUEST.frameBricks} Ancient End Bricks and an End Crystal.`, 3);
    }
    if (key === 'silent') {
      const h = this.host;
      if (!h) return null;
      const r = this.peek('silent');
      if (r.done) return this.info('silent_city', 'The bell is yours. The city is quieter still.', 4);
      if (!this.has(r, 'found')) return this.info('silent_city', 'Find the city\'s sealed hall.', 0);
      const opened = h.rel.filter((_, j) => this.has(r, `rel:${j}`)).length;
      const key4 = this.count(p, 'ancient_key') > 0;
      if (this.has(r, 'opened')) return this.info('silent_city', 'Recover what is inside the hall.', 3);
      if (key4) return this.info('silent_city', 'Open the sealed hall with the Ancient Key.', 3);
      if (this.count(p, 'ancient_key_shard') >= QUEST.shards) return this.info('silent_city', 'Combine the shards into the Ancient Key.', 2);
      return this.info('silent_city', `Collect the Ancient Key Shards hidden in the city (${Math.max(opened, Math.min(QUEST.shards, this.count(p, 'ancient_key_shard')))}/${QUEST.shards}).`, 1);
    }
    if (key.startsWith('vault:')) {
      const r = this.peek(key);
      if (r.done) return this.info('crystal_vault', 'The vault is cleared.', 4);
      if (this.has(r, 'open')) return this.info('crystal_vault', 'Survive the vault\'s Bulwark.', 3);
      if (r.stage < 1) return this.info('crystal_vault', 'Inspect the vault door.', 0);
      const pd = P(key.slice(6));
      const v = this.vaultAt(...pd);
      const n = v ? v.q.pedestals.filter((q) => getProp(this.end.getState(...q), 'crystal') === 'true').length : 0;
      if (n < QUEST.pedestals) return this.info('crystal_vault', `Place an End Crystal on each pedestal (${n}/${QUEST.pedestals}).`, 1);
      const l = this.lighting.get(key);
      return this.info('crystal_vault', l ? `The crystals light up (${l.n}/${QUEST.pedestals}).` : 'Power the pedestals from a working Crystal Generator.', 2);
    }
    if (key === 'dragon') {
      const r = this.peek('dragon');
      if (r.done) return this.info('dragons_history', 'You have stood in the Sanctum.', 5);
      const d = this.dragonStep(r, p);
      switch (d.step) {
        case 0:
          return this.info('dragons_history', `Read the Nest's fragments (${d.nest}/${NEST_IDS.length}).`, 0);
        case 1:
          return this.info('dragons_history', `Find more fragments about the Dragon (${d.more}/${QUEST.dragonFragments}).`, 1);
        case 2:
          return this.info('dragons_history', `Gather Dragon Scale Fragments (${d.scales}/${QUEST.scales}).`, 2);
        case 3:
          return this.info('dragons_history', 'Repair the Nest\'s broken ring with them.', 3);
        default:
          return this.info('dragons_history', 'Step through the ring.', 4);
      }
    }
    return null;
  }

  /** The quest a player is near (a site they stand in), starting the ones that start by being found. */
  private nearby(p: ServerPlayer): string | null {
    if (this.server.endStructures?.inNest(p) && this.ring()) {
      this.flag(this.rec('dragon'), 'started');
      return 'dragon';
    }
    const h = this.host;
    for (const s of this.startsNear(p)) {
      const q = this.questOf(s)!;
      if (q.lens) {
        const key = `obs:${k3(q.lens.lens)}`;
        if (this.peek(key).stage < 1 && Math.hypot(p.x - q.lens.lens[0], p.y - q.lens.lens[1], p.z - q.lens.lens[2]) <= 6) {
          this.rec(key).stage = 1;
          this.follow(p, key);
        }
        return key;
      }
      if (h && s.x === h.at[0] && s.z === h.at[2]) {
        if (Math.hypot(p.x - h.hall[0], p.z - h.hall[2]) <= 12) {
          this.flag(this.rec('silent'), 'found');
          this.follow(p, 'silent');
        }
        return 'silent';
      }
      const v = this.vaultOf(s);
      if (v) return v.key;
      for (const site of q.portals ?? []) {
        const b = portalCells(site).base;
        if (Math.hypot(p.x - b[0], p.y - b[1], p.z - b[2]) <= 12) return `gate:${portalKey(site)}`;
      }
    }
    return null;
  }

  private hud(p: ServerPlayer, q: QuestInfo | null): void {
    const k = q ? JSON.stringify(q) : '';
    if ((this.shown.get(p) ?? '') === k) return;
    if (k) this.shown.set(p, k);
    else this.shown.delete(p);
    p.send({ t: 'quest', quest: q });
  }

  private tickPlayers(): void {
    const s = this.server;
    for (const p of s.players.values()) {
      if (p.dead || p.dim.id !== 'end') {
        if (this.shown.has(p)) this.hud(p, null);
        continue;
      }
      // Arriving in the Sanctum completes the Dragon's History (for each player on their first visit)
      if (this.inSanctum(p)) {
        const r = this.rec('dragon');
        const st = this.sanctumState()!;
        if (!r.done) this.finish('dragons_history', r, p.dim, this.sanctumEntry(st.at));
        else this.award('dragons_history', r, p);
      }
      // The Silent City: holding the bell after the hall opened recovers it
      const h = this.host;
      if (h && !this.rec('silent').done && this.has(this.rec('silent'), 'opened') && this.count(p, 'silent_bell') > 0 && Math.hypot(p.x - h.hall[0], p.z - h.hall[2]) < 48) this.finish('silent_city', this.rec('silent'), p.dim, h.hall);
      // The vaults near this player
      for (const st of this.startsNear(p)) if (this.vaultOf(st)) this.tickVault(p.dim, st);
      // The tracker: the quest followed, else the one here
      let key = p.endQuest;
      if (key) {
        const done = this.keyDone(key);
        if (done) {
          const since = this.doneSince.get(p) ?? s.tickNo;
          this.doneSince.set(p, since);
          if (s.tickNo - since > 200) {
            p.endQuest = null;
            this.doneSince.delete(p);
            key = null;
          }
        }
      }
      key ??= this.nearby(p);
      if (key && key !== p.endQuest) this.nearby(p);
      this.hud(p, key ? this.infoFor(key, p) : null);
    }
  }

  private keyDone(key: string): boolean {
    if (key.startsWith('gate:')) return !!this.gates[key.slice(5)]?.used;
    return !!this.server.level.quests.end[key]?.done;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    if (!this.on && !this.ring()) return;
    this.runJobs();
    if (s.tickNo % 20 !== 11) return;
    // The Silent City's host is chosen once a player first reaches the band
    if (this.on && !this.host && !this.hostJob && [...s.players.values()].some((p) => p.dim.id === 'end' && inExpansion(p.x, p.z))) {
      this.hostJob = true;
      this.job(this.chooseHost(), (h) => {
        this.hostJob = false;
        if (h && !this.host) this.flags.silentCity = h;
      });
    }
    // The broken portals' census starts in the background once anyone is out in the band
    if (this.on && !this.portals && [...s.players.values()].some((p) => p.dim.id === 'end' && inExpansion(p.x, p.z))) this.startCensus();
    this.buildSilent();
    // Linked gateways whose sheets weren't loaded when they linked
    for (const st of Object.values(this.gates)) if (st.linked && !st.open) st.open = this.openSheet(this.end, st.site);
    this.tickPlayers();
  }

  onLeave(p: ServerPlayer): void {
    this.shown.delete(p);
    this.doneSince.delete(p);
  }

  // ------------------------------------------------------------------ the Admin Panel (advancement-neutral)

  /** The record key of a quest's site nearest a player (searching now), and a place to stand there. */
  nearestSite(p: ServerPlayer, q: EndQuestId): { key: string; at: P3 } | null {
    const m = this.gen.expansionStructures;
    if (q === 'dragons_history') {
      const ring = this.ring();
      if (!ring) return null;
      return { key: 'dragon', at: [ring.c[0], ring.c[1] - 3, ring.c[2] + 2] };
    }
    if (!m) return null;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (q === 'silent_city') {
      if (!this.host) {
        const h = drain(this.chooseHost());
        if (h) this.flags.silentCity = h;
      }
      const h = this.host;
      return h ? { key: 'silent', at: [h.hall[0], h.hall[1] + 1, h.hall[2] + 5] } : null;
    }
    if (q === 'lost_observatory') {
      const a = drain(m.nearestSteps('end_observatory', x, z, 24, (s) => !!this.questOf(s)?.lens));
      const b = drain(m.nearestSteps(GIANT_TYPE, x, z, 4, (s) => s.type === 'void_observatory' && !!this.questOf(s)?.lens));
      const s = [a, b].filter((v): v is Start => !!v).sort((u, v) => Math.hypot(u.x - x, u.z - z) - Math.hypot(v.x - x, v.z - z))[0];
      const l = s && this.questOf(s)!.lens!;
      return l ? { key: `obs:${k3(l.lens)}`, at: [l.core[0] + 2, l.core[1], l.core[2]] } : null;
    }
    if (q === 'crystal_vault') {
      const s = drain(m.nearestSteps('end_palace', x, z, 24, (st) => !!this.vaultOf(st)));
      const v = s && this.vaultOf(s);
      return v ? { key: v.key, at: [v.door[0]![0], v.door[0]![1], v.door[0]![2] - 6] } : null;
    }
    // A broken portal: the nearest ruins (or Fallen City) that has one
    const s = drain(m.nearestSteps('end_ruins', x, z, 24, (st) => !!this.questOf(st)?.portals?.length));
    const site = s && this.questOf(s)!.portals![0]!;
    if (!site) return null;
    const c = portalCells(site);
    return { key: `gate:${portalKey(site)}`, at: [c.base[0] + c.normal[0] * 2, c.base[1], c.base[2] + c.normal[1] * 2] };
  }

  /** Admin: follow (start) a quest at its nearest site. */
  adminStart(p: ServerPlayer, q: EndQuestId): { ok: boolean; text: string } {
    const site = this.nearestSite(p, q);
    if (!site) return { ok: false, text: `No ${QUEST_TITLE[q]} site in this world.` };
    const r = this.rec(site.key);
    r.stage = Math.max(r.stage, q === 'silent_city' || q === 'dragons_history' ? 0 : 1);
    if (q === 'silent_city') this.flag(r, 'found');
    if (q === 'dragons_history') this.flag(r, 'started');
    if (q === 'broken_gateway') this.gateOf(site.key.slice(5), this.siteOfGate(site.key)!);
    this.follow(p, site.key);
    return { ok: true, text: `Started ${QUEST_TITLE[q]} (${site.at.join(', ')}).` };
  }

  private siteOfGate(key: string): PortalSite | null {
    const k = key.slice(5);
    if (this.gates[k]) return this.gates[k]!.site;
    for (const s of this.startsAt(...P(k))) for (const site of this.questOf(s)!.portals ?? []) if (portalKey(site) === k) return site;
    // Not loaded or not near: find it from the plan around it
    const m = this.gen.expansionStructures;
    const b = P(k);
    for (const s of m?.startsFor(b[0] >> 4, b[2] >> 4) ?? []) for (const site of this.questOf(s)?.portals ?? []) if (portalKey(site) === k) return site;
    return null;
  }

  /** Admin: complete the quest the player follows (or its nearest site): no advancements, cheat-made rewards. */
  adminComplete(p: ServerPlayer, q: EndQuestId): { ok: boolean; text: string } {
    const site = p.endQuest && this.questIdOf(p.endQuest) === q ? { key: p.endQuest } : this.nearestSite(p, q);
    if (!site) return { ok: false, text: `No ${QUEST_TITLE[q]} site in this world.` };
    const r = this.rec(site.key);
    this.flag(r, 'cheat');
    const dim = this.end;
    const at: P3 = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
    switch (q) {
      case 'lost_observatory': {
        const lens = P(site.key.slice(4));
        const o = this.obsAt(...lens);
        if (o && dim.isLoaded(lens[0], lens[2])) {
          if (blocks[STATE_BLOCK[dim.getState(...lens)]!]!.id === 'ancient_lens') this.repairLens(dim, o.q);
          const be = dim.getBlockEntity(...lens) as { awake?: boolean; cheat?: number } | undefined;
          if (be) {
            be.awake = true;
            be.cheat = 1;
          }
        }
        this.give(p, stackOf('astral_shard', 2), true);
        this.give(p, stackOf('book', 1, { tag: { lore: 'stars_circle' } }), true);
        break;
      }
      case 'broken_gateway':
        this.forceGate(p, site.key.slice(5));
        this.give(p, stackOf('book', 1, { tag: { lore: 'gateways_stitches' } }), true);
        for (const k of [site.key.slice(5), this.gates[site.key.slice(5)]?.pair]) {
          if (!k) continue;
          const st = this.gates[k];
          if (st) st.used = true;
          const rr = this.rec(`gate:${k}`);
          this.flag(rr, 'cheat');
          rr.done = true;
        }
        break;
      case 'silent_city':
        this.give(p, stackOf('ancient_key', 1), true);
        this.give(p, stackOf('silent_bell', 1), true);
        this.flag(r, 'opened');
        if (this.host?.door) this.openDoor(dim, this.host.door);
        break;
      case 'crystal_vault': {
        const v = this.vaultAt(...P(site.key.slice(6)));
        if (v && !this.has(r, 'open') && v.door.every((d) => dim.isLoaded(d[0], d[2]))) this.openVault(dim, v, r, false);
        this.give(p, stackOf('ender_blink_module', 1), true);
        break;
      }
      case 'dragons_history': {
        const ring = this.ring();
        if (ring && !this.has(r, 'repaired')) this.mendRing(dim, ring);
        this.give(p, stackOf('sanctum_dragon_scale', 1), true);
        this.give(p, stackOf('book', 1, { tag: { lore: 'sanctum_seen' } }), true);
        break;
      }
    }
    r.done = true;
    r.stage = QUEST_STEPS[q];
    // Everyone is marked as rewarded: a cheat completion awards nothing, now or later
    for (const pl of this.present(p.dim, at, 64)) if (!r.rewarded.includes(pl.uuid)) r.rewarded.push(pl.uuid);
    this.follow(p, site.key);
    return { ok: true, text: `Completed ${QUEST_TITLE[q]} (cheat: no advancements; rewards are cheat-made).` };
  }

  private questIdOf(key: string): EndQuestId | null {
    if (key.startsWith('obs:')) return 'lost_observatory';
    if (key.startsWith('gate:')) return 'broken_gateway';
    if (key === 'silent') return 'silent_city';
    if (key.startsWith('vault:')) return 'crystal_vault';
    if (key === 'dragon') return 'dragons_history';
    return null;
  }

  /** Admin: a quest back to the start everywhere (and its blocks, where their chunks are loaded). */
  adminReset(q: EndQuestId): string {
    const end = this.server.level.quests.end;
    const dim = this.end;
    let n = 0;
    for (const key of Object.keys(end)) {
      if (this.questIdOf(key) !== q) continue;
      n++;
      if (q === 'lost_observatory') {
        const lens = P(key.slice(4));
        if (dim.isLoaded(lens[0], lens[2]) && blocks[STATE_BLOCK[dim.getState(...lens)]!]!.id === 'restored_ancient_lens') dim.setBlock(lens[0], lens[1], lens[2], S('ancient_lens'));
      }
      if (q === 'crystal_vault') {
        const v = this.vaultAt(...P(key.slice(6)));
        if (v && v.door.every((d) => dim.isLoaded(d[0], d[2]))) {
          for (const d of v.door) dim.setBlock(d[0], d[1], d[2], stateOf('crystal_vault_door', { facing: 'north' }));
          for (const pd of v.q.pedestals) if (blocks[STATE_BLOCK[dim.getState(...pd)]!]!.id === 'crystal_pedestal') dim.setBlock(pd[0], pd[1], pd[2], S('crystal_pedestal'));
        }
        this.lighting.delete(key);
      }
      delete end[key];
    }
    if (q === 'broken_gateway') {
      for (const st of Object.values(this.gates)) {
        const c = portalCells(st.site);
        if (st.linked && c.sheet.every((s) => dim.isLoaded(s[0], s[2]))) for (const s of c.sheet) dim.setBlock(s[0], s[1], s[2], stateOf('dead_portal', { axis: c.axis }));
      }
      (this.flags as { endGates?: unknown }).endGates = {};
      this.sheets = null;
    }
    if (q === 'silent_city') {
      const h = this.host;
      if (h) {
        if (h.door && h.door.every((d) => dim.isLoaded(d[0], d[2]))) for (const d of h.door) dim.setBlock(d[0], d[1], d[2], stateOf('ancient_vault_door', { facing: 'south' }));
        for (const q2 of h.rel) if (q2 && dim.isLoaded(q2[0], q2[2])) dim.setBlock(q2[0], q2[1], q2[2], stateOf('ancient_reliquary', { open: 'false' }));
      }
    }
    if (q === 'dragons_history') {
      const ring = this.ring();
      if (ring && ring.sheet.every((s) => dim.isLoaded(s[0], s[2]))) for (const s of ring.sheet) if (blocks[STATE_BLOCK[dim.getState(...s)]!]!.id === 'ancient_gateway') dim.setBlock(s[0], s[1], s[2], stateOf('dead_portal', { axis: 'x' }));
    }
    const rw = end.rewards;
    if (rw?.flags) rw.flags = rw.flags.filter((f) => f !== q);
    for (const p of this.server.players.values()) if (p.endQuest && this.questIdOf(p.endQuest) === q) p.endQuest = null;
    return `Reset ${QUEST_TITLE[q]} (${n} site${n === 1 ? '' : 's'}).`;
  }

  /** The block a player looks at (within 16 blocks), sheets of portals included. */
  lookedAt(p: ServerPlayer): P3 | null {
    const [ex, ey, ez] = this.server.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const hit = raycastBlocks(p.dim, ex, ey, ez, d[0], d[1], d[2], 16);
    return hit ? [hit.x, hit.y, hit.z] : null;
  }

  /** Admin: mends a broken portal and its pair and links them (cheat). The far end opens when its chunk loads. */
  forceGate(p: ServerPlayer, key?: string): { ok: boolean; text: string } {
    let site: PortalSite | null = null;
    if (key) site = this.siteOfGate(`gate:${key}`);
    else {
      const hit = this.lookedAt(p);
      const pt = hit ? this.portalAt(hit[0], hit[1], hit[2]) : null;
      if (pt) {
        key = pt.key;
        site = pt.site;
      }
    }
    if (!key || !site) return { ok: false, text: 'Look at a broken portal.' };
    const pair = this.pairOf(key, site);
    if (!pair) return { ok: false, text: 'That portal has no pair.' };
    const dim = this.end;
    for (const k of [key, pair]) {
      const st = this.gates[k]!;
      if (dim.isLoaded(portalCells(st.site).base[0], portalCells(st.site).base[2])) this.mendFrame(dim, st.site);
      st.repaired = true;
      this.flag(this.rec(`gate:${k}`), 'cheat');
    }
    this.link(key, pair, dim, portalCells(site).base);
    const b = portalCells(this.gates[pair]!.site).base;
    return { ok: true, text: `Linked the gateway with its pair at ${b.join(', ')}.` };
  }

  /** Admin: the Nest's ring mended (cheat), so the Sanctum opens. */
  openSanctum(): { ok: boolean; text: string } {
    const ring = this.ring();
    if (!ring) return { ok: false, text: 'The Dragon\'s Nest hasn\'t been carved in this world yet.' };
    const r = this.rec('dragon');
    this.flag(r, 'cheat');
    if (!this.has(r, 'repaired')) this.mendRing(this.end, ring);
    const st = this.sanctumState(true)!;
    return { ok: true, text: `The Nest's ring is open; the Sanctum is at ${st.at.join(', ')}.` };
  }

  status(): Record<string, unknown> {
    const end = this.server.level.quests.end;
    const h = this.host;
    return {
      on: this.on,
      records: Object.keys(end).length,
      done: Object.entries(end)
        .filter(([, r]) => r.done)
        .map(([k]) => k),
      silentCity: h ? { type: h.type, hall: h.hall, built: h.built.length } : null,
      gates: Object.values(this.gates).filter((g) => g.linked).length,
      sanctum: this.sanctumState(),
      jobs: this.jobs.length + (this.censusRunning ? 1 : 0),
    };
  }
}
