# MineHonk V5 - The Engineering Update: design

V5 adds engineering on top of the existing systems. It reuses the item and
block registries, block entities (saved with their chunk), container windows,
the crafting compiler, the fluid blocks, redstone (`Power`) and the admin and
advancement systems. Electronics (buildable PCs) are V5.5.

## Units and timing

- Energy is counted in **EU**; rates are **EU/t** (per game tick).
- Engineering runs in **steps every 4 ticks** (`ENG_STEP`). Rates are applied
  times 4 per step. Conveyors move entities every tick.
- Only loaded chunks simulate. A machine in an unloaded chunk keeps its state
  in its block entity and continues when the chunk loads again.

## Components (`src/common/engineering/catalog.ts`)

Every engineering block has a `ComponentDef` (shared by client and server):
kind, tier, which networks it joins (`energy`, `item`, `fluid`), energy
capacity and I/O, inventory layout, fluid capacity, and its Engineering Book
entry. Blocks are appended to the block registry in a V5 section; state is in
the block entity `{ type: 'eng', ... }`.

## Connections

`connectState` (placement.ts) gives conduits (cables, item pipes, fluid pipes)
six boolean arms (`north..down`). A conduit connects to another conduit of
the same network, and to any component that joins that network. One rule,
no special cases: `joins(state, net)`.

## Networks (server, `src/server/engineering/`)

- **Energy**: connected cables and devices. Built lazily by flood fill and
  cached; any block change on or next to a network member drops the cache.
  Each step: generators produce, consumers draw (proportionally when short),
  surplus charges batteries, deficits drain them. Throughput is limited by the
  weakest cable tier in the network (wire 64, insulated 512, conduit 4096 EU/t).
- **Items**: conveyors move item entities (visible) and insert them into the
  inventory they point into. Hoppers and chutes move items between
  inventories. Item pipes are a network: extractors pull from the inventory
  they face and deliver to the nearest accepting inventory along pipes,
  through item filters only when the item matches.
- **Fluids**: pumps take source blocks from the existing fluid world (water
  sources refill by the existing rules; lava does not). Pipes join pumps,
  tanks and fluid machines; valves (open/closed, signal controlled) and fluid
  filters gate the flow; outlets place source blocks. 1 bucket = 1000 mB.
- **Signals**: the redstone system. New parts plug into `Power`: signal
  cable (no decay), timers, logic gates, level sensors, item sensors,
  warning lights. Machines and generators have a signal mode (ignore / run
  when powered / run when unpowered). Old redstone wire and torches keep
  working but are no longer crafted or placed.

## Machines

Shared machine window (`kind: 'machine'`): input, output, fuel/tool and
upgrade slots, energy and fluid bars, progress, state, and configuration
buttons. States: idle, working, no power, no input, output full, disabled,
error. Block `status` prop (idle/working/error) drives the front texture.

Processing: crusher, grinder, electric furnace (uses smelting recipes),
compressor, cutter, recycler, assembler (vanilla crafting recipes only).
Upgrades: speed, efficiency, capacity, range (four slots). Machines push
their results out of their back (into an inventory, or onto a conveyor)
unless switched off in their window.

Multiblocks (`MULTIBLOCKS` in the catalog, checked in `machines.ts`):
controller + pattern of blocks, validated periodically: industrial furnace, advanced crusher, large generator, quarry.

Automation: mining drill, quarry (both use a pickaxe in a tool slot), ore
scanner, crop planter, crop harvester, irrigation sprinkler, item collector,
animal feeder.

## Crafting and the Engineering Book

Engineering items are crafted **only at the Engineering Crafting Table**
(own recipe list, never in the normal crafting table or Recipe Book). The
table and the Engineering Book themselves are crafted at a normal table.
The book holds the guides and an entry per component; its Craft button
fills the Engineering Crafting Table's grid and only works while that table
is open. Using the book on an engineering block, or a machine window's `?`,
opens that block's entry.

## Control rooms

Monitors show the network they are cabled to (power, batteries, machines,
storage, fluids, alerts). Control panels list the network's machines and
generators with on/off switches.

## Admin, advancements, saving, multiplayer

Admin Panel Engineering tab (cheats: never advancements). About a dozen
engineering advancements, credited to the player who placed the block.
Everything is server authoritative; state lives in block entities and item
entities, networks are rebuilt from the world, so saves cannot duplicate or
lose items, energy or fluid.

## End engineering (V6 phase 4)

The End Expansion's machines are ordinary components: `ComponentDef`s in the
same catalog (the `E` list, `endComp(...)`), joining the same EU networks
through the same cables, in the same machine window, with the same states and
signal modes, saved in the same `{ type: 'eng' }` block entities and crafted
at the Engineering Crafting Table. "End Power" is just EU made by End
generators. Their logic is in `src/server/engineering/end.ts`
(`EndEngineering`), called from the engineering step after the V5 machines.

