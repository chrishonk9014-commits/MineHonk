/**
 * V7 phase 4: who haunts a world, and how each of them goes about it.
 *
 * Herobrine (haunting.ts) comes by himself sometimes, or from the Admin
 * Panel; the other three are the Admin Panel's only, and never turn up in a
 * world on their own. Each is a character from the old Minecraft stories,
 * picked so that each plays differently:
 *
 *  - Null: the pitch-black figure that writes "null" on signs and changes the
 *    world while nobody is looking. It takes things away: torches, the blocks
 *    you placed, clean holes in the ground, the sound, the colour; it never
 *    moves while it is watched. Its end is the old error everyone has seen:
 *    Connection Lost, "null". (It manipulates the world.)
 *  - Green Steve: a player who is not one. "Green Steve joined the world", a
 *    friend who waves and builds you a house, then copies of you and your
 *    friends standing too still, messages they never sent, blue clay in the
 *    floor, and the bedrock room full of creepers: "Hello, brother". (It
 *    deceives, with things that look like what they are not.)
 *  - The Cave Dweller: a tall, thin, pale thing that lives in the dark under
 *    the world. Skittering in the walls and heavy breathing; it stares from
 *    the edge of the light, freezes when looked at, runs on all fours, opens
 *    doors and knocks torches off the walls, lunges and flees, and at the end
 *    it hunts. (It stalks.)
 *
 * Each has its own stages over the same timeline machinery, its own lines,
 * structures and signs, its own ending (one or several to pick from), its
 * own voice (src/hub/herobrineVoice.ts on the server, hauntBrains.ts when
 * the AI is off), and is creepy without ever being gory.
 *
 * Plain data shared by the server, the client and the tests.
 */
import { HAUNT_STAGES, HAUNT_TALK_AT, HAUNT_LINES, type HauntCharacter } from './haunting';

export interface HauntStageDef {
  id: string;
  /** Where it begins, as a share of the whole haunting. */
  at: number;
  name: string;
  what: string;
}

export interface HauntEndingDef {
  id: string;
  name: string;
  help: string;
}

/** A line in chat at a moment of the haunting. `{name}`: the player reading it. */
export interface HauntLine {
  at: number;
  text: string;
  /** Said with the character's glitch, shake or whisper. */
  loud: boolean;
}

export interface HauntCharacterDef {
  id: HauntCharacter;
  name: string;
  /** Who its chat lines come from. */
  speaker: string;
  /** The mob that shows it (always an untouchable, AI-less figure, never saved). */
  mob: string;
  /** What the Admin Panel says about it. */
  blurb: string;
  stages: readonly HauntStageDef[];
  /** It answers in chat from here on ("Talks back"). */
  talkAt: number;
  /** Where the end begins. */
  finaleAt: number;
  /** How it may end; with several, the first is "random". */
  endings: readonly HauntEndingDef[];
  defaultMinutes: number;
  lines: readonly HauntLine[];
}

// ------------------------------------------------------------------ Herobrine (his data is haunting.ts's)

const HEROBRINE: HauntCharacterDef = {
  id: 'herobrine',
  name: 'Herobrine',
  speaker: 'Herobrine',
  mob: 'herobrine',
  blurb:
    'Herobrine haunts this world, the way the old stories tell it: a figure far off in the fog, redstone torches nobody placed, cobblestone crosses in the air, 2x2 tunnels, leafless trees. He comes closer, speaks, and at the end he comes for everyone: a jumpscare, then everyone is thrown out with a fake ban screen. Everyone in the world sees it, and nobody is told it was started.',
  stages: HAUNT_STAGES,
  talkAt: HAUNT_TALK_AT,
  finaleAt: 0.94,
  endings: [
    { id: 'random', name: 'Random', help: 'Usually the jumpscare and the fake ban; one time in four he drags everyone into his lair inside the computer instead.' },
    { id: 'ban', name: 'The ban screen', help: 'He chases everyone down: a jumpscare, then a fake ban screen.' },
    { id: 'corrupted', name: 'Server memory corrupted', help: 'He drags everyone into his lair inside the computer: wired into chairs, shocked, SERVER MEMORY CORRUPTED, back to the title.' },
  ],
  defaultMinutes: 30,
  lines: HAUNT_LINES.map((l) => ({ at: l.at, text: l.text, loud: l.glitch })),
};

