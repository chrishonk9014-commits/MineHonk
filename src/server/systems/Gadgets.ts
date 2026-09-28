/**
 * Utility items and blocks that act on their own rules: firework rockets,
 * fishing, and (installed alongside) the compass, bell, jukebox, respawn
 * anchor, beacon, leads and riding helpers.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import { type ItemStack, stackOf, markAdmin, toSaved, fromSaved, type SavedStack } from '../../common/game/itemstack';
import { blocks, STATE_BLOCK, getProp, withProp } from '../../common/registry/blocks';
import { Mob } from '../entity/Mob';
import { items } from '../../common/registry/items';
import { FACE_DX, FACE_DY, FACE_DZ } from '../../common/world/constants';
import { Firework } from '../entity/Firework';
import { FishingBobber } from '../entity/FishingBobber';
import { ItemEntity } from '../entity/ItemEntity';
import { Random } from '../../common/math/rng';
import { rollLoot } from '../../common/game/loot';
import { enchantLevel } from '../../common/game/enchanting';
import { lookDir } from './Interaction';
import { Window } from './Containers';
import { STATE_OPAQUE, STATE_FLUID, STATE_SOLID } from '../../common/registry/blocks';
import { raycastBlocks } from '../../common/physics/raycast';
import { isSurvivalLike } from '../../common/game/gamemode';
import type { Chunk } from '../../common/world/chunk';

/** Blocks a beacon pyramid may be built from, and what buys an effect. */
const BEACON_BASE = new Set(['iron_block', 'gold_block', 'diamond_block', 'emerald_block', 'netherite_block']);
const BEACON_PAYMENT = new Set(['iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'netherite_ingot']);
/** Primary effects unlocked per pyramid level; level 4 adds a secondary (regeneration or the primary at level II). */
export const BEACON_PRIMARY: [string, number][] = [
  ['speed', 1],
  ['haste', 1],
  ['resistance', 2],
  ['jump_boost', 2],
  ['strength', 3],
];

/** Blocks that count towards a conduit's frame. */
const CONDUIT_FRAME = new Set(['prismarine', 'prismarine_bricks', 'dark_prismarine', 'sea_lantern']);
/** The 42 frame positions: three 5x5 rings, one in each plane through the conduit. */
const CONDUIT_RINGS: [number, number, number][] = (() => {
  const seen = new Set<string>();
  const out: [number, number, number][] = [];
  for (let a = -2; a <= 2; a++)
    for (let b = -2; b <= 2; b++) {
      if (Math.abs(a) !== 2 && Math.abs(b) !== 2) continue;
      for (const p of [[a, b, 0], [a, 0, b], [0, a, b]] as [number, number, number][]) {
        const k = p.join();
        if (!seen.has(k)) {
          seen.add(k);
          out.push(p);
        }
      }
    }
  return out;
})();

export class Gadgets {
  private readonly rng = new Random();
  /** Cast fishing lines by player. */
  private readonly bobbers = new Map<ServerPlayer, FishingBobber>();

  constructor(private readonly server: GameServer) {}

  // ------------------------------------------------------------------ item use (in the air)

  useItem(p: ServerPlayer, stack: ItemStack, hand: 0 | 1): boolean {
    const id = items[stack.id]!.id;
    switch (id) {
      case 'firework_rocket':
        return this.boost(p, stack, hand);
      case 'fishing_rod':
        return this.fish(p, stack, hand);
      case 'carrot_on_a_stick':
        return !!this.server.mounts?.boostPig(p);
      case 'rift_pearl':
        return this.blink(p, stack, hand);
    }
    return false;
  }

  private readonly blinkReady = new Map<ServerPlayer, number>();

  /**
   * Rift Pearl: an instant, harmless blink up to 24 blocks along the view,
   * stopping short of the first wall and settling onto the floor below.
   */
  private blink(p: ServerPlayer, stack: ItemStack, hand: 0 | 1): boolean {
    const s = this.server;
    if ((this.blinkReady.get(p) ?? 0) > s.tickNo) return true;
    const dim = p.dim;
    const [ex, ey, ez] = s.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const hit = raycastBlocks(dim, ex, ey, ez, d[0], d[1], d[2], 24, { useCollision: true });
    const dist = hit ? Math.max(0, hit.dist - 0.8) : 24;
    const free = (x: number, y: number, z: number): boolean => {
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      const by = Math.floor(y);
      return !STATE_SOLID[dim.getState(bx, by, bz)] && !STATE_SOLID[dim.getState(bx, by + 1, bz)];
    };
    // Walk back along the ray until the player fits
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let found = false;
    for (let t = dist; t >= 1; t -= 0.5) {
      tx = ex + d[0] * t;
      ty = ey + d[1] * t - 1.62;
      tz = ez + d[2] * t;
      if (free(tx, ty, tz)) {
        found = true;
        break;
      }
    }
    if (!found) return true;
    // Settle onto the ground within three blocks so the blink does not end in a fall
    for (let i = 0; i < 3 && free(tx, ty - 1, tz); i++) ty -= 1;
    if (STATE_SOLID[dim.getState(Math.floor(tx), Math.floor(ty) - 1, Math.floor(tz))]) ty = Math.floor(ty);
    s.particles(dim, 'portal', p.x, p.y + 1, p.z, 20, 0.4);
    s.playSound(dim, 'teleport', p.x, p.y, p.z, 1, 1.3);
    s.teleport(p, tx, ty, tz);
    p.body.fallDistance = 0;
    s.particles(dim, 'portal', tx, ty + 1, tz, 20, 0.4);
    s.playSound(dim, 'teleport', tx, ty, tz, 1, 1.5);
    this.consumeHeld(p, stack, hand);
    this.blinkReady.set(p, s.tickNo + 30);
    p.send({ t: 'cooldown', item: stack.id, ticks: 30 });
    p.addStat('used.rift_pearl');
    return true;
  }

  /** Right click on a block face with an item. */
  useOnBlock(p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number, face: number): boolean {
    const id = items[stack.id]!.id;
    if (id === 'compass' && p.dim.blockId(x, y, z) === 'lodestone') return this.linkLodestone(p, stack, x, y, z);
    if (id === 'firework_rocket') {
      if (p.gliding) return this.boost(p, stack, 0);
      this.launch(p.dim, x + FACE_DX[face] + 0.5, y + FACE_DY[face] + 0.1, z + FACE_DZ[face] + 0.5, this.server.interaction.isCheat(p, stack));
      this.consumeHeld(p, stack);
      return true;
    }
    // Fishing rods act on the plain 'use' the client sends as well; handling both would cast and reel at once
    return false;
  }

  private consumeHeld(p: ServerPlayer, stack: ItemStack, hand: 0 | 1 = 0): void {
    if (p.gamemode === 'creative') return;
    const slot = hand === 1 ? 40 : p.selectedSlot;
    const cur = p.inventory.get(slot);
    if (cur && cur.id === stack.id) p.inventory.set(slot, cur.count > 1 ? { ...cur, count: cur.count - 1 } : null);
  }

  // ------------------------------------------------------------------ compasses

  /** A compass used on a lodestone points at it from then on (in that dimension). */
  private linkLodestone(p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number): boolean {
    const linked: ItemStack = { id: stack.id, count: 1, tag: { ...(stack.tag ?? {}), data: { ...(stack.tag?.data ?? {}), lodestone: [x, y, z], dim: p.dim.id } } };
    const slot = p.selectedSlot;
    const cur = p.inventory.get(slot);
    if (!cur || cur.id !== stack.id) return false;
    if (cur.count > 1 && p.gamemode !== 'creative') {
      p.inventory.set(slot, { ...cur, count: cur.count - 1 });
      const rem = p.inventory.add(linked);
      if (rem) this.server.interaction.dropStack(p, rem);
    } else p.inventory.set(slot, { ...cur, tag: linked.tag });
    this.server.playSound(p.dim, 'lodestone.lock', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return true;
  }

  // ------------------------------------------------------------------ jukebox

  /** Playing jukeboxes: key "dim|x,y,z" -> track and who has been told. */
  private readonly records = new Map<string, { dim: Dimension; x: number; y: number; z: number; track: string; told: Set<ServerPlayer> }>();

  useJukebox(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const dim = p.dim;
    const be = dim.getBlockEntity(x, y, z);
    const stored = Array.isArray(be?.items) ? (be!.items as (SavedStack | null)[])[0] : null;
    if (stored) {
      // Eject the record
      dim.setBlockEntity(x, y, z, { type: 'jukebox', items: [null] });
      dim.setBlock(x, y, z, withProp(state, 'has_record', false));
      const st = fromSaved(stored);
      if (st) this.server.mining.dropItem(dim, x + 0.5, y + 1.1, z + 0.5, st);
      this.stopRecord(dim, x, y, z);
      return true;
    }
    const slot = p.selectedSlot;
    const held = p.inventory.get(slot);
    const def = held ? items[held.id]!.def : null;
    if (!held || def?.use !== 'music_disc') return false;
    const track = String(def.data?.track ?? 'meadow');
    dim.setBlockEntity(x, y, z, { type: 'jukebox', items: [toSaved({ ...held, count: 1 })] });
    dim.setBlock(x, y, z, withProp(state, 'has_record', true));
    if (p.gamemode !== 'creative') p.inventory.set(slot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
    this.records.set(`${dim.id}|${x},${y},${z}`, { dim, x, y, z, track, told: new Set() });
    p.addStat('played_record');
    return true;
  }

  /** Whether a record is playing within `r` blocks (parrots dance to it). */
  recordNear(dim: Dimension, x: number, y: number, z: number, r: number): boolean {
    for (const rec of this.records.values()) if (rec.dim === dim && (rec.x + 0.5 - x) ** 2 + (rec.y + 0.5 - y) ** 2 + (rec.z + 0.5 - z) ** 2 <= r * r) return true;
    return false;
  }

  private stopRecord(dim: Dimension, x: number, y: number, z: number): void {
    const k = `${dim.id}|${x},${y},${z}`;
    const r = this.records.get(k);
    if (!r) return;
    for (const pl of r.told) pl.send({ t: 'record', x, y, z, track: null });
    this.records.delete(k);
  }

  // ------------------------------------------------------------------ respawn anchor & bell

  useRespawnAnchor(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const dim = p.dim;
    const charges = parseInt(getProp(state, 'charges') ?? '0', 10);
    const held = p.inventory.get(p.selectedSlot);
    if (held && items[held.id]!.id === 'glowstone' && charges < 4) {
      dim.setBlock(x, y, z, withProp(state, 'charges', charges + 1));
      if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
      this.server.playSound(dim, 'respawn_anchor.charge', x + 0.5, y + 0.5, z + 0.5, 1, 0.8 + charges * 0.1);
      this.server.particles(dim, 'portal', x + 0.5, y + 1, z + 0.5, 8, 0.4);
      return true;
    }
    if (charges === 0) return false;
    if (!dim.rules.respawnAnchorWorks) {
      // Anchors only hold in the Nether; anywhere else a charged one blows up
      dim.setBlock(x, y, z, 0);
      this.server.interaction.explode?.(dim, x + 0.5, y + 0.5, z + 0.5, 5, true, null);
      return true;
    }
    p.spawnPoint = { dim: dim.id, x: x + 0.5, y: y + 1, z: z + 0.5, forced: false, block: [x, y, z] };
    p.send({ t: 'chat', text: 'Respawn point set', kind: 'system' });
    this.server.playSound(dim, 'respawn_anchor.set', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return true;
  }

  /**
   * Whether the bed or anchor a spawn point depends on still holds it (an
   * anchor spends one charge). Unloaded blocks are trusted.
   */
  claimSpawnBlock(p: ServerPlayer): boolean {
    const sp = p.spawnPoint;
    if (!sp?.block) return true;
    const dim = this.server.dim(sp.dim);
    const [x, y, z] = sp.block;
    if (!dim.isLoaded(x, z)) return true;
    const st = dim.getState(x, y, z);
    const id = blocks[STATE_BLOCK[st]!]!.id;
    if (id.endsWith('_bed')) return true;
    if (id !== 'respawn_anchor') return false;
    const charges = parseInt(getProp(st, 'charges') ?? '0', 10);
    if (charges <= 0) return false;
    dim.setBlock(x, y, z, withProp(st, 'charges', charges - 1));
    this.server.playSound(dim, 'respawn_anchor.set', x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
    return true;
  }

  /** Rings a bell: nearby villagers hurry, hidden monsters are revealed for a moment. */
  ringBell(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const s = this.server;
    const dim = p.dim;
    const now = s.tickNo;
    const k = `${dim.id}|${x},${y},${z}`;
    if ((this.bellRung.get(k) ?? -100) > now - 20) return true;
    this.bellRung.set(k, now);
    s.playSound(dim, 'bell.ring', x + 0.5, y + 0.5, z + 0.5, 3, 1);
    s.broadcastNear(dim, x, y, z, 48, { t: 'anim', id: -1, anim: 'swing' });
    for (const e of dim.entitiesNear(x + 0.5, y + 0.5, z + 0.5, 32)) {
      if (!(e instanceof Mob) || e.dead) continue;
      if (e.def.category === 'monster') s.mobs?.glow(e, 60);
      else if (e.type === 'villager') {
        e.revengeTarget = null;
        e.data.alarmTicks = 200;
      }
    }
    p.addStat('bells_rung');
    return true;
  }
  private readonly bellRung = new Map<string, number>();

  // ------------------------------------------------------------------ cauldron & flower pot

  /** Buckets and bottles fill and empty a cauldron. */
  useCauldron(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const slot = p.selectedSlot;
    const held = p.inventory.get(slot);
    if (!held) return false;
    const id = items[held.id]!.id;
    const level = parseInt(getProp(state, 'level') ?? '0', 10);
    const it = this.server.interaction;
    const set = (l: number): void => {
      p.dim.setBlock(x, y, z, withProp(state, 'level', l));
    };
    const creative = p.gamemode === 'creative';
    if (id === 'water_bucket' && level < 3) {
      set(3);
      if (!creative) p.inventory.set(slot, stackOf('bucket', 1));
      this.server.playSound(p.dim, 'bucket.empty', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      return true;
    }
    if (id === 'bucket' && level === 3) {
      set(0);
      if (!creative) it.replaceOne(p, slot, stackOf('water_bucket', 1));
      this.server.playSound(p.dim, 'bucket.fill', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      return true;
    }
    if (id === 'glass_bottle' && level > 0) {
      set(level - 1);
      if (!creative) it.replaceOne(p, slot, stackOf('potion', 1, { tag: { potion: 'water' } }));
      this.server.playSound(p.dim, 'bucket.fill', x + 0.5, y + 0.5, z + 0.5, 0.6, 1.4);
      return true;
    }
    if (id === 'potion' && (held.tag?.potion ?? 'water') === 'water' && level < 3) {
      set(level + 1);
      if (!creative) p.inventory.set(slot, stackOf('glass_bottle', 1));
      this.server.playSound(p.dim, 'bucket.empty', x + 0.5, y + 0.5, z + 0.5, 0.6, 1.4);
      return true;
    }
    return false;
  }

  /** Puts a plant into an empty pot, or takes it back out. */
  useFlowerPot(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const plant = getProp(state, 'plant') ?? 'none';
    if (plant !== 'none') {
      p.dim.setBlock(x, y, z, withProp(state, 'plant', 'none'));
      const rem = p.inventory.add(stackOf(plant, 1));
      if (rem) this.server.interaction.dropStack(p, rem);
      return true;
    }
    const held = p.inventory.get(p.selectedSlot);
    if (!held) return false;
    const id = items[held.id]!.id;
    const next = withProp(state, 'plant', id);
    if (next === state) return false;
    p.dim.setBlock(x, y, z, next);
    if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
    this.server.playSound(p.dim, 'place.grass', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return true;
  }

  // ------------------------------------------------------------------ candles & signs

  /** Flint and steel lights candles, another candle adds to the group, a bare hand snuffs them. */
  useCandle(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const held = p.inventory.get(p.selectedSlot);
    const id = held ? items[held.id]!.id : null;
    const lit = getProp(state, 'lit') === 'true';
    const n = parseInt(getProp(state, 'candles') ?? '1', 10);
    const c = [x + 0.5, y + 0.4, z + 0.5] as const;
    if (id === 'candle' && n < 4) {
      p.dim.setBlock(x, y, z, withProp(state, 'candles', n + 1));
      if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, held!.count > 1 ? { ...held!, count: held!.count - 1 } : null);
      this.server.playSound(p.dim, 'place.wool', ...c, 1, 1);
      return true;
    }
    if ((id === 'flint_and_steel' || id === 'fire_charge') && !lit) {
      p.dim.setBlock(x, y, z, withProp(state, 'lit', true));
      this.server.playSound(p.dim, 'ignite', ...c, 1, 1);
      if (isSurvivalLike(p.gamemode)) {
        if (id === 'flint_and_steel') this.server.interaction.damageHeldSlot(p, p.selectedSlot, 1);
        else p.inventory.set(p.selectedSlot, held!.count > 1 ? { ...held!, count: held!.count - 1 } : null);
      }
      return true;
    }
    if (lit && !held) {
      p.dim.setBlock(x, y, z, withProp(state, 'lit', false));
      this.server.playSound(p.dim, 'fire.extinguish', ...c, 0.4, 1.6);
      this.server.particles(p.dim, 'smoke', x + 0.5, y + 0.6, z + 0.5, 3, 0.1);
      return true;
    }
    return false;
  }

  /** An ink sac wipes a sign's glow; a glow ink sac makes its text shine in the dark. */
  inkSign(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const held = p.inventory.get(p.selectedSlot);
    if (!held) return false;
    const id = items[held.id]!.id;
    if (id !== 'glow_ink_sac' && id !== 'ink_sac') return false;
    const be = p.dim.getBlockEntity(x, y, z);
    if (!be || be.type !== 'sign') return false;
    const glow = id === 'glow_ink_sac';
    if ((be.glow === true) === glow) return false;
    const next = { type: 'sign', lines: Array.isArray(be.lines) ? be.lines : ['', '', '', ''], ...(glow ? { glow: true } : {}) };
    p.dim.setBlockEntity(x, y, z, next);
    this.server.sendToWatchers(p.dim, x, z, { t: 'block_entity', x, y, z, data: next });
    if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
    this.server.playSound(p.dim, glow ? 'glow_ink' : 'ink', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return true;
  }

  // ------------------------------------------------------------------ conduit

  private readonly conduits = new Map<string, { dim: Dimension; x: number; y: number; z: number }>();

  /** Remembers a placed conduit so it pulses without a block entity. */
  addConduit(dim: Dimension, x: number, y: number, z: number): void {
    this.conduits.set(`${dim.id}|${x},${y},${z}`, { dim, x, y, z });
  }

  /**
   * Frame blocks around a conduit: prismarine family blocks on the three
   * 5x5 rings centred on it. 16 wake it up; a full frame widens the range.
   */
  conduitFrame(dim: Dimension, x: number, y: number, z: number): number {
    let n = 0;
    for (const [dx, dy, dz] of CONDUIT_RINGS) if (CONDUIT_FRAME.has(dim.blockId(x + dx, y + dy, z + dz))) n++;
    return n;
  }

  /** The conduit needs water all around it (the 3x3x3 around the core). */
  private conduitWet(dim: Dimension, x: number, y: number, z: number): boolean {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dy && !dz) continue;
          if (STATE_FLUID[dim.getState(x + dx, y + dy, z + dz)] !== 1) return false;
        }
    return true;
  }

  private pulseConduit(key: string, c: { dim: Dimension; x: number; y: number; z: number }): void {
    const { dim, x, y, z } = c;
    if (!dim.isLoaded(x, z)) return;
    if (dim.blockId(x, y, z) !== 'conduit') {
      this.conduits.delete(key);
      return;
    }
    const frame = this.conduitFrame(dim, x, y, z);
    if (frame < 16 || !this.conduitWet(dim, x, y, z)) return;
    const range = Math.floor(frame / 7) * 16;
    const s = this.server;
    s.particles(dim, 'bubble', x + 0.5, y + 0.5, z + 0.5, 6, 0.8);
    for (const pl of s.players.values()) {
      if (pl.dim !== dim || pl.dead) continue;
      if ((pl.x - x - 0.5) ** 2 + (pl.y - y - 0.5) ** 2 + (pl.z - z - 0.5) ** 2 > range * range) continue;
      const wet = STATE_FLUID[dim.getState(Math.floor(pl.x), Math.floor(pl.y + 1.5), Math.floor(pl.z))] === 1 || STATE_FLUID[dim.getState(Math.floor(pl.x), Math.floor(pl.y), Math.floor(pl.z))] === 1;
      if (!wet) continue;
      s.interaction.survival.addEffect(pl, 'water_breathing', 0, 260);
      s.interaction.survival.addEffect(pl, 'night_vision', 0, 260);
    }
    if (frame >= 42) {
      // A full frame also bites hostile swimmers close by
      for (const e of dim.entitiesNear(x + 0.5, y + 0.5, z + 0.5, 8)) {
        if (e instanceof Mob && !e.dead && e.def.category === 'monster' && STATE_FLUID[dim.getState(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))] === 1) {
          e.hurt(4, { source: 'magic', attacker: null });
        }
      }
    }
  }

  // ------------------------------------------------------------------ beacon

  private readonly beacons = new Map<string, { dim: Dimension; x: number; y: number; z: number }>();

  onChunk(dim: Dimension, c: Chunk): void {
    for (const [k, be] of c.blockEntities) {
      if (be.type !== 'beacon' && be.type !== 'conduit') continue;
      const x = (c.cx << 4) + (k & 15);
      const z = (c.cz << 4) + ((k >> 4) & 15);
      (be.type === 'beacon' ? this.beacons : this.conduits).set(`${dim.id}|${x},${k >> 8},${z}`, { dim, x, y: k >> 8, z });
    }
  }

  /** Pyramid levels (0-4) under a beacon. */
  beaconLevels(dim: Dimension, x: number, y: number, z: number): number {
    let levels = 0;
    for (let l = 1; l <= 4; l++) {
      const yy = y - l;
      if (yy < 0) break;
      for (let dx = -l; dx <= l; dx++)
        for (let dz = -l; dz <= l; dz++) {
          if (!BEACON_BASE.has(dim.blockId(x + dx, yy, z + dz))) return levels;
        }
      levels = l;
    }
    return levels;
  }

  /** The beam needs open sky: nothing opaque above the beacon. */
  private beaconClear(dim: Dimension, x: number, y: number, z: number): boolean {
    if (!dim.rules.hasSky) return true;
    for (let yy = y + 1; yy < 256; yy++) if (STATE_OPAQUE[dim.getState(x, yy, z)]) return false;
    return true;
  }

  useBeacon(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const s = this.server;
    const dim = p.dim;
    let be = dim.getBlockEntity(x, y, z);
    if (!be || be.type !== 'beacon') {
      be = { type: 'beacon', primary: null, secondary: null, levels: 0, beam: false };
      dim.setBlockEntity(x, y, z, be);
    }
    this.beacons.set(`${dim.id}|${x},${y},${z}`, { dim, x, y, z });
    const cont = s.interaction.containers;
    const w = cont.allocWindow('beacon', 'Beacon', 1);
    w.pos = { dim, x, y, z };
    let payment: ItemStack | null = null;
    let pickPrimary: string | null = (be.primary as string | null) ?? null;
    let pickSecondary: string | null = (be.secondary as string | null) ?? null;
    const refresh = (): void => {
      const levels = this.beaconLevels(dim, x, y, z);
      w.props = {
        levels,
        primary: pickPrimary,
        secondary: pickSecondary,
        active: be!.primary ?? null,
        paid: !!payment && BEACON_PAYMENT.has(items[payment.id]!.id),
      };
    };
    w.refresh = refresh;
    w.slots.push({
      get: () => payment,
      set: (st) => {
        payment = st;
        refresh();
      },
      mayPlace: (st) => BEACON_PAYMENT.has(items[st.id]!.id),
      max: () => 1,
      group: 'input',
    });
    (w as Window & { select?: (i: number) => void }).select = (i: number) => {
      const levels = this.beaconLevels(dim, x, y, z);
      if (i >= 0 && i < BEACON_PRIMARY.length) {
        const [eff, need] = BEACON_PRIMARY[i]!;
        if (levels >= need) pickPrimary = eff;
      } else if (i === 10 && levels >= 4) pickSecondary = 'regeneration';
      else if (i === 11 && levels >= 4) pickSecondary = pickPrimary;
      else if (i === 20 && payment && pickPrimary && levels > 0) {
        // Confirm: the payment is consumed and the beacon switches effects
        payment = null;
        be!.primary = pickPrimary;
        be!.secondary = levels >= 4 ? pickSecondary : null;
        dim.setBlockEntity(x, y, z, be!);
        s.playSound(dim, 'beacon.power', x + 0.5, y + 0.5, z + 0.5, 1.5, 1);
        this.pulseBeacon(dim, x, y, z, true);
      }
      refresh();
    };
    cont.addPlayerSlots(w, p);
    w.onClose = (pl) => {
      if (payment) {
        const rem = pl.inventory.add(payment);
        if (rem) s.interaction.dropStack(pl, rem);
        payment = null;
      }
    };
    refresh();
    s.interaction.openCustomWindow(p, w);
    return true;
  }

  /** Updates a beacon's level and beam and gives its effects to players in range. */
  private pulseBeacon(dim: Dimension, x: number, y: number, z: number, force = false): void {
    const s = this.server;
    const be = dim.getBlockEntity(x, y, z);
    if (!be || be.type !== 'beacon') return;
    const levels = this.beaconLevels(dim, x, y, z);
    const beam = levels > 0 && this.beaconClear(dim, x, y, z);
    if (be.levels !== levels || be.beam !== beam || force) {
      be.levels = levels;
      be.beam = beam;
      dim.setBlockEntity(x, y, z, be);
      s.sendToWatchers(dim, x, z, { t: 'block_entity', x, y, z, data: be });
      if (beam && !force) s.playSound(dim, 'beacon.power', x + 0.5, y + 0.5, z + 0.5, 1.5, 1);
    }
    if (!beam || !be.primary) return;
    const range = 10 + levels * 10;
    const ticks = (9 + levels * 2) * 20;
    const primary = String(be.primary);
    const secondary = be.secondary ? String(be.secondary) : null;
    for (const pl of s.players.values()) {
      if (pl.dim !== dim || pl.dead || Math.abs(pl.x - x - 0.5) > range || Math.abs(pl.z - z - 0.5) > range) continue;
      s.interaction.survival.addEffect(pl, primary, secondary === primary ? 1 : 0, ticks);
      if (secondary && secondary !== primary) s.interaction.survival.addEffect(pl, secondary, 0, ticks);
    }
  }

  // ------------------------------------------------------------------ fireworks

  /** Launches a decorative rocket that bursts after about a second and a half. */
  launch(dim: Dimension, x: number, y: number, z: number, cheat = false): Firework {
    const f = new Firework(28 + this.rng.int(10), this.rng.int(360));
    f.setPos(x, y, z);
    f.vx = (this.rng.next() - 0.5) * 0.002;
    f.vz = (this.rng.next() - 0.5) * 0.002;
    f.admin = cheat;
    dim.addEntity(f);
    this.server.playSound(dim, 'firework.launch', x, y, z, 2, 1);
    return f;
  }

  /** While gliding, a rocket pushes the player along their look direction. */
  private boost(p: ServerPlayer, stack: ItemStack, hand: 0 | 1): boolean {
    if (!p.gliding) return false;
    const ticks = 22;
    p.boostUntil = this.server.tickNo + ticks + 20;
    p.send({ t: 'boost', ticks });
    this.consumeHeld(p, stack, hand);
    this.server.playSound(p.dim, 'firework.launch', p.x, p.y, p.z, 2, 1.1);
    this.boosting.set(p, this.server.tickNo + ticks);
    return true;
  }
  private readonly boosting = new Map<ServerPlayer, number>();

  // ------------------------------------------------------------------ fishing

  private fish(p: ServerPlayer, stack: ItemStack, hand: 0 | 1): boolean {
    const s = this.server;
    const cur = this.bobbers.get(p);
    if (cur && !cur.removed) {
      this.reel(p, cur, hand);
      return true;
    }
    const [ex, ey, ez] = s.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const b = new FishingBobber(p, enchantLevel(stack, 'lure'), enchantLevel(stack, 'luck_of_the_sea'));
    b.setPos(ex + d[0] * 0.4, ey - 0.2 + d[1] * 0.4, ez + d[2] * 0.4);
    b.body.vx = d[0] * 0.9 + (this.rng.next() - 0.5) * 0.05 + p.body.vx;
    b.body.vy = d[1] * 0.9 + 0.15;
    b.body.vz = d[2] * 0.9 + (this.rng.next() - 0.5) * 0.05 + p.body.vz;
    b.admin = s.interaction.isCheat(p, stack);
    p.dim.addEntity(b);
    this.bobbers.set(p, b);
    s.playSound(p.dim, 'fishing.cast', p.x, p.y + 1.5, p.z, 0.6, 0.8 + this.rng.next() * 0.3);
    return true;
  }

  private reel(p: ServerPlayer, b: FishingBobber, hand: 0 | 1): void {
    const s = this.server;
    const slot = hand === 1 ? 40 : p.selectedSlot;
    if (b.biting) {
      const drops = rollLoot('gameplay/fishing', { rng: b.rng, luck: b.luck });
      for (const st of drops) {
        // The catch flies to the angler
        const it = new ItemEntity(b.admin ? markAdmin(st) : st);
        it.setPos(b.x, b.y + 0.2, b.z);
        const dx = p.x - b.x;
        const dy = p.y + 1 - b.y;
        const dz = p.z - b.z;
        it.body.vx = dx * 0.1;
        it.body.vy = dy * 0.1 + Math.sqrt(Math.hypot(dx, dy, dz)) * 0.08;
        it.body.vz = dz * 0.1;
        b.dim.addEntity(it);
        p.addStat('fish_caught');
      }
      s.mining.dropXp(p.dim, p.x, p.y + 0.5, p.z, 1 + this.rng.int(6), b.admin);
      s.interaction.damageStack(p, slot, 1);
    } else if (b.state === 'ground') s.interaction.damageStack(p, slot, 2);
    s.playSound(p.dim, 'fishing.reel', p.x, p.y + 1.5, p.z, 0.6, 1);
    b.remove();
    this.bobbers.delete(p);
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    // Big dripleaves tip over under anyone standing on them
    if (s.tickNo % 5 === 0) {
      for (const p of s.players.values()) {
        if (p.dead || p.gamemode === 'spectator' || p.sneaking) continue;
        const bx = Math.floor(p.x);
        const by = Math.floor(p.y - 0.2);
        const bz = Math.floor(p.z);
        if (p.dim.blockId(bx, by, bz) === 'big_dripleaf') s.blockUpdates.stepOnDripleaf(p.dim, bx, by, bz);
      }
    }
    // Beacons pulse every four seconds
    if (s.tickNo % 80 === 0) {
      for (const [k, b] of this.beacons) {
        if (!b.dim.isLoaded(b.x, b.z)) continue;
        if (b.dim.blockId(b.x, b.y, b.z) !== 'beacon') {
          this.beacons.delete(k);
          continue;
        }
        this.pulseBeacon(b.dim, b.x, b.y, b.z);
      }
      for (const [k, c] of this.conduits) this.pulseConduit(k, c);
    }
    // Jukeboxes: tell players who come within earshot; stop when the jukebox is gone
    if (s.tickNo % 20 === 0) {
      for (const [k, r] of this.records) {
        if (!r.dim.isLoaded(r.x, r.z) || r.dim.blockId(r.x, r.y, r.z) !== 'jukebox' || !r.dim.getBlockEntity(r.x, r.y, r.z)?.items || !(r.dim.getBlockEntity(r.x, r.y, r.z)!.items as unknown[])[0]) {
          for (const pl of r.told) pl.send({ t: 'record', x: r.x, y: r.y, z: r.z, track: null });
          this.records.delete(k);
          continue;
        }
        for (const pl of s.players.values()) {
          const near = pl.dim === r.dim && pl.distanceSq(r.x + 0.5, r.y + 0.5, r.z + 0.5) < 64 * 64;
          if (near && !r.told.has(pl)) {
            r.told.add(pl);
            pl.send({ t: 'record', x: r.x, y: r.y, z: r.z, track: r.track });
          } else if (!near && r.told.has(pl)) {
            r.told.delete(pl);
            pl.send({ t: 'record', x: r.x, y: r.y, z: r.z, track: null });
          }
        }
        for (const pl of r.told) if (!s.players.has(pl.conn.id)) r.told.delete(pl);
      }
    }
    // Lines snap when the angler walks off, changes item or dimension
    for (const [p, b] of this.bobbers) {
      const held = [p.inventory.get(p.selectedSlot), p.inventory.get(40)].some((st) => st && items[st.id]!.id === 'fishing_rod');
      if (b.removed || p.dead || p.dim !== b.dim || !s.players.has(p.conn.id) || !held || p.distanceSq(b.x, b.y, b.z) > 32 * 32) {
        b.remove();
        this.bobbers.delete(p);
      }
    }
    // Rocket trails behind boosted gliders
    for (const [p, until] of this.boosting) {
      if (s.tickNo > until || !p.gliding) {
        this.boosting.delete(p);
        continue;
      }
      if (s.tickNo % 2 === 0) s.particles(p.dim, 'firework_trail', p.x, p.y + 0.4, p.z, 2, 0.1);
    }
  }

  /** The bobber a player has out, if any (tests and the client line). */
  bobberOf(p: ServerPlayer): FishingBobber | undefined {
    return this.bobbers.get(p);
  }
}

export { stackOf };
