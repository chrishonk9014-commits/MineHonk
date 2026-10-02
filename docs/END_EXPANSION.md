# Version 6 - The End Expansion (Phase 1: the portal and the world)

Design notes for the first of V6's five phases: the Expansion Portal and the
Expanded End's land and atmosphere. Structures, mobs, resources, quests,
weather events and bosses come in later phases.

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

Generator 6 (`LATEST_GENERATOR` and `GENERATOR_VERSION`) is V6.

- **The approach gap depends on the version.** Only worlds created with generator 6 or later get the void gap. Older worlds keep their outer islands, generated exactly as before, everywhere outside the ring.
- **The ring itself exists in every world.** Inside the ring the Expanded End replaces whatever would have generated there, so old worlds get the portal and somewhere for it to lead. The only chunks of an old world that can change are unmodified chunks inside the ring, which nobody could reasonably have explored. Modified chunks are saved and stay as they were.
- **Regression tests guard it.** `tests/unit/v6-regression.test.ts` hashes these chunks against hashes recorded before V6 (V5.5):
  - for generators 1, 3, 5 and 6: the main island, a spread of outer island chunks out to about 3,800 blocks, and an End city;
  - for older worlds: outer-island chunks between 4,500 and 5,700 blocks.

  It also checks that generator 6 changes nothing in the Overworld, the Nether or the Farlands.
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
- its surface palette (top, under and core blocks);
- its landscape features;
- its sky tint, fog colour, fog density and ambient light;
- its ambient particles;
- its sound bed (`bed.<id>` in `src/client/audio/synth.ts`).

Phase 1 is land and atmosphere only, so no mobs spawn in these biomes yet.

| Biome | Description | Land | Palette (top / under / core) | Features | Sky | Fog | Density | Light | Particles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pale Plains | Wide, flat islands of pale end stone, scattered with tufts of pale grass. | Large, low, flat islands | pale end stone / pale end stone / end stone | pale grass, patches, boulders | `#3b3552` | `#6e6888` | 0.12 | 0.62 | pale motes, floating |
| Shattered Spires | Tall, narrow islands of dark voidstone, broken into sheer stepped cliffs and needle-like spires. | Small, very tall islands, terraced, with ridged crests | voidstone / voidstone / voidstone | voidstone spires | `#24123a` | `#3a1f52` | 0.30 | 0.42 | violet motes, rising, glowing |
| Floating Archipelago | Strings of small islands hanging in the air at many heights, their tops covered in glowing moss. | Small islands, plus two layers of floating chains broken into beads | luminous moss / end stone / end stone | pale grass | `#0f2f36` | `#1d4a50` | 0.18 | 0.46 | teal motes, rising, glowing |
| Hollow Isles | Thick islands hollowed out by wide caves, with vines hanging from the cave roofs. | Large, deep islands, a band of caves through them and sinkholes where the caves are widest | end stone / end stone / voidstone | void vines from cave roofs, voidstone boulders | `#0c1430` | `#18244a` | 0.40 | 0.30 | blue motes, falling, glowing |
| Crystal Fields | Rolling islands where clusters and spikes of glowing crystal grow from the ground. | Medium islands, rolling hills | end stone / end stone / end stone | prism crystal spikes and clusters, prism clusters | `#3a2440` | `#6a4a72` | 0.15 | 0.52 | white sparkles, floating, glowing |
| Dune Isles | Large islands of soft end sand shaped into low dunes, under a dusty sky. | Very large islands, dune relief | end sand / end sand / end stone | dune reeds, patches | `#3a2c22` | `#7a6248` | 0.50 | 0.58 | sand dust, floating |
| Mist Hollows | Low, scattered islands lost in thick white mist. | Small, low islands | pale end stone / end stone / end stone | mist blooms, pale grass | `#8a8e9c` | `#c8ccd8` | 0.85 | 0.60 | mist motes, floating |

**New blocks**, each with its own texture painted in `tools/textures/v6.ts`:

- Pale End Stone, Voidstone, Luminous Moss (light 6), End Sand and Prism Crystal (light 9);
- Pale Grass, Dune Reed, Mist Bloom, Prism Cluster and Void Vines.

**Atmosphere** (`src/client/game/EndAtmosphere.ts`):

- **Blending:** the client samples a 5 x 5 grid of biomes 12 blocks apart around the player and blends their sky tint, fog colour, fog density and ambient light, weighting nearer samples more, then eases towards the result. Crossing a border or leaving the classic End shifts the air over a few seconds.
- **Sky and fog:** the End branch of `Sky.update` and the fog distances in `WorldRenderer` read the blended values.
- **Sound and particles:** the strongest biome around the player picks the ambient sound bed (a looping synth recipe that `AudioEngine.setBed` cross-fades) and the ambient particles.
- **F3:** the debug screen shows `Expanded End: <biome name>`.

**Performance** at render distance 8:

- **Generation:** an Expanded End chunk costs about as much as an outer-islands chunk, about 4 ms against 3.5 ms in the unit benchmark. Biome lookups use a 3 x 3 site search per column, and ambient beds are rendered once, not in four variants.
- **Rendering:** `tests/perf/bench.mjs` has End scenarios (`end`, `end-outer` and `end-<biome>`) for comparing the classic End with each biome. Here is one headless run (software WebGL, so compare rows rather than absolute fps):

  | Scene | fps | JS ms per frame | Draw calls | Triangles |
  | --- | --- | --- | --- | --- |
  | End: the main island (`end`) | 7.6 | 7.3 | 246 | 75k |
  | End: outer islands (`end-outer`) | 15.8 | 3.0 | 81 | 24k |
  | Pale Plains | 13.6 | 1.7 | 20 | 36k |
  | Shattered Spires | 10.1 | 2.1 | 27 | 40k |
  | Floating Archipelago | 11.1 | 2.5 | 30 | 36k |
  | Hollow Isles | 7.3 | 2.1 | 26 | 74k |
  | Crystal Fields | 9.1 | 2.3 | 33 | 42k |
  | Dune Isles | 8.6 | 1.8 | 19 | 16k |
  | Mist Hollows | 10.5 | 2.3 | 26 | 34k |

  Main-thread time and draw calls, which carry over to real hardware, are below the classic End's in every biome. Software frame rates mostly follow how much of the screen is land rather than void.

## Advancements

Both are in the End tab, awarded by the server, and cheat-gated like everything else:

- **The Expanded End:** "Reach the Expanded End". Reaching it by portal or by gliding both count.
- **Every Corner of the End:** "Visit all seven biomes of the Expanded End".

Visits are recorded per player in their save (`endBiomes`). The following never count:

- arriving by Admin Panel teleport, until the player walks out of the arrival area;
- the arrival area of a trip through a portal opened by the Admin Panel before the dragon's defeat;
- creative mode or cheat flight.

## Admin Panel (End Expansion tab)

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

## Tests

- **`tests/unit/v6-regression.test.ts`:** the classic End is byte-identical, older worlds keep their outer islands, V6 worlds have the approach gap, and generator 6 leaves the other dimensions alone.
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
