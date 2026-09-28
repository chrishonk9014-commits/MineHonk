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

/** Ticks between corruption checks for each player in the Farlands. */
const CORRUPTION_INTERVAL = 100;

export class FarlandsSystem {
  /** Randomness for corruption (replaceable in tests). */
  rng: { chance(p: number): boolean; next(): number } = new Random();

  constructor(private readonly server: GameServer) {}

  useOnBlock(p: ServerPlayer, stack: ItemStack, x: number, y: number, z: number): boolean {
    if (items[stack.id]?.id !== 'corrupted_eye') return false;
    if (p.dim.blockId(x, y, z) !== 'far_portal_frame') return false;
    if (!this.server.portals?.lightFar(p.dim, x, y, z)) return false;
    if (p.gamemode !== 'creative') {
      const s = p.inventory.get(p.selectedSlot);
      if (s) p.inventory.set(p.selectedSlot, s.count > 1 ? { ...s, count: s.count - 1 } : null);
      this.server.interaction.syncInventory(p);
    }
    if (!this.server.interaction.isCheat(p, stack)) this.server.interaction.grant(p, 'find_far_portal');
    return true;
  }

  /** Right click with the Farlands Compass. */
  useItem(p: ServerPlayer, stack: ItemStack): boolean {
    if (items[stack.id]?.id !== 'farlands_compass') return false;
    const inFar = p.dim.id === 'farlands';
    const type = inFar ? 'farlands_vault' : 'glitched_ruin';
    if (p.dim.id !== 'overworld' && !inFar) {
      p.send({ t: 'chat', text: 'The needle spins wildly. Nothing here is close enough to the edge.', kind: 'system' });
      return true;
    }
    const t = p.dim.generator.locate?.(type, Math.floor(p.x), Math.floor(p.z));
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
    const what = inFar ? 'a buried vault' : 'a glitched ruin';
    p.send({ t: 'chat', text: `The needle points ${dir} towards ${what}, about ${dist} blocks away.`, kind: 'system' });
    this.server.playSound(p.dim, 'glitch.zap', p.x, p.y + 1, p.z, 0.4, 1.6);
    return true;
  }

  tick(): void {
    const s = this.server;
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
