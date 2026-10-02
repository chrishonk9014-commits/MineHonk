/**
 * V6 phase 2: numbers the server and client share about the Expanded End's
 * fights: how long attacks are telegraphed, and the arc of a Chorus Beast's
 * throw (the client draws the arc the server's projectile then follows).
 */

/** Every attack is telegraphed for at least this many ticks... */
export const TELEGRAPH_TICKS = 24;
/** ...or this many when more than one player is near. */
export const TELEGRAPH_TICKS_CROWD = 32;
/** How near (blocks) other players must be to lengthen a telegraph. */
export const TELEGRAPH_CROWD_RANGE = 32;

/** Gravity of a thrown chorus glob (blocks per tick per tick; it has no drag). */
export const CHORUS_GLOB_GRAVITY = 0.04;

/** Launch velocity that carries a chorus glob from a to b in `flight` ticks. */
export function arcVelocity(ax: number, ay: number, az: number, bx: number, by: number, bz: number, flight: number): [number, number, number] {
  const g = CHORUS_GLOB_GRAVITY;
  return [(bx - ax) / flight, (by - ay + (g * flight * (flight - 1)) / 2) / flight, (bz - az) / flight];
}

/** Where a glob launched from a with velocity v is after n ticks. */
export function arcPoint(ax: number, ay: number, az: number, v: readonly [number, number, number], n: number): [number, number, number] {
  return [ax + v[0] * n, ay + v[1] * n - (CHORUS_GLOB_GRAVITY * n * (n - 1)) / 2, az + v[2] * n];
}
