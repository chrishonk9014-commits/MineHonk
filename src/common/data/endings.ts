/**
 * MineHonk's endings. Each is reached once per player (and remembered by
 * the world); reaching one shows its card. New endings are added here and
 * triggered by the system that owns them (the dragon fight, the Farlands).
 */
export type EndingStyle = 'calm' | 'glitch' | 'error';

export interface EndingDef {
  id: string;
  /** Display order in lists. */
  order: number;
  /** Short label for lists ("Ending 1"). */
  label: string;
  /** The ending's name. */
  title: string;
  /** What the card shows. */
  card: { head: string; title: string; line: string; style: EndingStyle };
  /** Not listed anywhere until someone reaches it. */
  secret?: boolean;
}

export const ENDINGS: EndingDef[] = [
  {
    id: 'dragon',
    order: 1,
    label: 'Ending 1',
    title: 'The Ender Dragon',
    card: { head: 'ENDING 1', title: 'The Ender Dragon', line: 'You have reached Ending 1 of MineHonk: The Ender Dragon', style: 'calm' },
  },
  {
    id: 'farlands_remains',
    order: 2,
    label: 'Secret Ending',
    title: 'The Farlands Remains',
    secret: true,
    card: { head: 'SECRET ENDING', title: 'The Farlands Remains', line: '', style: 'glitch' },
  },
  {
    id: 'error_defeated',
    order: 3,
    label: 'Farlands Ending',
    title: 'ERROR DEFEATED',
    secret: true,
    card: { head: 'FARLANDS ENDING', title: 'ERROR DEFEATED', line: 'The Farlands fall quiet. For now.', style: 'error' },
  },
];

export const ENDING_BY_ID = new Map(ENDINGS.map((e) => [e.id, e]));
