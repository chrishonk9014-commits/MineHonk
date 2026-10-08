/**
 * V6 - The End Expansion, phase 5: the Void Citadel on the server.
 *
 * - Its site: once per world, the first of the seed's candidates
 *   (src/common/endExpansion/citadel.ts) in the Void Wastes whose footprint
 *   holds no other structure and no chunk that was ever saved (so in an old
 *   world it never lands on terrain or builds anyone has touched). Recorded
 *   in `level.flags.citadel`, then handed to the End generator.
 * - Its floors: each floor's objective is checked here (combat halls
 *   cleared, glyph locks pressed in order, crystal sequences repeated, the
 *   parkour crossed, the engineering socket's rule followed); then its sealed
 *   descent door opens, for everyone, for good (`level.flags.citadel.floors`).
 *   Inputs from any player count; Constructs grow tougher with company.
 * - Citadel Anchors set where you come back; falling into the void still
 *   kills you.
 * - Finding it: three Citadel Star Chart Pieces (each giant structure's vault
 *   holds one the first time it is looted, and the Sanctum one) make the Void
 *   Citadel Map; the Lost Observatory's telescope marks it during an eclipse;
 *   and an eclipse shows its beam.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Mob, isAlive } from '../entity/Mob';
import { S, getProp, withProp, blocks, STATE_BLOCK, stateOf } from '../../common/registry/blocks';
import { stackOf, itemIdOf, isAdminStack, type ItemStack } from '../../common/game/itemstack';
import { EXPANSION_BIOMES } from '../../common/endExpansion/biomes';
import { inExpansion } from '../../common/endExpansion/region';
import { GIANT_IDS } from '../../common/endExpansion/structures';
import { CITADEL, FLOOR_NAMES, citadelCandidates, citadelChunks, citadelFloorAt, inCitadel, planCitadel, type CitadelPlan, type FloorSpec } from '../../common/endExpansion/citadel';
import type { EndGenerator } from '../../common/gen/end';
import { chunkIndex } from '../../common/world/constants';
import { isSurvivalLike } from '../../common/game/gamemode';

type P3 = [number, number, number];

/** What `level.flags.citadel` holds. */
export interface CitadelState {
  site: [number, number] | null;
  floors: { done: boolean; cheat?: boolean }[];
  /** Combat floors: how many Void Stalkers the rifts have let out. */
  stalkers: number[];
  /** Giant structures (type@x,z) whose vault has given its Star Chart Piece. */
  charts: string[];
}

/** The giant structures' vaults (the first looting of each holds a Star Chart Piece). */
export const GIANT_VAULTS: Record<string, string> = {
  end_colossus: 'chest/end_colossus_cache',
  crystal_cathedral: 'chest/crystal_cathedral',
  void_observatory: 'chest/void_observatory',
  end_fortress: 'chest/end_fortress_armory',
  fallen_city: 'chest/fallen_city',
};

interface Live {
  /** Glyph Lock: how far through the sequence. */
  glyph: number;
  /** Crystal Sequence: showing the pattern until `showUntil`; then the players' turn (`step`). */
  showUntil: number;
  step: number;
  /** Engineering: a check in progress (combination index, when each is read). */
  verify: { i: number; at: number; by: ServerPlayer; saved: number[] } | null;
  /** Combat: when the next stalker may come out of a rift. */
  riftAt: number;
}

const WARN_RIFT = 0x9a6aff;

export class EndCitadelSystem {
  plan: CitadelPlan | null = null;
  /** Resolves once the site is known (picking it may read storage). */
  readonly ready: Promise<void>;
  private readonly live = new Map<number, Live>();
  private nextFx = 9_500_000;

  constructor(readonly server: GameServer) {
    this.ready = this.init();
  }

  private get end(): Dimension {
    return this.server.dim('end');
  }

  private get gen(): EndGenerator {
    return this.end.generator as EndGenerator;
  }

  get state(): CitadelState {
    const f = this.server.level.flags as { citadel?: CitadelState };
    const c = f.citadel;
    if (!c || typeof c !== 'object') f.citadel = { site: null, floors: [], stalkers: [], charts: [] };
    const st = f.citadel!;
    if (!Array.isArray(st.floors)) st.floors = [];
    while (st.floors.length < CITADEL.floors) st.floors.push({ done: false });
    if (!Array.isArray(st.stalkers)) st.stalkers = [];
    if (!Array.isArray(st.charts)) st.charts = [];
    return st;
  }

