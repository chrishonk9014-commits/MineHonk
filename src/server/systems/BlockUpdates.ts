/**
 * Block update scheduling: neighbour reactions, scheduled ticks (fluids,
 * falling blocks) and random ticks (plant growth, spreading, decay).
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import { blocks, STATE_BLOCK, STATE_FLUID, STATE_SOLID, STATE_REPLACEABLE, STATE_OPAQUE, getProp, withProp, S, stateOf, blockHasTag, STATE_LIGHT } from '../../common/registry/blocks';
import { FACE_DX, FACE_DY, FACE_DZ, SECTIONS_PER_CHUNK, chunkIndex } from '../../common/world/constants';
import { canSurvive, connectState, chestPartnerUpdate } from '../../common/game/placement';
import { computeBlockDrops } from '../../common/game/drops';
import { Random } from '../../common/math/rng';
import { FallingBlock } from '../entity/FallingBlock';
import type { Chunk } from '../../common/world/chunk';
import { growTree } from '../../common/gen/features/trees';
import { reconnectSeam } from '../../common/game/connections';

/** Saved-chunk pseudo-entity carrying the chunk's pending block ticks (V4). */
export const TICKS_ENTITY = 'block_ticks';

const SEAMS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const rng = new Random();

interface Scheduled {
  x: number;
  y: number;
  z: number;
  due: number;
  kind: 'fluid' | 'fall' | 'check' | 'dripleaf';
}

export class BlockUpdates {
  /** Scheduled ticks per dimension keyed by position. */
  private readonly scheduled = new Map<Dimension, Map<string, Scheduled>>();
  /**
   * V4: ticks of chunks that are not loaded, by chunk, with the delay they
   * had left. They resume when the chunk loads (and are saved with it).
   */
  private readonly parked = new Map<Dimension, Map<number, { x: number; y: number; z: number; left: number; kind: Scheduled['kind'] }[]>>();
  private water = 0;
  private lava = 0;
  private fire = 0;
  private air = 0;

  constructor(private readonly server: GameServer) {}

  private ids(): void {
    if (this.water) return;
    this.water = S('water');
    this.lava = S('lava');
    this.fire = S('fire');
  }

  schedule(dim: Dimension, x: number, y: number, z: number, delay: number, kind: Scheduled['kind']): void {
    let m = this.scheduled.get(dim);
    if (!m) {
      m = new Map();
      this.scheduled.set(dim, m);
    }
    const k = x + ',' + y + ',' + z + kind;
    const due = this.server.tickNo + delay;
    const cur = m.get(k);
    if (cur && cur.due <= due) return;
    m.set(k, { x, y, z, due, kind });
    this.tickIndex.tick = -1;
  }

