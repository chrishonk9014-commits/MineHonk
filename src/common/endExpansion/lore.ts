/**
 * V6 - The End Expansion, phase 3: the lore pool.
 *
 * Fragments, not explanations: each is a torn page, a log entry, a stone
 * rubbing, a note, a star chart or a partial translation of at most four
 * short lines, about one topic. None answers a question; many raise new
 * ones, and some contradict each other a little, as if written by different
 * people. The pool is listed in docs/END_EXPANSION.md ("Lore pool (review)")
 * for hand editing; tests check that the two agree.
 *
 * A lore book is the plain `book` item with `tag.lore` set to a fragment id
 * (rolled by the `lore` loot function by each structure's weights). The
 * Dragon's Nest has its own fixed five, found nowhere else.
 */
import type { Random } from '../math/rng';

export type LoreTopic = 'dragon' | 'civilization' | 'endermen' | 'cities' | 'fragmented' | 'gateways' | 'overworld' | 'history';
export type LoreKind = 'torn_page' | 'log' | 'inscription' | 'note' | 'star_chart' | 'translation';

/** Places lore is found: the End City 2.0 variants, the giant structures and the Nest. */
export type LoreSite =
  | 'end_outpost'
  | 'end_settlement'
  | 'end_ruins'
  | 'end_library'
  | 'end_observatory'
  | 'end_shipyard'
  | 'end_metropolis'
  | 'end_palace'
  | 'end_colossus'
  | 'crystal_cathedral'
  | 'void_observatory'
  | 'end_fortress'
  | 'fallen_city'
  | 'dragon_nest';

export interface LoreFragment {
  id: string;
  topic: LoreTopic;
  kind: LoreKind;
  /** At most four short lines. */
  lines: string[];
  /** Only found at these sites (otherwise wherever its topic is weighted). */
  only?: LoreSite[];
}

/** What a lore book is called, by the kind of fragment it holds. */
export const LORE_KIND_NAMES: Record<LoreKind, string> = {
  torn_page: 'Torn Page',
  log: 'Log Entry',
  inscription: 'Stone Rubbing',
  note: 'Loose Note',
  star_chart: 'Star Chart',
  translation: 'Partial Translation',
};

export const LORE_TOPIC_NAMES: Record<LoreTopic, string> = {
  dragon: 'The Ender Dragon',
  civilization: 'The ancient civilization',
  endermen: 'Endermen',
  cities: 'End Cities',
  fragmented: 'Why the End is broken apart',
  gateways: 'The End gateways',
  overworld: 'The End and the Overworld',
  history: 'The history of the End',
};

