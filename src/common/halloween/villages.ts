/**
 * V7 - The Halloween Update, phase 2: the village variants' shared rules.
 *
 * In worlds made with generator 9 (V7) or later, every village is one of:
 *  - normal: a V4 village, block for block;
 *  - Trick-or-Treat eligible: two in three of the rest. It becomes a
 *    Trick-or-Treat Village if Halloween is on in the world when the server
 *    first builds any part of it, and an ordinary village otherwise. The
 *    server decides once, records it with the world (VillageRecord), and every
 *    chunk of the village follows that record, so a village is never half
 *    dressed (chunks generated after the cutoff still match the rest);
 *  - Abandoned: one in 40 village starts (Minecraft's zombie villages are
 *    about one in 50), decided by the seed alone and not seasonal. A ruin: collapsed houses, cobwebs, overgrowth, zombie
 *    villagers and undead guardians that never leave it.
 *
 * Which variant a village is depends only on the world's seed and the chunk
 * its start is in (villageVariant): nothing has to be planned to know, so
 * the Admin Panel's search skips other villages cheaply.
 *
 * Every house door of a Trick-or-Treat Village (cottages, houses, manors and
 * workshops: the chapel, storehouse and smithy are not homes) is a Candy Home
 * or a Trick Home, 2 to 4 of them Trick Homes. They look the same from
 * outside. The server keeps each door's record (DoorRecord) with the world.
 */
import { hashInts, Random } from '../math/rng';

export type VillageVariant = 'normal' | 'trick' | 'abandoned';

/** One village start in this many is an Abandoned Village. */
export const ABANDONED_ONE_IN = 40;
/** Of the others, this many in TRICK_OUT_OF are Trick-or-Treat eligible (two in three). */
export const TRICK_IN = 2;
export const TRICK_OUT_OF = 3;
/** Trick Homes in a Trick-or-Treat Village: at least, at most. */
export const TRICK_HOMES_MIN = 2;
export const TRICK_HOMES_MAX = 4;
/** A Trick-or-Treat Village needs this many house doors (so at least one is a Candy Home). */
export const TRICK_MIN_DOORS = 3;
/** Designs whose door is a home's door. */
export const HOME_DESIGNS: readonly string[] = ['cottage', 'house', 'manor', 'workshop'];

const VARIANT_SALT = 0x7a1105;
const DOOR_SALT = 0xd0025;

/** A village's variant, from the world seed and its start chunk alone. */
export function villageVariant(seed: number, cx: number, cz: number): VillageVariant {
  const h = hashInts(seed >>> 0, cx, cz, VARIANT_SALT) >>> 0;
  if (h % ABANDONED_ONE_IN === 0) return 'abandoned';
  return (h >>> 12) % TRICK_OUT_OF < TRICK_IN ? 'trick' : 'normal';
}

/** The key a village's record is saved under: its start chunk. */
export function villageKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export type DoorKind = 'candy' | 'trick';
export type Facing4 = 'north' | 'south' | 'west' | 'east';

/** A house door, as the village's plan places it (world coordinates). */
export interface DoorSpot {
  /** Index in the village's door list. */
  id: number;
  /** The door's lower block. */
  x: number;
  y: number;
  z: number;
  /** The way the door looks out (towards the road). */
  facing: Facing4;
  /** Where someone knocking stands: the block in front of the door, at the door's height. */
  out: [number, number, number];
  /** The building's design (cottage, house, manor, workshop). */
  design: string;
  /** Candy Home or Trick Home. */
  kind: DoorKind;
  /** Seed of whatever happens at this door (phase 3). */
  seed: number;
}

/** A door as the server keeps it. */
export interface DoorRecord extends DoorSpot {
  /**
   * Phase 3: a Candy Home someone has had candy from; a Trick Home beaten and
   * its chest given out (once, for everyone).
   */
  used: boolean;
  /** Phase 3, Candy Homes: who has had their candy here (player uuids; once each). */
  got?: string[];
}

/** What the plan knows of a village (Start.village). */
export interface VillageMeta {
  variant: VillageVariant;
  key: string;
  style: string;
  /** House doors (Trick-or-Treat eligible villages only; kinds already dealt). */
  doors: DoorSpot[];
  /** Abandoned Villages: the area its guardians stay in. */
  guard?: GuardArea;
}

/** The area a guardian keeps to (world blocks, inclusive). */
export interface GuardArea {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Ground height of the village's centre. */
  y: number;
  /**
   * Phase 3: how far out (blocks) a guardian may chase or pick a target
   * (default: GUARD_LEASH and GUARD_TARGET_LEASH); 0 keeps a Trick Home's
   * monsters to its rooms.
   */
  leash?: number;
}

/**
 * A village's record, saved with the world (LevelData.villages): every
 * Trick-or-Treat eligible village once it is first built, and every village
 * the Admin Panel builds (keys "admin@x,z").
 */
export interface VillageRecord {
  /**
   * 'trick': built as a Trick-or-Treat Village; 'normal': Halloween was off when
   * it was first built; 'abandoned': an Abandoned Village the Admin Panel built.
   */
  kind: 'trick' | 'normal' | 'abandoned';
  /** Server time it was decided. */
  decidedAt: number;
  /** The village's centre. */
  x: number;
  y: number;
  z: number;
  style: string;
  /** Its doors (Trick-or-Treat Villages). */
  doors: DoorRecord[];
  /** Made by the Admin Panel (or only because of a simulation): nothing about it counts towards advancements. */
  cheat?: boolean;
  /** Admin Panel Abandoned Villages: their haunted area. */
  area?: GuardArea;
}

