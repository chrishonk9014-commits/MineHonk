/**
 * Redstone power.
 *
 * Sources: levers, buttons, pressure plates, redstone blocks and redstone
 * torches. Redstone dust carries power (15, losing 1 per block) and powers the
 * block under it and the blocks it points into. A solid block with a source
 * attached to it (or a torch under it) is strongly powered and powers
 * everything around it, dust included; a solid block powered by dust only
 * powers the components next to it.
 *
 * Powered components: doors, trapdoors and fence gates open, lamps light,
 * note blocks play, TNT ignites. A redstone torch turns off when the block it
 * hangs on is powered (after a short delay, and it burns out when toggled too
 * fast).
 *
 * Everything is event driven: a change near redstone recomputes the dust
 * networks and components around it. Nothing is scanned every tick except the
 * few pressure plates currently pressed.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import { blocks, STATE_BLOCK, STATE_OPAQUE, getProp, withProp } from '../../common/registry/blocks';
import { FACE_DX, FACE_DY, FACE_DZ } from '../../common/world/constants';
import { redstoneKind as kindOf, H_DIRS, H_DX, H_DZ } from '../../common/game/redstone';

/** Face index (0 down .. 5 east) a lever/button hangs from (the block it is attached to). */
function attachedFace(state: number): number {
  const face = getProp(state, 'face');
  if (face === 'floor') return 0;
  if (face === 'ceiling') return 1;
  // wall: attached to the block behind (opposite its facing)
  switch (getProp(state, 'facing')) {
    case 'north':
      return 3;
    case 'south':
      return 2;
    case 'west':
      return 5;
    default:
      return 4;
  }
}

/** V5: front face index (2..5) of a facing signal part. */
function frontFace(state: number): number {
  return { north: 2, south: 3, west: 4, east: 5 }[getProp(state, 'facing') as 'north'] ?? 2;
}

/** The left and right faces of a part facing out of `front`. */
function sidesOf(front: number): [number, number] {
  switch (front) {
    case 2:
      return [4, 5];
    case 3:
      return [5, 4];
    case 4:
      return [3, 2];
    default:
      return [2, 3];
  }
}

/** A logic gate's output from its left, right and back inputs. */
export function gateResult(mode: string, a: boolean, b: boolean, back: boolean): boolean {
  switch (mode) {
    case 'or':
      return a || b || back;
    case 'xor':
      return (Number(a) + Number(b) + Number(back)) % 2 === 1;
    case 'nand':
      return !(a && b);
    case 'nor':
      return !(a || b || back);
    case 'not':
      return !back;
    default:
      return a && b;
  }
}

let CABLE = -1;
function isCable(state: number): boolean {
  if (CABLE < 0) CABLE = blocks.findIndex((bt) => bt.id === 'signal_cable');
  return STATE_BLOCK[state] === CABLE;
}

/** For wall torches: the block behind them. */
function wallTorchAttached(state: number): number {
  switch (getProp(state, 'facing')) {
    case 'north':
      return 3;
    case 'south':
      return 2;
    case 'west':
      return 5;
    default:
      return 4;
  }
}

export class Power {
  private readonly queue: { dim: Dimension; x: number; y: number; z: number }[] = [];
  private processing = false;
  /** Last powered state of components (doors etc.): only changes toggle them. */
  private readonly lastPowered = new Map<string, boolean>();
  /** Torch toggles waiting for their delay: key -> due tick. */
  private readonly torchQueue = new Map<string, { dim: Dimension; x: number; y: number; z: number; due: number }>();
  /** Recent toggles per torch (burnout). */
  private readonly torchHistory = new Map<string, number[]>();
  /** Logic gates switching after their delay. */
  private readonly gateQueue = new Map<string, { dim: Dimension; x: number; y: number; z: number; due: number; lit: boolean }>();
  /** Pressed plates: key -> last tick an entity was on it. */
  private readonly plates = new Map<string, { dim: Dimension; x: number; y: number; z: number; seen: number }>();
  /** External power providers (sculk sensors): returns 0..15 emitted from a position. */
  extraPower: ((dim: Dimension, x: number, y: number, z: number) => number) | null = null;

  constructor(private readonly server: GameServer) {}

  // ------------------------------------------------------------------ queries

