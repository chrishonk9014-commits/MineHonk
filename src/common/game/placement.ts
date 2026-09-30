/**
 * Block placement rules (pure). Given the clicked block/face/hit point and
 * the player's orientation, determines which states to place where.
 * Shared by the server (authoritative) and client (placement preview).
 */
import { blocks, blockById, STATE_BLOCK, STATE_SOLID, STATE_REPLACEABLE, STATE_FLUID, STATE_OPAQUE, STATE_FULL_CUBE, getProp, withProp, blockHasTag, getBlock, hasProp } from '../registry/blocks';
import { FACE_DX, FACE_DY, FACE_DZ, FACE_NAMES, yawToFacing, oppositeHorizontal } from '../world/constants';
import type { BlockDef } from '../registry/blockTypes';

export interface WorldReader {
  getState(x: number, y: number, z: number): number;
}

export interface PlaceRequest {
  blockId: string;
  /** Item wall variant (torch -> wall_torch). */
  wallBlockId?: string;
  x: number;
  y: number;
  z: number;
  face: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  pitch: number;
  sneaking: boolean;
}

export interface Placement {
  x: number;
  y: number;
  z: number;
  state: number;
}

const HORIZ = ['north', 'south', 'west', 'east'];

function isSturdy(w: WorldReader, x: number, y: number, z: number): boolean {
  const s = w.getState(x, y, z);
  if (STATE_FULL_CUBE[s]) return true;
  const m = blocks[STATE_BLOCK[s]!]!.def.model;
  if (m === 'slab' && getProp(s, 'type') !== 'bottom') return true;
  return m === 'stairs' || m === 'farmland' || m === 'path' || m === 'cactus';
}

/** Top face of block at (x,y,z) supports things (torches, signs...). */
function supportsFromBelow(w: WorldReader, x: number, y: number, z: number): boolean {
  const s = w.getState(x, y, z);
  if (STATE_FULL_CUBE[s]) return true;
  const def = blocks[STATE_BLOCK[s]!]!.def;
  switch (def.model) {
    case 'slab':
      return getProp(s, 'type') !== 'bottom';
    case 'stairs':
      return getProp(s, 'half') === 'top';
    case 'fence':
    case 'wall':
    case 'farmland':
    case 'path':
      return true;
    default:
      return false;
  }
}

export function soilOk(def: BlockDef, below: number, w: WorldReader, x: number, y: number, z: number): boolean {
  const bdef = blocks[STATE_BLOCK[below]!]!.def;
  const tags = bdef.tags ?? [];
  switch (def.place) {
    case 'needs_soil':
      if (def.id.endsWith('_sapling') && def.id.startsWith('null')) return tags.includes('dirt') || bdef.id === 'far_grass_block';
      return tags.includes('dirt') || bdef.id === 'farmland' || bdef.id === 'moss_block' || bdef.id === 'mud';
    case 'needs_farmland':
      return bdef.id === 'farmland';
    case 'needs_sand':
      if (def.id === 'cactus') {
        // Cactus touching cactus is one plant: arms branch sideways off a trunk
        let arm = false;
        for (let f = 2; f < 6; f++) {
          const n = w.getState(x + FACE_DX[f], y, z + FACE_DZ[f]);
          if (blocks[STATE_BLOCK[n]!]!.id === 'cactus') arm = true;
          else if (STATE_SOLID[n]) return false;
        }
        if (tags.includes('sand') || bdef.id === 'cactus') return true;
        return arm && !STATE_SOLID[below];
      }
      return tags.includes('sand') || tags.includes('terracotta') || bdef.id === 'terracotta' || tags.includes('dirt');
    case 'needs_soul_sand':
      return bdef.id === 'soul_sand';
    case 'needs_nylium':
      return tags.includes('nylium') || bdef.id === 'soul_soil' || tags.includes('dirt');
    case 'needs_water_surface':
      return STATE_FLUID[below] === 1 && getProp(below, 'level') === '0';
    case 'needs_solid_below':
      return supportsFromBelow(w, x, y - 1, z);
    case 'standing':
      if (def.id === 'sugar_cane') {
        if (bdef.id === 'sugar_cane') return true;
        if (!(tags.includes('dirt') || tags.includes('sand'))) return false;
        for (let f = 2; f < 6; f++) if (STATE_FLUID[w.getState(x + FACE_DX[f], y - 1, z + FACE_DZ[f])] === 1) return true;
        return false;
      }
      if (def.id === 'bamboo') return tags.includes('dirt') || tags.includes('sand') || bdef.id === 'bamboo' || bdef.id === 'gravel';
      return STATE_SOLID[below] === 1 || tags.includes('dirt');
    default:
      return true;
  }
}

