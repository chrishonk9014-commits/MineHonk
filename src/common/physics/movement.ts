/**
 * Entity movement physics shared by the client (prediction), the server
 * (validation) and mobs. Integration happens at the fixed 20 TPS rate with
 * constants tuned to feel like classic block-game movement.
 */
import { AABB } from './aabb';
import { collisionShape } from './shapes';
import { STATE_FLUID, STATE_FULL_CUBE, blocks, STATE_BLOCK, getProp } from '../registry/blocks';

export interface BlockAccess {
  getState(x: number, y: number, z: number): number;
  /** Whether the chunk containing (x, z) is loaded; unloaded areas are treated as solid walls. */
  isLoaded?(x: number, z: number): boolean;
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  width: number;
  height: number;
  onGround: boolean;
  collidedH: boolean;
  collidedV: boolean;
  inWater: boolean;
  inLava: boolean;
  /** Eyes submerged in water. */
  eyesInWater: boolean;
  onClimbable: boolean;
  fallDistance: number;
  stepHeight: number;
  noClip: boolean;
}

export function newBody(x = 0, y = 0, z = 0, width = 0.6, height = 1.8): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, width, height, onGround: false, collidedH: false, collidedV: false, inWater: false, inLava: false, eyesInWater: false, onClimbable: false, fallDistance: 0, stepHeight: 0.6, noClip: false };
}

export function bodyBox(b: Body, out = new AABB()): AABB {
  const hw = b.width / 2;
  return out.set(b.x - hw, b.y, b.z - hw, b.x + hw, b.y + b.height, b.z + hw);
}

const scratchBoxes: AABB[] = [];
function takeBox(i: number): AABB {
  let bx = scratchBoxes[i];
  if (!bx) bx = scratchBoxes[i] = new AABB();
  return bx;
}

/** Collects block collision boxes intersecting `area`. Returns count written to scratch. */
export function collectBoxes(world: BlockAccess, area: AABB): AABB[] {
  const out: AABB[] = [];
  const x0 = Math.floor(area.minX);
  const y0 = Math.floor(area.minY) - 1;
  const z0 = Math.floor(area.minZ);
  const x1 = Math.floor(area.maxX);
  const y1 = Math.floor(area.maxY);
  const z1 = Math.floor(area.maxZ);
  let n = 0;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const loaded = !world.isLoaded || world.isLoaded(x, z);
      for (let y = y0; y <= y1; y++) {
        if (!loaded) {
          if (y >= 0 && y < 256) {
            const bx = takeBox(n++).set(x, y, z, x + 1, y + 1, z + 1);
            if (bx.intersects(area)) out.push(bx);
          }
          continue;
        }
        const s = world.getState(x, y, z);
        if (s === 0) continue;
        if (STATE_FULL_CUBE[s]) {
          const bx = takeBox(n++).set(x, y, z, x + 1, y + 1, z + 1);
          if (bx.intersects(area)) out.push(bx);
          continue;
        }
        const shape = collisionShape(s);
        for (const sb of shape) {
          const bx = takeBox(n++).set(x + sb[0], y + sb[1], z + sb[2], x + sb[3], y + sb[4], z + sb[5]);
          if (bx.intersects(area)) out.push(bx);
        }
      }
    }
  }
  return out;
}

const tmpBox = new AABB();
const tmpArea = new AABB();

