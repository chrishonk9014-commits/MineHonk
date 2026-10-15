/**
 * V7 - The Halloween Update, phase 3: trick-or-treating (the rules in
 * src/common/halloween/trickOrTreat.ts, candy and the sack in Candy.ts).
 *
 * - Tells each player which doors near them can be knocked on (only while
 *   Halloween is on), so their game can show the Knock prompt.
 * - A knock: checked here (the door is a recorded Trick-or-Treat door, in
 *   reach, from outside; a costume on the head; a sack with room), then
 *   answered by the door's record (DoorRecord, saved with the village):
 *     Candy Home: the candy goes into the knocker's sack at once, and their
 *     uuid onto the door's record (once each); then the door opens, a
 *     villager in a costume says hello and goodbye, and shuts it. The
 *     knocker's camera watches, letterboxed, and may skip; others nearby see
 *     the door and the villager.
 *     Trick Home: the door creaks, something grabs the knocker and drags them
 *     in (the Haunting's grab and drag, src/server/world/drag.ts), the door
 *     slams. Its monsters keep to the house and drop nothing; beat them all
 *     and a chest appears (the door's seed rolls it), once for everyone.
 *     Leave or die and it ends, monsters gone, to be tried again.
 * - The Trick or Treat! quest (each step read off the real game, saved per
 *   player), shown while Halloween is on and no other tracker needs the space.
 * - The Admin Panel's trick-or-treat controls. Everything they make or start
 *   is cheat-made and counts for nothing, and never uses up a real door.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import { Mob } from '../entity/Mob';
import { Random } from '../../common/math/rng';
import { stateOf, getProp, withProp, STATE_BLOCK, STATE_SOLID, STATE_FLUID, blocks } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { stackOf, markAdmin } from '../../common/game/itemstack';
import { WEARABLE_BLOCKS } from '../../common/halloween/heads';
import { CANDY_ITEM, CANDY_NAMES, rollCandyHome, type CandyKind } from '../../common/halloween/candy';
import {
  KNOCK_REACH,
  KNOCK_LIST_RANGE,
  NO_COSTUME_LINES,
  NO_SACK_LINES,
  FULL_SACK_LINES,
  ALREADY_LINES,
  BUSY_LINES,
  FIGHT_LINES,
  EMPTY_LINES,
  OVER_LINES,
  CANDY_TIMES,
  TRICK_TIMES,
  TRICK_EMPTY_TICKS,
  TRICK_ENCOUNTERS,
  TRICK_HEROBRINE,
  QUEST_STEPS,
  QUEST_TITLE,
  QUEST_CANDY,
  candySceneFor,
  handfulText,
  trickKindFor,
  pickLine,
  currentStep,
  type CandyScene,
  type TrickKind,
  type TrickEncounter,
  type QuestStep,
} from '../../common/halloween/trickOrTreat';
import type { DoorRecord, VillageRecord } from '../../common/halloween/villages';
import { floorNear, sendGrab, sendDrag, sendSceneEnd, ease } from '../world/drag';
import type { QuestInfo, SpeechTone } from '../../common/net/protocol';

/** In a Trick-or-Treat Village, for the quest: this near one of its doors (blocks). */
const QUEST_VILLAGE_NEAR = 24;
/** How often (ticks) the doors near each player and the quest are looked at. */
const CHECK_TICKS = 10;
/** Village records further than this from a player (blocks) are not searched for doors. */
const RECORD_RANGE = 220;
const FACING: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const PROFESSIONS = ['farmer', 'librarian', 'cleric', 'fisherman', 'shepherd', 'butcher', 'mason', 'toolsmith'];
/** Boss bar ids for Trick Homes (one per door being fought in). */
let nextBar = 9_100_000;

export interface DoorRef {
  /** The village record's key. */
  key: string;
  rec: VillageRecord;
  door: DoorRecord;
}

/** A Trick Home's rooms: the floor cells someone could stand in, and their bounds. */
export interface HouseBox {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  cells: [number, number, number][];
}

interface CandyRun {
  ref: DoorRef;
  id: string;
  p: ServerPlayer;
  t: number;
  scene: CandyScene;
  kinds: CandyKind[];
  villager: Mob | null;
  told: boolean;
  /** The house behind the door (null: not much of one), for keeping its people out of the doorway. */
  box: HouseBox | null;
}

interface TrickRun {
  ref: DoorRef;
  id: string;
  kind: TrickKind;
  enc: TrickEncounter;
  /** Who knocked (and was dragged in). */
  p: ServerPlayer;
  t: number;
  phase: 'opening' | 'fight' | 'won';
  /** Started from the Admin Panel (the door's record is never used up), or cheats played a part (the chest is cheat-made). */
  admin: boolean;
  cheat: boolean;
  box: HouseBox;
  from: [number, number, number];
  landing: [number, number, number];
  grabber: Mob | null;
  mobs: Mob[];
  killed: Set<Mob>;
  inside: Map<Mob, [number, number, number]>;
  party: Set<ServerPlayer>;
  empty: number;
  bar: Set<ServerPlayer>;
  barId: number;
  /** Herobrine's next blink and blow (ticks). */
  blinkAt: number;
  hitAt: number;
}

export class TrickOrTreatSystem {
  /** Randomness (replaceable in tests). */
  rng: { next(): number; int(n: number): number } = new Random();
  private readonly candyRuns = new Map<string, CandyRun>();
  private readonly trickRuns = new Map<string, TrickRun>();
  /** The door list each player was last sent, and the quest tracker shown. */
  private readonly sentDoors = new WeakMap<ServerPlayer, string>();
  private readonly shownQuest = new Map<ServerPlayer, string>();
  private readonly doneShown = new Map<ServerPlayer, number>();
  private tickNo = 0;

  constructor(private readonly server: GameServer) {}

  private say(p: ServerPlayer, text: string, tone: SpeechTone, who?: string, ticks = 70): void {
    p.send({ t: 'speech', text, tone, ticks, ...(who ? { who } : {}) });
  }

  private get active(): boolean {
    return this.server.halloweenState().active;
  }

  // ------------------------------------------------------------------ doors

  /** Recorded Trick-or-Treat doors within `r` blocks of (x, z). */
  doorsAround(x: number, z: number, r: number): DoorRef[] {
    const out: DoorRef[] = [];
    for (const [key, rec] of Object.entries(this.server.level.villages)) {
      if (rec.kind !== 'trick' || Math.abs(rec.x - x) > RECORD_RANGE || Math.abs(rec.z - z) > RECORD_RANGE) continue;
      for (const door of rec.doors) if (Math.abs(door.x + 0.5 - x) <= r && Math.abs(door.z + 0.5 - z) <= r) out.push({ key, rec, door });
    }
    return out;
  }

