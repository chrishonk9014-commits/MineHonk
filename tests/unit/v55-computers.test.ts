/**
 * V5.5: computers. Building one, starting it, HonkOS, drives and files,
 * flash drives carrying data between computers, networks, blueprints that
 * still cost blocks, signals, and everything kept across a restart.
 */
import { describe, it, expect } from 'vitest';
import { makeServer, join, tick } from '../helpers/testServer';
import { S, stateOf, getProp, blocks, STATE_BLOCK } from '../../src/common/registry/blocks';
import { stackOf, type ItemStack } from '../../src/common/game/itemstack';
import { MemoryStorage } from '../../src/server/storage/Storage';
import { GameServer } from '../../src/server/GameServer';
import { installGameplay } from '../../src/server/gameplay';
import { POST_TICKS } from '../../src/server/engineering/computer/Computers';
import type { ServerPlayer } from '../../src/server/player/ServerPlayer';
import type { EngNode } from '../../src/server/engineering/Engineering';
import type { PcView } from '../../src/common/digital/view';

const CORE = ['power_supply', 'motherboard', 'cpu', 'ram_module'];

function id(state: number): string {
  return blocks[STATE_BLOCK[state]!]!.id;
}

/** Clears a flat pad in front of the player and returns its corner. */
function pad(player: ServerPlayer, w = 12): { x: number; y: number; z: number } {
  const dim = player.dim;
  const x = Math.floor(player.x) + 2;
  const y = Math.floor(player.y);
  const z = Math.floor(player.z) - 2;
  for (let dx = -1; dx <= w; dx++)
    for (let dz = -1; dz <= w; dz++) {
      dim.setBlock(x + dx, y - 1, z + dz, S('stone'));
      for (let dy = 0; dy < 6; dy++) dim.setBlock(x + dx, y + dy, z + dz, 0);
    }
  return { x, y, z };
}

/** Places a computer as a player would (they own it: its advancements are theirs). */
function placeComputer(server: GameServer, p: ServerPlayer, x: number, y: number, z: number, parts: string[] = CORE): EngNode {
  const dim = p.dim;
  dim.setBlock(x, y, z, stateOf('computer', { facing: 'south' }));
  const eng = server.engineering!;
  eng.onPlaced(p, dim, x, y, z, stackOf('computer', 1));
  const n = eng.node(dim, x, y, z)!;
  const ct = server.interaction.containers;
  const inv = ct.containerAt(dim, x, y, z, 12, 'eng');
  parts.forEach((pid, i) => pid && inv.set(i, stackOf(pid, 1)));
  ct.persist(dim, x, y, z, inv);
  eng.computers.invalidate(n);
  return n;
}

function setSlot(server: GameServer, n: EngNode, slot: number, st: ItemStack | null): void {
  const ct = server.interaction.containers;
  const inv = ct.containerAt(n.dim, n.x, n.y, n.z, 12, 'eng');
  inv.set(slot, st);
  ct.persist(n.dim, n.x, n.y, n.z, inv);
  server.engineering!.computers.invalidate(n);
}

function slot(server: GameServer, n: EngNode, i: number): ItemStack | null {
  return server.interaction.containers.containerAt(n.dim, n.x, n.y, n.z, 12, 'eng').get(i);
}

function power(n: EngNode): void {
  const be = n.be();
  if (be) be.energy = 4000;
}

function run(server: GameServer, nodes: EngNode[], t: number): void {
  for (let i = 0; i < t; i++) {
    for (const n of nodes) power(n);
    tick(server, 1);
  }
}

/** Walks up to the computer, opens its window and presses a button on its screen. */
function cmd(server: GameServer, p: ServerPlayer, n: EngNode, c: string, arg?: string | number): void {
  const pcs = server.engineering!.computers;
  if (p.windowId) server.interaction.containers.closeWindow(p, p.windowId);
  server.teleport(p, n.x + 0.5, n.y, n.z + 2.5);
  pcs.openFor(p, n);
  pcs.handleCmd(p, p.windowId, c, arg);
}

function view(server: GameServer, p: ServerPlayer, n: EngNode): PcView {
  return server.engineering!.computers.view(n, p);
}

