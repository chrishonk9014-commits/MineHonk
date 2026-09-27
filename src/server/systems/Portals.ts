/**
 * Portals between dimensions.
 *
 * Nether portals: an obsidian frame (interior 2x3 up to 21x21) is lit with
 * flint and steel or a fire charge. Standing inside for 4 seconds (instantly
 * in creative) moves the player to the other side at 1:8 scale. The arrival
 * portal is linked through a persistent registry of known portals; when none
 * is close enough a new one is built on the safest nearby ground. Arrival
 * waits until the destination chunks are loaded (like safe respawning).
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { PortalRecord } from '../world/LevelData';
import type { DimensionId } from '../../common/data/biomes';
import { S, stateOf, getProp, STATE_BLOCK, STATE_SOLID, STATE_FLUID, STATE_REPLACEABLE, blocks } from '../../common/registry/blocks';
import { WORLD_BORDER } from '../../common/world/constants';

const MAX_SIZE = 21;
/** Ticks a survival player must stand in a nether portal. */
export const NETHER_PORTAL_DELAY = 80;

export interface PortalFrame {
  x: number;
  y: number;
  z: number;
  axis: 'x' | 'z';
  width: number;
  height: number;
}

interface PendingArrival {
  dim: DimensionId;
  kind: 'nether' | 'far';
  x: number;
  y: number;
  z: number;
  axis: 'x' | 'z';
  /** A linked portal that still has to be verified once its chunk loads. */
  link: PortalRecord | null;
  since: number;
}

export class Portals {
  private readonly pending = new Map<ServerPlayer, PendingArrival>();
  private obsidian = 0;

  constructor(private readonly server: GameServer) {}

  private ids(): void {
    if (!this.obsidian) this.obsidian = S('obsidian');
  }

  // ------------------------------------------------------------------ frames

  /** Finds a complete empty frame around the open block (x,y,z) along an axis. */
  findFrame(dim: Dimension, x: number, y: number, z: number, axis: 'x' | 'z', frameId: string): PortalFrame | null {
    const frame = S(frameId);
    const open = (s: number): boolean => s === 0 || (STATE_REPLACEABLE[s] === 1 && !STATE_FLUID[s]) || blocks[STATE_BLOCK[s]!]!.id === 'fire';
    const at = (i: number, j: number, bx: number, bz: number): number => dim.getState(bx + (axis === 'x' ? i : 0), j, bz + (axis === 'z' ? i : 0));
    if (!open(dim.getState(x, y, z))) return null;
    // Down to the bottom frame
    let yb = y;
    while (yb > y - MAX_SIZE && open(dim.getState(x, yb - 1, z))) yb--;
    if (dim.getState(x, yb - 1, z) !== frame) return null;
    // Back to the first column
    let start = 0;
    while (start > -MAX_SIZE && open(at(start - 1, yb, x, z))) start--;
    if (at(start - 1, yb, x, z) !== frame) return null;
    let width = 0;
    while (width < MAX_SIZE && open(at(start + width, yb, x, z))) {
      if (at(start + width, yb - 1, x, z) !== frame) return null;
      width++;
    }
    if (width < 2 || width > MAX_SIZE || at(start + width, yb, x, z) !== frame) return null;
    let height = 0;
    for (; height < MAX_SIZE; height++) {
      const j = yb + height;
      let allFrame = true;
      let allOpen = true;
      for (let i = 0; i < width; i++) {
        const s = at(start + i, j, x, z);
        if (s !== frame) allFrame = false;
        if (!open(s)) allOpen = false;
      }
      if (allFrame) break;
      if (!allOpen || at(start - 1, j, x, z) !== frame || at(start + width, j, x, z) !== frame) return null;
    }
    if (height < 3 || height >= MAX_SIZE || y >= yb + height) return null;
    return { x: x + (axis === 'x' ? start : 0), y: yb, z: z + (axis === 'z' ? start : 0), axis, width, height };
  }

  private fill(dim: Dimension, f: PortalFrame, portalId: string): void {
    const st = stateOf(portalId, { axis: f.axis });
    for (let i = 0; i < f.width; i++)
      for (let j = 0; j < f.height; j++) dim.setBlock(f.x + (f.axis === 'x' ? i : 0), f.y + j, f.z + (f.axis === 'z' ? i : 0), st, { updateNeighbors: false });
  }

