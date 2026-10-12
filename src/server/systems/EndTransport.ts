/**
 * V6 - The End Expansion, phase 4: getting about (the server decides all of it).
 *
 * - Teleportation Nodes: an index of every node (in `level.flags.endNodes`,
 *   so nodes in unloaded chunks still show as destinations); a node's window
 *   names it, locks it to its owner and lists where it can go. A trip costs
 *   1,000 EU + 10 EU a block from the departure node's buffer, after 40
 *   ticks standing on it; the way out at the other end must be clear. Nodes
 *   never cross dimensions, and work only in the End or within 2,000 blocks
 *   of the Overworld's spawn.
 * - Ancient Gateways: stepping into a repaired gateway's sheet takes you to
 *   its pair (pairs and repairs are the Broken Gateway quest's, EndQuests).
 * - Vehicles (mobs with no AI, driven here): minecarts on rails (powered
 *   rails drive them to 0.4 blocks/tick, a powered Ender Rail to twice
 *   that), and the Void Skiff, a slow flying boat for two with a fuel tank
 *   of Void Shards that never climbs more than 16 blocks above the lowest it
 *   was in the last minute, and sinks slowly when it runs dry.
 * - The Void Skiff's blueprint teaches its recipe (per player).
 */
import type { GameServer } from '../GameServer';
import type { Dimension } from '../world/Dimension';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { HurtInfo } from '../entity/Living';
import { Mob } from '../entity/Mob';
import { blocks, STATE_BLOCK, STATE_SOLID, STATE_FLUID, getProp } from '../../common/registry/blocks';
import { stackOf, itemIdOf, isAdminStack, markAdmin, type ItemStack } from '../../common/game/itemstack';
import { moveBody, bodyObstructed } from '../../common/physics/movement';
import { collisionShape } from '../../common/physics/shapes';
import { isRail, railEnds, SIDE } from '../../common/game/rails';
import { CART, NODE, SKIFF, nodeCost, LOCKED_RECIPES } from '../../common/endExpansion/transport';
import type { MachineProps } from '../../common/engineering/window';
import type { EngNode } from '../engineering/Engineering';
import { lookDir } from './Interaction';

type P3 = [number, number, number];

/** A node in the index. */
export interface NodeRec {
  name: string;
  owner: string;
  ownerName: string;
  locked?: boolean;
  /** Placed by a cheat (trips from or to it never count). */
  cheat?: boolean;
}

interface Warmup {
  from: string;
  to: string;
  left: number;
  wait: number;
}

interface Transit {
  to: P3;
  dim: Dimension;
  since: number;
}

const nodeKey = (dim: string, x: number, y: number, z: number): string => `${dim}|${x},${y},${z}`;
const parseKey = (k: string): { dim: string; x: number; y: number; z: number } => {
  const [dim, rest] = k.split('|') as [string, string];
  const [x, y, z] = rest.split(',').map(Number) as P3;
  return { dim, x, y, z };
};

export class EndTransportSystem {
  private readonly warmups = new Map<ServerPlayer, Warmup>();
  private readonly transits = new Map<ServerPlayer, Transit>();
  private readonly gatewayCooldown = new Map<ServerPlayer, number>();
  private readonly pilots = new Map<ServerPlayer, { f: number; s: number; v: number }>();
  /** Distance walked on Ender Light over the void (for the advancement), per player. */
  private readonly bridgeWalk = new Map<ServerPlayer, { d: number; x: number; z: number }>();

  constructor(private readonly server: GameServer) {}

  // ------------------------------------------------------------------ nodes

  private get nodes(): Record<string, NodeRec> {
    const f = this.server.level.flags as { endNodes?: Record<string, NodeRec> };
    return (f.endNodes ??= {});
  }

  /** All nodes (key, record). */
  nodeList(): [string, NodeRec][] {
    return Object.entries(this.nodes);
  }

  /** Whether a node there works: anywhere in the End, or within 2,000 blocks of the Overworld's spawn. */
  nodeWorks(dim: string, x: number, z: number): boolean {
    if (dim === 'end') return true;
    if (dim !== 'overworld') return false;
    const s = this.server.level.spawn ?? [0, 64, 0];
    return Math.hypot(x - s[0], z - s[2]) <= NODE.overworldRange;
  }

  onNodePlaced(p: ServerPlayer, dim: Dimension, x: number, y: number, z: number, cheat: boolean): void {
    const n = Object.keys(this.nodes).length + 1;
    this.nodes[nodeKey(dim.id, x, y, z)] = { name: `Node ${n}`, owner: p.uuid, ownerName: p.name, ...(cheat ? { cheat: true } : {}) };
  }

