/**
 * Player interaction coordinator: block use, placement, item use, drops,
 * durability, respawning and progression hooks. Sub-systems (survival,
 * containers, weather, combat) are owned here.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../player/ServerPlayer';
import { Survival, type DamageInfo } from './Survival';
import { Containers, type Window } from './Containers';
import { Weather } from './Weather';
import type { C2S } from '../../common/net/protocol';
import { type ItemStack, type Slot, cloneStack, itemIdOf, stackOf, isAdminStack } from '../../common/game/itemstack';
import { items, itemById } from '../../common/registry/items';
import { blocks, STATE_BLOCK, getProp, withProp, S, stateOf, STATE_FLUID, STATE_SOLID, STATE_REPLACEABLE, blockHasTag } from '../../common/registry/blocks';
import { computePlacement, canSurvive, chestPartnerUpdate } from '../../common/game/placement';
import { REACH_CREATIVE, REACH_SURVIVAL, FACE_DX, FACE_DY, FACE_DZ, FACE_NAMES } from '../../common/world/constants';
import { AABB } from '../../common/physics/aabb';
import { isSurvivalLike, maxHealthFor } from '../../common/game/gamemode';
import type { Dimension } from '../world/Dimension';
import { enchantLevel } from '../../common/game/enchanting';
import { raycastBlocks } from '../../common/physics/raycast';
import { Random } from '../../common/math/rng';
import { ItemEntity } from '../entity/ItemEntity';
import { FallingBlock } from '../entity/FallingBlock';
import { ACHIEVEMENT_BY_ID } from '../../common/data/achievements';
import type { Entity } from '../entity/Entity';
import { LivingEntity } from '../entity/Living';
import { growTree } from '../../common/gen/features/trees';
import { OFFHAND, ARMOR_START } from '../player/Inventory';

const rng = new Random();

interface UsingState {
  slot: number;
  hand: 0 | 1;
  item: number;
  start: number;
  duration: number;
  kind: 'eat' | 'bow' | 'block';
}

/** Block interactions (by interact kind or block id) that visitors may not use. */
const VISITOR_BLOCKED = new Set(['chest', 'barrel', 'furnace', 'blast_furnace', 'smoker', 'brewing_stand', 'anvil', 'chipped_anvil', 'damaged_anvil', 'sign', 'jukebox', 'note_block', 'composter', 'cauldron', 'lectern', 'respawn_anchor', 'end_portal_frame', 'far_portal_frame']);

export class Interaction {
  readonly survival: Survival;
  readonly containers: Containers;
  readonly weather: Weather;
  private readonly using = new Map<ServerPlayer, UsingState>();
  /** Hook for systems added later (combat, mobs, portals, enchanting...). */
  hooks: {
    attack?: (p: ServerPlayer, target: Entity) => void;
    interactEntity?: (p: ServerPlayer, target: Entity, hand: 0 | 1) => boolean;
    hurtEntity?: (e: Entity, amount: number, source: string, attacker: Entity | null) => void;
    useItem?: (p: ServerPlayer, stack: ItemStack, hand: 0 | 1) => boolean;
    useItemOnBlock?: (p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number, face: number) => boolean;
    releaseItem?: (p: ServerPlayer, stack: ItemStack, ticks: number) => void;
    useBlock?: (p: ServerPlayer, x: number, y: number, z: number, state: number) => boolean;
    restore?: (dim: Dimension, data: Record<string, unknown>) => Entity | null;
    onDimension?: (p: ServerPlayer, dim: string) => void;
    windowAction?: (p: ServerPlayer, m: C2S) => void;
    tick?: () => void;
    onDeath?: (p: ServerPlayer, info: DamageInfo) => void;
    ignite?: (dim: Dimension, x: number, y: number, z: number) => void;
    igniteTnt?: (dim: Dimension, x: number, y: number, z: number) => void;
    portalLight?: (dim: Dimension, x: number, y: number, z: number) => boolean;
    /** Player touching an end portal, end gateway or far portal block. */
    enterPortal?: (p: ServerPlayer, kind: string) => void;
  } = {};

  constructor(private readonly server: GameServer) {
    this.survival = new Survival(server);
    this.containers = new Containers(server);
    this.weather = new Weather(server);
  }

  // ------------------------------------------------------------------ permissions

  /**
   * Whether the player may modify blocks at this position. Adventure players
   * may break (the tool rule is checked by the caller) but never place.
   */
  canModify(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number, breaking = false): boolean {
    if (!p.abilities.mayBuild && !(breaking && p.gamemode === 'adventure')) return false;
    if (this.server.roleOf(p) === 'visitor') return false;
    if (y < 0 || y > 255) return false;
    void dim;
    void x;
    void z;
    return true;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    for (const p of this.server.players.values()) {
      if (!p.dead) {
        this.survival.tickPlayer(p);
        this.tickUsing(p);
        // item pickup
        if (p.gamemode !== 'spectator' && this.server.tickNo % 2 === 0) {
          const box = new AABB(p.x - 1.3, p.y - 0.5, p.z - 1.3, p.x + 1.3, p.y + 2.3, p.z + 1.3);
          for (const e of p.dim.entitiesNear(p.x, p.y + 1, p.z, 2.5)) {
            if (e instanceof ItemEntity && box.contains(e.x, e.y, e.z)) {
              if (e.tryPickup(p)) this.containers.syncInventory(p, false);
            }
          }
        }
        if (p.portalCooldown > 0) p.portalCooldown--;
      }
      if (p.inventory.changed.size) this.containers.syncInventory(p, false);
    }
    this.containers.tickFurnaces();
    this.tickButtons();
    this.tickSleep();
    this.hooks.tick?.();
  }

  syncInventory(p: ServerPlayer): void {
    this.containers.syncInventory(p);
  }

  // ------------------------------------------------------------------ use on block

  private reachOk(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const [ex, ey, ez] = this.server.eyePos(p);
    const reach = (p.gamemode === 'creative' ? REACH_CREATIVE : REACH_SURVIVAL) + 1.5;
    const dx = x + 0.5 - ex;
    const dy = y + 0.5 - ey;
    const dz = z + 0.5 - ez;
    return dx * dx + dy * dy + dz * dz <= reach * reach;
  }

  private resend(p: ServerPlayer, x: number, y: number, z: number, face?: number): void {
    p.send({ t: 'block', x, y, z, state: p.dim.getState(x, y, z) });
    if (face !== undefined) {
      const ax = x + FACE_DX[face];
      const ay = y + FACE_DY[face];
      const az = z + FACE_DZ[face];
      p.send({ t: 'block', x: ax, y: ay, z: az, state: p.dim.getState(ax, ay, az) });
      p.send({ t: 'block', x: ax, y: ay + 1, z: az, state: p.dim.getState(ax, ay + 1, az) });
    }
  }

