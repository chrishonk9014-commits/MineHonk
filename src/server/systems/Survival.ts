/**
 * Survival stats: health/damage, God Mode health rules, hunger, air,
 * environmental hazards, status effects, experience and death.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { ARMOR_SLOTS, ARMOR_START } from '../player/Inventory';
import { items } from '../../common/registry/items';
import { blocks, STATE_BLOCK, STATE_OPAQUE, STATE_FLUID } from '../../common/registry/blocks';
import { enchantLevel } from '../../common/game/enchanting';
import { updateEnvironment } from '../../common/physics/movement';
import { isSurvivalLike } from '../../common/game/gamemode';
import type { Entity } from '../entity/Entity';

export type DamageSource =
  | 'fall'
  | 'lava'
  | 'fire'
  | 'in_fire'
  | 'drown'
  | 'starve'
  | 'void'
  | 'cactus'
  | 'magma'
  | 'berry_bush'
  | 'mob'
  | 'player'
  | 'arrow'
  | 'explosion'
  | 'magic'
  | 'wither'
  | 'poison'
  | 'suffocate'
  | 'lightning'
  | 'dragon_breath'
  | 'fly_into_wall'
  | 'freeze'
  | 'glitch'
  | 'kill';

const BYPASS_ARMOR = new Set<DamageSource>(['fall', 'drown', 'starve', 'void', 'magic', 'wither', 'poison', 'suffocate', 'fire', 'kill', 'freeze', 'fly_into_wall']);
/** Hazards that God Mode can optionally disable (world rule godHazards = false). */
const ENVIRONMENTAL = new Set<DamageSource>(['fall', 'lava', 'fire', 'in_fire', 'drown', 'starve', 'void', 'cactus', 'magma', 'berry_bush', 'suffocate', 'freeze', 'fly_into_wall']);

export interface DamageInfo {
  source: DamageSource;
  attacker?: Entity | null;
  /** Direction for knockback (unit vector x/z) */
  kbx?: number;
  kbz?: number;
  knockback?: number;
}

export class Survival {
  constructor(private readonly server: GameServer) {}

  /** Recomputes armor points from equipped armor. */
  updateArmor(p: ServerPlayer): void {
    let pts = 0;
    for (let i = ARMOR_START; i < ARMOR_START + 4; i++) {
      const s = p.inventory.get(i);
      const a = s ? items[s.id]?.def.armor : undefined;
      if (a) pts += a.defense;
    }
    if (pts !== p.armorCache) {
      p.armorCache = pts;
      p.statsDirty = true;
    }
  }

  private toughness(p: ServerPlayer): number {
    let t = 0;
    for (let i = ARMOR_START; i < ARMOR_START + 4; i++) {
      const s = p.inventory.get(i);
      const a = s ? items[s.id]?.def.armor : undefined;
      if (a) t += a.toughness ?? 0;
    }
    return t;
  }

  knockbackResistance(p: ServerPlayer): number {
    let k = 0;
    for (let i = ARMOR_START; i < ARMOR_START + 4; i++) {
      const s = p.inventory.get(i);
      const a = s ? items[s.id]?.def.armor : undefined;
      if (a) k += a.knockbackRes ?? 0;
    }
    return Math.min(1, k);
  }

  private protectionEpf(p: ServerPlayer, source: DamageSource): number {
    let epf = 0;
    for (let i = ARMOR_START; i < ARMOR_START + 4; i++) {
      const s = p.inventory.get(i);
      if (!s) continue;
      if (source !== 'void' && source !== 'kill' && source !== 'starve') epf += enchantLevel(s, 'protection');
      if (source === 'fire' || source === 'lava' || source === 'in_fire') epf += enchantLevel(s, 'fire_protection') * 2;
      if (source === 'explosion') epf += enchantLevel(s, 'blast_protection') * 2;
      if (source === 'arrow') epf += enchantLevel(s, 'projectile_protection') * 2;
    }
    if (source === 'fall') epf += enchantLevel(p.inventory.get(ARMOR_SLOTS.feet), 'feather_falling') * 3;
    return Math.min(20, epf);
  }

