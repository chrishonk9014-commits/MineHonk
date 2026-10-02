/** Server-side player entity + connection session state. */
import { items } from '../../common/registry/items';
import { newAdminState, type AdminPlayerState } from '../admin/adminState';
import { Entity } from '../entity/Entity';
import type { Connection, Identity } from '../net/Connection';
import { Inventory, INVENTORY_SIZE } from './Inventory';
import { abilitiesFor, type Abilities, type GameMode } from '../../common/game/gamemode';
import type { AbilitiesMsg, PlayerStats, S2C } from '../../common/net/protocol';
import type { Slot } from '../../common/game/itemstack';
import type { DimensionId } from '../../common/data/biomes';
import { itemById } from '../../common/registry/items';

let elytraNum = -1;
/** Item number of the Elytra (resolved once). */
const ELYTRA = (): number => (elytraNum >= 0 ? elytraNum : (elytraNum = itemById.get('elytra')?.num ?? 0));

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
export const PLAYER_SNEAK_EYE = 1.27;

export interface DigState {
  x: number;
  y: number;
  z: number;
  state: number;
  startTick: number;
  /** Expected ticks to break (server computed). */
  ticks: number;
  lastStage: number;
}

export class ServerPlayer extends Entity {
  readonly type = 'player';
  readonly name: string;
  readonly uuid: string;
  gamemode: GameMode = 'survival';
  abilities: Abilities = abilitiesFor('survival');
  readonly inventory = new Inventory(INVENTORY_SIZE);
  readonly enderChest = new Inventory(27);
  /** Item held on the cursor while a window is open. */
  cursor: Slot = null;
  selectedSlot = 0;

  // Survival stats
  health = 20;
  maxHealth = 20;
  absorption = 0;
  food = 20;
  saturation = 5;
  exhaustion = 0;
  foodTimer = 0;
  xpTotal = 0;
  air = 300;
  readonly maxAir = 300;
  effects = new Map<string, { amp: number; ticks: number }>();
  dead = false;
  hurtCooldown = 0;
  lastDamageSource = '';
  /** Invulnerability after join/respawn/teleport (ticks). */
  spawnProtection = 0;

  // Networking / view
  viewDistance = 8;
  readonly sentChunks = new Set<number>();
  readonly tracked = new Set<number>();
  chunkX = NaN;
  chunkZ = NaN;
  statsDirty = true;
  lastStatsJson = '';
  ping = 0;

  // Movement validation
  lastValidX = 0;
  lastValidY = 0;
  lastValidZ = 0;
  moveSeq = 0;
  teleportSeq = 0;
  awaitingTeleport = false;
  sneaking = false;
  sprinting = false;
  movesThisTick = 0;
  speedViolations = 0;
  lastGroundY = 0;
  airTicks = 0;

  dig: DigState | null = null;
  lastSwingTick = 0;
  lastAttackTick = 0;
  /** Monotonic counter of block interactions accepted (anti-spam). */
  interactBudget = 0;
  msgBudget = 0;
  chatBudget = 0;

  /** Bed or respawn anchor spawn; `block` is the bed/anchor it depends on. */
  spawnPoint: { dim: DimensionId; x: number; y: number; z: number; forced: boolean; block?: [number, number, number] } | null = null;
  readonly achievements = new Set<string>();
  /** Cheat bookkeeping that keeps admin actions advancement-neutral. */
  cheat: AdminPlayerState = newAdminState();
  readonly statistics: Record<string, number> = {};
  /** Open container window id (0 = own inventory). */
  windowId = 0;
  windowSeq = 0;
  sleepingTicks = 0;
  portalTicks = 0;
  portalCooldown = 0;
  joinedAt = Date.now();
  /** Tick until which a knocked-aside shield cannot be raised. */
  shieldDownUntil = 0;
  /** Gliding on an Elytra (reported by the client, checked by the server). */
  gliding = false;
  /** Horizontal speed of the last move while gliding (for wall impacts). */
  glideSpeed = 0;
  glideDirX = 0;
  glideDirZ = 0;
  /** Tick until which a firework rocket may push the player faster. */
  boostUntil = 0;
  /** The mob this player is riding. */
  vehicle: Entity | null = null;
  /** Where the player last died (the Recovery Compass points there). */
  lastDeath: { dim: DimensionId; x: number; y: number; z: number } | null = null;
  /** Sculk shrieker warnings (0-4); the fourth calls the Warden. Fades over time. */
  wardenWarning = 0;
  wardenWarningAt = 0;
  /** Shriekers ignore this player until this tick. */
  shriekCooldownUntil = 0;
  /** Distance walked since the last footstep vibration. */
  stepDistance = 0;
  /** Cave biome the player is in (0 = none) and every cave biome visited so far. */
  caveBiome = 0;
  visitedCaveBiomes = new Set<number>();
  /** V6: Expanded End biomes visited (ids). */
  visitedEndBiomes = new Set<string>();
  /** V6 phase 2: kinds of Expanded End mob this player has killed (for "Hunter of the Expanded End"). */
  expansionKills = new Set<string>();
  /** Endings this player has reached (V3). */
  endings = new Set<string>();
  /** An ending card waiting to be shown (after walking out through the End portal). */
  pendingEnding: string | null = null;
  /** Where this player stepped into the End portal (the secret ending returns them there). */
  endEntry: { x: number; y: number; z: number } | null = null;
  /** Freeze build-up from powder snow (ticks, 0-140). */
  freezeTicks = 0;

