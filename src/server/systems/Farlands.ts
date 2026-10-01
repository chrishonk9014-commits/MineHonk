/**
 * Farlands rules: the Corrupted Eye awakens far portal frames, the
 * Farlands Compass points at the nearest way in (or deeper), and the
 * dimension's corruption glitches unprotected players (a Potion of
 * Stability keeps it at bay).
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { ItemStack } from '../../common/game/itemstack';
import { items } from '../../common/registry/items';
import { Random } from '../../common/math/rng';
import { EnderEye } from '../entity/EndEntities';

/** Ticks between corruption checks for each player in the Farlands. */
const CORRUPTION_INTERVAL = 100;

export class FarlandsSystem {
  /** Randomness for corruption (replaceable in tests). */
  rng: { chance(p: number): boolean; next(): number } = new Random();

  constructor(private readonly server: GameServer) {}

  useOnBlock(p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number): boolean {
    if (items[stack.id]?.id !== 'corrupted_eye') return false;
    const id = p.dim.blockId(x, y, z);
    // Anywhere but a portal frame, the Eye shows the way instead
    if (id !== 'far_portal_frame' && id !== 'glitched_portal_frame') return this.guide(p, stack);
    const f = this.server.portals?.lightFar(p.dim, x, y, z);
    if (!f) return false;
    if (p.gamemode !== 'creative') {
      const s = p.inventory.get(p.selectedSlot);
      if (s) p.inventory.set(p.selectedSlot, s.count > 1 ? { ...s, count: s.count - 1 } : null);
      this.server.interaction.syncInventory(p);
    }
    // The portal wakes: everyone close by feels it
    const cx = f.x + (f.axis === 'x' ? f.width / 2 : 0.5);
    const cy = f.y + f.height / 2;
    const cz = f.z + (f.axis === 'z' ? f.width / 2 : 0.5);
    for (const o of this.server.players.values()) {
      if (o.dim !== p.dim || (o.x - cx) ** 2 + (o.y - cy) ** 2 + (o.z - cz) ** 2 > 48 * 48) continue;
      o.send({ t: 'fx', kind: 'portal_on', x: cx, y: cy, z: cz, ticks: 40 });
    }
    this.server.particles(p.dim, 'void_burst', cx, cy, cz, 60, 2);
    if (!this.server.interaction.isCheat(p, stack)) {
      this.server.interaction.grant(p, 'find_far_portal');
      const e = this.server.endings;
      if (e) e.state.farlandsAccess = true;
    }
    return true;
  }

  /** Ticks between Corrupted Eye guides. */
  private readonly guideReady = new WeakMap<ServerPlayer, number>();

  /**
   * V3.1: the Corrupted Eye works like an Eye of Ender that is never used
   * up. Thrown, an image of it flies towards the nearest glitched portal
   * (a glitched ruin's frame in worlds made before V3) and dissolves; the
   * Eye stays in hand. Returns true whenever the click was the Eye's.
   */
  guide(p: ServerPlayer, stack: ItemStack): boolean {
    const s = this.server;
    const now = s.tickNo;
    if ((this.guideReady.get(p) ?? 0) > now) return true;
    if (p.dim.id !== 'overworld') {
      p.send({ t: 'chat', text: 'The Eye stares back, unfocused. There is no way through from here.', kind: 'system' });
      this.guideReady.set(p, now + 20);
      return true;
    }
    const type = s.level.generatorVersion >= 3 ? 'glitched_portal' : 'glitched_ruin';
    const target = p.dim.generator.locate?.(type, Math.floor(p.x), Math.floor(p.z));
    if (!target) {
      p.send({ t: 'chat', text: 'The Eye flickers, but finds nothing to lead you to.', kind: 'system' });
      this.guideReady.set(p, now + 20);
      return true;
    }
    const [ex, ey, ez] = s.eyePos(p);
    const eye = new EnderEye(ex, ey - 0.1, ez, target, false, true);
    p.dim.addEntity(eye);
    s.playSound(p.dim, 'ender_eye.launch', ex, ey, ez, 1, 0.6);
    s.playSound(p.dim, 'glitch.zap', ex, ey, ez, 0.5, 1.4);
    this.guideReady.set(p, now + 20);
    p.send({ t: 'cooldown', item: stack.id, ticks: 20 });
    return true;
  }

