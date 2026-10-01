/**
 * V4: structures with objectives.
 *
 * - Sun monuments: set every lever on the obelisk to match the glyph above it
 *   (chiseled means on) and the sandstone seal over the chamber stairs breaks.
 * - Jungle shrines: light all four braziers on the top tier and the stone
 *   plugging the sanctum slides away.
 * - Bunkers: the keycard (always in the barracks footlocker) opens the
 *   security doors at the reader; bringing both generators online opens the
 *   blast door; reaching the vault completes the bunker.
 *
 * The objectives come from the generator (Start.quest), so nothing needs to
 * be stored at generation time; progress is kept in the level data.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { blocks, STATE_BLOCK, getProp, withProp } from '../../common/registry/blocks';
import { itemById } from '../../common/registry/items';
import type { Start, QuestSpec } from '../../common/gen/structures/manager';
import type { QuestInfo } from '../../common/net/protocol';
import type { QuestRecord } from '../world/LevelData';

type P3 = [number, number, number];

/** "about 9 blocks east" from one position to another. */
function where(from: P3, to: P3): string {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const d = Math.round(Math.hypot(dx, dz));
  const ns = dz < -Math.abs(dx) / 2 ? 'north' : dz > Math.abs(dx) / 2 ? 'south' : '';
  const ew = dx > Math.abs(dz) / 2 ? 'east' : dx < -Math.abs(dz) / 2 ? 'west' : '';
  return `about ${d} blocks ${ns}${ns && ew ? '-' : ''}${ew}`;
}
const same = (a: P3, x: number, y: number, z: number): boolean => a[0] === x && a[1] === y && a[2] === z;

/** Structures a player can find, for the explorer advancement. */
export const V4_FINDABLE = ['desert_oasis', 'sun_monument', 'buried_tomb', 'ranger_tower', 'hunter_camp', 'frozen_ruins', 'jungle_shrine', 'swamp_shack', 'stone_circle', 'lighthouse', 'mountain_lookout', 'prospector_camp', 'bunker', 'frost_temple', 'swamp_temple', 'badlands_temple', 'forest_temple', 'mountain_temple', 'desert_pyramid'];

export class StructureQuests {
  private readonly shown = new Map<ServerPlayer, string>();

  constructor(private readonly server: GameServer) {}

  private get on(): boolean {
    return this.server.level.generatorVersion >= 4;
  }

  static key(s: Start): string {
    return `${s.type}:${s.x},${s.y},${s.z}`;
  }

  record(s: Start): QuestRecord {
    const q = this.server.level.quests.bunker;
    return (q[StructureQuests.key(s)] ??= { stage: 0, done: false, rewarded: [], flags: [] });
  }

  /** Quest structures whose objective involves a position. */
  private startsAt(dim: Dimension, x: number, z: number): Start[] {
    if (dim.id !== 'overworld') return [];
    const g = dim.generator as { questStartsAt?(cx: number, cz: number): Start[] };
    return g.questStartsAt?.(x >> 4, z >> 4) ?? [];
  }

  /** A block changed: a lever flipped or a brazier lit may solve a puzzle. */
  onBlockChanged(dim: Dimension, x: number, y: number, z: number, state: number): void {
    if (!this.on) return;
    const id = blocks[STATE_BLOCK[state]!]!.id;
    if (id !== 'lever' && id !== 'campfire') return;
    for (const s of this.startsAt(dim, x, z)) {
      const q = s.quest!;
      if (q.kind === 'levers' && q.levers.some((l) => same(l.at, x, y, z))) this.checkLevers(dim, s, q);
      else if (q.kind === 'braziers' && q.braziers.some((b) => same(b, x, y, z))) this.checkBraziers(dim, s, q);
    }
  }

  private checkLevers(dim: Dimension, s: Start, q: Extract<QuestSpec, { kind: 'levers' }>): void {
    const rec = this.record(s);
    if (rec.done) return;
    for (const l of q.levers) if ((getProp(dim.getState(...l.at), 'powered') === 'true') !== l.on) return;
    this.solve(dim, s, q.door, 'The seal cracks open.');
  }

  private checkBraziers(dim: Dimension, s: Start, q: Extract<QuestSpec, { kind: 'braziers' }>): void {
    const rec = this.record(s);
    if (rec.done) return;
    for (const b of q.braziers) {
      const st = dim.getState(...b);
      if (blocks[STATE_BLOCK[st]!]!.id !== 'campfire' || getProp(st, 'lit') !== 'true') return;
    }
    this.solve(dim, s, q.door, 'The stone grinds aside.');
  }

