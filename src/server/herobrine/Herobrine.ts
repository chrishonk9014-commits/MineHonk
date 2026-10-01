/**
 * V5.5 - the Digital Corruption Update: the Herobrine story, server side.
 *
 * The canon path, step by step, and where each step lives:
 *
 *   1-7  the Mysterious Potion fed to the Ender Dragon; the dragon coughs up
 *        malware; a flash drive held in it becomes the Corrupted Flash
 *        Drive (Malware.ts);
 *   8    the dragon defeated, the ordinary V3 fight (onDragonDefeated
 *        counts it: the drive only speaks once the dragon has died since
 *        it was made);
 *   9-11 back in the Overworld the drive goes into a working computer (no
 *        hard drive needed): the computer is taken over, its screen and
 *        everything around it break up (the takeover, below);
 *   12   Herobrine comes out of the screen;
 *   13-14 the first fight (Fight.ts); low on health he goes back into the
 *        computer, which becomes a way in;
 *   15   through the screen: the world inside the computer, the seed where
 *        Herobrine was first found (gen/computer.ts);
 *   16-17 exploring it: what people saw in that seed, old terminals, the
 *        cables, the redstone torches, to the cave;
 *   18-19 the final fight, Herobrine plugged into the machines; defeated,
 *        the digital world collapses and everyone is thrown back out;
 *   20   the Herobrine secret ending, kept by the world and the player.
 *
 * The world keeps where its story stands (level.herobrine); Herobrine
 * himself is never saved: a restart mid-fight puts the story back to the
 * last step that doesn't need him (the computer waiting for its drive, or
 * the way in still open). Runs that used cheats anywhere (the Admin Panel,
 * a cheat-made drive or potion, a cheat-spawned dragon) play out the same
 * but award nothing and record the ending only as forced.
 *
 * Separate from the V3 story (potion -> Enderman -> Corrupted Eye ->
 * Farlands -> The Error): only the potion is shared.
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Entity } from '../entity/Entity';
import type { HurtInfo } from '../entity/Living';
import type { Projectile, ProjectileHit } from '../entity/Projectile';
import type { EngNode } from '../engineering/Engineering';
import type { PcData } from '../engineering/computer/Computers';
import type { Window } from '../systems/Containers';
import type { HerobrineWorld } from '../world/LevelData';
import type { PcView, UiBlock } from '../../common/digital/view';
import { Mob, isPlayer } from '../entity/Mob';
import { items } from '../../common/registry/items';
import { blocks, STATE_BLOCK, getProp, S, stateOf } from '../../common/registry/blocks';
import { stackOf, markAdmin, isAdminStack, type ItemStack } from '../../common/game/itemstack';
import { Random, hashInts } from '../../common/math/rng';
import { diskUsed } from '../../common/digital/data';
import { TAKEOVER_LINES, TERMINAL_LOGS, EXIT_TERMINAL_LINES, HEROBRINE_SEED, CORRUPTED_DRIVE_FILES, bearing } from '../../common/digital/story';
import type { ComputerWorldGenerator } from '../../common/gen/computer';
import { Malware } from './Malware';
import { HerobrineFights, DEATH_TICKS, type HbFight } from './Fight';
import { FACE_DX, FACE_DZ } from '../../common/world/constants';

/** Ticks between the takeover's lines on the screen. */
const LINE_TICKS = 14;
/** When (in the takeover) he comes out of the screen. */
const EMERGE_AT = TAKEOVER_LINES.length * LINE_TICKS + 24;
/** How far around the computer people see and hear the takeover. */
const TAKEOVER_RANGE = 28;

interface Takeover {
  n: EngNode;
  t: number;
  cheat: boolean;
  by: ServerPlayer | null;
}

interface Arrival {
  x: number;
  y: number;
  z: number;
  since: number;
  /** Show the Herobrine ending once they're down. */
  ending: boolean;
  cheat: boolean;
}

interface Apparition {
  m: Mob;
  /** The player it shows itself to. */
  p: ServerPlayer;
  since: number;
  /** The first sighting, across the lake. */
  first: boolean;
  /** Ticks the player has been looking straight at it. */
  seen: number;
}

interface Terminal {
  w: Window;
  x: number;
  y: number;
  z: number;
  exit: boolean;
}

export class HerobrineSystem {
  readonly malware: Malware;
  readonly fights: HerobrineFights;
  private takeover: Takeover | null = null;
  private readonly arrivals = new Map<ServerPlayer, Arrival>();
  private readonly apparitions: Apparition[] = [];
  /** Players who have had the first sighting this run, and when each last saw him in the fog. */
  private readonly sighted = new Set<string>();
  private readonly lastGlimpse = new Map<ServerPlayer, number>();
  private readonly terminals = new Map<ServerPlayer, Terminal>();
  /** Players in the computer world with no story to be in it for (ticks). */
  private readonly strays = new Map<ServerPlayer, number>();
  private readonly entering = new Set<ServerPlayer>();
  /** When each player came in through the screen (he lets you look around first). */
  private readonly arrivedAt = new Map<ServerPlayer, number>();
  private readonly rng = new Random();

  constructor(readonly server: GameServer) {
    this.malware = new Malware(this);
    this.fights = new HerobrineFights(this);
    this.recover();
  }

  get w(): HerobrineWorld {
    return this.server.level.herobrine;
  }

  /** An advancement for the story (never in a cheat run; the Admin Panel's context blocks it too). */
  grant(p: ServerPlayer, id: string): void {
    this.server.interaction.grant(p, id);
  }

  private grantRun(p: ServerPlayer, id: string): void {
    if (!this.w.cheat) this.grant(p, id);
  }

