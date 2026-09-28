/**
 * Recipe Book data. Every entry is derived from the game's recipe registries
 * (crafting, smelting, stonecutting, smithing, brewing) plus the processes
 * that combine items instead of following fixed recipes (anvil, enchanting).
 * Nothing here lists recipes by hand: anything registered in the recipe data
 * appears automatically.
 */
import { CRAFTING, SMELTING, STONECUTTING, SMITHING, RECIPE_TAGS, EXTRA_FUEL } from '../data/recipes';
import { BREWING, MODIFIERS, POTIONS, POTION_BY_ID } from '../data/potions';
import { items, itemById, initItems, type ItemType } from '../registry/items';
import { recipes } from './crafting';
import type { ItemStack, Slot } from './itemstack';

export type BookStation = 'crafting' | 'furnace' | 'stonecutter' | 'smithing' | 'brewing' | 'anvil' | 'enchanting';
export type BookCategory = 'building' | 'tools' | 'weapons' | 'armor' | 'food' | 'utilities' | 'redstone' | 'brewing' | 'other';

export const BOOK_CATEGORIES: { id: BookCategory; name: string; icon: string }[] = [
  { id: 'building', name: 'Building', icon: 'bricks' },
  { id: 'tools', name: 'Tools', icon: 'iron_pickaxe' },
  { id: 'weapons', name: 'Weapons', icon: 'iron_sword' },
  { id: 'armor', name: 'Armor', icon: 'iron_chestplate' },
  { id: 'food', name: 'Food', icon: 'bread' },
  { id: 'utilities', name: 'Utilities', icon: 'crafting_table' },
  { id: 'redstone', name: 'Redstone & Mechanisms', icon: 'redstone' },
  { id: 'brewing', name: 'Brewing', icon: 'brewing_stand' },
  { id: 'other', name: 'Other', icon: 'stick' },
];

export const STATION_NAMES: Record<string, string> = {
  crafting: 'Crafting Table',
  inventory: 'Inventory',
  furnace: 'Furnace',
  blast_furnace: 'Blast Furnace',
  smoker: 'Smoker',
  stonecutter: 'Stonecutter',
  smithing: 'Smithing Table',
  brewing: 'Brewing Stand',
  anvil: 'Anvil',
  enchanting: 'Enchanting Table',
};

/** One ingredient requirement: any of the listed items (optionally with a potion type). */
export interface Requirement {
  label: string;
  count: number;
  /** Item numbers that satisfy it. */
  options: number[];
  /** Potion type the stack must carry (brewing bases). */
  potion?: string;
  /** Fuel for furnaces and brewing stands (not consumed per item in the same way). */
  fuel?: boolean;
}

export interface BookEntry {
  id: string;
  station: BookStation;
  /** Workstations that accept it (window kinds). */
  stations: string[];
  category: BookCategory;
  result: ItemStack;
  /** Crafting layout (3x3, row-major; null = empty) with the requirement index per cell. */
  grid?: (number | null)[];
  /** Inputs in station order (furnace input, smithing base + addition, brewing base + ingredient). */
  inputs?: number[];
  requirements: Requirement[];
  shapeless?: boolean;
  /** Fits the 2x2 inventory grid. */
  fits2x2?: boolean;
  xp?: number;
  /** Explanation for process entries (anvil, enchanting). */
  note?: string;
  /** Lower-case text used by search. */
  search: string;
}

export type EntryStatus = 'ready' | 'station' | 'missing';

export interface EntryState {
  status: EntryStatus;
  missing: { label: string; need: number; have: number }[];
}

// ------------------------------------------------------------------ categories

const REDSTONE = /(^|_)(redstone|repeater|comparator|piston|observer|dispenser|dropper|hopper|lever|button|pressure_plate|tripwire|daylight|target|note_block|rail|tnt|door|trapdoor|fence_gate|lamp)($|_)/;
const BREWING_ITEMS = new Set(['brewing_stand', 'cauldron', 'glass_bottle', 'blaze_powder', 'fermented_spider_eye', 'glistering_melon_slice', 'magma_cream']);
const TOOL_USES = new Set(['shears', 'flint_and_steel', 'fire_charge', 'fishing_rod', 'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket', 'compass', 'farlands_compass', 'hoe', 'shovel', 'axe', 'bone_meal']);

