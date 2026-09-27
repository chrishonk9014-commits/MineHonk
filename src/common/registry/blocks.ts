/**
 * Block registry.
 *
 * Every block declares a set of state properties. Every combination of
 * property values receives a globally unique 16-bit *state id*; chunk data
 * stores state ids. Frequently used per-state attributes are baked into flat
 * typed arrays so hot paths (meshing, physics, lighting) never touch objects.
 */
import type { BlockDef, PropDefs, PropValue, RenderLayer } from './blockTypes';
import { BLOCK_DEFS } from '../data/blocks';

export interface BlockType {
  /** Numeric block id (registration order). */
  readonly num: number;
  readonly id: string;
  readonly def: BlockDef;
  /** First state id owned by this block. */
  readonly baseState: number;
  readonly stateCount: number;
  readonly defaultState: number;
  readonly propNames: readonly string[];
  readonly propValues: readonly (readonly PropValue[])[];
  /** Mixed radix strides for property encoding. */
  readonly propStrides: readonly number[];
  readonly tags: ReadonlySet<string>;
}

const MAX_STATES = 65536;

export const blocks: BlockType[] = [];
export const blockById = new Map<string, BlockType>();

// Per-state tables (filled in init).
export let STATE_BLOCK = new Uint16Array(0);
/** Full opaque cube: occludes neighbour faces and blocks all light. */
export let STATE_OPAQUE = new Uint8Array(0);
/** Participates in entity collision. */
export let STATE_SOLID = new Uint8Array(0);
export let STATE_LIGHT = new Uint8Array(0);
export let STATE_OPACITY = new Uint8Array(0);
/** 0 invisible 1 opaque 2 cutout 3 translucent */
export let STATE_LAYER = new Uint8Array(0);
export let STATE_REPLACEABLE = new Uint8Array(0);
/** 0 none, 1 water, 2 lava */
export let STATE_FLUID = new Uint8Array(0);
/** Full solid cube for collision fast path. */
export let STATE_FULL_CUBE = new Uint8Array(0);
let stateTotal = 0;

export const LAYER_INDEX: Record<RenderLayer, number> = {
  invisible: 0,
  opaque: 1,
  cutout: 2,
  translucent: 3,
};

function defaultLayer(def: BlockDef): RenderLayer {
  if (def.layer) return def.layer;
  switch (def.model) {
    case 'none':
      return 'invisible';
    case 'liquid':
    case 'portal':
      return 'translucent';
    case 'cube':
    case 'column':
      return 'opaque';
    default:
      return 'cutout';
  }
}

const NON_COLLIDING_MODELS = new Set([
  'none',
  'cross',
  'crop',
  'liquid',
  'torch',
  'wall_torch',
  'portal',
  'end_portal',
  'sign',
  'wall_sign',
  'vine',
  'double_plant',
  'fire',
  'button',
  'pressure_plate',
  'lever',
  'hanging_plant',
]);

export function blockCollides(def: BlockDef): boolean {
  if (def.collide !== undefined) return def.collide;
  return !NON_COLLIDING_MODELS.has(def.model);
}

function isFullCubeModel(def: BlockDef): boolean {
  return def.model === 'cube' || def.model === 'column' || def.model === 'mushroom_block';
}

let initialised = false;

