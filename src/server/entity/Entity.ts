/** Base class for all server-side entities. */
import { newBody, type Body, bodyBox } from '../../common/physics/movement';
import type { AABB } from '../../common/physics/aabb';
import type { EntitySpawn } from '../../common/net/protocol';
import type { Dimension } from '../world/Dimension';

let nextEntityId = 1;
export function allocEntityId(): number {
  return nextEntityId++;
}

export abstract class Entity {
  readonly id = allocEntityId();
  abstract readonly type: string;
  dim!: Dimension;
  body: Body;
  yaw = 0;
  pitch = 0;
  headYaw = 0;
  removed = false;
  age = 0;
  /** Chunk bucket the entity is currently registered in. */
  bucketKey = NaN;
  /** Last position broadcast to clients (for delta updates). */
  lastSent = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, headYaw: NaN };
  /** Entities that are not persisted with chunks (players, projectiles in flight...). */
  persistent = false;
  /** Set when metadata changed and needs broadcasting. */
  metaDirty = false;
  customName: string | null = null;
  /** Created by cheats (Admin Panel or commands): nothing it causes counts towards advancements. */
  admin = false;

  constructor(width: number, height: number) {
    this.body = newBody(0, 0, 0, width, height);
  }

  get x(): number {
    return this.body.x;
  }
  get y(): number {
    return this.body.y;
  }
  get z(): number {
    return this.body.z;
  }

  setPos(x: number, y: number, z: number): void {
    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
  }

  box(out?: AABB): AABB {
    return bodyBox(this.body, out);
  }

  distanceSq(x: number, y: number, z: number): number {
    const dx = this.body.x - x;
    const dy = this.body.y - y;
    const dz = this.body.z - z;
    return dx * dx + dy * dy + dz * dz;
  }

  distanceTo(e: Entity): number {
    return Math.sqrt(this.distanceSq(e.x, e.y, e.z));
  }

  /** Called every server tick while loaded. */
  tick(): void {
    this.age++;
  }

  remove(): void {
    this.removed = true;
  }

  /** Metadata broadcast to clients (health for bosses, item stack for dropped items...). */
  meta(): Record<string, unknown> | undefined {
    return this.customName ? { name: this.customName } : undefined;
  }

  spawnPacket(): EntitySpawn {
    return {
      id: this.id,
      type: this.type,
      x: this.body.x,
      y: this.body.y,
      z: this.body.z,
      yaw: this.yaw,
      pitch: this.pitch,
      vx: this.body.vx,
      vy: this.body.vy,
      vz: this.body.vz,
      meta: this.meta(),
    };
  }

  /** Persisted data (only for persistent entities). */
  save(): Record<string, unknown> | null {
    return null;
  }

  /** Range (blocks) within which players track this entity. */
  trackingRange(): number {
    return 80;
  }
}
