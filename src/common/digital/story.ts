/**
 * V5.5 - the Herobrine story: shared constants and the words the game shows.
 *
 * The canon path (implemented by the server's Herobrine system):
 *   Mysterious Potion -> Flash Drive -> the End -> the potion fed to the
 *   Ender Dragon -> the dragon spits malware -> a flash drive held in the
 *   malware becomes the Corrupted Flash Drive -> the dragon defeated -> the
 *   Overworld -> the drive in a computer -> Herobrine emerges from it -> the
 *   fight -> low on health he goes back into the computer -> the player
 *   follows him in -> the same seed where Herobrine was first found ->
 *   exploration -> a cave -> Herobrine, plugged into the machines -> the
 *   final fight -> Herobrine defeated -> the Herobrine secret ending.
 *
 * This is a separate story from the V3 one (potion -> Enderman -> Corrupted
 * Eye -> Farlands -> The Error): they share only the potion.
 */
import { seedFromString } from '../math/rng';

/** The seed of the world where Herobrine was first found. */
export const HEROBRINE_SEED = '478868574082066804';

let seedNum: number | null = null;
/** The seed as the game uses it: exactly what a world created with that seed gets. */
export function herobrineSeedNum(): number {
  return (seedNum ??= seedFromString(HEROBRINE_SEED));
}

/** The computer world generates the seed with MineHonk's oldest terrain, as it was. */
export const COMPUTER_WORLD_VERSION = 1;

/** Where the cave lies from the computer world's spawn (blocks). */
export const CAVE_OFFSET = { x: 176, z: -136 };
/** Floor of the cave's machine hall. */
export const CAVE_FLOOR_Y = 26;
export const CAVE_RADIUS = 21;

/** World story stages (saved with the level). */
export type HerobrineStage = 'none' | 'emerging' | 'fight1' | 'gateway' | 'final' | 'ending';

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** What the corrupted flash drive holds (story files, read-only). */
export const CORRUPTED_DRIVE_FILES: { name: string; kind: 'program' | 'log' | 'story'; size: number; lines?: string[] }[] = [
  { name: 'HER0BRINE.EXE', kind: 'story', size: 404, lines: ['[binary data]', '...', 'origin: seed 478868574082066804', 'payload: unknown'] },
  {
    name: 'dragon.log',
    kind: 'log',
    size: 12,
    lines: ['the dragon drank it.', 'it did not die. it coughed.', 'what came out was not fire.', 'it was data.'],
  },
  {
    name: 'README.txt',
    kind: 'log',
    size: 4,
    lines: ['do not plug this in.', 'do not plug this in.', 'do not plug this in.', '...', 'he is waiting for a computer.'],
  },
];

/** Lines a computer prints while the drive takes it over. */
export const TAKEOVER_LINES = [
  '> USB DEVICE CONNECTED',
  '> READING DRIVE ..........',
  '> AUTORUN: HER0BRINE.EXE',
  '> ACCESS DENIED',
  '> ACCESS DENIED',
  '> ACCESS GRANTED',
  '> SYSTEM BREACH',
  '> WORLD DATA ACCESSED',
  '> HE IS HERE',
];

/** What Herobrine writes across a screen during the final fight. */
export const HACK_MESSAGES = ['HER0BRINE.EXE', 'SYSTEM BREACH', 'ACCESS DENIED', 'PLAYER CONTROL OVERRIDE', 'WORLD DATA CORRUPTED', 'CONNECTION LOST', 'REMOVED HEROBRINE', 'SEED 478868574082066804'];

/**
 * Logs on the old terminals of the computer world. Clues, never a manual:
 * the things people said they saw in that seed, and where the cables go.
 */
export const TERMINAL_LOGS: string[][] = [
  ['LOG 0001', 'world loaded.', `seed: ${HEROBRINE_SEED}`, 'entities: 1 more than expected.'],
  ['LOG 0013', 'someone keeps taking the leaves', 'off the trees.', 'the trunks are still standing.'],
  ['LOG 0023', '2x2 tunnels in the hills again.', 'nobody here dug them.'],
  ['LOG 0031', 'sand pyramids in the water.', 'perfect ones.', 'I did not build them.'],
  ['LOG 0040', 'changelog:', '  - removed Herobrine'],
  ['LOG 0041', 'changelog:', '  - removed Herobrine', '  - removed Herobrine'],
  ['LOG 0052', 'he is not in the code any more.', 'he is in the hardware.'],
  ['LOG 0063', 'the cables all run the same way.', 'to the cave.'],
  ['LOG 0066', 'he plugged himself into the servers.', 'the lights in the cave never go out.'],
  ['LOG 0070', 'if you see him in the fog', 'do not walk towards him.', 'he is never where you saw him.'],
  ['LOG 0081', 'connection lost', 'connection lost', 'connection l0st'],
  ['LOG 0099', 'the torches mark the way down.', 'nobody placed those either.'],
];

/** The exit terminal at the computer world's spawn. */
export const EXIT_TERMINAL_LINES = ['> SESSION ACTIVE', `> SEED ${HEROBRINE_SEED}`, '> LOG OUT TO RETURN TO YOUR WORLD'];

/** Bearing words for a direction (dx, dz): the terminals point the way. */
export function bearing(dx: number, dz: number): string {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return dirs[(Math.round((a + 360) / 45) + 8) % 8]!;
}
