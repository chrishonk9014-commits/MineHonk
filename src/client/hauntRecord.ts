/**
 * V7 phase 4: whether the player on this device has beaten Herobrine for
 * real (the boss fight in his cave: the Removed Herobrine advancement, which
 * cheats and the Admin Panel never give). A player who has may find that
 * Herobrine comes back by himself to one new world in ten they make (the
 * automatic haunting, src/common/game/haunting.ts).
 *
 * It is kept on this device only: the hub keeps no progress for accounts.
 * A win from before V7 counts too: the worlds saved on this device are
 * looked through once for a player of this profile with that advancement.
 */
import { anyPlayerHas } from '../server/storage/IndexedDBStorage';

const KEY = 'minehonk.herobrineBeaten';
export const HEROBRINE_DEFEAT = 'defeat_final_herobrine';

export function herobrineBeaten(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** He was beaten for real just now (the advancement came in), in any world. */
export function recordHerobrineBeaten(how: 'now' | 'before' = 'now'): void {
  try {
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), how }));
  } catch {
    /* private window: not remembered */
  }
}

/** A win from before this was kept: looked for once in the worlds saved here. */
export async function backfillHerobrineBeaten(uuid: string): Promise<void> {
  if (herobrineBeaten()) return;
  try {
    if (await anyPlayerHas(uuid, HEROBRINE_DEFEAT)) recordHerobrineBeaten('before');
  } catch {
    /* no saved worlds to look through */
  }
}