  nodeGone(dim: Dimension, x: number, y: number, z: number): void {
    delete this.nodes[nodeKey(dim.id, x, y, z)];
  }

  /** A node's record (made on the spot for a node with none, e.g. placed by a command). */
  private rec(n: EngNode): NodeRec {
    const k = nodeKey(n.dim.id, n.x, n.y, n.z);
    return (this.nodes[k] ??= { name: `Node ${Object.keys(this.nodes).length + 1}`, owner: n.be()?.by ?? '', ownerName: '?', ...(n.be()?.cheat ? { cheat: true } : {}) });
  }

  private mayUse(r: NodeRec, p: ServerPlayer | undefined): boolean {
    return !r.locked || (!!p && r.owner === p.uuid);
  }

  /** Destinations from a node, nearest first. */
  destinations(n: EngNode, viewer?: ServerPlayer): { key: string; rec: NodeRec; dist: number; cost: number; ok: boolean }[] {
    const here = nodeKey(n.dim.id, n.x, n.y, n.z);
    const energy = n.be()?.energy ?? 0;
    const out: { key: string; rec: NodeRec; dist: number; cost: number; ok: boolean }[] = [];
    for (const [k, r] of this.nodeList()) {
      if (k === here) continue;
      const d = parseKey(k);
      if (d.dim !== n.dim.id || !this.nodeWorks(d.dim, d.x, d.z)) continue;
      const dist = Math.hypot(d.x - n.x, d.y - n.y, d.z - n.z);
      const cost = nodeCost(dist);
      out.push({ key: k, rec: r, dist, cost, ok: energy >= cost && this.mayUse(r, viewer) });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  nodeProps(n: EngNode, p: MachineProps, viewer?: ServerPlayer): void {
    const r = this.rec(n);
    const owner = !!viewer && viewer.uuid === r.owner;
    const works = this.nodeWorks(n.dim.id, n.x, n.z);
    p.field = { key: 'name', value: r.name, max: NODE.nameMax, placeholder: 'Node name', editable: !!viewer && (owner || !r.locked) && this.server.roleOf(viewer) !== 'visitor' };
    p.info.push(`Owner: ${r.ownerName}${r.locked ? ' (locked: only they can use it)' : ' (public)'}`);
    if (!works) p.info.push(n.dim.id === 'overworld' ? `Out of range: in the Overworld nodes work within ${NODE.overworldRange.toLocaleString('en-US')} blocks of spawn` : 'Nodes don\'t work in this dimension');
    else p.info.push(`A trip costs ${NODE.base.toLocaleString('en-US')} EU + ${NODE.perBlock} EU a block. Stand on the node, then pick where to go.`);
    if (owner) p.buttons.push({ key: 'lock', label: r.locked ? 'Locked: only you' : 'Public: anyone', on: !r.locked });
    p.choicesLabel = 'Destinations';
    p.choices = works
      ? this.destinations(n, viewer)
          .slice(0, 24)
          .map((d) => ({ key: `go:${d.key}`, label: d.rec.name, detail: `${Math.round(d.dist).toLocaleString('en-US')} blocks · ${d.cost.toLocaleString('en-US')} EU${d.rec.locked && d.rec.owner !== viewer?.uuid ? ' · locked' : ''}`, ok: d.ok }))
      : [];
  }

  nodeCfg(pl: ServerPlayer, n: EngNode, key: string, value: string | number): boolean {
    const r = this.rec(n);
    const owner = pl.uuid === r.owner;
    if (key === 'name') {
      if (!owner && r.locked) return true;
      const name = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NODE.nameMax);
      if (name) r.name = name;
      return true;
    }
    if (key === 'lock') {
      if (owner) r.locked = !r.locked;
      return true;
    }
    if (key.startsWith('go:')) {
      this.startTrip(pl, n, key.slice(3));
      return true;
    }
    return false;
  }

  private onNode(p: ServerPlayer, x: number, y: number, z: number): boolean {
    return p.dim.id !== undefined && Math.abs(p.x - (x + 0.5)) <= 0.75 && Math.abs(p.z - (z + 0.5)) <= 0.75 && p.y >= y + 0.9 && p.y <= y + 1.7;
  }

  private startTrip(p: ServerPlayer, n: EngNode, to: string): void {
    const fromKey = nodeKey(n.dim.id, n.x, n.y, n.z);
    if (!this.nodes[to]) return;
    if (!this.onNode(p, n.x, n.y, n.z)) {
      p.send({ t: 'chat', text: 'Stand on the node to travel from it.', kind: 'error' });
      return;
    }
    if (!this.nodeWorks(n.dim.id, n.x, n.z)) return;
    if (!this.mayUse(this.rec(n), p) || !this.mayUse(this.nodes[to]!, p)) {
      p.send({ t: 'chat', text: 'That node is locked by its owner.', kind: 'error' });
      return;
    }
    this.warmups.set(p, { from: fromKey, to, left: NODE.warmup, wait: 100 });
    this.server.interaction.closeWindow(p, p.windowId);
    this.server.playSound(n.dim, 'block.node_warmup', n.x + 0.5, n.y + 1, n.z + 0.5, 1, 1);
  }

  private tickWarmups(): void {
    const s = this.server;
    for (const [p, w] of [...this.warmups]) {
      const from = parseKey(w.from);
      const to = parseKey(w.to);
      if (!s.players.has(p.conn.id) || p.dead || p.dim.id !== from.dim || !this.onNode(p, from.x, from.y, from.z)) {
        this.warmups.delete(p);
        if (s.players.has(p.conn.id) && !p.dead) p.send({ t: 'chat', text: 'You stepped off the node: the trip is cancelled.', kind: 'system' });
        continue;
      }
      // Load the far end while the node warms up
      p.dim.want(to.x >> 4, to.z >> 4, 1, s.tickNo);
      if (w.left > 0) {
        w.left--;
        if (w.left % 2 === 0) s.particles(p.dim, 'portal', from.x + 0.5, from.y + 1.2, from.z + 0.5, 6, 0.5);
        continue;
      }
      if (!p.dim.isLoaded(to.x, to.z)) {
        if (--w.wait > 0) continue;
        this.warmups.delete(p);
        p.send({ t: 'chat', text: 'The far node doesn\'t answer.', kind: 'error' });
        continue;
      }
      this.warmups.delete(p);
      this.trip(p, w.from, w.to);
    }
  }

  /** The trip itself, checked again from scratch: both nodes, the cost, a clear way out. */
  private trip(p: ServerPlayer, fromKey: string, toKey: string): boolean {
    const s = this.server;
    const from = parseKey(fromKey);
    const to = parseKey(toKey);
    const eng = s.engineering;
    const fromNode = eng?.node(p.dim, from.x, from.y, from.z);
    const toRec = this.nodes[toKey];
    const fromRec = this.nodes[fromKey];
    if (!fromNode || fromNode.c.id !== 'teleport_node' || !toRec || !fromRec) return false;
    if (to.dim !== p.dim.id) {
      p.send({ t: 'chat', text: 'Nodes don\'t reach across dimensions.', kind: 'error' });
      return false;
    }
    if (!this.nodeWorks(from.dim, from.x, from.z) || !this.nodeWorks(to.dim, to.x, to.z)) return false;
    if (!this.mayUse(fromRec, p) || !this.mayUse(toRec, p)) return false;
    if (p.dim.blockId(to.x, to.y, to.z) !== 'teleport_node') {
      delete this.nodes[toKey];
      p.send({ t: 'chat', text: 'The far node is gone.', kind: 'error' });
      return false;
    }
    if (!this.clear(p.dim, to.x, to.y + 1, to.z) || !this.clear(p.dim, to.x, to.y + 2, to.z)) {
      p.send({ t: 'chat', text: `The way out at ${toRec.name} is blocked.`, kind: 'error' });
      s.playSound(p.dim, 'block.node_fail', from.x + 0.5, from.y + 1, from.z + 0.5, 1, 1);
      return false;
    }
    const be = fromNode.be()!;
    const cost = nodeCost(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z));
    if ((be.energy ?? 0) < cost) {
      p.send({ t: 'chat', text: `Not enough power: the trip needs ${cost.toLocaleString('en-US')} EU.`, kind: 'error' });
      return false;
    }
    be.energy = (be.energy ?? 0) - cost;
    fromNode.dirty = true;
    s.playSound(p.dim, 'block.node_go', from.x + 0.5, from.y + 1, from.z + 0.5, 1, 1);
    s.teleport(p, to.x + 0.5, to.y + 1, to.z + 0.5);
    s.playSound(p.dim, 'block.node_go', to.x + 0.5, to.y + 1, to.z + 0.5, 1, 1.2);
    s.particles(p.dim, 'portal', to.x + 0.5, to.y + 1.2, to.z + 0.5, 30, 0.6);
    if (fromRec.owner === p.uuid && toRec.owner === p.uuid && !fromRec.cheat && !toRec.cheat && !s.admin.inContext(p)) s.interaction.grant(p, 'teleport_own_nodes');
    return true;
  }