  handleUseOn(p: ServerPlayer, m: C2S & { t: 'use_on' }): void {
    const dim = p.dim;
    const { x, y, z, face } = m;
    p.interactBudget += 1;
    if (p.interactBudget > 12) return this.resend(p, x, y, z, face);
    if (p.gamemode === 'spectator' || !dim.isLoaded(x, z)) return;
    if (!this.reachOk(p, x, y, z)) {
      this.server.log(`[anticheat] ${p.name} use_on out of reach`);
      return this.resend(p, x, y, z, face);
    }
    const state = dim.getState(x, y, z);
    const hand = m.hand === 1 ? OFFHAND : p.selectedSlot;
    const stack = p.inventory.get(hand);
    // 1. Block interaction (unless sneaking with an item)
    if (!(p.sneaking && stack)) {
      if (this.useBlock(p, x, y, z, state)) {
        p.send({ t: 'use_result', seq: m.seq, ok: true });
        return;
      }
    }
    if (!stack) return;
    // 2. Item-on-block behaviours
    if (this.useItemOnBlock(p, stack, hand, m)) {
      p.send({ t: 'use_result', seq: m.seq, ok: true });
      return;
    }
    // 3. Block placement
    const def = items[stack.id]!.def;
    const blockId = def.block;
    if (!blockId || !p.abilities.mayBuild) return this.resend(p, x, y, z, face);
    const placements = computePlacement(dim, {
      blockId,
      wallBlockId: def.wallBlock,
      x,
      y,
      z,
      face,
      hx: m.hx,
      hy: m.hy,
      hz: m.hz,
      yaw: m.yaw,
      pitch: m.pitch,
      sneaking: p.sneaking,
    });
    if (!placements) return this.resend(p, x, y, z, face);
    // Validate: no entity collision, permissions
    for (const pl of placements) {
      if (!this.canModify(p, dim, pl.x, pl.y, pl.z)) return this.resend(p, x, y, z, face);
      if (STATE_SOLID[pl.state] && this.entityObstructs(dim, pl.x, pl.y, pl.z, pl.state)) return this.resend(p, x, y, z, face);
    }
    for (const pl of placements) dim.setBlock(pl.x, pl.y, pl.z, pl.state);
    // Blocks placed from cheat items (or in a cheat context) stay cheat-made
    const cheat = this.isCheat(p, stack);
    for (const pl of placements) this.server.admin.setBlockMark(dim, pl.x, pl.y, pl.z, cheat);
    const first = placements[0]!;
    const pdef = blocks[STATE_BLOCK[first.state]!]!.def;
    // Double chest partner
    if (pdef.model === 'chest') {
      const pu = chestPartnerUpdate(dim, first.x, first.y, first.z, first.state);
      if (pu) dim.setBlock(pu.x, pu.y, pu.z, pu.state, { keepBlockEntity: true });
    }
    if (pdef.entity === 'furnace') dim.setBlockEntity(first.x, first.y, first.z, { type: 'furnace', items: [null, null, null] });
    if (pdef.entity === 'chest' || pdef.entity === 'barrel') dim.setBlockEntity(first.x, first.y, first.z, { type: pdef.entity, items: new Array(27).fill(null) });
    if (pdef.entity === 'sign') {
      dim.setBlockEntity(first.x, first.y, first.z, { type: 'sign', lines: ['', '', '', ''] });
      p.send({ t: 'open_window', window: -1, kind: 'player', title: 'sign', size: 0, data: { sign: [first.x, first.y, first.z] } });
    }
    this.server.playSound(dim, 'place.' + pdef.sound, first.x + 0.5, first.y + 0.5, first.z + 0.5, 1, 0.8, p);
    if (isSurvivalLike(p.gamemode)) this.consume(p, hand, 1);
    p.addStat('placed.' + blocks[STATE_BLOCK[first.state]!]!.id);
    if (pdef.model === 'crop' && !cheat) this.grant(p, 'plant_seed');
    p.send({ t: 'use_result', seq: m.seq, ok: true });
  }

  private entityObstructs(dim: Dimension, x: number, y: number, z: number, state: number): boolean {
    void state;
    const box = new AABB(x, y, z, x + 1, y + 1, z + 1);
    for (const e of dim.entitiesNear(x + 0.5, y + 0.5, z + 0.5, 3)) {
      if (e.type === 'item' || e.type === 'xp_orb' || e.type === 'arrow') continue;
      if ((e as ServerPlayer).gamemode === 'spectator') continue;
      if (e.box().grow(-0.01).intersects(box)) return true;
    }
    return false;
  }