  /** The recorded door with a block at (x, y, z) (either half). */
  doorAt(x: number, y: number, z: number): DoorRef | null {
    for (const ref of this.doorsAround(x + 0.5, z + 0.5, 1)) {
      const d = ref.door;
      if (d.x === x && d.z === z && (y === d.y || y === d.y + 1)) return ref;
    }
    return null;
  }

  private idOf(ref: DoorRef): string {
    return `${ref.key}#${ref.door.id}`;
  }

  private isDoor(dim: Dimension, d: DoorRecord): boolean {
    return blocks[STATE_BLOCK[dim.getState(d.x, d.y, d.z)]!]?.def.model === 'door';
  }

  /** Opens or shuts a door (both halves). */
  private setDoor(dim: Dimension, d: DoorRecord, open: boolean, sound: string | null, pitch = 1, volume = 1): void {
    const st = dim.getState(d.x, d.y, d.z);
    if (blocks[STATE_BLOCK[st]!]?.def.model !== 'door') return;
    if ((getProp(st, 'open') === 'true') !== open) {
      dim.setBlock(d.x, d.y, d.z, withProp(st, 'open', open));
      const up = dim.getState(d.x, d.y + 1, d.z);
      if (STATE_BLOCK[up] === STATE_BLOCK[st]) dim.setBlock(d.x, d.y + 1, d.z, withProp(up, 'open', open));
    }
    if (sound) this.server.playSound(dim, sound, d.x + 0.5, d.y + 1, d.z + 0.5, volume, pitch);
  }

  /** Who is in a cutscene or a fight here. */
  private busy(p: ServerPlayer): boolean {
    for (const r of this.candyRuns.values()) if (r.p === p) return true;
    for (const r of this.trickRuns.values()) if (r.p === p && r.phase === 'opening') return true;
    return false;
  }

  /** Whether the player wears a costume (a head or a carved pumpkin on their head). */
  costumed(p: ServerPlayer): boolean {
    const hat = p.inventory.get(39);
    return !!hat && WEARABLE_BLOCKS.includes(items[hat.id]?.id ?? '');
  }

  // ------------------------------------------------------------------ knocking

  /**
   * A player knocked on the door at (x, y, z). `force` (the Admin Panel)
   * skips the season, the costume, the sack and the once-each rule, and
   * makes everything that comes of it cheat-made.
   */
  knock(p: ServerPlayer, x: number, y: number, z: number, force = false): { ok: boolean; text: string } {
    const s = this.server;
    if (p.dead || p.gamemode === 'spectator' || p.dim.id !== 'overworld' || this.busy(p)) return { ok: false, text: 'Not now.' };
    const ref = this.doorAt(x, y, z);
    if (!ref) return { ok: false, text: 'That is not a Trick-or-Treat door.' };
    const d = ref.door;
    const dim = p.dim;
    if (!this.isDoor(dim, d)) return { ok: false, text: 'The door is gone.' };
    const [fx, fz] = FACING[d.facing]!;
    // In reach, and on the outside (knocking from inside is just opening it)
    const eye = s.eyePos(p);
    const dist = Math.hypot(eye[0] - (d.x + 0.5), eye[1] - (d.y + 1), eye[2] - (d.z + 0.5));
    const outside = (p.x - (d.x + 0.5)) * fx + (p.z - (d.z + 0.5)) * fz > 0.2;
    if (!force && (dist > KNOCK_REACH + 0.75 || !outside)) return { ok: false, text: 'Too far from the door.' };
    // Everyone near hears the knock
    s.playSound(dim, 'door.knock', d.x + 0.5, d.y + 1, d.z + 0.5, 1, 1);
    const id = this.idOf(ref);
    const voice = (lines: readonly string[]): { ok: boolean; text: string } => {
      const line = pickLine(lines, this.rng);
      this.say(p, line, 'door', 'Behind the door');
      return { ok: false, text: line };
    };
    if (!force && !this.active) return voice(OVER_LINES);
    const trick = d.kind === 'trick';
    if (trick && this.trickRuns.has(id)) return voice(FIGHT_LINES);
    if (this.candyRuns.has(id)) return voice(BUSY_LINES);
    if (!force) {
      if (trick && d.used) return voice(EMPTY_LINES);
      if (!this.costumed(p)) return voice(NO_COSTUME_LINES);
      const candy = s.candy!;
      if (!candy.hasSack(p)) return voice(NO_SACK_LINES);
      if (candy.room(p) <= 0) return voice(FULL_SACK_LINES);
      if (!trick && d.got?.includes(p.uuid)) return voice(ALREADY_LINES);
    }
    const cheat = force || !!ref.rec.cheat || s.admin.inContext(p);
    // (the quest counts every answered door, cheats too: it is a guide, and rewards nothing)
    p.halloween.knocks++;
    if (trick) {
      this.startTrick(p, ref, trickKindFor(d.seed), force, cheat);
      return { ok: true, text: `Knocked on a Trick Home: ${TRICK_ENCOUNTERS[trickKindFor(d.seed)].name}.` };
    }
    const kinds = this.startCandy(p, ref, force, cheat);
    return { ok: true, text: `Knocked on a Candy Home: ${handfulText(kinds, CANDY_NAMES)}.` };
  }

  /**
   * Where the knocker's camera watches from (a step or so back from the door,
   * as far as there is room, so whoever answers is seen whole), and the point
   * it watches in the doorway.
   */
  private watch(p: ServerPlayer, d: DoorRecord): { eye: [number, number, number]; at: [number, number, number] } {
    const [ex, ey, ez] = this.server.eyePos(p);
    const [fx, fz] = FACING[d.facing]!;
    const dim = p.dim;
    let back = 0;
    for (let k = 0.3; k <= 1.5; k += 0.3) {
      const x = Math.floor(ex + fx * k);
      const z = Math.floor(ez + fz * k);
      if (STATE_SOLID[dim.getState(x, Math.floor(ey), z)] || STATE_SOLID[dim.getState(x, Math.floor(ey - 1), z)]) break;
      back = k;
    }
    return { eye: [ex + fx * back, ey, ez + fz * back], at: [d.x + 0.5, d.y + 1.45, d.z + 0.5] };
  }

  // ------------------------------------------------------------------ Candy Homes

