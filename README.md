# MineHonk

A multiplayer voxel survival sandbox that runs in the browser. Every block
texture, model, sound and line of code is original. The world is infinite and
deterministic. The server is authoritative. There are four dimensions: the
Overworld, the Nether, the End and the Farlands (and, since Version 5.5,
somewhere you can only get to through a computer).

## Quick start

```bash
npm install
npm run dev            # game at http://localhost:5173 (single player works immediately)
```

Single player runs an integrated server in a Web Worker and saves worlds in
IndexedDB. Worlds can be exported to and imported from `.mhworld` files.

## Playing online

Play with friends right from the website, on a computer or a phone. Nothing to
install.

1. Open the game and choose **Multiplayer**. Create an account (a player name
   and a password; there is no email, so remember your password).
2. **Host** a world: pick one of your single player worlds or create a new
   one, choose who may join (**Private** with a code, **Friends**, or
   **Public**), and press **Start Hosting**. You get a join code like
   `ABC7-92KD` to share. Keep the tab open: your world is online while it runs.
3. Friends **join** with the code, or from their **Friends** tab (*Playing
   your world — JOIN*), or from the invitation you send them. Anyone can join
   **Public** worlds from the Public tab.

Already playing alone? Pause and choose **Open to Multiplayer**: the world goes
online without restarting. The pause menu's **Hosting...** shows the code and
the players, lets you make operators, kick, ban, invite friends, change the
settings (including **Allow Cheats**) and stop hosting.

The world, everyone's inventories and progress are saved in the host's
browser. Players who come back find everything where they left it. Single
player is unchanged and needs no account.

Running the site yourself? The online hub is set up once on websites, with no
terminal: [docs/ONLINE_SETUP.md](docs/ONLINE_SETUP.md). How it works, privacy
and limits: [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md).

### Self-hosting (advanced)

A dedicated Node server can host worlds on a machine you control (it does not
need the online hub). In the game, choose **Multiplayer → Server address...**
to connect to it.

```bash
npm run build          # client (dist/) + dedicated server (dist-server/)
npm start              # PORT=8080 by default, data in ./data
```

Open `http://your-host:8080`, choose **Multiplayer**, create an account, then
create a world or join one with a code such as `ABC7-92KD`. For development,
run `npm run server` next to `npm run dev`. Vite proxies `/api` and `/play` to
it.

| Variable       | Default | Meaning                                                    |
| -------------- | ------- | ---------------------------------------------------------- |
| `PORT`         | `8080`  | HTTP and WebSocket port                                    |
| `HOST`         | all     | Interface to bind                                          |
| `DATA_DIR`     | `data`  | Accounts, friends, world registry and world files          |
| `STATIC_DIR`   | `dist`  | Built client to serve                                      |
| `MAX_PLAYERS`  | `16`    | Players per world                                          |
| `TRUST_PROXY`  | off     | `1` behind a reverse proxy (client IP from X-Forwarded-For) |
| `CORS_ORIGINS` | none    | Comma-separated sites that may call the API                |

Put it behind HTTPS (for example, a reverse proxy) for anything other than a
LAN. Operators can add words to the chat filter in
`DATA_DIR/moderation/blocklist.txt`, one per line. Hosted deployments should
also connect their platform's moderation service through
`ServerOptions.filterChat` and forward player reports through
`GameServer.onReport`.

## Playing

- **Move** WASD, **jump** Space, **sneak** Shift, **sprint** Ctrl or double-tap W
- **Mine or attack** left mouse, **use or place** right mouse, **pick block** middle mouse
- **Inventory** E, **drop** Q, **swap hands** F, **chat** T, **commands** /
- **Player list** Tab, **achievements** L, **debug info** F3, **camera** F5, **hide HUD** F1, **screenshot** F2
- **Admin Panel** F8 (worlds with cheats on, owner and operators only)
- **Auto Optimize**: when the game lags badly for a few seconds (under 20
  frames a second, or stuttering), it lowers one setting at a time, least
  noticeable first, and says what it changed. Options > Video Settings can
  undo it all or switch it off.
- Gamepads are supported. Every key can be rebound under Options → Controls.

### Game modes

Survival, Hardcore (one life, then spectate), Creative, Adventure (blocks can
only be broken with the right tool), Spectator, and **God Mode**. God Mode is
survival with a maximum health you choose when creating the world: 1, 2, 3, 4,
5, 10, 20, 50, 99, a custom value, or infinite (anything over 99 counts as
infinite). With infinite health, damage cannot kill you, but knockback,
effects, hunger and hazards still apply unless you turn them off. Players with
infinite health who fall into the void are returned to their spawn point.

### Progression

