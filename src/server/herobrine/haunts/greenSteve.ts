/**
 * Green Steve's part of the Haunting (the Admin Panel only). He is a player
 * who is not one, and everything he does looks like something it is not:
 *
 *   friend   "Green Steve joined the world"; someone in green waves from far off and runs;
 *            friendly messages, and a gift left on the ground
 *   gifts    little houses he built for you, FOR MY BROTHER on a sign by the door, blue clay
 *            in the floor that drops you into a bedrock room (green creepers, "Hello, brother",
 *            and back out a few seconds later); doors left open
 *   copies   copies of you and your friends, wearing your names, standing too still, waving;
 *            messages in chat from friends who never sent them
 *   brother  he talks back, far too friendly; creepers hiss right behind you and puff away
 *            (never exploding)
 *   finale   "room": everyone wakes in a bedrock room full of creepers turning to look,
 *            "Hello, brother", a white flash; or "replaced": everyone watches from outside
 *            themselves as Green Steve, wearing their name, walks away into their world
 *
 * His houses are left standing when it ends (cheat-marked, like all a
 * haunting's blocks); his bedrock rooms are always taken away again, and
 * nobody is ever left in one. His creepers are figures, never real ones.
 */
import type { ServerPlayer } from '../../player/ServerPlayer';
import type { Dimension } from '../../world/Dimension';
import type { HauntingSystem } from '../Haunting';
import type { Mob } from '../../entity/Mob';
import type { DimensionId } from '../../../common/data/biomes';
import { S, stateOf } from '../../../common/registry/blocks';
import { markAdmin, stackOf } from '../../../common/game/itemstack';
import { WORLD_HEIGHT } from '../../../common/world/constants';
import { GREEN_SIGNS, GREEN_FAKE_CHAT, GREEN_FRIENDLY, GREEN_END } from '../../../common/game/hauntCast';
import type { HauntPart, HauntState, Figure } from './types';
import { NATURAL, seenByAnyone, openDoor, undoCells, putCell, steady, type Cells } from './shared';

const BUDGET: Record<string, Record<string, number>> = {
  friend: { wave: 3, gift: 2, friendly: 2, door: 1 },
  gifts: { wave: 2, house: 3, door: 3, gift: 2, sign: 2, friendly: 2 },
  copies: { copy: 5, fakechat: 4, house: 2, door: 3, sign: 2, creeper: 1 },
  brother: { copy: 5, fakechat: 4, creeper: 4, house: 1, door: 2, sign: 3, wave: 1 },
  finale: {},
};

const GIFTS = ['poppy', 'cookie', 'apple', 'dandelion', 'bread'];
/** How long someone stays in a trap's bedrock room (ticks). */
const TRAP_TICKS = 160;

interface Trap {
  dim: DimensionId;
  /** The blue clay tile (in the house floor), where to put them back out, the room under it. */
  x: number;
  y: number;
  z: number;
  out: [number, number, number];
  cells: Cells;
}

/** The end, while it plays. */
interface End {
  t: number;
  kind: 'room' | 'replaced';
  /** One bedrock room per dimension (room); where everyone was (to put them back). */
  rooms: Map<DimensionId, { cx: number; cy: number; cz: number; cells: Cells; ok: boolean }>;
  from: Map<string, [DimensionId, number, number, number, number]>;
  figs: Mob[];
  /** replaced: each player's copy, and where the camera watches it from. */
  copies: Map<string, { m: Mob; cam: [number, number, number]; dir: [number, number] }>;
}

export class GreenSteveHaunt implements HauntPart {
  readonly id = 'green_steve' as const;
  readonly budget = BUDGET;
  private traps: Trap[] = [];
  private readonly trapped = new Map<string, { trap: Trap; until: number; figs: Mob[] }>();
  private end: End | null = null;

  constructor(private readonly h: HauntingSystem) {}

  private get rng(): { next(): number; int(n: number): number } {
    return this.h.rng;
  }

  holds(p: ServerPlayer): boolean {
    return !!this.end || this.trapped.has(p.uuid);
  }

  silent(): boolean {
    return !!this.end;
  }

