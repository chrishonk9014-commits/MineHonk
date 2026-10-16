/**
 * V7 - The Halloween Update, phase 3: trick-or-treating (the server's side is
 * src/server/systems/TrickOrTreat.ts).
 *
 * Knocking: standing at a door of a Trick-or-Treat Village, looking at it, a
 * "Knock" prompt shows (G, or tap it). Right-clicking the door still opens it
 * as always; knocking is its own action so neither gets in the other's way.
 * Only while Halloween is on in the world. To be answered you need a costume
 * on your head (a costume head or a carved pumpkin) and a Trick-or-Treat Sack
 * with room in it; otherwise a voice behind the door tells you why not.
 *
 * - A Candy Home: the door opens, a villager in a costume greets you, gives
 *   you 1 to 3 candies (straight into your sack, the moment the door is
 *   answered, skipped or not), says goodbye and shuts the door. Once per
 *   player per home (saved on the door's record).
 * - A Trick Home: the door creaks open, something grabs you and drags you
 *   inside, the door slams. Beat what is in there and a chest appears, once
 *   per home for everyone. Open (or break) the door and you're out; leave or
 *   die and it ends, nothing lost, to be tried again.
 *
 * Plain data shared by the server, the client and the tests.
 */
import type { CandyKind } from './candy';

/** How far a knock reaches: from the eyes to the middle of the door (blocks). */
export const KNOCK_REACH = 4;
/** Doors this near (blocks) are offered to the client for the prompt. */
export const KNOCK_LIST_RANGE = 7;

export type Rng = { next(): number; int(n: number): number };
export function pickLine(list: readonly string[], rng: Rng): string {
  return list[rng.int(list.length)]!;
}

// ---------------------------------------------------------------------------
// What the voice behind the door says
// ---------------------------------------------------------------------------
export const NO_COSTUME_LINES: readonly string[] = [
  'No costume, no candy!',
  'And what are you supposed to be? Come back in a costume!',
  "Nice try. Where's your costume?",
  'We only give candy to little monsters. Dress up!',
];
export const NO_SACK_LINES: readonly string[] = [
  'Where would you even put it? Bring a sack!',
  "No sack? I'm not stuffing your pockets!",
  "You'll want a sack for all that candy!",
];
export const FULL_SACK_LINES: readonly string[] = ['Your sack is already full, greedy!', "There's no room left in that sack!", 'Greedy! Eat some of that first.'];
export const ALREADY_LINES: readonly string[] = ['You already got candy here!', "Didn't I see you already? Nice try!", 'One handful each, little monster!'];
export const BUSY_LINES: readonly string[] = ['One at a time, please!', 'Just a moment, I have someone at the door!'];
/** A Trick Home with a fight going on inside. */
export const FIGHT_LINES: readonly string[] = ['Something is crashing about in there...', 'You hear snarling, and furniture breaking.'];
/** A Trick Home already beaten and looted. */
export const EMPTY_LINES: readonly string[] = ['Nobody answers. The house is quiet now.', 'The door creaks. Nothing stirs inside any more.'];
/** Halloween is over in this world. */
export const OVER_LINES: readonly string[] = ['Nobody answers. Halloween is over.'];

// ---------------------------------------------------------------------------
// Candy Homes
// ---------------------------------------------------------------------------
export interface CandyScene {
  id: string;
  /** What the villager wears on its head. */
  head: string;
  greet: readonly string[];
  give: readonly string[];
  bye: readonly string[];
}