/** Whether a block at a position can remain (used after neighbour changes too). */
export function canSurvive(state: number, w: WorldReader, x: number, y: number, z: number): boolean {
  const def = blocks[STATE_BLOCK[state]!]!.def;
  const below = w.getState(x, y - 1, z);
  switch (def.model) {
    case 'torch':
      return supportsFromBelow(w, x, y - 1, z) || isSturdy(w, x, y - 1, z);
    case 'wall_torch':
    case 'ladder':
    case 'wall_sign': {
      const f = getProp(state, 'facing')!;
      const back = oppositeHorizontal(f);
      const bi = FACE_NAMES.indexOf(back as 'north');
      return isSturdy(w, x + FACE_DX[bi], y, z + FACE_DZ[bi]);
    }
    case 'button':
    case 'lever': {
      const face = getProp(state, 'face');
      if (face === 'floor') return isSturdy(w, x, y - 1, z);
      if (face === 'ceiling') return isSturdy(w, x, y + 1, z);
      const back = oppositeHorizontal(getProp(state, 'facing')!);
      const bi = FACE_NAMES.indexOf(back as 'north');
      return isSturdy(w, x + FACE_DX[bi], y, z + FACE_DZ[bi]);
    }
    case 'door':
      if (getProp(state, 'half') === 'upper') return STATE_BLOCK[below] === STATE_BLOCK[state];
      return isSturdy(w, x, y - 1, z);
    case 'double_plant':
      if (getProp(state, 'half') === 'upper') return STATE_BLOCK[below] === STATE_BLOCK[state];
      return soilOk(def, below, w, x, y, z);
    case 'lantern':
      if (getProp(state, 'hanging') === 'true') {
        const above = w.getState(x, y + 1, z);
        return STATE_SOLID[above] === 1 || blocks[STATE_BLOCK[above]!]!.def.model === 'chain';
      }
      return STATE_SOLID[below] === 1;
    case 'carpet':
    case 'pressure_plate':
      return STATE_SOLID[below] === 1 && blocks[STATE_BLOCK[below]!]!.def.model !== 'carpet';
    case 'snow_layer': {
      const bid = blocks[STATE_BLOCK[below]!]!.id;
      if (bid === 'ice' || bid === 'packed_ice' || bid === 'blue_ice' || bid === 'barrier') return false;
      if (bid === 'snow') return getProp(below, 'layers') === '8';
      return STATE_FULL_CUBE[below] === 1 || blockHasTag(below, 'leaves');
    }
    case 'sign':
      return STATE_SOLID[below] === 1;
    case 'vine': {
      if (def.id !== 'vine') return true;
      const above = w.getState(x, y + 1, z);
      for (const d of HORIZ) {
        if (getProp(state, d) !== 'true') continue;
        const i = FACE_NAMES.indexOf(d as 'north');
        if (isSturdy(w, x + FACE_DX[i], y, z + FACE_DZ[i])) return true;
        if (STATE_BLOCK[above] === STATE_BLOCK[state] && getProp(above, d) === 'true') return true;
      }
      return getProp(state, 'up') === 'true' && isSturdy(w, x, y + 1, z);
    }
    case 'hanging_plant': {
      const above = w.getState(x, y + 1, z);
      return STATE_SOLID[above] === 1 || STATE_BLOCK[above] === STATE_BLOCK[state];
    }
    case 'dripstone': {
      const up = getProp(state, 'vertical_direction') === 'up';
      const n = w.getState(x, up ? y - 1 : y + 1, z);
      return STATE_SOLID[n] === 1;
    }
    case 'cross':
    case 'crop':
    case 'lily_pad':
    case 'cactus':
      if (def.fluid === 'water') return STATE_SOLID[below] === 1;
      if (def.id === 'twisting_vines') return STATE_SOLID[below] === 1 || STATE_BLOCK[below] === STATE_BLOCK[state];
      if (!def.place) return STATE_SOLID[below] === 1;
      return soilOk(def, below, w, x, y, z);
    case 'rod':
      if (def.id === 'bamboo') return soilOk(def, below, w, x, y, z);
      return true;
    case 'fire':
      return STATE_SOLID[below] === 1 || flammableNeighbour(w, x, y, z);
    case 'portal': {
      // A portal sheet needs portal or frame blocks on every side within its plane
      const frame = def.id === 'far_portal' ? 'far_portal_frame' : 'obsidian';
      const ok = (s: number): boolean => STATE_BLOCK[s] === STATE_BLOCK[state] || blocks[STATE_BLOCK[s]!]!.id === frame;
      const alongX = getProp(state, 'axis') !== 'z';
      const dx = alongX ? 1 : 0;
      const dz = alongX ? 0 : 1;
      return ok(below) && ok(w.getState(x, y + 1, z)) && ok(w.getState(x + dx, y, z + dz)) && ok(w.getState(x - dx, y, z - dz));
    }
    case 'bed':
      return true;
    default:
      if (def.id === 'bracket_fungus') {
        const bi = FACE_NAMES.indexOf(oppositeHorizontal(getProp(state, 'facing')!) as 'north');
        return isSturdy(w, x + FACE_DX[bi], y, z + FACE_DZ[bi]);
      }
      if (def.place) return soilOk(def, below, w, x, y, z);
      return true;
  }
}

