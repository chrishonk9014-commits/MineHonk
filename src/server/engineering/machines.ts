/**
 * Machines: generators, processing machines, multiblock controllers and the
 * automation machines (mining drill, quarry, ore scanner, farming).
 *
 * A machine's state is what's in its block entity; each step it checks
 * whether it may run (switched on, signal mode), what it would make, whether
 * there is room for the result and energy for the work, and then works or
 * says why it can't: idle, no input, no power, output full, disabled or an
 * error (a missing pickaxe, an incomplete multiblock, no water...).
 */
import type { Dimension } from '../world/Dimension';
import { Mob } from '../entity/Mob';
import { ItemEntity } from '../entity/ItemEntity';
import { blocks, STATE_BLOCK, STATE_FLUID, getProp, withProp, stateOf } from '../../common/registry/blocks';
import { items, itemById } from '../../common/registry/items';
import { type ItemStack, type Slot, cloneStack, isAdminStack, markAdmin, canStack, maxStack } from '../../common/game/itemstack';
import { fuelTicks, smeltingFor, recipes, engRecipes, type CompiledRecipe } from '../../common/game/crafting';
import { computeBlockDrops } from '../../common/game/drops';
import { Random } from '../../common/math/rng';
import { CRAFTING } from '../../common/data/recipes';
import { MACHINE_RECIPES, MULTIBLOCKS, RECYCLABLE, ENG_CRAFTING, COMPONENT_BY_ID, type ComponentDef, type MachineRecipe } from '../../common/engineering/catalog';
import { FACE_DX, FACE_DZ } from '../../common/world/constants';
import type { Inventory } from '../player/Inventory';
import type { Engineering, EngNode } from './Engineering';
import { rangesOf, type EngBE } from './state';
import { END_STATUS_TEXT } from './end';

const rng = new Random();

/** Status codes (shown in windows, monitors and control panels). */
export const STATUS_TEXT: Record<string, string> = {
  working: 'Working',
  idle: 'Idle',
  no_input: 'Waiting for input',
  no_power: 'No power',
  output_full: 'Output full',
  disabled: 'Switched off',
  no_fuel: 'No fuel',
  no_water: 'No water',
  no_lava: 'No lava',
  full: 'Energy full',
  no_wind: 'No wind here',
  no_sun: 'No sunlight',
  no_water_near: 'No water to turn it',
  no_tool: 'Needs a pickaxe',
  incomplete: 'Structure incomplete',
  finished: 'Finished digging',
  no_recipe: 'Nothing it can make from that',
  no_target: 'Put the item to make in its target slot',
  scanning: 'Scanning',
  ...END_STATUS_TEXT,
};

const ERROR_STATES = new Set(['no_power', 'output_full', 'incomplete', 'no_tool', 'no_water', 'no_lava', 'no_recipe', 'no_void', 'no_stone', 'no_crystal_power', 'blocked']);
const visualOf = (status: string): 'idle' | 'working' | 'error' => (status === 'working' || status === 'scanning' || status === 'charging' ? 'working' : ERROR_STATES.has(status) ? 'error' : 'idle');

type Lookup = Map<number, MachineRecipe>;

export class MachineLogic {
  private readonly lookups = new Map<string, Lookup>();
  /** Crop block state for a seed item number. */
  private seedCrops: Map<number, number> | null = null;

  constructor(private readonly eng: Engineering) {}

  // ------------------------------------------------------------------ recipes

  private lookup(set: string): Lookup {
    let m = this.lookups.get(set);
    if (m) return m;
    m = new Map();
    for (const r of MACHINE_RECIPES[set] ?? []) {
      const it = itemById.get(r.input);
      if (it && !m.has(it.num)) m.set(it.num, r);
    }
    this.lookups.set(set, m);
    return m;
  }

  /** What a machine makes from an input stack (null if nothing). */
  recipeFor(set: string, input: ItemStack): { inCount: number; out: ItemStack[]; bonus?: MachineRecipe['bonus'] } | null {
    if (set === 'electric_furnace') {
      const extra = this.lookup('electric_furnace').get(input.id);
      if (extra) return { inCount: 1, out: [{ id: itemById.get(extra.output)!.num, count: extra.count }] };
      const sm = smeltingFor(input.id);
      return sm ? { inCount: 1, out: [{ id: sm.resultNum, count: 1 }] } : null;
    }
    if (set === 'recycler') return this.recycle(input);
    let r = this.lookup(set).get(input.id);
    if (!r && set === 'advanced_crusher') r = this.lookup('crusher').get(input.id);
    if (!r) return null;
    if (input.count < (r.inCount ?? 1)) return null;
    const count = r.countMax ? r.count + rng.int(r.countMax - r.count + 1) : r.count;
    return { inCount: r.inCount ?? 1, out: [{ id: itemById.get(r.output)!.num, count }], bonus: r.bonus };
  }

