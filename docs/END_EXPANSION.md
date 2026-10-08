# Version 6 - The End Expansion

Design notes for V6's five phases:

- **Phase 1, the portal and the world:** the Expansion Portal and the
  Expanded End's land and atmosphere.
- **Phase 2, mobs and resources:** the seven biomes' final names, five new
  mobs, and the Expanded End's stone, ores, crystal, chorus wood, Ender Alloy,
  ancient and astral resources (see [Phase 2](#phase-2-mobs-and-resources)).
- **Phase 3, structures:** the eight End City 2.0 variants, the ancient
  civilization's remains, the five giant structures, the Guardian Constructs
  and the Dragon's Nest (see [Phase 3](#phase-3-structures-the-ancient-civilization-and-the-dragons-nest)).

- **Phase 4, engineering, transport, quests and Elytra upgrades:** End
  machines on V5 engineering, bridges, nodes, ancient gateways, rails and the
  Void Skiff, five quests in the ancient structures, and Elytra modules (see
  [Phase 4](#phase-4-engineering-transport-quests-and-elytra-upgrades)).

- **Phase 5, events, the Dragon, the Void Citadel and the End Guardian:**
  Void Storms and the End Eclipse over the Expanded End, eight new moves for
  the Ender Dragon, a six-floor tower hanging into the void, and the boss at
  its bottom (see [Phase 5](#phase-5-events-the-dragon-the-void-citadel-and-the-end-guardian)).
  V6 is complete: version 6.0.0.

## Where it is

The Expanded End is part of the End dimension (`'end'`). It is not a dimension
of its own, and travel there never changes dimension. The constants are in
`src/common/endExpansion/region.ts`.

| Constant | Value | Meaning |
| --- | --- | --- |
| `EXPANSION_INNER` | 6,000 | Inner edge of the ring (blocks from 0, 0), in every world |
| `EXPANSION_OUTER` | 10,000 | Outer edge of the ring |
| `EXPANSION_MARGIN` | 400 | Open void just inside each edge before any land |
| `APPROACH_FADE_START` / `APPROACH_FADE_END` | 4,000 / 4,600 | V6 worlds: the outer islands thin out and stop here |
| `REGION_CELL` / `REGION_WARP` | 640 / 150 | Size of the biome regions and how far their borders wander |
| `EXPANSION_PORTAL_SITE` | (0, 72) | The Expansion Portal on the main island |
| `ARRIVAL_NOMINAL` | (0, 7,200) | Where the search for the arrival island starts |

In a V6 world the End is laid out like this:

- the main island;
- void out to 1,000 blocks;
- the outer islands, which thin out from 4,000 and stop at 4,600;
- about 1,800 blocks of open void;
- the Expanded End, with land from about 6,400 to 9,600;
- void beyond that.

You can't sensibly glide the 1,800 blocks of void, so the portal is the way in.

## The version gate

Generator 6 is V6 phase 1, generator 7 is phase 2, and generator 8
(`LATEST_GENERATOR` and `GENERATOR_VERSION`) is phase 3.

- **The approach gap depends on the version.** Only worlds created with generator 6 or later get the void gap. Older worlds keep their outer islands, generated exactly as before, everywhere outside the ring.
- **The ring itself exists in every world.** Inside the ring the Expanded End replaces whatever would have generated there, so old worlds get the portal and somewhere for it to lead. The only chunks of an old world that can change are unmodified chunks inside the ring, which nobody could reasonably have explored. Modified chunks are saved and stay as they were.
- **Regression tests guard it.** `tests/unit/v6-regression.test.ts` hashes these chunks against hashes recorded before V6 (V5.5):
  - for generators 1, 3, 5, 6 and 7: the main island, a spread of outer island chunks out to about 3,800 blocks, and an End city;
  - for older worlds: outer-island chunks between 4,500 and 5,700 blocks.

  It also checks that generators 6 and 7 change nothing in the Overworld, the Nether or the Farlands.
- **Phase 2 is gated too.** Generator 7 gives each biome its own stone, ores and plants. A world made by generator 6 (phase 1) keeps generating its Expanded End exactly as before: `tests/unit/v6-resources.test.ts` checks its chunks against hashes recorded in phase 1, and that generator 7 keeps every land shape (only surfaces, ores and plants differ). Saved chunks are never edited, so phase 1 worlds get no new ores; the new mobs do live there.
- **Phase 3 is gated too.** Only generator 8 worlds get the Expanded End's structures, and only in chunks generated from now on (see [Phase 3](#phase-3-structures-the-ancient-civilization-and-the-dragons-nest)). Generators 6 and 7 keep generating their Expanded End byte for byte as before.
- **Generator code:** `src/common/gen/end.ts` calls `src/common/gen/endExpansion.ts` only for columns inside the ring. Classic chunks run the same code as before, apart from one boolean check.

## The Expansion Portal

The portal logic is in `src/server/systems/EndExpansion.ts`, and its shape is in `src/common/endExpansion/portal.ts`.

- **Shape:** an upright frame 5 wide and 6 tall, made of Expansion Portal Frame blocks. It stands on an end stone brick plinth around (0, 72) on the main island, 72 blocks from the exit portal and well away from the pillars and the gateway ring. Its 3 x 4 opening holds the Expansion Portal sheet.
- **Its own blocks and textures:**
  - **Frame:** dark slate with inlaid channels that are empty while the portal is dormant and glow pale cyan once it is alive.
  - **Sheet:** ribbons of pale blue light rising through indigo, distinct from the exit portal's and gateways' starfield and from nether portals.
  - The painters are in `tools/textures/v6.ts`.
- **Building:** the portal is built once, the first time the main island is loaded, and recorded in `level.flags.expansionPortal` with its position and state.
  - Before the Ender Dragon's defeat it is **dormant**: dark frame, empty opening.
  - In worlds where the dragon is already dead, old saves included, it is built **alive** straight away.
  - Old saves need no migration: a missing record means "not built yet".
- **Opening:** the portal opens when `flags.dragonKilledOnce` becomes true. Every way of defeating the dragon sets that flag:
  - **The normal kill:** `DragonFight.finish()`.
  - **A cheat-spawned dragon's kill:** also `finish()`. The portal is access to the world, so it opens; advancements follow the existing cheat rules (the kill awards nothing).
  - **The Voidbound (Farlands) secret completion:** `Endgame.finishSecretNow()` calls `DragonFight.completeSecret()`, which sets `dragonKilledOnce`, so it opens the portal too.
  - The opening happens once. The Admin Panel can close the portal again afterwards.
- **Travel:**
  - **Entering:** standing in the sheet for 3 seconds (instantly in creative and spectator) takes the player to the arrival platform in the Expanded End.
  - **Returning:** the return portal on the platform takes them back to the main island, three blocks in front of the Expansion Portal.
  - **Same dimension:** the player stays in dimension `'end'` throughout.
  - **Chunk loading:** this works like the End gateways. The server teleports the player, the client holds still until its chunks arrive, and the server then checks the spot.
- **Safe arrival:** the arrival site is built by the generator in every world. Its position is deterministic from the seed: the first spot near `ARRIVAL_NOMINAL` that is well inside a biome region.
  - The site is a solid disc of land 14 blocks in radius, a 9 x 9 end stone brick platform, and the return portal, which is always open.
  - On every arrival the server checks the spot. If the floor is missing it puts one back, and it clears solid blocks or fluids at the feet and head. Nobody lands in the void or inside rock.
- **Server authority:** the server decides everything about the portal (whether it is open, the teleport, the arrival). Portal use while it is closed is refused, even if a portal block is standing in the opening.
- **Multiplayer:** once open, the portal works for every player.
- **Breaking:** the frame can't be broken outside creative or the Admin Panel. It has hardness -1 and resistance 3,600,000 like an End Portal Frame, so explosions and the dragon can't break it either.
  - It does not rebuild itself.
  - If a creative player knocks a piece out, the sheet collapses like a nether portal's, and the Admin Panel's **Build the portal** puts it back.

## The seven biomes

Biome selection works like this:

- **Regions:** the ring is divided into regions, which are cells of a jittered 640-block grid seen through a slow warp. The selection is low-frequency noise, so regions are hundreds of blocks across.
- **Biomes:** each cell takes one of the seven biomes by hash. Neighbouring cells of the same biome join up.
- **Gaps:** between different biomes the land tapers into a void gap about 40 to 60 blocks wide. You can bridge it, but crossing without Elytra is hard.
- **Determinism:** generation depends only on the seed.

Each biome entry in `src/common/endExpansion/biomes.ts` carries:

- its name and description;
- its terrain style;
- its surface palette (top, under and core blocks), landscape features and ores (generator 7), and the phase 1 palette and features (`phase1`, for generator 6 worlds);
- its sky tint, fog colour, fog density and ambient light;
- its ambient particles;
- its sound bed (`bed.<id>` in `src/client/audio/synth.ts`).

Phase 2 gave the biomes their final names. Each kept its slot (and so its
biome number, which is what chunks save), its land shape and, in generator 6
worlds, its phase 1 surface; a player's saved list of visited biomes is
mapped to the new ids on load (`PHASE1_BIOME_IDS`).

| Biome (id; phase 1 name) | Description | Land | Palette, generator 7 (top / under / core) | Features, generator 7 | Ores | Sky | Fog | Density | Light | Particles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| End Barrens (`end_barrens`; Pale Plains) | Wide, flat islands of cracked end stone, strewn with boulders. | Large, low, flat islands | cracked end stone / cracked end stone / end stone | cracked boulders, bare patches, a little pale grass | none | `#3b3552` | `#6e6888` | 0.12 | 0.62 | pale motes, floating |
| Shattered End (`shattered_end`; Shattered Spires) | Tall, narrow islands of dark voidstone, broken into sheer stepped cliffs and needle-like spires. | Small, very tall islands, terraced, with ridged crests | voidstone / voidstone / voidstone | voidstone spires, debris | Ancient End Fragment | `#24123a` | `#3a1f52` | 0.30 | 0.42 | violet motes, rising, glowing |
| Astral End (`astral_end`; Floating Archipelago) | Strings of small islands hanging at many heights, their stone glowing with a cold light. | Small islands, plus two layers of floating chains broken into beads | astral end stone / end stone / end stone | luminous moss patches | Astral Ore | `#101a40` | `#1e2a66` | 0.18 | 0.48 | blue-white motes, rising, glowing |
| End Highlands (`highlands`; Hollow Isles) | Thick, high continents of end stone, hollowed out by wide caves with vines hanging from their roofs. | Large, deep islands, a band of caves through them and sinkholes where the caves are widest | end stone / end stone / voidstone | void vines, voidstone boulders, chorus plants | Ender Ore | `#0c1430` | `#18244a` | 0.35 | 0.34 | blue motes, falling, glowing |
| End Crystal Fields (`end_crystal_fields`; Crystal Fields) | Rolling islands of sparkling stone where formations of glowing crystal grow from the ground. | Medium islands, rolling hills | crystalline end stone / crystalline end stone / end stone | crystal spires tipped with End Crystal Clusters, clusters, prism clusters | none (End Crystal Clusters) | `#3a2440` | `#6a4a72` | 0.15 | 0.52 | white sparkles, floating, glowing |
| Chorus Forest (`chorus_forest`; Dune Isles) | Large islands overgrown with chorus plants, under the branches of giant chorus trees. | Very large islands, rolling relief | end stone / end stone / end stone | giant chorus trees, chorus plants | none | `#2c1838` | `#5a3a6a` | 0.32 | 0.56 | lilac motes, floating |
| Void Wastes (`void_wastes`; Mist Hollows) | Low, scattered islands of dark end stone, half lost in a dark haze. | Small, low islands | dark end stone / dark end stone / end stone | void crystals | Void Crystal Ore | `#0c0a14` | `#1c1628` | 0.60 | 0.36 | violet motes, falling, glowing |

The End Highlands keep the id `highlands`: the classic End already has an
`end_highlands` biome (the outer islands), with the same display name.

**Phase 1 surfaces** (generator 6 worlds, unchanged): Pale End Stone (End
Barrens), voidstone (Shattered End), Luminous Moss (Astral End), end stone
over voidstone (End Highlands), end stone with prism crystals (End Crystal
Fields), End Sand with dune reeds (Chorus Forest) and pale end stone with mist
blooms (Void Wastes).

**Phase 1 blocks**, each with its own texture painted in `tools/textures/v6.ts`:

- Pale End Stone, Voidstone, Luminous Moss (light 6), End Sand and Prism Crystal (light 9);
- Pale Grass, Dune Reed, Mist Bloom, Prism Cluster and Void Vines.

**Atmosphere** (`src/client/game/EndAtmosphere.ts`):

- **Blending:** the client samples a 5 x 5 grid of biomes 12 blocks apart around the player and blends their sky tint, fog colour, fog density and ambient light, weighting nearer samples more, then eases towards the result. Crossing a border or leaving the classic End shifts the air over a few seconds.
- **Sky and fog:** the End branch of `Sky.update` and the fog distances in `WorldRenderer` read the blended values.
- **Sound and particles:** the strongest biome around the player picks the ambient sound bed (a looping synth recipe that `AudioEngine.setBed` cross-fades) and the ambient particles.
- **F3:** the debug screen shows `Expanded End: <biome name>`.

**Performance** at render distance 8:

- **Generation:** an Expanded End chunk costs about as much as an outer-islands chunk, about 4 ms against 3.5 ms in the unit benchmark. Biome lookups use a 3 x 3 site search per column, and ambient beds are rendered once, not in four variants.
- **Rendering:** `tests/perf/bench.mjs` has End scenarios (`end`, `end-outer` and `end-<biome>`) for comparing the classic End with each biome. Here is one headless run from phase 1 (software WebGL, so compare rows rather than absolute fps; biomes under their phase 2 names):

  | Scene | fps | JS ms per frame | Draw calls | Triangles |
  | --- | --- | --- | --- | --- |
  | End: the main island (`end`) | 7.6 | 7.3 | 246 | 75k |
  | End: outer islands (`end-outer`) | 15.8 | 3.0 | 81 | 24k |
  | End Barrens | 13.6 | 1.7 | 20 | 36k |
  | Shattered End | 10.1 | 2.1 | 27 | 40k |
  | Astral End | 11.1 | 2.5 | 30 | 36k |
  | End Highlands | 7.3 | 2.1 | 26 | 74k |
  | End Crystal Fields | 9.1 | 2.3 | 33 | 42k |
  | Chorus Forest | 8.6 | 1.8 | 19 | 16k |
  | Void Wastes | 10.5 | 2.3 | 26 | 34k |

  Main-thread time and draw calls, which carry over to real hardware, are below the classic End's in every biome. Software frame rates mostly follow how much of the screen is land rather than void.

## Advancements (phase 1)

Both are in the End tab, awarded by the server, and cheat-gated like everything else:

- **The Expanded End:** "Reach the Expanded End". Reaching it by portal or by gliding both count.
- **Every Corner of the End:** "Visit all seven biomes of the Expanded End".

Visits are recorded per player in their save (`endBiomes`). The following never count:

- arriving by Admin Panel teleport, until the player walks out of the arrival area;
- the arrival area of a trip through a portal opened by the Admin Panel before the dragon's defeat;
- creative mode or cheat flight.

## Admin Panel (End Expansion tab, phase 1)

These are the `V6_OPS` in `src/common/game/admin.ts`, checked by `validateAdmin`, run by the `AdminService` execute switch (`src/server/admin/expansionAdmin.ts`) and shown in the `AdminPanel.ts` tab.

| Op | What it does |
| --- | --- |
| `status` | Portal state, dragon, arrival platform, the player's position and biome, biomes visited |
| `activate` / `deactivate` | Opens or closes the Expansion Portal (applied as soon as the main island is loaded). Opened before the dragon's defeat, travel through it is a cheat visit |
| `build_portal` | Builds (or rebuilds) the portal on the main island, now or once the island loads |
| `tp_portal` | Teleports to the main island, in front of the portal |
| `tp_arrival` | Teleports to the arrival platform |
| `tp_biome` | Teleports to the nearest land of the chosen biome (searching from the player if they are in the Expanded End, otherwise from the arrival platform) |
| `where` | Shows the biome and coordinates at the player |
| `defeat_dragon` | Ends the dragon fight at once, for testing the portal. The dragon is marked cheat-made first, so the kill awards nothing and its drops and experience are cheat-made |

Every op is a cheat. None of them awards an advancement.

## Tests (phase 1)

- **`tests/unit/v6-regression.test.ts`:** the classic End is byte-identical (generators 1 to 8), older worlds keep their outer islands, V6 worlds have the approach gap, and generators 6 to 8 leave the other dimensions alone.
- **`tests/unit/v6-expansion.test.ts`** covers:
  - the ring and the gap;
  - all seven biomes reachable inside the ring with their palettes;
  - large regions with void gaps between them;
  - determinism;
  - the arrival site;
  - portal gating: dormant, opened by `finish()`, built only once, alive in an old save that already has `dragonKilledOnce`;
  - the round trip staying in the End, and repaired arrivals;
  - multiplayer use and the server refusing use while closed;
  - every Admin Panel op, with zero advancements;
  - both advancements.
- **`tests/e2e/v6.mjs`:** the browser check. It creates a cheats world and screenshots:
  - the dormant portal;
  - the dragon forced from the panel and the portal alive;
  - a walk through the portal;
  - one view of each biome, by admin teleport, with the F3 line checked.

  The screenshots go to `tests/e2e/out/v6-*.png`.

## Phase 2: mobs and resources

The rules phase 2 keeps:

- **The classic End is unchanged.** Nothing new spawns or generates on the main island or the outer islands: the new spawn lists belong to the Expanded End's biomes, and the regression hashes still pass. The one change the classic End sees is that one chorus plant in ten also drops a Chorus Fiber.
- **No duplicate systems.** The mobs are entries in the mob registry (`src/common/data/mobs.ts`) with brains built from the shared goal system, their drops are loot tables, the blocks and items are registry entries, Ender Alloy is a row in the tier and armor tables of `src/common/data/items.ts`, the recipes are in the shared recipe lists (so the Recipe Book shows them), the upgrade uses the smithing table, and the advancements are in the End tab. Mob skins are painted by the client's model kit like every other mob's; block and item textures (spawn eggs included) are painted in `tools/textures/` and packed by `npm run gen:assets`.
- **The server decides.** AI, spawning, telegraphs and the hits after them, drops, ore generation and mining results all happen on the server.
- **Saves stay compatible.** Generator 7 gates every new surface, ore and plant (see the version gate above). Items save by id and blocks are appended to the registry, so no saved number moves.
- **The Admin Panel is advancement-neutral**, and there is no new ending or lore: the one line of flavour is the Ancient End Fragment's tooltip.

### The mobs

Code: `src/common/endExpansion/mobs.ts` (spawn lists and caps), `src/server/ai/endGoals.ts` (goals), `src/server/systems/EndMobs.ts` (spawning rules, telegraphs, hits, the void slip, scattering, temper, swarm, dive), models in `src/client/render/entities/mobs.ts`, voices and sounds in `src/client/audio/synth.ts`.

| Mob (id) | Kind | Health | Damage | Armor | Size (w x h) | Speed | Spawns (weight, group) | Cap per player | Drops | XP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Endling (`endling`) | passive | 8 | - | 0 | 0.5 x 0.6 | 0.10 | End Highlands, Chorus Forest (10, 2-4) | 10 | Raw Endling 1-2 (Looting +1; cooked if burning) | 1-3 |
| Void Stalker (`void_stalker`) | hostile, any light | 30 | 7 | 4 | 0.7 x 2.2 | 0.16 | End Barrens (8), Shattered End (10), Void Wastes (12); 1-2 | 6 | Void Shard 0-2 (Looting +1), Void Stalker Hide 0-1 | 8 |
| Chorus Beast (`chorus_beast`) | neutral; knockback resistance 0.8 | 80 | 12 | 8 | 2.4 x 3.0 | 0.07 | Chorus Forest (3, 1) | 2 | Chorus Fiber 3-6, Chorus Fruit 2-4 | 15 |
| End Crystal Mite (`end_crystal_mite`) | hostile, tiny, swarms | 6 | 2 | 0 | 0.4 x 0.3 | 0.14 | End Crystal Fields within 5 blocks of a crystal formation (4, 2-4); 2-4 from a mined cluster (25%) | 8 | End Crystal Fragment 0-1 (Looting +1) | 3 |
| End Phantom (`end_phantom`) | hostile flyer, very rare | 40 | 9 | 0 | 2.0 x 0.8 | 0.22 | Astral End, Void Wastes, only 8,000+ blocks out (2, 1) | 1 | End Phantom Membrane 1 (Looting +1), Astral Dust 0-1 | 20 |

Every Expanded End biome also keeps spawning vanilla Endermen (weight 10, 1-3).

**Spawning** goes through the mob system's natural spawning, with the
Expanded End's own limits on top:

- A kind stops spawning once that many of it are within 128 blocks of the player it would spawn for (the cap above), and a group never overshoots it. Three players standing together share one area, so they can't stack spawns.
- End Phantoms only spawn 8,000 blocks or more from the centre, and around any one player at most once every 6,000 ticks (5 minutes).
- Ground mobs need firm ground: a solid block below and no void edge right beside the spot. Light doesn't matter.
- The Admin Panel can switch natural spawning of these five off and on (`level.flags.expansionMobSpawning`).

**Telegraphs.** Every attack shows itself for at least 24 ticks before it
lands, or 32 when more than one player is within 32 blocks of the mob
(`src/common/endExpansion/combat.ts`). The server times wind-ups in ticks and
resolves each hit at the moment of impact, against where everyone is then.

| Mob | Attack | Telegraph | What happens |
| --- | --- | --- | --- |
| Void Stalker | Lunge | Crouches for 24 (32) ticks with its eyes flaring and a rising growl | Leaps at the target (only if the whole leap is over ground) and hits once on contact, with standard knockback |
| Chorus Beast | Ground slam | Rears up, arms high, for 28 (32) ticks; a ring of radius 4 shows on the ground | 12 damage to every player within 4 blocks, thrown away from the beast, or along the island if that way is the void |
| Chorus Beast | Chorus throw | Winds up for 24 (32) ticks with the chorus glowing in its fist; the arc it will follow shows as beads and a dashed line, with a ring where it lands | The chorus follows exactly that arc (6-18 blocks); a hit does 6 damage and shifts the target 2-4 blocks onto safe ground, like chorus fruit |
| End Crystal Mite | Bite | Rears up and shivers for 24 (32) ticks, with a glassy rattle | 2 damage if the target is still in reach |
| End Phantom | Dive | Hangs still and screeches, wings flaring white, for 30 (32) ticks; the dive's line shows | Dives along that line, hits once on contact, and climbs away |

**No hit throws a player towards the void.** Knockback is checked four blocks
along its direction: if that leads over the void, the hit comes without
knockback (the slam instead picks the nearest direction along the island).

**Void edges are walls.** The pathfinder never stands a mob over the void,
and all five never step there either: a step (or a hop) that would leave
nothing at all under a mob's feet is taken back. Only a hit can throw one
off, and a Void Stalker going over on purpose.

**Behaviour:**

- **Endling:** wanders in small groups and follows players holding chorus fruit; chorus fruit breeds them. When hit it blinks 3-8 blocks away like a small Enderman. When a Void Stalker comes within 16 blocks, every Endling nearby chirps and blinks 8-14 blocks away from it.
- **Void Stalker:** hunts at any light level. **Void slip:** the first time it drops below half health, or when a player has looked straight at it for 3 seconds (then not again for 15 seconds after it returns), it runs to the nearest island edge within 20 blocks and drops into the void. It is gone (hidden, untouchable) for 4-8 seconds, then 2-4 blocks behind the nearest player, on safe ground, rising void particles, a ring and a low rising sound show for 24 (32) ticks before it climbs out there, facing them. With nobody within 64 blocks or no safe spot for 10 seconds, it is gone for good. It does the same if it falls into the void some other way.
- **Chorus Beast:** neutral until a player hits it or breaks a chorus plant, chorus flower or chorus stalk within 8 blocks of it. Then it goes after them, and calms down after 30 seconds without a target within 28 blocks.
- **End Crystal Mite:** hitting one turns every mite within 12 blocks on the attacker. Mining an End Crystal Cluster has a 25% chance to let out 2-4 mites, which go for the miner. Mites with nothing to fight near a mined-out cluster burrow back into the nearest cluster within 16 blocks.
- **End Phantom:** circles high (16 blocks above its target, or around where it appeared) and hunts players gliding with Elytra too. Hit while diving, it is stunned for 2 seconds (it drifts down, wings folded).

**Models:** each mob has its own blocky model, painted skin and animations
(idle, walk, its wind-up, its attack; hurt and death as for every mob), a
spawn egg, and a voice (idle, hurt and death) plus wind-up and attack sounds.

### The resources

Code: `src/common/endExpansion/resources.ts` (blocks, items, kits), `src/common/endExpansion/recipes.ts`, the tier tables in `src/common/data/items.ts`, loot in `src/common/data/loot.ts`, textures in `tools/textures/v6.ts`.

**Stone.** Four end stone variants, each with a polished form and bricks, and
stairs, a slab and a wall for all three (any pickaxe, hardness 3,
resistance 9). Each is the surface of one biome in generator 7 worlds.

| Variant | Biome | Notes |
| --- | --- | --- |
| Cracked End Stone | End Barrens | |
| Dark End Stone | Void Wastes | Holds Void Crystal Ore |
| Crystalline End Stone | End Crystal Fields | Sparkles faintly (an animated texture) |
| Astral End Stone | Astral End | Glows (light 6), in all its forms |

**Ores and other blocks:**

| Block | Where | Tool | Drops | Notes |
| --- | --- | --- | --- | --- |
| End Crystal Cluster | On the crystal formations of the End Crystal Fields | any pickaxe | End Crystal Fragment 2-4 (Fortune); the cluster with Silk Touch | Light 10, glass sound; 25% chance of 2-4 mites |
| Void Crystal Ore | Void Wastes, in the dark end stone near the surface (about 1.2 veins per chunk, up to 4 blocks) | diamond pickaxe | Void Shard 1-3 (Fortune); the ore with Silk Touch | XP 3-7 |
| Ender Ore | Deep in the End Highlands' voidstone, 12-36 blocks under the surface (very rare: about 0.35 veins per chunk, at most 3 blocks) | netherite pickaxe (or Ender Alloy) | itself | Hardness 30, resistance 1,200 like Ancient Debris; every block closed in on all six sides, never open to the air or sky; smelts into Ender Scrap |
| Ancient End Fragment | Shattered End, buried 1-5 blocks deep in the voidstone and debris (about 0.45 per chunk) | diamond pickaxe | Ancient Fragment 1-2; the block with Silk Touch | Tooltip: "Worked stone. Older than the cities." |
| Astral Ore | Astral End only, 2-10 blocks under the top (extremely rare: about 0.12 per chunk) | Ender Alloy pickaxe only | Astral Dust 1-2 (Fortune); the ore with Silk Touch | Glows (light 9); XP 4-9 |
| Chorus wood | Giant chorus trees in the Chorus Forest | axe | itself | Chorus Stalk, Stripped Chorus Stalk, Chorus Planks, Stairs, Slab, Fence, Fence Gate, Door, Trapdoor, Button, Pressure Plate; joins the wood recipes and tags |
| Crystal Lamp, Crystal Glass | crafted | | | Lamp: light 15. Glass: translucent, light 3 |
| Void Glass | crafted | | | Translucent |
| Chorus Cloth, Chorus Rope | crafted | | | Cloth: a building block. Rope: climbable |
| Ancient End Bricks | crafted | any pickaxe | | With stairs, slab and wall |
| Astral Lantern, Astral Glass | crafted | | | Lantern: light 15. Glass: light 5 |

**Items:** End Crystal Fragment, Chorus Fiber, Ender Scrap, Ender Alloy
Ingot, Ancient Fragment, Astral Dust, Astral Shard, Void Stalker Hide, Void
Leather, End Phantom Membrane, Void Pack, Raw Endling (2 hunger) and Cooked
Endling (6 hunger, 0.6 saturation). Resources with uses still to come carry
a short tooltip saying so.

**Ender Alloy** (a row in `TIERS` and `ARMOR_MATERIALS`):

- **Tools:** level 4, speed 10, durability 2,500, enchantability 18, attack bonus 5 (sword 9, axe 11, pickaxe 7, shovel 7.5).
- **Armor:** durability multiplier 42, defense 3 / 8 / 6 / 3, toughness 4, knockback resistance 0.15.
- Both are fire resistant, epic rarity, and repaired with an Ender Alloy Ingot. Only Ender Alloy pickaxes mine Astral Ore (a block's `harvestMaterial`).
- Gear only comes from upgrading netherite gear at a smithing table with an Ender Alloy Ingot (enchantments, names and damage carry over).
- An Ender Alloy item (ingot or gear) dropped into the void comes back onto the nearest safe ground within 48 blocks (or where it last lay).
- No set bonuses.

**The Void Pack** holds 9 stacks (right-click to open; it won't hold another
pack or a shulker box, and can't be moved while open). Its contents live on
the item. On a death in the void, and only then, the pack and everything in
it stay in the player's inventory; any other death drops it like everything
else, still packed.

**End Phantom Membrane** repairs Elytra at the anvil, like a phantom's
(both carry the item tag `membranes`, which is now Elytra's repair material).

### Recipes

| Result | Recipe |
| --- | --- |
| Polished (variant) End Stone x4 | 2 x 2 of the stone (stonecutter: 1 for 1) |
| (Variant) End Stone Bricks x4 | 2 x 2 of the polished stone (stonecutter from either) |
| Stairs x4, Slab x6, Wall x6 | the usual shapes of each form (stonecutter: 1, 2, 1 from that form or the ones before it) |
| Crystal Lamp | 4 End Crystal Fragments around a glass |
| Crystal Glass x8 | 8 glass around an End Crystal Fragment |
| End Crystal (second recipe) | 7 End Crystal Fragments, an Eye of Ender and a Ghast Tear (the original stays) |
| Void Glass x8 | 8 glass around a Void Shard |
| Chorus Planks x4 | a chorus stalk; the rest of the wood set as for every wood |
| Chorus Cloth | 2 x 2 Chorus Fiber |
| Chorus Rope x2 | 3 Chorus Fiber in a column |
| Ender Scrap | smelt Ender Ore |
| Ender Alloy Ingot | 4 Ender Scrap, 4 Void Shards and an Ender Pearl (shapeless) |
| Ender Alloy gear | netherite gear + Ender Alloy Ingot at a smithing table |
| Ancient End Bricks x4 | 2 x 2 Ancient Fragments |
| Astral Shard | 9 Astral Dust |
| Astral Lantern | 8 iron nuggets around an Astral Shard |
| Astral Glass x8 | 8 glass around an Astral Dust |
| Void Leather | 2 x 2 Void Stalker Hide |
| Void Pack | a string over 3 Void Leather (bundle shape) |
| Cooked Endling | smelt Raw Endling |

### Advancements (phase 2)

All in the End tab, awarded by the server, never for cheat-made mobs or items or under a cheat:

| Advancement | For |
| --- | --- |
| A Small Friend | Feed an Endling |
| Back From the Edge | Survive a Void Stalker's void slip (it came back behind you), then defeat it |
| Gentle Giant | Calm or defeat an angered Chorus Beast |
| Out of the Light | Defeat an End Phantom |
| Crystal Clear | Mine an End Crystal Cluster |
| Deep in the Highlands | Obtain Ender Scrap |
| Forged in the End | Obtain an Ender Alloy Ingot |
| Stardust | Obtain Astral Dust |
| Clad in the End | Wear a full set of Ender Alloy armor |
| Hunter of the Expanded End | Defeat every kind of creature of the Expanded End (kept per player as `endKills`) |

### Admin Panel (phase 2)

The End Expansion tab gains:

| Op / section | What it does |
| --- | --- |
| Mobs: Spawn 1 / Spawn a group | The panel's usual spawn action for each of the five (cheat-made: defeating them never counts) |
| `kill_mobs` | Removes the Expanded End's mobs (from phase 3, Guardian Constructs too) within 96 blocks (no drops) |
| `mob_spawning_on` / `mob_spawning_off` | Switches their natural spawning |
| `give_set` | Gives a whole kit: each end stone variant's set, chorus wood, End Crystal, Void, Ancient, Astral, Ender Alloy, Ender Alloy tools, Ender Alloy armor, food and membranes; each item in a kit can also be given alone |
| Status | Also shows whether they spawn, and how many of each live in each biome (loaded chunks) |

### Tests (phase 2)

- **`tests/unit/v6-mobs.test.ts`:** on a real server: every telegraph lasts at least 24 ticks before its hit (32 with a second player near); the void slip always ends behind a player on safe ground after its telegraph, or with the stalker gone when nobody is left; staring sets it off; no mob walks into the void over 3,000 ticks of being driven at it; hits at an edge never throw a player off; Endlings scatter; a Chorus Beast angers at broken chorus and calms down; mites swarm out of mined clusters and burrow back; End Phantoms are stunned when hit mid-dive.
- **`tests/unit/v6-resources.test.ts`:** phase 1 hashes and land shapes; ores deterministic, only in their biomes and the band, Ender Ore never open to the air, tool tiers, Fortune and Silk Touch; every recipe, smelting, stonecutting, smithing (keeping enchantments) and the Recipe Book; the tier tables; Ender Alloy back from the void; the Void Pack on void and other deaths, and its window; natural spawning with three players (caps, biomes, rare phantoms, nothing on the main island); mobs and items through a save; a phase 1 save loading; every admin op awarding nothing; the advancements.
- **`tests/e2e/v6.mjs`** also screenshots each mob in its biome, the four ores in cut walls, a giant chorus tree, a Void Stalker's crouch and a Chorus Beast's throw arc as they wind up, and Ender Alloy armor worn by the player (on the inventory's player model, which now draws worn armor of every material, as other players' models do). `tests/e2e/v6-sites.ts` finds the ores and the tree in the test world.

## Phase 3: structures, the ancient civilization and the Dragon's Nest

The rules phase 3 keeps:

- **The classic End is unchanged.** Nothing new generates on the main island or the outer islands, and the existing End Cities and End Ships generate exactly as before; the regression hashes still pass for generator 8. The one change to the main island is the Dragon's Nest, carved by the server after the dragon's first defeat (below).
- **One structure system.** The variants and giants are `StructureType`s of the existing structure manager (`src/common/gen/structures/manager.ts`: region grid, starts, pieces, entities), built per chunk through a `DecorView` with the `Builder` (`builder.ts`). Their chests are the existing containers with loot tables in `src/common/data/loot.ts`, rolled on the server when first opened. Lore books are the existing `book` item. The Constructs are mob registry entries with goal-system brains. The advancements are in the End tab.
- **Generator 8.** A second structure manager (`EndGenerator.expansionStructures`) exists only in generator 8 worlds and only plans inside the ring. Generator 6 and 7 worlds have none, so they keep generating their Expanded End byte for byte as before (tested). Chunks are never edited after they are saved, so a structure only appears in chunks generated after the update.
- **Deterministic.** Placement and layout come from the world seed. During planning, layout decisions read only the unbuilt terrain (`ExpansionTerrain`), and build-time randomness comes from position hashes. So a structure builds the same whatever order its chunks generate in (tested).
- **Chunk by chunk.** Every structure, giants included, is planned once (a `Start` with its pieces) and each chunk builds only its own part as it generates. The server's own builds (the Nest and Admin Panel builds) carve one loaded chunk per tick and never touch a chunk that isn't loaded.
- **No lore dump and no new ending.** The ancient civilization is told in fragments (see the [lore pool](#lore-pool-review)). Things phase 4 will make work are inert now and say so.

Code:

- `src/common/endExpansion/structures.ts`: what the structures are (data shared with the docs, tests and Admin Panel).
- `src/common/endExpansion/ancient.ts`: ancient blocks, artifacts, weapons and the Ancient Map.
- `src/common/endExpansion/lore.ts`: the lore pool and its weights.
- `src/common/endExpansion/nest.ts`: the Nest's plan.
- `src/common/gen/structures/expanded/`: the generator.
  - `kit.ts`: palettes and building primitives.
  - `plan.ts`: the site and the plan.
  - `variants.ts`: the eight variants.
  - `giants.ts`: the five giants.
  - `index.ts`: the manager types.
- `src/server/systems/EndStructures.ts`: the Nest carving, discovery, glyphs, inert messages, lore and artifact tracking, maps, the Shardstaff and Admin Panel builds.
- `src/server/systems/Constructs.ts` and `src/server/ai/endGoals.ts`: the Constructs.

### End City 2.0: the eight variants

Each variant is planned from a pool of pieces (rooms, towers, bridges, platforms, stairs) with random rotations, lengths, heights and branch counts, so no two copies look alike. A test plans each variant at ten seeds and gets ten different piece lists.

Each builds from the classic End City blocks (purpur, end stone bricks, end rods) plus a palette picked by biome:

- **End Barrens:** cracked end stone.
- **Shattered End:** dark voidstone with purple glass.
- **Void Wastes:** dark voidstone with Void Glass.
- **Astral End:** Astral Glass and Astral Lanterns.
- **End Crystal Fields:** Crystalline End Stone, Crystal Glass and Crystal Lamps.
- **Chorus Forest:** chorus wood.
- **End Highlands:** the classic palette.

| Variant (id) | Biomes | Spacing / separation (chunks) | Pieces | Guards | Loot table: focus |
| --- | --- | --- | --- | --- | --- |
| End Outpost (`end_outpost`) | all but the Astral End | 24 / 8 | A watchtower (with a lookout room and ladder) on a platform, bridge stubs, 1-2 more platforms | 1-2 Sentinels | `chest/end_outpost`: Cooked Endling, arrows, Void Shards, End Crystal Fragments |
| End Settlement (`end_settlement`) | Chorus Forest, End Highlands | 40 / 12 | 4-8 small houses (each a pick of roof, size and rotation) round a central plaza, bridges, chorus gardens | none: Endlings live there | `chest/end_settlement`: chorus materials, building blocks, Ender Glyph Stone, books and lore |
| End Ruins (`end_ruins`) | Shattered End, End Barrens, Void Wastes | 28 / 8 | 3-6 broken fragments of other variants' pieces (towers, halls, platforms, portals), weathered, holed, collapsed, some floating loose nearby | Void Stalkers spawn there anyway | `chest/end_ruins`: Ancient Fragments, Ender writings, damaged gear, artifacts |
| End Library (`end_library`) | End Highlands, Chorus Forest | 56 / 16 | 2-4 floors of bookshelf halls and reading rooms joined by stairs, a sealed archive (an Ancient Vault Door) | 2 Sentinels | `chest/end_library`: books and lore, enchanted books, Ancient Maps |
| End Observatory (`end_observatory`) | End Highlands, Astral End | 64 / 20 | A spire with a spiral stair and balconies up to a dome, with a dormant telescope (Ancient Lens, Core and Conduits) | 1 Bulwark | `chest/end_observatory`: Astral Dust, Ancient Maps, star charts |
| End Shipyard (`end_shipyard`) | Void Wastes, Shattered End | 64 / 20 | Floating docks, a finished hull and a half-built one (classic End Ship style, varied), sometimes a third, and a crane frame | 2-3 Sentinels | `chest/end_shipyard`: Phantom Membrane, Ender Scrap, Void Shards; Elytra in about 15% of Shipyards (`chest/end_shipyard_elytra`) |
| End Metropolis (`end_metropolis`) | End Highlands | 96 / 32 | 4-7 towers of 4-8 floors round a central plaza with a crystal monument, paths, sky bridges, a vault under the plaza | 4-6 Constructs of both kinds | `chest/end_metropolis`, `chest/end_metropolis_vault`: Ender Scrap, enchanted Ender Alloy (rare), Astral Shards |
| End Palace (`end_palace`) | End Crystal Fields, Astral End | 128 / 40 | One grand building with a throne hall, courtyards, Crystal Glass windows, towers and a sealed Crystal Vault Door | 3 Bulwarks | `chest/end_palace`: crystal goods, Astral Shards, Crystal Pillars and Astral Mosaic |

Placement:

- The manager lists its types largest first: the giants, then Palace, Metropolis, Shipyard, Observatory, Library, Settlement, Ruins and Outpost. It drops any start whose bounds come within 16 blocks of a start of an earlier type, so no two structures overlap (tested over every start in three worlds).
- A start needs its biome and enough ground. The Metropolis may move up to 112 blocks from its region's start chunk to find room in the End Highlands, since without that it would be rarer than the Palace.
- Every piece stands on land or joins (within 8 blocks) a piece that does: nothing floats out of reach (tested).
- The Expanded End's big features (giant chorus trees, crystal formations and so on) are not placed where a structure stands.
- In a typical world (sampled over six seeds) there are:
  - Outposts: 230-270
  - Ruins: 55-80
  - Settlements: about 20
  - Libraries: 10-16
  - Shipyards: 8-15
  - Observatories: 2-7
  - Metropolises: 0-3
  - Palaces: 0-2

### The ancient civilization

The civilization is never a structure of its own: its remains are in the Ruins, Libraries, Observatories, the giants and the Nest.

| Thing | In game |
| --- | --- |
| Ender Glyph Stone (`ender_glyph_stone`) | A wall block with six glyph faces (a made-up script; prop `glyph`). Right-click shows the glyphs on a tablet and nothing else (`glyphs` message); the first time earns "Lost in Translation". |
| Ancient End Bricks, cracked and chiseled | The civilization's stone. Cracked and chiseled variants are new in phase 3. |
| Broken portals | Frames of Ancient End Bricks, cracked and with pieces missing, holding Dead Portal blocks (`dead_portal`: dim, still, unbreakable, not passable). Using one: "Something is missing." |
| Strange machines | Ancient Conduit, Ancient Core (dormant), Ancient Lens. Using one: "It has no power." |
| Sealed doors | Ancient Vault Door (Library archive, Fortress keep, Colossus), Crystal Vault Door (Palace), Ancient Ward Stone. All unbreakable. Using one: "It is sealed. Something is missing." (the ward stone: "It is sealed."). |
| Ancient Map (`ancient_map`) | A compass-style item: the needle points at one specific giant structure. When a chest first rolls a map (`ancient_map` loot function), the server ties it to the giant nearest that chest (`tag.data = {map: 'marked', target, dim: 'end'}`). Its tooltip names nothing: "Marked: a place." A map found where no giant can be reached (an old world, or a giant-less seed area) stays unmarked and its needle spins. |
| End Artifacts | Six collectibles, each with one line of flavour, found in ancient sites. Holding all six earns "Keeper of Relics". |
| Ancient weapons | Three, found only in ancient sites (Colossus cache, Fortress armories, Fallen City, rarely the Nest), all repaired with Ancient Fragments at an anvil. |
| Lore books | The `book` item with `tag.lore` naming a fragment. It is named by kind (Torn Page, Log Entry, Stone Rubbing, Loose Note, Star Chart, Partial Translation); right-click opens it. |

The artifacts:

| Artifact | Flavour |
| --- | --- |
| Glyph Tablet | The marks are cut deeper on one side. |
| Cracked Ender Eye | It still turns, very slowly, towards nothing. |
| Old Crystal Lens | Ground by hand. Something bright was seen through it. |
| Ancient Coin | Both faces are worn smooth. |
| Ancient Key Shard | One piece of something that once opened. |
| Dragon Scale Fragment | Too small to be from the dragon you know. (The Nest only.) |

The weapons, balanced against Ender Alloy (sword 9):

| Weapon | Base | Special |
| --- | --- | --- |
| Ancient Blade (`ancient_blade`) | Sword, 8 damage, durability 1,800 | Ignores 2 points of the target's armor (`armorPierce`, for mobs and players alike) |
| Voidpiercer (`voidpiercer`) | Crossbow-like bow (draw and release), durability 900 | Its bolts fly dead straight (no gravity, no drag) for their first 32 blocks, then fall as usual |
| Shardstaff (`shardstaff`) | Durability 600 | Right-click fires a slow crystal shard (speed 0.8, life 22 ticks: about 17 blocks; 9 damage). 24-tick cooldown, shown on the item |

### The giant structures

At most one giant per giant region of 200 x 200 chunks (`GIANT_SPACING`, separation 60). All five share one region grid. Each region looks for a spot (up to 128 blocks from its start chunk, at least 70 blocks inside its biome region) in a biome that has a giant, picks a giant by the biome's weights and plans it there. A typical world has 6 to 11 of them in the whole ring, so an explorer who knows the rough biome finds one in a few hours.

| Giant (id) | Biomes (weight) | What it is | Inside | Loot |
| --- | --- | --- | --- | --- |
| End Colossus (`end_colossus`) | Void Wastes (3), Shattered End (2) | A giant broken statue floating in pieces: head, torso, an arm and a hand, with void between them. Who it shows is never said. | Climbable outside (ledges and chorus ropes), a hollow chamber in the head with glyph inscriptions and the weapon cache | `chest/end_colossus`, `chest/end_colossus_cache` (always one ancient weapon) |
| Crystal Cathedral (`crystal_cathedral`) | End Crystal Fields | Crystal Glass, End Crystal Clusters and Crystalline End Stone under huge crystal spires | A nave, transept and apse, side chapels with End Crystal Mite nests, a dormant crystal organ machine | `chest/crystal_cathedral`: a big End Crystal Fragment haul |
| Void Observatory (`void_observatory`) | Astral End (3), Void Wastes (1) | A ring of telescope towers round a central dome hanging over open void, joined by bridges | Star charts, a dormant giant lens, Astral Shards, Ancient Maps | `chest/void_observatory` |
| End Fortress (`end_fortress`) | End Highlands, End Barrens | Walls, corner towers, gatehouses and a keep | Sentinel patrols on the walls and in the yard, Bulwarks at the keep, armories, barracks, a sealed inner keep | `chest/end_fortress`, `chest/end_fortress_armory` (Ender Alloy pieces, ancient weapons) |
| The Fallen City (`fallen_city`) | Shattered End | Dozens of collapsed End City towers over a debris field: leaning, half sunk, fallen over, broken bridges | The densest lore: glyph walls, broken portals, books, artifacts, Ancient End Fragments; Void Stalkers live there | `chest/fallen_city` |

Discovery is checked once a second. The first time a player walks into a giant:

- they get its title on screen (for example "THE FALLEN CITY"), once per giant per player;
- the discovery music sting plays (`music.discovery` in `synth.ts`);
- they earn that giant's advancement (cheat-gated).

Each player who finds it gets these, in multiplayer too. Entering any variant counts towards "Cities Beyond the Cities" and "Grand Tour of the End".

### Guardian Constructs

Built, not born: bodies of Ancient End Bricks with glowing crystal joints and a crystal heart, and procedural mechanical voices (servo whine, grinding, clanks). Neither spawns naturally. Each is a gen entity of its structure, placed when the structure's chunk generates, with its post (`home`), route and leash stored on the mob.

| Construct | id | Health | Damage | Armor | Size | Behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| Guardian Construct: Sentinel | `guardian_sentinel` | 40 | 8 | 10 | 0.9 x 2.4 | Patrols a route between its structure's points. Charged punch: its arm glows for 24 ticks (a warning circle on the ground) before the hit. Crystal bolt: a beam marks the line for 30 ticks, then the bolt flies along it (6 damage, 20 blocks). |
| Guardian Construct: Bulwark | `guardian_bulwark` | 120 | 14 | 14, knockback resistance 1 | 1.6 x 2.8 | Stands dormant guarding a room or vault and wakes when a player enters the room, comes within 6 blocks or hits it. Back at its post after 10 seconds with nobody about, it goes dormant again. Ground pound: a ring of glowing cracks for 32 ticks, then a 5-block blast that pushes players away from void edges, never towards them. Shield: for 24 ticks a visible shield halves the damage it takes. |

The "Warden-type" construct of the plan is the Bulwark in game, since a Warden mob already exists.

Rules for both:

- **Telegraphs.** Every attack telegraphs for at least its time above, and at least 32 ticks with a second player near (the phase 2 rule).
- **Leash.** They never stray more than 24 blocks from home. Past it they drop their target and walk back.
- **No respawns.** A killed Construct stays dead: structure entities are placed once, with the chunk, and saved with it.
- **Drops.** `mob/guardian_sentinel`: Ancient Fragments 1-2, End Crystal Fragments 1-3, Ender Scrap 5%. `mob/guardian_bulwark`: 2-4, 2-5, 15%.
- **Advancement.** Killing a Bulwark earns "Unmade". A cheat-made Construct awards nothing.

### The Dragon's Nest

**When it appears.**

- `DragonFight.finish()` sets `dragonKilledOnce`, which opens the Expansion Portal. From then on the server carves the Nest (`EndStructuresSystem.tickNest`).
- In a world where the dragon died before this update, the server carves it the first time the End's main island is loaded.
- The server carves one loaded chunk per tick, nearest the entrance first. It records its progress in `level.flags.dragonNest` (`{done: [chunks], built}`), so the work resumes after a restart.
- Once `built` is set, the Nest is never carved again. Player changes inside it stay.
- End terrain generation never changes: the Nest is cut into the island afterwards, as the portal is built.

**Where it is.** The plan (`nestPlan(seed, terrain)`) is deterministic from the seed and the island's shape:

- **The chamber:** a wide, low hollow about 44 x 36 blocks under the island's middle, centred at (0, 6). It has a flat floor and a low dome whose height follows the island: at least 5 blocks above the underside and 8 below the surface.
- **Kept clear:** 7 blocks round the exit portal's column, 7 round the Expansion Portal, and 5 round each obsidian pillar. Nothing is carved outside the island's own stone.
- **The entrance:** a crack opening in the ground just in front of the Expansion Portal. It is open to the sky, 2-4 blocks wide, with stair steps where it drops. It runs down to the chamber floor and is hard to miss. It is the only place the Nest reaches the surface.
- **Tested:** it never cuts the surface elsewhere, never reaches the underside, and leaves the exit portal, the pillars and the ring gateways exactly as they were.

**What is inside.** There is no boss and no fight:

- 7 Astral Lanterns hanging on chains, and old crystal growths (dim light 5) on the floor and walls.
- 16-21 nest hollows in two tiers round the walls, far too many for one dragon. Every one is empty; some hold broken shell fragments. Nothing explains them.
- Ancient End Bricks showing through the walls and floor, and a core of them under the exit portal, banded with Ender Glyph Stone murals. The island was built on, or around, something older.
- A broken portal with its own frame design: a ring of crying obsidian, obsidian and chiseled Ancient End Bricks round a Dead Portal sheet. Phase 4's "The Dragon's History" quest uses it.
- 3-4 chests (`chest/dragon_nest_a` to `_d`), holding:
  - the Nest's five fixed lore fragments;
  - Dragon Scale Fragments (found nowhere else);
  - Ancient Fragments;
  - one Ancient Map, tied to the giant nearest the Nest;
  - a 6% chance per chest of an ancient weapon.

  Each chest rolls once per world, when first opened, as every container does, and everyone shares what it rolled.

Entering the chamber earns "Beneath the Pillars".

**The dragon.** The Nest lies under the island and away from the fight, and the dragon's AI ignores it. `DragonFight.nearest()` skips players in the Nest, so the dragon never dives at someone down there. That is the only change to how the dragon fights. (Phase 3 also fixes its boss bar: the death sequence's last tick used to add the bar back after `finish()` had cleared it, so it stayed on screen at 0% for the rest of the session.) A respawned dragon (the End Crystal ritual) fights as before and never touches the Nest (tested).

### Loot

Every structure chest has a table in `src/common/data/loot.ts`:

- one per variant (plus the Shipyard's Elytra chest and the Metropolis vault);
- one per giant (plus the Colossus cache and the Fortress armories);
- the Nest's;
- one for each Construct's drops.

Two new loot functions:

- `lore`: makes a book a lore fragment, picked by the site's weights;
- `ancient_map`: an unmarked map, which the server marks when the chest is filled.

The other rules:

- **Phase 2 materials** come in small amounts: Void Shards, End Crystal Fragments, chorus materials, Astral Dust and Shards, Ancient Fragments.
- **Ender Scrap** is uncommon (Shipyards, the Metropolis, Fortress armories, Constructs).
- **Finished Ender Alloy gear** is rare: weight 1-2 in the Metropolis and the Fortress armories, always enchanted.
- **Damaged gear** in Ruins and the Fallen City comes worn (`worn`: 15-60% used).
- **Elytra.** The only new source is the Shipyard: when a Shipyard is planned, its first finished hull's chest becomes `chest/end_shipyard_elytra` with a 15% chance (`SHIPYARD_ELYTRA_CHANCE`; about 15% of Shipyards, tested). The classic End Ships keep their guaranteed Elytra and the classic End City chests are unchanged.

### Advancements (phase 3)

All in the End tab, awarded by the server, never for cheat-made things or under a cheat:

| Advancement | For |
| --- | --- |
| Cities Beyond the Cities | Find an End City variant |
| Grand Tour of the End | Find all eight variants |
| Lost in Translation | "Read" (use) an Ender Glyph Stone |
| Pieces of a Story | Find 10 different lore fragments (kept per player as `endLore`) |
| Keeper of Relics | Find all six End Artifacts (`endArtifacts`) |
| Fallen Giant / Glass Choir / Watching the Void / The Last Wall / What Remains | Discover the End Colossus / Crystal Cathedral / Void Observatory / End Fortress / Fallen City |
| Wonders of the End | Discover all five giant structures (`endFound`) |
| Beneath the Pillars | Enter the Dragon's Nest |
| Unmade | Defeat a Guardian Construct: Bulwark |

### Admin Panel (phase 3)

The End Expansion tab gains a Structures section and a Dragon's Nest section. Every op is an advancement-neutral cheat: Constructs it places are cheat-made, items it gives are admin items, and structures it builds award nothing to whoever is in the cheat context.

| Op | What it does |
| --- | --- |
| `locate_structures` | Lists the nearest of each variant and each giant (searching from the player in the ring, otherwise from the arrival island) and the Nest, with distances |
| `tp_structure` | Teleports to the nearest of the chosen structure (from the same place as the locator) |
| `generate_here` | Plans the chosen variant or giant at the player, whatever the biome, and builds it into the loaded chunks, one per tick |
| `build_nest` / `tp_nest` | Builds the Dragon's Nest now (before the dragon's defeat too, for testing), and teleports to its entrance |
| `reset_loot` | Restores the chests of the structure the player stands in (or the Nest's, on the main island), unrolled: their loot rolls again when opened |
| Spawn: Sentinel, Bulwark | The panel's usual spawn action; a Construct without a post takes the spot it spawned at as its home |
| `give_set` | Gains the sets `artifacts`, `ancient_weapons`, `ancient_map` and `ancient_blocks` (each item can also be given alone) |
| `give_lore` | Gives a random lore book (any fragment, Nest fragments included) |

### Saves and old worlds

- **What is saved.** Structures are blocks and block entities in saved chunks. Looted chests keep their contents, and killed Constructs stay dead. The Nest's progress is in the level flags. Players keep `endFound`, `endTitles`, `endLore` and `endArtifacts`.
- **New registry entries.** The blocks and items are appended to the registries, so no saved number moves.
- **Phase 1 and 2 worlds (generators 6 and 7)** load and play as before. They get no structures, since their generator never plans any. They do get the Nest once their dragon is dead (it is the server's work, not the generator's), and their Ancient Maps stay unmarked.
- **Unexplored chunks.** In a generator 8 world, structures appear only in chunks generated from now on.

### Fixes along the way

- **The dragon's boss bar** stayed on screen after every kill (see [the Dragon's Nest](#the-dragons-nest)).
- **The void edge guard (phase 2):** a mob in the air whose step would have taken it over the void was put back where it was, keeping its whole fall. It hung at the ledge while its fall distance grew, then died of the fall when it landed. The "never walk off the island" test failed about half its runs. Now only the sideways part of the step is undone and the fall distance is kept as it was.
- **`kill_mobs`** also removes Guardian Constructs.

### Tests (phase 3)

- **`tests/unit/v6-structures.test.ts`** (on real generators and servers):
  - **Placement:**
    - biomes, ring and arrival island; nothing reaches the classic End; no structures for generators 6 and 7;
    - determinism; spacing; no overlaps; reachability;
    - giant rarity over the whole ring of three worlds;
    - ten layouts from ten seeds for each of the 13 kinds.
  - **Building:** chunk-order independence, and chunks only getting their own part.
  - **Lore:** every fragment at most four lines and listed here, word for word.
  - **Loot:**
    - every table rolls;
    - Ender Alloy rarity and the Shipyard Elytra rate;
    - the Nest's lore and map;
    - loot rolling once per container across players.
  - **The Nest:**
    - absent before the dragon dies; carved after, one chunk per tick;
    - built once; the protected blocks untouched;
    - a BFS walk from the surface down to the floor;
    - an old save with `dragonKilledOnce` getting it;
    - a respawned dragon ignoring a player inside and dying again.
  - **Constructs:**
    - telegraph times (24/30/32, and 32 with a crowd);
    - the leash; the shield halving damage;
    - no respawn after a restart;
    - the Bulwark's advancement and loot.
  - **Discovery:** titles, the sting and advancements for each of two players, once.
  - **The ancient civilization:**
    - glyphs, inert messages, lore and artifact counts;
    - map marking;
    - the three weapons' properties.
  - **Saves, old worlds and admin:** saves through a restart, and every admin op awarding nothing.
- **`tests/unit/v6-regression.test.ts`:** generator 8 added to the classic End hashes and the other dimensions.
- **`tests/e2e/v6.mjs`** also screenshots:
  - each variant and each giant, generated by the Admin Panel at a spot in the Expanded End;
  - a Sentinel's and a Bulwark's telegraphs;
  - the inside of the Dragon's Nest;
  - an Ender Glyph Stone wall.

## Phase 4: engineering, transport, quests and Elytra upgrades

Phase 4 makes the Expanded End somewhere to build in, travel across and
finish things: End machines on V5 engineering, five ways of getting about,
five quests in the ancient structures, and upgrades for the Elytra. It adds
no new generator version (structures already carried their quest parts in
phase 3), no new ending, and nothing to the classic End.

The rules it keeps:

- **No second systems.** The machines are V5 components (see
  [ENGINEERING.md](ENGINEERING.md#end-engineering-v6-phase-4)); "End Power" is
  EU. The quests are V4 quests (a `QuestSpec` of kind `'end'` in the
  structure plans, records in `level.quests.end`, the same tracker). Recipes
  are in the Recipe Book.
- **The End is not a factory.** Eight craftable End components, all made
  from the End's own resources. No structure spawns with a working machine:
  cores are dormant, lenses cracked, gateways broken.
- **The Elytra is never nerfed.** An Elytra without upgrades, with or
  without rockets, flies exactly as before (a recorded flight path is
  checked against a verbatim copy of the old code).
- **Exploration still matters.** Nodes link only nodes players built;
  gateways only pairs players mended; nothing takes anyone somewhere they
  couldn't already reach.
- **Server-authoritative, save-compatible, cheat-neutral.** New state lives
  only in block entities, quest records, item data (`tag.data`) and
  `level.flags`. The client never sends item data the server keeps (an
  Elytra's upgrades can't be faked). Anything done with the Admin Panel
  earns nothing.

### End engineering

| Machine | EU | What it does |
| --- | --- | --- |
| Crystal Generator | +128 EU/t | burns an End Crystal Fragment every 400 ticks |
| Void Collector | +24 EU/t | only with 32+ blocks of open air below it, down to the bottom of the world; ×4 during a phase 5 Void Storm (`server.endEvents.voidStormFactor`) |
| Restored Ancient Core | +512 EU/t | never runs out; restored, never crafted (below); Silk Touch picks it up |
| Void Cell | stores 2,000,000 | 4,096 EU/t in and out; keeps its charge when broken |
| End Processor | −64 EU/t | Ender Ore → 2 Ender Scrap; Void Crystal Ore → 4–6 Void Shards; End Crystal Cluster → 5 End Crystal Fragments; Ancient End Fragment → 3 Ancient Fragments (4% an Ancient Key Shard); Chorus Stalk → 4 Chorus Fiber |
| Crystal Grower | −32 EU/t | an End Crystal Cluster on Crystalline End Stone beside it every 5 minutes |
| Teleportation Node | 1,000 + 10/block a trip | below |
| Ender Bridge Projector | −16 EU/t per 16 blocks | below |
| Ender Rail | −1 EU/t | below |

Recipes (Engineering Crafting Table): Crystal Generator (fragments, Ender
Alloy, cable, control circuit), Void Collector (Crystal Glass, Void Shards,
Dark End Stone), Void Cell (Void Shards, Ender Alloy, a battery), End
Processor (Ender Alloy, fragments, a crusher, a control circuit), Crystal
Grower (fragments, Crystal Glass, Crystalline End Stone, a control circuit),
Teleportation Node (Astral Shards, an Ender Pearl, Ender Alloy, an advanced
circuit, steel plates), Ender Bridge Projector (Chorus Rope, fragments,
Ender Alloy, a control circuit), Ender Rail ×16 (Ender Alloy, a fragment).

**Ancient Cores.** Dormant cores in the ancient structures carry power like
cables. In each giant structure one of them (the first anyone restores) can
be brought back with 8 Ancient Fragments and an Astral Shard. A restored
core can be moved with Silk Touch; it is the only way to have one.

Each machine has idle, working and error fronts and its own hum. The
Engineering Book has **End Engineering** and **End Transport** chapters.

### Transport

| Way | Rules |
| --- | --- |
| **Ender Bridges** | The projector lays a walkable, translucent, unbreakable bridge of Ender Light up to 64 blocks the way it faces, stopping at the first solid block; 16 EU/t per started 16 blocks. Without power (or without its signal, in a signal mode) the bridge flickers, then fades over 3 seconds: the flicker is the warning to get off. |
| **Teleportation Nodes** | Placed by players. Each has a name (set in its window) and is public unless its owner locks it. Its window lists every other node in the same dimension: all of the End's, or in the Overworld those within 2,000 blocks of spawn (other dimensions: none). A trip costs 1,000 EU + 10 EU a block from the departure node's buffer, after 40 ticks standing on the node (with particles); the arrival must be clear, or nothing happens and nothing is paid. Never across dimensions. The node index is `level.flags.endNodes`, so nodes in unloaded chunks still show. |
| **Ancient Gateways** | Every broken portal (in End Ruins and the Fallen City) has a pair, fixed by the seed, about a sixteenth of the way round the band (median over 1,500 blocks). Mend both ends and the pair becomes a gateway, both ways, for good. It works like an End gateway, looks ancient, and never touches the classic gateways. See the Broken Gateway. |
| **Ender Rails** | Powered by a signal or by 1 EU/t from a cable, they drive minecarts at twice a powered rail's speed (0.8 blocks/tick). They can lie on Ender Light, so a line can cross the void on a bridge. Plain rails, powered rails and minecarts came with them (MineHonk had none before). |
| **Void Skiff** | A flying boat for a pilot and one passenger: 1.5× walking speed, hovers 3 blocks over whatever is below (ground or void), rises and sinks slowly (jump / sprint) and never climbs more than 16 blocks above the lowest it was in the last minute. It burns a Void Shard every 30 seconds from a 16-shard tank (feed it shards with a right click); dry, it sinks slowly and warns the pilot. Its recipe (Chorus Planks, Chorus Cloth, Void Shards, an Ender Alloy Ingot) is locked until a player reads a **Void Skiff Blueprint**, found in the Shipyards' finished ships. |

Elytra and rockets stay the fastest way to explore; the skiff is for
carrying a friend across the void, not for speed.

### Quests

Each quest starts at its trigger, keeps its steps on the server and shows
the next step in the quest tracker (in the End's colours). Loot is given
once per world; advancements once per player. Everyone nearby when a step is
done shares it. Admin completions award nothing and give cheat-marked items.

<details>
<summary><b>Spoilers: walkthroughs</b></summary>

**THE LOST OBSERVATORY** (End Observatories and the Void Observatory)

1. Find the observatory's Ancient Lens (it is cracked).
2. Repair it with 8 Ancient Fragments. The conduits down to the core at the
   telescope's foot mend with it.
3. Power it: 256 EU/t into the core for 30 seconds (the tracker shows the
   charge).
4. Look through it (right click with an empty hand): an Ancient Map to the
   nearest giant structure the looker hasn't found. Once an in-game day.

Rewards: 2 Astral Shards and the *stars_circle* fragment (once per world).

**THE BROKEN GATEWAY** (End Ruins and the Fallen City)

1. Inspect a broken portal.
2. Repair its frame: 12 Ancient End Bricks and an End Crystal. Its sheet
   comes back dead, and you get an Ancient Map to its pair.
3. Follow the map.
4. Repair the pair the same way: both sheets light.
5. Step through. The first time in the world: the *gateways_stitches*
   fragment.

**THE SILENT CITY** (one per world: the Fallen City nearest the arrival
island; with none within 4,000 blocks, the nearest End Settlement; failing
that, End Ruins)

1. Find the city's sealed hall (built into the city when its chunks load).
2. Collect the 4 Ancient Key Shards from the city's reliquaries.
3. Combine them into the Ancient Key (crafting).
4. Open the hall and recover the **Silent Bell**.

The Silent Bell holds every Construct within 64 blocks still for 10 seconds;
5 minutes to ring again. The Ancient Key is kept, and also opens the End
Fortress's inner keep and the End Library's archive.

**THE CRYSTAL VAULT** (End Palaces)

1. Inspect the vault door: four empty pedestals rise.
2. Put an End Crystal on each.
3. Power them from a working Crystal Generator (other power doesn't light
   them). The crystals light one by one, then the door opens.
4. Survive the vault's Bulwark, which wakes as the door opens.

Loot: Astral Shards and Ender Alloy gear in the vault. The first vault each
player clears also gives the **Ender Blink** module (only once per player).

**THE DRAGON'S HISTORY** (the Dragon's Nest)

1. Read the Nest's five fragments.
2. Find three more fragments about the Dragon.
3. Gather four Dragon Scale Fragments.
4. Repair the Nest's ring with them. It opens one way into the **Sanctum**,
   a small hidden room deep in the band, built the first time anyone goes
   through. It holds the **Sanctum Dragon Scale** (the Void Recovery module),
   the *sanctum_seen* fragment, and a way back to the Nest.

</details>

### Elytra upgrades

Modules go on at the smithing table (Elytra + module). An Elytra takes three,
never the same one twice; shears at the smithing table take the newest off
(the module is lost). Upgrades live in the item's data, so they survive
repairs (either membrane), anvils, renaming and saves. The tooltip lists
them, each shows as a small mark on the worn wings, and the HUD shows meters
for Hover, Burst, Blink and Void Recovery.

| Module | Effect | Made from |
| --- | --- | --- |
| Reinforced | 864 durability instead of 432 | 2 End Phantom Membranes, an Ender Alloy Ingot |
| Thrust | gliding picks up speed 30% faster; rockets push 20% harder (the server's movement check allows for it) | an Astral Shard, an End Phantom Membrane, 2 Void Shards |
| Hover | sneak while gliding to hang in the air, up to 3 seconds until you stand on the ground again; a point of durability every 10 ticks of it | 4 End Crystal Fragments, an End Phantom Membrane |
| Burst | double-tap jump while gliding: a rocket's push for 8 ticks; 3 charges, each back 10 seconds after use | 4 Void Shards, 4 Astral Dust, an End Phantom Membrane |
| Void Recovery | in the End only, falling below the void line puts you back on the last solid ground you stood on, for a quarter of the wings' remaining durability; 5 minutes to recharge (saved with the player) | the Sanctum Dragon Scale |
| Ender Blink | while gliding, use with an empty hand: 8 blocks straight ahead, cut short before anything solid (never into a block); 20 seconds to recharge | the Crystal Vault's reward |

### Advancements (phase 4)

All in the End tab, awarded by the server, never under a cheat:

| Advancement | For |
| --- | --- |
| Power From the End | running a Crystal Generator |
| It Still Hums | restoring an Ancient Core |
| Bottled Void | filling a Void Cell |
| Light Underfoot | crossing the void on an Ender Bridge |
| Been There, Built That | teleporting between two of your own nodes |
| Two Edges, Held Together | repairing both ends of an ancient gateway |
| Void Sailor | piloting a Void Skiff across 500 blocks of void |
| The Lost Observatory, The Broken Gateway, The Silent City, The Crystal Vault, The Dragon's History | each quest |
| Everything the End Remembers | all five quests |
| Better Wings / Fully Fledged | an Elytra upgrade / all three slots filled |

### Admin Panel (phase 4)

In the End Expansion tab, all advancement-neutral:

- **End quests:** for each quest, Start, Complete, Reset (everywhere, with
  its blocks where loaded) and Teleport to its nearest start; a status line.
  A completion marks the record a cheat: no advancements, cheat-marked
  rewards, and the world's loot stays unclaimed.
- **Give sets:** End machines and transport (every machine, nodes, bridges,
  rails, minecarts, the skiff and its blueprint), Elytra and modules (with a
  smithing table and shears), quest items (the Ancient Key, the Silent Bell,
  the Sanctum Dragon Scale, shards, scale fragments, bricks, crystals).
- **Tests (look at the block first):** fill the machine's EU (it is marked a
  cheat); force-repair a gateway and its pair; open the Sanctum; build an End
  test line (a fuelled Crystal Generator charging a Void Cell, an End
  Processor, a Crystal Grower, two nodes and an Ender Bridge Projector).
- Structures the panel generates keep their quests, so they can be tried
  out, but their records start as cheats.

### Saves and old worlds

- New state: machine block entities; `level.quests.end` (quest records);
  `level.flags.endNodes`, `endGates`, `silentCity`, `dragonSanctum` and
  `endGenerated` (structures the panel built); the player's unlocked recipes,
  End rewards, Void Recovery cooldown and followed quest; Elytra upgrades in
  item data.
- Phase 1–3 saves load as they are (missing records start empty). Phase 3
  worlds (generator 8) have every quest in their structures, including
  chunks generated before phase 4. Phase 1 and 2 worlds have no structures,
  so only the Dragon's History (once the Nest is carved).
- Looking at a quest site creates no record; only doing something does.

### Deviations from the plan

- **Rails were missing.** MineHonk had no rails or minecarts; Ender Rails
  needed them, so plain rails, powered rails and minecarts came first.
- **The Sanctum Dragon Scale** is the Void Recovery material, named apart
  from the Ender Dragon's existing scale item.
- **Broken portals** are in End Ruins and the Fallen City (the structures
  that had them in phase 3).
- **Admin-built structures** hold working quests, but count for nothing.
- **The End Processor's "artifact shard"** is an Ancient Key Shard (4%), so
  a Silent City key can, slowly, come from processing too.

### Fixes along the way

- Admin quest operations now report failure when a world has no site for
  the quest (or nothing is looked at), instead of answering "ok".
- The tracker no longer saves empty records for quest sites a player only
  walked past.
- Moving an item around the creative inventory no longer loses its item data
  (an Elytra's upgrades, a Void Pack's contents, an Ancient Map's target):
  the client can't send item data, so the server puts back its own copy of
  the stack the player picked up.

### Tests (phase 4)

- `tests/unit/v6-phase4.test.ts`: each End machine (output, fuel, the void
  check and storm hook, the restored core, the Void Cell, the processor's
  recipes, the grower, signal modes, nothing found-only is craftable);
  bridges (length, load, cost, fade), the bridge advancement, rails on Ender
  Light at twice a powered rail's speed, the Void Skiff (fuel, sinking with
  a warning, the climb limit, two riders), nodes (cost, warm-up, unsafe
  arrivals, no crossing dimensions, locks); the Elytra (slots, duplicates,
  shears, repairs and anvils and saves, an unchanged flight path, Thrust,
  Hover, Burst, Blink never into blocks, Void Recovery End-only with its
  cooldown).
- `tests/unit/v6-quests.test.ts`: each quest end to end through the
  client's own messages, with two players where it matters; gateway pairs
  (deterministic, symmetric, far apart, at most one left over) and two-way
  travel; once-per-world and once-per-player rewards; saves (machines,
  nodes, gates, quest records, Elytra data) and carrying on after a reload;
  phase 1–3 saves; every Admin Panel op, with nothing earned.
- The phase 1 regression hashes and the V5 engineering tests pass unchanged.
- `tests/e2e/v6.mjs` (phase 4 part): the End test line over the void
  (`v6-crystal-generator.png`), its Ender Bridge (`v6-ender-bridge.png`), a
  node's window (`v6-teleport-node.png`), a Void Skiff flown off the edge
  (`v6-void-skiff.png`), a repaired gateway (`v6-ancient-gateway.png`), the
  quest tracker (`v6-quest-tracker.png`), an Elytra upgraded at a smithing
  table (`v6-elytra-smithing.png`) and its tooltip (`v6-elytra-tooltip.png`).

## Phase 5: events, the Dragon, the Void Citadel and the End Guardian

Phase 5 finishes V6. It adds weather to the Expanded End (Void Storms and the End Eclipse), eight new moves for the Ender Dragon, the Void Citadel (a six-floor tower hanging into the void) and the End Guardian at its bottom. It also adds the music, title screen and advancements that close the version. Every new piece reuses an existing system:

- Structures go through the structure manager and the generator.
- Telegraphs and banners use the fx system (`warn_*`, `hack`).
- The boss bar, quests, loot tables, engineering networks and Admin Panel are the existing ones.

The rules it keeps:

- **The classic End is unchanged.** Storms and eclipses only reach the Expanded End's ring; the main island, the outer islands and the Phase 1 regression hashes stay as they were. Worlds made before V6 (no Expanded End) have no events and no Citadel.
- **The Dragon fight is added to, never replaced.** Some things stay exactly as they were:
  - its 200 health, the crystals and pillars, the exit portal;
  - when it perches (`perchDue` and the approach chance are untouched);
  - its defeat (`dragonKilled`, `dragonKilledOnce`, `finish()`), respawning with four crystals;
  - the V5.5 malware path (`herobrine.onDragonDefeated()`, `malware.onDragonGone()`);
  - the V3 Voidbound secret (`completeSecret()`);
  - and the Phase 1–3 hooks (the Expansion Portal, the Nest on its death).
- **Every new attack is fair:**
  - it is shown at least 24 ticks before it lands (32 with other players near);
  - its name is on a warning banner (fx `hack`);
  - it is resolved on the server where it lands;
  - nothing hurts unseen, and nothing knocks anyone into the void without warning.
- **Nothing permanent breaks.** Every block an event or a fight changes (craters, dropped arena tiles, remnants, monoliths, shards) is recorded in `level.flags`, put back afterwards, and saved until it is.
- **No new ending.** The End Guardian's fall is a victory title; `endings.ts` never hears of it.

### Void Storms

- **Schedule:** every 2–4 in-game days (`STORM` in `src/common/endExpansion/events.ts`), never during an eclipse or with one due.
- **Length:** 3–5 minutes.
- **Warning:** a minute ahead. The sky dims, the void rumbles, and a **VOID STORM APPROACHING** banner shows. Then violet fog, void motes and the storm's own sound bed.
- **Void Debris:** about every 2.5 s near each player in the band, a ring marks the impact 24 ticks (32) ahead while a stone falls onto it. It deals 6 damage within 1.6 blocks and then shatters: a falling block that never settles and never breaks anything.
- **Cracks:** cosmetic crack decals flicker along island edges near the player (client-side).
- **Low-gravity pockets** (radius 4, 20 s):
  - marked 24 ticks first, then a swirl;
  - inside, jumps go twice as high and falls are half as fast: the client's gravity is halved;
  - never reversed, never a pull.
- **Mobs:**
  - Void Stalkers and Chorus Beasts follow 50% further;
  - Chorus Beasts turn on anyone they can see;
  - Endlings out in the open blink into cover.
- **Crystals:**
  - Crystal Clusters glow brighter;
  - Crystal Generators make 50% more;
  - the Void Collector makes 4× (the phase 4 hook).
- **Storm Remnants:**
  - 1–2 per storm, small floating ruins near players, each with a chest (`chest/storm_remnant`: Ancient Fragments, Void Shards, now and then an artifact);
  - in the storm's last 30 seconds they flicker and a **THE REMNANT IS FADING** banner shows;
  - when the storm ends they go. Anyone standing on one is set down on the nearest solid ground, and whatever its chest still held drops there.
- **Advancements:** *Weathered* (be out in the band through a storm) and *Salvage* (open a remnant's chest).

### The End Eclipse

- **Schedule:** rolled each day, 2.5% a day and at least 20 days apart, so about one in sixty days all told. It starts at nightfall and lasts one night (about 7 minutes). There is no warning.
- **The sight:**
  - a one-time **THE END ECLIPSE** title with its own sting;
  - the sky turns near black;
  - a dark disc ringed with white-violet light hangs in the north-east;
  - stars show through the fog;
  - light motes drift, and island edges glow faintly;
  - block light is brighter and paler, so astral blocks, ores and crystals stand out.
- **Eclipse Shards:**
  - grow on island surfaces near players (one every 8 s, up to ten around each);
  - can be mined only while it lasts, and dissolve at dawn;
  - are the altar's fuel, the Guardian's Lance's repair material, and loot.
- **Eclipse Monoliths:**
  - 2–3 near each player: obsidian and astral pillars, each with a cache (`chest/eclipse_monolith`: shards, astral loot and one fragment of a lore set found nowhere else);
  - 30 seconds before dawn they flicker with a warning, then go by the same rules as remnants.
- **Eclipsed mobs:**
  - End Phantoms come more often, at most two per player's area;
  - Void Stalkers come pale and outlined, take 25% less damage and have a second Void Slip in them;
  - both drop extra loot and Eclipse Shards.
- **The beam:** a pillar of light rises from the Void Citadel, seen on the horizon from anywhere in the band, and as a real beam up close.
- **Advancements:** *Dark Disc* (see one) and *Grown in the Dark* (mine a shard).

The state (`level.flags.endEvents`, `endEventBlocks`) is the server's; clients get `end_event` messages and ease their sky towards it.

### The Dragon's new moves

`src/server/systems/DragonAdditions.ts` with its numbers in `src/common/endExpansion/dragon.ts`. TheEnd.ts calls into it at a few points: after its moves each tick, when it picks an attack in its holding pattern, while perched, when a crystal breaks, and when the fight ends.

| Move | When | Shown first | What lands |
| --- | --- | --- | --- |
| **Void Breath Wave** | in place of a strafe now and then | it stops, inhales for 30 ticks (violet glow in its throat) while a purple path is drawn on the ground | a 20-block line of breath along the path, fading over 4 s (Dragon's Breath can be bottled from it) |
| **Wing Gust** | once a perch | it rears up for 28 ticks; a ring marks the 12 blocks round the portal | everyone in the ring pushed away from the portal, at most 6 blocks, and only as far as the island carries on 3 blocks beyond; a player who still overshoots towards the void is set back down where the gust meant |
| **Roar** | about once a perch | | the screen shakes, a ring of light runs out, Endermen within 48 turn to the portal (no damage) |
| **Pillar Weave** | as a perch comes due, now and then | its route through the pillars is drawn | it flies the route (its body hurts as before), then comes down to perch |
| **Strafing Dive** | in place of a strafe now and then | its shadow line on the ground, 24 ticks before the pass | a shallow pass along the line; its claws deal 8 to whoever stays on it, and throw them sideways, never along the line |
| **Crystal Fury** | 10 s after a crystal breaks | the other crystals flare; a 30-tick charge line from a crystal to anyone within 8 blocks of its pillar | 5 damage if they stayed on the line |
| **Edge Strike** | rarely | a red ring over a spot on the island's outer edge for 40 ticks | 6 damage nearby (thrown inwards); a small crater of loose end stone that crumbles 3 s later |
| **Dragon Storm** | below 25% health | | a dark sky and distant thunder over the island (cosmetic) until the fight ends |

The Edge Strike never comes near:

- the pillars (each pillar's radius + 7);
- the exit portal (16 + 7);
- the Expansion Portal;
- the Nest's entrance;
- any of the 20 ring gateways;
- the arrival platform.

Its blocks are recorded in `level.flags.dragonRestore`, put back when the fight ends or the dragon is put away, and saved until then.

**Tuning.** `tests/unit/v6-dragon-sim.ts` runs the same fight twice, with the additions and without:

- one player standing still (nothing dodged), so the damage is an upper bound;
- every random stream seeded;
- crystals broken at 1, 2, 3 and 4 minutes.

Nine runs: three seeds × three spots (by the portal, mid-island, beside a pillar), 6 minutes each:

| | Perches | Damage per minute (no dodging) |
| --- | --- | --- |
| Before (the V3 fight) | 86 | 266 |
| After (with the additions) | 95 | 258 |

So there are 10% more perches and 3% less damage per minute. The worst single run rose 5%, well within the 30% the plan allows.

- **Why the damage doesn't rise:** the new attacks take the place of strafes and charges (20%, 18% and 7% of those picks). They also end in a perch when one is due.
- **Why the perches don't fall:** a weave starts as a perch comes due instead of delaying it.

In those runs, per 6 minutes:

- 0–2 breath waves, 0–3 dives, 0–2 edge strikes and 1–4 weaves;
- a gust on every perch, a roar on most;
- about 16 fury shots for a player camping a pillar (4 crystals broken).

A first-timer in diamond armor with a bow, who steps off a marked line, takes far less than these numbers. The `tests/unit/v6-dragon.test.ts` version of this check (3 seeds, mid-island) asserts no fewer perches and at most 30% more damage.

### The Void Citadel

**Placement** (`src/common/endExpansion/citadel.ts`, `src/server/systems/EndCitadel.ts`):

- **One per world**, at the first site in a seed-ordered list of candidates:
  - a golden-angle spiral through the deep band, 8,600–9,400 blocks out (the band's land ends at 9,600, so the plan's "9,000–12,000" became this);
  - the site must be in the Void Wastes;
  - and nothing else may stand there: the structure census is checked.
- **Old worlds** skip any candidate whose 4 × 4-chunk footprint has a chunk already made (in storage or loaded), so the Citadel never overwrites anything.
- **Saved and built:** the site is saved in `level.flags.citadel`. The plan is pure (`planCitadel(seed, site)`), and the generator builds it into each chunk as the chunk is made, like any structure.
- **Pre-V6 worlds:** worlds without the Expanded End get no Citadel.

**Three ways to find it:**

- **Citadel Star Chart Pieces:**
  - one in the first looting of each giant structure's vault (Colossus cache, Cathedral, Void Observatory, Fortress armory, Fallen City: five in a world);
  - one in the Dragon's History's Sanctum chest;
  - three make the **Void Citadel Map**, whose needle points at the entrance.
- **The Lost Observatory's telescope** during an eclipse: the map, once each eclipse.
- **The beam** during an eclipse.

**The tower:**

- **The top:** an island with an open entrance hall at its top. Below it hangs a 37-block-wide tower of unbreakable Citadel Stone (bricks, pillars, tiles, glass, lamps).
- **The floors:** six of them, 13 blocks apart. Each has:
  - a landing, with a **Citadel Anchor** (it sets the respawn point and never runs out), a small library (`chest/citadel_library`: the Citadel's own lore set) and a vault (`chest/citadel_vault`: enchanted Ender Alloy, Astral Shards, Eclipse Shards, now and then an ancient weapon or an artifact);
  - a sealed 3 × 3 descent door that opens, for everyone and for good, when the floor's objective is done, onto a ladder shaft down to the next floor.
- **The order:** each of the five kinds once plus one twice, shuffled by the seed. Difficulty grows with depth.

| Floor | Objective | Deeper means |
| --- | --- | --- |
| **Combat** | clear the hall: its Sentinels (and a Bulwark deeper down) and every Void Stalker the two rifts let out, two at a time, each rift marked before one climbs out | more Sentinels, more Stalkers |
| **Glyph Lock** | press the keys by the door in the order of the glyphs on the mural; a wrong key darkens them all and wakes a Sentinel | longer sequences (3–6 of 8 glyphs) |
| **Crystal Sequence** | touch the Sequence Stone and watch the six pedestals light, then repeat it | 4–7 steps |
| **Parkour** | out through the wall and round the outside over open void: stepping stones, pulsing Ender Light bridges (on 6 s, flickering 1.5 s, gone 2.5 s) and a moving platform that carries its rider; reach the far landing | 3-block gaps instead of 2 |
| **Engineering** | a running core and a socket joined by broken Ancient Conduits; bridge them with your own cable, then wire the three levers (A, B, C) through your own logic gates so the socket's signal follows the rule on the wall (one of eight, by the seed). The socket tries all eight lever combinations, one at a time, and opens the door only if every one is right | (the rule) |

Multiplayer:

- doors open for everyone;
- anyone's key, pedestal or lever counts;
- Constructs have 50% more health for each extra player on the floor.

Floors done, doors opened, rifts emptied and Star Charts given are saved in `level.flags.citadel`. Chests are looted once, as always. Falling off the parkour route is falling into the void.

Discovery shows a one-time **THE VOID CITADEL** title with its sting and its sound bed. Each kind of floor has its own bed, the halls have an ancient one, and the server picks the bed (`ambience` messages). Advancements:

- *The Void Citadel* (find it);
- one for each kind of floor cleared;
- *The Bottom of the Tower* (reach the arena).

### The End Guardian

**The arena.** It lies under the last floor:

- a round platform of Guardian Floor (radius 15) over a lower floor eight blocks down, which catches every fall (with fall damage);
- the lower floor's middle is glass over the void;
- stairs climb back up on two sides.

**The altar** wants four Eclipse Shards, one at a time. It comes charged the first time.

**Stats:**

- 1,000 health, +400 for each player beyond the first in the arena when it wakes;
- armor 16;
- never knocked back.

Every attack is named on a banner and shown first (24 ticks, 32 with company), and resolved on the server.

| Phase | Health | Attacks |
| --- | --- | --- |
| 1. **AWAKENING** | 100–66% | **CRYSTAL LANCE**: a 30-tick charge line from its chest through the target, then a beam along exactly that line (14). **GROUND FRACTURE**: a ring of cracks round the target for 32 ticks, then those tiles drop to the lower floor for 3 s. **CONSTRUCT CALL**: two Sentinels, each marked first, at most every 45 s. |
| 2. **VOID SHIFT** | 66–33% | **VOID ORBS**: three slow homing orbs that can be shot or struck down (8). **GRAVITY WELL**: a low-gravity pocket like the storm's, marked 24 ticks first. **CRYSTAL SHIELD**: four pylons rise; it takes half damage until all are broken; they come back once. |
| 3. **CORE EXPOSED** | 33–0% | Faster, and lances and fractures in pairs. **COLLAPSE**: the outer ring flashes for 40 ticks, then drops for 8 s. **FINAL LANCE**: a slow sweep all the way round at chest height (16) under a **JUMP OR DUCK** banner: in the air or sneaking, it passes over or under. |

**Core windows:** after every fourth attack it kneels for 5 s with its core bare and takes half as much again.

**Resets and respawning:**

- If everyone dies or leaves (40 blocks), it resets after a minute: full health, the arena put back, the altar still charged.
- A fight is never saved: a restart resets it and keeps the altar charged. Changed arena blocks are saved (`guardianRestore`) and put back.
- Defeated, it re-forms after 7 in-game days, and each fight after the first wants four shards.

**Loot** (each player who fought gets their own):

| Item | Chance | What it is |
| --- | --- | --- |
| **Guardian Core** | certain on each player's first defeat of it (recorded per player), 25% after | at the smithing table it opens an Elytra's fourth upgrade slot (once) |
| **The Guardian's Lance** | 33% | a sword-like weapon that reaches 2 blocks further; use it to fire a short Crystal Lance (12 blocks, 9 damage, stopped by blocks), 40-tick cooldown |
| **Eclipse Veil** (Elytra module) | 20% | while gliding, sneak and use an empty hand: hard to see for 5 s, and every mob after you loses you (none can pick you out until it ends); 60 s to recharge |
| **End Guardian Head** | every defeat | a decorative block |
| `chest/end_guardian` | always | enchanted Ender Alloy, 3–6 Astral Shards, 2–4 Eclipse Shards, scrap and experience |

Its fall shows **THE END GUARDIAN HAS FALLEN** with its own music. There is no ending card and nothing in `endings.ts`. Advancements:

- *The End Guardian Has Fallen*;
- *Jump or Duck* (without being struck by a Final Lance);
- *Four Wings' Worth* (fill all four Elytra slots).

### The whole progression

1. Defeat the Ender Dragon (now with its new moves). The Expansion Portal on the main island opens.
2. Cross to the Expanded End's arrival platform and explore its seven biomes, mobs and resources (Ender Alloy, astral and crystal materials).
3. Find the structures. A giant structure's vault gives the first Star Chart Piece. The quests, End engineering and transport make the band home; the Dragon's History opens the Sanctum (another piece).
4. Weather Void Storms for their remnants. Under an End Eclipse, gather Eclipse Shards and visit the monoliths; the telescope and the beam point the way too.
5. Three pieces make the Void Citadel Map. Follow it, and work down the six floors.
6. At the bottom, wake the End Guardian at the charged altar and defeat it.
7. Its Core gives the Elytra a fourth slot, for the Eclipse Veil or anything else. Every seven days it can be fought again, for four Eclipse Shards.

### Audio and visuals

- **Sound** (`src/client/audio/synth.ts`):
  - beds for the storm, the eclipse, the ancient halls, each kind of Citadel floor, the arena, and the Guardian's three phases (thicker and faster each phase);
  - stings for the eclipse, the Citadel and the victory;
  - the Dragon's roar, inhale, breath wave, gust and edge strike;
  - every storm, Citadel and Guardian sound;
  - mob voices for the Guardian (stone machinery, grander), its pylons and its orbs.
  - The Phase 1 biome beds are unchanged and still play.
- **Sky** (`Sky.ts`, `WorldRenderer.ts`, `EndEventsClient.ts`):
  - the storm's violet murk and closer fog;
  - the eclipse's near-black sky, its disc and corona, stars through the fog, and brighter block light;
  - the Dragon's storm;
  - the Citadel's beam, on the horizon and up close.
- **Particles:** void motes in a storm, light motes and edge glints under the eclipse, and storm cracks.
- **Models:** the End Guardian (Citadel Stone with gold trim, a crown of shards, a lance, a core that blazes when it kneels, a shell of light behind its shield), the Crystal Pylon and the Void Orb. The Dragon rears for the gust and glows violet in its throat for the breath. Eclipsed mobs have a pale outline; a veiled player is nearly invisible.
- **Textures:** the events' blocks, every Citadel block (eight glyph faces, keys lit and dark, the pedestal, the core and socket fronts), the arena, and the phase's items.

### Title screen

The title screen's random scenes are now V6's four (`?title=` picks one):

- `expanded_end` (the arrival island);
- `crystal_fields`;
- `void_citadel` (the tower from the side, hanging into the void);
- `end_eclipse` (an island under the eclipse, with a monolith and shards).

The V5.5 and older scenes remain by name. The edition reads **V6 - The End Expansion**, and `package.json` is 6.0.0.

### Advancements (phase 5)

All are on the End tab and awarded by the server. None counts in a cheat context (Admin Panel storms, eclipses, floors, Guardians and items):

- *Weathered*, *Salvage*;
- *Dark Disc*, *Grown in the Dark*;
- *The Void Citadel*, *Hall Cleared*, *In the Right Order*, *Echo*, *Over Nothing*, *Rewired*, *The Bottom of the Tower*;
- *The End Guardian Has Fallen*, *Jump or Duck*, *Four Wings' Worth*.

### Admin Panel (phase 5)

On the End Expansion tab:

- **Events:** start or stop a Void Storm or an End Eclipse, with their state shown.
- **The Void Citadel:** teleport to the entrance, any floor (1–6) or the arena; solve the floor you are on; reset all progress.
- **The End Guardian:** spawn, next phase, force defeat (no loot, no advancement), reset.
- **Rare End loot:** Guardian Core, the Lance, the Eclipse Veil, Eclipse Shards, Star Chart Pieces, the head (cheat-marked).
- **The Dragon's new moves:** respawn the Dragon (cheat-made), then each move one at a time. The fight becomes a cheat, and its defeat awards nothing.

### Saves and old worlds

New state, all in `level.flags`:

- `endEvents` and `endEventBlocks` (temporary blocks, each with what it replaced);
- `citadel` (site, floors, rifts, charts);
- `guardian` (charged, last defeat, defeats) and `guardianRestore`;
- `dragonRestore`.

Players gain `veiledUntil` (not saved) and the Guardian Core's first-defeat record in their End rewards. An Elytra's fourth slot is `tag.data.slots`.

- **Phase 1–4 worlds** load and get the Citadel, at a site where nothing was generated yet. Their storms and eclipses start on the usual schedule.
- **V5.5 and older worlds** load unchanged: no Expanded End, so no events and no Citadel.

### Deviations and fixes along the way

- **The Citadel's band** is 8,600–9,400 out, because the Expanded End's land ends at 9,600.
- **Two extra Admin Panel tools:** "Next phase" for the Guardian, and "Respawn the Dragon" (so the Dragon's moves can be tried after its defeat). Both are cheats.
- **Generated machines now run from the start:** a newly generated chunk's engineering blocks are registered at once (the Citadel's cores and sockets). Before, that happened only when a chunk was loaded from storage.
- **Respawning at a Citadel Anchor** puts the player at the anchor, not on the island above it. The safe spot is searched from the anchor's height.
- **Warning markers no longer recompile shaders:** under a Void Storm, warning rings and cracks come and go every few seconds. Each time the last of a kind went, three.js freed its shader program, and the next compiled it again, a long frame each time. `WorldFX` now keeps one drawn material of each kind (see Performance).
- **A phase 4 test was flaky:** a roaming Void Stalker could kill the player during a gateway trip, which also happened on the phase 4 commit. The test now keeps the player healthy while it waits.

### Performance

`npm run bench` at render distance 8, run on the phase 4 build (before) and this one (after) on the same machine. Rendering is headless and in software (SwiftShader), so absolute frame rates are far below a real GPU's: compare rows, and read the main-thread time and draw calls, which carry over to real hardware.

| Scene | Before: ms per frame (fps) | After: ms per frame (fps) | JS ms per frame, before → after | Draw calls, before → after |
| --- | --- | --- | --- | --- |
| The classic End, main island (`end`) | 142 (7.1) | 152 (6.6) | 6.7 → 7.8 | 181 → 215 |
| The classic End, outer islands (`end-outer`) | 65 (15.6) | 64 (16.0) | 4.0 → 3.1 | 32 → 19 |
| Astral End (`end-astral_end`) | 82 (12.5) | 87 (11.7) | 2.0 → 2.3 | 22 → 22 |
| Void Wastes (`end-void_wastes`) | 116 (8.7) | 113 (8.8) | 12.1 → 7.9 | 32 → 30 |

Every scene is within 7% of its phase 4 time. The main island's after run had 11 more chunks loaded and 21% more triangles in view (85k against 70k), which accounts for its slower frames. Every Expanded End scene draws faster than the classic main island.

The events are measured from one spot in the Astral End, first without the event and then under it (`end-storm`, `end-eclipse`; each records an `-off` row too):

| Scene | Without: ms per frame (p95) | With: ms per frame (p95) | JS ms per frame, avg / p95 | Draw calls |
| --- | --- | --- | --- | --- |
| Void Storm | 90 (200) | 95 (150) | 2.4 / 6.3 → 7.4 / 8.6 | 22 → 23 |
| End Eclipse | 88 (183) | 93 (167) | 2.2 / 5.8 → 3.1 / 7.7 | 22 → 25 |

Neither event drops frames: the 95th-percentile frame is no slower with the event than without it, and each costs about 5% of the average frame. The storm's higher average JS time is the one-off compile of its markers' shaders when the first ones appear.

The first storm measurement found long frames (a p95 of 196 ms of JS) every few seconds. Each time the last warning ring or crack of a kind faded and its material was disposed, three.js freed the shader program, and the next one compiled it again. `WorldFX` now keeps one drawn material of each kind, so each program is compiled once.

### Tests (phase 5)

- `tests/unit/v6-dragon.test.ts`:
  - 200 health;
  - every new move from the Admin Panel;
  - the breath wave, dive, fury (32 ticks with company) and gust each shown before they land;
  - the roar does no damage;
  - edge-strike sites keep clear of every protected place, and the crater is saved, crumbles and is put back;
  - the gust never pushes anyone off the island, nor towards a hole in it;
  - the tuning check.
- `tests/unit/end-v3.test.ts`, `endgame.test.ts`, `v55-herobrine.test.ts`: the classic fight (five perches or more), the Voidbound secret and the malware path, unchanged.
- `tests/unit/v6-events.test.ts`:
  - 1,200 days of schedule: storm gaps, lengths, eclipse gaps, and never both at once;
  - only the band, never the classic End;
  - debris marked ahead and never breaking a block;
  - remnants fading with a warning and setting the player down safely;
  - pockets;
  - the eclipse's title, monoliths and shards dissolving at dawn;
  - a storm surviving a save and reload.
- `tests/unit/v6-citadel.test.ts`:
  - one site per world, from the seed, in the Void Wastes;
  - an old world skips a used footprint and never overwrites a chunk; pre-V6 worlds have none;
  - built as planned, unbreakable, with a title once;
  - every kind of floor solved (a wrong glyph wakes a Sentinel; the crystal show and repeat; combat with every rift marked; a search over the plan's route for parkour; engineering with real cable and a simulated circuit, a wrong one refused);
  - doors only on the objective;
  - anchors and the void;
  - progress across a reload, and the reset;
  - three players.
- `tests/unit/v6-guardian.test.ts`:
  - the arena's catching floor and stairs;
  - health scaling;
  - every phase's attacks named and shown 24 ticks before any hit;
  - core windows at 1.5× and the shield at half;
  - a fracture's tiles back;
  - the reset when abandoned;
  - re-forming after 7 days for 4 shards;
  - the Core once per player, the head every time;
  - the title and no ending;
  - a forced defeat giving nothing;
  - never saved mid-fight.
- `tests/unit/v6-phase5.test.ts`:
  - the fourth Elytra slot and its advancement;
  - the Eclipse Veil;
  - the Lance's beam, cooldown and reach;
  - Star Chart Pieces and the map;
  - the eclipse beam;
  - every new loot table and lore set;
  - the advancements;
  - every Admin Panel tool, with nothing earned.
- `tests/unit/v6-canon.test.ts`: one world from the Dragon to the Guardian's Core, the way a player goes.
- `tests/e2e/v6.mjs` (phase 5 part):
  - a Void Storm (`v6-storm.png`) and a remnant (`v6-storm-remnant.png`);
  - the eclipse (`v6-eclipse-sky.png`) and a monolith (`v6-eclipse-monolith.png`);
  - the Citadel's title, outside (`v6-citadel-exterior.png`), a Glyph Lock (`v6-citadel-glyph.png`) and the parkour route (`v6-citadel-parkour.png`);
  - each Guardian phase (`v6-guardian-phase1..3.png`) and its victory (`v6-guardian-victory.png`, no ending card);
  - each Dragon move (`v6-dragon-*.png`);
  - the four title scenes (`v6-title-*.png`) and the edition text.

## Lore pool (review)

Every fragment in `src/common/endExpansion/lore.ts`, word for word, for review and hand editing (a test keeps the two in step: change both). The rules:

- **Fragments, not explanations.** At most four short lines and one topic each. None answers its question, and some disagree, as if written by different people.
- **No contradictions of canon.**
  - The dragon is the beast of the classic fight: it "comes back" because it can be respawned.
  - Nothing names the Voidbound, the Farlands or the Error.
  - Herobrine has nothing to do with the End.
- **Disagreements on purpose:**
  - `dragon_pillars_ours` / `dragon_pillars_not_ours`;
  - `fragmented_pulled` / `fragmented_never_whole`;
  - `history_long_dark` / `history_nobody_lived`;
  - `endermen_halls` / `endermen_carried`.

Placement weights by site and topic: a fragment's weight at a site is its topic's weight there. A fragment marked "only in" has weight 3 at its own sites and 0 elsewhere. The Nest's five are only in the Nest. The Eclipse Monoliths hold only the eclipse's five, and the Void Citadel's libraries only its eight (phase 5); neither set turns up anywhere else. Each structure's loot table pulls fragments by these weights.

| Site | The Ender Dragon | The ancient civilization | Endermen | End Cities | Why the End is broken apart | The End gateways | The End and the Overworld | The history of the End |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `end_outpost` | - | - | 1 | - | 2 | 3 | 3 | - |
| `end_settlement` | - | - | 3 | 3 | - | - | 2 | 1 |
| `end_ruins` | - | 3 | - | 2 | 2 | - | - | 3 |
| `end_library` | 2 | 3 | 2 | 2 | 2 | 2 | 2 | 3 |
| `end_observatory` | - | - | - | - | 2 | 3 | - | 2 |
| `end_shipyard` | - | - | - | 3 | - | 2 | 2 | - |
| `end_metropolis` | 1 | - | 1 | 3 | - | - | - | 2 |
| `end_palace` | 2 | 2 | - | - | - | - | - | 3 |
| `end_colossus` | 2 | 3 | - | - | - | - | - | 2 |
| `crystal_cathedral` | 3 | 2 | - | - | - | - | - | 2 |
| `void_observatory` | - | - | - | - | 3 | 3 | - | 2 |
| `end_fortress` | 3 | - | 2 | - | 1 | - | - | 2 |
| `fallen_city` | 1 | 3 | 1 | 3 | 2 | - | - | 3 |

#### The Ender Dragon

- `dragon_counting` (Log Entry).
  > The beast circled the tower nine times today.\
  > It does not hunt us.\
  > It is counting something.

- `dragon_pillars_ours` (Torn Page).
  > We did not make the beast.\
  > We only made the pillars.\
  > Whoever says otherwise has not read the old marks.

- `dragon_pillars_not_ours` (Torn Page).
  > The pillars were never ours.\
  > They stood here when we came,\
  > and the fires on them were already lit.

- `dragon_gate` (Stone Rubbing).
  > IT GUARDS THE GATE\
  > OR THE GATE GUARDS IT

- `dragon_returns` (Loose Note).
  > Every time it falls, it comes back.\
  > Not the same.\
  > Never quite the same.

- `dragon_translation` (Partial Translation). Only in: end_library, fallen_city.
  > "...the one that flies is the one that [?]..."\
  > The last word has no translation.\
  > It is the same mark as "waits".

#### The ancient civilization

- `civ_not_first` (Stone Rubbing).
  > WE WHO CUT THE STONE\
  > WERE NOT THE FIRST TO CUT IT

- `civ_bricks` (Log Entry).
  > Counted the old bricks again.\
  > The newest are older than any city.\
  > Who were they building for?

- `civ_wrote` (Torn Page).
  > They wrote on everything:\
  > walls, floors, the undersides of bridges.\
  > As if afraid of being forgotten,\
  > or of forgetting.

- `civ_hum` (Loose Note).
  > The old machines hum when nobody is listening.\
  > Or I imagine it.

- `civ_left` (Torn Page).
  > They left in a single day.\
  > Doors open. Lamps lit.\
  > Nobody has found where they went.

- `civ_translation` (Partial Translation). Only in: end_library, fallen_city.
  > "...before the cities there was [?], and [?] was..."\
  > The same mark is cut over every sealed door.\
  > We think it means "wait".

#### Endermen

- `endermen_halls` (Log Entry).
  > The tall ones walked our halls before they were finished.\
  > They never moved a single block of them.

- `endermen_carried` (Loose Note).
  > The tall ones carried the stone for us,\
  > one block at a time.\
  > They have not stopped.

- `endermen_ask` (Torn Page).
  > Ask one of the tall ones where it is from.\
  > It will look at you,\
  > and then you will be the one who leaves.

- `endermen_eyes` (Stone Rubbing).
  > DO NOT MEET THEIR EYES\
  > THEY REMEMBER FACES

#### End Cities

- `cities_upward` (Torn Page).
  > The cities were built upward\
  > because there was nowhere left to build outward.

- `cities_purpur` (Log Entry).
  > Purpur grows if you let it.\
  > We stopped letting it.

- `cities_ships` (Loose Note).
  > Every city had a ship.\
  > Every ship was ready to leave.\
  > Most of them never did.

- `cities_last_first` (Stone Rubbing).
  > THIS CITY WAS THE LAST\
  > THIS CITY WAS THE FIRST

#### Why the End is broken apart

- `fragmented_pulled` (Torn Page).
  > The land was whole once.\
  > Then something pulled,\
  > and it came apart like wet paper.

- `fragmented_never_whole` (Loose Note).
  > It was never whole.\
  > We only told the children that\
  > so they would not look down.

- `fragmented_wider` (Log Entry).
  > Measured the gap between two islands.\
  > Wider than last year.\
  > Wider than the year before.

- `fragmented_holds` (Stone Rubbing).
  > WHAT HOLDS THE ISLANDS UP\
  > IS WHAT KEEPS THEM APART

- `fragmented_clean` (Torn Page).
  > The edges are clean.\
  > Stone does not break that cleanly on its own.

#### The End gateways

- `gateways_in` (Torn Page).
  > The gateways were not built to let things in.\
  > Read that again.

- `gateways_count` (Loose Note).
  > A new gateway opens each time the beast falls.\
  > Who decided that?\
  > Who is keeping count?

- `gateways_before` (Stone Rubbing).
  > THE DOORS IN THE SKY\
  > WERE HERE BEFORE THE SKY

- `stars_gateways` (Star Chart). Only in: end_observatory, void_observatory.
  > Each gateway points at a star.\
  > Each star points back.

#### The End and the Overworld

- `overworld_weather` (Torn Page).
  > There is a world with weather.\
  > I have never seen it.\
  > My grandmother said it was loud.

- `overworld_eyes` (Loose Note).
  > Twelve eyes to open the way from below.\
  > Who taught them the number?

- `overworld_dream` (Stone Rubbing).
  > THE GREEN WORLD IS THE DREAM\
  > THIS IS THE WAKING

#### The history of the End

- `history_order` (Torn Page).
  > First the stone. Then the builders.\
  > Then the beast.\
  > Or was it the beast first?

- `history_long_dark` (Log Entry).
  > The year of the long dark. No lamp would stay lit.\
  > We moved everything to the outer islands.

- `history_nobody_lived` (Torn Page).
  > Nobody ever lived on the outer islands.\
  > Whoever wrote otherwise\
  > was copying from something older.

- `history_middle` (Loose Note).
  > Our records begin in the middle of a sentence.

- `history_crown` (Stone Rubbing).
  > REMEMBER THE CROWN\
  > REMEMBER WHO WORE IT LAST

- `stars_missing` (Star Chart). Only in: end_observatory, void_observatory.
  > The stars here do not move.\
  > We charted them for a hundred years anyway.\
  > On the last night, one of them was gone.

#### The Dragon's Nest (fixed, found nowhere else)

- `nest_many` (Stone Rubbing, The Ender Dragon)
  > MANY NESTS\
  > ONE SKY

- `nest_sealed` (Torn Page, The history of the End)
  > We sealed the hollows and built the island over them.\
  > Nobody asked what had been in them.\
  > Nobody wanted to.

- `nest_counted` (Loose Note, The Ender Dragon)
  > Counted the hollows twice\
  > and got two different numbers.

- `nest_visit` (Log Entry, The Ender Dragon)
  > The beast came down here once while we worked.\
  > It looked into every hollow in turn,\
  > then left without a sound.

- `nest_first_fire` (Stone Rubbing, The history of the End)
  > THE FIRST FIRE WAS LIT HERE\
  > NOT ON THE PILLARS

#### The quests' fragments (phase 4, fixed, found nowhere else)

Each is given by one quest, once per world, and never placed in loot.

- `stars_circle` (Star Chart, The history of the End): the Lost Observatory
  > Every star we chart is the same distance from us.\
  > Seen from the green world, they are not.\
  > What stands at the middle of the circle?

- `gateways_stitches` (Torn Page, The End gateways): the Broken Gateway
  > The gateways were never meant for walking through.\
  > The oldest map calls them stitches.\
  > Stitches hold two edges together.

- `sanctum_seen` (Inscription, The Ender Dragon): the Dragon's History, in the Sanctum
  > THE FIRST FIRE WAS NOT LIT FOR WARMTH\
  > IT WAS LIT TO BE SEEN\
  > FROM PAST THE EDGE\
  > IT WAS SEEN

#### The End Eclipse (phase 5, found only in the Eclipse Monoliths)

One in each monolith's cache, never placed anywhere else.

- `eclipse_marks` (Star Chart, The history of the End)
  > The dark one crosses the light once in a long while.\
  > We marked every night it came.\
  > The marks never repeat.

- `eclipse_growth` (Loose Note, The ancient civilization)
  > Things grow on the stone when it is dark above.\
  > By morning they are gone.\
  > We stopped trying to keep them.

- `eclipse_light` (Log Entry, The history of the End)
  > A light stood up out of the deep band last night.\
  > Nobody had built anything there.\
  > Nobody would go and look.

- `eclipse_still` (Stone Rubbing, Endermen)
  > THEY ALL STOOD STILL\
  > AND LOOKED THE SAME WAY

- `eclipse_ring` (Partial Translation, Why the End is broken apart)
  > ...when the ring of light closes, the pieces...\
  > ...[the rest is worn away]

#### The Void Citadel (phase 5, found only in its libraries)

In the libraries on the Citadel's floors, never placed anywhere else.

- `citadel_downwards` (Torn Page, The ancient civilization)
  > We built it downwards.\
  > Every floor was a promise to go deeper.\
  > Nobody remembers who asked for the bottom.

- `citadel_doors` (Log Entry, The ancient civilization)
  > The doors were never meant to keep anything out.\
  > Each one asks a question.\
  > Nobody wrote down the answers.

- `citadel_waits` (Stone Rubbing, The history of the End)
  > IT DOES NOT SLEEP\
  > IT WAITS FOR THE DARK SKY\
  > IT REMEMBERS THE SHAPE OF US

- `citadel_first_word` (Partial Translation, The ancient civilization)
  > ...the first word was carved before the first door...\
  > ...its meaning [cracked through]...

- `citadel_other_void` (Loose Note, Why the End is broken apart)
  > The void under the tower is not the same void.\
  > Drop a stone in and listen.\
  > It does not land.

- `citadel_tall_ones` (Log Entry, Endermen)
  > The tall ones never came down here.\
  > We thought it was fear.\
  > It might have been respect.

- `citadel_lamps` (Torn Page, End Cities)
  > The lamps were lit once, from below.\
  > They are still burning.\
  > Nobody has been below since.

- `citadel_chart_end` (Star Chart, The history of the End)
  > The chart ends at the tower.\
  > Past it, someone drew only a circle.