  /** A restart with the story half-way: back to the last step that doesn't need Herobrine himself. */
  private recover(): void {
    const w = this.w;
    if (w.stage === 'emerging' || w.stage === 'fight1') {
      w.stage = 'none';
      w.gateway = null;
      w.party = [];
      w.cheat = false;
    } else if (w.stage === 'final') w.stage = 'gateway';
    else if (w.stage === 'ending') this.resetRun(true);
  }

  private computerWorld(): ComputerWorldGenerator {
    return this.server.dim('computer').generator as ComputerWorldGenerator;
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    this.malware.tick();
    if (this.takeover) this.stepTakeover(this.takeover);
    this.fights.tick();
    this.runArrivals();
    this.stepApparitions();
    if (s.tickNo % 20 === 0) for (const p of s.players.values()) this.checkPlayer(p);
    if (s.tickNo % 5 === 0) this.computerWorldTick();
    if (s.tickNo % 20 === 7 && !this.fights.fight) this.adoptStrays();
    // A collapsed computer world still in memory is forgotten once nobody is in it
    if (s.tickNo % 100 === 33) {
      const cw = s.dims.get('computer');
      if (cw && ![...s.players.values()].some((p) => p.dim === cw)) cw.dropStale();
    }
    // The way in shimmers
    if (this.w.stage === 'gateway' && s.tickNo % 8 === 0) {
      const n = this.gatewayNode();
      if (n) {
        const [fx, fz] = this.front(n);
        s.particles(n.dim, 'glitch', n.x + 0.5 + fx * 0.6, n.y + 0.5, n.z + 0.5 + fz * 0.6, 2, 0.3);
      }
    }
  }

  /** Inventory checks: the drives a player carries. */
  private checkPlayer(p: ServerPlayer): void {
    if (p.dead) return;
    let flash = false;
    let corrupted = false;
    for (let i = 0; i < 41; i++) {
      const st = p.inventory.get(i);
      if (!st || isAdminStack(st)) continue;
      const id = items[st.id]?.id;
      if (id === 'flash_drive') flash = true;
      else if (id === 'corrupted_flash_drive' && !(st.tag?.data as { cheat?: boolean } | undefined)?.cheat) corrupted = true;
    }
    if (flash) this.grant(p, 'obtain_flash_drive');
    if (corrupted) this.grant(p, 'obtain_corrupted_drive');
  }

  /** A Herobrine spawned some other way (a spawn egg, the Admin Panel's mob spawner) gets a fight. */
  private adoptStrays(): void {
    for (const dim of this.server.dims.values())
      for (const e of dim.entities.values()) {
        if (!(e instanceof Mob) || e.type !== 'herobrine' || e.dead || e.removed || e.data.apparition) continue;
        this.fights.adopt(e);
        return;
      }
  }

  // ------------------------------------------------------------------ the dragon

  /** Reading the witch's grimoire (the page itself opens on the client). */
  useItem(p: ServerPlayer, stack: ItemStack): boolean {
    if (items[stack.id]?.id !== 'witch_grimoire') return false;
    if (!isAdminStack(stack)) this.grant(p, 'read_grimoire');
    this.server.playSound(p.dim, 'book.page', p.x, p.y + 1, p.z, 0.6, 0.8);
    return true;
  }

  /** The potion on a mob (from the V3 endgame): the dragon is ours. */
  feedDragon(p: ServerPlayer, target: Entity, slot: number, stack: ItemStack): boolean {
    if (!(target instanceof Mob) || target.type !== 'ender_dragon') return false;
    return this.malware.feed(p, target, slot, stack);
  }

  /** The Ender Dragon's ordinary defeat (the V3 fight's finish). */
  onDragonDefeated(admin: boolean): void {
    const w = this.w;
    w.dragonKills++;
    if (!admin) w.legitKills++;
    this.malware.onDragonGone();
  }

  // ------------------------------------------------------------------ the computer

  private gatewayNode(): EngNode | null {
    const g = this.w.gateway;
    if (!g) return null;
    const ow = this.server.dims.get('overworld');
    if (!ow || !ow.isLoaded(g.x, g.z)) return null;
    const n = this.server.engineering?.node(ow, g.x, g.y, g.z);
    return n && n.c.kind === 'computer' ? n : null;
  }

  private isGateway(dim: Dimension, x: number, y: number, z: number): boolean {
    const g = this.w.gateway;
    return !!g && this.w.stage !== 'none' && dim.id === 'overworld' && g.x === x && g.y === y && g.z === z;
  }

  /** The story has this computer (the takeover, the fight around it, the way in). */
  holds(n: EngNode): boolean {
    return this.isGateway(n.dim, n.x, n.y, n.z);
  }

  /** Blocks nobody may break or change right now: the computer at the heart of the story. */
  protects(dim: Dimension, x: number, y: number, z: number): boolean {
    return this.isGateway(dim, x, y, z);
  }

  /** The direction the computer's screen faces. */
  private front(n: EngNode): [number, number] {
    const f = { north: 2, south: 3, west: 4, east: 5 }[getProp(n.dim.getState(n.x, n.y, n.z), 'facing') as 'north'] ?? 2;
    return [FACE_DX[f]!, FACE_DZ[f]!];
  }

  private pcOf(n: EngNode): PcData | null {
    const be = n.be();
    return be ? this.server.engineering!.computers.pcOf(be) : null;
  }

  private near(n: EngNode, r: number): ServerPlayer[] {
    return [...this.server.players.values()].filter((p) => p.dim === n.dim && !p.dead && p.distanceSq(n.x + 0.5, n.y + 0.5, n.z + 0.5) < r * r);
  }