  isInput(c: ComponentDef, s: ItemStack): boolean {
    if (!c.machine) return false;
    if (c.machine === 'electric_furnace') return !!smeltingFor(s.id) || this.lookup('electric_furnace').has(s.id);
    return this.lookup(c.machine).has(s.id);
  }

  /** Recycling: half of the recyclable materials of the item's crafting recipe. */
  private recycle(input: ItemStack): { inCount: number; out: ItemStack[] } | null {
    const id = items[input.id]!.id;
    const recipe = [...CRAFTING, ...ENG_CRAFTING].find((r) => r.result === id);
    if (!recipe) return null;
    const counts = new Map<string, number>();
    const ings = recipe.type === 'shaped' ? recipe.pattern.join('').split('').filter((ch) => ch !== ' ').map((ch) => recipe.key[ch]!) : recipe.ingredients;
    for (const ing of ings) if (RECYCLABLE.includes(ing)) counts.set(ing, (counts.get(ing) ?? 0) + 1);
    if (!counts.size) return null;
    const per = recipe.count ?? 1;
    // Worn tools give back less
    const dur = items[input.id]!.def.durability;
    const wear = dur ? Math.max(0, 1 - (input.damage ?? 0) / dur) : 1;
    const out: ItemStack[] = [];
    for (const [ing, n] of counts) {
      const k = Math.floor(((n * 0.5) / per) * wear);
      if (k > 0) out.push({ id: itemById.get(ing)!.num, count: k });
    }
    if (!out.length) {
      // At least the most valuable material once
      const best = [...counts.keys()].sort((a, b) => RECYCLABLE.indexOf(b) - RECYCLABLE.indexOf(a))[0]!;
      if (wear > 0.25) out.push({ id: itemById.get(best)!.num, count: 1 });
    }
    return out.length ? { inCount: 1, out } : null;
  }

  // ------------------------------------------------------------------ helpers

  private inv(n: EngNode): Inventory {
    return this.eng.server.interaction.containers.containerAt(n.dim, n.x, n.y, n.z, rangesOf(n.c).size, 'eng');
  }

  private persist(n: EngNode, inv: Inventory): void {
    this.eng.server.interaction.containers.persist(n.dim, n.x, n.y, n.z, inv);
    this.eng.windows.refreshAt(n.dim, n.x, n.y, n.z);
  }

  /** Room for these stacks in the output slots (cheat items never mix with legit ones). */
  private fits(inv: Inventory, range: [number, number], out: ItemStack[]): boolean {
    const sim: Slot[] = inv.slots.slice(range[0], range[1]).map((s) => (s ? { ...s } : null));
    for (const st of out) {
      let left = st.count;
      for (let i = 0; i < sim.length && left > 0; i++) {
        const cur = sim[i];
        if (cur && canStack(cur, st)) {
          const n = Math.min(maxStack(st) - cur.count, left);
          cur.count += n;
          left -= n;
        }
      }
      for (let i = 0; i < sim.length && left > 0; i++) {
        if (sim[i]) continue;
        const n = Math.min(maxStack(st), left);
        sim[i] = { ...st, count: n };
        left -= n;
      }
      if (left > 0) return false;
    }
    return true;
  }

  private put(inv: Inventory, range: [number, number], st: ItemStack): void {
    let left = st.count;
    for (let i = range[0]; i < range[1] && left > 0; i++) {
      const cur = inv.get(i);
      if (cur && canStack(cur, st)) {
        const n = Math.min(maxStack(st) - cur.count, left);
        if (n > 0) inv.set(i, { ...cur, count: cur.count + n });
        left -= n;
      }
    }
    for (let i = range[0]; i < range[1] && left > 0; i++) {
      if (inv.get(i)) continue;
      const n = Math.min(maxStack(st), left);
      inv.set(i, { ...cloneStack(st), count: n });
      left -= n;
    }
  }

  setStatus(n: EngNode, status: string, detail?: string): void {
    const be = n.be();
    if (!be) return;
    const full = detail ? `${status}:${detail}` : status;
    if (be.status !== full) {
      be.status = full;
      n.dirty = true;
    }
    this.eng.setBlockProp(n, 'status', visualOf(status));
  }

  refreshVisual(n: EngNode): void {
    const be = n.be();
    if (be?.status) this.eng.setBlockProp(n, 'status', visualOf(be.status.split(':')[0]!));
    if (n.c.kind === 'battery') this.batteryVisual(n);
  }

  private batteryVisual(n: EngNode): void {
    const be = n.be();
    if (!be) return;
    const frac = (be.energy ?? 0) / (n.c.energy?.capacity ?? 1);
    const level = frac <= 0.001 ? 0 : Math.min(4, 1 + Math.floor(frac * 4));
    this.eng.setBlockProp(n, 'charge', String(level));
  }