function flammableNeighbour(w: WorldReader, x: number, y: number, z: number): boolean {
  for (let f = 0; f < 6; f++) {
    const s = w.getState(x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f]);
    if (blocks[STATE_BLOCK[s]!]!.def.flammable) return true;
  }
  return false;
}

function canReplace(w: WorldReader, x: number, y: number, z: number, placing: string): boolean {
  const s = w.getState(x, y, z);
  if (s === 0 || STATE_REPLACEABLE[s]) {
    // Placing water plants inside water is fine; snow layers merge separately
    return true;
  }
  void placing;
  return false;
}

/** Computes the placements for a block item. Returns null if invalid. */
export function computePlacement(w: WorldReader, r: PlaceRequest): Placement[] | null {
  let bt = blockById.get(r.blockId);
  if (!bt) return null;
  const clicked = w.getState(r.x, r.y, r.z);
  const cdef = blocks[STATE_BLOCK[clicked]!]!.def;
  const face = r.face;
  let x = r.x;
  let y = r.y;
  let z = r.z;
  // Slab merging into the clicked slab
  if (bt.def.model === 'slab' && STATE_BLOCK[clicked] === bt.num) {
    const t = getProp(clicked, 'type');
    if ((t === 'bottom' && face === 1) || (t === 'top' && face === 0)) return [{ x, y, z, state: withProp(clicked, 'type', 'double') }];
  }
  // Snow layers stack
  if (bt.id === 'snow' && cdef.id === 'snow') {
    const l = parseInt(getProp(clicked, 'layers')!, 10);
    if (l < 8) return [{ x, y, z, state: withProp(clicked, 'layers', String(l + 1)) }];
  }
  const replaceClicked = STATE_REPLACEABLE[clicked] && !(cdef.id === 'snow' && getProp(clicked, 'layers') !== '1') && STATE_FLUID[clicked] === 0;
  if (!replaceClicked) {
    x += FACE_DX[face];
    y += FACE_DY[face];
    z += FACE_DZ[face];
  }
  if (y < 0 || y > 255) return null;
  const target = w.getState(x, y, z);
  // Slab merging into the target cell
  if (bt.def.model === 'slab' && STATE_BLOCK[target] === bt.num && getProp(target, 'type') !== 'double') {
    return [{ x, y, z, state: withProp(target, 'type', 'double') }];
  }
  if (!canReplace(w, x, y, z, bt.id)) return null;
  const facing = yawToFacing(r.yaw); // direction the player looks
  const toward = oppositeHorizontal(facing); // points back to the player
  const hitHigh = face === 0 || (face !== 1 && (replaceClicked ? r.hy : r.hy) > 0.5);
  let state = bt.defaultState;
  const def = bt.def;

  // Wall variants (torch -> wall_torch, sign -> wall_sign)
  if (r.wallBlockId && face >= 2) {
    const wb = getBlock(r.wallBlockId);
    bt = wb;
    const wf = FACE_NAMES[face]!;
    state = withProp(wb.defaultState, 'facing', wf);
    if (!canSurvive(state, w, x, y, z)) return null;
    return [{ x, y, z, state }];
  }
  if (r.wallBlockId && face === 0) return null;

  switch (def.model) {
    case 'column':
    case 'chain':
      state = withProp(state, 'axis', face <= 1 ? 'y' : face <= 3 ? 'z' : 'x');
      break;
    case 'slab':
      state = withProp(state, 'type', hitHigh ? 'top' : 'bottom');
      break;
    case 'stairs':
      state = withProps(state, { facing, half: hitHigh ? 'top' : 'bottom' });
      state = stairShape(w, x, y, z, state);
      break;
    case 'door': {
      if (!canReplace(w, x, y + 1, z, bt.id) || y + 1 > 255) return null;
      if (!isSturdy(w, x, y - 1, z)) return null;
      // Hinge: towards the side the player clicked relative to the door center
      const left = rotateCCW(facing);
      const li = FACE_NAMES.indexOf(left as 'north');
      const lx = FACE_DX[li];
      const lz = FACE_DZ[li];
      const hitSide = (r.hx - 0.5) * lx + (r.hz - 0.5) * lz;
      const leftSolid = STATE_SOLID[w.getState(x + lx, y, z + lz)];
      const rightSolid = STATE_SOLID[w.getState(x - lx, y, z - lz)];
      let hinge = hitSide > 0 ? 'left' : 'right';
      if (leftSolid && !rightSolid) hinge = 'left';
      else if (rightSolid && !leftSolid) hinge = 'right';
      const base = withProps(state, { facing, hinge });
      return [
        { x, y, z, state: withProp(base, 'half', 'lower') },
        { x, y: y + 1, z, state: withProp(base, 'half', 'upper') },
      ];
    }
    case 'bed': {
      const fi = FACE_NAMES.indexOf(facing as 'north');
      const hx = x + FACE_DX[fi];
      const hz = z + FACE_DZ[fi];
      if (!canReplace(w, hx, y, hz, bt.id)) return null;
      if (!STATE_SOLID[w.getState(x, y - 1, z)] || !STATE_SOLID[w.getState(hx, y - 1, hz)]) return null;
      const base = withProp(state, 'facing', facing);
      return [
        { x, y, z, state: withProp(base, 'part', 'foot') },
        { x: hx, y, z: hz, state: withProp(base, 'part', 'head') },
      ];
    }
    case 'double_plant': {
      if (!canReplace(w, x, y + 1, z, bt.id)) return null;
      if (!soilOk(def, w.getState(x, y - 1, z), w, x, y, z)) return null;
      return [
        { x, y, z, state: withProp(state, 'half', 'lower') },
        { x, y: y + 1, z, state: withProp(state, 'half', 'upper') },
      ];
    }
    case 'trapdoor':
      if (face >= 2) state = withProps(state, { facing: FACE_NAMES[face]!, half: r.hy > 0.5 ? 'top' : 'bottom' });
      else state = withProps(state, { facing: toward, half: face === 0 ? 'top' : 'bottom' });
      break;
    case 'ladder':
      if (face < 2) return null;
      state = withProp(state, 'facing', FACE_NAMES[face]!);
      break;
    case 'button':
    case 'lever':
      if (face === 1) state = withProps(state, { face: 'floor', facing });
      else if (face === 0) state = withProps(state, { face: 'ceiling', facing });
      else state = withProps(state, { face: 'wall', facing: FACE_NAMES[face]! });
      break;
    case 'lantern':
      state = withProp(state, 'hanging', face === 0 || !STATE_SOLID[w.getState(x, y - 1, z)] ? 'true' : 'false');
      break;
    case 'sign': {
      const rot = Math.round(((((-r.yaw * 180) / Math.PI + 180) % 360) + 360) % 360 / 22.5) % 16;
      state = withProp(state, 'rotation', String(rot));
      break;
    }
    case 'rod':
      if (hasProp(state, 'facing')) state = withProp(state, 'facing', FACE_NAMES[face]!);
      break;
    case 'dripstone':
      state = withProp(state, 'vertical_direction', face === 0 ? 'down' : 'up');
      break;
    case 'vine': {
      if (face <= 1 && def.id === 'vine') {
        if (face === 0) state = withProp(state, 'up', 'true');
        else return null;
      } else {
        const back = FACE_NAMES[face ^ 1]!;
        state = withProp(state, back, 'true');
      }
      break;
    }
    case 'chest':
      state = withProp(state, 'facing', toward);
      if (hasProp(state, 'type')) state = chestPairing(w, x, y, z, state, r.sneaking);
      break;
    case 'anvil':
      state = withProp(state, 'facing', rotateCCW(facing));
      break;
    case 'end_portal_frame':
      state = withProp(state, 'facing', toward);
      break;
    case 'fence_gate':
      state = withProp(state, 'facing', facing);
      break;
    case 'campfire':
      state = withProp(state, 'facing', toward);
      break;
    default:
      if (def.id === 'bracket_fungus') {
        // Grows out of the side that was clicked
        if (face < 2) return null;
        state = withProp(state, 'facing', FACE_NAMES[face]!);
        break;
      }
      if (hasProp(state, 'facing')) {
        const vals = bt.propValues[bt.propNames.indexOf('facing')]!;
        if (vals.includes('up')) {
          // 6-way (barrel): face towards the player including vertical
          if (r.pitch > 0.8) state = withProp(state, 'facing', 'down');
          else if (r.pitch < -0.8) state = withProp(state, 'facing', 'up');
          else state = withProp(state, 'facing', toward);
        } else state = withProp(state, 'facing', toward);
      }
      if (hasProp(state, 'axis')) state = withProp(state, 'axis', face <= 1 ? 'y' : face <= 3 ? 'z' : 'x');
  }
  // Water plants must be placed in water; others must not be placed into water unless allowed
  if (def.fluid === 'water' && STATE_FLUID[target] !== 1) return null;
  state = connectState(w, x, y, z, state);
  if (!canSurvive(state, w, x, y, z)) return null;
  return [{ x, y, z, state }];
}