  /** Room to stand: nothing solid, no fluid or fire. */
  private clear(dim: Dimension, x: number, y: number, z: number): boolean {
    const st = dim.getState(x, y, z);
    if (STATE_FLUID[st]) return false;
    if (collisionShape(st).length) return false;
    const id = blocks[STATE_BLOCK[st]!]!.id;
    return !/fire|lava|magma|cactus|campfire/.test(id);
  }

  // ------------------------------------------------------------------ ancient gateways

  private tickGateways(): void {
    const s = this.server;
    for (const p of s.players.values()) {
      if (p.dead || p.gamemode === 'spectator') continue;
      const cd = this.gatewayCooldown.get(p) ?? 0;
      const t = this.transits.get(p);
      if (t) {
        t.dim.want(t.to[0] >> 4, t.to[2] >> 4, 1, s.tickNo);
        if (p.dim !== t.dim) this.transits.delete(p);
        else if (t.dim.isLoaded(t.to[0], t.to[2])) {
          // (null: the far side isn't ready yet, such as the Sanctum before its chunks load)
          const spot = s.endQuests ? s.endQuests.landing(t.dim, t.to) : t.to;
          if (!spot) {
            if (s.tickNo - t.since > 400) this.transits.delete(p);
            continue;
          }
          this.transits.delete(p);
          s.teleport(p, spot[0] + 0.5, spot[1], spot[2] + 0.5);
          s.playSound(p.dim, 'block.gateway_go', spot[0] + 0.5, spot[1] + 1, spot[2] + 0.5, 1, 0.8);
          this.gatewayCooldown.set(p, s.tickNo + 60);
        } else if (s.tickNo - t.since > 400) this.transits.delete(p);
        continue;
      }
      if (cd > s.tickNo) continue;
      const x = Math.floor(p.x);
      const z = Math.floor(p.z);
      let gate: P3 | null = null;
      for (const dy of [0, 1]) {
        const y = Math.floor(p.y + dy);
        if (p.dim.blockId(x, y, z) === 'ancient_gateway') gate = [x, y, z];
      }
      if (!gate) continue;
      const to = s.endQuests?.gatewayExit(p, p.dim, gate[0], gate[1], gate[2]);
      if (!to) continue;
      this.transits.set(p, { to, dim: p.dim, since: s.tickNo });
      s.playSound(p.dim, 'block.gateway_go', p.x, p.y + 1, p.z, 1, 1);
      this.gatewayCooldown.set(p, s.tickNo + 60);
    }
  }

