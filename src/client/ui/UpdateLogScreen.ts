/**
 * Options > Update Log: a book of what each update added. A list of sections
 * on the left (a strip across the top on narrow screens), the section on the
 * right: text, screenshots (click one to see it larger), cards, item icons,
 * real recipes and step-by-step examples.
 */
import { el, clear } from './dom';
import { iconEl, showTooltip, hideTooltip } from './slots';
import type { Screen, ScreenHost } from './Screens';
import { itemById, items } from '../../common/registry/items';
import { engRecipes, recipes, type CompiledRecipe } from '../../common/game/crafting';
import { ACHIEVEMENTS } from '../../common/data/achievements';
import { UPDATE_LOG, imageUrl, advancementIcon, type Block, type Card, type Section, type UpdateEntry } from './updateLog';

/** Remembered while the page is open: reopening the log comes back to the same place. */
const memory = { version: '', section: '' };

const numOf = (id: string): number => itemById.get(id)?.num ?? -1;

/** Text with **bold** parts. */
function rich(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) frag.append(el('b', {}, part.slice(2, -2)));
    else frag.append(part);
  });
  return frag;
}

/** An item icon in a slot, with its tooltip on hover. */
function itemSlot(id: string, cls = 'slot ul-slot'): HTMLElement {
  const box = el('div', { class: cls });
  const num = numOf(id);
  if (num < 0) return box;
  const ic = iconEl({ id: num, count: 1 }, false);
  if (ic) box.append(ic);
  box.addEventListener('mousemove', (e) => showTooltip({ id: num, count: 1 }, e.clientX, e.clientY));
  box.addEventListener('mouseleave', () => hideTooltip());
  return box;
}

const itemName = (id: string): string => itemById.get(id)?.def.name ?? id;