  // ------------------------------------------------------------------ the site

  private async init(): Promise<void> {
    // Worlds made before V6 have no Expanded End (their End stays the classic one): no Citadel
    if (!this.gen.terrain.expanded) return;
    const st = this.state;
    let site = st.site;
    if (!site) site = await this.pickSite();
    if (!site) return;
    st.site = site;
    this.plan = planCitadel(this.server.level.seedNum, { x: site[0], z: site[1] });
    this.gen.citadel = this.plan;
  }

  /** The first candidate in the Void Wastes with no other structure and no saved (or loaded) chunk in its footprint. */
  private async pickSite(): Promise<[number, number] | null> {
    const seed = this.server.level.seedNum;
    const ex = this.gen.terrain.expansion;
    const census = this.gen.censusManager();
    const dim = this.end;
    for (const c of citadelCandidates(seed)) {
      if (!inExpansion(c.x, c.z)) continue;
      if (EXPANSION_BIOMES[ex.regionAt(c.x, c.z).biome]?.id !== 'void_wastes') continue;
      const chunks = citadelChunks(c);
      // No other structure in the way
      if (census) {
        const b = { x0: c.x - 40, z0: c.z - 40, x1: c.x + 40, z1: c.z + 40 };
        let clash = false;
        for (const [cx, cz] of chunks) {
          for (const s of census.startsFor(cx, cz)) if (s.bounds.x1 >= b.x0 && s.bounds.x0 <= b.x1 && s.bounds.z1 >= b.z0 && s.bounds.z0 <= b.z1) clash = true;
          if (clash) break;
        }
        if (clash) continue;
      }
      // Never into a chunk that exists already (an old world's terrain or builds)
      let used = false;
      for (const [cx, cz] of chunks) {
        if (dim.chunks.has(chunkIndex(cx, cz)) || (await this.server.storage.readChunk('end', cx, cz))) {
          used = true;
          break;
        }
      }
      if (used) continue;
      return [c.x, c.z];
    }
    return null;
  }

  /** Whether the Citadel takes up a position (events keep their temporary blocks out). */
  covers(x: number, y: number, z: number): boolean {
    return !!this.plan && inCitadel(this.plan, x, y, z);
  }

  private floorOf(k: number): FloorSpec | null {
    return this.plan?.floors[k] ?? null;
  }

  private liveOf(k: number): Live {
    let l = this.live.get(k);
    if (!l) {
      l = { glyph: 0, showUntil: 0, step: 0, verify: null, riftAt: 0 };
      this.live.set(k, l);
    }
    return l;
  }

  /** Players on a floor (index; CITADEL.floors for the arena). */
  playersOn(k: number): ServerPlayer[] {
    const plan = this.plan;
    if (!plan) return [];
    return [...this.server.players.values()].filter((p) => !p.dead && p.dim.id === 'end' && p.gamemode !== 'spectator' && citadelFloorAt(plan, p.x, p.y, p.z) === k);
  }

  private say(players: ServerPlayer[], text: string): void {
    for (const p of players) p.send({ t: 'chat', text, kind: 'system' });
  }

  private cheatFor(players: ServerPlayer[]): boolean {
    return players.length > 0 && players.every((p) => this.server.admin.inContext(p));
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const plan = this.plan;
    if (!plan) return;
    const now = this.server.tickNo;
    const anyNear = [...this.server.players.values()].some((p) => p.dim.id === 'end' && Math.abs(p.x - plan.x) < 160 && Math.abs(p.z - plan.z) < 160);
    if (now % 20 === 0) this.markMaps();
    if (now % 20 === 10) this.ambience(plan);
    if (!anyNear) return;
    if (now % 10 === 0) this.discover();
    const st = this.state;
    for (const f of plan.floors) {
      const done = st.floors[f.index]!.done;
      // Doors of finished floors stay open (a chunk saved before, a restart)
      if (done && now % 40 === 0) this.openDoor(f, false);
      if (f.kind === 'parkour') this.parkourTick(f);
      if (done) continue;
      const on = this.playersOn(f.index);
      if (f.kind === 'combat' && on.length) this.combatTick(f, on);
      if (f.kind === 'crystal') this.crystalTick(f);
      if (f.kind === 'engineering') this.verifyTick(f);
      if (on.length && now % 20 === 0) this.scaleConstructs(f, on.length);
    }
  }