  // ------------------------------------------------------------------ vehicles

  /** Right click on a vehicle: get in (or refuel a skiff). True when handled. */
  interact(p: ServerPlayer, m: Mob, held: ItemStack | null, slot: number): boolean {
    if (!m.def.vehicle) return false;
    if (m.dead || m.removed || p.sneaking) return true;
    if (m.def.vehicle === 'skiff' && held && itemIdOf(held) === 'void_shard') {
      const tank = Number(m.data.fuel ?? 0);
      if (tank >= SKIFF.tank) {
        p.send({ t: 'chat', text: 'The skiff\'s tank is full.', kind: 'system' });
        return true;
      }
      const add = Math.min(held.count, SKIFF.tank - tank);
      m.data.fuel = tank + add;
      if (p.gamemode !== 'creative') p.inventory.set(slot, held.count > add ? { ...held, count: held.count - add } : null);
      if (isAdminStack(held)) m.data.cheatFuel = true;
      this.server.playSound(m.dim, 'block.skiff_fuel', m.x, m.y + 0.5, m.z, 0.8, 1);
      p.send({ t: 'chat', text: `Void Skiff: ${m.data.fuel} void shards in the tank (${Math.round((Number(m.data.fuel) * SKIFF.fuelTicks) / 20 / 60)} minutes).`, kind: 'system' });
      return true;
    }
    if (p.vehicle) return true;
    if (!m.rider) this.board(p, m, 'pilot');
    else if (m.def.vehicle === 'skiff' && !m.data.passenger) this.board(p, m, 'passenger');
    return true;
  }

