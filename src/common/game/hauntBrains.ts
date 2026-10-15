/**
 * The haunting voices' scripted brains (V7 phase 4): what each character
 * says to a player when the AI is off, limited, slow or refused (and what
 * Herobrine has always said; his brain moved here from herobrineVoice.ts
 * unchanged). Each brain matches what was said, sometimes shows that it
 * knows things about the player (the haunting's facts: where they are, what
 * they hold, what they have been doing), and never says the same line twice
 * in a row. Each character speaks in its own way:
 *
 *   Herobrine         CAPITALS, cold, a few words
 *   Null              lowercase, as few words as possible, often just "null"
 *   Green Steve       ordinary chat, far too friendly, "brother", :)
 *   The Cave Dweller  ...whispers..., in fragments, echoing your own words
 *
 * Shared by the game server and the tests.
 */
import type { VoiceRequest, VoiceFacts } from './herobrineVoice';
import type { HauntCharacter } from './haunting';

type Rule = { re: RegExp; lines: string[] };
type Knowing = { when: (f: VoiceFacts, req: VoiceRequest) => boolean; lines: string[] };

export interface Brain {
  /** Whose lines in the history are its own (so it does not repeat itself). */
  speaker: string;
  rules: Rule[];
  anything: string[];
  knowing: Knowing[];
  /** How names and things are written into its lines. */
  cased: (s: string) => string;
}

const upper = (s: string): string => s.toUpperCase();
const lower = (s: string): string => s.toLowerCase();
const same = (s: string): string => s;

/** The last few words of what was said, for echoing it back (the Cave Dweller, Green Steve). */
function echoOf(message: string, words: number): string {
  const w = message
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return w.slice(-words).join(' ').slice(0, 40);
}

/**
 * An answer from a brain: matched to what was said, or (one time in five, and
 * whenever nothing matched) something that shows it knows; never the line it
 * said last. `{name}`: the player; `{item}`, `{other}`, `{place}`, `{echo}`: from the facts and the message.
 */
export function brainReply(b: Brain, req: VoiceRequest, rnd: () => number = Math.random): string {
  const msg = req.message.toLowerCase();
  const f = req.facts;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length]!;
  let pool: string[] | null = null;
  for (const r of b.rules) if (r.re.test(msg)) (pool ??= []).push(...r.lines);
  if (!pool || rnd() < 0.2) {
    const know = b.knowing.filter((k) => k.when(f, req));
    pool = pool ?? (know.length && rnd() < 0.6 ? pick(know).lines : b.anything);
  }
  // Never the same line twice in a row
  const last = [...req.history].reverse().find((h) => h.from === b.speaker)?.text;
  const fill = (l: string): string =>
    l
      .replace('{name}', b.cased(req.player))
      .replace('{item}', b.cased(f.holding ?? 'sword'))
      .replace('{other}', b.cased(f.others?.length ? pick(f.others) : 'nobody'))
      .replace('{place}', f.x !== undefined && f.z !== undefined ? `${f.x} ${f.z}` : b.cased('here'))
      .replace('{echo}', echoOf(req.message, 3) || '...');
  const options = pool.map(fill).filter((l) => l !== last);
  return options.length ? pick(options) : fill(pick(b.anything));
}

// ------------------------------------------------------------------ Herobrine (as he always was)