describe('a computer', () => {
  it('starts only with its core parts and power, and runs HonkOS from a hard drive', async () => {
    const { server } = await makeServer({ seed: 'pc-boot' });
    const { player } = await join(server);
    const o = pad(player);
    const pcs = server.engineering!.computers;
    const n = placeComputer(server, player, o.x, o.y, o.z, []);
    expect(pcs.state(n)).toBe('off');
    cmd(server, player, n, 'power');
    run(server, [], 8);
    expect(pcs.state(n)).toBe('missing');
    expect(view(server, player, n).message).toContain('POWER SUPPLY');
    for (const [i, pid] of CORE.entries()) setSlot(server, n, i, stackOf(pid, 1));
    run(server, [], 12);
    // Parts, but no power
    expect(pcs.state(n)).toBe('no_power');
    run(server, [n], 8);
    expect(pcs.state(n)).toBe('post');
    expect(getProp(n.dim.getState(n.x, n.y, n.z), 'screen')).toBe('boot');
    run(server, [n], POST_TICKS + 8);
    // No hard drive: the BIOS
    expect(pcs.state(n)).toBe('bios');
    expect(player.achievements.has('boot_computer')).toBe(true);
    expect(getProp(n.dim.getState(n.x, n.y, n.z), 'screen')).toBe('on');
    // It needs a keyboard to be used
    expect(view(server, player, n).message).toContain('KEYBOARD');
    n.dim.setBlock(n.x + 1, n.y, n.z, stateOf('keyboard', { facing: 'south' }));
    run(server, [n], 12);
    expect(view(server, player, n).periph.keyboard).toBe(true);
    expect(view(server, player, n).apps.map((a) => a.id)).toEqual(expect.arrayContaining(['diagnostics', 'disk_utility']));
    // HonkOS onto a hard drive
    setSlot(server, n, 7, stackOf('hard_drive', 1));
    run(server, [n], 12);
    cmd(server, player, n, 'install', 'hdd0');
    run(server, [n], 4);
    expect(pcs.state(n)).toBe('desktop');
    expect(player.achievements.has('install_os')).toBe(true);
    const apps = view(server, player, n).apps;
    expect(apps.map((a) => a.id)).toEqual(expect.arrayContaining(['files', 'factory', 'power', 'storage', 'machines', 'fluids', 'config', 'automation', 'control', 'logs', 'scanner']));
    // Graphics programs need a graphics card (and a mouse)
    expect(apps.find((a) => a.id === 'map')?.ok).toBe(false);
    // Switched off, it goes dark
    cmd(server, player, n, 'power');
    run(server, [n], 8);
    expect(pcs.state(n)).toBe('off');
    expect(getProp(n.dim.getState(n.x, n.y, n.z), 'screen')).toBe('off');
  }, 60000);

  it('lights the LEDs beside it while running and sends its signal out', async () => {
    const { server } = await makeServer({ seed: 'pc-signal' });
    const { player } = await join(server);
    const o = pad(player);
    const n = placeComputer(server, player, o.x, o.y, o.z);
    n.dim.setBlock(o.x - 1, o.y, o.z, stateOf('led_light', { facing: 'south' }));
    n.dim.setBlock(o.x, o.y, o.z + 1, S('redstone_lamp'));
    n.dim.setBlock(o.x + 1, o.y, o.z, stateOf('keyboard', { facing: 'south' }));
    cmd(server, player, n, 'power');
    run(server, [n], POST_TICKS + 20);
    expect(getProp(n.dim.getState(o.x - 1, o.y, o.z), 'lit')).toBe('true');
    expect(getProp(n.dim.getState(o.x, o.y, o.z + 1), 'lit')).toBe('false');
    setSlot(server, n, 7, stackOf('hard_drive', 1));
    run(server, [n], 12);
    cmd(server, player, n, 'install', 'hdd0');
    cmd(server, player, n, 'app', 'control');
    cmd(server, player, n, 'out');
    run(server, [n], 6);
    expect(getProp(n.dim.getState(o.x, o.y, o.z + 1), 'lit')).toBe('true');
    // Off: the LED goes out with it
    cmd(server, player, n, 'power');
    run(server, [n], 10);
    expect(getProp(n.dim.getState(o.x - 1, o.y, o.z), 'lit')).toBe('false');
    expect(getProp(n.dim.getState(o.x, o.y, o.z + 1), 'lit')).toBe('false');
  }, 60000);
});