/** At most this many village records and doors a village are read back (far more than any world makes). */
export const MAX_VILLAGE_RECORDS = 4096;
export const MAX_VILLAGE_DOORS = 64;
/** A record's key: the village's start chunk ("cx,cz"), or "admin@x,z" for the Admin Panel's. */
const RECORD_KEY = /^(admin@)?-?\d{1,9},-?\d{1,9}$/;

/** Reads saved records back, dropping anything malformed (and keys that are not a village's). */
export function sanitizeVillageRecords(raw: unknown): Record<string, VillageRecord> {
  const out: Record<string, VillageRecord> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  let n = 0;
  for (const [key, r] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_VILLAGE_RECORDS) break;
    if (!RECORD_KEY.test(key) || !r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if ((o.kind !== 'trick' && o.kind !== 'normal' && o.kind !== 'abandoned') || !num(o.x) || !num(o.y) || !num(o.z)) continue;
    const doors: DoorRecord[] = [];
    if (Array.isArray(o.doors))
      for (const d of (o.doors as Record<string, unknown>[]).slice(0, MAX_VILLAGE_DOORS)) {
        if (!d || typeof d !== 'object' || !Number.isInteger(d.x) || !Number.isInteger(d.y) || !Number.isInteger(d.z) || !Number.isInteger(d.id) || (d.id as number) < 0 || (d.kind !== 'candy' && d.kind !== 'trick')) continue;
        const outPos = Array.isArray(d.out) && d.out.length === 3 && d.out.every((v) => Number.isInteger(v)) ? ([...d.out] as [number, number, number]) : ([d.x, d.y, d.z] as [number, number, number]);
        const facing = (['north', 'south', 'west', 'east'] as const).find((f) => f === d.facing) ?? 'north';
        const got = Array.isArray(d.got) ? [...new Set((d.got as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0 && u.length <= 64))].slice(0, 1024) : [];
        doors.push({ id: d.id as number, x: d.x as number, y: d.y as number, z: d.z as number, facing, out: outPos, design: typeof d.design === 'string' && d.design.length <= 32 ? d.design : 'house', kind: d.kind, seed: num(d.seed) ? d.seed >>> 0 : 0, used: d.used === true, ...(got.length ? { got } : {}) });
      }
    const a = o.area as Record<string, unknown> | undefined;
    const area = a && num(a.x0) && num(a.z0) && num(a.x1) && num(a.z1) && num(a.y) ? { x0: a.x0, z0: a.z0, x1: a.x1, z1: a.z1, y: a.y } : undefined;
    out[key] = { kind: o.kind, decidedAt: num(o.decidedAt) ? o.decidedAt : 0, x: o.x, y: o.y, z: o.z, style: typeof o.style === 'string' && o.style.length <= 32 ? o.style : 'plains', doors, ...(o.cheat === true ? { cheat: true } : {}), ...(area ? { area } : {}) };
    n++;
  }
  return out;
}

/** Deals each door its kind: 2 to 4 Trick Homes (never all of them), the rest Candy Homes. */
export function dealDoors(seed: number, key: string, spots: Omit<DoorSpot, 'kind' | 'seed'>[]): DoorSpot[] {
  const [kx, kz] = key.split(',').map(Number) as [number, number];
  const rng = new Random(hashInts(seed >>> 0, kx, kz, DOOR_SALT));
  const n = spots.length;
  const tricks = Math.max(0, Math.min(TRICK_HOMES_MIN + rng.int(TRICK_HOMES_MAX - TRICK_HOMES_MIN + 1), n - 1));
  // A shuffled order picks the Trick Homes
  const order = spots.map((_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const trick = new Set(order.slice(0, tricks));
  return spots.map((s, i) => ({ ...s, kind: trick.has(i) ? 'trick' : 'candy', seed: hashInts(seed >>> 0, s.x, s.y, s.z, DOOR_SALT) >>> 0 }));
}

/** Whether a position lies in a guard area, `pad` blocks to spare. */
export function inGuardArea(a: GuardArea, x: number, z: number, pad = 0): boolean {
  return x >= a.x0 - pad && x <= a.x1 + 1 + pad && z >= a.z0 - pad && z <= a.z1 + 1 + pad;
}

/** What the server tells world generation about villages (GeneratorOptions.villages). */
export interface VillageHooks {
  /**
   * Whether a Trick-or-Treat eligible village is dressed. The server decides
   * the first time it is asked about a village (Halloween on or not, then) and
   * records the answer, so it never changes.
   */
  trick?(s: { village?: VillageMeta; x: number; y: number; z: number }): boolean;
  /** For searches: whether it is, or would be if it were built now (never records anything). */
  trickNow?(s: { village?: VillageMeta; x: number; y: number; z: number }): boolean;
  /** Every village is this variant (the title screen's scenes). */
  force?: VillageVariant;
}

/** Undead guardians in an Abandoned Village: at least, at most (zombie villagers come on top). */
export const GUARDIANS_MIN = 5;
export const GUARDIANS_MAX = 10;