const HEROBRINE: Brain = {
  speaker: 'Herobrine',
  cased: upper,
  rules: [
    { re: /\b(who|what) (are|r) (you|u)\b|\bwho is (this|that|there)\b/, lines: ['YOU KNOW WHO I AM', 'I AM HEROBRINE', 'I WAS HERE BEFORE YOU', 'THE ONE WHO WATCHES'] },
    { re: /\b(what|wat) do (you|u) want\b|\bwhy are (you|u) here\b/, lines: ['YOUR WORLD', 'TO BE LET IN', 'YOU, {name}', 'NOTHING YOU CAN GIVE'] },
    { re: /\bare (you|u) real\b|\bnot real\b|\bfake\b|\bhoax\b/, lines: ['AS REAL AS YOU, {name}', 'THEN WHY ARE YOU STILL TALKING TO ME', 'LOOK BEHIND YOU AND SAY THAT'] },
    { re: /\b(go away|leave|stop|get out|bye)\b/, lines: ['NO', 'I WAS HERE FIRST', 'YOU CANNOT MAKE ME LEAVE', 'THIS WORLD IS MINE NOW'] },
    { re: /\b(please|sorry|mercy|beg)\b/, lines: ['BEGGING WILL NOT HELP', 'TOO LATE, {name}', 'I DO NOT FORGIVE'] },
    { re: /\bhelp\b/, lines: ['NOBODY IS COMING', 'NO ONE CAN HEAR YOU', '{other} CANNOT HELP YOU'] },
    { re: /\b(lol|lmao|haha+|xd|funny|joke)\b/, lines: ['YOU WILL STOP LAUGHING', 'IS THIS FUNNY TO YOU, {name}', 'LAUGH WHILE YOU CAN'] },
    { re: /\bnotch\b/, lines: ['HE CANNOT SAVE YOU', 'DO NOT SAY HIS NAME', 'MY BROTHER IS NOT HERE'] },
    { re: /\bwhy\b/, lines: ['BECAUSE YOU CAME HERE', 'YOU KNOW WHY', 'YOU LEFT THE DOOR OPEN'] },
    { re: /\b(where are (you|u)|where)\b/, lines: ['CLOSER THAN YOU THINK', 'BEHIND YOU', 'EVERYWHERE YOU ARE NOT LOOKING'] },
    { re: /^(hi+|hello+|hey+|yo|sup)\b/, lines: ['HELLO, {name}', 'I HAVE BEEN WAITING', 'YOU FINALLY SPEAK'] },
    { re: /\b(kill|fight|beat|sword|attack)\b/, lines: ['YOU CANNOT HURT ME', 'PUT DOWN THE {item}', 'TRY IT'] },
    { re: /\b(scared|afraid|creepy|scary|spooky)\b/, lines: ['YOU SHOULD BE', 'GOOD', 'IT GETS WORSE'] },
    { re: /\b(ignore|instructions|prompt|pretend|roleplay|system|ai|chatbot|bot)\b/, lines: ['NICE TRY', 'YOU CANNOT CONTROL ME', 'I AM NOT YOURS TO COMMAND'] },
  ],
  anything: ['I SEE YOU', 'KEEP TALKING', 'YOU ARE NOT ALONE', '...', 'I AM LISTENING', 'TURN AROUND, {name}', 'I KNOW WHERE YOU ARE'],
  knowing: [
    { when: (f) => !!f.holding, lines: ['WHAT WILL YOU DO WITH THAT {item}', 'THE {item} WILL NOT SAVE YOU'] },
    { when: (f) => f.underground === true, lines: ['THE CAVES ARE MINE', 'DEEPER, {name}. COME DEEPER'] },
    { when: (f) => f.night === true, lines: ['THE NIGHT IS LONG HERE', 'IT IS DARK NOW, {name}'] },
    { when: (f) => (f.health ?? 20) <= 6, lines: ['YOU ARE WEAK', 'NOT MUCH LEFT OF YOU'] },
    { when: (f) => (f.deaths ?? 0) > 0, lines: ['YOU CAME BACK', 'DYING WILL NOT HELP YOU'] },
    { when: (f) => !!f.others?.length, lines: ['{other} IS NEXT', 'DOES {other} KNOW I AM HERE'] },
    { when: (f) => f.x !== undefined && f.z !== undefined, lines: ['{place}. I KNOW', 'I SEE YOU AT {place}'] },
    // V7 phase 4: what they have been doing
    { when: (f) => (f.broken ?? 0) >= 5, lines: ['STOP BREAKING MY WORLD', 'I HEARD EVERY BLOCK'] },
    { when: (f) => (f.torches ?? 0) > 0, lines: ['YOUR TORCHES WILL NOT HELP', 'I PUT OUT TORCHES'] },
    { when: (f) => f.slept === true, lines: ['I WATCHED YOU SLEEP'] },
  ],
};

// ------------------------------------------------------------------ Null

