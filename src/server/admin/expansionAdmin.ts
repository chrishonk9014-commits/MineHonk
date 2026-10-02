/**
 * V6: the Admin Panel's End Expansion tools. Every one of them is a cheat:
 * switching the portal on before the dragon's defeat makes travel through it
 * a cheat visit, and every teleport here marks its arrival area, so nothing
 * done with them earns an advancement.
 */
import type { ServerPlayer } from '../player/ServerPlayer';
import type { V6Op } from '../../common/game/admin';
import type { EndGenerator } from '../../common/gen/end';
import { arrivalLayout } from '../../common/gen/endExpansion';
import { EXPANSION_BIOMES, expansionBiomeIndex } from '../../common/endExpansion/biomes';
import { inExpansion } from '../../common/endExpansion/region';
import type { EndExpansionSystem } from '../systems/EndExpansion';

export interface ExpansionAdminHelpers {
  /** Teleports (as a cheat) once the destination has loaded; the result follows as a second reply. */
  queueTeleport(p: ServerPlayer, x: number, y: number, z: number, label: string, surface: boolean): void;
}

type Result = { ok: boolean; text: string; data?: unknown } | null;

export function expansionAdmin(sys: EndExpansionSystem, h: ExpansionAdminHelpers, p: ServerPlayer, op: V6Op, biome?: string): Result {
  const s = sys.server;
  const gen = s.dim('end').generator as EndGenerator;
  const ex = gen.terrain.expansion;
  const ok = (text: string): Result => ({ ok: true, text, data: sys.status(p) });
  // Teleports answer twice: this first (the panel shows it as progress), then the landing
  const pending = (text: string): Result => ({ ok: true, text, data: { ...sys.status(p), pending: true } });
  switch (op) {
    case 'status':
      return { ok: true, text: '', data: sys.status(p) };
    case 'activate':
      sys.setActive(true, true);
      return ok(sys.state?.built ? 'The Expansion Portal is open.' : 'The Expansion Portal will be open when the main island loads.');
    case 'deactivate':
      sys.setActive(false, true);
      return ok('The Expansion Portal is closed.');
    case 'build_portal':
      return ok(sys.requestBuild() ? 'Built the Expansion Portal on the main island.' : 'The Expansion Portal will be built as soon as the main island loads.');
    case 'tp_portal': {
      const site = sys.site();
      h.queueTeleport(p, site.x, site.y, site.z - 3, 'Expansion Portal', true);
      return pending('Preparing a landing by the Expansion Portal...');
    }
    case 'tp_arrival': {
      const L = arrivalLayout(ex.arrival());
      h.queueTeleport(p, L.stand.x, L.stand.y, L.stand.z, 'arrival platform', false);
      return pending('Preparing a landing on the arrival platform...');
    }
    case 'tp_biome': {
      const i = expansionBiomeIndex(biome ?? '');
      const def = EXPANSION_BIOMES[i];
      if (!def) return { ok: false, text: 'Unknown biome.' };
      // Search from the player when they're already out there, otherwise from the arrival platform
      const a = ex.arrival();
      const from = p.dim.id === 'end' && inExpansion(p.x, p.z) ? { x: Math.floor(p.x), z: Math.floor(p.z) } : { x: a.x, z: a.z };
      const spot = ex.findBiome(i, from.x, from.z);
      if (!spot) return { ok: false, text: `No ${def.name} found.` };
      h.queueTeleport(p, spot.x, spot.y, spot.z, def.name, true);
      return pending(`Found the ${def.name} at ${spot.x}, ${spot.z}. Preparing a landing...`);
    }
    case 'defeat_dragon': {
      // For testing the portal: the dragon is marked cheat-made first, so its defeat awards
      // nothing and its drops and experience are cheat-made; the fight ends as usual (finish())
      const d = s.theEnd?.fight.dragon;
      if (!d || d.dead) return { ok: false, text: s.level.flags.dragonKilledOnce === true && !s.level.flags.dragonAlive ? 'The Ender Dragon has already been defeated.' : 'The Ender Dragon is not here: go to the End first.' };
      d.admin = true;
      s.level.flags.dragonAdmin = true;
      d.hurt(d.health + 10000, { source: 'mob', attacker: p });
      return ok('The Ender Dragon is defeated (a cheat: no advancement, its drops are cheat-made).');
    }
    case 'where': {
      const st = sys.status(p) as { here: { x: number; y: number; z: number; inExpansion: boolean; biome: string | null } };
      const here = st.here;
      const where = here.inExpansion ? `in the ${here.biome} (Expanded End)` : p.dim.id === 'end' ? 'in the End, outside the Expanded End' : `in the ${p.dim.id}`;
      return ok(`You are ${where} at ${here.x}, ${here.y}, ${here.z}.`);
    }
  }
  return { ok: false, text: 'Unknown action.' };
}