  /** Power a component at (x,y,z) sends directly into the neighbour in direction `face`. */
  private emitted(dim: Dimension, x: number, y: number, z: number, face: number): number {
    const s = dim.getState(x, y, z);
    const k = kindOf(s);
    switch (k) {
      case 'lever':
      case 'button':
      case 'plate':
        return getProp(s, 'powered') === 'true' ? 15 : 0;
      case 'block':
        return 15;
      case 'torch':
        // Not back into the block it stands on
        return getProp(s, 'lit') === 'true' && face !== 0 ? 15 : 0;
      case 'wall_torch':
        return getProp(s, 'lit') === 'true' && face !== wallTorchAttached(s) ? 15 : 0;
      case 'wire': {
        const p = parseInt(getProp(s, 'power') ?? '0', 10);
        if (p === 0) return 0;
        if (face === 0) return p; // the block below
        if (face === 1) return 0;
        return this.wirePoints(s, face) ? p : 0;
      }
      case 'sensor':
        return this.extraPower ? this.extraPower(dim, x, y, z) : 0;
      // V5 signal parts
      case 'timer':
        return getProp(s, 'lit') === 'true' ? 15 : 0;
      case 'logic':
        return getProp(s, 'lit') === 'true' && face === frontFace(s) ? 15 : 0;
      case 'level':
      case 'detector': {
        if (face !== frontFace(s)) return 0;
        const out = (dim.getBlockEntity(x, y, z) as { out?: number } | undefined)?.out;
        return typeof out === 'number' ? Math.max(0, Math.min(15, out)) : getProp(s, 'lit') === 'true' ? 15 : 0;
      }
      default:
        return 0;
    }
  }

  /** Whether a signal comes into (x,y,z) from its neighbour on side `face`. */
  private inputFrom(dim: Dimension, x: number, y: number, z: number, face: number): boolean {
    const nx = x + FACE_DX[face];
    const ny = y + FACE_DY[face];
    const nz = z + FACE_DZ[face];
    return this.emitted(dim, nx, ny, nz, face ^ 1) > 0 || this.strongly(dim, nx, ny, nz) || this.weakly(dim, nx, ny, nz);
  }

  /** Whether dust points into the horizontal face (2..5). */
  private wirePoints(s: number, face: number): boolean {
    const dir = ['', '', 'north', 'south', 'west', 'east'][face]!;
    let n = 0;
    for (const d of H_DIRS) if (getProp(s, d) !== 'none') n++;
    if (n === 0) return true; // a dot powers all around
    if (getProp(s, dir) !== 'none') return true;
    if (n === 1) {
      // A single arm runs straight through the dot
      const opp = { north: 'south', south: 'north', west: 'east', east: 'west' }[dir]!;
      return getProp(s, opp) !== 'none';
    }
    return false;
  }

  /** A solid block with a source attached to it, a lit torch under it, or a plate on it. */
  private strongly(dim: Dimension, x: number, y: number, z: number): boolean {
    if (!STATE_OPAQUE[dim.getState(x, y, z)]) return false;
    for (let f = 0; f < 6; f++) {
      const nx = x + FACE_DX[f];
      const ny = y + FACE_DY[f];
      const nz = z + FACE_DZ[f];
      const s = dim.getState(nx, ny, nz);
      const k = kindOf(s);
      if (!k) continue;
      if ((k === 'lever' || k === 'button') && getProp(s, 'powered') === 'true') {
        // The component at n hangs from us if its attached face points back at us
        const af = attachedFace(s);
        if (nx + FACE_DX[af] === x && ny + FACE_DY[af] === y && nz + FACE_DZ[af] === z) return true;
      } else if (k === 'plate' && f === 1 && getProp(s, 'powered') === 'true') return true;
      else if (k === 'torch' && f === 0 && getProp(s, 'lit') === 'true') return true;
      else if (k === 'sensor' && this.extraPower && this.extraPower(dim, nx, ny, nz) > 0 && f === 1) return true;
    }
    return false;
  }

  /** A solid block powered weakly by dust (it powers components beside it, but not dust). */
  private weakly(dim: Dimension, x: number, y: number, z: number): boolean {
    if (!STATE_OPAQUE[dim.getState(x, y, z)]) return false;
    for (let f = 0; f < 6; f++) {
      const nx = x + FACE_DX[f];
      const ny = y + FACE_DY[f];
      const nz = z + FACE_DZ[f];
      const s = dim.getState(nx, ny, nz);
      if (kindOf(s) === 'wire' && this.emitted(dim, nx, ny, nz, f ^ 1) > 0) return true;
      if ((kindOf(s) === 'torch' || kindOf(s) === 'wall_torch') && this.emitted(dim, nx, ny, nz, f ^ 1) > 0 && f === 0) return true;
    }
    return false;
  }

