/**
 * V6 - The End Expansion: the Expansion Portal on the main End island, travel
 * between it and the Expanded End, and progress there.
 *
 * - The portal is built once (recorded in `level.flags.expansionPortal`) the
 *   first time the main island is loaded: dormant (dark frame, no sheet) until
 *   the Ender Dragon has been defeated (`flags.dragonKilledOnce`, set by the
 *   normal kill and by the secret ending's completion), then alive. Worlds
 *   where the dragon was already dead get it alive straight away.
 * - It is a teleport inside the End: the player never leaves dimension 'end'.
 *   The server picks the destination, waits for its chunks like the End
 *   gateways do, and makes sure the arrival spot has a floor and headroom.
 * - Its frame can't be broken outside creative (like an End Portal Frame);
 *   the Admin Panel can rebuild it.
 * - The Admin Panel can switch it on and off. Opened by the panel before the
 *   dragon's defeat, travel through it is a cheat (nothing it leads to counts).
 */
import { EXPANSION_MOBS } from '../../common/endExpansion/mobs';
import { expansionGiveSets } from '../../common/endExpansion/resources';
import { mobDef } from '../../common/data/mobs';
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import { S, STATE_SOLID, STATE_FLUID, getProp, blocks, STATE_BLOCK } from '../../common/registry/blocks';
import type { EndGenerator } from '../../common/gen/end';
import { arrivalLayout } from '../../common/gen/endExpansion';
import { EXPANSION_PORTAL_SITE, inExpansion } from '../../common/endExpansion/region';
import { EXPANSION_BIOMES } from '../../common/endExpansion/biomes';
import { buildExpansionPortal, setExpansionPortalAlive } from '../../common/endExpansion/portal';

/** Ticks a survival player stands in the portal before it takes them (instant in creative). */
export const EXPANSION_PORTAL_DELAY = 60;

export interface ExpansionPortalState {
  /** Frame placed on the main island (only ever once, unless the Admin Panel rebuilds it). */
  built: boolean;
  /** Bottom centre of the frame. */
  x: number;
  y: number;
  z: number;
  /** Alive (glowing frame, open sheet) or dormant. */
  active: boolean;
  /** The dragon's defeat has opened it. */
  opened: boolean;
  /** Switched on by the Admin Panel before the dragon's defeat: travel through it is a cheat. */
  cheat: boolean;
}

interface Arriving {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class EndExpansionSystem {
  private readonly arriving = new Map<ServerPlayer, Arriving>();
  /** Admin Panel asked for a rebuild while the island wasn't loaded. */
  private rebuild = false;

  constructor(readonly server: GameServer) {}

  private get flags(): Record<string, unknown> {
    return this.server.level.flags;
  }

  private get end(): Dimension {
    return this.server.dim('end');
  }

  private get generator(): EndGenerator {
    return this.end.generator as EndGenerator;
  }

  /** The portal's saved state (null until the End has first been visited or the Admin Panel touched it). */
  get state(): ExpansionPortalState | null {
    const raw = this.flags.expansionPortal as Partial<ExpansionPortalState> | undefined;
    if (!raw || typeof raw !== 'object' || ![raw.x, raw.y, raw.z].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return { built: raw.built === true, x: raw.x!, y: raw.y!, z: raw.z!, active: raw.active === true, opened: raw.opened === true, cheat: raw.cheat === true };
  }

  private save(st: ExpansionPortalState): void {
    this.flags.expansionPortal = { ...st };
  }

  /** The saved state, created on first use: alive straight away where the dragon is already dead. */
  private ensureState(): ExpansionPortalState {
    const st = this.state;
    if (st) return st;
    const killed = this.flags.dragonKilledOnce === true;
    const s = this.site();
    const out: ExpansionPortalState = { built: false, x: s.x, y: s.y, z: s.z, active: killed, opened: killed, cheat: false };
    this.save(out);
    return out;
  }

  /** Where the frame stands on the main island (its base on the terrain there). */
  site(): { x: number; y: number; z: number } {
    const { x, z } = EXPANSION_PORTAL_SITE;
    const col = this.generator.terrain.column(x, z);
    return { x, y: (col?.top ?? 60) + 1, z };
  }

  /** True when every chunk the portal and its approach touch is loaded. */
  private siteLoaded(): boolean {
    const { x, z } = EXPANSION_PORTAL_SITE;
    const dim = this.end;
    for (const dx of [-4, 4]) for (const dz of [-4, 4]) if (!dim.isLoaded(x + dx, z + dz)) return false;
    return true;
  }

  // ------------------------------------------------------------------ the portal

  /** Builds the portal as its state says (dormant or alive). Returns false if the island isn't loaded. */
  private build(): boolean {
    if (!this.siteLoaded()) return false;
    const st = this.ensureState();
    const dim = this.end;
    const s = this.site();
    // Fill any hollow under the plinth so the frame never hangs over the edge
    const stone = S('end_stone');
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -3; dx <= 3; dx++)
        for (let y = s.y - 2; y > s.y - 10; y--) {
          if (STATE_SOLID[dim.getState(s.x + dx, y, s.z + dz)]) break;
          dim.setBlock(s.x + dx, y, s.z + dz, stone);
        }
    buildExpansionPortal((x, y, z, b) => dim.setBlock(x, y, z, b), s.x, s.y, s.z, st.active);
    this.save({ ...st, built: true, x: s.x, y: s.y, z: s.z });
    this.rebuild = false;
    return true;
  }

