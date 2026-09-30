/**
 * Mob system: spawning (natural, structures, spawners, eggs), combat
 * (player melee, mob melee/ranged, projectiles), explosions, breeding,
 * taming, shearing, trading, loot and XP, persistence hooks.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import { Mob, isPlayer, isAlive, type Target } from '../entity/Mob';
import { ItemEntity } from '../entity/ItemEntity';
import { LivingEntity, type HurtInfo } from '../entity/Living';
import type { Entity } from '../entity/Entity';
import { Projectile, PrimedTnt, type ProjectileKind, type ProjectileHit } from '../entity/Projectile';
import { EndCrystal } from '../entity/EndEntities';
import type { ServerPlayer } from '../player/ServerPlayer';
import { installBrain } from '../ai/brains';
import type { RangedKind } from '../ai/goals';
import { canSee } from '../ai/goals';
import { MOB_DEFS, mobDef, type MobCategory } from '../../common/data/mobs';
import { TRADES, PROFESSIONS, type Profession } from '../../common/data/trades';
import { biomeOf } from '../../common/registry/biomes';
import type { SpawnEntry } from '../../common/data/biomes';
import { items, itemById } from '../../common/registry/items';
import { S, STATE_SOLID, STATE_FLUID, STATE_BLOCK, blocks, STATE_OPAQUE, getProp } from '../../common/registry/blocks';
import { collisionShape } from '../../common/physics/shapes';
import { Random, hashInts } from '../../common/math/rng';
import { rollLoot } from '../../common/game/loot';
import { enchantLevel, selectEnchantments } from '../../common/game/enchanting';
import { stackOf, type ItemStack, cloneStack, isAdminStack, markAdmin } from '../../common/game/itemstack';
import { chunkIndex } from '../../common/world/constants';
import { lookDir } from './Interaction';
import { Window } from './Containers';
import type { C2S } from '../../common/net/protocol';
import type { Chunk } from '../../common/world/chunk';

const CAPS: Record<MobCategory, number> = { monster: 40, creature: 12, ambient: 6, water: 8, npc: 0, boss: 0 };
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

export interface Offer {
  buy: ItemStack;
  buy2?: ItemStack;
  sell: ItemStack;
  uses: number;
  maxUses: number;
}

/** Monster spawn lists that replace the biome's inside certain structures. */
/** V2: who lives in each cave biome (by CaveBiome number). The deep dark stays empty. */
const CAVE_MONSTERS: Record<number, SpawnEntry[]> = {
  1: [{ mob: 'zombie', weight: 90, min: 2, max: 4 }, { mob: 'skeleton', weight: 90, min: 2, max: 4 }, { mob: 'creeper', weight: 80, min: 1, max: 2 }, { mob: 'spider', weight: 60, min: 1, max: 2 }],
  2: [{ mob: 'skeleton', weight: 80, min: 2, max: 4 }, { mob: 'zombie', weight: 60, min: 2, max: 3 }, { mob: 'cave_spider', weight: 40, min: 2, max: 3 }, { mob: 'creeper', weight: 40, min: 1, max: 1 }, { mob: 'cave_stalker', weight: 20, min: 1, max: 1 }],
  3: [{ mob: 'zombie', weight: 60, min: 1, max: 3 }, { mob: 'skeleton', weight: 60, min: 1, max: 3 }, { mob: 'creeper', weight: 40, min: 1, max: 1 }],
  4: [{ mob: 'spider', weight: 40, min: 1, max: 2 }, { mob: 'zombie', weight: 30, min: 1, max: 2 }],
  5: [{ mob: 'crystal_mite', weight: 100, min: 2, max: 5 }, { mob: 'skeleton', weight: 30, min: 1, max: 2 }],
  6: [{ mob: 'zombie', weight: 60, min: 2, max: 4 }, { mob: 'husk', weight: 30, min: 1, max: 3 }, { mob: 'skeleton', weight: 60, min: 2, max: 3 }, { mob: 'drowned', weight: 20, min: 1, max: 2 }],
  7: [{ mob: 'magma_cube', weight: 80, min: 1, max: 3 }, { mob: 'skeleton', weight: 40, min: 1, max: 2 }, { mob: 'blaze', weight: 5, min: 1, max: 1 }],
  8: [{ mob: 'stray', weight: 100, min: 2, max: 4 }, { mob: 'skeleton', weight: 30, min: 1, max: 2 }, { mob: 'zombie', weight: 30, min: 1, max: 2 }],
  // V3: things that leaked in from the Farlands
  10: [{ mob: 'glitch_zombie', weight: 60, min: 1, max: 3 }, { mob: 'glitch_skeleton', weight: 50, min: 1, max: 2 }, { mob: 'farlands_wanderer', weight: 25, min: 1, max: 1 }, { mob: 'void_wisp', weight: 30, min: 1, max: 2 }],
};
const CAVE_WATER: Record<number, SpawnEntry[]> = {
  1: [{ mob: 'glow_squid', weight: 10, min: 1, max: 3 }],
  2: [{ mob: 'glow_squid', weight: 10, min: 1, max: 3 }],
  3: [{ mob: 'axolotl', weight: 10, min: 2, max: 4 }, { mob: 'glow_squid', weight: 6, min: 1, max: 3 }, { mob: 'tropical_fish', weight: 8, min: 3, max: 6 }],
  6: [{ mob: 'glow_squid', weight: 10, min: 1, max: 2 }],
};

const STRUCTURE_SPAWNS: Record<string, SpawnEntry[]> = {
  nether_fortress: [
    { mob: 'blaze', weight: 10, min: 2, max: 3 },
    { mob: 'wither_skeleton', weight: 8, min: 1, max: 3 },
    { mob: 'zombified_piglin', weight: 5, min: 2, max: 4 },
    { mob: 'skeleton', weight: 2, min: 1, max: 2 },
    { mob: 'magma_cube', weight: 3, min: 1, max: 3 },
  ],
  bastion: [
    { mob: 'piglin', weight: 10, min: 2, max: 4 },
    { mob: 'hoglin', weight: 2, min: 1, max: 2 },
  ],
  witch_hut: [{ mob: 'witch', weight: 1, min: 1, max: 1 }],
  pillager_outpost: [{ mob: 'pillager', weight: 1, min: 1, max: 3 }],
};

/** The froglight a frog of each kind makes from a magma cube. */
const FROGLIGHT: Record<string, string> = { temperate: 'ochre', warm: 'pearlescent', cold: 'verdant' };

export class MobSystem {
  private readonly rng = new Random();
  private readonly spawners = new Map<Dimension, Map<string, { x: number; y: number; z: number; delay: number }>>();

  constructor(private readonly server: GameServer) {}

