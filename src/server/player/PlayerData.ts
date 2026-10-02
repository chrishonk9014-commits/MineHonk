/** Loading/saving player state (inventory, stats, position, progression). */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from './ServerPlayer';
import type { DimensionId } from '../../common/data/biomes';
import { stackOf } from '../../common/game/itemstack';
import { maxHealthFor, GAME_MODES, type GameMode } from '../../common/game/gamemode';
import { loadAdminState } from '../admin/adminState';
import { PHASE1_BIOME_IDS } from '../../common/endExpansion/biomes';

export const PLAYER_DATA_VERSION = 1;

const DIMS: DimensionId[] = ['overworld', 'nether', 'end', 'farlands', 'computer'];

export class PlayerData {
  constructor(private readonly server: GameServer) {}

  async load(p: ServerPlayer): Promise<{ found: boolean; dim: DimensionId }> {
    let raw: Record<string, unknown> | null = null;
    try {
      raw = (await this.server.storage.readPlayer(p.uuid)) as Record<string, unknown> | null;
    } catch (e) {
      this.server.log(`[server] failed reading player ${p.name}: ${(e as Error).message}`);
    }
    if (!raw || typeof raw !== 'object') return { found: false, dim: 'overworld' };
    const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const pos = Array.isArray(raw.pos) ? (raw.pos as number[]) : null;
    const dim = DIMS.includes(raw.dim as DimensionId) ? (raw.dim as DimensionId) : 'overworld';
    if (pos && pos.length === 3 && pos.every((v) => Number.isFinite(v))) p.setPos(pos[0]!, pos[1]!, pos[2]!);
    else (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
    p.yaw = num(raw.yaw, 0);
    p.pitch = num(raw.pitch, 0);
    // Per-player gamemode (e.g. hardcore spectator after death, /gamemode changes)
    if (GAME_MODES.includes(raw.gamemode as GameMode)) p.setGamemode(raw.gamemode as GameMode);
    p.maxHealth = maxHealthFor(p.gamemode === 'spectator' || p.gamemode === 'creative' ? this.server.level.mode : p.gamemode, this.server.level.godHearts);
    if (this.server.level.mode === 'god' && p.gamemode !== 'god') p.maxHealth = 20;
    const hp = raw.health === 'inf' ? Infinity : num(raw.health, 20);
    p.health = Number.isFinite(p.maxHealth) ? Math.max(0, Math.min(p.maxHealth, Number.isFinite(hp) ? hp : p.maxHealth)) : 20;
    if (p.health <= 0) {
      p.dead = true;
    }
    p.food = Math.max(0, Math.min(20, num(raw.food, 20)));
    p.saturation = Math.max(0, Math.min(20, num(raw.saturation, 5)));
    p.exhaustion = Math.max(0, num(raw.exhaustion, 0));
    p.xpTotal = Math.max(0, Math.floor(num(raw.xp, 0)));
    p.air = Math.max(0, Math.min(p.maxAir, num(raw.air, p.maxAir)));
    p.selectedSlot = Math.max(0, Math.min(8, Math.floor(num(raw.selected, 0))));
    p.inventory.load(raw.inventory);
    p.enderChest.load(raw.enderChest);
    if (Array.isArray(raw.achievements)) for (const a of raw.achievements) if (typeof a === 'string') p.achievements.add(a);
    if (raw.stats && typeof raw.stats === 'object') for (const [k, v] of Object.entries(raw.stats as Record<string, unknown>)) if (typeof v === 'number') p.statistics[k] = v;
    if (Array.isArray(raw.effects)) {
      for (const e of raw.effects as { id?: string; amp?: number; ticks?: number }[]) if (e && typeof e.id === 'string') p.effects.set(e.id, { amp: num(e.amp, 0), ticks: num(e.ticks, 0) });
    }
    const sp = raw.spawnPoint as Record<string, unknown> | undefined;
    if (sp && DIMS.includes(sp.dim as DimensionId) && [sp.x, sp.y, sp.z].every((v) => typeof v === 'number')) {
      p.spawnPoint = { dim: sp.dim as DimensionId, x: sp.x as number, y: sp.y as number, z: sp.z as number, forced: !!sp.forced };
      const bl = sp.block;
      if (Array.isArray(bl) && bl.length === 3 && bl.every((v) => Number.isInteger(v))) p.spawnPoint.block = bl as [number, number, number];
    }
    (p as { fireTicks?: number }).fireTicks = num(raw.fire, 0);
    if (Array.isArray(raw.caveBiomes)) for (const b of raw.caveBiomes) if (typeof b === 'number' && b > 0 && b < 16) p.visitedCaveBiomes.add(b);
    // V6: the Expanded End's biomes this player has been to
    // (V6 phase 2 renamed the Expanded End's biomes: a phase 1 save lists them under their old ids)
    if (Array.isArray(raw.endBiomes)) for (const b of raw.endBiomes) if (typeof b === 'string' && b.length < 64) p.visitedEndBiomes.add(PHASE1_BIOME_IDS[b] ?? b);
    if (Array.isArray(raw.endKills)) for (const k of raw.endKills) if (typeof k === 'string' && k.length < 64) p.expansionKills.add(k);
    for (const [key, set] of [['endFound', p.endFound], ['endTitles', p.endTitles], ['endLore', p.endLore], ['endArtifacts', p.endArtifacts]] as const) {
      const arr = (raw as Record<string, unknown>)[key];
      if (Array.isArray(arr)) for (const k of arr) if (typeof k === 'string' && k.length < 96) set.add(k);
    }
    if (typeof raw.wardenWarning === 'number' && raw.wardenWarning >= 0 && raw.wardenWarning <= 4) p.wardenWarning = Math.floor(raw.wardenWarning);
    const ld = raw.lastDeath as Record<string, unknown> | undefined;
    if (ld && DIMS.includes(ld.dim as DimensionId) && [ld.x, ld.y, ld.z].every((v) => typeof v === 'number' && Number.isFinite(v))) p.lastDeath = { dim: ld.dim as DimensionId, x: ld.x as number, y: ld.y as number, z: ld.z as number };
    if (Array.isArray(raw.endings)) for (const e of raw.endings) if (typeof e === 'string' && e.length < 64) p.endings.add(e);
    if (typeof raw.pendingEnding === 'string' && raw.pendingEnding.length < 64) p.pendingEnding = raw.pendingEnding;
    const ee = raw.endEntry as Record<string, unknown> | undefined;
    if (ee && [ee.x, ee.y, ee.z].every((v) => typeof v === 'number' && Number.isFinite(v))) p.endEntry = { x: ee.x as number, y: ee.y as number, z: ee.z as number };
    p.freezeTicks = Math.max(0, Math.min(140, Math.floor(num(raw.freeze, 0))));
    p.cheat = loadAdminState(raw.cheat);
    this.server.interaction.survival.updateArmor(p);
    return { found: true, dim };
  }

  serialize(p: ServerPlayer): Record<string, unknown> {
    return {
      version: PLAYER_DATA_VERSION,
      uuid: p.uuid,
      name: p.name,
      dim: p.dim?.id ?? 'overworld',
      pos: [p.x, p.y, p.z],
      yaw: p.yaw,
      pitch: p.pitch,
      gamemode: p.gamemode,
      health: Number.isFinite(p.maxHealth) ? p.health : 'inf',
      food: p.food,
      saturation: p.saturation,
      exhaustion: p.exhaustion,
      xp: p.xpTotal,
      air: p.air,
      selected: p.selectedSlot,
      inventory: p.inventory.save(),
      enderChest: p.enderChest.save(),
      achievements: [...p.achievements],
      stats: p.statistics,
      effects: [...p.effects.entries()].map(([id, e]) => ({ id, amp: e.amp, ticks: e.ticks })),
      spawnPoint: p.spawnPoint,
      lastDeath: p.lastDeath ?? undefined,
      wardenWarning: p.wardenWarning || undefined,
      caveBiomes: p.visitedCaveBiomes.size ? [...p.visitedCaveBiomes] : undefined,
      endBiomes: p.visitedEndBiomes.size ? [...p.visitedEndBiomes] : undefined,
      endKills: p.expansionKills.size ? [...p.expansionKills] : undefined,
      endFound: p.endFound.size ? [...p.endFound] : undefined,
      endTitles: p.endTitles.size ? [...p.endTitles] : undefined,
      endLore: p.endLore.size ? [...p.endLore] : undefined,
      endArtifacts: p.endArtifacts.size ? [...p.endArtifacts] : undefined,
      endings: p.endings.size ? [...p.endings] : undefined,
      pendingEnding: p.pendingEnding ?? undefined,
      endEntry: p.endEntry ?? undefined,
      freeze: p.freezeTicks || undefined,
      fire: (p as { fireTicks?: number }).fireTicks ?? 0,
      cheat: p.cheat,
      savedAt: Date.now(),
    };
  }

  async save(p: ServerPlayer): Promise<void> {
    // Return items held on the cursor / crafting grid before saving.
    if (p.cursor) {
      const rem = p.inventory.add(p.cursor);
      p.cursor = null;
      if (rem) this.server.interaction.dropStack(p, rem);
    }
    await this.server.storage.writePlayer(p.uuid, this.serialize(p));
  }

  giveStarterItems(p: ServerPlayer): void {
    if (p.gamemode === 'creative') {
      const kit = ['grass_block', 'stone', 'oak_planks', 'oak_log', 'glass', 'torch', 'bricks', 'stone_bricks', 'oak_door'];
      kit.forEach((id, i) => p.inventory.set(i, stackOf(id, 64)));
    }
  }
}