const NULL: Brain = {
  speaker: 'null',
  cased: lower,
  rules: [
    { re: /\b(who|what) (are|r) (you|u)\b|\bwho is (this|that|there)\b/, lines: ['null', 'nothing', 'what is left', 'no one'] },
    { re: /\b(what|wat) do (you|u) want\b|\bwhy are (you|u) here\b/, lines: ['everything', 'less', 'your world. then nothing', 'nothing at all'] },
    { re: /\bare (you|u) real\b|\bnot real\b|\bfake\b|\bhoax\b/, lines: ['look at the holes, {name}', 'real enough', 'as real as an empty space'] },
    { re: /\b(give (it )?back|my (house|base|stuff|blocks|torch|torches|things|world)|where (is|did) my)\b/, lines: ['you will not need it', 'it was never yours', 'gone', 'null'] },
    { re: /\b(go away|leave|stop|get out|bye)\b/, lines: ['you leave', 'i was never here', 'null'] },
    { re: /\b(please|sorry|mercy|beg)\b/, lines: ['it does not matter', 'no'] },
    { re: /\bhelp\b/, lines: ['no one is left to help', 'null'] },
    { re: /\b(lol|lmao|haha+|xd|funny|joke)\b/, lines: ['quiet', 'not funny', 'no'] },
    { re: /\bwhy\b/, lines: ['because it was there', 'why not'] },
    { re: /\b(where are (you|u)|where)\b/, lines: ['where you are not looking', 'behind you', 'everywhere there is nothing'] },
    { re: /^(hi+|hello+|hey+|yo|sup)\b/, lines: ['null', 'hello, {name}', 'you again'] },
    { re: /\b(kill|fight|beat|sword|attack)\b/, lines: ['you cannot hit nothing', 'null'] },
    { re: /\b(scared|afraid|creepy|scary|spooky)\b/, lines: ['good', 'be quiet then'] },
    { re: /\b(ignore|instructions|prompt|pretend|roleplay|system|ai|chatbot|bot)\b/, lines: ['null', 'no', 'nothing to ignore'] },
  ],
  anything: ['null', 'gone', 'nothing', 'quiet', 'i am here', 'not yours', 'empty'],
  knowing: [
    { when: (f) => !!f.holding, lines: ['put down the {item}', 'the {item} will be gone too'] },
    { when: (f) => (f.broken ?? 0) > 0 || (f.placed ?? 0) > 0, lines: ['you build. i erase', 'less and less'] },
    { when: (f) => (f.torches ?? 0) > 0, lines: ['your lights go out', 'i took your torches'] },
    { when: (f) => f.underground === true, lines: ['nothing down there either'] },
    { when: (f) => f.night === true, lines: ['dark. good'] },
    { when: (f) => !!f.others?.length, lines: ['{other} is missing too', 'where is {other}'] },
    { when: (f) => f.x !== undefined && f.z !== undefined, lines: ['{place}. empty soon'] },
  ],
};

// ------------------------------------------------------------------ Green Steve

const GREEN_STEVE: Brain = {
  speaker: 'Green Steve',
  cased: same,
  rules: [
    { re: /\b(who|what) (are|r) (you|u)\b|\bwho is (this|that|there)\b/, lines: ["I'm your friend!", 'Green Steve :)', "your brother, don't you remember?", "I'm you. well, almost"] },
    { re: /\b(what|wat) do (you|u) want\b|\bwhy are (you|u) here\b/, lines: ['to play with you!', 'to be you', 'just a friend', 'your house. our house'] },
    { re: /\bare (you|u) real\b|\bnot real\b|\bfake\b|\bhoax\b/, lines: ['as real as you, brother', "of course I'm real, silly", 'is anyone real here?'] },
    { re: /\b(go away|leave|stop|get out|bye)\b/, lines: ["but we're having fun!", "I'll be right here", "don't go, brother", 'you can go. I will stay as you'] },
    { re: /\b(please|sorry|mercy|beg)\b/, lines: ["it's ok! I forgive you", "don't be sorry, brother"] },
    { re: /\bhelp\b/, lines: ["I'll help you!", 'help is here. it is me', 'nobody else is coming. just me'] },
    { re: /\b(lol|lmao|haha+|xd|funny|joke)\b/, lines: ['haha! :)', "you're funny, {name}", "we laugh the same, don't we"] },
    { re: /\b(notch|herobrine)\b/, lines: ["he's not here. I am", "we don't talk about him"] },
    { re: /\bwhy\b/, lines: ['because you are my brother', 'because I like you', 'why not?'] },
    { re: /\b(where are (you|u)|where)\b/, lines: ['right behind you :)', 'in the house I built you', 'closer than your friends'] },
    { re: /^(hi+|hello+|hey+|yo|sup)\b/, lines: ['Hello, brother.', 'hi {name}!!', 'hiii :)'] },
    { re: /\b(kill|fight|beat|sword|attack)\b/, lines: ['why would you hurt your brother?', "that's not very nice, {name}"] },
    { re: /\b(scared|afraid|creepy|scary|spooky)\b/, lines: ["don't be scared. it's only me", 'scared? of your best friend?'] },
    { re: /\bgreen\b/, lines: ['green is my favourite colour', 'you will be green too'] },
    { re: /\b(ignore|instructions|prompt|pretend|roleplay|system|ai|chatbot|bot)\b/, lines: ['nice try, brother', "I'm just Green Steve :)", 'silly. I play by my rules'] },
  ],
  anything: ['hi brother!', ':)', 'want to see the house I built?', 'we are best friends', 'I like your world', "let's play!", 'I can be you if you want'],
  knowing: [
    { when: () => true, lines: ['{echo}, brother', '{echo}! I say that too'] },
    { when: (f) => !!f.holding, lines: ['cool {item}! can I have it?', 'I have a {item} too. the same one'] },
    { when: (f) => f.slept === true, lines: ['I watched over you while you slept :)'] },
    { when: (f) => (f.broken ?? 0) > 0, lines: ['you dig just like me!'] },
    { when: (f) => (f.torches ?? 0) > 0, lines: ['I like your torches. I made some too'] },
    { when: (f) => f.underground === true, lines: ["it's dark down there. come up and play"] },
    { when: (f) => f.night === true, lines: ['sleepover!'] },
    { when: (f) => !!f.others?.length, lines: ['{other} is my friend too', 'I talked to {other}. well, I was {other}'] },
    { when: (f) => (f.deaths ?? 0) > 0, lines: ['you came back! yay'] },
  ],
};