/** How each Candy Home answers (picked by the door and the knocker, so each door can differ for each player). */
export const CANDY_SCENES: readonly CandyScene[] = [
  { id: 'cheerful', head: 'carved_pumpkin', greet: ['Happy Halloween!', 'Trick or treat? Treat, of course!'], give: ['Here you go!', 'Take a handful!'], bye: ['Stay spooky!', 'Mind the ghosts out there!'] },
  { id: 'boo', head: 'skeleton_skull', greet: ['BOO! ...Ha! Got you!', 'BOO! Did I scare you?'], give: ["Here, for being brave.", 'Have some, you earned it.'], bye: ['Off you go, before I do it again!', 'Rattle rattle! Goodbye!'] },
  { id: 'granny', head: 'zombie_head', greet: ['Oh, look at you! What a frightful costume!', "My, my. Aren't you a scary one!"], give: ['Have some extra, dear. You look hungry.', "Don't eat them all at once."], bye: ['Off you go now, dear.', "Wrap up warm, it's cold out."] },
  { id: 'shy', head: 'creeper_head', greet: ['...ssss... oh! Hello.', 'Um. Hi. Trick or treat?'], give: ['Um. Candy?', 'This is for you.'], bye: ['...bye.', 'Happy... Halloween.'] },
];

/** A Candy Home's answer, in ticks from the knock. Skippable at any point. */
export const CANDY_TIMES = { open: 16, appear: 18, greet: 26, give: 56, bye: 84, back: 104, close: 112, end: 122 } as const;

export function candySceneFor(doorSeed: number, uuid: string): CandyScene {
  let h = doorSeed >>> 0;
  for (let i = 0; i < uuid.length; i++) h = Math.imul(h ^ uuid.charCodeAt(i), 0x01000193) >>> 0;
  return CANDY_SCENES[h % CANDY_SCENES.length]!;
}

