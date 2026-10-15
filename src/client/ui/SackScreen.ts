/**
 * V7 phase 3: the Trick-or-Treat Sack, opened. How many of each candy it
 * holds, "n / 128" and the room left; take candy out (one, or all of a
 * kind), eat one straight from it, or put every candy you carry in. The
 * panel only asks: every change is the server's, and the panel redraws from
 * the sack the server sends back.
 */
import { el, clear, button } from './dom';
import { iconEl, showTooltip, hideTooltip } from './slots';
import { stackOf, type Slot } from '../../common/game/itemstack';
import { CANDY_ITEM, CANDY_KINDS, CANDY_NAMES, CANDY_LOOK, SACK_CAPACITY, sackContents, sackTotal, type CandyKind } from '../../common/halloween/candy';
import type { SackOp } from '../../common/net/protocol';
import { itemById } from '../../common/registry/items';

export interface SackHost {
  /** The sack as the client last heard of it (null: not in that slot any more). */
  sack(): Slot;
  act(op: SackOp, kind?: CandyKind, n?: number): void;
  close(): void;
  /** Candy carried outside the sack (for "Put all candy in"). */
  carried(): number;
}

export class SackPanel {
  readonly root = el('div', { class: 'gui-panel sack-panel' });
  private readonly body = el('div', { class: 'sack-body' });
  private shown = '';

  constructor(private readonly host: SackHost) {
    this.root.append(el('div', { class: 'gui-title' }, 'Trick-or-Treat Sack'), this.body);
    this.refresh();
  }

  /** Redraws if the sack changed; false once there is no sack to show (the panel closes). */
  refresh(): boolean {
    const sack = this.host.sack();
    if (!sack || itemById.get('trick_or_treat_sack')?.num !== sack.id) return false;
    const carried = this.host.carried();
    const key = JSON.stringify([sack.tag?.data ?? null, carried]);
    if (key === this.shown) return true;
    this.shown = key;
    const c = sackContents(sack);
    const total = sackTotal(c);
    const left = SACK_CAPACITY - total;
    clear(this.body);
    // How full it is
    const bar = el('div', { class: 'sack-bar' + (left <= 0 ? ' full' : '') }, el('div', { style: { width: `${(total / SACK_CAPACITY) * 100}%` } }));
    this.body.append(
      el('div', { class: 'sack-count' }, el('span', { class: 'big' }, `${total} / ${SACK_CAPACITY}`), el('span', { class: 'dim' }, left > 0 ? `${left} space left` : 'Your sack is full!')),
      bar,
    );
    if (total === 0) this.body.append(el('div', { class: 'sack-empty dim' }, 'Empty. Knock on doors in a Trick-or-Treat Village in a costume, or click candy onto the sack in your inventory.'));
    for (const k of CANDY_KINDS) {
      const n = c.counts[k];
      if (n <= 0) continue;
      const stack = stackOf(CANDY_ITEM[k], 1);
      const icon = el('div', { class: 'slot sack-icon' });
      const ic = iconEl(stack, false);
      if (ic) icon.append(ic);
      icon.addEventListener('mousemove', (e) => showTooltip(stack, (e as MouseEvent).clientX, (e as MouseEvent).clientY));
      icon.addEventListener('mouseleave', () => hideTooltip());
      const row = el(
        'div',
        { class: 'sack-row' + (k === 'poisoned' ? ' poisoned' : '') },
        icon,
        el('div', { class: 'sack-name' }, el('div', { class: k === 'poisoned' ? 'poisoned-text' : k === 'king' ? 'rarity-rare' : k === 'big' ? 'yellow' : '' }, CANDY_NAMES[k]), el('div', { class: 'dim small' }, CANDY_LOOK[k])),
        el('div', { class: 'sack-n' }, `x${n}`),
        button('Take 1', () => this.host.act('take', k, 1), 'btn chip'),
        button('Take all', () => this.host.act('take', k, n), 'btn chip'),
        button(k === 'poisoned' ? 'Eat?!' : 'Eat', () => this.host.act('eat', k), 'btn chip'),
      );
      this.body.append(row);
    }
    this.body.append(
      el('div', { class: 'sack-foot' }, button(carried > 0 ? `Put all candy in (${carried})` : 'Put all candy in', () => this.host.act('fill'), 'btn', carried <= 0 || left <= 0), button('Done', () => this.host.close(), 'btn')),
    );
    return true;
  }
}
