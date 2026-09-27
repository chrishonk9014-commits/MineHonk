/** Game modes, difficulty and derived player abilities. */
export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator' | 'hardcore' | 'god';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export const GAME_MODES: readonly GameMode[] = ['survival', 'creative', 'adventure', 'spectator', 'hardcore', 'god'];
export const DIFFICULTIES: readonly Difficulty[] = ['peaceful', 'easy', 'normal', 'hard'];

export const GAME_MODE_INFO: Record<GameMode, { name: string; description: string }> = {
  survival: { name: 'Survival', description: 'Gather resources, craft, build and survive the night.' },
  creative: { name: 'Creative', description: 'Unlimited blocks, flight and instant building.' },
  adventure: { name: 'Adventure', description: 'Explore and play scenarios. Blocks need the right tools to break.' },
  spectator: { name: 'Spectator', description: 'Fly through everything and observe without interacting.' },
  hardcore: { name: 'Hardcore', description: 'One life. Hard difficulty. Death is permanent.' },
  god: { name: 'God Mode', description: 'Survival with a maximum health you choose — from one heart to infinite.' },
};

export interface Abilities {
  /** May fly (toggle). */
  mayFly: boolean;
  flying: boolean;
  /** Takes no damage at all. */
  invulnerable: boolean;
  instantBuild: boolean;
  /** May break / place blocks. */
  mayBuild: boolean;
  noClip: boolean;
  /** Hunger and health systems apply. */
  survivalStats: boolean;
  walkSpeed: number;
  flySpeed: number;
}

export function abilitiesFor(mode: GameMode): Abilities {
  const base: Abilities = { mayFly: false, flying: false, invulnerable: false, instantBuild: false, mayBuild: true, noClip: false, survivalStats: true, walkSpeed: 0.1, flySpeed: 0.05 };
  switch (mode) {
    case 'creative':
      return { ...base, mayFly: true, invulnerable: true, instantBuild: true, survivalStats: false };
    case 'spectator':
      return { ...base, mayFly: true, flying: true, invulnerable: true, mayBuild: false, noClip: true, survivalStats: false, flySpeed: 0.1 };
    case 'adventure':
      return { ...base, mayBuild: false };
    default:
      return base;
  }
}

/** Survival-like modes share hunger/health/drops rules. */
export function isSurvivalLike(mode: GameMode): boolean {
  return mode === 'survival' || mode === 'hardcore' || mode === 'god' || mode === 'adventure';
}

/** God Mode max-hearts presets offered in world creation. */
export const GOD_HEART_PRESETS = [1, 2, 3, 4, 5, 10, 20, 50, 99, 'infinite'] as const;
export type GodHearts = number | 'infinite';

/** Values above 99 hearts mean infinite health. */
export function normalizeGodHearts(v: unknown): GodHearts {
  if (v === 'infinite' || v === Infinity) return 'infinite';
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 10;
  if (n > 99) return 'infinite';
  return n;
}

/** Maximum health in half-heart points (Infinity for infinite). */
export function maxHealthFor(mode: GameMode, godHearts: GodHearts): number {
  if (mode !== 'god') return 20;
  return godHearts === 'infinite' ? Infinity : godHearts * 2;
}

export function formatHearts(maxHealth: number): string {
  if (!Number.isFinite(maxHealth)) return '∞';
  return String(maxHealth / 2);
}