  /** Whether a component (door, lamp...) at (x,y,z) receives power. */
  powered(dim: Dimension, x: number, y: number, z: number): boolean {
    for (let f = 0; f < 6; f++) {
      const nx = x + FACE_DX[f];
      const ny = y + FACE_DY[f];
      const nz = z + FACE_DZ[f];
      // Face index from the neighbour back towards us is f ^ 1
      if (this.emitted(dim, nx, ny, nz, f ^ 1) > 0) return true;
      if (this.strongly(dim, nx, ny, nz) || this.weakly(dim, nx, ny, nz)) return true;
    }
    return false;
  }

  /** Power level flowing into dust at (x,y,z) from sources and strongly powered blocks (not other dust). */
  private wireInput(dim: Dimension, x: number, y: number, z: number): number {
    let best = 0;
    for (let f = 0; f < 6; f++) {
      const nx = x + FACE_DX[f];
      const ny = y + FACE_DY[f];
      const nz = z + FACE_DZ[f];
      const s = dim.getState(nx, ny, nz);
      const k = kindOf(s);
      if (k && k !== 'wire') best = Math.max(best, this.emitted(dim, nx, ny, nz, f ^ 1));
      else if (!k && this.strongly(dim, nx, ny, nz)) best = 15;
      if (best === 15) return 15;
    }
    return best;
  }

  /** Dust connected to dust at (x,y,z): sideways, and up or down one step where nothing blocks it. */
  private wireNeighbours(dim: Dimension, x: number, y: number, z: number, out: [number, number, number][]): void {
    const aboveOpen = !STATE_OPAQUE[dim.getState(x, y + 1, z)];
    for (let i = 0; i < 4; i++) {
      const nx = x + H_DX[i]!;
      const nz = z + H_DZ[i]!;
      const side = dim.getState(nx, y, nz);
      if (kindOf(side) === 'wire') out.push([nx, y, nz]);
      else if (!STATE_OPAQUE[side] && kindOf(dim.getState(nx, y - 1, nz)) === 'wire') out.push([nx, y - 1, nz]);
      if (aboveOpen && STATE_OPAQUE[side] && kindOf(dim.getState(nx, y + 1, nz)) === 'wire') out.push([nx, y + 1, nz]);
    }
  }

  // ------------------------------------------------------------------ updates

  /** Something changed at (x,y,z): update redstone around it. */
  touch(dim: Dimension, x: number, y: number, z: number): void {
    this.queue.push({ dim, x, y, z });
    if (this.processing) return;
    this.processing = true;
    try {
      let budget = 4000;
      while (this.queue.length && budget-- > 0) {
        const q = this.queue.shift()!;
        this.process(q.dim, q.x, q.y, q.z);
      }
      this.queue.length = 0;
    } finally {
      this.processing = false;
    }
  }

