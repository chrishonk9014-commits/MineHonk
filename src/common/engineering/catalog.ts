/**
 * V5 - The Engineering Update: the catalogue of engineering components.
 *
 * Static data only (no registry lookups at import time): the block registry
 * appends the block definitions built here, the item registry the items,
 * and the server and client read the component definitions to know what a
 * block does (networks it joins, energy, inventory, fluids, its book entry).
 */
import type { BlockDef, PropDefs } from '../registry/blockTypes';
import type { ItemDef } from '../registry/itemTypes';

export type Net = 'energy' | 'item' | 'fluid' | 'data';
export type Tier = 1 | 2 | 3 | 4;

export type EngKind =
  | 'station'
  | 'generator'
  | 'battery'
  | 'cable'
  | 'machine'
  | 'multiblock'
  | 'storage'
  | 'conveyor'
  | 'hopper'
  | 'chute'
  | 'item_pipe'
  | 'extractor'
  | 'item_filter'
  | 'sorter'
  | 'fluid_pipe'
  | 'pump'
  | 'tank'
  | 'valve'
  | 'fluid_filter'
  | 'outlet'
  | 'signal'
  | 'monitor'
  | 'control_panel'
  | 'decor'
  // V5.5: computers
  | 'computer'
  | 'peripheral'
  | 'data_cable'
  | 'server'
  // V6 phase 4: End transport (bridge projectors, teleportation nodes, Ender Rails)
  | 'transport';

export interface SlotLayout {
  input?: number;
  output?: number;
  fuel?: number;
  tool?: number;
  upgrades?: number;
  /** Ghost slots (filters, assembler target): they hold a copy, never items. */
  ghost?: number;
}

export interface ComponentDef {
  id: string;
  name: string;
  kind: EngKind;
  tier: Tier;
  /** Networks it joins (and conduits of those networks connect to it). */
  nets: Net[];
  /** EU: buffer, max input/output per tick, use per tick while working, generation per tick at best. */
  energy?: { capacity: number; maxIn?: number; maxOut?: number; use?: number; gen?: number };
  slots?: SlotLayout;
  /** Fluid buffer (mB) and which fluids it takes. */
  fluid?: { capacity: number; accepts: ('water' | 'lava')[] };
  /** Machine recipe set (see MACHINE_RECIPES) or a special behaviour. */
  machine?: string;
  /** Ticks per operation (machines, pumps, drills...). */
  time?: number;
  /** Base radius of area machines. */
  area?: number;
  /** Cables: EU/t a network can carry. */
  cableCap?: number;
  /** Conveyors: blocks per second. */
  speed?: number;
  /** Has a signal mode (ignore / run when powered / run when unpowered). */
  signal?: boolean;
  /** Short description (tooltips and the book). */
  desc: string;
  /** Engineering Book guide this belongs to. */
  guide: string;
  /** V5.5 peripherals: what a computer next to it gains. */
  peripheral?: 'keyboard' | 'mouse' | 'speaker' | 'led';
  /** V6: the block is registered elsewhere (an older block that joins a network). */
  existing?: boolean;
  /** V6: never crafted (restored or placed by a quest). */
  uncraftable?: boolean;
}

// ---------------------------------------------------------------------------
// The components
// ---------------------------------------------------------------------------
const C: ComponentDef[] = [];
const comp = (d: ComponentDef): ComponentDef => (C.push(d), d);

// Station
comp({ id: 'engineering_table', name: 'Engineering Crafting Table', kind: 'station', tier: 1, nets: [], desc: 'Where every engineering item is made. The Engineering Book shows the recipes and fills the grid for you.', guide: 'getting_started' });

// Power generation
comp({ id: 'water_wheel', name: 'Water Wheel', kind: 'generator', tier: 1, nets: ['energy'], energy: { capacity: 2000, maxOut: 64, gen: 8 }, signal: true, desc: 'Cheap and steady. Makes 2 EU/t for each side touching water (up to 8 EU/t).', guide: 'power' });
comp({ id: 'solar_panel', name: 'Solar Panel', kind: 'generator', tier: 1, nets: ['energy'], energy: { capacity: 2000, maxOut: 64, gen: 10 }, desc: 'Up to 10 EU/t under open sky at midday; less in the morning, evening and rain, nothing at night.', guide: 'power' });
comp({ id: 'wind_turbine', name: 'Wind Turbine', kind: 'generator', tier: 2, nets: ['energy'], energy: { capacity: 4000, maxOut: 128, gen: 24 }, signal: true, desc: 'Better the higher it stands: nothing below y 64, up to 24 EU/t at y 128 and above. The wind comes and goes; storms blow harder. Needs open air beside it.', guide: 'power' });
comp({ id: 'steam_generator', name: 'Steam Generator', kind: 'generator', tier: 2, nets: ['energy', 'fluid'], energy: { capacity: 8000, maxOut: 256, gen: 40 }, slots: { fuel: 1 }, fluid: { capacity: 8000, accepts: ['water'] }, signal: true, desc: '40 EU/t while it has fuel and water (5 mB/t). Pipe water in or fill it with buckets. A good backup generator: run it from a signal.', guide: 'power' });
comp({ id: 'advanced_generator', name: 'Advanced Generator', kind: 'generator', tier: 3, nets: ['energy'], energy: { capacity: 32000, maxOut: 512, gen: 160 }, slots: { fuel: 1 }, signal: true, desc: '160 EU/t, burning fuel twice as fast as a furnace. Expensive, compact, powerful.', guide: 'power' });

// Energy storage
comp({ id: 'battery', name: 'Battery', kind: 'battery', tier: 1, nets: ['energy'], energy: { capacity: 20000, maxIn: 64, maxOut: 64 }, desc: 'Stores 20,000 EU (64 EU/t in or out). Keeps its charge when broken.', guide: 'power' });
comp({ id: 'battery_bank', name: 'Battery Bank', kind: 'battery', tier: 2, nets: ['energy'], energy: { capacity: 250000, maxIn: 256, maxOut: 256 }, desc: 'Stores 250,000 EU (256 EU/t in or out). Keeps its charge when broken.', guide: 'power' });
comp({ id: 'energy_cell', name: 'Advanced Energy Cell', kind: 'battery', tier: 4, nets: ['energy'], energy: { capacity: 2000000, maxIn: 1024, maxOut: 1024 }, desc: 'Stores 2,000,000 EU (1,024 EU/t in or out). Keeps its charge when broken.', guide: 'power' });

// Cables
comp({ id: 'copper_wire', name: 'Copper Wire', kind: 'cable', tier: 1, nets: ['energy'], cableCap: 64, desc: 'Carries up to 64 EU/t. A network carries as much as its weakest cable.', guide: 'power' });
comp({ id: 'insulated_cable', name: 'Insulated Cable', kind: 'cable', tier: 2, nets: ['energy'], cableCap: 512, desc: 'Carries up to 512 EU/t.', guide: 'power' });
comp({ id: 'power_conduit', name: 'Power Conduit', kind: 'cable', tier: 3, nets: ['energy'], cableCap: 4096, desc: 'Carries up to 4,096 EU/t.', guide: 'power' });

// Processing machines
const machine = (id: string, name: string, tier: Tier, use: number, time: number, slots: SlotLayout, desc: string, extra: Partial<ComponentDef> = {}): ComponentDef =>
  comp({ id, name, kind: 'machine', tier, nets: ['energy', 'item'], energy: { capacity: use * 400, maxIn: use * 8, use }, slots: { upgrades: 4, ...slots }, machine: id, time, signal: true, desc, guide: 'machines', ...extra });
machine('crusher', 'Crusher', 1, 8, 100, { input: 1, output: 2 }, 'Crushes raw ores into two dusts, coal into coal dust, stone into gravel and sand.');
machine('electric_furnace', 'Electric Furnace', 1, 8, 80, { input: 1, output: 1 }, 'Smelts like a furnace, faster and without fuel. Turns steel blend into steel.');
machine('grinder', 'Grinder', 2, 6, 80, { input: 1, output: 2 }, 'Grinds bones, blaze rods, wool, cane and plants into more than crafting gives.');
machine('compressor', 'Compressor', 2, 12, 120, { input: 1, output: 1 }, 'Presses ingots into plates and packs ice, sand and clay.');
machine('cutter', 'Cutter', 2, 6, 60, { input: 1, output: 1 }, 'Saws logs into six planks, planks into sticks, plates into gears and copper into wire.');
machine('recycler', 'Recycler', 3, 16, 160, { input: 1, output: 4 }, 'Breaks metal tools, armor and engineering parts back into half their materials.');
machine('assembler', 'Assembler', 4, 12, 60, { input: 9, output: 1, ghost: 1 }, 'Crafts the item in its target slot (crafting table recipes only) from its inputs, over and over.');