  /** Called after any authoritative block change. */
  onChanged(dim: Dimension, x: number, y: number, z: number, old: number, state: number): void {
    this.ids();
    // self checks
    this.react(dim, x, y, z);
    for (let f = 0; f < 6; f++) this.react(dim, x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f]);
    this.server.power?.onBlockChanged(dim, x, y, z, old, state);
    this.server.sculk?.onBlockChanged(dim, x, y, z, old, state);
    this.server.structureQuests?.onBlockChanged(dim, x, y, z, state);
  }

  /** Neighbour reaction for the block at (x,y,z). */
  private react(dim: Dimension, x: number, y: number, z: number): void {
    if (y < 0 || y > 255 || !dim.isLoaded(x, z)) return;
    const s = dim.getState(x, y, z);
    if (s === 0) return;
    const def = blocks[STATE_BLOCK[s]!]!.def;
    if (STATE_FLUID[s] && def.model === 'liquid') {
      this.schedule(dim, x, y, z, STATE_FLUID[s] === 2 ? (dim.rules.lavaSpreadFast ? 10 : 30) : 5, 'fluid');
      return;
    }
    // Waterlogged-ish plants (seagrass etc.) need water around to spread: skip
    if (def.gravity) {
      const below = dim.getState(x, y - 1, z);
      if (below === 0 || STATE_REPLACEABLE[below] || STATE_FLUID[below]) this.schedule(dim, x, y, z, 2, 'fall');
      return;
    }
    // Connection shapes
    const cs = connectState(dim, x, y, z, s);
    if (cs !== s) {
      dim.setBlock(x, y, z, cs, { updateNeighbors: false });
      return;
    }
    if (def.model === 'chest') {
      const pu = chestPartnerUpdate(dim, x, y, z, s);
      if (pu && dim.getState(pu.x, pu.y, pu.z) !== pu.state && getProp(dim.getState(pu.x, pu.y, pu.z), 'type') === 'single') dim.setBlock(pu.x, pu.y, pu.z, pu.state, { keepBlockEntity: true, updateNeighbors: false });
    }
    if (!canSurvive(s, dim, x, y, z)) this.schedule(dim, x, y, z, 1, 'check');
  }

  /** Breaks a block naturally, dropping its items (unsupported torches, plants...). */
  breakNaturally(dim: Dimension, x: number, y: number, z: number, drop = true): void {
    const s = dim.getState(x, y, z);
    if (s === 0) return;
    const def = blocks[STATE_BLOCK[s]!]!.def;
    dim.setBlock(x, y, z, def.fluid === 'water' && def.model !== 'liquid' ? this.water : 0);
    if (drop) {
      for (const st of computeBlockDrops(s, null, rng).items) this.server.mining.dropItem(dim, x + 0.5, y + 0.3, z + 0.5, st);
    }
    this.server.particles(dim, 'block', x + 0.5, y + 0.5, z + 0.5, 12, 0.4, s);
  }

  /** V4 worlds: the fluid and connection improvements of the World Update. */
  get v4(): boolean {
    return this.server.level.generatorVersion >= 4;
  }

  onChunkReady(dim: Dimension, c: Chunk): void {
    if (this.v4) {
      this.joinNeighbours(dim, c);
      this.resumeParked(dim, c);
    }
    // Register furnaces with pending work
    for (const [k, be] of c.blockEntities) {
      if (be.type === 'furnace') {
        const x = (c.cx << 4) + (k & 15);
        const z = (c.cz << 4) + ((k >> 4) & 15);
        const y = k >> 8;
        this.server.interaction.containers.registerFurnace(dim, x, y, z);
      }
    }
    // Restore persistent entities (and, in V4 worlds, the chunk's pending block ticks)
    const ents = dim.takePendingEntities(c.cx, c.cz);
    if (ents) {
      const ticks = ents.filter((e) => e.type === TICKS_ENTITY);
      if (ticks.length && this.v4) for (const t of ticks) this.loadTicks(dim, t);
      this.server.interaction.restoreEntities(dim, ticks.length ? ents.filter((e) => e.type !== TICKS_ENTITY) : ents);
    }
  }

  // ------------------------------------------------------------------ pending ticks across unloads (V4)

  private parkedFor(dim: Dimension): Map<number, { x: number; y: number; z: number; left: number; kind: Scheduled['kind'] }[]> {
    let m = this.parked.get(dim);
    if (!m) {
      m = new Map();
      this.parked.set(dim, m);
    }
    return m;
  }

  private park(dim: Dimension, s: Scheduled): void {
    const k = chunkIndex(s.x >> 4, s.z >> 4);
    const m = this.parkedFor(dim);
    let l = m.get(k);
    if (!l) {
      l = [];
      m.set(k, l);
    }
    if (l.length < 4096) l.push({ x: s.x, y: s.y, z: s.z, left: Math.max(1, s.due - this.server.tickNo), kind: s.kind });
  }

  /** Scheduled ticks by chunk, rebuilt at most once per server tick (saving asks for many chunks at once). */
  private tickIndex: { dim: Dimension | null; tick: number; map: Map<number, Scheduled[]> } = { dim: null, tick: -1, map: new Map() };

  /** Scheduled ticks inside a chunk (without removing them). */
  private ticksIn(dim: Dimension, cx: number, cz: number): Scheduled[] {
    const idx = this.tickIndex;
    if (idx.dim !== dim || idx.tick !== this.server.tickNo) {
      idx.dim = dim;
      idx.tick = this.server.tickNo;
      idx.map = new Map();
      const m = this.scheduled.get(dim);
      if (m)
        for (const t of m.values()) {
          const k = chunkIndex(t.x >> 4, t.z >> 4);
          let l = idx.map.get(k);
          if (!l) {
            l = [];
            idx.map.set(k, l);
          }
          l.push(t);
        }
    }
    return idx.map.get(chunkIndex(cx, cz)) ?? [];
  }

  /** V4: a chunk is unloading; its pending ticks wait for it to come back. */
  onChunkUnloaded(dim: Dimension, c: Chunk): void {
    if (!this.v4) return;
    const m = this.scheduled.get(dim);
    if (!m) return;
    const list = this.ticksIn(dim, c.cx, c.cz);
    if (!list.length) return;
    for (const s of list) {
      m.delete(s.x + ',' + s.y + ',' + s.z + s.kind);
      this.park(dim, s);
    }
    this.tickIndex.tick = -1;
  }

  private resumeParked(dim: Dimension, c: Chunk): void {
    const m = this.parked.get(dim);
    const k = chunkIndex(c.cx, c.cz);
    const l = m?.get(k);
    if (!l) return;
    m!.delete(k);
    for (const t of l) this.schedule(dim, t.x, t.y, t.z, t.left, t.kind);
  }

  /** Whether a chunk has pending ticks that must be saved with it. */
  hasTicks(dim: Dimension, c: Chunk): boolean {
    if (!this.v4) return false;
    return !!this.parked.get(dim)?.get(chunkIndex(c.cx, c.cz))?.length || this.ticksIn(dim, c.cx, c.cz).length > 0;
  }

  /** The chunk's pending ticks as a saved pseudo-entity (none in pre-V4 worlds). */
  savedTicks(dim: Dimension, c: Chunk): Record<string, unknown>[] {
    if (!this.v4) return [];
    const list: number[] = [];
    const kinds: Scheduled['kind'][] = ['fluid', 'fall', 'check', 'dripleaf'];
    const now = this.server.tickNo;
    for (const s of this.ticksIn(dim, c.cx, c.cz)) list.push(s.x & 15, s.y, s.z & 15, Math.max(1, s.due - now), kinds.indexOf(s.kind));
    for (const t of this.parked.get(dim)?.get(chunkIndex(c.cx, c.cz)) ?? []) list.push(t.x & 15, t.y, t.z & 15, t.left, kinds.indexOf(t.kind));
    return list.length ? [{ type: TICKS_ENTITY, cx: c.cx, cz: c.cz, t: list }] : [];
  }

  private loadTicks(dim: Dimension, d: Record<string, unknown>): void {
    const kinds: Scheduled['kind'][] = ['fluid', 'fall', 'check', 'dripleaf'];
    const t = d.t;
    const cx = Number(d.cx);
    const cz = Number(d.cz);
    if (!Array.isArray(t) || !Number.isFinite(cx) || !Number.isFinite(cz)) return;
    for (let i = 0; i + 4 < t.length && i < 5 * 4096; i += 5) {
      const [lx, y, lz, left, kind] = [t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4]].map(Number) as [number, number, number, number, number];
      if (!(lx >= 0 && lx < 16 && lz >= 0 && lz < 16 && y >= 0 && y < 256) || !kinds[kind]) continue;
      this.schedule(dim, (cx << 4) + lx, y, (cz << 4) + lz, Math.max(1, Math.min(1200, left || 1)), kinds[kind]!);
    }
  }

  /**
   * V4 worlds: fences, panes, walls and stairs along the chunk's borders
   * connect to what stands across them, now that both sides are loaded.
   */
  private joinNeighbours(dim: Dimension, c: Chunk): void {
    const set = (x: number, y: number, z: number, s: number): void => {
      dim.setBlock(x, y, z, s, { updateNeighbors: false, keepBlockEntity: true });
    };
    for (const [dx, dz] of SEAMS) {
      const n = dim.getChunk(c.cx + dx, c.cz + dz);
      if (n) reconnectSeam(dim, c, n, set);
    }
  }

  tick(dim: Dimension): void {
    this.ids();
    const m = this.scheduled.get(dim);
    if (m && m.size) {
      const now = this.server.tickNo;
      const due: Scheduled[] = [];
      for (const [k, s] of m) {
        if (s.due <= now) {
          due.push(s);
          m.delete(k);
          if (due.length > 4000) break;
        }
      }
      if (due.length) this.tickIndex.tick = -1;
      for (const s of due) {
        if (!dim.isLoaded(s.x, s.z)) {
          if (this.v4) this.park(dim, s);
          continue;
        }
        if (s.kind === 'fluid') this.tickFluid(dim, s.x, s.y, s.z);
        else if (s.kind === 'fall') this.tickFall(dim, s.x, s.y, s.z);
        else if (s.kind === 'dripleaf') this.tickDripleaf(dim, s.x, s.y, s.z);
        else {
          const st = dim.getState(s.x, s.y, s.z);
          if (st !== 0 && !canSurvive(st, dim, s.x, s.y, s.z)) this.breakNaturally(dim, s.x, s.y, s.z);
        }
      }
    }
    this.randomTicks(dim);
  }

  private tickFall(dim: Dimension, x: number, y: number, z: number): void {
    const s = dim.getState(x, y, z);
    if (!blocks[STATE_BLOCK[s]!]!.def.gravity) return;
    const below = dim.getState(x, y - 1, z);
    if (!(below === 0 || STATE_REPLACEABLE[below] || STATE_FLUID[below]) || y <= 0) return;
    const cheat = this.server.admin.blockMarked(dim, x, y, z);
    dim.setBlock(x, y, z, 0);
    this.server.admin.setBlockMark(dim, x, y, z, false);
    const e = new FallingBlock(s);
    e.setPos(x + 0.5, y, z + 0.5);
    e.admin = cheat;
    dim.addEntity(e);
  }

  // ------------------------------------------------------------------ fluids
  // level 0 = source, 1..7 = flowing (distance), 8+ = falling

  private fluidLevel(s: number, kind: number): number {
    if (STATE_FLUID[s] !== kind || blocks[STATE_BLOCK[s]!]!.def.model !== 'liquid') return -1;
    return parseInt(getProp(s, 'level')!, 10);
  }

  private tickFluid(dim: Dimension, x: number, y: number, z: number): void {
    const s = dim.getState(x, y, z);
    const kind = STATE_FLUID[s]!;
    if (!kind || blocks[STATE_BLOCK[s]!]!.def.model !== 'liquid') return;
    const base = kind === 1 ? this.water : this.lava;
    const drop = kind === 1 || dim.rules.lavaSpreadFast ? 1 : 2;
    const maxDist = 7;
    let level = parseInt(getProp(s, 'level')!, 10);
    // Recompute this cell's level from neighbours (unless source)
    if (level !== 0) {
      let best = 99;
      let falling = false;
      const above = dim.getState(x, y + 1, z);
      if (STATE_FLUID[above] === kind && blocks[STATE_BLOCK[above]!]!.def.model === 'liquid') {
        best = 8; // falling
        falling = true;
      } else {
        let sources = 0;
        for (let f = 2; f < 6; f++) {
          const n = dim.getState(x + FACE_DX[f], y, z + FACE_DZ[f]);
          const nl = this.fluidLevel(n, kind);
          if (nl < 0) continue;
          if (nl === 0) sources++;
          const eff = nl >= 8 ? 0 : nl;
          best = Math.min(best, eff + drop);
        }
        // Infinite water: two adjacent sources above solid/water ground make a source
        const under = dim.getState(x, y - 1, z);
        if (kind === 1 && sources >= 2 && (STATE_SOLID[under] || this.fluidLevel(under, 1) === 0)) best = 0;
      }
      // Level 8 means falling. Before V4, a cell one step past the last flowing
      // level also came out as 8 and then fed its neighbours like a waterfall,
      // so the edge of a spreading fluid could pulse forever.
      const newLevel = this.v4 ? (falling ? 8 : best > maxDist ? -1 : best) : best > maxDist && best !== 8 ? -1 : best;
      if (newLevel === -1) {
        dim.setBlock(x, y, z, 0);
        return;
      }
      if (newLevel !== level) {
        level = newLevel;
        dim.setBlock(x, y, z, withProp(base, 'level', String(Math.min(15, level))));
      }
    }
    // Lava/water interaction
    if (kind === 2) {
      for (let f = 0; f < 6; f++) {
        if (f === 0) continue;
        const n = dim.getState(x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f]);
        if (STATE_FLUID[n] === 1) {
          dim.setBlock(x, y, z, level === 0 ? S('obsidian') : S('cobblestone'));
          if (this.server.admin.blockMarked(dim, x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f])) this.server.admin.setBlockMark(dim, x, y, z, true);
          this.server.playSound(dim, 'fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6);
          return;
        }
      }
    }
    const v4 = this.v4;
    // Spread down
    const below = dim.getState(x, y - 1, z);
    if (y > 0 && this.canFlowInto(dim, below, kind, x, y - 1, z)) {
      if (kind === 1 && STATE_FLUID[below] === 2) {
        // Water pouring onto lava: a lava source sets into obsidian, flowing lava into cobblestone (V4; stone before)
        dim.setBlock(x, y - 1, z, this.fluidLevel(below, 2) === 0 ? S('obsidian') : v4 ? S('cobblestone') : S('stone'));
        if (this.server.admin.blockMarked(dim, x, y, z)) this.server.admin.setBlockMark(dim, x, y - 1, z, true);
        if (v4) this.server.playSound(dim, 'fizz', x + 0.5, y - 0.5, z + 0.5, 0.5, 2.6);
        return;
      }
      this.flowInto(dim, x, y - 1, z, withProp(base, 'level', '8'), kind, this.server.admin.blockMarked(dim, x, y, z), true);
      if (level !== 0) return; // falling fluid doesn't spread sideways unless source
    }
    // Spread sideways
    const eff = level >= 8 ? 0 : level;
    const next = eff + drop;
    if (next > maxDist) return;
    if (y > 0 && level !== 0 && this.fluidLevel(below, kind) >= 0) return;
    const dirs = this.flowDirections(dim, x, y, z, kind);
    let blocked = false;
    for (const f of dirs) {
      const nx = x + FACE_DX[f];
      const nz = z + FACE_DZ[f];
      // V4: flow waiting at the edge of the loaded world carries on once the chunk loads
      if (v4 && !dim.isLoaded(nx, nz)) {
        blocked = true;
        continue;
      }
      const n = dim.getState(nx, y, nz);
      if (!this.canFlowInto(dim, n, kind, nx, y, nz)) continue;
      const nl = this.fluidLevel(n, kind);
      // Sources, falling fluid and cells at least as full stay as they are
      if (nl >= 0 && (nl === 0 || nl >= 8 || nl <= next)) continue;
      this.flowInto(dim, nx, y, nz, withProp(base, 'level', String(next)), kind, this.server.admin.blockMarked(dim, x, y, z), false);
    }
    if (blocked) this.schedule(dim, x, y, z, 40, 'fluid');
  }

  /** Prefers directions leading to a drop within 4 blocks (classic flow AI). */
  private flowDirections(dim: Dimension, x: number, y: number, z: number, kind: number): number[] {
    const all = [2, 3, 4, 5];
    let best = 99;
    const scores: number[] = [];
    for (const f of all) {
      let d = 99;
      for (let k = 1; k <= 4; k++) {
        const nx = x + FACE_DX[f] * k;
        const nz = z + FACE_DZ[f] * k;
        const n = dim.getState(nx, y, nz);
        if (!this.canFlowInto(dim, n, kind, nx, y, nz) && this.fluidLevel(n, kind) < 0) break;
        const under = dim.getState(nx, y - 1, nz);
        if (this.canFlowInto(dim, under, kind, nx, y - 1, nz)) {
          d = k;
          break;
        }
      }
      scores.push(d);
      best = Math.min(best, d);
    }
    if (best === 99) return all;
    return all.filter((_, i) => scores[i] === best);
  }

  /**
   * Whether fluid of `kind` may move into a cell: air, replaceable blocks,
   * the other fluid (they mix) or a flowing (not source) cell of its own kind.
   * Same-kind sources are never replaced: turning a source under a source into
   * falling water let the sideways flow of its neighbours and the source above
   * rewrite it forever (1 -> 8 -> 1 every fluid tick).
   */
  private canFlowInto(dim: Dimension, s: number, kind: number, x: number, y: number, z: number): boolean {
    if (s === 0) return true;
    if (STATE_FLUID[s]) {
      const def = blocks[STATE_BLOCK[s]!]!.def;
      if (def.model !== 'liquid') return false;
      return STATE_FLUID[s] !== kind || this.fluidLevel(s, kind) !== 0;
    }
    if (!dim.isLoaded(x, z)) return false;
    return STATE_REPLACEABLE[s] === 1 && !STATE_SOLID[s];
  }

  /** Fluid spreading from a cheat-placed source keeps the cheat mark. */
  private flowInto(dim: Dimension, x: number, y: number, z: number, state: number, kind: number, cheat = false, down = false): void {
    if (cheat) this.server.admin.setBlockMark(dim, x, y, z, true);
    const cur = dim.getState(x, y, z);
    if (cur !== 0 && !STATE_FLUID[cur] && STATE_REPLACEABLE[cur]) {
      for (const st of computeBlockDrops(cur, null, rng).items) this.server.mining.dropItem(dim, x + 0.5, y + 0.3, z + 0.5, st);
    }
    if (STATE_FLUID[cur] && STATE_FLUID[cur] !== kind) {
      // Mixing. V4 follows one rule set: water reaching lava sets a source into
      // obsidian and flowing lava into cobblestone; lava pouring down into water
      // makes stone, lava running sideways into it cobblestone.
      let solid: number;
      if (!this.v4) solid = kind === 1 ? S('cobblestone') : S('stone');
      else if (kind === 1) solid = this.fluidLevel(cur, 2) === 0 ? S('obsidian') : S('cobblestone');
      else solid = down ? S('stone') : S('cobblestone');
      dim.setBlock(x, y, z, solid);
      if (this.v4) this.server.playSound(dim, 'fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6);
      return;
    }
    dim.setBlock(x, y, z, state);
  }

  // ------------------------------------------------------------------ random ticks

  private randomTicks(dim: Dimension): void {
    const speed = this.server.level.rules.randomTickSpeed;
    if (speed <= 0) return;
    // Only chunks near players
    const players = [...this.server.players.values()].filter((p) => p.dim === dim);
    if (players.length === 0) return;
    const done = new Set<number>();
    for (const p of players) {
      const pcx = Math.floor(p.x) >> 4;
      const pcz = Math.floor(p.z) >> 4;
      for (let dz = -8; dz <= 8; dz++) {
        for (let dx = -8; dx <= 8; dx++) {
          const k = chunkIndex(pcx + dx, pcz + dz);
          if (done.has(k)) continue;
          done.add(k);
          const c = dim.chunks.get(k);
          if (!c) continue;
          for (let si = 0; si < SECTIONS_PER_CHUNK; si++) {
            const sec = c.sections[si];
            if (!sec) continue;
            for (let n = 0; n < speed; n++) {
              const i = rng.int(4096);
              const st = sec[i]!;
              if (st === 0) continue;
              const def = blocks[STATE_BLOCK[st]!]!.def;
              if (!def.randomTicks) continue;
              this.randomTick(dim, (c.cx << 4) + (i & 15), (si << 4) + (i >> 8), (c.cz << 4) + ((i >> 4) & 15), st);
            }
          }
        }
      }
    }
  }

  private skyAt(dim: Dimension, x: number, y: number, z: number): number {
    return dim.getLight(x, y, z) >> 4;
  }

  private lightAt(dim: Dimension, x: number, y: number, z: number): number {
    const l = dim.getLight(x, y, z);
    const sky = l >> 4;
    const block = l & 15;
    const dt = this.server.level.dayTime;
    const skyDim = dt > 13000 && dt < 23000 ? 11 : 0;
    return Math.max(block, sky - skyDim);
  }

  /** A ripe stem sets its fruit on free ground beside it (one at a time). */
  private growFruit(dim: Dimension, x: number, y: number, z: number, fruit: string): void {
    if (this.lightAt(dim, x, y + 1, z) < 9 || !rng.chance(1 / 4)) return;
    for (let f = 2; f < 6; f++) if (blocks[STATE_BLOCK[dim.getState(x + FACE_DX[f], y, z + FACE_DZ[f])]!]!.id === fruit) return;
    const f = 2 + rng.int(4);
    const fx = x + FACE_DX[f];
    const fz = z + FACE_DZ[f];
    const ground = blocks[STATE_BLOCK[dim.getState(fx, y - 1, fz)]!]!.id;
    if (dim.getState(fx, y, fz) !== 0 || !['dirt', 'grass_block', 'farmland', 'coarse_dirt', 'podzol', 'moss_block', 'rooted_dirt', 'mud'].includes(ground)) return;
    dim.setBlock(fx, y, fz, S(fruit));
  }

  /** Something is standing on a big dripleaf: it tips, then drops what is on it, then springs back. */
  stepOnDripleaf(dim: Dimension, x: number, y: number, z: number): void {
    const st = dim.getState(x, y, z);
    if (blocks[STATE_BLOCK[st]!]!.id !== 'big_dripleaf' || getProp(st, 'tilt') !== 'none') return;
    dim.setBlock(x, y, z, withProp(st, 'tilt', 'partial'));
    this.server.playSound(dim, 'dripleaf.tilt', x + 0.5, y + 0.9, z + 0.5, 0.6, 1);
    this.schedule(dim, x, y, z, 10, 'dripleaf');
  }

  private tickDripleaf(dim: Dimension, x: number, y: number, z: number): void {
    const st = dim.getState(x, y, z);
    if (blocks[STATE_BLOCK[st]!]!.id !== 'big_dripleaf') return;
    const tilt = getProp(st, 'tilt');
    if (tilt === 'partial') {
      dim.setBlock(x, y, z, withProp(st, 'tilt', 'full'));
      this.schedule(dim, x, y, z, 60, 'dripleaf');
    } else if (tilt === 'full') {
      dim.setBlock(x, y, z, withProp(st, 'tilt', 'none'));
      this.server.playSound(dim, 'dripleaf.tilt', x + 0.5, y + 0.9, z + 0.5, 0.6, 1.3);
    }
  }

  private randomTick(dim: Dimension, x: number, y: number, z: number, st: number): void {
    const bt = blocks[STATE_BLOCK[st]!]!;
    const def = bt.def;
    const id = bt.id;
    if (id === 'budding_amethyst') {
      // Buds grow on a free face and ripen into clusters
      if (!rng.chance(1 / 5)) return;
      const f = rng.int(6);
      const nx = x + FACE_DX[f];
      const ny = y + FACE_DY[f];
      const nz = z + FACE_DZ[f];
      const n = dim.getState(nx, ny, nz);
      const nid = blocks[STATE_BLOCK[n]!]!.id;
      if (n === 0 || nid === 'cave_air') dim.setBlock(nx, ny, nz, S('amethyst_bud'));
      else if (nid === 'amethyst_bud') dim.setBlock(nx, ny, nz, S('amethyst_cluster'));
      return;
    }
    if (def.model === 'crop') {
      const age = parseInt(getProp(st, 'age')!, 10);
      const max = (def.data?.maxAge as number) ?? 7;
      if (age >= max) {
        if (def.data?.fruit) this.growFruit(dim, x, y, z, String(def.data.fruit));
        return;
      }
      if (id !== 'nether_wart' && this.lightAt(dim, x, y + 1, z) < 9) return;
      const farm = dim.getState(x, y - 1, z);
      const moist = blocks[STATE_BLOCK[farm]!]!.id === 'farmland' && getProp(farm, 'moisture') === '7';
      const chance = id === 'nether_wart' ? 0.1 : moist ? 1 / 3 : 1 / 8;
      if (rng.chance(chance)) dim.setBlock(x, y, z, withProp(st, 'age', String(age + 1)));
      return;
    }
    if (id === 'grass_block' || id === 'mycelium') {
      const aboveS = dim.getState(x, y + 1, z);
      if (STATE_OPAQUE[aboveS] || STATE_FLUID[aboveS]) {
        dim.setBlock(x, y, z, S('dirt'));
        return;
      }
      if (this.lightAt(dim, x, y + 1, z) >= 9) {
        for (let k = 0; k < 4; k++) {
          const nx = x + rng.range(-1, 1);
          const ny = y + rng.range(-3, 1);
          const nz = z + rng.range(-1, 1);
          if (dim.getState(nx, ny, nz) === S('dirt')) {
            const na = dim.getState(nx, ny + 1, nz);
            if (!STATE_OPAQUE[na] && !STATE_FLUID[na] && this.lightAt(dim, nx, ny + 1, nz) >= 4) dim.setBlock(nx, ny, nz, S(id));
          }
        }
      }
      return;
    }
    if (id === 'farmland') {
      let water = false;
      for (let dx = -4; dx <= 4 && !water; dx++) for (let dz = -4; dz <= 4 && !water; dz++) for (let dy = 0; dy <= 1; dy++) if (STATE_FLUID[dim.getState(x + dx, y + dy, z + dz)] === 1) water = true;
      const m = parseInt(getProp(st, 'moisture')!, 10);
      if (water || (this.server.level.raining && this.skyAt(dim, x, y + 1, z) >= 15)) {
        if (m < 7) dim.setBlock(x, y, z, withProp(st, 'moisture', '7'));
      } else if (m > 0) dim.setBlock(x, y, z, withProp(st, 'moisture', String(m - 1)));
      else if (blocks[STATE_BLOCK[dim.getState(x, y + 1, z)]!]!.def.model !== 'crop') dim.setBlock(x, y, z, S('dirt'));
      return;
    }
    if (def.tags?.includes('leaves')) {
      if (getProp(st, 'persistent') === 'true') return;
      // distance to nearest log within 6
      let found = false;
      for (let dx = -4; dx <= 4 && !found; dx++) for (let dy = -4; dy <= 4 && !found; dy++) for (let dz = -4; dz <= 4 && !found; dz++) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 6) continue;
        if (blockHasTag(dim.getState(x + dx, y + dy, z + dz), 'logs')) found = true;
      }
      if (!found) this.breakNaturally(dim, x, y, z);
      return;
    }
    if (def.tags?.includes('saplings')) {
      if (this.lightAt(dim, x, y + 1, z) < 9 || !rng.chance(1 / 7)) return;
      if (getProp(st, 'stage') === '0') dim.setBlock(x, y, z, withProp(st, 'stage', '1'));
      else {
        const cheat = this.server.admin.blockMarked(dim, x, y, z);
        growTree(dim, x, y, z, id.replace('_sapling', ''), rng, (bx, by, bz, s) => {
          dim.setBlock(bx, by, bz, s);
          if (cheat) this.server.admin.setBlockMark(dim, bx, by, bz, true);
        });
      }
      return;
    }
    if (id === 'sugar_cane' || id === 'cactus') {
      if (dim.getState(x, y + 1, z) !== 0) return;
      let h = 1;
      while (STATE_BLOCK[dim.getState(x, y - h, z)] === STATE_BLOCK[st] && h < 4) h++;
      if (h >= 3) return;
      const age = parseInt(getProp(st, 'age')!, 10);
      if (age >= 15) {
        const ns = S(id);
        if (canSurvive(ns, { getState: (a, b, c) => (a === x && b === y + 1 && c === z ? 0 : dim.getState(a, b, c)) }, x, y + 1, z)) {
          dim.setBlock(x, y + 1, z, ns);
          if (this.server.admin.blockMarked(dim, x, y, z)) this.server.admin.setBlockMark(dim, x, y + 1, z, true);
        }
        dim.setBlock(x, y, z, withProp(st, 'age', '0'), { updateNeighbors: false });
      } else dim.setBlock(x, y, z, withProp(st, 'age', String(age + 1)), { updateNeighbors: false });
      return;
    }
    if (id === 'ice') {
      if ((dim.getLight(x, y, z) & 15) > 11 - (STATE_LIGHT[st] ?? 0)) dim.setBlock(x, y, z, dim.id === 'nether' ? 0 : this.water);
      return;
    }
    if (id === 'snow') {
      if ((dim.getLight(x, y, z) & 15) > 11) dim.setBlock(x, y, z, 0);
      return;
    }
    if (id === 'fire') {
      if (!this.server.level.rules.doFireTick) return;
      const age = parseInt(getProp(st, 'age')!, 10);
      if (this.server.level.raining && this.skyAt(dim, x, y, z) >= 15 && rng.chance(0.5)) {
        dim.setBlock(x, y, z, 0);
        return;
      }
      const below = dim.getState(x, y - 1, z);
      const eternal = blocks[STATE_BLOCK[below]!]!.id === 'netherrack' || blocks[STATE_BLOCK[below]!]!.id === 'magma_block';
      if (!eternal && age >= 15) {
        dim.setBlock(x, y, z, 0);
        return;
      }
      if (!eternal) dim.setBlock(x, y, z, withProp(st, 'age', String(Math.min(15, age + rng.range(1, 3)))), { updateNeighbors: false });
      // spread / burn neighbours
      for (let f = 0; f < 6; f++) {
        const nx = x + FACE_DX[f];
        const ny = y + FACE_DY[f];
        const nz = z + FACE_DZ[f];
        const n = dim.getState(nx, ny, nz);
        if (blocks[STATE_BLOCK[n]!]!.def.flammable && rng.chance(0.15)) {
          if (blocks[STATE_BLOCK[n]!]!.id === 'tnt') this.server.interaction.igniteTnt(dim, nx, ny, nz);
          else dim.setBlock(nx, ny, nz, rng.chance(0.5) ? withProp(this.fire, 'age', String(Math.min(15, age + 2))) : 0);
        }
      }
      if (!eternal && !canSurvive(st, dim, x, y, z)) dim.setBlock(x, y, z, 0);
      return;
    }
    if (id === 'redstone_ore' || id === 'deepslate_redstone_ore') {
      if (getProp(st, 'lit') === 'true') dim.setBlock(x, y, z, withProp(st, 'lit', 'false'));
      return;
    }
    if (id === 'smoldering_netherrack' && rng.chance(0.02)) {
      dim.setBlock(x, y, z, S('netherrack'));
      return;
    }
    if (id === 'kelp' || id === 'bamboo' || id === 'chorus_flower' || id === 'vine' || id === 'sweet_berry_bush') {
      this.server.interaction.growPlant(dim, x, y, z, st, rng);
    }
    void STATE_SOLID;
    void stateOf;
  }
}