  reset(why: 'stop' | 'end'): void {
    const s = this.h.server;
    // Nobody is left in a bedrock room
    for (const [uuid, tr] of this.trapped) {
      const p = [...s.players.values()].find((o) => o.uuid === uuid);
      if (p && p.dim.id === tr.trap.dim) s.teleport(p, ...tr.trap.out);
      for (const m of tr.figs) if (!m.removed) m.remove();
    }
    this.trapped.clear();
    const e = this.end;
    this.end = null;
    if (e) {
      for (const m of e.figs) if (!m.removed) m.remove();
      for (const c of e.copies.values()) if (!c.m.removed) c.m.remove();
      for (const p of s.players.values()) {
        const from = e.from.get(p.uuid);
        if (why === 'stop') p.send({ t: 'fx', kind: 'scene', text: 'end', ticks: 1 });
        if (!from) continue;
        const [d, x, y, z, yaw] = from;
        if (p.dim.id !== d) s.changeDimension(p, d, x, y, z, yaw, { admin: true });
        else s.teleport(p, x, y, z, yaw);
      }
      for (const [d, r] of e.rooms) undoCells(this.h, s.dims.get(d), r.cells);
    }
    // His rooms go; his houses stay (Stop takes those back too)
    for (const t of this.traps) undoCells(this.h, s.dims.get(t.dim), t.cells);
    this.traps = [];
  }

  originOf(p: ServerPlayer): { dim: DimensionId; x: number; y: number; z: number; yaw: number } | null {
    const from = this.end?.from.get(p.uuid);
    if (from) return { dim: from[0], x: from[1], y: from[2], z: from[3], yaw: from[4] };
    const tr = this.trapped.get(p.uuid);
    return tr ? { dim: tr.trap.dim, x: tr.trap.out[0], y: tr.trap.out[1], z: tr.trap.out[2], yaw: p.yaw } : null;
  }

  /** Leaving from a trap's room, or his end: saved where he took them from. */
  release(p: ServerPlayer): void {
    const at = this.originOf(p);
    if (!at) return;
    p.leaveAt = at;
    const tr = this.trapped.get(p.uuid);
    if (tr) for (const m of tr.figs) if (!m.removed) m.remove();
    this.trapped.delete(p.uuid);
    this.end?.from.delete(p.uuid);
  }

  event(kind: string, p: ServerPlayer, _st: HauntState, stage: string): void {
    switch (kind) {
      case 'wave':
        this.friend(p);
        break;
      case 'friendly':
        this.h.say(p, GREEN_FRIENDLY[this.rng.int(GREEN_FRIENDLY.length)]!, false);
        break;
      case 'gift':
        this.gift(p);
        break;
      case 'house':
        this.house(p);
        break;
      case 'door':
        openDoor(this.h, p, 14);
        break;
      case 'sign':
        this.h.placeSign(p, GREEN_SIGNS[this.rng.int(GREEN_SIGNS.length)]!, 6, 16);
        break;
      case 'copy':
        this.copy(p, stage === 'brother');
        break;
      case 'fakechat':
        this.fakeChat(p);
        break;
      case 'creeper':
        this.creeper(p);
        break;
    }
  }

  oneOffs(): void {}

  atmosphere(): void {}

  /** His traps: standing on the blue clay drops you into the room under it. */
  everyTick(_st: HauntState, _f: number, players: ServerPlayer[]): void {
    const s = this.h.server;
    for (const [uuid, tr] of this.trapped) {
      if (s.tickNo < tr.until) continue;
      this.trapped.delete(uuid);
      const p = players.find((o) => o.uuid === uuid);
      for (const m of tr.figs) if (!m.removed) {
        s.particles(m.dim, 'explosion_smoke', m.x, m.y + 0.8, m.z, 12, 0.4);
        m.remove();
      }
      const dim = s.dims.get(tr.trap.dim);
      if (dim) this.h.set(dim, tr.trap.x, tr.trap.y, tr.trap.z, S('blue_terracotta'));
      if (p && p.dim === dim) {
        s.teleport(p, ...tr.trap.out);
        p.send({ t: 'fx', kind: 'shake', strength: 0.3, ticks: 8 });
      }
    }
    if (!this.traps.length) return;
    for (const p of players) {
      if (p.dead || this.trapped.has(p.uuid)) continue;
      const t = this.traps.find((x) => x.dim === p.dim.id && Math.floor(p.x) === x.x && Math.floor(p.z) === x.z && Math.floor(p.y + 0.01) === x.y + 1);
      if (t && p.dim.getState(t.x, t.y, t.z) === S('blue_terracotta')) this.spring(p, t);
    }
  }