  private board(p: ServerPlayer, m: Mob, role: 'pilot' | 'passenger'): void {
    this.server.interaction.stopUsing(p);
    p.vehicle = m;
    if (role === 'pilot') m.rider = p;
    else m.data.passenger = p.uuid;
    m.riderControl = false;
    m.persistenceRequired = true;
    m.metaDirty = true;
    p.metaDirty = true;
    const def = m.def.mount!;
    p.send({ t: 'mount', id: m.id, control: false, seat: def.seat, width: m.def.width, height: m.def.height, speed: 0, jump: 0, x: m.x, y: m.y, z: m.z, yaw: m.yaw, kind: m.def.vehicle, pilot: role === 'pilot' });
    this.server.playSound(m.dim, m.def.vehicle === 'skiff' ? 'block.skiff_board' : 'block.cart_board', m.x, m.y + 0.5, m.z, 0.7, 1);
    if (m.def.vehicle === 'skiff' && role === 'pilot') {
      m.data.climb = [];
      if (!Number(m.data.fuel ?? 0) && !Number(m.data.burn ?? 0)) p.send({ t: 'title', text: '', sub: 'The skiff has no fuel: feed it Void Shards', ticks: 50 });
    }
  }

  /** A vehicle was hit: it breaks into its item after enough knocks (instantly in creative). */
  vehicleHurt(m: Mob, amount: number, info: HurtInfo): number {
    if (m.removed) return 0;
    const atk = info.attacker as ServerPlayer | null | undefined;
    const byPlayer = !!atk && (atk as { conn?: unknown }).conn !== undefined;
    if (info.source === 'void' || info.source === 'kill') {
      this.breakVehicle(m, false);
      return amount;
    }
    const creative = byPlayer && atk!.gamemode === 'creative';
    m.data.dmg = Number(m.data.dmg ?? 0) + (creative ? 1000 : amount);
    m.hurtTime = 10;
    m.metaDirty = true;
    this.server.playSound(m.dim, 'block.vehicle_hit', m.x, m.y + 0.5, m.z, 0.6, 1);
    if (Number(m.data.dmg) >= m.def.health) this.breakVehicle(m, !creative);
    return amount;
  }

  private breakVehicle(m: Mob, drop: boolean): void {
    for (const p of this.server.players.values()) if (p.vehicle === m) this.server.mounts?.dismount(p);
    if (drop) {
      const st = stackOf(m.def.vehicle === 'skiff' ? 'void_skiff' : 'minecart', 1);
      this.server.mining.dropItem(m.dim, m.x, m.y + 0.3, m.z, m.data.cheat ? markAdmin(st) : st);
      // What was left in the skiff's tank
      const fuel = Number(m.data.fuel ?? 0);
      if (fuel > 0) this.server.mining.dropItem(m.dim, m.x, m.y + 0.3, m.z, m.data.cheatFuel ? markAdmin(stackOf('void_shard', fuel)) : stackOf('void_shard', fuel));
    }
    m.remove();
  }