  /** Right-click block behaviours. Returns true if handled. */
  private useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const dim = p.dim;
    const bt = blocks[STATE_BLOCK[state]!]!;
    const def = bt.def;
    // Visitors may look around and use doors, but not shared storage or stations that change the world
    if (this.server.roleOf(p) === 'visitor' && (VISITOR_BLOCKED.has(def.interact ?? '') || VISITOR_BLOCKED.has(bt.id))) {
      p.send({ t: 'chat', text: 'Visitors cannot use that in this world.', kind: 'error' });
      return true;
    }
    if (this.hooks.useBlock?.(p, x, y, z, state)) return true;
    const adventureOk = p.gamemode !== 'spectator';
    if (!adventureOk) return false;
    switch (def.interact) {
      case 'crafting':
        this.containers.openCrafting(p, dim, x, y, z);
        return true;
      case 'furnace':
        this.containers.openFurnace(p, dim, x, y, z, 'furnace');
        return true;
      case 'blast_furnace':
        this.containers.openFurnace(p, dim, x, y, z, 'blast_furnace');
        return true;
      case 'smoker':
        this.containers.openFurnace(p, dim, x, y, z, 'smoker');
        return true;
      case 'chest':
        this.containers.openChest(p, dim, x, y, z);
        return true;
      case 'barrel':
        this.containers.openBarrel(p, dim, x, y, z);
        return true;
      case 'ender_chest':
        this.containers.openEnderChest(p, dim, x, y, z);
        return true;
      case 'stonecutter':
        this.containers.openStonecutter(p, dim, x, y, z);
        return true;
      case 'smithing':
        this.containers.openSmithing(p, dim, x, y, z);
        return true;
      case 'door': {
        const open = getProp(state, 'open') !== 'true';
        const upper = getProp(state, 'half') === 'upper';
        dim.setBlock(x, y, z, withProp(state, 'open', open));
        const oy = upper ? y - 1 : y + 1;
        const other = dim.getState(x, oy, z);
        if (STATE_BLOCK[other] === STATE_BLOCK[state]) dim.setBlock(x, oy, z, withProp(other, 'open', open));
        this.server.playSound(dim, open ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        return true;
      }
      case 'trapdoor':
      case 'fence_gate': {
        const open = getProp(state, 'open') !== 'true';
        let ns = withProp(state, 'open', open);
        if (def.interact === 'fence_gate' && open) {
          // open away from the player
          const f = getProp(state, 'facing')!;
          const dx = p.x - (x + 0.5);
          const dz = p.z - (z + 0.5);
          const along = f === 'north' || f === 'south' ? dz : dx;
          const sign = f === 'south' || f === 'east' ? 1 : -1;
          if (along * sign > 0) ns = withProp(ns, 'facing', ({ north: 'south', south: 'north', east: 'west', west: 'east' } as Record<string, string>)[f]!);
        }
        dim.setBlock(x, y, z, ns);
        this.server.playSound(dim, open ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 1, 1.1);
        return true;
      }
      case 'lever': {
        const on = getProp(state, 'powered') !== 'true';
        dim.setBlock(x, y, z, withProp(state, 'powered', on));
        this.server.playSound(dim, 'click', x + 0.5, y + 0.5, z + 0.5, 0.3, on ? 0.6 : 0.5);
        return true;
      }
      case 'button': {
        if (getProp(state, 'powered') === 'true') return true;
        dim.setBlock(x, y, z, withProp(state, 'powered', true));
        this.server.blockUpdates.schedule(dim, x, y, z, def.sound === 'wood' ? 30 : 20, 'check');
        (this.pendingButtons ??= []).push({ dim, x, y, z, at: this.server.tickNo + (def.sound === 'wood' ? 30 : 20) });
        this.server.playSound(dim, 'click', x + 0.5, y + 0.5, z + 0.5, 0.3, 0.6);
        return true;
      }
      case 'bed':
        return this.useBed(p, x, y, z, state);
      case 'cake': {
        if (!isSurvivalLike(p.gamemode) && p.gamemode !== 'creative') return false;
        if (p.food >= 20 && p.gamemode !== 'creative') return false;
        const bites = parseInt(getProp(state, 'bites')!, 10);
        this.survival.feed(p, 2, 0.4);
        if (bites >= 6) dim.setBlock(x, y, z, 0);
        else dim.setBlock(x, y, z, withProp(state, 'bites', bites + 1));
        this.server.playSound(dim, 'eat', x + 0.5, y + 0.5, z + 0.5, 0.5, 1);
        return true;
      }
      case 'note_block':
        this.server.playSound(dim, 'note', x + 0.5, y + 0.5, z + 0.5, 1, 0.5 + rng.next());
        this.server.particles(dim, 'note', x + 0.5, y + 1.2, z + 0.5, 1);
        return true;
      case 'composter': {
        const held = p.heldItem();
        const lvl = parseInt(getProp(state, 'level')!, 10);
        if (lvl >= 8) {
          dim.setBlock(x, y, z, withProp(state, 'level', 0));
          this.server.mining.dropItem(dim, x + 0.5, y + 1.1, z + 0.5, stackOf('bone_meal', 1));
          return true;
        }
        if (held && isCompostable(items[held.id]!.id)) {
          if (isSurvivalLike(p.gamemode)) this.consume(p, p.selectedSlot, 1);
          if (rng.chance(0.5)) dim.setBlock(x, y, z, withProp(state, 'level', Math.min(8, lvl + 1)));
          this.server.particles(dim, 'composter', x + 0.5, y + 0.8, z + 0.5, 5);
          return true;
        }
        return false;
      }
      case 'jukebox':
        return false;
      case 'respawn_anchor':
        return false;
      case 'enchanting':
      case 'anvil':
      case 'brewing':
        return !!this.hooks.useBlock?.(p, x, y, z, state);
      case 'sign':
        return false;
    }
    // Redstone ore glows when touched
    if (bt.id === 'redstone_ore' || bt.id === 'deepslate_redstone_ore') {
      if (getProp(state, 'lit') !== 'true') dim.setBlock(x, y, z, withProp(state, 'lit', true));
      return false;
    }
    return false;
  }
  private pendingButtons: { dim: Dimension; x: number; y: number; z: number; at: number }[] | undefined;

  tickButtons(): void {
    if (!this.pendingButtons?.length) return;
    const now = this.server.tickNo;
    this.pendingButtons = this.pendingButtons.filter((b) => {
      if (b.at > now) return true;
      const s = b.dim.getState(b.x, b.y, b.z);
      if (blocks[STATE_BLOCK[s]!]!.def.interact === 'button') b.dim.setBlock(b.x, b.y, b.z, withProp(s, 'powered', false));
      return false;
    });
  }

  private useBed(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    const dim = p.dim;
    if (!dim.rules.bedWorks) {
      // Beds explode outside the overworld
      dim.setBlock(x, y, z, 0);
      this.hooks.ignite?.(dim, x, y, z);
      this.server.interaction.explode?.(dim, x + 0.5, y + 0.5, z + 0.5, 5, true, null);
      return true;
    }
    p.spawnPoint = { dim: dim.id, x: x + 0.5, y: y + 0.6, z: z + 0.5, forced: false };
    p.send({ t: 'chat', text: 'Respawn point set', kind: 'system' });
    if (!this.server.admin.blockMarked(dim, x, y, z)) this.grant(p, 'sleep_bed');
    const dt = this.server.level.dayTime;
    const night = dt >= 12542 && dt <= 23459;
    if (!night && !this.server.level.thundering) {
      p.send({ t: 'chat', text: 'You can only sleep at night or during thunderstorms', kind: 'system' });
      return true;
    }
    const monsters = dim.entitiesNear(x, y, z, 8, (e) => (e as { hostile?: boolean }).hostile === true);
    if (monsters.length && isSurvivalLike(p.gamemode)) {
      p.send({ t: 'chat', text: 'You may not rest now; there are monsters nearby', kind: 'system' });
      return true;
    }
    p.sleepingTicks = 1;
    p.metaDirty = true;
    this.server.broadcastNear(dim, p.x, p.y, p.z, 64, { t: 'anim', id: p.id, anim: 'sleep' });
    void state;
    return true;
  }

  wake(p: ServerPlayer): void {
    if (p.sleepingTicks > 0) {
      p.sleepingTicks = 0;
      p.metaDirty = true;
      this.server.broadcastNear(p.dim, p.x, p.y, p.z, 64, { t: 'anim', id: p.id, anim: 'wake' });
    }
  }

  /** Called each tick: if every overworld player is asleep long enough, skip the night. */
  tickSleep(): void {
    const ow = [...this.server.players.values()].filter((p) => p.dim.id === 'overworld' && !p.dead && p.gamemode !== 'spectator');
    if (ow.length === 0) return;
    let asleep = 0;
    for (const p of ow) if (p.sleepingTicks > 0) {
      p.sleepingTicks++;
      asleep++;
    }
    if (asleep > 0 && asleep >= Math.ceil(ow.length / 2) && ow.filter((p) => p.sleepingTicks > 0).every((p) => p.sleepingTicks >= 100)) {
      const l = this.server.level;
      l.dayTime = 0;
      if (l.raining) this.weather.set('clear');
      for (const p of ow) this.wake(p);
      this.server.sendTime();
    }
  }

  // ------------------------------------------------------------------ item on block