  /** Right click with the Farlands Compass (or the Corrupted Eye, in the air). */
  useItem(p: ServerPlayer, stack: ItemStack): boolean {
    if (items[stack.id]?.id === 'corrupted_eye') return this.guide(p, stack);
    if (items[stack.id]?.id !== 'farlands_compass') return false;
    const inFar = p.dim.id === 'farlands';
    if (p.dim.id !== 'overworld' && !inFar) {
      p.send({ t: 'chat', text: 'The needle spins wildly. Nothing here is close enough to the edge.', kind: 'system' });
      return true;
    }
    // V3 worlds: the way in is a glitched portal in the corrupted caves; in the
    // Farlands the needle is drawn to The Error's arena until it falls
    const v3 = this.server.level.generatorVersion >= 3;
    const arena = inFar && !this.server.endings?.state.errorDefeated ? p.dim.generator.locate?.('error_arena', Math.floor(p.x), Math.floor(p.z)) : null;
    const type = inFar ? (arena ? 'error_arena' : 'farlands_vault') : v3 ? 'glitched_portal' : 'glitched_ruin';
    const t = arena ?? p.dim.generator.locate?.(type, Math.floor(p.x), Math.floor(p.z));
    if (!t) {
      p.send({ t: 'chat', text: 'The needle trembles but settles nowhere.', kind: 'system' });
      return true;
    }
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.round(Math.hypot(dx, dz));
    const dirs = ['north', 'north-west', 'west', 'south-west', 'south', 'south-east', 'east', 'north-east'];
    const ang = Math.atan2(-dx, -dz);
    const dir = dirs[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8]!;
    const what = type === 'error_arena' ? 'something enormous floating over the void' : inFar ? 'a buried vault' : v3 ? 'a glitched portal deep underground' : 'a glitched ruin';
    p.send({ t: 'chat', text: `The needle points ${dir} towards ${what}, about ${dist} blocks away.`, kind: 'system' });
    this.server.playSound(p.dim, 'glitch.zap', p.x, p.y + 1, p.z, 0.4, 1.6);
    return true;
  }

  /** Nearest glitched portal per player, refreshed when they move far enough. */
  private readonly hintCache = new WeakMap<ServerPlayer, { x: number; z: number; at: { x: number; y: number; z: number } | null }>();

  /**
   * V3: a Corrupted Eye held in the Overworld leaks motes that drift towards
   * the nearest glitched portal (a hint, not a map: they fade within a few blocks).
   */
  private eyeHints(): void {
    const s = this.server;
    if (s.level.generatorVersion < 3) return;
    for (const p of s.players.values()) {
      if (p.dead || p.dim.id !== 'overworld' || items[p.heldItem()?.id ?? -1]?.id !== 'corrupted_eye') continue;
      let c = this.hintCache.get(p);
      if (!c || (c.x - p.x) ** 2 + (c.z - p.z) ** 2 > 32 * 32) {
        c = { x: p.x, z: p.z, at: p.dim.generator.locate?.('glitched_portal', Math.floor(p.x), Math.floor(p.z)) ?? null };
        this.hintCache.set(p, c);
      }
      if (!c.at) continue;
      const dx = c.at.x + 0.5 - p.x;
      const dy = c.at.y + 1 - (p.y + 1.2);
      const dz = c.at.z + 0.5 - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 3) continue;
      for (let k = 1; k <= 3; k++) {
        const f = (0.8 + k * 0.7) / d;
        s.particles(p.dim, 'glitch', p.x + dx * f, p.y + 1.2 + dy * f, p.z + dz * f, 1, 0.05);
      }
    }
  }

  tick(): void {
    const s = this.server;
    if (s.tickNo % 10 === 0) this.eyeHints();
    if (s.tickNo % 20 !== 0) return;
    for (const p of s.players.values()) {
      if (p.dim.id !== 'farlands' || p.dead || p.gamemode === 'creative' || p.gamemode === 'spectator') continue;
      if (s.tickNo % CORRUPTION_INTERVAL !== (p.id % 5) * 20) continue;
      if (p.effects.has('stability')) {
        if (p.effects.has('nausea')) p.effects.delete('nausea');
        continue;
      }
      if (!this.rng.chance(0.2)) continue;
      s.interaction.survival.addEffect(p, 'nausea', 0, 120);
      s.interaction.survival.damage(p, 1, { source: 'magic', attacker: null });
      s.particles(p.dim, 'glitch', p.x, p.y + 1, p.z, 20, 0.6);
      s.playSound(p.dim, 'glitch.zap', p.x, p.y + 1, p.z, 0.8, 0.7 + this.rng.next() * 0.6);
    }
  }
}