  /** Using a vehicle item: a minecart onto a rail, a skiff onto a block or out in front over the void. */
  placeVehicle(p: ServerPlayer, stack: ItemStack, slot: number, at?: P3): boolean {
    const id = itemIdOf(stack);
    if (id !== 'minecart' && id !== 'void_skiff') return false;
    const dim = p.dim;
    let x: number;
    let y: number;
    let z: number;
    if (id === 'minecart') {
      if (!at || !isRail(dim.getState(at[0], at[1], at[2]))) return true;
      [x, y, z] = [at[0] + 0.5, at[1] + 0.0625, at[2] + 0.5];
    } else if (at) [x, y, z] = [at[0] + 0.5, at[1] + 1.05, at[2] + 0.5];
    else {
      const d = lookDir(p.yaw, 0);
      [x, y, z] = [p.x + d[0] * 2.5, p.y + 0.4, p.z + d[2] * 2.5];
    }
    const m = this.server.mobs?.spawn(dim, id === 'minecart' ? 'minecart' : 'void_skiff', x, y, z, { persistent: true, reason: 'item' });
    if (!m) return true;
    m.yaw = p.yaw;
    m.controlled = true;
    m.noAi = true;
    if (bodyObstructed(dim, m.body, 0.05)) {
      m.remove();
      return true;
    }
    if (isAdminStack(stack) || this.server.admin.inContext(p)) m.data.cheat = true;
    if (p.gamemode !== 'creative') p.inventory.set(slot, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
    this.server.playSound(dim, 'block.vehicle_place', x, y, z, 0.8, 1);
    return true;
  }

  /** The Void Skiff blueprint teaches its recipe. */
  useBlueprint(p: ServerPlayer, stack: ItemStack, slot: number): boolean {
    if (itemIdOf(stack) !== 'void_skiff_blueprint') return false;
    const recipe = Object.entries(LOCKED_RECIPES).find(([, bp]) => bp === 'void_skiff_blueprint')![0];
    if (p.recipes.has(recipe)) {
      p.send({ t: 'chat', text: 'You already know how to build a Void Skiff.', kind: 'system' });
      return true;
    }
    p.recipes.add(recipe);
    if (p.gamemode !== 'creative') p.inventory.set(slot, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
    p.send({ t: 'recipes', unlocked: [...p.recipes] });
    p.send({ t: 'title', text: '', sub: 'You learned to build the Void Skiff', ticks: 60 });
    this.server.playSound(p.dim, 'ui.learn', p.x, p.y + 1, p.z, 1, 1);
    return true;
  }

  /** The pilot's controls (forward, sideways, up/down), from their client. */
  pilot(p: ServerPlayer, f: number, s: number, v: number): void {
    const m = p.vehicle as Mob | null;
    if (!m || m.rider !== p || m.def.vehicle !== 'skiff') return;
    this.pilots.set(p, { f: Math.max(-1, Math.min(1, f)), s: Math.max(-1, Math.min(1, s)), v: Math.sign(v) });
  }

  private tickVehicles(): void {
    for (const dim of this.server.dims.values()) {
      for (const e of dim.entities.values()) {
        if (!(e instanceof Mob) || !e.def.vehicle || e.removed) continue;
        e.controlled = true;
        e.noAi = true;
        if (e.def.vehicle === 'minecart') this.tickCart(e);
        else this.tickSkiff(e);
      }
    }
  }

  // ---- minecarts

  /** The rail a cart is on (its block, or the one below it on a slope). */
  private railUnder(dim: Dimension, x: number, y: number, z: number): P3 | null {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (const by of [Math.floor(y), Math.floor(y - 0.5)]) if (isRail(dim.getState(bx, by, bz))) return [bx, by, bz];
    return null;
  }

  private tickCart(m: Mob): void {
    const dim = m.dim;
    const b = m.body;
    const rail = this.railUnder(dim, b.x, b.y, b.z);
    if (!rail) {
      // Off the rails: it falls and slides like a box
      b.vy -= 0.04;
      b.vx *= 0.95;
      b.vz *= 0.95;
      moveBody(dim, b, b.vx, b.vy, b.vz);
      if (b.onGround) b.vy = 0;
      if (b.y < -64) this.breakVehicle(m, false);
      dim.updateBucket(m);
      return;
    }
    const st = dim.getState(...rail);
    const shape = getProp(st, 'shape') ?? 'north_south';
    const id = blocks[STATE_BLOCK[st]!]!.id;
    const powered = getProp(st, 'powered') === 'true';
    const [e1, e2] = railEnds(shape);
    const v1 = SIDE[e1.side];
    const v2 = SIDE[e2.side];
    // Heading: the end the cart's motion points to more
    let speed = Number(m.data.speed ?? 0);
    let hx = Number(m.data.hx ?? v2[0]);
    let hz = Number(m.data.hz ?? v2[1]);
    // Pushed by players walking into it
    for (const p of dim.entitiesNear(b.x, b.y, b.z, 1.4)) {
      if (p === m.rider || !(p as ServerPlayer).conn || (p as ServerPlayer).dead) continue;
      const dx = b.x - p.x;
      const dz = b.z - p.z;
      const dd = Math.hypot(dx, dz);
      if (dd > 1.1 || dd < 1e-3) continue;
      const along1 = dx * v1[0] + dz * v1[1];
      const along2 = dx * v2[0] + dz * v2[1];
      const toward = along2 >= along1 ? v2 : v1;
      if (speed < 0.08 || hx * toward[0] + hz * toward[1] <= 0) {
        hx = toward[0];
        hz = toward[1];
        speed = Math.max(speed, 0.1);
      }
    }
    const goingTo = hx * v2[0] + hz * v2[1] >= hx * v1[0] + hz * v1[1] ? e2 : e1;
    const from = goingTo === e2 ? e1 : e2;
    const out = SIDE[goingTo.side];
    // Slopes speed it up downhill and slow it uphill
    if (goingTo.up) speed -= CART.slope;
    else if (from.up) speed += CART.slope;
    // Powered rails: a powered one drives the cart, an unpowered one brakes it
    if (id === 'powered_rail' || id === 'ender_rail') {
      if (powered) {
        const max = id === 'ender_rail' ? CART.ender : CART.powered;
        if (speed < 0.02) {
          // A cart at rest starts away from a solid block behind it
          const back = SIDE[from.side];
          if (STATE_SOLID[dim.getState(rail[0] + back[0], rail[1], rail[2] + back[1])]) speed = 0.1;
        }
        if (speed > 0.01) speed = Math.min(max, speed + (id === 'ender_rail' ? CART.enderPush : CART.push));
      } else {
        speed *= CART.brake;
        if (speed < 0.03) speed = 0;
      }
    }
    speed *= CART.friction;
    // Off an Ender Rail it slows back to an ordinary top speed
    if (id !== 'ender_rail' && speed > CART.powered) speed = Math.max(CART.powered, speed * 0.97);
    speed = Math.max(0, Math.min(CART.max, speed));
    if (speed < 0.003) speed = 0;
    // Move: along the way in (to the middle), then along the way out
    const cx = rail[0] + 0.5;
    const cz = rail[2] + 0.5;
    let left = speed;
    let x = b.x;
    let z = b.z;
    const inV = SIDE[from.side];
    const passed = (x - cx) * out[0] + (z - cz) * out[1] >= -1e-6;
    if (!passed) {
      // Still between the way in and the middle: snap onto that line and head for the middle
      const tx = cx;
      const tz = cz;
      if (inV[0] !== 0) z = cz;
      else x = cx;
      const d = Math.hypot(tx - x, tz - z);
      const step = Math.min(left, d);
      if (d > 1e-6) {
        x += ((tx - x) / d) * step;
        z += ((tz - z) / d) * step;
      }
      left -= step;
    }
    if (out[0] !== 0) z = cz;
    else x = cx;
    x += out[0] * left;
    z += out[1] * left;
    // Height along the rail
    const frac = Math.max(0, Math.min(1, (x - rail[0]) * Math.abs(out[0]) + (z - rail[2]) * Math.abs(out[1])));
    let y = rail[1] + 0.0625;
    if (goingTo.up) y += out[0] + out[1] > 0 ? frac : 1 - frac;
    else if (from.up) y += out[0] + out[1] > 0 ? 1 - frac : frac;
    // Leaving the block: is there a rail to go on to?
    const nbx = Math.floor(x);
    const nbz = Math.floor(z);
    if (nbx !== rail[0] || nbz !== rail[2]) {
      const ny = rail[1] + (goingTo.up ? 1 : 0);
      const next = [ny, ny - 1].find((yy) => isRail(dim.getState(nbx, yy, nbz)));
      if (next === undefined) {
        const solid = STATE_SOLID[dim.getState(nbx, ny, nbz)];
        if (solid) {
          // Buffer stop
          x = cx + out[0] * 0.49;
          z = cz + out[1] * 0.49;
          speed = 0;
        } else {
          // Off the end of the line
          b.vx = out[0] * speed;
          b.vz = out[1] * speed;
          b.vy = 0;
        }
      } else if (next < ny) y = next + 0.0625 + 1;
    }
    m.data.speed = speed;
    m.data.hx = out[0];
    m.data.hz = out[1];
    m.yaw = Math.atan2(-out[0], -out[1]);
    m.setPos(x, y, z);
    b.vx = out[0] * speed;
    b.vz = out[1] * speed;
    b.onGround = true;
    dim.updateBucket(m);
    if (speed > 0.05 && this.server.tickNo % 8 === 0) this.server.playSound(dim, 'block.cart_roll', x, y, z, Math.min(1, speed * 2), 0.8 + speed);
  }

  // ---- the Void Skiff

  /** The top of the ground under a point (within 32 blocks), or null over the void. */
  private groundBelow(dim: Dimension, x: number, y: number, z: number): number | null {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let yy = Math.floor(y); yy >= Math.max(0, Math.floor(y) - 32); yy--) {
      const st = dim.getState(bx, yy, bz);
      if (STATE_SOLID[st] || STATE_FLUID[st]) return yy + 1;
    }
    return null;
  }

  private tickSkiff(m: Mob): void {
    const s = this.server;
    const dim = m.dim;
    const b = m.body;
    const pilot = m.rider as ServerPlayer | null;
    const input = pilot ? (this.pilots.get(pilot) ?? { f: 0, s: 0, v: 0 }) : { f: 0, s: 0, v: 0 };
    if (pilot) m.yaw = pilot.yaw;
    // Fuel: a shard every 30 seconds while someone is aboard
    let burn = Number(m.data.burn ?? 0);
    const aboard = !!pilot || !!m.data.passenger;
    if (aboard && burn <= 0 && Number(m.data.fuel ?? 0) > 0) {
      m.data.fuel = Number(m.data.fuel) - 1;
      burn = SKIFF.fuelTicks;
    }
    if (aboard && burn > 0) burn--;
    m.data.burn = burn;
    const flying = burn > 0;
    // The client shows the void crystals glowing while it burns
    if (!!m.data.lit !== flying) {
      if (flying) m.data.lit = true;
      else delete m.data.lit;
      m.metaDirty = true;
    }
    if (aboard && !flying && s.tickNo % 40 === 0 && pilot) pilot.send({ t: 'title', text: '', sub: 'Out of fuel: the skiff is sinking', ticks: 40 });
    // Where it wants to be
    const d = lookDir(m.yaw, 0);
    const side = lookDir(m.yaw + Math.PI / 2, 0);
    let vx = 0;
    let vz = 0;
    let vy = 0;
    if (flying) {
      vx = (d[0] * input.f + side[0] * -input.s * 0.6) * SKIFF.speed;
      vz = (d[2] * input.f + side[2] * -input.s * 0.6) * SKIFF.speed;
      vy = input.v * SKIFF.vSpeed;
      // It keeps its hover height over whatever lies below (holds its height over the void)
      const ground = this.groundBelow(dim, b.x, b.y, b.z);
      if (ground !== null && b.y < ground + SKIFF.hover - 0.05 && input.v <= 0) vy = Math.max(vy, Math.min(SKIFF.vSpeed, ground + SKIFF.hover - b.y));
    } else vy = aboard ? -SKIFF.sink : -0.08;
    // It can never be more than 16 blocks above the lowest it was in the last minute
    const hist = Array.isArray(m.data.climb) ? (m.data.climb as number[]) : [];
    if (s.tickNo % 20 === 0) {
      hist.push(b.y);
      while (hist.length > SKIFF.climbWindow / 20) hist.shift();
      m.data.climb = hist;
    }
    const low = Math.min(b.y, ...hist);
    if (vy > 0 && b.y + vy > low + SKIFF.climb) vy = Math.max(0, low + SKIFF.climb - b.y);
    // Smooth the motion a little
    b.vx += (vx - b.vx) * 0.3;
    b.vz += (vz - b.vz) * 0.3;
    b.vy = vy;
    const ox = b.x;
    const oz = b.z;
    moveBody(dim, b, b.vx, b.vy, b.vz);
    if (b.y < -64) {
      this.breakVehicle(m, false);
      return;
    }
    dim.updateBucket(m);
    // Crossing the void (the pilot's advancement)
    if (pilot && !m.data.cheat && !s.admin.inContext(pilot) && this.groundBelow(dim, b.x, b.y, b.z) === null) {
      const voidDist = Number(m.data.voidDist ?? 0) + Math.hypot(b.x - ox, b.z - oz);
      m.data.voidDist = voidDist;
      if (voidDist >= 500) s.interaction.grant(pilot, 'skiff_across_void');
    }
    if (flying && aboard && s.tickNo % 30 === 0) s.playSound(dim, 'block.skiff_hum', b.x, b.y + 0.5, b.z, 0.5, 1);
    if (flying && aboard && s.tickNo % 4 === 0) s.particles(dim, 'portal', b.x, b.y, b.z, 2, 0.6);
  }

  // ------------------------------------------------------------------ Ender Bridges (the advancement)

  private tickBridgeWalk(): void {
    const s = this.server;
    if (s.tickNo % 10 !== 0) return;
    for (const p of s.players.values()) {
      if (p.dead || p.dim.id !== 'end' || s.admin.inContext(p)) continue;
      const bx = Math.floor(p.x);
      const by = Math.floor(p.y - 0.1);
      const bz = Math.floor(p.z);
      const onLight = p.dim.blockId(bx, by, bz) === 'ender_light' && this.groundBelow(p.dim, p.x, by - 1, p.z) === null;
      const w = this.bridgeWalk.get(p);
      if (!onLight) {
        if (w) this.bridgeWalk.delete(p);
        continue;
      }
      if (!w) {
        this.bridgeWalk.set(p, { d: 0, x: p.x, z: p.z });
        continue;
      }
      w.d += Math.hypot(p.x - w.x, p.z - w.z);
      w.x = p.x;
      w.z = p.z;
      if (w.d >= 24) s.interaction.grant(p, 'cross_ender_bridge');
    }
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    this.tickWarmups();
    this.tickGateways();
    this.tickVehicles();
    this.tickBridgeWalk();
  }

  onLeave(p: ServerPlayer): void {
    this.warmups.delete(p);
    this.transits.delete(p);
    this.gatewayCooldown.delete(p);
    this.pilots.delete(p);
    this.bridgeWalk.delete(p);
  }

  status(): Record<string, unknown> {
    return { nodes: this.nodeList().length };
  }
}