  private useItemOnBlock(p: ServerPlayer, stack: ItemStack, hand: number, m: C2S & { t: 'use_on' }): boolean {
    if (this.server.roleOf(p) === 'visitor') return false;
    const dim = p.dim;
    const { x, y, z, face } = m;
    const it = items[stack.id]!;
    const state = dim.getState(x, y, z);
    const bid = blocks[STATE_BLOCK[state]!]!.id;
    const survival = isSurvivalLike(p.gamemode);
    if (this.hooks.useItemOnBlock?.(p, stack, x, y, z, face)) return true;
    const ax = x + FACE_DX[face];
    const ay = y + FACE_DY[face];
    const az = z + FACE_DZ[face];
    switch (it.def.use) {
      case 'hoe': {
        if ((bid === 'grass_block' || bid === 'dirt' || bid === 'dirt_path' || bid === 'coarse_dirt' || bid === 'rooted_dirt') && face !== 0 && dim.getState(x, y + 1, z) === 0) {
          if (!this.canModify(p, dim, x, y, z)) return false;
          dim.setBlock(x, y, z, bid === 'coarse_dirt' ? S('dirt') : S('farmland'));
          if (bid === 'rooted_dirt') this.server.mining.dropItem(dim, x + 0.5, y + 1.1, z + 0.5, stackOf('hanging_roots'));
          this.server.playSound(dim, 'hoe.till', x + 0.5, y + 1, z + 0.5, 1, 1);
          if (survival) this.damageHeldSlot(p, hand, 1);
          return true;
        }
        return false;
      }
      case 'shovel': {
        if ((bid === 'grass_block' || bid === 'dirt' || bid === 'podzol' || bid === 'mycelium' || bid === 'coarse_dirt') && face !== 0 && dim.getState(x, y + 1, z) === 0) {
          dim.setBlock(x, y, z, S('dirt_path'));
          this.server.playSound(dim, 'shovel.flatten', x + 0.5, y + 1, z + 0.5, 1, 1);
          if (survival) this.damageHeldSlot(p, hand, 1);
          return true;
        }
        if (bid === 'campfire' && getProp(state, 'lit') === 'true') {
          dim.setBlock(x, y, z, withProp(state, 'lit', false));
          return true;
        }
        return false;
      }
      case 'axe': {
        const strip = strippedOf(bid);
        if (strip) {
          dim.setBlock(x, y, z, withProp(S(strip), 'axis', getProp(state, 'axis') ?? 'y'));
          this.server.playSound(dim, 'axe.strip', x + 0.5, y + 0.5, z + 0.5, 1, 1);
          if (survival) this.damageHeldSlot(p, hand, 1);
          return true;
        }
        return false;
      }
      case 'flint_and_steel':
      case 'fire_charge': {
        if (bid === 'tnt') {
          this.igniteTnt(dim, x, y, z);
          if (survival) it.def.use === 'flint_and_steel' ? this.damageHeldSlot(p, hand, 1) : this.consume(p, hand, 1);
          return true;
        }
        if ((bid === 'campfire' || bid === 'soul_campfire') && getProp(state, 'lit') === 'false') {
          dim.setBlock(x, y, z, withProp(state, 'lit', true));
          return true;
        }
        if (this.hooks.portalLight?.(dim, ax, ay, az)) {
          if (survival) it.def.use === 'flint_and_steel' ? this.damageHeldSlot(p, hand, 1) : this.consume(p, hand, 1);
          return true;
        }
        const target = dim.getState(ax, ay, az);
        if (target === 0 || STATE_REPLACEABLE[target]) {
          const fire = blockHasTag(dim.getState(ax, ay - 1, az), 'soul_fire_base') ? S('soul_fire') : S('fire');
          if (!canSurvive(fire, dim, ax, ay, az)) return false;
          dim.setBlock(ax, ay, az, fire);
          this.server.playSound(dim, 'ignite', ax + 0.5, ay + 0.5, az + 0.5, 1, 1);
          if (survival) it.def.use === 'flint_and_steel' ? this.damageHeldSlot(p, hand, 1) : this.consume(p, hand, 1);
          return true;
        }
        return false;
      }
      case 'bucket': {
        // Pick up fluid: raycast including fluids
        const [ex, ey, ez] = this.server.eyePos(p);
        const dir = lookDir(p.yaw, p.pitch);
        const hit = raycastBlocks(dim, ex, ey, ez, dir[0], dir[1], dir[2], 5, { fluids: true });
        if (hit && STATE_FLUID[hit.state] && getProp(hit.state, 'level') === '0') {
          const kind = STATE_FLUID[hit.state] === 1 ? 'water_bucket' : 'lava_bucket';
          const cheatFluid = this.isCheat(p, stack) || this.server.admin.blockMarked(dim, hit.x, hit.y, hit.z);
          dim.setBlock(hit.x, hit.y, hit.z, 0);
          this.server.admin.setBlockMark(dim, hit.x, hit.y, hit.z, false);
          this.server.playSound(dim, 'bucket.fill', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, 1);
          const filled = this.server.admin.mark(p, stackOf(kind), cheatFluid);
          if (survival) this.replaceOne(p, hand, filled);
          else if (!p.inventory.count(itemById.get(kind)!.num)) p.inventory.add(filled);
          return true;
        }
        return false;
      }
      case 'water_bucket':
      case 'lava_bucket': {
        const target = STATE_REPLACEABLE[state] && !STATE_FLUID[state] ? [x, y, z] : [ax, ay, az];
        const [tx, ty, tz] = target as [number, number, number];
        const cur = dim.getState(tx, ty, tz);
        if (!(cur === 0 || STATE_REPLACEABLE[cur])) return false;
        if (it.def.use === 'water_bucket' && dim.rules.waterEvaporates) {
          this.server.playSound(dim, 'fizz', tx + 0.5, ty + 0.5, tz + 0.5, 0.5, 2.6);
          this.server.particles(dim, 'smoke', tx + 0.5, ty + 0.5, tz + 0.5, 8);
        } else {
          dim.setBlock(tx, ty, tz, it.def.use === 'water_bucket' ? S('water') : S('lava'));
          this.server.admin.setBlockMark(dim, tx, ty, tz, this.isCheat(p, stack));
        }
        this.server.playSound(dim, 'bucket.empty', tx + 0.5, ty + 0.5, tz + 0.5, 1, 1);
        if (survival) this.replaceOne(p, hand, this.server.admin.mark(p, stackOf('bucket'), isAdminStack(stack)));
        return true;
      }
      case 'bone_meal':
        if (this.boneMeal(dim, x, y, z, state, this.isCheat(p, stack))) {
          if (survival) this.consume(p, hand, 1);
          this.server.particles(dim, 'happy', x + 0.5, y + 0.8, z + 0.5, 12, 0.4);
          return true;
        }
        return false;
      case 'ender_eye':
        return false;
      case 'spawn_egg':
        return false;
    }
    // Shears on pumpkins
    if (items[stack.id]!.id === 'shears' && bid === 'pumpkin' && face >= 2) {
      dim.setBlock(x, y, z, withProp(S('carved_pumpkin'), 'facing', FACE_NAMES[face]!));
      this.server.mining.dropItem(dim, ax + 0.5, ay + 0.2, az + 0.5, stackOf('pumpkin_seeds', 4));
      if (survival) this.damageHeldSlot(p, hand, 1);
      return true;
    }
    return false;
  }

