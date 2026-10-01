/**
 * V5.5: the Admin Panel's Herobrine tools. Every one of them is a cheat:
 * items it gives are cheat-marked, travel it does is a cheat visit, and a
 * story run it starts or pushes along is a cheat run (it plays out the same
 * but awards nothing and its ending is recorded only as forced).
 */
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import type { DimensionId } from '../../common/data/biomes';
import type { V55Op } from '../../common/game/admin';
import type { ComputerWorldGenerator } from '../../common/gen/computer';
import type { HerobrineSystem } from './Herobrine';
import { END_SPAWN } from '../../common/gen/end';

export interface HerobrineAdminHelpers {
  moveTo(p: ServerPlayer, dim: DimensionId, x: number, y: number, z: number): void;
  give(p: ServerPlayer, id: string, count: number): void;
  safeSpot(dim: Dimension, x: number, y: number, z: number): { x: number; y: number; z: number } | null;
}

type Result = { ok: boolean; text: string; data?: unknown };

export function herobrineAdmin(hb: HerobrineSystem, h: HerobrineAdminHelpers, p: ServerPlayer, op: V55Op): Result {
  const s = hb.server;
  const w = hb.w;
  const ok = (text: string): Result => ({ ok: true, text, data: hb.status() });
  const L = (): ReturnType<ComputerWorldGenerator['layout']> => (s.dim('computer').generator as ComputerWorldGenerator).layout();
  switch (op) {
    case 'status':
      return { ok: true, text: '', data: hb.status() };
    case 'give_potion':
      h.give(p, 'mysterious_potion', 1);
      return ok('Gave a Mysterious Potion (cheat-made).');
    case 'give_hard_drive':
      h.give(p, 'hard_drive', 1);
      return ok('Gave a Hard Drive (cheat-made).');
    case 'give_flash_drive':
      h.give(p, 'flash_drive', 1);
      return ok('Gave a Flash Drive (cheat-made).');
    case 'give_corrupted': {
      const st = hb.makeCorruptedDrive();
      const rest = p.inventory.add(st);
      if (rest) s.interaction.dropStack(p, rest);
      s.interaction.syncInventory(p);
      return ok('Gave a Corrupted Flash Drive (cheat-made, awake: plug it into a running computer in the Overworld).');
    }
    case 'spawn_dragon': {
      const end = s.theEnd;
      if (!end) return { ok: false, text: 'The End is not running.' };
      const fight = end.fight;
      if (fight.dragon && !fight.dragon.dead) {
        if (p.dim.id !== 'end') h.moveTo(p, 'end', END_SPAWN.x + 0.5, END_SPAWN.y, END_SPAWN.z + 0.5);
        return ok('The Ender Dragon is already alive in the End.');
      }
      // The fight brings it back as soon as someone is there (a cheat dragon: its kill counts for nothing)
      s.level.flags.dragonKilled = false;
      s.level.flags.dragonAdmin = true;
      if (p.dim.id !== 'end') {
        end.enterPortal(p, 'end_portal');
        s.admin.onAdminArrival(p, 'end', END_SPAWN.x, END_SPAWN.z, true);
      } else if (s.dim('end').isLoaded(0, 0)) fight.spawnDragon();
      return ok('The Ender Dragon is coming (cheat-spawned).');
    }
    case 'trigger_malware': {
      const d = s.theEnd?.fight.dragon;
      if (d && !d.dead && d.dim === p.dim) {
        hb.malware.infect(d, true);
        hb.malware.spit(d, true, p);
        return ok('The dragon is sick with malware (cheat) and spat some near you.');
      }
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      hb.malware.cloud(p.dim, p.x + fx * 3, Math.floor(p.y + 0.01), p.z + fz * 3, true);
      return ok('A malware cloud formed in front of you (cheat). Hold a flash drive in it.');
    }
    case 'trigger_event':
    case 'spawn_first': {
      if (p.dim.id !== 'overworld') return { ok: false, text: 'Go to the Overworld first.' };
      if (w.stage !== 'none') return { ok: false, text: `The story is already running (${w.stage}). Reset it first.` };
      const n = hb.adminComputer(p);
      if (!n) return { ok: false, text: 'Could not find or build a computer here.' };
      // A drive in its USB slot, so the computer has something to have read
      const ct = s.interaction.containers;
      const inv = ct.containerAt(n.dim, n.x, n.y, n.z, 12, 'eng');
      if (!inv.get(11)) {
        const st = hb.makeCorruptedDrive();
        inv.set(11, st);
        ct.persist(n.dim, n.x, n.y, n.z, inv);
        const pc = n.be() ? s.engineering!.computers.pcOf(n.be()!) : null;
        if (pc) pc.usbSeen = (st.tag?.data as { disk?: string } | undefined)?.disk;
      }
      s.engineering!.computers.invalidate(n);
      hb.startTakeover(n, null, true);
      if (op === 'spawn_first') hb.skipTakeover();
      return ok(op === 'spawn_first' ? 'Herobrine is coming out of the computer (cheat).' : 'The computer is being taken over (cheat).');
    }
    case 'enter_world': {
      const sp = L().spawn;
      hb.addVisitor(p);
      h.moveTo(p, 'computer', sp.x + 0.5, sp.y, sp.z + 0.5);
      return ok('Inside the computer: seed 478868574082066804 (a cheat visit).');
    }
    case 'tp_seed': {
      const g = L().sighting;
      hb.addVisitor(p);
      h.moveTo(p, 'computer', g.x + 0.5, g.y, g.z + 0.5);
      return ok('At the first sighting, across the lake (a cheat visit).');
    }
    case 'tp_cave': {
      const l = L();
      hb.addVisitor(p);
      h.moveTo(p, 'computer', l.entrance.x + l.tunnelRun - 1 + 0.5, l.hall.y, l.entrance.z + 1);
      return ok("At the bottom of the tunnel into Herobrine's cave (a cheat visit).");
    }
    case 'spawn_final': {
      const l = L();
      w.cheat = true;
      if (w.stage === 'none' || w.stage === 'gateway') w.stage = 'final';
      hb.addVisitor(p);
      const H = l.hall;
      if (p.dim.id !== 'computer' || Math.hypot(p.x - H.x, p.z - H.z) > H.r - 4) h.moveTo(p, 'computer', H.x - H.r + 6 + 0.5, H.y, H.z + 0.5);
      return ok('Herobrine waits in his cave, plugged in (a cheat run): the fight starts in the hall.');
    }
    case 'force_ending': {
      if (!s.endings) return { ok: false, text: 'Endings are not running.' };
      s.endings.force(p, 'herobrine');
      return ok('The Herobrine ending was forced (recorded as forced, never reached).');
    }
    case 'reset_progress':
      hb.adminReset();
      return ok('The Herobrine story was reset: no drive is running, the computer is just a computer, the computer world will be rebuilt.');
    case 'reset_ending': {
      const st = s.endings?.state;
      if (st) {
        delete st.reached.herobrine;
        st.forced = st.forced.filter((id) => id !== 'herobrine');
      }
      for (const pl of s.players.values()) {
        pl.endings.delete('herobrine');
        if (pl.pendingEnding === 'herobrine') pl.pendingEnding = null;
      }
      w.completions = 0;
      return ok('The Herobrine ending was cleared from this world and its players.');
    }
  }
  return { ok: false, text: 'Unknown operation.' };
}
