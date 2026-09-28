/**
 * Admin Panel (cheats). Every button sends a request that the server
 * authorises and validates; the panel never changes the game by itself.
 * Anything done here is advancement-neutral (see server/admin/AdminService).
 */
import { el, clear } from './dom';
import { iconEl, showTooltip, hideTooltip, itemDisplayName } from './slots';
import type { Screen } from './Screens';
import { items, CREATIVE_TABS, itemById } from '../../common/registry/items';
import type { ItemStack } from '../../common/game/itemstack';
import { POTIONS } from '../../common/data/potions';
import { ENCHANTMENTS } from '../../common/data/enchantments';
import { MOB_DEFS } from '../../common/data/mobs';
import { structureName, TIME_PRESETS, ADMIN_DIMENSIONS, type AdminAction, type AdminCatalog, type LocateResult } from '../../common/game/admin';
import type { DimensionId } from '../../common/data/biomes';

export interface AdminReply {
  ok: boolean;
  text: string;
  data?: unknown;
}

export interface AdminHost {
  request(action: AdminAction, onProgress?: (r: AdminReply) => void): Promise<AdminReply>;
  close(): void;
  /** Client-side performance figures for the Performance tab. */
  clientPerf(): Record<string, string | number>;
  playerName(): string;
  isOwner(): boolean;
  cheats(): boolean;
}

type Tab = 'items' | 'mobs' | 'teleport' | 'player' | 'world' | 'perf';
const TABS: { id: Tab; name: string; icon: string }[] = [
  { id: 'items', name: 'Give Items', icon: 'chest' },
  { id: 'mobs', name: 'Spawn Mobs', icon: 'spawn_egg_zombie' },
  { id: 'teleport', name: 'Teleport', icon: 'ender_pearl' },
  { id: 'player', name: 'Player', icon: 'golden_apple' },
  { id: 'world', name: 'World', icon: 'grass_block' },
  { id: 'perf', name: 'Performance', icon: 'redstone' },
];
const DIM_NAMES: Record<string, string> = { overworld: 'Overworld', nether: 'Nether', end: 'The End', farlands: 'Farlands' };
const MOB_CATEGORY_NAMES: Record<string, string> = { monster: 'Hostile', creature: 'Animals', water: 'Water', ambient: 'Ambient', npc: 'Villagers', boss: 'Bosses' };

/** Remembered between openings during a session. */
const memory: { tab: Tab; itemQuery: string; itemTab: string; mobQuery: string; mobCat: string; dim: DimensionId; structure: string; biome: string; cave: string; count: number } = {
  tab: 'items',
  itemQuery: '',
  itemTab: 'all',
  mobQuery: '',
  mobCat: 'all',
  dim: 'overworld',
  structure: 'village',
  biome: 'plains',
  cave: 'deep_dark',
  count: 1,
};

/** Every giveable stack: each registered item, potions and books expanded into their variants. */
function catalogStacks(): ItemStack[] {
  const out: ItemStack[] = [];
  for (const it of items) {
    if (it.num === 0) continue;
    if (it.id === 'potion' || it.id === 'splash_potion') for (const p of POTIONS) out.push({ id: it.num, count: 1, tag: { potion: p.id } });
    else if (it.id === 'enchanted_book') for (const e of ENCHANTMENTS) out.push({ id: it.num, count: 1, tag: { stored: { [e.id]: e.maxLevel } } });
    else out.push({ id: it.num, count: 1 });
  }
  return out;
}

