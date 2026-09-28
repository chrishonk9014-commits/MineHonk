/** Base for non-player living entities (mobs). */
import { Entity } from './Entity';
import type { DamageSource } from '../systems/Survival';

export interface HurtInfo {
  source: DamageSource;
  attacker: Entity | null;
  kbx?: number;
  kbz?: number;
  knockback?: number;
  /** Knocks a raised shield aside for this many ticks. */
  disableShield?: number;
  /** Goes through a raised shield (at half strength). */
  pierceShield?: boolean;
}

export abstract class LivingEntity extends Entity {
  health: number;
  maxHealth: number;
  hurtTime = 0;
  deathTime = 0;
  dead = false;
  fireTicks = 0;
  lastAttacker: Entity | null = null;
  lastHurtByPlayerTick = -1000;
  armor = 0;

  constructor(width: number, height: number, maxHealth: number) {
    super(width, height);
    this.maxHealth = maxHealth;
    this.health = maxHealth;
  }

  /** Returns damage applied. Subclasses implement drops / AI reactions. */
  abstract hurt(amount: number, info: HurtInfo): number;

  isUndead(): boolean {
    return false;
  }

  isArthropod(): boolean {
    return false;
  }

  isFarlands(): boolean {
    return false;
  }
}
