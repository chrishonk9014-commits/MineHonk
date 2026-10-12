/** Small in-game overlays: sign editing and the player list. */
import { el, clear, button } from './dom';
import type { GameMode } from '../../common/game/gamemode';
import type { WorldInfo } from '../../common/net/protocol';
import type { WorldRole } from '../../common/net/multiplayer';
import { LIMITS } from '../../common/net/protocol';

export class SignEditor {
  readonly root = el('div', { class: 'screen dim center interactive' });
  private readonly inputs: HTMLInputElement[] = [];

  constructor(lines: string[], private readonly done: (lines: string[]) => void) {
    const board = el('div', { class: 'sign-board' });
    for (let i = 0; i < 4; i++) {
      const inp = el('input', { class: 'sign-line', maxLength: LIMITS.signLine, value: lines[i] ?? '' }) as HTMLInputElement;
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (e.key === 'Enter' && i === 3) this.finish();
          else this.inputs[Math.min(3, i + 1)]!.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.inputs[Math.max(0, i - 1)]!.focus();
        } else if (e.key === 'Escape') this.finish();
      });
      this.inputs.push(inp);
      board.append(inp);
    }
    this.root.append(el('div', { class: 'title-text' }, 'Edit Sign Message'), board, el('div', { class: 'spacer' }), button('Done', () => this.finish()));
    setTimeout(() => this.inputs[0]!.focus(), 0);
  }

  private finish(): void {
    this.done(this.inputs.map((i) => i.value.slice(0, LIMITS.signLine)));
  }

  destroy(): void {
    this.root.remove();
  }
}

const ROLE_TAG: Record<WorldRole, string> = { owner: 'Owner', operator: 'Op', builder: '', visitor: 'Visitor' };

export class PlayerList {
  readonly root = el('div', { class: 'player-list hidden' });
  private lastKey = '';

  update(players: { name: string; uuid: string; ping: number; mode: GameMode; role?: WorldRole }[], visible: boolean, world: WorldInfo | null): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) return;
    const key = JSON.stringify([players, world?.name, world?.joinCode]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    clear(this.root);
    if (world) this.root.append(el('div', { class: 'pl-header' }, world.name + (world.joinCode ? `  ·  Join code: ${world.joinCode}` : '')));
    const grid = el('div', { class: 'pl-grid' });
    for (const p of players) {
      const bars = p.ping < 150 ? 5 : p.ping < 300 ? 4 : p.ping < 600 ? 3 : p.ping < 1000 ? 2 : 1;
      // Roles only matter (and are only sent) in multiplayer worlds
      const tag = p.role && p.role !== 'builder' ? el('span', { class: 'pl-role ' + p.role }, ROLE_TAG[p.role]) : null;
      grid.append(el('div', { class: 'pl-row' + (p.mode === 'spectator' ? ' spectator' : '') }, el('span', {}, p.name, tag), el('span', { class: 'ping', title: `${p.ping} ms` }, '▮'.repeat(bars))));
    }
    this.root.append(grid);
  }
}
