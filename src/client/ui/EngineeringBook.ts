/**
 * The Engineering Book: guides with step-by-step instructions and an entry
 * for every engineering block and item (recipe, stats, what it is made from
 * and used in). Clicking an ingredient opens its entry.
 *
 * It is a guide; crafting happens at the Engineering Crafting Table. When the
 * table is open the book sits beside it and its Craft buttons fill the grid
 * (the server does the moving); anywhere else they explain where to craft.
 */
import { el, clear } from './dom';
import { iconEl, showTooltip, hideTooltip } from './slots';
import type { Slot } from '../../common/game/itemstack';
import { itemById, items } from '../../common/registry/items';
import { engRecipes, recipes, type CompiledRecipe } from '../../common/game/crafting';
import { countItems } from '../../common/game/recipeBook';
import { CHAPTERS, guideEntries, guideEntry, type GuideEntry } from '../../common/engineering/guide';

/** Remembered between openings during a session. */
const memory = { chapter: 'getting_started', entry: '' as string, query: '' };

export interface BookOptions {
  /** Fills the Engineering Crafting Table grid; absent when no table is open. */
  craft?: (recipe: number, all: boolean) => void;
  advancedTooltips: boolean;
  close?: () => void;
}

const numOf = (id: string): number => itemById.get(id)?.num ?? 0;