  // ------------------------------------------------------------------ a friend

  /** Him, far off, waving; he runs when you come closer. */
  private friend(p: ServerPlayer): void {
    if (this.h.figures.some((f) => f.p === p && f.kind === 'friend')) return;
    const at = this.h.spotNear(p, 30, 46, true);
    if (!at) return;
    const m = this.h.spawnFigure(p, 'friend', ...at, 'wave', {}, {}, 'green_steve');
    if (m) m.customName = 'Green Steve';
  }

  /** Something left on the ground for you (it counts for nothing, like anything a haunting makes). */
  private gift(p: ServerPlayer): void {
    const s = this.h.server;
    for (let tries = 0; tries < 8; tries++) {
      const [x, z] = this.h.around(p, 3, 7);
      const y = this.h.floorNear(p.dim, x, z, Math.floor(p.y), 4);
      if (y === null) continue;
      s.mining.dropItem(p.dim, x + 0.5, y + 0.2, z + 0.5, markAdmin(stackOf(GIFTS[this.rng.int(GIFTS.length)]!, 1)), false);
      s.particles(p.dim, 'happy', x + 0.5, y + 0.5, z + 0.5, 8, 0.4);
      return;
    }
  }

  // ------------------------------------------------------------------ his houses

  /** A little house, built while nobody was looking, with blue clay in the floor over a bedrock room. */
  private house(p: ServerPlayer): boolean {
    const dim = p.dim;
    if (this.traps.length >= 6) return false;
    const id = (cx: number, cy: number, cz: number): string => this.h.idAt(dim, cx, cy, cz);
    // Plain ground (sand and gravel too: the room is walled in bedrock before anything is taken out)
    const ground = (cx: number, cy: number, cz: number): boolean => NATURAL.test(id(cx, cy, cz)) && !dim.getBlockEntity(cx, cy, cz);
    const cover = (cx: number, cy: number, cz: number): boolean => this.h.open(dim, cx, cy, cz) || id(cx, cy, cz) === 'snow';
    for (let tries = 0; tries < 30; tries++) {
      const [x, z] = this.h.around(p, 10, 30);
      const g = this.h.floorNear(dim, x, z, Math.floor(p.y), 10);
      if (g === null || seenByAnyone(this.h, dim, x + 0.5, g + 1, z + 0.5, 0.4)) continue;
      if (!dim.isLoaded(x - 3, z - 3) || !dim.isLoaded(x + 3, z + 3)) continue;
      // Ground about level (a step of one either way is built over), plain ground under it all for
      // the room (never into a cave, water or anything someone made), open air above
      let ok = true;
      for (let dx = -2; dx <= 2 && ok; dx++)
        for (let dz = -2; dz <= 2 && ok; dz++) {
          const f = id(x + dx, g - 1, z + dz);
          if (dim.getState(x + dx, g - 1, z + dz) !== 0 && !ground(x + dx, g - 1, z + dz) && f !== 'snow' && f !== 'ice' && f !== 'packed_ice') ok = false;
          for (let y = g - 5; y <= g - 2 && ok; y++) if (!ground(x + dx, y, z + dz)) ok = false;
          if (!cover(x + dx, g, z + dz) && !(ground(x + dx, g, z + dz) && steady(dim, x + dx, g, z + dz))) ok = false;
          for (let y = g + 1; y <= g + 3 && ok; y++) if (!cover(x + dx, y, z + dz)) ok = false;
        }
      // Nothing outside it that would slide in (sand next to where the walls go is fine: they are solid)
      if (!ok) continue;
      // The door faces the player
      const alongX = Math.abs(p.x - x) > Math.abs(p.z - z);
      const sx = alongX ? Math.sign(p.x - x) || 1 : 0;
      const sz = alongX ? 0 : Math.sign(p.z - z) || 1;
      // The room's blocks are kept apart: it is always taken away again (the house may stay)
      const house: Cells = [];
      const cells: Cells = [];
      const put = (cx: number, cy: number, cz: number, st: number): boolean => putCell(this.h, dim, house, cx, cy, cz, st);
      const dig = (cx: number, cy: number, cz: number, st: number): boolean => putCell(this.h, dim, cells, cx, cy, cz, st);
      const all = (fn: (dx: number, dz: number, edge: boolean, corner: boolean) => void): void => {
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) fn(dx, dz, Math.abs(dx) === 2 || Math.abs(dz) === 2, Math.abs(dx) === 2 && Math.abs(dz) === 2);
      };
      // 1. Whatever stands where the house goes, from the top down (a flower, snow, a step of ground)
      all((dx, dz) => {
        for (let y = g + 3; y >= g; y--) if (dim.getState(x + dx, y, z + dz) !== 0) put(x + dx, y, z + dz, 0);
      });
      // 2. A plank floor (blue clay in the middle)
      all((dx, dz) => put(x + dx, g - 1, z + dz, dx === 0 && dz === 0 ? S('blue_terracotta') : S('oak_planks')));
      // 3. The room under the floor: 3x3, two high, walled in bedrock first, then hollowed out; a glowstone in one wall
      all((dx, dz, edge) => {
        dig(x + dx, g - 4, z + dz, S('bedrock'));
        if (edge) for (let y = g - 3; y <= g - 2; y++) dig(x + dx, y, z + dz, S('bedrock'));
      });
      all((dx, dz, edge) => {
        if (!edge) for (let y = g - 2; y >= g - 3; y--) dig(x + dx, y, z + dz, 0);
      });
      dig(x - 2 * sx, g - 2, z - 2 * sz, S('glowstone'));
      // 4. Plank walls, log corners, windows, the doorway facing the player, a slab roof
      all((dx, dz, edge, corner) => {
        if (edge)
          for (let y = g; y <= g + 2; y++) {
            const door = dx === 2 * sx && dz === 2 * sz && y <= g + 1;
            const window = !corner && y === g + 1 && (dx === 0 || dz === 0) && !(dx === 2 * sx && dz === 2 * sz);
            if (!door) put(x + dx, y, z + dz, corner ? stateOf('oak_log', { axis: 'y' }) : window ? S('glass') : S('oak_planks'));
          }
        put(x + dx, g + 3, z + dz, stateOf('oak_slab', { type: 'bottom' }));
      });
      // FOR MY BROTHER, by the door
      const fx = x + 3 * sx;
      const fz = z + 3 * sz;
      const fy = this.h.floorNear(dim, fx, fz, g, 2) ?? g;
      this.h.signAt(p, fx + (sx === 0 ? 1 : 0), fy, fz + (sz === 0 ? 1 : 0), GREEN_SIGNS[0]!);
      this.traps.push({ dim: dim.id, x, y: g - 1, z, out: [fx + 0.5, fy, fz + 0.5], cells });
      return true;
    }
    return false;
  }

  /** Down through the blue clay: green creepers, Hello brother, and back out a few seconds later. */
  private spring(p: ServerPlayer, t: Trap): void {
    const dim = p.dim;
    if (!this.h.set(dim, t.x, t.y, t.z, 0)) return;
    const s = this.h.server;
    const figs: Mob[] = [];
    for (const [dx, dz] of [
      [-1, -1],
      [1, 1],
    ] as const) {
      const m = this.h.apparition(dim, 'creeper', t.x + dx + 0.5, t.y - 2, t.z + dz + 0.5, Math.atan2(-dx, -dz) + Math.PI, 'stare');
      if (m) figs.push(m);
    }
    s.playSound(dim, 'fizz', t.x + 0.5, t.y - 1, t.z + 0.5, 0.8, 0.6);
    this.trapped.set(p.uuid, { trap: t, until: s.tickNo + TRAP_TICKS, figs });
    s.later(30, () => {
      if (this.trapped.has(p.uuid) && s.players.has(p.conn.id)) this.h.say(p, 'welcome home, brother :)', true);
    });
  }

  // ------------------------------------------------------------------ copies

  /** A copy of someone in the world, wearing their name, standing too still. */
  private copy(p: ServerPlayer, waving: boolean): void {
    if (this.h.figures.some((f) => f.p === p && f.kind === 'copy')) return;
    const all = [...this.h.server.players.values()];
    const who = all[this.rng.int(all.length)]!;
    const at = this.h.spotNear(p, 14, 26, true);
    if (!at) return;
    const m = this.h.spawnFigure(p, 'copy', ...at, waving && this.rng.next() < 0.5 ? 'wave' : 'stare', { who: who.uuid }, {}, 'green_steve');
    if (m) m.customName = who.name;
  }

  /** A message to one player from a friend who never sent it (from themselves, when alone). */
  private fakeChat(p: ServerPlayer): void {
    const others = [...this.h.server.players.values()].filter((o) => o !== p);
    const from = others.length ? others[this.rng.int(others.length)]!.name : p.name;
    p.send({ t: 'chat', text: GREEN_FAKE_CHAT[this.rng.int(GREEN_FAKE_CHAT.length)]!, kind: 'chat', from });
  }

  /** A creeper right behind you, hissing; then a puff of smoke, and nothing. */
  private creeper(p: ServerPlayer): void {
    for (let tries = 0; tries < 8; tries++) {
      const at = this.h.spotNear(p, 2.5, 4.5, false, true);
      if (!at) continue;
      const m = this.h.spawnFigure(p, 'creeper', ...at, 'stare', {}, {}, 'green_steve', 'creeper');
      if (!m) return;
      this.h.server.playSound(p.dim, 'fizz', at[0], at[1] + 1, at[2], 1, 0.5);
      return;
    }
  }

  appear(p: ServerPlayer): boolean {
    const at = this.h.spotNear(p, 10, 14, true);
    if (!at) return false;
    const m = this.h.spawnFigure(p, 'test', ...at, 'wave', {}, {}, 'green_steve');
    if (m) m.customName = 'Green Steve';
    return !!m;
  }

  stepFigure(fg: Figure, age: number, d: number): boolean {
    const { m, p } = fg;
    if (fg.kind === 'replacer' || fg.kind === 'room') return true;
    const run = fg.data.run as number | undefined;
    if (run === undefined) {
      m.yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
      m.headYaw = m.yaw;
    }
    if (this.h.lookingAt(p, m.x, m.y + 1.6, m.z, 0.97)) fg.seen++;
    switch (fg.kind) {
      case 'friend':
        // He runs off when you come closer (or stare at him)
        if (run === undefined && (d < 18 || fg.seen > 120)) {
          fg.data.run = age;
          m.data.hbAnim = 'idle';
          m.yaw = Math.atan2(p.x - m.x, p.z - m.z);
          m.headYaw = m.yaw;
          m.metaDirty = true;
        }
        if (run !== undefined) {
          const dx = m.x - p.x;
          const dz = m.z - p.z;
          const n = Math.hypot(dx, dz) || 1;
          const nx = m.x + (dx / n) * 0.3;
          const nz = m.z + (dz / n) * 0.3;
          const ny = this.h.floorNear(m.dim, Math.floor(nx), Math.floor(nz), Math.floor(m.y), 3) ?? m.y;
          m.setPos(nx, ny, nz);
          m.metaDirty = true;
          return age - run < 40;
        }
        return age < 360;
      case 'copy':
        return d >= 8 && fg.seen < 80 && age < 500;
      case 'creeper':
        // Swelling, flashing, hissing... and then only smoke
        m.fuse = Math.min(28, age);
        m.metaDirty = true;
        return age < 34;
      case 'test':
        return d >= 4 && fg.seen < 80 && age < 240;
      default:
        return age < 400;
    }
  }

  vanish(fg: Figure, gone: boolean): void {
    const s = this.h.server;
    const { m, p } = fg;
    if (fg.kind === 'creeper') {
      s.particles(m.dim, 'explosion_smoke', m.x, m.y + 0.8, m.z, 16, 0.5);
      if (!gone) {
        p.send({ t: 'sound', name: 'greensteve.pop', x: m.x, y: m.y + 1, z: m.z, volume: 0.8, pitch: 1 });
        p.send({ t: 'fx', kind: 'shake', strength: 0.35, ticks: 8 });
      }
      return;
    }
    s.particles(m.dim, 'happy', m.x, m.y + 1, m.z, 10, 0.4);
    if (!gone) p.send({ t: 'sound', name: 'greensteve.pop', x: m.x, y: m.y + 1, z: m.z, volume: 0.4, pitch: 1.4 });
  }

  // ------------------------------------------------------------------ the end

  finale(st: HauntState, _f: number, players: ServerPlayer[]): void {
    if (!this.end) {
      st.final ??= (st.ending ?? 'random') === 'random' ? (this.rng.next() < 0.5 ? 'room' : 'replaced') : st.ending;
      // Out of any trap first
      this.reset('stop');
      this.h.clearFigures();
      this.end = { t: -1, kind: st.final === 'replaced' ? 'replaced' : 'room', rooms: new Map(), from: new Map(), figs: [], copies: new Map() };
    }
    const e = this.end;
    e.t++;
    if (e.kind === 'room') this.roomEnd(st, e, players);
    else this.replacedEnd(st, e, players);
  }

  /** Everyone wakes in a bedrock room full of creepers; they turn to look; Hello, brother; a white flash. */
  private roomEnd(st: HauntState, e: End, players: ServerPlayer[]): void {
    const s = this.h.server;
    const t = e.t;
    if (t === 0) for (const p of players) p.send({ t: 'fx', kind: 'scene', text: 'black', ticks: 50 });
    if (t === 30) {
      for (const p of players) {
        if (p.dead) continue;
        let r = e.rooms.get(p.dim.id);
        if (!r) {
          r = this.buildRoom(p.dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
          e.rooms.set(p.dim.id, r);
          if (r.ok) this.fillRoom(e, p.dim, r);
        }
        if (!r.ok) continue;
        // In a row at one end, facing him at the other
        const i = e.from.size;
        const x = r.cx + 0.5 - 2.5;
        const z = r.cz + 0.5 + (i % 6 - (Math.min(6, players.length) - 1) / 2) * 1.3;
        e.from.set(p.uuid, [p.dim.id, p.x, p.y, p.z, p.yaw]);
        s.teleport(p, x - Math.floor(i / 6), r.cy, z, -Math.PI / 2);
      }
    }
    if (t === 50) for (const p of players) p.send({ t: 'fx', kind: 'scene', text: 'rise', ticks: 60 });
    // The creepers all round the walls turn, all at once, to look at you
    if (t === 100)
      for (const m of e.figs) {
        if (m.removed || m.type !== 'creeper') continue;
        const near = players.filter((p) => p.dim === m.dim).sort((a, b) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(b.x - m.x, b.z - m.z))[0];
        if (!near) continue;
        m.yaw = Math.atan2(-(near.x - m.x), -(near.z - m.z));
        m.headYaw = m.yaw;
        m.metaDirty = true;
      }
    if (t === 100) for (const p of players) p.send({ t: 'sound', name: 'herobrine.presence', x: p.x, y: p.y + 1, z: p.z, volume: 0.6, pitch: 1.3 });
    if (t === 115)
      for (const p of players) {
        this.h.say(p, 'Hello, brother.', true);
        p.send({ t: 'sound', name: 'greensteve.hello', x: p.x, y: p.y + 1, z: p.z, volume: 0.9, pitch: 1 });
      }
    if (t >= 150 && t < 185)
      for (const m of e.figs) {
        if (m.removed || m.type !== 'creeper') continue;
        m.fuse = Math.min(28, (t - 150) * 1.2);
        m.metaDirty = true;
        if (t === 150) s.playSound(m.dim, 'fizz', m.x, m.y + 1, m.z, 0.7, 0.5);
      }
    if (t === 185) for (const p of players) p.send({ t: 'fx', kind: 'scene', text: 'flash', ticks: 40 });
    if (t >= 215) this.h.finish(st, { kind: 'screen', screen: { style: 'green_steve', ...GREEN_END.room } });
  }

  /** A bedrock room high above: 9x4x9 inside, glowstone in the ceiling. */
  private buildRoom(dim: Dimension, px: number, py: number, pz: number): { cx: number; cy: number; cz: number; cells: Cells; ok: boolean } {
    const cy = Math.min(WORLD_HEIGHT - 8, Math.max(py + 30, 150));
    const cells: Cells = [];
    const room = { cx: px, cy, cz: pz, cells, ok: false };
    if (!dim.isLoaded(px - 5, pz - 5) || !dim.isLoaded(px + 5, pz + 5)) return room;
    for (let dx = -5; dx <= 5; dx++)
      for (let dz = -5; dz <= 5; dz++)
        for (let y = cy - 1; y <= cy + 4; y++) {
          const shell = Math.abs(dx) === 5 || Math.abs(dz) === 5 || y === cy - 1 || y === cy + 4;
          const light = y === cy + 4 && Math.abs(dx) % 3 === 0 && Math.abs(dz) % 3 === 0 && Math.abs(dx) < 5 && Math.abs(dz) < 5;
          putCell(this.h, dim, cells, px + dx, y, pz + dz, shell ? S(light ? 'glowstone' : 'bedrock') : 0);
        }
    room.ok = true;
    return room;
  }

  /** Creepers along both walls (facing them), and him at the far end, facing everyone. */
  private fillRoom(e: End, dim: Dimension, r: { cx: number; cy: number; cz: number }): void {
    for (const side of [-1, 1])
      for (const dx of [-3, -1.5, 0, 1.5, 3]) {
        // Facing the wall, until they turn
        const m = this.h.apparition(dim, 'creeper', r.cx + 0.5 + dx, r.cy, r.cz + 0.5 + side * 3.5, side > 0 ? Math.PI : 0, 'stare');
        if (m) e.figs.push(m);
      }
    const g = this.h.apparition(dim, 'green_steve', r.cx + 0.5 + 3.2, r.cy, r.cz + 0.5, Math.PI / 2, 'stare');
    if (g) {
      g.customName = 'Green Steve';
      e.figs.push(g);
    }
  }

  /** From outside yourself: Green Steve, wearing your name, turns, waves, and walks away into your world. */
  private replacedEnd(st: HauntState, e: End, players: ServerPlayer[]): void {
    const t = e.t;
    if (t === 0)
      for (const p of players) {
        if (p.dead) continue;
        const dir: [number, number] = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
        const y = this.h.floorNear(p.dim, Math.floor(p.x), Math.floor(p.z), Math.floor(p.y), 2) ?? p.y;
        const m = this.h.apparition(p.dim, 'green_steve', p.x, y, p.z, p.yaw, 'stare');
        if (!m) continue;
        m.customName = p.name;
        // The camera steps back out of you, up and behind
        const cam: [number, number, number] = [p.x - dir[0] * 4.5, y + 2.6, p.z - dir[1] * 4.5];
        e.copies.set(p.uuid, { m, cam, dir });
        p.send({ t: 'fx', kind: 'scene', text: 'watch', ticks: 240, x: cam[0], y: cam[1], z: cam[2], x1: m.x, y1: m.y + 1.6, z1: m.z });
      }
    for (const [uuid, c] of e.copies) {
      const p = players.find((o) => o.uuid === uuid);
      const m = c.m;
      if (m.removed) continue;
      if (t === 40) {
        // It turns round, and looks at you
        m.yaw = Math.atan2(-(c.cam[0] - m.x), -(c.cam[2] - m.z));
        m.headYaw = m.yaw;
        m.metaDirty = true;
        if (p) p.send({ t: 'sound', name: 'greensteve.hello', x: m.x, y: m.y + 1.5, z: m.z, volume: 0.7, pitch: 0.9 });
      }
      if (t === 70) {
        m.data.hbAnim = 'wave';
        m.metaDirty = true;
      }
      if (t === 105) {
        m.data.hbAnim = 'idle';
        m.yaw = Math.atan2(-c.dir[0], -c.dir[1]);
        m.headYaw = m.yaw;
        m.metaDirty = true;
      }
      if (t > 105 && t < 230) {
        const nx = m.x + c.dir[0] * 0.13;
        const nz = m.z + c.dir[1] * 0.13;
        const ny = this.h.floorNear(m.dim, Math.floor(nx), Math.floor(nz), Math.floor(m.y), 3) ?? m.y;
        m.setPos(nx, ny, nz);
        m.metaDirty = true;
        if (p && t % 10 === 0) p.send({ t: 'fx', kind: 'scene', text: 'watch', ticks: 240 - t, x: c.cam[0], y: c.cam[1], z: c.cam[2], x1: m.x, y1: m.y + 1.6, z1: m.z });
      }
    }
    if (t === 225) for (const p of players) p.send({ t: 'fx', kind: 'scene', text: 'black', ticks: 40 });
    if (t >= 255) this.h.finish(st, { kind: 'screen', screen: { style: 'green_steve', ...GREEN_END.replaced } });
  }
}