function withProps(state: number, p: Record<string, string>): number {
  for (const [k, v] of Object.entries(p)) state = withProp(state, k, v);
  return state;
}

export function rotateCCW(f: string): string {
  return ({ north: 'west', west: 'south', south: 'east', east: 'north' } as Record<string, string>)[f] ?? f;
}
export function rotateCW(f: string): string {
  return ({ north: 'east', east: 'south', south: 'west', west: 'north' } as Record<string, string>)[f] ?? f;
}

function chestPairing(w: WorldReader, x: number, y: number, z: number, state: number, sneaking: boolean): number {
  if (sneaking) return withProp(state, 'type', 'single');
  const facing = getProp(state, 'facing')!;
  // "left" is to the chest's left when looking at its front
  const leftDir = rotateCW(facing);
  const rightDir = rotateCCW(facing);
  for (const [dir, myType] of [
    [leftDir, 'right'],
    [rightDir, 'left'],
  ] as const) {
    const i = FACE_NAMES.indexOf(dir as 'north');
    const ns = w.getState(x + FACE_DX[i], y, z + FACE_DZ[i]);
    if (STATE_BLOCK[ns] === STATE_BLOCK[state] && getProp(ns, 'type') === 'single' && getProp(ns, 'facing') === facing) return withProp(state, 'type', myType);
  }
  return withProp(state, 'type', 'single');
}