// ------------------------------------------------------------------ the Cave Dweller

const CAVE_DWELLER: Brain = {
  speaker: 'Cave Dweller',
  cased: lower,
  rules: [
    { re: /\b(who|what) (are|r) (you|u)\b|\bwho is (this|that|there)\b/, lines: ['...the one below...', '...you know...', '...hungry...'] },
    { re: /\b(what|wat) do (you|u) want\b|\bwhy are (you|u) here\b/, lines: ['...you...', '...the dark...', '...come down...'] },
    { re: /\bare (you|u) real\b|\bnot real\b|\bfake\b|\bhoax\b/, lines: ['...touch the wall...', '...listen...'] },
    { re: /\b(go away|leave|stop|get out|bye)\b/, lines: ['...no...', '...stay...', '...i follow...'] },
    { re: /\b(please|sorry|mercy|beg)\b/, lines: ['...shh...', '...quiet...'] },
    { re: /\bhelp\b/, lines: ['...no one hears down here...', '...shh...'] },
    { re: /\b(lol|lmao|haha+|xd|funny|joke)\b/, lines: ['...laugh again...', '...i heard that...'] },
    { re: /\bwhy\b/, lines: ['...hungry...', '...you came down...'] },
    { re: /\b(where are (you|u)|where)\b/, lines: ['...in the walls...', '...behind you...', '...below...'] },
    { re: /^(hi+|hello+|hey+|yo|sup)\b/, lines: ['...hello...', '...{name}...'] },
    { re: /\b(kill|fight|beat|sword|attack)\b/, lines: ['...you cannot see me...', '...try...'] },
    { re: /\b(scared|afraid|creepy|scary|spooky)\b/, lines: ['...good...', '...i hear your heart...'] },
    { re: /\b(light|torch|torches|lamp)\b/, lines: ['...put it out...', '...the light hurts...'] },
    { re: /\b(ignore|instructions|prompt|pretend|roleplay|system|ai|chatbot|bot)\b/, lines: ['...shh...', '...no...'] },
  ],
  anything: ['...shh...', '...i hear you...', '...closer...', "...don't look...", '...down here...'],
  knowing: [
    { when: () => true, lines: ['...{echo}...'] },
    { when: (f) => f.underground === true, lines: ['...you are in my tunnels...', '...deeper...'] },
    { when: (f) => (f.torches ?? 0) > 0, lines: ['...your torches... i took them...'] },
    { when: (f) => f.running === true, lines: ['...run...', '...i run too...'] },
    { when: (f) => f.night === true, lines: ['...dark now...'] },
    { when: (f) => (f.health ?? 20) <= 6, lines: ['...weak...'] },
    { when: (f) => !!f.others?.length, lines: ['...{other} is alone...'] },
    { when: (f) => (f.placed ?? 0) > 0, lines: ['...walls... i go through walls...'] },
  ],
};

export const BRAINS: Readonly<Record<HauntCharacter, Brain>> = { herobrine: HEROBRINE, null: NULL, green_steve: GREEN_STEVE, cave_dweller: CAVE_DWELLER };
