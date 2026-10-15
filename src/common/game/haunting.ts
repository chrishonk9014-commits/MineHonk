/**
 * The Haunting (every world; not seasonal): Herobrine, the way the old
 * stories tell it. A white-eyed figure far off in the fog who is gone when
 * you look again; redstone torches nobody placed; cobblestone crosses in
 * the air; 2x2 tunnels that lead nowhere; trees stripped of their leaves;
 * sand pyramids in the water; a "Herobrine joined the world" that nobody
 * can explain. Then he comes closer, glitches players, plays with the
 * world like an admin, sends monsters and answers when spoken to. At the end
 * he comes for everyone: a jumpscare and a fake ban screen, or (one time in
 * four, unless the panel chose) he drags everyone into his lair inside the
 * computer, wired up, shocked, SERVER MEMORY CORRUPTED. The world is deleted
 * after either if its owner chose that.
 *
 * The whole thing runs on a timeline of the length the Admin Panel chose
 * (30 minutes unless changed); every moment below is a fraction of it.
 *
 * V7 phase 4: Herobrine also comes by himself, once, to some worlds made by
 * players who beat him for real (the automatic haunting, below), and the
 * Admin Panel can send three more characters from the old stories (their
 * data is in hauntCast.ts). Plain data shared by the server, the client and
 * the tests.
 */

export const HAUNT_DEFAULT_MINUTES = 30;
export const HAUNT_MIN_MINUTES = 1;
export const HAUNT_MAX_MINUTES = 180;

export type HauntStage = 'watching' | 'signs' | 'closer' | 'speaks' | 'finale';

/** Where each stage begins, as a share of the whole haunting. */
export const HAUNT_STAGES: readonly { id: HauntStage; at: number; name: string; what: string }[] = [
  { id: 'watching', at: 0, name: 'He is watching', what: 'Far off in the fog, gone when you look again. A redstone torch nobody placed.' },
  { id: 'signs', at: 0.2, name: 'Signs', what: 'Cobblestone crosses in the air, 2x2 tunnels, leafless trees, signs, torches going out, fake admin messages. "Herobrine joined the world".' },
  { id: 'closer', at: 0.45, name: 'Closer', what: 'He walks towards you, then is gone. The dark closes in, a shrine appears, players glitch, monsters come. "YOU ARE NOT SAFE".' },
  { id: 'speaks', at: 0.7, name: 'He speaks', what: 'He talks, and answers when you talk to him. Midnight, thunder, wardens. He stands right behind you.' },
  { id: 'finale', at: 0.94, name: 'The end', what: 'He comes for everyone: a jumpscare and a fake ban, or his lair inside the computer and SERVER MEMORY CORRUPTED.' },
];

export function hauntStage(f: number): HauntStage {
  let s: HauntStage = 'watching';
  for (const st of HAUNT_STAGES) if (f >= st.at) s = st.id;
  return s;
}

/** When the chase starts (everyone at once) and how long it may take before the end comes anyway. */
export const HAUNT_CHASE_AT = 0.965;
export const HAUNT_CHASE_MAX_TICKS = 20 * 20;

/** What he says, and when (shares of the haunting). `{name}` is the player reading it. */
export const HAUNT_LINES: readonly { at: number; text: string; glitch: boolean }[] = [
  // The first contact, as in the oldest story: one word, quietly
  { at: 0.38, text: 'stop', glitch: false },
  { at: 0.55, text: 'YOU ARE NOT SAFE', glitch: true },
  { at: 0.72, text: 'I HAVE BEEN WATCHING YOU', glitch: true },
  { at: 0.76, text: 'I SEE YOU, {name}', glitch: true },
  { at: 0.8, text: 'THIS WORLD IS MINE', glitch: true },
  { at: 0.84, text: 'YOU SHOULD NOT HAVE COME HERE', glitch: true },
  { at: 0.88, text: 'THERE IS NO ESCAPE', glitch: true },
  { at: 0.91, text: 'TURN AROUND', glitch: true },
  { at: 0.95, text: 'FOUND YOU', glitch: true },
];

/** He answers players in chat from here on (and at most this many times in one haunting). */
export const HAUNT_TALK_AT = 0.7;
export const HAUNT_MAX_ANSWERS = 60;

/** How it ends: the fake ban, the lair inside the computer, or one of them at random (the lair one time in four). */
export type HauntEnding = 'random' | 'ban' | 'corrupted';
export const HAUNT_ENDINGS: readonly HauntEnding[] = ['random', 'ban', 'corrupted'];
export const HAUNT_CORRUPT_CHANCE = 0.25;
export const HAUNT_ENDING_NAMES: Record<HauntEnding, string> = { random: 'Random', ban: 'The ban screen', corrupted: 'Server memory corrupted' };

/**
 * The lair ending, in ticks from the moment he grabs everyone: dragged
 * along the ground, pulled into the computer, waking up wired into a chair
 * in his hall, three shocks, death, SERVER MEMORY CORRUPTED, the title.
 */
export const HAUNT_SCENE = { grab: 0, drag: 20, dragTicks: 90, pull: 110, arrive: 140, wake: 220, shocks: [280, 320, 350], die: 380, corrupt: 440, end: 580 } as const;