  /**
   * Applies damage to a player. Returns the health actually lost.
   * All damage paths (mobs, PvP, hazards) go through here.
   */
  damage(p: ServerPlayer, amount: number, info: DamageInfo): number {
    if (p.dead || !Number.isFinite(amount) || amount <= 0) return 0;
    const src = info.source;
    if (src !== 'kill') {
      if (p.abilities.invulnerable) return 0;
      if (p.spawnProtection > 0 && src !== 'void') return 0;
      if (this.server.level.difficulty === 'peaceful' && (src === 'mob' || src === 'arrow')) return 0;
      if (p.gamemode === 'god' && !this.server.level.rules.godHazards && ENVIRONMENTAL.has(src)) return 0;
      if ((src === 'fire' || src === 'lava' || src === 'in_fire') && p.effects.has('fire_resistance')) return 0;
    }
    if (src === 'mob' || src === 'arrow' || src === 'explosion') {
      const d = this.server.level.difficulty;
      if (info.attacker?.type !== 'player') amount = d === 'easy' ? Math.min(amount / 2 + 1, amount) : d === 'hard' ? amount * 1.5 : amount;
    }
    // Hurt cooldown (i-frames): only the difference from a larger hit applies.
    if (p.hurtCooldown > 10 && src !== 'kill' && src !== 'void') {
      const last = (p as { lastHurtAmount?: number }).lastHurtAmount ?? 0;
      if (amount <= last) return 0;
      const diff = amount - last;
      (p as { lastHurtAmount?: number }).lastHurtAmount = amount;
      amount = diff;
    } else {
      (p as { lastHurtAmount?: number }).lastHurtAmount = amount;
      p.hurtCooldown = 20;
    }
    if (!BYPASS_ARMOR.has(src)) {
      const armor = p.armorCache;
      const tough = this.toughness(p);
      const reduced = Math.min(20, Math.max(armor / 5, armor - amount / (2 + tough / 4)));
      amount *= 1 - reduced / 25;
      this.damageArmor(p, Math.max(1, Math.floor(amount / 4)));
    }
    const res = p.effects.get('resistance');
    if (res && src !== 'void' && src !== 'kill') amount *= Math.max(0, 1 - 0.2 * (res.amp + 1));
    const epf = this.protectionEpf(p, src);
    if (epf > 0) amount *= 1 - epf / 25;
    if (amount <= 0) return 0;
    // Absorption first
    if (p.absorption > 0) {
      const a = Math.min(p.absorption, amount);
      p.absorption -= a;
      amount -= a;
    }
    // Knockback always applies (even with infinite health)
    if (info.knockback && info.kbx !== undefined && info.kbz !== undefined) {
      const k = info.knockback * (1 - this.knockbackResistance(p));
      if (k > 0) p.send({ t: 'velocity', id: p.id, vx: info.kbx * k, vy: 0.36 * Math.min(1, k * 2), vz: info.kbz * k });
    }
    p.lastDamageSource = src;
    (p as { lastAttacker?: Entity | null }).lastAttacker = info.attacker ?? null;
    this.server.broadcastNear(p.dim, p.x, p.y, p.z, 64, { t: 'anim', id: p.id, anim: 'hurt' });
    this.server.playSound(p.dim, 'hurt.player', p.x, p.y + 1, p.z, 1, 1);
    this.exhaust(p, 0.1);
    p.statsDirty = true;
    if (amount <= 0) return 0;
    // God Mode infinite health: damage cannot reduce health (knockback/effects still applied).
    if (!Number.isFinite(p.maxHealth) && src !== 'kill') return 0;
    const before = p.health;
    p.health = Math.max(0, p.health - amount);
    p.addStat('damage_taken', Math.round((before - p.health) * 10));
    if (p.health <= 0) {
      if (this.tryTotem(p) && src !== 'kill' && src !== 'void') return before;
      this.die(p, info);
    }
    return before - p.health;
  }

  private tryTotem(p: ServerPlayer): boolean {
    for (const slot of [p.selectedSlot, 40]) {
      const s = p.inventory.get(slot);
      if (s && items[s.id]?.id === 'totem_of_undying') {
        p.inventory.set(slot, s.count > 1 ? { ...s, count: s.count - 1 } : null);
        p.health = 1;
        p.effects.clear();
        this.addEffect(p, 'regeneration', 1, 900);
        this.addEffect(p, 'absorption', 1, 100);
        this.addEffect(p, 'fire_resistance', 0, 800);
        this.server.broadcastNear(p.dim, p.x, p.y, p.z, 64, { t: 'anim', id: p.id, anim: 'totem' });
        this.server.interaction.syncInventory(p);
        return true;
      }
    }
    return false;
  }

  private damageArmor(p: ServerPlayer, amount: number): void {
    for (let i = ARMOR_START; i < ARMOR_START + 4; i++) {
      const s = p.inventory.get(i);
      if (s && items[s.id]?.def.durability) this.server.interaction.damageStack(p, i, amount);
    }
  }