export function updateLogScreen(host: ScreenHost, inGame: boolean): Screen {
  const entry = UPDATE_LOG.find((e) => e.version === memory.version) ?? UPDATE_LOG[0]!;
  memory.version = entry.version;
  if (!entry.sections.some((s) => s.id === memory.section)) memory.section = entry.sections[0]!.id;

  const nav = el('div', { class: 'ul-nav' });
  const page = el('div', { class: 'ul-page' });
  const lightbox = el('div', { class: 'ul-lightbox hidden' });
  const close = el('button', { class: 'btn ul-close' }, 'Done') as HTMLButtonElement;
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    host.uiClick();
    hideTooltip();
    host.pop();
  });
  const versions = el('div', { class: 'ul-versions' });
  for (const e of UPDATE_LOG) versions.append(el('div', { class: 'ul-version' + (e === entry ? ' active' : '') }, `${e.version} - ${e.name}`));
  const book = el(
    'div',
    { class: 'ul-book' },
    el('div', { class: 'ul-head' }, el('div', { class: 'ul-head-title' }, 'Update Log'), versions, close),
    el('div', { class: 'ul-body' }, nav, page),
    lightbox,
  );
  const root = el('div', { class: 'screen update-log-screen ' + (inGame ? 'dim' : 'dirt') }, book);

  // ------------------------------------------------------------------ pictures
  const openLightbox = (src: string, caption: string): void => {
    clear(lightbox);
    lightbox.append(el('img', { class: 'ul-lightbox-img', src, alt: caption }), el('div', { class: 'ul-lightbox-cap' }, caption), el('div', { class: 'ul-lightbox-hint' }, 'Click anywhere or press Esc to close'));
    lightbox.classList.remove('hidden');
  };
  const closeLightbox = (): void => {
    lightbox.classList.add('hidden');
    clear(lightbox);
  };
  lightbox.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });

  const picture = (name: string, caption: string, cls = 'ul-figure'): HTMLElement => {
    const src = imageUrl(entry, name);
    const img = el('img', { class: 'ul-img', src, alt: caption, loading: 'lazy', decoding: 'async' }) as HTMLImageElement;
    img.addEventListener('error', () => img.classList.add('missing'));
    const fig = el('figure', { class: cls }, img, caption ? el('figcaption', {}, rich(caption)) : null);
    fig.addEventListener('click', (e) => {
      e.stopPropagation();
      host.uiClick();
      openLightbox(src, caption);
    });
    return fig;
  };

  // ------------------------------------------------------------------ blocks
  const recipeOf = (id: string): { r: CompiledRecipe; where: string } | null => {
    const n = numOf(id);
    const normal = recipes().find((r) => r.result === n);
    if (normal) return { r: normal, where: 'Crafting Table' };
    const eng = engRecipes().find((r) => r.result === n);
    return eng ? { r: eng, where: 'Engineering Crafting Table' } : null;
  };
  const recipeView = (id: string): HTMLElement | null => {
    const found = recipeOf(id);
    if (!found) return null;
    const { r, where } = found;
    const cells: (Set<number> | null)[] = new Array(9).fill(null);
    if (r.shaped) for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) cells[y * 3 + x] = r.cells[y * r.width + x] ?? null;
    else r.cells.forEach((c, i) => (cells[i] = c));
    const grid = el('div', { class: 'ul-grid' });
    for (const c of cells) {
      const first = c ? [...c][0] : undefined;
      const id = first !== undefined ? (items[first]?.id ?? '') : '';
      grid.append(id ? itemSlot(id) : el('div', { class: 'slot ul-slot' }));
    }
    const out = itemSlot(id, 'slot ul-slot ul-out');
    if (r.count > 1) out.append(el('div', { class: 'count' }, String(r.count)));
    return el('div', { class: 'ul-recipe' }, el('div', { class: 'ul-recipe-row' }, grid, el('div', { class: 'ul-arrow' }, '>'), out), el('div', { class: 'ul-note' }, `${itemName(id)} · ${where}${r.shaped ? '' : ' (any arrangement)'}`));
  };
  const equationView = (eq: { parts: string[]; result: string; where: string }): HTMLElement => {
    const row = el('div', { class: 'ul-recipe-row' });
    eq.parts.forEach((p, i) => {
      if (i) row.append(el('div', { class: 'ul-arrow' }, '+'));
      row.append(itemSlot(p));
    });
    row.append(el('div', { class: 'ul-arrow' }, '>'), itemSlot(eq.result, 'slot ul-slot ul-out'));
    return el('div', { class: 'ul-recipe' }, row, el('div', { class: 'ul-note' }, `${eq.parts.map(itemName).join(' + ')} > ${itemName(eq.result)} · ${eq.where}`));
  };
  const cell = (text: string): HTMLElement => {
    const td = el('td', {});
    if (text.startsWith('@')) {
      const sp = text.indexOf(' ');
      const id = text.slice(1, sp < 0 ? undefined : sp);
      td.append(el('div', { class: 'ul-cell-item' }, itemSlot(id, 'slot ul-slot small'), el('span', {}, rich(sp < 0 ? itemName(id) : text.slice(sp + 1)))));
    } else td.append(rich(text));
    return td;
  };
  const cardView = (c: Card): HTMLElement => {
    const card = el('div', { class: 'ul-card' + (c.link ? ' link' : '') + (c.img ? '' : ' compact') });
    if (c.img) card.append(picture(c.img, '', 'ul-card-pic'));
    const body = el('div', { class: 'ul-card-body' });
    const head = el('div', { class: 'ul-card-title' });
    if (c.icon) head.append(itemSlot(c.icon, 'slot ul-slot small'));
    head.append(el('span', {}, c.title));
    body.append(head, el('div', { class: 'ul-card-text' }, rich(c.text)));
    if (c.meta) body.append(el('div', { class: 'ul-card-meta' }, rich(c.meta)));
    card.append(body);
    if (c.link) {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        host.uiClick();
        open(c.link!);
      });
    }
    return card;
  };

  const block = (b: Block): HTMLElement => {
    switch (b.k) {
      case 'p':
        return el('p', { class: 'ul-text' }, rich(b.text));
      case 'h':
        return el('div', { class: 'ul-h' }, b.text);
      case 'img':
        return picture(b.img, b.caption);
      case 'gallery':
        return el('div', { class: 'ul-gallery' }, ...b.items.map((i) => picture(i.img, i.caption)));
      case 'cards':
        return el('div', {}, b.title ? el('div', { class: 'ul-h' }, b.title) : null, el('div', { class: 'ul-cards' + (b.items.every((c) => !c.img) ? ' compact' : '') }, ...b.items.map(cardView)));
      case 'items': {
        const grid = el('div', { class: 'ul-items' });
        for (const id of b.ids) grid.append(el('div', { class: 'ul-item' }, itemSlot(id), el('span', {}, itemName(id))));
        return el('div', {}, b.title ? el('div', { class: 'ul-sub' }, rich(b.title)) : null, grid);
      }
      case 'list':
        return el('ul', { class: 'ul-list' }, ...b.items.map((i) => el('li', {}, rich(i))));
      case 'table': {
        const table = el('table', { class: 'ul-table' }, el('thead', {}, el('tr', {}, ...b.head.map((h) => el('th', {}, h)))), el('tbody', {}, ...b.rows.map((r) => el('tr', {}, ...r.map(cell)))));
        return el('div', {}, b.title ? el('div', { class: 'ul-sub' }, b.title) : null, el('div', { class: 'ul-table-wrap' }, table));
      }
      case 'tip':
        return el('div', { class: 'ul-tip' }, el('div', { class: 'ul-tag' }, 'TIP'), el('div', {}, rich(b.text)));
      case 'example': {
        const box = el('div', { class: 'ul-example' }, el('div', { class: 'ul-tag' }, 'EXAMPLE'), el('div', { class: 'ul-example-title' }, b.title));
        if (b.text) box.append(el('p', { class: 'ul-text' }, rich(b.text)));
        if (b.steps) box.append(el('ol', { class: 'ul-steps' }, ...b.steps.map((s) => el('li', {}, rich(s)))));
        if (b.recipe) {
          const r = recipeView(b.recipe);
          if (r) box.append(r);
        }
        if (b.equation) box.append(equationView(b.equation));
        return box;
      }
      case 'advancements': {
        const i0 = ACHIEVEMENTS.findIndex((a) => a.id === b.from);
        const i1 = ACHIEVEMENTS.findIndex((a) => a.id === b.to);
        const list = i0 >= 0 && i1 >= i0 ? ACHIEVEMENTS.slice(i0, i1 + 1) : [];
        const grid = el('div', { class: 'ul-advancements' });
        for (const a of list) grid.append(el('div', { class: 'ul-adv' }, itemSlot(advancementIcon(a.icon)), el('div', {}, el('div', { class: 'ul-adv-title' }, a.title), el('div', { class: 'ul-adv-text' }, a.description))));
        return el('div', {}, el('div', { class: 'ul-sub' }, `${list.length} new advancements`), grid);
      }
    }
  };

  // ------------------------------------------------------------------ pages
  const renderNav = (): void => {
    clear(nav);
    for (const s of entry.sections) {
      const b = el('div', { class: 'ul-nav-item' + (s.id === memory.section ? ' active' : ''), title: s.title, 'data-section': s.id }, itemSlot(s.icon, 'ul-nav-ic'), el('span', {}, s.title));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        host.uiClick();
        open(s.id);
      });
      nav.append(b);
    }
    nav.querySelector('.ul-nav-item.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const renderPage = (s: Section): void => {
    clear(page);
    hideTooltip();
    if (s === entry.sections[0]) page.append(hero(entry));
    page.append(el('div', { class: 'ul-title' }, s.title));
    for (const b of s.blocks) page.append(block(b));
    const i = entry.sections.indexOf(s);
    const next = entry.sections[i + 1];
    const prev = entry.sections[i - 1];
    const foot = el('div', { class: 'ul-foot' });
    if (prev) foot.append(navButton(`< ${prev.title}`, prev.id));
    foot.append(el('div', { style: { flex: '1' } }));
    if (next) foot.append(navButton(`${next.title} >`, next.id));
    page.append(foot);
    page.scrollTop = 0;
  };
  const navButton = (label: string, id: string): HTMLElement => {
    const b = el('button', { class: 'btn ul-next' }, label) as HTMLButtonElement;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      host.uiClick();
      open(id);
    });
    return b;
  };
  const hero = (e: UpdateEntry): HTMLElement => {
    const h = el('div', { class: 'ul-hero' }, el('img', { class: 'ul-hero-img', src: imageUrl(e, e.hero), alt: '' }), el('div', { class: 'ul-hero-text' }, el('div', { class: 'ul-hero-version' }, e.version), el('div', { class: 'ul-hero-name' }, e.name), el('div', { class: 'ul-hero-tag' }, e.tagline)));
    return h;
  };
  function open(id: string): void {
    const s = entry.sections.find((x) => x.id === id);
    if (!s) return;
    memory.section = id;
    renderNav();
    renderPage(s);
  }
  open(memory.section);

  return {
    root,
    onKey(e) {
      if (e.code === 'Escape' && !lightbox.classList.contains('hidden')) {
        e.preventDefault();
        closeLightbox();
        return true;
      }
      return false;
    },
    onClose() {
      hideTooltip();
    },
  };
}