  /** Bone meal growth. Returns true if anything happened. */
  boneMeal(dim: Dimension, x: number, y: number, z: number, state: number, cheat = false): boolean {
    const def = blocks[STATE_BLOCK[state]!]!.def;
    // Growth from cheat bone meal (or of a cheat-placed plant) stays cheat-made
    const taint = cheat || this.server.admin.blockMarked(dim, x, y, z);
    const set = (bx: number, by: number, bz: number, st: number): void => {
      dim.setBlock(bx, by, bz, st);
      if (taint) this.server.admin.setBlockMark(dim, bx, by, bz, true);
    };
    const id = def.id;
    if (def.model === 'crop') {
      const age = parseInt(getProp(state, 'age')!, 10);
      const max = (def.data?.maxAge as number) ?? 7;
      if (age >= max) return false;
      set(x, y, z, withProp(state, 'age', Math.min(max, age + rng.range(2, 5))));
      return true;
    }
    if (def.tags?.includes('saplings')) {
      if (rng.chance(0.45)) growTree(dim, x, y, z, id.replace('_sapling', ''), rng, (bx, by, bz, s) => set(bx, by, bz, s));
      return true;
    }
    if (id === 'grass_block') {
      for (let i = 0; i < 40; i++) {
        const gx = x + rng.range(-3, 3);
        const gz = z + rng.range(-3, 3);
        for (let dy = -1; dy <= 1; dy++) {
          const gy = y + dy;
          if (blocks[STATE_BLOCK[dim.getState(gx, gy, gz)]!]!.id === 'grass_block' && dim.getState(gx, gy + 1, gz) === 0) {
            const flower = rng.chance(0.1) ? S(rng.pick(['dandelion', 'poppy', 'azure_bluet', 'oxeye_daisy'])) : S('short_grass');
            set(gx, gy + 1, gz, flower);
            break;
          }
        }
      }
      return true;
    }
    if (id === 'short_grass' && dim.getState(x, y + 1, z) === 0) {
      set(x, y, z, stateOf('tall_grass', { half: 'lower' }));
      set(x, y + 1, z, stateOf('tall_grass', { half: 'upper' }));
      return true;
    }
    if (id === 'sweet_berry_bush') {
      const age = parseInt(getProp(state, 'age')!, 10);
      if (age >= 3) return false;
      set(x, y, z, withProp(state, 'age', age + 1));
      return true;
    }
    if (id === 'brown_mushroom' || id === 'red_mushroom') {
      dim.setBlock(x, y, z, 0);
      growTree(dim, x, y, z, 'oak', rng, () => {});
      return true;
    }
    return false;
  }

  growPlant(dim: Dimension, x: number, y: number, z: number, state: number, r: Random): void {
    const id = blocks[STATE_BLOCK[state]!]!.id;
    if (id === 'sweet_berry_bush') {
      const age = parseInt(getProp(state, 'age')!, 10);
      if (age < 3 && r.chance(0.2)) dim.setBlock(x, y, z, withProp(state, 'age', age + 1));
    } else if (id === 'kelp') {
      if (STATE_FLUID[dim.getState(x, y + 1, z)] === 1 && blocks[STATE_BLOCK[dim.getState(x, y + 1, z)]!]!.def.model === 'liquid' && r.chance(0.14)) dim.setBlock(x, y + 1, z, S('kelp'));
    } else if (id === 'bamboo') {
      let h = 1;
      while (STATE_BLOCK[dim.getState(x, y - h, z)] === STATE_BLOCK[state] && h < 16) h++;
      if (h < 12 && dim.getState(x, y + 1, z) === 0 && r.chance(0.33)) dim.setBlock(x, y + 1, z, S('bamboo'));
    } else if (id === 'vine') {
      if (dim.getState(x, y - 1, z) === 0 && r.chance(0.1)) dim.setBlock(x, y - 1, z, state);
    }
  }

  // ------------------------------------------------------------------ use in air

  handleUse(p: ServerPlayer, m: C2S & { t: 'use' }): void {
    const hand = m.hand === 1 ? OFFHAND : p.selectedSlot;
    const stack = p.inventory.get(hand);
    if (m.action === 'release') {
      const u = this.using.get(p);
      if (u) {
        this.using.delete(p);
        const held = p.inventory.get(u.slot);
        if (held && held.id === u.item && u.kind === 'bow') this.hooks.releaseItem?.(p, held, this.server.tickNo - u.start);
      }
      return;
    }
    if (!stack || p.gamemode === 'spectator') return;
    const def = items[stack.id]!.def;
    if (def.food) {
      const canEat = def.food.alwaysEdible || p.food < 20 || p.gamemode === 'creative' || (p.gamemode === 'god' && !this.server.level.rules.godHunger);
      if (!canEat) return;
      this.using.set(p, { slot: hand, hand: m.hand, item: stack.id, start: this.server.tickNo, duration: def.food.eatTime ?? 32, kind: 'eat' });
      return;
    }
    if (def.use === 'potion') {
      this.using.set(p, { slot: hand, hand: m.hand, item: stack.id, start: this.server.tickNo, duration: 32, kind: 'eat' });
      return;
    }
    if (def.use === 'bow' || def.use === 'crossbow' || def.use === 'trident') {
      this.using.set(p, { slot: hand, hand: m.hand, item: stack.id, start: this.server.tickNo, duration: 72000, kind: 'bow' });
      return;
    }
    if (def.use === 'shield') {
      this.using.set(p, { slot: hand, hand: m.hand, item: stack.id, start: this.server.tickNo, duration: 72000, kind: 'block' });
      return;
    }
    if (def.armor) {
      // equip from hand
      const slot = { head: 39, chest: 38, legs: 37, feet: 36 }[def.armor.slot];
      const cur = p.inventory.get(slot);
      p.inventory.set(slot, cloneStack(stack));
      p.inventory.set(hand, cur);
      this.survival.updateArmor(p);
      this.server.playSound(p.dim, 'equip', p.x, p.y, p.z, 1, 1);
      return;
    }
    if (this.hooks.useItem?.(p, stack, m.hand)) return;
    // Bucket used in air on fluids (raycast)
    if (def.use === 'bucket' || def.use === 'water_bucket' || def.use === 'lava_bucket') {
      const [ex, ey, ez] = this.server.eyePos(p);
      const dir = lookDir(p.yaw, p.pitch);
      const hit = raycastBlocks(p.dim, ex, ey, ez, dir[0], dir[1], dir[2], 5, { fluids: def.use === 'bucket' });
      if (hit) this.useItemOnBlock(p, stack, hand, { t: 'use_on', x: hit.x, y: hit.y, z: hit.z, face: hit.face, hx: 0.5, hy: 0.5, hz: 0.5, hand: m.hand, yaw: p.yaw, pitch: p.pitch, seq: 0 });
    }
  }

  isUsing(p: ServerPlayer): UsingState | undefined {
    return this.using.get(p);
  }

