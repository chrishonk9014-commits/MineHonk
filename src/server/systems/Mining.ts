/**
 * Authoritative block breaking. The client predicts progress; the server
 * validates reach, line of sight, permissions and elapsed time.
 */
import { markAdmin } from '../../common/game/itemstack';
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { C2S } from '../../common/net/protocol';
import { breakTicks, adventureMayBreak } from '../../common/game/mining';
import { computeBlockDrops } from '../../common/game/drops';
import { enchantLevel } from '../../common/game/enchanting';
import { blocks, STATE_BLOCK, getProp, S, STATE_FLUID, withProp } from '../../common/registry/blocks';
import { items } from '../../common/registry/items';
import { raycastBlocks } from '../../common/physics/raycast';
import { REACH_CREATIVE, REACH_SURVIVAL, FACE_DX, FACE_DY, FACE_DZ } from '../../common/world/constants';
import { Random } from '../../common/math/rng';
import { isSurvivalLike } from '../../common/game/gamemode';
import type { Dimension } from '../world/Dimension';
import { ItemEntity, XpOrb, splitXp } from '../entity/ItemEntity';
import type { ItemStack } from '../../common/game/itemstack';
import { ARMOR_SLOTS } from '../player/Inventory';

const rng = new Random();

export class Mining {
  constructor(private readonly server: GameServer) {}

  private reachOk(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const [ex, ey, ez] = this.server.eyePos(p);
    const reach = (p.gamemode === 'creative' ? REACH_CREATIVE : REACH_SURVIVAL) + 1.5;
    const dx = x + 0.5 - ex;
    const dy = y + 0.5 - ey;
    const dz = z + 0.5 - ez;
    return dx * dx + dy * dy + dz * dz <= reach * reach;
  }

  /** Line of sight from the eye to any point of the block (no solid block in between). */
  private sightOk(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const [ex, ey, ez] = this.server.eyePos(p);
    const targets: [number, number, number][] = [
      [x + 0.5, y + 0.5, z + 0.5],
      [x + 0.5, y + 0.95, z + 0.5],
      [x + 0.5, y + 0.05, z + 0.5],
      [x + 0.05, y + 0.5, z + 0.5],
      [x + 0.95, y + 0.5, z + 0.5],
      [x + 0.5, y + 0.5, z + 0.05],
      [x + 0.5, y + 0.5, z + 0.95],
    ];
    for (const [tx, ty, tz] of targets) {
      const dx = tx - ex;
      const dy = ty - ey;
      const dz = tz - ez;
      const dist = Math.hypot(dx, dy, dz);
      const hit = raycastBlocks(p.dim, ex, ey, ez, dx, dy, dz, dist + 0.01, { useCollision: false });
      if (!hit || (hit.x === x && hit.y === y && hit.z === z)) return true;
    }
    return false;
  }

  private ctxFor(p: ServerPlayer): Parameters<typeof breakTicks>[1] {
    const helmet = p.inventory.get(ARMOR_SLOTS.head);
    return {
      tool: p.heldItem(),
      onGround: p.body.onGround || p.abilities.flying,
      underwater: p.body.eyesInWater,
      aquaAffinity: enchantLevel(helmet, 'aqua_affinity') > 0,
      haste: p.effects.has('haste') ? p.effects.get('haste')!.amp + 1 : 0,
      fatigue: p.effects.has('mining_fatigue') ? p.effects.get('mining_fatigue')!.amp + 1 : 0,
      creative: p.gamemode === 'creative',
    };
  }

  private reject(p: ServerPlayer, x: number, y: number, z: number): void {
    p.send({ t: 'block', x, y, z, state: p.dim.getState(x, y, z) });
    const be = p.dim.getBlockEntity(x, y, z);
    if (be) p.send({ t: 'block_entity', x, y, z, data: be });
    p.dig = null;
  }