  private startCandy(p: ServerPlayer, ref: DoorRef, force: boolean, cheat: boolean): CandyKind[] {
    const s = this.server;
    const d = ref.door;
    const kinds = rollCandyHome(this.rng);
    // The candy is the player's the moment the door is answered: skipped, left or not
    s.candy!.award(p, kinds, cheat);
    if (!force) {
      d.got = [...(d.got ?? []), p.uuid];
      d.used = true;
      s.villages?.markDirty();
    }
    p.halloween.candy += kinds.length;
    if (!cheat) {
      s.interaction.grant(p, 'first_candy');
      if (s.candy!.fullSack(p)) s.interaction.grant(p, 'full_sack');
    }
    p.addStat('trick_or_treat.candy', kinds.length);
    const run: CandyRun = { ref, id: this.idOf(ref), p, t: 0, scene: candySceneFor(d.seed, p.uuid), kinds, villager: null, told: false, box: this.house(p.dim, d) };
    this.candyRuns.set(run.id, run);
    if (run.box) this.clearResidents(p.dim, d, run.box, 'in');
    const w = this.watch(p, d);
    p.send({ t: 'fx', kind: 'scene', text: 'look', ticks: CANDY_TIMES.end, x: w.eye[0], y: w.eye[1], z: w.eye[2], x1: w.at[0], y1: w.at[1], z1: w.at[2], skip: true });
    return kinds;
  }

  private tickCandy(run: CandyRun): void {
    const s = this.server;
    const { p } = run;
    const d = run.ref.door;
    const dim = s.overworld;
    const T = CANDY_TIMES;
    run.t++;
    const t = run.t;
    if (!s.players.has(p.conn.id) || p.dead || p.dim !== dim) {
      this.endCandy(run, false);
      return;
    }
    const [fx, fz] = FACING[d.facing]!;
    const inX = d.x + 0.5 - fx * 0.9;
    const inZ = d.z + 0.5 - fz * 0.9;
    const atX = d.x + 0.5 - fx * 0.25;
    const atZ = d.z + 0.5 - fz * 0.25;
    if (run.box && t % 5 === 0 && t < T.close) this.clearResidents(dim, d, run.box, 'in', run.villager);
    if (t === T.open) this.setDoor(dim, d, true, 'door.open');
    if (t === T.appear) {
      const v = s.mobs?.spawn(dim, 'villager', inX, d.y, inZ, { reason: 'event', data: { trickScene: true, noDrops: true, untouchable: true, headwear: run.scene.head, profession: PROFESSIONS[this.rng.int(PROFESSIONS.length)] } });
      if (v) {
        v.noAi = true;
        v.persistent = false;
        v.persistenceRequired = true;
        v.yaw = Math.atan2(-(p.x - inX), -(p.z - inZ));
        v.headYaw = v.yaw;
        v.metaDirty = true;
        run.villager = v;
      }
    }
    const v = run.villager;
    if (v && !v.removed) {
      // Steps into the doorway, then back in
      const k = t <= T.greet ? ease((t - T.appear) / (T.greet - T.appear)) : t >= T.back ? 1 - ease((t - T.back) / (T.close - T.back)) : 1;
      v.setPos(inX + (atX - inX) * k, d.y, inZ + (atZ - inZ) * k);
      v.body.vx = v.body.vz = 0;
      v.yaw = Math.atan2(-(p.x - v.x), -(p.z - v.z));
      v.headYaw = v.yaw;
      v.metaDirty = true;
    }
    const who = 'Villager';
    if (t === T.greet) this.say(p, pickLine(run.scene.greet, this.rng), 'villager', who, 40);
    if (t === T.give) {
      this.say(p, `${pickLine(run.scene.give, this.rng)} (${handfulText(run.kinds, CANDY_NAMES)})`, 'villager', who, 50);
      run.told = true;
      if (v) {
        s.particles(dim, 'happy', v.x, v.y + 1.2, v.z, 8, 0.4);
        s.playSound(dim, 'candy.give', v.x, v.y + 1, v.z, 0.8, 1);
      }
    }
    if (t === T.bye) this.say(p, pickLine(run.scene.bye, this.rng), 'villager', who, 40);
    if (t >= T.close) {
      this.setDoor(dim, d, false, t === T.close ? 'door.close' : null);
      if (v && !v.removed) v.remove();
      run.villager = null;
    }
    if (t >= T.end) this.endCandy(run, true);
  }

  /** The door shut, the villager gone; `tell`: back to the game for the knocker. */
  private endCandy(run: CandyRun, tell: boolean): void {
    this.candyRuns.delete(run.id);
    if (run.villager && !run.villager.removed) run.villager.remove();
    this.setDoor(this.server.overworld, run.ref.door, false, null);
    if (tell && this.server.players.has(run.p.conn.id)) sendSceneEnd(run.p);
  }

  /** The player skipped their cutscene. */
  skip(p: ServerPlayer): void {
    for (const run of this.candyRuns.values()) {
      if (run.p !== p) continue;
      if (!run.told) this.say(p, `You got ${handfulText(run.kinds, CANDY_NAMES)}.`, 'info');
      this.endCandy(run, true);
      return;
    }
    for (const run of this.trickRuns.values()) {
      // A Trick Home's drag: straight to the slam
      if (run.p === p && run.phase === 'opening' && run.t >= TRICK_TIMES.grab) run.t = TRICK_TIMES.slam - 1;
    }
  }

  // ------------------------------------------------------------------ Trick Homes