  private tickUsing(p: ServerPlayer): void {
    const u = this.using.get(p);
    if (!u) return;
    const stack = p.inventory.get(u.slot);
    if (!stack || stack.id !== u.item || (u.slot !== OFFHAND && u.slot !== p.selectedSlot)) {
      this.using.delete(p);
      return;
    }
    const elapsed = this.server.tickNo - u.start;
    if (u.kind === 'eat') {
      if (elapsed % 4 === 0 && elapsed > 6) {
        this.server.playSound(p.dim, 'eat', p.x, p.y + 1.5, p.z, 0.5, 0.9 + rng.next() * 0.2);
        this.server.broadcastNear(p.dim, p.x, p.y, p.z, 32, { t: 'anim', id: p.id, anim: 'eat' });
      }
      if (elapsed >= u.duration) {
        this.using.delete(p);
        this.finishEating(p, u.slot, stack);
      }
    }
  }

  private finishEating(p: ServerPlayer, slot: number, stack: ItemStack): void {
    const def = items[stack.id]!.def;
    const id = items[stack.id]!.id;
    if (def.use === 'potion') {
      this.server.workstations?.applyPotion(p, stack.tag?.potion ?? 'water');
      if (p.gamemode !== 'creative') this.replaceOne(p, slot, stackOf('glass_bottle'));
      p.addStat('drank.' + (stack.tag?.potion ?? 'water'));
      p.statsDirty = true;
      return;
    }
    const f = def.food!;
    if (f.special === 'milk') p.effects.clear();
    else this.survival.feed(p, f.hunger, f.saturation);
    for (const e of f.effects ?? []) if (e.chance === undefined || rng.chance(e.chance)) this.survival.addEffect(p, e.effect, e.amplifier ?? 0, e.duration);
    if (f.special === 'chorus_teleport') this.chorusTeleport(p);
    this.server.playSound(p.dim, 'burp', p.x, p.y + 1, p.z, 0.5, 1);
    if (p.gamemode !== 'creative') {
      if (f.remainder) this.replaceOne(p, slot, stackOf(f.remainder));
      else this.consume(p, slot, 1);
    }
    p.addStat('eaten.' + id);
    if ((id === 'sunroot' || id === 'roasted_sunroot') && !isAdminStack(stack)) this.grant(p, 'eat_sunroot');
    p.statsDirty = true;
  }

  private chorusTeleport(p: ServerPlayer): void {
    for (let i = 0; i < 16; i++) {
      const tx = Math.floor(p.x + rng.range(-8, 8)) + 0.5;
      const tz = Math.floor(p.z + rng.range(-8, 8)) + 0.5;
      if (!p.dim.isLoaded(tx, tz)) continue;
      for (let dy = 8; dy >= -8; dy--) {
        const ty = Math.floor(p.y) + dy;
        if (STATE_SOLID[p.dim.getState(Math.floor(tx), ty - 1, Math.floor(tz))] && !STATE_SOLID[p.dim.getState(Math.floor(tx), ty, Math.floor(tz))] && !STATE_SOLID[p.dim.getState(Math.floor(tx), ty + 1, Math.floor(tz))]) {
          this.server.particles(p.dim, 'portal', p.x, p.y + 1, p.z, 32, 0.5);
          this.server.teleport(p, tx, ty, tz);
          this.server.playSound(p.dim, 'teleport', tx, ty, tz, 1, 1);
          return;
        }
      }
    }
  }

  // ------------------------------------------------------------------ inventory helpers

  consume(p: ServerPlayer, slot: number, n: number): void {
    const s = p.inventory.get(slot);
    if (!s) return;
    p.inventory.set(slot, s.count > n ? { ...s, count: s.count - n } : null);
  }

  /** Replaces one item of a stack with another (bucket -> water bucket). */
  replaceOne(p: ServerPlayer, slot: number, repl: ItemStack): void {
    const s = p.inventory.get(slot);
    if (!s) return;
    if (s.count <= 1) p.inventory.set(slot, repl);
    else {
      p.inventory.set(slot, { ...s, count: s.count - 1 });
      const rem = p.inventory.add(repl);
      if (rem) this.dropStack(p, rem);
    }
  }

  damageHeld(p: ServerPlayer, amount: number): void {
    this.damageStack(p, p.selectedSlot, amount);
  }

  private damageHeldSlot(p: ServerPlayer, slot: number, amount: number): void {
    this.damageStack(p, slot, amount);
  }

  /** Applies durability damage (respecting Unbreaking); breaks the item when used up. */
  damageStack(p: ServerPlayer, slot: number, amount: number): void {
    if (!isSurvivalLike(p.gamemode)) return;
    const s = p.inventory.get(slot);
    if (!s) return;
    const dur = items[s.id]?.def.durability;
    if (!dur) return;
    const unb = enchantLevel(s, 'unbreaking');
    let dmg = 0;
    for (let i = 0; i < amount; i++) {
      const isArmor = slot >= ARMOR_START && slot < ARMOR_START + 4;
      if (unb > 0 && rng.next() >= (isArmor ? 0.6 + 0.4 / (unb + 1) : 1 / (unb + 1))) continue;
      dmg++;
    }
    if (dmg === 0) return;
    const nd = (s.damage ?? 0) + dmg;
    if (nd >= dur) {
      p.inventory.set(slot, null);
      this.server.playSound(p.dim, 'item.break', p.x, p.y + 1, p.z, 0.8, 0.9);
      this.server.particles(p.dim, 'item_break', p.x, p.y + 1.4, p.z, 8, 0.2, s.id);
      p.addStat('broken.' + itemIdOf(s));
    } else p.inventory.set(slot, { ...s, damage: nd });
    if (slot >= ARMOR_START && slot < ARMOR_START + 4) this.survival.updateArmor(p);
  }

  /** Mending: XP repairs a random equipped mending item first. Returns remaining XP. */
  applyMending(p: ServerPlayer, xp: number): number {
    const slots = [p.selectedSlot, OFFHAND, 36, 37, 38, 39].filter((i) => {
      const s = p.inventory.get(i);
      return s && (s.damage ?? 0) > 0 && enchantLevel(s, 'mending') > 0;
    });
    if (slots.length === 0) return xp;
    const i = rng.pick(slots);
    const s = p.inventory.get(i)!;
    const repair = Math.min(xp * 2, s.damage ?? 0);
    p.inventory.set(i, { ...s, damage: (s.damage ?? 0) - repair });
    return xp - Math.ceil(repair / 2);
  }

  dropStack(p: ServerPlayer, stack: ItemStack): void {
    const e = new ItemEntity(cloneStack(stack));
    const [ex, ey, ez] = this.server.eyePos(p);
    e.setPos(ex, ey - 0.3, ez);
    const d = lookDir(p.yaw, p.pitch);
    e.body.vx = d[0] * 0.3 + (rng.next() - 0.5) * 0.02;
    e.body.vy = d[1] * 0.3 + 0.1;
    e.body.vz = d[2] * 0.3 + (rng.next() - 0.5) * 0.02;
    e.pickupDelay = 40;
    e.owner = p.uuid;
    p.dim.addEntity(e);
  }

  dropHeld(p: ServerPlayer, all: boolean): void {
    if (p.gamemode === 'spectator') return;
    const s = p.heldItem();
    if (!s) return;
    const n = all ? s.count : 1;
    this.dropStack(p, { ...cloneStack(s), count: n });
    p.inventory.set(p.selectedSlot, s.count > n ? { ...s, count: s.count - n } : null);
    this.containers.syncInventory(p, false);
  }

