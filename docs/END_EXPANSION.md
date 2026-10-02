# Version 6 - The End Expansion

Design notes for V6's first two phases:

- **Phase 1, the portal and the world:** the Expansion Portal and the
  Expanded End's land and atmosphere.
- **Phase 2, mobs and resources:** the seven biomes' final names, five new
  mobs, and the Expanded End's stone, ores, crystal, chorus wood, Ender Alloy,
  ancient and astral resources (see [Phase 2](#phase-2-mobs-and-resources)).

Later phases add the End Guardian construct, machines and Elytra upgrades,
and the Citadel's boss.

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

Generator 6 is V6 phase 1; generator 7 (`LATEST_GENERATOR` and
`GENERATOR_VERSION`) is phase 2.

- **The approach gap depends on the version.** Only worlds created with generator 6 or later get the void gap. Older worlds keep their outer islands, generated exactly as before, everywhere outside the ring.
- **The ring itself exists in every world.** Inside the ring the Expanded End replaces whatever would have generated there, so old worlds get the portal and somewhere for it to lead. The only chunks of an old world that can change are unmodified chunks inside the ring, which nobody could reasonably have explored. Modified chunks are saved and stay as they were.
- **Regression tests guard it.** `tests/unit/v6-regression.test.ts` hashes these chunks against hashes recorded before V6 (V5.5):
  - for generators 1, 3, 5, 6 and 7: the main island, a spread of outer island chunks out to about 3,800 blocks, and an End city;
  - for older worlds: outer-island chunks between 4,500 and 5,700 blocks.

  It also checks that generators 6 and 7 change nothing in the Overworld, the Nether or the Farlands.
- **Phase 2 is gated too.** Generator 7 gives each biome its own stone, ores and plants. A world made by generator 6 (phase 1) keeps generating its Expanded End exactly as before: `tests/unit/v6-resources.test.ts` checks its chunks against hashes recorded in phase 1, and that generator 7 keeps every land shape (only surfaces, ores and plants differ). Saved chunks are never edited, so phase 1 worlds get no new ores; the new mobs do live there.
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

- **`tests/unit/v6-regression.test.ts`:** the classic End is byte-identical (generators 1 to 7), older worlds keep their outer islands, V6 worlds have the approach gap, and generators 6 and 7 leave the other dimensions alone.
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
| `kill_mobs` | Removes the Expanded End's mobs within 96 blocks (no drops) |
| `mob_spawning_on` / `mob_spawning_off` | Switches their natural spawning |
| `give_set` | Gives a whole kit: each end stone variant's set, chorus wood, End Crystal, Void, Ancient, Astral, Ender Alloy, Ender Alloy tools, Ender Alloy armor, food and membranes; each item in a kit can also be given alone |
| Status | Also shows whether they spawn, and how many of each live in each biome (loaded chunks) |

### Tests (phase 2)

- **`tests/unit/v6-mobs.test.ts`:** on a real server: every telegraph lasts at least 24 ticks before its hit (32 with a second player near); the void slip always ends behind a player on safe ground after its telegraph, or with the stalker gone when nobody is left; staring sets it off; no mob walks into the void over 3,000 ticks of being driven at it; hits at an edge never throw a player off; Endlings scatter; a Chorus Beast angers at broken chorus and calms down; mites swarm out of mined clusters and burrow back; End Phantoms are stunned when hit mid-dive.
- **`tests/unit/v6-resources.test.ts`:** phase 1 hashes and land shapes; ores deterministic, only in their biomes and the band, Ender Ore never open to the air, tool tiers, Fortune and Silk Touch; every recipe, smelting, stonecutting, smithing (keeping enchantments) and the Recipe Book; the tier tables; Ender Alloy back from the void; the Void Pack on void and other deaths, and its window; natural spawning with three players (caps, biomes, rare phantoms, nothing on the main island); mobs and items through a save; a phase 1 save loading; every admin op awarding nothing; the advancements.
- **`tests/e2e/v6.mjs`** also screenshots each mob in its biome, the four ores in cut walls, a giant chorus tree, a Void Stalker's crouch and a Chorus Beast's throw arc as they wind up, and Ender Alloy armor worn by the player (on the inventory's player model, which now draws worn armor of every material, as other players' models do). `tests/e2e/v6-sites.ts` finds the ores and the tree in the test world.