  /** A puzzle is solved: open its door, tell everyone near, grant the advancement. */
  private solve(dim: Dimension, s: Start, door: P3[], text: string): void {
    const rec = this.record(s);
    rec.done = true;
    for (const d of door) {
      dim.setBlock(d[0], d[1], d[2], 0);
      this.server.particles(dim, 'block', d[0] + 0.5, d[1] + 0.5, d[2] + 0.5, 20, 0.5);
    }
    const [x, y, z] = door[0]!;
    this.server.playSound(dim, 'block.stone.break', x + 0.5, y + 0.5, z + 0.5, 1.2, 0.6);
    for (const p of this.server.players.values()) {
      if (p.dim !== dim || (p.x - x) ** 2 + (p.z - z) ** 2 > 32 * 32) continue;
      p.send({ t: 'title', text: 'Puzzle solved', sub: text, ticks: 50 });
      if (!this.server.admin.inContext(p)) this.server.interaction.grant(p, 'solve_puzzle');
    }
  }

  /** Right-clicking the bunker's machines. Returns true when handled. */
  useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const id = blocks[STATE_BLOCK[state]!]!.id;
    if (id !== 'keycard_reader' && id !== 'bunker_generator') return false;
    if (!this.on) return true;
    const s = this.startsAt(p.dim, x, z).find((t) => t.quest?.kind === 'bunker');
    const q = s?.quest as Extract<QuestSpec, { kind: 'bunker' }> | undefined;
    if (!s || !q) return true;
    const rec = this.record(s);
    const flags = (rec.flags ??= []);
    const dim = p.dim;
    if (id === 'keycard_reader') {
      if (flags.includes('card')) return true;
      const held = p.inventory.get(p.selectedSlot);
      const card = itemById.get('bunker_keycard')!.num;
      if (!held || held.id !== card) {
        p.send({ t: 'chat', text: 'ACCESS DENIED. Present a keycard.', kind: 'error' });
        this.server.playSound(dim, 'block.note.bass', x + 0.5, y + 0.5, z + 0.5, 0.8, 0.5);
        return true;
      }
      flags.push('card');
      dim.setBlock(x, y, z, withProp(state, 'lit', 'true'));
      for (const d of q.doors) {
        const ds = dim.getState(...d);
        const bt = blocks[STATE_BLOCK[ds]!]!;
        if (bt.def.model === 'door') dim.setBlock(d[0], d[1], d[2], withProp(ds, 'open', 'true'), { updateNeighbors: false });
        // Version 4.5 bunkers: the security gate is a blast door that slides away
        else if (bt.id === 'bunker_blast_door') {
          dim.setBlock(d[0], d[1], d[2], 0);
          this.server.particles(dim, 'smoke', d[0] + 0.5, d[1] + 0.5, d[2] + 0.5, 4, 0.4);
        }
      }
      this.server.playSound(dim, 'block.note.pling', x + 0.5, y + 0.5, z + 0.5, 1, 1.4);
      p.send({ t: 'chat', text: 'ACCESS GRANTED. Security doors open.', kind: 'system' });
      rec.stage = Math.max(rec.stage, 1);
      return true;
    }
    // A generator
    if (!flags.includes('card')) {
      p.send({ t: 'chat', text: 'The generator is locked out. Security is still active.', kind: 'error' });
      return true;
    }
    const tag = `gen:${x},${y},${z}`;
    if (flags.includes(tag)) return true;
    flags.push(tag);
    dim.setBlock(x, y, z, withProp(state, 'lit', 'true'));
    this.server.playSound(dim, 'block.piston.extend', x + 0.5, y + 0.5, z + 0.5, 1, 0.6);
    const online = q.generators.filter((g) => flags.includes(`gen:${g[0]},${g[1]},${g[2]}`)).length;
    rec.stage = Math.max(rec.stage, 1 + online);
    if (online < q.generators.length) {
      p.send({ t: 'chat', text: `Generator online (${online}/${q.generators.length}).`, kind: 'system' });
      return true;
    }
    for (const b of q.blast) {
      dim.setBlock(b[0], b[1], b[2], 0);
      this.server.particles(dim, 'smoke', b[0] + 0.5, b[1] + 0.5, b[2] + 0.5, 6, 0.4);
    }
    this.server.playSound(dim, 'block.iron_door.open', q.blast[0]![0], q.blast[0]![1], q.blast[0]![2], 1.5, 0.5);
    for (const pl of this.server.players.values()) if (pl.dim === dim && this.inside(pl, q)) pl.send({ t: 'title', text: 'POWER RESTORED', sub: 'The blast door is open', ticks: 60 });
    return true;
  }

  private inside(p: ServerPlayer, q: Extract<QuestSpec, { kind: 'bunker' }>): boolean {
    const a = q.area;
    return p.x >= a.x0 && p.x <= a.x1 + 1 && p.y >= a.y0 && p.y <= a.y1 + 1 && p.z >= a.z0 && p.z <= a.z1 + 1;
  }

  tick(): void {
    const s = this.server;
    if (!this.on || s.tickNo % 20 !== 5) return;
    for (const p of s.players.values()) {
      if (p.dead || p.dim.id !== 'overworld') {
        this.hud(p, null);
        continue;
      }
      const legit = p.gamemode !== 'spectator' && !s.admin.inContext(p);
      // Structure discovery
      const at = p.dim.generator.structureAt?.(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (at && legit && V4_FINDABLE.includes(at)) {
        const k = 'found.' + at;
        if (!p.statistics[k]) {
          p.addStat(k);
          if (at === 'sun_monument' || at === 'stone_circle') s.interaction.grant(p, 'find_monument');
          if (at === 'bunker') s.interaction.grant(p, 'find_bunker');
          const found = V4_FINDABLE.filter((t) => p.statistics['found.' + t]).length;
          if (found >= 8) s.interaction.grant(p, 'world_explorer');
        }
      }
      // The bunker's tracker
      const b = this.startsAt(p.dim, Math.floor(p.x), Math.floor(p.z)).find((t) => t.quest?.kind === 'bunker' && this.inside(p, t.quest));
      if (!b) {
        this.hud(p, null);
        continue;
      }
      const q = b.quest as Extract<QuestSpec, { kind: 'bunker' }>;
      const rec = this.record(b);
      const v = q.vault;
      if (!rec.done && (p.x - v[0] - 0.5) ** 2 + (p.z - v[2] - 0.5) ** 2 < 9 && Math.abs(p.y - v[1]) < 3 && q.generators.every((g) => rec.flags?.includes(`gen:${g[0]},${g[1]},${g[2]}`))) {
        rec.done = true;
        rec.stage = q.generators.length + 2;
        p.send({ t: 'title', text: 'BUNKER SECURED', sub: 'The vault is yours', ticks: 60 });
        if (legit) s.interaction.grant(p, 'bunker_quest');
      }
      this.hud(p, this.bunkerInfo(rec, q));
    }
  }

  bunkerInfo(rec: QuestRecord, q: Extract<QuestSpec, { kind: 'bunker' }>): QuestInfo {
    const flags = rec.flags ?? [];
    const online = q.generators.filter((g) => flags.includes(`gen:${g[0]},${g[1]},${g[2]}`)).length;
    let text: string;
    if (rec.done) text = 'Secured. The vault is open.';
    else if (!flags.includes('card')) text = q.cache && q.hatch ? `Find the keycard in the guard post's chest, ${where(q.hatch, q.cache)} of the hatch, and use it on the reader by the security gate.` : 'Find a keycard and use it on the reader by the security door.';
    else if (online < q.generators.length) text = `Bring the generators online (${online}/${q.generators.length}).`;
    else text = 'The blast door is open. Reach the vault.';
    const stages = q.generators.length + 2;
    return { title: 'Bunker', text, stage: rec.done ? stages : rec.stage, stages };
  }

  private hud(p: ServerPlayer, q: QuestInfo | null): void {
    // The Glitched Structure's tracker takes priority while its player is inside one
    if (this.server.glitchedQuest?.errorAt(p)) return;
    // ...and so does a temple's, while its player is inside one
    if (this.server.templeTrials?.showing(p)) return;
    const k = q ? JSON.stringify(q) : '';
    if ((this.shown.get(p) ?? '') === k) return;
    if (k) this.shown.set(p, k);
    else this.shown.delete(p);
    p.send({ t: 'quest', quest: q });
  }

  onLeave(p: ServerPlayer): void {
    this.shown.delete(p);
  }
}
