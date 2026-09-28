/**
 * Potions and brewing (data-driven). A potion item carries `tag.potion` with
 * one of these ids. Durations are in ticks.
 */
export interface PotionDef {
  id: string;
  name: string;
  color: number;
  effects: { id: string; amp: number; duration: number }[];
}

const P: PotionDef[] = [];
function potion(id: string, name: string, color: number, effects: PotionDef['effects'] = []): void {
  P.push({ id, name, color, effects });
}

potion('water', 'Water Bottle', 0x385dc6);
potion('awkward', 'Awkward Potion', 0x385dc6);
potion('mundane', 'Mundane Potion', 0x385dc6);
potion('thick', 'Thick Potion', 0x385dc6);
potion('night_vision', 'Potion of Night Vision', 0x1f1fa1, [{ id: 'night_vision', amp: 0, duration: 3600 }]);
potion('long_night_vision', 'Potion of Night Vision', 0x1f1fa1, [{ id: 'night_vision', amp: 0, duration: 9600 }]);
potion('invisibility', 'Potion of Invisibility', 0x7f8392, [{ id: 'invisibility', amp: 0, duration: 3600 }]);
potion('long_invisibility', 'Potion of Invisibility', 0x7f8392, [{ id: 'invisibility', amp: 0, duration: 9600 }]);
potion('leaping', 'Potion of Leaping', 0x22ff4c, [{ id: 'jump_boost', amp: 0, duration: 3600 }]);
potion('long_leaping', 'Potion of Leaping', 0x22ff4c, [{ id: 'jump_boost', amp: 0, duration: 9600 }]);
potion('strong_leaping', 'Potion of Leaping', 0x22ff4c, [{ id: 'jump_boost', amp: 1, duration: 1800 }]);
potion('fire_resistance', 'Potion of Fire Resistance', 0xe49a3a, [{ id: 'fire_resistance', amp: 0, duration: 3600 }]);
potion('long_fire_resistance', 'Potion of Fire Resistance', 0xe49a3a, [{ id: 'fire_resistance', amp: 0, duration: 9600 }]);
potion('swiftness', 'Potion of Swiftness', 0x7cafc6, [{ id: 'speed', amp: 0, duration: 3600 }]);
potion('long_swiftness', 'Potion of Swiftness', 0x7cafc6, [{ id: 'speed', amp: 0, duration: 9600 }]);
potion('strong_swiftness', 'Potion of Swiftness', 0x7cafc6, [{ id: 'speed', amp: 1, duration: 1800 }]);
potion('slowness', 'Potion of Slowness', 0x5a6c81, [{ id: 'slowness', amp: 0, duration: 1800 }]);
potion('long_slowness', 'Potion of Slowness', 0x5a6c81, [{ id: 'slowness', amp: 0, duration: 4800 }]);
potion('water_breathing', 'Potion of Water Breathing', 0x2e5299, [{ id: 'water_breathing', amp: 0, duration: 3600 }]);
potion('long_water_breathing', 'Potion of Water Breathing', 0x2e5299, [{ id: 'water_breathing', amp: 0, duration: 9600 }]);
potion('healing', 'Potion of Healing', 0xf82423, [{ id: 'instant_health', amp: 0, duration: 1 }]);
potion('strong_healing', 'Potion of Healing', 0xf82423, [{ id: 'instant_health', amp: 1, duration: 1 }]);
potion('harming', 'Potion of Harming', 0x430a09, [{ id: 'instant_damage', amp: 0, duration: 1 }]);
potion('strong_harming', 'Potion of Harming', 0x430a09, [{ id: 'instant_damage', amp: 1, duration: 1 }]);
potion('poison', 'Potion of Poison', 0x4e9331, [{ id: 'poison', amp: 0, duration: 900 }]);
potion('long_poison', 'Potion of Poison', 0x4e9331, [{ id: 'poison', amp: 0, duration: 1800 }]);
potion('strong_poison', 'Potion of Poison', 0x4e9331, [{ id: 'poison', amp: 1, duration: 432 }]);
potion('regeneration', 'Potion of Regeneration', 0xcd5cab, [{ id: 'regeneration', amp: 0, duration: 900 }]);
potion('long_regeneration', 'Potion of Regeneration', 0xcd5cab, [{ id: 'regeneration', amp: 0, duration: 1800 }]);
potion('strong_regeneration', 'Potion of Regeneration', 0xcd5cab, [{ id: 'regeneration', amp: 1, duration: 450 }]);
potion('strength', 'Potion of Strength', 0x932423, [{ id: 'strength', amp: 0, duration: 3600 }]);
potion('long_strength', 'Potion of Strength', 0x932423, [{ id: 'strength', amp: 0, duration: 9600 }]);
potion('strong_strength', 'Potion of Strength', 0x932423, [{ id: 'strength', amp: 1, duration: 1800 }]);
potion('weakness', 'Potion of Weakness', 0x484d48, [{ id: 'weakness', amp: 0, duration: 1800 }]);
potion('long_weakness', 'Potion of Weakness', 0x484d48, [{ id: 'weakness', amp: 0, duration: 4800 }]);
potion('slow_falling', 'Potion of Slow Falling', 0xf7f8e0, [{ id: 'slow_falling', amp: 0, duration: 1800 }]);
potion('long_slow_falling', 'Potion of Slow Falling', 0xf7f8e0, [{ id: 'slow_falling', amp: 0, duration: 4800 }]);
/** Original: brewed from a dragon scale, hardens the skin. */
potion('resilience', 'Potion of Resilience', 0x6a4a8a, [{ id: 'resistance', amp: 0, duration: 1800 }]);
potion('long_resilience', 'Potion of Resilience', 0x6a4a8a, [{ id: 'resistance', amp: 0, duration: 4800 }]);
potion('strong_resilience', 'Potion of Resilience', 0x6a4a8a, [{ id: 'resistance', amp: 1, duration: 900 }]);
/** Original: resists the Farlands' corruption (reduces glitch damage, clears nausea). */
potion('stability', 'Potion of Stability', 0x2ad7c2, [{ id: 'stability', amp: 0, duration: 3600 }]);
potion('long_stability', 'Potion of Stability', 0x2ad7c2, [{ id: 'stability', amp: 0, duration: 9600 }]);