  private logPc(n: EngNode, line: string): void {
    this.server.engineering?.computers.log(n, line);
  }

  /**
   * A drive went into a running computer's USB slot (Computers notices it
   * once per insertion). Only the Corrupted Flash Drive matters here.
   */
  onUsbDrive(n: EngNode, stack: ItemStack, p: ServerPlayer | null): void {
    if (items[stack.id]?.id !== 'corrupted_flash_drive') return;
    const s = this.server;
    const disks = s.engineering!.computers.disks;
    const tag = disks.tag(stack);
    const w = this.w;
    const glitch = (): void => {
      s.particles(n.dim, 'glitch', n.x + 0.5, n.y + 0.8, n.z + 0.5, 10, 0.4);
      s.playSound(n.dim, 'computer.glitch', n.x + 0.5, n.y + 0.5, n.z + 0.5, 0.8, 0.6);
    };
    if (tag.spent) {
      this.logPc(n, 'HER0BRINE.EXE: file not found');
      return;
    }
    if (n.dim.id !== 'overworld') {
      this.logPc(n, 'HER0BRINE.EXE: no world data');
      glitch();
      return;
    }
    if (w.stage !== 'none') {
      this.logPc(n, 'HER0BRINE.EXE: already running');
      glitch();
      return;
    }
    const admin = isAdminStack(stack);
    const active = typeof tag.born === 'number' ? tag.born < w.dragonKills : admin;
    if (!active) {
      // Made, but the dragon it came from still lives
      this.logPc(n, 'HER0BRINE.EXE: dormant');
      glitch();
      return;
    }
    // Whoever plugged it in (or, failing that, whoever stands at the keyboard)
    const by = p ?? this.near(n, 6).sort((a, b) => a.distanceSq(n.x, n.y, n.z) - b.distanceSq(n.x, n.y, n.z))[0] ?? null;
    const cheat = admin || tag.cheat === true || typeof tag.bornLegit !== 'number' || w.legitKills <= tag.bornLegit || (!!by && s.admin.inContext(by));
    this.startTakeover(n, by, cheat);
  }

  /** The computer is his: lines on the screen, the room breaking up, then him. */
  startTakeover(n: EngNode, by: ServerPlayer | null, cheat: boolean): void {
    const w = this.w;
    const pc = this.pcOf(n);
    if (!pc) return;
    w.stage = 'emerging';
    w.gateway = { x: n.x, y: n.y, z: n.z };
    w.cheat = cheat;
    w.party = by ? [by.uuid] : [];
    pc.story = 'takeover';
    pc.storyLines = [];
    pc.app = '';
    n.dirty = true;
    this.sighted.clear();
    this.takeover = { n, t: 0, cheat, by };
    this.logPc(n, 'USB: autorun HER0BRINE.EXE');
    this.server.power?.touch(n.dim, n.x, n.y, n.z);
  }

  private stepTakeover(tk: Takeover): void {
    const s = this.server;
    const n = tk.n;
    if (n.removed || !this.holds(n)) {
      this.takeover = null;
      return;
    }
    tk.t++;
    const pc = this.pcOf(n);
    if (!pc) return;
    const watchers = this.near(n, TAKEOVER_RANGE);
    const cx = n.x + 0.5;
    const cy = n.y + 0.5;
    const cz = n.z + 0.5;
    if (tk.t === 20 && tk.by && !tk.cheat) this.grant(tk.by, 'insert_corrupted_drive');
    if (tk.t % LINE_TICKS === 0) {
      const i = tk.t / LINE_TICKS - 1;
      const line = TAKEOVER_LINES[i];
      if (line) {
        pc.storyLines = [...(pc.storyLines ?? []), line];
        n.dirty = true;
        s.playSound(n.dim, 'computer.glitch', cx, cy, cz, 1.2, 0.6 + i * 0.06);
        for (const p of watchers) p.send({ t: 'fx', kind: 'takeover', text: line, ticks: LINE_TICKS + 6, strength: Math.min(1, (i + 1) / TAKEOVER_LINES.length) });
      }
    }
    // The room flickers more and more
    if (tk.t % 6 === 0) {
      s.particles(n.dim, 'glitch', cx, cy + 0.4, cz, 6 + (tk.t >> 4), 0.6);
      for (const p of watchers) p.send({ t: 'fx', kind: 'glitch', strength: Math.min(0.55, 0.05 + tk.t / 400), ticks: 6 });
    }
    if (tk.t % 30 === 0) s.playSound(n.dim, 'glitch.static', cx, cy, cz, 1.5, 0.5 + tk.t / 400);
    if (tk.t === EMERGE_AT - 30) {
      for (const p of watchers) p.send({ t: 'fx', kind: 'presence', ticks: 90 });
      s.playSound(n.dim, 'herobrine.presence', cx, cy, cz, 3, 0.8);
    }
    if (tk.t === EMERGE_AT) {
      this.takeover = null;
      const [fx, fz] = this.front(n);
      const home = { x: cx + fx * 0.55, y: n.y, z: cz + fz * 0.55 };
      const out = { x: cx + fx * 2.2, y: n.y, z: cz + fz * 2.2 };
      const yaw = Math.atan2(-fx, -fz);
      this.fights.startFirst(n.dim, home, out, yaw, tk.cheat);
      for (const p of this.near(n, 40)) {
        this.addParty(p);
        if (!tk.cheat) this.grant(p, 'witness_herobrine');
      }
    }
  }

  /** The Admin Panel: straight to him coming out of the screen. */
  skipTakeover(): void {
    const tk = this.takeover;
    if (!tk) return;
    const pc = this.pcOf(tk.n);
    if (pc) pc.storyLines = [...TAKEOVER_LINES];
    tk.t = EMERGE_AT - 1;
  }

