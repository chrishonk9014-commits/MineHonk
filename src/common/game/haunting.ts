/**
 * The Haunting (Admin Panel, every world): Herobrine, the way the old
 * stories tell it. A white-eyed figure far off in the fog who is gone when
 * you look again; redstone torches nobody placed; cobblestone crosses in
 * the air; 2x2 tunnels that lead nowhere; trees stripped of their leaves;
 * sand pyramids in the water; a "Herobrine joined the world" that nobody
 * can explain. Then he comes closer, speaks, and at the end he comes for
 * everyone: a jumpscare, the world deleted (if its owner chose that), and
 * everyone thrown out with a fake ban screen.
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
  { id: 'signs', at: 0.2, name: 'Signs', what: 'Cobblestone crosses in the air, 2x2 tunnels, leafless trees, signs, torches going out. "Herobrine joined the world".' },
  { id: 'closer', at: 0.45, name: 'Closer', what: 'He walks towards you, then is gone. The music stops, the dark closes in. "YOU ARE NOT SAFE".' },
  { id: 'speaks', at: 0.7, name: 'He speaks', what: 'He talks in chat, stands right behind you, and the signs are everywhere.' },
  { id: 'finale', at: 0.94, name: 'The end', what: 'He comes for everyone. A jumpscare, then the world is deleted and everyone is banned (a fake ban).' },
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
}

export type HauntOp = 'status' | 'start' | 'stop' | 'skip';
export const HAUNT_OPS: readonly HauntOp[] = ['status', 'start', 'stop', 'skip'];
