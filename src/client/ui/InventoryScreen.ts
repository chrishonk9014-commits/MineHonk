/**
 * Container GUI. Layout is chosen by window kind; slot indices match the
 * server's window slot order. All clicks are sent to the server, which
 * replies with authoritative contents.
 */
import { el, clear } from './dom';
import { fillSlot, showTooltip, hideTooltip, iconEl, itemDisplayName } from './slots';
import type { Slot } from '../../common/game/itemstack';
import type { C2S, WindowKind, ClickMode } from '../../common/net/protocol';
import { sprites } from './sprites';
import { items, CREATIVE_TABS } from '../../common/registry/items';
import { enchantName } from '../../common/game/enchanting';
import { POTIONS } from '../../common/data/potions';
import { ENCHANTMENTS } from '../../common/data/enchantments';
import type { ItemStack } from '../../common/game/itemstack';
import { romanNumeral } from '../../common/data/enchantments';
import { RecipeBookPanel, recipeBookOpen, setRecipeBookOpen, playerOwnedSlots } from './RecipeBook';
import { EngineeringBookPanel } from './EngineeringBook';
import type { MachineProps } from '../../common/engineering/window';
import { ComputerPanel } from './ComputerScreen';
import type { PcView } from '../../common/digital/view';

/** The Engineering Book beside the Engineering Crafting Table (remembered between screens). */
let engBookOpen = true;

/** Screens that offer the Recipe Book. */
const BOOK_KINDS = new Set(['player', 'crafting', 'furnace', 'blast_furnace', 'smoker', 'stonecutter', 'smithing', 'brewing', 'anvil', 'enchanting', 'creative']);

export interface WindowState {
  id: number;
  kind: WindowKind;
  title: string;
  size: number;
  slots: Slot[];
  props: Record<string, unknown>;
}

