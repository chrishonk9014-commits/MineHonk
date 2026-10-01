/**
 * The Engineering Book's contents: chapters with step-by-step guides, and an
 * entry for every engineering block and item. Entries come from the catalog
 * (components by their `guide`, plus materials and upgrades), so a new
 * component shows up in the book by itself.
 */
import { COMPONENTS, COMPONENT_BY_ID, ENG_MATERIALS, UPGRADES, UPGRADE_INFO, MACHINE_RECIPES, DUST_SMELTING, type ComponentDef } from './catalog';

export interface GuideChapter {
  id: string;
  title: string;
  /** Item shown as the chapter icon. */
  icon: string;
  intro: string;
  /** Step-by-step instructions. */
  steps: string[];
  tips?: string[];
}

export const CHAPTERS: readonly GuideChapter[] = [
  {
    id: 'getting_started',
    title: 'Getting Started',
    icon: 'engineering_table',
    intro: 'Engineering turns raw materials into power, machines and factories. Everything is made at the Engineering Crafting Table; this book shows how.',
    steps: [
      'Craft an Engineering Crafting Table at a normal crafting table (iron, copper and a crafting table).',
      'Place it and open it. Open this book beside it: pick an entry and press Craft to fill the grid from your inventory.',
      'Start with copper: make Copper Wire and a Water Wheel, then a Battery.',
      'Make a Crusher and an Electric Furnace. Crushing ore gives two dusts; smelting the dust gives two ingots.',
      'Use this book on any engineering block to jump to its entry.',
    ],
    tips: ['Engineering items are never made at the normal crafting table.', 'Tiers: 1 basic, 2 intermediate, 3 advanced, 4 industrial. Higher tiers need parts from lower ones.'],
  },
  {
    id: 'materials',
    title: 'Materials & Parts',
    icon: 'iron_gear',
    intro: 'Machines are built from plates, gears, coils, motors and circuits. Better parts come from machines.',
    steps: [
      'Iron Plates and Iron Gears are made at the Engineering Crafting Table from iron ingots.',
      'Copper Coils come from copper ingots; a Motor needs coils, plates and a gear.',
      'Control Circuits need redstone, copper and gold; Advanced Circuits need control circuits and diamonds.',
      'Steel: crush coal into coal dust, mix it with iron dust into Steel Blend, and smelt the blend in an Electric Furnace.',
      'Upgrades go into a machine\'s upgrade slots (up to four).',
    ],
  },
  {
    id: 'power',
    title: 'Power',
    icon: 'water_wheel',
    intro: 'Energy is counted in EU and moves through cables at EU per tick (EU/t). Generators make it, batteries store it, machines use it.',
    steps: [
      'Place a generator: a Water Wheel next to water, or a Solar Panel under open sky.',
      'Run Copper Wire from it. Wire connects by itself to cables and engineering blocks next to it.',
      'Put a Battery on the line to keep what the machines don\'t use right now.',
      'Cable your machines in. Open any of them to see the network: what it makes, uses and stores.',
      'When the network says it is at its cable limit, swap the wire for Insulated Cable or a Power Conduit.',
    ],
    tips: ['Blocks touching each other connect without cable.', 'Batteries keep their charge when broken.', 'When there is not enough power, every machine slows down together.'],
  },
  {
    id: 'machines',
    title: 'Machines',
    icon: 'crusher',
    intro: 'Machines process items using energy. They all share one window: slots, an energy bar, progress, their state and settings.',
    steps: [
      'Place a machine next to a cable or a powered block.',
      'Put items in its input slot (or feed it with a conveyor, hopper or pipe).',
      'Watch its state: Working, No power, No input, Output full or Disabled. The front lights up while it works.',
      'Take the results from its output slots, or pull them out with a hopper or extractor.',
      'Add upgrades: speed, efficiency, capacity and range.',
    ],
    tips: ['Every machine has a signal setting: ignore signals, run while powered, or run while unpowered.'],
  },
  {
    id: 'items',
    title: 'Item Transport',
    icon: 'conveyor',
    intro: 'Move items without carrying them: conveyors, hoppers and chutes for short runs, pipes and extractors for networks.',
    steps: [
      'Lay Conveyors pointing towards a machine or chest. Items dropped on them ride along and go in at the end.',
      'Put a Hopper under a chest to pull items out of it; it passes them the way it points.',
      'For longer runs, join inventories with Item Pipes.',
      'Place an Item Extractor facing the inventory to empty, pipe it to where items should go, and power it.',
      'Use Item Filters in the pipes, or an Item Sorter, to send each item to the right place.',
    ],
    tips: ['Chests, barrels and furnaces join pipe networks too.', 'A signal locks a hopper.'],
  },
  {
    id: 'fluids',
    title: 'Fluids',
    icon: 'pump',
    intro: 'Pumps lift water and lava out of the world into pipes, tanks and machines. 1 bucket is 1,000 mB.',
    steps: [
      'Place a Pump touching a pool and power it.',
      'Run Fluid Pipes from it to a Fluid Tank or a machine that takes fluid (Steam Generator, Sprinkler, Large Generator).',
      'Add a Fluid Valve to switch the flow by hand or by signal.',
      'Set a Fluid Filter with a bucket so only that fluid passes.',
      'A Fluid Outlet pours source blocks back into the world.',
    ],
    tips: ['Water pools of two or more sources refill; lava pools run dry.', 'Buckets fill from and empty into tanks.'],
  },
  {
    id: 'logic',
    title: 'Signals & Logic',
    icon: 'logic_gate',
    intro: 'Signals replace redstone. Levers, buttons, plates, lamps, doors and sculk all work with them.',
    steps: [
      'Lay Signal Cable from a lever to a machine. It never grows weaker along the way.',
      'Set the machine\'s signal mode to "Runs while powered".',
      'Put a Level Sensor against a battery, set it to "below 50%", and point its front at a Steam Generator: a backup generator.',
      'Combine signals with a Logic Gate (AND, OR, XOR, NAND, NOR, NOT). Use it to change the mode.',
      'Use a Timer for pulses, an Item Sensor to count items going past, and a Warning Light to show a signal.',
    ],
    tips: ['Old redstone dust and torches already in the world keep working.'],
  },
  {
    id: 'automation',
    title: 'Mining Automation',
    icon: 'mining_drill',
    intro: 'Drills and quarries dig for you; the ore scanner tells you where to dig.',
    steps: [
      'Place a Mining Drill above the area to dig and power it.',
      'Put a pickaxe in its tool slot. Better pickaxes dig harder blocks; they wear down.',
      'Pull its output into storage with a hopper or an extractor and pipes.',
      'Use an Ore Scanner to see which ores are nearby and where.',
      'Later, a Quarry digs a 9x9 area.',
    ],
  },
  {
    id: 'farming',
    title: 'Farming Automation',
    icon: 'crop_harvester',
    intro: 'Plant, water, harvest and breed without lifting a finger.',
    steps: [
      'Till farmland around a spot and place a Crop Planter level with it; fill it with seeds.',
      'Place a Crop Harvester nearby: it harvests ripe crops and replants them.',
      'Pipe water into an Irrigation Sprinkler to keep the farmland wet and crops growing faster.',
      'Put an Item Collector near the farm to pick up stray drops.',
      'For animals, fill an Animal Feeder with their food.',
    ],
  },
  {
    id: 'multiblocks',
    title: 'Multiblocks',
    icon: 'machine_casing',
    intro: 'Big machines built from many blocks around one controller. The controller says which block is missing.',
    steps: [
      'Place the controller (for example an Industrial Furnace) facing you.',
      'Build the frame behind it from Machine Casing (or Industrial Glass): for the furnace, a 3x3x3 cube, hollow in the middle.',
      'Open the controller: it lists the first missing block and its position.',
      'Once complete, power it and use it like any machine.',
    ],
    tips: ['Industrial Furnace and Large Generator: 3x3x3 hollow cube. Advanced Crusher: 3 wide, 2 high, 2 deep with a Crusher at the back. Quarry: a ring of 8 casings.'],
  },
  {
    id: 'control',
    title: 'Control Rooms',
    icon: 'monitor',
    intro: 'See and run a whole factory from one room.',
    steps: [
      'Cable a Monitor to your network. Use it to switch pages: power, batteries, machines, storage, fluids, alerts.',
      'Add a Control Panel to the same network to switch any machine on or off.',
      'Put several monitors side by side on different pages.',
    ],
  },
  {
    id: 'factories',
    title: 'Factories',
    icon: 'hazard_stripes',
    intro: 'Put it all together: power, machines, transport, logic and a control room.',
    steps: [
      'Plan the flow: ore in, crushed, smelted, sorted, stored.',
      'Feed machines with conveyors or extractors, so they work on their own.',
      'Store power in batteries and add a backup generator on a level sensor.',
      'Watch it from a control room.',
      'Build it with factory blocks: casing, steel, industrial glass, grates, stripes and lights.',
    ],
  },
];