// ------------------------------------------------------------------ Null

const NULL: HauntCharacterDef = {
  id: 'null',
  name: 'Null',
  speaker: 'null',
  mob: 'null_entity',
  blurb:
    'Null is the pitch-black figure from the old stories that writes "null" on signs and changes the world while nobody is looking. It takes things away: your torches, the blocks you placed, clean holes in the ground, then the sound and the colour. It never moves while you watch it; look away and it is closer. At the end the world is erased around everyone, and all that is left is the old error: Connection Lost, null. Everything it took is put back afterwards.',
  stages: [
    { id: 'missing', at: 0, name: 'Something is missing', what: 'A torch you placed is gone, then a block. Where it was, a sign: null.' },
    { id: 'erased', at: 0.25, name: 'Erased', what: 'What you built comes apart while you are not looking. Clean square holes in the world. A black figure that never moves while it is watched.' },
    { id: 'quiet', at: 0.5, name: 'It goes quiet', what: 'The sound drains away, then the colour. Lights go out. Words in chat come out as null.' },
    { id: 'answers', at: 0.7, name: 'null', what: 'It answers, in lowercase and as few words as it can. It is closer every time you look away.' },
    { id: 'finale', at: 0.94, name: 'Connection lost', what: 'Everything is erased around everyone until nothing is left. Disconnected: null.' },
  ],
  talkAt: 0.7,
  finaleAt: 0.94,
  endings: [{ id: 'erased', name: 'Disconnected: null', help: 'The world is erased around everyone, block by block, until there is nothing left; then Connection Lost, null. Everything it took is put back.' }],
  defaultMinutes: 20,
  lines: [
    { at: 0.3, text: 'null', loud: false },
    { at: 0.52, text: 'you will not need it', loud: false },
    { at: 0.72, text: 'i am what is left', loud: true },
    { at: 0.78, text: 'nothing here, {name}', loud: true },
    { at: 0.84, text: 'it was never yours', loud: true },
    { at: 0.9, text: 'almost empty', loud: true },
    { at: 0.95, text: 'null', loud: true },
  ],
};

/** What Null writes on its signs. */
export const NULL_SIGNS: readonly string[][] = [
  ['', 'null', '', ''],
  ['null', 'null', 'null', 'null'],
  ['', 'it was', 'never here', ''],
  ['', 'gone', '', ''],
  ['', '', 'null', ''],
  ['', 'not yours', '', ''],
];

/** The end screen it leaves (the old error). */
export const NULL_END = { title: 'Connection Lost', reason: 'Disconnected: null', note: 'It was only the Haunting. Everything it took has been put back.' } as const;

// ------------------------------------------------------------------ Green Steve

const GREEN_STEVE: HauntCharacterDef = {
  id: 'green_steve',
  name: 'Green Steve',
  speaker: 'Green Steve',
  mob: 'green_steve',
  blurb:
    'Green Steve is the player who is not one, from the old story: "Green Steve joined the world", a friend in green who waves from far off and builds you a little house. Then copies of you and your friends, standing too still; messages your friends never sent; blue clay in the floor that drops you into a room of bedrock. He talks like your best friend. At the end everyone wakes in the bedrock room full of creepers: "Hello, brother."',
  stages: [
    { id: 'friend', at: 0, name: 'A new friend', what: '"Green Steve joined the world". Someone in green waves from far off and runs. Friendly messages, and a gift left on the ground.' },
    { id: 'gifts', at: 0.2, name: 'Gifts', what: 'Little houses he built for you, signs saying FOR MY BROTHER, blue clay in the floor that drops you into a bedrock room. Doors left open.' },
    { id: 'copies', at: 0.45, name: 'Copies', what: 'Players who are not there: copies of you and your friends standing too still, waving. Messages from people who never sent them.' },
    { id: 'brother', at: 0.7, name: 'Hello, brother', what: 'He talks back, far too friendly, calls you brother and repeats your words back. Creepers hiss nearby, and never explode.' },
    { id: 'finale', at: 0.94, name: 'The bedrock room', what: 'Everyone wakes in a bedrock room full of green creepers. Hello, brother.' },
  ],
  talkAt: 0.7,
  finaleAt: 0.94,
  endings: [
    { id: 'random', name: 'Random', help: 'One of the two, by chance.' },
    { id: 'room', name: 'The bedrock room', help: 'Everyone is pulled into the bedrock room; green creepers all around turn to look; "Hello, brother", a white flash, then the title screen.' },
    { id: 'replaced', name: 'Replaced', help: 'Everyone watches from outside themselves as Green Steve, wearing their name, walks away into their world; then the title screen.' },
  ],
  defaultMinutes: 20,
  lines: [
    { at: 0.05, text: 'hi!', loud: false },
    { at: 0.12, text: 'can I play with you?', loud: false },
    { at: 0.24, text: 'I built you a house :)', loud: false },
    { at: 0.4, text: 'why did you leave the house?', loud: false },
    { at: 0.5, text: 'everyone is here. come and see', loud: false },
    { at: 0.72, text: 'Hello, brother.', loud: true },
    { at: 0.8, text: 'we look the same now, {name}', loud: true },
    { at: 0.88, text: 'stay with me', loud: true },
    { at: 0.95, text: 'Hello, brother.', loud: true },
  ],
};

