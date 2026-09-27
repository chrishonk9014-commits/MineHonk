import { describe, it, expect } from 'vitest';
import { normalizeJoinCode, joinCodeFromBytes, validateUsername, validatePassword } from '../../src/common/net/multiplayer';
import { ChatFilter } from '../../src/server/moderation/ChatFilter';
import { makeServer, join, tick } from '../helpers/testServer';
import { S, stateOf } from '../../src/common/registry/blocks';
import { stackOf } from '../../src/common/game/itemstack';
import { breakTicks } from '../../src/common/game/mining';

describe('multiplayer rules', () => {
  it('normalises and generates join codes', () => {
    expect(normalizeJoinCode('abc7 92kd')).toBe('ABC7-92KD');
    expect(normalizeJoinCode('ABC7-92KD')).toBe('ABC7-92KD');
    expect(normalizeJoinCode('ABC0-92KD')).toBeNull(); // 0 is ambiguous and excluded
    expect(normalizeJoinCode('ABC7-92K')).toBeNull();
    const code = joinCodeFromBytes(new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]));
    expect(normalizeJoinCode(code)).toBe(code);
  });

  it('validates account names and passwords', () => {
    expect(validateUsername('Steve_42')).toBeNull();
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('bad name')).not.toBeNull();
    expect(validateUsername('Admin')).not.toBeNull();
    expect(validatePassword('short')).not.toBeNull();
    expect(validatePassword('long enough pw')).toBeNull();
  });
});

describe('chat filter', () => {
  it('masks profanity including obfuscated spellings', () => {
    const f = new ChatFilter();
    for (const bad of ['what the fuck', 'sh1t happens', 'fuuuuck', 'f u c k this', 'you b!tch']) {
      const r = f.check(bad, 'p' + bad);
      expect(r.text).not.toBeNull();
      expect(r.text).toContain('***');
    }
    for (const ok of ['hello there', 'I love Dickens novels', 'a classic build', 'shiitake mushrooms']) {
      expect(new ChatFilter().check(ok, 'x').text).toBe(ok);
    }
  });

  it('blocks links, hides personal details, throttles repeats and shouting', () => {
    const f = new ChatFilter();
    expect(f.check('join my server at www.example.com', 'a').text).toBeNull();
    expect(f.check('visit https://evil.test/x', 'b').text).toBeNull();
    const pii = f.check('mail me at kid@example.org or 555 123 4567', 'c');
    expect(pii.text).toContain('[email hidden]');
    expect(pii.text).toContain('[number hidden]');
    expect(pii.text).not.toContain('555');
    expect(f.check('buy diamonds', 'd').text).not.toBeNull();
    expect(f.check('buy diamonds', 'd').text).not.toBeNull();
    expect(f.check('buy diamonds', 'd').text).toBeNull();
    expect(f.check('WHY IS EVERYONE SHOUTING AT ME', 'e').text).toBe('why is everyone shouting at me');
    const custom = new ChatFilter(['grief']);
    expect(custom.check('stop the griefing', 'f').text).toContain('***');
  });
});

describe('world roles', () => {
  it('stops visitors from building, opening storage or hurting animals', async () => {
    const { server } = await makeServer({ mode: 'survival', owner: 'owner-uuid' });
    server.level.defaultRole = 'visitor';
    server.level.joinCode = 'ABCD-EFGH';
    const { conn, player } = await join(server, 'Guest');
    expect(server.roleOf(player)).toBe('visitor');
    expect(conn.last('welcome')?.world.joinCode).toBeUndefined();
    const dim = player.dim;
    const x = Math.floor(player.x);
    const y = Math.floor(player.y) - 1;
    const z = Math.floor(player.z);
    player.body.onGround = true;
    dim.setBlock(x, y, z, S('dirt'));
    const need = breakTicks(S('dirt'), { tool: null, onGround: true, underwater: false, aquaAffinity: false, haste: 0, fatigue: 0, creative: false });
    server.handle(conn, { t: 'dig', action: 'start', x, y, z, face: 1 });
    tick(server, need + 1);
    server.handle(conn, { t: 'dig', action: 'finish', x, y, z, face: 1 });
    expect(dim.getState(x, y, z)).toBe(S('dirt'));
    // No placing
    dim.setBlock(x - 1, y, z, S('dirt'));
    dim.setBlock(x - 1, y + 1, z, 0);
    dim.setBlock(x - 1, y + 2, z, 0);
    player.inventory.set(player.selectedSlot, stackOf('cobblestone', 4));
    server.handle(conn, { t: 'use_on', x: x - 1, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.4, seq: 2 });
    expect(dim.getState(x - 1, y + 1, z)).toBe(0);
    // No chests
    dim.setBlock(x + 1, y + 1, z, stateOf('chest', { facing: 'north' }));
    const opened = conn.of('open_window').length;
    server.handle(conn, { t: 'use_on', x: x + 1, y: y + 1, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.2, seq: 3 });
    expect(conn.of('open_window').length).toBe(opened);
    // No hurting animals
    const cow = server.mobs!.spawn(dim, 'cow', x + 1.5, y + 1, z + 0.5)!;
    const hp = cow.health;
    server.mobs!.playerAttack(player, cow);
    expect(cow.health).toBe(hp);
    // Promoted to builder: can build
    server.level.roles[player.uuid] = 'builder';
    player.interactBudget = 0;
    server.handle(conn, { t: 'use_on', x: x - 1, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 0, yaw: 0, pitch: 1.4, seq: 4 });
    expect(dim.getState(x - 1, y + 1, z)).toBe(S('cobblestone'));
  });

  it('lets operators mute and players report', async () => {
    const { server } = await makeServer({ mode: 'survival', owner: 'uuid-Owner' });
    const { conn: oc, player: owner } = await join(server, 'Owner');
    const { conn: gc, player: guest } = await join(server, 'Guest');
    expect(server.roleOf(owner)).toBe('owner');
    server.handle(oc, { t: 'chat', text: '/mute Guest 5' });
    expect(server.isMuted(guest)).toBe(true);
    const before = oc.of('chat').filter((m) => m.from === 'Guest').length;
    server.handle(gc, { t: 'chat', text: 'hello?' });
    expect(oc.of('chat').filter((m) => m.from === 'Guest').length).toBe(before);
    expect(gc.last('chat')?.text).toContain('muted');
    server.handle(oc, { t: 'chat', text: '/unmute Guest' });
    expect(server.isMuted(guest)).toBe(false);
    // Guests cannot mute
    await new Promise((r) => setTimeout(r, 0));
    guest.chatBudget = 0;
    server.handle(gc, { t: 'chat', text: '/mute Owner' });
    expect(server.isMuted(owner)).toBe(false);
    guest.chatBudget = 0;
    server.handle(gc, { t: 'chat', text: '/report Owner was rude to me' });
    expect(server.level.reports.length).toBe(1);
    expect(oc.of('chat').some((m) => m.text.includes('reported'))).toBe(true);
  });
});