  heal(p: ServerPlayer, amount: number): void {
    if (p.dead || !Number.isFinite(p.maxHealth)) return;
    const before = p.health;
    p.health = Math.min(p.maxHealth, p.health + amount);
    if (p.health !== before) p.statsDirty = true;
  }

  exhaust(p: ServerPlayer, amount: number): void {
    if (!p.abilities.survivalStats) return;
    if (p.gamemode === 'god' && !this.server.level.rules.godHunger) return;
    if (this.server.level.difficulty === 'peaceful') return;
    p.exhaustion = Math.min(40, p.exhaustion + amount);
  }

  addEffect(p: ServerPlayer, id: string, amp: number, ticks: number): void {
    const cur = p.effects.get(id);
    if (cur && (cur.amp > amp || (cur.amp === amp && cur.ticks > ticks))) return;
    if (id === 'instant_health') {
      this.heal(p, 4 << amp);
      return;
    }
    if (id === 'instant_damage') {
      this.damage(p, 6 << amp, { source: 'magic' });
      return;
    }
    if (id === 'saturation') {
      this.feed(p, amp + 1, (amp + 1) * 2);
      return;
    }
    p.effects.set(id, { amp, ticks });
    if (id === 'absorption') p.absorption = Math.max(p.absorption, 4 * (amp + 1));
    p.statsDirty = true;
  }

  feed(p: ServerPlayer, hunger: number, saturation: number): void {
    p.food = Math.min(20, p.food + hunger);
    p.saturation = Math.min(p.food, p.saturation + saturation);
    p.statsDirty = true;
  }

  giveXp(p: ServerPlayer, amount: number, fromOrb = false): void {
    if (amount <= 0) return;
    if (fromOrb) amount = this.server.interaction.applyMending(p, amount);
    const before = p.xpLevel().level;
    p.xpTotal = Math.min(2_000_000_000, p.xpTotal + amount);
    p.statsDirty = true;
    const after = p.xpLevel().level;
    if (after > before && after % 5 === 0) this.server.playSound(p.dim, 'levelup', p.x, p.y, p.z, 0.75, 1);
    this.server.interaction.checkXpAchievements(p, after);
  }

  /** Called from validated movement to track falls and environment. */
  onMove(p: ServerPlayer, prevY: number, onGround: boolean): void {
    updateEnvironment(p.dim, p.body, p.eyeHeight);
    const b = p.body;
    if (p.abilities.flying || b.inWater || b.onClimbable || p.gamemode === 'spectator' || p.effects.has('slow_falling') || p.effects.has('levitation')) {
      b.fallDistance = 0;
      return;
    }
    if (p.y < prevY) b.fallDistance += prevY - p.y;
    else if (p.y > prevY + 0.01 && !onGround) {
      // moving up (jumping) - keep accumulated distance only from the apex
      b.fallDistance = Math.max(0, b.fallDistance - (p.y - prevY));
    }
    if (onGround) {
      if (b.fallDistance > 3) this.land(p, b.fallDistance);
      b.fallDistance = 0;
    }
  }

