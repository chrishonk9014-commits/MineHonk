/**
 * The cloud hub, running locally under Wrangler (workerd with local D1 and
 * Durable Objects): accounts with device-stretched passwords, friends and
 * presence, hosting, join codes, signed join tickets, signaling, invites,
 * settings pushed to hosts, and the relay.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startLocalHub, type LocalHub } from '../helpers/wranglerHub';
import { HubClient, ORIGIN } from '../helpers/hubClient';
import { verifyTicket, importVerifyKey } from '../../src/hub/tickets';
import { fromB64url, toB64url } from '../../src/hub/crypto';
import { decodeRelay, encodeRelay, RELAY_CLOSE, RELAY_DATA, RELAY_OPEN } from '../../src/common/net/hubProtocol';

let hub: LocalHub;
const COMPAT = 'test-compat';

beforeAll(async () => {
  hub = await startLocalHub();
}, 120_000);

afterAll(async () => {
  await hub?.stop();
});

const hostedWorld = (id: string, over: Record<string, unknown> = {}) => ({ id, name: 'Castle', visibility: 'friends', mode: 'survival', cheats: true, players: 1, maxPlayers: 4, version: '6.0.0', compat: COMPAT, ...over });

describe('cloud hub (local Wrangler)', () => {
  it('answers as a cloud hub, only to allowed sites, and never accepts a raw password', async () => {
    const h = await fetch(`${hub.base}/api/health`, { headers: { Origin: ORIGIN } });
    expect(h.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(await h.json()).toMatchObject({ ok: true, name: 'MineHonk', kind: 'cloud', auth: 'stretched-v1' });
    const evil = await fetch(`${hub.base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const raw = await new HubClient(hub.base, 'Rawpw').call('POST', '/register', { name: 'Rawpw', password: 'correct horse battery' });
    expect(raw.status).toBe(400);
    expect(String(raw.data.error)).toMatch(/refresh/);
    const a = await new HubClient(hub.base, 'Alice').signUp();
    expect((await a.call('GET', '/me')).data).toMatchObject({ name: 'Alice' });
    expect((await a.call('GET', '/me', undefined, 'bogus')).status).toBe(401);
    // A lobby socket from another site is refused
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${hub.base.replace('http', 'ws')}/api/lobby`, ['minehonk', `auth.${a.token}`], { headers: { Origin: 'https://evil.example' } });
        ws.on('open', resolve);
        ws.on('unexpected-response', (_q, r) => reject(new Error(String(r.statusCode))));
        ws.on('error', reject);
      }),
    ).rejects.toThrow(/403/);
  });

  it('hosts a world, shows it to friends, and signs tickets only for who may join', async () => {
    const host = await new HubClient(hub.base, 'Hosty').signUp();
    const friend = await new HubClient(hub.base, 'Frieda').signUp();
    const stranger = await new HubClient(hub.base, 'Strange').signUp();
    await host.call('POST', '/friends/request', { name: 'Frieda' });
    await friend.call('POST', '/friends/accept', { uuid: host.uuid });

    // Register the world (the host is authoritative for its settings)
    const reg = await host.call<{ id: string; joinCode: string; cheats: boolean; online: boolean }>('POST', '/host', { name: 'Castle', visibility: 'friends', mode: 'survival', cheats: true, maxPlayers: 4 });
    expect(reg.status).toBe(200);
    expect(reg.data.joinCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const id = reg.data.id;
    // Not online until the host's lobby socket says so
    expect((await friend.call<{ friends: { world?: string }[] }>('GET', '/friends')).data.friends[0]!.world).toBeUndefined();
    const hl = await host.lobby();
    await hl.next((m) => m.t === 'welcome');
    // Someone else cannot put the world online
    const sl = await stranger.lobby();
    sl.ws.send(JSON.stringify({ t: 'host', world: hostedWorld(id) }));
    expect((await sl.next((m) => m.t === 'error')).message).toMatch(/your own worlds/);
    hl.ws.send(JSON.stringify({ t: 'host', world: hostedWorld(id) }));
    await hl.next((m) => m.t === 'hosting' && m.online);

    const fr = (await friend.call<{ friends: { name: string; online: boolean; world?: string; worldId?: string; cheats?: boolean }[] }>('GET', '/friends')).data.friends;
    expect(fr).toEqual([expect.objectContaining({ name: 'Hosty', online: true, world: 'Castle', worldId: id, cheats: true })]);
    const fw = (await friend.call<{ friends: { id: string; online: boolean; players: number }[] }>('GET', '/worlds')).data.friends;
    expect(fw).toEqual([expect.objectContaining({ id, online: true, players: 1 })]);
    expect((await stranger.call<{ public: unknown[] }>('GET', '/worlds')).data.public).toEqual([]);

    // Tickets: friends yes (direct connections allowed), strangers no
    const key = await importVerifyKey(((await host.call<{ jwk: JsonWebKey }>('GET', '/hub-key')).data.jwk));
    const t = await friend.call<{ ticket: string; host: string; relayOnly: boolean }>('POST', '/ticket', { world: id, compat: COMPAT });
    expect(t.status).toBe(200);
    expect(t.data.host).toBe(host.uuid);
    expect(t.data.relayOnly).toBe(false);
    const claims = await verifyTicket(t.data.ticket, key);
    expect(claims).toMatchObject({ uuid: friend.uuid, name: 'Frieda', world: id, via: 'friend', relay: false });
    // A forged ticket (a different name) fails the signature check, an expired one too
    const [body, sig] = t.data.ticket.split('.');
    const forged = JSON.parse(new TextDecoder().decode(fromB64url(body!)));
    forged.name = 'Hosty';
    expect(await verifyTicket(`${toB64url(new TextEncoder().encode(JSON.stringify(forged)))}.${sig}`, key)).toBeNull();
    expect(await verifyTicket(t.data.ticket, key, Date.now() + 10 * 60_000)).toBeNull();
    expect((await stranger.call('POST', '/ticket', { world: id, compat: COMPAT })).status).toBe(403);
    expect((await friend.call('POST', '/ticket', { world: id, compat: 'old-version' })).data.error).toBe('Version mismatch — refresh the page');

    // A code joins strangers (and remembers them)
    expect((await stranger.call('POST', '/join', { code: 'ZZZZ-ZZZZ' })).data.error).toBe('Code not found');
    const j = await stranger.call<{ id: string; online: boolean }>('POST', '/join', { code: reg.data.joinCode.toLowerCase() });
    expect(j.data).toMatchObject({ id, online: true });
    const st = await stranger.call<{ ticket: string; relayOnly: boolean }>('POST', '/ticket', { world: id, compat: COMPAT });
    expect((await verifyTicket(st.data.ticket, key))!.via).toBe('member');

    // Public: anyone can join, but only through a relay
    hl.ws.send(JSON.stringify({ t: 'host', world: hostedWorld(id, { visibility: 'public' }) }));
    await host.call('POST', '/host', { id, visibility: 'public' });
    const pub = await new HubClient(hub.base, 'Publius').signUp();
    const pw = (await pub.call<{ public: { id: string; cheats: boolean; version: string }[] }>('GET', '/worlds')).data.public;
    expect(pw).toEqual([expect.objectContaining({ id, cheats: true, version: '6.0.0' })]);
    const pt = await pub.call<{ ticket: string; relayOnly: boolean }>('POST', '/ticket', { world: id, compat: COMPAT });
    expect(pt.data.relayOnly).toBe(true);
    expect((await verifyTicket(pt.data.ticket, key))!.relay).toBe(true);

    // Full, banned, offline
    hl.ws.send(JSON.stringify({ t: 'players', world: id, players: 4 }));
    await new Promise((r) => setTimeout(r, 200));
    expect((await pub.call('POST', '/ticket', { world: id, compat: COMPAT })).data.error).toBe('World is full');
    hl.ws.send(JSON.stringify({ t: 'players', world: id, players: 2 }));
    await host.call('POST', `/worlds/${id}/ban`, { uuid: pub.uuid });
    expect((await pub.call('POST', '/ticket', { world: id, compat: COMPAT })).data.error).toBe("You're banned from this world");
    expect((await pub.call('POST', '/join', { code: reg.data.joinCode })).data.error).toBe("You're banned from this world");
    // The ban reached the host as a settings push
    expect((await hl.next((m) => m.t === 'settings' && m.settings.banned.includes(pub.uuid))).world).toBe(id);
    hl.ws.close();
    await new Promise((r) => setTimeout(r, 300));
    expect((await friend.call('POST', '/ticket', { world: id, compat: COMPAT })).data.error).toBe('The host is offline');
    sl.ws.close();
  });

  it('forwards signaling between joiners and hosts, delivers invites, and relays game traffic', async () => {
    const host = await new HubClient(hub.base, 'Rhost').signUp();
    const joiner = await new HubClient(hub.base, 'Rjoin').signUp();
    const nosy = await new HubClient(hub.base, 'Rnosy').signUp();
    await host.call('POST', '/friends/request', { name: 'Rjoin' });
    await joiner.call('POST', '/friends/accept', { uuid: host.uuid });
    const id = (await host.call<{ id: string }>('POST', '/host', { name: 'Relayed', visibility: 'private' })).data.id;
    const hl = await host.lobby();
    hl.ws.send(JSON.stringify({ t: 'host', world: hostedWorld(id, { visibility: 'private' }) }));
    await hl.next((m) => m.t === 'hosting');
    const jl = await joiner.lobby();
    await jl.next((m) => m.t === 'welcome');

    // Invite: a private world opens to the invited friend
    expect((await joiner.call('POST', '/ticket', { world: id, compat: COMPAT })).status).toBe(403);
    expect((await nosy.call('POST', '/invite', { to: joiner.uuid, world: id })).status).toBe(403);
    expect((await host.call<{ delivered: boolean }>('POST', '/invite', { to: joiner.uuid, world: id })).data.delivered).toBe(true);
    expect(await jl.next((m) => m.t === 'invite')).toMatchObject({ from: host.uuid, fromName: 'Rhost', world: id, worldName: 'Relayed' });
    const t = await joiner.call<{ ticket: string }>('POST', '/ticket', { world: id, compat: COMPAT });
    expect(t.status).toBe(200);

    // Signaling: joiner -> host and back; only to the world's host
    jl.ws.send(JSON.stringify({ t: 'signal', to: host.uuid, world: id, sid: 's1', data: { kind: 'offer', sdp: 'x', ticket: t.data.ticket, relayOnly: false } }));
    expect(await hl.next((m) => m.t === 'signal')).toMatchObject({ from: joiner.uuid, fromName: 'Rjoin', world: id, sid: 's1' });
    hl.ws.send(JSON.stringify({ t: 'signal', to: joiner.uuid, world: id, sid: 's1', data: { kind: 'answer', sdp: 'y' } }));
    expect((await jl.next((m) => m.t === 'signal')).data).toEqual({ kind: 'answer', sdp: 'y' });
    const nl = await nosy.lobby();
    nl.ws.send(JSON.stringify({ t: 'signal', to: joiner.uuid, world: id, sid: 's9', data: {} }));
    expect((await nl.next((m) => m.t === 'error')).message).toMatch(/offline/);

    // The relay: a forged ticket is refused, a real one reaches the host
    const relayPath = `/relay/${id}`;
    const dot = t.data.ticket.indexOf('.');
    const bad = t.data.ticket.slice(0, dot + 10) + (t.data.ticket[dot + 10] === 'A' ? 'B' : 'A') + t.data.ticket.slice(dot + 11);
    await expect(joiner.socket(relayPath, ['minehonk', `ticket.${bad}`])).rejects.toThrow(/403/);
    // No host on the relay yet
    await expect(joiner.socket(relayPath, ['minehonk', `ticket.${t.data.ticket}`])).rejects.toThrow(/409/);
    await expect(nosy.socket(relayPath, ['minehonk', `auth.${nosy.token}`])).rejects.toThrow(/403/);
    const hr = await host.socket(relayPath, ['minehonk', `auth.${host.token}`]);
    const jr = await joiner.socket(relayPath, ['minehonk', `ticket.${t.data.ticket}`]);
    const open = decodeRelay((await hr.next((m) => m instanceof Uint8Array && decodeRelay(m)?.[0]?.type === RELAY_OPEN)) as Uint8Array)![0]!;
    expect(JSON.parse(new TextDecoder().decode(open.data))).toEqual({ uuid: joiner.uuid });
    jr.ws.send(new Uint8Array([1, 2, 3]));
    const got = decodeRelay((await hr.next((m) => m instanceof Uint8Array && decodeRelay(m)?.[0]?.type === RELAY_DATA)) as Uint8Array)![0]!;
    expect([...got.data]).toEqual([1, 2, 3]);
    expect(got.conn).toBe(open.conn);
    hr.ws.send(encodeRelay([{ type: RELAY_DATA, conn: open.conn, data: new Uint8Array([9, 8]) }]));
    expect([...((await jr.next((m) => m instanceof Uint8Array)) as Uint8Array)]).toEqual([9, 8]);
    // The host leaving ends every relayed game
    const closed = new Promise<{ code: number; reason: string }>((r) => jr.ws.on('close', (code, reason) => r({ code, reason: String(reason) })));
    hr.ws.close();
    expect(await closed).toEqual({ code: 4001, reason: 'The host left the game' });
    void RELAY_CLOSE;
    for (const s of [hl, jl, nl]) s.ws.close();
  });
});