export function adminScreen(host: AdminHost): Screen {
  const root = el('div', { class: 'screen dim center admin-screen' });
  const panel = el('div', { class: 'admin-panel' });
  const status = el('div', { class: 'admin-status' });
  const body = el('div', { class: 'admin-body' });
  const tabs = el('div', { class: 'admin-tabs' });
  let catalog: AdminCatalog | null = null;
  let perfTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  const say = (r: AdminReply | string, ok = true): void => {
    const text = typeof r === 'string' ? r : r.text;
    status.textContent = text;
    status.className = 'admin-status ' + ((typeof r === 'string' ? ok : r.ok) ? 'ok' : 'err');
  };
  const send = async (action: AdminAction, onProgress?: (r: AdminReply) => void): Promise<AdminReply> => {
    const r = await host.request(action, (p) => {
      say(p);
      onProgress?.(p);
    });
    if (!destroyed && r.text) say(r);
    return r;
  };
  const btn = (label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement => {
    const b = el('button', { class: cls }, label) as HTMLButtonElement;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  const field = (props: Record<string, unknown>): HTMLInputElement => {
    const f = el('input', { class: 'field', ...props }) as HTMLInputElement;
    f.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation();
    });
    return f;
  };
  const select = (options: { value: string; label: string }[], value: string, onChange: (v: string) => void): HTMLSelectElement => {
    const s = el('select', { class: 'field admin-select' }) as HTMLSelectElement;
    for (const o of options) s.append(el('option', { value: o.value }, o.label));
    s.value = options.some((o) => o.value === value) ? value : (options[0]?.value ?? '');
    s.addEventListener('change', () => onChange(s.value));
    s.addEventListener('keydown', (e) => e.stopPropagation());
    return s;
  };
  const label = (t: string): HTMLElement => el('div', { class: 'label' }, t);
  const section = (title: string, ...children: (HTMLElement | null)[]): HTMLElement => el('div', { class: 'admin-section' }, el('div', { class: 'admin-section-title' }, title), ...children.filter((c): c is HTMLElement => !!c));
  const targetSelect = (): HTMLSelectElement => {
    const players = catalog?.players ?? [host.playerName()];
    return select(
      players.map((n) => ({ value: n === host.playerName() ? '' : n, label: n === host.playerName() ? `${n} (you)` : n })),
      '',
      () => {},
    );
  };
  const target = (s: HTMLSelectElement): string | undefined => s.value || undefined;

  // ------------------------------------------------------------------ items
  const stacks = catalogStacks();
  const renderItems = (): HTMLElement => {
    const wrap = el('div', { class: 'admin-items' });
    const search = field({ placeholder: 'Search items (name or id)...', value: memory.itemQuery });
    const cats = el('div', { class: 'admin-chips' });
    const grid = el('div', { class: 'admin-grid' });
    const detail = el('div', { class: 'admin-detail' });
    let selected: ItemStack | null = null;
    const chip = (id: string, name: string): HTMLElement => {
      const c = btn(name, () => {
        memory.itemTab = id;
        for (const x of cats.children) x.classList.toggle('active', x === c);
        fill();
      }, 'btn chip' + (memory.itemTab === id ? ' active' : ''));
      return c;
    };
    cats.append(chip('all', 'All'));
    for (const t of CREATIVE_TABS) cats.append(chip(t.id, t.name));
    cats.append(chip('hidden', 'Technical'));
    const fill = (): void => {
      clear(grid);
      const q = memory.itemQuery.trim().toLowerCase();
      const frag = document.createDocumentFragment();
      let n = 0;
      for (const st of stacks) {
        const it = items[st.id]!;
        const tab = it.def.creative ?? 'building';
        if (memory.itemTab !== 'all' && tab !== memory.itemTab) continue;
        if (q && !itemDisplayName(st).toLowerCase().includes(q) && !it.id.includes(q)) continue;
        const cell = el('div', { class: 'slot admin-cell' });
        const ic = iconEl(st, false);
        if (ic) cell.append(ic);
        cell.addEventListener('mousemove', (e) => showTooltip(st, e.clientX, e.clientY, true));
        cell.addEventListener('mouseleave', () => hideTooltip());
        cell.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          selected = st;
          for (const c of grid.querySelectorAll('.admin-cell.selected')) c.classList.remove('selected');
          cell.classList.add('selected');
          showDetail();
        });
        frag.append(cell);
        n++;
      }
      grid.append(frag);
      if (!n) grid.append(el('div', { class: 'muted admin-empty' }, 'No items match.'));
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    search.addEventListener('input', () => {
      memory.itemQuery = search.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fill, 80);
    });
    const showDetail = (): void => {
      clear(detail);
      if (!selected) {
        detail.append(el('div', { class: 'muted' }, 'Pick an item to give.'));
        return;
      }
      const st = selected;
      const it = items[st.id]!;
      const icon = el('div', { class: 'slot big' });
      const ic = iconEl(st, false);
      if (ic) icon.append(ic);
      const qty = field({ type: 'number', min: 1, max: 2304, value: String(it.maxStack === 1 ? 1 : Math.min(memory.count, 2304)), class: 'field admin-num' });
      const quick = el('div', { class: 'row' }, ...[1, 16, 64, 640].map((n) => btn(String(n), () => (qty.value = String(n)), 'btn chip')));
      // Optional enchantment for enchantable gear
      let ench: HTMLSelectElement | null = null;
      let lvl: HTMLInputElement | null = null;
      if ((it.def.enchantability ?? 0) > 0 && it.id !== 'book') {
        ench = select([{ value: '', label: 'No enchantment' }, ...ENCHANTMENTS.map((e) => ({ value: e.id, label: e.name }))], '', () => {});
        lvl = field({ type: 'number', min: 1, max: 10, value: '1', class: 'field admin-num' });
      }
      const who = targetSelect();
      const give = btn('Give', () => {
        const count = Math.max(1, Math.min(2304, Math.floor(Number(qty.value) || 1)));
        memory.count = count;
        const book = st.tag?.stored ? Object.entries(st.tag.stored)[0] : undefined;
        void send({
          a: 'give',
          item: it.id,
          count,
          potion: st.tag?.potion,
          enchant: book ? book[0] : ench?.value || undefined,
          level: book ? book[1] : ench?.value ? Math.max(1, Math.min(10, Math.floor(Number(lvl?.value) || 1))) : undefined,
          target: target(who),
        });
      }, 'btn admin-go');
      const parts: (HTMLElement | null)[] = [
        el('div', { class: 'row admin-detail-head' }, icon, el('div', {}, el('div', {}, itemDisplayName(st)), el('div', { class: 'muted small' }, `minehonk:${it.id}${it.maxStack > 1 ? `, stacks to ${it.maxStack}` : ''}`))),
        label('Quantity'),
        el('div', { class: 'row' }, qty, quick),
        ench ? label('Enchantment (optional)') : null,
        ench && lvl ? el('div', { class: 'row' }, ench, lvl) : null,
        (catalog?.players.length ?? 1) > 1 ? label('Give to') : null,
        (catalog?.players.length ?? 1) > 1 ? who : null,
        give,
      ];
      for (const part of parts) if (part) detail.append(part);
    };
    wrap.append(search, cats, el('div', { class: 'admin-split' }, grid, detail));
    fill();
    showDetail();
    setTimeout(() => search.focus(), 0);
    return wrap;
  };

  // ------------------------------------------------------------------ mobs
  const renderMobs = (): HTMLElement => {
    const wrap = el('div', { class: 'admin-items' });
    const search = field({ placeholder: 'Search mobs...', value: memory.mobQuery });
    const cats = el('div', { class: 'admin-chips' });
    const list = el('div', { class: 'admin-list' });
    const detail = el('div', { class: 'admin-detail' });
    const mobs = catalog?.mobs ?? MOB_DEFS.map((m) => ({ id: m.id, name: m.name, category: m.category }));
    const catsSeen = [...new Set(mobs.map((m) => m.category))];
    let selected: (typeof mobs)[number] | null = null;
    const chip = (id: string, name: string): HTMLElement => {
      const c = btn(name, () => {
        memory.mobCat = id;
        for (const x of cats.children) x.classList.toggle('active', x === c);
        fill();
      }, 'btn chip' + (memory.mobCat === id ? ' active' : ''));
      return c;
    };
    cats.append(chip('all', 'All'));
    for (const c of catsSeen) cats.append(chip(c, MOB_CATEGORY_NAMES[c] ?? c));
    const icon = (id: string): HTMLElement => {
      const cell = el('div', { class: 'slot' });
      const egg = itemById.get('spawn_egg_' + id) ?? itemById.get('dragon_egg');
      const ic = egg ? iconEl({ id: egg.num, count: 1 }, false) : null;
      if (ic) cell.append(ic);
      return cell;
    };
    const fill = (): void => {
      clear(list);
      const q = memory.mobQuery.trim().toLowerCase();
      for (const m of mobs) {
        if (memory.mobCat !== 'all' && m.category !== memory.mobCat) continue;
        if (q && !m.name.toLowerCase().includes(q) && !m.id.includes(q)) continue;
        const row = el('div', { class: 'admin-row' + (selected?.id === m.id ? ' selected' : '') }, icon(m.id), el('div', {}, el('div', {}, m.name), el('div', { class: 'muted small' }, MOB_CATEGORY_NAMES[m.category] ?? m.category)));
        row.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          selected = m;
          for (const r of list.querySelectorAll('.admin-row.selected')) r.classList.remove('selected');
          row.classList.add('selected');
          showDetail();
        });
        list.append(row);
      }
    };
    search.addEventListener('input', () => {
      memory.mobQuery = search.value;
      fill();
    });
    const showDetail = (): void => {
      clear(detail);
      if (!selected) {
        detail.append(el('div', { class: 'muted' }, 'Pick a mob to spawn in front of you.'));
        return;
      }
      const m = selected;
      const qty = field({ type: 'number', min: 1, max: 50, value: '1', class: 'field admin-num' });
      detail.append(
        el('div', { class: 'row admin-detail-head' }, icon(m.id), el('div', {}, m.name)),
        label('How many (1-50)'),
        el('div', { class: 'row' }, qty, ...[1, 5, 10].map((n) => btn(String(n), () => (qty.value = String(n)), 'btn chip'))),
        m.id === 'ender_dragon' ? el('div', { class: 'muted small' }, 'In the End it joins the dragon fight. Admin-spawned mobs never count for advancements.') : el('div', { class: 'muted small' }, 'Admin-spawned mobs never count for advancements.'),
        btn('Spawn', () => void send({ a: 'spawn', mob: m.id, count: Math.max(1, Math.min(50, Math.floor(Number(qty.value) || 1))) }), 'btn admin-go'),
      );
    };
    wrap.append(search, cats, el('div', { class: 'admin-split' }, list, detail));
    fill();
    showDetail();
    return wrap;
  };

  // ------------------------------------------------------------------ teleport
  const renderTeleport = (): HTMLElement => {
    const wrap = el('div', { class: 'admin-cols' });
    const dimOptions = ADMIN_DIMENSIONS.map((d) => ({ value: d, label: DIM_NAMES[d]! }));
    const resultBox = (): HTMLElement => el('div', { class: 'admin-result' }, el('div', { class: 'muted' }, 'Pick one and press Find nearest.'));
    const showResult = (box: HTMLElement, r: AdminReply, go: () => void): void => {
      clear(box);
      const d = r.data as LocateResult | undefined;
      if (!r.ok || !d) {
        box.append(el('div', { class: 'error-text' }, r.text));
        return;
      }
      box.append(
        el('div', { class: 'admin-kv' }, el('span', { class: 'muted' }, 'Nearest:'), el('span', {}, d.name)),
        el('div', { class: 'admin-kv' }, el('span', { class: 'muted' }, 'Distance:'), el('span', {}, `${d.distance.toLocaleString()} blocks`)),
        el('div', { class: 'admin-kv' }, el('span', { class: 'muted' }, 'Dimension:'), el('span', {}, DIM_NAMES[d.dim] ?? d.dim)),
        btn('TELEPORT', go, 'btn admin-go'),
      );
    };
    // Structures
    const sBox = resultBox();
    const structures = (): { value: string; label: string }[] => (catalog?.structures[memory.dim] ?? []).map((id) => ({ value: id, label: structureName(id) })).sort((a, b) => a.label.localeCompare(b.label));
    let sSel = select(structures(), memory.structure, (v) => (memory.structure = v));
    const sHolder = el('div', {}, sSel);
    const findS = async (tp: boolean): Promise<void> => {
      const structure = sSel.value;
      if (!structure) return;
      clear(sBox);
      sBox.append(el('div', { class: 'muted' }, tp ? 'Finding a safe landing...' : 'Searching...'));
      const r = await send({ a: tp ? 'tp_structure' : 'locate_structure', dim: memory.dim, structure });
      if (destroyed) return;
      if (tp) {
        if (r.ok) host.close();
        else showResult(sBox, r, () => void findS(true));
        return;
      }
      showResult(sBox, r, () => void findS(true));
    };
    // Biomes
    const bBox = resultBox();
    const biomesFor = (): { value: string; label: string }[] => (catalog?.biomes[memory.dim] ?? []).map((b) => ({ value: b.id, label: b.name })).sort((a, b) => a.label.localeCompare(b.label));
    let bSel = select(biomesFor(), memory.biome, (v) => (memory.biome = v));
    const bHolder = el('div', {}, bSel);
    const findB = async (tp: boolean): Promise<void> => {
      const biome = bSel.value;
      if (!biome) return;
      clear(bBox);
      bBox.append(el('div', { class: 'muted' }, tp ? 'Finding a safe landing...' : 'Searching...'));
      const r = await send({ a: tp ? 'tp_biome' : 'locate_biome', dim: memory.dim, biome });
      if (destroyed) return;
      if (tp) {
        if (r.ok) host.close();
        else showResult(bBox, r, () => void findB(true));
        return;
      }
      showResult(bBox, r, () => void findB(true));
    };
    // Underground (V2 worlds): cave biomes, mega-caverns, ravines, the Ancient City
    const cBox = resultBox();
    const cavesFor = (): { value: string; label: string }[] => (catalog?.caves?.[memory.dim] ?? []).map((c) => ({ value: c.id, label: c.name }));
    let cSel = select(cavesFor(), memory.cave, (v) => (memory.cave = v));
    const cHolder = el('div', {});
    const findC = async (tp: boolean, what?: { a: 'structure' | 'cave'; id: string }): Promise<void> => {
      const target = what ?? { a: 'cave', id: cSel.value };
      if (!target.id) return;
      clear(cBox);
      cBox.append(el('div', { class: 'muted' }, tp ? 'Finding a safe landing...' : 'Searching underground...'));
      const r =
        target.a === 'structure'
          ? await send({ a: tp ? 'tp_structure' : 'locate_structure', dim: memory.dim, structure: target.id })
          : await send({ a: tp ? 'tp_biome' : 'locate_biome', dim: memory.dim, biome: `cave:${target.id}` });
      if (destroyed) return;
      if (tp && r.ok) {
        host.close();
        return;
      }
      showResult(cBox, r, () => void findC(true, target));
    };
    const fillCaves = (): void => {
      clear(cHolder);
      clear(cBox);
      if (!cavesFor().length) {
        cHolder.append(el('div', { class: 'muted small' }, memory.dim === 'overworld' ? 'This world was created before the Caves Update, so it has no cave biomes.' : 'No cave biomes in this dimension.'));
        return;
      }
      cSel = select(cavesFor(), memory.cave, (v) => (memory.cave = v));
      const hasCity = (catalog?.structures[memory.dim] ?? []).includes('ancient_city');
      cHolder.append(
        label('Cave biome or feature'),
        cSel,
        el('div', { class: 'row' }, btn('Find nearest', () => void findC(false), 'btn half-w'), btn('Teleport', () => void findC(true), 'btn half-w')),
        el(
          'div',
          { class: 'admin-chips' },
          hasCity ? btn('Find Ancient City', () => void findC(false, { a: 'structure', id: 'ancient_city' }), 'btn chip') : null,
          btn('Find Deep Dark', () => void findC(false, { a: 'cave', id: 'deep_dark' }), 'btn chip'),
          btn('Find Mega-Cavern', () => void findC(false, { a: 'cave', id: 'mega_cavern' }), 'btn chip'),
          btn('Spawn Warden (admin)', () => void send({ a: 'spawn', mob: 'warden', count: 1 }), 'btn chip'),
        ),
        el('div', { class: 'muted small' }, 'An admin Warden never counts for advancements or the Escape achievement.'),
        cBox,
      );
    };
    fillCaves();
    const dimSel = select(dimOptions, memory.dim, (v) => {
      memory.dim = v as DimensionId;
      fillCaves();
      sSel = select(structures(), memory.structure, (x) => (memory.structure = x));
      bSel = select(biomesFor(), memory.biome, (x) => (memory.biome = x));
      clear(sHolder);
      sHolder.append(sSel);
      clear(bHolder);
      bHolder.append(bSel);
      clear(sBox);
      clear(bBox);
    });
    // Players
    const players = el('div', { class: 'admin-list short' });
    for (const n of catalog?.players ?? []) {
      if (n === host.playerName()) continue;
      players.append(el('div', { class: 'admin-row' }, el('div', { style: { flex: '1' } }, n), btn('Go to', () => void send({ a: 'tp_player', target: n }), 'btn chip'), btn('Bring', () => void send({ a: 'bring_player', target: n }), 'btn chip')));
    }
    if (!players.children.length) players.append(el('div', { class: 'muted' }, 'No other players online.'));
    wrap.append(
      el(
        'div',
        { class: 'admin-col' },
        label('Dimension'),
        dimSel,
        section('Teleport to Structure', label('Structure'), sHolder, el('div', { class: 'row' }, btn('Find nearest', () => void findS(false), 'btn half-w'), btn('Teleport', () => void findS(true), 'btn half-w')), sBox),
        section('Underground', cHolder),
      ),
      el(
        'div',
        { class: 'admin-col' },
        section('Teleport to Biome', label('Biome'), bHolder, el('div', { class: 'row' }, btn('Find nearest', () => void findB(false), 'btn half-w'), btn('Teleport', () => void findB(true), 'btn half-w')), bBox),
        section('Players', players),
      ),
    );
    return wrap;
  };

  // ------------------------------------------------------------------ player
  const renderPlayer = (): HTMLElement => {
    const who = targetSelect();
    const hp = field({ type: 'number', min: 1, max: 2000, value: '20', class: 'field admin-num' });
    const food = field({ type: 'number', min: 0, max: 20, value: '20', class: 'field admin-num' });
    const xp = field({ type: 'number', min: -1000, max: 10000, value: '30', class: 'field admin-num' });
    let confirmClear = false;
    const clearBtn = btn('Clear inventory', () => {
      if (!confirmClear) {
        confirmClear = true;
        clearBtn.textContent = 'Click again to clear';
        return;
      }
      confirmClear = false;
      clearBtn.textContent = 'Clear inventory';
      void send({ a: 'clear_inventory', target: target(who) });
    });
    return el(
      'div',
      { class: 'admin-cols' },
      el(
        'div',
        { class: 'admin-col' },
        (catalog?.players.length ?? 1) > 1 ? section('Player', who) : null,
        section('Game Mode', el('div', { class: 'admin-chips' }, ...(['survival', 'creative', 'adventure', 'spectator', 'god'] as const).map((m) => btn(m[0]!.toUpperCase() + m.slice(1), () => void send({ a: 'gamemode', mode: m, target: target(who) }), 'btn chip')))),
        section('Health & Hunger', el('div', { class: 'row' }, btn('Heal', () => void send({ a: 'heal', target: target(who) }), 'btn chip')), el('div', { class: 'row' }, label('Health (half hearts)'), hp, btn('Set', () => void send({ a: 'health', value: Math.max(1, Number(hp.value) || 20), target: target(who) }), 'btn chip')), el('div', { class: 'row' }, label('Hunger (0-20)'), food, btn('Set', () => void send({ a: 'hunger', value: Math.max(0, Math.min(20, Math.floor(Number(food.value) || 0))), target: target(who) }), 'btn chip'))),
      ),
      el(
        'div',
        { class: 'admin-col' },
        section('Experience', el('div', { class: 'row' }, label('Levels'), xp, btn('Set', () => void send({ a: 'xp', mode: 'set', levels: Math.max(0, Math.floor(Number(xp.value) || 0)), target: target(who) }), 'btn chip'), btn('Add', () => void send({ a: 'xp', mode: 'add', levels: Math.floor(Number(xp.value) || 0), target: target(who) }), 'btn chip'))),
        section('Flight', el('div', { class: 'row' }, btn('Allow flying', () => void send({ a: 'flight', on: true, target: target(who) }), 'btn chip'), btn('Stop flying', () => void send({ a: 'flight', on: false, target: target(who) }), 'btn chip'))),
        section('Inventory', clearBtn),
      ),
    );
  };

  // ------------------------------------------------------------------ world
  const renderWorld = (): HTMLElement => {
    const radius = field({ type: 'number', min: 1, max: 256, value: '48', class: 'field admin-num' });
    let hostileOnly = true;
    const hostileBtn = btn('Hostile only: ON', () => {
      hostileOnly = !hostileOnly;
      hostileBtn.textContent = `Hostile only: ${hostileOnly ? 'ON' : 'OFF'}`;
    }, 'btn chip');
    let confirmRegen = false;
    const regen = btn('Regenerate this chunk', () => {
      if (!confirmRegen) {
        confirmRegen = true;
        regen.textContent = 'Click again: rebuild from seed';
        return;
      }
      confirmRegen = false;
      regen.textContent = 'Regenerate this chunk';
      void send({ a: 'regen_chunk' });
    });
    const cheatsToggle = host.isOwner() ? section('Cheats', el('div', { class: 'muted small' }, 'Turning cheats off hides this panel for everyone.'), btn(host.cheats() ? 'Turn cheats off' : 'Turn cheats on', () => void send({ a: 'set_cheats', on: !host.cheats() }).then(() => host.close()), 'btn chip')) : null;
    return el(
      'div',
      { class: 'admin-cols' },
      el(
        'div',
        { class: 'admin-col' },
        section('Time', el('div', { class: 'admin-chips' }, ...Object.entries(TIME_PRESETS).map(([k, v]) => btn(k[0]!.toUpperCase() + k.slice(1), () => void send({ a: 'time', value: v }), 'btn chip')))),
        section('Weather', el('div', { class: 'admin-chips' }, ...(['clear', 'rain', 'thunder'] as const).map((k) => btn(k[0]!.toUpperCase() + k.slice(1), () => void send({ a: 'weather', kind: k }), 'btn chip')))),
        section('Difficulty', el('div', { class: 'admin-chips' }, ...(['peaceful', 'easy', 'normal', 'hard'] as const).map((k) => btn(k[0]!.toUpperCase() + k.slice(1), () => void send({ a: 'difficulty', value: k }), 'btn chip')))),
        section('PvP', el('div', { class: 'admin-chips' }, btn('PvP on', () => void send({ a: 'pvp', on: true }), 'btn chip'), btn('PvP off', () => void send({ a: 'pvp', on: false }), 'btn chip'))),
      ),
      el(
        'div',
        { class: 'admin-col' },
        section('Remove Nearby Mobs', el('div', { class: 'row' }, label('Radius'), radius, hostileBtn), btn('Remove mobs', () => void send({ a: 'clear_mobs', radius: Math.max(1, Math.min(256, Math.floor(Number(radius.value) || 48))), hostileOnly }), 'btn')),
        section('Chunks', btn('Reload nearby chunks', () => void send({ a: 'reload_chunks' }), 'btn'), regen),
        cheatsToggle,
      ),
    );
  };

  // ------------------------------------------------------------------ performance
  const renderPerf = (): HTMLElement => {
    const box = el('div', { class: 'admin-cols' });
    const client = el('div', { class: 'admin-col admin-stats' });
    const server = el('div', { class: 'admin-col admin-stats' });
    const kv = (parent: HTMLElement, rows: Record<string, string | number>): void => {
      clear(parent);
      for (const [k, v] of Object.entries(rows)) parent.append(el('div', { class: 'admin-kv' }, el('span', { class: 'muted' }, k), el('span', {}, String(v))));
    };
    const refresh = async (): Promise<void> => {
      kv(client, host.clientPerf());
      const r = await host.request({ a: 'perf' });
      if (destroyed || !r.ok) return;
      const d = r.data as Record<string, string | number>;
      kv(server, { 'Server TPS': d.tps!, 'Tick time': `${d.tickMs} ms`, 'Loaded chunks': d.chunks!, Entities: d.entities!, Mobs: d.mobs!, Players: d.players!, 'Generation': `${d.genMsPerChunk} ms/chunk`, 'Chunks queued': d.pendingGeneration!, 'Server memory': d.serverHeapMB ? `${d.serverHeapMB} MB` : 'n/a' });
    };
    void refresh();
    perfTimer = setInterval(() => void refresh(), 1000);
    box.append(el('div', {}, el('div', { class: 'admin-section-title' }, 'This computer'), client), el('div', {}, el('div', { class: 'admin-section-title' }, 'Server'), server));
    return box;
  };

  // ------------------------------------------------------------------ layout
  const show = (t: Tab): void => {
    memory.tab = t;
    if (perfTimer) {
      clearInterval(perfTimer);
      perfTimer = null;
    }
    for (const c of tabs.children) c.classList.toggle('active', (c as HTMLElement).dataset.tab === t);
    clear(body);
    hideTooltip();
    const view = t === 'items' ? renderItems() : t === 'mobs' ? renderMobs() : t === 'teleport' ? renderTeleport() : t === 'player' ? renderPlayer() : t === 'world' ? renderWorld() : renderPerf();
    body.append(view);
  };
  for (const t of TABS) {
    const tab = el('div', { class: 'admin-tab', title: t.name });
    tab.dataset.tab = t.id;
    const num = itemById.get(t.icon)?.num;
    const ic = num !== undefined ? iconEl({ id: num, count: 1 }, false) : null;
    if (ic) tab.append(el('div', { class: 'slot' }, ic));
    tab.append(el('span', {}, t.name));
    tab.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      show(t.id);
    });
    tabs.append(tab);
  }
  panel.append(
    el('div', { class: 'admin-head' }, el('div', { class: 'admin-title' }, 'Admin Panel'), el('div', { class: 'admin-badge' }, 'CHEATS ENABLED'), btn('Done', () => host.close(), 'btn chip')),
    el('div', { class: 'admin-note muted small' }, 'Everything done here is a cheat: it never counts towards advancements.'),
    tabs,
    body,
    status,
  );
  root.append(panel);
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) host.close();
  });
  show(memory.tab);
  void host.request({ a: 'catalog' }).then((r) => {
    if (destroyed || !r.ok) {
      if (!destroyed) say(r);
      return;
    }
    catalog = r.data as AdminCatalog;
    if (memory.tab !== 'items') show(memory.tab);
  });
  return {
    root,
    onClose: () => {
      destroyed = true;
      if (perfTimer) clearInterval(perfTimer);
      hideTooltip();
    },
  };
}