  private land(p: ServerPlayer, dist: number): void {
    const under = p.dim.getState(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    const id = blocks[STATE_BLOCK[under]!]!.id;
    let mul = 1;
    if (id === 'hay_block' || id === 'hay_bale') mul = 0.2;
    else if (id === 'slime_block' || STATE_FLUID[under]) mul = 0;
    else if (id.endsWith('_bed')) mul = 0.5;
    else if (id === 'honey_block') mul = 0.2;
    const jb = p.effects.get('jump_boost');
    const dmg = Math.ceil((dist - 3 - (jb ? jb.amp + 1 : 0)) * mul);
    if (dmg > 0) {
      this.damage(p, dmg, { source: 'fall' });
      this.server.playSound(p.dim, dmg > 4 ? 'fall.big' : 'fall.small', p.x, p.y, p.z, 1, 1);
      p.addStat('fall_damage', dmg);
    }
  }

  /** Per-tick survival processing for a live player. */
  tickPlayer(p: ServerPlayer): void {
    if (p.dead) return;
    if (p.hurtCooldown > 0) p.hurtCooldown--;
    if (p.spawnProtection > 0) p.spawnProtection--;
    const t = this.server.tickNo;
    const level = this.server.level;
    // Status effects
    for (const [id, e] of p.effects) {
      e.ticks--;
      if (id === 'regeneration' && t % Math.max(1, 50 >> e.amp) === 0) this.heal(p, 1);
      if (id === 'poison' && t % Math.max(1, 25 >> e.amp) === 0 && p.health > 1) this.damage(p, 1, { source: 'poison' });
      if (id === 'wither' && t % Math.max(1, 40 >> e.amp) === 0) this.damage(p, 1, { source: 'wither' });
      if (id === 'hunger') this.exhaust(p, 0.005 * (e.amp + 1));
      if (e.ticks <= 0) {
        p.effects.delete(id);
        if (id === 'absorption') p.absorption = 0;
        p.statsDirty = true;
      }
    }
    if (t % 20 === 0 && p.effects.size) p.statsDirty = true;

    if (!p.abilities.survivalStats && p.gamemode !== 'god') {
      p.air = p.maxAir;
      return;
    }
    const b = p.body;
    updateEnvironment(p.dim, b, p.eyeHeight);
    // Air / drowning
    if (b.eyesInWater && !p.effects.has('water_breathing')) {
      const resp = enchantLevel(p.inventory.get(ARMOR_SLOTS.head), 'respiration');
      if (resp === 0 || Math.random() < 1 / (resp + 1)) p.air--;
      if (p.air <= -20) {
        p.air = 0;
        this.damage(p, 2, { source: 'drown' });
      }
      p.statsDirty = true;
    } else if (p.air < p.maxAir) {
      p.air = Math.min(p.maxAir, p.air + 4);
      p.statsDirty = true;
    }
    // Fire & lava
    const fire = p as { fireTicks?: number };
    if (b.inLava) {
      if (t % 10 === 0) this.damage(p, 4, { source: 'lava' });
      fire.fireTicks = 300;
    }
    if (b.inWater && (fire.fireTicks ?? 0) > 0) fire.fireTicks = 0;
    if ((fire.fireTicks ?? 0) > 0) {
      fire.fireTicks!--;
      if (t % 20 === 0) this.damage(p, 1, { source: 'fire' });
      if (fire.fireTicks === 0 || fire.fireTicks! % 20 === 0) p.metaDirty = true;
    }
    // Contact blocks
    const feet = p.dim.getState(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z));
    const fdef = blocks[STATE_BLOCK[feet]!]!.def;
    if ((fdef.model === 'fire' || fdef.id === 'campfire') && t % 10 === 0) {
      this.damage(p, fdef.contactDamage ?? 1, { source: 'in_fire' });
      fire.fireTicks = Math.max(fire.fireTicks ?? 0, 160);
    }
    if (fdef.id === 'sweet_berry_bush' && t % 10 === 0) this.damage(p, 1, { source: 'berry_bush' });
    if (fdef.id === 'powder_snow' && t % 40 === 0) this.damage(p, 1, { source: 'freeze' });
    const under = p.dim.getState(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z));
    const udef = blocks[STATE_BLOCK[under]!]!.def;
    if ((udef.id === 'magma_block' || udef.id === 'smoldering_netherrack') && b.onGround && !p.sneaking && t % 10 === 0 && !enchantLevel(p.inventory.get(ARMOR_SLOTS.feet), 'frost_walker')) this.damage(p, 1, { source: 'magma' });
    // Cactus: touching horizontally
    if (t % 10 === 0) {
      for (const [ox, oz] of [
        [0.35, 0],
        [-0.35, 0],
        [0, 0.35],
        [0, -0.35],
      ] as const) {
        const s = p.dim.getState(Math.floor(p.x + ox), Math.floor(p.y + 0.5), Math.floor(p.z + oz));
        if (blocks[STATE_BLOCK[s]!]!.id === 'cactus') {
          this.damage(p, 1, { source: 'cactus' });
          break;
        }
      }
    }
    // Suffocation
    const head = p.dim.getState(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    if (STATE_OPAQUE[head] && !p.abilities.noClip && t % 10 === 0) this.damage(p, 1, { source: 'suffocate' });
    // Void
    if (p.y < -64 && t % 10 === 0) this.damage(p, 4, { source: 'void' });

    // Hunger & regeneration
    const peaceful = level.difficulty === 'peaceful';
    if (peaceful) {
      if (t % 20 === 0) this.heal(p, 1);
      if (t % 10 === 0 && p.food < 20) {
        p.food++;
        p.statsDirty = true;
      }
    }
    if (p.exhaustion >= 4) {
      p.exhaustion -= 4;
      if (p.saturation > 0) p.saturation = Math.max(0, p.saturation - 1);
      else if (!peaceful) p.food = Math.max(0, p.food - 1);
      p.statsDirty = true;
    }
    const regen = level.rules.naturalRegeneration;
    const finiteMax = Number.isFinite(p.maxHealth);
    if (regen && finiteMax && p.saturation > 0 && p.food >= 20 && p.health < p.maxHealth) {
      if (++p.foodTimer >= 10) {
        const amt = Math.min(p.saturation, 6) / 6;
        this.heal(p, amt);
        this.exhaust(p, amt * 6);
        p.foodTimer = 0;
      }
    } else if (regen && finiteMax && p.food >= 18 && p.health < p.maxHealth) {
      if (++p.foodTimer >= 80) {
        this.heal(p, 1);
        this.exhaust(p, 6);
        p.foodTimer = 0;
      }
    } else if (p.food <= 0) {
      if (++p.foodTimer >= 80) {
        const d = level.difficulty;
        if (d === 'hard' || (d === 'normal' && p.health > 1) || (d === 'easy' && p.health > 10) || !finiteMax) this.damage(p, 1, { source: 'starve' });
        p.foodTimer = 0;
      }
    } else p.foodTimer = 0;
    // Sprinting costs food
    if (p.sprinting && b.onGround) this.exhaust(p, 0.01);
    if (!isSurvivalLike(p.gamemode)) p.exhaustion = 0;
  }

