/**
 * V5.5: the Witch's Grimoire, found in every witch's hut beside the
 * Mysterious Potion. An old book of ink drawings and half-sentences that
 * foreshadow both of the potion's doors (the Farlands and The Error; the
 * computer and Herobrine) without ever reading like instructions.
 *
 * Pages are data (so the client draws them and tests can check them); the
 * drawings themselves are the client's ink sprites, named here.
 */

export type GrimoireArt =
  | 'potion'
  | 'enderman'
  | 'dragon'
  | 'dragon_fallen'
  | 'crystal'
  | 'end_island'
  | 'corrupted_eye'
  | 'corrupted_cave'
  | 'glitched_portal'
  | 'farlands'
  | 'the_error'
  | 'malware'
  | 'flash_drive'
  | 'corrupted_drive'
  | 'hard_drive'
  | 'computer'
  | 'herobrine'
  | 'fog_world'
  | 'cave_machines'
  | 'lightning'
  | 'network'
  | 'corruption'
  | 'eye_sigil';

/** One row of drawings; 'arrow' between drawings reads as "leads to". */
export type GrimoireRow = (GrimoireArt | 'arrow')[];

export interface GrimoirePage {
  title: string;
  rows: GrimoireRow[];
  /** Handwritten lines under the drawings. Some words are scratched out (~like this~). */
  text: string[];
  /** Ink style: 'ink' (brown), 'void' (violet, the first door), 'signal' (green-grey, the second). */
  ink?: 'ink' | 'void' | 'signal';
}

export const GRIMOIRE: GrimoirePage[] = [
  {
    title: '',
    rows: [['eye_sigil']],
    text: ['Two doors are drawn in this book.', 'Both open with the same bottle.', 'Close it.'],
  },
  {
    title: 'The Bottle',
    rows: [['potion']],
    text: ['Brewed where I lived. Not for drinking:', 'it pulls away from any lips.', 'It wants to be given.'],
  },
  {
    title: 'The First Door',
    ink: 'void',
    rows: [['potion', 'arrow', 'enderman'], ['crystal', 'arrow', 'dragon_fallen']],
    text: ['Give it to the tall one, who walks between places.', 'The tall one will hunt the beast of the End.', 'When no fire burns on the pillars, ~let it~ the tall one ends it.'],
  },
  {
    title: '',
    ink: 'void',
    rows: [['corrupted_eye', 'arrow', 'corrupted_cave'], ['glitched_portal', 'arrow', 'farlands', 'arrow', 'the_error']],
    text: ['The eye that comes back is wrong.', 'Under the wrong stone there is a door that is not a door.', 'Past it the land forgets how far it goes.', 'Something waits at the edge. It was never finished.'],
  },
  {
    title: 'The Second Door',
    ink: 'signal',
    rows: [['potion', 'arrow', 'dragon'], ['malware', 'arrow', 'flash_drive', 'arrow', 'corrupted_drive']],
    text: ['Give it to the beast itself.', 'It does not die of it. It coughs,', 'and what it coughs is not fire.', 'The little drive drinks what the beast coughs up.'],
  },
  {
    title: '',
    ink: 'signal',
    rows: [['dragon_fallen', 'arrow', 'computer'], ['corruption', 'arrow', 'herobrine']],
    text: ['The drive keeps quiet while the beast lives.', 'Never let it speak to a machine.', '~He~ Something is waiting for a machine.', 'White eyes.'],
  },
  {
    title: '',
    ink: 'signal',
    rows: [['computer', 'arrow', 'fog_world']],
    text: ['Hurt him and he goes back where he came from.', 'Behind the glass is a world older than ours:', 'the very one where he was first seen.', '4788685740 ~~~~~~~~'],
  },
  {
    title: '',
    ink: 'signal',
    rows: [['cave_machines'], ['network', 'lightning', 'hard_drive']],
    text: ['Under it, a cave where the lights never go out.', 'Cables, all of them running to him.', 'He is part of the machines now,', 'and the machines are full of lightning.'],
  },
  {
    title: '',
    rows: [['herobrine']],
    text: ['If you have read this far', 'you already know which door you will open.'],
  },
];

/** Every drawing the grimoire uses (the client draws each one). */
export function grimoireArt(): GrimoireArt[] {
  const out = new Set<GrimoireArt>();
  for (const p of GRIMOIRE) for (const r of p.rows) for (const a of r) if (a !== 'arrow') out.add(a);
  return [...out];
}
