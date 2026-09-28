/**
 * Recipe Book panel shown beside the inventory and workstation screens.
 * Entries come from the shared recipe registries (see common/game/recipeBook);
 * craftability is recomputed from the player's items whenever the inventory
 * changes, touching only the rows whose status changed.
 */
import { el, clear } from './dom';
import { iconEl, showTooltip, hideTooltip } from './slots';
import { sprites } from './sprites';
import type { Slot, ItemStack } from '../../common/game/itemstack';
import { items, itemById } from '../../common/registry/items';
import { recipeBook, entryState, countItems, itemName, filterBook, BOOK_CATEGORIES, STATION_NAMES, type BookEntry, type BookCategory, type EntryState } from '../../common/game/recipeBook';

type Filter = BookCategory | 'all';

/** Remembered between screens during a session. */
const memory = { open: false, category: 'all' as Filter, query: '', craftable: false, selected: '' };

export function recipeBookOpen(): boolean {
  return memory.open;
}
export function setRecipeBookOpen(v: boolean): void {
  memory.open = v;
}

const STATUS_TEXT: Record<EntryState['status'], string> = { ready: 'Can craft', station: 'Needs', missing: 'Missing items' };

export class RecipeBookPanel {
  readonly root = el('div', { class: 'recipe-book gui-panel' });
  private readonly entries = recipeBook();
  private readonly states = new Map<string, EntryState>();
  private readonly rows = new Map<string, HTMLElement>();
  private readonly list = el('div', { class: 'rb-list' });
  private readonly detail = el('div', { class: 'rb-detail' });
  private readonly countLabel = el('div', { class: 'rb-count' });
  private counts = new Map<number | string, number>();
  private signature = '';
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private cycleCells: { cell: HTMLElement; options: number[]; potion?: string }[] = [];
  private cycleTick = 0;
  private shown: BookEntry[] = [];

