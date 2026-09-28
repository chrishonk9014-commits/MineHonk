/** Per-player cheat bookkeeping (persisted with the player). */
import type { DimensionId } from '../../common/data/biomes';

export interface AdminZone {
  dim: DimensionId;
  x: number;
  z: number;
}

export interface AdminPlayerState {
  /** Experience points that came from cheats; spent first, never counted for advancements. */
  xp: number;
  /** Places reached by cheat teleports: nothing done nearby counts, items found there are marked. */
  zones: AdminZone[];
  /** Dimension entered by a cheat teleport: the whole visit is advancement-neutral. */
  visit: DimensionId | null;
  /** Game mode was set by an admin (differs from the world's own mode). */
  mode: boolean;
  /** Flight granted by an admin in a mode that normally cannot fly. */
  flight: boolean;
}

export const ADMIN_ZONE_RADIUS = 128;
export const MAX_ADMIN_ZONES = 32;

export function newAdminState(): AdminPlayerState {
  return { xp: 0, zones: [], visit: null, mode: false, flight: false };
}

const DIMS: DimensionId[] = ['overworld', 'nether', 'end', 'farlands'];

export function loadAdminState(raw: unknown): AdminPlayerState {
  const s = newAdminState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.xp === 'number' && Number.isFinite(r.xp) && r.xp > 0) s.xp = Math.floor(r.xp);
  if (Array.isArray(r.zones)) {
    for (const z of r.zones as Record<string, unknown>[]) {
      if (z && DIMS.includes(z.dim as DimensionId) && Number.isFinite(z.x) && Number.isFinite(z.z)) s.zones.push({ dim: z.dim as DimensionId, x: z.x as number, z: z.z as number });
    }
    s.zones = s.zones.slice(-MAX_ADMIN_ZONES);
  }
  if (DIMS.includes(r.visit as DimensionId)) s.visit = r.visit as DimensionId;
  s.mode = r.mode === true;
  s.flight = r.flight === true;
  return s;
}
