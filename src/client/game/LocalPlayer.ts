/**
 * The local player: client-side movement prediction using the shared physics.
 * The server validates every position; teleports correct any divergence.
 */
import { newBody, stepMovement, type Body, updateEnvironment, bodyObstructed } from '../../common/physics/movement';
import type { ClientWorld } from '../world/ClientWorld';
import type { AbilitiesMsg, C2S } from '../../common/net/protocol';
import type { GameMode } from '../../common/game/gamemode';

export class LocalPlayer {
  body: Body = newBody(0, 100, 0, 0.6, 1.8);
  prev = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  sneaking = false;
  sprinting = false;
  flying = false;
  abilities: AbilitiesMsg = { mayFly: false, flying: false, invulnerable: false, instantBuild: false, mayBuild: true, noClip: false, walkSpeed: 0.1, flySpeed: 0.05 };
  gamemode: GameMode = 'survival';
  entityId = 0;
  seq = 0;
  lastSent = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, onGround: false, sneak: false, sprint: false, flying: false, ticks: 0 };
  frozen = true;
  /** Distance walked (for view bobbing). */
  walkDist = 0;
  prevWalkDist = 0;
  bob = 0;
  prevBob = 0;
  lastJumpPress = -100;
  lastForwardPress = -100;
  tickNo = 0;
  dead = false;
  sleeping = false;
  fovMod = 1;

  constructor(private readonly world: ClientWorld) {}

  get eyeHeight(): number {
    return this.sneaking && !this.flying ? 1.27 : 1.62;
  }

  setPos(x: number, y: number, z: number): void {
    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
    this.prev.x = x;
    this.prev.y = y;
    this.prev.z = z;
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.body.fallDistance = 0;
  }

  /** Interpolated position for rendering. */
  lerpPos(alpha: number): [number, number, number] {
    return [this.prev.x + (this.body.x - this.prev.x) * alpha, this.prev.y + (this.body.y - this.prev.y) * alpha, this.prev.z + (this.body.z - this.prev.z) * alpha];
  }

  /** Runs one 20 Hz physics tick. Returns a move packet if one should be sent. */
  tick(input: { forward: number; strafe: number; jump: boolean; sneak: boolean; sprint: boolean; jumpPressed: boolean; forwardPressed: boolean }): C2S | null {
    this.tickNo++;
    this.prev.x = this.body.x;
    this.prev.y = this.body.y;
    this.prev.z = this.body.z;
    this.prevWalkDist = this.walkDist;
    this.prevBob = this.bob;
    const loaded = this.world.isLoaded(this.body.x, this.body.z);
    if (!loaded || this.dead || this.sleeping) {
      this.frozen = !loaded;
      return this.dead ? null : this.movePacket(true);
    }
    this.frozen = false;
    // Double-tap jump toggles flight
    if (input.jumpPressed && this.abilities.mayFly) {
      if (this.tickNo - this.lastJumpPress < 7) {
        this.flying = !this.flying;
        this.lastJumpPress = -100;
      } else this.lastJumpPress = this.tickNo;
    }
    if (!this.abilities.mayFly) this.flying = false;
    if (this.abilities.noClip) this.flying = true;
    // Double-tap forward to sprint
    if (input.forwardPressed) {
      if (this.tickNo - this.lastForwardPress < 7) this.sprinting = true;
      this.lastForwardPress = this.tickNo;
    }
    if (input.sprint) this.sprinting = true;
    if (input.forward <= 0 || input.sneak || this.body.collidedH) this.sprinting = false;
    this.sneaking = input.sneak;
    const ox = this.body.x;
    const oz = this.body.z;
    const res = stepMovement(this.world, this.body, { forward: input.forward, strafe: input.strafe, jump: input.jump, sneak: input.sneak, sprint: this.sprinting, yaw: this.yaw }, { flying: this.flying, noClip: this.abilities.noClip, walkSpeed: this.abilities.walkSpeed, flySpeed: this.abilities.flySpeed }, this.eyeHeight);
    if (this.flying && this.body.onGround && !this.abilities.noClip && this.gamemode !== 'spectator') this.flying = false;
    // The server computes fall damage itself; locally we only need a fresh count per fall
    if (this.body.onGround) this.body.fallDistance = 0;
    const moved = Math.hypot(this.body.x - ox, this.body.z - oz);
    if (this.body.onGround && !this.flying) this.walkDist += moved * 0.6;
    const targetBob = this.body.onGround && !this.flying ? Math.min(0.1, moved) : 0;
    this.bob += (targetBob - this.bob) * 0.4;
    void res;
    this.fovMod += ((this.sprinting ? 1.12 : 1) * (this.flying ? 1.05 : 1) - this.fovMod) * 0.35;
    return this.movePacket(false);
  }

  private movePacket(force: boolean): C2S | null {
    const b = this.body;
    const ls = this.lastSent;
    ls.ticks++;
    const changed = b.x !== ls.x || b.y !== ls.y || b.z !== ls.z || this.yaw !== ls.yaw || this.pitch !== ls.pitch || b.onGround !== ls.onGround || this.sneaking !== ls.sneak || this.sprinting !== ls.sprint || this.flying !== ls.flying;
    if (!changed && ls.ticks < 20 && !force) return null;
    if (force && !changed && ls.ticks < 20) return null;
    ls.x = b.x;
    ls.y = b.y;
    ls.z = b.z;
    ls.yaw = this.yaw;
    ls.pitch = this.pitch;
    ls.onGround = b.onGround;
    ls.sneak = this.sneaking;
    ls.sprint = this.sprinting;
    ls.flying = this.flying;
    ls.ticks = 0;
    return { t: 'move', x: b.x, y: b.y, z: b.z, yaw: this.yaw, pitch: this.pitch, onGround: b.onGround, flying: this.flying, sneak: this.sneaking, sprint: this.sprinting, seq: this.seq };
  }

  isUnderwater(): boolean {
    updateEnvironment(this.world, this.body, this.eyeHeight);
    return this.body.eyesInWater;
  }

  stuck(): boolean {
    return bodyObstructed(this.world, this.body, 0.05);
  }
}
