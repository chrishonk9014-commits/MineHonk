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
import { structureName, TIME_PRESETS, ADMIN_DIMENSIONS, type AdminAction, type AdminCatalog, type LocateResult, type V4Op, type V5Op, type V55Op, type V6Op } from '../../common/game/admin';
import { EXPANSION_BIOMES } from '../../common/endExpansion/biomes';
import { END_QUESTS } from '../../common/endExpansion/quests';
import type { DimensionId } from '../../common/data/biomes';
import { ENDINGS } from '../../common/data/endings';

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

type Tab = 'items' | 'mobs' | 'teleport' | 'player' | 'world' | 'endgame' | 'v4' | 'v5' | 'v55' | 'v6' | 'perf';
const TABS: { id: Tab; name: string; icon: string }[] = [
  { id: 'items', name: 'Give Items', icon: 'chest' },
  { id: 'mobs', name: 'Spawn Mobs', icon: 'spawn_egg_zombie' },
  { id: 'teleport', name: 'Teleport', icon: 'ender_pearl' },
  { id: 'player', name: 'Player', icon: 'golden_apple' },
  { id: 'world', name: 'World', icon: 'grass_block' },
  { id: 'endgame', name: 'Endgame', icon: 'corrupted_eye' },
  { id: 'v4', name: 'World Update', icon: 'error_block' },
  { id: 'v5', name: 'Engineering', icon: 'crusher' },
  { id: 'v55', name: 'Digital Corruption', icon: 'corrupted_flash_drive' },
  { id: 'v6', name: 'End Expansion', icon: 'end_stone_bricks' },
  { id: 'perf', name: 'Performance', icon: 'redstone' },
];
const DIM_NAMES: Record<string, string> = { overworld: 'Overworld', nether: 'Nether', end: 'The End', farlands: 'Farlands', computer: 'Inside the Computer' };
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
      ),
      el(
        'div',
        { class: 'admin-col' },
        section('Teleport to Biome', label('Biome'), bHolder, el('div', { class: 'row' }, btn('Find nearest', () => void findB(false), 'btn half-w'), btn('Teleport', () => void findB(true), 'btn half-w')), bBox),
        section('Players', players),
        section('Underground', cHolder),
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

  // ------------------------------------------------------------------ endgame (V3)
  const renderEndgame = (): HTMLElement => {
    const state = el('div', { class: 'admin-stats' });
    const showState = (d: unknown): void => {
      if (!d || typeof d !== 'object') return;
      const st = d as { dragonDeath: string | null; reached: string[]; forced: string[]; eyeAwarded: boolean; farlandsAccess: boolean; errorDefeated: boolean; error: { state: string; phase: number; health: number; maxHealth: number } | null };
      const nameOf = (id: string): string => ENDINGS.find((e) => e.id === id)?.card.title ?? id;
      clear(state);
      const rows: [string, string][] = [
        ['Dragon', st.dragonDeath ? `defeated (${st.dragonDeath})` : 'alive'],
        ['Endings reached', st.reached.map(nameOf).join(', ') || 'none'],
        ['Forced (cheats)', st.forced.map(nameOf).join(', ') || 'none'],
        ['Corrupted Eye awarded', st.eyeAwarded ? 'yes' : 'no'],
        ['Glitched portal lit', st.farlandsAccess ? 'yes' : 'no'],
        ['The Error', st.error ? `${st.error.state}, phase ${st.error.phase}, ${Math.ceil(st.error.health)}/${st.error.maxHealth}` : st.errorDefeated ? 'defeated' : 'waiting in its arena'],
      ];
      for (const [k, v] of rows) state.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, k), el('span', {}, v)));
    };
    const endgame = (op: 'status' | 'reset_endings' | 'force_ending' | 'reset_error', id?: string): void => void send({ a: 'endgame', op, id }).then((r) => showState(r.data));
    const spawn = (mob: string, label: string): HTMLElement => btn(label, () => void send({ a: 'spawn', mob, count: 1 }), 'btn chip');
    const give = (item: string, label: string): HTMLElement => btn(label, () => void send({ a: 'give', item, count: 1 }), 'btn chip');
    const find = (dim: DimensionId, structure: string, label: string): HTMLElement =>
      el('div', { class: 'row' }, el('span', { class: 'label' }, label), btn('Find', () => void send({ a: 'locate_structure', dim, structure }), 'btn chip'), btn('Teleport', () => void send({ a: 'tp_structure', dim, structure }), 'btn chip'));
    const cave = el('div', { class: 'row' }, el('span', { class: 'label' }, 'Corrupted Cave'), btn('Find', () => void send({ a: 'locate_biome', dim: 'overworld', biome: 'cave:corrupted_caves' }), 'btn chip'), btn('Teleport', () => void send({ a: 'tp_biome', dim: 'overworld', biome: 'cave:corrupted_caves' }), 'btn chip'));
    endgame('status');
    return el(
      'div',
      { class: 'admin-cols' },
      el(
        'div',
        { class: 'admin-col' },
        section('Summon', el('div', { class: 'admin-chips' }, spawn('enderman', 'Enderman'), spawn('ender_dragon', 'Ender Dragon'), spawn('the_error', 'The Error'))),
        section('Give', el('div', { class: 'admin-chips' }, give('mysterious_potion', 'Mysterious Potion'), give('corrupted_eye', 'Corrupted Eye'), give('farlands_compass', 'Farlands Compass'))),
        section('Find', cave, find('overworld', 'glitched_portal', 'Glitched Portal'), find('farlands', 'error_arena', "The Error's Arena")),
      ),
      el(
        'div',
        { class: 'admin-col' },
        section('World State', state, btn('Refresh', () => endgame('status'), 'btn chip')),
        section('Endings', el('div', { class: 'admin-chips' }, ...ENDINGS.map((e) => btn(`Force: ${e.card.title}`, () => endgame('force_ending', e.id), 'btn chip'))), btn('Reset all endings', () => endgame('reset_endings'), 'btn chip')),
        section('The Error', el('div', { class: 'muted small' }, 'Ends a fight in progress and lets The Error form again.'), btn('Reset The Error', () => endgame('reset_error'), 'btn chip')),
      ),
    );
  };

  // ------------------------------------------------------------------ the Engineering Update (V5)
  const renderV5 = (): HTMLElement => {
    const state = el('div', { class: 'admin-stats' });
    const showState = (d: unknown): void => {
      if (!d || typeof d !== 'object') return;
      const st = d as { nodes: number; kinds: Record<string, number>; stepMs: number; perTick: number; inspect: Record<string, unknown> | null };
      clear(state);
      const rows: [string, string][] = [
        ['Engineering blocks loaded', String(st.nodes)],
        ['Last step', `${st.stepMs} ms (${st.perTick} ms per tick)`],
        ['By kind', Object.entries(st.kinds).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') || 'none'],
      ];
      const i = st.inspect;
      if (i) {
        rows.push(['Nearest', `${String(i.name)} at ${(i.at as number[]).join(', ')}${i.cheat ? ' (cheat)' : ''}`], ['State', String(i.status)]);
        if (i.energy) rows.push(['Energy', String(i.energy)]);
        if (i.fluid) rows.push(['Fluid', String(i.fluid)]);
        rows.push(['Network', i.network ? String(i.network) : 'not on an energy network']);
      } else rows.push(['Nearest', 'no engineering block within 8 blocks']);
      for (const [k, v] of rows) state.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, k), el('span', {}, v)));
    };
    const op = (o: V5Op): void => void send({ a: 'v5', op: o }).then((r) => showState(r.data));
    op('status');
    return el(
      'div',
      { class: 'admin-cols' },
      el(
        'div',
        { class: 'admin-col' },
        section('Kits', el('div', { class: 'muted small' }, 'Cheat-marked items: they never count for advancements.'), el('div', { class: 'admin-chips' }, btn('Starter kit', () => op('kit_basic'), 'btn chip'), btn('Advanced kit', () => op('kit_advanced'), 'btn chip'), btn('Factory kit', () => op('kit_factory'), 'btn chip'))),
        section('Energy', el('div', { class: 'muted small' }, 'Within 16 blocks of you. Filled machines are cheat-marked.'), el('div', { class: 'admin-chips' }, btn('Fill energy', () => op('fill_energy'), 'btn chip'), btn('Drain energy', () => op('drain_energy'), 'btn chip'), btn('Reset machines', () => op('reset_machines'), 'btn chip'))),
        section('Test', el('div', { class: 'admin-chips' }, btn('Build a test line', () => op('test_rig'), 'btn chip'), btn('Stress test (250 machines)', () => op('stress_test'), 'btn chip'))),
      ),
      el('div', { class: 'admin-col' }, section('Inspect', state, btn('Refresh', () => op('status'), 'btn chip'))),
    );
  };

  // ------------------------------------------------------------------ the Digital Corruption Update (V5.5)
  const renderV55 = (): HTMLElement => {
    const state = el('div', { class: 'admin-stats' });
    const STAGES: Record<string, string> = { none: 'Not started', emerging: 'A computer is being taken over', fight1: 'Herobrine is out (first fight)', gateway: 'The computer is a way in', final: 'In his cave (final fight)', ending: 'The digital world is collapsing' };
    const showState = (d: unknown): void => {
      clear(state);
      const st = d as { stage?: string; gateway?: { x: number; y: number; z: number } | null; cheat?: boolean; dragonKills?: number; legitKills?: number; completions?: number; infected?: boolean; clouds?: number; fight?: { kind: string; state: string; phase: number; health: number; maxHealth: number } | null; party?: number } | undefined;
      if (!st || st.stage === undefined) return;
      const rows: [string, string][] = [
        ['Story', `${STAGES[st.stage] ?? st.stage}${st.cheat ? ' (a cheat run)' : ''}`],
        ['Computer', st.gateway ? `${st.gateway.x}, ${st.gateway.y}, ${st.gateway.z}` : 'none'],
        ['Ender Dragon', `${st.infected ? 'sick with malware, ' : ''}killed ${st.dragonKills ?? 0} times (${st.legitKills ?? 0} without cheats)`],
        ['Malware clouds', String(st.clouds ?? 0)],
        ['Players in it', String(st.party ?? 0)],
        ['Herobrine', st.fight ? `${st.fight.kind === 'first' ? 'first fight' : 'final fight'}, ${st.fight.state}${st.fight.kind === 'final' ? `, phase ${st.fight.phase}` : ''}, ${Math.ceil(st.fight.health)} / ${st.fight.maxHealth}` : 'not here'],
        ['Seen through', `${st.completions ?? 0} time${st.completions === 1 ? '' : 's'}`],
      ];
      for (const [k, v] of rows) state.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, k), el('span', {}, v)));
    };
    const op = (o: V55Op): void => void send({ a: 'v55', op: o }).then((r) => showState(r.data));
    const chips = (...b: HTMLElement[]): HTMLElement => el('div', { class: 'admin-chips' }, ...b);
    op('status');
    return el(
      'div',
      { class: 'admin-cols' },
      el(
        'div',
        { class: 'admin-col' },
        el('div', { class: 'muted small' }, 'Everything here is a cheat: it never awards an advancement, and a story run it touches only ever records its ending as forced.'),
        section('Give', chips(btn('Mysterious Potion', () => op('give_potion'), 'btn chip'), btn('Hard Drive', () => op('give_hard_drive'), 'btn chip'), btn('Flash Drive', () => op('give_flash_drive'), 'btn chip'), btn('Corrupted Flash Drive', () => op('give_corrupted'), 'btn chip'))),
        section('The Ender Dragon', chips(btn('Spawn the dragon (go to the End)', () => op('spawn_dragon'), 'btn chip'), btn('Trigger malware', () => op('trigger_malware'), 'btn chip'))),
        section(
          'Herobrine',
          el('div', { class: 'muted small' }, 'In the Overworld: uses the computer beside you or builds one.'),
          chips(btn('Trigger the Herobrine event', () => op('trigger_event'), 'btn chip'), btn('Spawn the first Herobrine', () => op('spawn_first'), 'btn chip')),
        ),
        section('Inside the Computer', chips(btn('Enter the computer world', () => op('enter_world'), 'btn chip'), btn('Teleport to the seed', () => op('tp_seed'), 'btn chip'), btn('Teleport to the cave', () => op('tp_cave'), 'btn chip'), btn('Spawn the final Herobrine', () => op('spawn_final'), 'btn chip'))),
        section('Endings & Resets', chips(btn('Force the Herobrine ending', () => op('force_ending'), 'btn chip'), btn('Reset Herobrine progression', () => op('reset_progress'), 'btn chip'), btn('Reset the ending', () => op('reset_ending'), 'btn chip'))),
      ),
      el('div', { class: 'admin-col' }, section('Story', state, btn('Refresh', () => op('status'), 'btn chip'))),
    );
  };

  // ------------------------------------------------------------------ the End Expansion (V6)
  const renderV6 = (): HTMLElement => {
    const state = el('div', { class: 'admin-stats' });
    const showState = (d: unknown): void => {
      const st = d as
        | {
            portal: { built: boolean; x: number; y: number; z: number; active: boolean; opened: boolean; cheat: boolean } | null;
            dragonDefeated: boolean;
            arrival: { x: number; y: number; z: number; biome: string };
            here: { dim: string; x: number; y: number; z: number; inExpansion: boolean; biome: string | null };
            biomes: { id: string; name: string; visited: boolean }[];
            mobs?: { spawning: boolean; kinds: { id: string; name: string }[]; counts: Record<string, Record<string, number>> };
            sets?: { id: string; name: string; items: string[] }[];
            structures?: Structs;
            located?: { id: string; name: string; giant: boolean; at: { x: number; y: number; z: number; distance: number } | null }[];
            events?: P5Events | null;
            citadel?: { site: number[] | null; entrance?: number[]; floors?: { kind: string; done: boolean }[]; charts?: number } | null;
            guardian?: { awake?: boolean; phase?: number; health?: number; charged?: boolean; reformsIn?: number; defeats?: number } | null;
            dragon?: { alive: boolean; phase: string | null; storm: boolean; craters: number };
          }
        | undefined;
      if (!st?.arrival) return;
      clear(state);
      showP5(st);
      showMobs(st);
      showSets(st.sets);
      showStructures(st.structures, st.located);
      const pt = st.portal;
      const rows: [string, string][] = [
        ['Expansion Portal', pt ? `${pt.active ? 'open' : 'dormant'}${pt.cheat ? ' (opened by a cheat)' : ''}${pt.built ? ` at ${pt.x}, ${pt.y}, ${pt.z}` : ', not built yet'}` : 'not built yet (the End has not been visited)'],
        ['Ender Dragon', st.dragonDefeated ? 'defeated' : 'not defeated yet'],
        ['Arrival platform', `${st.arrival.x}, ${st.arrival.y}, ${st.arrival.z} (${st.arrival.biome})`],
        ['You', `${DIM_NAMES[st.here.dim] ?? st.here.dim} ${st.here.x}, ${st.here.y}, ${st.here.z}`],
        ['Biome here', st.here.inExpansion ? st.here.biome ?? '?' : 'not in the Expanded End'],
        ['Biomes visited', `${st.biomes.filter((b) => b.visited).length} of ${st.biomes.length}`],
      ];
      for (const [k, v] of rows) state.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, k), el('span', {}, v)));
    };
    const op = (o: V6Op, biome?: string): void => void send(biome ? { a: 'v6', op: o, biome } : { a: 'v6', op: o }).then((r) => showState(r.data));
    // Phase 5: the events, the Void Citadel, the End Guardian, rare loot and the Dragon's new moves
    type P5Events = { storm?: string; stormLeft?: number; eclipse?: boolean; eclipseLeft?: number; remnants?: number; monoliths?: number; shards?: number; nextStorm?: number };
    const p5Line = el('div', { class: 'admin-stats' });
    const secs = (t: number | undefined): string => `${Math.ceil((t ?? 0) / 20)} s`;
    const showP5 = (st: { events?: P5Events | null; citadel?: { site: number[] | null; floors?: { kind: string; done: boolean }[]; charts?: number } | null; guardian?: { awake?: boolean; phase?: number; health?: number; charged?: boolean; reformsIn?: number; defeats?: number } | null; dragon?: { alive: boolean; phase: string | null; storm: boolean; craters: number } }): void => {
      clear(p5Line);
      const ev = st.events;
      const c = st.citadel;
      const g = st.guardian;
      const rows: [string, string][] = [
        ['Void Storm', ev ? (ev.storm === 'active' ? `raging (${secs(ev.stormLeft)} left, ${ev.remnants ?? 0} remnants)` : ev.storm === 'warning' ? 'approaching' : `calm (next in about ${Math.round((ev.nextStorm ?? 0) / 1200)} min)`) : 'not running'],
        ['End Eclipse', ev ? (ev.eclipse ? `under way (${secs(ev.eclipseLeft)} left, ${ev.monoliths ?? 0} monoliths, ${ev.shards ?? 0} shards)` : 'none') : 'not running'],
        ['Void Citadel', c?.site ? `at ${c.site.join(', ')}: ${c.floors?.filter((f) => f.done).length ?? 0} of ${c.floors?.length ?? 6} floors done` : 'no site yet'],
        ['End Guardian', g ? (g.awake ? `awake, phase ${g.phase}, ${Math.ceil(g.health ?? 0)} health` : g.reformsIn ? `re-forms in ${Math.ceil(g.reformsIn / 24000)} days` : `waiting (altar ${g.charged ? 'charged' : 'wants 4 Eclipse Shards'})`) : 'not running'],
        ['Ender Dragon (V6)', st.dragon ? `${st.dragon.alive ? `alive (${st.dragon.phase})` : 'not here'}${st.dragon.storm ? ', storm' : ''}${st.dragon.craters ? `, ${st.dragon.craters} crater blocks to put back` : ''}` : ''],
      ];
      for (const [k, v] of rows) p5Line.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, k), el('span', {}, v)));
    };
    const p5 = (body: Record<string, unknown>): void => void send({ a: 'v6', ...body } as never).then((r) => showState(r.data));
    const citadelSpots: [string, string][] = [['entrance', 'Entrance'], ['1', 'Floor 1'], ['2', 'Floor 2'], ['3', 'Floor 3'], ['4', 'Floor 4'], ['5', 'Floor 5'], ['6', 'Floor 6'], ['arena', 'Arena']];
    const rareLoot: [string, string][] = [['guardian_core', 'Guardian Core'], ['guardians_lance', "The Guardian's Lance"], ['eclipse_veil', 'Eclipse Veil module'], ['eclipse_shards', 'Eclipse Shards'], ['star_chart', 'Star Chart pieces'], ['guardian_head', 'End Guardian Head']];
    const dragonTests: [string, string][] = [['breath_wave', 'Void Breath Wave'], ['wing_gust', 'Wing Gust'], ['roar', 'Roar'], ['pillar_weave', 'Pillar Weave'], ['strafing_dive', 'Strafing Dive'], ['crystal_fury', 'Crystal Fury'], ['edge_strike', 'Edge Strike'], ['dragon_storm', 'Dragon Storm']];
    const chips = (...b: HTMLElement[]): HTMLElement => el('div', { class: 'admin-chips' }, ...b);
    // Phase 2: the Expanded End's mobs (spawned as cheat mobs: killing them never counts) and resources
    const mobBox = el('div', {});
    const counts = el('div', { class: 'admin-stats' });
    const spawning = el('div', { class: 'muted small' });
    const showMobs = (st: { mobs?: { spawning: boolean; kinds: { id: string; name: string }[]; counts: Record<string, Record<string, number>> } }): void => {
      const m = st.mobs;
      if (!m) return;
      clear(mobBox);
      for (const k of m.kinds)
        mobBox.append(el('div', { class: 'row' }, el('span', { class: 'label' }, k.name), btn('Spawn 1', () => void send({ a: 'spawn', mob: k.id, count: 1 }), 'btn chip'), btn('Spawn a group', () => void send({ a: 'spawn', mob: k.id, count: k.id === 'chorus_beast' || k.id === 'end_phantom' ? 2 : 4 }), 'btn chip')));
      spawning.textContent = `Natural spawning of these mobs is ${m.spawning ? 'on' : 'off'}.`;
      clear(counts);
      for (const b of EXPANSION_BIOMES) {
        const row = m.counts[b.id] ?? {};
        const parts = m.kinds.filter((k) => row[k.id]).map((k) => `${row[k.id]} ${k.name}`);
        counts.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, b.name), el('span', {}, parts.length ? parts.join(', ') : 'none')));
      }
    };
    const itemName = (id: string): string => itemById.get(id)?.def.name ?? id;
    const setBox = el('div', {});
    let setsShown = false;
    const showSets = (sets: { id: string; name: string; items: string[] }[] | undefined): void => {
      if (!sets || setsShown) return;
      setsShown = true;
      for (const g of sets)
        setBox.append(
          el('div', { class: 'muted small' }, g.name),
          chips(btn(`All of ${g.name}`, () => void send({ a: 'v6', op: 'give_set', set: g.id }), 'btn chip'), ...g.items.map((id) => btn(itemName(id), () => void send({ a: 'give', item: id, count: 1 }), 'btn chip'))),
        );
    };
    // Phase 3: the structures (generator 8 worlds), the Guardian Constructs and the Dragon's Nest
    type Structs = { kinds: { id: string; name: string; giant: boolean }[]; constructs: { id: string; name: string }[]; enabled?: boolean; nest?: { due: boolean; built: boolean; carved: number; chunks: number }; building?: number };
    const structBox = el('div', {});
    const locBox = el('div', { class: 'admin-stats' });
    const nestLine = el('div', { class: 'muted small' });
    let structsShown = false;
    const sop = (o: V6Op, structure: string): void => void send({ a: 'v6', op: o, structure }).then((r) => showState(r.data));
    const showStructures = (s: Structs | undefined, located?: { id: string; name: string; giant: boolean; at: { x: number; y: number; z: number; distance: number } | null }[]): void => {
      if (!s) return;
      const n = s.nest;
      nestLine.textContent = n ? (n.built ? "The Dragon's Nest is built." : n.due ? `The Dragon's Nest is being carved (${n.carved} of ${n.chunks} chunks).` : "The Dragon's Nest comes after the dragon's first defeat.") : '';
      if (!s.enabled) nestLine.textContent += ' This world was made before the Expanded End had structures: only new worlds have them (the Nest is in every world).';
      if (located) {
        clear(locBox);
        for (const l of located)
          locBox.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, l.name), el('span', {}, l.at ? `${l.at.x}, ${l.at.z} (${l.at.distance} blocks)` : 'none found'), ...(l.at ? [btn('Teleport', () => sop('tp_structure', l.id), 'btn chip')] : [])));
      }
      if (structsShown) return;
      structsShown = true;
      structBox.append(
        el('div', { class: 'muted small' }, 'Teleport to the nearest:'),
        chips(...s.kinds.map((k) => btn(k.name, () => sop('tp_structure', k.id), 'btn chip'))),
        el('div', { class: 'muted small' }, 'Generate one here (built a chunk at a time; its Constructs are cheat mobs):'),
        chips(...s.kinds.map((k) => btn(k.name, () => sop('generate_here', k.id), 'btn chip'))),
        el('div', { class: 'muted small' }, 'Guardian Constructs (cheat mobs: defeating them never counts):'),
        chips(...s.constructs.map((c) => btn(`Spawn ${c.name.replace('Guardian Construct: ', '')}`, () => void send({ a: 'spawn', mob: c.id, count: 1 }), 'btn chip'))),
      );
    };
    // Phase 4: the End quests (every op advancement-neutral) and the testing tools
    const questLine = el('div', { class: 'admin-stats' });
    const showQuests = (q: { silentCity?: { type: string; hall: number[]; built: number } | null; gates?: number; done?: string[]; sanctum?: { at: number[]; built: boolean } | null } | undefined): void => {
      if (!q) return;
      clear(questLine);
      const rows: [string, string][] = [
        ['Silent City', q.silentCity ? `${q.silentCity.type.replace(/_/g, ' ')} at ${q.silentCity.hall.join(', ')}` : 'not chosen yet (when a player first reaches the band)'],
        ['Linked gateways', String(q.gates ?? 0)],
        ['Sanctum', q.sanctum ? `${q.sanctum.at.join(', ')}${q.sanctum.built ? ' (built)' : ''}` : 'not opened'],
        ['Completed sites', String(q.done?.length ?? 0)],
      ];
      for (const [k, v] of rows) questLine.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, k), el('span', {}, v)));
    };
    const qop = (o: V6Op, quest: string): void => void send({ a: 'v6', op: o, quest }).then((r) => showQuests((r.data as { quests?: Parameters<typeof showQuests>[0] } | undefined)?.quests));
    const questBox = el(
      'div',
      {},
      ...END_QUESTS.map((q) => el('div', { class: 'row' }, el('span', { class: 'label' }, q.title), btn('Start', () => qop('quest_start', q.id), 'btn chip'), btn('Complete', () => qop('quest_complete', q.id), 'btn chip'), btn('Reset', () => qop('quest_reset', q.id), 'btn chip'), btn('Teleport', () => qop('quest_tp', q.id), 'btn chip'))),
    );
    op('status');
    return el(
      'div',
      { class: 'admin-cols' },
      el(
        'div',
        { class: 'admin-col' },
        el('div', { class: 'muted small' }, 'Everything here is a cheat: it never awards an advancement. A portal opened here before the Ender Dragon is defeated leads to a cheat visit.'),
        section('Events', el('div', { class: 'muted small' }, 'Over the Expanded End. Started here, nothing in them counts for advancements.'), chips(btn('Start a Void Storm', () => op('storm_start'), 'btn chip'), btn('Stop the storm', () => op('storm_stop'), 'btn chip'), btn('Start an End Eclipse', () => op('eclipse_start'), 'btn chip'), btn('End the eclipse', () => op('eclipse_stop'), 'btn chip')), p5Line),
        section(
          'The Void Citadel',
          el('div', { class: 'muted small' }, 'Teleport (the Citadel is built as its chunks load), solve the floor you are on, or seal every floor again.'),
          chips(...citadelSpots.map(([id, label]) => btn(label, () => p5({ op: 'citadel_tp', spot: id }), 'btn chip'))),
          chips(btn('Solve this floor', () => op('citadel_solve'), 'btn chip'), btn('Reset Citadel progress', () => op('citadel_reset'), 'btn chip')),
        ),
        section('The End Guardian', el('div', { class: 'muted small' }, 'In the arena. A Guardian woken or felled here gives no loot and no advancement.'), chips(btn('Spawn', () => op('guardian_spawn'), 'btn chip'), btn('Force defeat', () => op('guardian_defeat'), 'btn chip'), btn('Reset', () => op('guardian_reset'), 'btn chip'))),
        section('Rare End loot', el('div', { class: 'muted small' }, 'Cheat-marked items: they never count for advancements.'), chips(...rareLoot.map(([id, label]) => btn(label, () => p5({ op: 'give_rare', set: id }), 'btn chip')))),
        section("The Dragon's new moves", el('div', { class: 'muted small' }, 'One at a time, in the End while the Dragon lives (the fight becomes a cheat: its defeat awards nothing).'), chips(...dragonTests.map(([id, label]) => btn(label, () => p5({ op: 'dragon_test', test: id }), 'btn chip')))),
        section('End quests', el('div', { class: 'muted small' }, 'Start, complete (no advancements; any reward is cheat-made), reset, or go to the nearest start. Sites are searched from you in the End.'), questBox, questLine),
        section('Engineering and transport tests', el('div', { class: 'muted small' }, 'Look at the block first.'), chips(btn('Fill the machine\'s EU', () => op('fill_eu'), 'btn chip'), btn('Force-repair this gateway and its pair', () => op('force_gate'), 'btn chip'), btn("Open the Dragon's History Sanctum", () => op('open_sanctum'), 'btn chip'), btn('Build an End test line', () => op('end_rig'), 'btn chip'))),
        section('Expansion Portal', chips(btn('Activate', () => op('activate'), 'btn chip'), btn('Deactivate', () => op('deactivate'), 'btn chip'), btn('Build the portal', () => op('build_portal'), 'btn chip'), btn('Teleport to the portal', () => op('tp_portal'), 'btn chip'))),
        section('The Expanded End', chips(btn('Teleport to the arrival platform', () => op('tp_arrival'), 'btn chip'))),
        section('The Ender Dragon', el('div', { class: 'muted small' }, 'In the End: ends the fight at once, so the portal can be tested. Nothing it drops counts.'), chips(btn('Defeat the Ender Dragon', () => op('defeat_dragon'), 'btn chip'))),
        section('Biomes', chips(...EXPANSION_BIOMES.map((b) => btn(b.name, () => op('tp_biome', b.id), 'btn chip')))),
        section('Mobs', el('div', { class: 'muted small' }, 'Spawned in front of you, as cheat mobs: defeating them never counts.'), mobBox, chips(btn('Remove expansion mobs nearby', () => op('kill_mobs'), 'btn chip'), btn('Natural spawning on', () => op('mob_spawning_on'), 'btn chip'), btn('Natural spawning off', () => op('mob_spawning_off'), 'btn chip')), spawning),
        section('Resources', el('div', { class: 'muted small' }, 'Cheat-marked items: they never count for advancements.'), setBox, chips(btn('A random lore book', () => op('give_lore'), 'btn chip'))),
        section('Structures', structBox, chips(btn('Locate every structure', () => op('locate_structures'), 'btn chip'), btn('Reset the loot here', () => op('reset_loot'), 'btn chip')), locBox),
        section("The Dragon's Nest", nestLine, chips(btn("Build the Dragon's Nest", () => op('build_nest'), 'btn chip'), btn("Teleport to the Dragon's Nest", () => op('tp_nest'), 'btn chip'))),
      ),
      el('div', { class: 'admin-col' }, section('Status', state, chips(btn('Refresh', () => op('status'), 'btn chip'), btn('Where am I?', () => op('where'), 'btn chip'))), section('Mobs by biome (loaded areas)', counts)),
    );
  };

  // ------------------------------------------------------------------ the World Update (V4)
  const renderV4 = (): HTMLElement => {
    const state = el('div', { class: 'admin-stats' });
    const showState = (d: unknown): void => {
      if (!d || typeof d !== 'object') return;
      const st = d as {
        inErrorBiome: boolean;
        glitch: { stage: number; done: boolean; fighting: number | null; mobs: number } | null;
        bunker: { stage: number; done: boolean; stages: number } | null;
        temple: { name: string; stage: number; done: boolean; stages: number; run: string | null } | null;
      };
      clear(state);
      const rows: [string, string][] = [
        ['Glitched Structure', st.glitch ? (st.glitch.done ? 'complete' : st.glitch.fighting ? `stage ${st.glitch.fighting} in progress, ${st.glitch.mobs} left` : `${st.glitch.stage} of 5 stages cleared`) : 'not in an Error Biome chunk'],
        ['Bunker', st.bunker ? (st.bunker.done ? 'secured' : `objective ${st.bunker.stage} of ${st.bunker.stages}`) : 'not in a bunker'],
        ['Temple', st.temple ? `${st.temple.name}: ${st.temple.done ? 'complete' : st.temple.run ? `${st.temple.run} in progress` : `${st.temple.stage} of ${st.temple.stages - 1} trials done`}` : 'not in a temple'],
      ];
      for (const [k, v] of rows) state.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, k), el('span', {}, v)));
    };
    const op = (o: V4Op): void => void send({ a: 'v4', op: o }).then((r) => showState(r.data));
    const find = (dim: DimensionId, structure: string, label: string): HTMLElement =>
      el('div', { class: 'row' }, el('span', { class: 'label' }, label), btn('Find', () => void send({ a: 'locate_structure', dim, structure }), 'btn chip'), btn('Teleport', () => void send({ a: 'tp_structure', dim, structure }), 'btn chip'));
    const spawn = (mob: string, label: string): HTMLElement => btn(label, () => void send({ a: 'spawn', mob, count: 1 }), 'btn chip');
    const give = (item: string, label: string): HTMLElement => btn(label, () => void send({ a: 'give', item, count: 1 }), 'btn chip');
    op('status');
    return el(
      'div',
      { class: 'admin-cols' },
      el(
        'div',
        { class: 'admin-col' },
        section(
          'Find',
          find('overworld', 'village', 'Village'),
          find('overworld', 'sun_monument', 'Sun Monument'),
          find('overworld', 'jungle_shrine', 'Jungle Shrine'),
          find('overworld', 'bunker', 'Bunker'),
          find('overworld', 'jungle_temple', 'Jungle Temple'),
          find('overworld', 'desert_pyramid', 'Desert Pyramid'),
          find('overworld', 'frost_temple', 'Frost Temple'),
          find('overworld', 'swamp_temple', 'Swamp Temple'),
          find('overworld', 'badlands_temple', 'Canyon Temple'),
          find('overworld', 'forest_temple', 'Grove Temple'),
          find('overworld', 'mountain_temple', 'Mountain Temple'),
          find('overworld', 'stone_circle', 'Stone Circle'),
          find('overworld', 'desert_oasis', 'Desert Oasis'),
          find('overworld', 'lighthouse', 'Lighthouse'),
          find('overworld', 'buried_tomb', 'Buried Tomb'),
          find('overworld', 'error_biome', 'Error Biome'),
          find('overworld', 'glitched_structure', 'Glitched Structure'),
          find('nether', 'glitched_structure', 'Glitched Structure (Nether)'),
        ),
        section('Spawn Glitched Mobs', el('div', { class: 'admin-chips' }, spawn('glitch_zombie', 'Glitched Zombie'), spawn('glitch_skeleton', 'Glitched Skeleton'), spawn('rift_walker', 'Rift Walker'), spawn('void_wisp', 'Void Wisp'), spawn('glitch_beast', 'Glitch Beast'))),
      ),
      el(
        'div',
        { class: 'admin-col' },
        section('Quests', state, btn('Refresh', () => op('status'), 'btn chip')),
        section('Glitched Structure', el('div', { class: 'muted small' }, 'Stand in the Error Biome chunk. Stages started or cleared here are cheats.'), el('div', { class: 'admin-chips' }, btn('Start next stage', () => op('glitch_start'), 'btn chip'), btn('Clear stage', () => op('glitch_clear'), 'btn chip'), btn('Reset structure', () => op('glitch_reset'), 'btn chip'))),
        section('Give', el('div', { class: 'admin-chips' }, btn('Glitched reward roll', () => op('glitch_reward'), 'btn chip'), give('glitched_pickaxe', 'Glitched Pickaxe'), give('glitched_chestplate', 'Glitched Chestplate'), give('bunker_keycard', 'Bunker Keycard'))),
        section('Bunker', btn('Reset this bunker', () => op('bunker_reset'), 'btn chip')),
        section(
          'Temple',
          el('div', { class: 'muted small' }, 'Stand inside a temple (Version 4.5 worlds). Trials completed here are cheats; so is a prize won after them.'),
          el('div', { class: 'admin-chips' }, btn('Complete current trial', () => op('temple_advance'), 'btn chip'), btn('Reset temple', () => op('temple_reset'), 'btn chip'), give('temple_relic', 'Temple Relic')),
        ),
        section('Fluids', el('div', { class: 'muted small' }, 'Builds a glass tank beside you where water meets lava sources and flowing lava.'), btn('Build fluid test rig', () => op('fluid_rig'), 'btn chip')),
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
    const view = t === 'items' ? renderItems() : t === 'mobs' ? renderMobs() : t === 'teleport' ? renderTeleport() : t === 'player' ? renderPlayer() : t === 'world' ? renderWorld() : t === 'endgame' ? renderEndgame() : t === 'v4' ? renderV4() : t === 'v5' ? renderV5() : t === 'v55' ? renderV55() : t === 'v6' ? renderV6() : renderPerf();
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
