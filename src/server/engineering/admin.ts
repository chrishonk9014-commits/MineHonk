/**
 * The Admin Panel's Engineering tab. Everything here is a cheat: items given
 * are cheat-marked, blocks placed are admin-marked, and machines it fills or
 * builds are flagged so nothing they make counts towards advancements.
 */
import type { ServerPlayer } from '../player/ServerPlayer';
import type { Dimension } from '../world/Dimension';
import type { V5Op } from '../../common/game/admin';
import { S, stateOf } from '../../common/registry/blocks';
import { itemById } from '../../common/registry/items';
import { markAdmin, stackOf } from '../../common/game/itemstack';
import { portAt } from './ports';
import { ENG_STEP, type Engineering, type EngNode } from './Engineering';

export interface AdminHooks {
  mark(dim: Dimension, x: number, y: number, z: number): void;
  give(p: ServerPlayer, id: string, count: number): void;
}

const KITS: Record<string, [string, number][]> = {
  kit_basic: [
    ['engineering_book', 1],
    ['engineering_table', 1],
    ['water_wheel', 2],
    ['solar_panel', 4],
    ['battery', 2],
    ['copper_wire', 32],
    ['crusher', 1],
    ['electric_furnace', 1],
    ['conveyor', 16],
    ['hopper', 4],
    ['crate', 2],
  ],
  kit_advanced: [
    ['steam_generator', 2],
    ['battery_bank', 2],
    ['insulated_cable', 32],
    ['grinder', 1],
    ['compressor', 1],
    ['cutter', 1],
    ['item_extractor', 4],
    ['item_pipe', 32],
    ['item_filter', 4],
    ['item_sorter', 2],
    ['pump', 2],
    ['fluid_pipe', 32],
    ['fluid_tank', 2],
    ['fluid_valve', 2],
    ['signal_cable', 32],
    ['timer', 2],
    ['logic_gate', 4],
    ['level_sensor', 2],
    ['speed_upgrade', 4],
    ['efficiency_upgrade', 4],
    ['capacity_upgrade', 4],
    ['range_upgrade', 4],
  ],
  kit_factory: [
    ['advanced_generator', 2],
    ['energy_cell', 2],
    ['power_conduit', 32],
    ['industrial_furnace', 1],
    ['quarry', 1],
    ['mining_drill', 1],
    ['ore_scanner', 1],
    ['assembler', 1],
    ['recycler', 1],
    ['machine_casing', 64],
    ['industrial_glass', 16],
    ['monitor', 4],
    ['control_panel', 1],
    ['crop_planter', 1],
    ['crop_harvester', 1],
    ['irrigation_sprinkler', 1],
    ['item_collector', 1],
    ['animal_feeder', 1],
    ['diamond_pickaxe', 2],
  ],
};

