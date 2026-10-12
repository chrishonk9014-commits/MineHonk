/**
 * The Haunting (Admin Panel, every world): Herobrine, the way the old
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
 * Plain data shared by the server, the client and the tests.
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
  stage: HauntStage | null;
  /** Seconds in, and of the whole. */
  elapsed: number;
  total: number;
  /** The world is deleted at the end (otherwise kept: a fake deletion). */
  erase: boolean;
  /** Blocks he has placed or taken that Stop would put back. */
  changes: number;
  /** Whether the person asking may arm the deletion (the world's owner). */
  canErase: boolean;
  /** How it will end (as chosen; a random one is not given away). */
  ending: HauntEnding;
}

export type HauntOp = 'status' | 'start' | 'stop' | 'skip';
export const HAUNT_OPS: readonly HauntOp[] = ['status', 'start', 'stop', 'skip'];