| Machine | Kind | EU | Notes |
| --- | --- | --- | --- |
| Crystal Generator | generator | makes 128 EU/t | burns one End Crystal Fragment per 400 ticks (its fuel slot takes nothing else); buffer 51,200 |
| Void Collector | generator | makes 24 EU/t | only with at least 32 blocks of air below it, all the way down to the bottom of the world; ×`server.endEvents.voidStormFactor()` (phase 5's Void Storms, ×4) |
| Restored Ancient Core | generator | makes 512 EU/t | never runs out; never crafted: restored from a dormant Ancient Core where it was found; Silk Touch picks a restored one up |
| Void Cell | battery | stores 2,000,000 EU, 4,096 EU/t in and out | the ordinary battery logic; keeps its charge when broken |
| End Processor | machine | uses 64 EU/t, 100 ticks a job | the recipes below |
| Crystal Grower | machine | uses 32 EU/t | grows an End Crystal Cluster on Crystalline End Stone beside it (with air above) every 6,000 ticks (5 minutes) |
| Teleportation Node | transport | 1,000 EU + 10 EU a block per trip, from its own buffer (250,000) | see [END_EXPANSION.md](END_EXPANSION.md#transport) |
| Ender Bridge Projector | transport | 16 EU/t per 16 blocks of bridge | up to 64 blocks of Ender Light the way it faces; flickers and fades over 3 seconds without power or its signal |
| Ender Rail | transport | 1 EU/t (or a signal) | powered, drives minecarts twice as fast as a powered rail; can lie on Ender Light |
| Restored Ancient Lens | machine | uses 256 EU/t | the Lost Observatory's telescope: wakes after 600 ticks powered (quest only, never crafted) |
| Crystal Pedestal | machine | uses 64 EU/t | the Crystal Vault's pedestals: lit only by a network with a burning Crystal Generator (quest only, never crafted) |
| Ancient Conduit, Ancient Core (dormant) | cable | 512 EU/t | blocks found in the ancient structures; they carry power like cables but keep their own shapes |

End Processor recipes (`MACHINE_RECIPES.end_processor`; a recipe can give a
range with `countMax`):

| In | Out |
| --- | --- |
| Ender Ore | 2 Ender Scrap (a furnace still gives 1) |
| Void Crystal Ore | 4 to 6 Void Shards |
| End Crystal Cluster | 5 End Crystal Fragments |
| Ancient End Fragment (the block) | 3 Ancient Fragments, and a 4% chance of an Ancient Key Shard |
| Chorus Stalk | 4 Chorus Fiber |

Rules kept from the spec:

- **Few and focused.** Eight craftable End components, each needing the
  End's own resources (Ender Alloy, End Crystal Fragments, Void Shards,
  Astral Shards, Crystalline and Dark End Stone, chorus).
- **No working machines in structures.** Structures hold dormant cores,
  cracked lenses and conduits; a player restores or powers them.
- **Uncraftable means uncraftable.** Components marked `uncraftable` (the
  restored core, lens and pedestal) are left out of `COMPONENTS` (so out of
  the crafting table and the creative tab) but keep their Engineering Book
  entries, which say where they come from.
- **Cheats stay cheats.** Machines placed with cheat items or in a cheat
  context (and anything the Admin Panel fills or builds) are marked
  `cheat`, and nothing they do earns an advancement.
- **Status.** New status texts (`END_STATUS_TEXT`): no void below, no
  Crystalline End Stone, charging, no crystal, no Crystal Generator power,
  blocked. Each End machine has idle, working and error fronts
  (`tools/textures/v6phase4.ts`) and its own hum (`synth.ts`).

The Engineering Book has two new chapters, **End Engineering** and **End
Transport** (`guide.ts`), with the usual entries; recipes are shown from the
Recipe Book's data, not repeated.

Advancements (End tab): Power From the End (run a Crystal Generator), It
Still Hums (restore an Ancient Core), Bottled Void (fill a Void Cell), Light
Underfoot (cross the void on an Ender Bridge), Been There, Built That
(teleport between two of your own nodes).

The Admin Panel's End Expansion tab can fill the looked-at machine's buffer
and build an **End test line** (a fuelled Crystal Generator charging a Void
Cell, an End Processor, a Crystal Grower, two Teleportation Nodes and an
Ender Bridge Projector), all cheat-marked.

## The Void Citadel (V6 phase 5)

The Citadel's engineering floor is built from the same components. The
**Citadel Core** (an existing, uncraftable generator, 512 EU/t like a restored
Ancient Core) feeds the **Citadel Socket** (an existing, uncraftable signal
machine) through a run of broken Ancient Conduits; the player bridges the gaps
with their own cable and builds the floor's logic from levers and gates. Using
the socket has it try all eight lever combinations, one at a time, and open
the floor's door only if its signal follows the rule on the wall every time.

Both are generated, not placed, so their block entities (`type: 'eng'`) come
with the structure, and a newly generated chunk now registers its engineering
blocks at once (`onChunkGenerated` calls `engineering.onChunkLoaded`); before,
only chunks loaded from storage did. Existing conduits join the network like
any cable.

## Where things live

- `src/common/engineering/`: `catalog.ts` (components, block and item
  definitions, recipes, machine recipes, multiblock patterns), `connect.ts`
  (which blocks join which network), `conveyor.ts` (belt physics shared by
  client and server), `geometry.ts` (shapes of non-cube blocks, shared by
  collision and rendering), `guide.ts` (the Engineering Book's chapters and
  entries), `window.ts` (machine window props).
- `src/server/engineering/`: `Engineering.ts` (nodes, hooks, the step),
  `energy.ts`, `machines.ts`, `transport.ts`, `fluids.ts`, `signals.ts`,
  `control.ts`, `windows.ts`, `ports.ts` (inventories as seen by
  automation), `admin.ts` (Admin Panel tab), `state.ts`.
- Client: `ui/EngineeringBook.ts`, the `machine` and `eng_crafting` layouts
  in `ui/InventoryScreen.ts`, models in `render/models.ts`, monitor screens
  in `render/SignText.ts`, textures in `tools/textures/v5.ts`.
- V6 phase 4: `src/server/engineering/end.ts` (the End machines, bridges,
  rails, lens and pedestals), `src/server/systems/EndTransport.ts` (nodes,
  gateways, minecarts, the Void Skiff), textures in
  `tools/textures/v6phase4.ts`.