  dropAll(p: ServerPlayer): void {
    for (let i = 0; i < p.inventory.size; i++) {
      const s = p.inventory.get(i);
      if (!s) continue;
      if (enchantLevel(s, 'vanishing_curse')) {
        p.inventory.set(i, null);
        continue;
      }
      const e = new ItemEntity(cloneStack(s));
      e.setPos(p.x, p.y + 0.5, p.z);
      e.body.vx = (rng.next() - 0.5) * 0.5;
      e.body.vy = rng.next() * 0.3;
      e.body.vz = (rng.next() - 0.5) * 0.5;
      e.pickupDelay = 40;
      p.dim.addEntity(e);
      p.inventory.set(i, null);
    }
    this.containers.syncInventory(p);
  }

  swapHands(p: ServerPlayer): void {
    const a = p.inventory.get(p.selectedSlot);
    const b = p.inventory.get(OFFHAND);
    p.inventory.set(p.selectedSlot, b);
    p.inventory.set(OFFHAND, a);
    this.containers.syncInventory(p);
  }

  spillContainer(dim: Dimension, x: number, y: number, z: number, be: unknown): void {
    const list = (be as { items?: unknown[] }).items ?? [];
    this.containers.forget(dim, x, y, z);
    for (const raw of list) {
      const s = raw ? (typeof (raw as { id?: unknown }).id === 'string' ? fromSavedSafe(raw) : null) : null;
      if (s) this.server.mining.dropItem(dim, x + 0.5, y + 0.5, z + 0.5, s);
    }
  }

  // ------------------------------------------------------------------ windows

  handleClick(p: ServerPlayer, m: C2S & { t: 'click' }): void {
    this.containers.handleClick(p, m);
  }

  closeWindow(p: ServerPlayer, id: number, silent = false): void {
    this.containers.closeWindow(p, id, silent);
  }

  handleCreativeSet(p: ServerPlayer, slot: number, item: Slot): void {
    this.containers.creativeSet(p, slot, item);
  }

  handleCreativePick(p: ServerPlayer, item: Slot): void {
    if (p.gamemode !== 'creative' || !item) return;
    // Put into hotbar: existing slot with same item, else empty slot, else current
    for (let i = 0; i < 9; i++) {
      const s = p.inventory.get(i);
      if (s && s.id === item.id) {
        p.selectedSlot = i;
        p.send({ t: 'hotbar', slot: i });
        return;
      }
    }
    let target = p.inventory.get(p.selectedSlot) ? p.inventory.firstEmpty(0, 9) : p.selectedSlot;
    if (target < 0) target = p.selectedSlot;
    p.inventory.set(target, this.server.admin.mark(p, { ...item, count: items[item.id]!.maxStack }));
    p.selectedSlot = target;
    p.send({ t: 'hotbar', slot: target });
    this.containers.syncInventory(p);
  }