// Multiblock controllers
comp({ id: 'industrial_furnace', name: 'Industrial Furnace', kind: 'multiblock', tier: 3, nets: ['energy', 'item'], energy: { capacity: 32000, maxIn: 256, use: 32 }, slots: { input: 8, output: 8, upgrades: 4 }, machine: 'electric_furnace', time: 80, signal: true, desc: 'A 3x3x3 furnace of machine casing, hollow inside. Smelts eight stacks side by side.', guide: 'multiblocks' });
comp({ id: 'advanced_crusher', name: 'Advanced Crusher', kind: 'multiblock', tier: 3, nets: ['energy', 'item'], energy: { capacity: 32000, maxIn: 256, use: 32 }, slots: { input: 1, output: 3, upgrades: 4 }, machine: 'advanced_crusher', time: 60, signal: true, desc: 'Machine casing 3 wide, 2 high and 2 deep, with a Crusher in the back. Three dusts from every ore.', guide: 'multiblocks' });
comp({ id: 'large_generator', name: 'Large Generator', kind: 'multiblock', tier: 4, nets: ['energy', 'fluid'], energy: { capacity: 200000, maxOut: 4096, gen: 512 }, fluid: { capacity: 16000, accepts: ['lava'] }, signal: true, desc: 'A 3x3x3 of machine casing, hollow inside. Burns lava (2 mB/t) for 512 EU/t.', guide: 'multiblocks' });
comp({ id: 'quarry', name: 'Quarry', kind: 'multiblock', tier: 4, nets: ['energy', 'item'], energy: { capacity: 64000, maxIn: 512, use: 96 }, slots: { tool: 1, output: 27, upgrades: 4 }, machine: 'quarry', time: 20, area: 4, signal: true, desc: 'Ringed by eight machine casings, it digs out the 9x9 area below it layer by layer with the pickaxe in its tool slot.', guide: 'multiblocks' });

// Automation
comp({ id: 'mining_drill', name: 'Mining Drill', kind: 'machine', tier: 3, nets: ['energy', 'item'], energy: { capacity: 12000, maxIn: 128, use: 24 }, slots: { tool: 1, output: 9, upgrades: 4 }, machine: 'drill', time: 40, area: 1, signal: true, desc: 'Digs the 3x3 column below it with the pickaxe in its tool slot (which wears down). Slower than you, but it never sleeps.', guide: 'automation' });
comp({ id: 'ore_scanner', name: 'Ore Scanner', kind: 'machine', tier: 3, nets: ['energy'], energy: { capacity: 8000, maxIn: 128, use: 16 }, slots: { upgrades: 4 }, machine: 'scanner', time: 200, area: 16, signal: true, desc: 'Scans the ground around it for ores and lists what it found.', guide: 'automation' });
comp({ id: 'crop_planter', name: 'Crop Planter', kind: 'machine', tier: 2, nets: ['energy', 'item'], energy: { capacity: 2000, maxIn: 32, use: 2 }, slots: { input: 9, upgrades: 4 }, machine: 'planter', time: 20, area: 2, signal: true, desc: 'Plants seeds from its inventory on empty farmland around it (place it level with the farmland).', guide: 'farming' });
comp({ id: 'crop_harvester', name: 'Crop Harvester', kind: 'machine', tier: 2, nets: ['energy', 'item'], energy: { capacity: 2000, maxIn: 32, use: 4 }, slots: { output: 9, upgrades: 4 }, machine: 'harvester', time: 20, area: 2, signal: true, desc: 'Harvests ripe crops around it into its inventory and replants them.', guide: 'farming' });
comp({ id: 'irrigation_sprinkler', name: 'Irrigation Sprinkler', kind: 'machine', tier: 2, nets: ['energy', 'fluid'], energy: { capacity: 2000, maxIn: 32, use: 2 }, slots: { upgrades: 4 }, fluid: { capacity: 4000, accepts: ['water'] }, machine: 'sprinkler', time: 40, area: 3, signal: true, desc: 'Keeps farmland around it wet and helps crops grow, using water (1 mB/t).', guide: 'farming' });
comp({ id: 'item_collector', name: 'Item Collector', kind: 'machine', tier: 2, nets: ['energy', 'item'], energy: { capacity: 2000, maxIn: 32, use: 2 }, slots: { output: 18, upgrades: 4 }, machine: 'collector', time: 4, area: 3, signal: true, desc: 'Pulls dropped items around it into its inventory.', guide: 'farming' });
comp({ id: 'animal_feeder', name: 'Animal Feeder', kind: 'machine', tier: 2, nets: ['energy', 'item'], energy: { capacity: 2000, maxIn: 32, use: 4 }, slots: { input: 9, upgrades: 4 }, machine: 'feeder', time: 200, area: 4, signal: true, desc: 'Feeds the animals around it from its inventory so they breed (up to 16 nearby).', guide: 'farming' });

// Storage
comp({ id: 'crate', name: 'Crate', kind: 'storage', tier: 1, nets: ['item'], slots: { input: 36 }, desc: '36 slots. Conveyors, hoppers and pipes can fill and empty it.', guide: 'items' });
comp({ id: 'industrial_chest', name: 'Industrial Chest', kind: 'storage', tier: 2, nets: ['item'], slots: { input: 54 }, desc: '54 slots.', guide: 'items' });
comp({ id: 'storage_barrel', name: 'Storage Barrel', kind: 'storage', tier: 2, nets: ['item'], slots: { input: 1 }, desc: 'Holds up to 4,096 of a single kind of item.', guide: 'items' });
comp({ id: 'item_vault', name: 'Item Vault', kind: 'storage', tier: 3, nets: ['item'], slots: { input: 81 }, desc: '81 slots.', guide: 'items' });

// Item transport
comp({ id: 'conveyor', name: 'Conveyor', kind: 'conveyor', tier: 1, nets: [], speed: 2, desc: 'Carries items (and anything standing on it) 2 blocks a second, and drops them into the inventory it points into.', guide: 'items' });
comp({ id: 'express_conveyor', name: 'Express Conveyor', kind: 'conveyor', tier: 2, nets: [], speed: 5, desc: 'A conveyor running 5 blocks a second.', guide: 'items' });
comp({ id: 'hopper', name: 'Hopper', kind: 'hopper', tier: 1, nets: ['item'], slots: { input: 5 }, time: 8, desc: 'Takes items from the inventory (or the floor) above and passes them on, one every 8 ticks, the way it points.', guide: 'items' });
comp({ id: 'chute', name: 'Chute', kind: 'chute', tier: 1, nets: ['item'], slots: { input: 1 }, time: 2, desc: 'Drops what falls into it straight down into the inventory below, quickly.', guide: 'items' });
comp({ id: 'item_pipe', name: 'Item Pipe', kind: 'item_pipe', tier: 2, nets: ['item'], desc: 'Joins inventories into an item network. Items enter through extractors.', guide: 'items' });
comp({ id: 'item_extractor', name: 'Item Extractor', kind: 'extractor', tier: 2, nets: ['item', 'energy'], energy: { capacity: 400, maxIn: 16, use: 1 }, slots: { upgrades: 4, ghost: 9 }, time: 10, signal: true, desc: 'Pulls items from the inventory it faces into the pipes and sends them to the nearest inventory that takes them. Set its filter to pull only some items.', guide: 'items' });
comp({ id: 'item_filter', name: 'Item Filter', kind: 'item_filter', tier: 2, nets: ['item'], slots: { ghost: 9 }, desc: 'A pipe that lets through only the items in its filter (or everything but them).', guide: 'items' });
comp({ id: 'item_sorter', name: 'Item Sorter', kind: 'sorter', tier: 2, nets: ['item'], slots: { input: 1, ghost: 9 }, time: 2, desc: 'Items matching its filter leave by the front, everything else by the back.', guide: 'items' });