/** Moves a body by (dx,dy,dz) resolving collisions; updates flags. Returns actual movement. */
export function moveBody(world: BlockAccess, b: Body, dx: number, dy: number, dz: number, sneakGuard = false): void {
  if (b.noClip) {
    b.x += dx;
    b.y += dy;
    b.z += dz;
    b.onGround = false;
    b.collidedH = false;
    b.collidedV = false;
    return;
  }
  // Sneaking prevents walking off ledges.
  if (sneakGuard && b.onGround) {
    const step = 0.05;
    const box = bodyBox(b, tmpBox);
    while (dx !== 0 && collectBoxes(world, tmpArea.copy(box).offset(dx, -1.0, 0).set(tmpArea.minX, box.minY - 1.0, tmpArea.minZ, tmpArea.maxX, box.minY - 0.01, tmpArea.maxZ)).length === 0) {
      if (Math.abs(dx) < step) dx = 0;
      else dx -= step * Math.sign(dx);
    }
    while (dz !== 0 && collectBoxes(world, tmpArea.copy(box).offset(0, 0, dz).set(tmpArea.minX, box.minY - 1.0, tmpArea.minZ, tmpArea.maxX, box.minY - 0.01, tmpArea.maxZ)).length === 0) {
      if (Math.abs(dz) < step) dz = 0;
      else dz -= step * Math.sign(dz);
    }
  }
  const origDx = dx;
  const origDy = dy;
  const origDz = dz;
  const box = bodyBox(b, new AABB());
  const area = box.clone().expand(dx, dy, dz);
  const boxes = collectBoxes(world, area);
  for (const o of boxes) dy = box.clipY(o, dy);
  box.offset(0, dy, 0);
  for (const o of boxes) dx = box.clipX(o, dx);
  box.offset(dx, 0, 0);
  for (const o of boxes) dz = box.clipZ(o, dz);
  box.offset(0, 0, dz);

  const onGroundNow = origDy !== dy && origDy < 0;
  // Step up
  if (b.stepHeight > 0 && (onGroundNow || b.onGround) && (origDx !== dx || origDz !== dz)) {
    const sbox = bodyBox(b, new AABB());
    const sarea = sbox.clone().expand(origDx, b.stepHeight, origDz);
    const sboxes = collectBoxes(world, sarea);
    let sy = b.stepHeight;
    for (const o of sboxes) sy = sbox.clipY(o, sy);
    sbox.offset(0, sy, 0);
    let sx = origDx;
    for (const o of sboxes) sx = sbox.clipX(o, sx);
    sbox.offset(sx, 0, 0);
    let sz = origDz;
    for (const o of sboxes) sz = sbox.clipZ(o, sz);
    sbox.offset(0, 0, sz);
    let down = -sy;
    for (const o of sboxes) down = sbox.clipY(o, down);
    sbox.offset(0, down, 0);
    if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-7) {
      box.copy(sbox);
      dx = sx;
      dz = sz;
      dy = sy + down;
    }
  }
  b.x = (box.minX + box.maxX) / 2;
  b.y = box.minY;
  b.z = (box.minZ + box.maxZ) / 2;
  b.collidedH = origDx !== dx || origDz !== dz;
  b.collidedV = origDy !== dy;
  b.onGround = b.collidedV && origDy < 0;
  if (origDx !== dx) b.vx = 0;
  if (origDz !== dz) b.vz = 0;
  if (origDy !== dy) b.vy = 0;
}

/** Updates fluid / climbable flags for the body's current position. */
export function updateEnvironment(world: BlockAccess, b: Body, eyeHeight: number): void {
  const box = bodyBox(b, tmpBox);
  b.inWater = false;
  b.inLava = false;
  const x0 = Math.floor(box.minX + 0.001);
  const x1 = Math.floor(box.maxX - 0.001);
  const z0 = Math.floor(box.minZ + 0.001);
  const z1 = Math.floor(box.maxZ - 0.001);
  const y0 = Math.floor(box.minY + 0.001);
  const y1 = Math.floor(box.maxY - 0.001);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        const s = world.getState(x, y, z);
        const f = STATE_FLUID[s];
        if (!f) continue;
        const h = fluidHeight(s);
        if (box.minY < y + h) {
          if (f === 1) b.inWater = true;
          else b.inLava = true;
        }
      }
    }
  }
  const ey = b.y + eyeHeight;
  const es = world.getState(Math.floor(b.x), Math.floor(ey), Math.floor(b.z));
  b.eyesInWater = STATE_FLUID[es] === 1 && ey < Math.floor(ey) + fluidHeight(es);
  const fs = world.getState(Math.floor(b.x), Math.floor(b.y + 0.01), Math.floor(b.z));
  b.onClimbable = !!blocks[STATE_BLOCK[fs]!]!.def.climbable;
}

/** Height of fluid surface within a fluid block (0..1). */
export function fluidHeight(state: number): number {
  const lvl = parseInt(getProp(state, 'level') ?? '0', 10);
  if (lvl >= 8) return 1;
  return (8 - lvl) / 9;
}

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1 (positive = right)
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  yaw: number;
}