  private register(dim: Dimension, kind: 'nether' | 'far', f: PortalFrame): void {
    const list = this.server.level.portals;
    if (list.some((r) => r.dim === dim.id && r.x === f.x && r.y === f.y && r.z === f.z)) return;
    list.push({ dim: dim.id, kind, x: f.x, y: f.y, z: f.z, axis: f.axis });
    if (list.length > 1024) list.shift();
  }

  /** Flint and steel / fire charge used on the open block (x,y,z). */
  light(dim: Dimension, x: number, y: number, z: number): boolean {
    if (dim.id !== 'overworld' && dim.id !== 'nether') return false;
    for (const axis of ['x', 'z'] as const) {
      const f = this.findFrame(dim, x, y, z, axis, 'obsidian');
      if (!f) continue;
      this.fill(dim, f, 'nether_portal');
      this.register(dim, 'nether', f);
      this.server.playSound(dim, 'portal.open', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ travel

  /** Kind of portal block the player's body touches. */
  private touching(p: ServerPlayer): string | null {
    const x0 = Math.floor(p.x - 0.3);
    const x1 = Math.floor(p.x + 0.3);
    const z0 = Math.floor(p.z - 0.3);
    const z1 = Math.floor(p.z + 0.3);
    const y0 = Math.floor(p.y);
    const y1 = Math.floor(p.y + 1.7);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const id = blocks[STATE_BLOCK[p.dim.getState(x, y, z)]!]!.id;
          if (id === 'nether_portal' || id === 'end_portal' || id === 'far_portal' || id === 'end_gateway') return id;
        }
    return null;
  }

  tick(): void {
    this.ids();
    for (const p of this.server.players.values()) {
      if (p.dead) continue;
      const pend = this.pending.get(p);
      if (pend) {
        this.processArrival(p, pend);
        continue;
      }
      const kind = this.touching(p);
      if (!kind) {
        p.portalTicks = 0;
        continue;
      }
      if (p.portalCooldown > 0) {
        // Stay put in the arrival portal until the player steps out
        p.portalCooldown = Math.max(p.portalCooldown, 20);
        continue;
      }
      if (kind === 'nether_portal') {
        p.portalTicks++;
        const need = p.gamemode === 'creative' || p.gamemode === 'spectator' ? 1 : NETHER_PORTAL_DELAY;
        if (p.portalTicks >= need) {
          p.portalTicks = 0;
          this.travelNether(p);
        }
      } else {
        this.server.interaction.hooks.enterPortal?.(p, kind);
      }
    }
  }

  private travelNether(p: ServerPlayer): void {
    const from = p.dim.id;
    if (from !== 'overworld' && from !== 'nether') return;
    const to: DimensionId = from === 'overworld' ? 'nether' : 'overworld';
    const scale = from === 'overworld' ? 1 / 8 : 8;
    const lim = WORLD_BORDER / (to === 'nether' ? 8 : 1) - 32;
    const tx = Math.max(-lim, Math.min(lim, Math.floor(p.x * scale)));
    const tz = Math.max(-lim, Math.min(lim, Math.floor(p.z * scale)));
    const axisHere = getProp(p.dim.getState(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z)), 'axis');
    this.depart(p, to, 'nether', tx, tz, axisHere === 'z' ? 'z' : 'x', to === 'nether' ? 16 : 128);
  }

  /**
   * Sends a player to the nearest registered portal of `kind` within `radius`
   * of (tx, tz) in dimension `to`, or builds one there once terrain is loaded.
   */
  depart(p: ServerPlayer, to: DimensionId, kind: 'nether' | 'far', tx: number, tz: number, axis: 'x' | 'z', radius: number): void {
    let best: PortalRecord | null = null;
    let bestD = radius * radius;
    for (const r of this.server.level.portals) {
      if (r.dim !== to || r.kind !== kind) continue;
      const d = (r.x - tx) ** 2 + (r.z - tz) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = r;
      }
    }
    this.server.playSound(p.dim, 'portal.travel', p.x, p.y + 1, p.z, 0.8, 1);
    const target = best ?? { x: tx, y: to === 'nether' ? 70 : 100, z: tz };
    this.server.changeDimension(p, to, target.x + 0.5, target.y, target.z + 0.5);
    p.portalCooldown = 100;
    this.pending.set(p, { dim: to, kind, x: target.x, y: target.y, z: target.z, axis: best?.axis ?? axis, link: best, since: this.server.tickNo });
  }