/** What the fake admin messages say he used. `{name}`: a player. */
export const HAUNT_ADMIN_LINES: readonly string[] = ['kill @a', 'gamemode adventure {name}', 'clear {name}', 'ban {name}', 'op Herobrine', 'time set midnight', 'weather thunder', 'give {name} tnt ×64', 'tp {name} ~ -64 ~', 'delete world', 'summon warden', 'deop {name}'];

/** The fake "joined"/"left" lines (the same words the game uses for real players). */
export const HAUNT_JOIN_AT = [0.3, 0.6, 0.945] as const;

/** Words on the signs he leaves. */
export const HAUNT_SIGNS: readonly string[][] = [
  ['', 'STOP', '', ''],
  ['', 'I SEE YOU', '', ''],
  ['TURN', 'AROUND', '', ''],
  ['', 'HE IS HERE', '', ''],
  ['', 'LEAVE', '', ''],
  ['', 'NOT SAFE', '', ''],
  ['', 'WHY', '', ''],
];

/** The fake ban screen: what every player sees at the end. */
export const HAUNT_BAN = {
  title: 'You are banned from this server.',
  reason: 'YOU WERE WARNED',
  by: 'Herobrine',
  expires: 'Never',
};

/** What the Admin Panel shows. */
export interface HauntStatus {
  active: boolean;
  /** The stage's id (for Herobrine one of HauntStage; the other characters have their own, see hauntCast.ts). */
  stage: string | null;
  /** V7 phase 4: who is haunting (Herobrine unless the panel chose another). */
  character: HauntCharacter;
  /** Started by itself (the automatic haunting), not from the Admin Panel. */
  auto: boolean;
  /** An automatic haunting waiting to begin: seconds of play left until it does (the panel only). */
  autoIn?: number;
  /** This world's automatic haunting: none (no roll, or it did not come up), waiting, running, or over for good. */
  autoState: 'none' | 'waiting' | 'running' | 'over';
  /** Seconds in, and of the whole. */
  elapsed: number;
  total: number;
  /** The world is deleted at the end (otherwise kept: a fake deletion). */
  erase: boolean;
  /** Blocks he has placed or taken that Stop would put back. */
  changes: number;
  /** Whether the person asking may arm the deletion (the world's owner). */
  canErase: boolean;
  /** How it will end (as chosen; a random one is not given away): one of the character's endings. */
  ending: string;
}

/**
 * status, start, stop (puts everything back), skip (to the next stage),
 * V7 phase 4: finale (straight to the end), finale_in (`minutes` until the
 * end begins), restart (an automatic haunting from its beginning), appear
 * (the chosen character, near you, briefly: a test), talk (say `text` to the
 * chosen character without any haunting: a test of its voice).
 */
export type HauntOp = 'status' | 'start' | 'stop' | 'skip' | 'finale' | 'finale_in' | 'restart' | 'appear' | 'talk';
export const HAUNT_OPS: readonly HauntOp[] = ['status', 'start', 'stop', 'skip', 'finale', 'finale_in', 'restart', 'appear', 'talk'];

/** V7 phase 4: who can haunt a world (Herobrine by himself; the others only from the Admin Panel). */
export type HauntCharacter = 'herobrine' | 'null' | 'green_steve' | 'cave_dweller';
export const HAUNT_CHARACTERS: readonly HauntCharacter[] = ['herobrine', 'null', 'green_steve', 'cave_dweller'];

// ------------------------------------------------------------------ the automatic haunting (V7 phase 4)

/**
 * Herobrine comes by himself to one world in ten made by a player who has
 * beaten him for real (the boss fight, no cheats, not from the Admin Panel)
 * in an earlier world. The roll is made once, when the world is created,
 * with a real random number (not the seed), and kept in the world; nothing
 * shows it. It begins after this much play (a random time in between, set
 * at the roll; only time with someone in the world counts): long enough
 * that the world has become someone's home (a Minecraft day is 20 minutes:
 * the first night or two have passed and there is a shelter), short enough
 * to come within the first evening or two of play.
 */
export const AUTO_HAUNT_CHANCE = 0.1;
export const AUTO_HAUNT_DELAY_MIN = 20 * 60 * 20;
export const AUTO_HAUNT_DELAY_MAX = 40 * 60 * 20;
/** It lasts about 45 minutes, through the same stages as the panel's. */
export const AUTO_HAUNT_MINUTES = 45;
/** How it ends: the usual pick (the lair one time in four); the world is always kept. */
export const AUTO_HAUNT_ENDING: HauntEnding = 'random';

/** What a world keeps of its roll (level.flags.autoHaunt): made once, at creation; never made again. */
export interface AutoHauntRoll {
  /** The roll came up: Herobrine will come. */
  haunted: boolean;
  /** Ticks of play before he does, and played so far. */
  after: number;
  played: number;
  /** When the roll was made (ms since 1970). */
  at: number;
  /** It began, and it is over (for good). */
  begun?: boolean;
  over?: boolean;
}

/** The roll, for a world being created by an eligible player. `rnd` must be a real random source. */
export function rollAutoHaunt(rnd: () => number, now: number): AutoHauntRoll {
  const haunted = rnd() < AUTO_HAUNT_CHANCE;
  const after = Math.round(AUTO_HAUNT_DELAY_MIN + rnd() * (AUTO_HAUNT_DELAY_MAX - AUTO_HAUNT_DELAY_MIN));
  return { haunted, after, played: 0, at: now };
}