// Fluids
comp({ id: 'fluid_pipe', name: 'Fluid Pipe', kind: 'fluid_pipe', tier: 2, nets: ['fluid'], desc: 'Joins pumps, tanks and fluid machines into a fluid network.', guide: 'fluids' });
comp({ id: 'pump', name: 'Pump', kind: 'pump', tier: 2, nets: ['energy', 'fluid'], energy: { capacity: 2000, maxIn: 64, use: 8 }, fluid: { capacity: 4000, accepts: ['water', 'lava'] }, time: 20, area: 6, signal: true, desc: 'Draws source blocks of water or lava from the pool it touches (1 bucket a second) into the fluid network. Water pools of two or more sources refill; lava does not.', guide: 'fluids' });
comp({ id: 'fluid_tank', name: 'Fluid Tank', kind: 'tank', tier: 2, nets: ['fluid'], fluid: { capacity: 16000, accepts: ['water', 'lava'] }, desc: 'Holds 16 buckets of one fluid. Fill and empty it with buckets too. Keeps its contents when broken.', guide: 'fluids' });
comp({ id: 'fluid_valve', name: 'Fluid Valve', kind: 'valve', tier: 2, nets: ['fluid'], signal: true, desc: 'A pipe that opens and closes: use it to switch it, or give it a signal (open while powered).', guide: 'fluids' });
comp({ id: 'fluid_filter', name: 'Fluid Filter', kind: 'fluid_filter', tier: 2, nets: ['fluid'], desc: 'A pipe that lets only one fluid through. Use it with a bucket of that fluid to set it.', guide: 'fluids' });
comp({ id: 'fluid_outlet', name: 'Fluid Outlet', kind: 'outlet', tier: 2, nets: ['fluid'], fluid: { capacity: 2000, accepts: ['water', 'lava'] }, time: 10, signal: true, desc: 'Pours a source block of the network\'s fluid in front of it when there is room (1,000 mB each).', guide: 'fluids' });

// Signals (redstone)
comp({ id: 'signal_cable', name: 'Signal Cable', kind: 'signal', tier: 1, nets: [], desc: 'Carries a signal like redstone used to, without growing weaker along the cable.', guide: 'logic' });
comp({ id: 'timer', name: 'Timer', kind: 'signal', tier: 2, nets: [], signal: false, desc: 'Sends a short pulse every few seconds (use it to change the period).', guide: 'logic' });
comp({ id: 'logic_gate', name: 'Logic Gate', kind: 'signal', tier: 2, nets: [], desc: 'Combines the signals coming into its left, right and back into one signal out of its front: AND, OR, XOR, NAND, NOR or NOT. Use it to change the mode.', guide: 'logic' });
comp({ id: 'level_sensor', name: 'Level Sensor', kind: 'signal', tier: 2, nets: [], desc: 'Reads the block behind it (battery charge, storage, tank or machine buffer) and sends a signal out of the front: proportional, above a level, or below it.', guide: 'logic' });
comp({ id: 'item_sensor', name: 'Item Sensor', kind: 'signal', tier: 2, nets: [], desc: 'Sends a signal while items pass on top of the block in front of it.', guide: 'logic' });
comp({ id: 'warning_light', name: 'Warning Light', kind: 'signal', tier: 2, nets: [], desc: 'Flashes while it gets a signal.', guide: 'logic' });

// Control rooms
comp({ id: 'monitor', name: 'Monitor', kind: 'monitor', tier: 3, nets: ['energy'], energy: { capacity: 200, maxIn: 8, use: 1 }, desc: 'Shows its network on screen: power, batteries, machines, storage, fluids or alerts. Use it to switch the page.', guide: 'control' });
comp({ id: 'control_panel', name: 'Control Panel', kind: 'control_panel', tier: 4, nets: ['energy'], energy: { capacity: 200, maxIn: 8, use: 1 }, desc: 'Lists every machine and generator on its network, with a switch for each one.', guide: 'control' });

// Industrial blocks
comp({ id: 'machine_casing', name: 'Machine Casing', kind: 'decor', tier: 2, nets: [], desc: 'Builds multiblock machines, and walls of factories.', guide: 'multiblocks' });
for (const [id, name, desc] of [
  ['steel_block', 'Block of Steel', 'Nine steel ingots.'],
  ['industrial_glass', 'Industrial Glass', 'Clear, framed glass for factory walls.'],
  ['metal_grate', 'Metal Grate', 'A see-through grating for floors and walkways.'],
  ['hazard_stripes', 'Hazard Stripes', 'Yellow and black: mind the machines.'],
  ['factory_light', 'Factory Light', 'A bright industrial light.'],
  ['industrial_door', 'Industrial Door', 'A heavy door that only opens with a signal.'],
] as const)
  comp({ id, name, kind: 'decor', tier: 2, nets: [], desc, guide: 'factories' });

// V5.5 - computers (the Digital Corruption Update)
comp({ id: 'computer', name: 'Computer', kind: 'computer', tier: 3, nets: ['energy', 'data'], energy: { capacity: 4000, maxIn: 64, use: 3 }, slots: { input: 12 }, desc: 'A computer case. Install a power supply, motherboard, CPU and RAM to boot it, a hard drive for HonkOS and its programs. It needs a monitor and a keyboard beside it, and power.', guide: 'computers' });
comp({ id: 'keyboard', name: 'Keyboard', kind: 'peripheral', tier: 2, nets: [], peripheral: 'keyboard', desc: 'Lets you use the computer it sits beside (within one block).', guide: 'computers' });
comp({ id: 'mouse', name: 'Mouse', kind: 'peripheral', tier: 2, nets: [], peripheral: 'mouse', desc: 'Programs with graphics (maps and blueprints) need a mouse beside the computer.', guide: 'computers' });
comp({ id: 'speaker', name: 'Speaker', kind: 'peripheral', tier: 2, nets: [], peripheral: 'speaker', desc: 'Lets a computer beside it play sounds: its start-up chime, alerts and alarms.', guide: 'computers' });
comp({ id: 'led_light', name: 'LED', kind: 'peripheral', tier: 1, nets: [], peripheral: 'led', desc: 'A small status light. Beside a computer it shows its state (green running, red trouble); anywhere else it lights while powered by a signal.', guide: 'computers' });
comp({ id: 'network_cable', name: 'Network Cable', kind: 'data_cable', tier: 2, nets: ['data'], desc: 'Joins computers and server racks with network cards into a network: share files and programs between them.', guide: 'computers' });
comp({ id: 'server_rack', name: 'Server Rack', kind: 'server', tier: 3, nets: ['energy', 'data'], energy: { capacity: 2000, maxIn: 32, use: 2 }, slots: { input: 4 }, desc: 'Holds four hard drives as network storage: every computer on its network can read and write them.', guide: 'computers' });

// ---------------------------------------------------------------------------
// V6 - The End Expansion, phase 4: End engineering. End Power is EU made by
// End generators, carried by the same cables. These blocks are appended to
// the block registry after the expansion's phase 3 blocks (endEngineeringBlockDefs),
// so no earlier block number moves.
// ---------------------------------------------------------------------------
const E: ComponentDef[] = [];
const endComp = (d: ComponentDef): ComponentDef => (E.push(d), d);

/** Crystal Generator: EU/t while burning, and ticks one End Crystal Fragment burns for. */
export const CRYSTAL_GEN = { gen: 128, burn: 400 } as const;
/** Void Collector: EU/t, and the open void it needs under it (air all the way down). */
export const VOID_COLLECTOR = { gen: 24, air: 32 } as const;
/** Restored Ancient Core: EU/t, forever. */
export const ANCIENT_CORE_GEN = 512;
/** Crystal Grower: ticks per cluster (about five minutes). */
export const CRYSTAL_GROWER_TIME = 6000;

