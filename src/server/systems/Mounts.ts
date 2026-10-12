/**
 * Riding and leads.
 *
 * Riding: saddled, tamed horses (and camels) are steered by the rider's
 * client, which simulates the mount and sends its position; the server checks
 * each step. Saddled pigs walk where a Carrot on a Stick points; untamed
 * horses buck until they accept their rider. Riders sit on the mount's seat.
 *
 * Leads: a lead ties an animal to the player (it follows, is pulled when it
 * lags behind and the lead snaps past 10 blocks) or to a fence post.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { Mob } from '../entity/Mob';
import { type ItemStack, stackOf } from '../../common/game/itemstack';
import { items } from '../../common/registry/items';
import { blocks, STATE_BLOCK } from '../../common/registry/blocks';
import { bodyObstructed } from '../../common/physics/movement';
import { lookDir } from './Interaction';
import { Random } from '../../common/math/rng';


const HORSE_FOOD: Record<string, { heal: number; temper: number }> = {
  wheat: { heal: 2, temper: 3 },
  sugar: { heal: 1, temper: 3 },
  apple: { heal: 3, temper: 3 },
  golden_carrot: { heal: 4, temper: 5 },
  golden_apple: { heal: 10, temper: 10 },
  hay_block: { heal: 20, temper: 0 },
};

/** Animals a lead can hold. */
function leashable(m: Mob): boolean {
  const d = m.def;
  if (d.id === 'iron_golem' || d.id === 'sky_ray') return true;
  return d.category === 'creature' && !d.aquatic && !d.flying && !d.farlands;
}

export class Mounts {
  private readonly rng = new Random();

  constructor(private readonly server: GameServer) {}

  // ------------------------------------------------------------------ interaction