export function engineeringAdmin(eng: Engineering, hooks: AdminHooks, p: ServerPlayer, op: V5Op): { ok: boolean; text: string; data?: unknown } {
  const dim = p.dim;
  const near = (r: number): EngNode[] => [...eng.nodes.values()].filter((n) => n.dim === dim && !n.removed && Math.abs(n.x - p.x) <= r && Math.abs(n.y - p.y) <= r && Math.abs(n.z - p.z) <= r);
  const flag = (n: EngNode): void => {
    const be = n.be();
    if (!be) return;
    be.cheat = true;
    n.dirty = true;
  };
  const place = (x: number, y: number, z: number, st: number): void => {
    dim.setBlock(x, y, z, st);
    hooks.mark(dim, x, y, z);
    const n = eng.node(dim, x, y, z);
    if (n) flag(n);
  };
  const status = (): Record<string, unknown> => {
    const all = [...eng.nodes.values()];
    const kinds: Record<string, number> = {};
    for (const n of all) kinds[n.c.kind] = (kinds[n.c.kind] ?? 0) + 1;
    const closest = near(8).sort((a, b) => (a.x - p.x) ** 2 + (a.y - p.y) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 + (b.z - p.z) ** 2))[0];
    let inspect: Record<string, unknown> | null = null;
    if (closest) {
      const be = closest.be();
      const net = eng.energy.netAt(dim, closest.x, closest.y, closest.z);
      inspect = {
        name: closest.c.name,
        at: [closest.x, closest.y, closest.z],
        status: be?.status ?? 'idle',
        energy: be?.energy !== undefined ? `${Math.floor(be.energy)} / ${eng.capacityOf(closest)} EU` : null,
        fluid: be?.fluid?.id ? `${be.fluid.amount} mB ${be.fluid.id}` : null,
        network: net ? `${net.members.size} blocks, ${net.devices.length} devices, +${net.stats.gen.toFixed(1)} / -${net.stats.use.toFixed(1)} EU/t, carries ${net.cap === Infinity ? 'any' : net.cap} EU/t, stored ${Math.floor(net.stats.stored)} / ${net.stats.capacity}` : null,
        cheat: !!be?.cheat,
      };
    }
    return { nodes: all.length, kinds, stepMs: Number(eng.lastStepMs.toFixed(2)), perTick: Number((eng.lastStepMs / ENG_STEP).toFixed(3)), inspect };
  };
  switch (op) {
    case 'status':
      return { ok: true, text: '', data: status() };
    case 'fill_energy': {
      let k = 0;
      for (const n of near(16)) {
        const be = n.be();
        if (!be || !n.c.energy) continue;
        be.energy = eng.capacityOf(n);
        if (n.c.fluid?.accepts.includes('water') && n.c.kind !== 'tank') be.fluid = { id: 'water', amount: n.c.fluid.capacity };
        flag(n);
        n.sleep = 0;
        k++;
      }
      return { ok: true, text: `Filled ${k} engineering block${k === 1 ? '' : 's'} with energy (cheat-marked: what they make never counts for advancements).`, data: status() };
    }
    case 'drain_energy': {
      let k = 0;
      for (const n of near(16)) {
        const be = n.be();
        if (!be || be.energy === undefined) continue;
        be.energy = 0;
        n.dirty = true;
        k++;
      }
      return { ok: true, text: `Drained ${k} engineering block${k === 1 ? '' : 's'}.`, data: status() };
    }
    case 'reset_machines': {
      let k = 0;
      for (const n of near(16)) {
        const be = n.be();
        if (!be) continue;
        be.progress = 0;
        delete be.lanes;
        delete be.status;
        delete be.formed;
        delete be.missing;
        delete be.cursor;
        delete be.burn;
        n.sleep = 0;
        n.dirty = true;
        k++;
      }
      return { ok: true, text: `Reset ${k} machine${k === 1 ? '' : 's'}: progress, states and multiblock checks start over.`, data: status() };
    }
    case 'kit_basic':
    case 'kit_advanced':
    case 'kit_factory': {
      for (const [id, n] of KITS[op]!) if (itemById.has(id)) hooks.give(p, id, n);
      return { ok: true, text: `Gave the ${op === 'kit_basic' ? 'starter' : op === 'kit_advanced' ? 'advanced' : 'factory'} engineering kit.` };
    }
    case 'test_rig': {
      // A powered processing line: cell -> cable -> crusher -> conveyor -> furnace -> hopper -> crate, with a monitor.
      // Machines push their results out of the back, so they face west along the line.
      const x0 = Math.floor(p.x) + 2;
      const y0 = Math.floor(p.y);
      const z0 = Math.floor(p.z) + 2;
      for (let x = -1; x <= 9; x++) for (let z = -1; z <= 2; z++) for (let y = 0; y <= 2; y++) place(x0 + x, y0 + y, z0 + z, 0);
      for (let x = -1; x <= 9; x++) for (let z = -1; z <= 2; z++) place(x0 + x, y0 - 1, z0 + z, S('steel_block'));
      place(x0, y0, z0, S('energy_cell'));
      for (let x = 1; x <= 8; x++) place(x0 + x, y0, z0 + 1, S('insulated_cable'));
      place(x0, y0, z0 + 1, S('insulated_cable'));
      place(x0 + 2, y0, z0, stateOf('crusher', { facing: 'west' }));
      for (let x = 3; x <= 5; x++) place(x0 + x, y0, z0, stateOf('conveyor', { facing: 'east' }));
      place(x0 + 6, y0, z0, stateOf('electric_furnace', { facing: 'west' }));
      place(x0 + 7, y0, z0, stateOf('hopper', { facing: 'east' }));
      place(x0 + 8, y0, z0, S('crate'));
      place(x0 + 1, y0 + 1, z0 + 1, stateOf('monitor', { facing: 'north' }));
      const cell = eng.node(dim, x0, y0, z0)?.be();
      if (cell) cell.energy = 2_000_000;
      portAt(eng.server, dim, x0 + 2, y0, z0, 1)?.insert(markAdmin(stackOf('raw_iron', 32)));
      return { ok: true, text: 'Built a test line beside you: an energy cell powering a crusher, whose dust rides a conveyor into an electric furnace and a hopper into a crate. Everything in it is a cheat.', data: status() };
    }
    case 'stress_test': {
      // 250 electric furnaces in ten powered rows, all working
      const x0 = Math.floor(p.x) + 3;
      const y0 = Math.floor(p.y) + 4;
      const z0 = Math.floor(p.z) - 10;
      let k = 0;
      for (let row = 0; row < 10; row++) {
        const z = z0 + row * 2;
        place(x0 - 1, y0, z, S('energy_cell'));
        const cell = eng.node(dim, x0 - 1, y0, z)?.be();
        if (cell) cell.energy = 2_000_000;
        for (let i = 0; i < 25; i++) {
          place(x0 + i, y0, z, S('insulated_cable'));
          place(x0 + i, y0 + 1, z, stateOf('electric_furnace', { facing: 'north' }));
          portAt(eng.server, dim, x0 + i, y0 + 1, z, 1)?.insert(markAdmin(stackOf('iron_dust', 64)));
          k++;
        }
      }
      return { ok: true, text: `Built ${k} working electric furnaces in ten networks above you. Watch the engineering step time here and in the Performance tab.`, data: status() };
    }
    default:
      return { ok: false, text: 'Unknown engineering action.' };
  }
}