/** Partner update for double chests: returns the new state for the neighbour (or null). */
export function chestPartnerUpdate(w: WorldReader, x: number, y: number, z: number, state: number): Placement | null {
  const type = getProp(state, 'type');
  if (!type || type === 'single') return null;
  const facing = getProp(state, 'facing')!;
  const dir = type === 'right' ? rotateCW(facing) : rotateCCW(facing);
  const i = FACE_NAMES.indexOf(dir as 'north');
  const nx = x + FACE_DX[i];
  const nz = z + FACE_DZ[i];
  const ns = w.getState(nx, y, nz);
  if (STATE_BLOCK[ns] !== STATE_BLOCK[state]) return null;
  return { x: nx, y, z: nz, state: withProp(ns, 'type', type === 'right' ? 'left' : 'right') };
}

// ---------------------------------------------------------------- connections

function connectsTo(w: WorldReader, self: number, x: number, y: number, z: number, dir: string): boolean {
  const s = w.getState(x, y, z);
  if (s === 0) return false;
  const def = blocks[STATE_BLOCK[s]!]!.def;
  const me = blocks[STATE_BLOCK[self]!]!.def;
  if (me.model === 'fence') {
    if (def.model === 'fence') return (def.tags?.includes('wooden_fences') ?? false) === (me.tags?.includes('wooden_fences') ?? false);
    if (def.model === 'fence_gate') {
      const gf = getProp(s, 'facing')!;
      return dir === 'north' || dir === 'south' ? gf === 'east' || gf === 'west' : gf === 'north' || gf === 'south';
    }
  }
  if (me.model === 'wall' && (def.model === 'wall' || def.model === 'fence_gate' || def.model === 'pane')) return true;
  if (me.model === 'pane' && (def.model === 'pane' || def.model === 'wall')) return true;
  return STATE_OPAQUE[s] === 1 || STATE_FULL_CUBE[s] === 1;
}

