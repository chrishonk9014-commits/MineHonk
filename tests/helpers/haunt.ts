/** V7.1: a world's hauntings are a list (one of each character at most); the tests' way to read one. */
import type { GameServer } from '../../src/server/GameServer';
import type { HauntCharacter } from '../../src/common/game/haunting';
import type { HauntState } from '../../src/server/herobrine/haunts/types';

/** The running haunting of a character, or (no character given) the first running; undefined when none. */
export function hauntOf<T = HauntState>(server: GameServer, c?: HauntCharacter): T | undefined {
  const h = server.haunting!;
  return ((c ? h.stateOf(c) : h.states[0]) ?? undefined) as T | undefined;
}