  private readonly beds = new Map<ServerPlayer, string | null>();

  /** Each player's sound bed in the Citadel: the halls, each kind of floor, the arena (the Guardian's phase while it fights). */
  private ambience(plan: CitadelPlan): void {
    for (const p of this.server.players.values()) {
      let bed: string | null = null;
      if (!p.dead && p.dim.id === 'end' && inCitadel(plan, p.x, p.y, p.z)) {
        const k = citadelFloorAt(plan, p.x, p.y, p.z);
        const g = this.server.guardian?.fight;
        if (k === CITADEL.floors) bed = g ? `bed.guardian_${g.phase}` : 'bed.citadel_arena';
        else if (k >= 0) bed = this.state.floors[k]!.done ? 'bed.ancient' : `bed.citadel_${plan.floors[k]!.kind}`;
        else bed = 'bed.ancient';
      }
      if ((this.beds.get(p) ?? null) === bed) continue;
      this.beds.set(p, bed);
      p.send({ t: 'ambience', bed });
    }
    for (const p of this.beds.keys()) if (!this.server.players.has(p.conn.id)) this.beds.delete(p);
  }

  /** A one-time title for each player who finds it, and the advancement. */
  private discover(): void {
    const plan = this.plan!;
    for (const p of this.server.players.values()) {
      if (p.dead || p.dim.id !== 'end' || !inCitadel(plan, p.x, p.y, p.z)) continue;
      if (!p.endTitles.has('void_citadel')) {
        p.endTitles.add('void_citadel');
        p.send({ t: 'title', text: 'THE VOID CITADEL', ticks: 100 });
        p.send({ t: 'sound', name: 'music.citadel', x: p.x, y: p.y, z: p.z, volume: 1, pitch: 1 });
      }
      if (this.server.admin.inContext(p)) continue;
      this.server.interaction.grant(p, 'find_void_citadel');
      if (citadelFloorAt(plan, p.x, p.y, p.z) === CITADEL.floors) this.server.interaction.grant(p, 'reach_guardian_arena');
    }
  }

  /** A floor's objective is done: its door opens for everyone, for good. */
  complete(f: FloorSpec, cheat: boolean): void {
    const st = this.state;
    const rec = st.floors[f.index]!;
    if (rec.done) return;
    rec.done = true;
    if (cheat) rec.cheat = true;
    this.openDoor(f, true);
    const on = this.playersOn(f.index);
    for (const p of on) {
      p.send({ t: 'title', text: '', sub: 'The way down opens', ticks: 60 });
      if (!cheat && !this.server.admin.inContext(p)) this.server.interaction.grant(p, `clear_citadel_${f.kind}`);
    }
  }

  private openDoor(f: FloorSpec, loud: boolean): void {
    const dim = this.end;
    const door = S('citadel_door');
    let opened = false;
    for (const [x, y, z] of f.door) {
      if (!dim.isLoaded(x, z) || dim.getState(x, y, z) !== door) continue;
      dim.setBlock(x, y, z, 0);
      opened = true;
    }
    if (opened && loud) {
      const [x, y, z] = f.door[4] ?? f.door[0]!;
      this.server.particles(dim, 'portal', x + 0.5, y + 0.5, z + 0.5, 60, 1.2);
      this.server.playSound(dim, 'citadel.door', x + 0.5, y + 0.5, z + 0.5, 2, 1);
    }
  }

  /** Constructs on a floor: tougher with more players there. */
  private scaleConstructs(f: FloorSpec, n: number): void {
    const dim = this.end;
    for (const e of dim.entitiesNear((f.room.x0 + f.room.x1) / 2, f.y + 4, (f.room.z0 + f.room.z1) / 2, 30)) {
      if (!(e instanceof Mob) || e.dead || e.data.citadelFloor !== f.index) continue;
      if (e.data.scaledFor === n) continue;
      const base = Number(e.data.baseHealth ?? e.maxHealth);
      e.data.baseHealth = base;
      const share = e.health / e.maxHealth;
      e.maxHealth = Math.round(base * (1 + 0.5 * (n - 1)));
      e.health = Math.max(1, e.maxHealth * share);
      e.data.scaledFor = n;
      e.metaDirty = true;
    }
  }

  // ------------------------------------------------------------------ combat