export interface GuideEntry {
  id: string;
  name: string;
  chapter: string;
  tier?: number;
  desc: string;
  /** Facts like "Uses 8 EU/t". */
  stats: string[];
  /** How it is made other than at the table (machines, smelting). */
  madeBy: string[];
}

const title = (id: string): string =>
  id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const num = (n: number): string => n.toLocaleString('en-US');

function statsOf(c: ComponentDef): string[] {
  const s: string[] = [`Tier ${c.tier}`];
  const e = c.energy;
  if (e?.gen) s.push(`Makes up to ${e.gen} EU/t`);
  if (e?.use) s.push(`Uses ${e.use} EU/t while working`);
  if (e && c.kind === 'battery') s.push(`Stores ${num(e.capacity)} EU, ${num(e.maxIn ?? 0)} EU/t in/out`);
  if (c.cableCap) s.push(`Carries ${num(c.cableCap)} EU/t`);
  if (c.fluid) s.push(`Holds ${num(c.fluid.capacity)} mB of ${c.fluid.accepts.join(' or ')}`);
  if (c.time && c.kind !== 'signal') s.push(`${(c.time / 20).toFixed(c.time % 20 ? 1 : 0)} s per operation`);
  if (c.slots?.upgrades) s.push(`${c.slots.upgrades} upgrade slots`);
  if (c.signal) s.push('Signal controlled');
  return s;
}