export const LORE: LoreFragment[] = [
  // The Ender Dragon
  { id: 'dragon_counting', topic: 'dragon', kind: 'log', lines: ['The beast circled the tower nine times today.', 'It does not hunt us.', 'It is counting something.'] },
  { id: 'dragon_pillars_ours', topic: 'dragon', kind: 'torn_page', lines: ['We did not make the beast.', 'We only made the pillars.', 'Whoever says otherwise has not read the old marks.'] },
  { id: 'dragon_pillars_not_ours', topic: 'dragon', kind: 'torn_page', lines: ['The pillars were never ours.', 'They stood here when we came,', 'and the fires on them were already lit.'] },
  { id: 'dragon_gate', topic: 'dragon', kind: 'inscription', lines: ['IT GUARDS THE GATE', 'OR THE GATE GUARDS IT'] },
  { id: 'dragon_returns', topic: 'dragon', kind: 'note', lines: ['Every time it falls, it comes back.', 'Not the same.', 'Never quite the same.'] },
  { id: 'dragon_translation', topic: 'dragon', kind: 'translation', lines: ['"...the one that flies is the one that [?]..."', 'The last word has no translation.', 'It is the same mark as "waits".'], only: ['end_library', 'fallen_city'] },
  // The ancient civilization
  { id: 'civ_not_first', topic: 'civilization', kind: 'inscription', lines: ['WE WHO CUT THE STONE', 'WERE NOT THE FIRST TO CUT IT'] },
  { id: 'civ_bricks', topic: 'civilization', kind: 'log', lines: ['Counted the old bricks again.', 'The newest are older than any city.', 'Who were they building for?'] },
  { id: 'civ_wrote', topic: 'civilization', kind: 'torn_page', lines: ['They wrote on everything:', 'walls, floors, the undersides of bridges.', 'As if afraid of being forgotten,', 'or of forgetting.'] },
  { id: 'civ_hum', topic: 'civilization', kind: 'note', lines: ['The old machines hum when nobody is listening.', 'Or I imagine it.'] },
  { id: 'civ_left', topic: 'civilization', kind: 'torn_page', lines: ['They left in a single day.', 'Doors open. Lamps lit.', 'Nobody has found where they went.'] },
  { id: 'civ_translation', topic: 'civilization', kind: 'translation', lines: ['"...before the cities there was [?], and [?] was..."', 'The same mark is cut over every sealed door.', 'We think it means "wait".'], only: ['end_library', 'fallen_city'] },
  // Endermen
  { id: 'endermen_halls', topic: 'endermen', kind: 'log', lines: ['The tall ones walked our halls before they were finished.', 'They never moved a single block of them.'] },
  { id: 'endermen_carried', topic: 'endermen', kind: 'note', lines: ['The tall ones carried the stone for us,', 'one block at a time.', 'They have not stopped.'] },
  { id: 'endermen_ask', topic: 'endermen', kind: 'torn_page', lines: ['Ask one of the tall ones where it is from.', 'It will look at you,', 'and then you will be the one who leaves.'] },
  { id: 'endermen_eyes', topic: 'endermen', kind: 'inscription', lines: ['DO NOT MEET THEIR EYES', 'THEY REMEMBER FACES'] },
  // End Cities
  { id: 'cities_upward', topic: 'cities', kind: 'torn_page', lines: ['The cities were built upward', 'because there was nowhere left to build outward.'] },
  { id: 'cities_purpur', topic: 'cities', kind: 'log', lines: ['Purpur grows if you let it.', 'We stopped letting it.'] },
  { id: 'cities_ships', topic: 'cities', kind: 'note', lines: ['Every city had a ship.', 'Every ship was ready to leave.', 'Most of them never did.'] },
  { id: 'cities_last_first', topic: 'cities', kind: 'inscription', lines: ['THIS CITY WAS THE LAST', 'THIS CITY WAS THE FIRST'] },
  // Why the End is broken apart
  { id: 'fragmented_pulled', topic: 'fragmented', kind: 'torn_page', lines: ['The land was whole once.', 'Then something pulled,', 'and it came apart like wet paper.'] },
  { id: 'fragmented_never_whole', topic: 'fragmented', kind: 'note', lines: ['It was never whole.', 'We only told the children that', 'so they would not look down.'] },
  { id: 'fragmented_wider', topic: 'fragmented', kind: 'log', lines: ['Measured the gap between two islands.', 'Wider than last year.', 'Wider than the year before.'] },
  { id: 'fragmented_holds', topic: 'fragmented', kind: 'inscription', lines: ['WHAT HOLDS THE ISLANDS UP', 'IS WHAT KEEPS THEM APART'] },
  { id: 'fragmented_clean', topic: 'fragmented', kind: 'torn_page', lines: ['The edges are clean.', 'Stone does not break that cleanly on its own.'] },
  // The End gateways
  { id: 'gateways_in', topic: 'gateways', kind: 'torn_page', lines: ['The gateways were not built to let things in.', 'Read that again.'] },
  { id: 'gateways_count', topic: 'gateways', kind: 'note', lines: ['A new gateway opens each time the beast falls.', 'Who decided that?', 'Who is keeping count?'] },
  { id: 'gateways_before', topic: 'gateways', kind: 'inscription', lines: ['THE DOORS IN THE SKY', 'WERE HERE BEFORE THE SKY'] },
  // The End and the Overworld
  { id: 'overworld_weather', topic: 'overworld', kind: 'torn_page', lines: ['There is a world with weather.', 'I have never seen it.', 'My grandmother said it was loud.'] },
  { id: 'overworld_eyes', topic: 'overworld', kind: 'note', lines: ['Twelve eyes to open the way from below.', 'Who taught them the number?'] },
  { id: 'overworld_dream', topic: 'overworld', kind: 'inscription', lines: ['THE GREEN WORLD IS THE DREAM', 'THIS IS THE WAKING'] },
  // The history of the End
  { id: 'history_order', topic: 'history', kind: 'torn_page', lines: ['First the stone. Then the builders.', 'Then the beast.', 'Or was it the beast first?'] },
  { id: 'history_long_dark', topic: 'history', kind: 'log', lines: ['The year of the long dark. No lamp would stay lit.', 'We moved everything to the outer islands.'] },
  { id: 'history_nobody_lived', topic: 'history', kind: 'torn_page', lines: ['Nobody ever lived on the outer islands.', 'Whoever wrote otherwise', 'was copying from something older.'] },
  { id: 'history_middle', topic: 'history', kind: 'note', lines: ['Our records begin in the middle of a sentence.'] },
  { id: 'history_crown', topic: 'history', kind: 'inscription', lines: ['REMEMBER THE CROWN', 'REMEMBER WHO WORE IT LAST'] },
  // Star charts (the observatories)
  { id: 'stars_missing', topic: 'history', kind: 'star_chart', lines: ['The stars here do not move.', 'We charted them for a hundred years anyway.', 'On the last night, one of them was gone.'], only: ['end_observatory', 'void_observatory'] },
  { id: 'stars_gateways', topic: 'gateways', kind: 'star_chart', lines: ['Each gateway points at a star.', 'Each star points back.'], only: ['end_observatory', 'void_observatory'] },
];