  private combatTick(f: FloorSpec, on: ServerPlayer[]): void {
    const dim = this.end;
    const st = this.state;
    const l = this.liveOf(f.index);
    const now = this.server.tickNo;
    const spawned = st.stalkers[f.index] ?? 0;
    const quota = f.stalkers ?? 0;
    const foes = dim.entitiesNear((f.room.x0 + f.room.x1) / 2, f.y + 4, (f.room.z0 + f.room.z1) / 2, 30).filter((e) => e instanceof Mob && !e.dead && !e.removed && e.data.citadelFloor === f.index && e.y >= f.y - 2 && e.y <= f.y + 13) as Mob[];
    const stalkers = foes.filter((m) => m.type === 'void_stalker').length;
    // The rifts let out their Void Stalkers, two at a time, each shown before it climbs out
    if (spawned < quota && stalkers < 2 && now >= l.riftAt && f.rifts?.length) {
      const [rx, ry, rz] = f.rifts[spawned % f.rifts.length]!;
      const tele = on.length > 1 ? 32 : 24;
      l.riftAt = now + tele + 100;
      st.stalkers[f.index] = spawned + 1;
      for (const p of on) p.send({ t: 'fx', kind: 'warn_circle', id: this.nextFx++, x: rx + 0.5, y: ry + 1.05, z: rz + 0.5, r: 1.2, ticks: tele, color: WARN_RIFT });
      this.server.playSound(dim, 'mob.void_stalker.rise', rx + 0.5, ry + 1, rz + 0.5, 1.4, 1);
      const cheat = this.cheatFor(on);
      setTimeoutTicks(this.server, tele, () => {
        const m = this.server.mobs?.spawn(dim, 'void_stalker', rx + 0.5, ry + 1, rz + 0.5, { persistent: true, reason: 'structure' });
        if (!m) return;
        m.data.citadelFloor = f.index;
        if (cheat) m.admin = true;
        this.server.particles(dim, 'void_burst', rx + 0.5, ry + 1.5, rz + 0.5, 20, 0.5);
      });
      return;
    }
    if (spawned >= quota && foes.length === 0 && now >= l.riftAt) this.complete(f, this.cheatFor(on));
  }

  // ------------------------------------------------------------------ blocks used

