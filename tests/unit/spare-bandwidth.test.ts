/**
 * Browser hosting spares the host's upload: loot drifting about (items, XP
 * orbs) goes to players on the network twice a second instead of every tick,
 * and always ends on where it came to rest. Off by default: single player and
 * the dedicated server send everything as before.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { ItemEntity } from '../../src/server/entity/ItemEntity';
import { itemById } from '../../src/common/registry/items';

async function drift(spare: boolean) {
  const { server } = await makeServer({ mode: 'creative' });
  (server.opts as { spareBandwidth: boolean }).spareBandwidth = spare;
  const { conn, player } = await join(server, 'Watcher');
  tick(server, 5);
  const item = new ItemEntity({ id: itemById.get('dirt')!.num, count: 1 });
  // Moved only by the test (no physics, no pickup, no despawn)
  item.tick = () => {};
  item.setPos(player.x + 6, player.y + 1, player.z);
  player.dim.addEntity(item);
  tick(server, 2);
  const sent = (): number[][] =>
    conn.of('moves').flatMap((m) => {
      const out: number[][] = [];
      for (let i = 0; i < m.list.length; i += 7) if (m.list[i] === item.id) out.push(m.list.slice(i + 1, i + 4));
      return out;
    });
  conn.received.length = 0;
  // Drifts for 40 ticks...
  for (let i = 0; i < 40; i++) {
    item.setPos(item.x + 0.01, item.y, item.z);
    tick(server, 1);
  }
  const whileMoving = sent().length;
  // ...then comes to rest
  item.setPos(item.x + 0.37, item.y, item.z);
  const rest = [item.x, item.y, item.z];
  tick(server, 12);
  const last = sent().pop()!;
  return { whileMoving, last, rest };
}

describe('sparing bandwidth when hosting', () => {
  it('sends drifting loot a few times a second, and where it stopped', async () => {
    const r = await drift(true);
    expect(r.whileMoving).toBeGreaterThanOrEqual(3);
    expect(r.whileMoving).toBeLessThanOrEqual(5);
    expect(r.last[0]).toBeCloseTo(r.rest[0]!, 2);
  });

  it('changes nothing when off', async () => {
    const r = await drift(false);
    expect(r.whileMoving).toBeGreaterThanOrEqual(38);
    expect(r.last[0]).toBeCloseTo(r.rest[0]!, 2);
  });
});
