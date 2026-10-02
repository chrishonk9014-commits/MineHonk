/**
 * V6 - The End Expansion, phase 4: what an upgraded Elytra does (the server
 * decides; the client predicts the same).
 *
 * - Reinforced: twice the durability (itemstack.maxDurability).
 * - Thrust: gliding picks up speed 30% faster and rockets push 20% harder
 *   (the movement budget allows for it here).
 * - Hover: sneak while gliding to hang in the air, 3 seconds at most until
 *   the wearer stands on the ground again; a point of durability every 10
 *   ticks of it.
 * - Burst: a double-tapped jump while gliding gives a short push (a rocket's
 *   for 8 ticks); 3 charges, each back 10 seconds after it was used.
 * - Ender Blink: 8 blocks straight ahead while gliding, stopping short of
 *   anything solid; 20 seconds to recharge.
 * - Void Recovery: in the End, falling below the void line puts the wearer
 *   back on the last ground they stood on, for a quarter of the wings'
 *   remaining durability; 5 minutes to recharge (saved with the player).
 *
 * The client gets the meters (`elytra` messages) for its HUD and to know
 * when hovering, bursting or blinking will be accepted.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { ARMOR_START } from '../player/Inventory';
import { STATE_SOLID } from '../../common/registry/blocks';
import { itemIdOf, maxDurability, type ItemStack } from '../../common/game/itemstack';
import { bodyObstructed } from '../../common/physics/movement';
import { ELYTRA, elytraUpgrades, glideFactors, type ElytraUpgrade } from '../../common/endExpansion/elytra';
import { VOID_LINE } from '../../common/endExpansion/transport';
import { lookDir } from './Interaction';
import { isSurvivalLike } from '../../common/game/gamemode';

type P3 = [number, number, number];

interface WingState {
  /** Ticks of hovering used since the wearer last stood on the ground. */
  hover: number;
  /** When each Burst charge is back (0: ready). */
  charges: number[];
  /** When Ender Blink is ready again. */
  blinkAt: number;
  /** The last solid ground stood on in the End. */
  ground: P3 | null;
  /** What the client was last told. */
  sent: string;
}

const CHEST = ARMOR_START + 2;

export class ElytraUpgrades {
  private readonly state = new Map<ServerPlayer, WingState>();

  constructor(private readonly server: GameServer) {}

  private of(p: ServerPlayer): WingState {
    let s = this.state.get(p);
    if (!s) {
      s = { hover: 0, charges: Array(ELYTRA.burstCharges).fill(0), blinkAt: 0, ground: null, sent: '' };
      this.state.set(p, s);
    }
    return s;
  }

  /** The Elytra worn in the chest slot (with flight left in it), or null. */
  wings(p: ServerPlayer): ItemStack | null {
    const s = p.inventory.get(CHEST);
    if (!s || itemIdOf(s) !== 'elytra') return null;
    return (s.damage ?? 0) < maxDurability(s) - 1 ? s : null;
  }

  upgrades(p: ServerPlayer): ElytraUpgrade[] {
    return elytraUpgrades(this.wings(p));
  }

  /** How much faster than usual a glider may move (1 without Thrust). */
  speedFactor(p: ServerPlayer): number {
    return glideFactors(this.upgrades(p)).glide;
  }

  // ------------------------------------------------------------------ the client's moves

  action(p: ServerPlayer, a: 'burst' | 'blink'): void {
    if (p.dead || !p.gliding || p.vehicle) return;
    const ups = this.upgrades(p);
    const s = this.of(p);
    const now = this.server.tickNo;
    if (a === 'burst') {
      if (!ups.includes('burst')) return;
      const i = s.charges.findIndex((t) => t <= now);
      if (i < 0) return;
      s.charges[i] = now + ELYTRA.burstRecharge;
      p.boostUntil = Math.max(p.boostUntil, now + ELYTRA.burstTicks + 10);
      p.send({ t: 'boost', ticks: ELYTRA.burstTicks });
      this.server.playSound(p.dim, 'elytra.burst', p.x, p.y + 1, p.z, 1, 1);
      this.server.particles(p.dim, 'portal', p.x, p.y + 0.8, p.z, 12, 0.5);
      this.sync(p, true);
      return;
    }
    if (!ups.includes('ender_blink') || s.blinkAt > now) return;
    const to = this.blinkTarget(p);
    if (!to) return;
    s.blinkAt = now + ELYTRA.blinkCooldown;
    this.server.particles(p.dim, 'portal', p.x, p.y + 0.9, p.z, 20, 0.5);
    this.server.playSound(p.dim, 'elytra.blink', p.x, p.y + 1, p.z, 1, 1);
    this.server.teleport(p, to[0], to[1], to[2], undefined, undefined, true);
    this.server.particles(p.dim, 'portal', to[0], to[1] + 0.9, to[2], 20, 0.5);
    this.sync(p, true);
  }