  constructor(
    private readonly windowKind: string,
    private readonly advancedTooltips: boolean,
  ) {
    const search = el('input', { class: 'field rb-search', placeholder: 'Search recipes...', value: memory.query }) as HTMLInputElement;
    search.addEventListener('input', () => {
      memory.query = search.value;
      this.renderList();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation();
    });
    const craftable = el('button', { class: 'btn chip rb-toggle' + (memory.craftable ? ' active' : '') }, 'Craftable only') as HTMLButtonElement;
    craftable.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      memory.craftable = !memory.craftable;
      craftable.classList.toggle('active', memory.craftable);
      this.renderList();
    });
    const tabs = el('div', { class: 'rb-tabs' });
    const tab = (id: Filter, icon: string, title: string): HTMLElement => {
      const t = el('div', { class: 'rb-tab' + (memory.category === id ? ' active' : ''), title });
      const num = itemById.get(icon)?.num;
      const ic = num !== undefined ? iconEl({ id: num, count: 1 }, false) : null;
      if (ic) t.append(ic);
      t.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        memory.category = id;
        for (const c of tabs.children) c.classList.remove('active');
        t.classList.add('active');
        this.renderList();
      });
      return t;
    };
    tabs.append(tab('all', 'book', 'All recipes'));
    for (const c of BOOK_CATEGORIES) if (this.entries.some((e) => e.category === c.id)) tabs.append(tab(c.id, c.icon, c.name));
    this.root.append(el('div', { class: 'gtitle' }, 'Recipe Book'), search, el('div', { class: 'row rb-bar' }, craftable, this.countLabel), tabs, this.list, this.detail);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.list.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  /** Recomputes craftability from the player's items (cheap; only changed rows are touched). */
  update(slots: Iterable<Slot>): void {
    const counts = countItems(slots);
    const sig = [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(',');
    if (sig === this.signature && this.states.size) return;
    this.signature = sig;
    this.counts = counts;
    const first = this.states.size === 0;
    for (const e of this.entries) {
      const s = entryState(e, counts, this.windowKind);
      const old = this.states.get(e.id);
      this.states.set(e.id, s);
      if (!first && old?.status !== s.status) {
        const row = this.rows.get(e.id);
        if (row) this.styleRow(row, e, s);
      }
    }
    if (first) this.renderList();
    else if (memory.craftable) this.renderList();
    else this.updateCount();
    const sel = this.entries.find((e) => e.id === memory.selected);
    if (sel) this.renderDetail(sel);
  }

  private visible(): BookEntry[] {
    return filterBook(this.entries, { query: memory.query, category: memory.category, craftableOnly: memory.craftable, states: this.states });
  }

  private updateCount(): void {
    const ready = this.shown.filter((e) => this.states.get(e.id)?.status === 'ready').length;
    this.countLabel.textContent = `${this.shown.length} recipes, ${ready} craftable here`;
  }

  private renderList(): void {
    this.shown = this.visible();
    clear(this.list);
    this.rows.clear();
    const frag = document.createDocumentFragment();
    for (const e of this.shown) {
      const row = el('div', { class: 'rb-row' });
      const icon = el('div', { class: 'slot rb-icon' });
      const ic = iconEl(e.result);
      if (ic) icon.append(ic);
      const text = el('div', { class: 'rb-text' }, el('div', { class: 'rb-name' }, itemName(e.result)), el('div', { class: 'rb-sub' }));
      row.append(icon, text);
      row.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        memory.selected = e.id;
        for (const r of this.list.querySelectorAll('.rb-row.selected')) r.classList.remove('selected');
        row.classList.add('selected');
        this.renderDetail(e);
      });
      icon.addEventListener('mousemove', (ev) => showTooltip(e.result, ev.clientX, ev.clientY, this.advancedTooltips));
      icon.addEventListener('mouseleave', () => hideTooltip());
      if (e.id === memory.selected) row.classList.add('selected');
      this.rows.set(e.id, row);
      this.styleRow(row, e, this.states.get(e.id));
      frag.append(row);
    }
    if (!this.shown.length) frag.append(el('div', { class: 'rb-empty' }, 'No recipes match.'));
    this.list.append(frag);
    this.updateCount();
    const sel = this.entries.find((e) => e.id === memory.selected);
    if (sel) this.renderDetail(sel);
    else this.renderDetail(null);
  }

  private stationLabel(e: BookEntry): string {
    if (e.station === 'crafting') return e.fits2x2 ? 'Inventory or Crafting Table' : 'Crafting Table';
    return e.stations.map((s) => STATION_NAMES[s] ?? s).join(' / ');
  }

  private styleRow(row: HTMLElement, e: BookEntry, s: EntryState | undefined): void {
    const status = s?.status ?? 'missing';
    row.classList.remove('ready', 'station', 'missing');
    row.classList.add(status);
    const sub = row.querySelector('.rb-sub')!;
    sub.textContent = status === 'station' ? `${STATUS_TEXT.station} ${this.stationLabel(e)}` : status === 'ready' ? `${STATUS_TEXT.ready} - ${this.stationLabel(e)}` : this.stationLabel(e);
  }

  // ------------------------------------------------------------------ detail

  private slotFor(req: { options: number[]; potion?: string } | null, count = 1): HTMLElement {
    const cell = el('div', { class: 'slot' });
    if (!req || !req.options.length) return cell;
    const stack: ItemStack = { id: req.options[0]!, count, ...(req.potion ? { tag: { potion: req.potion } } : {}) };
    const ic = iconEl(stack);
    if (ic) cell.append(ic);
    if (req.options.length > 1) {
      cell.classList.add('rb-cycle');
      this.cycleCells.push({ cell, options: req.options, potion: req.potion });
    }
    cell.addEventListener('mousemove', (ev) => {
      const cur = Number(cell.dataset.item ?? req.options[0]);
      showTooltip({ id: cur, count: 1, ...(req.potion ? { tag: { potion: req.potion } } : {}) }, ev.clientX, ev.clientY, this.advancedTooltips);
    });
    cell.addEventListener('mouseleave', () => hideTooltip());
    return cell;
  }

  private renderDetail(e: BookEntry | null): void {
    clear(this.detail);
    this.cycleCells = [];
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    if (!e) {
      this.detail.append(el('div', { class: 'rb-hint' }, 'Select a recipe to see its ingredients.'));
      return;
    }
    const s = this.states.get(e.id) ?? entryState(e, this.counts, this.windowKind);
    const result = el('div', { class: 'slot big' });
    const ric = iconEl(e.result);
    if (ric) result.append(ric);
    result.addEventListener('mousemove', (ev) => showTooltip(e.result, ev.clientX, ev.clientY, this.advancedTooltips));
    result.addEventListener('mouseleave', () => hideTooltip());
    const arrow = el('div', { class: 'progress-arrow' });
    arrow.style.backgroundImage = `url(${sprites().arrowEmpty})`;
    let layout: HTMLElement;
    if (e.grid) {
      const g = el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(3, calc(var(--s) * 18))' } });
      for (const cell of e.grid) g.append(this.slotFor(cell === null ? null : e.requirements[cell]!));
      layout = el('div', { class: 'row rb-layout' }, g, arrow, result);
    } else {
      const inputs = (e.inputs ?? [0]).map((i) => this.slotFor(e.requirements[i]!));
      const parts: HTMLElement[] = [];
      inputs.forEach((c, i) => {
        if (i > 0 && !(e.station === 'furnace' && i === 1)) parts.push(el('div', { class: 'muted' }, '+'));
        parts.push(c);
      });
      if (e.station === 'furnace') {
        const flame = el('div', { class: 'flame' });
        flame.style.backgroundImage = `url(${sprites().flameFull})`;
        // Furnace layout: input above the flame, fuel below
        layout = el('div', { class: 'row rb-layout' }, el('div', { class: 'stack', style: { gap: 'calc(var(--s) * 2)' } }, inputs[0]!, flame, inputs[1]!), arrow, result);
      } else layout = el('div', { class: 'row rb-layout' }, ...parts, arrow, result);
    }
    const station = el('div', { class: 'rb-station' }, `Station: ${this.stationLabel(e)}`);
    const flags: string[] = [];
    if (e.shapeless) flags.push('Shapeless: any arrangement works');
    if (e.station === 'crafting' && !e.fits2x2) flags.push('Needs a Crafting Table (3x3)');
    if (e.xp) flags.push(`${e.xp} XP per item`);
    const status = el('div', { class: 'rb-status ' + s.status }, s.status === 'ready' ? 'You can craft this now.' : s.status === 'station' ? `You have the ingredients. Use a ${this.stationLabel(e)}.` : 'Missing ingredients:');
    const reqs = el('div', { class: 'rb-reqs' });
    for (const r of e.requirements) {
      const have = this.have(r);
      const ok = have >= r.count;
      const ic = el('div', { class: 'slot small' });
      const icon = iconEl({ id: r.options[0] ?? 0, count: 1, ...(r.potion ? { tag: { potion: r.potion } } : {}) }, false);
      if (icon) ic.append(icon);
      reqs.append(el('div', { class: 'rb-req ' + (ok ? 'ok' : 'missing') }, ic, el('span', { class: 'rb-req-name' }, r.label), el('span', { class: 'rb-req-count' }, `${Math.min(have, r.count)}/${r.count}`)));
    }
    this.detail.append(el('div', { class: 'rb-title' }, `${itemName(e.result)}${e.result.count > 1 ? ' x' + e.result.count : ''}`), layout, station, ...flags.map((f) => el('div', { class: 'rb-flag' }, f)));
    if (e.note) this.detail.append(el('div', { class: 'rb-note' }, e.note));
    this.detail.append(status, reqs);
    if (this.cycleCells.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.cycleTimer = setInterval(() => this.cycle(), 1200);
    }
  }

  /** How many of a requirement the player holds. */
  private have(r: { options: number[]; potion?: string }): number {
    let n = 0;
    for (const num of r.options) n += this.counts.get(r.potion ? `${num}:${r.potion}` : num) ?? 0;
    return n;
  }

  /** Steps group ingredients ("any planks") through their options. */
  private cycle(): void {
    this.cycleTick++;
    for (const c of this.cycleCells) {
      const num = c.options[this.cycleTick % c.options.length]!;
      c.cell.dataset.item = String(num);
      c.cell.querySelector(':scope > div')?.remove();
      const ic = iconEl({ id: num, count: 1, ...(c.potion ? { tag: { potion: c.potion } } : {}) });
      if (ic) c.cell.append(ic);
    }
  }

  destroy(): void {
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.cycleTimer = null;
    this.root.remove();
  }
}

/** Slots whose contents belong to the player for a given window kind (result/output slots excluded). */
export function playerOwnedSlots(kind: string, slots: Slot[], size: number): Slot[] {
  switch (kind) {
    case 'player':
      return slots.filter((_, i) => (i >= 1 && i <= 4) || i >= 9);
    case 'crafting':
      return slots.filter((_, i) => i >= 1);
    case 'furnace':
    case 'blast_furnace':
    case 'smoker':
    case 'smithing':
    case 'anvil':
      return slots.filter((_, i) => i !== 2);
    case 'stonecutter':
      return slots.filter((_, i) => i !== 1);
    default:
      return slots.filter((_, i) => i >= size);
  }
}

void items;