/** How a handful reads ("2 Candy and a Big Candy"). */
export function handfulText(kinds: readonly CandyKind[], names: Readonly<Record<CandyKind, string>>): string {
  const counts = new Map<CandyKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const parts = [...counts].map(([k, n]) => (n === 1 ? `a ${names[k]}` : `${n} ${names[k]}`));
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Trick Homes
// ---------------------------------------------------------------------------
export type TrickKind = 'zombie_villagers' | 'witch' | 'skeletons' | 'undead' | 'spiders' | 'herobrine';
export const TRICK_KINDS: readonly TrickKind[] = ['zombie_villagers', 'witch', 'skeletons', 'undead', 'spiders', 'herobrine'];

export interface TrickEncounter {
  name: string;
  /** What reaches out of the door and drags you in. */
  grab: string;
  /** Everything waiting inside (the grabber is the first). */
  mobs: readonly string[];
  /** What it reads in the boss bar. */
  title: string;
  /** The chest that appears when it is beaten. */
  loot: string;
}

/**
 * What waits in a Trick Home (each beatable with ordinary gear: iron and a
 * shield do it). Herobrine is a short, frightening fight with no boss
 * arena: he blinks about the room, hits hard and goes down fast.
 */
export const TRICK_ENCOUNTERS: Readonly<Record<TrickKind, TrickEncounter>> = {
  zombie_villagers: { name: 'The Hungry Neighbours', grab: 'zombie_villager', mobs: ['zombie_villager', 'zombie_villager', 'zombie_villager'], title: 'The Hungry Neighbours', loot: 'trick_home' },
  witch: { name: "The Witch's Kitchen", grab: 'witch', mobs: ['witch', 'zombie_villager'], title: "The Witch's Kitchen", loot: 'trick_home' },
  skeletons: { name: 'Skeletons in the Closet', grab: 'skeleton', mobs: ['skeleton', 'skeleton'], title: 'Skeletons in the Closet', loot: 'trick_home' },
  undead: { name: 'The Undead Party', grab: 'zombie', mobs: ['zombie', 'skeleton', 'zombie_villager'], title: 'The Undead Party', loot: 'trick_home' },
  spiders: { name: 'Cobwebs and Fangs', grab: 'spider', mobs: ['spider', 'cave_spider', 'cave_spider'], title: 'Cobwebs and Fangs', loot: 'trick_home' },
  herobrine: { name: 'Herobrine?!', grab: 'herobrine', mobs: ['herobrine'], title: 'Herobrine', loot: 'trick_home_herobrine' },
};

/** Which encounter a Trick Home holds, by its door's seed (weights out of 100: Herobrine one in a hundred). */
export const TRICK_ODDS: Readonly<Record<TrickKind, number>> = { zombie_villagers: 25, witch: 17, skeletons: 20, undead: 21, spiders: 16, herobrine: 1 };

/** A Trick Home's encounter: fixed by the door's seed, so it is the same every time anyone knocks. */
export function trickKindFor(doorSeed: number): TrickKind {
  // A hash of the seed, so neighbouring doors' seeds don't line up
  let h = (doorSeed ^ 0x7e1c0ade) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  let r = h % 100;
  for (const k of TRICK_KINDS) {
    r -= TRICK_ODDS[k];
    if (r < 0) return k;
  }
  return 'zombie_villagers';
}

/** A Trick Home's opening, in ticks from the knock: the creak, the grab, the drag inside, the slam. */
export const TRICK_TIMES = { creak: 10, appear: 16, grab: 20, drag: 36, dragTicks: 46, slam: 84 } as const;
/** Nobody left inside for this long (ticks): the encounter is over, to be tried again. */
export const TRICK_EMPTY_TICKS = 60;
/** Herobrine in a Trick Home: his health (and per extra player), his blow, how often he blinks (ticks). */
export const TRICK_HEROBRINE = { health: 40, perPlayer: 20, damage: 4, hitEvery: 30, blinkMin: 50, blinkMax: 80 } as const;

// ---------------------------------------------------------------------------
// The quest
// ---------------------------------------------------------------------------
export type QuestStep = 'sack' | 'costume' | 'wear' | 'village' | 'knock' | 'candy';
export const QUEST_STEPS: readonly { id: QuestStep; text: string }[] = [
  { id: 'sack', text: 'Get a Trick-or-Treat Sack (craft one: string over wool)' },
  { id: 'costume', text: 'Get a costume: a head, or a carved pumpkin' },
  { id: 'wear', text: 'Wear your costume on your head' },
  { id: 'village', text: 'Find a Trick-or-Treat Village' },
  { id: 'knock', text: 'Knock on doors until a Candy Home treats you' },
  { id: 'candy', text: 'Collect candy from Candy Homes' },
];
export const QUEST_TITLE = 'Trick or Treat!';
/** Candies to collect for the last step. */
export const QUEST_CANDY = 10;
/** The tracker's note while something does not count (Phase 5: the quest is honest, like advancements). */
export const QUEST_CHEAT_NOTE = 'Cheats and the Admin Panel do not count';

/**
 * What a player has done towards trick-or-treating (saved with the player).
 * Since V7 phase 5 every count is honest play only (no cheats, no Admin Panel,
 * no cheat-made village): the quest cannot be finished without really doing
 * it, and finishing it is an advancement.
 */
export interface HalloweenProgress {
  /** Quest steps done, in order (they stay done). */
  steps: QuestStep[];
  /** Doors answered (Candy and Trick Homes). */
  knocks: number;
  /** Successful trick-or-treats: Candy Homes that gave candy (phase 5; older saves start at 0). */
  treats: number;
  /** Candies Candy Homes gave. */
  candy: number;
  /** Trick Homes beaten. */
  tricks: number;
  /** The quest was finished. */
  done: boolean;
}

export function newProgress(): HalloweenProgress {
  return { steps: [], knocks: 0, treats: 0, candy: 0, tricks: 0, done: false };
}

export function sanitizeProgress(raw: unknown): HalloweenProgress {
  const out = newProgress();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1e9, Math.floor(v))) : 0);
  if (Array.isArray(o.steps)) for (const s of o.steps) if (QUEST_STEPS.some((q) => q.id === s) && !out.steps.includes(s as QuestStep)) out.steps.push(s as QuestStep);
  out.knocks = n(o.knocks);
  out.treats = n(o.treats);
  out.candy = n(o.candy);
  out.tricks = n(o.tricks);
  out.done = o.done === true;
  return out;
}

/** The step a player is on (null: all done). */
export function currentStep(pr: HalloweenProgress): QuestStep | null {
  for (const s of QUEST_STEPS) if (!pr.steps.includes(s.id)) return s.id;
  return null;
}
