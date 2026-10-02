/**
 * V6 phase 3: the Expanded End's structures on the server.
 *
 * - The Dragon's Nest: planned once from the seed (src/common/endExpansion/
 *   nest.ts) and carved into the main island once the dragon has died (or
 *   the Admin Panel asks), one loaded chunk per tick, recorded in
 *   `level.flags.dragonNest`. Old worlds where the dragon is already dead
 *   get it the first time the End loads. It is built only once.
 * - Finding things: players walking into an End City variant or a giant
 *   structure (a one-time title and a music sting for each giant they find),
 *   or into the Nest, earn the End tab's advancements (cheat-gated).
 * - The ancient civilization: Ender Glyph Stone shows its glyphs and nothing
 *   else; the dormant machines, sealed doors and dead portals say so.
 *   Lore fragments and End Artifacts are counted as players come to hold
 *   them; Ancient Maps are tied to the nearest giant structure when a chest
 *   first rolls them.
 * - The Shardstaff fires its slow crystal shard (with its cooldown).
 * - The Admin Panel's builds: a structure planned at the player is built
 *   here one chunk per tick, like the Nest; its Constructs are cheat-made.
 *
 * Nothing is ever built in a chunk that isn't loaded (near a player), and no
 * tick builds more than one chunk's worth.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Chunk } from '../../common/world/chunk';
import { chunkIndex } from '../../common/world/constants';
import { DecorView } from '../../common/gen/decorate/view';
import type { EndGenerator } from '../../common/gen/end';
import type { Box, Start } from '../../common/gen/structures/manager';
import { planExpansionStructureAt } from '../../common/gen/structures/expanded';
import { nestPlan, inNest as inNestPlan, type NestPlan } from '../../common/endExpansion/nest';
import { END_VARIANT_IDS, GIANT_IDS, GIANT_STRUCTURES, GIANT_TYPE, expansionStructureName } from '../../common/endExpansion/structures';
import { END_ARTIFACT_IDS, INERT_MESSAGES, SHARD, SHARDSTAFF_COOLDOWN } from '../../common/endExpansion/ancient';
import { LORE_BY_ID } from '../../common/endExpansion/lore';
import { inExpansion } from '../../common/endExpansion/region';
import { S, blocks, STATE_BLOCK, getProp } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { isAdminStack, itemIdOf, type ItemStack } from '../../common/game/itemstack';
import { hashInts } from '../../common/math/rng';
import { lookDir } from './Interaction';
import { isAlive, isPlayer, type Target } from '../entity/Mob';
import { LivingEntity } from '../entity/Living';
import { isConstruct } from '../../common/endExpansion/structures';

/** What `level.flags.dragonNest` holds. */
export interface NestState {
  /** Chunks (chunkIndex) already carved. */
  done: number[];
  /** Every chunk has been carved. */
  built: boolean;
  /** The Admin Panel asked for it before the dragon's defeat. */
  forced?: boolean;
}

/** An Admin Panel structure, as saved in `level.flags.endGenerated` (enough to plan it again). */
interface GeneratedRec {
  kind: string;
  x: number;
  y: number;
  z: number;
  seed: number;
  biome?: string;
}

/** A structure being built into loaded chunks, a chunk per tick (Admin Panel). */
interface LiveBuild {
  dim: Dimension;
  start: Start;
  chunks: number[];
  by: ServerPlayer | null;
}

const EMPTY = new Chunk(0, 0, false);

export class EndStructuresSystem {
  private plan: NestPlan | null = null;
  private nestChunkList: number[] | null = null;
  private readonly builds: LiveBuild[] = [];
  private readonly shardReady = new Map<ServerPlayer, number>();

  constructor(readonly server: GameServer) {}

  private get flags(): Record<string, unknown> {
    return this.server.level.flags;
  }

  private get end(): Dimension {
    return this.server.dim('end');
  }

  private get gen(): EndGenerator {
    return this.end.generator as EndGenerator;
  }

  // ------------------------------------------------------------------ the Dragon's Nest

  nestPlan(): NestPlan {
    return (this.plan ??= nestPlan(this.gen.seed, this.gen.terrain));
  }

  /** The Nest's saved state (null until it is due). */
  get nest(): NestState | null {
    const raw = this.flags.dragonNest as Partial<NestState> | undefined;
    if (!raw || typeof raw !== 'object') return null;
    return { done: Array.isArray(raw.done) ? raw.done.filter((n) => Number.isFinite(n)).map(Number) : [], built: raw.built === true, forced: raw.forced === true };
  }