  /** Right-clicks on the Citadel's blocks (true when handled). */
  useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const plan = this.plan;
    if (!plan || p.dim.id !== 'end') return false;
    const id = blocks[STATE_BLOCK[state]!]!.id;
    switch (id) {
      case 'citadel_anchor':
        return this.useAnchor(p, x, y, z);
      case 'citadel_glyph_key':
        return this.pressKey(p, x, y, z, state);
      case 'citadel_beacon':
        return this.startSequence(p, x, y, z);
      case 'citadel_pedestal':
        return this.pressPedestal(p, x, y, z);
      case 'citadel_socket':
        return this.useSocket(p, x, y, z);
      case 'citadel_door':
        p.send({ t: 'chat', text: 'Sealed. It opens when this floor is done.', kind: 'system' });
        return true;
      case 'guardian_altar':
        return this.server.guardian?.useAltar(p, x, y, z) ?? false;
      default:
        return false;
    }
  }

  private useAnchor(p: ServerPlayer, x: number, y: number, z: number): boolean {
    p.spawnPoint = { dim: 'end', x: x + 0.5, y: y + 1, z: z + 0.5, forced: false, block: [x, y, z] };
    p.send({ t: 'chat', text: 'Respawn point set at this Citadel Anchor.', kind: 'system' });
    this.server.playSound(p.dim, 'respawn_anchor.set', x + 0.5, y + 1, z + 0.5, 1, 1.2);
    this.server.particles(p.dim, 'portal', x + 0.5, y + 1.2, z + 0.5, 24, 0.5);
    return true;
  }

  private floorAtBlock(x: number, y: number, z: number): FloorSpec | null {
    const plan = this.plan!;
    const k = citadelFloorAt(plan, x, y, z);
    return k >= 0 && k < CITADEL.floors ? plan.floors[k]! : null;
  }

  private pressKey(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const f = this.floorAtBlock(x, y, z);
    if (!f || f.kind !== 'glyph' || !f.sequence || !f.keys) return true;
    if (this.state.floors[f.index]!.done) return true;
    const dim = p.dim;
    const l = this.liveOf(f.index);
    const glyph = Number(getProp(state, 'glyph') ?? -1);
    if (getProp(state, 'lit') === 'true') return true;
    if (glyph === f.sequence[l.glyph]) {
      dim.setBlock(x, y, z, withProp(state, 'lit', true));
      l.glyph++;
      this.server.playSound(dim, 'citadel.glyph', x + 0.5, y + 0.5, z + 0.5, 1, 0.8 + l.glyph * 0.1);
      if (l.glyph >= f.sequence.length) {
        l.glyph = 0;
        this.complete(f, this.server.admin.inContext(p));
      }
      return true;
    }
    // Wrong: the keys go dark and a Sentinel wakes
    l.glyph = 0;
    for (const k of f.keys) {
      const s = dim.getState(...k.at);
      if (getProp(s, 'lit') === 'true') dim.setBlock(k.at[0], k.at[1], k.at[2], withProp(s, 'lit', false));
    }
    this.server.playSound(dim, 'citadel.wrong', x + 0.5, y + 0.5, z + 0.5, 1, 0.7);
    const awake = dim.entitiesNear(f.sentinelAt![0], f.sentinelAt![1], f.sentinelAt![2], 24).filter((e) => e instanceof Mob && !e.dead && e.type === 'guardian_sentinel' && e.data.citadelFloor === f.index).length;
    if (awake < 2) {
      const [sx, sy, sz] = f.sentinelAt!;
      const m = this.server.mobs?.spawn(dim, 'guardian_sentinel', sx + 0.5, sy, sz + 0.5, { persistent: true, reason: 'structure', data: { citadelFloor: f.index, home: [sx, sy, sz] } });
      if (m) {
        if (this.server.admin.inContext(p)) m.admin = true;
        this.server.particles(dim, 'portal', sx + 0.5, sy + 1.2, sz + 0.5, 30, 0.6);
      }
    }
    p.send({ t: 'chat', text: 'The keys go dark. Something stirs.', kind: 'system' });
    return true;
  }

  // ------------------------------------------------------------------ crystal sequence

  private startSequence(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const f = this.floorAtBlock(x, y, z);
    if (!f || f.kind !== 'crystal' || this.state.floors[f.index]!.done) return true;
    const l = this.liveOf(f.index);
    const now = this.server.tickNo;
    if (l.showUntil > now) return true;
    l.step = 0;
    l.showUntil = now + f.pattern!.length * 20 + 10;
    this.server.playSound(p.dim, 'citadel.sequence', x + 0.5, y + 1, z + 0.5, 1.2, 1);
    return true;
  }

  private crystalTick(f: FloorSpec): void {
    const l = this.live.get(f.index);
    if (!l || l.showUntil <= 0) return;
    const now = this.server.tickNo;
    const dim = this.end;
    const t = now - (l.showUntil - f.pattern!.length * 20 - 10);
    if (now < l.showUntil) {
      // Each step: lit 14 ticks, dark 6 (whichever tick the show is first seen on)
      const i = Math.floor(Math.max(0, t) / 20);
      const ph = Math.max(0, t) % 20;
      if (i < f.pattern!.length) {
        const at = f.pedestals![f.pattern![i]!]!;
        const lit = dim.isLoaded(at[0], at[2]) && getProp(dim.getState(...at), 'lit') === 'true';
        if (ph < 14 && !lit) {
          this.setLit(dim, at, true);
          this.server.playSound(dim, 'citadel.crystal', at[0] + 0.5, at[1] + 1, at[2] + 0.5, 1, 0.7 + f.pattern![i]! * 0.12);
        } else if (ph >= 14 && lit) this.setLit(dim, at, false);
      }
    }
    // Brief flashes of pressed pedestals go out
    for (const at of f.pedestals!) {
      const s = dim.isLoaded(at[0], at[2]) ? dim.getState(...at) : 0;
      const until = this.flashes.get(`${at}`);
      if (until !== undefined && now >= until && getProp(s, 'lit') === 'true') {
        this.setLit(dim, at, false);
        this.flashes.delete(`${at}`);
      }
    }
  }

  private readonly flashes = new Map<string, number>();

  private setLit(dim: Dimension, at: P3, on: boolean): void {
    if (!dim.isLoaded(at[0], at[2])) return;
    const s = dim.getState(...at);
    if (blocks[STATE_BLOCK[s]!]!.id !== 'citadel_pedestal') return;
    dim.setBlock(at[0], at[1], at[2], withProp(s, 'lit', on));
  }

  private pressPedestal(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const f = this.floorAtBlock(x, y, z);
    if (!f || f.kind !== 'crystal' || this.state.floors[f.index]!.done) return true;
    const l = this.liveOf(f.index);
    const now = this.server.tickNo;
    if (l.showUntil > now) return true;
    if (l.showUntil === 0) {
      p.send({ t: 'chat', text: 'Touch the Sequence Stone first, and watch.', kind: 'system' });
      return true;
    }
    const idx = f.pedestals!.findIndex((a) => a[0] === x && a[1] === y && a[2] === z);
    const dim = p.dim;
    if (idx === f.pattern![l.step]) {
      this.setLit(dim, [x, y, z], true);
      this.flashes.set(`${[x, y, z]}`, now + 8);
      this.server.playSound(dim, 'citadel.crystal', x + 0.5, y + 1, z + 0.5, 1, 0.7 + idx * 0.12);
      l.step++;
      if (l.step >= f.pattern!.length) {
        l.step = 0;
        l.showUntil = 0;
        this.complete(f, this.server.admin.inContext(p));
      }
      return true;
    }
    l.step = 0;
    l.showUntil = 0;
    this.server.playSound(dim, 'citadel.wrong', x + 0.5, y + 1, z + 0.5, 1, 0.7);
    p.send({ t: 'chat', text: 'The crystals dim. Touch the Sequence Stone to watch again.', kind: 'system' });
    return true;
  }

  // ------------------------------------------------------------------ engineering

  private useSocket(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const f = this.floorAtBlock(x, y, z);
    if (!f || f.kind !== 'engineering' || this.state.floors[f.index]!.done) return true;
    const l = this.liveOf(f.index);
    if (l.verify) return true;
    const node = this.server.engineering?.node(p.dim, x, y, z);
    const be = node?.be();
    if (!be?.powered) {
      p.send({ t: 'chat', text: 'The socket is dark: it needs the core\'s power (bridge the broken conduits).', kind: 'system' });
      return true;
    }
    // Check every combination of the three levers, one after another
    const saved = f.levers!.map((at) => p.dim.getState(...at));
    l.verify = { i: 0, at: this.server.tickNo + 16, by: p, saved };
    this.setLevers(f, 0);
    p.send({ t: 'chat', text: 'The socket tests your circuit...', kind: 'system' });
    this.server.playSound(p.dim, 'citadel.sequence', x + 0.5, y + 1, z + 0.5, 1, 0.8);
    return true;
  }

  private setLevers(f: FloorSpec, combo: number): void {
    const dim = this.end;
    f.levers!.forEach((at, i) => {
      const s = dim.getState(...at);
      const on = !!(combo & (1 << i));
      if (getProp(s, 'powered') !== String(on)) dim.setBlock(at[0], at[1], at[2], withProp(s, 'powered', on));
    });
  }

  private verifyTick(f: FloorSpec): void {
    const l = this.live.get(f.index);
    const v = l?.verify;
    if (!v || this.server.tickNo < v.at) return;
    const dim = this.end;
    const [sx, sy, sz] = f.socket!;
    const signal = !!this.server.power?.powered(dim, sx, sy, sz);
    const powered = !!this.server.engineering?.node(dim, sx, sy, sz)?.be()?.powered;
    const want = f.rule!.table[v.i]!;
    const restore = (): void => {
      f.levers!.forEach((at, i) => dim.setBlock(at[0], at[1], at[2], v.saved[i]!));
      l!.verify = null;
    };
    if (!powered || signal !== want) {
      const names = ['A', 'B', 'C'].map((n, i) => `${n} ${v.i & (1 << i) ? 'on' : 'off'}`).join(', ');
      v.by.send({ t: 'chat', text: `The socket rejects it: with ${names} the door wants ${want ? 'a signal' : 'no signal'}${powered ? '' : ' (and power)'}.`, kind: 'system' });
      this.server.playSound(dim, 'citadel.wrong', sx + 0.5, sy + 1, sz + 0.5, 1, 0.7);
      restore();
      return;
    }
    v.i++;
    if (v.i >= 8) {
      restore();
      this.complete(f, this.server.admin.inContext(v.by));
      return;
    }
    this.setLevers(f, v.i);
    v.at = this.server.tickNo + 16;
  }

  // ------------------------------------------------------------------ parkour

  /** The pulsing bridges and the moving platforms (while anyone is near), and the crossing. */
  private parkourTick(f: FloorSpec): void {
    const plan = this.plan!;
    const dim = this.end;
    const now = this.server.tickNo;
    const near = [...this.server.players.values()].filter((p) => !p.dead && p.dim === dim && Math.abs(p.y - f.y) < 24 && Math.abs(p.x - plan.x) < 40 && Math.abs(p.z - plan.z) < 40);
    if (!near.length) return;
    // Bridges: on 120 ticks, flickering 30 (fading through 1-3), gone 50
    for (const b of f.bridges ?? []) {
      const t = (now + b.phase) % 200;
      const want = t < 120 ? 0 : t < 150 ? 1 + Math.floor((t - 120) / 10) : -1;
      for (const [x, y, z] of b.cells) {
        if (!dim.isLoaded(x, z)) continue;
        const s = dim.getState(x, y, z);
        const cur = s === 0 ? -1 : blocks[STATE_BLOCK[s]!]!.id === 'ender_light' ? Number(getProp(s, 'fade') ?? 0) : -2;
        if (cur === -2 || cur === want) continue;
        dim.setBlock(x, y, z, want < 0 ? 0 : stateOf('ender_light', { fade: String(want) }), { updateNeighbors: false });
      }
    }
    // Movers: one block every 10 ticks, there and back, carrying whoever stands on them
    for (const mv of f.movers ?? []) {
      if (now % 10 !== 0) continue;
      const period = mv.length * 2;
      const step = Math.floor(now / 10 + mv.phase) % period;
      const off = step < mv.length ? step : period - step;
      const prevStep = (step - 1 + period) % period;
      const prevOff = prevStep < mv.length ? prevStep : period - prevStep;
      if (off === prevOff) continue;
      const d = (off - prevOff) * mv.dir;
      const tiles = S('citadel_tiles');
      const at = (c: P3, o: number): P3 => (mv.axis === 'x' ? [c[0] + o * mv.dir, c[1], c[2]] : [c[0], c[1], c[2] + o * mv.dir]);
      const old = mv.cells.map((c) => at(c, prevOff));
      const nu = mv.cells.map((c) => at(c, off));
      if (![...old, ...nu].every(([x, , z]) => dim.isLoaded(x, z))) continue;
      const riders = near.filter((p) => old.some(([x, y, z]) => Math.floor(p.x) === x && Math.floor(p.z) === z && p.y >= y + 0.9 && p.y <= y + 1.6));
      for (const [x, y, z] of old) if (!nu.some((n) => n[0] === x && n[2] === z)) dim.setBlock(x, y, z, 0);
      for (const [x, y, z] of nu) dim.setBlock(x, y, z, tiles);
      for (const p of riders) this.server.teleport(p, p.x + (mv.axis === 'x' ? d : 0), p.y, p.z + (mv.axis === 'z' ? d : 0), undefined, undefined, true);
    }
    // Across: anyone who reaches the far landing opens the way down
    if (!this.state.floors[f.index]!.done && f.finish) {
      const b = f.finish;
      for (const p of near) if (p.x >= b.x0 && p.x <= b.x1 + 1 && p.z >= b.z0 && p.z <= b.z1 + 1 && p.y >= b.y0 && p.y <= b.y1) this.complete(f, this.server.admin.inContext(p));
    }
  }

  // ------------------------------------------------------------------ Star Charts and the map

  /** A chest's loot rolled: the first looting of each giant structure's vault holds a Star Chart Piece. */
  onLootRolled(dim: Dimension, x: number, y: number, z: number, table: string, stacks: ItemStack[]): void {
    if (dim.id !== 'end') return;
    const giant = Object.entries(GIANT_VAULTS).find(([, t]) => t === table)?.[0];
    if (!giant) return;
    const s = this.gen.expansionStartsAt(x, z).find((st) => st.type === giant || (GIANT_IDS.includes(st.type) && st.type === giant));
    if (!s) return;
    const key = `${s.type}@${s.x},${s.z}`;
    const st = this.state;
    if (st.charts.includes(key)) return;
    st.charts.push(key);
    stacks.push(stackOf('citadel_star_chart_piece', 1));
  }

  /** Void Citadel Maps point at the Citadel (once its site is known). */
  private markMaps(): void {
    const plan = this.plan;
    if (!plan) return;
    for (const p of this.server.players.values()) {
      for (let i = 0; i < p.inventory.size; i++) {
        const s = p.inventory.get(i);
        if (!s || itemIdOf(s) !== 'void_citadel_map' || s.tag?.data?.target) continue;
        p.inventory.set(i, { ...s, tag: { ...(s.tag ?? {}), data: { ...(s.tag?.data ?? {}), target: plan.entrance, dim: 'end', map: 'citadel' } } });
        this.server.interaction.syncInventory(p);
      }
    }
  }

  /** The telescope during an eclipse: a map to the Citadel itself. */
  citadelMap(cheat: boolean): ItemStack | null {
    const plan = this.plan;
    if (!plan) return null;
    const m = stackOf('void_citadel_map', 1, { tag: { data: { target: plan.entrance, dim: 'end', map: 'citadel' } } });
    return cheat ? { ...m, tag: { ...m.tag, admin: true } } : m;
  }

  // ------------------------------------------------------------------ Admin Panel

  /** The floor a player is on (or the lowest one not done). */
  currentFloor(p: ServerPlayer): FloorSpec | null {
    const plan = this.plan;
    if (!plan) return null;
    const k = citadelFloorAt(plan, p.x, p.y, p.z);
    if (k >= 0 && k < CITADEL.floors) return plan.floors[k]!;
    const st = this.state;
    return plan.floors.find((f) => !st.floors[f.index]!.done) ?? null;
  }

  /** Where to stand on a floor (its anchor's side), the entrance or the arena. */
  spotOf(which: 'entrance' | 'arena' | number): P3 | null {
    const plan = this.plan;
    if (!plan) return null;
    if (which === 'entrance') return [plan.entrance[0] + 3, plan.entrance[1], plan.entrance[2] + 3];
    if (which === 'arena') return [plan.arena.center[0], plan.arena.center[1], plan.arena.center[2] + 10];
    const f = plan.floors[which];
    if (!f) return null;
    return [f.anchor[0] + f.m, f.anchor[1], f.anchor[2] + f.m];
  }

  solve(p: ServerPlayer): string {
    const f = this.currentFloor(p);
    if (!f) return 'Every floor is done.';
    this.complete(f, true);
    return `Solved floor ${f.index + 1} (${FLOOR_NAMES[f.kind]}): its door is open (cheat: no advancements).`;
  }

  /** Every floor back to sealed, the puzzles and rifts reset, the Constructs of the plan back. */
  reset(): string {
    const plan = this.plan;
    if (!plan) return 'The Citadel has no site yet.';
    const st = this.state;
    const dim = this.end;
    st.floors = st.floors.map(() => ({ done: false }));
    st.stalkers = [];
    this.live.clear();
    for (const f of plan.floors) {
      for (const [x, y, z] of f.door) if (dim.isLoaded(x, z)) dim.setBlock(x, y, z, S('citadel_door'));
      for (const k of f.keys ?? []) if (dim.isLoaded(k.at[0], k.at[2])) dim.setBlock(k.at[0], k.at[1], k.at[2], plan.blockAt(...k.at)!);
      for (const at of f.pedestals ?? []) if (dim.isLoaded(at[0], at[2])) dim.setBlock(at[0], at[1], at[2], plan.blockAt(...at)!);
    }
    // Missing Constructs come back where the plan put them (cheat-made)
    for (const e of plan.entities) {
      if (!dim.isLoaded(e.x, e.z)) continue;
      const k = Number(e.data?.citadelFloor);
      const there = dim.entitiesNear(e.x, e.y, e.z, 2).some((o) => o instanceof Mob && o.type === e.type && !o.dead);
      if (there) continue;
      const m = this.server.mobs?.spawn(dim, e.type, e.x, e.y, e.z, { persistent: true, reason: 'structure', data: { ...(e.data ?? {}) } });
      if (m) {
        m.admin = true;
        m.data.citadelFloor = k;
      }
    }
    return 'Reset the Citadel: every door sealed, every puzzle and rift back as it was.';
  }

  status(): Record<string, unknown> {
    const plan = this.plan;
    if (!plan) return { site: null };
    const st = this.state;
    return { site: [plan.x, plan.z], entrance: plan.entrance, floors: plan.floors.map((f) => ({ kind: f.kind, done: st.floors[f.index]!.done })), charts: st.charts.length };
  }
}

/** Runs something a number of ticks from now (the server's own scheduler). */
function setTimeoutTicks(server: GameServer, ticks: number, fn: () => void): void {
  server.later(ticks, fn);
}

void isAlive;
void isAdminStack;
void isSurvivalLike;
