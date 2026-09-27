/** Client-side replicated entity with interpolation. */
export class ClientEntity {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  yaw: number;
  pitch: number;
  headYaw: number;
  tyaw: number;
  tpitch: number;
  theadYaw: number;
  vx = 0;
  vy = 0;
  vz = 0;
  meta: Record<string, unknown>;
  /** Interpolation steps remaining towards the target. */
  steps = 0;
  hurtTime = 0;
  deathTime = 0;
  swingTime = 0;
  walkDist = 0;
  prevWalkDist = 0;
  limbSpeed = 0;
  age = 0;
  dead = false;
  anim: string | null = null;
  animTime = 0;

  constructor(
    readonly id: number,
    readonly type: string,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    meta: Record<string, unknown> | undefined,
  ) {
    this.x = this.px = this.tx = x;
    this.y = this.py = this.ty = y;
    this.z = this.pz = this.tz = z;
    this.yaw = this.tyaw = yaw;
    this.pitch = this.tpitch = pitch;
    this.headYaw = this.theadYaw = yaw;
    this.meta = meta ?? {};
  }

  setTarget(x: number, y: number, z: number, yaw: number, pitch: number, headYaw: number): void {
    this.tx = x;
    this.ty = y;
    this.tz = z;
    this.tyaw = yaw;
    this.tpitch = pitch;
    this.theadYaw = headYaw;
    this.steps = 3;
  }

  /** 20 Hz update: move towards the target. */
  tick(): void {
    this.age++;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.prevWalkDist = this.walkDist;
    if (this.steps > 0) {
      const f = 1 / this.steps;
      this.x += (this.tx - this.x) * f;
      this.y += (this.ty - this.y) * f;
      this.z += (this.tz - this.z) * f;
      this.yaw += angleDiff(this.tyaw, this.yaw) * f;
      this.pitch += (this.tpitch - this.pitch) * f;
      this.headYaw += angleDiff(this.theadYaw, this.headYaw) * f;
      this.steps--;
    }
    // No velocity extrapolation: the server sends positions for everything that
    // moves, and extrapolating a stale spawn velocity makes resting mobs drift.
    const moved = Math.hypot(this.x - this.px, this.z - this.pz);
    this.limbSpeed += (Math.min(1, moved * 4) - this.limbSpeed) * 0.4;
    this.walkDist += this.limbSpeed;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.swingTime > 0) this.swingTime--;
    if (this.dead) this.deathTime++;
    if (this.anim) this.animTime++;
  }

  lerp(alpha: number): [number, number, number] {
    return [this.px + (this.x - this.px) * alpha, this.py + (this.y - this.py) * alpha, this.pz + (this.z - this.pz) * alpha];
  }
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