  /** Switches the portal on or off (the blocks follow once the main island is loaded). */
  setActive(on: boolean, cheat: boolean): ExpansionPortalState {
    const st = this.ensureState();
    st.active = on;
    // Opened by a cheat before the dragon's defeat: travel through it is a cheat until then
    if (on && cheat && !st.opened) st.cheat = true;
    this.save(st);
    this.maintain();
    return st;
  }

  /** Makes the blocks match the state (when loaded and the frame still stands). */
  private sync(st: ExpansionPortalState): void {
    if (!this.siteLoaded()) return;
    const dim = this.end;
    const base = dim.getState(st.x, st.y, st.z);
    if (blocks[STATE_BLOCK[base]!]!.id !== 'expansion_portal_frame') return;
    if ((getProp(base, 'lit') === 'true') === st.active) return;
    setExpansionPortalAlive((x, y, z, b) => dim.setBlock(x, y, z, b), st.x, st.y, st.z, st.active);
    if (st.active) {
      this.server.playSound(dim, 'end_portal.open', st.x + 0.5, st.y + 2, st.z + 0.5, 3, 0.8);
      this.server.particles(dim, 'portal', st.x + 0.5, st.y + 2.5, st.z + 0.5, 60, 1.6);
    }
  }

  /** Builds the portal once, opens it after the dragon's first defeat, and keeps its blocks in step. */
  private maintain(): void {
    if (!this.siteLoaded()) return;
    const st = this.ensureState();
    // The dragon's first defeat opens it (once: the Admin Panel may close it again afterwards)
    if (this.flags.dragonKilledOnce === true && !st.opened) {
      st.opened = true;
      st.active = true;
      st.cheat = false;
      this.save(st);
      if (st.built) for (const p of this.server.players.values()) if (p.dim === this.end) p.send({ t: 'chat', text: 'The Expansion Portal on the main island has opened.', kind: 'system' });
    }
    if (!st.built || this.rebuild) this.build();
    else this.sync(st);
  }

  /** Admin Panel: rebuild the portal now, or as soon as the main island loads. */
  requestBuild(): boolean {
    this.rebuild = true;
    return this.build();
  }

  // ------------------------------------------------------------------ travel

  /** A player stood in an Expansion Portal long enough. */
  enter(p: ServerPlayer): void {
    if (p.dim.id !== 'end' || p.dead) return;
    const there = inExpansion(p.x, p.z);
    if (!there) {
      // The way in only works while the portal is alive (the server decides, whatever the client shows)
      const st = this.state;
      if (!st?.active) {
        p.portalCooldown = 40;
        return;
      }
      this.toExpansion(p, st.cheat);
    } else this.toIsland(p);
  }

  /** Sends a player to the arrival platform in the Expanded End. */
  toExpansion(p: ServerPlayer, cheat: boolean): void {
    const a = this.generator.terrain.expansion.arrival();
    const L = arrivalLayout(a);
    this.depart(p, L.stand.x + 0.5, L.stand.y, L.stand.z + 0.5, L.yaw);
    // A portal opened by a cheat: the arrival area counts as a cheat visit
    if (cheat) this.server.admin.onAdminArrival(p, 'end', L.stand.x, L.stand.z, false);
  }

  /** Sends a player back to the main island, in front of the Expansion Portal. */
  toIsland(p: ServerPlayer): void {
    const s = this.site();
    const z = s.z - 3;
    const col = this.generator.terrain.column(s.x, z);
    this.depart(p, s.x + 0.5, (col?.top ?? s.y - 1) + 1, z + 0.5, 0);
  }