export function categoryOf(it: ItemType): BookCategory {
  const d = it.def;
  const id = it.id;
  if (d.use === 'potion' || d.use === 'splash_potion' || BREWING_ITEMS.has(id)) return 'brewing';
  if (d.armor || id === 'shield' || id === 'elytra') return 'armor';
  const tt = d.tool?.type as string | undefined;
  if (tt === 'sword' || (!tt && (d.weapon || d.use === 'bow' || d.use === 'crossbow' || d.use === 'trident' || /arrow$/.test(id)))) return 'weapons';
  if (tt) return 'tools';
  if (d.food) return 'food';
  if (REDSTONE.test(id)) return 'redstone';
  if (d.use && TOOL_USES.has(d.use)) return 'tools';
  if (id === 'clock' || id === 'lead' || id === 'spyglass') return 'tools';
  const tab = d.creative;
  if (tab === 'functional' || tab === 'tools') return 'utilities';
  if (tab === 'building' || tab === 'colored' || tab === 'nature' || tab === 'farlands' || d.block) return 'building';
  return 'other';
}

// ------------------------------------------------------------------ building

let cache: BookEntry[] | null = null;

function tagOptions(tag: string): number[] {
  const out = new Set<number>();
  for (const id of RECIPE_TAGS[tag] ?? []) if (itemById.has(id)) out.add(itemById.get(id)!.num);
  for (const it of items) if (it.tags.has(tag)) out.add(it.num);
  return [...out];
}

const TAG_LABELS: Record<string, string> = {
  planks: 'Any Planks',
  wooden_slabs: 'Any Wooden Slab',
  logs: 'Any Log or Wood',
  coals: 'Coal or Charcoal',
  stone_crafting: 'Cobblestone, Cobbled Deepslate or Blackstone',
  soul_fire_base: 'Soul Sand or Soul Soil',
  sand_any: 'Sand or Red Sand',
  mushrooms_any: 'Any Mushroom',
  small_flowers_any: 'Any Small Flower',
};

function ingredient(s: string): { options: number[]; label: string } {
  if (s.startsWith('#')) {
    const tag = s.slice(1);
    const options = tagOptions(tag);
    let label = TAG_LABELS[tag];
    if (!label) {
      const first = options[0] !== undefined ? items[options[0]]!.def.name : tag;
      label = /_logs$/.test(tag) && options.length > 1 ? `Any ${first} or ${items[options[1]!]!.def.name.split(' ').pop()}` : `Any ${tag.replace(/_/g, ' ')}`;
    }
    return { options, label };
  }
  const it = itemById.get(s);
  return { options: it ? [it.num] : [], label: it?.def.name ?? s };
}

function fuelOptions(): number[] {
  const out: number[] = [];
  for (const it of items) if ((it.def.fuel ?? EXTRA_FUEL[it.id] ?? 0) > 0) out.push(it.num);
  return out;
}

function potionName(id: string, splash = false): string {
  const p = POTION_BY_ID.get(id);
  const n = p?.name ?? id;
  const long = id.startsWith('long_') ? ' (Extended)' : id.startsWith('strong_') ? ' II' : '';
  if (splash) return 'Splash ' + n + long;
  return n + long;
}