/** Updates connection properties (fences, walls, panes, stairs shape, vines). */
export function connectState(w: WorldReader, x: number, y: number, z: number, state: number): number {
  const def = blocks[STATE_BLOCK[state]!]!.def;
  if (def.model === 'fence' || def.model === 'wall' || def.model === 'pane') {
    for (const d of HORIZ) {
      const i = FACE_NAMES.indexOf(d as 'north');
      state = withProp(state, d, connectsTo(w, state, x + FACE_DX[i], y, z + FACE_DZ[i], d) ? 'true' : 'false');
    }
    if (def.model === 'wall') {
      const n = getProp(state, 'north') === 'true';
      const s = getProp(state, 'south') === 'true';
      const e = getProp(state, 'east') === 'true';
      const wv = getProp(state, 'west') === 'true';
      const straight = (n && s && !e && !wv) || (e && wv && !n && !s);
      const above = w.getState(x, y + 1, z);
      state = withProp(state, 'up', !straight || (above !== 0 && blocks[STATE_BLOCK[above]!]!.def.model !== 'none') ? 'true' : 'false');
    }
    return state;
  }
  if (def.model === 'stairs') return stairShape(w, x, y, z, state);
  if (def.id === 'redstone_wire') return wireShape(w, x, y, z, state);
  if (def.model === 'fence_gate') {
    const f = getProp(state, 'facing')!;
    const axisDirs = f === 'north' || f === 'south' ? ['west', 'east'] : ['north', 'south'];
    const inWall = axisDirs.some((d) => {
      const i = FACE_NAMES.indexOf(d as 'north');
      return blocks[STATE_BLOCK[w.getState(x + FACE_DX[i], y, z + FACE_DZ[i])]!]!.def.model === 'wall';
    });
    return withProp(state, 'in_wall', inWall ? 'true' : 'false');
  }
  if (def.model === 'hanging_plant' && def.id === 'cave_vines') return state;
  if (def.id === 'chorus_plant') {
    for (let f = 0; f < 6; f++) {
      const n = w.getState(x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f]);
      const nid = blocks[STATE_BLOCK[n]!]!.id;
      const ok = nid === 'chorus_plant' || nid === 'chorus_flower' || (f === 0 && nid === 'end_stone');
      state = withProp(state, FACE_NAMES[f]!, ok ? 'true' : 'false');
    }
    return state;
  }
  return state;
}

function stairAt(w: WorldReader, x: number, y: number, z: number, dir: string): number | null {
  const i = FACE_NAMES.indexOf(dir as 'north');
  const s = w.getState(x + FACE_DX[i], y, z + FACE_DZ[i]);
  return blocks[STATE_BLOCK[s]!]!.def.model === 'stairs' ? s : null;
}

/** Computes stair shape (straight / inner / outer corners) from neighbours. */
export function stairShape(w: WorldReader, x: number, y: number, z: number, state: number): number {
  const facing = getProp(state, 'facing')!;
  const half = getProp(state, 'half');
  // Stair in front (the high side direction)
  const front = stairAt(w, x, y, z, facing);
  if (front !== null && getProp(front, 'half') === half) {
    const ff = getProp(front, 'facing')!;
    if (ff === rotateCCW(facing)) return withProp(state, 'shape', 'outer_left');
    if (ff === rotateCW(facing)) return withProp(state, 'shape', 'outer_right');
  }
  const back = stairAt(w, x, y, z, oppositeHorizontal(facing));
  if (back !== null && getProp(back, 'half') === half) {
    const bf = getProp(back, 'facing')!;
    if (bf === rotateCCW(facing)) return withProp(state, 'shape', 'inner_left');
    if (bf === rotateCW(facing)) return withProp(state, 'shape', 'inner_right');
  }
  return withProp(state, 'shape', 'straight');
}

export { STATE_FLUID };
import { wireShape } from './redstone';