  private depart(p: ServerPlayer, x: number, y: number, z: number, yaw: number): void {
    const dim = p.dim;
    this.server.playSound(dim, 'portal.travel', p.x, p.y + 1, p.z, 0.8, 1.2);
    this.server.teleport(p, x, y, z, yaw);
    p.portalCooldown = 100;
    this.arriving.set(p, { x, y, z, yaw });
  }

  /** Floor under the feet and air for the body at an arrival spot. */
  private makeSafe(dim: Dimension, x: number, y: number, z: number): void {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const floor = dim.getState(bx, y - 1, bz);
    if (!STATE_SOLID[floor] || STATE_FLUID[floor]) dim.setBlock(bx, y - 1, bz, S('end_stone_bricks'));
    for (const dy of [0, 1]) {
      const s = dim.getState(bx, y + dy, bz);
      if (STATE_SOLID[s] || STATE_FLUID[s]) dim.setBlock(bx, y + dy, bz, 0);
    }
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    for (const [p, a] of this.arriving) {
      if (p.dead || p.dim.id !== 'end') {
        this.arriving.delete(p);
        continue;
      }
      const dim = p.dim;
      let loaded = true;
      for (const dx of [-16, 0, 16]) for (const dz of [-16, 0, 16]) if (!dim.isLoaded(a.x + dx, a.z + dz)) loaded = false;
      // The client holds still until its chunks arrive (like after an End gateway)
      if (!loaded) continue;
      this.arriving.delete(p);
      this.makeSafe(dim, a.x, a.y, a.z);
      this.server.teleport(p, a.x, a.y, a.z, a.yaw);
      this.server.playSound(dim, 'portal.travel', a.x, a.y + 1, a.z, 0.6, 1.4);
    }
    if (this.server.tickNo % 20 === 0) {
      this.maintain();
      this.progress();
    }
  }

  /** Advancements for reaching the Expanded End and visiting its biomes (cheat-gated by grant). */
  private progress(): void {
    const end = this.end;
    const it = this.server.interaction;
    for (const p of this.server.players.values()) {
      if (p.dead || p.dim !== end || p.gamemode === 'spectator' || !inExpansion(p.x, p.z) || this.arriving.has(p)) continue;
      if (this.server.admin.inContext(p)) continue;
      it.grant(p, 'enter_expanded_end');
      const id = this.biomeIdAt(p.x, p.z);
      if (id && !p.visitedEndBiomes.has(id)) {
        p.visitedEndBiomes.add(id);
        if (EXPANSION_BIOMES.every((b) => p.visitedEndBiomes.has(b.id))) it.grant(p, 'all_expanded_biomes');
      }
    }
  }

  /** Expanded End biome id at a column (null outside the ring). */
  biomeIdAt(x: number, z: number): string | null {
    if (!inExpansion(x, z)) return null;
    return this.generator.terrain.expansion.biomeDefAt(Math.floor(x), Math.floor(z)).id;
  }

  /** Status for the Admin Panel. */
  status(p: ServerPlayer): Record<string, unknown> {
    const st = this.state;
    const a = this.generator.terrain.expansion.arrival();
    const here = p.dim.id === 'end' ? this.biomeIdAt(p.x, p.z) : null;
    const def = here ? EXPANSION_BIOMES.find((b) => b.id === here) : undefined;
    return {
      portal: st,
      dragonDefeated: this.flags.dragonKilledOnce === true,
      arrival: { x: a.x, y: a.floor, z: a.z, biome: EXPANSION_BIOMES[a.biome]?.name ?? '' },
      here: { dim: p.dim.id, x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), inExpansion: p.dim.id === 'end' && inExpansion(p.x, p.z), biome: def?.name ?? null },
      biomes: EXPANSION_BIOMES.map((b) => ({ id: b.id, name: b.name, visited: p.visitedEndBiomes.has(b.id) })),
      // Phase 2: the Expanded End's mobs (natural spawning, and how many live in each biome's loaded chunks) and resource kits
      mobs: {
        spawning: this.server.endMobs?.spawning ?? false,
        kinds: EXPANSION_MOBS.map((id) => ({ id, name: mobDef(id)?.name ?? id })),
        counts: this.server.endMobs?.countsByBiome(this.end) ?? {},
      },
      sets: expansionGiveSets().map((g) => ({ id: g.id, name: g.name, items: g.items.map(([id]) => id) })),
    };
  }
}
