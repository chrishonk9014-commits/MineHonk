/**
 * What the haunting core (../Haunting.ts) and each character's part
 * (herobrine.ts, null.ts, greenSteve.ts, caveDweller.ts) share.
 */
import type { ServerPlayer } from '../../player/ServerPlayer';
import type { Mob } from '../../entity/Mob';
import type { HauntCharacter } from '../../../common/game/haunting';
import type { HauntNotice } from '../../../common/game/hauntCast';
import type { HauntEndScreen } from '../../../common/net/protocol';
import type { DimensionId } from '../../../common/data/biomes';

/** What the world keeps of a haunting (level.flags.haunt). */
export interface HauntState {
  /** Ticks in, and of the whole. */
  t: number;
  total: number;
  erase: boolean;
  /** Who started it ("auto": nobody, it came by itself). */
  by: string;
  /** One-off moments already played (lines, joins, the shrine). */
  done: string[];
  /** How it ends as chosen, and as decided when the end begins. */
  ending?: string;
  final?: string;
  /** Times it has answered someone. */
  said?: number;
  /** The time and weather before it first touched them (put back by Stop and at the end). */
  sky?: { dayTime: number; raining: boolean; thundering: boolean; rainTime: number; thunderTime: number };
  /** Deaths per player since it began. */
  deaths?: Record<string, number>;
  /** V7 phase 4: who is haunting (Herobrine when missing: hauntings from before). */
  char?: HauntCharacter;
  /** It came by itself (the automatic haunting). */
  auto?: boolean;
  /** The Admin Panel moved it along (an automatic haunting touched like that counts for nothing). */
  touched?: boolean;
  /** A character's own saved bits (kept small). */
  mem?: Record<string, unknown>;
}

/** One of its figures in the world, shown to one player. */
export interface Figure {
  m: Mob;
  p: ServerPlayer;
  kind: string;
  since: number;
  /** Ticks the player has been looking straight at it. */
  seen: number;
  /** Whatever the character keeps about this figure. */
  data: Record<string, unknown>;
  /** Whose figure it is (it may wear another mob's shape: Green Steve's fake creepers). */
  owner: HauntCharacter;
}

/** How a haunting ends for everyone. */
export type HauntFinish = { kind: 'ban' } | { kind: 'corrupted' } | { kind: 'screen'; screen: Omit<HauntEndScreen, 'deleted'> };

/** A character's part: what it does on top of the shared timeline. */
export interface HauntPart {
  readonly id: HauntCharacter;
  /**
   * Random events per player over each stage (spread at random through it):
   * stage id -> event -> how many. The core rolls them every 10 ticks.
   */
  readonly budget: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** One random event for one player. */
  event(kind: string, p: ServerPlayer, st: HauntState, stage: string, f: number): void;
  /** Its one-off moments (beyond its lines in chat, which the core plays). */
  oneOffs(st: HauntState, f: number, players: ServerPlayer[], once: (key: string, at: number) => boolean): void;
  /** Every tick of its end. */
  finale(st: HauntState, f: number, players: ServerPlayer[]): void;
  /** Every 20 ticks outside the end: the dark, the quiet, the colour (whatever it does to the air). */
  atmosphere(st: HauntState, f: number, players: ServerPlayer[]): void;
  /** Every tick outside the end, for what must be watched closely (cheap). */
  everyTick?(st: HauntState, f: number, players: ServerPlayer[]): void;
  /** One of its figures, each tick: false when it should go (the core makes it vanish). */
  stepFigure(fg: Figure, age: number, dist: number): boolean;
  /** How a figure vanishes (the sound, the afterimage; `gone`: its player left or moved away); the core removes it. */
  vanish?(fg: Figure, gone: boolean): void;
  /** The test from the Admin Panel: shows itself near a player for a moment. */
  appear(p: ServerPlayer): boolean;
  /** Something a player did (the automatic haunting's noticing, or anything the character cares about). */
  notice?(p: ServerPlayer, what: HauntNotice, st: HauntState, stage: string, f: number, at?: [number, number, number]): void;
  /**
   * Its own in-memory state forgotten, and anyone it is holding put back
   * where they were: 'stop' (Stop, or no haunting any more: their screen is
   * cleared too) or 'end' (the end screen follows). Called every tick while
   * nothing haunts the world, so it must be cheap and quiet when idle.
   */
  reset(why: 'stop' | 'end'): void;
  /**
   * V7 phase 5: a player is leaving the world in the middle of something that
   * moved them (a trap, an end's cutscene): where they are saved is where it
   * took them from, never a bedrock room or a lair. (A world loaded again in
   * its end starts the end again.)
   */
  release?(p: ServerPlayer): void;
  /** Where a player it holds was taken from (saves made meanwhile keep them there); null: it holds nobody. */
  originOf?(p: ServerPlayer): { dim: DimensionId; x: number; y: number; z: number; yaw: number } | null;
  /** It is holding this player (a cutscene of its end). */
  holds?(p: ServerPlayer): boolean;
  /** It is not answering anyone now (`delivering`: an answer already on its way is about to be said). */
  silent?(delivering: boolean): boolean;
  /** It changes what a player says in chat (or null to leave it). */
  chatText?(p: ServerPlayer, text: string): string | null;
}