endComp({ id: 'crystal_generator', name: 'Crystal Generator', kind: 'generator', tier: 3, nets: ['energy'], energy: { capacity: 51200, maxOut: 512, gen: CRYSTAL_GEN.gen }, slots: { fuel: 1 }, signal: true, desc: 'Burns End Crystal Fragments: 128 EU/t for 20 seconds each.', guide: 'end_engineering' });
endComp({ id: 'void_collector', name: 'Void Collector', kind: 'generator', tier: 3, nets: ['energy'], energy: { capacity: 4800, maxOut: 128, gen: VOID_COLLECTOR.gen }, signal: true, desc: 'Draws 24 EU/t from the void, without fuel. It only works over open void: nothing but air under it, all the way down, at least 32 blocks of it.', guide: 'end_engineering' });
endComp({ id: 'restored_ancient_core', name: 'Restored Ancient Core', kind: 'generator', tier: 4, nets: ['energy'], energy: { capacity: 102400, maxOut: 1024, gen: ANCIENT_CORE_GEN }, signal: true, uncraftable: true, desc: 'A dormant Ancient Core brought back with Ancient Fragments and an Astral Shard: 512 EU/t, and it never runs out. It can\'t be made, only restored where it was found (about one in each giant structure). Silk Touch picks a restored one up.', guide: 'end_engineering' });
endComp({ id: 'void_cell', name: 'Void Cell', kind: 'battery', tier: 4, nets: ['energy'], energy: { capacity: 2000000, maxIn: 4096, maxOut: 4096 }, desc: 'Stores 2,000,000 EU in the void (4,096 EU/t in or out). Keeps its charge when broken.', guide: 'end_engineering' });
endComp({ id: 'end_processor', name: 'End Processor', kind: 'machine', tier: 3, nets: ['energy', 'item'], energy: { capacity: 64 * 400, maxIn: 64 * 8, use: 64 }, slots: { input: 1, output: 2, upgrades: 4 }, machine: 'end_processor', time: 100, signal: true, desc: 'Processes the End\'s resources: more Ender Scrap from Ender Ore, shards from Void Crystal Ore, fragments from crystal clusters, Ancient Fragments from old stone, fiber from chorus.', guide: 'end_engineering' });
endComp({ id: 'crystal_grower', name: 'Crystal Grower', kind: 'machine', tier: 3, nets: ['energy'], energy: { capacity: 32 * 400, maxIn: 32 * 8, use: 32 }, slots: { upgrades: 4 }, machine: 'grower', time: CRYSTAL_GROWER_TIME, signal: true, desc: 'Slowly grows an End Crystal Cluster on Crystalline End Stone beside it (about one every five minutes), so crystal grows back.', guide: 'end_engineering' });
endComp({ id: 'teleport_node', name: 'Teleportation Node', kind: 'transport', tier: 4, nets: ['energy'], energy: { capacity: 250000, maxIn: 2048 }, machine: 'node', desc: 'Name it, then pick another node to go to. It links to every node in the End (and those within 2,000 blocks of the Overworld\'s spawn), never across dimensions. Each trip costs 1,000 EU plus 10 EU a block from this node\'s buffer, after 2 seconds standing on it.', guide: 'end_transport' });
endComp({ id: 'ender_bridge_projector', name: 'Ender Bridge Projector', kind: 'transport', tier: 3, nets: ['energy'], energy: { capacity: 8000, maxIn: 512 }, machine: 'bridge', signal: true, desc: 'Projects a solid, walkable bridge of Ender Light up to 64 blocks the way it faces, stopping at the first solid block. It uses 16 EU/t for every 16 blocks of bridge. Without power or its signal, the bridge flickers and fades over 3 seconds.', guide: 'end_transport' });
endComp({ id: 'ender_rail', name: 'Ender Rail', kind: 'transport', tier: 3, nets: ['energy'], energy: { capacity: 400, maxIn: 64, use: 1 }, machine: 'rail', desc: 'A rail that, powered (with a signal, or 1 EU/t from a cable), drives minecarts at twice a powered rail\'s speed. It can lie on Ender Light, carrying a line over the void.', guide: 'end_transport' });
// Quest machines (placed by a repair, never crafted)
endComp({ id: 'restored_ancient_lens', name: 'Restored Ancient Lens', kind: 'machine', tier: 4, nets: ['energy'], energy: { capacity: 256 * 600, maxIn: 1024, use: 256 }, machine: 'lens', uncraftable: true, desc: 'An observatory\'s Ancient Lens, repaired. Powered at 256 EU/t for 30 seconds it wakes; then look through the telescope.', guide: 'end_engineering' });
endComp({ id: 'crystal_pedestal', name: 'Crystal Pedestal', kind: 'machine', tier: 4, nets: ['energy'], energy: { capacity: 64 * 200, maxIn: 512, use: 64 }, machine: 'pedestal', uncraftable: true, desc: 'One of the four pedestals before an End Palace\'s crystal vault. Each holds an End Crystal and must be powered from a Crystal Generator.', guide: 'end_engineering' });
// The Ancient Conduits of the old machines carry power again (blocks of phase 3)
endComp({ id: 'ancient_conduit', name: 'Ancient Conduit', kind: 'cable', tier: 2, nets: ['energy'], cableCap: 512, existing: true, uncraftable: true, desc: 'The old machines\' conduits carry power again, up to 512 EU/t: cable an observatory\'s telescope at its foot and the power climbs the tube.', guide: 'end_engineering' });
endComp({ id: 'ancient_core', name: 'Ancient Core (dormant)', kind: 'cable', tier: 2, nets: ['energy'], cableCap: 512, existing: true, uncraftable: true, desc: 'A dormant core passes power along like a conduit. In a giant structure one core can be restored (8 Ancient Fragments and an Astral Shard) into a Restored Ancient Core.', guide: 'end_engineering' });

// V6 phase 5: the Void Citadel's engineering floors (their blocks are the Citadel's, never crafted or broken)
endComp({ id: 'citadel_core', name: 'Citadel Core', kind: 'generator', tier: 4, nets: ['energy'], energy: { capacity: 102400, maxOut: 1024, gen: ANCIENT_CORE_GEN }, existing: true, uncraftable: true, desc: 'A Void Citadel\'s core, still running: 512 EU/t to whatever its broken conduits reach. Bridge them with your own cable.', guide: 'end_engineering' });
endComp({ id: 'citadel_socket', name: 'Citadel Socket', kind: 'machine', tier: 4, nets: ['energy'], energy: { capacity: 64 * 200, maxIn: 512, use: 64 }, machine: 'socket', signal: true, existing: true, uncraftable: true, desc: 'The lock of a Void Citadel\'s engineering floor: powered from the floor\'s core, it opens the door when the signal it gets follows the rule on the wall. Use it to have it check.', guide: 'end_engineering' });

/** End engineering components (phase 4). */
export const END_COMPONENTS: readonly ComponentDef[] = E;
/**
 * Every component a player builds (made at the Engineering Crafting Table).
 * The End's restored machines (the Restored Ancient Core, the Restored
 * Ancient Lens, the Crystal Vault's pedestals) and the ancient conduits and
 * cores that carry power are found, never made: they are in END_COMPONENTS
 * and COMPONENT_BY_ID but not here.
 */
export const COMPONENTS: readonly ComponentDef[] = [...C, ...E.filter((c) => !c.uncraftable)];
export const COMPONENT_BY_ID: ReadonlyMap<string, ComponentDef> = new Map([...C, ...E].map((c) => [c.id, c]));

/** Machines whose block faces the player who placed them (generators, machines, sensors...). */
const FACED = new Set<EngKind>(['generator', 'machine', 'multiblock', 'hopper', 'extractor', 'sorter', 'pump', 'outlet', 'monitor', 'control_panel', 'conveyor', 'computer', 'peripheral', 'server']);

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------
const BOOL = ['false', 'true'] as const;
const FACING4 = ['north', 'south', 'west', 'east'] as const;
const FACING6 = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
const STATUS = ['idle', 'working', 'error'] as const;
/** V5.5: what a computer's screen shows. */
export const SCREENS = ['off', 'boot', 'on', 'err', 'glitch', 'portal'] as const;
const ARMS: PropDefs = { north: BOOL, south: BOOL, west: BOOL, east: BOOL, up: BOOL, down: BOOL };

export const GATE_MODES = ['and', 'or', 'xor', 'nand', 'nor', 'not'] as const;

/** Block definitions for every V5 engineering block (appended to the block registry). */
export function engineeringBlockDefs(): BlockDef[] {
  return blockDefsFor(C);
}

/** V6 phase 4: the End engineering blocks (appended after the expansion's phase 3 blocks). */
export function endEngineeringBlockDefs(): BlockDef[] {
  return blockDefsFor(E.filter((c) => !c.existing));
}

const RAIL_STRAIGHT = ['north_south', 'east_west', 'ascending_north', 'ascending_south', 'ascending_east', 'ascending_west'] as const;