export const POTIONS: readonly PotionDef[] = P;
export const POTION_BY_ID = new Map(P.map((p) => [p.id, p]));

/** Ingredient item id -> [base potion -> result potion]. */
export const BREWING: Record<string, Record<string, string>> = {
  nether_wart: { water: 'awkward' },
  redstone: { water: 'mundane' },
  glowstone_dust: { water: 'thick' },
  golden_carrot: { awkward: 'night_vision' },
  rabbit_foot: { awkward: 'leaping' },
  magma_cream: { awkward: 'fire_resistance' },
  sugar: { awkward: 'swiftness' },
  pufferfish: { awkward: 'water_breathing' },
  glistering_melon_slice: { awkward: 'healing' },
  spider_eye: { awkward: 'poison' },
  ghast_tear: { awkward: 'regeneration' },
  blaze_powder: { awkward: 'strength' },
  phantom_membrane: { awkward: 'slow_falling' },
  sky_ray_membrane: { awkward: 'slow_falling' },
  glitch_shard: { awkward: 'stability' },
  dragon_scale: { awkward: 'resilience' },
  ember_core: { awkward: 'long_fire_resistance' },
  stalker_fang: { awkward: 'long_night_vision' },
  fermented_spider_eye: {
    water: 'weakness',
    night_vision: 'invisibility',
    long_night_vision: 'long_invisibility',
    swiftness: 'slowness',
    long_swiftness: 'long_slowness',
    leaping: 'slowness',
    long_leaping: 'long_slowness',
    healing: 'harming',
    strong_healing: 'strong_harming',
    poison: 'harming',
    long_poison: 'harming',
    strong_poison: 'strong_harming',
  },
};

/** Modifiers applied to any base potion that has the variant. */
export const MODIFIERS: Record<string, (id: string) => string | null> = {
  redstone: (id) => (POTION_BY_ID.has('long_' + id) ? 'long_' + id : null),
  glowstone_dust: (id) => (POTION_BY_ID.has('strong_' + id) ? 'strong_' + id : null),
};

export function brewResult(potionId: string, ingredient: string): string | null {
  const direct = BREWING[ingredient]?.[potionId];
  if (direct) return direct;
  const mod = MODIFIERS[ingredient];
  if (mod && !potionId.startsWith('long_') && !potionId.startsWith('strong_')) return mod(potionId);
  return null;
}

/** Whether an item can be used as a brewing ingredient at all. */
export function isIngredient(id: string): boolean {
  return id in BREWING || id in MODIFIERS || id === 'gunpowder';
}