  die(p: ServerPlayer, info: DamageInfo): void {
    if (p.dead) return;
    p.dead = true;
    p.health = 0;
    p.dig = null;
    p.statsDirty = true;
    const msg = deathMessage(p, info);
    this.server.broadcastChat(msg, 'death');
    this.server.broadcastNear(p.dim, p.x, p.y, p.z, 64, { t: 'anim', id: p.id, anim: 'death' }, p);
    p.addStat('deaths');
    const level = this.server.level;
    const score = p.xpTotal;
    if (!level.rules.keepInventory) {
      this.server.interaction.dropAll(p);
      const lvl = p.xpLevel().level;
      const xp = Math.min(100, lvl * 7);
      if (xp > 0) this.server.mining.dropXp(p.dim, p.x, p.y + 0.5, p.z, xp);
      p.xpTotal = 0;
    }
    p.effects.clear();
    p.absorption = 0;
    (p as { fireTicks?: number }).fireTicks = 0;
    p.send({ t: 'death', message: msg, hardcore: level.hardcore, score });
    this.server.interaction.closeWindow(p, p.windowId, true);
    this.server.interaction.onPlayerDied(p, info);
  }
}

function deathMessage(p: ServerPlayer, info: DamageInfo): string {
  const by = info.attacker ? ((info.attacker as { name?: string }).name ?? info.attacker.customName ?? prettyMob(info.attacker.type)) : '';
  switch (info.source) {
    case 'fall':
      return `${p.name} hit the ground too hard`;
    case 'lava':
      return `${p.name} tried to swim in lava`;
    case 'fire':
      return `${p.name} burned to death`;
    case 'in_fire':
      return `${p.name} went up in flames`;
    case 'drown':
      return `${p.name} drowned`;
    case 'starve':
      return `${p.name} starved to death`;
    case 'void':
      return `${p.name} fell out of the world`;
    case 'cactus':
      return `${p.name} was pricked to death`;
    case 'magma':
      return `${p.name} discovered the floor was lava`;
    case 'berry_bush':
      return `${p.name} was poked to death by a sweet berry bush`;
    case 'explosion':
      return by ? `${p.name} was blown up by ${by}` : `${p.name} blew up`;
    case 'arrow':
      return `${p.name} was shot by ${by || 'an arrow'}`;
    case 'player':
      return `${p.name} was slain by ${by}`;
    case 'mob':
      return `${p.name} was slain by ${by}`;
    case 'magic':
      return `${p.name} was killed by magic`;
    case 'wither':
      return `${p.name} withered away`;
    case 'poison':
      return `${p.name} succumbed to poison`;
    case 'suffocate':
      return `${p.name} suffocated in a wall`;
    case 'lightning':
      return `${p.name} was struck by lightning`;
    case 'dragon_breath':
      return `${p.name} was roasted in dragon's breath`;
    case 'fly_into_wall':
      return `${p.name} experienced kinetic energy`;
    case 'freeze':
      return `${p.name} froze to death`;
    case 'glitch':
      return `${p.name} was deleted by the Farlands`;
    default:
      return `${p.name} died`;
  }
}

export function prettyMob(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