  handleSignText(p: ServerPlayer, m: C2S & { t: 'sign_text' }): void {
    const be = p.dim.getBlockEntity(m.x, m.y, m.z);
    if (!be || be.type !== 'sign') return;
    if (p.distanceSq(m.x + 0.5, m.y + 0.5, m.z + 0.5) > 64) return;
    if (!this.canModify(p, p.dim, m.x, m.y, m.z)) return;
    const filter = this.server.opts.filterChat;
    const lines = m.lines.map((l) => {
      const clean = l.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 32);
      return filter ? filter(clean, p) ?? '' : clean;
    });
    p.dim.setBlockEntity(m.x, m.y, m.z, { type: 'sign', lines });
    this.server.sendToWatchers(p.dim, m.x, m.z, { t: 'block_entity', x: m.x, y: m.y, z: m.z, data: { type: 'sign', lines } });
  }

  handleWindowAction(p: ServerPlayer, m: C2S): void {
    if (m.t === 'trade') {
      // Stonecutter recipe / merchant offer selection
      const w = this.containers.windowOf(p) as Window & { select?: (i: number) => void };
      if (w.id !== 0 && w.id === p.windowId && w.select && Number.isInteger(m.index)) {
        w.select(m.index);
        w.refresh?.();
        this.containers.sync(p);
      }
      return;
    }
    this.hooks.windowAction?.(p, m);
  }

  /** Optional progression hook when a player kills a mob. */
  onMobKilled?: (p: ServerPlayer, m: Entity) => void;

  openCustomWindow(p: ServerPlayer, w: Window): void {
    this.containers.openCustom(p, w);
  }

  onChestViewers(dim: Dimension, parts: [number, number, number][], delta: number): void {
    for (const [x, y, z] of parts) {
      const key = `${x},${y},${z}`;
      const n = Math.max(0, (this.chestViewers.get(key) ?? 0) + delta);
      this.chestViewers.set(key, n);
      this.server.sendToWatchers(dim, x, z, { t: 'block_entity', x, y, z, data: { type: 'chest_anim', open: n > 0 } });
    }
  }
  private readonly chestViewers = new Map<string, number>();

  // ------------------------------------------------------------------ entities

  handleAttack(p: ServerPlayer, id: number): void {
    const target = p.dim.entities.get(id);
    if (!target || target === p || p.gamemode === 'spectator') return;
    this.hooks.attack?.(p, target);
  }

  handleInteractEntity(p: ServerPlayer, id: number, hand: 0 | 1): void {
    const target = p.dim.entities.get(id);
    if (!target || p.distanceSq(target.x, target.y, target.z) > 49) return;
    this.hooks.interactEntity?.(p, target, hand);
  }

  hurtEntity(e: Entity, amount: number, source: string, attacker: Entity | null): void {
    if (e instanceof LivingEntity) e.hurt(amount, { source: source as never, attacker });
    else this.hooks.hurtEntity?.(e, amount, source, attacker);
  }

  restoreEntities(dim: Dimension, list: Record<string, unknown>[]): void {
    for (const d of list) {
      let e: Entity | null = null;
      if (d.type === 'item') e = ItemEntity.load(d);
      else if (d.type === 'falling_block') e = FallingBlock.load(d);
      else e = this.hooks.restore?.(dim, d) ?? null;
      if (e) dim.addEntity(e);
    }
  }

  igniteTnt(dim: Dimension, x: number, y: number, z: number): void {
    if (this.hooks.igniteTnt) this.hooks.igniteTnt(dim, x, y, z);
    else dim.setBlock(x, y, z, 0);
  }

  explode?: (dim: Dimension, x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null) => void;

  // ------------------------------------------------------------------ lifecycle

  respawn(p: ServerPlayer): void {
    if (!p.dead) return;
    const level = this.server.level;
    if (level.hardcore) {
      p.dead = false;
      p.health = 20;
      p.setGamemode('spectator');
      p.send({ t: 'gamemode', mode: 'spectator', abilities: p.abilitiesMsg() });
      p.send({ t: 'respawned' });
      p.statsDirty = true;
      return;
    }
    p.dead = false;
    p.maxHealth = maxHealthFor(p.gamemode, level.godHearts);
    p.health = Number.isFinite(p.maxHealth) ? p.maxHealth : 20;
    p.food = 20;
    p.saturation = 5;
    p.exhaustion = 0;
    p.air = p.maxAir;
    p.spawnProtection = 60;
    p.hurtCooldown = 0;
    p.statsDirty = true;
    this.sendToSpawn(p);
    p.send({ t: 'respawned' });
    this.containers.syncInventory(p);
  }

  /** Moves a player to their respawn point (bed/anchor) or the world spawn. */
  sendToSpawn(p: ServerPlayer): void {
    const level = this.server.level;
    let dimId = p.spawnPoint?.dim ?? 'overworld';
    let pos: [number, number, number] | null = null;
    if (p.spawnPoint) {
      const d = this.server.dim(p.spawnPoint.dim);
      pos = [p.spawnPoint.x, p.spawnPoint.y, p.spawnPoint.z];
      void d;
    }
    if (!pos) {
      const s = level.spawn ?? [0, 80, 0];
      const r = level.rules.spawnRadius;
      pos = [s[0] + 0.5 + rng.range(-r, r), s[1], s[2] + 0.5 + rng.range(-r, r)];
      dimId = 'overworld';
      (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
    }
    if (p.dim.id !== dimId) this.server.changeDimension(p, dimId, pos[0], pos[1], pos[2]);
    else this.server.teleport(p, pos[0], pos[1], pos[2]);
    if (p.spawnPoint) (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
  }

  onDimensionEntered(p: ServerPlayer, dim: string): void {
    this.hooks.onDimension?.(p, dim);
  }

  onPlayerDied(p: ServerPlayer, info: DamageInfo): void {
    this.using.delete(p);
    this.hooks.onDeath?.(p, info);
  }

  beforeBlockBroken(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number, state: number): void {
    const def = blocks[STATE_BLOCK[state]!]!.def;
    if (def.entity === 'furnace' || def.entity === 'chest' || def.entity === 'barrel') {
      this.containers.refreshViewers(dim, x, y, z);
    }
    void p;
  }

  // ------------------------------------------------------------------ achievements

  /** Whether an action with this stack is cheat-made (cheat item or cheat context). */
  isCheat(p: ServerPlayer, stack?: Slot): boolean {
    return isAdminStack(stack) || this.server.admin.inContext(p);
  }

  /**
   * Awards an advancement. Never while the player acts under a cheat (Admin
   * Panel action, cheat game mode or flight, a place reached by a cheat
   * teleport); callers also skip it for cheat-made items, mobs and blocks.
   */
  grant(p: ServerPlayer, id: string): void {
    if (this.server.admin.inContext(p)) return;
    if (p.achievements.has(id)) return;
    const a = ACHIEVEMENT_BY_ID.get(id);
    if (!a) return;
    p.achievements.add(id);
    p.send({ t: 'achievement', id, title: a.title });
    this.server.broadcastChat(`${p.name} has made the advancement [${a.title}]`, 'achievement');
  }

  onBlockMined(p: ServerPlayer, blockId: string, drops: ItemStack[], cheat = false): void {
    if (cheat) return;
    this.grant(p, 'mine_block');
    const held = p.heldItem();
    if (held && items[held.id]!.def.tool?.type === 'pickaxe' && (blockId === 'stone' || blockId === 'cobblestone' || blockId === 'deepslate')) this.grant(p, 'stone_age');
    void drops;
  }

  onItemPickedUp(p: ServerPlayer, stack: ItemStack, real = true): void {
    if (!real || isAdminStack(stack)) return;
    const id = itemIdOf(stack);
    if (id === 'diamond') this.grant(p, 'mine_diamond');
    if (id === 'obsidian') this.grant(p, 'form_obsidian');
    if (id === 'ancient_debris' || id === 'netherite_scrap') this.grant(p, 'obtain_ancient_debris');
    if (id === 'blaze_rod') this.grant(p, 'obtain_blaze_rod');
    if (id === 'elytra') this.grant(p, 'elytra');
    if (id === 'corrupted_eye') this.grant(p, 'corrupted_eye');
    if (id === 'iron_ingot') this.grant(p, 'smelt_iron');
  }

  onCrafted(p: ServerPlayer, stack: ItemStack): void {
    if (isAdminStack(stack)) return;
    const id = itemIdOf(stack);
    if (id === 'crafting_table') this.grant(p, 'craft_table');
    if (id.endsWith('_pickaxe') || id.endsWith('_axe') || id.endsWith('_shovel') || id.endsWith('_sword') || id.endsWith('_hoe')) this.grant(p, 'craft_tool');
    if (id === 'stone_pickaxe') this.grant(p, 'upgrade_tools');
    if (id === 'iron_pickaxe') this.grant(p, 'iron_tools');
    if (id.startsWith('iron_') && ['helmet', 'chestplate', 'leggings', 'boots'].some((a) => id.endsWith(a))) this.grant(p, 'obtain_armor');
    if (id === 'bread') this.grant(p, 'bake_bread');
    if (id.startsWith('glitched_')) this.grant(p, 'glitched_gear');
    if (id.startsWith('netherite_')) {
      const all = [36, 37, 38, 39].every((i) => items[p.inventory.get(i)?.id ?? 0]?.id.startsWith('netherite_'));
      if (all) this.grant(p, 'netherite_armor');
    }
  }

  onSmelted(p: ServerPlayer, stack: ItemStack): void {
    if (isAdminStack(stack)) return;
    const id = itemIdOf(stack);
    if (id === 'iron_ingot') this.grant(p, 'smelt_iron');
  }

  checkXpAchievements(p: ServerPlayer, level: number): void {
    // Only experience earned in play counts (cheat experience is tracked separately)
    if (level >= 30 && this.server.admin.legitLevel(p) >= 30) this.grant(p, 'level_30');
  }
}

function fromSavedSafe(raw: unknown): ItemStack | null {
  const it = itemById.get(String((raw as { id: string }).id));
  if (!it) return null;
  const count = Math.max(1, Math.min(it.maxStack, Number((raw as { count?: number }).count) || 1));
  const s: ItemStack = { id: it.num, count };
  const d = Number((raw as { damage?: number }).damage);
  if (d > 0) s.damage = d;
  const tag = (raw as { tag?: ItemStack['tag'] }).tag;
  if (tag && typeof tag === 'object') s.tag = tag;
  return s;
}

export function lookDir(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp];
}

function strippedOf(id: string): string | null {
  if (id.startsWith('stripped_')) return null;
  if (id.endsWith('_log') || id.endsWith('_wood') || id.endsWith('_stem') || id.endsWith('_hyphae')) return 'stripped_' + id;
  return null;
}

function isCompostable(id: string): boolean {
  return /seeds|sapling|leaves|short_grass|fern|kelp|sugar_cane|cactus|melon|pumpkin|wheat|carrot|potato|beetroot|apple|flower|tulip|poppy|dandelion|berries|mushroom|bread|cookie|sunroot/.test(id);
}

export { PLAYER_WIDTH, PLAYER_HEIGHT };