export function initBlocks(): void {
  if (initialised) return;
  initialised = true;
  let next = 0;
  const pending: { def: BlockDef; base: number; count: number; names: string[]; values: PropValue[][]; strides: number[] }[] = [];
  for (const def of BLOCK_DEFS) {
    if (blockById.has(def.id)) throw new Error(`Duplicate block id ${def.id}`);
    const props: PropDefs = def.props ?? {};
    const names = Object.keys(props);
    const values = names.map((n) => [...props[n]!]);
    const strides: number[] = [];
    let count = 1;
    for (let i = names.length - 1; i >= 0; i--) {
      strides[i] = count;
      count *= values[i]!.length;
    }
    pending.push({ def, base: next, count, names, values, strides });
    next += count;
    if (next > MAX_STATES) throw new Error('Too many block states');
    const bt: BlockType = {
      num: blocks.length,
      id: def.id,
      def,
      baseState: pending[pending.length - 1]!.base,
      stateCount: count,
      defaultState: 0,
      propNames: names,
      propValues: values,
      propStrides: strides,
      tags: new Set(def.tags ?? []),
    };
    blocks.push(bt);
    blockById.set(def.id, bt);
  }
  stateTotal = next;
  STATE_BLOCK = new Uint16Array(next);
  STATE_OPAQUE = new Uint8Array(next);
  STATE_SOLID = new Uint8Array(next);
  STATE_LIGHT = new Uint8Array(next);
  STATE_OPACITY = new Uint8Array(next);
  STATE_LAYER = new Uint8Array(next);
  STATE_REPLACEABLE = new Uint8Array(next);
  STATE_FLUID = new Uint8Array(next);
  STATE_FULL_CUBE = new Uint8Array(next);

  for (const bt of blocks) {
    const def = bt.def;
    // default state
    let ds = bt.baseState;
    if (def.defaults) {
      for (const [k, v] of Object.entries(def.defaults)) {
        const pi = bt.propNames.indexOf(k);
        if (pi < 0) throw new Error(`Block ${def.id}: default for unknown prop ${k}`);
        const vi = bt.propValues[pi]!.indexOf(v);
        if (vi < 0) throw new Error(`Block ${def.id}: bad default ${k}=${v}`);
        ds += vi * bt.propStrides[pi]!;
      }
    }
    (bt as { defaultState: number }).defaultState = ds;
    const layer = LAYER_INDEX[defaultLayer(def)];
    const collides = blockCollides(def);
    const fullCube = isFullCubeModel(def);
    const opaque = fullCube && layer === LAYER_INDEX.opaque;
    for (let s = bt.baseState; s < bt.baseState + bt.stateCount; s++) {
      STATE_BLOCK[s] = bt.num;
      STATE_OPAQUE[s] = opaque ? 1 : 0;
      STATE_SOLID[s] = collides ? 1 : 0;
      STATE_LIGHT[s] = def.light ?? 0;
      STATE_OPACITY[s] = opaque ? 15 : def.opacity ?? 0;
      STATE_LAYER[s] = layer;
      STATE_REPLACEABLE[s] = def.replaceable ? 1 : 0;
      STATE_FLUID[s] = def.fluid === 'water' ? 1 : def.fluid === 'lava' ? 2 : 0;
      STATE_FULL_CUBE[s] = fullCube && collides ? 1 : 0;
    }
    applyStateOverrides(bt);
  }
}

/** Per-state overrides for blocks whose attributes depend on properties. */
function applyStateOverrides(bt: BlockType): void {
  const def = bt.def;
  if (def.model === 'slab') {
    // double slabs are full opaque cubes
    for (let s = bt.baseState; s < bt.baseState + bt.stateCount; s++) {
      if (getProp(s, 'type') === 'double') {
        STATE_OPAQUE[s] = def.layer === 'translucent' || def.layer === 'cutout' ? 0 : 1;
        STATE_OPACITY[s] = STATE_OPAQUE[s] ? 15 : STATE_OPACITY[s]!;
        STATE_FULL_CUBE[s] = 1;
      }
    }
  }
  if (def.id === 'furnace' || def.id === 'blast_furnace' || def.id === 'smoker') {
    for (let s = bt.baseState; s < bt.baseState + bt.stateCount; s++) {
      STATE_LIGHT[s] = getProp(s, 'lit') === 'true' ? 13 : 0;
    }
  }
  if (def.id === 'redstone_ore' || def.id === 'deepslate_redstone_ore') {
    for (let s = bt.baseState; s < bt.baseState + bt.stateCount; s++) {
      STATE_LIGHT[s] = getProp(s, 'lit') === 'true' ? 9 : 0;
    }
  }
  if (def.id === 'end_portal_frame') {
    for (let s = bt.baseState; s < bt.baseState + bt.stateCount; s++) {
      STATE_LIGHT[s] = getProp(s, 'eye') === 'true' ? 1 : 0;
    }
  }
  if (def.id === 'campfire' || def.id === 'soul_campfire') {
    for (let s = bt.baseState; s < bt.baseState + bt.stateCount; s++) {
      if (getProp(s, 'lit') === 'false') STATE_LIGHT[s] = 0;
    }
  }
  if (def.model === 'door' || def.model === 'trapdoor' || def.model === 'fence_gate') {
    // collision depends on open state; handled by shape code, keep solid flag.
  }
  if (def.fluid) {
    // Flowing liquid only fully opaque to light when source
  }
}