/** Builds (once) every Recipe Book entry from the registries. */
export function recipeBook(): BookEntry[] {
  if (cache) return cache;
  initItems();
  const out: BookEntry[] = [];
  const name = (num: number): string => items[num]?.def.name ?? '?';
  const searchText = (result: ItemStack, reqs: Requirement[], extra = ''): string => [itemName(result), ...reqs.map((r) => r.label), extra].join(' ').toLowerCase();

  // Crafting: the compiled list only holds recipes whose items all exist
  for (const c of recipes()) {
    const r = CRAFTING[c.index]!;
    const reqs: Requirement[] = [];
    const reqIndex = new Map<string, number>();
    const need = (s: string): number => {
      const k = s;
      let i = reqIndex.get(k);
      if (i === undefined) {
        const g = ingredient(s);
        i = reqs.length;
        reqs.push({ label: g.label, count: 0, options: g.options });
        reqIndex.set(k, i);
      }
      reqs[i]!.count++;
      return i;
    };
    let grid: (number | null)[];
    let fits: boolean;
    if (r.type === 'shaped') {
      const h = r.pattern.length;
      const w = Math.max(...r.pattern.map((p) => p.length));
      grid = new Array(9).fill(null);
      r.pattern.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] !== ' ') grid[y * 3 + x] = need(r.key[row[x]!]!);
      });
      fits = w <= 2 && h <= 2;
    } else {
      grid = new Array(9).fill(null);
      r.ingredients.forEach((s, i) => (grid[i] = need(s)));
      fits = r.ingredients.length <= 4;
    }
    const result: ItemStack = { id: c.result, count: c.count };
    out.push({
      id: `craft:${c.index}`,
      station: 'crafting',
      stations: fits ? ['player', 'crafting'] : ['crafting'],
      category: categoryOf(items[c.result]!),
      result,
      grid,
      requirements: reqs,
      shapeless: r.type === 'shapeless',
      fits2x2: fits,
      search: searchText(result, reqs, fits ? 'inventory crafting table' : 'crafting table'),
    });
  }

  // Smelting (furnace; blast furnace for ores, smoker for food)
  const fuels = fuelOptions();
  SMELTING.forEach((s, i) => {
    const inp = itemById.get(s.input);
    const res = itemById.get(s.result);
    if (!inp || !res) return;
    const stations = s.kind === 'ore' ? ['furnace', 'blast_furnace'] : s.kind === 'food' ? ['furnace', 'smoker'] : ['furnace'];
    const reqs: Requirement[] = [
      { label: inp.def.name, count: 1, options: [inp.num] },
      { label: 'Any Fuel', count: 1, options: fuels, fuel: true },
    ];
    const result: ItemStack = { id: res.num, count: 1 };
    out.push({ id: `smelt:${i}`, station: 'furnace', stations, category: categoryOf(res), result, inputs: [0, 1], requirements: reqs, xp: s.xp, search: searchText(result, reqs, stations.map((x) => STATION_NAMES[x]).join(' ')) });
  });

  // Stonecutting
  STONECUTTING.forEach((s, i) => {
    const inp = itemById.get(s.input);
    const res = itemById.get(s.result);
    if (!inp || !res) return;
    const reqs: Requirement[] = [{ label: inp.def.name, count: 1, options: [inp.num] }];
    const result: ItemStack = { id: res.num, count: s.count };
    out.push({ id: `cut:${i}`, station: 'stonecutter', stations: ['stonecutter'], category: categoryOf(res), result, inputs: [0], requirements: reqs, search: searchText(result, reqs, 'stonecutter') });
  });

  // Smithing
  SMITHING.forEach((s, i) => {
    const b = itemById.get(s.base);
    const a = itemById.get(s.addition);
    const res = itemById.get(s.result);
    if (!b || !a || !res) return;
    const reqs: Requirement[] = [
      { label: b.def.name, count: 1, options: [b.num] },
      { label: a.def.name, count: 1, options: [a.num] },
    ];
    const result: ItemStack = { id: res.num, count: 1 };
    out.push({ id: `smith:${i}`, station: 'smithing', stations: ['smithing'], category: categoryOf(res), result, inputs: [0, 1], requirements: reqs, search: searchText(result, reqs, 'smithing table upgrade') });
  });

  // Brewing: every base potion + ingredient pair the brewing rules accept
  const potionItem = itemById.get('potion');
  const splashItem = itemById.get('splash_potion');
  const blaze = itemById.get('blaze_powder');
  if (potionItem) {
    const pairs: { base: string; ing: string; result: string }[] = [];
    for (const [ing, table] of Object.entries(BREWING)) for (const [base, result] of Object.entries(table)) pairs.push({ base, ing, result });
    for (const [ing, fn] of Object.entries(MODIFIERS)) {
      for (const p of POTIONS) {
        if (p.id.startsWith('long_') || p.id.startsWith('strong_')) continue;
        if (BREWING[ing]?.[p.id]) continue; // direct recipe already listed
        const r = fn(p.id);
        if (r) pairs.push({ base: p.id, ing, result: r });
      }
    }
    for (const { base, ing, result: res } of pairs) {
      const ingIt = itemById.get(ing);
      if (!ingIt || !POTION_BY_ID.has(base) || !POTION_BY_ID.has(res)) continue;
      const reqs: Requirement[] = [
        { label: potionName(base), count: 1, options: [potionItem.num], potion: base },
        { label: ingIt.def.name, count: 1, options: [ingIt.num] },
      ];
      if (blaze) reqs.push({ label: 'Blaze Powder (fuel)', count: 1, options: [blaze.num], fuel: true });
      const result: ItemStack = { id: potionItem.num, count: 1, tag: { potion: res } };
      out.push({ id: `brew:${ing}:${base}`, station: 'brewing', stations: ['brewing'], category: 'brewing', result, inputs: [0, 1], requirements: reqs, search: searchText(result, reqs, 'brewing stand potion') });
    }
    // Gunpowder turns any potion into a splash potion
    const gun = itemById.get('gunpowder');
    if (splashItem && gun) {
      for (const p of POTIONS) {
        const reqs: Requirement[] = [
          { label: potionName(p.id), count: 1, options: [potionItem.num], potion: p.id },
          { label: gun.def.name, count: 1, options: [gun.num] },
        ];
        if (blaze) reqs.push({ label: 'Blaze Powder (fuel)', count: 1, options: [blaze.num], fuel: true });
        const result: ItemStack = { id: splashItem.num, count: 1, tag: { potion: p.id } };
        out.push({ id: `brew:gunpowder:${p.id}`, station: 'brewing', stations: ['brewing'], category: 'brewing', result, inputs: [0, 1], requirements: reqs, search: searchText(result, reqs, 'brewing stand splash potion') });
      }
    }
  }

  // Anvil: repair with the item's material (grouped by material)
  const byMaterial = new Map<string, number[]>();
  for (const it of items) {
    const rep = it.def.repair;
    if (!rep || !it.def.durability) continue;
    const list = byMaterial.get(rep) ?? [];
    list.push(it.num);
    byMaterial.set(rep, list);
  }
  for (const [mat, list] of byMaterial) {
    const g = ingredient(mat.startsWith('#') || itemById.has(mat) ? mat : '#' + mat);
    if (!g.options.length || !list.length) continue;
    const reqs: Requirement[] = [
      { label: `Damaged ${list.length > 1 ? 'item' : name(list[0]!)} (${list.map(name).slice(0, 3).join(', ')}${list.length > 3 ? '...' : ''})`, count: 1, options: list },
      { label: g.label, count: 1, options: g.options },
    ];
    const result: ItemStack = { id: list[0]!, count: 1 };
    out.push({
      id: `anvil:repair:${mat}`,
      station: 'anvil',
      stations: ['anvil'],
      category: categoryOf(items[list[0]!]!),
      result,
      inputs: [0, 1],
      requirements: reqs,
      note: `Repair with ${g.label}: each unit restores a quarter of the item's durability. Costs experience levels.`,
      search: searchText(result, reqs, `anvil repair ${list.map(name).join(' ')}`),
    });
  }
  const book = itemById.get('enchanted_book');
  const sword = itemById.get('iron_sword');
  if (book && sword) {
    const tools = items.filter((it) => (it.def.durability ?? 0) > 0).map((it) => it.num);
    const reqs: Requirement[] = [
      { label: 'Tool, weapon or armor', count: 1, options: tools },
      { label: 'Enchanted Book', count: 1, options: [book.num] },
    ];
    out.push({
      id: 'anvil:combine',
      station: 'anvil',
      stations: ['anvil'],
      category: 'utilities',
      result: { id: sword.num, count: 1, tag: { ench: { sharpness: 1 } } },
      inputs: [0, 1],
      requirements: reqs,
      note: 'Combine an item with an enchanted book (or two of the same item) to merge their enchantments. Rename items here too. Costs experience levels.',
      search: 'anvil combine enchantments enchanted book rename',
    });
  }
  // Enchanting table
  const lapis = itemById.get('lapis_lazuli');
  const pick = itemById.get('iron_pickaxe');
  if (lapis && pick) {
    const enchantable = items.filter((it) => (it.def.enchantability ?? 0) > 0 || it.id === 'book').map((it) => it.num);
    const reqs: Requirement[] = [
      { label: 'Tool, weapon, armor or book', count: 1, options: enchantable },
      { label: lapis.def.name, count: 1, options: [lapis.num] },
    ];
    out.push({
      id: 'enchanting:item',
      station: 'enchanting',
      stations: ['enchanting'],
      category: 'utilities',
      result: { id: pick.num, count: 1, tag: { ench: { efficiency: 1 } } },
      inputs: [0, 1],
      requirements: reqs,
      note: 'Pick one of three offers. Costs 1 to 3 Lapis Lazuli and experience levels; bookshelves around the table unlock stronger offers.',
      search: 'enchanting table enchant lapis lazuli experience',
    });
  }
  cache = out;
  return out;
}