  // ------------------------------------------------------------------ spawning
  create(type: string, opts: { baby?: boolean; data?: Record<string, unknown>; reason?: string } = {}): Mob | null {
    const def = mobDef(type);
    if (!def) return null;
    const m = new Mob(type);
    const r = this.rng;
    if (def.equipment) {
      for (const [id, chance] of def.equipment) {
        if (r.next() < chance * (this.server.level.difficulty === 'hard' ? 1.5 : 1)) {
          const it = itemById.get(id);
          if (it) {
            m.held = { id: it.num, count: 1 };
            break;
          }
        }
      }
    }
    m.baby = opts.baby ?? (def.babyChance !== undefined && r.next() < def.babyChance);
    switch (def.brain) {
      case 'sheep': {
        const roll = r.next();
        m.data.color = roll < 0.815 ? 'white' : roll < 0.865 ? 'light_gray' : roll < 0.915 ? 'gray' : roll < 0.965 ? 'black' : roll < 0.995 ? 'brown' : 'pink';
        break;
      }
      case 'slime':
        m.data.size = [1, 2, 4][r.int(3)];
        this.applySlimeSize(m);
        break;
      case 'cat':
        m.data.variant = ['tabby', 'black', 'siamese', 'ginger', 'calico'][r.int(5)];
        break;
      case 'villager': {
        const prof = (opts.data?.profession as Profession | undefined) ?? (r.chance(0.15) ? 'none' : PROFESSIONS[r.int(PROFESSIONS.length)]!);
        m.data.profession = prof;
        m.data.offers = this.makeOffers(prof, r);
        m.persistenceRequired = true;
        break;
      }
      case 'wolf':
      case 'golem':
        m.persistenceRequired = def.brain === 'golem';
        break;
    }
    if (def.id === 'horse') {
      // Each horse is its own: speed and jump strength (averaged, so extremes are rare) and coat
      m.data.hspeed = 0.1125 + ((r.next() + r.next() + r.next()) / 3) * 0.225;
      m.data.hjump = 0.4 + ((r.next() + r.next() + r.next()) / 3) * 0.6;
      m.data.variant = ['chestnut', 'bay', 'black', 'white', 'gray', 'creamy', 'dark_brown'][r.int(7)];
    }
    if (def.id === 'creeper' && r.chance(0.02)) m.data.charged = true;
    switch (def.id) {
      case 'parrot':
        m.data.variant = ['red', 'blue', 'green', 'cyan', 'gray'][r.int(5)];
        break;
      case 'llama':
        m.data.variant = ['creamy', 'white', 'brown', 'gray'][r.int(4)];
        break;
      case 'panda': {
        // Personalities: brown pandas are rare, aggressive ones fight back
        const roll = r.next();
        m.data.variant = roll < 0.02 ? 'brown' : roll < 0.12 ? 'aggressive' : roll < 0.3 ? 'lazy' : roll < 0.45 ? 'playful' : 'normal';
        break;
      }
      case 'axolotl':
        m.data.variant = r.chance(1 / 1200) ? 'blue' : ['lucy', 'wild', 'gold', 'cyan'][r.int(4)];
        break;
      case 'tropical_fish': {
        const cols = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'cyan', 'purple', 'blue', 'red', 'black'];
        m.data.variant = `${['kob', 'stripey', 'flopper', 'sunstreak', 'dasher', 'spotty'][r.int(6)]}:${cols[r.int(cols.length)]}:${cols[r.int(cols.length)]}`;
        break;
      }
      case 'pufferfish':
        m.data.puff = 0;
        break;
    }
    if (opts.data) for (const [k, v] of Object.entries(opts.data)) if (k !== 'profession') m.data[k] = v;
    if (def.category === 'boss') {
      m.persistenceRequired = true;
      m.maxHealth = def.health;
      m.health = def.health;
    }
    installBrain(m);
    return m;
  }

  spawn(dim: Dimension, type: string, x: number, y: number, z: number, opts: { baby?: boolean; data?: Record<string, unknown>; reason?: string; persistent?: boolean } = {}): Mob | null {
    const m = this.create(type, opts);
    if (!m) return null;
    m.setPos(x, y, z);
    m.yaw = this.rng.next() * Math.PI * 2;
    if (opts.persistent) m.persistenceRequired = true;
    // Frogs take their colour from the climate they hatch in
    if (type === 'frog' && !m.data.variant) {
      const t = biomeOf(dim.getBiome(Math.floor(x), Math.floor(z))).temperature;
      m.data.variant = t < 0.4 ? 'cold' : t > 1 ? 'warm' : 'temperate';
    }
    dim.addEntity(m);
    return m;
  }

  private applySlimeSize(m: Mob): void {
    const size = Number(m.data.size ?? 1);
    const w = 0.52 * size;
    m.body.width = w;
    m.body.height = w;
    m.maxHealth = size * size;
    m.health = m.maxHealth;
  }

  private makeOffers(prof: Profession, r: Random): Offer[] {
    if (prof === 'none') return [];
    const list = TRADES[prof];
    const picks = [...list].sort(() => r.next() - 0.5).slice(0, 4 + r.int(2));
    return picks.map((t) => {
      const sell = stackOf(t.sell[0], t.sell[1]);
      if (t.sell[0] === 'enchanted_book') {
        const ench = selectEnchantments(r, { id: itemById.get('book')!.num, count: 1 }, 5 + r.int(25), true);
        sell.tag = { ench };
      }
      return { buy: stackOf(t.buy[0], t.buy[1]), buy2: t.buy2 ? stackOf(t.buy2[0], t.buy2[1]) : undefined, sell, uses: 0, maxUses: t.maxUses };
    });
  }

  /** Called once per chunk right after world generation. */
  /** Spawns generated non-mob entities (end crystals); returns true when handled. */
  extraEntity?: (dim: Dimension, type: string, x: number, y: number, z: number) => boolean;
  /** Boss death hand-off (the dragon fight runs its own death sequence). */
  /** A boss died; returns false to let its death run the usual way (loot, experience, advancements). */
  onBossDeath?: (m: Mob, killer: ServerPlayer | null, info: HurtInfo) => boolean;

  onChunkGenerated(dim: Dimension, c: Chunk): void {
    let spawned = false;
    for (const e of c.genEntities) {
      if (this.extraEntity?.(dim, e.type, e.x, e.y, e.z)) continue;
      const m = this.spawn(dim, e.type, e.x, e.y, e.z, { data: e.data, persistent: true, reason: 'structure' });
      if (m) spawned = true;
    }
    c.genEntities.length = 0;
    // Initial animals in the overworld (creature packs at chunk generation)
    if (dim.id === 'overworld') {
      const rng = new Random(hashInts(this.server.level.seedNum, c.cx, c.cz, 0xa41a));
      if (rng.chance(0.1)) {
        const x = (c.cx << 4) + rng.int(16);
        const z = (c.cz << 4) + rng.int(16);
        const biome = biomeOf(c.getBiome(x & 15, z & 15));
        const list = biome.spawns?.creature ?? [];
        if (list.length) {
          const entry = weighted(list, rng);
          const n = entry.min + rng.int(entry.max - entry.min + 1);
          for (let i = 0; i < n; i++) {
            const px = x + rng.int(6) - 3;
            const pz = z + rng.int(6) - 3;
            if (px >> 4 !== c.cx || pz >> 4 !== c.cz) continue;
            const y = c.getHeight(px & 15, pz & 15);
            const ground = c.get(px & 15, y - 1, pz & 15);
            if (STATE_FLUID[ground] || y < 2) continue;
            if (this.spawn(dim, entry.mob, px + 0.5, y, pz + 0.5, { persistent: true })) spawned = true;
          }
        }
      }
    }
    if (spawned) {
      c.modified = true;
      c.dirty = true;
    }
    this.registerSpawners(dim, c);
  }

  onChunkLoaded(dim: Dimension, c: Chunk): void {
    this.registerSpawners(dim, c);
  }

  onChunkUnloaded(dim: Dimension, c: Chunk): void {
    const m = this.spawners.get(dim);
    if (!m) return;
    for (const [k, s] of m) if (s.x >> 4 === c.cx && s.z >> 4 === c.cz) m.delete(k);
  }

  private registerSpawners(dim: Dimension, c: Chunk): void {
    for (const [k, be] of c.blockEntities) {
      if (be.type !== 'spawner') continue;
      const x = (c.cx << 4) + (k & 15);
      const z = (c.cz << 4) + ((k >> 4) & 15);
      const y = k >> 8;
      let m = this.spawners.get(dim);
      if (!m) this.spawners.set(dim, (m = new Map()));
      m.set(`${x},${y},${z}`, { x, y, z, delay: Number(be.delay ?? 20) });
    }
  }

  restore(dim: Dimension, d: Record<string, unknown>): Entity | null {
    if (d.kind === 'mob') {
      const m = Mob.restore(d);
      if (!m) return null;
      if (m.def.brain === 'slime') {
        const hp = m.health;
        this.applySlimeSize(m);
        m.health = Math.min(m.maxHealth, hp);
      }
      installBrain(m);
      return m;
    }
    if (d.kind === 'projectile') {
      const pr = Projectile.restoreTrident(d);
      if (!pr) return null;
      pr.onHit = (x, hit) => this.onProjectileHit(x, hit);
      pr.onReturn = (x) => this.tridentReturned(x);
      return pr;
    }
    void dim;
    return null;
  }

  // ------------------------------------------------------------------ tick
  tick(): void {
    const s = this.server;
    const t = s.tickNo;
    for (const dim of s.dims.values()) {
      for (const e of dim.entities.values()) if (e instanceof Mob && !e.dead) this.specialTick(e);
      this.tickSpawners(dim);
    }
    if (t % 20 === 0) this.despawn();
    if (s.level.rules.doMobSpawning && t % 10 === 0) this.naturalSpawn();
  }

  /** Per-mob behaviours that don't fit the goal system. */
  private specialTick(m: Mob): void {
    const s = this.server;
    switch (m.type) {
      case 'chicken':
        if (!m.baby && m.age % 20 === 0 && m.rng.next() < 1 / 300) {
          s.mining.dropItem(m.dim, m.x, m.y + 0.3, m.z, stackOf('egg', 1));
          s.playSound(m.dim, 'pop', m.x, m.y, m.z, 0.5, 1.2);
        }
        break;
      case 'cave_stalker': {
        // Light burns it: seek darkness and take damage in bright places
        if (m.age % 20 !== 0) break;
        const l = m.dim.getLight(Math.floor(m.x), Math.floor(m.y + 1.5), Math.floor(m.z));
        const light = Math.max((l >> 4) * (m.isDaytime() ? 1 : 0.25), l & 15);
        if (light >= 10) {
          m.hurt(2, { source: 'magic', attacker: null });
          s.particles(m.dim, 'smoke', m.x, m.y + 1.5, m.z, 6, 0.4);
          m.target = null;
        }
        break;
      }
      case 'ember_beast':
        if (m.age % 40 === 0 && m.target && m.rng.chance(0.3) && s.level.rules.mobGriefing) {
          const x = Math.floor(m.x);
          const y = Math.floor(m.y);
          const z = Math.floor(m.z);
          if (m.dim.getState(x, y, z) === 0 && STATE_SOLID[m.dim.getState(x, y - 1, z)]) m.dim.setBlock(x, y, z, S('fire'));
        }
        if (m.age % 4 === 0) s.particles(m.dim, 'ember', m.x, m.y + 1, m.z, 1, 0.5);
        break;
      case 'void_wisp':
      case 'rift_walker':
        if (m.age % 6 === 0) s.particles(m.dim, 'portal', m.x, m.y + m.def.height * 0.6, m.z, 1, 0.4);
        break;
      case 'farlands_wanderer':
      case 'glitch_zombie':
      case 'glitch_skeleton':
      case 'glitched_cow':
      case 'glitched_sheep':
        if (m.age % 30 === 0 && m.rng.chance(0.2)) s.particles(m.dim, 'glitch', m.x, m.y + 1, m.z, 3, 0.4);
        break;
      case 'enderman':
        if (m.age % 5 === 0 && (m.target || m.angryAt)) s.particles(m.dim, 'portal', m.x, m.y + 1.5, m.z, 1, 0.5);
        break;
      case 'warden':
        s.warden?.tick(m);
        break;
      default:
        this.animalTick(m);
    }
    if (m.data.slowTicks && (m.data.slowTicks = (m.data.slowTicks as number) - 1) <= 0) delete m.data.slowTicks;
    if (m.data.alarmTicks && (m.data.alarmTicks = (m.data.alarmTicks as number) - 1) <= 0) delete m.data.alarmTicks;
    if (m.data.glowTicks && (m.data.glowTicks = (m.data.glowTicks as number) - 1) <= 0) {
      delete m.data.glowTicks;
      m.metaDirty = true;
    }
  }

  /** The newer animals' own habits (parrots, pufferfish, axolotls, pandas, frogs, camels). */
  private animalTick(m: Mob): void {
    const s = this.server;
    switch (m.type) {
      case 'parrot': {
        if (m.age % 20 === 0) {
          // Dances while a record plays nearby
          const dancing = !!s.gadgets?.recordNear(m.dim, m.x, m.y, m.z, 4);
          if (!!m.data.dancing !== dancing) {
            m.data.dancing = dancing || undefined;
            m.metaDirty = true;
          }
        }
        // Imitates a monster it can hear
        if (m.age % 40 === 0 && m.rng.chance(1 / 12)) {
          const near = m.dim.entitiesNear(m.x, m.y, m.z, 20, (e) => e instanceof Mob && !e.dead && e.def.category === 'monster');
          const pick = near[m.rng.int(Math.max(1, near.length))] as Mob | undefined;
          if (pick) s.playSound(m.dim, `mob.${pick.soundKey()}.idle`, m.x, m.y + 0.5, m.z, 0.7, 1.7);
        }
        break;
      }
      case 'pufferfish': {
        if (m.age % 5 !== 0) break;
        // Puffs up when something big swims close, and stings what touches it
        const threat = m.dim.entitiesNear(m.x, m.y, m.z, 2.5, (e) => e !== m && (isPlayer(e) ? !e.dead && e.gamemode !== 'creative' && e.gamemode !== 'spectator' : e instanceof Mob && !e.dead && !e.def.aquatic && e.type !== 'axolotl')).length > 0;
        const puff = Number(m.data.puff ?? 0);
        const next = threat ? Math.min(2, puff + 1) : m.age % 40 === 0 ? Math.max(0, puff - 1) : puff;
        if (next !== puff) {
          m.data.puff = next;
          m.body.width = m.body.height = [0.35, 0.5, 0.7][next]!;
          m.metaDirty = true;
          s.playSound(m.dim, next > puff ? 'pufferfish.blow_up' : 'pufferfish.blow_out', m.x, m.y, m.z, 0.6, 1);
        }
        if (next > 0) {
          for (const e of m.dim.entitiesNear(m.x, m.y, m.z, 0.8 + next * 0.3, (e) => e !== m && (isPlayer(e) || (e instanceof Mob && !e.def.aquatic && e.type !== 'axolotl')))) {
            if (isPlayer(e) && (e.dead || e.gamemode === 'creative' || e.gamemode === 'spectator')) continue;
            if (this.damage(e, 1 + next, { source: 'mob', attacker: m }) > 0) {
              if (isPlayer(e)) s.interaction.survival.addEffect(e, 'poison', 0, 60 * next);
              s.playSound(m.dim, 'pufferfish.sting', m.x, m.y, m.z, 1, 1);
            }
          }
        }
        break;
      }
      case 'axolotl': {
        // Plays dead when badly hurt, healing while it lies still
        const pd = Number(m.data.playDead ?? 0);
        if (pd > 0) {
          m.data.playDead = pd - 1;
          m.target = null;
          m.stopNavigation();
          if (m.age % 20 === 0) m.health = Math.min(m.maxHealth, m.health + 1);
          if (pd - 1 <= 0) {
            delete m.data.playDead;
            m.metaDirty = true;
          }
        } else if (s.tickNo - m.lastHurtTick < 2 && m.health < m.maxHealth / 2 && m.body.inWater && m.rng.chance(1 / 3)) {
          m.data.playDead = 200;
          m.revengeTarget = null;
          m.metaDirty = true;
        }
        break;
      }
      case 'panda': {
        if (m.age % 20 !== 0) break;
        // Pandas pick up bamboo and sit down to eat it
        const eating = Number(m.data.eating ?? 0);
        if (eating > 0) {
          m.data.eating = eating - 20;
          m.stopNavigation();
          if (m.data.eating as number <= 0) {
            delete m.data.eating;
            m.sitting = false;
            m.metaDirty = true;
          }
        } else {
          const food = m.dim.entitiesNear(m.x, m.y, m.z, 3, (e) => e instanceof ItemEntity && !e.removed && items[e.stack.id]?.id === 'bamboo')[0] as ItemEntity | undefined;
          if (food) {
            food.stack.count > 1 ? (food.stack = { ...food.stack, count: food.stack.count - 1 }) : food.remove();
            m.data.eating = 200;
            m.sitting = true;
            m.metaDirty = true;
            s.playSound(m.dim, 'eat', m.x, m.y + 1, m.z, 0.6, 0.8);
          } else if (m.data.variant === 'playful' && !m.data.rolling && m.rng.chance(1 / 30)) {
            m.data.rolling = 30;
            m.metaDirty = true;
          } else if (m.data.variant === 'lazy' && m.rng.chance(1 / 20)) {
            m.sitting = !m.sitting;
            m.metaDirty = true;
          }
        }
        if (m.data.rolling && (m.data.rolling = (m.data.rolling as number) - 20) <= 0) {
          delete m.data.rolling;
          m.metaDirty = true;
        }
        // Baby pandas sneeze now and then
        if (m.baby && m.rng.chance(1 / 300)) {
          s.playSound(m.dim, 'panda.sneeze', m.x, m.y + 0.5, m.z, 1, 1.4);
          s.mining.dropItem(m.dim, m.x, m.y + 0.5, m.z, stackOf('slime_ball', 1));
        }
        break;
      }
      case 'camel':
        // Camels settle down for long rests
        if (m.age % 100 === 0 && !m.rider && m.rng.chance(1 / 12)) {
          m.sitting = !m.sitting;
          m.stopNavigation();
          m.metaDirty = true;
        }
        break;
      case 'frog':
        if (m.data.tongue && (m.data.tongue = (m.data.tongue as number) - 1) <= 0) {
          delete m.data.tongue;
          m.metaDirty = true;
        }
        break;
    }
  }

  /** Cave mob reactions to being hurt: sporelings puff spores, crystal mites call the swarm. */
  onCaveMobHurt(m: Mob, attacker: Entity): void {
    const s = this.server;
    if (m.type === 'sporeling') {
      if (m.age - Number(m.data.puffedAt ?? -100) < 60) return;
      m.data.puffedAt = m.age;
      s.particles(m.dim, 'spore_cloud', m.x, m.y + 0.8, m.z, 30, 1.2);
      s.playSound(m.dim, 'sporeling.puff', m.x, m.y + 0.8, m.z, 1, 1);
      for (const p of s.players.values()) {
        if (p.dim !== m.dim || p.dead || p.distanceSq(m.x, m.y, m.z) > 9) continue;
        s.interaction.survival.addEffect(p, 'nausea', 0, 160);
        s.interaction.survival.addEffect(p, 'slowness', 0, 60);
      }
      return;
    }
    // Crystal mites: the rest of the nest joins in
    for (const e of m.dim.entitiesNear(m.x, m.y, m.z, 10, (en) => en instanceof Mob && en.type === 'crystal_mite' && !en.dead && en !== m)) {
      const other = e as Mob;
      if (!other.target) other.target = attacker as Target;
    }
  }

  /** Outlines an entity through walls for a while (spectral arrows, bells). */
  glow(e: Entity, ticks: number): void {
    if (isPlayer(e)) {
      this.server.interaction.survival.addEffect(e, 'glowing', 0, ticks);
      e.metaDirty = true;
    } else if (e instanceof Mob) {
      if (!e.data.glowTicks) e.metaDirty = true;
      e.data.glowTicks = Math.max(Number(e.data.glowTicks ?? 0), ticks);
    }
  }

  private tickSpawners(dim: Dimension): void {
    const list = this.spawners.get(dim);
    if (!list) return;
    for (const [k, sp] of list) {
      if (dim.getState(sp.x, sp.y, sp.z) !== S('spawner')) {
        list.delete(k);
        continue;
      }
      let nearPlayer = false;
      for (const p of this.server.players.values()) if (p.dim === dim && !p.dead && p.distanceSq(sp.x + 0.5, sp.y + 0.5, sp.z + 0.5) < 256) nearPlayer = true;
      if (!nearPlayer) continue;
      if (this.server.tickNo % 4 === 0) this.server.particles(dim, 'flame', sp.x + 0.5, sp.y + 0.5, sp.z + 0.5, 1, 0.3);
      if (--sp.delay > 0) continue;
      sp.delay = 200 + this.rng.int(600);
      const be = dim.getBlockEntity(sp.x, sp.y, sp.z);
      const type = String(be?.mob ?? 'zombie');
      if (this.server.level.difficulty === 'peaceful' && mobDef(type)?.category === 'monster') continue;
      const nearby = dim.entitiesNear(sp.x, sp.y, sp.z, 8, (e) => e.type === type).length;
      if (nearby >= 6) continue;
      for (let i = 0; i < 4; i++) {
        const x = sp.x + 0.5 + (this.rng.next() - 0.5) * 8;
        const y = sp.y + this.rng.int(3) - 1;
        const z = sp.z + 0.5 + (this.rng.next() - 0.5) * 8;
        if (!this.fits(dim, type, x, y, z)) continue;
        const m = this.spawn(dim, type, x, y, z, { reason: 'spawner' });
        if (m) this.server.particles(dim, 'smoke', x, y + 0.5, z, 8, 0.4);
      }
    }
  }

  private fits(dim: Dimension, type: string, x: number, y: number, z: number): boolean {
    const d = mobDef(type)!;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const by = Math.floor(y);
    for (let i = 0; i < Math.ceil(d.height); i++) {
      const s = dim.getState(bx, by + i, bz);
      if (collisionShape(s).length || (STATE_FLUID[s] && !d.aquatic)) return false;
    }
    if (d.flying || d.aquatic) return true;
    const below = dim.getState(bx, by - 1, bz);
    return STATE_SOLID[below] === 1 && !STATE_FLUID[below];
  }

  private despawn(): void {
    for (const dim of this.server.dims.values()) {
      for (const e of dim.entities.values()) {
        if (!(e instanceof Mob) || e.dead || e.persistenceRequired || e.customName || e.owner) continue;
        const cat = e.def.category;
        if (cat !== 'monster' && cat !== 'ambient' && cat !== 'water') continue;
        let nearest = Infinity;
        for (const p of this.server.players.values()) if (p.dim === dim) nearest = Math.min(nearest, p.distanceSq(e.x, e.y, e.z));
        if (nearest > 128 * 128) e.remove();
        else if (nearest > 32 * 32 && this.rng.chance(1 / 40)) e.remove();
      }
    }
  }

  private naturalSpawn(): void {
    const s = this.server;
    const diff = s.level.difficulty;
    for (const p of s.players.values()) {
      if (p.dead || p.gamemode === 'spectator') continue;
      const dim = p.dim;
      // Count mobs by category around the player
      const counts: Record<string, number> = {};
      for (const e of dim.entitiesNear(p.x, p.y, p.z, 128)) if (e instanceof Mob) counts[e.def.category] = (counts[e.def.category] ?? 0) + 1;
      const cats: MobCategory[] = ['monster', 'creature', 'ambient', 'water'];
      for (const cat of cats) {
        if (cat === 'monster' && diff === 'peaceful') continue;
        if ((counts[cat] ?? 0) >= CAPS[cat]) continue;
        if (cat === 'creature' && s.tickNo % 400 !== 0) continue;
        this.trySpawnAround(p, cat);
      }
    }
  }

  private trySpawnAround(p: ServerPlayer, cat: MobCategory): void {
    const dim = p.dim;
    const r = this.rng;
    const ang = r.next() * Math.PI * 2;
    const dist = 24 + r.next() * 40;
    const x = Math.floor(p.x + Math.cos(ang) * dist);
    const z = Math.floor(p.z + Math.sin(ang) * dist);
    if (!dim.isLoaded(x, z)) return;
    const top = dim.getHeight(x, z);
    let y: number;
    // V2 overworld: part of the creature and water spawning happens in the caves
    const caves = dim.id === 'overworld' && !!dim.generator.caves;
    const underCreature = caves && cat === 'creature' && r.chance(0.3);
    const underWater = caves && cat === 'water' && r.chance(0.4);
    if (cat === 'creature' && !underCreature) y = top;
    else if (cat === 'water' && !underWater) y = Math.max(1, top - 1 - r.int(8));
    else if (underCreature || underWater) y = 8 + r.int(Math.max(1, Math.min(52, top - 12) - 8));
    else if (!dim.rules.hasSky) {
      // Cavern dimensions: pick one of the column's floors instead of a random height.
      // Without a ceiling (the End) the surface itself is a floor too.
      const floors: number[] = [];
      const last = dim.rules.hasCeiling ? top - 1 : top;
      for (let yy = 2; yy <= last; yy++) if (STATE_SOLID[dim.getState(x, yy - 1, z)] && !STATE_SOLID[dim.getState(x, yy, z)] && !STATE_SOLID[dim.getState(x, yy + 1, z)] && !STATE_FLUID[dim.getState(x, yy, z)]) floors.push(yy);
      if (!floors.length) return;
      y = floors[r.int(floors.length)]!;
    } else y = 1 + r.int(Math.max(1, top));
    const biome = biomeOf(dim.getBiome(x, z));
    const list: SpawnEntry[] = (cat === 'monster' || cat === 'creature' || cat === 'water' || cat === 'ambient' ? biome.spawns?.[cat] : undefined) ?? [];
    let entry: SpawnEntry | null = list.length ? weighted(list, r) : null;
    // Structures with their own inhabitants (fortresses, witch huts, outposts)
    if (cat === 'monster') {
      const st = dim.generator.structureAt?.(x, y, z);
      const sl = st ? STRUCTURE_SPAWNS[st] : undefined;
      if (sl) entry = weighted(sl, r);
    }
    // Cave biomes decide who lives underground (V2)
    const cb = caves && cat !== 'ambient' && (cat !== 'creature' || underCreature) && (cat !== 'water' || underWater) ? dim.generator.caveBiomeAt!(x, y, z) : 0;
    if (cb === 9) return; // the deep dark: nothing spawns there
    if (cb) {
      if (cat === 'monster' && CAVE_MONSTERS[cb] && (cb === 10 || r.chance(0.6))) entry = weighted(CAVE_MONSTERS[cb]!, r);
      else if (cat === 'water') entry = CAVE_WATER[cb] ? weighted(CAVE_WATER[cb]!, r) : null;
      else if (cat === 'creature') entry = cb === 4 ? { mob: 'sporeling', weight: 1, min: 1, max: 3 } : null;
    } else if (underCreature || underWater) entry = null;
    // Underground-only spawns
    if (cat === 'ambient' && dim.id === 'overworld' && y < 60) entry = { mob: 'bat', weight: 1, min: 1, max: 2 };
    if (cat === 'monster' && dim.id === 'overworld' && y < 40 && r.chance(0.12)) entry = { mob: 'cave_stalker', weight: 1, min: 1, max: 1 };
    if (!entry) return;
    const def = mobDef(entry.mob);
    if (!def) return;
    const n = entry.min + r.int(entry.max - entry.min + 1);
    let spawned = 0;
    for (let i = 0; i < n * 3 && spawned < n; i++) {
      const sx = x + r.int(9) - 4;
      const sz = z + r.int(9) - 4;
      let sy = y;
      // Find floor near y
      if (!def.flying && !def.aquatic) {
        let k = 0;
        while (k < 8 && !(STATE_SOLID[dim.getState(sx, sy - 1, sz)] && !collisionShape(dim.getState(sx, sy, sz)).length)) {
          sy--;
          k++;
        }
      }
      if (sy < 1) continue;
      // Chosen for a cave biome: it must still be in that biome after dropping to the floor
      if (cb && dim.generator.caveBiomeAt!(sx, sy, sz) !== cb) continue;
      let tooClose = false;
      for (const pl of this.server.players.values()) if (pl.dim === dim && pl.distanceSq(sx, sy, sz) < 24 * 24) tooClose = true;
      if (tooClose) continue;
      if (!this.spawnConditions(dim, def.id, sx, sy, sz, cat)) continue;
      if (!this.fits(dim, def.id, sx + 0.5, sy, sz + 0.5)) continue;
      const m = this.spawn(dim, def.id, sx + 0.5, sy, sz + 0.5, { reason: 'natural' });
      // Spawned because a cheat set the time or weather: they count as cheat-made
      if (m && this.server.admin.skyTainted) m.admin = true;
      if (m) {
        if (cat === 'creature') m.persistenceRequired = true;
        spawned++;
      }
    }
  }

  private spawnConditions(dim: Dimension, type: string, x: number, y: number, z: number, cat: MobCategory): boolean {
    const def = mobDef(type)!;
    const light = dim.getLight(x, y, z);
    const sky = light >> 4;
    const blk = light & 15;
    const t = this.server.level.dayTime % 24000;
    const night = t > 13000 && t < 23000;
    const skyDarken = !dim.rules.hasSky ? 0 : night ? 11 : this.server.interaction.weather.thundering ? 5 : 0;
    const effSky = Math.max(0, sky - skyDarken);
    const below = dim.getState(x, y - 1, z);
    switch (cat) {
      case 'monster': {
        if (def.aquatic) return STATE_FLUID[dim.getState(x, y, z)] === 1;
        if (STATE_FLUID[dim.getState(x, y, z)]) return false;
        const max = def.maxSpawnLight ?? 0;
        if (blk > max) return false;
        if (max < 15 && effSky > this.rng.int(8)) return false;
        return STATE_SOLID[below] === 1 && STATE_OPAQUE[below] === 1;
      }
      case 'creature': {
        const id = blocks[STATE_BLOCK[below]!]!.id;
        // Jungle animals also live up in the canopy
        const canopy = (type === 'parrot' || type === 'ocelot') && id.endsWith('_leaves');
        // Sporelings live on the mycelium of dark mushroom caves
        if (type === 'sporeling') return id === 'mycelium' || id === 'moss_block' || STATE_OPAQUE[below] === 1;
        return (canopy || id === 'grass_block' || id === 'snow_block' || id === 'sand' || id === 'mycelium' || id === 'podzol' || id === 'far_grass_block' || id === 'moss_block') && Math.max(sky, blk) > 8;
      }
      case 'water':
        return STATE_FLUID[dim.getState(x, y, z)] === 1 && STATE_FLUID[dim.getState(x, y + 1, z)] === 1;
      case 'ambient':
        return Math.max(effSky, blk) < 4 && y < 63;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------ combat: mobs
  meleeAttack(m: Mob, t: Target): void {
    const s = this.server;
    if (!isAlive(t)) return;
    s.broadcastNear(m.dim, m.x, m.y, m.z, 64, { t: 'anim', id: m.id, anim: 'swing' });
    // Frogs swallow small slimes whole: slime balls from slimes, froglights from magma cubes
    if (m.type === 'frog' && t instanceof Mob && (t.type === 'slime' || t.type === 'magma_cube')) {
      m.data.tongue = 6;
      m.metaDirty = true;
      const drop = t.type === 'slime' ? 'slime_ball' : `${FROGLIGHT[String(m.data.variant ?? 'temperate')] ?? 'ochre'}_froglight`;
      t.remove();
      s.mining.dropItem(m.dim, m.x, m.y + 0.3, m.z, m.admin || t.admin ? markAdmin(stackOf(drop, 1)) : stackOf(drop, 1));
      s.playSound(m.dim, 'frog.eat', m.x, m.y, m.z, 1, 1);
      m.target = null;
      return;
    }
    let dmg = (m.def.damage ?? 2) + (typeof m.data.dmgBonus === 'number' ? m.data.dmgBonus : 0);
    if (m.def.brain === 'slime') dmg = Math.max(0, Number(m.data.size ?? 1) - (m.type === 'slime' ? 0 : -1)) * (m.type === 'magma_cube' ? 1.5 : 1);
    if (m.held) {
      const w = items[m.held.id]!.def.weapon;
      if (w) dmg += w.damage - 1;
    }
    if (m.baby) dmg = Math.max(1, dmg * 0.7);
    const dx = t.x - m.x;
    const dz = t.z - m.z;
    const d = Math.hypot(dx, dz) || 1;
    let kb = 0.4;
    if (m.type === 'iron_golem' || m.type === 'hoglin' || m.type === 'goat') kb = 1.2;
    if (m.type === 'glitch_beast') kb = 1.4;
    const info = { source: 'mob' as const, attacker: m, kbx: dx / d, kbz: dz / d, knockback: kb };
    const dealt = this.damage(t, dmg, info);
    if (dealt <= 0) return;
    if (m.type === 'iron_golem' || m.type === 'goat' || m.type === 'hoglin') {
      if (isPlayer(t)) t.send({ t: 'velocity', id: t.id, vx: (dx / d) * kb, vy: 0.6, vz: (dz / d) * kb });
      else t.body.vy += 0.5;
    }
    // Special on-hit effects
    const diffMul = s.level.difficulty === 'hard' ? 2 : 1;
    if (isPlayer(t)) {
      const sv = s.interaction.survival;
      switch (m.type) {
        case 'husk':
          sv.addEffect(t, 'hunger', 0, 140 * diffMul);
          break;
        case 'cave_spider':
          if (s.level.difficulty !== 'easy') sv.addEffect(t, 'poison', 0, 140 * diffMul);
          break;
        case 'wither_skeleton':
          sv.addEffect(t, 'wither', 0, 200);
          break;
        case 'cave_stalker':
          sv.addEffect(t, 'darkness', 0, 120);
          sv.addEffect(t, 'slowness', 0, 60);
          break;
        case 'rift_walker':
          sv.addEffect(t, 'blindness', 0, 40);
          break;
        case 'void_wisp':
          sv.addEffect(t, 'levitation', 0, 30);
          break;
        case 'glitch_zombie':
          sv.addEffect(t, 'nausea', 0, 100);
          break;
      }
    }
    if (m.type === 'ember_beast' || m.type === 'blaze' || (m.fireTicks > 0 && m.rng.chance(0.3))) this.setOnFire(t, 5);
  }

  /** Damages any entity through the right path (players go through Survival). */
  damage(t: Entity, amount: number, info: HurtInfo & { kbx?: number; kbz?: number; knockback?: number }): number {
    if (isPlayer(t)) {
      if (info.attacker && isPlayer(info.attacker) && !this.server.level.pvp && !this.server.templeTrials?.pvpBetween(info.attacker, t)) return 0;
      return this.server.interaction.survival.damage(t, amount, { source: info.source as never, attacker: info.attacker, kbx: info.kbx, kbz: info.kbz, knockback: info.knockback, disableShield: info.disableShield, pierceShield: info.pierceShield });
    }
    if (t instanceof LivingEntity) return t.hurt(amount, info);
    return 0;
  }

  setOnFire(t: Entity, seconds: number): void {
    if (isPlayer(t)) {
      if (t.effects.has('fire_resistance')) return;
      (t as ServerPlayer & { fireTicks?: number }).fireTicks = Math.max((t as ServerPlayer & { fireTicks?: number }).fireTicks ?? 0, seconds * 20);
    } else if (t instanceof LivingEntity) {
      if ((t as Mob).def?.fireImmune) return;
      t.fireTicks = Math.max(t.fireTicks, seconds * 20);
      t.metaDirty = true;
    }
  }

  rangedAttack(m: Mob, t: Target, kind: RangedKind): void {
    const s = this.server;
    const [ex, ey, ez] = m.eyePos();
    const tx = t.x;
    const ty = t.y + ((t as { eyeHeight?: number }).eyeHeight ?? 1.5) * 0.6;
    const tz = t.z;
    const dx = tx - ex;
    const dz = tz - ez;
    const hd = Math.hypot(dx, dz);
    const inacc = s.level.difficulty === 'hard' ? 2 : s.level.difficulty === 'easy' ? 10 : 6;
    s.broadcastNear(m.dim, m.x, m.y, m.z, 64, { t: 'anim', id: m.id, anim: 'swing' });
    switch (kind) {
      case 'arrow':
      case 'crossbow': {
        const p = this.projectile(m.dim, 'arrow', ex, ey - 0.1, ez, m);
        const dy = ty - ey + hd * 0.2;
        p.shoot(dx, dy, dz, kind === 'crossbow' ? 2.4 : 1.6, inacc, () => m.rng.next());
        p.damage = m.def.damage ?? 2;
        if (m.type === 'stray') p.data = { slow: true };
        s.playSound(m.dim, 'bow.shoot', m.x, m.y + 1.5, m.z, 1, 1 / (0.8 + m.rng.next() * 0.4));
        break;
      }
      case 'llama_spit': {
        const p = this.projectile(m.dim, 'snowball', ex, ey - 0.1, ez, m);
        p.shoot(dx, ty - ey + hd * 0.1, dz, 1.5, inacc, () => m.rng.next());
        p.data = { spit: true };
        s.playSound(m.dim, 'llama.spit', m.x, m.y + 1.5, m.z, 1, 0.9 + m.rng.next() * 0.2);
        break;
      }
      case 'small_fireball':
        for (let i = 0; i < 3; i++) {
          const p = this.projectile(m.dim, 'small_fireball', ex, ey, ez, m);
          p.shoot(dx, ty - ey, dz, 1.1, inacc + 4, () => m.rng.next());
          p.damage = 5;
          p.life = 100;
        }
        s.playSound(m.dim, 'ignite', m.x, m.y + 1, m.z, 1, 1.2);
        break;
      case 'fireball': {
        const p = this.projectile(m.dim, 'fireball', ex, ey, ez, m);
        p.shoot(dx, ty - ey, dz, 0.9, 1, () => m.rng.next());
        p.damage = 6;
        p.life = 300;
        s.playSound(m.dim, 'mob.ghast.hurt', m.x, m.y, m.z, 3, 1.4);
        break;
      }
      case 'potion': {
        const p = this.projectile(m.dim, 'potion', ex, ey, ez, m);
        const dist = Math.hypot(dx, ty - ey, dz);
        p.shoot(dx, ty - ey + dist * 0.25, dz, 0.75, 8, () => m.rng.next());
        const eff = hd > 8 && !(t as ServerPlayer).effects?.has('slowness') ? 'slowness' : (t as ServerPlayer).health >= 8 && !(t as ServerPlayer).effects?.has('poison') ? 'poison' : 'instant_damage';
        p.data = { effect: eff };
        break;
      }
      case 'shulker_bullet': {
        const p = this.projectile(m.dim, 'shulker_bullet', ex, ey, ez, m);
        p.shoot(dx, ty - ey, dz, 0.4, 0, () => m.rng.next());
        p.homing = t;
        p.damage = 4;
        p.life = 200;
        break;
      }
      case 'rift_bolt': {
        const p = this.projectile(m.dim, 'rift_bolt', ex, ey, ez, m);
        p.shoot(dx, ty - ey, dz, 1.2, 2, () => m.rng.next());
        p.damage = 8;
        p.life = 120;
        s.playSound(m.dim, 'glitch.zap', m.x, m.y + 2, m.z, 2, 0.8);
        break;
      }
    }
  }

  projectile(dim: Dimension, kind: ProjectileKind, x: number, y: number, z: number, owner: Entity | null): Projectile & { data?: Record<string, unknown> } {
    const p = new Projectile(kind) as Projectile & { data?: Record<string, unknown> };
    p.setPos(x, y, z);
    p.owner = owner;
    if (owner && isPlayer(owner)) p.ownerUuid = owner.uuid;
    p.onHit = (pr, hit) => this.onProjectileHit(pr as Projectile & { data?: Record<string, unknown> }, hit);
    dim.addEntity(p);
    return p;
  }

  private onProjectileHit(p: Projectile & { data?: Record<string, unknown> }, hit: ProjectileHit): boolean {
    const s = this.server;
    const dim = p.dim;
    const e = hit.entity;
    if (e && e === p.owner && p.kind === 'dragon_fireball') return false;
    if (e instanceof EndCrystal) {
      e.destroy(p.owner);
      return true;
    }
    if (p.kind === 'dragon_fireball') {
      s.theEnd?.breathCloud(dim, hit.x, hit.block ? hit.y : Math.floor(hit.y), hit.z, p.owner);
      return true;
    }
    switch (p.kind) {
      case 'trident':
        if (p.item) return this.thrownTridentHit(p, hit);
        return this.arrowHit(p, hit);
      case 'arrow':
        return this.arrowHit(p, hit);
      case 'snowball':
      case 'egg':
        if (e && e !== p.owner) {
          const dmg = p.data?.spit ? 1 : p.kind === 'snowball' && (e.type === 'blaze' || e.type === 'ember_beast') ? 3 : 0;
          const d = Math.hypot(p.vx, p.vz) || 1;
          if (dmg > 0) this.damage(e, dmg, { source: 'arrow', attacker: p.owner, kbx: p.vx / d, kbz: p.vz / d, knockback: 0.2 });
          else if (isPlayer(e)) e.send({ t: 'velocity', id: e.id, vx: (p.vx / d) * 0.1, vy: 0.1, vz: (p.vz / d) * 0.1 });
          else if (e instanceof LivingEntity) e.hurt(0.0001, { source: 'arrow', attacker: p.owner, kbx: p.vx / d, kbz: p.vz / d, knockback: 0.2 });
        }
        s.particles(dim, p.kind === 'snowball' ? 'white_ash' : 'block', hit.x, hit.y, hit.z, 8, 0.2, p.kind === 'egg' ? undefined : undefined);
        if (p.kind === 'egg' && this.rng.chance(1 / 8)) {
          const n = this.rng.chance(1 / 32) ? 4 : 1;
          for (let i = 0; i < n; i++) {
            const c = this.spawn(dim, 'chicken', hit.x, hit.y, hit.z, { baby: true, persistent: true });
            if (c) c.admin = p.admin;
          }
        }
        return true;
      case 'ender_pearl': {
        const owner = p.owner;
        if (owner && isPlayer(owner) && owner.dim === dim && !owner.dead) {
          s.teleport(owner, hit.x, hit.y + 0.1, hit.z);
          s.interaction.survival.damage(owner, 5, { source: 'fall' });
          s.playSound(dim, 'teleport', hit.x, hit.y, hit.z, 1, 1);
          if (this.rng.chance(0.05)) this.spawn(dim, 'silverfish', hit.x, hit.y, hit.z);
        }
        s.particles(dim, 'portal', hit.x, hit.y, hit.z, 24, 0.5);
        return true;
      }
      case 'small_fireball':
        if (e) {
          if (e.type === 'blaze') return false;
          this.damage(e, p.damage, { source: 'fire', attacker: p.owner });
          this.setOnFire(e, 5);
        } else if (hit.block && s.level.rules.mobGriefing) {
          const b = hit.block;
          const fx = b.x + [0, 0, 0, 0, -1, 1][b.face]!;
          const fy = b.y + [-1, 1, 0, 0, 0, 0][b.face]!;
          const fz = b.z + [0, 0, -1, 1, 0, 0][b.face]!;
          if (dim.getState(fx, fy, fz) === 0) dim.setBlock(fx, fy, fz, S('fire'));
        }
        return true;
      case 'fireball':
        if (e && e.type === 'ghast' && p.owner === e) return false;
        if (e) this.damage(e, 6, { source: 'explosion', attacker: p.owner });
        this.explode(dim, hit.x, hit.y, hit.z, 1, true, p.owner);
        return true;
      case 'potion':
      case 'experience_bottle': {
        s.particles(dim, 'splash', hit.x, hit.y, hit.z, 20, 0.6);
        s.playSound(dim, 'item.break', hit.x, hit.y, hit.z, 1, 1.4);
        if (p.kind === 'experience_bottle') {
          s.mining.dropXp(dim, hit.x, hit.y, hit.z, 3 + this.rng.int(9), p.admin);
          return true;
        }
        const potionId = p.data?.potion as string | undefined;
        if (potionId) {
          // Player-thrown splash potion: full effect list, scaled by distance
          for (const t of dim.entitiesNear(hit.x, hit.y, hit.z, 4)) {
            const f = 1 - Math.sqrt(t.distanceSq(hit.x, hit.y, hit.z)) / 4;
            if (f <= 0) continue;
            if (isPlayer(t)) s.workstations?.applyPotion(t, potionId, f);
            else if (t instanceof LivingEntity) {
              const harm = potionId.includes('harming') ? 6 : potionId.includes('healing') ? -6 : 0;
              const undead = t.isUndead();
              if (harm !== 0) {
                const dmg = (undead ? -harm : harm) * f * (potionId.startsWith('strong_') ? 2 : 1);
                if (dmg > 0) t.hurt(dmg, { source: 'magic', attacker: p.owner });
                else t.health = Math.min(t.maxHealth, t.health - dmg);
              }
              if (potionId.includes('fire_resistance') || potionId.includes('water')) t.fireTicks = 0;
            }
          }
          return true;
        }
        const eff = String(p.data?.effect ?? 'instant_damage');
        for (const t of dim.entitiesNear(hit.x, hit.y, hit.z, 4)) {
          if (!isPlayer(t)) continue;
          const f = 1 - Math.sqrt(t.distanceSq(hit.x, hit.y, hit.z)) / 4;
          if (f <= 0) continue;
          if (eff === 'instant_damage') s.interaction.survival.damage(t, 6 * f, { source: 'magic', attacker: p.owner });
          else s.interaction.survival.addEffect(t, eff, 0, Math.round((eff === 'poison' ? 900 : 1800) * f * 0.25));
        }
        return true;
      }
      case 'shulker_bullet':
        if (e) {
          if (e === p.owner) return false;
          this.damage(e, 4, { source: 'mob', attacker: p.owner });
          if (isPlayer(e)) s.interaction.survival.addEffect(e, 'levitation', 0, 200);
        }
        s.particles(dim, 'crit', hit.x, hit.y, hit.z, 6, 0.3);
        return true;
      case 'rift_bolt':
        if (e) {
          if (e === p.owner) return false;
          this.damage(e, p.damage, { source: 'magic', attacker: p.owner });
          if (isPlayer(e)) s.interaction.survival.addEffect(e, 'nausea', 0, 80);
        }
        s.particles(dim, 'glitch', hit.x, hit.y, hit.z, 12, 0.5);
        return true;
    }
    return true;
  }

  /** A thrown trident: fixed damage, then it drops (and returns with Loyalty). */
  private thrownTridentHit(p: Projectile, hit: ProjectileHit): boolean {
    const s = this.server;
    const e = hit.entity;
    if (e) {
      if (e === p.owner || p.dealt) return false;
      const d = Math.hypot(p.vx, p.vz) || 1;
      const item = p.item!;
      const ench = e instanceof LivingEntity && e.isUndead() ? 2.5 * enchantLevel(item, 'smite') : 0;
      this.damage(e, p.damage + enchantLevel(item, 'sharpness') * 0.5 + ench, { source: 'arrow', attacker: p.owner, kbx: p.vx / d, kbz: p.vz / d, knockback: 0.4 });
      p.dealt = true;
      p.vx *= -0.01;
      p.vy *= -0.1;
      p.vz *= -0.01;
      s.playSound(p.dim, 'trident.hit', e.x, e.y + 1, e.z, 1, 1);
      return false;
    }
    s.playSound(p.dim, 'trident.hit_ground', hit.x, hit.y, hit.z, 0.8, 1);
    return false;
  }

  /** Arrows (and mob-thrown tridents): damage from speed, then stick or drop. */
  private arrowHit(p: Projectile, hit: ProjectileHit): boolean {
    const s = this.server;
    const e = hit.entity;
    if (e) {
      if (e === p.owner) return false;
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      let dmg = Math.ceil(speed * p.damage);
      if (p.crit) dmg += Math.floor(Math.random() * (Math.floor(dmg / 2) + 2));
      const d = Math.hypot(p.vx, p.vz) || 1;
      const dealt = this.damage(e, dmg, { source: 'arrow', attacker: p.owner, kbx: p.vx / d, kbz: p.vz / d, knockback: 0.3 + p.knockback * 0.6 });
      if (dealt > 0) {
        if (p.fire) this.setOnFire(e, 5);
        if (p.data?.slow && isPlayer(e)) s.interaction.survival.addEffect(e, 'slowness', 0, 600);
        if (p.data?.spectral) this.glow(e, 200);
        s.playSound(p.dim, 'arrow.hit', e.x, e.y + 1, e.z, 1, 1.2);
        return true;
      }
      // Deflected (e.g. blocked): drop
      p.vx *= -0.1;
      p.vy *= -0.1;
      p.vz *= -0.1;
      return false;
    }
    s.playSound(p.dim, 'arrow.hit', hit.x, hit.y, hit.z, 0.6, 1.2);
    return false;
  }

  creeperExplode(m: Mob): void {
    const charged = !!m.data.charged;
    m.dead = true;
    m.remove();
    this.explode(m.dim, m.x, m.y + 0.5, m.z, charged ? 6 : 3, false, m);
  }

  // ------------------------------------------------------------------ explosions
  explode(dim: Dimension, x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null, cheat = false): void {
    this.server.sculk?.vibrate(dim, x, y, z, source, 'explosion');
    const s = this.server;
    const cheatDrops = cheat || !!source?.admin;
    const r = this.rng;
    const griefing = s.level.rules.mobGriefing || (source?.type !== 'creeper' && source?.type !== 'ghast' && !(source instanceof Mob));
    const destroyed = new Set<string>();
    if (griefing && power > 0) {
      // Ray-march from the centre, reducing strength by blast resistance
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 16; j++)
          for (let k = 0; k < 16; k++) {
            if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
            let dx = (i / 15) * 2 - 1;
            let dy = (j / 15) * 2 - 1;
            let dz = (k / 15) * 2 - 1;
            const len = Math.hypot(dx, dy, dz);
            dx /= len;
            dy /= len;
            dz /= len;
            let strength = power * (0.7 + r.next() * 0.6);
            let px = x;
            let py = y;
            let pz = z;
            while (strength > 0) {
              const bx = Math.floor(px);
              const by = Math.floor(py);
              const bz = Math.floor(pz);
              const st = dim.getState(bx, by, bz);
              if (st !== 0) {
                const def = blocks[STATE_BLOCK[st]!]!.def;
                const res = def.hardness < 0 ? 3600000 : def.resistance ?? def.hardness;
                strength -= (res + 0.3) * 0.3;
                if (STATE_FLUID[st]) strength -= 0; // fluids absorb via resistance
                if (strength > 0 && def.hardness >= 0 && !STATE_FLUID[st]) destroyed.add(`${bx},${by},${bz}`);
              }
              px += dx * 0.3;
              py += dy * 0.3;
              pz += dz * 0.3;
              strength -= 0.225;
            }
          }
    }
    // Damage & knockback entities
    const radius = power * 2;
    for (const e of dim.entitiesNear(x, y, z, radius + 1)) {
      if (e.removed) continue;
      const dist = Math.sqrt(e.distanceSq(x, y, z)) / radius;
      if (dist > 1) continue;
      const dx = e.x - x;
      const dy = e.y + 1 - y;
      const dz = e.z - z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const exposure = this.exposure(dim, x, y, z, e);
      const impact = (1 - dist) * exposure;
      const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * radius + 1);
      if (e instanceof Projectile) continue;
      if (e instanceof EndCrystal) {
        if (e !== source) e.destroy(source);
        continue;
      }
      if (e.type === 'item' || e.type === 'xp_orb') {
        if (impact > 0.3) e.remove();
        continue;
      }
      if (e instanceof PrimedTnt) {
        e.body.vx += (dx / d) * impact;
        e.body.vy += (dy / d) * impact;
        e.body.vz += (dz / d) * impact;
        continue;
      }
      if (isPlayer(e)) {
        if (e.gamemode === 'spectator') continue;
        s.interaction.survival.damage(e, dmg, { source: 'explosion', attacker: source });
        if (e.gamemode !== 'creative' || !e.abilities.flying) e.send({ t: 'velocity', id: e.id, vx: (dx / d) * impact, vy: (dy / d) * impact, vz: (dz / d) * impact });
      } else if (e instanceof LivingEntity) {
        e.hurt(dmg, { source: 'explosion', attacker: source });
        e.body.vx += (dx / d) * impact;
        e.body.vy += (dy / d) * impact;
        e.body.vz += (dz / d) * impact;
      }
    }
    // Break blocks, dropping some of them
    const tntIgnite: [number, number, number][] = [];
    for (const k of destroyed) {
      const [bx, by, bz] = k.split(',').map(Number) as [number, number, number];
      const st = dim.getState(bx, by, bz);
      const id = blocks[STATE_BLOCK[st]!]!.id;
      if (id === 'tnt') {
        tntIgnite.push([bx, by, bz]);
        continue;
      }
      if (r.chance(1 / power)) {
        s.mining.dropBlock(dim, bx, by, bz, st, cheatDrops);
      }
      if (dim.getBlockEntity(bx, by, bz)) {
        s.interaction.containers.materializeLoot(dim, bx, by, bz, 27, cheatDrops);
        const be = dim.getBlockEntity(bx, by, bz);
        if (be && Array.isArray((be as { items?: unknown }).items)) s.interaction.spillContainer(dim, bx, by, bz, be, id, cheatDrops);
      }
      dim.setBlock(bx, by, bz, 0);
    }
    for (const [bx, by, bz] of tntIgnite) {
      dim.setBlock(bx, by, bz, 0);
      const t = new PrimedTnt();
      t.setPos(bx + 0.5, by, bz + 0.5);
      t.fuse = 10 + r.int(20);
      t.source = source;
      dim.addEntity(t);
    }
    if (fire) {
      for (const k of destroyed) {
        if (!r.chance(1 / 3)) continue;
        const [bx, by, bz] = k.split(',').map(Number) as [number, number, number];
        if (dim.getState(bx, by, bz) === 0 && STATE_SOLID[dim.getState(bx, by - 1, bz)]) dim.setBlock(bx, by, bz, S('fire'));
      }
    }
    s.broadcastNear(dim, x, y, z, 96, { t: 'explosion', x, y, z, power, kx: 0, ky: 0, kz: 0 });
  }

  private exposure(dim: Dimension, x: number, y: number, z: number, e: Entity): number {
    let seen = 0;
    let total = 0;
    const w = e.body.width;
    const h = e.body.height;
    for (let i = 0; i <= 2; i++)
      for (let j = 0; j <= 2; j++)
        for (let k = 0; k <= 2; k++) {
          const px = e.x - w / 2 + (w * i) / 2;
          const py = e.y + (h * j) / 2;
          const pz = e.z - w / 2 + (w * k) / 2;
          total++;
          let blocked = false;
          const steps = Math.ceil(Math.hypot(px - x, py - y, pz - z) * 2);
          for (let st = 1; st < steps && !blocked; st++) {
            const f = st / steps;
            const s = dim.getState(Math.floor(x + (px - x) * f), Math.floor(y + (py - y) * f), Math.floor(z + (pz - z) * f));
            if (STATE_SOLID[s] && STATE_OPAQUE[s]) blocked = true;
          }
          if (!blocked) seen++;
        }
    return seen / total;
  }

  igniteTnt(dim: Dimension, x: number, y: number, z: number, source: Entity | null = null): void {
    const cheat = this.server.admin.blockMarked(dim, x, y, z) || !!source?.admin || (!!source && isPlayer(source) && this.server.admin.inContext(source as ServerPlayer));
    dim.setBlock(x, y, z, 0);
    this.server.admin.setBlockMark(dim, x, y, z, false);
    const t = new PrimedTnt();
    t.setPos(x + 0.5, y, z + 0.5);
    t.body.vy = 0.2;
    t.source = source;
    t.admin = cheat;
    dim.addEntity(t);
    this.server.playSound(dim, 'fizz', x + 0.5, y + 0.5, z + 0.5, 1, 1);
  }

  // ------------------------------------------------------------------ teleport / breed / death
  teleportMob(m: Mob, behind: Target | null): void {
    const s = this.server;
    for (let i = 0; i < 16; i++) {
      let x: number;
      let z: number;
      if (behind) {
        const d = lookDir(behind.yaw, 0);
        x = behind.x - d[0] * 2 + (m.rng.next() - 0.5) * 2;
        z = behind.z - d[2] * 2 + (m.rng.next() - 0.5) * 2;
      } else {
        x = m.x + (m.rng.next() - 0.5) * 32;
        z = m.z + (m.rng.next() - 0.5) * 32;
      }
      let y = Math.floor((behind ? behind.y : m.y) + (m.rng.int(16) - 8) * (behind ? 0 : 1));
      for (let k = 0; k < 16 && y > 1; k++) {
        if (STATE_SOLID[m.dim.getState(Math.floor(x), y - 1, Math.floor(z))]) break;
        y--;
      }
      if (!this.fits(m.dim, m.type, x, y, z)) continue;
      if (STATE_FLUID[m.dim.getState(Math.floor(x), y, Math.floor(z))]) continue;
      s.particles(m.dim, 'portal', m.x, m.y + 1, m.z, 24, 0.6);
      s.playSound(m.dim, 'teleport', m.x, m.y, m.z, 1, 1);
      m.setPos(x, y, z);
      m.stopNavigation();
      s.particles(m.dim, 'portal', x, y + 1, z, 24, 0.6);
      return;
    }
  }

  breed(a: Mob, b: Mob): void {
    if (a.loveTicks <= 0 || b.loveTicks <= 0) return;
    a.loveTicks = 0;
    b.loveTicks = 0;
    a.breedCooldown = 6000;
    b.breedCooldown = 6000;
    const baby = this.spawn(a.dim, a.type, (a.x + b.x) / 2, a.y, (a.z + b.z) / 2, { baby: true, persistent: true });
    if (baby) {
      baby.growTicks = 0;
      if (a.data.color && b.data.color) baby.data.color = this.rng.chance(0.5) ? a.data.color : b.data.color;
      if (a.owner) baby.owner = a.owner;
      // Cheat-spawned parents or cheat food: the whole family stays cheat-made
      const cheat = a.admin || b.admin || !!a.data.cheatLove || !!b.data.cheatLove;
      delete a.data.cheatLove;
      delete b.data.cheatLove;
      baby.admin = cheat;
      this.server.mining.dropXp(a.dim, a.x, a.y, a.z, 1 + this.rng.int(7), cheat);
      if (!cheat) for (const p of this.server.players.values()) if (p.dim === a.dim && p.distanceSq(a.x, a.y, a.z) < 256) this.server.interaction.grant(p, 'breed_animals');
    }
  }

  onMobDeath(m: Mob, info: HurtInfo): void {
    const s = this.server;
    const killer = info.attacker && isPlayer(info.attacker) ? info.attacker : m.dim.server.tickNo - m.lastHurtByPlayerTick < 100 && isPlayer(m.lastAttacker) ? (m.lastAttacker as ServerPlayer) : null;
    const byPlayer = !!killer || (info.attacker instanceof Mob && !!info.attacker.owner);
    if (m.def.category === 'boss' && this.onBossDeath?.(m, killer, info)) {
      if (killer) {
        killer.addStat('killed.' + m.type);
        killer.addStat('mob_kills');
      }
      return;
    }
    const weapon = killer ? killer.inventory.get(killer.selectedSlot) : null;
    const looting = enchantLevel(weapon, 'looting');
    if (!m.baby && s.level.rules.doMobLoot) {
      const drops = rollLoot('mob/' + (m.type === 'sheep' || m.type === 'glitched_sheep' ? m.type : m.type), { rng: m.rng, looting, killedByPlayer: byPlayer, onFire: m.fireTicks > 0, difficulty: s.level.difficulty });
      if ((m.type === 'sheep' || m.type === 'glitched_sheep') && !m.data.sheared) drops.push(stackOf(`${String(m.data.color ?? 'white')}_wool`, 1));
      if (m.held && m.rng.next() < 0.085 + looting * 0.01) drops.push({ ...cloneStack(m.held), damage: Math.floor(m.rng.next() * (items[m.held.id]!.def.durability ?? 0) * 0.8) || undefined });
      // Loot from cheat-spawned mobs is cheat-made
      for (const st of drops) s.mining.dropItem(m.dim, m.x, m.y + 0.5, m.z, m.admin ? markAdmin(st) : st);
    }
    // Fighting alongside an axolotl: it rewards the player who lands the killing blow
    if (killer) {
      for (const a of m.dim.entitiesNear(m.x, m.y, m.z, 16, (e) => e instanceof Mob && e.type === 'axolotl' && e.target === m)) {
        void a;
        s.interaction.survival.addEffect(killer, 'regeneration', 0, 100);
        if (!m.admin) s.interaction.grant(killer, 'axolotl_help');
        killer.effects.delete('mining_fatigue');
        break;
      }
    }
    if (byPlayer && !m.baby) {
      const xp = m.def.xp ?? (m.def.category === 'monster' ? 5 : m.def.category === 'boss' ? 500 : 1 + m.rng.int(3));
      // A sculk catalyst nearby drinks the experience and spreads sculk instead
      if (!s.sculk?.onDeath(m.dim, m.x, m.y, m.z, xp)) s.mining.dropXp(m.dim, m.x, m.y + 0.5, m.z, xp, m.admin);
      else if (killer && !m.admin) s.interaction.grant(killer, 'catalyst_spread');
    }
    // Slimes split
    if (m.def.brain === 'slime') {
      const size = Number(m.data.size ?? 1);
      if (size > 1) {
        const n = 2 + m.rng.int(3);
        for (let i = 0; i < n; i++) {
          const c = this.create(m.type, { data: { size: size / 2 } });
          if (!c) continue;
          c.admin = m.admin;
          c.data.size = size / 2;
          this.applySlimeSize(c);
          c.setPos(m.x + (m.rng.next() - 0.5) * size * 0.5, m.y + 0.5, m.z + (m.rng.next() - 0.5) * size * 0.5);
          m.dim.addEntity(c);
        }
      }
    }
    if (m.data.saddle) s.mining.dropItem(m.dim, m.x, m.y + 0.5, m.z, stackOf('saddle', 1));
    s.mounts?.unleash(m, true);
    if (killer) {
      killer.addStat('killed.' + m.type);
      killer.addStat('mob_kills');
      s.interaction.onMobKilled?.(killer, m);
    }
    // Villager deaths are announced to nearby players (like named pets)
    if (m.customName || m.owner) s.broadcastChat(`${m.customName ?? m.def.name} died`, 'death');
  }

  // ------------------------------------------------------------------ player combat
  playerAttack(p: ServerPlayer, target: Entity): void {
    const s = this.server;
    if (p.dead || p.gamemode === 'spectator') return;
    if (target.removed || (target as LivingEntity).dead) return;
    if (target instanceof EndCrystal) {
      target.destroy(p);
      return;
    }
    if (!(target instanceof LivingEntity) && !isPlayer(target) && !(target instanceof PrimedTnt)) {
      // Punching items/xp does nothing; fireballs are deflected
      if (target instanceof Projectile && target.kind === 'fireball') {
        const d = lookDir(p.yaw, p.pitch);
        target.vx = d[0] * 1.2;
        target.vy = d[1] * 1.2;
        target.vz = d[2] * 1.2;
        target.owner = p;
      }
      return;
    }
    if (isPlayer(target) && ((!s.level.pvp && !s.templeTrials?.pvpBetween(p, target)) || target.gamemode === 'creative')) return;
    // Visitors may defend themselves against monsters but not hurt animals, pets or villagers
    if (s.roleOf(p) === 'visitor' && target instanceof Mob && target.def.category !== 'monster' && target.def.category !== 'boss') return;
    // Reach & line of sight
    const [ex, ey, ez] = s.eyePos(p);
    const reach = p.gamemode === 'creative' ? 6 : 4.5;
    const cx = Math.max(target.x - target.body.width / 2, Math.min(ex, target.x + target.body.width / 2));
    const cy = Math.max(target.y, Math.min(ey, target.y + target.body.height));
    const cz = Math.max(target.z - target.body.width / 2, Math.min(ez, target.z + target.body.width / 2));
    if ((cx - ex) ** 2 + (cy - ey) ** 2 + (cz - ez) ** 2 > reach * reach) return;
    const held = p.inventory.get(p.selectedSlot);
    const it = held ? items[held.id]!.def : null;
    const weapon = it?.weapon;
    const speed = weapon?.speed ?? (it?.tool ? 1 : 4);
    const cooldownTicks = 20 / speed;
    const since = s.tickNo - p.lastAttackTick;
    const f = Math.max(0, Math.min(1, (since + 0.5) / cooldownTicks));
    p.lastAttackTick = s.tickNo;
    let dmg = weapon?.damage ?? (it?.tool ? 1 + it.tool.tier : 1);
    if (p.effects.has('strength')) dmg += 3 * (p.effects.get('strength')!.amp + 1);
    if (p.effects.has('weakness')) dmg -= 4;
    // Enchantments
    let ench = 0;
    const sharp = enchantLevel(held, 'sharpness');
    if (sharp) ench += 0.5 * sharp + 0.5;
    if (target instanceof LivingEntity && target.isUndead()) ench += 2.5 * enchantLevel(held, 'smite');
    if (target instanceof LivingEntity && target.isArthropod()) ench += 2.5 * enchantLevel(held, 'bane_of_arthropods');
    if (target instanceof LivingEntity && target.isFarlands()) ench += 2.5 * enchantLevel(held, 'glitchbane');
    dmg = dmg * (0.2 + f * f * 0.8) + ench * f;
    const b = p.body;
    const crit = f > 0.9 && b.fallDistance > 0 && !b.onGround && !b.inWater && !b.onClimbable && !p.effects.has('blindness') && !p.sprinting;
    if (crit) dmg *= 1.5;
    const sprintKb = f > 0.9 && p.sprinting;
    const kbLevel = enchantLevel(held, 'knockback') + (sprintKb ? 1 : 0);
    const dl = lookDir(p.yaw, 0);
    const axe = it?.tool?.type === 'axe';
    const dealt = this.damage(target, Math.max(0, dmg), { source: 'player', attacker: p, kbx: dl[0], kbz: dl[2], knockback: 0.4 + kbLevel * 0.5, disableShield: axe && f > 0.9 ? 100 : undefined });
    if (dealt <= 0 && !(target instanceof PrimedTnt)) {
      s.playSound(p.dim, 'attack.weak', target.x, target.y + 1, target.z, 0.6, 1);
      return;
    }
    if (crit) s.broadcastNear(p.dim, target.x, target.y, target.z, 64, { t: 'anim', id: target.id, anim: 'crit' });
    if (ench > 0) s.broadcastNear(p.dim, target.x, target.y, target.z, 64, { t: 'anim', id: target.id, anim: 'magic_crit' });
    s.playSound(p.dim, crit ? 'attack.crit' : f > 0.9 ? 'attack.strong' : 'attack.weak', target.x, target.y + 1, target.z, 1, 1);
    const fire = enchantLevel(held, 'fire_aspect');
    if (fire) this.setOnFire(target, fire * 4);
    // Sweeping edge for swords
    if (it?.tool?.type === 'sword' || (weapon && items[held!.id]!.id.endsWith('_sword'))) {
      if (f > 0.9 && b.onGround && !crit && !sprintKb) {
        const sweep = 1 + (enchantLevel(held, 'sweeping_edge') ? dmg * (enchantLevel(held, 'sweeping_edge') / (enchantLevel(held, 'sweeping_edge') + 1)) : 0);
        for (const o of p.dim.entitiesNear(target.x, target.y, target.z, 1.5)) {
          if (o === target || o === p || !(o instanceof LivingEntity) || o.dead) continue;
          if ((o as Mob).owner === p.uuid) continue;
          this.damage(o, sweep, { source: 'player', attacker: p, kbx: dl[0], kbz: dl[2], knockback: 0.4 });
        }
        s.playSound(p.dim, 'attack.sweep', target.x, target.y + 1, target.z, 1, 1);
        s.particles(p.dim, 'crit', target.x, target.y + 1, target.z, 4, 0.8);
      }
    }
    if (held && (weapon || it?.tool) && p.gamemode !== 'creative') s.interaction.damageHeld(p, weapon ? 1 : 2);
    s.interaction.survival.exhaust(p, 0.1);
    p.addStat('damage_dealt', Math.round(dealt * 10));
    if (target instanceof Mob) {
      // Wolves defend their owner's targets
      for (const w of p.dim.entitiesNear(p.x, p.y, p.z, 16)) if (w instanceof Mob && w.owner === p.uuid && !w.sitting && w !== target) w.target = target;
    }
  }

  // ------------------------------------------------------------------ interactions
  interact(p: ServerPlayer, target: Entity, hand: 0 | 1): boolean {
    if (!(target instanceof Mob) || target.dead) return false;
    // Visitors can trade but not shear, milk, tame, breed or name other players' animals
    if (this.server.roleOf(p) === 'visitor' && target.type !== 'villager') return false;
    const s = this.server;
    const m = target;
    const slot = hand === 1 ? 40 : p.selectedSlot;
    const held = p.inventory.get(slot);
    const id = held ? items[held.id]!.id : '';
    const survival = p.gamemode !== 'creative';
    const consume = (): void => {
      if (survival && held) p.inventory.set(slot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
    };
    const give = (st: ItemStack): void => {
      const rem = p.inventory.add(st);
      if (rem) s.interaction.dropStack(p, rem);
    };
    // Riding, saddles and leads
    if (s.mounts?.interact(p, m, held, slot)) return true;
    // Name tags
    if (id === 'name_tag' && held?.tag?.name) {
      m.customName = String(held.tag.name).slice(0, 32);
      m.persistenceRequired = true;
      m.metaDirty = true;
      consume();
      return true;
    }
    // Breeding / taming
    // Ocelots learn to trust a player who feeds them fish
    if (m.type === 'ocelot' && !m.data.trusting && m.def.breedItems?.includes(id)) {
      consume();
      if (m.rng.chance(1 / 3)) {
        m.data.trusting = true;
        m.persistenceRequired = true;
        m.metaDirty = true;
        s.particles(m.dim, 'heart', m.x, m.y + 1, m.z, 7, 0.5);
      } else s.particles(m.dim, 'smoke', m.x, m.y + 1, m.z, 7, 0.5);
      return true;
    }
    if (m.def.breedItems?.includes(id) && !m.baby) {
      if ((m.type === 'wolf' || m.type === 'cat' || m.type === 'parrot') && !m.owner) {
        if (m.type === 'wolf' && id !== 'bone') return false;
        consume();
        if (m.rng.chance(1 / 3)) {
          m.owner = p.uuid;
          m.persistenceRequired = true;
          m.target = null;
          m.revengeTarget = null;
          m.sitting = true;
          m.metaDirty = true;
          s.particles(m.dim, 'heart', m.x, m.y + 1, m.z, 7, 0.5);
          if (m.type === 'wolf' && !m.admin && !s.interaction.isCheat(p, held)) s.interaction.grant(p, 'tame_wolf');
        } else s.particles(m.dim, 'smoke', m.x, m.y + 1, m.z, 7, 0.5);
        return true;
      }
      if (m.breedCooldown <= 0 && m.loveTicks <= 0) {
        const cheatFood = s.interaction.isCheat(p, held);
        consume();
        m.loveTicks = 600;
        if (cheatFood) m.data.cheatLove = true;
        return true;
      }
    }
    if (m.type === 'wolf' && id === 'bone' && !m.owner) {
      consume();
      if (m.rng.chance(1 / 3)) {
        m.owner = p.uuid;
        m.persistenceRequired = true;
        m.sitting = true;
        m.metaDirty = true;
        s.particles(m.dim, 'heart', m.x, m.y + 1, m.z, 7, 0.5);
        if (!m.admin && !s.interaction.isCheat(p, held)) s.interaction.grant(p, 'tame_wolf');
      } else s.particles(m.dim, 'smoke', m.x, m.y + 1, m.z, 7, 0.5);
      return true;
    }
    // Owner toggles sitting
    if (m.owner === p.uuid && (m.type === 'wolf' || m.type === 'cat' || m.type === 'parrot')) {
      m.sitting = !m.sitting;
      m.stopNavigation();
      m.target = null;
      m.metaDirty = true;
      return true;
    }
    // Shearing / milking / dyeing
    if ((m.type === 'sheep' || m.type === 'glitched_sheep') && id === 'shears' && !m.data.sheared && !m.baby) {
      m.data.sheared = true;
      m.metaDirty = true;
      const n = 1 + m.rng.int(3);
      s.mining.dropItem(m.dim, m.x, m.y + 1, m.z, stackOf(m.type === 'glitched_sheep' ? 'purple_wool' : `${String(m.data.color ?? 'white')}_wool`, n));
      s.playSound(m.dim, 'shovel.flatten', m.x, m.y, m.z, 1, 1.4);
      if (survival) s.interaction.damageHeld(p, 1);
      return true;
    }
    if (m.type === 'sheep' && id.endsWith('_dye')) {
      const color = id.slice(0, -4);
      if (COLORS.includes(color) && m.data.color !== color) {
        m.data.color = color;
        m.metaDirty = true;
        consume();
        return true;
      }
    }
    if ((m.type === 'cow' || m.type === 'mooshroom' || m.type === 'goat' || m.type === 'glitched_cow') && id === 'bucket' && !m.baby) {
      consume();
      give(stackOf('milk_bucket', 1));
      s.playSound(m.dim, 'bucket.fill', m.x, m.y, m.z, 1, 1);
      return true;
    }
    if (m.type === 'mooshroom' && id === 'bowl' && !m.baby) {
      consume();
      give(stackOf('mushroom_stew', 1));
      return true;
    }
    // Villager trading
    if (m.type === 'villager' && !m.baby) {
      const prof = String(m.data.profession ?? 'none');
      if (prof === 'none' || !Array.isArray(m.data.offers) || !(m.data.offers as Offer[]).length) {
        s.playSound(m.dim, 'mob.villager.hurt', m.x, m.y + 1.6, m.z, 1, 1);
        return true;
      }
      this.openMerchant(p, m);
      return true;
    }
    return false;
  }

  private openMerchant(p: ServerPlayer, m: Mob): void {
    const s = this.server;
    const cont = s.interaction.containers;
    const offers = m.data.offers as Offer[];
    const w = cont.allocWindow('merchant', m.customName ?? `${capitalize(String(m.data.profession))}`, 3);
    const inputs: (ItemStack | null)[] = [null, null];
    let selected = -1;
    let result: ItemStack | null = null;
    const matches = (have: ItemStack | null, want?: ItemStack): boolean => (!want ? true : !!have && have.id === want.id && have.count >= want.count);
    const refresh = (): void => {
      result = null;
      const o = offers[selected];
      if (o && o.uses < o.maxUses && matches(inputs[0]!, o.buy) && matches(inputs[1]!, o.buy2)) {
        result = cloneStack(o.sell);
        if (m.admin || isAdminStack(inputs[0]) || isAdminStack(inputs[1]) || s.admin.inContext(p)) result = markAdmin(result);
      }
      w.props = { offers: offers.map((o) => ({ buy: o.buy, buy2: o.buy2 ?? null, sell: o.sell, out: o.uses >= o.maxUses })), selected };
    };
    w.refresh = refresh;
    for (let i = 0; i < 2; i++) {
      const idx = i;
      w.slots.push({
        get: () => inputs[idx] ?? null,
        set: (st) => {
          inputs[idx] = st;
          refresh();
        },
        mayPlace: () => true,
        max: (st) => items[st.id]!.maxStack,
        group: 'input',
      });
    }
    w.slots.push({
      get: () => result,
      set: () => {},
      mayPlace: () => false,
      max: (st) => items[st.id]!.maxStack,
      output: true,
      group: 'result',
      onTake: () => {
        const o = offers[selected];
        if (!o) return;
        const take = (i: number, want?: ItemStack): void => {
          if (!want) return;
          const have = inputs[i]!;
          inputs[i] = have.count > want.count ? { ...have, count: have.count - want.count } : null;
        };
        take(0, o.buy);
        take(1, o.buy2);
        o.uses++;
        p.addStat('traded');
        const cheat = isAdminStack(result);
        if (!cheat) s.interaction.grant(p, 'trade');
        s.mining.dropXp(m.dim, m.x, m.y + 1, m.z, 1 + m.rng.int(3), cheat);
        s.playSound(m.dim, 'mob.villager.idle', m.x, m.y + 1.6, m.z, 1, 1.2);
        refresh();
      },
    });
    (w as Window & { select?: (i: number) => void }).select = (i: number) => {
      if (i < 0 || i >= offers.length) return;
      selected = i;
      // Move matching items from the inventory into the payment slots
      const o = offers[i]!;
      for (const [slot, want] of [
        [0, o.buy],
        [1, o.buy2],
      ] as const) {
        if (!want) continue;
        const cur = inputs[slot];
        if (cur && cur.id !== want.id) {
          const rem = p.inventory.add(cur);
          if (rem) s.interaction.dropStack(p, rem);
          inputs[slot] = null;
        }
        for (let k = 0; k < 36 && (inputs[slot]?.count ?? 0) < want.count; k++) {
          const st = p.inventory.get(k);
          if (!st || st.id !== want.id) continue;
          const need = Math.min(st.count, items[st.id]!.maxStack - (inputs[slot]?.count ?? 0));
          inputs[slot] = { ...st, count: (inputs[slot]?.count ?? 0) + need };
          p.inventory.set(k, st.count > need ? { ...st, count: st.count - need } : null);
        }
      }
      refresh();
    };
    cont.addPlayerSlots(w, p);
    w.onClose = (pl) => {
      for (let i = 0; i < 2; i++) {
        const st = inputs[i];
        if (!st) continue;
        const rem = pl.inventory.add(st);
        if (rem) s.interaction.dropStack(pl, rem);
        inputs[i] = null;
      }
    };
    refresh();
    s.interaction.openCustomWindow(p, w);
  }

  /** Spawn egg on a block face. */
  useSpawnEgg(p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number, face: number): boolean {
    const def = items[stack.id]!.def;
    if (def.use !== 'spawn_egg' || !def.spawns) return false;
    const dim = p.dim;
    const st = dim.getState(x, y, z);
    // Eggs on spawners change the spawned mob
    if (blocks[STATE_BLOCK[st]!]!.id === 'spawner') {
      if (p.gamemode !== 'creative') return false;
      const be = dim.getBlockEntity(x, y, z) ?? { type: 'spawner' };
      dim.setBlockEntity(x, y, z, { ...be, type: 'spawner', mob: def.spawns });
      return true;
    }
    const fx = x + [0, 0, 0, 0, -1, 1][face]!;
    const fy = y + [-1, 1, 0, 0, 0, 0][face]!;
    const fz = z + [0, 0, -1, 1, 0, 0][face]!;
    const top = collisionShape(dim.getState(fx, fy - 1, fz)).reduce((a, b) => Math.max(a, b[4]), 0);
    const m = this.spawn(dim, def.spawns, fx + 0.5, fy + (face === 1 ? 0 : 0) + (top > 1 ? top - 1 : 0), fz + 0.5, { reason: 'egg', persistent: true });
    if (!m) return false;
    m.admin = this.server.interaction.isCheat(p, stack);
    if (stack.tag?.name) m.customName = String(stack.tag.name);
    if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
    void getProp;
    return true;
  }

  /** Right-click item use in the air: throwables. */
  useItem(p: ServerPlayer, stack: ItemStack): boolean {
    const s = this.server;
    const def = items[stack.id]!.def;
    const kind: ProjectileKind | null = def.use === 'snowball' ? 'snowball' : def.use === 'egg' ? 'egg' : def.use === 'ender_pearl' ? 'ender_pearl' : def.use === 'experience_bottle' ? 'experience_bottle' : null;
    if (!kind) return false;
    if (kind === 'ender_pearl') {
      if ((p as ServerPlayer & { pearlCooldown?: number }).pearlCooldown && s.tickNo < (p as ServerPlayer & { pearlCooldown?: number }).pearlCooldown!) return true;
      (p as ServerPlayer & { pearlCooldown?: number }).pearlCooldown = s.tickNo + 20;
    }
    const [ex, ey, ez] = s.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const pr = this.projectile(p.dim, kind, ex + d[0] * 0.3, ey - 0.1 + d[1] * 0.3, ez + d[2] * 0.3, p);
    pr.admin = s.interaction.isCheat(p, stack);
    pr.shoot(d[0], d[1] + (kind === 'experience_bottle' ? 0.2 : 0), d[2], kind === 'experience_bottle' ? 0.7 : 1.5, 1, () => this.rng.next());
    pr.vx += p.body.vx;
    pr.vz += p.body.vz;
    if (p.gamemode !== 'creative') p.inventory.set(p.selectedSlot, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
    s.playSound(p.dim, 'bow.shoot', p.x, p.y + 1.5, p.z, 0.5, 0.4);
    p.addStat('used.' + items[stack.id]!.id);
    return true;
  }

  /** Bow (or trident) released after `ticks` of drawing. */
  releaseBow(p: ServerPlayer, stack: ItemStack, ticks: number, slot = p.selectedSlot): void {
    const s = this.server;
    const def = items[stack.id]!;
    if (def.id === 'trident') {
      this.throwTrident(p, stack, ticks, slot);
      return;
    }
    if (def.id !== 'bow' && def.id !== 'crossbow') return;
    let f = ticks / 20;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    if (f > 1) f = 1;
    const infinity = enchantLevel(stack, 'infinity') > 0;
    const creative = p.gamemode === 'creative';
    let arrowSlot = -1;
    // Offhand first, then the inventory; creative players shoot plain arrows unless they carry spectral ones
    const order = [40, ...Array.from({ length: 36 }, (_, i) => i)];
    for (const i of order) {
      const a = p.inventory.get(i);
      const aid = a ? items[a.id]!.id : '';
      if (aid === 'arrow' || aid === 'spectral_arrow') {
        arrowSlot = i;
        break;
      }
    }
    if (arrowSlot < 0 && !creative) return;
    const spectral = arrowSlot >= 0 && items[p.inventory.get(arrowSlot)!.id]!.id === 'spectral_arrow';
    const [ex, ey, ez] = s.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const pr = this.projectile(p.dim, 'arrow', ex, ey - 0.1, ez, p);
    pr.shoot(d[0], d[1], d[2], f * 3, 1, () => this.rng.next());
    pr.crit = f >= 1;
    pr.damage = 2 + (enchantLevel(stack, 'power') ? 0.5 * enchantLevel(stack, 'power') + 0.5 : 0);
    pr.knockback = enchantLevel(stack, 'punch');
    pr.fire = enchantLevel(stack, 'flame') > 0;
    pr.pickup = !creative && !(infinity && !spectral);
    if (spectral) {
      pr.data = { spectral: true };
      pr.item = stackOf('spectral_arrow', 1);
    }
    if (!creative && !(infinity && !spectral) && arrowSlot >= 0) {
      const a = p.inventory.get(arrowSlot)!;
      p.inventory.set(arrowSlot, a.count > 1 ? { ...a, count: a.count - 1 } : null);
    }
    if (!creative) s.interaction.damageHeld(p, 1);
    s.playSound(p.dim, 'bow.shoot', p.x, p.y + 1.5, p.z, 1, 1 / (0.8 + this.rng.next() * 0.4) + f * 0.5);
    p.addStat('used.bow');
  }

  /** Throws a trident drawn for at least half a second. */
  private throwTrident(p: ServerPlayer, stack: ItemStack, ticks: number, slot: number): void {
    const s = this.server;
    if (ticks < 10) return;
    const creative = p.gamemode === 'creative';
    if (!creative) s.interaction.damageStack(p, slot, 1);
    const thrown = cloneStack(p.inventory.get(slot) ?? stack);
    if (!thrown || items[thrown.id]!.id !== 'trident') return;
    const [ex, ey, ez] = s.eyePos(p);
    const d = lookDir(p.yaw, p.pitch);
    const pr = this.projectile(p.dim, 'trident', ex, ey - 0.1, ez, p);
    pr.shoot(d[0], d[1], d[2], 2.5, 1, () => this.rng.next());
    pr.damage = 8;
    pr.item = thrown;
    pr.loyalty = enchantLevel(thrown, 'loyalty');
    pr.pickup = !creative;
    pr.persistent = true;
    pr.admin = s.interaction.isCheat(p, thrown);
    pr.onReturn = (x) => this.tridentReturned(x);
    if (!creative) p.inventory.set(slot, null);
    s.playSound(p.dim, 'trident.throw', p.x, p.y + 1.5, p.z, 1, 1);
    p.addStat('used.trident');
  }

  /** A Loyalty trident reached its thrower: back into the inventory. */
  private tridentReturned(pr: Projectile): void {
    const o = pr.owner;
    if (!pr.item || !o || !isPlayer(o)) return;
    if (pr.pickup) {
      const rem = o.inventory.add(pr.item);
      if (rem) this.server.interaction.dropStack(o, rem);
    }
    this.server.playSound(o.dim, 'trident.return', o.x, o.y + 1, o.z, 1, 1);
  }

  /** Players pick up arrows and tridents stuck in the ground. */
  tickArrowPickup(): void {
    for (const p of this.server.players.values()) {
      if (p.dead || p.gamemode === 'spectator') continue;
      for (const e of p.dim.entitiesNear(p.x, p.y + 1, p.z, 2)) {
        if (!(e instanceof Projectile) || !e.stuck || e.removed || e.returning) continue;
        if (e.kind === 'trident') {
          // Only the thrower may pick up a Loyalty trident; mob tridents can't be picked up
          if (!e.item || (e.loyalty > 0 && e.ownerUuid !== p.uuid)) continue;
          if (e.pickup) {
            const rem = p.inventory.add(e.item);
            if (rem) continue;
          }
          e.remove();
          this.server.broadcastNear(p.dim, e.x, e.y, e.z, 32, { t: 'take_item', item: e.id, by: p.id });
          this.server.playSound(p.dim, 'pop', e.x, e.y, e.z, 0.2, 1.8);
          continue;
        }
        if (e.kind !== 'arrow') continue;
        if (e.pickup && p.gamemode !== 'creative') {
          const rem = p.inventory.add(e.item ? cloneStack(e.item) : stackOf('arrow', 1));
          if (rem) continue;
        }
        e.remove();
        this.server.broadcastNear(p.dim, e.x, e.y, e.z, 32, { t: 'take_item', item: e.id, by: p.id });
        this.server.playSound(p.dim, 'pop', e.x, e.y, e.z, 0.2, 1.8);
      }
    }
  }

  window(p: ServerPlayer, m: C2S): void {
    void p;
    void m;
  }
}

function weighted<T extends { weight: number }>(list: T[], r: Random): T {
  let total = 0;
  for (const e of list) total += e.weight;
  let x = r.next() * total;
  for (const e of list) {
    x -= e.weight;
    if (x <= 0) return e;
  }
  return list[list.length - 1]!;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { MOB_DEFS, canSee, chunkIndex };