/** The Dragon's Nest's own five fragments (about the Dragon and the central End), found nowhere else. */
export const NEST_LORE: LoreFragment[] = [
  { id: 'nest_many', topic: 'dragon', kind: 'inscription', lines: ['MANY NESTS', 'ONE SKY'] },
  { id: 'nest_sealed', topic: 'history', kind: 'torn_page', lines: ['We sealed the hollows and built the island over them.', 'Nobody asked what had been in them.', 'Nobody wanted to.'] },
  { id: 'nest_counted', topic: 'dragon', kind: 'note', lines: ['Counted the hollows twice', 'and got two different numbers.'] },
  { id: 'nest_visit', topic: 'dragon', kind: 'log', lines: ['The beast came down here once while we worked.', 'It looked into every hollow in turn,', 'then left without a sound.'] },
  { id: 'nest_first_fire', topic: 'history', kind: 'inscription', lines: ['THE FIRST FIRE WAS LIT HERE', 'NOT ON THE PILLARS'] },
];

/**
 * Phase 4: fragments only a quest gives (found nowhere else): the Lost
 * Observatory's star chart, the Broken Gateway's first repair, and the last
 * fragment in the Dragon's History's Sanctum.
 */
export const QUEST_LORE: LoreFragment[] = [
  { id: 'stars_circle', topic: 'history', kind: 'star_chart', lines: ['Every star we chart is the same distance from us.', 'Seen from the green world, they are not.', 'What stands at the middle of the circle?'] },
  { id: 'gateways_stitches', topic: 'gateways', kind: 'torn_page', lines: ['The gateways were never meant for walking through.', 'The oldest map calls them stitches.', 'Stitches hold two edges together.'] },
  { id: 'sanctum_seen', topic: 'dragon', kind: 'inscription', lines: ['THE FIRST FIRE WAS NOT LIT FOR WARMTH', 'IT WAS LIT TO BE SEEN', 'FROM PAST THE EDGE', 'IT WAS SEEN'] },
];

export const LORE_BY_ID = new Map([...LORE, ...NEST_LORE, ...QUEST_LORE].map((f) => [f.id, f]));

/** How much each site leans towards each topic (0 = never). */
const TOPIC_WEIGHTS: Record<Exclude<LoreSite, 'dragon_nest'>, Partial<Record<LoreTopic, number>>> = {
  end_outpost: { overworld: 3, gateways: 3, fragmented: 2, endermen: 1 },
  end_settlement: { endermen: 3, cities: 3, overworld: 2, history: 1 },
  end_ruins: { civilization: 3, history: 3, cities: 2, fragmented: 2 },
  end_library: { dragon: 2, civilization: 3, endermen: 2, cities: 2, fragmented: 2, gateways: 2, overworld: 2, history: 3 },
  end_observatory: { gateways: 3, fragmented: 2, history: 2 },
  end_shipyard: { cities: 3, overworld: 2, gateways: 2 },
  end_metropolis: { cities: 3, history: 2, dragon: 1, endermen: 1 },
  end_palace: { history: 3, civilization: 2, dragon: 2 },
  end_colossus: { civilization: 3, dragon: 2, history: 2 },
  crystal_cathedral: { dragon: 3, history: 2, civilization: 2 },
  void_observatory: { gateways: 3, fragmented: 3, history: 2 },
  end_fortress: { endermen: 2, history: 2, dragon: 3, fragmented: 1 },
  fallen_city: { civilization: 3, cities: 3, history: 3, fragmented: 2, dragon: 1, endermen: 1 },
};

/** A fragment's placement weight at a site. */
export function loreWeight(f: LoreFragment, site: LoreSite): number {
  if (QUEST_LORE.includes(f)) return 0;
  if (site === 'dragon_nest') return NEST_LORE.includes(f) ? 1 : 0;
  if (NEST_LORE.includes(f)) return 0;
  if (f.only) return f.only.includes(site) ? 3 : 0;
  return TOPIC_WEIGHTS[site][f.topic] ?? 0;
}

/** Picks a fragment for a site by its weights. */
export function pickLore(site: LoreSite, rng: Random): LoreFragment {
  const pool = [...LORE, ...NEST_LORE].map((f) => ({ f, weight: loreWeight(f, site) })).filter((e) => e.weight > 0);
  return rng.weighted(pool).f;
}

/** Every site lore is found at. */
export const LORE_SITES: LoreSite[] = ['end_outpost', 'end_settlement', 'end_ruins', 'end_library', 'end_observatory', 'end_shipyard', 'end_metropolis', 'end_palace', 'end_colossus', 'crystal_cathedral', 'void_observatory', 'end_fortress', 'fallen_city', 'dragon_nest'];

/** Display name of a lore book (by the fragment it holds). */
export function loreBookName(id: string): string | null {
  const f = LORE_BY_ID.get(id);
  return f ? LORE_KIND_NAMES[f.kind] : null;
}