  /** Someone the Admin Panel sent into the computer world. */
  addVisitor(p: ServerPlayer): void {
    this.addParty(p);
  }

  private addParty(p: ServerPlayer): void {
    const w = this.w;
    if (!w.party.includes(p.uuid)) w.party.push(p.uuid);
    if (w.party.length > 64) w.party.shift();
  }

  /** Engineering lost a computer block: if it was his, the story can't go on from it. */
  onComputerGone(n: EngNode): void {
    if (!this.isGateway(n.dim, n.x, n.y, n.z)) return;
    const w = this.w;
    if (this.takeover?.n === n) this.takeover = null;
    const f = this.fights.fight;
    if (f && f.kind === 'first') this.fights.reset(f);
    if (w.stage === 'final' || w.stage === 'ending') return;
    w.stage = 'none';
    w.gateway = null;
    w.party = [];
    w.cheat = false;
  }

  // ------------------------------------------------------------------ the first fight

  onFirstBegins(f: HbFight): void {
    this.w.stage = 'fight1';
    void f;
  }

  /** Low on health he went back into the computer: it is a way in now. */
  onFirstRetreat(f: HbFight): void {
    const s = this.server;
    const w = this.w;
    w.stage = 'gateway';
    const n = this.gatewayNode();
    if (n) {
      const pc = this.pcOf(n);
      if (pc) {
        pc.story = 'gateway';
        pc.storyLines = [];
        n.dirty = true;
      }
      this.spendDrive(n);
      this.logPc(n, 'HER0BRINE.EXE: process moved');
      s.playSound(n.dim, 'herobrine.retreat', n.x + 0.5, n.y + 0.5, n.z + 0.5, 3, 0.7);
      for (const p of this.near(n, 40)) p.send({ t: 'fx', kind: 'glitch', strength: 0.5, ticks: 20 });
    }
    for (const uuid of f.party) {
      const p = this.online(uuid);
      if (!p) continue;
      this.addParty(p);
      if (!f.cheat && !w.cheat) this.grant(p, 'defeat_first_herobrine');
    }
  }

  /** The drive in the USB slot did its work: HER0BRINE.EXE is gone from it. */
  private spendDrive(n: EngNode): void {
    const s = this.server;
    const pcs = s.engineering!.computers;
    for (const d of pcs.drives(n)) {
      if (d.key !== 'usb' || d.disk.kind !== 'corrupted') continue;
      const exe = d.disk.files.find((f) => f.name === 'HER0BRINE.EXE');
      if (exe) {
        exe.size = 0;
        exe.data = { lines: ['(empty)'] };
      }
      const inv = s.interaction.containers.containerAt(n.dim, n.x, n.y, n.z, 12, 'eng');
      const st = inv.get(11);
      if (st) {
        st.tag = { ...(st.tag ?? {}), data: { ...((st.tag?.data as object | undefined) ?? {}), spent: true, used: diskUsed(d.disk) } };
        inv.set(11, st);
        s.interaction.containers.persist(n.dim, n.x, n.y, n.z, inv);
      }
    }
  }

  /** A fight ended with nobody left in it. */
  onFightLost(f: HbFight): void {
    const w = this.w;
    if (f.kind === 'first' && (w.stage === 'emerging' || w.stage === 'fight1')) {
      // He goes back in, and the computer lets go of the drive: plug it in again to face him again
      const n = this.gatewayNode();
      if (n) {
        const pc = this.pcOf(n);
        if (pc) {
          pc.story = undefined;
          pc.storyLines = undefined;
          pc.usbSeen = undefined;
          n.dirty = true;
        }
        this.logPc(n, 'HER0BRINE.EXE: process ended');
      }
      w.stage = 'none';
      w.gateway = null;
      w.party = [];
      w.cheat = false;
    } else if (f.kind === 'final' && w.stage === 'final') w.stage = 'gateway';
  }

  // ------------------------------------------------------------------ the way in, and out

  /** The ENTER button on the computer he went back into. */
  enterComputer(p: ServerPlayer, n: EngNode): void {
    const w = this.w;
    if ((w.stage !== 'gateway' && w.stage !== 'final') || !this.holds(n) || this.entering.has(p) || p.dead) return;
    const s = this.server;
    this.entering.add(p);
    s.interaction.containers.closeWindow(p, p.windowId);
    p.send({ t: 'fx', kind: 'enter_computer', ticks: 36 });
    s.playSound(n.dim, 'computer.enter', n.x + 0.5, n.y + 0.5, n.z + 0.5, 1.5, 1);
    s.later(34, () => {
      this.entering.delete(p);
      if (!s.players.has(p.conn.id) || p.dead || p.dim !== n.dim) return;
      if (w.stage !== 'gateway' && w.stage !== 'final') return;
      this.addParty(p);
      const L = this.computerWorld().layout();
      s.changeDimension(p, 'computer', L.spawn.x + 0.5, L.spawn.y, L.spawn.z + 0.5, 0);
      this.arrivedAt.set(p, s.tickNo);
      p.portalCooldown = 100;
      this.grantRun(p, 'enter_computer');
      s.later(40, () => {
        if (s.players.has(p.conn.id) && p.dim.id === 'computer') p.send({ t: 'fx', kind: 'presence', ticks: 80 });
      });
    });
  }