  /** Spends energy for `ticks` of work; false (and the no-power status) if there isn't enough. */
  private spend(n: EngNode, be: EngBE, ticks: number): boolean {
    const use = (n.c.energy?.use ?? 0) * ticks * this.eng.upgrades(n).power;
    if ((be.energy ?? 0) < use) {
      this.setStatus(n, 'no_power');
      return false;
    }
    be.energy = (be.energy ?? 0) - use;
    n.dirty = true;
    return true;
  }

  // ------------------------------------------------------------------ generators

  generate(nodes: EngNode[], N: number): void {
    const s = this.eng.server;
    for (const n of nodes) {
      if (n.removed) continue;
      if (n.c.kind === 'battery') {
        this.batteryVisual(n);
        const b = n.be();
        if (b && (b.energy ?? 0) >= (n.c.energy?.capacity ?? 1) / 2) this.eng.grant(n, 'store_power');
        continue;
      }
      const gen = n.c.energy?.gen;
      if (!gen) continue;
      const be = n.be();
      if (!be) continue;
      n.rate = 0;
      if (!this.eng.allowed(n)) {
        this.setStatus(n, 'disabled');
        continue;
      }
      const cap = this.eng.capacityOf(n);
      const room = cap - (be.energy ?? 0);
      if (room < 1) {
        this.setStatus(n, 'full');
        continue;
      }
      let rate = 0;
      const { dim, x, y, z } = n;
      switch (n.c.id) {
        case 'water_wheel': {
          let water = 0;
          for (let f = 2; f < 6; f++) if (STATE_FLUID[dim.getState(x + FACE_DX[f], y, z + FACE_DZ[f])] === 1) water++;
          if (!water) {
            this.setStatus(n, 'no_water_near');
            continue;
          }
          rate = Math.min(gen, 2 * water);
          break;
        }
        case 'solar_panel': {
          if (!dim.rules.hasSky || dim.getHeight(x, z) > y + 1) {
            this.setStatus(n, 'no_sun');
            continue;
          }
          const t = ((s.level.dayTime % 24000) + 24000) % 24000;
          const sun = t < 12000 ? Math.sin((Math.PI * t) / 12000) : 0;
          rate = gen * Math.min(1, sun * 1.25) * (s.level.raining ? 0.4 : 1);
          if (rate < 0.05) {
            this.setStatus(n, 'no_sun');
            continue;
          }
          break;
        }
        case 'wind_turbine': {
          const h = Math.max(0, Math.min(1, (y - 64) / 64));
          if (h <= 0 || !dim.rules.hasSky) {
            this.setStatus(n, 'no_wind');
            continue;
          }
          const tt = s.tickNo / 20;
          let wind = 0.65 + 0.25 * Math.sin(tt / 60 + x * 0.013) + 0.1 * Math.sin(tt / 13 + z * 0.021);
          if (s.level.thundering) wind += 0.35;
          else if (s.level.raining) wind += 0.15;
          let open = 0;
          for (let f = 2; f < 6; f++) if (dim.getState(x + FACE_DX[f], y, z + FACE_DZ[f]) === 0) open++;
          rate = gen * h * Math.min(1, wind) * (open >= 3 ? 1 : 0.5);
          break;
        }
        case 'steam_generator':
        case 'advanced_generator': {
          const steam = n.c.id === 'steam_generator';
          const fluid = (be.fluid ??= { id: null, amount: 0 });
          if (steam && (fluid.id !== 'water' || fluid.amount < 5 * N)) {
            this.setStatus(n, 'no_water');
            continue;
          }
          if ((be.burn ?? 0) <= 0) {
            const inv = this.inv(n);
            const r = rangesOf(n.c);
            const fuel = inv.get(r.fuel[0]);
            const ft = fuelTicks(fuel);
            if (!fuel || ft <= 0) {
              this.setStatus(n, 'no_fuel');
              continue;
            }
            if (items[fuel.id]!.id === 'lava_bucket') inv.set(r.fuel[0], { id: itemById.get('bucket')!.num, count: 1 });
            else inv.set(r.fuel[0], fuel.count > 1 ? { ...fuel, count: fuel.count - 1 } : null);
            if (isAdminStack(fuel)) be.cheat = 1;
            be.burn = be.burnTotal = ft;
            this.persist(n, inv);
          }
          be.burn = Math.max(0, (be.burn ?? 0) - N * (steam ? 1 : 2));
          if (steam) fluid.amount -= 5 * N;
          if (fluid.amount <= 0) fluid.id = steam ? fluid.id : null;
          rate = gen;
          break;
        }
        case 'large_generator': {
          if (!this.formed(n)) continue;
          const fluid = (be.fluid ??= { id: null, amount: 0 });
          if (fluid.id !== 'lava' || fluid.amount < 2 * N) {
            this.setStatus(n, 'no_lava');
            continue;
          }
          fluid.amount -= 2 * N;
          if (fluid.amount <= 0) fluid.id = null;
          rate = gen;
          break;
        }
        // V6 phase 4: the End generators
        case 'crystal_generator':
        case 'void_collector':
        case 'restored_ancient_core':
        case 'citadel_core': {
          const r = this.eng.end.generate(n, be, N);
          if (r === null) continue;
          rate = r;
          break;
        }
        default:
          continue;
      }
      const made = Math.min(rate * N, room);
      be.energy = (be.energy ?? 0) + made;
      n.rate = made / N;
      n.dirty = true;
      this.setStatus(n, 'working');
      if (made > 0) this.eng.grant(n, 'generate_power');
    }
  }