export interface MoveAbilities {
  flying: boolean;
  noClip: boolean;
  walkSpeed: number;
  flySpeed: number;
  /** Multiplier from potion effects etc. */
  speedMul?: number;
  jumpBoost?: number;
  /** Levitation level (effect amplifier + 1): floats upwards. */
  levitation?: number;
  /** Slow falling: tiny gravity and no fall distance. */
  slowFalling?: boolean;
}

export interface MoveResult {
  /** Horizontal speed scaled "block below" friction in use. */
  sprinting: boolean;
  jumped: boolean;
}

/** Block slipperiness under the body. */
function groundSlip(world: BlockAccess, b: Body): number {
  const s = world.getState(Math.floor(b.x), Math.floor(b.y - 0.5), Math.floor(b.z));
  return blocks[STATE_BLOCK[s]!]!.def.slipperiness ?? 0.6;
}

function speedFactorAt(world: BlockAccess, b: Body): number {
  let f = 1;
  const inside = world.getState(Math.floor(b.x), Math.floor(b.y + 0.2), Math.floor(b.z));
  const di = blocks[STATE_BLOCK[inside]!]!.def;
  if (di.speedFactor !== undefined && !di.collide && inside !== 0) f = Math.min(f, di.speedFactor);
  if (b.onGround) {
    const under = world.getState(Math.floor(b.x), Math.floor(b.y - 0.1), Math.floor(b.z));
    const du = blocks[STATE_BLOCK[under]!]!.def;
    if (du.speedFactor !== undefined) f = Math.min(f, du.speedFactor);
  }
  return f;
}

/**
 * Advances a player-like body by one tick using input. Mobs reuse this with
 * synthetic input.
 */
export function stepMovement(world: BlockAccess, b: Body, input: MoveInput, ab: MoveAbilities, eyeHeight: number): MoveResult {
  const res: MoveResult = { sprinting: false, jumped: false };
  b.noClip = ab.noClip;
  updateEnvironment(world, b, eyeHeight);
  let fwd = input.forward;
  let str = input.strafe;
  const len = Math.hypot(fwd, str);
  if (len > 1) {
    fwd /= len;
    str /= len;
  }
  if (input.sneak && !ab.flying) {
    fwd *= 0.3;
    str *= 0.3;
  }
  const sprinting = input.sprint && fwd > 0.8 && !input.sneak;
  res.sprinting = sprinting;
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  // yaw 0 looks towards -Z; strafe right is +X when yaw = 0
  const dirX = -sin * fwd + cos * str;
  const dirZ = -cos * fwd - sin * str;
  const speedMul = ab.speedMul ?? 1;

  if (ab.flying) {
    const accel = ab.flySpeed * (sprinting || input.sprint ? 2 : 1);
    b.vx += dirX * accel;
    b.vz += dirZ * accel;
    if (input.jump) b.vy += ab.flySpeed * 3;
    if (input.sneak) b.vy -= ab.flySpeed * 3;
    moveBody(world, b, b.vx, b.vy, b.vz);
    b.vx *= 0.91;
    b.vz *= 0.91;
    b.vy *= 0.6;
    b.fallDistance = 0;
    return res;
  }

  if (b.inWater || b.inLava) {
    const drag = b.inWater ? 0.8 : 0.5;
    const accel = 0.02 * speedMul * (sprinting && b.inWater ? 1.5 : 1);
    b.vx += dirX * accel;
    b.vz += dirZ * accel;
    if (input.jump) b.vy += 0.04;
    const startY = b.y;
    moveBody(world, b, b.vx, b.vy, b.vz);
    b.vx *= drag;
    b.vz *= drag;
    b.vy *= drag;
    b.vy -= b.inWater ? 0.02 : 0.02;
    // climb out of water onto ledges
    if (b.collidedH) {
      const test = bodyBox(b, tmpBox).offset(b.vx, b.vy + 0.6 - b.y + startY, b.vz);
      if (collectBoxes(world, test).length === 0 && !input.sneak) b.vy = 0.3;
    }
    b.fallDistance = 0;
    return res;
  }

  const slip = b.onGround ? groundSlip(world, b) * 0.91 : 0.91;
  const baseSpeed = ab.walkSpeed * speedMul * (sprinting ? 1.3 : 1);
  const accel = b.onGround ? (baseSpeed * 0.16277136) / (slip * slip * slip) : sprinting ? 0.026 : 0.02;
  b.vx += dirX * accel;
  b.vz += dirZ * accel;

  if (input.jump && b.onGround) {
    b.vy = 0.42 + 0.1 * (ab.jumpBoost ?? 0);
    res.jumped = true;
    if (sprinting) {
      b.vx += -sin * 0.2;
      b.vz += -cos * 0.2;
    }
  }

  if (b.onClimbable) {
    b.vx = Math.max(-0.15, Math.min(0.15, b.vx));
    b.vz = Math.max(-0.15, Math.min(0.15, b.vz));
    b.vy = Math.max(b.vy, input.sneak ? 0 : -0.15);
    b.fallDistance = 0;
  }

  const sf = speedFactorAt(world, b);
  const prevY = b.y;
  moveBody(world, b, b.vx * sf, b.vy, b.vz * sf, input.sneak);

  if (b.onClimbable && (b.collidedH || input.jump)) b.vy = 0.2;

  // fall distance tracking
  if (b.onGround) {
    // landing handled by caller (reads fallDistance before reset)
  } else if (b.y < prevY) {
    b.fallDistance += prevY - b.y;
  }

  if (ab.levitation) {
    b.vy += (0.05 * ab.levitation - b.vy) * 0.2;
    b.fallDistance = 0;
  } else if (ab.slowFalling && b.vy <= 0) {
    b.vy -= 0.01;
    b.vy *= 0.98;
    b.fallDistance = 0;
  } else {
    b.vy -= 0.08;
    b.vy *= 0.98;
  }
  b.vx *= slip;
  b.vz *= slip;
  return res;
}