let cache: GuideEntry[] | null = null;

/** Every entry in the book, in chapter order. */
export function guideEntries(): GuideEntry[] {
  if (cache) return cache;
  const out: GuideEntry[] = [];
  const madeBy = (id: string): string[] => {
    const r: string[] = [];
    for (const [machine, list] of Object.entries(MACHINE_RECIPES))
      for (const m of list) if (m.output === id) r.push(`${COMPONENT_BY_ID.get(machine)?.name ?? title(machine)}: ${m.inCount ?? 1} ${title(m.input)} -> ${m.count}`);
    for (const [dust, ingot] of DUST_SMELTING) if (ingot === id) r.push(`Any furnace: ${title(dust)}`);
    return r;
  };
  for (const ch of CHAPTERS) {
    if (ch.id === 'materials') {
      for (const id of ENG_MATERIALS) out.push({ id, name: title(id), chapter: 'materials', desc: MATERIAL_DESC[id] ?? '', stats: [], madeBy: madeBy(id) });
      for (const id of UPGRADES) out.push({ id, name: title(id), chapter: 'materials', desc: UPGRADE_INFO[id], stats: ['Goes in a machine\'s upgrade slots'], madeBy: [] });
      continue;
    }
    for (const c of COMPONENTS) if (c.guide === ch.id) out.push({ id: c.id, name: c.name, chapter: ch.id, tier: c.tier, desc: c.desc, stats: statsOf(c), madeBy: madeBy(c.id) });
  }
  cache = out;
  return out;
}

export function guideEntry(id: string): GuideEntry | undefined {
  return guideEntries().find((e) => e.id === id);
}

const MATERIAL_DESC: Record<string, string> = {
  copper_dust: 'Crushed copper. Smelts into a copper ingot.',
  iron_dust: 'Crushed iron. Smelts into an iron ingot, or mixes with coal dust into steel blend.',
  gold_dust: 'Crushed gold. Smelts into a gold ingot.',
  coal_dust: 'Crushed coal. Burns as fuel, and goes into steel blend.',
  steel_blend: 'Iron and coal dust, ready to smelt into steel in an Electric Furnace.',
  steel_ingot: 'Strong metal for tier 3 and 4 machines.',
  iron_plate: 'A pressed iron sheet: the body of most machines.',
  steel_plate: 'A pressed steel sheet for advanced machines.',
  iron_gear: 'Moves things. Used in motors, conveyors and drills.',
  copper_coil: 'Wound copper for motors, generators and cables.',
  motor: 'Makes machines move: conveyors, pumps, crushers.',
  control_circuit: 'The brain of a tier 2 machine.',
  advanced_circuit: 'The brain of tier 3 and 4 machines.',
};