/** Clears the cached book (tests, or after registering new recipes at runtime). */
export function resetRecipeBook(): void {
  cache = null;
}

export function itemName(s: ItemStack): string {
  const it = items[s.id];
  if (!it) return '?';
  if (s.tag?.potion && (it.id === 'potion' || it.id === 'splash_potion')) return potionName(s.tag.potion, it.id === 'splash_potion');
  return it.def.name;
}

// ------------------------------------------------------------------ availability

/** Item counts from a list of slots (by item number; potions also by type). */
export function countItems(slots: Iterable<Slot>): Map<number | string, number> {
  const m = new Map<number | string, number>();
  for (const s of slots) {
    if (!s || s.count <= 0) continue;
    m.set(s.id, (m.get(s.id) ?? 0) + s.count);
    if (s.tag?.potion) {
      const k = `${s.id}:${s.tag.potion}`;
      m.set(k, (m.get(k) ?? 0) + s.count);
    }
  }
  return m;
}

/**
 * Whether the player has the ingredients for an entry, and what is missing.
 * Specific ingredients are reserved first so a shared item is not counted
 * twice. `window` is the open workstation (player inventory = 'player').
 */
export function entryState(e: BookEntry, counts: Map<number | string, number>, window: string): EntryState {
  const left = new Map(counts);
  const missing: EntryState['missing'] = [];
  const order = e.requirements.map((r, i) => i).sort((a, b) => e.requirements[a]!.options.length - e.requirements[b]!.options.length);
  for (const i of order) {
    const r = e.requirements[i]!;
    let need = r.count;
    let have = 0;
    for (const num of r.options) {
      if (need <= 0) break;
      const k = r.potion ? `${num}:${r.potion}` : num;
      const n = left.get(k) ?? 0;
      if (n <= 0) continue;
      const take = Math.min(n, need);
      left.set(k, n - take);
      if (r.potion) left.set(num, (left.get(num) ?? 0) - take);
      need -= take;
      have += take;
    }
    if (need > 0) missing.push({ label: r.label, need: r.count, have });
  }
  if (missing.length) return { status: 'missing', missing };
  return { status: e.stations.includes(window) ? 'ready' : 'station', missing };
}

// ------------------------------------------------------------------ filtering

export interface BookFilter {
  query?: string;
  category?: BookCategory | 'all';
  /** Hide entries whose ingredients are missing. */
  craftableOnly?: boolean;
  states?: Map<string, EntryState>;
}

/** Entries matching a search and category, craftable first, then by name. */
export function filterBook(entries: BookEntry[], f: BookFilter): BookEntry[] {
  const words = (f.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const cat = f.category ?? 'all';
  const states = f.states;
  const rank = (e: BookEntry): number => {
    const s = states?.get(e.id);
    return !s ? 3 : s.status === 'ready' ? 0 : s.status === 'station' ? 1 : 2;
  };
  return entries
    .filter((e) => (cat === 'all' || e.category === cat) && words.every((w) => e.search.includes(w)) && (!f.craftableOnly || (states?.get(e.id)?.status ?? 'missing') !== 'missing'))
    .sort((a, b) => rank(a) - rank(b) || itemName(a.result).localeCompare(itemName(b.result)));
}
