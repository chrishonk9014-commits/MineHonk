import { describe, it, expect, beforeAll } from 'vitest';
import { initItems } from '../../src/common/registry/items';
import { S } from '../../src/common/registry/blocks';
import { newBody, stepMovement, type BlockAccess } from '../../src/common/physics/movement';
import { AABB } from '../../src/common/physics/aabb';

/** Tiny sparse world for physics tests. */
function world(fill: (x: number, y: number, z: number) => number): BlockAccess {
  return { getState: (x, y, z) => fill(x, y, z), isLoaded: () => true };
}

const still = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: 0 };
const opts = { flying: false, noClip: false, walkSpeed: 0.1, flySpeed: 0.05 };

describe('physics', () => {
  let stone = 0;
  let slab = 0;
  beforeAll(() => {
    initItems();
    stone = S('stone');
    slab = S('stone_slab');
  });

  it('clips movement against obstacles on every axis', () => {
    const box = new AABB(0, 1, 0, 1, 2, 1);
    const below = new AABB(0, 0, 0, 1, 1, 1);
    const above = new AABB(0, 2.5, 0, 1, 3.5, 1);
    expect(box.clipY(below, -0.5)).toBe(0);
    expect(box.clipY(above, 1)).toBeCloseTo(0.5);
    expect(box.clipY(above, -1)).toBe(-1);
    const east = new AABB(1.25, 1, 0, 2, 2, 1);
    expect(box.clipX(east, 1)).toBeCloseTo(0.25);
    expect(box.clipX(east, -1)).toBe(-1);
    const south = new AABB(0, 1, 1.5, 1, 2, 2);
    expect(box.clipZ(south, 1)).toBeCloseTo(0.5);
  });

  it('falls and lands on the ground', () => {
    const w = world((_x, y) => (y < 64 ? stone : 0));
    const b = newBody(0.5, 70, 0.5);
    for (let i = 0; i < 60; i++) stepMovement(w, b, still, opts, 1.62);
    expect(b.y).toBeCloseTo(64, 5);
    expect(b.onGround).toBe(true);
    // Landing leaves the accumulated distance for the caller (fall damage)
    expect(b.fallDistance).toBeGreaterThan(5.5);
  });

  it('is stopped by walls and steps up slabs but not full blocks', () => {
    const wall = world((_x, y, z) => (y < 64 || (y === 64 && z <= -3) ? stone : 0));
    const b = newBody(0.5, 64, 0.5);
    for (let i = 0; i < 40; i++) stepMovement(wall, b, { ...still, forward: 1 }, opts, 1.62);
    expect(b.y).toBeCloseTo(64, 5);
    expect(b.z).toBeCloseTo(-2 + 0.3, 3);
    const steps = world((_x, y, z) => (y < 64 ? stone : y === 64 && z <= -3 ? slab : 0));
    const c = newBody(0.5, 64, 0.5);
    for (let i = 0; i < 40; i++) stepMovement(steps, c, { ...still, forward: 1 }, opts, 1.62);
    expect(c.y).toBeCloseTo(64.5, 5);
    expect(c.z).toBeLessThan(-3);
  });

  it('jumps about 1.25 blocks', () => {
    const w = world((_x, y) => (y < 64 ? stone : 0));
    const b = newBody(0.5, 64, 0.5);
    for (let i = 0; i < 3; i++) stepMovement(w, b, still, opts, 1.62);
    expect(b.onGround).toBe(true);
    let maxY = 0;
    for (let i = 0; i < 20; i++) {
      stepMovement(w, b, { ...still, jump: i === 0 }, opts, 1.62);
      maxY = Math.max(maxY, b.y);
    }
    expect(maxY - 64).toBeGreaterThan(1.1);
    expect(maxY - 64).toBeLessThan(1.4);
    expect(b.onGround).toBe(true);
  });
});