  handleDig(p: ServerPlayer, m: C2S & { t: 'dig' }): void {
    const { x, y, z } = m;
    const dim = p.dim;
    if (m.action === 'abort') {
      if (p.dig) this.server.broadcastNear(dim, x, y, z, 64, { t: 'dig_progress', x, y, z, stage: -1, by: p.id }, p);
      p.dig = null;
      return;
    }
    if (p.gamemode === 'spectator') return this.reject(p, x, y, z);
    if (!dim.isLoaded(x, z)) return;
    const state = dim.getState(x, y, z);
    if (state === 0 || STATE_FLUID[state]) return this.reject(p, x, y, z);
    if (!p.abilities.mayBuild && !(p.gamemode === 'adventure' && adventureMayBreak(state, p.heldItem()))) return this.reject(p, x, y, z);
    if (!this.reachOk(p, x, y, z) || !this.sightOk(p, x, y, z)) {
      this.server.log(`[anticheat] ${p.name} dig out of reach/sight at ${x},${y},${z}`);
      return this.reject(p, x, y, z);
    }
    if (!this.server.interaction.canModify(p, dim, x, y, z, true)) return this.reject(p, x, y, z);
    const held = p.heldItem();
    if (p.gamemode === 'creative' && held && items[held.id]?.def.tool?.type === 'sword') return this.reject(p, x, y, z);

    if (m.action === 'start') {
      // Interacting blocks that react to left click
      const ticks = breakTicks(state, this.ctxFor(p));
      if (!Number.isFinite(ticks)) return this.reject(p, x, y, z);
      if (ticks === 0) {
        this.breakBlock(p, x, y, z, state);
        return;
      }
      p.dig = { x, y, z, state, startTick: this.server.tickNo, ticks, lastStage: -1 };
      return;
    }
    // finish
    const d = p.dig;
    if (!d || d.x !== x || d.y !== y || d.z !== z || d.state !== state) return this.reject(p, x, y, z);
    // Recompute: conditions (tool, ground) may have changed; use the most lenient of the two.
    const nowTicks = breakTicks(state, this.ctxFor(p));
    const need = Math.min(d.ticks, nowTicks);
    const elapsed = this.server.tickNo - d.startTick;
    // Allow ~30% tolerance for latency jitter.
    if (elapsed + 2 < need * 0.7) {
      this.server.log(`[anticheat] ${p.name} broke block too fast (${elapsed}/${need} ticks)`);
      return this.reject(p, x, y, z);
    }
    p.dig = null;
    this.breakBlock(p, x, y, z, state);
  }

  tick(): void {
    for (const p of this.server.players.values()) {
      const d = p.dig;
      if (!d) continue;
      const elapsed = this.server.tickNo - d.startTick;
      if (elapsed > d.ticks * 3 + 200 || p.dim.getState(d.x, d.y, d.z) !== d.state) {
        this.server.broadcastNear(p.dim, d.x, d.y, d.z, 64, { t: 'dig_progress', x: d.x, y: d.y, z: d.z, stage: -1, by: p.id }, p);
        p.dig = null;
        continue;
      }
      const stage = Math.min(9, Math.floor((elapsed / d.ticks) * 10));
      if (stage !== d.lastStage) {
        d.lastStage = stage;
        this.server.broadcastNear(p.dim, d.x, d.y, d.z, 64, { t: 'dig_progress', x: d.x, y: d.y, z: d.z, stage, by: p.id }, p);
      }
      if (elapsed % 4 === 0) {
        const def = blocks[STATE_BLOCK[d.state]!]!.def;
        this.server.playSound(p.dim, 'hit.' + def.sound, d.x + 0.5, d.y + 0.5, d.z + 0.5, 0.25, 0.5, p);
      }
    }
  }