  private processArrival(p: ServerPlayer, a: PendingArrival): void {
    const dim = p.dim;
    if (dim.id !== a.dim) {
      this.pending.delete(p);
      return;
    }
    const r = a.link ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (!dim.isLoaded(a.x + dx * 16, a.z + dz * 16)) return;
    this.pending.delete(p);
    const portalId = a.kind === 'far' ? 'far_portal' : 'nether_portal';
    if (a.link) {
      if (blocks[STATE_BLOCK[dim.getState(a.x, a.y, a.z)]!]!.id === portalId) {
        this.place(p, a.link.x, a.link.y, a.link.z, a.link.axis);
        return;
      }
      // The linked portal was destroyed: forget it and build a new one here
      const list = this.server.level.portals;
      const i = list.indexOf(a.link);
      if (i >= 0) list.splice(i, 1);
    }
    const spot = this.findSpot(dim, a.x, a.z, a.axis) ?? this.forceSpot(dim, a.x, a.z);
    const f = this.build(dim, spot.x, spot.y, spot.z, a.axis, a.kind);
    this.place(p, f.x, f.y, f.z, f.axis);
  }

  private place(p: ServerPlayer, x: number, y: number, z: number, axis: 'x' | 'z'): void {
    const px = x + (axis === 'x' ? 1 : 0.5);
    const pz = z + (axis === 'z' ? 1 : 0.5);
    this.server.teleport(p, px, y, pz);
    p.portalCooldown = 100;
  }

  /** Floor y whose 4x4x3 volume (along the axis) is clear, with solid ground under the frame. */
  private spotOk(dim: Dimension, x: number, y: number, z: number, axis: 'x' | 'z'): boolean {
    for (let i = -1; i <= 2; i++)
      for (let d = -1; d <= 1; d++) {
        const bx = x + (axis === 'x' ? i : d);
        const bz = z + (axis === 'z' ? i : d);
        const g = dim.getState(bx, y - 1, bz);
        if (!STATE_SOLID[g] || STATE_FLUID[g]) return false;
        for (let h = 0; h < 4; h++) {
          const s = dim.getState(bx, y + h, bz);
          if (s !== 0 && !(STATE_REPLACEABLE[s] && !STATE_FLUID[s])) return false;
        }
      }
    return true;
  }

  private findSpot(dim: Dimension, tx: number, tz: number, axis: 'x' | 'z'): { x: number; y: number; z: number } | null {
    const ceiling = dim.rules.hasCeiling;
    for (let r = 0; r <= 16; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = tx + dx;
          const z = tz + dz;
          const top = ceiling ? 120 : Math.min(250, dim.getHeight(x, z) + 1);
          for (let y = top; y > (ceiling ? 32 : 1); y--) {
            if (!ceiling && y < top - 1) break; // overworld: only the surface
            if (this.spotOk(dim, x, y, z, axis)) return { x, y, z };
          }
        }
    }
    return null;
  }

  /** No natural spot: carve room and lay an obsidian platform. */
  private forceSpot(dim: Dimension, tx: number, tz: number): { x: number; y: number; z: number } {
    const y = dim.rules.hasCeiling ? 70 : Math.max(64, Math.min(240, dim.getHeight(tx, tz) + 1));
    for (let i = -1; i <= 2; i++)
      for (let d = -1; d <= 1; d++) {
        for (const [bx, bz] of [
          [tx + i, tz + d],
          [tx + d, tz + i],
        ] as const) {
          dim.setBlock(bx, y - 1, bz, this.obsidian);
          for (let h = 0; h < 4; h++) dim.setBlock(bx, y + h, bz, 0);
        }
      }
    return { x: tx, y, z: tz };
  }

  /** Builds a 4x5 frame whose interior bottom-left is (x, y, z) and lights it. */
  build(dim: Dimension, x: number, y: number, z: number, axis: 'x' | 'z', kind: 'nether' | 'far'): PortalFrame {
    const frame = kind === 'far' ? S('far_portal_frame') : this.obsidian || S('obsidian');
    const at = (i: number, j: number, st: number): void => {
      dim.setBlock(x + (axis === 'x' ? i : 0), y + j, z + (axis === 'z' ? i : 0), st, { updateNeighbors: false });
    };
    for (let i = -1; i <= 2; i++)
      for (let j = -1; j <= 3; j++) {
        const edge = i === -1 || i === 2 || j === -1 || j === 3;
        at(i, j, edge ? frame : 0);
      }
    const f: PortalFrame = { x, y, z, axis, width: 2, height: 3 };
    this.fill(dim, f, kind === 'far' ? 'far_portal' : 'nether_portal');
    this.register(dim, kind, f);
    return f;
  }

  isPending(p: ServerPlayer): boolean {
    return this.pending.has(p);
  }
}