  /** Up to 8 blocks along the look, cut short before the first thing in the way (never into a block). */
  blinkTarget(p: ServerPlayer): P3 | null {
    const d = lookDir(p.yaw, p.pitch);
    const body = { ...p.body };
    let best: P3 | null = null;
    for (let t = 0.25; t <= ELYTRA.blink + 1e-6; t += 0.25) {
      const x = p.x + d[0] * t;
      const y = p.y + d[1] * t;
      const z = p.z + d[2] * t;
      if (!p.dim.isLoaded(x, z)) break;
      body.x = x;
      body.y = y;
      body.z = z;
      if (bodyObstructed(p.dim, body, 0.01)) break;
      best = [x, y, z];
    }
    return best && Math.hypot(best[0] - p.x, best[1] - p.y, best[2] - p.z) >= 0.5 ? best : null;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    const now = s.tickNo;
    for (const p of s.players.values()) {
      if (p.recoverCooldown > 0) p.recoverCooldown--;
      if (p.dead) continue;
      const st = this.of(p);
      const ups = this.upgrades(p);
      // Ground to come back to (in the End, standing on something solid)
      if (p.dim.id === 'end' && p.body.onGround && !p.vehicle && STATE_SOLID[p.dim.getState(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z))]) st.ground = [p.x, p.y, p.z];
      if (p.body.onGround) st.hover = 0;
      if (ups.length) {
        // Hover: sneaking while gliding hangs in the air until the meter runs out
        if (ups.includes('hover') && p.gliding && p.sneaking && st.hover < ELYTRA.hoverTicks) {
          st.hover++;
          if (st.hover % ELYTRA.hoverWear === 0) s.interaction.damageStack(p, CHEST, 1);
        }
        if (ups.includes('void_recovery') && p.dim.id === 'end' && p.y < VOID_LINE && p.recoverCooldown <= 0 && st.ground) this.recover(p, st);
      }
      if (now % 10 === 0) this.sync(p, false);
    }
    for (const p of this.state.keys()) if (!s.players.has(p.conn.id)) this.state.delete(p);
  }

  /** Void Recovery: back to the last ground, for a quarter of what's left of the wings. */
  private recover(p: ServerPlayer, st: WingState): void {
    const s = this.server;
    const g = st.ground!;
    let to: P3 = g;
    if (p.dim.isLoaded(g[0], g[2]) && !STATE_SOLID[p.dim.getState(Math.floor(g[0]), Math.floor(g[1] - 0.05), Math.floor(g[2]))]) {
      // That ground is gone: the nearest floor in its column
      const y = s.findSafeY(p.dim, g[0], g[2], Math.floor(g[1]) + 4);
      if (y === null) return;
      to = [g[0], y, g[2]];
    }
    const w = p.inventory.get(CHEST)!;
    const max = maxDurability(w);
    const left = max - (w.damage ?? 0);
    const cost = Math.max(1, Math.ceil(left * ELYTRA.recoveryCost));
    if (isSurvivalLike(p.gamemode)) p.inventory.set(CHEST, { ...w, damage: Math.min(max - 1, (w.damage ?? 0) + cost) });
    p.recoverCooldown = ELYTRA.recoveryCooldown;
    p.gliding = false;
    p.metaDirty = true;
    s.teleport(p, to[0], to[1], to[2]);
    s.playSound(p.dim, 'elytra.recover', to[0], to[1] + 1, to[2], 1, 1);
    s.particles(p.dim, 'portal', to[0], to[1] + 1, to[2], 40, 0.8);
    p.send({ t: 'title', text: '', sub: 'The void gave you back.', ticks: 50 });
    this.sync(p, true);
  }

  /** Tells the client the wings' upgrades and meters when they change. */
  private sync(p: ServerPlayer, force: boolean): void {
    const st = this.of(p);
    const ups = this.upgrades(p);
    const now = this.server.tickNo;
    const msg: { t: 'elytra'; upgrades: string[]; hover?: number; charges?: number; chargeIn?: number; blinkIn?: number; recoverIn?: number } = { t: 'elytra', upgrades: ups };
    if (ups.includes('hover')) msg.hover = ELYTRA.hoverTicks - st.hover;
    if (ups.includes('burst')) {
      msg.charges = st.charges.filter((t) => t <= now).length;
      const next = st.charges.filter((t) => t > now).sort((a, b) => a - b)[0];
      if (next) msg.chargeIn = next - now;
    }
    if (ups.includes('ender_blink')) msg.blinkIn = Math.max(0, st.blinkAt - now);
    if (ups.includes('void_recovery')) msg.recoverIn = p.recoverCooldown;
    // Counting down on its own: only changes of state (not each tick of a countdown) are news
    const key = JSON.stringify({ ...msg, chargeIn: msg.chargeIn ? 1 : 0, blinkIn: msg.blinkIn ? 1 : 0, recoverIn: msg.recoverIn ? 1 : 0, hover: msg.hover === undefined ? undefined : Math.ceil(msg.hover / 10) });
    if (!force && key === st.sent) return;
    st.sent = key;
    p.send(msg);
  }

  onLeave(p: ServerPlayer): void {
    this.state.delete(p);
  }
}