function blockDefsFor(list: readonly ComponentDef[]): BlockDef[] {
  const out: BlockDef[] = [];
  const metal = (c: ComponentDef, o: Partial<BlockDef>): void => {
    out.push({
      id: c.id,
      name: c.name,
      hardness: c.tier >= 3 ? 5 : 3.5,
      resistance: 12,
      sound: 'metal',
      model: 'cube',
      tex: { all: c.id },
      tool: 'pickaxe',
      harvestLevel: 1,
      requiresTool: true,
      interact: 'engineering',
      entity: 'eng',
      creative: 'engineering',
      ...o,
    } as BlockDef);
  };
  for (const c of list) {
    const faced = FACED.has(c.kind);
    if (c.kind === 'transport') {
      if (c.id === 'teleport_node') metal(c, { props: { status: STATUS }, tex: { all: 'teleport_node_side', top: 'teleport_node_top', top_on: 'teleport_node_top_on', top_err: 'teleport_node_top_err', bottom: 'machine_bottom' }, light: 4 });
      else if (c.id === 'ender_bridge_projector') metal(c, { props: { facing: FACING4, status: STATUS }, tex: { all: 'ender_bridge_projector_side', top: 'ender_bridge_projector_top', bottom: 'machine_bottom', front: 'ender_bridge_projector_front', front_on: 'ender_bridge_projector_front_on', front_err: 'ender_bridge_projector_front_err' }, light: 0 });
      else if (c.id === 'ender_rail') metal(c, { hardness: 0.7, harvestLevel: 0, requiresTool: false, model: 'rail', layer: 'cutout', opacity: 0, collide: false, props: { shape: RAIL_STRAIGHT, powered: BOOL }, tex: { all: 'ender_rail', on: 'ender_rail_on' }, place: 'needs_solid_below', light: 0, interact: undefined, tags: ['rails'] });
      continue;
    }
    if (c.id === 'restored_ancient_core') {
      metal(c, { hardness: 30, resistance: 1200, harvestLevel: 3, props: { facing: FACING4, status: STATUS }, tex: { all: 'restored_ancient_core_side', top: 'restored_ancient_core_top', bottom: 'restored_ancient_core_top', front: 'restored_ancient_core_front', front_on: 'restored_ancient_core_front_on', front_err: 'restored_ancient_core_front_err' }, light: 9, drops: { item: 'none', silkTouch: true }, creative: 'hidden' });
      continue;
    }
    if (c.id === 'restored_ancient_lens') {
      metal(c, { hardness: -1, resistance: 3600000, props: { status: STATUS }, tex: { all: 'restored_ancient_lens', all_on: 'restored_ancient_lens_on' }, layer: 'translucent', opacity: 0, light: 6, drops: 'none', creative: 'hidden', item: false });
      continue;
    }
    if (c.id === 'crystal_pedestal') {
      metal(c, { hardness: -1, resistance: 3600000, model: 'custom', layer: 'cutout', opacity: 0, props: { crystal: BOOL, lit: BOOL }, tex: { all: 'crystal_pedestal', top: 'crystal_pedestal_top', on: 'crystal_pedestal_on' }, light: 7, drops: 'none', creative: 'hidden', item: false });
      continue;
    }
    switch (c.kind) {
      case 'station':
        out.push({ id: c.id, name: c.name, hardness: 2.5, sound: 'wood', model: 'cube', tex: { top: 'engineering_table_top', side: 'engineering_table_side', front: 'engineering_table_front', bottom: 'oak_planks' }, tool: 'axe', interact: 'engineering_table', creative: 'engineering' } as BlockDef);
        break;
      case 'cable':
      case 'data_cable':
      case 'item_pipe':
      case 'fluid_pipe':
      case 'item_filter':
      case 'valve':
      case 'fluid_filter': {
        const extra: PropDefs = c.kind === 'valve' ? { open: BOOL } : {};
        metal(c, {
          hardness: c.kind === 'cable' || c.kind === 'data_cable' ? 0.5 : 1,
          harvestLevel: 0,
          requiresTool: false,
          model: 'custom',
          layer: 'cutout',
          opacity: 0,
          props: { ...ARMS, ...extra },
          defaults: c.kind === 'valve' ? { open: 'true' } : {},
          tex: { all: c.id },
          interact: c.kind === 'cable' || c.kind === 'data_cable' || c.kind === 'item_pipe' || c.kind === 'fluid_pipe' ? undefined : 'engineering',
          entity: c.kind === 'cable' || c.kind === 'data_cable' || c.kind === 'item_pipe' || c.kind === 'fluid_pipe' ? undefined : 'eng',
        });
        break;
      }
      case 'conveyor':
        metal(c, { hardness: 1, harvestLevel: 0, model: 'custom', layer: 'cutout', opacity: 0, props: { facing: FACING4 }, tex: { all: c.id + '_side', top: c.id + '_belt' }, interact: undefined, entity: undefined });
        break;
      case 'tank':
        metal(c, { model: 'custom', layer: 'cutout', opacity: 0, props: { fluid: ['none', 'water', 'lava'], level: ['0', '1', '2', '3', '4', '5', '6', '7', '8'] }, tex: { all: 'fluid_tank', top: 'fluid_tank_top' }, light: 0 });
        break;
      case 'battery':
        metal(c, { props: { charge: ['0', '1', '2', '3', '4'] }, tex: { top: c.id + '_top', side: c.id + '_side', bottom: c.id + '_top' }, texBy: 'charge' });
        break;
      case 'hopper':
        metal(c, { model: 'custom', layer: 'cutout', opacity: 0, props: { facing: ['down', 'north', 'south', 'west', 'east'] }, tex: { all: 'hopper_side', top: 'hopper_top' } });
        break;
      case 'chute':
        metal(c, { model: 'custom', layer: 'cutout', opacity: 0, tex: { all: 'chute' } });
        break;
      case 'signal': {
        if (c.id === 'signal_cable') {
          const SIDE = ['none', 'side', 'up'] as const;
          out.push({ id: c.id, name: c.name, hardness: 0, sound: 'stone', model: 'custom', props: { north: SIDE, south: SIDE, west: SIDE, east: SIDE, power: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'] }, tex: { all: 'signal_cable_line', dot: 'signal_cable_dot', on: 'signal_cable_line_on', on_dot: 'signal_cable_dot_on', particle: 'signal_cable_dot' }, collide: false, layer: 'cutout', place: 'needs_solid_below', creative: 'engineering', tags: ['redstone'] } as BlockDef);
        } else if (c.id === 'warning_light') {
          metal(c, { hardness: 1, harvestLevel: 0, model: 'custom', layer: 'cutout', opacity: 0, props: { lit: BOOL }, tex: { all: 'warning_light', on: 'warning_light_on', base: 'warning_light_base' }, light: 12, interact: undefined, entity: undefined, tags: ['redstone'] });
        } else {
          const props: PropDefs = { facing: FACING4, lit: BOOL };
          if (c.id === 'logic_gate') props.mode = GATE_MODES;
          metal(c, { hardness: 0.5, harvestLevel: 0, requiresTool: false, model: 'custom', layer: 'cutout', opacity: 0, props, tex: { all: 'signal_plate', top: c.id, top_on: c.id + '_on' }, place: 'needs_solid_below', tags: ['redstone'] });
        }
        break;
      }
      case 'decor': {
        if (c.id === 'industrial_door') {
          out.push({ id: c.id, name: c.name, hardness: 5, sound: 'metal', model: 'door', props: { facing: FACING4, half: ['lower', 'upper'], open: BOOL, hinge: ['left', 'right'] }, tex: { top: 'industrial_door_top', bottom: 'industrial_door_bottom', particle: 'industrial_door_bottom' }, tool: 'pickaxe', harvestLevel: 1, requiresTool: true, tags: ['doors'], creative: 'engineering' } as BlockDef);
        } else if (c.id === 'industrial_glass') {
          out.push({ id: c.id, name: c.name, hardness: 1.5, resistance: 12, sound: 'glass', model: 'cube', tex: { all: c.id }, layer: 'cutout', opacity: 0, tool: 'pickaxe', creative: 'engineering', drops: { item: c.id } } as BlockDef);
        } else if (c.id === 'metal_grate') {
          out.push({ id: c.id, name: c.name, hardness: 3, sound: 'metal', model: 'cube', tex: { all: c.id }, layer: 'cutout', opacity: 0, tool: 'pickaxe', harvestLevel: 0, requiresTool: true, creative: 'engineering' } as BlockDef);
        } else {
          out.push({ id: c.id, name: c.name, hardness: c.id === 'steel_block' ? 5 : 3.5, resistance: 12, sound: 'metal', model: 'cube', tex: { all: c.id }, tool: 'pickaxe', harvestLevel: 1, requiresTool: true, light: c.id === 'factory_light' ? 15 : 0, creative: 'engineering' } as BlockDef);
        }
        break;
      }
      case 'computer':
        // The screen shows what the computer is doing: off, starting up, running, trouble, corrupted, a way in
        metal(c, { props: { facing: FACING4, screen: SCREENS }, tex: { all: 'computer_side', top: 'computer_top', bottom: 'machine_bottom', front: 'computer_front' }, frontBy: 'screen', light: 0 });
        break;
      case 'peripheral': {
        const props: PropDefs = { facing: FACING4 };
        if (c.peripheral === 'led') props.lit = BOOL;
        metal(c, { hardness: 0.8, harvestLevel: 0, requiresTool: false, model: 'custom', layer: 'cutout', opacity: 0, props, tex: c.peripheral === 'led' ? { all: c.id, top: c.id + '_top', on: c.id + '_on' } : { all: c.id, top: c.id + '_top' }, light: c.peripheral === 'led' ? 7 : 0, interact: undefined, entity: undefined, place: c.peripheral === 'led' ? undefined : 'needs_solid_below' });
        break;
      }
      case 'storage':
        metal(c, { tex: { top: c.id + '_top', side: c.id + '_side', bottom: c.id + '_top', front: c.id === 'storage_barrel' ? 'storage_barrel_front' : undefined }, props: c.id === 'storage_barrel' ? { facing: FACING4 } : undefined, hardness: c.tier === 1 ? 2.5 : 3.5, sound: c.tier === 1 ? 'wood' : 'metal', tool: c.tier === 1 ? 'axe' : 'pickaxe', harvestLevel: 0, requiresTool: c.tier !== 1 });
        break;
      case 'sorter':
      case 'extractor':
        metal(c, { props: { facing: FACING6 }, tex: { all: c.id + '_side', front: c.id + '_front', back: c.id + '_back' } });
        break;
      default: {
        const props: PropDefs = {};
        if (faced) props.facing = FACING4;
        if (c.kind === 'generator' || c.kind === 'machine' || c.kind === 'multiblock' || c.kind === 'pump' || c.kind === 'monitor' || c.kind === 'control_panel' || c.kind === 'server') props.status = STATUS;
        metal(c, {
          props,
          tex: { all: c.id + '_side', top: c.id + '_top', bottom: 'machine_bottom', front: c.id + '_front', front_on: c.id + '_front_on', front_err: c.id + '_front_err' },
          light: c.kind === 'monitor' || c.kind === 'control_panel' ? 6 : 0,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Items (materials, components, upgrades, the book)
// ---------------------------------------------------------------------------
export const ENG_MATERIALS = ['copper_dust', 'iron_dust', 'gold_dust', 'coal_dust', 'steel_blend', 'steel_ingot', 'iron_plate', 'steel_plate', 'iron_gear', 'copper_coil', 'motor', 'control_circuit', 'advanced_circuit'] as const;
export const UPGRADES = ['speed_upgrade', 'efficiency_upgrade', 'capacity_upgrade', 'range_upgrade'] as const;
/** V5.5: electronics and computer parts (installed in a computer's slots). */
export const ELECTRONICS = ['circuit_board', 'electronic_components', 'connector'] as const;
export const COMPUTER_PARTS = ['power_supply', 'motherboard', 'cpu', 'ram_module', 'gpu', 'network_card', 'hard_drive', 'flash_drive'] as const;
export type ComputerPart = (typeof COMPUTER_PARTS)[number];
export type UpgradeId = (typeof UPGRADES)[number];

export function engineeringItemDefs(): ItemDef[] {
  const title = (id: string): string =>
    id
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const out: ItemDef[] = [];
  for (const id of ENG_MATERIALS) out.push({ id, name: title(id), creative: 'engineering', tags: ['engineering'], ...(id === 'coal_dust' ? { fuel: 1600 } : {}) });
  for (const id of UPGRADES) out.push({ id, name: title(id), maxStack: 16, rarity: 'uncommon', creative: 'engineering', tags: ['engineering', 'upgrade'] });
  out.push({ id: 'engineering_book', name: 'Engineering Book', maxStack: 1, use: 'engineering_book', rarity: 'uncommon', creative: 'engineering' });
  // V5.5: electronics, computer parts and drives
  for (const id of ELECTRONICS) out.push({ id, name: title(id), creative: 'engineering', tags: ['engineering', 'electronics'] });
  const PART_NAMES: Record<string, string> = { power_supply: 'Power Supply', motherboard: 'Motherboard', cpu: 'CPU', ram_module: 'RAM Module', gpu: 'Graphics Card', network_card: 'Network Card', hard_drive: 'Hard Drive', flash_drive: 'Flash Drive' };
  for (const id of COMPUTER_PARTS) {
    const drive = id === 'hard_drive' || id === 'flash_drive';
    out.push({ id, name: PART_NAMES[id]!, maxStack: drive ? 1 : 16, rarity: id === 'cpu' || id === 'gpu' ? 'uncommon' : 'common', creative: 'engineering', tags: ['engineering', 'computer_part', ...(drive ? ['drive'] : [])] });
  }
  // Never crafted: what the Ender Dragon's malware makes of a flash drive
  out.push({ id: 'corrupted_flash_drive', name: 'Corrupted Flash Drive', maxStack: 1, rarity: 'glitched', glint: true, creative: 'hidden', tags: ['computer_part', 'drive'] });
  return out;
}

/** What each upgrade does (also shown in the book). */
export const UPGRADE_INFO: Record<UpgradeId, string> = {
  speed_upgrade: 'Works 1.6x faster per upgrade, but uses 2x the power.',
  efficiency_upgrade: 'Uses 30% less power per upgrade, at the same speed.',
  capacity_upgrade: 'Quadruples the energy and fluid buffers, and pumps and extractors move more at once.',
  range_upgrade: 'Area machines (drills, quarries, farming machines, scanners) reach 2 blocks further.',
};

// ---------------------------------------------------------------------------
// Engineering Crafting Table recipes (never in the normal crafting table)
// ---------------------------------------------------------------------------
export interface EngShaped {
  type: 'shaped';
  pattern: string[];
  key: Record<string, string>;
  result: string;
  count?: number;
}
export interface EngShapeless {
  type: 'shapeless';
  ingredients: string[];
  result: string;
  count?: number;
}
export type EngRecipe = EngShaped | EngShapeless;

export const ENG_CRAFTING: EngRecipe[] = [];
const shaped = (result: string, count: number, pattern: string[], key: Record<string, string>): void => void ENG_CRAFTING.push({ type: 'shaped', pattern, key, result, count });
const shapeless = (result: string, count: number, ...ingredients: string[]): void => void ENG_CRAFTING.push({ type: 'shapeless', ingredients, result, count });

const K = {
  C: 'copper_ingot',
  I: 'iron_ingot',
  G: 'gold_ingot',
  R: 'redstone',
  S: 'steel_ingot',
  P: 'steel_plate',
  p: 'iron_plate',
  g: 'iron_gear',
  c: 'copper_coil',
  M: 'motor',
  X: 'control_circuit',
  A: 'advanced_circuit',
  L: 'glass',
  D: 'diamond',
  O: 'glowstone_dust',
  K: 'machine_casing',
  T: 'smooth_stone',
  W: '#planks',
  s: 'stick',
  F: 'flint',
  w: '#wool_any',
  t: 'string',
};
const k = (...letters: string[]): Record<string, string> => Object.fromEntries(letters.map((l) => [l, K[l as keyof typeof K]]));
const with_ = (base: Record<string, string>, extra: Record<string, string>): Record<string, string> => ({ ...base, ...extra });

// Components and materials
shaped('iron_gear', 2, [' I ', 'I I', ' I '], k('I'));
shaped('copper_coil', 2, ['CCC', 'CIC', 'CCC'], k('C', 'I'));
shapeless('steel_blend', 1, 'iron_dust', 'coal_dust', 'coal_dust');
shaped('motor', 1, [' p ', 'cgc', ' p '], k('p', 'c', 'g'));
shaped('control_circuit', 2, ['RpR', 'GCG', 'RpR'], k('R', 'p', 'G', 'C'));
shaped('advanced_circuit', 2, ['GXG', 'DRD', 'GXG'], k('G', 'X', 'D', 'R'));
shaped('steel_block', 1, ['SSS', 'SSS', 'SSS'], k('S'));
shapeless('steel_ingot', 9, 'steel_block');
// Tier 1
shaped('water_wheel', 1, ['sWs', 'WgW', 'sWs'], k('s', 'W', 'g'));
shaped('solar_panel', 1, ['LLL', 'CRC', 'III'], k('L', 'C', 'R', 'I'));
shaped('copper_wire', 12, ['CCC'], k('C'));
shaped('battery', 1, [' C ', 'IRI', 'IRI'], k('C', 'I', 'R'));
shaped('crusher', 1, ['IgI', 'FcF', 'ITI'], k('I', 'g', 'F', 'c', 'T'));
shaped('electric_furnace', 1, ['III', 'cUc', 'IRI'], with_(k('I', 'c', 'R'), { U: 'furnace' }));
shaped('crate', 1, ['WIW', 'W W', 'WIW'], k('W', 'I'));
shaped('conveyor', 8, ['LLL', 'gRg'], with_(k('g', 'R'), { L: 'leather' }));
shaped('hopper', 1, ['I I', 'IUI', ' I '], with_(k('I'), { U: 'chest' }));
shaped('chute', 4, ['I I', 'I I', 'I I'], k('I'));
shaped('signal_cable', 8, ['tRt'], k('t', 'R'));
// Tier 2
shaped('compressor', 1, ['IgI', 'ScS', 'III'], k('I', 'g', 'S', 'c'));
shaped('grinder', 1, ['SgS', 'FMF', 'SXS'], k('S', 'g', 'F', 'M', 'X'));
shaped('cutter', 1, ['SgS', 'pMp', 'SXS'], k('S', 'g', 'p', 'M', 'X'));
shaped('wind_turbine', 1, [' p ', 'pMp', ' S '], k('p', 'M', 'S'));
shaped('steam_generator', 1, ['SBS', 'cUc', 'SXS'], with_(k('S', 'c', 'X'), { B: 'bucket', U: 'furnace' }));
shaped('insulated_cable', 8, ['www', 'CCC', 'www'], k('w', 'C'));
shaped('battery_bank', 1, ['BBB', 'BXB', 'SSS'], with_(k('X', 'S'), { B: 'battery' }));
shaped('industrial_chest', 1, ['SpS', 'pUp', 'SpS'], with_(k('S', 'p'), { U: 'crate' }));
shaped('storage_barrel', 1, ['SpS', 'pUp', 'SpS'], with_(k('S', 'p'), { U: 'barrel' }));
shaped('express_conveyor', 3, ['UUU', 'pMp'], with_(k('p', 'M'), { U: 'conveyor' }));
shaped('item_pipe', 8, ['pLp'], k('p', 'L'));
shaped('item_extractor', 1, [' H ', 'pMp', ' X '], with_(k('p', 'M', 'X'), { H: 'hopper' }));
shapeless('item_filter', 1, 'item_pipe', 'paper', 'control_circuit');
shaped('item_sorter', 1, ['pHp', 'XcX', 'pHp'], with_(k('p', 'X', 'c'), { H: 'hopper' }));
shaped('fluid_pipe', 8, ['SLS'], k('S', 'L'));
shaped('pump', 1, ['SBS', 'gMg', 'SXS'], with_(k('S', 'g', 'M', 'X'), { B: 'bucket' }));
shaped('fluid_tank', 1, ['SLS', 'L L', 'SLS'], k('S', 'L'));
shapeless('fluid_valve', 1, 'fluid_pipe', 'lever', 'iron_plate');
shapeless('fluid_filter', 1, 'fluid_pipe', 'paper', 'control_circuit');
shapeless('fluid_outlet', 1, 'fluid_pipe', 'bucket', 'iron_plate');
shaped('timer', 1, ['pRp', 'RXR', 'pRp'], k('p', 'R', 'X'));
shaped('logic_gate', 2, ['RXR', 'TTT'], k('R', 'X', 'T'));
shaped('level_sensor', 1, [' R ', 'RXR', 'TTT'], k('R', 'X', 'T'));
shaped('item_sensor', 1, [' L ', 'RXR', 'TTT'], k('L', 'R', 'X', 'T'));
shaped('warning_light', 2, ['pRp', 'LOL', 'pLp'], k('p', 'R', 'L', 'O'));
shaped('speed_upgrade', 1, ['RgR', 'pXp', 'RgR'], k('R', 'g', 'p', 'X'));
shaped('efficiency_upgrade', 1, ['GpG', 'pXp', 'GpG'], k('G', 'p', 'X'));
shaped('crop_planter', 1, ['SHS', 'gMg', 'SXS'], with_(k('S', 'g', 'M', 'X'), { H: 'iron_hoe' }));
shaped('crop_harvester', 1, ['SHS', 'gMg', 'SXS'], with_(k('S', 'g', 'M', 'X'), { H: 'shears' }));
shaped('irrigation_sprinkler', 1, ['pBp', 'LfL', 'SXS'], with_(k('p', 'L', 'S', 'X'), { B: 'bucket', f: 'fluid_pipe' }));
shaped('item_collector', 1, ['pHp', 'gMg', 'SXS'], with_(k('p', 'g', 'M', 'S', 'X'), { H: 'hopper' }));
shaped('animal_feeder', 1, ['pUp', 'gMg', 'SXS'], with_(k('p', 'g', 'M', 'S', 'X'), { U: 'wheat' }));
shaped('machine_casing', 4, ['SpS', 'p p', 'SpS'], k('S', 'p'));
shaped('industrial_glass', 4, ['pLp', 'LLL', 'pLp'], k('p', 'L'));
shaped('metal_grate', 4, ['pp', 'pp'], k('p'));
shaped('hazard_stripes', 8, ['YBY', 'BpB', 'YBY'], with_(k('p'), { Y: 'yellow_dye', B: 'black_dye' }));
shaped('factory_light', 4, ['pLp', 'LOL', 'pLp'], k('p', 'L', 'O'));
shaped('industrial_door', 3, ['PP', 'PP', 'PP'], k('P'));
// Tier 3
shaped('advanced_generator', 1, ['PAP', 'MUM', 'PKP'], with_(k('P', 'A', 'M', 'K'), { U: 'steam_generator' }));
shaped('power_conduit', 8, ['PPP', 'UUU', 'PPP'], with_(k('P'), { U: 'insulated_cable' }));
shaped('recycler', 1, ['PcP', 'gKg', 'PAP'], k('P', 'c', 'g', 'K', 'A'));
shaped('mining_drill', 1, ['PMP', 'gKg', 'PAP'], k('P', 'M', 'g', 'K', 'A'));
shaped('ore_scanner', 1, ['PLP', 'AKA', 'PRP'], k('P', 'L', 'A', 'K', 'R'));
shaped('item_vault', 1, ['PUP', 'UKU', 'PUP'], with_(k('P', 'K'), { U: 'industrial_chest' }));
shaped('industrial_furnace', 1, ['PUP', 'AKA', 'PUP'], with_(k('P', 'A', 'K'), { U: 'electric_furnace' }));
shaped('advanced_crusher', 1, ['PUP', 'AKA', 'PUP'], with_(k('P', 'A', 'K'), { U: 'crusher' }));
shaped('capacity_upgrade', 1, ['PbP', 'bAb', 'PbP'], with_(k('P', 'A'), { b: 'battery' }));
shaped('range_upgrade', 1, ['PeP', 'eAe', 'PeP'], with_(k('P', 'A'), { e: 'ender_pearl' }));
shaped('monitor', 1, ['PLP', 'LAL', 'PRP'], k('P', 'L', 'A', 'R'));
// Tier 4
shaped('energy_cell', 1, ['DbD', 'bAb', 'DbD'], with_(k('D', 'A'), { b: 'battery_bank' }));
shaped('large_generator', 1, ['PaP', 'AKA', 'PaP'], with_(k('P', 'A', 'K'), { a: 'advanced_generator' }));
shaped('quarry', 1, ['PdP', 'AKA', 'PdP'], with_(k('P', 'A', 'K'), { d: 'mining_drill' }));
shaped('assembler', 1, ['PUP', 'AKA', 'PXP'], with_(k('P', 'A', 'K', 'X'), { U: 'crafting_table' }));
shaped('control_panel', 1, ['PmP', 'AKA', 'PRP'], with_(k('P', 'A', 'K', 'R'), { m: 'monitor' }));

// V5.5 - electronics and computers
shaped('circuit_board', 2, ['CRC', 'ppp'], k('C', 'R', 'p'));
shaped('electronic_components', 4, ['RCR', 'LGL'], k('R', 'C', 'L', 'G'));
shaped('connector', 4, ['C C', 'pCp'], k('C', 'p'));
shaped('power_supply', 1, ['pcp', 'XbX', 'pnp'], with_(k('p', 'c', 'X'), { b: 'battery', n: 'connector' }));
shaped('motherboard', 1, ['ene', 'XBX', 'nBn'], with_(k('X'), { e: 'electronic_components', n: 'connector', B: 'circuit_board' }));
shaped('cpu', 1, ['eGe', 'GAG', 'eGe'], with_(k('G', 'A'), { e: 'electronic_components' }));
shaped('ram_module', 2, ['eee', 'BBB', 'n n'], { e: 'electronic_components', B: 'circuit_board', n: 'connector' });
shaped('gpu', 1, ['ePe', 'AOA', 'nBn'], with_(k('P', 'A', 'O'), { e: 'electronic_components', n: 'connector', B: 'circuit_board' }));
shaped('network_card', 1, ['nCn', 'eBe'], with_(k('C'), { e: 'electronic_components', n: 'connector', B: 'circuit_board' }));
shaped('hard_drive', 1, ['pgp', 'eXe', 'pnp'], with_(k('p', 'g', 'X'), { e: 'electronic_components', n: 'connector' }));
shaped('flash_drive', 1, ['n', 'B', 'p'], with_(k('p'), { n: 'connector', B: 'circuit_board' }));
shaped('computer', 1, ['PLP', 'pKp', 'PnP'], with_(k('P', 'L', 'p', 'K'), { n: 'connector' }));
shaped('keyboard', 1, ['bbb', 'pep'], with_(k('p'), { b: 'stone_button', e: 'electronic_components' }));
shaped('mouse', 1, ['bnb', 'pep'], with_(k('p'), { b: 'stone_button', n: 'connector', e: 'electronic_components' }));
shaped('speaker', 1, ['pnp', 'pNp', 'pep'], with_(k('p'), { n: 'connector', N: 'note_block', e: 'electronic_components' }));
shaped('led_light', 4, ['L', 'O', 'e'], with_(k('L', 'O'), { e: 'electronic_components' }));
shaped('network_cable', 8, ['www', 'CnC', 'www'], with_(k('w', 'C'), { n: 'connector' }));
shaped('server_rack', 1, ['PnP', 'hKh', 'PnP'], with_(k('P', 'K'), { n: 'connector', h: 'hard_drive' }));

// V6 phase 4 - End engineering (made from the End's resources)
{
  const E = { F: 'end_crystal_fragment', V: 'void_shard', Y: 'ender_alloy_ingot', U: 'insulated_cable', D: 'dark_end_stone', G: 'crystal_glass', B: 'battery', c: 'crusher', Q: 'crystalline_end_stone', R: 'chorus_rope', A: 'advanced_circuit', P: 'steel_plate', X: 'control_circuit', a: 'astral_shard', e: 'ender_pearl', n: 'chorus_planks' };
  const e = (...letters: string[]): Record<string, string> => Object.fromEntries(letters.map((l) => [l, E[l as keyof typeof E]]));
  shaped('crystal_generator', 1, ['FYF', 'UXU', 'FYF'], e('F', 'Y', 'U', 'X'));
  shaped('void_collector', 1, ['GGG', 'VDV', 'DDD'], e('G', 'V', 'D'));
  shaped('void_cell', 1, ['VYV', 'YBY', 'VYV'], e('V', 'Y', 'B'));
  shaped('end_processor', 1, ['YFY', 'FcF', 'YXY'], e('Y', 'F', 'c', 'X'));
  shaped('crystal_grower', 1, ['FGF', 'QXQ', 'QQQ'], e('F', 'G', 'Q', 'X'));
  shaped('teleport_node', 1, ['aea', 'YAY', 'PPP'], e('a', 'e', 'Y', 'A', 'P'));
  shaped('ender_bridge_projector', 1, ['RFR', 'YXY', 'RFR'], e('R', 'F', 'Y', 'X'));
  shaped('ender_rail', 16, ['Y Y', 'YFY', 'Y Y'], e('Y', 'F'));
}

/** Extra recipe tag used by engineering recipes. */
export const ENG_TAGS: Record<string, (colors: readonly string[]) => string[]> = {
  wool_any: (colors) => colors.map((c) => `${c}_wool`),
};

// ---------------------------------------------------------------------------
// Machine processing recipes
// ---------------------------------------------------------------------------
export interface MachineRecipe {
  input: string;
  /** Input items used per operation. */
  inCount?: number;
  output: string;
  count: number;
  /** V6: a count from `count` to `countMax` (inclusive) each time. */
  countMax?: number;
  /** A bonus output now and then. */
  bonus?: { item: string; chance: number };
}

const ORE_DUSTS: [string[], string][] = [
  [['raw_iron', 'iron_ore', 'deepslate_iron_ore'], 'iron_dust'],
  [['raw_gold', 'gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'], 'gold_dust'],
  [['raw_copper', 'copper_ore', 'deepslate_copper_ore'], 'copper_dust'],
];

export const MACHINE_RECIPES: Record<string, MachineRecipe[]> = {
  crusher: [
    ...ORE_DUSTS.flatMap(([ins, dust]) => ins.map((input) => ({ input, output: dust, count: 2 }))),
    { input: 'coal', output: 'coal_dust', count: 1 },
    { input: 'charcoal', output: 'coal_dust', count: 1 },
    { input: 'cobblestone', output: 'gravel', count: 1 },
    { input: 'stone', output: 'cobblestone', count: 1 },
    { input: 'gravel', output: 'sand', count: 1, bonus: { item: 'flint', chance: 0.1 } },
    { input: 'sandstone', output: 'sand', count: 4 },
    { input: 'glowstone', output: 'glowstone_dust', count: 4 },
    { input: 'diamond_ore', output: 'diamond', count: 2 },
    { input: 'lapis_ore', output: 'lapis_lazuli', count: 10 },
    { input: 'redstone_ore', output: 'redstone', count: 6 },
  ],
  advanced_crusher: ORE_DUSTS.flatMap(([ins, dust]) => ins.map((input) => ({ input, output: dust, count: 3 }))),
  grinder: [
    { input: 'bone', output: 'bone_meal', count: 5 },
    { input: 'blaze_rod', output: 'blaze_powder', count: 4 },
    { input: 'sugar_cane', output: 'sugar', count: 2 },
    { input: 'gravel', output: 'flint', count: 1 },
    { input: 'cactus', output: 'green_dye', count: 2 },
    { input: 'beetroot', output: 'red_dye', count: 2 },
    { input: 'bone_block', output: 'bone_meal', count: 12 },
    ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => ({ input: `${c}_wool`, output: 'string', count: 4 })),
  ],
  compressor: [
    { input: 'iron_ingot', output: 'iron_plate', count: 1 },
    { input: 'steel_ingot', output: 'steel_plate', count: 1 },
    { input: 'ice', inCount: 4, output: 'packed_ice', count: 1 },
    { input: 'packed_ice', inCount: 4, output: 'blue_ice', count: 1 },
    { input: 'sand', inCount: 4, output: 'sandstone', count: 1 },
    { input: 'clay_ball', inCount: 4, output: 'clay', count: 1 },
    { input: 'snowball', inCount: 4, output: 'snow_block', count: 1 },
  ],
  cutter: [
    ...['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'].map((w) => ({ input: `${w}_log`, output: `${w}_planks`, count: 6 })),
    ...['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'].map((w) => ({ input: `${w}_planks`, output: 'stick', count: 4 })),
    { input: 'iron_plate', output: 'iron_gear', count: 1 },
    { input: 'copper_ingot', output: 'copper_wire', count: 6 },
  ],
  /** Smelting only an electric furnace does (the rest comes from the furnace recipes). */
  electric_furnace: [{ input: 'steel_blend', output: 'steel_ingot', count: 1 }],
  /** V6 phase 4: the End Processor (smelting Ender Ore still gives one scrap). */
  end_processor: [
    { input: 'ender_ore', output: 'ender_scrap', count: 2 },
    { input: 'void_crystal_ore', output: 'void_shard', count: 4, countMax: 6 },
    { input: 'end_crystal_cluster', output: 'end_crystal_fragment', count: 5 },
    { input: 'ancient_end_fragment', output: 'ancient_fragment', count: 3, bonus: { item: 'ancient_key_shard', chance: 0.04 } },
    { input: 'chorus_stalk', output: 'chorus_fiber', count: 4 },
  ],
};

/** Materials the recycler gives back (half of what went in, rounded down, at least one). */
export const RECYCLABLE = ['iron_ingot', 'gold_ingot', 'copper_ingot', 'diamond', 'netherite_ingot', 'steel_ingot', 'iron_plate', 'steel_plate', 'emerald', 'redstone', 'iron_gear', 'copper_coil'];

/** Dusts smelt into ingots in any furnace. */
export const DUST_SMELTING: [string, string][] = [
  ['iron_dust', 'iron_ingot'],
  ['gold_dust', 'gold_ingot'],
  ['copper_dust', 'copper_ingot'],
];

// ---------------------------------------------------------------------------
// Multiblocks: offsets are local (x right, y up, z back), the controller at the front
// ---------------------------------------------------------------------------
export interface MultiblockPattern {
  /** Local positions and what must be there; the controller sits at (0,0,0) facing -z. */
  parts: { at: [number, number, number]; block: string | string[] }[];
}

function hollowCube(): MultiblockPattern['parts'] {
  const parts: MultiblockPattern['parts'] = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = 0; z <= 2; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        parts.push({ at: [x, y, z], block: x === 0 && y === 0 && z === 1 ? 'air' : ['machine_casing', 'industrial_glass'] });
      }
  return parts;
}

export const MULTIBLOCKS: Record<string, MultiblockPattern> = {
  industrial_furnace: { parts: hollowCube() },
  large_generator: { parts: hollowCube() },
  advanced_crusher: {
    parts: [
      { at: [-1, 0, 0], block: 'machine_casing' },
      { at: [1, 0, 0], block: 'machine_casing' },
      { at: [-1, 0, 1], block: 'machine_casing' },
      { at: [0, 0, 1], block: 'crusher' },
      { at: [1, 0, 1], block: 'machine_casing' },
      ...[-1, 0, 1].flatMap((x) => [0, 1].map((z) => ({ at: [x, 1, z] as [number, number, number], block: 'machine_casing' }))),
    ],
  },
  quarry: {
    parts: [-1, 0, 1].flatMap((x) => [-1, 0, 1].filter((z) => x !== 0 || z !== 0).map((z) => ({ at: [x, 0, z] as [number, number, number], block: 'machine_casing' }))),
  },
};
