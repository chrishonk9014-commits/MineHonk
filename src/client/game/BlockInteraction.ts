/**
 * Targeting, mining progress prediction and placement for the local player.
 * The server remains authoritative: predictions are corrected by block
 * updates from the server.
 */
import { raycastBlocks, type RayHit } from '../../common/physics/raycast';
import { breakTicks, adventureMayBreak } from '../../common/game/mining';
import { REACH_CREATIVE, REACH_SURVIVAL, FACE_DX, FACE_DY, FACE_DZ } from '../../common/world/constants';
import type { ClientWorld } from '../world/ClientWorld';
import type { LocalPlayer } from './LocalPlayer';
import type { ItemStack } from '../../common/game/itemstack';
import { items } from '../../common/registry/items';
import { blocks, STATE_BLOCK, STATE_FLUID } from '../../common/registry/blocks';
import { computePlacement } from '../../common/game/placement';
import type { C2S } from '../../common/net/protocol';
import { enchantLevel } from '../../common/game/enchanting';

export interface DigTarget {
  x: number;
  y: number;
  z: number;
  face: number;
  state: number;
  progress: number;
  ticks: number;
}

export class BlockInteraction {
  target: RayHit | null = null;
  dig: DigTarget | null = null;
  private breakCooldown = 0;
  private useCooldown = 0;
  private seq = 0;

  constructor(
    private readonly world: ClientWorld,
    private readonly player: LocalPlayer,
    private readonly send: (m: C2S) => void,
    private readonly effects: { hitParticles: (state: number, x: number, y: number, z: number, face: number) => void; breakFx: (state: number, x: number, y: number, z: number) => void; sound: (name: string, x: number, y: number, z: number, vol?: number, pitch?: number) => void; swing: () => void },
  ) {}

  reach(): number {
    return this.player.gamemode === 'creative' ? REACH_CREATIVE : REACH_SURVIVAL;
  }