const fmtEU = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.floor(n)));

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
  private progress: { arrow?: HTMLElement; flame?: HTMLElement; brew?: HTMLElement; fuel?: HTMLElement } = {};
  private mouse = { x: 0, y: 0 };
  private creativeTab = 'building';
  private creativeSearch = '';
  private creativeGrid: HTMLElement | null = null;
  private creativeCursor: Slot = null;
  private readonly keyHandler: (e: KeyboardEvent) => void;
  private detachPreview: (() => void) | null = null;
  private book: RecipeBookPanel | null = null;
  private bookKind = '';
  private engBook: EngineeringBookPanel | null = null;
  private computer: ComputerPanel | null = null;
  private machine: { energy?: HTMLElement; energyText?: HTMLElement; fluid?: HTMLElement; fluidText?: HTMLElement; status?: HTMLElement; info?: HTMLElement; buttons?: HTMLElement; infoSig?: string; buttonSig?: string; field?: HTMLInputElement; choices?: HTMLElement; choiceSig?: string } = {};

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
      const st = this.creativeItems()[i - 10000];
      return st ? { ...st } : null;
    }
    return this.win.slots[i] ?? null;
  }

  destroy(): void {
    this.book?.destroy();
    this.book = null;
    this.engBook?.destroy();
    this.engBook = null;
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

  private creativeCache: { key: string; list: ItemStack[] } | null = null;

  /** Catalog stacks for the current tab/search; potions and books expand into variants. */
  private creativeItems(): ItemStack[] {
    const q = this.creativeSearch.toLowerCase();
    const key = this.creativeTab + '|' + q;
    if (this.creativeCache?.key === key) return this.creativeCache.list;
    const out: ItemStack[] = [];
    for (const it of items) {
      if (it.num === 0 || it.def.creative === 'hidden') continue;
      const variants: ItemStack[] = [];
      if (it.id === 'potion' || it.id === 'splash_potion') for (const p of POTIONS) variants.push({ id: it.num, count: 1, tag: { potion: p.id } });
      else if (it.id === 'enchanted_book') for (const e of ENCHANTMENTS) variants.push({ id: it.num, count: 1, tag: { stored: { [e.id]: e.maxLevel } } });
      else variants.push({ id: it.num, count: 1 });
      for (const v of variants) {
        if (q) {
          const name = itemDisplayName(v).toLowerCase();
          if (!name.includes(q) && !it.id.includes(q)) continue;
        } else if ((it.def.creative ?? 'building') !== this.creativeTab) continue;
        out.push(v);
      }
    }
    this.creativeCache = { key, list: out };
    return out;
  }

  private creativeClick(i: number, e: MouseEvent): void {
    const playerSlots = this.opts.playerSlots();
    if (i >= 10000) {
      // catalog
      const st = this.creativeItems()[i - 10000];
      if (!st) return;
      if (this.creativeCursor) {
        this.creativeCursor = null;
      } else {
        this.creativeCursor = { ...st, count: e.shiftKey || e.button === 1 ? items[st.id]!.maxStack : 1 };
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
      case 'eng_crafting': {
        const grid = el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(3, calc(var(--s) * 18))' } });
        for (let i = 1; i <= 9; i++) grid.append(this.slot(i));
        const top = row(grid, this.arrow(), this.slot(0, 'slot big'));
        top.style.margin = '0 0 calc(var(--s) * 6) calc(var(--s) * 22)';
        gui.append(title, top, this.invSection(10));
        break;
      }
      case 'machine':
        this.buildMachine(gui, title);
        break;
      case 'computer':
        this.computer = new ComputerPanel(gui, w.props as unknown as PcView, {
          slot: (i) => this.slot(i),
          invSection: (o) => this.invSection(o),
          cmd: (cmd, arg) => this.send({ t: 'pc_cmd', window: this.win.id, cmd, ...(arg !== undefined ? { arg } : {}) }),
        });
        break;
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
      case 'enchanting': {
        const opts = (w.props.options as { cost: number; lapis: number; hint: { id: string; level: number } | null; ok: boolean }[] | undefined) ?? [];
        const col = el('div', { class: 'ench-options' });
        for (let i = 0; i < 3; i++) {
          const o = opts[i];
          const b = el('div', { class: 'ench-option' + (o && o.cost > 0 ? (o.ok ? ' ok' : ' locked') : ' empty') });
          if (o && o.cost > 0) {
            const hint = o.hint ? `${enchantName(o.hint.id)} ${romanNumeral(o.hint.level)} ...?` : '';
            b.append(el('div', { class: 'ench-lapis' }, String(i + 1)), el('div', { class: 'ench-hint' }, hint), el('div', { class: 'ench-cost' }, String(o.cost)));
            b.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              if (o.ok) this.send({ t: 'enchant', option: i });
            });
          }
          col.append(b);
        }
        const left = el('div', { class: 'row', style: { gap: 'calc(var(--s) * 2)', alignSelf: 'center' } }, this.slot(0), this.slot(1));
        const top = row(left, col);
        top.style.marginBottom = 'calc(var(--s) * 6)';
        gui.append(title, top, this.invSection(2));
        break;
      }
      case 'anvil': {
        const input = el('input', { class: 'field anvil-name', maxLength: 35, placeholder: 'Item name', value: String(w.props.name ?? '') }) as HTMLInputElement;
        let timer: ReturnType<typeof setTimeout> | null = null;
        input.addEventListener('input', () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => this.send({ t: 'rename', name: input.value }), 150);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Escape') e.stopPropagation();
        });
        const label = el('div', { class: 'anvil-cost' });
        this.anvilLabel = label;
        this.updateAnvilLabel();
        const top = row(this.slot(0), el('div', { class: 'muted' }, '+'), this.slot(1), this.arrow(), this.slot(2, 'slot big'));
        gui.append(title, input, top, label, this.invSection(3));
        setTimeout(() => {
          if (document.activeElement === document.body) input.focus();
        }, 0);
        break;
      }
      case 'brewing': {
        const bubbles = el('div', { class: 'brew-progress' }, el('div'));
        this.progress.brew = bubbles.firstChild as HTMLElement;
        const fuelBar = el('div', { class: 'brew-fuel' }, el('div'));
        this.progress.fuel = fuelBar.firstChild as HTMLElement;
        const top = el(
          'div',
          { class: 'brew-layout' },
          el('div', { class: 'stack' }, this.slot(4), fuelBar),
          el('div', { class: 'stack' }, this.slot(3), bubbles, el('div', { class: 'row' }, this.slot(0), this.slot(1), this.slot(2))),
        );
        gui.append(title, top, this.invSection(5));
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
      case 'beacon': {
        // Pyramid tiers unlock effects; pick one, pay with an ingot or gem, confirm
        const levels = Number(w.props.levels ?? 0);
        const primary = (w.props.primary as string | null) ?? null;
        const secondary = (w.props.secondary as string | null) ?? null;
        const names: Record<string, string> = { speed: 'Speed', haste: 'Haste', resistance: 'Resistance', jump_boost: 'Jump Boost', strength: 'Strength', regeneration: 'Regeneration' };
        const effects: [string, number][] = [
          ['speed', 1],
          ['haste', 1],
          ['resistance', 2],
          ['jump_boost', 2],
          ['strength', 3],
        ];
        const btn = (label: string, on: boolean, selected: boolean, idx: number): HTMLElement => {
          const b = el('div', { class: 'beacon-effect' + (on ? '' : ' locked') + (selected ? ' selected' : '') }, label);
          if (on)
            b.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              this.send({ t: 'trade', index: idx });
            });
          return b;
        };
        const prim = el('div', { class: 'beacon-col' }, el('div', { class: 'muted' }, 'Primary Power'));
        effects.forEach(([id, need], i) => prim.append(btn(names[id]!, levels >= need, primary === id, i)));
        const sec = el('div', { class: 'beacon-col' }, el('div', { class: 'muted' }, 'Secondary Power'));
        sec.append(btn('Regeneration', levels >= 4, secondary === 'regeneration', 10), btn(primary ? `${names[primary]} II` : 'Primary II', levels >= 4 && !!primary, !!secondary && secondary === primary, 11));
        const confirm = el('div', { class: 'beacon-confirm' + (w.props.paid && primary ? '' : ' locked') }, 'Confirm');
        confirm.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (w.props.paid && primary) this.send({ t: 'trade', index: 20 });
        });
        const info = el('div', { class: 'muted' }, levels > 0 ? `Pyramid level ${levels}${w.props.active ? ` - active: ${names[String(w.props.active)] ?? w.props.active}` : ''}` : 'Build a pyramid of iron, gold, diamond, emerald or netherite blocks under the beacon');
        const pay = el('div', { class: 'stack', style: { alignItems: 'center', gap: 'calc(var(--s) * 2)' } }, el('div', { class: 'muted' }, 'Payment'), this.slot(0), confirm);
        const top = row(prim, sec, pay);
        top.style.alignItems = 'flex-start';
        top.style.marginBottom = 'calc(var(--s) * 4)';
        gui.append(title, info, top, this.invSection(1));
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
    if (BOOK_KINDS.has(w.kind)) {
      const btn = el('div', { class: 'rb-button' + (recipeBookOpen() ? ' active' : ''), title: 'Recipe Book' });
      const ic = iconEl({ id: items.find((x) => x.id === 'book')?.num ?? 0, count: 1 }, false);
      if (ic) btn.append(ic);
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        setRecipeBookOpen(!recipeBookOpen());
        btn.classList.toggle('active', recipeBookOpen());
        this.syncBook();
      });
      gui.append(btn);
    }
    if (w.kind === 'eng_crafting') {
      const btn = el('div', { class: 'rb-button' + (engBookOpen ? ' active' : ''), title: 'Engineering Book' });
      const ic = iconEl({ id: items.find((x) => x.id === 'engineering_book')?.num ?? 0, count: 1 }, false);
      if (ic) btn.append(ic);
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        engBookOpen = !engBookOpen;
        btn.classList.toggle('active', engBookOpen);
        this.syncEngBook(engBookOpen);
      });
      gui.append(btn);
      this.syncEngBook(engBookOpen);
    }
    this.syncBook();
    this.refresh();
  }

  /** Shows or hides the Engineering Book beside the GUI, optionally at an entry. */
  private syncEngBook(open: boolean, entry?: string): void {
    if (!open) {
      this.engBook?.destroy();
      this.engBook = null;
    } else if (!this.engBook) {
      const craft = this.win.kind === 'eng_crafting' ? (recipe: number, all: boolean): void => this.send({ t: 'eng_fill', recipe, all }) : undefined;
      this.engBook = new EngineeringBookPanel({ craft, advancedTooltips: this.opts.advancedTooltips });
      this.engBook.update(this.ownedSlots());
    }
    if (this.engBook && entry) this.engBook.open(entry);
    const gui = this.root.querySelector(':scope > .gui');
    if (this.engBook && gui && this.engBook.root.nextSibling !== gui) this.root.insertBefore(this.engBook.root, gui);
    this.root.classList.toggle('with-book', !!this.engBook || !!this.book);
  }

  // ---------------------------------------------------------------- machines

  private get mp(): MachineProps {
    return this.win.props as unknown as MachineProps;
  }

  /** One layout for every engineering machine, described by the window props. */
  private buildMachine(gui: HTMLElement, title: HTMLElement): void {
    const p = this.mp;
    const L = p.layout ?? { input: 0, output: 0, fuel: 0, tool: 0, upgrades: 0, ghost: 0 };
    this.machine = {};
    gui.classList.add('eng-gui');
    // Title with tier and a link to the book entry
    const help = el('div', { class: 'eng-help', title: 'Open its Engineering Book entry' }, '?');
    help.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (this.engBook) this.syncEngBook(false);
      else this.syncEngBook(true, p.comp);
    });
    title.append(el('span', { class: 'eng-tier' }, `Tier ${p.tier}`));
    gui.append(el('div', { class: 'eng-title-row' }, title, help));
    let i = 0;
    const group = (n: number, cls = 'slot'): HTMLElement[] => {
      const out: HTMLElement[] = [];
      for (let k = 0; k < n; k++) out.push(this.slot(i++, cls));
      return out;
    };
    const cols = (n: number): number => (n <= 3 ? n : n <= 9 ? 3 : 9);
    const gridOf = (els: HTMLElement[], label?: string): HTMLElement => {
      const g = el('div', { class: 'grid', style: { gridTemplateColumns: `repeat(${cols(els.length)}, calc(var(--s) * 18))` } }, ...els);
      return label ? el('div', { class: 'eng-group' }, el('div', { class: 'eng-label' }, label), g) : g;
    };
    const inputs = group(L.input);
    const outputs = group(L.output, 'slot');
    const fuel = group(L.fuel);
    const tool = group(L.tool);
    const ups = group(L.upgrades);
    const ghosts = group(L.ghost, 'slot ghost');
    const main = el('div', { class: 'eng-main' });
    // Bars
    if (p.energyMax !== undefined) {
      const fill = el('div', { class: 'eng-bar-fill energy' });
      const text = el('div', { class: 'eng-bar-text' });
      this.machine.energy = fill;
      this.machine.energyText = text;
      main.append(el('div', { class: 'eng-bar', title: 'Energy' }, fill, text));
    }
    if (p.fluid) {
      const fill = el('div', { class: 'eng-bar-fill fluid' });
      const text = el('div', { class: 'eng-bar-text' });
      this.machine.fluid = fill;
      this.machine.fluidText = text;
      main.append(el('div', { class: 'eng-bar', title: 'Fluid' }, fill, text));
    }
    const left = el('div', { class: 'stack eng-col' });
    if (inputs.length) left.append(gridOf(inputs, p.comp === 'storage_barrel' ? 'Put in' : p.kind === 'machine' || p.kind === 'multiblock' ? 'Input' : 'Items'));
    if (fuel.length) left.append(gridOf(fuel, 'Fuel'));
    if (tool.length) left.append(gridOf(tool, 'Pickaxe'));
    if (left.childElementCount) main.append(left);
    if (p.time && (inputs.length || tool.length) && outputs.length) main.append(this.arrow());
    if (outputs.length) main.append(gridOf(outputs, p.comp === 'storage_barrel' ? 'Take out' : 'Output'));
    if (ups.length) main.append(el('div', { class: 'eng-group' }, el('div', { class: 'eng-label' }, 'Upgrades'), el('div', { class: 'stack', style: { gap: '0' } }, ...ups)));
    if (main.childElementCount) gui.append(main);
    if (ghosts.length) gui.append(gridOf(ghosts, p.ghostLabel ?? 'Filter'));
    this.machine.status = el('div', { class: 'eng-status' });
    this.machine.info = el('div', { class: 'eng-info' });
    this.machine.buttons = el('div', { class: 'eng-buttons' });
    // V6 phase 4: a name to type (a Teleportation Node) and a list to pick from (its destinations)
    const extra: HTMLElement[] = [];
    if (p.field) {
      const f = p.field;
      const input = el('input', { class: 'field eng-field', maxlength: String(f.max), placeholder: f.placeholder, value: f.value }) as HTMLInputElement;
      input.disabled = !f.editable;
      const commit = (): void => {
        const v = input.value.trim().slice(0, f.max);
        if (v && v !== this.mp.field?.value) this.send({ t: 'eng_cfg', window: this.win.id, key: f.key, value: v });
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          commit();
          input.blur();
        }
      });
      input.addEventListener('keyup', (e) => e.stopPropagation());
      input.addEventListener('mousedown', (e) => e.stopPropagation());
      input.addEventListener('blur', commit);
      this.machine.field = input;
      extra.push(el('div', { class: 'eng-field-row' }, el('div', { class: 'eng-label' }, 'Name'), input));
    }
    if (p.choices) {
      this.machine.choices = el('div', { class: 'eng-choices' });
      extra.push(el('div', { class: 'eng-group' }, el('div', { class: 'eng-label' }, p.choicesLabel ?? 'Choose'), this.machine.choices));
    }
    gui.append(this.machine.status, this.machine.info, ...extra, this.machine.buttons, this.invSection(this.win.size));
    this.updateMachine();
  }

  private updateMachine(): void {
    const p = this.mp;
    const m = this.machine;
    if (m.energy && p.energyMax) {
      const f = Math.max(0, Math.min(1, (p.energy ?? 0) / p.energyMax));
      m.energy.style.height = `${f * 100}%`;
      m.energyText!.textContent = `${fmtEU(p.energy ?? 0)}`;
      m.energy.parentElement!.title = `Energy: ${Math.floor(p.energy ?? 0).toLocaleString('en-US')} / ${p.energyMax.toLocaleString('en-US')} EU`;
    }
    if (m.fluid && p.fluid) {
      const f = Math.max(0, Math.min(1, p.fluid.amount / p.fluid.cap));
      m.fluid.style.height = `${f * 100}%`;
      m.fluid.className = 'eng-bar-fill fluid ' + (p.fluid.id ?? 'empty');
      m.fluidText!.textContent = `${(p.fluid.amount / 1000).toFixed(1)}B`;
      m.fluid.parentElement!.title = `${p.fluid.id ? p.fluid.id[0]!.toUpperCase() + p.fluid.id.slice(1) : 'Empty'}: ${p.fluid.amount.toLocaleString('en-US')} / ${p.fluid.cap.toLocaleString('en-US')} mB`;
    }
    if (this.progress.arrow) this.progress.arrow.style.width = `${p.time ? Math.min(1, (p.progress ?? 0) / p.time) * 100 : 0}%`;
    if (m.status) {
      m.status.textContent = p.statusText ?? '';
      m.status.className = 'eng-status ' + (p.status ?? '');
      m.status.style.display = p.statusText ? '' : 'none';
    }
    const infoSig = JSON.stringify(p.info ?? []);
    if (m.info && infoSig !== m.infoSig) {
      m.infoSig = infoSig;
      clear(m.info);
      for (const line of p.info ?? []) m.info.append(el('div', {}, line));
    }
    if (m.field && p.field && document.activeElement !== m.field && m.field.value !== p.field.value) m.field.value = p.field.value;
    const choiceSig = JSON.stringify(p.choices ?? []);
    if (m.choices && choiceSig !== m.choiceSig) {
      m.choiceSig = choiceSig;
      clear(m.choices);
      if (!p.choices?.length) m.choices.append(el('div', { class: 'muted' }, 'Nowhere to go yet: build another node.'));
      for (const c of p.choices ?? []) {
        const row = el('button', { class: 'btn eng-choice' + (c.ok ? '' : ' off') }, el('span', { class: 'eng-choice-name' }, c.label), el('span', { class: 'eng-choice-detail' }, c.detail)) as HTMLButtonElement;
        row.disabled = !c.ok;
        row.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (c.ok) this.send({ t: 'eng_cfg', window: this.win.id, key: c.key, value: 1 });
        });
        m.choices.append(row);
      }
    }
    const buttonSig = JSON.stringify(p.buttons ?? []);
    if (m.buttons && buttonSig !== m.buttonSig) {
      m.buttonSig = buttonSig;
      clear(m.buttons);
      for (const b of p.buttons ?? []) {
        const btn = el('button', { class: 'btn chip eng-btn' + (b.on === true ? ' on' : b.on === false ? ' off' : '') }, b.label) as HTMLButtonElement;
        btn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.send({ t: 'eng_cfg', window: this.win.id, key: b.key, value: 1 });
        });
        m.buttons.append(btn);
      }
    }
  }

  /** Shows or hides the Recipe Book beside the GUI (kept open between screens). */
  private syncBook(): void {
    const want = recipeBookOpen() && BOOK_KINDS.has(this.win.kind);
    if (this.book && (!want || this.bookKind !== this.win.kind)) {
      this.book.destroy();
      this.book = null;
    }
    if (want && !this.book) {
      this.book = new RecipeBookPanel(this.win.kind, this.opts.advancedTooltips);
      this.bookKind = this.win.kind;
      this.book.update(this.ownedSlots());
    }
    const gui = this.root.querySelector(':scope > .gui');
    if (this.book && gui && this.book.root.nextSibling !== gui) this.root.insertBefore(this.book.root, gui);
    this.root.classList.toggle('with-book', !!this.book || !!this.engBook);
  }

  /** The player's items as seen by the current screen (for recipe availability). */
  private ownedSlots(): Slot[] {
    if (this.isCreative()) return playerOwnedSlots('player', this.opts.playerSlots(), 0);
    return playerOwnedSlots(this.win.kind, this.win.slots, this.win.size);
  }

  private buildCreative(gui: HTMLElement): void {
    // Half the tabs above the GUI, half below (one row each)
    const tabs = el('div', { class: 'tabs', style: { position: 'absolute', bottom: '100%', left: '0' } });
    const tabsBelow = el('div', { class: 'tabs below', style: { position: 'absolute', top: '100%', left: '0' } });
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
        for (const c of [...tabs.children, ...tabsBelow.children]) c.classList.remove('active');
        t.classList.add('active');
        this.renderCreativeGrid();
      });
      return t;
    };
    const half = Math.ceil(CREATIVE_TABS.length / 2);
    CREATIVE_TABS.forEach((tab, i) => (i < half ? tabs : tabsBelow).append(makeTab(tab.id, tab.icon, tab.name)));
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
    gui.append(tabs, tabsBelow, search, this.creativeGrid, el('details', {}, el('summary', { class: 'gtitle', style: { cursor: 'pointer' } }, 'Inventory'), armor, main), hot);
    this.renderCreativeGrid();
  }

  private renderCreativeGrid(): void {
    if (!this.creativeGrid) return;
    clear(this.creativeGrid);
    for (const k of [...this.slotEls.keys()]) if (k >= 10000) this.slotEls.delete(k);
    const list = this.creativeItems();
    list.forEach((st, i) => {
      const s = this.slot(10000 + i);
      fillSlot(s, st);
      this.creativeGrid!.append(s);
    });
  }

  // ---------------------------------------------------------------- updates

  setState(win: WindowState, cursor: Slot): void {
    const rebuild = win.id !== this.win.id || win.kind !== this.win.kind || ((win.kind === 'stonecutter' || win.kind === 'merchant' || win.kind === 'enchanting' || win.kind === 'beacon') && JSON.stringify(win.props) !== JSON.stringify(this.win.props));
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
    const merged = this.win.kind === 'computer' ? { ...props } : { ...this.win.props, ...props };
    if ((this.win.kind === 'stonecutter' || this.win.kind === 'merchant' || this.win.kind === 'enchanting' || this.win.kind === 'beacon') && JSON.stringify(merged) !== JSON.stringify(this.win.props)) {
      this.setState({ ...this.win, props: merged }, this.cursor);
      return;
    }
    this.win.props = merged;
    if (this.win.kind === 'anvil') this.updateAnvilLabel();
    if (this.win.kind === 'machine') this.updateMachine();
    if (this.win.kind === 'computer') this.computer?.update(this.win.props as unknown as PcView);
    this.refreshProgress();
  }

  private anvilLabel: HTMLElement | null = null;

  private updateAnvilLabel(): void {
    const label = this.anvilLabel;
    if (!label) return;
    const w = this.win;
    const cost = Number(w.props.cost ?? 0);
    label.className = 'anvil-cost';
    label.textContent = '';
    if (cost <= 0) return;
    if (w.props.tooExpensive) {
      label.textContent = 'Too Expensive!';
      label.classList.add('error-text');
    } else {
      label.textContent = `Enchantment Cost: ${cost}`;
      label.classList.add(w.props.affordable ? 'ok-text' : 'error-text');
    }
  }

  private refreshProgress(): void {
    if (this.win.kind === 'machine' || this.win.kind === 'computer') return;
    const p = this.win.props as Record<string, number>;
    if (this.progress.arrow) {
      const f = p.cookTotal ? p.cook / p.cookTotal : 0;
      this.progress.arrow.style.width = `${Math.min(1, f) * 100}%`;
    }
    if (this.progress.flame) {
      const f = p.burnTotal ? p.burn / p.burnTotal : 0;
      this.progress.flame.style.height = `${Math.min(1, f) * 100}%`;
    }
    if (this.progress.brew) {
      const f = p.brew > 0 ? 1 - p.brew / (p.brewTotal || 400) : 0;
      this.progress.brew.style.height = `${Math.min(1, f) * 100}%`;
    }
    if (this.progress.fuel) this.progress.fuel.style.width = `${Math.min(1, (p.fuel ?? 0) / 20) * 100}%`;
  }

  refresh(): void {
    const slots = this.isCreative() ? this.opts.playerSlots() : this.win.slots;
    for (const [i, s] of this.slotEls) {
      if (i >= 10000) continue;
      fillSlot(s, slots[i] ?? null);
    }
    // The tooltip only follows mouse moves; drop it when the hovered slot empties
    if (this.hovered >= 0 && this.hovered < 10000 && !this.slotStack(this.hovered)) hideTooltip();
    this.refreshProgress();
    this.book?.update(this.ownedSlots());
    this.engBook?.update(this.ownedSlots());
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
