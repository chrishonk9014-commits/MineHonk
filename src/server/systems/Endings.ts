/**
 * Endings (V3): who has reached which ending, the world's endgame state and
 * the cards shown when an ending is reached. The dragon fight and the
 * Farlands decide *when* an ending happens; this system records it.
 *
 * Cheats never count: an ending reached with cheats (or forced from the
 * Admin Panel) still shows its card and updates the world's state, but it is
 * listed as forced and grants no advancements.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { ENDING_BY_ID } from '../../common/data/endings';
import { newWorldEndings, type WorldEndings } from '../world/LevelData';

export class EndingsSystem {
  constructor(private readonly server: GameServer) {}

  get state(): WorldEndings {
    const l = this.server.level;
    l.endings ??= newWorldEndings();
    return l.endings;
  }

  /**
   * Records that `p` reached an ending. `show`: display the card now, or
   * hold it until the player next walks out through the End portal.
   */
  reach(p: ServerPlayer, id: string, opts: { cheat?: boolean; show?: 'now' | 'on_exit' } = {}): void {
    const def = ENDING_BY_ID.get(id);
    if (!def) return;
    const st = this.state;
    if (opts.cheat) {
      if (!st.reached[id] && !st.forced.includes(id)) st.forced.push(id);
    } else {
      st.reached[id] ??= Date.now();
      st.forced = st.forced.filter((f) => f !== id);
      p.endings.add(id);
    }
    if (opts.show === 'on_exit') p.pendingEnding = id;
    else this.showCard(p, id);
  }

  /** Walking out of the End: the held card, if any. */
  onLeaveEnd(p: ServerPlayer): void {
    const id = p.pendingEnding;
    if (!id) return;
    p.pendingEnding = null;
    // Let the arrival settle before the card fades in
    this.server.later(40, () => {
      if (this.server.players.has(p.conn.id)) this.showCard(p, id);
    });
  }

  showCard(p: ServerPlayer, id: string): void {
    const def = ENDING_BY_ID.get(id);
    if (!def) return;
    p.send({ t: 'ending', id, head: def.card.head, title: def.card.title, line: def.card.line, style: def.card.style });
    this.server.playSound(p.dim, id === 'dragon' ? 'challenge.complete' : 'glitch.zap', p.x, p.y + 1, p.z, 0.7, id === 'dragon' ? 1 : 0.5);
  }

  /** Admin Panel: forget every ending in the world and for every player (online and remembered). */
  reset(): void {
    const l = this.server.level;
    l.endings = newWorldEndings();
    for (const p of this.server.players.values()) {
      p.endings.clear();
      p.pendingEnding = null;
    }
  }

  /** Admin Panel: force an ending's world state (never counts as reached). */
  force(p: ServerPlayer, id: string): boolean {
    if (!ENDING_BY_ID.has(id)) return false;
    const st = this.state;
    if (id === 'dragon') st.dragonDeath = 'cheat';
    if (id === 'farlands_remains') {
      st.dragonDeath = 'cheat';
      st.eyeAwarded = true;
    }
    if (id === 'error_defeated') st.errorDefeated = true;
    this.reach(p, id, { cheat: true, show: 'now' });
    return true;
  }
}