/**
 * One tick of Elytra gliding. Pitch (positive = looking down) trades height
 * for speed; looking up bleeds speed into lift. `boost` is a firework rocket
 * pushing along the look direction.
 */
export function stepGlide(world: BlockAccess, b: Body, yaw: number, pitch: number, boost: boolean): void {
  const cp = Math.cos(pitch);
  const lx = -Math.sin(yaw) * cp;
  const ly = -Math.sin(pitch);
  const lz = -Math.cos(yaw) * cp;
  const horiz = Math.hypot(lx, lz);
  const speedH = Math.hypot(b.vx, b.vz);
  const lift = cp * cp;
  b.vy += 0.08 * (-1 + lift * 0.75);
  if (b.vy < 0 && horiz > 0) {
    const m = b.vy * -0.1 * lift;
    b.vx += (lx * m) / horiz;
    b.vy += m;
    b.vz += (lz * m) / horiz;
  }
  if (pitch < 0 && horiz > 0) {
    const m = speedH * Math.sin(-pitch) * 0.04;
    b.vx -= (lx * m) / horiz;
    b.vy += m * 3.2;
    b.vz -= (lz * m) / horiz;
  }
  if (horiz > 0) {
    b.vx += ((lx / horiz) * speedH - b.vx) * 0.1;
    b.vz += ((lz / horiz) * speedH - b.vz) * 0.1;
  }
  if (boost) {
    b.vx += lx * 0.1 + (lx * 1.5 - b.vx) * 0.5;
    b.vy += ly * 0.1 + (ly * 1.5 - b.vy) * 0.5;
    b.vz += lz * 0.1 + (lz * 1.5 - b.vz) * 0.5;
  }
  b.vx *= 0.99;
  b.vy *= 0.98;
  b.vz *= 0.99;
  moveBody(world, b, b.vx, b.vy, b.vz);
  b.fallDistance = 0;
}

/** Whether the body's box intersects any solid collision boxes (used to reject noclip). */
export function bodyObstructed(world: BlockAccess, b: Body, shrink = 0.01): boolean {
  const box = bodyBox(b, tmpBox).grow(-shrink);
  return collectBoxes(world, box).length > 0;
}