  /** LOG OUT at the terminal where you arrived. */
  exitComputer(p: ServerPlayer): void {
    const s = this.server;
    if (p.dim.id !== 'computer') return;
    p.send({ t: 'fx', kind: 'hack', text: 'LOGGING OUT', strength: 2, ticks: 24 });
    p.send({ t: 'fx', kind: 'glitch', strength: 0.5, ticks: 20 });
    s.later(20, () => {
      if (s.players.has(p.conn.id) && p.dim.id === 'computer' && !p.dead) this.returnHome(p, false, false);
    });
  }

  /** Out of the computer world: in front of the computer you came in through (or home, if it's gone). */
  private returnHome(p: ServerPlayer, ending: boolean, cheat: boolean): void {
    const s = this.server;
    const g = this.w.gateway;
    let x: number;
    let y: number;
    let z: number;
    const n = this.gatewayNode();
    if (g && n) {
      const [fx, fz] = this.front(n);
      x = g.x + fx * 2;
      y = g.y;
      z = g.z + fz * 2;
    } else if (g) {
      x = g.x;
      y = g.y;
      z = g.z + 2;
    } else {
      const sp = p.spawnPoint && p.spawnPoint.dim === 'overworld' ? p.spawnPoint : null;
      const ws = s.level.spawn ?? [0, 64, 0];
      x = Math.floor(sp?.x ?? ws[0]);
      y = Math.floor(sp?.y ?? ws[1]);
      z = Math.floor(sp?.z ?? ws[2]);
    }
    s.changeDimension(p, 'overworld', x + 0.5, y + 0.2, z + 0.5, p.yaw);
    p.portalCooldown = 200;
    this.arrivals.set(p, { x, y, z, since: s.tickNo, ending, cheat });
  }