  updateTarget(eye: [number, number, number], dir: [number, number, number]): void {
    if (this.player.gamemode === 'spectator') {
      this.target = null;
      return;
    }
    this.target = raycastBlocks(this.world, eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], this.reach());
  }

  /** Called every tick while the attack button is held. */
  tickMining(held: ItemStack | null, attacking: boolean, underwater: boolean, haste: number, fatigue: number, aquaAffinity: boolean): void {
    if (this.breakCooldown > 0) this.breakCooldown--;
    const t = this.target;
    const mayBreak = !!t && (this.player.abilities.mayBuild || (this.player.gamemode === 'adventure' && adventureMayBreak(t.state, held)));
    if (!attacking || !t || !mayBreak) {
      if (this.dig) {
        this.send({ t: 'dig', action: 'abort', x: this.dig.x, y: this.dig.y, z: this.dig.z, face: this.dig.face });
        this.dig = null;
      }
      return;
    }
    const creative = this.player.gamemode === 'creative';
    if (creative && held && items[held.id]?.def.tool?.type === 'sword') return;
    if (this.dig && (this.dig.x !== t.x || this.dig.y !== t.y || this.dig.z !== t.z || this.dig.state !== t.state)) {
      this.send({ t: 'dig', action: 'abort', x: this.dig.x, y: this.dig.y, z: this.dig.z, face: this.dig.face });
      this.dig = null;
    }
    if (!this.dig) {
      if (this.breakCooldown > 0) return;
      const ticks = breakTicks(t.state, { tool: held, onGround: this.player.body.onGround || this.player.flying, underwater, aquaAffinity, haste, fatigue, creative });
      if (!Number.isFinite(ticks)) return;
      this.send({ t: 'dig', action: 'start', x: t.x, y: t.y, z: t.z, face: t.face });
      if (ticks === 0) {
        this.breakLocal(t.x, t.y, t.z, t.state);
        this.breakCooldown = creative ? 5 : 0;
        return;
      }
      this.dig = { x: t.x, y: t.y, z: t.z, face: t.face, state: t.state, progress: 0, ticks };
    }
    const d = this.dig;
    // Recompute speed as conditions change (tool, ground, water)
    const ticks = breakTicks(d.state, { tool: held, onGround: this.player.body.onGround || this.player.flying, underwater, aquaAffinity, haste, fatigue, creative });
    d.ticks = ticks;
    d.progress += 1 / Math.max(1, ticks);
    if (Math.floor(d.progress * 20) % 4 === 0) {
      const def = blocks[STATE_BLOCK[d.state]!]!.def;
      this.effects.sound('hit.' + def.sound, d.x + 0.5, d.y + 0.5, d.z + 0.5, 0.25, 0.5);
    }
    this.effects.hitParticles(d.state, d.x, d.y, d.z, d.face);
    this.effects.swing();
    if (d.progress >= 1) {
      this.send({ t: 'dig', action: 'finish', x: d.x, y: d.y, z: d.z, face: d.face });
      this.breakLocal(d.x, d.y, d.z, d.state);
      this.dig = null;
      this.breakCooldown = 5;
    }
  }

  private breakLocal(x: number, y: number, z: number, state: number): void {
    this.effects.breakFx(state, x, y, z);
    // Predict removal; the server will correct if rejected.
    this.world.setBlock(x, y, z, 0);
  }

  /** Right click on a block: returns true if a packet was sent. */
  use(held: ItemStack | null, hand: 0 | 1, sneaking: boolean): boolean {
    const t = this.target;
    if (!t || this.useCooldown > 0) return false;
    this.useCooldown = 4;
    const hx = Math.min(1, Math.max(0, t.px - t.x));
    const hy = Math.min(1, Math.max(0, t.py - t.y));
    const hz = Math.min(1, Math.max(0, t.pz - t.z));
    this.send({ t: 'use_on', x: t.x, y: t.y, z: t.z, face: t.face, hx, hy, hz, hand, yaw: this.player.yaw, pitch: this.player.pitch, seq: ++this.seq });
    // Placement prediction for block items (not when interacting with a usable block)
    const def = blocks[STATE_BLOCK[t.state]!]!.def;
    const interacts = !!def.interact && !sneaking;
    if (held && !interacts && this.player.abilities.mayBuild) {
      const idef = items[held.id]?.def;
      if (idef?.block) {
        const pl = computePlacement(this.world, { blockId: idef.block, wallBlockId: idef.wallBlock, x: t.x, y: t.y, z: t.z, face: t.face, hx, hy, hz, yaw: this.player.yaw, pitch: this.player.pitch, sneaking });
        if (pl) {
          const pb = this.player.body;
          const blocked = pl.some((p) => {
            const solid = blocks[STATE_BLOCK[p.state]!]!.def;
            if (!solid || STATE_FLUID[p.state]) return false;
            return pb.x + 0.3 > p.x && pb.x - 0.3 < p.x + 1 && pb.z + 0.3 > p.z && pb.z - 0.3 < p.z + 1 && pb.y < p.y + 1 && pb.y + 1.8 > p.y && (solid.collide ?? true) && solid.model !== 'cross' && solid.model !== 'torch';
          });
          if (!blocked) {
            for (const p of pl) this.world.setBlock(p.x, p.y, p.z, p.state);
            const sdef = blocks[STATE_BLOCK[pl[0]!.state]!]!.def;
            this.effects.sound('place.' + sdef.sound, pl[0]!.x + 0.5, pl[0]!.y + 0.5, pl[0]!.z + 0.5, 1, 0.8);
          }
        }
      }
    }
    this.effects.swing();
    return true;
  }

  tick(): void {
    if (this.useCooldown > 0) this.useCooldown--;
  }

  /** Position adjacent to the target face (for placement previews). */
  adjacent(): [number, number, number] | null {
    const t = this.target;
    if (!t) return null;
    return [t.x + FACE_DX[t.face], t.y + FACE_DY[t.face], t.z + FACE_DZ[t.face]];
  }

  static aquaAffinity(helmet: ItemStack | null): boolean {
    return enchantLevel(helmet, 'aqua_affinity') > 0;
  }
}