  // ------------------------------------------------------------------ work

  work(nodes: EngNode[], N: number): void {
    for (const n of nodes) {
      if (n.removed) continue;
      const k = n.c.kind;
      if (k !== 'machine' && k !== 'multiblock') continue;
      if (n.c.energy?.gen) continue;
      if (n.sleep > 0) {
        n.sleep--;
        continue;
      }
      const be = n.be();
      if (!be) continue;
      if (k === 'multiblock' && !this.formed(n)) continue;
      if (!this.eng.allowed(n)) {
        this.setStatus(n, 'disabled');
        continue;
      }
      switch (n.c.machine) {
        // V6 phase 4: End machines with their own logic (engineering/end.ts)
        case 'grower':
        case 'lens':
        case 'pedestal':
        case 'socket':
          break;
        case 'drill':
        case 'quarry':
          this.dig(n, be, N);
          break;
        case 'scanner':
          this.scan(n, be, N);
          break;
        case 'planter':
          this.plant(n, be, N);
          break;
        case 'harvester':
          this.harvest(n, be, N);
          break;
        case 'sprinkler':
          this.sprinkle(n, be, N);
          break;
        case 'collector':
          this.collect(n, be, N);
          break;
        case 'feeder':
          this.feed(n, be, N);
          break;
        case 'assembler':
          this.assemble(n, be, N);
          break;
        default:
          if (n.c.id === 'industrial_furnace') this.processLanes(n, be, N);
          else this.process(n, be, N);
      }
    }
  }

  /** Every operation takes `time` ticks of work, sped up by upgrades. */
  private advance(n: EngNode, be: EngBE, N: number): boolean {
    if (!this.spend(n, be, N)) return false;
    be.progress = (be.progress ?? 0) + N * this.eng.upgrades(n).speed;
    n.dirty = true;
    if (be.progress < (n.c.time ?? 100)) {
      this.setStatus(n, 'working');
      return false;
    }
    be.progress -= n.c.time ?? 100;
    return true;
  }

  private idle(n: EngNode, be: EngBE, status = 'no_input'): void {
    if (be.progress) {
      be.progress = 0;
      n.dirty = true;
    }
    this.setStatus(n, status);
    n.sleep = 3;
  }

  /** One-input processing machines. */
  private process(n: EngNode, be: EngBE, N: number): void {
    const inv = this.inv(n);
    const r = rangesOf(n.c);
    const input = inv.get(r.input[0]);
    if (!input) return this.idle(n, be);
    const recipe = this.recipeFor(n.c.machine!, input);
    if (!recipe) return this.idle(n, be, 'no_recipe');
    const cheat = isAdminStack(input) || !!be.cheat;
    const out = recipe.out.map((o) => (cheat ? markAdmin({ ...o }) : o));
    if (!this.fits(inv, r.output, out)) {
      this.setStatus(n, 'output_full');
      n.sleep = 2;
      return;
    }
    if (!this.advance(n, be, N)) return;
    inv.set(r.input[0], input.count > recipe.inCount ? { ...input, count: input.count - recipe.inCount } : null);
    for (const o of out) this.put(inv, r.output, o);
    if (recipe.bonus && rng.chance(recipe.bonus.chance)) {
      const b: ItemStack = { id: itemById.get(recipe.bonus.item)!.num, count: 1 };
      if (cheat) markAdmin(b);
      if (this.fits(inv, r.output, [b])) this.put(inv, r.output, b);
    }
    this.persist(n, inv);
    this.finished(n, be, cheat);
  }

