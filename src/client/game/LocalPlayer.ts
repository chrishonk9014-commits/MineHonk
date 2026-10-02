/**
 * The local player: client-side movement prediction using the shared physics.
 * The server validates every position; teleports correct any divergence.
 */
import { newBody, stepMovement, stepGlide, moveBody, type Body, updateEnvironment, bodyObstructed } from '../../common/physics/movement';
import { ELYTRA, glideFactors, type ElytraUpgrade } from '../../common/endExpansion/elytra';
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
  lastSent = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, onGround: false, sneak: false, sprint: false, flying: false, glide: false, ticks: 0 };
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
  /** Active status effects (from the server's stats). */
  effects: { id: string; amp: number }[] = [];
  /** Gliding on an Elytra. */
  gliding = false;
  /** Ticks of firework rocket boost left. */
  boostTicks = 0;
  /** V6 phase 4: the worn Elytra's upgrades (from the chest slot), and Hover's meter (the server's, counted down here too). */
  wingUps: () => readonly ElytraUpgrade[] = () => [];
  hoverLeft: number = ELYTRA.hoverTicks;
  hovering = false;
  /** Asks the server for an upgrade's move (Burst on a double-tapped jump while gliding). */
  onElytra: (a: 'burst' | 'blink') => void = () => {};
  private lastGlideJump = -100;
  /** Whether the equipped chest item is an Elytra that still flies (set by the game). */
  canGlide: () => boolean = () => false;
  /** Sneaking speed factor (Silent Stride on the leggings raises it). */
  sneakSpeed: () => number = () => 0.3;
  /** Leather boots on: powder snow holds the player up. */
  powderWalk: () => boolean = () => false;
  /**
   * The mob being ridden. With `control` this client simulates the mount's
   * body and steers it; otherwise the player sits wherever the server moves it.
   */
  vehicle: { id: number; control: boolean; seat: number; speed: number; jump: number; body: Body; yaw: number; kind?: 'minecart' | 'skiff'; pilot?: boolean } | null = null;
  /** Position (and yaw) of the ridden (uncontrolled) mount's entity, from the game. */
  vehiclePos: () => [number, number, number, number?] | null = () => null;

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
    if (this.vehicle && loaded && !this.dead) return this.tickRiding(input);
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
    const eff = (id: string): number => {
      const e = this.effects.find((x) => x.id === id);
      return e ? e.amp + 1 : 0;
    };
    const speedMul = Math.max(0.1, 1 + eff('speed') * 0.2 - eff('slowness') * 0.15);
    // Elytra: a jump in mid-air opens the wings; landing, water or flight folds them
    const b0 = this.body;
    if (!this.gliding && input.jumpPressed && !b0.onGround && !this.flying && !b0.inWater && !b0.inLava && !b0.onClimbable && this.canGlide()) this.gliding = true;
    if (this.gliding && (b0.onGround || this.flying || b0.inWater || b0.inLava || !this.canGlide())) {
      this.gliding = false;
      this.boostTicks = 0;
    }
    let res: ReturnType<typeof stepMovement> | null = null;
    if (this.body.onGround) this.hoverLeft = ELYTRA.hoverTicks;
    this.hovering = false;
    if (this.gliding) {
      updateEnvironment(this.world, this.body, this.eyeHeight);
      const ups = this.wingUps();
      // Burst: a double-tapped jump while gliding
      if (input.jumpPressed && ups.includes('burst')) {
        if (this.tickNo - this.lastGlideJump < 7) {
          this.onElytra('burst');
          this.lastGlideJump = -100;
        } else this.lastGlideJump = this.tickNo;
      }
      if (input.sneak && ups.includes('hover') && this.hoverLeft > 0) {
        // Hover: hang in the air while sneak is held (the meter runs down)
        this.hovering = true;
        this.hoverLeft--;
        const b = this.body;
        b.vx *= 0.7;
        b.vz *= 0.7;
        b.vy = 0;
        moveBody(this.world, b, b.vx, 0, b.vz);
        b.fallDistance = 0;
        if (this.boostTicks > 0) this.boostTicks--;
      } else {
        stepGlide(this.world, this.body, this.yaw, this.pitch, this.boostTicks > 0, glideFactors(ups));
        if (this.boostTicks > 0) this.boostTicks--;
      }
    } else {
      res = stepMovement(
        this.world,
        this.body,
        { forward: input.forward, strafe: input.strafe, jump: input.jump, sneak: input.sneak, sprint: this.sprinting, yaw: this.yaw },
        { flying: this.flying, noClip: this.abilities.noClip, walkSpeed: this.abilities.walkSpeed, flySpeed: this.abilities.flySpeed, speedMul, sneakSpeed: this.sneakSpeed(), jumpBoost: eff('jump_boost'), levitation: this.flying ? 0 : eff('levitation'), slowFalling: eff('slow_falling') > 0, powderWalk: this.powderWalk() },
        this.eyeHeight,
      );
    }
    if (this.flying && this.body.onGround && !this.abilities.noClip && this.gamemode !== 'spectator') this.flying = false;
    // The server computes fall damage itself; locally we only need a fresh count per fall
    if (this.body.onGround) this.body.fallDistance = 0;
    const moved = Math.hypot(this.body.x - ox, this.body.z - oz);
    if (this.body.onGround && !this.flying) this.walkDist += moved * 0.6;
    const targetBob = this.body.onGround && !this.flying ? Math.min(0.1, moved) : 0;
    this.bob += (targetBob - this.bob) * 0.4;
    void res;
    const glideFov = this.gliding ? 1 + Math.min(0.25, Math.hypot(this.body.vx, this.body.vy, this.body.vz) * 0.12) : 1;
    this.fovMod += ((this.sprinting ? 1.12 : 1) * (this.flying ? 1.05 : 1) * (1 + (speedMul - 1) * 0.5) * glideFov - this.fovMod) * 0.35;
    return this.movePacket(false);
  }

  /** Riding: steer the mount (controlled) or sit where it is. The rider's feet are on the seat. */
  private tickRiding(input: { forward: number; strafe: number; jump: boolean; jumpPressed: boolean }): C2S | null {
    const v = this.vehicle!;
    this.flying = false;
    this.gliding = false;
    this.sprinting = false;
    this.sneaking = false;
    if (v.control) {
      const vb = v.body;
      // Mounts turn with the camera; they walk forward and sideways, never backwards fast
      v.yaw = this.yaw;
      const jump = input.jumpPressed && vb.onGround && v.jump > 0;
      stepMovement(this.world, vb, { forward: Math.max(-0.3, input.forward), strafe: input.strafe * 0.6, jump: false, sneak: false, sprint: false, yaw: this.yaw }, { flying: false, noClip: false, walkSpeed: v.speed, flySpeed: 0 }, 1);
      if (jump) vb.vy = v.jump;
      vb.fallDistance = 0;
      this.body.x = vb.x;
      this.body.y = vb.y + v.seat;
      this.body.z = vb.z;
    } else {
      const pos = this.vehiclePos();
      if (pos) {
        // A Void Skiff's passenger sits behind its pilot
        const back = v.kind === 'skiff' && !v.pilot ? 0.6 : 0;
        const yaw = pos[3] ?? 0;
        this.body.x = pos[0] + Math.sin(yaw) * back;
        this.body.y = pos[1] + v.seat;
        this.body.z = pos[2] + Math.cos(yaw) * back;
      }
    }
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.body.fallDistance = 0;
    this.body.onGround = true;
    const moved = Math.hypot(this.body.x - this.prev.x, this.body.z - this.prev.z);
    this.bob += (Math.min(0.06, moved) - this.bob) * 0.4;
    this.fovMod += (1 - this.fovMod) * 0.35;
    return this.movePacket(false);
  }

  private movePacket(force: boolean): C2S | null {
    const b = this.body;
    const ls = this.lastSent;
    ls.ticks++;
    const changed = b.x !== ls.x || b.y !== ls.y || b.z !== ls.z || this.yaw !== ls.yaw || this.pitch !== ls.pitch || b.onGround !== ls.onGround || this.sneaking !== ls.sneak || this.sprinting !== ls.sprint || this.flying !== ls.flying || this.gliding !== ls.glide;
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
    ls.glide = this.gliding;
    ls.ticks = 0;
    return { t: 'move', x: b.x, y: b.y, z: b.z, yaw: this.yaw, pitch: this.pitch, onGround: b.onGround, flying: this.flying, sneak: this.sneaking, sprint: this.sprinting, seq: this.seq, glide: this.gliding };
  }

  isUnderwater(): boolean {
    updateEnvironment(this.world, this.body, this.eyeHeight);
    return this.body.eyesInWater;
  }

  stuck(): boolean {
    return bodyObstructed(this.world, this.body, 0.05);
  }
}