Wood → Stone → Iron → Diamond → the Nether (obsidian portal; fortresses,
bastions, blaze rods) → Eyes of Ender lead to a stronghold → the End and the
Ender Dragon → the dragon drops a **Corrupted Eye** → awaken the frame in a
rare **glitched ruin** in the Overworld → the **Farlands**. The Farlands have
overflow walls, glitch ores and data spires. Farlands corruption glitches
unprotected players; brew a Potion of Stability to resist it.

### The World Update (V4)

Worlds created in V4 generate with generator version 4. **Worlds created
before V4 keep generating exactly as they did** (hash tests guard every
dimension), and they keep their fluid rules too.

- **Every biome has its own plants and materials**: desert marigolds and
  flowering cacti (tall columns, branching saguaros, clusters), aloe and
  scrub in badlands and savannas, clover and buttercups on plains, leaf
  litter and shadowcaps in forests, bracket fungus on overgrown fallen logs,
  lingonberries and snowberries in taigas, frostblooms on snowy plains,
  edelweiss on meadows, orchids and hanging moss in jungles, cattails,
  glowcaps and peat in swamps, seashells and beach grass, cherry petals,
  termite mounds on savannas.
- **Villages are planned settlements**: a town centre plaza (well or
  fountain, bell, benches, market stalls), main roads and side streets that
  follow the ground, plots zoned by distance (smithy, storehouse, workshop
  and chapel near the plaza; cottages, houses and two-storey manors; fields,
  pens and watchtowers at the edge), in eight biome styles including jungle
  and swamp villages on stilts.
- **New structures**: desert oasis, sun monument, buried tomb, ranger tower,
  hunter camp, frozen ruins, jungle shrine, swamp shack, stone circle,
  lighthouse, mountain lookout, prospector camp and the bunker. Temples,
  huts, igloos and outposts are a little more common; structures never
  overlap.
- **Objectives**: set a sun monument's levers to match their glyphs; light a
  jungle shrine's four braziers; in a bunker, find the keycard, open the
  security doors, bring both generators online and reach the vault. The
  quest tracker shows the current objective.
- **The Error Biome**: about one chunk in 5,000 in the Overworld or the
  Nether (never the End or the Farlands), exactly one chunk, never two side
  by side: an unloaded chunk of black and purple ERROR blocks. Dig down to
  the **Glitched Structure**: five stacked arenas of glitched mobs, each
  stage harder, each shut off by a Firewall until the one above is cleared.
  Clearing all five rewards everyone who fought with one Glitched tool and
  one Glitched armor piece (the same gear the Farlands smithing makes). It
  never gives the Corrupted Eye or opens the Farlands.
- **Fences, panes, walls and gates connect properly**, also in generated
  structures and across chunk borders.
- **Fluids**: no more endlessly pulsing water edges; flow carries on across
  unloaded chunk borders and through saves; water reaching lava makes
  obsidian from a source and cobblestone from flowing lava, lava pouring
  into water makes stone. Caves never hold water on top of lava: it cools to
  magma, and cave lava is lined with magma and basalt. Water surfaces slope
  at their edges and show their flow.
- **Admin Panel**: a World Update tab finds and teleports to V4 places,
  drives the Glitched Structure's stages, gives Glitched reward rolls,
  resets bunkers and builds a fluid test rig. As always, nothing done there
  counts towards advancements.

### Version 4.5 - Temples & Bunkers

Worlds created in Version 4.5 generate with generator version 5. **Worlds
created before it, V4 worlds included, keep generating exactly as they did**
(hash tests guard them), including their V4 bunkers and jungle temples.