  private runArrivals(): void {
    const s = this.server;
    for (const [p, a] of this.arrivals) {
      if (!s.players.has(p.conn.id)) {
        this.arrivals.delete(p);
        continue;
      }
      const dim = p.dim;
      let loaded = true;
      for (let dx = -1; dx <= 1 && loaded; dx++) for (let dz = -1; dz <= 1 && loaded; dz++) if (!dim.isLoaded(a.x + dx * 16, a.z + dz * 16)) loaded = false;
      if (!loaded && s.tickNo - a.since < 600) continue;
      this.arrivals.delete(p);
      const spot = loaded ? s.admin.safeSpot(dim, a.x, a.y, a.z, false) : null;
      if (spot) s.teleport(p, spot.x + 0.5, spot.y, spot.z + 0.5);
      else (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
      p.send({ t: 'fx', kind: 'unsilence', ticks: 60 });
      if (a.ending) {
        s.later(60, () => {
          if (!s.players.has(p.conn.id)) return;
          const cheat = a.cheat || s.admin.inContext(p);
          if (!cheat) this.grant(p, 'herobrine_ending');
          s.endings?.reach(p, 'herobrine', { cheat, show: 'now' });
        });
      }
    }
  }

  // ------------------------------------------------------------------ inside the computer

  private computerWorldTick(): void {
    const s = this.server;
    const cw = s.dims.get('computer');
    if (!cw) return;
    const w = this.w;
    const L = this.computerWorld().layout();
    for (const p of s.players.values()) {
      if (p.dim !== cw || p.dead) {
        this.strays.delete(p);
        continue;
      }
      // Nothing to be in here for: the connection drops
      const story = w.stage === 'gateway' || w.stage === 'final' || w.stage === 'ending';
      const visit = p.cheat.visit === 'computer' || s.admin.inContext(p);
      if (!story && !visit) {
        const t = (this.strays.get(p) ?? 0) + 5;
        this.strays.set(p, t);
        if (t === 5) p.send({ t: 'fx', kind: 'hack', text: 'CONNECTION LOST', strength: 1, ticks: 40 });
        if (t >= 60) {
          this.strays.delete(p);
          this.returnHome(p, false, false);
        }
        continue;
      }
      this.strays.delete(p);
      if (p.gamemode === 'spectator') continue;
      // Into the hall: he is waiting
      const H = L.hall;
      const inHall = Math.hypot(p.x - H.x - 0.5, p.z - H.z - 0.5) < H.r - 3 && p.y > H.y - 2 && p.y < H.y + 14;
      if (inHall && w.stage !== 'ending') {
        this.grantRun(p, 'find_herobrine_cave');
        if (!this.fights.fight) {
          const cheat = w.cheat || !story;
          if (!story) {
            // An Admin Panel visit with no story running: a cheat run of the final fight
            w.cheat = true;
            w.gateway = null;
          }
          w.stage = 'final';
          this.clearApparitions();
          this.fights.startFinal(cw, H, L.throne, L.coils, L.core, cheat);
        }
      }
      // He watches from the fog
      if (story && w.stage === 'gateway') this.maybeAppear(p, L);
    }
  }

  // The figure in the fog ------------------------------------------------

  private maybeAppear(p: ServerPlayer, L: ReturnType<ComputerWorldGenerator['layout']>): void {
    const s = this.server;
    if (this.apparitions.some((a) => a.p === p) || this.apparitions.length >= 4) return;
    const dSight = Math.hypot(p.x - L.sighting.x, p.z - L.sighting.z);
    // The first time: standing across the lake, where he was first seen
    if (!this.sighted.has(p.uuid)) {
      if (s.tickNo - (this.arrivedAt.get(p) ?? 0) < 100) return;
      if (dSight < 70 && dSight > 20) this.appear(p, L.sighting.x + 0.5, L.sighting.y, L.sighting.z + 0.5, true);
      return;
    }
    // Later: now and then, somewhere in the fog behind you
    const last = this.lastGlimpse.get(p) ?? s.tickNo;
    if (!this.lastGlimpse.has(p)) this.lastGlimpse.set(p, s.tickNo);
    if (s.tickNo - last < 2400 || !this.rng.chance(0.02)) return;
    this.lastGlimpse.set(p, s.tickNo);
    const a = p.yaw + Math.PI + (this.rng.next() - 0.5) * 1.2;
    const r = 26 + this.rng.next() * 12;
    const x = Math.floor(p.x - Math.sin(a) * r);
    const z = Math.floor(p.z - Math.cos(a) * r);
    if (!p.dim.isLoaded(x, z)) return;
    const y = p.dim.getHeight(x, z);
    if (y < 40 || Math.abs(y - p.y) > 12) return;
    this.appear(p, x + 0.5, y, z + 0.5, false);
  }

  private appear(p: ServerPlayer, x: number, y: number, z: number, first: boolean): void {
    const m = this.server.mobs?.spawn(p.dim, 'herobrine', x, y, z, { reason: 'boss', data: { apparition: true } });
    if (!m) return;
    m.noAi = true;
    m.persistent = false;
    m.data.untouchable = true;
    m.data.apparition = true;
    m.data.hbAnim = 'stare';
    m.yaw = Math.atan2(-(p.x - x), -(p.z - z));
    m.headYaw = m.yaw;
    m.metaDirty = true;
    this.apparitions.push({ m, p, since: this.server.tickNo, first, seen: 0 });
  }

  private stepApparitions(): void {
    const s = this.server;
    for (let i = this.apparitions.length - 1; i >= 0; i--) {
      const a = this.apparitions[i]!;
      const m = a.m;
      const p = a.p;
      const gone = m.removed || !s.players.has(p.conn.id) || p.dim !== m.dim || p.dead;
      if (!gone) {
        // He turns to follow you
        m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
        m.headYaw = m.yaw;
        m.body.vx = m.body.vz = 0;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        if (this.lookingAt(p, m.x, m.y + 1.6, m.z, a.first ? 0.985 : 0.97)) a.seen++;
        const age = s.tickNo - a.since;
        const done = d < (a.first ? 16 : 12) || a.seen >= (a.first ? 40 : 10) || age > (a.first ? 900 : 360);
        if (!done) continue;
        if (a.first || a.seen > 0) {
          this.sighted.add(p.uuid);
          this.lastGlimpse.set(p, s.tickNo);
          if (a.seen > 0 || d < 16) this.grantRun(p, 'discover_herobrine_seed');
        }
        p.send({ t: 'fx', kind: 'afterimage', id: m.id, ticks: 14 });
        s.playSound(m.dim, 'herobrine.whisper', m.x, m.y + 1, m.z, 0.6, 0.8);
      }
      if (!m.removed) {
        s.particles(m.dim, 'glitch', m.x, m.y + 1, m.z, 12, 0.4);
        m.remove();
      }
      this.apparitions.splice(i, 1);
    }
  }

  private clearApparitions(): void {
    for (const a of this.apparitions) if (!a.m.removed) a.m.remove();
    this.apparitions.length = 0;
  }

  /** Whether a player is looking at a point (cosine of the angle off the centre of the view). */
  private lookingAt(p: ServerPlayer, x: number, y: number, z: number, cos: number): boolean {
    const [ex, ey, ez] = this.server.eyePos(p);
    const dx = x - ex;
    const dy = y - ey;
    const dz = z - ez;
    const d = Math.hypot(dx, dy, dz) || 1;
    const cp = Math.cos(p.pitch);
    const lx = -Math.sin(p.yaw) * cp;
    const ly = -Math.sin(p.pitch);
    const lz = -Math.cos(p.yaw) * cp;
    return (lx * dx + ly * dy + lz * dz) / d > cos;
  }

  // Terminals ------------------------------------------------------------------

  /** Using an old terminal: its log (and, at the one you arrived beside, the way out). */
  useBlock(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean {
    if (blocks[STATE_BLOCK[state]!]!.id !== 'old_terminal') return false;
    if (p.gamemode === 'spectator') return true;
    const s = this.server;
    const dim = p.dim;
    let exit = false;
    let lines: string[];
    if (dim.id === 'computer') {
      const L = this.computerWorld().layout();
      exit = x === L.exitTerminal.x && y === L.exitTerminal.y && z === L.exitTerminal.z;
      if (exit) lines = [...EXIT_TERMINAL_LINES];
      else {
        const log = TERMINAL_LOGS[(hashInts(x, y, z, 0x7e3) >>> 0) % TERMINAL_LOGS.length]!;
        const dx = L.entrance.x - x;
        const dz = L.entrance.z - z;
        const far = Math.hypot(dx, dz);
        lines = [...log, '', '> trace cable', far < 24 ? '> signal: strong. here.' : `> signal: ${bearing(dx, dz)}`];
      }
    } else lines = [...TERMINAL_LOGS[(hashInts(x, y, z, 0x7e3) >>> 0) % TERMINAL_LOGS.length]!];
    const view: PcView & { terminal: boolean } = {
      name: 'Old Terminal',
      state: 'desktop',
      power: true,
      energy: 0,
      energyMax: 0,
      use: 0,
      hw: [],
      periph: { keyboard: true, mouse: false, speaker: false, monitors: 1, leds: 0 },
      apps: [],
      app: 'terminal',
      title: exit ? 'SESSION' : (lines[0] ?? 'LOG'),
      blocks: [{ t: 'text', lines, tone: 'ok' } as UiBlock, ...(exit ? [{ t: 'btns', items: [{ label: 'LOG OUT', cmd: 'logout', tone: 'glitch' }] } as UiBlock] : [])],
      slots: [],
      terminal: true,
    };
    const ct = s.interaction.containers;
    const w = ct.allocWindow('computer', 'Old Terminal', 0);
    w.pos = { dim, x, y, z };
    w.props = view as unknown as Record<string, unknown>;
    w.onClose = (pl) => this.terminals.delete(pl);
    ct.openCustom(p, w);
    this.terminals.set(p, { w, x, y, z, exit });
    s.playSound(dim, 'computer.boot', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.7);
    if (dim.id === 'computer' && lines.some((l) => l.includes(HEROBRINE_SEED))) this.grantRun(p, 'discover_herobrine_seed');
    return true;
  }

  /** A button on a terminal's screen; false if the window isn't a terminal. */
  terminalCmd(p: ServerPlayer, windowId: number, cmd: string): boolean {
    const t = this.terminals.get(p);
    if (!t || t.w.id !== windowId || p.windowId !== windowId) return false;
    if (cmd === 'logout' && t.exit && p.distanceSq(t.x + 0.5, t.y + 0.5, t.z + 0.5) < 64) {
      this.server.interaction.containers.closeWindow(p, windowId);
      this.exitComputer(p);
    }
    return true;
  }

  // ------------------------------------------------------------------ projectiles, damage, death

  /** Herobrine's bolt struck something. */
  boltHit(pr: Projectile & { data?: Record<string, unknown> }, hit: ProjectileHit): boolean {
    const s = this.server;
    const e = hit.entity;
    if (e && e === pr.owner) return false;
    if (e && isPlayer(e)) {
      const dmg = typeof pr.data?.dmg === 'number' ? pr.data.dmg : 5;
      const d = Math.hypot(pr.vx, pr.vz) || 1;
      s.interaction.survival.damage(e, dmg, { source: 'mob', attacker: pr.owner ?? undefined, kbx: pr.vx / d, kbz: pr.vz / d, knockback: 0.5 });
      e.send({ t: 'fx', kind: 'glitch', strength: 0.3, ticks: 8 });
    } else if (e instanceof Mob && e.type !== 'herobrine') e.hurt(4, { source: 'magic', attacker: pr.owner });
    s.particles(pr.dim, 'glitch', hit.x, hit.y, hit.z, 14, 0.3);
    s.playSound(pr.dim, 'glitch.zap', hit.x, hit.y, hit.z, 1, 1.2);
    return true;
  }

  scaleDamage(m: Mob, amount: number, info: HurtInfo): number {
    return this.fights.scaleDamage(m, amount, info);
  }

  /** Herobrine's health ran out (Mobs.onBossDeath). */
  onBossDeath(m: Mob, killer: ServerPlayer | null, info: HurtInfo): void {
    this.fights.onDeath(m, killer, info);
  }

  onFinalBegins(f: HbFight, players: ServerPlayer[]): void {
    this.w.stage = 'final';
    for (const p of players) this.addParty(p);
    void f;
  }

  /** Defeated, for real: the digital world starts to come apart. */
  onFinalDefeated(f: HbFight): void {
    const s = this.server;
    const w = this.w;
    w.stage = 'ending';
    const cheat = f.cheat || w.cheat;
    for (const p of this.fights.participants(f)) if (!cheat) this.grant(p, 'defeat_final_herobrine');
    this.toComputerWorld({ t: 'fx', kind: 'silence', ticks: DEATH_TICKS + 60 });
    this.toComputerWorld({ t: 'fx', kind: 'glitch', strength: 0.9, ticks: 20 });
    const m = f.boss;
    if (m) s.playSound(f.dim, 'herobrine.death', m.x, m.y + 1, m.z, 6, 1);
  }

  private toComputerWorld(msg: Parameters<ServerPlayer['send']>[0]): void {
    for (const p of this.server.players.values()) if (p.dim.id === 'computer') p.send(msg);
  }

  /** The collapse, tick by tick (the fight's dying state). */
  dying(f: HbFight, t: number): void {
    const s = this.server;
    const m = f.boss;
    const L = this.computerWorld().layout();
    if (t === 20) this.toComputerWorld({ t: 'fx', kind: 'hack', text: 'CONNECTION LOST', strength: 1, ticks: 50 });
    if (t === 60) this.toComputerWorld({ t: 'fx', kind: 'corrupt_world', strength: 0.9, ticks: 160 });
    if (t > 10 && t < 170 && t % 8 === 0) {
      this.toComputerWorld({ t: 'fx', kind: 'glitch', strength: Math.min(0.9, 0.2 + t / 220), ticks: 8 });
      if (m) s.particles(f.dim, 'glitch', m.x + (this.rng.next() - 0.5) * 2, m.y + this.rng.next() * 2, m.z + (this.rng.next() - 0.5) * 2, 20, 0.6);
      // The hall comes apart (the world is rebuilt from the seed next time)
      const H = L.hall;
      for (let i = 0; i < 6; i++) {
        const a = this.rng.next() * Math.PI * 2;
        const r = this.rng.next() * (H.r + 2);
        const x = Math.floor(H.x + Math.cos(a) * r);
        const z = Math.floor(H.z + Math.sin(a) * r);
        const y = H.y + 2 + this.rng.int(14);
        const id = f.dim.blockId(x, y, z);
        if (id !== 'air' && id !== 'herobrine_core') f.dim.setBlock(x, y, z, this.rng.chance(0.5) ? S('missing_block') : S('static_block'), { updateNeighbors: false });
      }
      for (const c of L.coils) if (this.rng.chance(0.25)) for (const p of s.players.values()) if (p.dim === f.dim) p.send({ t: 'fx', kind: 'arc', id: 7_500_000 + t, x: c.x + 0.5, y: c.y + 2.2, z: c.z + 0.5, x1: L.core.x + 0.5, y1: L.core.y + 3, z1: L.core.z + 0.5, ticks: 6 });
      s.playSound(f.dim, 'glitch.static', H.x, H.y + 4, H.z, 4, 0.4 + t / 300);
    }
    if (t === 160) this.toComputerWorld({ t: 'fx', kind: 'shutdown', ticks: 80 });
    if (t >= DEATH_TICKS) this.finishEnding(f);
  }

  /** Everyone is thrown back out; the world's story starts over. */
  private finishEnding(f: HbFight): void {
    const s = this.server;
    const w = this.w;
    const cheat = f.cheat || w.cheat;
    this.fights.finish(f);
    this.clearApparitions();
    for (const p of [...s.players.values()]) {
      if (p.dim.id !== 'computer') continue;
      if (p.dead) continue;
      this.returnHome(p, true, cheat || s.admin.inContext(p));
    }
    if (!cheat) w.completions++;
    this.resetRun(false);
  }

  /** The computer is just a computer again; the computer world will be rebuilt from the seed. */
  private resetRun(keepGateway: boolean): void {
    const w = this.w;
    const n = this.gatewayNode();
    if (n) {
      const pc = this.pcOf(n);
      if (pc) {
        pc.story = undefined;
        pc.storyLines = undefined;
        pc.app = '';
        n.dirty = true;
      }
    }
    // Arrivals still on their way out use the gateway's position, then it goes
    const g = w.gateway;
    w.stage = 'none';
    w.party = [];
    w.cheat = false;
    w.epoch++;
    this.sighted.clear();
    w.gateway = keepGateway ? g : null;
  }

  private online(uuid: string): ServerPlayer | null {
    for (const p of this.server.players.values()) if (p.uuid === uuid) return p;
    return null;
  }

  // ------------------------------------------------------------------ the Admin Panel

  /** Gives a Corrupted Flash Drive (cheat-made, awake: it needs no dragon). */
  makeCorruptedDrive(): ItemStack {
    const disks = this.server.engineering!.computers.disks;
    const d = disks.create('corrupted');
    for (const f of CORRUPTED_DRIVE_FILES) d.files.push({ name: f.name, kind: f.kind, size: f.size, data: { lines: f.lines ?? [] }, ro: true });
    const st = stackOf('corrupted_flash_drive', 1);
    st.tag = { data: { disk: d.id, label: d.label, used: diskUsed(d), cap: d.cap, born: -1, cheat: true } };
    return markAdmin(st);
  }

  /** A working computer (cheat-made) in front of a player, for the story's admin triggers. */
  adminComputer(p: ServerPlayer): EngNode | null {
    const s = this.server;
    const eng = s.engineering;
    if (!eng) return null;
    // One already standing near?
    let best: EngNode | null = null;
    let bd = 64;
    for (const n of eng.nodes.values()) {
      if (n.dim !== p.dim || n.c.kind !== 'computer' || n.removed) continue;
      const d = p.distanceSq(n.x + 0.5, n.y + 0.5, n.z + 0.5);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (!best) {
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      const x = Math.floor(p.x + fx * 3);
      const z = Math.floor(p.z + fz * 3);
      const y = Math.floor(p.y);
      const facing = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 'west' : 'east') : fz > 0 ? 'north' : 'south';
      for (let dy = 0; dy < 3; dy++) {
        p.dim.setBlock(x, y + dy, z, 0);
        s.admin.setBlockMark(p.dim, x, y + dy, z, true);
      }
      p.dim.setBlock(x, y, z, stateOf('computer', { facing }));
      s.admin.setBlockMark(p.dim, x, y, z, true);
      best = eng.node(p.dim, x, y, z) ?? null;
      if (!best) return null;
      const ct = s.interaction.containers;
      const inv = ct.containerAt(p.dim, x, y, z, 12, 'eng');
      const parts = ['power_supply', 'motherboard', 'cpu', 'ram_module', 'ram_module'];
      parts.forEach((id, i) => inv.set(i, markAdmin(stackOf(id, 1))));
      ct.persist(p.dim, x, y, z, inv);
      p.dim.setBlock(x, y + 1, z, stateOf('monitor', { facing }));
      s.admin.setBlockMark(p.dim, x, y + 1, z, true);
    }
    const be = best.be();
    if (be) {
      be.energy = best.c.energy?.capacity ?? 4000;
      be.cheat = 1;
      const pc = eng.computers.pcOf(be);
      pc.on = true;
      pc.run = true;
      pc.boot = 0;
      best.dirty = true;
    }
    eng.computers.invalidate(best);
    return best;
  }

  /** Puts everything back to before the story started (the Admin Panel). */
  adminReset(): void {
    const s = this.server;
    this.takeover = null;
    const f = this.fights.fight;
    if (f) this.fights.reset(f, true);
    this.fights.restoreSaved();
    this.malware.clear();
    this.clearApparitions();
    const w = this.w;
    w.infected = false;
    w.infectedCheat = false;
    for (const p of [...s.players.values()]) if (p.dim.id === 'computer' && !p.dead && p.cheat.visit !== 'computer') this.returnHome(p, false, true);
    this.resetRun(false);
  }

  /** Status for the Admin Panel. */
  status(): Record<string, unknown> {
    const w = this.w;
    return {
      stage: w.stage,
      gateway: w.gateway,
      cheat: w.cheat,
      dragonKills: w.dragonKills,
      legitKills: w.legitKills,
      completions: w.completions,
      infected: w.infected,
      clouds: this.malware.clouds.length,
      takeover: !!this.takeover,
      fight: this.fights.status(),
      party: w.party.length,
    };
  }
}