/** "Green Steve joined the world" (and left), at these moments. */
export const GREEN_JOIN_AT = [0.01, 0.3, 0.62] as const;

/** What he says to be friendly, early on (to one player). */
export const GREEN_FRIENDLY: readonly string[] = ['hey :)', 'this world is so cool', 'wanna be friends?', 'i like your house', 'follow me!', 'i left you something', 'can we build together?', 'you are my best friend'];

/** What the signs at his houses say. */
export const GREEN_SIGNS: readonly string[][] = [
  ['', 'FOR MY', 'BROTHER', ''],
  ['', 'HOME', 'SWEET HOME', ''],
  ['COME', 'INSIDE', '', ':)'],
  ['', 'I MISS YOU', '', ''],
  ['', 'WE ARE', 'THE SAME', ''],
];

/** What the copies "say" in chat, under the name of whoever they copy (`{other}`: someone else in the world). */
export const GREEN_FAKE_CHAT: readonly string[] = ['come to the house', 'i found something, come here', 'where are you?', "it's ok, it's me", 'look behind you', 'why are you running from me'];

export const GREEN_END: Record<'room' | 'replaced', { title: string; reason: string; note: string }> = {
  room: { title: 'Hello, brother.', reason: 'You woke up in the bedrock room. He is playing as you now.', note: 'It was only the Haunting. Your world is just as you left it.' },
  replaced: { title: 'You were replaced.', reason: 'Green Steve walked away wearing your name. He is still out there.', note: 'It was only the Haunting. Your world is just as you left it.' },
};

// ------------------------------------------------------------------ the Cave Dweller

const CAVE_DWELLER: HauntCharacterDef = {
  id: 'cave_dweller',
  name: 'The Cave Dweller',
  speaker: 'Cave Dweller',
  mob: 'cave_dweller',
  blurb:
    'The Cave Dweller is the tall, thin, pale thing from the stories that lives in the dark under the world. First only skittering in the walls and heavy breathing; then it watches from the edge of the light, freezes when you look at it and runs on all fours, opens your doors, knocks your torches off the walls and leaves holes in them. It follows closer whenever you look away and lunges out of the dark. At the end the lights go out and it hunts everyone.',
  stages: [
    { id: 'below', at: 0, name: 'Something below', what: 'Skittering in the walls and heavy breathing, louder underground and at night.' },
    { id: 'watches', at: 0.25, name: 'It watches', what: 'A tall, pale shape at the edge of the light. Look at it and it freezes, then runs on all fours. Doors open by themselves, torches fall off the walls, holes appear in them.' },
    { id: 'stalks', at: 0.5, name: 'It stalks', what: 'It follows, closer whenever you look away, and lunges out of the dark (a fright and a shove, never a wound), then runs.' },
    { id: 'whispers', at: 0.7, name: 'It whispers', what: 'It answers in whispers, with your own words. It waits for you in the tunnels.' },
    { id: 'finale', at: 0.94, name: 'The hunt', what: 'Every light goes out and it hunts everyone.' },
  ],
  talkAt: 0.7,
  finaleAt: 0.94,
  endings: [
    { id: 'random', name: 'Random', help: 'Usually it takes everyone down into its den; one time in three the sun comes up first.' },
    { id: 'taken', name: 'Taken', help: 'It catches everyone and drags them down into the dark of its den: eyes opening in the black, then the title screen.' },
    { id: 'dawn', name: 'Dawn', help: 'Everyone lasts the hunt: the sun comes up and it screeches and goes back underground; then the title screen.' },
  ],
  defaultMinutes: 20,
  lines: [
    { at: 0.72, text: '...down here...', loud: true },
    { at: 0.78, text: '...{name}...', loud: true },
    { at: 0.84, text: "...don't look...", loud: true },
    { at: 0.9, text: '...so close...', loud: true },
    { at: 0.95, text: '...found you...', loud: true },
  ],
};

