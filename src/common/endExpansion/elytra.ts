/**
 * V6 - The End Expansion, phase 4: Elytra upgrades.
 *
 * Upgrade modules go onto an Elytra at the smithing table (Elytra + module),
 * three at most and each kind once. They live on the Elytra's item data
 * (`tag.data.upgrades`), so repairs, anvils and saves keep them. Shears in
 * the smithing table's other slot take the newest module off again; the
 * module is lost.
 *
 * An Elytra without upgrades flies exactly as it always did, and firework
 * rockets are unchanged. Everything here is an addition.
 */
import type { ItemDef } from '../registry/itemTypes';
import type { ItemStack } from '../game/itemstack';

export type ElytraUpgrade = 'reinforced' | 'thrust' | 'hover' | 'burst' | 'void_recovery' | 'ender_blink';

export interface ElytraModule {
  id: ElytraUpgrade;
  /** The item that adds it at the smithing table. */
  item: string;
  name: string;
  desc: string;
}

export const ELYTRA_MODULES: readonly ElytraModule[] = [
  { id: 'reinforced', item: 'reinforced_module', name: 'Reinforced', desc: 'Twice the durability (864 instead of 432).' },
  { id: 'thrust', item: 'thrust_module', name: 'Thrust', desc: 'Gliding picks up speed 30% faster, and rockets push 20% harder.' },
  { id: 'hover', item: 'hover_module', name: 'Hover', desc: 'Hold sneak while gliding to hang in the air for up to 3 seconds. Recharges on the ground; wears the wings a little.' },
  { id: 'burst', item: 'burst_module', name: 'Burst', desc: 'Double-tap jump while gliding for a burst of speed without a rocket. 3 charges, each back after 10 seconds.' },
  { id: 'void_recovery', item: 'sanctum_dragon_scale', name: 'Void Recovery', desc: 'Falling into the End\'s void brings you back to the last ground you stood on. Costs a quarter of the wings\' durability; 5 minutes to recharge. Only in the End.' },
  { id: 'ender_blink', item: 'ender_blink_module', name: 'Ender Blink', desc: 'While gliding, use an empty hand to blink 8 blocks ahead. It never blinks into blocks. 20 seconds to recharge.' },
];

/** The numbers (ticks, blocks, multipliers). */
export const ELYTRA = {
  slots: 3,
  durability: 432,
  /** Thrust: glide acceleration and rocket boost multipliers. */
  thrustGlide: 1.3,
  thrustRocket: 1.2,
  /** Hover: ticks of hovering per charge, and one point of durability every `hoverWear` ticks. */
  hoverTicks: 60,
  hoverWear: 10,
  /** Burst: charges, ticks for one to come back, ticks the push lasts. */
  burstCharges: 3,
  burstRecharge: 200,
  burstTicks: 8,
  /** Ender Blink: distance and cooldown. */
  blink: 8,
  blinkCooldown: 400,
  /** Void Recovery: cooldown and the share of the remaining durability it costs. */
  recoveryCooldown: 6000,
  recoveryCost: 0.25,
} as const;

/**
 * Module items. Void Recovery's is the Sanctum Dragon Scale, found only in
 * the Sanctum at the end of The Dragon's History (the ordinary Dragon Scales
 * the Dragon drops don't do it).
 */
export function elytraItemDefs(): ItemDef[] {
  const mod = (id: string, name: string, desc: string, rarity: ItemDef['rarity'] = 'rare'): ItemDef => ({ id, name, maxStack: 16, rarity, creative: 'tools', tooltip: `Elytra upgrade: ${desc}`, tags: ['elytra_module'] });
  const desc = (u: ElytraUpgrade): string => ELYTRA_MODULES.find((m) => m.id === u)!.desc;
  return [
    mod('reinforced_module', 'Reinforced Module', desc('reinforced')),
    mod('thrust_module', 'Thrust Module', desc('thrust')),
    mod('hover_module', 'Hover Module', desc('hover')),
    mod('burst_module', 'Burst Module', desc('burst')),
    { id: 'sanctum_dragon_scale', name: 'Sanctum Dragon Scale', maxStack: 16, rarity: 'epic', creative: 'tools', tooltip: `The oldest scale, kept where no one could reach it. Elytra upgrade, Void Recovery: ${desc('void_recovery')}`, tags: ['elytra_module'] },
    mod('ender_blink_module', 'Ender Blink Module', desc('ender_blink'), 'epic'),
  ];
}