  /** Hook for every authoritative block change (cheap unless redstone is nearby). */
  onBlockChanged(dim: Dimension, x: number, y: number, z: number, old: number, state: number): void {
    if (this.processing) {
      // Changes made by redstone itself are followed up by the running update
      return;
    }
    let near = kindOf(old) !== null || kindOf(state) !== null;
    for (let f = 0; f < 6 && !near; f++) if (kindOf(dim.getState(x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f]))) near = true;
    if (near) this.touch(dim, x, y, z);
  }

  /** Recomputes dust networks and components within reach of a change. */
  private process(dim: Dimension, x: number, y: number, z: number): void {
    // 1. Dust networks near the change (within two blocks: power travels through one solid block)
    const seen = new Set<string>();
    const affected: [number, number, number][] = [];
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 3) continue;
          const px = x + dx;
          const py = y + dy;
          const pz = z + dz;
          const s = dim.getState(px, py, pz);
          const k = kindOf(s);
          if (k === 'wire') {
            const key = px + ',' + py + ',' + pz;
            if (!seen.has(key)) this.updateNetwork(dim, px, py, pz, seen, affected);
          } else if (k) affected.push([px, py, pz]);
        }
    // 2. Components next to changed dust (and one block further, through solid blocks)
    const done = new Set<string>();
    const check = (px: number, py: number, pz: number): void => {
      const key = px + ',' + py + ',' + pz;
      if (done.has(key)) return;
      done.add(key);
      this.updateComponent(dim, px, py, pz);
    };
    for (const [ax, ay, az] of affected) {
      check(ax, ay, az);
      for (let f = 0; f < 6; f++) {
        const nx = ax + FACE_DX[f];
        const ny = ay + FACE_DY[f];
        const nz = az + FACE_DZ[f];
        check(nx, ny, nz);
        if (STATE_OPAQUE[dim.getState(nx, ny, nz)]) for (let g = 0; g < 6; g++) check(nx + FACE_DX[g], ny + FACE_DY[g], nz + FACE_DZ[g]);
      }
    }
  }

  /** Recomputes the power of every dust in the network containing (x,y,z). */
  private updateNetwork(dim: Dimension, x: number, y: number, z: number, seen: Set<string>, affected: [number, number, number][]): void {
    const nodes: [number, number, number][] = [];
    const stack: [number, number, number][] = [[x, y, z]];
    seen.add(x + ',' + y + ',' + z);
    const nb: [number, number, number][] = [];
    while (stack.length && nodes.length < 2048) {
      const n = stack.pop()!;
      nodes.push(n);
      nb.length = 0;
      this.wireNeighbours(dim, n[0], n[1], n[2], nb);
      for (const m of nb) {
        const k = m[0] + ',' + m[1] + ',' + m[2];
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push(m);
      }
    }
    // Levels: inputs of 15 (or less) flow outwards, losing one per step
    const level = new Map<string, number>();
    const buckets: [number, number, number][][] = Array.from({ length: 16 }, () => []);
    for (const n of nodes) {
      const inp = this.wireInput(dim, n[0], n[1], n[2]);
      level.set(n[0] + ',' + n[1] + ',' + n[2], inp);
      if (inp > 0) buckets[inp]!.push(n);
    }
    for (let l = 15; l > 1; l--) {
      for (const n of buckets[l]!) {
        if (level.get(n[0] + ',' + n[1] + ',' + n[2])! !== l) continue;
        nb.length = 0;
        this.wireNeighbours(dim, n[0], n[1], n[2], nb);
        const fromCable = isCable(dim.getState(n[0], n[1], n[2]));
        for (const m of nb) {
          const k = m[0] + ',' + m[1] + ',' + m[2];
          const cur = level.get(k);
          // Signal Cable carries a signal to more Signal Cable without growing weaker
          const next = fromCable && isCable(dim.getState(m[0], m[1], m[2])) ? l : l - 1;
          if (cur === undefined || cur >= next) continue;
          level.set(k, next);
          buckets[next]!.push(m);
        }
      }
    }
    for (const n of nodes) {
      const s = dim.getState(n[0], n[1], n[2]);
      const want = level.get(n[0] + ',' + n[1] + ',' + n[2]) ?? 0;
      if (parseInt(getProp(s, 'power') ?? '0', 10) !== want) {
        dim.setBlock(n[0], n[1], n[2], withProp(s, 'power', want), { updateNeighbors: false });
        affected.push(n);
      }
    }
    // Components at the ends always need a look, even when levels did not change
    if (!affected.length && nodes.length) affected.push(nodes[0]!);
  }

  /** Applies power to one component (doors, lamps, torches...). */
  private updateComponent(dim: Dimension, x: number, y: number, z: number): void {
    const s = dim.getState(x, y, z);
    const k = kindOf(s);
    if (!k || k === 'wire' || k === 'lever' || k === 'button' || k === 'plate' || k === 'block' || k === 'sensor' || k === 'timer' || k === 'level' || k === 'detector') return;
    const key = dim.id + '|' + x + ',' + y + ',' + z;
    if (k === 'logic') {
      // Inputs on the left, right and back; the result goes out of the front one tick later
      const f = frontFace(s);
      const back = f ^ 1;
      const [left, right] = sidesOf(f);
      const a = this.inputFrom(dim, x, y, z, left);
      const b = this.inputFrom(dim, x, y, z, right);
      const c = this.inputFrom(dim, x, y, z, back);
      const want = gateResult(getProp(s, 'mode') ?? 'and', a, b, c);
      if ((getProp(s, 'lit') === 'true') !== want && !this.gateQueue.has(key)) this.gateQueue.set(key, { dim, x, y, z, due: this.server.tickNo + 2, lit: want });
      return;
    }
    if (k === 'torch' || k === 'wall_torch') {
      const af = k === 'torch' ? 0 : wallTorchAttached(s);
      const ax = x + FACE_DX[af];
      const ay = y + FACE_DY[af];
      const az = z + FACE_DZ[af];
      const off = this.strongly(dim, ax, ay, az) || this.weakly(dim, ax, ay, az) || this.emittedInto(dim, ax, ay, az, x, y, z);
      const lit = getProp(s, 'lit') === 'true';
      if (lit === !off) return;
      // Torches switch after a short delay (this is what makes torch loops blink instead of hang)
      if (!this.torchQueue.has(key)) this.torchQueue.set(key, { dim, x, y, z, due: this.server.tickNo + 2 });
      return;
    }
    let on = this.powered(dim, x, y, z);
    if (k === 'door') {
      // Either half powers the whole door
      const upper = getProp(s, 'half') === 'upper';
      const oy = upper ? y - 1 : y + 1;
      on = on || this.powered(dim, x, oy, z);
    }
    const prev = this.lastPowered.get(key);
    this.lastPowered.set(key, on);
    if (this.lastPowered.size > 20000) this.lastPowered.clear();
    switch (k) {
      case 'lamp':
        if ((getProp(s, 'lit') === 'true') !== on) dim.setBlock(x, y, z, withProp(s, 'lit', on));
        return;
      case 'door': {
        if (prev === on || (prev === undefined && !on)) return;
        const upper = getProp(s, 'half') === 'upper';
        const oy = upper ? y - 1 : y + 1;
        if ((getProp(s, 'open') === 'true') === on) return;
        dim.setBlock(x, y, z, withProp(s, 'open', on), { updateNeighbors: false });
        const other = dim.getState(x, oy, z);
        if (STATE_BLOCK[other] === STATE_BLOCK[s]) dim.setBlock(x, oy, z, withProp(other, 'open', on), { updateNeighbors: false });
        this.lastPowered.set(dim.id + '|' + x + ',' + oy + ',' + z, on);
        this.server.playSound(dim, on ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 1, blocks[STATE_BLOCK[s]!]!.def.sound === 'metal' ? 0.8 : 1.1);
        return;
      }
      case 'trapdoor':
      case 'gate':
        if (prev === on || (prev === undefined && !on)) return;
        if ((getProp(s, 'open') === 'true') === on) return;
        dim.setBlock(x, y, z, withProp(s, 'open', on), { updateNeighbors: false });
        this.server.playSound(dim, on ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 1, 1.2);
        return;
      case 'note':
        if (on && prev === false) {
          this.server.playSound(dim, 'note', x + 0.5, y + 0.5, z + 0.5, 1, 0.5 + ((x * 7 + z * 13 + y) & 15) / 15);
          this.server.particles(dim, 'note', x + 0.5, y + 1.2, z + 0.5, 1);
        }
        return;
      case 'tnt':
        if (on) this.server.interaction.hooks.igniteTnt?.(dim, x, y, z);
        return;
    }
  }

  /** Whether the component at (x,y,z) is powered directly by something other than the torch at (tx,ty,tz). */
  private emittedInto(dim: Dimension, x: number, y: number, z: number, tx: number, ty: number, tz: number): boolean {
    for (let f = 0; f < 6; f++) {
      const nx = x + FACE_DX[f];
      const ny = y + FACE_DY[f];
      const nz = z + FACE_DZ[f];
      if (nx === tx && ny === ty && nz === tz) continue;
      const s = dim.getState(nx, ny, nz);
      const k = kindOf(s);
      if ((k === 'lever' || k === 'button' || k === 'plate' || k === 'block') && this.emitted(dim, nx, ny, nz, f ^ 1) > 0) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    const now = s.tickNo;
    // Torches due to switch
    if (this.torchQueue.size) {
      for (const [key, t] of [...this.torchQueue]) {
        if (t.due > now) continue;
        this.torchQueue.delete(key);
        if (!t.dim.isLoaded(t.x, t.z)) continue;
        const st = t.dim.getState(t.x, t.y, t.z);
        const k = kindOf(st);
        if (k !== 'torch' && k !== 'wall_torch') continue;
        const hist = (this.torchHistory.get(key) ?? []).filter((tt) => tt > now - 60);
        if (hist.length >= 8) {
          // Burnt out: stays off for a while
          if (getProp(st, 'lit') === 'true') t.dim.setBlock(t.x, t.y, t.z, withProp(st, 'lit', false));
          s.particles(t.dim, 'smoke', t.x + 0.5, t.y + 0.7, t.z + 0.5, 5, 0.2);
          s.playSound(t.dim, 'fizz', t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.5, 2);
          this.torchQueue.set(key, { ...t, due: now + 160 });
          this.torchHistory.set(key, []);
          continue;
        }
        const af = k === 'torch' ? 0 : wallTorchAttached(st);
        const ax = t.x + FACE_DX[af];
        const ay = t.y + FACE_DY[af];
        const az = t.z + FACE_DZ[af];
        const off = this.strongly(t.dim, ax, ay, az) || this.weakly(t.dim, ax, ay, az) || this.emittedInto(t.dim, ax, ay, az, t.x, t.y, t.z);
        const lit = !off;
        if ((getProp(st, 'lit') === 'true') === lit) continue;
        hist.push(now);
        this.torchHistory.set(key, hist);
        t.dim.setBlock(t.x, t.y, t.z, withProp(st, 'lit', lit), { updateNeighbors: false });
        this.touch(t.dim, t.x, t.y, t.z);
      }
    }
    // Logic gates due to switch
    if (this.gateQueue.size) {
      for (const [key, g] of [...this.gateQueue]) {
        if (g.due > now) continue;
        this.gateQueue.delete(key);
        if (!g.dim.isLoaded(g.x, g.z)) continue;
        const st = g.dim.getState(g.x, g.y, g.z);
        if (kindOf(st) !== 'logic' || (getProp(st, 'lit') === 'true') === g.lit) continue;
        g.dim.setBlock(g.x, g.y, g.z, withProp(st, 'lit', g.lit), { updateNeighbors: false, keepBlockEntity: true });
        this.touch(g.dim, g.x, g.y, g.z);
      }
    }
    // Pressure plates: pressed while something stands on them
    if (now % 2 === 0) {
      for (const dim of s.dims.values()) {
        if (dim.chunks.size === 0) continue;
        for (const e of dim.entities.values()) {
          if (e.removed || (e as { dead?: boolean }).dead) continue;
          if ((e as { gamemode?: string }).gamemode === 'spectator') continue;
          const bx = Math.floor(e.x);
          const by = Math.floor(e.y + 0.01);
          const bz = Math.floor(e.z);
          const st = dim.getState(bx, by, bz);
          if (kindOf(st) !== 'plate') continue;
          // Stone plates only feel players and mobs; wooden ones anything
          const def = blocks[STATE_BLOCK[st]!]!.def;
          if (def.sound !== 'wood' && e.type !== 'player' && !('def' in e)) continue;
          const key = dim.id + '|' + bx + ',' + by + ',' + bz;
          const pl = this.plates.get(key);
          if (pl) pl.seen = now;
          else this.plates.set(key, { dim, x: bx, y: by, z: bz, seen: now });
          if (getProp(st, 'powered') !== 'true') {
            dim.setBlock(bx, by, bz, withProp(st, 'powered', true), { updateNeighbors: false });
            s.playSound(dim, 'click', bx + 0.5, by + 0.1, bz + 0.5, 0.3, 0.6);
            this.touch(dim, bx, by, bz);
          }
        }
      }
      for (const [key, pl] of this.plates) {
        if (pl.seen > now - 20) continue;
        this.plates.delete(key);
        const st = pl.dim.getState(pl.x, pl.y, pl.z);
        if (kindOf(st) === 'plate' && getProp(st, 'powered') === 'true') {
          pl.dim.setBlock(pl.x, pl.y, pl.z, withProp(st, 'powered', false), { updateNeighbors: false });
          s.playSound(pl.dim, 'click', pl.x + 0.5, pl.y + 0.1, pl.z + 0.5, 0.3, 0.5);
          this.touch(pl.dim, pl.x, pl.y, pl.z);
        }
      }
    }
  }
}
