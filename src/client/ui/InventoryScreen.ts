/**
 * Container GUI. Layout is chosen by window kind; slot indices match the
 * server's window slot order. All clicks are sent to the server, which
 * replies with authoritative contents.
 */
import { el, clear } from './dom';
import { fillSlot, showTooltip, hideTooltip, iconEl } from './slots';
import type { Slot } from '../../common/game/itemstack';
import type { C2S, WindowKind, ClickMode } from '../../common/net/protocol';
import { sprites } from './sprites';
import { items, CREATIVE_TABS } from '../../common/registry/items';

export interface WindowState {
  id: number;
  kind: WindowKind;
  title: string;
  size: number;
  slots: Slot[];
  props: Record<string, unknown>;
}

export class InventoryScreen {
  readonly root = el('div', { class: 'layer interactive' });
  private readonly slotEls = new Map<number, HTMLElement>();
  private readonly cursorEl = el('div', { class: 'cursor-item' });
  private cursor: Slot = null;
  private hovered = -1;
  private dragging = false;
  private dragButton = 0;
  private dragSlots: number[] = [];
  private lastClick = { slot: -1, time: 0 };
  private seq = 0;
  private win: WindowState;
  private progress: { arrow?: HTMLElement; flame?: HTMLElement } = {};
  private mouse = { x: 0, y: 0 };
  private creativeTab = 'building';
  private creativeSearch = '';
  private creativeGrid: HTMLElement | null = null;
  private creativeCursor: Slot = null;
  private readonly keyHandler: (e: KeyboardEvent) => void;
  private detachPreview: (() => void) | null = null;