  private saveNest(st: NestState): void {
    this.flags.dragonNest = { done: st.done, built: st.built, ...(st.forced ? { forced: true } : {}) };
  }

  /** Every chunk the Nest touches, nearest the entrance first. */
  nestChunks(): number[] {
    if (this.nestChunkList) return this.nestChunkList;
    const plan = this.nestPlan();
    const set = new Map<number, number>();
    const [ex, , ez] = plan.entrance;
    for (const p of plan.pieces)
      for (let cx = p.box.x0 >> 4; cx <= p.box.x1 >> 4; cx++)
        for (let cz = p.box.z0 >> 4; cz <= p.box.z1 >> 4; cz++) set.set(chunkIndex(cx, cz), Math.hypot((cx << 4) + 8 - ex, (cz << 4) + 8 - ez));
    this.nestChunkList = [...set.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    return this.nestChunkList;
  }

  /** The Nest is due: the dragon has died once (or the Admin Panel asked) and it isn't finished. */
  nestDue(): boolean {
    const st = this.nest;
    if (st?.built) return false;
    return this.flags.dragonKilledOnce === true || st?.forced === true;
  }

  /** Admin Panel: build the Nest now (as its chunks load), whatever the dragon. */
  forceNest(): boolean {
    const st = this.nest ?? { done: [], built: false };
    if (st.built) return false;
    st.forced = true;
    this.saveNest(st);
    return true;
  }

  /** Whether a player stands in the Nest (once any of it is carved). */
  inNest(p: { dim: { id: string }; x: number; y: number; z: number }): boolean {
    if (p.dim.id !== 'end') return false;
    const st = this.nest;
    if (!st || (!st.built && !st.done.length)) return false;
    return inNestPlan(this.nestPlan(), p.x, p.y, p.z);
  }

  /** Carves the next loaded chunk of the Nest. Returns true when it built one. */
  private tickNest(): boolean {
    if (!this.nestDue()) return false;
    const dim = this.end;
    const st = this.nest ?? { done: [], built: false };
    const done = new Set(st.done);
    const todo = this.nestChunks().filter((k) => !done.has(k));
    if (!todo.length) {
      st.built = true;
      this.saveNest(st);
      return false;
    }
    for (const k of todo) {
      const c = dim.chunks.get(k);
      if (!c || !c.lightReady) continue;
      this.buildChunk(dim, c, this.nestPlan().pieces);
      st.done.push(k);
      if (st.done.length >= this.nestChunks().length) st.built = true;
      this.saveNest(st);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ live building

  /** Builds the pieces that reach a loaded chunk straight into it, then relights and resends it. */
  private buildChunk(dim: Dimension, c: Chunk, pieces: readonly { box: Box; build(v: DecorView): void }[]): void {
    const v = new DecorView(c, (x, z) => dim.chunks.get(chunkIndex(x, z)) ?? EMPTY);
    const x0 = c.cx << 4;
    const z0 = c.cz << 4;
    for (const p of pieces) if (p.box.x1 >= x0 && p.box.x0 < x0 + 16 && p.box.z1 >= z0 && p.box.z0 < z0 + 16) p.build(v);
    c.recount();
    c.recomputeHeightmap();
    dim.light.invalidateCache();
    dim.light.initChunk(c);
    c.dirty = true;
    c.modified = true;
    const k = chunkIndex(c.cx, c.cz);
    // Everyone who has the chunk gets it again
    for (const pl of this.server.players.values()) if (pl.dim === dim) pl.sentChunks.delete(k);
  }

  /** Admin Panel: plans a structure here and builds it over the next ticks. Returns the plan (or null). */
  generateAt(p: ServerPlayer, kind: string): Start | null {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const z = Math.floor(p.z);
    const biome = inExpansion(x, z) && p.dim.id === 'end' ? undefined : 'highlands';
    const seed = hashInts(this.server.level.seedNum, x, y, z, this.server.tickNo);
    const s = planExpansionStructureAt(this.gen.terrain.expansion, kind, { x, z, y, biome }, seed);
    if (!s) return null;
    // V6 phase 4: remembered (and saved), so its quests can be tried out; it is a cheat's, so they count for nothing
    const list = (this.flags.endGenerated as GeneratedRec[] | undefined) ?? [];
    list.push({ kind, x, y, z, seed, ...(biome ? { biome } : {}) });
    this.flags.endGenerated = list.slice(-64);
    this.generated = null;
    this.server.endQuests?.onGenerated(s);
    const set = new Set<number>();
    for (const pc of s.pieces) for (let cx = pc.box.x0 >> 4; cx <= pc.box.x1 >> 4; cx++) for (let cz = pc.box.z0 >> 4; cz <= pc.box.z1 >> 4; cz++) set.add(chunkIndex(cx, cz));
    this.builds.push({ dim: p.dim, start: s, chunks: [...set], by: p });
    return s;
  }

  /** Builds one chunk of the oldest Admin Panel build whose next chunk is loaded. */
  private tickBuilds(): boolean {
    for (let i = 0; i < this.builds.length; i++) {
      const b = this.builds[i]!;
      if (!b.chunks.length) {
        this.builds.splice(i--, 1);
        continue;
      }
      for (let j = 0; j < b.chunks.length; j++) {
        const k = b.chunks[j]!;
        const c = b.dim.chunks.get(k);
        if (!c || !c.lightReady) continue;
        b.chunks.splice(j, 1);
        this.buildChunk(b.dim, c, b.start.pieces);
        // Its Constructs and creatures are cheat-made
        for (const e of b.start.entities ?? []) {
          if (Math.floor(e.x) >> 4 !== c.cx || Math.floor(e.z) >> 4 !== c.cz) continue;
          const m = this.server.mobs?.spawn(b.dim, e.type, e.x, e.y, e.z, { data: e.data ? { ...e.data } : undefined, persistent: true, reason: 'structure' });
          if (m) m.admin = true;
        }
        if (!b.chunks.length) b.by?.send({ t: 'chat', text: `Finished building the ${expansionStructureName(b.start.type)}.`, kind: 'system' });
        return true;
      }
    }
    return false;
  }

  /** Structures the Admin Panel built (planned again from what was saved). */
  private generated: Start[] | null = null;

  generatedStarts(): Start[] {
    if (this.generated) return this.generated;
    const out: Start[] = [];
    for (const g of (this.flags.endGenerated as GeneratedRec[] | undefined) ?? []) {
      const s = planExpansionStructureAt(this.gen.terrain.expansion, g.kind, { x: g.x, z: g.z, y: g.y, biome: g.biome }, g.seed);
      if (s) out.push(s);
    }
    return (this.generated = out);
  }

  /** Admin Panel structures whose pieces hold a position (only the quests look at these). */
  generatedAt(x: number, y: number, z: number): Start[] {
    return this.generatedStarts().filter((s) => y >= s.bounds.y0 - 2 && y <= s.bounds.y1 + 2 && s.pieces.some((p) => x >= p.box.x0 - 1 && x <= p.box.x1 + 1 && z >= p.box.z0 - 1 && z <= p.box.z1 + 1));
  }

  /** Builds still in progress (the Admin Panel's status). */
  get pendingBuilds(): number {
    return this.builds.reduce((n, b) => n + b.chunks.length, 0);
  }

  /** Admin Panel: puts a structure's chests back as they generated (loot rolled again when opened). */
  resetLoot(dim: Dimension, s: { pieces: readonly { box: Box; build(v: DecorView): void }[] }): number {
    let n = 0;
    for (const [k, c] of dim.chunks) {
      void k;
      const x0 = c.cx << 4;
      const z0 = c.cz << 4;
      const pieces = s.pieces.filter((p) => p.box.x1 >= x0 && p.box.x0 < x0 + 16 && p.box.z1 >= z0 && p.box.z0 < z0 + 16);
      if (!pieces.length) continue;
      // A view that only lets chests (and their loot) through
      const view = new ChestOnlyView(c, (x, z) => dim.chunks.get(chunkIndex(x, z)) ?? EMPTY);
      for (const p of pieces) p.build(view);
      for (const ch of view.chests) {
        dim.setBlock(ch.x, ch.y, ch.z, ch.state);
        dim.setBlockEntity(ch.x, ch.y, ch.z, ch.be);
        this.server.interaction.containers.forget(dim, ch.x, ch.y, ch.z);
        n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ finding things

  /** The Expanded End structures whose pieces hold a position. */
  structuresAt(x: number, y: number, z: number): Start[] {
    if (!this.gen.expansionStructures) return [];
    return this.gen.expansionStartsAt(Math.floor(x), Math.floor(z)).filter((s) => y >= s.bounds.y0 - 2 && y <= s.bounds.y1 + 2 && s.pieces.some((p) => x >= p.box.x0 - 1 && x <= p.box.x1 + 1 && z >= p.box.z0 - 1 && z <= p.box.z1 + 1));
  }

  private discover(): void {
    const it = this.server.interaction;
    for (const p of this.server.players.values()) {
      if (p.dead || p.dim.id !== 'end' || p.gamemode === 'spectator') continue;
      if (this.inNest(p)) it.grant(p, 'enter_dragon_nest');
      if (!inExpansion(p.x, p.z)) continue;
      const cheat = this.server.admin.inContext(p);
      for (const s of this.structuresAt(p.x, p.y, p.z)) {
        const giant = GIANT_IDS.includes(s.type);
        if (giant) {
          // A one-time title and a music sting for each giant structure a player finds
          const key = `${s.type}@${s.x},${s.z}`;
          if (!p.endTitles.has(key)) {
            p.endTitles.add(key);
            const g = GIANT_STRUCTURES.find((x) => x.id === s.type)!;
            p.send({ t: 'title', text: g.title, ticks: 100 });
            p.send({ t: 'sound', name: 'music.discovery', x: p.x, y: p.y + 1, z: p.z, volume: 1, pitch: 1 });
          }
        }
        if (cheat) continue;
        if (!p.endFound.has(s.type)) p.endFound.add(s.type);
        if (giant) {
          it.grant(p, `find_${s.type}`);
          if (GIANT_IDS.every((id) => p.endFound.has(id))) it.grant(p, 'all_giant_structures');
        } else if (END_VARIANT_IDS.includes(s.type)) {
          it.grant(p, 'find_end_variant');
          if (END_VARIANT_IDS.every((id) => p.endFound.has(id))) it.grant(p, 'all_end_variants');
        }
      }
    }
  }

  /** Lore fragments and End Artifacts players hold; Ancient Maps without a mark get one. */
  private scanInventories(): void {
    const it = this.server.interaction;
    for (const p of this.server.players.values()) {
      if (p.dead) continue;
      for (let i = 0; i < p.inventory.size; i++) {
        const st = p.inventory.get(i);
        if (!st) continue;
        const id = itemIdOf(st);
        if (id === 'ancient_map' && st.tag?.data?.map !== 'marked') {
          this.markMaps(p.dim, p.x, p.z, [st]);
          p.inventory.set(i, st);
          continue;
        }
        if (isAdminStack(st)) continue;
        if (id === 'book' && st.tag?.lore && LORE_BY_ID.has(st.tag.lore) && !p.endLore.has(st.tag.lore)) {
          p.endLore.add(st.tag.lore);
          if (p.endLore.size >= 10) it.grant(p, 'lore_fragments');
        }
        if (END_ARTIFACT_IDS.includes(id) && !p.endArtifacts.has(id)) {
          p.endArtifacts.add(id);
          if (END_ARTIFACT_IDS.every((a) => p.endArtifacts.has(a))) it.grant(p, 'all_artifacts');
        }
      }
    }
  }

  /** The nearest giant structure to a column (null in worlds without them). */
  nearestGiant(x: number, z: number): Start | null {
    const m = this.gen.expansionStructures;
    if (!m) return null;
    const steps = m.nearestSteps(GIANT_TYPE, Math.floor(x), Math.floor(z), 8);
    let r = steps.next();
    while (!r.done) r = steps.next();
    return r.value;
  }

  /** Ties unmarked Ancient Maps to the giant structure nearest where they were found. */
  markMaps(dim: Dimension, x: number, z: number, stacks: ItemStack[]): void {
    let target: Start | null | undefined;
    for (const st of stacks) {
      if (itemIdOf(st) !== 'ancient_map' || st.tag?.data?.map === 'marked') continue;
      if (dim.id !== 'end') continue;
      target ??= this.nearestGiant(x, z);
      if (!target) continue;
      st.tag = { ...(st.tag ?? {}), data: { ...(st.tag?.data ?? {}), map: 'marked', target: [target.x, target.y, target.z], dim: 'end' } };
    }
  }

  // ------------------------------------------------------------------ using things

  /** Ender Glyph Stone shows its glyphs; the dormant ancient blocks say what they lack. */
  useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const id = blocks[STATE_BLOCK[state]!]!.id;
    if (id === 'ender_glyph_stone') {
      p.send({ t: 'glyphs', seed: hashInts(x, y, z) >>> 0, face: Number(getProp(state, 'glyph') ?? 0) });
      this.server.playSound(p.dim, 'block.glyph', x + 0.5, y + 0.5, z + 0.5, 0.6, 1);
      this.server.interaction.grant(p, 'read_glyph');
      return true;
    }
    const msg = INERT_MESSAGES[id];
    if (!msg) return false;
    p.send({ t: 'title', text: '', sub: msg, ticks: 50 });
    this.server.playSound(p.dim, id === 'dead_portal' ? 'block.dead_portal' : 'block.dormant', x + 0.5, y + 0.5, z + 0.5, 0.6, 1);
    return true;
  }

  /** The Shardstaff: a slow crystal shard straight ahead, then a cooldown. */
  useItem(p: ServerPlayer, stack: ItemStack, hand: number): boolean {
    if (items[stack.id]?.id !== 'shardstaff') return false;
    const s = this.server;
    if ((this.shardReady.get(p) ?? 0) > s.tickNo) return true;
    const [ex, ey, ez] = s.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const pr = s.mobs!.projectile(p.dim, 'crystal_shard', ex + d[0] * 0.6, ey - 0.15 + d[1] * 0.6, ez + d[2] * 0.6, p);
    pr.vx = d[0] * SHARD.speed;
    pr.vy = d[1] * SHARD.speed;
    pr.vz = d[2] * SHARD.speed;
    pr.life = SHARD.life;
    pr.admin = s.interaction.isCheat(p, stack);
    pr.onHit = (proj, hit) => {
      const e = hit.entity;
      if (e && e !== p && (isPlayer(e) || e instanceof LivingEntity) && isAlive(e as Target)) {
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const l = Math.hypot(dx, dz) || 1;
        s.mobs!.damage(e as Target, SHARD.damage, { source: 'player', attacker: p, kbx: dx / l, kbz: dz / l, knockback: 0.3 });
      }
      s.particles(proj.dim as Dimension, 'end_rod', hit.x, hit.y, hit.z, 12, 0.3);
      s.playSound(proj.dim as Dimension, 'shardstaff.hit', hit.x, hit.y, hit.z, 0.8, 1.2);
      return true;
    };
    s.playSound(p.dim, 'shardstaff.fire', p.x, p.y + 1.5, p.z, 1, 1);
    this.shardReady.set(p, s.tickNo + SHARDSTAFF_COOLDOWN);
    p.send({ t: 'cooldown', item: stack.id, ticks: SHARDSTAFF_COOLDOWN });
    if (p.gamemode !== 'creative') s.interaction.damageStack(p, hand === 1 ? 40 : p.selectedSlot, 1);
    return true;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    // At most one chunk built per tick: the Nest first, then Admin Panel builds
    if (!this.tickNest()) this.tickBuilds();
    if (this.server.tickNo % 20 === 7) {
      this.discover();
      this.scanInventories();
    }
    for (const p of this.shardReady.keys()) if (!this.server.players.has(p.conn.id)) this.shardReady.delete(p);
  }

  /** Status for the Admin Panel. */
  status(): Record<string, unknown> {
    const st = this.nest;
    const plan = this.nestPlan();
    return {
      enabled: !!this.gen.expansionStructures,
      nest: { due: this.nestDue(), built: st?.built ?? false, carved: st?.done.length ?? 0, chunks: this.nestChunks().length, entrance: plan.entrance, floor: plan.floor },
      building: this.pendingBuilds,
    };
  }
}

/** A view that keeps only the chests a build would place (the Admin Panel's loot reset). */
class ChestOnlyView extends DecorView {
  readonly chests: { x: number; y: number; z: number; state: number; be: { type: string; [k: string]: unknown } }[] = [];
  private last: { x: number; y: number; z: number; state: number } | null = null;

  override set(x: number, y: number, z: number, state: number): void {
    if (!this.inside(x, z)) return;
    if (blocks[STATE_BLOCK[state]!]!.id === 'chest') this.last = { x, y, z, state };
  }

  override setBlockEntity(x: number, y: number, z: number, data: { type: string; [k: string]: unknown } | undefined): void {
    if (!data || data.type !== 'chest' || typeof data.loot !== 'string' || !this.inside(x, z)) return;
    const l = this.last;
    this.chests.push({ x, y, z, state: l && l.x === x && l.y === y && l.z === z ? l.state : S('chest'), be: { ...data } });
  }
}

void isConstruct;