  constructor(
    readonly conn: Connection,
    identity: Identity,
  ) {
    super(PLAYER_WIDTH, PLAYER_HEIGHT);
    this.name = identity.name;
    this.uuid = identity.uuid;
    this.body.stepHeight = 0.6;
  }

  send(msg: S2C): void {
    this.conn.send(msg);
  }

  get eyeHeight(): number {
    return this.sneaking ? PLAYER_SNEAK_EYE : PLAYER_EYE;
  }

  get eyeY(): number {
    return this.body.y + this.eyeHeight;
  }

  heldItem(): Slot {
    return this.inventory.get(this.selectedSlot);
  }

  setGamemode(mode: GameMode): void {
    this.gamemode = mode;
    const flying = this.abilities.flying && mode !== 'survival' && mode !== 'hardcore' && mode !== 'god' && mode !== 'adventure';
    this.abilities = abilitiesFor(mode);
    if (mode === 'creative') this.abilities.flying = flying;
    this.body.noClip = this.abilities.noClip;
  }

  abilitiesMsg(): AbilitiesMsg {
    const a = this.abilities;
    return { mayFly: a.mayFly, flying: a.flying, invulnerable: a.invulnerable, instantBuild: a.instantBuild, mayBuild: a.mayBuild, noClip: a.noClip, walkSpeed: a.walkSpeed, flySpeed: a.flySpeed };
  }

  xpLevel(): { level: number; progress: number } {
    let level = 0;
    let remaining = this.xpTotal;
    for (;;) {
      const need = xpForLevel(level);
      if (remaining < need) return { level, progress: remaining / need };
      remaining -= need;
      level++;
      if (level > 100000) return { level, progress: 0 };
    }
  }

  armorPoints(): number {
    return this.armorCache;
  }
  armorCache = 0;

  statsPacket(): PlayerStats {
    const { level, progress } = this.xpLevel();
    return {
      health: this.health,
      maxHealth: this.maxHealth,
      absorption: this.absorption,
      food: this.food,
      saturation: this.saturation,
      xp: this.xpTotal,
      level,
      xpProgress: progress,
      air: this.air,
      maxAir: this.maxAir,
      armor: this.armorCache,
      effects: [...this.effects.entries()].map(([id, e]) => ({ id, amp: e.amp, ticks: e.ticks })),
      freeze: this.freezeTicks ? Math.round((this.freezeTicks / 140) * 20) / 20 : undefined,
    };
  }

  override meta(): Record<string, unknown> {
    const m: Record<string, unknown> = { name: this.name, sneak: this.sneaking, held: this.heldItem()?.id ?? 0 };
    if (this.effects.has('glowing')) m.glowing = true;
    if (this.gliding) m.glide = true;
    if (this.vehicle) m.riding = this.vehicle.id;
    const chest = this.inventory.get(38);
    if (chest && chest.id === ELYTRA()) m.elytra = true;
    // V6: worn armor, head to feet, by material (drawn on the player model)
    const worn = [39, 38, 37, 36].map((i) => {
      const a = items[this.inventory.get(i)?.id ?? -1]?.def.armor;
      return a && a.material !== 'elytra' ? a.material : '';
    });
    if (worn.some(Boolean)) m.armor = worn;
    return m;
  }

  override trackingRange(): number {
    return 128;
  }

  addStat(key: string, n = 1): void {
    this.statistics[key] = (this.statistics[key] ?? 0) + n;
  }
}

/** XP needed to go from `level` to `level + 1` (classic curve). */
export function xpForLevel(level: number): number {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}