  /**
   * A house's rooms behind a door: the floor cells reachable from just inside
   * it (feet and head clear), within 7 blocks and on the house's side of the
   * door. Null if it isn't a house any more (nothing inside, or it is open to
   * everything around).
   */
  house(dim: Dimension, d: DoorRecord): HouseBox | null {
    const [fx, fz] = FACING[d.facing]!;
    const open = (x: number, y: number, z: number): boolean => {
      const st = dim.getState(x, y, z);
      return !STATE_SOLID[st] && !STATE_FLUID[st];
    };
    const sx = d.x - fx;
    const sz = d.z - fz;
    if (!dim.isLoaded(sx, sz) || !open(sx, d.y, sz) || !open(sx, d.y + 1, sz)) return null;
    const seen = new Set<string>([`${sx},${sz}`]);
    const cells: [number, number, number][] = [];
    const queue: [number, number][] = [[sx, sz]];
    while (queue.length) {
      const [x, z] = queue.shift()!;
      cells.push([x, d.y, z]);
      if (cells.length > 160) return null;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const nz = z + dz;
        const k = `${nx},${nz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        // Behind the door's wall line, near the door
        if ((nx - d.x) * fx + (nz - d.z) * fz > -1) continue;
        if (Math.abs(nx - d.x) > 7 || Math.abs(nz - d.z) > 7) continue;
        if (!dim.isLoaded(nx, nz) || !open(nx, d.y, nz) || !open(nx, d.y + 1, nz)) continue;
        queue.push([nx, nz]);
      }
    }
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, , z] of cells) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    return { x0, z0, x1, z1, y0: d.y - 1, y1: d.y + 9, cells };
  }

  /** Whether a position is inside a house's rooms (`pad` blocks to spare). */
  static inHouse(b: HouseBox, x: number, y: number, z: number, pad = 0): boolean {
    return x >= b.x0 - pad && x <= b.x1 + 1 + pad && z >= b.z0 - pad && z <= b.z1 + 1 + pad && y >= b.y0 - 1 && y <= b.y1 + 1;
  }

  /** Starts a Trick Home's encounter at a door (the knock was accepted, or the Admin Panel asked). */
  startTrick(p: ServerPlayer, ref: DoorRef, kind: TrickKind, admin: boolean, cheat: boolean): TrickRun | null {
    const dim = p.dim;
    const d = ref.door;
    const box = this.house(dim, d) ?? this.fallbackBox(d);
    const [fx, fz] = FACING[d.facing]!;
    // Pulled about three blocks in
    const want: [number, number] = [d.x - fx * 3, d.z - fz * 3];
    const landing = [...box.cells].sort((a, b) => Math.hypot(a[0] - want[0], a[2] - want[1]) - Math.hypot(b[0] - want[0], b[2] - want[1]))[0] ?? [d.x - fx, d.y, d.z - fz];
    const run: TrickRun = {
      ref,
      id: this.idOf(ref),
      kind,
      enc: TRICK_ENCOUNTERS[kind],
      p,
      t: 0,
      phase: 'opening',
      admin,
      cheat,
      box,
      from: [p.x, p.y, p.z],
      landing: [landing[0] + 0.5, landing[1], landing[2] + 0.5],
      grabber: null,
      mobs: [],
      killed: new Set(),
      inside: new Map(),
      party: new Set([p]),
      empty: 0,
      bar: new Set(),
      barId: nextBar++,
      blinkAt: 0,
      hitAt: 0,
    };
    this.trickRuns.set(run.id, run);
    this.clearResidents(dim, d, box, 'out');
    return run;
  }

  /**
   * The people who live behind a door, out of the way while it is answered
   * (V7 phase 3). A Trick Home's go a few steps behind whoever knocked, out
   * of sight of the door (`out`); a Candy Home's step back from the doorway
   * into the house, so whoever answers stands there alone (`in`). Villagers
   * never open doors, so once one is shut they stay where they are.
   */
  private clearResidents(dim: Dimension, d: DoorRecord, box: HouseBox, where: 'out' | 'in', keep?: Mob | null): void {
    const [fx, fz] = FACING[d.facing]!;
    const players = [...this.server.players.values()].filter((p) => p.dim === dim);
    const free = (x: number, z: number): boolean => !players.some((p) => Math.hypot(p.x - x, p.z - z) < 1.2);
    let deeper = 0;
    for (const e of dim.entities.values()) {
      if (!(e instanceof Mob) || e === keep || e.removed || e.dead || e.type !== 'villager' || e.data.trickScene) continue;
      if (Math.abs(e.x - d.x) > 12 || Math.abs(e.z - d.z) > 12 || Math.abs(e.y - d.y) > 6) continue;
      const doorway = Math.floor(e.x) === d.x && Math.floor(e.z) === d.z && Math.abs(e.y - d.y) < 2;
      const inside = TrickOrTreatSystem.inHouse(box, e.x, e.y, e.z, 0.3);
      // (a Candy Home's own people only need to be out of the doorway and the step inside it)
      if (where === 'in' ? !doorway && !(inside && Math.hypot(e.x - (d.x + 0.5), e.z - (d.z + 0.5)) < 2.2) : !doorway && !inside) continue;
      let spot: [number, number, number] | null = null;
      if (where === 'out') {
        for (const back of [4, 5, 3, 6]) {
          for (const side of [0, 2, -2, 3, -3]) {
            const x = d.x + fx * back - fz * side;
            const z = d.z + fz * back + fx * side;
            const y = floorNear(dim, x, z, d.y, 3);
            if (y === null || TrickOrTreatSystem.inHouse(box, x + 0.5, y, z + 0.5, 1) || !free(x + 0.5, z + 0.5)) continue;
            spot = [x + 0.5, y, z + 0.5];
            break;
          }
          if (spot) break;
        }
      } else {
        // The far side of the house, one to a spot
        const far = box.cells.filter((c) => Math.hypot(c[0] - d.x, c[2] - d.z) >= 2.5).sort((a, b) => Math.hypot(b[0] - d.x, b[2] - d.z) - Math.hypot(a[0] - d.x, a[2] - d.z));
        const c = far[deeper++ % Math.max(1, far.length)];
        if (c) spot = [c[0] + 0.5, c[1], c[2] + 0.5];
      }
      if (!spot) continue;
      e.stopNavigation();
      e.setPos(spot[0], spot[1], spot[2]);
      e.body.vx = e.body.vz = 0;
      e.metaDirty = true;
    }
  }

  private fallbackBox(d: DoorRecord): HouseBox {
    const [fx, fz] = FACING[d.facing]!;
    const cells: [number, number, number][] = [];
    for (let a = 1; a <= 4; a++) for (let b = -2; b <= 2; b++) cells.push([d.x - fx * a + (fz !== 0 ? b : 0), d.y, d.z - fz * a + (fx !== 0 ? b : 0)]);
    const xs = cells.map((c) => c[0]);
    const zs = cells.map((c) => c[2]);
    return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs), y0: d.y - 1, y1: d.y + 9, cells };
  }

  /** Spawns one of a Trick Home's monsters at a cell (kept to the house, dropping nothing, never saved). */
  private spawnTrickMob(run: TrickRun, type: string, x: number, y: number, z: number): Mob | null {
    const s = this.server;
    const box = run.box;
    const guard = { x0: box.x0, z0: box.z0, x1: box.x1, z1: box.z1, y: box.y0 + 1, leash: 0 };
    const herobrine = type === 'herobrine';
    const m = s.mobs?.spawn(run.p.dim, type, x, y, z, { reason: 'event', data: { trickHome: run.id, noDrops: true, guard, ...(herobrine ? { hbAnim: 'idle' } : {}) } });
    if (!m) return null;
    m.persistent = false;
    m.persistenceRequired = true;
    m.admin = run.cheat;
    if (herobrine) {
      // Not the boss: a short fight, driven from here
      m.noAi = true;
      const n = Math.max(1, run.party.size);
      m.maxHealth = TRICK_HEROBRINE.health + TRICK_HEROBRINE.perPlayer * (n - 1);
      m.health = m.maxHealth;
    }
    m.metaDirty = true;
    run.mobs.push(m);
    run.inside.set(m, [x, y, z]);
    return m;
  }

  private tickTrick(run: TrickRun): void {
    const s = this.server;
    const dim = run.p.dim;
    const d = run.ref.door;
    const T = TRICK_TIMES;
    run.t++;
    const t = run.t;
    if (run.phase === 'opening') {
      const p = run.p;
      if (!s.players.has(p.conn.id) || p.dead || p.dim !== dim) {
        this.endTrick(run, 'left');
        return;
      }
      const [fx, fz] = FACING[d.facing]!;
      if (t % 5 === 0) this.clearResidents(dim, d, run.box, 'out');
      if (t === T.creak) this.setDoor(dim, d, true, 'door.creak', 0.8);
      if (t === T.appear) {
        const g = this.spawnTrickMob(run, run.enc.grab, d.x + 0.5 - fx * 0.6, d.y, d.z + 0.5 - fz * 0.6);
        if (g) {
          g.noAi = true;
          g.yaw = Math.atan2(-(p.x - g.x), -(p.z - g.z));
          g.headYaw = g.yaw;
          g.metaDirty = true;
          run.grabber = g;
        }
        s.playSound(dim, run.kind === 'herobrine' ? 'herobrine.charge' : 'trick.sting', d.x + 0.5, d.y + 1, d.z + 0.5, 1.2, 1);
      }
      if (t === T.grab) {
        const g = run.grabber;
        sendGrab(p, g?.x ?? d.x + 0.5, (g?.y ?? d.y) + 1.6, g?.z ?? d.z + 0.5, T.drag - T.grab, true);
        p.send({ t: 'fx', kind: 'shake', strength: 0.7, ticks: 10 });
        if (run.kind === 'herobrine') p.send({ t: 'fx', kind: 'glitch', strength: 0.6, ticks: 12 });
      }
      if (t === T.drag) {
        run.from = [p.x, p.y, p.z];
        sendDrag(p, run.from, run.landing, T.dragTicks, true, true);
      }
      if (t > T.drag && t < T.slam && run.grabber && !run.grabber.removed) {
        // It walks backwards into the house ahead of them, pulling
        const k = ease((t - T.drag) / T.dragTicks);
        const g = run.grabber;
        const [lx, , lz] = run.landing;
        const sx = d.x + 0.5 - fx * 0.6;
        const sz = d.z + 0.5 - fz * 0.6;
        const ex = lx - fx * 1.2;
        const ez = lz - fz * 1.2;
        const gx = sx + (ex - sx) * k;
        const gz = sz + (ez - sz) * k;
        const gy = floorNear(dim, Math.floor(gx), Math.floor(gz), d.y, 1) ?? d.y;
        g.setPos(gx, gy, gz);
        g.body.vx = g.body.vz = 0;
        // Backwards, facing whoever it pulls
        g.yaw = Math.atan2(-fx, -fz);
        g.headYaw = g.yaw;
        g.metaDirty = true;
      }
      if (t >= T.slam) this.slam(run);
      return;
    }
    if (run.phase === 'won') {
      if (t > 40) this.trickRuns.delete(run.id);
      return;
    }
    // ---- the fight
    const party = [...s.players.values()].filter((p) => p.dim === dim && !p.dead && p.gamemode !== 'spectator' && TrickOrTreatSystem.inHouse(run.box, p.x, p.y, p.z, 0.2));
    for (const p of party) {
      if (!run.party.has(p)) run.party.add(p);
      if (s.admin.inContext(p)) run.cheat = true;
    }
    // (anyone opening the door to get out lets the street in)
    if (t % 10 === 0) this.clearResidents(dim, d, run.box, 'out');
    run.empty = party.length ? 0 : run.empty + 1;
    if (run.empty >= TRICK_EMPTY_TICKS) {
      this.endTrick(run, 'left');
      return;
    }
    const alive = run.mobs.filter((m) => !m.removed && !m.dead);
    // Gone some other way than being beaten (a chunk unloading, peaceful): it is over, to be tried again
    if (!alive.length && run.mobs.some((m) => !run.killed.has(m))) {
      this.endTrick(run, 'left');
      return;
    }
    if (!alive.length) {
      this.win(run);
      return;
    }
    for (const m of alive) {
      // Kept to the house
      if (!TrickOrTreatSystem.inHouse(run.box, m.x, m.y, m.z, -0.1)) {
        const back = run.inside.get(m);
        if (back) m.setPos(back[0], back[1], back[2]);
        m.body.vx = m.body.vz = 0;
        m.stopNavigation();
      } else run.inside.set(m, [m.x, m.y, m.z]);
      // Only those inside are fair game
      if (m.target && (!party.includes(m.target as ServerPlayer) || (m.target as ServerPlayer).dead)) m.target = null;
      if (!m.target && party.length) {
        m.target = party.reduce((a, b) => (a.distanceSq(m.x, m.y, m.z) <= b.distanceSq(m.x, m.y, m.z) ? a : b));
        m.metaDirty = true;
      }
      if (m.type === 'herobrine') this.herobrineTurn(run, m, party);
    }
    this.bars(run, alive.length);
  }

  /** The door slams behind them; the fight begins. */
  private slam(run: TrickRun): void {
    const s = this.server;
    const p = run.p;
    const d = run.ref.door;
    const dim = p.dim;
    const [fx, fz] = FACING[d.facing]!;
    const [lx, ly, lz] = run.landing;
    // Turned round to face whatever is in there with them
    s.teleport(p, lx, ly, lz, Math.atan2(fx, fz));
    sendSceneEnd(p);
    this.setDoor(dim, d, false, 'door.slam', 0.8, 1.6);
    for (const o of s.players.values()) if (o.dim === dim && o.distanceSq(d.x, d.y, d.z) < 24 * 24) o.send({ t: 'fx', kind: 'shake', strength: 0.5, ticks: 8 });
    // The rest of them, deeper in the house, away from the door
    const far = [...run.box.cells].sort((a, b) => Math.hypot(b[0] - d.x, b[2] - d.z) - Math.hypot(a[0] - d.x, a[2] - d.z));
    const rest = run.enc.mobs.slice(run.grabber ? 1 : 0);
    rest.forEach((type, i) => {
      const c = far[i % Math.max(1, far.length)] ?? [lx, ly, lz];
      this.spawnTrickMob(run, type, c[0] + 0.5, c[1], c[2] + 0.5);
    });
    if (run.grabber && run.kind !== 'herobrine') run.grabber.noAi = false;
    for (const m of run.mobs) {
      m.target = p;
      m.metaDirty = true;
    }
    run.phase = 'fight';
    run.t = 0;
    run.blinkAt = 30;
    run.hitAt = 20;
    if (run.kind === 'herobrine') {
      p.send({ t: 'fx', kind: 'haunt', strength: 0.55 });
      this.say(p, 'YOU SHOULD NOT HAVE KNOCKED', 'scare', 'Herobrine', 50);
      s.playSound(dim, 'herobrine.whisper', lx, ly + 1, lz, 1, 0.7);
    } else this.say(p, `${run.enc.name}!`, 'scare', undefined, 40);
  }

  /** Herobrine in a Trick Home: he blinks about the room and hits hard, but not for long. */
  private herobrineTurn(run: TrickRun, m: Mob, party: ServerPlayer[]): void {
    const s = this.server;
    const target = (m.target as ServerPlayer | null) ?? party[0];
    if (!target) return;
    m.yaw = Math.atan2(-(target.x - m.x), -(target.z - m.z));
    m.headYaw = m.yaw;
    m.metaDirty = true;
    const t = run.t;
    const d = Math.hypot(target.x - m.x, target.z - m.z);
    if (t >= run.hitAt && d < 2.2 && Math.abs(target.y - m.y) < 2) {
      run.hitAt = t + TRICK_HEROBRINE.hitEvery;
      s.interaction.survival.damage(target, TRICK_HEROBRINE.damage, { source: 'mob', attacker: m });
      s.playSound(m.dim, 'herobrine.slam', m.x, m.y + 1, m.z, 0.8, 1.2);
      m.data.hbAnim = 'attack';
    } else if (t >= run.hitAt - TRICK_HEROBRINE.hitEvery + 10) m.data.hbAnim = 'idle';
    if (t >= run.blinkAt) {
      run.blinkAt = t + TRICK_HEROBRINE.blinkMin + this.rng.int(TRICK_HEROBRINE.blinkMax - TRICK_HEROBRINE.blinkMin + 1);
      // Right behind them, or the nearest spot to it
      const bx = target.x + Math.sin(target.yaw) * 1.6;
      const bz = target.z + Math.cos(target.yaw) * 1.6;
      const c = [...run.box.cells].sort((a, b) => Math.hypot(a[0] + 0.5 - bx, a[2] + 0.5 - bz) - Math.hypot(b[0] + 0.5 - bx, b[2] + 0.5 - bz))[0];
      if (c) {
        s.particles(m.dim, 'glitch', m.x, m.y + 1, m.z, 16, 0.4);
        m.setPos(c[0] + 0.5, c[1], c[2] + 0.5);
        run.inside.set(m, [m.x, m.y, m.z]);
        for (const p of party) p.send({ t: 'fx', kind: 'glitch', strength: 0.4, ticks: 6 });
        s.playSound(m.dim, 'herobrine.whisper', m.x, m.y + 1, m.z, 0.8, 0.8 + this.rng.next() * 0.3);
        // Close enough to hit straight away, a moment later
        run.hitAt = Math.max(run.hitAt, t + 10);
      }
    }
  }

  private bars(run: TrickRun, alive: number): void {
    const s = this.server;
    const d = run.ref.door;
    const title = `${run.enc.title}: ${alive} left`;
    const progress = alive / Math.max(1, run.mobs.length);
    for (const p of s.players.values()) {
      const near = p.dim === run.p.dim && p.distanceSq(d.x, d.y, d.z) < 24 * 24;
      if (near && !run.bar.has(p)) {
        run.bar.add(p);
        p.send({ t: 'boss', id: run.barId, action: 'add', title, progress, color: run.kind === 'herobrine' ? 'herobrine' : 'halloween' });
      } else if (near) {
        if (s.tickNo % 10 === 0) p.send({ t: 'boss', id: run.barId, action: 'update', title, progress });
      } else if (run.bar.has(p)) {
        run.bar.delete(p);
        p.send({ t: 'boss', id: run.barId, action: 'remove' });
      }
    }
  }

  private clearBars(run: TrickRun): void {
    for (const p of run.bar) if (this.server.players.has(p.conn.id)) p.send({ t: 'boss', id: run.barId, action: 'remove' });
    run.bar.clear();
    if (run.kind === 'herobrine') for (const p of run.party) if (this.server.players.has(p.conn.id)) p.send({ t: 'fx', kind: 'haunt', strength: 0 });
  }

  /** A Trick Home's monster fell (Mobs.onMobDeath). */
  onMobDeath(m: Mob, killer?: ServerPlayer | null, cheatKill = false): void {
    const run = this.trickRuns.get(String(m.data.trickHome));
    if (!run) return;
    run.killed.add(m);
    if (cheatKill || (killer && this.server.admin.inContext(killer))) run.cheat = true;
    // Herobrine goes the way his apparitions do
    if (m.type === 'herobrine') {
      this.server.particles(m.dim, 'glitch', m.x, m.y + 1, m.z, 40, 0.6);
      this.server.playSound(m.dim, 'herobrine.death', m.x, m.y + 1, m.z, 1.2, 1.3);
    }
  }

  /** Every monster beaten: the house falls quiet, a chest appears, the door opens. */
  private win(run: TrickRun): void {
    const s = this.server;
    const d = run.ref.door;
    const dim = run.p.dim;
    run.phase = 'won';
    run.t = 0;
    this.clearBars(run);
    const chest = this.placeChest(run);
    this.setDoor(dim, d, true, 'door.creak', 1.1);
    const herobrine = run.kind === 'herobrine';
    for (const p of run.party) {
      if (!s.players.has(p.conn.id)) continue;
      this.say(p, herobrine ? 'He was never here. Something was left behind...' : 'The house falls quiet. A chest creaks open...', 'info', undefined, 80);
      if (run.cheat || run.admin) continue;
      p.halloween.tricks++;
      s.interaction.grant(p, 'beat_trick_home');
      if (herobrine) s.interaction.grant(p, 'herobrine_trick');
    }
    if (chest) s.playSound(dim, 'chest.open', chest[0] + 0.5, chest[1] + 0.5, chest[2] + 0.5, 1, 0.9);
    // Once per home, for everyone (a run the panel started never uses a real door up)
    if (!run.admin) {
      d.used = true;
      s.villages?.markDirty();
    }
  }

  /** The chest: as far from the door as there is room for, on the floor, never beside another chest. */
  private placeChest(run: TrickRun): [number, number, number] | null {
    const s = this.server;
    const d = run.ref.door;
    const dim = run.p.dim;
    const isChest = (x: number, y: number, z: number): boolean => blocks[STATE_BLOCK[dim.getState(x, y, z)]!]?.id === 'chest';
    const cells = [...run.box.cells].sort((a, b) => Math.hypot(b[0] - d.x, b[2] - d.z) - Math.hypot(a[0] - d.x, a[2] - d.z));
    for (const [x, y, z] of cells) {
      if (dim.getState(x, y, z) !== 0 || !STATE_SOLID[dim.getState(x, y - 1, z)]) continue;
      if (isChest(x + 1, y, z) || isChest(x - 1, y, z) || isChest(x, y, z + 1) || isChest(x, y, z - 1)) continue;
      // Nobody standing in it
      if ([...s.players.values()].some((p) => p.dim === dim && Math.floor(p.x) === x && Math.floor(p.z) === z && Math.abs(p.y - y) < 2)) continue;
      // Facing the door, so it is the first thing seen coming in
      dim.setBlock(x, y, z, stateOf('chest', { facing: d.facing }));
      dim.setBlockEntity(x, y, z, { type: 'chest', loot: run.enc.loot, lootSeed: (d.seed ^ 0x7c4e57) >>> 0 });
      // Cheat-made if cheats had a part (its loot is marked when it fills)
      if (run.cheat || run.admin) s.admin.setBlockMark(dim, x, y, z, true);
      return [x, y, z];
    }
    return null;
  }

  /** It ends without a win: its monsters go, nothing is used up, it can be tried again. */
  private endTrick(run: TrickRun, why: 'left' | 'stopped'): void {
    void why;
    this.trickRuns.delete(run.id);
    for (const m of run.mobs) if (!m.removed) m.remove();
    this.clearBars(run);
    if (run.phase === 'opening' && this.server.players.has(run.p.conn.id)) sendSceneEnd(run.p);
    this.setDoor(run.p.dim, run.ref.door, false, null);
  }

  /** A player left the world: their cutscene ends (a Trick Home they were alone in ends a moment later). */
  onLeave(p: ServerPlayer): void {
    for (const run of [...this.candyRuns.values()]) if (run.p === p) this.endCandy(run, false);
    for (const run of [...this.trickRuns.values()]) if (run.p === p && run.phase === 'opening') this.endTrick(run, 'left');
    this.shownQuest.delete(p);
    this.doneShown.delete(p);
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    this.tickNo++;
    for (const run of [...this.candyRuns.values()]) this.tickCandy(run);
    for (const run of [...this.trickRuns.values()]) this.tickTrick(run);
    if (this.tickNo % CHECK_TICKS !== 0) return;
    for (const p of this.server.players.values()) {
      this.sendDoors(p);
      this.quest(p);
    }
  }

  /** The doors near a player that can be knocked on (none when Halloween is off). */
  private sendDoors(p: ServerPlayer): void {
    const list: [number, number, number, string][] = [];
    if (this.active && p.dim.id === 'overworld' && !p.dead) for (const ref of this.doorsAround(p.x, p.z, KNOCK_LIST_RANGE)) list.push([ref.door.x, ref.door.y, ref.door.z, ref.door.facing]);
    const key = list.map((d) => d.join(',')).join(';');
    if ((this.sentDoors.get(p) ?? '') === key) return;
    this.sentDoors.set(p, key);
    p.send({ t: 'knock_doors', doors: list });
  }

  // ------------------------------------------------------------------ the quest

  /**
   * Whether a quest step is done right now, read off the game. The quest is a
   * guide (it rewards nothing), so it works in Creative and with cheats like
   * the other trackers: a sack or a costume from the creative menu or the
   * Admin Panel counts, and so does an Admin Panel village. The advancements
   * along the way stay honest (Interaction.grant).
   */
  stepDone(p: ServerPlayer, step: QuestStep): boolean {
    const candy = this.server.candy!;
    const has = (pred: (id: string) => boolean): boolean => {
      for (let i = 0; i <= 40; i++) {
        const st = p.inventory.get(i);
        if (st && pred(items[st.id]!.id)) return true;
      }
      return false;
    };
    switch (step) {
      case 'sack':
        return has((id) => id === items[candy.sackNum]!.id);
      case 'costume':
        return has((id) => WEARABLE_BLOCKS.includes(id));
      case 'wear':
        return this.costumed(p);
      case 'village':
        return p.achievements.has('find_trick_village') || (p.dim.id === 'overworld' && this.doorsAround(p.x, p.z, QUEST_VILLAGE_NEAR).length > 0);
      case 'knock':
        return p.halloween.knocks > 0;
      case 'candy':
        return p.halloween.candy >= QUEST_CANDY;
    }
  }

  /** The tracker for a player (null: hidden). */
  questInfo(p: ServerPlayer): QuestInfo | null {
    const pr = p.halloween;
    const step = currentStep(pr);
    if (!step) return null;
    const i = QUEST_STEPS.findIndex((q) => q.id === step);
    const def = QUEST_STEPS[i]!;
    const text = step === 'candy' ? `${def.text} (${Math.min(pr.candy, QUEST_CANDY)}/${QUEST_CANDY})` : def.text;
    return { title: QUEST_TITLE, text, stage: i, stages: QUEST_STEPS.length, ...(step === 'candy' ? { remaining: Math.max(0, QUEST_CANDY - pr.candy) } : {}) };
  }

  /** Moves a player's quest on (steps in order, each staying done) and shows it while Halloween is on. */
  private quest(p: ServerPlayer): void {
    const s = this.server;
    const pr = p.halloween;
    if (this.active && !p.dead && p.gamemode !== 'spectator') {
      for (let step = currentStep(pr); step && this.stepDone(p, step); step = currentStep(pr)) pr.steps.push(step);
      if (!currentStep(pr) && !pr.done) {
        pr.done = true;
        this.doneShown.set(p, this.tickNo);
        p.send({ t: 'title', text: 'Trick or Treat!', sub: 'Quest complete. Happy Halloween!', ticks: 80 });
        p.send({ t: 'sound', name: 'music.discovery', x: p.x, y: p.y + 1, z: p.z, volume: 1, pitch: 1.2 });
      }
    }
    let q: QuestInfo | null = this.active ? this.questInfo(p) : null;
    const doneAt = this.doneShown.get(p);
    if (this.active && !q && doneAt !== undefined) {
      if (this.tickNo - doneAt < 200) q = { title: QUEST_TITLE, text: 'Done! Happy Halloween!', stage: QUEST_STEPS.length, stages: QUEST_STEPS.length };
      else this.doneShown.delete(p);
    }
    // Other trackers (a structure's, a temple's, the End's) have the space while they need it
    if (s.glitchedQuest?.showing(p) || s.templeTrials?.showing(p) || s.structureQuests?.showing(p) || s.endQuests?.showing(p)) {
      this.shownQuest.delete(p);
      return;
    }
    const k = q ? JSON.stringify(q) : '';
    if ((this.shownQuest.get(p) ?? '') === k) return;
    if (k) this.shownQuest.set(p, k);
    else this.shownQuest.delete(p);
    p.send({ t: 'quest', quest: q });
  }

  // ------------------------------------------------------------------ Admin Panel

  /** The nearest recorded door within `r` blocks (of a kind, if given). */
  nearestDoor(p: ServerPlayer, r: number, kind?: 'candy' | 'trick'): DoorRef | null {
    let best: DoorRef | null = null;
    let bd = r * r;
    for (const ref of this.doorsAround(p.x, p.z, r)) {
      if (kind && ref.door.kind !== kind) continue;
      const dd = (ref.door.x + 0.5 - p.x) ** 2 + (ref.door.z + 0.5 - p.z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = ref;
      }
    }
    return best;
  }

  /** Puts a player at a door's step, facing it. */
  private toDoor(p: ServerPlayer, d: DoorRecord): void {
    const [fx, fz] = FACING[d.facing]!;
    const [ox, oy, oz] = d.out;
    // Facing back along the door's own way out, i.e. at the door
    this.server.admin.moveTo(p, 'overworld', ox + 0.5, oy, oz + 0.5, Math.atan2(fx, fz));
  }

  /** The Admin Panel: knock on the nearest door, ignoring every requirement. */
  adminKnock(p: ServerPlayer): { ok: boolean; text: string } {
    if (p.dim.id !== 'overworld') return { ok: false, text: 'Trick-or-Treat Villages are in the Overworld.' };
    const ref = this.nearestDoor(p, 48);
    if (!ref) return { ok: false, text: 'No Trick-or-Treat Village door within 48 blocks.' };
    if (this.trickRuns.has(this.idOf(ref)) || this.candyRuns.has(this.idOf(ref))) return { ok: false, text: 'Something is already happening at that door.' };
    this.toDoor(p, ref.door);
    return this.knock(p, ref.door.x, ref.door.y, ref.door.z, true);
  }

  /** The Admin Panel: a Trick Home's encounter of a chosen kind at the nearest door. */
  adminTrick(p: ServerPlayer, kind: TrickKind): { ok: boolean; text: string } {
    if (p.dim.id !== 'overworld') return { ok: false, text: 'Trick-or-Treat Villages are in the Overworld.' };
    const ref = this.nearestDoor(p, 48, 'trick') ?? this.nearestDoor(p, 48);
    if (!ref) return { ok: false, text: 'No Trick-or-Treat Village door within 48 blocks.' };
    if (this.trickRuns.has(this.idOf(ref)) || this.candyRuns.has(this.idOf(ref))) return { ok: false, text: 'Something is already happening at that door.' };
    if (!this.isDoor(p.dim, ref.door)) return { ok: false, text: 'That door is gone.' };
    this.toDoor(p, ref.door);
    this.server.playSound(p.dim, 'door.knock', ref.door.x + 0.5, ref.door.y + 1, ref.door.z + 0.5, 1, 1);
    this.startTrick(p, ref, kind, true, true);
    return { ok: true, text: `Started "${TRICK_ENCOUNTERS[kind].name}" at door ${ref.door.id + 1} (cheat-made: the door's real chest is untouched).` };
  }

  /** The Admin Panel: the nearest village's doors as if nobody had knocked (candy given, Trick Homes beaten). */
  adminReset(p: ServerPlayer): { ok: boolean; text: string } {
    const ref = this.nearestDoor(p, 160);
    if (!ref) return { ok: false, text: 'No Trick-or-Treat Village within 160 blocks.' };
    let n = 0;
    for (const d of ref.rec.doors) {
      if (d.used || d.got?.length) n++;
      d.used = false;
      delete d.got;
    }
    for (const run of [...this.trickRuns.values()]) if (run.ref.key === ref.key) this.endTrick(run, 'stopped');
    for (const run of [...this.candyRuns.values()]) if (run.ref.key === ref.key) this.endCandy(run, true);
    this.server.villages?.markDirty();
    return { ok: true, text: `Reset the ${ref.rec.doors.length} doors of the nearest village (${n} had been knocked on).` };
  }

  /** The Admin Panel: a sack (empty or full) and candy, all cheat-made. */
  adminGive(p: ServerPlayer, what: 'sack' | 'full_sack' | CandyKind): { ok: boolean; text: string } {
    const s = this.server;
    const candy = s.candy!;
    let st;
    let text: string;
    if (what === 'sack' || what === 'full_sack') {
      st = what === 'sack' ? markAdmin(stackOf(items[candy.sackNum]!.id)) : candy.makeSack({ regular: 80, big: 30, king: 8, poisoned: 10 }, true);
      text = what === 'sack' ? 'Gave you an empty Trick-or-Treat Sack.' : 'Gave you a full Trick-or-Treat Sack (128 candy).';
    } else {
      st = markAdmin(stackOf(CANDY_ITEM[what], 8));
      text = `Gave you 8 ${CANDY_NAMES[what]}.`;
    }
    const rem = p.inventory.add(st);
    if (rem) s.interaction.dropStack(p, rem);
    s.interaction.syncInventory(p);
    return { ok: true, text };
  }

  /** For the Admin Panel and tests: what is going on. */
  status(): { candy: number; tricks: { door: string; kind: TrickKind; phase: string; left: number }[] } {
    return {
      candy: this.candyRuns.size,
      tricks: [...this.trickRuns.values()].map((r) => ({ door: r.id, kind: r.kind, phase: r.phase, left: r.mobs.filter((m) => !m.removed && !m.dead).length })),
    };
  }

  /** The run at a door (tests). */
  runAt(ref: DoorRef): { candy?: CandyRun; trick?: TrickRun } {
    const id = this.idOf(ref);
    return { candy: this.candyRuns.get(id), trick: this.trickRuns.get(id) };
  }
}