export function stateCount(): number {
  return stateTotal;
}

export function blockOf(state: number): BlockType {
  return blocks[STATE_BLOCK[state]!]!;
}

export function getBlock(id: string): BlockType {
  const b = blockById.get(id);
  if (!b) throw new Error(`Unknown block ${id}`);
  return b;
}

export function hasBlock(id: string): boolean {
  return blockById.has(id);
}

/** Default state id for a block id. */
export function S(id: string): number {
  return getBlock(id).defaultState;
}

export function getProp(state: number, name: string): PropValue | undefined {
  const bt = blocks[STATE_BLOCK[state]!]!;
  const pi = bt.propNames.indexOf(name);
  if (pi < 0) return undefined;
  const local = state - bt.baseState;
  const vi = Math.floor(local / bt.propStrides[pi]!) % bt.propValues[pi]!.length;
  return bt.propValues[pi]![vi];
}

export function getProps(state: number): Record<string, PropValue> {
  const bt = blocks[STATE_BLOCK[state]!]!;
  const out: Record<string, PropValue> = {};
  const local = state - bt.baseState;
  for (let i = 0; i < bt.propNames.length; i++) {
    const vi = Math.floor(local / bt.propStrides[i]!) % bt.propValues[i]!.length;
    out[bt.propNames[i]!] = bt.propValues[i]![vi]!;
  }
  return out;
}

export function hasProp(state: number, name: string): boolean {
  return blocks[STATE_BLOCK[state]!]!.propNames.includes(name);
}

/** Returns a new state id with the property changed (or the same state if the prop doesn't exist). */
export function withProp(state: number, name: string, value: PropValue | number | boolean): number {
  const bt = blocks[STATE_BLOCK[state]!]!;
  const pi = bt.propNames.indexOf(name);
  if (pi < 0) return state;
  const vals = bt.propValues[pi]!;
  const vi = vals.indexOf(String(value));
  if (vi < 0) return state;
  const local = state - bt.baseState;
  const stride = bt.propStrides[pi]!;
  const cur = Math.floor(local / stride) % vals.length;
  return state + (vi - cur) * stride;
}

export function withProps(state: number, props: Record<string, PropValue | number | boolean>): number {
  let s = state;
  for (const [k, v] of Object.entries(props)) s = withProp(s, k, v);
  return s;
}

/** Build a state from block id + props. */
export function stateOf(id: string, props?: Record<string, PropValue | number | boolean>): number {
  const base = getBlock(id).defaultState;
  return props ? withProps(base, props) : base;
}

export function isBlock(state: number, id: string): boolean {
  return blocks[STATE_BLOCK[state]!]!.id === id;
}

export function blockHasTag(state: number, tag: string): boolean {
  return blocks[STATE_BLOCK[state]!]!.tags.has(tag);
}

/** String form "id[k=v,...]" used for debugging and save-format palettes. */
export function stateToString(state: number): string {
  const bt = blocks[STATE_BLOCK[state]!]!;
  if (bt.propNames.length === 0) return bt.id;
  const p = getProps(state);
  return bt.id + '[' + Object.entries(p).map(([k, v]) => `${k}=${v}`).join(',') + ']';
}

/** Parses "id[k=v]" (unknown blocks/props resolve to air / default values). */
export function stateFromString(s: string): number {
  const m = /^([a-z0-9_:]+)(?:\[(.*)\])?$/.exec(s.trim());
  if (!m) return 0;
  const bt = blockById.get(m[1]!);
  if (!bt) return 0;
  let st = bt.defaultState;
  if (m[2]) {
    for (const kv of m[2].split(',')) {
      const [k, v] = kv.split('=');
      if (k && v !== undefined) st = withProp(st, k, v);
    }
  }
  return st;
}

export const AIR = 0;