describe('drives', () => {
  it('flash drives carry files from one computer to another; nothing physical is copied', async () => {
    const { server } = await makeServer({ seed: 'pc-flash' });
    const { player } = await join(server);
    const o = pad(player);
    const pcs = server.engineering!.computers;
    const a = placeComputer(server, player, o.x, o.y, o.z);
    const b = placeComputer(server, player, o.x + 6, o.y, o.z);
    for (const n of [a, b]) {
      n.dim.setBlock(n.x + 1, n.y, n.z, stateOf('keyboard', { facing: 'south' }));
      setSlot(server, n, 7, stackOf('hard_drive', 1));
    }
    // Something to capture around A
    for (let dx = -1; dx <= 1; dx++) a.dim.setBlock(a.x + dx, a.y + 2, a.z, S('oak_planks'));
    for (const n of [a, b]) {
      cmd(server, player, n, 'power');
    }
    run(server, [a, b], POST_TICKS + 20);
    for (const n of [a, b]) {
      cmd(server, player, n, 'install', 'hdd0');
    }
    cmd(server, player, a, 'app', 'blueprint');
    cmd(server, player, a, 'capture');
    const hddA = pcs.drives(a).find((d) => d.key === 'hdd0')!;
    const bp = hddA.disk.files.find((f) => f.kind === 'blueprint')!;
    expect(bp).toBeTruthy();
    // Onto a flash drive
    setSlot(server, a, 11, stackOf('flash_drive', 1));
    run(server, [a, b], 12);
    cmd(server, player, a, 'sel', `hdd0/${bp.name}`);
    cmd(server, player, a, 'copy', 'usb');
    const flash = slot(server, a, 11)!;
    const tag = flash.tag?.data as { disk: string; used: number };
    expect(tag.used).toBeGreaterThan(0);
    expect(server.level.digital.disks[tag.disk]!.files.map((f) => f.name)).toContain(bp.name);
    // Out of A, into B: the files come with it
    setSlot(server, a, 11, null);
    setSlot(server, b, 11, flash);
    run(server, [a, b], 12);
    const usb = pcs.drives(b).find((d) => d.key === 'usb')!;
    expect(usb.disk.files.map((f) => f.name)).toContain(bp.name);
    // Building from it costs the blocks: with none carried, nothing appears
    for (let dx = -1; dx <= 1; dx++) a.dim.setBlock(a.x + dx, a.y + 2, a.z, 0);
    for (let i = 0; i < 41; i++) player.inventory.set(i, null);
    cmd(server, player, a, 'build', `hdd0/${bp.name}`);
    expect(id(a.dim.getState(a.x, a.y + 2, a.z))).toBe('air');
    player.inventory.set(5, stackOf('oak_planks', 2));
    cmd(server, player, a, 'build', `hdd0/${bp.name}`);
    const built = [-1, 0, 1].filter((dx) => id(a.dim.getState(a.x + dx, a.y + 2, a.z)) === 'oak_planks').length;
    expect(built).toBe(2);
    expect(player.inventory.get(5)).toBeNull();
    // Corrupted drives keep what they have: it can't be copied off or wiped
    const hb = server.herobrine!;
    const cd = hb.makeCorruptedDrive();
    setSlot(server, b, 11, cd);
    run(server, [a, b], 12);
    cmd(server, player, b, 'sel', 'usb/dragon.log');
    cmd(server, player, b, 'copy', 'hdd0');
    expect(pcs.drives(b).find((d) => d.key === 'hdd0')!.disk.files.some((f) => f.name === 'dragon.log')).toBe(false);
    cmd(server, player, b, 'wipe', 'usb');
    expect(pcs.drives(b).find((d) => d.key === 'usb')!.disk.files.length).toBeGreaterThan(0);
  }, 60000);

  it('networks: computers with network cards and server racks share files over network cable', async () => {
    const { server } = await makeServer({ seed: 'pc-network' });
    const { player } = await join(server);
    const o = pad(player, 14);
    const pcs = server.engineering!.computers;
    const a = placeComputer(server, player, o.x, o.y, o.z, [...CORE, '', '', '', 'hard_drive', '', '', 'network_card']);
    const b = placeComputer(server, player, o.x + 8, o.y, o.z, [...CORE, '', '', '', 'hard_drive', '', '', 'network_card']);
    for (let x = o.x + 1; x < o.x + 8; x++) a.dim.setBlock(x, o.y, o.z, S('network_cable'));
    // A server rack on the same cable
    a.dim.setBlock(o.x + 4, o.y, o.z + 1, stateOf('server_rack', { facing: 'north' }));
    const rack = server.engineering!.node(a.dim, o.x + 4, o.y, o.z + 1)!;
    const rinv = server.interaction.containers.containerAt(a.dim, rack.x, rack.y, rack.z, 4, 'eng');
    rinv.set(0, stackOf('hard_drive', 1));
    server.interaction.containers.persist(a.dim, rack.x, rack.y, rack.z, rinv);
    for (const n of [a, b]) {
      n.dim.setBlock(n.x, n.y, n.z - 1, stateOf('keyboard', { facing: 'south' }));
      cmd(server, player, n, 'power');
    }
    run(server, [a, b, rack], POST_TICKS + 20);
    for (const n of [a, b]) {
      cmd(server, player, n, 'install', 'hdd0');
    }
    const net = pcs.network(a);
    expect(net.map((r) => r.name).sort()).toEqual(['Computer 1', 'Server Rack 1']);
    // A's honkos files: send one to B
    cmd(server, player, a, 'app', 'network');
    cmd(server, player, a, 'sel', 'hdd0/logs.prg');
    cmd(server, player, a, 'remote', `${b.x},${b.y},${b.z}`);
    const before = pcs.drives(b).find((d) => d.key === 'hdd0')!.disk.files.length;
    const hdA = pcs.drives(a).find((d) => d.key === 'hdd0')!.disk;
    const prog = hdA.files.find((f) => f.kind === 'program')!;
    cmd(server, player, a, 'sel', `hdd0/${prog.name}`);
    // B already has its own copy (same name): send a file it doesn't have
    hdA.files.push({ name: 'notes.txt', kind: 'log', size: 2, data: { lines: ['hello'] } });
    cmd(server, player, a, 'sel', 'hdd0/notes.txt');
    cmd(server, player, a, 'send', 'hdd0');
    expect(pcs.drives(b).find((d) => d.key === 'hdd0')!.disk.files.length).toBe(before + 1);
    expect(player.achievements.has('network_transfer')).toBe(true);
    // And to the rack
    cmd(server, player, a, 'remote', `${rack.x},${rack.y},${rack.z}`);
    cmd(server, player, a, 'send', 'rack0');
    expect(pcs.rackDrives(rack)[0]!.disk.files.map((f) => f.name)).toContain('notes.txt');
  }, 60000);
});