- **Temples of trials**: the jungle temple is rebuilt, and there are new
  temples for snowy lands (Frost Temple), swamps (Swamp Temple), badlands and
  savannas (Canyon Temple), forests and taigas (Grove Temple) and mountains
  (Mountain Temple), plus the **Desert Pyramid** (the old desert temple
  stays as it was). Each has three trials, one per chamber, in order:
  awaken the altars, bring the Temple Relic to its altar, light the braziers
  (flint and steel waits in the chest by the door), set the levers to match
  the glyphs, or defeat waves of the temple's guardians. Each trial breaks
  the seal into the next chamber; the third opens the way to the arena on
  the roof (the pyramid's summit).
- **The Champion's Trial**: whoever stands in the arena when it begins takes
  part. Alone, you fight the temple's champion. With others it is a **duel**:
  PvP is on between the contestants (whatever the world's PvP setting), a
  contestant who would die is knocked out instead (sent back down with a
  little health, keeping their items), and so is anyone who leaves the
  arena. The last one standing takes the temple's prize: enchanted diamond
  gear, totems and treasure, different for each temple.
- **Bunkers**: the keycard is no longer inside. It waits in a chest at a
  guard post on the surface near the hatch, and the quest tracker says
  roughly where. The whole bunker sits in a **bedrock shell**, and the entry
  hall and vault are walled in bedrock, so there is no digging in or around
  the doors. Every bunker has a **random layout**: a maze of rooms
  (barracks, storage, armory, lab, mess hall, comms) on a 4 x 4 grid, two or
  three generators, a keycard gate and a blast door. Bunkers now appear in
  almost every land biome and dress for it: desert, badlands, snow, taiga,
  jungle, swamp, mountain and temperate styles, from the guard post and the
  camouflage up top to the floors, spawners and mobs inside.
- **Admin Panel**: the World Update tab finds every temple, completes or
  resets the current temple's trials and gives Temple Relics. As always,
  none of it counts towards advancements, and a prize won after a cheated
  trial is cheat-marked.

### Version 5 - The Engineering Update

Power, machines, automation and factories. Engineering works in every world,
old and new (it adds blocks; it does not change world generation). Design
notes: [docs/ENGINEERING.md](docs/ENGINEERING.md). Buildable computers came
in Version 5.5.

- **The Engineering Crafting Table and Book**: every engineering item is made
  at the Engineering Crafting Table (iron, copper and a crafting table, at a
  normal table); none of them at the normal crafting table. The
  **Engineering Book** (a book and a copper ingot) holds step-by-step guides
  for each topic and an entry for every block and part: its recipe, numbers,
  what it is made from and used in. Click an ingredient to open its entry;
  use the book on an engineering block to open that block's entry. With the
  table open, the book sits beside it and its **Craft** buttons fill the grid
  from your inventory.
- **Power** in EU and EU/t: water wheels, solar panels, wind turbines, steam
  generators (fuel and water), advanced generators and the Large Generator
  (lava); batteries, battery banks and advanced energy cells (they keep their
  charge when broken); copper wire, insulated cable and power conduits
  carrying 64, 512 and 4,096 EU/t. A network shares out power by need, never
  makes energy out of nothing, and carries only as much as its weakest
  cable.
- **Machines** share one window: input, output, fuel, tool and upgrade
  slots, energy and fluid bars, progress, state (working, no power, no
  input, output full, disabled...), information about their network, and
  settings. Crusher (two dusts per ore), electric furnace, grinder,
  compressor, cutter, recycler and assembler. Speed, efficiency, capacity
  and range upgrades. Machines push their results out of their back into an
  inventory or onto a conveyor (a switch in the window turns it off).
- **Items**: conveyors and express conveyors (items, mobs and players ride
  them), hoppers, chutes, item pipes with extractors, filters and sorters;
  crates, industrial chests, item vaults and storage barrels (4,096 of one
  item). Chests, barrels and furnaces join item networks too.
- **Fluids** on the existing water and lava: pumps lift source blocks (water
  pools refill, lava does not), pipes, tanks you can see the level of,
  valves, fluid filters and outlets.
- **Signals replace redstone**: signal cable (no loss along its length),
  timers, logic gates (AND, OR, XOR, NAND, NOR, NOT), level sensors, item
  sensors and warning lights. Levers, buttons, plates, lamps, doors and
  sculk all work with them; every machine can ignore signals, run while
  powered or run while unpowered. Redstone dust and torches already in a
  world keep working, but are no longer crafted or placed.
- **Automation**: mining drills and quarries (with a pickaxe that wears
  down), ore scanners, crop planters and harvesters, irrigation sprinklers,
  item collectors and animal feeders.
- **Multiblocks**: the Industrial Furnace (eight lanes), Advanced Crusher,
  Large Generator and Quarry, built from machine casing; the controller says
  which block is missing and where.
- **Control rooms**: monitors show their network (power, batteries,
  machines, storage, fluids, alerts) on their screen; control panels switch
  any machine on the network on or off.
- **Factory blocks**: machine casing, steel, industrial glass, metal grates,
  hazard stripes, factory lights and industrial doors.
- **Eleven engineering advancements**, credited to whoever placed the
  machine. **Admin Panel**: an Engineering tab with kits, filling and
  draining energy, resetting machines, inspecting the nearest machine and
  its network, a test production line and a 250-machine stress test. As
  always, nothing done there counts towards advancements, and what cheated
  machines make is cheat-marked.
- **Title screen**: "V5 - The Engineering Update" under the logo, and the
  backdrop is one of five engineering set scenes built on real terrain: a
  factory, a power plant, a quarry mine, an automated farm or a control room.
- Everything is server authoritative and saved in block entities with its
  chunk: energy, items, fluids and progress survive saves and unloads
  without duplicating or disappearing. Only loaded chunks run.

### Version 5.5 - The Digital Corruption Update

Computers, drives and data, built on the Engineering systems, and a second
secret story that runs through them. Design notes (with spoilers):
[docs/DIGITAL.md](docs/DIGITAL.md).

- **Computers** are engineering machines: a case on an energy network with
  twelve slots (power supply, motherboard, CPU, four RAM, two hard drives,
  graphics card, network card, USB). With the core parts in and power it
  starts up (POST), then runs **HonkOS** from a hard drive, or only its BIOS
  without one. **Peripherals** count within a block of the case: monitors
  (they show what it runs), a keyboard (needed to use it), a mouse (graphics
  programs), speakers (sounds) and LEDs (status lights). Computers send a
  signal out and read the signals coming in. Parts are made from circuit
  boards, electronic components and connectors at the Engineering Crafting
  Table.
- **Programs** (one window, a Screen tab and a Hardware tab): File Manager,
  Factory, Power, Storage, Machine and Fluid Managers, Machine
  Configuration, Automation (if this, then that rules), Engineering Control,
  Network Manager, Blueprint Manager, Map Viewer, Digital Logs, System
  Scanner, Diagnostics and Disk Utility (installs HonkOS). Not an operating
  system to learn: tools for the factory the computer is cabled to.
- **Drives and data**: hard drives (8 MB) keep files with the world; flash
  drives (1 MB) carry configurations, automation rules, blueprints, maps
  and logs between computers: plug in, read, write, take out. Network cable
  joins computers with network cards and **server racks** (four drives of
  network storage). Data is copied, never things: building a blueprint
  costs the blocks it places, taken from your inventory.
- **A second secret**: the Mysterious Potion opens two doors. The first is
  the V3 one, unchanged. The second starts somewhere else entirely, ends in
  a new secret ending, and is only ever hinted at, by a **Witch's Grimoire**
  of ink drawings found beside the potion in every witch's hut.
- **Seventeen digital advancements** (most of them secret). **Admin Panel**:
  a Digital Corruption tab to give the story's items, spawn and test the
  dragon, and step through (or reset) every part of the story. As always,
  nothing done there counts.
- **Title screen**: "V5.5 - The Digital Corruption Update", over a computer
  lab, a foggy lake, a cave full of machines or a sick dragon.
- Server authoritative, multiplayer-safe, and old worlds load unchanged
  (saves gained a `digital` store and the story's state; nothing else moved).

### Version 6 - The End Expansion

V6 comes in five phases. **Phase 1** adds the Expansion Portal and the
**Expanded End**, a deeper, farther part of the End, more than 6,000 blocks out.
It is still the End: going there never changes dimension. **Phase 2** fills it
with five new mobs and its own stone, ores, crystal, chorus wood and Ender
Alloy. **Phase 3** builds it up: new End Cities, the remains of an older
civilization, five giant structures, their Guardian Constructs, and the
Dragon's Nest under the main island. **Phase 4** brings it to life: End
machines on the Engineering Update's networks, new ways across the void, five
quests in the ancient structures and Elytra upgrades. **Phase 5** finishes it:
Void Storms and the End Eclipse, new moves for the Ender Dragon, the Void
Citadel and the End Guardian at its bottom. Design notes:
[docs/END_EXPANSION.md](docs/END_EXPANSION.md).

In the game, **Options > Update Log** walks through all of V6 and the new
browser multiplayer, with screenshots, item icons, recipes and step-by-step
examples (`src/client/ui/updateLogV6.ts`; its pictures are made by the scripts
in `tools/update-log/`).

- **The Expansion Portal** stands on the main End island, apart from the exit
  portal: an upright frame of its own.
  - It is dark until the Ender Dragon has been defeated, then it comes alive.
  - The dragon's defeat counts whether it was a normal kill, a cheat-spawned
    dragon's kill or the Voidbound secret ending.
  - Worlds where the dragon is already dead get it alive the first time the
    End loads.
  - Its frame can't be broken outside creative.
- **Travel there and back**: the portal takes you to an arrival platform in
  the Expanded End, always on safe ground. A return portal there takes you back
  to the main island beside the Expansion Portal. Every player can use it once
  it is open.
- **The way there**: in worlds created in V6, the outer islands stop at about
  4,600 blocks, and nothing but void lies between them and the Expanded End.
  Older worlds keep their End exactly as it generated (hash tests guard it),
  and get the Expanded End too.
- **Seven biomes** in large regions with void gaps between them. Each has its
  own land, ground, plants, sky tint, fog, light, drifting particles and
  ambient sound:
  - **End Barrens**: wide, flat islands of cracked end stone, strewn with
    boulders.
  - **Shattered End**: tall, narrow islands of dark voidstone, broken into
    sheer stepped cliffs and needle-like spires.
  - **Astral End**: strings of small islands hanging at many heights, their
    stone glowing with a cold light.
  - **End Highlands**: thick, high continents of end stone, hollowed out by
    wide caves with vines hanging from their roofs.
  - **End Crystal Fields**: rolling islands of sparkling stone where
    formations of glowing crystal grow from the ground.
  - **Chorus Forest**: large islands overgrown with chorus plants, under the
    branches of giant chorus trees.
  - **Void Wastes**: low, scattered islands of dark end stone, half lost in a
    dark haze.

  The F3 screen names the biome you are in. (Phase 2 renamed the phase 1
  biomes; worlds created in phase 1 keep their phase 1 ground and plants.)
- **Five new mobs** (phase 2), each with its own model, animations, sounds and
  spawn egg. Every attack is telegraphed for at least 24 ticks (32 with other
  players near), no hit ever throws you into the void, and none of them walks
  off an island:
  - **Endling**: a small, shy lavender creature with big dark eyes. It blinks
    away when hit, scatters when a Void Stalker comes near, and breeds on
    chorus fruit.
  - **Void Stalker**: a tall, dark hunter that crouches before it lunges. Hurt
    badly, or stared at, it runs off the island edge into the void and climbs
    back a few seconds later behind you.
  - **Chorus Beast**: a neutral giant of the Chorus Forest. Anger it (or break
    chorus near it) and it slams the ground and throws chorus along an arc
    you can see coming.
  - **End Crystal Mite**: tiny crystal-backed swarmers that come out of mined
    crystal clusters.
  - **End Phantom**: a very rare flyer of the outer band that screeches,
    flares its wings and dives, at Elytra gliders too.
- **Resources** (phase 2): four end stone variants (cracked, dark,
  crystalline, glowing astral) with polished, brick, stair, slab and wall
  forms; End Crystal Clusters, Crystal Lamps and Crystal Glass; Void Crystal
  Ore and Void Glass; giant chorus trees with a full chorus wood set, Chorus
  Cloth and Chorus Rope; Ender Ore deep in the Highlands, smelted into Ender
  Scrap for **Ender Alloy** (upgrade netherite gear at a smithing table; it
  comes back out of the void if dropped); Ancient End Fragments and bricks;
  Astral Ore (an Ender Alloy pickaxe only), Astral Lanterns and Astral Glass;
  the **Void Pack**, a 9-slot bag that keeps its contents when you die in the
  void; Endling meat; and the End Phantom Membrane, which repairs Elytra.
  Every recipe is in the Recipe Book.
- **Eight End City variants** (phase 3), each assembled from pieces with
  random rotations, sizes and branches, and dressed in its biome's stone and
  glass:
  - **Outposts**: watchtowers with bridge stubs, the most common.
  - **Settlements**: houses round a plaza among chorus gardens, home to
    Endlings.
  - **Ruins**: weathered, collapsed and floating pieces of the others.
  - **Libraries**: floors of bookshelf halls and a sealed archive.
  - **Observatories**: spires with a dome and a dormant telescope.
  - **Shipyards**: docks, ships and a crane, sometimes with Elytra (about one
    in seven).
  - **Metropolises**: towers linked by sky bridges round a plaza and vault.
  - **Palaces**: a throne hall behind a sealed crystal vault door, the rarest.
- **The ancient civilization**, told only in fragments:
  - Ender Glyph Stone in a script nobody can read.
  - Broken portals, dormant machines and sealed doors that tell you what they
    lack.
  - 38 lore fragments (torn pages, logs, rubbings, star charts) that raise
    more questions than they answer.
  - Six End Artifacts and Ancient Maps whose needles point to "a place".
  - Three ancient weapons: the armor-piercing Ancient Blade, the Voidpiercer,
    whose bolts fly straight for 32 blocks, and the Shardstaff.
- **Five giant structures**, about one per 200 x 200 chunks, each announced
  with a title and a music sting:
  - the End Colossus, a broken statue floating in pieces;
  - the Crystal Cathedral;
  - the Void Observatory over open void;
  - the End Fortress;
  - the Fallen City.
- **Guardian Constructs** guard them, built rather than born: the patrolling
  Sentinel (a glowing punch, a crystal bolt along a marked line) and the
  Bulwark (a ground pound telegraphed by glowing cracks, and a shield). They
  never leave their posts and never come back once destroyed.
- **The Dragon's Nest**: once the Ender Dragon has died, a crack opens beside
  the Expansion Portal into a vast hollow under the main island. It is full of
  empty nest hollows, older stone and its own broken portal. Worlds where the
  dragon is already dead get it too.
- **End engineering** (phase 4), on the same EU networks, cables, machine
  window and Engineering Crafting Table as V5, made from the End's own
  resources:
  - the **Crystal Generator** (128 EU/t from End Crystal Fragments), the
    **Void Collector** (24 EU/t, only over open void) and the **Restored
    Ancient Core** (512 EU/t for ever; restored from a dormant core in a
    giant structure, never crafted);
  - the **Void Cell** (2,000,000 EU), the **End Processor** (more out of the
    End's ores, crystal, old stone and chorus) and the **Crystal Grower**
    (crystal grows back);
  - an **End Engineering** chapter in the Engineering Book.
- **Getting about** (phase 4):
  - **Ender Bridges**: a projector lays a walkable bridge of light up to 64
    blocks over the void, which flickers and fades when its power goes.
  - **Teleportation Nodes**: name them, lock them, and travel between nodes
    you built (1,000 EU + 10 EU a block), never across dimensions.
  - **Ancient Gateways**: every broken portal has a pair far round the band;
    mend both and they link for good.
  - **Rails and minecarts**, and **Ender Rails** that run twice as fast and
    can lie on a bridge of light.
  - The **Void Skiff**, a slow flying boat for two that burns Void Shards;
    its recipe is learned from a blueprint found in the Shipyards' ships.
- **Five quests** (phase 4), shown step by step in the quest tracker:
  **The Lost Observatory** (mend and power an ancient telescope), **The
  Broken Gateway**, **The Silent City** (an Ancient Key and the Silent Bell,
  which stills Constructs), **The Crystal Vault** (four crystals, a Crystal
  Generator and a waking Bulwark) and **The Dragon's History** (a hidden
  Sanctum). Loot once per world, advancements for everyone who takes part.
- **Elytra upgrades** (phase 4): three module slots at the smithing table:
  Reinforced, Thrust, Hover, Burst, Void Recovery and Ender Blink. An Elytra
  without them flies exactly as before.
- **Void Storms** (phase 5): every 2–4 in-game days a storm sweeps the
  Expanded End for 3–5 minutes, a minute after its warning banner.
  - Violet fog, void motes and its own sound.
  - Void Debris falls onto rings marked ahead of it (6 damage); it never
    breaks a block.
  - Low-gravity pockets, marked first, where you jump higher and fall slower.
  - Stalkers and Chorus Beasts grow bolder; crystals grow brighter and
    Crystal Generators and Void Collectors make more.
  - **Storm Remnants**: small floating ruins with a chest. They fade with a
    warning when the storm ends, and set anyone on them down safely.
- **The End Eclipse** (phase 5): about one night in sixty, with no warning.
  - The sky goes near black round a dark disc ringed with light; stars show
    through the fog and block light grows brighter and paler.
  - **Eclipse Shards** grow on the islands and dissolve at dawn.
  - **Eclipse Monoliths** rise with a cache and lore found nowhere else.
  - Pale, outlined Void Stalkers and more End Phantoms, with better loot.
  - A beam of light rises from the Void Citadel, seen from anywhere in the
    Expanded End.
- **The Ender Dragon's new moves** (phase 5), added to the fight, which
  otherwise stays exactly as it was (200 health, crystals, perching, the exit
  portal, every ending and secret). Each is named on a banner and shown at
  least 24 ticks before it lands (32 with others near):
  - the **Void Breath Wave** along a path drawn on the ground;
  - the **Wing Gust** as it perches, which pushes but never off the island;
  - the **Roar**, which turns the Endermen (no damage);
  - the **Pillar Weave** through the pillars, on its way to perch;
  - the **Strafing Dive** along its shadow line;
  - **Crystal Fury**: a charge line from a crystal 10 s after one breaks;
  - the **Edge Strike**: a marked crater on the island's edge that crumbles
    and is put back after the fight;
  - the **Dragon Storm** sky below a quarter of its health.

  A tuning simulation keeps the damage it deals per minute no higher than
  before and the number of perches no lower (95 against 86).
- **The Void Citadel** (phase 5): one per world, deep in the Void Wastes, a
  six-floor tower hanging into the void.
  - Find it with three **Citadel Star Chart Pieces** (in the giant
    structures' vaults and the Sanctum), which make the **Void Citadel Map**;
    or with the Lost Observatory's telescope, or the beam, during an eclipse.
  - Each floor has a **Citadel Anchor** (a respawn point), a library and a
    vault, and a sealed door that opens for everyone when its objective is
    done: a **Combat** hall with rifts, a **Glyph Lock**, a **Crystal
    Sequence** to repeat, **Parkour** round the outside over open void, and
    an **Engineering** puzzle wired with your own cables and logic gates.
  - Each floor's music and sound bed is its own.
- **The End Guardian** (phase 5), at the Citadel's bottom: 1,000 health (more
  for each extra player), three phases, every attack named and shown first:
  - **Awakening**: the Crystal Lance, Ground Fracture and Construct Call;
  - **Void Shift**: Void Orbs, a Gravity Well and the Crystal Shield's
    pylons;
  - **Core Exposed**: faster, with the Collapse of the outer ring and the
    Final Lance (jump or duck).

  It kneels with its core bare after every fourth attack. The arena's lower
  floor catches every fall. It resets if abandoned, and re-forms after seven
  days, woken with four Eclipse Shards. Its loot:
  - the **Guardian Core** (an Elytra's fourth upgrade slot);
  - the **Guardian's Lance**, a long-reach weapon that fires a short beam;
  - the **Eclipse Veil**, an Elytra module that hides you from every mob for
    five seconds;
  - its head.

  Its fall is a victory title, not an ending.
- **Title screen**: four V6 scenes: the Expanded End, the Crystal Fields, the
  Void Citadel and the End Eclipse. The edition reads "V6 - The End
  Expansion".
- **Fifty-four advancements** in the End tab:
  - reaching the Expanded End and visiting all seven biomes;
  - ten for its mobs and resources (phase 2);
  - thirteen for its structures, lore, giants, the Nest and the Bulwark
    (phase 3);
  - fifteen for its machines, travel, quests and Elytra upgrades (phase 4);
  - fourteen for storms, the eclipse, the Citadel's floors, the Guardian and
    the fourth Elytra slot (phase 5).
- **Admin Panel**: an End Expansion tab to:
  - switch, build and reach the portal;
  - teleport to the arrival platform or any biome, and show where you are;
  - end the dragon fight for testing;
  - spawn the new mobs and Constructs, remove them, switch their spawning and
    count them per biome;
  - give any resource, artifact, weapon, map or lore book, or whole kits;
  - locate and teleport to the nearest of every structure;
  - build any structure where you stand;
  - build the Dragon's Nest and reset a structure's loot;
  - start, complete, reset or reach any End quest, fill a machine's EU,
    force-repair a gateway pair, open the Sanctum and build an End test
    line;
  - start or stop a Void Storm or an End Eclipse;
  - teleport to the Citadel, any floor or the arena, solve a floor or reset
    them all;
  - spawn the End Guardian, skip a phase, force its defeat or reset it;
  - respawn the Ender Dragon and try each of its new moves;
  - give the rare End loot (Guardian Core, Lance, Eclipse Veil, shards, Star
    Chart Pieces, the head).

  The Teleport tab's End lists hold them too: every Expanded End biome and
  structure (marked "(Expanded End)"), the Dragon's Nest and the Void
  Citadel, to find or teleport to from anywhere.

  As always, nothing done there counts towards advancements.
- **Old worlds**: phase 3 structures appear only in worlds created from now
  on, in newly explored chunks. Older worlds load unchanged, and still get the
  Nest. Phase 3 worlds get every phase 4 quest in their structures. Phase
  1–4 worlds get the Citadel where nothing has generated yet, and storms and
  eclipses. Worlds older than V6 have no Expanded End, so no events and no
  Citadel.

### Recipe Book

The book button in the top corner of the inventory and of every workstation
screen (crafting table, furnaces, brewing stand, smithing table,
stonecutter, anvil, enchanting table) opens the Recipe Book in every game
mode. It is built from the recipe registries, so it
always lists every recipe the game knows: crafting (shaped and shapeless),
smelting, blasting, smoking, campfire cooking, brewing, smithing and
stonecutting, plus how enchanting and the anvil work. Search by name or
ingredient, filter by category (Building, Tools, Weapons, Armor, Food,
Utilities, Redstone, Brewing, Other) or show only what you can make now.
Selecting a recipe shows its grid or inputs, quantities, the station it needs
and which ingredients are missing. It updates as your inventory changes.

### Admin Panel and cheats

Turn on **Allow Cheats** when you create a world, or toggle it later from the
pause menu (world owner only). The Admin Panel (F8 or the pause menu) is
available to the world owner in single player and to the owner and operators
in multiplayer. Builders and visitors never get it. Every action is checked
and carried out by the server (in a hosted world, the host's).

In multiplayer the owner decides: **Allow Cheats** is a hosting setting that
can be changed at any time, operators are made from the hosting panel (or with
`/op`), and every admin action is announced in chat (*[Admin] Name used: give
diamond ×64*) unless the owner turns announcements off. Worlds with cheats on
show a **Cheats ON** badge in the Friends and Public lists and when joining.

- **Items**: give any registered item. Search, filter by category and choose
  a quantity (more than a stack is split across slots or dropped).
- **Mobs**: spawn any mob, with search, categories and a quantity.
- **Teleport**: choose a dimension and a structure or biome. The server finds
  the nearest one without freezing the game and shows its name, distance and
  dimension. Press TELEPORT to land on a safe spot there, never inside
  walls, lava or the void. You can also teleport to players or bring them to you.
- **Player**: game mode, heal, health, hunger, XP level, flight, clear inventory.
- **World**: time, weather, difficulty, PvP, remove mobs, regenerate or reload
  chunks.
- **Performance**: client FPS, frame time, chunks and meshes, server TPS,
  tick time, entities and memory.

A **CHEATS ENABLED** badge is shown while cheats are on. Admin actions never
award or progress advancements, directly or through what follows from them.
Items the panel gives are marked as cheat items, and so is everything made
from them, including crafting, smelting, brewing, trading and drops. Mobs it
spawns are marked, and so are their drops and XP. Teleport arrival areas and
cheat-set time or weather also count as cheats. Normal play in the same world
still earns advancements as usual.

## Development

```bash
npm run typecheck      # TypeScript
npm test               # unit and integration tests (vitest)
npm run test:e2e       # browser smoke test against the production build
npm run test:e2e:mp    # two-browser multiplayer test against the Node server
npm run test:e2e:online  # browser-hosted multiplayer, up to five browsers, against a local cloud hub
npm run gen:assets     # regenerate textures, atlases and the pixel font
```

End-to-end tests use the production build (`npx vite build`). The multiplayer
test also needs `npm run build:server`. More browser checks:

```bash
npm run test:e2e:v1       # Recipe Book, Admin Panel, cheat-free advancements
npm run test:e2e:render   # culling never changes a pixel
npm run test:e2e:v4       # the World Update: Error Biome, Glitched Structure, admin tab
npm run test:e2e:v6       # the End Expansion: the portal, travel, every biome, the mobs, ores and armor, every structure, the Constructs and the Dragon's Nest (screenshots)
```

### Performance tools

```bash
npx vite build --minify false --outDir dist-bench
node tests/perf/bench.mjs dist-bench        # FPS, frame time, draws, memory per scenario
node tools/perf/compare.mjs a.json b.json   # before/after table
npx tsx tools/perf/server-bench.ts          # server tick cost with many mobs
node tools/perf/shader-cost.mjs             # frame time by render layer and option
node tools/perf/churn.mjs                   # server updates and re-meshing in a still scene
```

The benchmark uses headless Chromium with software WebGL, so absolute FPS is
far below a real GPU. Compare runs made on the same machine.

On slow machines, lower the render distance (Options → Video presets) and
set **Leaves: Fast**. Leaves are the most expensive thing to draw in forests.

### Architecture

```
src/common    shared, deterministic code: registries (blocks, items, biomes, mobs,
              recipes, loot, potions), world generation for all four dimensions,
              physics, protocol and validation
src/server    authoritative GameServer: dimensions and chunk streaming, lighting,
              mining and building, containers, survival, mobs and AI, combat,
              explosions, portals, the End and dragon fight, the Farlands,
              workstations, commands, moderation and roles
src/worker    integrated server (Web Worker + IndexedDB): single player, and
              hosting from the browser (hosting.ts)
src/hub       shared hub logic (accounts, friends, world registry, tickets) behind
              a storage interface, used by both hubs
hub           the cloud hub: Cloudflare Worker, D1 migrations, lobby and relay
              Durable Objects (deployed by .github/workflows/deploy-hub.yml)
src/server-node  dedicated hub (self-hosting): file storage, HTTP API and the
              WebSocket game transport
src/client    three.js renderer, meshing worker, UI, audio synthesis, input
tools         procedural asset generation (textures, font) and debug maps
tests         unit, integration and end-to-end tests
```

Chunks are meshed in worker threads into a compact vertex format, with each
section's faces grouped by the direction they face. Sections are packed into
render regions (4x4 chunks by 8 sections) drawn with one multi-draw call per
buffer page. Each frame the renderer skips sections outside the view,
sections hidden behind solid terrain (a cave visibility graph) and face
groups pointing away from the camera, drawing solid terrain near to far.
`tests/e2e/render-equivalence.mjs` checks that culling never changes a
pixel. Greedy meshing is implemented but off: merged faces leave hairline
cracks at a distance.

The client only sends intentions (move, dig, use, click, chat). The server
validates everything: reach, line of sight, break timing, inventory
ownership, crafting, damage, XP, drops and rewards. It corrects the client
when they disagree.

### Security notes

- Passwords are hashed with scrypt on the Node server. Online, the browser
  stretches them first (PBKDF2, 600,000 rounds) and the hub stores a salted
  hash of that. Session tokens are random, sent as bearer headers and stored
  only as hashes. Repeated failed logins lock the account for a few minutes.
- Joining a browser-hosted world takes a short-lived join ticket signed by the
  hub; the host checks it before connecting and again before letting the
  player in. Strangers from the public list connect only through a relay, so
  no one sees anyone else's IP address.
- The in-game name always comes from the account and never from the client.
  Join codes are only visible to owners and operators.
- Sign-in, join codes and the API are rate limited. Game sockets have packet
  flood and payload size limits.
- The server sets CSP and other security headers, and blocks path traversal
  when serving files.
- Cheat and debug commands require operator status and a world with cheats
  enabled. The developer handle (`window.minehonk`) only exists in
  development builds and automated test browsers.