  /** The industrial furnace: eight lanes side by side. */
  private processLanes(n: EngNode, be: EngBE, N: number): void {
    const inv = this.inv(n);
    const r = rangesOf(n.c);
    const lanes = (be.lanes ??= new Array(r.input[1] - r.input[0]).fill(0));
    // Spread a stack over empty lanes, so one stack still smelts side by side
    let spread = false;
    for (let i = 0; i < lanes.length; i++) {
      if (inv.get(r.input[0] + i)) continue;
      let from = -1;
      for (let j = 0; j < lanes.length; j++) {
        const s = inv.get(r.input[0] + j);
        if (s && s.count >= 2 && (from < 0 || s.count > inv.get(r.input[0] + from)!.count)) from = j;
      }
      if (from < 0) break;
      const s = inv.get(r.input[0] + from)!;
      const half = Math.floor(s.count / 2);
      inv.set(r.input[0] + from, { ...s, count: s.count - half });
      inv.set(r.input[0] + i, { ...s, count: half });
      spread = true;
    }
    if (spread) this.persist(n, inv);
    const work: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      const input = inv.get(r.input[0] + i);
      const recipe = input ? this.recipeFor('electric_furnace', input) : null;
      if (!input || !recipe) {
        lanes[i] = 0;
        continue;
      }
      const out = recipe.out.map((o) => (isAdminStack(input) || be.cheat ? markAdmin({ ...o }) : o));
      if (!this.fits(inv, [r.output[0] + i, r.output[0] + i + 1], out)) continue;
      work.push(i);
    }
    if (!work.length) return this.idle(n, be);
    if (!this.spend(n, be, N)) return;
    const step = N * this.eng.upgrades(n).speed;
    let changed = false;
    for (const i of work) {
      lanes[i] = (lanes[i] ?? 0) + step;
      if (lanes[i]! < (n.c.time ?? 80)) continue;
      lanes[i]! -= n.c.time ?? 80;
      const input = inv.get(r.input[0] + i)!;
      const recipe = this.recipeFor('electric_furnace', input)!;
      inv.set(r.input[0] + i, input.count > 1 ? { ...input, count: input.count - 1 } : null);
      for (const o of recipe.out) this.put(inv, [r.output[0] + i, r.output[0] + i + 1], isAdminStack(input) || be.cheat ? markAdmin({ ...o }) : o);
      changed = true;
      this.finished(n, be, isAdminStack(input) || !!be.cheat);
    }
    n.dirty = true;
    if (changed) this.persist(n, inv);
    this.setStatus(n, 'working');
  }

  /** The assembler: crafts its target item from whatever its inputs hold. */
  private assemble(n: EngNode, be: EngBE, N: number): void {
    const target = be.ghost?.[0];
    if (!target) return this.idle(n, be, 'no_target');
    const tnum = itemById.get(target.id)?.num;
    // Crafting table recipes only: engineering is made at the Engineering Crafting Table
    const recipe: CompiledRecipe | undefined = recipes().find((r) => r.result === tnum);
    if (!recipe || engRecipes().some((e) => e.result === tnum)) return this.idle(n, be, 'no_recipe');
    const inv = this.inv(n);
    const r = rangesOf(n.c);
    const plan = this.planCraft(inv, r.input, recipe);
    if (!plan) return this.idle(n, be);
    const cheat = !!be.cheat || plan.some((i) => isAdminStack(inv.get(i)));
    const out: ItemStack = { id: recipe.result, count: recipe.count };
    if (cheat) markAdmin(out);
    if (!this.fits(inv, r.output, [out])) {
      this.setStatus(n, 'output_full');
      n.sleep = 2;
      return;
    }
    if (!this.advance(n, be, N)) return;
    for (const i of plan) {
      const s = inv.get(i)!;
      inv.set(i, s.count > 1 ? { ...s, count: s.count - 1 } : null);
    }
    this.put(inv, r.output, out);
    this.persist(n, inv);
    this.finished(n, be, cheat);
  }

  /** Slots to take one item each from for a recipe's ingredients (null if they aren't all there). */
  private planCraft(inv: Inventory, range: [number, number], recipe: CompiledRecipe): number[] | null {
    const left = new Map<number, number>();
    for (let i = range[0]; i < range[1]; i++) {
      const s = inv.get(i);
      if (s && !s.damage) left.set(i, s.count);
    }
    const plan: number[] = [];
    for (const cell of recipe.cells) {
      if (!cell) continue;
      let found = -1;
      for (const [i, c] of left) {
        if (c > 0 && cell.has(inv.get(i)!.id)) {
          found = i;
          break;
        }
      }
      if (found < 0) return null;
      left.set(found, left.get(found)! - 1);
      plan.push(found);
    }
    return plan;
  }

  private finished(n: EngNode, be: EngBE, cheat: boolean): void {
    const s = this.eng.server;
    if (s.tickNo % 2 === 0) s.playSound(n.dim, 'machine.done', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.35, 0.9 + rng.next() * 0.2);
    if (cheat || be.cheat) return;
    this.eng.grant(n, 'first_machine');
    if (be.auto) this.eng.grant(n, 'automate_resource');
    if (n.c.tier >= 3) this.eng.grant(n, 'advanced_engineering');
  }

  // ------------------------------------------------------------------ multiblocks

  /** Whether a multiblock controller's structure is complete (checked every couple of seconds). */
  formed(n: EngNode): boolean {
    const be = n.be();
    if (!be) return false;
    const s = this.eng.server;
    const check = be.formed === undefined || (s.tickNo + n.x * 7 + n.z * 13) % 40 < 4;
    if (check) {
      const missing = this.missingPart(n);
      const formed = missing === null;
      if (formed !== be.formed || be.missing !== (missing ?? undefined)) {
        be.formed = formed;
        if (missing) be.missing = missing;
        else delete be.missing;
        n.dirty = true;
        if (formed) this.eng.grant(n, 'build_multiblock');
      }
    }
    if (!be.formed) this.setStatus(n, 'incomplete', be.missing);
    return !!be.formed;
  }

  /** The first block missing from a controller's pattern ("machine casing at x, y, z"), or null. */
  missingPart(n: EngNode): string | null {
    const pat = MULTIBLOCKS[n.c.id];
    if (!pat) return null;
    const facing = getProp(n.dim.getState(n.x, n.y, n.z), 'facing') ?? 'north';
    const [fx, fz] = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[facing as 'north']!;
    // Local x runs to the right of the front, z away from it
    const bx = -fx;
    const bz = -fz;
    const rx = -fz;
    const rz = fx;
    for (const p of pat.parts) {
      const [lx, ly, lz] = p.at;
      const x = n.x + lx * rx + lz * bx;
      const y = n.y + ly;
      const z = n.z + lx * rz + lz * bz;
      if (!n.dim.isLoaded(x, z)) return 'part of it is not loaded';
      const id = blocks[STATE_BLOCK[n.dim.getState(x, y, z)]!]!.id;
      const ok = [p.block].flat();
      if (!ok.includes(id)) {
        const want = ok[0] === 'air' ? 'an empty space' : blocks[STATE_BLOCK[stateOf(ok[0]!)]!]!.def.name;
        return `${want} at ${x}, ${y}, ${z}`;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ automation

  /** Mining drill and quarry: dig the area below, one block per operation. */
  private dig(n: EngNode, be: EngBE, N: number): void {
    const inv = this.inv(n);
    const r = rangesOf(n.c);
    const tool = inv.get(r.tool[0]);
    const tdef = tool ? items[tool.id]!.def.tool : undefined;
    if (!tool || tdef?.type !== 'pickaxe') return this.idle(n, be, 'no_tool');
    const radius = (n.c.area ?? 1) + this.eng.upgrades(n).range;
    const target = this.nextDig(n, be, radius, tdef.tier);
    if (!target) return this.idle(n, be, 'finished');
    const [x, y, z] = target;
    const state = n.dim.getState(x, y, z);
    const drops = computeBlockDrops(state, tool, rng).items;
    const cheat = isAdminStack(tool) || !!be.cheat;
    if (cheat) for (const d of drops) markAdmin(d);
    if (!this.fits(inv, r.output, drops)) {
      this.setStatus(n, 'output_full');
      n.sleep = 2;
      return;
    }
    if (!this.advance(n, be, N)) return;
    n.dim.setBlock(x, y, z, 0);
    this.eng.server.particles(n.dim, 'block', x + 0.5, y + 0.5, z + 0.5, 8, 0.4, state);
    for (const d of drops) this.put(inv, r.output, d);
    // The pickaxe wears down
    const dmg = (tool.damage ?? 0) + 1;
    const max = items[tool.id]!.def.durability ?? 0;
    if (max && dmg >= max) {
      inv.set(r.tool[0], null);
      this.eng.server.playSound(n.dim, 'item.break', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.8, 1);
    } else inv.set(r.tool[0], { ...tool, damage: dmg });
    be.cursor = [x, y, z];
    this.persist(n, inv);
    this.finished(n, be, cheat);
    if (!cheat) this.eng.grant(n, 'automate_resource');
  }

  /** The next block the drill can dig: row by row, layer by layer down from just below it. */
  private nextDig(n: EngNode, be: EngBE, radius: number, tier: number): [number, number, number] | null {
    const x0 = n.x - radius;
    const z0 = n.z - radius;
    const w = radius * 2 + 1;
    let [cx, cy, cz] = be.cursor ?? [x0, n.y - 1, z0];
    if (cy >= n.y) cy = n.y - 1;
    let tries = 0;
    for (; cy >= 1 && tries < 4096; ) {
      tries++;
      if (cx < x0 || cx >= x0 + w || cz < z0 || cz >= z0 + w) {
        cx = x0;
        cz = z0;
      }
      if (!n.dim.isLoaded(cx, cz)) return null;
      const s = n.dim.getState(cx, cy, cz);
      const def = blocks[STATE_BLOCK[s]!]!.def;
      const minable = s !== 0 && !STATE_FLUID[s] && def.hardness >= 0 && !def.entity && !COMPONENT_BY_ID.has(def.id) && (def.harvestLevel ?? 0) <= tier + 1 && def.model !== 'liquid';
      if (minable) {
        be.cursor = [cx, cy, cz];
        return [cx, cy, cz];
      }
      cx++;
      if (cx >= x0 + w) {
        cx = x0;
        cz++;
        if (cz >= z0 + w) {
          cz = z0;
          cy--;
        }
      }
    }
    be.cursor = [cx, cy, cz];
    n.dirty = true;
    return null;
  }

  /** Ore scanner: a sweep every ten seconds while it runs. */
  private scan(n: EngNode, be: EngBE, N: number): void {
    if (!this.advance(n, be, N)) return;
    const radius = (n.c.area ?? 16) + this.eng.upgrades(n).range;
    const found = new Map<string, { count: number; nearest: [number, number, number]; d: number }>();
    for (let dy = -radius; dy <= radius; dy++) {
      const y = n.y + dy;
      if (y < 0 || y > 255) continue;
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++) {
          const x = n.x + dx;
          const z = n.z + dz;
          if (!n.dim.isLoaded(x, z)) continue;
          const id = blocks[STATE_BLOCK[n.dim.getState(x, y, z)]!]!.id;
          if (!id.endsWith('_ore') && id !== 'ancient_debris') continue;
          const ore = id.replace(/^deepslate_/, '').replace(/^nether_/, '');
          const d = dx * dx + dy * dy + dz * dz;
          const f = found.get(ore);
          if (!f) found.set(ore, { count: 1, nearest: [x, y, z], d });
          else {
            f.count++;
            if (d < f.d) {
              f.d = d;
              f.nearest = [x, y, z];
            }
          }
        }
    }
    be.scan = [...found.entries()].sort((a, b) => b[1].count - a[1].count).map(([ore, f]) => ({ ore, count: f.count, nearest: f.nearest }));
    be.scanAt = this.eng.server.tickNo;
    n.dirty = true;
    this.setStatus(n, 'working');
    this.eng.windows.refreshAt(n.dim, n.x, n.y, n.z);
  }

  /** Farmland and crop positions around a farming machine (it sits level with the farmland). */
  private *field(n: EngNode): Generator<[number, number, number]> {
    const r = (n.c.area ?? 2) + this.eng.upgrades(n).range;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx || dz) yield [n.x + dx, n.y, n.z + dz];
  }

  private cropFor(seedNum: number): number | undefined {
    if (!this.seedCrops) {
      this.seedCrops = new Map();
      for (const bt of blocks) {
        const seed = bt.def.model === 'crop' ? (bt.def.data?.seed as string | undefined) : undefined;
        if (seed && itemById.has(seed) && !this.seedCrops.has(itemById.get(seed)!.num)) this.seedCrops.set(itemById.get(seed)!.num, bt.defaultState);
      }
    }
    return this.seedCrops.get(seedNum);
  }

  private plant(n: EngNode, be: EngBE, N: number): void {
    const inv = this.inv(n);
    const r = rangesOf(n.c);
    let slot = -1;
    for (let i = r.input[0]; i < r.input[1]; i++) {
      const s = inv.get(i);
      if (s && this.cropFor(s.id) !== undefined) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return this.idle(n, be);
    let spot: [number, number, number] | null = null;
    for (const p of this.field(n)) {
      const soil = blocks[STATE_BLOCK[n.dim.getState(p[0], p[1], p[2])]!]!.id;
      if (soil === 'farmland' && n.dim.getState(p[0], p[1] + 1, p[2]) === 0) {
        spot = p;
        break;
      }
    }
    if (!spot) return this.idle(n, be, 'idle');
    if (!this.advance(n, be, N)) return;
    const seed = inv.get(slot)!;
    n.dim.setBlock(spot[0], spot[1] + 1, spot[2], this.cropFor(seed.id)!);
    inv.set(slot, seed.count > 1 ? { ...seed, count: seed.count - 1 } : null);
    this.persist(n, inv);
    this.finished(n, be, isAdminStack(seed));
  }

  private harvest(n: EngNode, be: EngBE, N: number): void {
    const inv = this.inv(n);
    const r = rangesOf(n.c);
    let spot: [number, number, number] | null = null;
    let state = 0;
    for (const p of this.field(n)) {
      const s = n.dim.getState(p[0], p[1] + 1, p[2]);
      const def = blocks[STATE_BLOCK[s]!]!.def;
      if (def.model !== 'crop') continue;
      const max = (def.data?.maxAge as number) ?? 7;
      if (parseInt(getProp(s, 'age') ?? '0', 10) >= max && !def.data?.fruit) {
        spot = p;
        state = s;
        break;
      }
    }
    if (!spot) return this.idle(n, be, 'idle');
    const def = blocks[STATE_BLOCK[state]!]!.def;
    const drops = computeBlockDrops(state, null, rng).items;
    // Keep one seed back to replant
    const seedId = itemById.get(def.data?.seed as string)?.num;
    const si = drops.findIndex((d) => d.id === seedId);
    const replant = si >= 0;
    if (replant) {
      drops[si] = { ...drops[si]!, count: drops[si]!.count - 1 };
      if (drops[si]!.count <= 0) drops.splice(si, 1);
    }
    if (!this.fits(inv, r.output, drops)) {
      this.setStatus(n, 'output_full');
      n.sleep = 2;
      return;
    }
    if (!this.advance(n, be, N)) return;
    n.dim.setBlock(spot[0], spot[1] + 1, spot[2], replant ? withProp(state, 'age', '0') : 0);
    for (const d of drops) this.put(inv, r.output, d);
    this.persist(n, inv);
    this.finished(n, be, false);
    this.eng.grant(n, 'automate_resource');
  }

  private sprinkle(n: EngNode, be: EngBE, N: number): void {
    const fluid = be.fluid;
    if (!fluid || fluid.id !== 'water' || fluid.amount < N) return this.idle(n, be, 'no_water');
    if (!this.advance(n, be, N)) {
      fluid.amount -= N;
      return;
    }
    fluid.amount -= N;
    const s = this.eng.server;
    let grew = 0;
    for (const p of this.field(n)) {
      const soil = n.dim.getState(p[0], p[1], p[2]);
      if (blocks[STATE_BLOCK[soil]!]!.id === 'farmland' && getProp(soil, 'moisture') !== '7') n.dim.setBlock(p[0], p[1], p[2], withProp(soil, 'moisture', '7'), { updateNeighbors: false });
      const crop = n.dim.getState(p[0], p[1] + 1, p[2]);
      const def = blocks[STATE_BLOCK[crop]!]!.def;
      if (def.model === 'crop' && grew < 3 && rng.chance(0.25)) {
        const age = parseInt(getProp(crop, 'age') ?? '0', 10);
        if (age < ((def.data?.maxAge as number) ?? 7)) {
          n.dim.setBlock(p[0], p[1] + 1, p[2], withProp(crop, 'age', String(age + 1)), { updateNeighbors: false });
          grew++;
        }
      }
    }
    s.particles(n.dim, 'splash', n.x + 0.5, n.y + 1.2, n.z + 0.5, 12, 1.5);
    this.setStatus(n, 'working');
  }

  private collect(n: EngNode, be: EngBE, N: number): void {
    const inv = this.inv(n);
    const r = rangesOf(n.c);
    const radius = (n.c.area ?? 3) + this.eng.upgrades(n).range;
    let took = false;
    let full = false;
    for (const e of n.dim.entitiesNear(n.x + 0.5, n.y + 0.5, n.z + 0.5, radius + 1)) {
      if (!(e instanceof ItemEntity) || e.removed || e.pickupDelay > 8) continue;
      if (Math.abs(e.x - n.x - 0.5) > radius + 0.5 || Math.abs(e.z - n.z - 0.5) > radius + 0.5 || Math.abs(e.y - n.y) > radius + 1) continue;
      if (!this.spend(n, be, N)) return;
      const before = e.stack.count;
      const fit = this.fitCount(inv, r.output, e.stack);
      if (fit <= 0) {
        full = true;
        continue;
      }
      this.put(inv, r.output, { ...e.stack, count: fit });
      if (fit >= before) e.remove();
      else {
        e.stack.count -= fit;
        e.metaDirty = true;
      }
      took = true;
    }
    if (took) {
      this.persist(n, inv);
      this.setStatus(n, 'working');
    } else this.setStatus(n, full ? 'output_full' : 'idle');
  }

  private fitCount(inv: Inventory, range: [number, number], st: ItemStack): number {
    let room = 0;
    for (let i = range[0]; i < range[1]; i++) {
      const cur = inv.get(i);
      if (!cur) room += maxStack(st);
      else if (canStack(cur, st)) room += maxStack(st) - cur.count;
    }
    return Math.min(room, st.count);
  }

  private feed(n: EngNode, be: EngBE, N: number): void {
    if (!this.advance(n, be, N)) return;
    const inv = this.inv(n);
    const r = rangesOf(n.c);
    const radius = (n.c.area ?? 4) + this.eng.upgrades(n).range;
    const animals = n.dim.entitiesNear(n.x + 0.5, n.y + 0.5, n.z + 0.5, radius + 1).filter((e): e is Mob => e instanceof Mob && !e.removed && !e.dead && !!e.def.breedItems?.length);
    const byType = new Map<string, Mob[]>();
    for (const m of animals) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
    let fed = 0;
    for (const [, list] of byType) {
      if (list.length >= 16) continue;
      const ready = list.filter((m) => !m.baby && m.breedCooldown <= 0 && m.loveTicks <= 0);
      if (ready.length < 2) continue;
      const food = (m: Mob): number => {
        for (let i = r.input[0]; i < r.input[1]; i++) {
          const s = inv.get(i);
          if (s && m.def.breedItems!.includes(items[s.id]!.id)) return i;
        }
        return -1;
      };
      for (const m of ready.slice(0, 2)) {
        const i = food(m);
        if (i < 0) break;
        const s = inv.get(i)!;
        inv.set(i, s.count > 1 ? { ...s, count: s.count - 1 } : null);
        m.loveTicks = 600;
        if (isAdminStack(s) || be.cheat) m.data.cheatLove = true;
        fed++;
      }
    }
    if (fed) {
      this.persist(n, inv);
      this.finished(n, be, !!be.cheat);
    } else this.setStatus(n, 'idle');
  }
}

export type { Dimension };