const VALID = new Set<string>(ELYTRA_MODULES.map((m) => m.id));

/** The upgrades on an Elytra (in the order they were added). */
export function elytraUpgrades(s: ItemStack | null | undefined): ElytraUpgrade[] {
  const up = s?.tag?.data?.upgrades;
  return Array.isArray(up) ? (up.filter((u) => typeof u === 'string' && VALID.has(u)) as ElytraUpgrade[]).slice(0, ELYTRA.slots) : [];
}

export function hasUpgrade(s: ItemStack | null | undefined, u: ElytraUpgrade): boolean {
  return elytraUpgrades(s).includes(u);
}

/** Which upgrade a module item adds. */
export function moduleUpgrade(itemId: string): ElytraUpgrade | null {
  return ELYTRA_MODULES.find((m) => m.item === itemId)?.id ?? null;
}

/** Why a module can't go on (null: it can). */
export function cannotAdd(s: ItemStack, u: ElytraUpgrade): string | null {
  const ups = elytraUpgrades(s);
  if (ups.includes(u)) return 'It already has that upgrade.';
  if (ups.length >= ELYTRA.slots) return 'All three upgrade slots are taken.';
  return null;
}

/** The Elytra with one more upgrade (a copy). */
export function withUpgrade(s: ItemStack, u: ElytraUpgrade): ItemStack {
  const ups = [...elytraUpgrades(s), u];
  return { ...s, tag: { ...(s.tag ?? {}), data: { ...(s.tag?.data ?? {}), upgrades: ups } } };
}

/** The Elytra without its newest upgrade (a copy), or null when it has none. */
export function withoutNewest(s: ItemStack): ItemStack | null {
  const ups = elytraUpgrades(s);
  if (!ups.length) return null;
  ups.pop();
  const data: Record<string, unknown> = { ...(s.tag?.data ?? {}) };
  if (ups.length) data.upgrades = ups;
  else delete data.upgrades;
  const tag: NonNullable<ItemStack['tag']> = { ...(s.tag ?? {}) };
  if (Object.keys(data).length) tag.data = data;
  else delete tag.data;
  const out: ItemStack = { ...s, tag };
  if (!Object.keys(tag).length) delete out.tag;
  // Losing Reinforced can't leave it more worn than an ordinary Elytra can be
  if (!ups.includes('reinforced') && (out.damage ?? 0) >= ELYTRA.durability) out.damage = ELYTRA.durability - 1;
  return out;
}

/** Glide physics multipliers for the Elytra's upgrades (1 and 1 without Thrust: unchanged flight). */
export function glideFactors(ups: readonly ElytraUpgrade[]): { glide: number; rocket: number } {
  return ups.includes('thrust') ? { glide: ELYTRA.thrustGlide, rocket: ELYTRA.thrustRocket } : { glide: 1, rocket: 1 };
}

/** Tooltip lines for an Elytra's upgrades. */
export function upgradeLines(s: ItemStack): string[] {
  const ups = elytraUpgrades(s);
  if (!ups.length) return [];
  const free = ELYTRA.slots - ups.length;
  return [`Upgrades (${ups.length}/${ELYTRA.slots}):`, ...ups.map((u) => `  ${ELYTRA_MODULES.find((m) => m.id === u)!.name}`), ...(free ? [`  ${free} slot${free === 1 ? '' : 's'} free`] : [])];
}

/**
 * The smithing table with an Elytra: a module adds its upgrade; shears take
 * the newest one off (the module is lost). Null when nothing happens (also
 * when the module can't go on: a duplicate, or no slot left).
 */
export function elytraSmith(base: ItemStack | null, addition: ItemStack | null, idOf: (s: ItemStack) => string): { result: ItemStack; kind: 'add' | 'remove'; upgrade: ElytraUpgrade | null } | null {
  if (!base || !addition || idOf(base) !== 'elytra') return null;
  const a = idOf(addition);
  if (a === 'shears') {
    const ups = elytraUpgrades(base);
    const out = withoutNewest(base);
    return out ? { result: { ...out, count: 1 }, kind: 'remove', upgrade: ups[ups.length - 1] ?? null } : null;
  }
  const u = moduleUpgrade(a);
  if (!u || cannotAdd(base, u)) return null;
  return { result: { ...withUpgrade(base, u), count: 1 }, kind: 'add', upgrade: u };
}
