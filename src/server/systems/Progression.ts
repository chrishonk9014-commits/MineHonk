/**
 * Exploration progress: dimension arrival and structure discovery
 * achievements (checked periodically against the generator's structure
 * layout, so discovering a place needs no special blocks).
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Mob } from '../entity/Mob';

const KILL_ACHIEVEMENTS: Record<string, string> = {
  cave_stalker: 'kill_stalker',
  ember_beast: 'kill_ember_beast',
  glitch_beast: 'kill_glitch_beast',
};

const STRUCTURE_ACHIEVEMENTS: Record<string, string> = {
  village: 'find_village',
  desert_temple: 'find_temple',
  jungle_temple: 'find_temple',
  sky_shrine: 'find_sky_shrine',
  nether_fortress: 'find_fortress',
  stronghold: 'follow_ender_eye',
  end_city: 'find_end_city',
  glitched_ruin: 'find_far_portal',
};

const DIMENSION_ACHIEVEMENTS: Record<string, string> = {
  nether: 'enter_nether',
  end: 'enter_end',
  farlands: 'enter_farlands',
};

export class Progression {
  constructor(private readonly server: GameServer) {
    const prev = server.interaction.onMobKilled;
    server.interaction.onMobKilled = (p, m) => {
      prev?.(p, m);
      if (!(m instanceof Mob)) return;
      if (m.def.category === 'monster' || m.def.category === 'boss') server.interaction.grant(p, 'kill_mob');
      const a = KILL_ACHIEVEMENTS[m.type];
      if (a) server.interaction.grant(p, a);
    };
  }

  onDimension(p: ServerPlayer, dim: string): void {
    const a = DIMENSION_ACHIEVEMENTS[dim];
    if (a) this.server.interaction.grant(p, a);
    if (p.achievements.has('enter_nether') && p.achievements.has('enter_end') && p.achievements.has('enter_farlands')) this.server.interaction.grant(p, 'all_dimensions');
  }

  tick(): void {
    if (this.server.tickNo % 40 !== 0) return;
    for (const p of this.server.players.values()) {
      if (p.dead || p.gamemode === 'spectator') continue;
      const at = p.dim.generator.structureAt?.(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const a = at ? STRUCTURE_ACHIEVEMENTS[at] : undefined;
      if (a) this.server.interaction.grant(p, a);
    }
  }
}
