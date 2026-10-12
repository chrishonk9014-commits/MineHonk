/**
 * Engineering block state. Every engineering block with state keeps it in its
 * block entity `{ type: 'eng', ... }`, saved with its chunk: energy, items
 * (the same `items` array containers use, so breaking it spills them), fluid,
 * progress and configuration. Nothing about a machine lives anywhere else,
 * so a save can neither duplicate nor lose what a machine holds.
 */
import type { SavedStack } from '../../common/game/itemstack';
import { COMPONENT_BY_ID, UPGRADES, type ComponentDef, type SlotLayout, type UpgradeId } from '../../common/engineering/catalog';

export type FluidId = 'water' | 'lava';

export interface EngConfig {
  /** Signal mode: ignore signals, run only while powered, or only while unpowered. */
  signal?: 'ignore' | 'on' | 'off';
  /** Switched off by a control panel. */
  enabled?: boolean;
  /** Timers: ticks between pulses. */
  period?: number;
  /** Level sensors: 'level' (proportional), 'above' or 'below' the threshold. */
  mode?: string;
  /** Level sensors: threshold percentage. */
  threshold?: number;
  /** Filters, extractors, sorters: whitelist (true) or blacklist. */
  whitelist?: boolean;
  /** Monitors: which page they show. */
  page?: number;
  /** Fluid filters: the fluid they pass. */
  fluid?: FluidId;
  /** Machines: push results out of their back (default on). */
  eject?: boolean;
}

export interface EngBE {
  type: 'eng';
  /** Component id (sanity: the block it belongs to). */
  id: string;
  energy?: number;
  /** Inventory slots in layout order: inputs, outputs, fuel, tool, upgrades. */
  items?: (SavedStack | null)[];
  /** Ghost (filter / target) slots. */
  ghost?: (SavedStack | null)[];
  fluid?: { id: FluidId | null; amount: number };
  /** Ticks of work done on the current operation (per lane for multi-lane machines). */
  progress?: number;
  lanes?: number[];
  burn?: number;
  burnTotal?: number;
  /** Last status code (shown in windows, monitors and control panels). */
  status?: string;
  cfg?: EngConfig;
  /** Uuid of the player who placed it (advancements are credited to them). */
  by?: string;
  /** Storage barrel contents. */
  stored?: { item: SavedStack | null; count: number };
  /** Drill and quarry: next block to dig (world position). */
  cursor?: [number, number, number];
  /** Ore scanner results. */
  scan?: { ore: string; count: number; nearest: [number, number, number] }[];
  scanAt?: number;
  /** Multiblock controllers: whether the structure is complete, and what is missing. */
  formed?: boolean;
  missing?: string;
  /** Timer phase. */
  phase?: number;
  [k: string]: unknown;
}

export function compOf(id: string): ComponentDef | undefined {
  return COMPONENT_BY_ID.get(id);
}

/** Slot index ranges of a layout. */
export interface Ranges {
  input: [number, number];
  output: [number, number];
  fuel: [number, number];
  tool: [number, number];
  upgrades: [number, number];
  size: number;
}

const rangeCache = new Map<string, Ranges>();

export function rangesOf(c: ComponentDef): Ranges {
  let r = rangeCache.get(c.id);
  if (r) return r;
  const s: SlotLayout = c.slots ?? {};
  let i = 0;
  const take = (n = 0): [number, number] => {
    const a = i;
    i += n;
    return [a, i];
  };
  r = { input: take(s.input), output: take(s.output), fuel: take(s.fuel), tool: take(s.tool), upgrades: take(s.upgrades), size: 0 };
  r.size = i;
  rangeCache.set(c.id, r);
  return r;
}

export function newBE(c: ComponentDef): EngBE {
  const be: EngBE = { type: 'eng', id: c.id };
  if (c.energy) be.energy = 0;
  const size = rangesOf(c).size;
  if (size) be.items = new Array(size).fill(null);
  if (c.slots?.ghost) be.ghost = new Array(c.slots.ghost).fill(null);
  if (c.fluid) be.fluid = { id: null, amount: 0 };
  if (c.signal) be.cfg = { signal: 'ignore' };
  if (c.id === 'timer') be.cfg = { period: 40 };
  if (c.id === 'level_sensor') be.cfg = { mode: 'level', threshold: 50 };
  if (c.kind === 'item_filter' || c.kind === 'extractor' || c.kind === 'sorter') be.cfg = { ...(be.cfg ?? {}), whitelist: true };
  if (c.kind === 'monitor') be.cfg = { page: 0 };
  if (c.kind === 'storage' && c.id === 'storage_barrel') be.stored = { item: null, count: 0 };
  return be;
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------
export interface UpgradeEffect {
  /** Work done per tick (1 = base). */
  speed: number;
  /** Energy per tick multiplier. */
  power: number;
  /** Buffers (energy, fluid) multiplier. */
  capacity: number;
  /** Extra radius for area machines. */
  range: number;
}

/** Combined effect of the upgrades in a machine (four slots at most). */
export function upgradeEffect(counts: Partial<Record<UpgradeId, number>>): UpgradeEffect {
  const n = (u: UpgradeId): number => Math.max(0, Math.min(4, counts[u] ?? 0));
  const speed = Math.pow(1.6, n('speed_upgrade'));
  const power = Math.pow(2, n('speed_upgrade')) * Math.pow(0.7, n('efficiency_upgrade'));
  return { speed, power, capacity: Math.pow(4, n('capacity_upgrade')), range: 2 * n('range_upgrade') };
}

export function isUpgrade(id: string): id is UpgradeId {
  return (UPGRADES as readonly string[]).includes(id);
}