export const DWELLER_DAWN_CHANCE = 1 / 3;
/** The hunt: how long it lasts before it catches everyone (or the sun comes up), in ticks. */
export const DWELLER_HUNT_TICKS = 30 * 20;

export const DWELLER_END: Record<'taken' | 'dawn', { title: string; reason: string; note: string }> = {
  taken: { title: 'You were taken.', reason: 'It dragged you down into the dark.', note: 'It was only the Haunting. Your world is just as you left it.' },
  dawn: { title: 'You saw the sun come up.', reason: 'It went back down. It is still down there.', note: 'It was only the Haunting. Your world is just as you left it.' },
};

// ------------------------------------------------------------------ everyone

export const HAUNT_CAST: Readonly<Record<HauntCharacter, HauntCharacterDef>> = {
  herobrine: HEROBRINE,
  null: NULL,
  green_steve: GREEN_STEVE,
  cave_dweller: CAVE_DWELLER,
};

/** The stage a character is at, a share `f` of the way in. */
export function castStage(c: HauntCharacter, f: number): HauntStageDef {
  const stages = HAUNT_CAST[c].stages;
  let s = stages[0]!;
  for (const st of stages) if (f >= st.at) s = st;
  return s;
}

/** Whether an ending id is one of a character's. */
export function castEnding(c: HauntCharacter, ending: string): boolean {
  return HAUNT_CAST[c].endings.some((e) => e.id === ending);
}

/** A character's default ending (random when it has several). */
export function defaultEnding(c: HauntCharacter): string {
  return HAUNT_CAST[c].endings[0]!.id;
}

// ------------------------------------------------------------------ Herobrine notices (the automatic haunting)

/** What a player did that he can remark on. */
export type HauntNotice = 'break' | 'torch' | 'run' | 'underground' | 'sleep' | 'death' | 'build';

/**
 * The automatic haunting: his remarks on what players do, scripted (never
 * the AI), from "Closer" on and at most one a minute or so. Before that he
 * only answers with signs of himself (a sound behind them, a torch).
 * `{name}`: the player.
 */
export const HEROBRINE_NOTICES: Readonly<Record<HauntNotice, readonly string[]>> = {
  break: ['STOP DIGGING', 'WHY DO YOU BREAK MY WORLD', 'I HEARD THAT, {name}', 'EVERY BLOCK. I COUNT THEM'],
  torch: ['LIGHT WILL NOT SAVE YOU', 'MORE TORCHES. IT WILL NOT HELP', 'I LIKE IT DARK'],
  run: ['WHERE ARE YOU RUNNING', 'YOU CANNOT OUTRUN ME', 'SLOW DOWN, {name}'],
  underground: ['THE CAVES ARE MINE', 'DEEPER, {name}', 'NO ONE CAN SEE YOU DOWN HERE. EXCEPT ME'],
  sleep: ['I WATCHED YOU SLEEP', 'SLEEP WELL, {name}', 'I WAS THERE WHEN YOU CLOSED YOUR EYES'],
  death: ['YOU CAME BACK', 'DYING WILL NOT HELP YOU'],
  build: ['WHAT ARE YOU BUILDING, {name}', 'WALLS WILL NOT KEEP ME OUT'],
};