  /** Right click on a mob. Returns true when riding or leads handled it. */
  interact(p: ServerPlayer, m: Mob, held: ItemStack | null, slot: number): boolean {
    const id = held ? items[held.id]!.id : '';
    const def = m.def.mount;
    const survival = p.gamemode !== 'creative';
    const consume = (): void => {
      if (survival && held) p.inventory.set(slot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
    };
    // Leads: untie from you, or tie on
    if (m.data.leash === p.uuid) {
      this.unleash(m, true);
      return true;
    }
    if (id === 'lead' && leashable(m) && !m.data.leash && !m.data.leashPos) {
      m.data.leash = p.uuid;
      m.persistenceRequired = true;
      m.metaDirty = true;
      consume();
      this.server.playSound(m.dim, 'lead.tie', m.x, m.y + 1, m.z, 1, 1);
      return true;
    }
    if (!def || m.baby) return false;
    // Horses eat to heal and calm down
    if (m.type === 'horse' && HORSE_FOOD[id]) {
      const f = HORSE_FOOD[id]!;
      if (m.health >= m.maxHealth && (m.owner || f.temper === 0)) return false;
      m.health = Math.min(m.maxHealth, m.health + f.heal);
      m.data.temper = Math.min(100, Number(m.data.temper ?? 0) + f.temper);
      consume();
      this.server.playSound(m.dim, 'eat', m.x, m.y + 1.4, m.z, 0.8, 1);
      this.server.particles(m.dim, 'happy', m.x, m.y + 1.5, m.z, 5, 0.5);
      return true;
    }
    if (id === 'saddle' && !m.data.saddle && (!def.tame || m.owner)) {
      m.data.saddle = true;
      m.metaDirty = true;
      consume();
      this.server.playSound(m.dim, 'saddle.equip', m.x, m.y + 1, m.z, 1, 1);
      return true;
    }
    if (p.sneaking || m.rider || this.riding(p)) return false;
    // Mounting: saddled animals; untamed horses can be mounted bare-backed to tame them
    const taming = def.tame && !m.owner;
    if (!taming && !m.data.saddle) return false;
    if (held && id !== 'carrot_on_a_stick' && !taming) return false;
    this.mount(p, m, !taming && def.control === 'client');
    return true;
  }

  /** Right click on a fence: ties every animal on your lead to it. */
  useFence(p: ServerPlayer, x: number, y: number, z: number): boolean {
    let tied = 0;
    for (const e of p.dim.entitiesNear(p.x, p.y, p.z, 12)) {
      if (!(e instanceof Mob) || e.data.leash !== p.uuid) continue;
      delete e.data.leash;
      e.data.leashPos = [x, y, z];
      e.metaDirty = true;
      tied++;
    }
    if (tied) this.server.playSound(p.dim, 'lead.tie', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return tied > 0;
  }

  // ------------------------------------------------------------------ riding

  riding(p: ServerPlayer): Mob | null {
    return p.vehicle as Mob | null;
  }

  mount(p: ServerPlayer, m: Mob, control: boolean): void {
    const def = m.def.mount!;
    this.server.interaction.stopUsing(p);
    p.vehicle = m;
    m.rider = p;
    m.riderControl = control;
    m.persistenceRequired = true;
    m.stopNavigation();
    m.metaDirty = true;
    p.metaDirty = true;
    this.seat(p, m);
    const speed = m.type === 'horse' ? Number(m.data.hspeed ?? 0.225) : m.type === 'camel' ? 0.09 : m.def.speed;
    const jump = m.type === 'horse' ? Number(m.data.hjump ?? 0.7) : m.type === 'camel' ? 0.42 : 0;
    p.send({ t: 'mount', id: m.id, control, seat: def.seat, width: m.def.width, height: m.def.height, speed, jump, x: m.x, y: m.y, z: m.z, yaw: m.yaw });
    if (m.type === 'horse' && !m.owner) m.data.rideTicks = 0;
    this.server.playSound(m.dim, `mob.${m.soundKey()}.idle`, m.x, m.y + 1.2, m.z, 0.8, 1);
  }

  /** Gets the rider off, placing them beside the mount on solid ground. */
  dismount(p: ServerPlayer, silent = false): void {
    const m = p.vehicle as Mob | null;
    if (!m) return;
    p.vehicle = null;
    // V6 phase 4: a Void Skiff's passenger gets off without unseating its pilot
    if (m.data.passenger === p.uuid) delete m.data.passenger;
    else {
      m.rider = null;
      m.riderControl = false;
    }
    m.metaDirty = true;
    p.metaDirty = true;
    p.send({ t: 'mount', id: null });
    if (silent || p.dead) return;
    // Side of the mount, else on top of it
    const dim = m.dim;
    const side = lookDir(m.yaw + Math.PI / 2, 0);
    const spots: [number, number, number][] = [
      [m.x + side[0] * (m.def.width / 2 + 0.6), m.y, m.z + side[2] * (m.def.width / 2 + 0.6)],
      [m.x - side[0] * (m.def.width / 2 + 0.6), m.y, m.z - side[2] * (m.def.width / 2 + 0.6)],
      [m.x, m.y + m.def.height, m.z],
    ];
    for (const [x, y, z] of spots) {
      for (const dy of [0, 1, -1]) {
        const b = { ...p.body, x, y: Math.floor(y) + dy, z };
        if (!bodyObstructed(dim, b, 0.02)) {
          this.server.teleport(p, x, Math.floor(y) + dy, z);
          return;
        }
      }
    }
    this.server.teleport(p, m.x, m.y + m.def.height, m.z);
  }

  private seat(p: ServerPlayer, m: Mob): void {
    const y = m.y + (m.def.mount?.seat ?? m.def.height * 0.75);
    // A skiff's passenger sits behind the pilot
    const back = m.data.passenger === p.uuid ? lookDir(m.yaw, 0) : null;
    const x = back ? m.x - back[0] * 0.6 : m.x;
    const z = back ? m.z - back[2] * 0.6 : m.z;
    p.setPos(x, y, z);
    p.lastValidX = x;
    p.lastValidY = y;
    p.lastValidZ = z;
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.body.fallDistance = 0;
    p.dim.updateBucket(p);
  }

  /** The rider's client moved the mount it steers. */
  vehicleMove(p: ServerPlayer, x: number, y: number, z: number, yaw: number): void {
    const m = p.vehicle as Mob | null;
    if (!m || !m.riderControl || m.dead || m.removed) return;
    const dx = x - m.x;
    const dy = y - m.y;
    const dz = z - m.z;
    const b = { ...m.body, x, y, z };
    const bad = dx * dx + dz * dz > 2.2 * 2.2 || Math.abs(dy) > 3 || !m.dim.isLoaded(x, z) || bodyObstructed(m.dim, b, 0.05);
    if (bad) {
      p.send({ t: 'vehicle_pos', x: m.x, y: m.y, z: m.z });
      return;
    }
    m.setPos(x, y, z);
    m.yaw = yaw;
    m.headYaw = yaw;
    m.dim.updateBucket(m);
    this.seat(p, m);
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const s = this.server;
    for (const p of s.players.values()) {
      const m = p.vehicle as Mob | null;
      if (!m) continue;
      if (m.dead || m.removed || m.dim !== p.dim || p.dead || p.gamemode === 'spectator') {
        this.dismount(p, p.dead || m.dim !== p.dim);
        continue;
      }
      if (!m.riderControl) this.driveUncontrolled(p, m);
      this.seat(p, m);
    }
    // Leads
    if (s.tickNo % 2 === 0) {
      for (const dim of s.dims.values()) {
        for (const e of dim.entities.values()) {
          if (!(e instanceof Mob) || (!e.data.leash && !e.data.leashPos) || e.dead) continue;
          this.tickLeash(e);
        }
      }
    }
  }

  /** Pigs follow a Carrot on a Stick; untamed horses buck and may accept the rider. */
  private driveUncontrolled(p: ServerPlayer, m: Mob): void {
    const s = this.server;
    if (m.type === 'pig') {
      const held = [p.inventory.get(p.selectedSlot), p.inventory.get(40)].some((st) => st && items[st.id]!.id === 'carrot_on_a_stick');
      if (held) {
        const d = lookDir(p.yaw, 0);
        const boost = Number(m.data.boostTicks ?? 0);
        if (boost > 0) m.data.boostTicks = boost - 1;
        m.wantPos = { x: m.x + d[0] * 2, y: m.y, z: m.z + d[2] * 2, speed: boost > 0 ? 4 : 2.3 };
      }
      return;
    }
    if (m.type === 'horse' && !m.owner) {
      const t = (m.data.rideTicks = Number(m.data.rideTicks ?? 0) + 1);
      if (t % 20 !== 0) return;
      const temper = Number(m.data.temper ?? 0);
      if (this.rng.int(100) < temper) {
        m.owner = p.uuid;
        m.data.tamedBy = p.uuid;
        s.particles(m.dim, 'heart', m.x, m.y + 1.5, m.z, 7, 0.5);
        s.playSound(m.dim, 'mob.horse.idle', m.x, m.y + 1.2, m.z, 1, 1.2);
        m.metaDirty = true;
        return;
      }
      m.data.temper = Math.min(100, temper + 5);
      if (t >= 40 && this.rng.chance(0.5)) {
        // Bucked off
        s.particles(m.dim, 'smoke', m.x, m.y + 1.5, m.z, 7, 0.5);
        s.playSound(m.dim, 'mob.horse.hurt', m.x, m.y + 1.2, m.z, 1, 1.3);
        this.dismount(p);
      }
    }
  }

  /** Right click with a Carrot on a Stick while riding a pig: a burst of speed. */
  boostPig(p: ServerPlayer): boolean {
    const m = p.vehicle as Mob | null;
    if (!m || m.type !== 'pig') return false;
    const slot = items[p.inventory.get(p.selectedSlot)?.id ?? 0]?.id === 'carrot_on_a_stick' ? p.selectedSlot : 40;
    m.data.boostTicks = 60;
    this.server.interaction.damageStack(p, slot, 7);
    this.server.playSound(m.dim, 'mob.pig.idle', m.x, m.y + 0.8, m.z, 1, 1.3);
    return true;
  }

  // ------------------------------------------------------------------ leads

  private tickLeash(m: Mob): void {
    const s = this.server;
    let hx: number;
    let hy: number;
    let hz: number;
    if (m.data.leashPos) {
      const [x, y, z] = m.data.leashPos as [number, number, number];
      if (!m.dim.isLoaded(x, z)) return;
      const tags = blocks[STATE_BLOCK[m.dim.getState(x, y, z)]!]!.tags;
      if (!tags.has('fences') && !tags.has('walls')) {
        this.unleash(m, true);
        return;
      }
      hx = x + 0.5;
      hy = y + 0.5;
      hz = z + 0.5;
    } else {
      const holder = [...s.players.values()].find((pl) => pl.uuid === m.data.leash);
      if (!holder || holder.dim !== m.dim || holder.dead) {
        // The holder left: wait a while, then the lead drops
        const lost = (m.data.leashLost = Number(m.data.leashLost ?? 0) + 2);
        if (lost > 200) this.unleash(m, true);
        return;
      }
      delete m.data.leashLost;
      hx = holder.x;
      hy = holder.y + 1;
      hz = holder.z;
      if (m.metaHolder !== holder.id) {
        m.metaHolder = holder.id;
        m.metaDirty = true;
      }
    }
    const dx = hx - m.x;
    const dy = hy - m.y;
    const dz = hz - m.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 10) {
      this.unleash(m, true);
      s.playSound(m.dim, 'lead.break', m.x, m.y + 1, m.z, 1, 1);
      return;
    }
    if (d > 6) {
      // Pulled along
      const f = (d - 6) * 0.04;
      m.body.vx += (dx / d) * f;
      m.body.vy += Math.max(0, (dy / d) * f);
      m.body.vz += (dz / d) * f;
    }
    if (d > 3.5 && !m.data.leashPos && s.tickNo % 10 === 0) m.navigateTo(hx, hy - 1, hz, 1.2);
  }

  /** Removes a lead, dropping it as an item. */
  unleash(m: Mob, drop: boolean): void {
    if (!m.data.leash && !m.data.leashPos) return;
    delete m.data.leash;
    delete m.data.leashPos;
    delete m.data.leashLost;
    m.metaHolder = 0;
    m.metaDirty = true;
    if (drop) this.server.mining.dropItem(m.dim, m.x, m.y + 0.5, m.z, stackOf('lead', 1));
  }
}