describe('saving', () => {
  it('keeps drives, files and the computer itself across a restart', async () => {
    const storage = new MemoryStorage();
    const { server } = await makeServer({ seed: 'pc-save' }, storage);
    const { player } = await join(server);
    const o = pad(player);
    const n = placeComputer(server, player, o.x, o.y, o.z);
    n.dim.setBlock(o.x + 1, o.y, o.z, stateOf('keyboard', { facing: 'south' }));
    setSlot(server, n, 7, stackOf('hard_drive', 1));
    cmd(server, player, n, 'power');
    run(server, [n], POST_TICKS + 20);
    cmd(server, player, n, 'install', 'hdd0');
    const pcs = server.engineering!.computers;
    const diskId = (slot(server, n, 7)!.tag?.data as { disk: string }).disk;
    expect(pcs.state(n)).toBe('desktop');
    await server.stop();
    const s2 = await GameServer.open(storage, null, { log: () => {}, genBudgetMs: 1000, chunksPerTick: 400 });
    installGameplay(s2);
    s2.level.rules.doMobSpawning = false;
    const { player: p2 } = await join(s2);
    const n2 = s2.engineering!.node(p2.dim, o.x, o.y, o.z)!;
    expect(n2).toBeTruthy();
    expect(s2.level.digital.disks[diskId]!.files.some((f) => f.name === 'honkos.sys')).toBe(true);
    run(s2, [n2], POST_TICKS + 20);
    expect(s2.engineering!.computers.state(n2)).toBe('desktop');
  }, 60000);
});
