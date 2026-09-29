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
  underground_ruins: 'find_underground_structure',
  buried_temple: 'find_underground_structure',
  hidden_chamber: 'find_underground_structure',
  abandoned_lab: 'find_underground_structure',
  cave_shrine: 'find_underground_structure',
  monster_chamber: 'find_underground_structure',
  treasure_room: 'find_treasure_room',
  ancient_city: 'find_ancient_city',
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
      // Killing a cheat-spawned mob never counts
      if (m.admin) return;
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
    if (this.server.tickNo % 20 === 0) for (const p of this.server.players.values()) this.caves(p);
    if (this.server.tickNo % 40 !== 0) return;
    for (const p of this.server.players.values()) {
      if (p.dead || p.gamemode === 'spectator') continue;
      const at = p.dim.generator.structureAt?.(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const a = at ? STRUCTURE_ACHIEVEMENTS[at] : undefined;
      if (a) {
        this.server.interaction.grant(p, a);
        if (at === 'treasure_room') this.server.interaction.grant(p, 'find_underground_structure');
      }
    }
  }

  /** Which cave biome a player is in: tells their client (fog, ambience) and counts visits. */
  private caves(p: ServerPlayer): void {
    const g = p.dim.generator;
    let cb = 0;
    if (g.caves && g.caveBiomeAt && !p.dead) {
      // Underground means out of the sky's reach as well as below the surface
      const head = p.dim.getLight(Math.floor(p.x), Math.floor(p.y + 1.6), Math.floor(p.z)) >> 4;
      cb = head < 15 || p.y < 50 ? g.caveBiomeAt(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)) : 0;
    }
    if (cb !== p.caveBiome) {
      p.caveBiome = cb;
      p.send({ t: 'cave_biome', id: cb });
    }
    // Cheat arrivals (admin teleports) never count as a visit
    if (!cb || p.gamemode === 'spectator' || this.server.admin.inContext(p)) return;
    const it = this.server.interaction;
    if (!p.visitedCaveBiomes.has(cb)) {
      p.visitedCaveBiomes.add(cb);
      it.grant(p, 'enter_cave_biome');
      // The nine biomes of the Caves Update (the corrupted caves are a secret of their own)
      let n = 0;
      for (let i = 1; i <= 9; i++) if (p.visitedCaveBiomes.has(i)) n++;
      if (n >= 9) it.grant(p, 'all_cave_biomes');
      if (cb === 10) it.grant(p, 'find_corrupted_cave');
    }
    if (g.inMegaCavern?.(p.x, p.y, p.z)) it.grant(p, 'find_mega_cavern');
  }
}
