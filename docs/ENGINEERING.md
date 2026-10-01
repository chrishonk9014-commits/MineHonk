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
