/**
 * Shared entity type information needed by both sides: collision size,
 * eye height, and whether players can attack the entity. Mob definitions
 * register their own entries through `registerEntityInfo`.
 */
export interface EntityTypeInfo {
  width: number;
  height: number;
  eye?: number;
  /** Player melee can target it. */
  attackable: boolean;
  /** Right click interacts with it. */
  interactable?: boolean;
}

const INFO = new Map<string, EntityTypeInfo>([
  ['player', { width: 0.6, height: 1.8, eye: 1.62, attackable: true, interactable: true }],
  ['item', { width: 0.25, height: 0.25, attackable: false }],
  ['xp_orb', { width: 0.5, height: 0.5, attackable: false }],
  ['falling_block', { width: 0.98, height: 0.98, attackable: false }],
  ['tnt', { width: 0.98, height: 0.98, attackable: false }],
  ['arrow', { width: 0.5, height: 0.5, attackable: false }],
  ['snowball', { width: 0.25, height: 0.25, attackable: false }],
  ['egg', { width: 0.25, height: 0.25, attackable: false }],
  ['ender_pearl', { width: 0.25, height: 0.25, attackable: false }],
  ['eye_of_ender', { width: 0.25, height: 0.25, attackable: false }],
  ['fireball', { width: 1, height: 1, attackable: true }],
  ['small_fireball', { width: 0.31, height: 0.31, attackable: false }],
  ['lightning', { width: 0, height: 0, attackable: false }],
  ['end_crystal', { width: 2, height: 2, attackable: true }],
  ['boat', { width: 1.375, height: 0.56, attackable: true, interactable: true }],
  ['minecart', { width: 0.98, height: 0.7, attackable: true, interactable: true }],
]);

export function registerEntityInfo(type: string, info: EntityTypeInfo): void {
  INFO.set(type, info);
}

export function entityInfo(type: string): EntityTypeInfo {
  return INFO.get(type) ?? { width: 0.6, height: 1.8, attackable: true };
}