  /** Removes a block as if broken by a player (drops, durability, stats, companions). */
  breakBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): void {
    const dim = p.dim;
    const bt = blocks[STATE_BLOCK[state]!]!;
    const def = bt.def;
    const survival = isSurvivalLike(p.gamemode);
    const tool = p.heldItem();
    this.server.interaction.beforeBlockBroken(p, dim, x, y, z, state);
    // Replacement block: ice leaves water; everything else becomes air.
    let replacement = 0;
    if (def.id === 'ice' && survival && dim.id !== 'nether') {
      const below = dim.getState(x, y - 1, z);
      if (below !== 0 && !STATE_FLUID[below]) replacement = S('water');
    }
    // Generated loot chests fill themselves before they can spill
    if (survival) this.server.interaction.containers.materializeLoot(dim, x, y, z, 27, this.server.admin.inContext(p));
    const be = dim.getBlockEntity(x, y, z);
    // Breaking a cheat-placed block, or with a cheat tool, or under a cheat: the drops are cheat-made
    const cheat = this.server.admin.blockMarked(dim, x, y, z) || this.server.interaction.isCheat(p, tool);
    dim.setBlock(x, y, z, replacement);
    this.server.admin.setBlockMark(dim, x, y, z, false);
    this.removeCompanion(dim, x, y, z, state);
    this.server.particles(dim, 'block', x + 0.5, y + 0.5, z + 0.5, 30, 0.5, state);
    this.server.playSound(dim, 'break.' + def.sound, x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
    this.server.broadcastNear(dim, x, y, z, 64, { t: 'dig_progress', x, y, z, stage: -1, by: p.id }, p);
    p.addStat('mined.' + bt.id);
    p.addStat('blocks_mined');
    if (survival) {
      const drops = computeBlockDrops(state, tool, rng);
      if (cheat) for (const s of drops.items) markAdmin(s);
      for (const s of drops.items) this.dropItem(dim, x + 0.5, y + 0.3, z + 0.5, s);
      if (drops.xp > 0) this.dropXp(dim, x + 0.5, y + 0.5, z + 0.5, drops.xp, cheat);
      // Container contents spill
      if (be && Array.isArray((be as { items?: unknown }).items)) this.server.interaction.spillContainer(dim, x, y, z, be);
      if (def.hardness > 0) this.server.interaction.damageHeld(p, 1);
      this.server.interaction.survival.exhaust(p, 0.005);
      this.server.interaction.onBlockMined(p, bt.id, drops.items, cheat);
    }
  }

  /** Doors, beds and tall plants occupy two blocks; remove the partner. */
  private removeCompanion(dim: Dimension, x: number, y: number, z: number, state: number): void {
    const def = blocks[STATE_BLOCK[state]!]!.def;
    if (def.model === 'door' || def.model === 'double_plant') {
      const upper = getProp(state, 'half') === 'upper';
      const oy = upper ? y - 1 : y + 1;
      if (STATE_BLOCK[dim.getState(x, oy, z)] === STATE_BLOCK[state]) dim.setBlock(x, oy, z, 0);
    } else if (def.model === 'bed') {
      const facing = getProp(state, 'facing')!;
      const head = getProp(state, 'part') === 'head';
      const f = { north: 2, south: 3, west: 4, east: 5 }[facing]!;
      const dir = head ? -1 : 1;
      const ox = x + FACE_DX[f] * dir;
      const oz = z + FACE_DZ[f] * dir;
      if (STATE_BLOCK[dim.getState(ox, y, oz)] === STATE_BLOCK[state]) dim.setBlock(ox, y, oz, 0);
    } else if (def.model === 'chest') {
      // Detach the partner half of a double chest
      const type = getProp(state, 'type');
      if (type && type !== 'single') {
        for (let f = 2; f < 6; f++) {
          const nx = x + FACE_DX[f];
          const nz = z + FACE_DZ[f];
          const ns = dim.getState(nx, y, nz);
          if (STATE_BLOCK[ns] === STATE_BLOCK[state] && getProp(ns, 'type') !== 'single') dim.setBlock(nx, y, nz, withProp(ns, 'type', 'single'), { keepBlockEntity: true });
        }
      }
    }
    void FACE_DY;
  }

  dropItem(dim: Dimension, x: number, y: number, z: number, stack: ItemStack, velocity = true): ItemEntity {
    const e = new ItemEntity(stack);
    e.setPos(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    if (velocity) {
      e.body.vx = (Math.random() - 0.5) * 0.2;
      e.body.vy = 0.2;
      e.body.vz = (Math.random() - 0.5) * 0.2;
    }
    dim.addEntity(e);
    return e;
  }

  dropXp(dim: Dimension, x: number, y: number, z: number, amount: number, cheat = false): void {
    for (const v of splitXp(amount)) {
      const o = new XpOrb(v);
      o.admin = cheat;
      o.setPos(x, y, z);
      o.body.vx = (Math.random() - 0.5) * 0.2;
      o.body.vy = 0.2 + Math.random() * 0.1;
      o.body.vz = (Math.random() - 0.5) * 0.2;
      dim.addEntity(o);
    }
  }

  /** Drops what a block yields when destroyed without a tool (explosions). */
  dropBlock(dim: Dimension, x: number, y: number, z: number, state: number, cheat = false): void {
    const drops = computeBlockDrops(state, null, this.dropRng);
    const marked = cheat || this.server.admin.blockMarked(dim, x, y, z);
    for (const st of drops.items) this.dropItem(dim, x + 0.5, y + 0.3, z + 0.5, marked ? markAdmin(st) : st);
  }

  private readonly dropRng = new Random();
}