export class EngineeringBookPanel {
  readonly root = el('div', { class: 'eng-book gui-panel' });
  private readonly nav = el('div', { class: 'eb-nav' });
  private readonly page = el('div', { class: 'eb-page' });
  private counts = new Map<number | string, number>();
  private history: string[] = [];
  private cycle: { cell: HTMLElement; options: number[] }[] = [];
  private cycleTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: BookOptions) {
    const search = el('input', { class: 'field eb-search', placeholder: 'Search the book...', value: memory.query }) as HTMLInputElement;
    search.addEventListener('input', () => {
      memory.query = search.value;
      if (memory.query) this.renderSearch();
      else this.render();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation();
    });
    const head = el('div', { class: 'eb-head' }, el('div', { class: 'gtitle' }, 'Engineering Book'), search);
    if (opts.close) {
      const x = el('button', { class: 'btn chip eb-close' }, 'Close') as HTMLButtonElement;
      x.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        opts.close!();
      });
      head.append(x);
    }
    this.root.append(head, el('div', { class: 'eb-body' }, this.nav, this.page));
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.timer = setInterval(() => this.tickCycle(), 1000);
    this.renderNav();
    if (memory.query) this.renderSearch();
    else this.render();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    hideTooltip();
    this.root.remove();
  }

  /** Opens an entry (an engineering item id) or, given a chapter id, that chapter. */
  open(id: string): void {
    if (CHAPTERS.some((c) => c.id === id)) {
      memory.chapter = id;
      memory.entry = '';
    } else if (guideEntry(id)) {
      if (memory.entry && memory.entry !== id) this.history.push(memory.entry);
      memory.entry = id;
      memory.chapter = guideEntry(id)!.chapter;
    } else return;
    memory.query = '';
    const s = this.root.querySelector('.eb-search') as HTMLInputElement | null;
    if (s) s.value = '';
    this.renderNav();
    this.render();
  }

  /** The player's items changed: recount what can be crafted. */
  update(slots: Slot[]): void {
    const next = countItems(slots);
    const sig = (m: Map<number | string, number>): string => [...m].map(([k, v]) => k + ':' + v).join(',');
    if (sig(next) === sig(this.counts)) return;
    this.counts = next;
    if (memory.entry && !memory.query) this.render();
  }

  // ------------------------------------------------------------------ rendering

  private renderNav(): void {
    clear(this.nav);
    for (const ch of CHAPTERS) {
      const b = el('div', { class: 'eb-chapter' + (ch.id === memory.chapter ? ' active' : ''), title: ch.title });
      const ic = iconEl({ id: numOf(ch.icon), count: 1 }, false);
      if (ic) b.append(el('div', { class: 'eb-ic' }, ic));
      b.append(el('span', {}, ch.title));
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.history = [];
        this.open(ch.id);
      });
      this.nav.append(b);
    }
  }

  private render(): void {
    this.cycle = [];
    clear(this.page);
    this.page.scrollTop = 0;
    if (memory.entry) this.renderEntry(guideEntry(memory.entry)!);
    else this.renderChapter();
  }

  private entryChip(e: GuideEntry): HTMLElement {
    const chip = el('div', { class: 'eb-entry-chip', title: e.name });
    const ic = iconEl({ id: numOf(e.id), count: 1 }, false);
    if (ic) chip.append(el('div', { class: 'eb-ic' }, ic));
    chip.append(el('span', {}, e.name));
    chip.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      this.open(e.id);
    });
    return chip;
  }

  private renderChapter(): void {
    const ch = CHAPTERS.find((c) => c.id === memory.chapter) ?? CHAPTERS[0]!;
    this.page.append(el('div', { class: 'eb-title' }, ch.title), el('div', { class: 'eb-text' }, ch.intro));
    const ol = el('ol', { class: 'eb-steps' });
    for (const s of ch.steps) ol.append(el('li', {}, s));
    this.page.append(el('div', { class: 'eb-sub' }, 'Step by step'), ol);
    if (ch.tips?.length) {
      const ul = el('ul', { class: 'eb-tips' });
      for (const t of ch.tips) ul.append(el('li', {}, t));
      this.page.append(el('div', { class: 'eb-sub' }, 'Tips'), ul);
    }
    const entries = guideEntries().filter((e) => e.chapter === ch.id);
    if (entries.length) {
      const grid = el('div', { class: 'eb-entries' });
      for (const e of entries) grid.append(this.entryChip(e));
      this.page.append(el('div', { class: 'eb-sub' }, 'In this chapter'), grid);
    }
  }

  private renderSearch(): void {
    this.cycle = [];
    clear(this.page);
    const q = memory.query.toLowerCase();
    const hits = guideEntries().filter((e) => e.name.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q));
    const chapters = CHAPTERS.filter((c) => c.title.toLowerCase().includes(q) || c.steps.some((s) => s.toLowerCase().includes(q)));
    this.page.append(el('div', { class: 'eb-title' }, `Search: ${memory.query}`));
    for (const c of chapters) {
      const b = el('div', { class: 'eb-entry-chip' }, el('span', {}, 'Guide: ' + c.title));
      b.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        this.open(c.id);
      });
      this.page.append(b);
    }
    const grid = el('div', { class: 'eb-entries' });
    for (const e of hits) grid.append(this.entryChip(e));
    this.page.append(grid);
    if (!hits.length && !chapters.length) this.page.append(el('div', { class: 'eb-text' }, 'Nothing found.'));
  }

  private renderEntry(e: GuideEntry): void {
    const n = numOf(e.id);
    const back = el('button', { class: 'btn chip' }, '< Back') as HTMLButtonElement;
    back.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      const prev = this.history.pop();
      if (prev) {
        memory.entry = prev;
        memory.chapter = guideEntry(prev)?.chapter ?? memory.chapter;
      } else memory.entry = '';
      this.renderNav();
      this.render();
    });
    const icon = el('div', { class: 'slot eb-big' });
    const ic = iconEl({ id: n, count: 1 }, false);
    if (ic) icon.append(ic);
    this.page.append(el('div', { class: 'eb-entry-head' }, back, icon, el('div', {}, el('div', { class: 'eb-title' }, e.name), el('div', { class: 'eb-meta' }, (e.tier ? `Tier ${e.tier} - ` : '') + (CHAPTERS.find((c) => c.id === e.chapter)?.title ?? '')))));
    this.page.append(el('div', { class: 'eb-text' }, e.desc));
    if (e.stats.length) {
      const ul = el('ul', { class: 'eb-tips' });
      for (const s of e.stats) ul.append(el('li', {}, s));
      this.page.append(ul);
    }
    // How to make it
    const eng = engRecipes().filter((r) => r.result === n);
    const normal = recipes().filter((r) => r.result === n);
    if (eng.length || normal.length) this.page.append(el('div', { class: 'eb-sub' }, 'Recipe'));
    for (const r of eng) this.page.append(this.recipeView(r, true));
    for (const r of normal) this.page.append(this.recipeView(r, false));
    if (e.madeBy.length) {
      this.page.append(el('div', { class: 'eb-sub' }, 'Also made by'));
      const ul = el('ul', { class: 'eb-tips' });
      for (const m of e.madeBy) ul.append(el('li', {}, m));
      this.page.append(ul);
    }
    // What uses it
    const uses = new Set<number>();
    for (const r of engRecipes()) if (r.result !== n && r.cells.some((c) => c?.has(n))) uses.add(r.result);
    const usedIn = [...uses].map((u) => guideEntry(items[u]!.id)).filter((x): x is GuideEntry => !!x);
    if (usedIn.length) {
      const grid = el('div', { class: 'eb-entries' });
      for (const u of usedIn) grid.append(this.entryChip(u));
      this.page.append(el('div', { class: 'eb-sub' }, 'Used in'), grid);
    }
  }

  /** A 3x3 recipe grid with have/missing counts and the Craft buttons. */
  private recipeView(r: CompiledRecipe, engineering: boolean): HTMLElement {
    const grid = el('div', { class: 'eb-grid' });
    const cells: (Set<number> | null)[] = new Array(9).fill(null);
    if (r.shaped) for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) cells[y * 3 + x] = r.cells[y * r.width + x] ?? null;
    else r.cells.forEach((c, i) => (cells[i] = c));
    // What the player has, reserving items as each cell takes one
    const left = new Map(this.counts);
    let missing = 0;
    for (const c of cells) {
      const cell = el('div', { class: 'slot eb-cell' });
      if (c) {
        const options = [...c];
        const have = options.find((o) => (left.get(o) ?? 0) > 0);
        if (have !== undefined) left.set(have, left.get(have)! - 1);
        else {
          missing++;
          cell.classList.add('missing');
        }
        this.fillCell(cell, have ?? options[0]!);
        if (options.length > 1) this.cycle.push({ cell, options });
        cell.addEventListener('mousedown', (ev) => {
          ev.stopPropagation();
          const id = cell.dataset.item;
          if (id && guideEntry(id)) this.open(id);
        });
        cell.addEventListener('mousemove', (ev) => showTooltip({ id: Number(cell.dataset.num), count: 1 }, ev.clientX, ev.clientY, this.opts.advancedTooltips));
        cell.addEventListener('mouseleave', () => hideTooltip());
      }
      grid.append(cell);
    }
    const out = el('div', { class: 'slot eb-cell eb-out' });
    const oi = iconEl({ id: r.result, count: r.count });
    if (oi) out.append(oi);
    const box = el('div', { class: 'eb-recipe' }, grid, el('div', { class: 'eb-arrow' }, '>'), out);
    const wrap = el('div', { class: 'eb-recipe-wrap' }, box);
    if (!engineering) {
      wrap.append(el('div', { class: 'eb-note' }, 'Made at a normal Crafting Table.'));
      return wrap;
    }
    const status = el('div', { class: 'eb-note' + (missing ? ' missing' : ' ok') }, missing ? `Missing ${missing} item${missing > 1 ? 's' : ''}` : 'You have everything');
    const row = el('div', { class: 'eb-craft-row' });
    const btn = (label: string, all: boolean): HTMLButtonElement => {
      const b = el('button', { class: 'btn chip' + (this.opts.craft && !missing ? '' : ' disabled') }, label) as HTMLButtonElement;
      b.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        if (this.opts.craft && !missing) this.opts.craft(r.index, all);
      });
      return b;
    };
    row.append(btn('Craft', false), btn('Craft all', true));
    wrap.append(status, row);
    if (!this.opts.craft) wrap.append(el('div', { class: 'eb-note' }, 'Open an Engineering Crafting Table to craft from the book.'));
    return wrap;
  }

  private fillCell(cell: HTMLElement, num: number): void {
    clear(cell);
    const ic = iconEl({ id: num, count: 1 }, false);
    if (ic) cell.append(ic);
    cell.dataset.num = String(num);
    cell.dataset.item = items[num]?.id ?? '';
    cell.classList.toggle('link', !!guideEntry(items[num]?.id ?? ''));
  }

  private tickCycle(): void {
    this.cycleTick++;
    for (const c of this.cycle) this.fillCell(c.cell, c.options[this.cycleTick % c.options.length]!);
  }
}
