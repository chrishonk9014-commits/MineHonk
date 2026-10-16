/**
 * Shared by the V7 phase 5 tests: a world with a real (not cheat-made)
 * Trick-or-Treat Village built, standing at its doors, dressing up, and the
 * Admin Panel's requests.
 */
import { expect } from 'vitest';
import { makeServer, join, tick, type FakeConn } from './testServer';
import type { GameServer } from '../../src/server/GameServer';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { HALLOWEEN_ENDS_AT } from '../../src/common/halloween/season';
import type { OverworldGenerator } from '../../src/common/gen/generator';
import { stackOf, type ItemStack } from '../../src/common/game/itemstack';
import { items } from '../../src/common/registry/items';
import type { DoorRecord } from '../../src/common/halloween/villages';
import type { DoorRef } from '../../src/server/systems/TrickOrTreat';
import type { NewWorldOptions } from '../../src/server/world/LevelData';

export const MIN = 60_000;
export const BEFORE = HALLOWEEN_ENDS_AT - MIN;
export const AFTER = HALLOWEEN_ENDS_AT + MIN;
/** A Trick-or-Treat eligible village (seed "v7-villages", generator 9): see v7-villages.test.ts. */
export const SEED = 'v7-villages';
export const VILLAGE = { x: 552, z: 1000 };
const FACING: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

export const idOf = (s: { id: number } | null | undefined): string => (s ? items[s.id]!.id : '');

/** Loads or generates every chunk of an area. */
export async function loadArea(server: GameServer, x0: number, z0: number, x1: number, z1: number): Promise<void> {
  const dim = server.overworld;
  const cx = ((x0 + x1) >> 1) >> 4;
  const cz = ((z0 + z1) >> 1) >> 4;
  const r = Math.max((x1 - x0) >> 4, (z1 - z0) >> 4) / 2 + 2;
  const all = (): boolean => {
    for (let x = x0 >> 4; x <= x1 >> 4; x++) for (let z = z0 >> 4; z <= z1 >> 4; z++) if (!dim.getChunk(x, z)) return false;
    return true;
  };
  for (let i = 0; i < 400 && !all(); i++) {
    dim.want(cx, cz, Math.ceil(r), server.tickNo);
    await new Promise((res) => setTimeout(res, 0));
    dim.processGeneration(5000);
  }
  expect(all()).toBe(true);
}

/** A world with its Trick-or-Treat Village built (a real one: not cheat-made), at `clock.now`. */
export async function trickWorld(clock: { now: number } = { now: BEFORE }, opts: Partial<NewWorldOptions> = {}, storage = new MemoryStorage()): Promise<{ server: GameServer; storage: MemoryStorage; doors: DoorRef[] }> {
  const { server } = await makeServer({ seed: SEED, ...opts }, storage, { clock: () => clock.now });
  const g = server.overworld.generator as OverworldGenerator;
  const s = g.villageAt(VILLAGE.x, VILLAGE.z)!;
  await loadArea(server, s.bounds.x0, s.bounds.z0, s.bounds.x1, s.bounds.z1);
  const rec = server.villages!.record(s.village!.key)!;
  const doors = rec.doors.map((door) => ({ key: s.village!.key, rec, door }));
  return { server, storage, doors };
}

/** Stands a player on a door's step, looking at it. */
export function atDoor(p: ServerPlayer, d: DoorRecord): void {
  const [fx, fz] = FACING[d.facing]!;
  p.setPos(d.out[0] + 0.5, d.out[1], d.out[2] + 0.5);
  p.yaw = Math.atan2(fx, fz);
  p.pitch = 0;
}

/** A sack in the first hotbar slot and a costume on the head (honest ones). */
export function dress(p: ServerPlayer, sack: ItemStack | null = stackOf('trick_or_treat_sack'), hat = 'carved_pumpkin'): void {
  p.inventory.set(39, hat ? stackOf(hat) : null);
  p.selectedSlot = 0;
  p.inventory.set(0, sack);
}

export function knock(server: GameServer, conn: FakeConn, d: DoorRecord): void {
  server.handle(conn, { t: 'knock', x: d.x, y: d.y, z: d.z });
}

let req = 1;
export interface AdminReply {
  ok: boolean;
  text: string;
  data?: Record<string, unknown>;
}
/** An Admin Panel request, answered within the tick. */
export function admin(server: GameServer, conn: FakeConn, action: Record<string, unknown>): AdminReply {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  tick(server, 1);
  return (conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop() ?? { ok: false, text: 'no reply' }) as never;
}
/** An Admin Panel request that answers later (the haunting's talk test). */
export async function adminAsync(server: GameServer, conn: FakeConn, action: Record<string, unknown>): Promise<AdminReply> {
  const r = req++;
  server.handle(conn, { t: 'admin', req: r, action } as never);
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 0));
    tick(server, 1);
    const got = conn.received.filter((m) => m.t === 'admin_result' && (m as { req: number }).req === r).pop();
    if (got) return got as never;
  }
  return { ok: false, text: 'no reply' };
}

export { join, tick };