  constructor(
    win: WindowState,
    cursor: Slot,
    private readonly send: (m: C2S) => void,
    private readonly opts: { creative: boolean; playerSlots: () => Slot[]; onClose: () => void; advancedTooltips: boolean; attachPreview?: (host: HTMLElement) => () => void },
  ) {
    // Own copy: the caller mutates its window state as messages arrive
    this.win = { ...win, props: { ...win.props } };
    this.cursor = cursor;
    this.build();
    this.root.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      this.cursorEl.style.left = e.clientX + 'px';
      this.cursorEl.style.top = e.clientY + 'px';
      if (this.hovered >= 0) showTooltip(this.cursor || this.creativeCursor ? null : this.slotStack(this.hovered), e.clientX, e.clientY, this.opts.advancedTooltips);
    });
    this.root.addEventListener('mousedown', (e) => {
      // click outside the GUI drops the cursor stack
      if ((e.target as HTMLElement) === this.root) {
        if (this.isCreative()) {
          if (this.creativeCursor) {
            this.send({ t: 'creative_set', slot: -1, item: e.button === 1 ? { ...this.creativeCursor, count: 1 } : this.creativeCursor });
            this.creativeCursor = null;
            this.renderCursor();
          }
          return;
        }
        this.click(-999, e.button === 2 ? 1 : 0, 'pickup');
      }
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', this.onMouseUp);
    this.keyHandler = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler, true);
    this.root.append(this.cursorEl);
    this.renderCursor();
  }

  private isCreative(): boolean {
    return this.win.kind === 'creative';
  }

  private slotStack(i: number): Slot {
    if (i >= 10000) {
      const list = this.creativeItems();
      const num = list[i - 10000];
      return num ? { id: num, count: 1 } : null;
    }
    return this.win.slots[i] ?? null;
  }

  destroy(): void {
    this.detachPreview?.();
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.keyHandler, true);
    hideTooltip();
    this.root.remove();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (this.hovered < 0 || this.hovered >= 10000) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) {
      e.stopPropagation();
      e.preventDefault();
      if (this.isCreative()) return;
      this.click(this.hovered, parseInt(m[1]!, 10) - 1, 'swap');
    } else if (e.code === 'KeyQ') {
      e.stopPropagation();
      if (!this.isCreative()) this.click(this.hovered, e.ctrlKey ? 1 : 0, 'drop');
    } else if (e.code === 'KeyF') {
      e.stopPropagation();
      if (!this.isCreative()) this.click(this.hovered, 40, 'swap');
    }
  }

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (this.dragging) {
      this.dragging = false;
      if (this.dragSlots.length > 1) {
        this.send({ t: 'click', window: this.win.id, slot: 0, button: this.dragButton, mode: 'drag_start', seq: ++this.seq });
        for (const s of this.dragSlots) this.send({ t: 'click', window: this.win.id, slot: s, button: this.dragButton, mode: 'drag_add', seq: ++this.seq });
        this.send({ t: 'click', window: this.win.id, slot: 0, button: this.dragButton, mode: 'drag_end', seq: ++this.seq });
      } else if (this.dragSlots.length === 1) {
        this.click(this.dragSlots[0]!, this.dragButton, 'pickup');
      }
      for (const s of this.dragSlots) this.slotEls.get(s)?.classList.remove('dragged');
      this.dragSlots = [];
    }
    void e;
  };

  private click(slot: number, button: number, mode: ClickMode): void {
    this.send({ t: 'click', window: this.win.id, slot, button, mode, seq: ++this.seq });
  }

  private slot(i: number, cls = 'slot'): HTMLElement {
    const s = el('div', { class: cls });
    s.addEventListener('mouseenter', () => {
      this.hovered = i;
      if (this.dragging && this.cursor && !this.dragSlots.includes(i)) {
        this.dragSlots.push(i);
        s.classList.add('dragged');
      }
    });
    s.addEventListener('mouseleave', () => {
      if (this.hovered === i) this.hovered = -1;
      hideTooltip();
    });
    s.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onSlotDown(i, e);
    });
    this.slotEls.set(i, s);
    return s;
  }

  private onSlotDown(i: number, e: MouseEvent): void {
    if (this.isCreative()) {
      this.creativeClick(i, e);
      return;
    }
    const button = e.button === 2 ? 1 : e.button === 1 ? 2 : 0;
    if (button === 2) {
      this.click(i, 2, 'clone');
      return;
    }
    if (e.shiftKey) {
      this.click(i, button, 'quick');
      return;
    }
    const now = performance.now();
    if (button === 0 && this.lastClick.slot === i && now - this.lastClick.time < 250 && this.cursor) {
      this.click(i, 0, 'collect');
      this.lastClick = { slot: -1, time: 0 };
      return;
    }
    this.lastClick = { slot: i, time: now };
    if (this.cursor) {
      // start potential drag distribution
      this.dragging = true;
      this.dragButton = button;
      this.dragSlots = [i];
      return;
    }
    this.click(i, button, 'pickup');
  }

  // ---------------------------------------------------------------- creative

  private creativeItems(): number[] {
    const q = this.creativeSearch.toLowerCase();
    const out: number[] = [];
    for (const it of items) {
      if (it.num === 0 || it.def.creative === 'hidden') continue;
      if (q) {
        if (!it.def.name.toLowerCase().includes(q) && !it.id.includes(q)) continue;
      } else if ((it.def.creative ?? 'building') !== this.creativeTab) continue;
      out.push(it.num);
    }
    return out;
  }

  private creativeClick(i: number, e: MouseEvent): void {
    const playerSlots = this.opts.playerSlots();
    if (i >= 10000) {
      // catalog
      const num = this.creativeItems()[i - 10000];
      if (!num) return;
      if (this.creativeCursor) {
        this.creativeCursor = null;
      } else {
        this.creativeCursor = { id: num, count: e.shiftKey || e.button === 1 ? items[num]!.maxStack : 1 };
      }
      this.renderCursor();
      return;
    }
    // player-window slot index
    const cur = playerSlots[i] ?? null;
    if (e.shiftKey && !this.creativeCursor) {
      this.send({ t: 'creative_set', slot: i, item: null });
      return;
    }
    if (this.creativeCursor) {
      const place = e.button === 2 ? { ...this.creativeCursor, count: 1 } : this.creativeCursor;
      if (cur && cur.id === place.id && e.button === 2) {
        this.send({ t: 'creative_set', slot: i, item: { ...cur, count: Math.min(items[cur.id]!.maxStack, cur.count + 1) } });
        return;
      }
      this.send({ t: 'creative_set', slot: i, item: place });
      if (e.button === 2) {
        this.creativeCursor = this.creativeCursor.count > 1 ? { ...this.creativeCursor, count: this.creativeCursor.count - 1 } : null;
      } else this.creativeCursor = cur;
    } else if (cur) {
      if (e.button === 1) this.creativeCursor = { ...cur, count: items[cur.id]!.maxStack };
      else {
        this.creativeCursor = cur;
        this.send({ t: 'creative_set', slot: i, item: null });
      }
    }
    this.renderCursor();
  }

  // ---------------------------------------------------------------- building

  private invSection(offset: number): HTMLElement {
    const main = el('div', { class: 'inv-main' });
    for (let i = 0; i < 27; i++) main.append(this.slot(offset + i));
    const hot = el('div', { class: 'inv-hotbar' });
    for (let i = 0; i < 9; i++) hot.append(this.slot(offset + 27 + i));
    return el('div', {}, el('div', { class: 'gtitle' }, 'Inventory'), main, hot);
  }

  private arrow(): HTMLElement {
    const sp = sprites();
    const a = el('div', { class: 'progress-arrow' });
    a.style.backgroundImage = `url(${sp.arrowEmpty})`;
    const fill = el('div');
    fill.style.backgroundImage = `url(${sp.arrowFull})`;
    fill.style.width = '0';
    a.append(fill);
    this.progress.arrow = fill;
    return a;
  }

  private build(): void {
    const w = this.win;
    const gui = el('div', { class: 'gui' });
    const title = el('div', { class: 'gtitle' }, w.title);
    const row = (...c: HTMLElement[]): HTMLElement => el('div', { class: 'row', style: { alignItems: 'center', justifyContent: 'flex-start', gap: 'calc(var(--s) * 4)' } }, ...c);
    switch (w.kind) {
      case 'player': {
        const armor = el('div', { class: 'stack', style: { gap: '0' } }, this.slot(5), this.slot(6), this.slot(7), this.slot(8));
        const preview = el('div', { class: 'player-preview', style: { width: 'calc(var(--s) * 51)', height: 'calc(var(--s) * 72)', background: '#000', border: 'var(--s) solid #373737', marginLeft: 'calc(var(--s) * 2)' } });
        this.detachPreview = this.opts.attachPreview?.(preview) ?? null;
        const craft = el('div', {}, el('div', { class: 'gtitle' }, 'Crafting'), el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(2, calc(var(--s) * 18))' } }, this.slot(1), this.slot(2), this.slot(3), this.slot(4)));
        const top = row(armor, preview, el('div', { class: 'stack', style: { justifyContent: 'flex-end', height: 'calc(var(--s) * 72)' } }, this.slot(45)), craft, this.arrow(), this.slot(0, 'slot big'));
        top.style.marginBottom = 'calc(var(--s) * 6)';
        gui.append(top, this.invSection(9));
        break;
      }
      case 'crafting': {
        const grid = el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(3, calc(var(--s) * 18))' } });
        for (let i = 1; i <= 9; i++) grid.append(this.slot(i));
        const top = row(grid, this.arrow(), this.slot(0, 'slot big'));
        top.style.margin = '0 0 calc(var(--s) * 6) calc(var(--s) * 22)';
        gui.append(title, top, this.invSection(10));
        break;
      }
      case 'chest': {
        const rows = Math.ceil(w.size / 9);
        const grid = el('div', { class: 'inv-main', style: { marginBottom: 'calc(var(--s) * 6)' } });
        for (let i = 0; i < rows * 9; i++) grid.append(this.slot(i));
        gui.append(title, grid, this.invSection(w.size));
        break;
      }
      case 'furnace':
      case 'blast_furnace':
      case 'smoker': {
        const sp = sprites();
        const flame = el('div', { class: 'flame' });
        flame.style.backgroundImage = `url(${sp.flameEmpty})`;
        const ff = el('div');
        ff.style.backgroundImage = `url(${sp.flameFull})`;
        ff.style.height = '0';
        flame.append(ff);
        this.progress.flame = ff;
        const left = el('div', { class: 'stack', style: { gap: 'calc(var(--s) * 2)' } }, this.slot(0), flame, this.slot(1));
        const top = row(left, this.arrow(), this.slot(2, 'slot big'));
        top.style.margin = '0 0 calc(var(--s) * 6) calc(var(--s) * 48)';
        gui.append(title, top, this.invSection(3));
        break;
      }
      case 'stonecutter': {
        const opts = el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(4, calc(var(--s) * 18))', minHeight: 'calc(var(--s) * 54)', background: '#8b8b8b' } });
        const list = (w.props.options as number[] | undefined) ?? [];
        list.forEach((num, idx) => {
          const b = el('div', { class: 'slot', style: { cursor: 'pointer', outline: idx === w.props.selected ? 'var(--s) solid #fff' : '' } });
          fillSlot(b, { id: num, count: 1 });
          b.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.send({ t: 'trade', index: idx });
          });
          opts.append(b);
        });
        const top = row(this.slot(0), opts, this.slot(1, 'slot big'));
        top.style.marginBottom = 'calc(var(--s) * 6)';
        gui.append(title, top, this.invSection(2));
        break;
      }
      case 'merchant': {
        // Offer list on the left, payment slots and result on the right
        const offers = (w.props.offers as { buy: Slot; buy2: Slot; sell: Slot; out: boolean }[] | undefined) ?? [];
        const list = el('div', { class: 'offer-list' });
        offers.forEach((o, idx) => {
          const b = el('div', { class: 'offer' + (idx === w.props.selected ? ' selected' : '') + (o.out ? ' out' : '') });
          const cell = (st: Slot): HTMLElement => {
            const c = el('div', { class: 'offer-cell' });
            const ic = iconEl(st);
            if (ic) c.append(ic);
            return c;
          };
          b.append(cell(o.buy), o.buy2 ? cell(o.buy2) : el('div', { class: 'offer-cell' }), el('div', { class: 'offer-arrow' }, o.out ? '✕' : '→'), cell(o.sell));
          b.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.send({ t: 'trade', index: idx });
          });
          b.addEventListener('mousemove', (e) => showTooltip(o.sell, e.clientX, e.clientY, this.opts.advancedTooltips));
          b.addEventListener('mouseleave', () => hideTooltip());
          list.append(b);
        });
        const right = el('div', { class: 'stack' }, row(this.slot(0), this.slot(1), this.arrow(), this.slot(2, 'slot big')), this.invSection(3));
        const body = row(list, right);
        body.style.alignItems = 'flex-start';
        gui.append(title, body);
        break;
      }
      case 'smithing': {
        const top = row(this.slot(0), el('div', { class: 'muted' }, '+'), this.slot(1), this.arrow(), this.slot(2, 'slot big'));
        top.style.margin = '0 0 calc(var(--s) * 6) calc(var(--s) * 30)';
        gui.append(title, top, this.invSection(3));
        break;
      }
      case 'creative':
        this.buildCreative(gui);
        break;
      default: {
        // Generic: container slots in rows, then inventory
        const grid = el('div', { class: 'inv-main', style: { marginBottom: 'calc(var(--s) * 6)' } });
        for (let i = 0; i < w.size; i++) grid.append(this.slot(i));
        gui.append(title, grid, this.invSection(w.size));
      }
    }
    this.root.append(gui);
    this.refresh();
  }

  private buildCreative(gui: HTMLElement): void {
    const tabs = el('div', { class: 'tabs', style: { position: 'absolute', top: 'calc(var(--s) * -30)', left: '0' } });
    const makeTab = (id: string, icon: string, name: string): HTMLElement => {
      const t = el('div', { class: 'tab' + (id === this.creativeTab && !this.creativeSearch ? ' active' : ''), title: name });
      const num = items.find((x) => x.id === icon)?.num;
      if (num) {
        const ic = iconEl({ id: num, count: 1 }, false);
        if (ic) t.append(ic);
      }
      t.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.creativeTab = id;
        this.creativeSearch = '';
        search.value = '';
        for (const c of tabs.children) c.classList.remove('active');
        t.classList.add('active');
        this.renderCreativeGrid();
      });
      return t;
    };
    for (const tab of CREATIVE_TABS) tabs.append(makeTab(tab.id, tab.icon, tab.name));
    const search = el('input', { class: 'field', placeholder: 'Search items...', style: { width: 'calc(var(--s) * 162)', height: 'calc(var(--s) * 14)', marginBottom: 'calc(var(--s) * 4)' } }) as HTMLInputElement;
    search.addEventListener('input', () => {
      this.creativeSearch = search.value;
      this.renderCreativeGrid();
    });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.creativeGrid = el('div', { class: 'scrollgrid', style: { background: '#8b8b8b', marginBottom: 'calc(var(--s) * 6)' } });
    const hot = el('div', { class: 'inv-hotbar' });
    for (let i = 0; i < 9; i++) hot.append(this.slot(36 + i));
    const main = el('div', { class: 'inv-main' });
    for (let i = 0; i < 27; i++) main.append(this.slot(9 + i));
    const armor = el('div', { class: 'row', style: { justifyContent: 'flex-start', gap: '0', marginBottom: 'calc(var(--s) * 4)' } }, this.slot(5), this.slot(6), this.slot(7), this.slot(8), el('div', { style: { width: 'calc(var(--s) * 18)' } }), this.slot(45));
    gui.style.position = 'absolute';
    gui.append(tabs, search, this.creativeGrid, el('details', {}, el('summary', { class: 'gtitle', style: { cursor: 'pointer' } }, 'Inventory'), armor, main), hot);
    this.renderCreativeGrid();
  }

  private renderCreativeGrid(): void {
    if (!this.creativeGrid) return;
    clear(this.creativeGrid);
    for (const k of [...this.slotEls.keys()]) if (k >= 10000) this.slotEls.delete(k);
    const list = this.creativeItems();
    list.forEach((num, i) => {
      const s = this.slot(10000 + i);
      fillSlot(s, { id: num, count: 1 });
      this.creativeGrid!.append(s);
    });
  }

  // ---------------------------------------------------------------- updates

  setState(win: WindowState, cursor: Slot): void {
    const rebuild = win.id !== this.win.id || win.kind !== this.win.kind || ((win.kind === 'stonecutter' || win.kind === 'merchant') && JSON.stringify(win.props) !== JSON.stringify(this.win.props));
    this.win = { ...win, props: { ...win.props } };
    this.cursor = cursor;
    if (rebuild) {
      const gui = this.root.querySelector('.gui');
      gui?.remove();
      this.slotEls.clear();
      this.progress = {};
      this.build();
    }
    this.refresh();
    this.renderCursor();
  }

  setProps(props: Record<string, unknown>): void {
    const merged = { ...this.win.props, ...props };
    if ((this.win.kind === 'stonecutter' || this.win.kind === 'merchant') && JSON.stringify(merged) !== JSON.stringify(this.win.props)) {
      this.setState({ ...this.win, props: merged }, this.cursor);
      return;
    }
    this.win.props = merged;
    this.refreshProgress();
  }

  private refreshProgress(): void {
    const p = this.win.props as Record<string, number>;
    if (this.progress.arrow) {
      const f = p.cookTotal ? p.cook / p.cookTotal : 0;
      this.progress.arrow.style.width = `${Math.min(1, f) * 100}%`;
    }
    if (this.progress.flame) {
      const f = p.burnTotal ? p.burn / p.burnTotal : 0;
      this.progress.flame.style.height = `${Math.min(1, f) * 100}%`;
    }
  }

  refresh(): void {
    const slots = this.isCreative() ? this.opts.playerSlots() : this.win.slots;
    for (const [i, s] of this.slotEls) {
      if (i >= 10000) continue;
      fillSlot(s, slots[i] ?? null);
    }
    this.refreshProgress();
  }

  private renderCursor(): void {
    clear(this.cursorEl);
    const c = this.isCreative() ? this.creativeCursor : this.cursor;
    const ic = iconEl(c);
    if (ic) this.cursorEl.append(ic);
    this.cursorEl.style.left = this.mouse.x + 'px';
    this.cursorEl.style.top = this.mouse.y + 'px';
  }
}
