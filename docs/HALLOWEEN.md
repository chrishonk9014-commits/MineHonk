# Version 7 - The Halloween Update

Design notes. V7 comes in five phases:

1. **Foundation** (7.0.0-phase1): the season's rules, the "Halloween content"
   world option, the Update Log's V7 and V6.5 tabs, a pumpkin for every
   dimension, ghosts at night, the Halloween title screen, and the Admin
   Panel's Halloween tab.
2. **Villages** (7.0.0-phase2): Trick-or-Treat Villages (with 2-4 Trick
   Homes each), Abandoned Villages, zombie villagers and their undead
   guardians, the costume heads, the orange and purple factory lights.
3. **Trick-or-treating**: the sack (128 candy), candy, costumes, knocking on
   doors, Trick Home fights, the quest.
4. **Hauntings**: an automatic 45-minute haunting, and three new creepypasta
   characters in the Admin Panel, each with their own AI conversations.
5. **Admin Panel controls, advancements, full tests and polish.**

## The season (`src/common/halloween/season.ts`)

Halloween content is on before **`HALLOWEEN_ENDS_AT` = 2026-11-07T08:00:00Z**
(November 7, 2026, 12:00 AM PST). It is one instant for everyone: the check
compares milliseconds since 1970, never a local date. It does not come back
by itself next year (next year gets its own update).

There are two questions, and every seasonal feature asks one of them:

| Question | Function | Used by |
| --- | --- | --- |
| The menu: is it the season? | `seasonActive(now)` | Title screen scenes, splashes and logo |
| A world: is Halloween content on here? | `halloweenState(now, setting, sim)` | Everything in a world: pumpkins and ghosts now, villages, candy and the rest later |

A world's answer depends on its **setting**, chosen at creation:

| `LevelData.halloween` | Before the cutoff | After the cutoff |
| --- | --- | --- |
| `'seasonal'` (the default; every world from before V7, which has no field) | on (`reason: 'season'`) | off (`reason: 'expired'`) |
| `'always'` | on (`reason: 'always'`) | on (`reason: 'always'`) |

Seasonal expiry **never deletes anything**. Pumpkins already placed or grown,
items and saves all stay; "off" only means no *new* seasonal content.
**Not seasonal at all**: hauntings (automatic or from the Admin Panel),
Abandoned Villages and the Update Log.

### Who decides, and the clock (`src/common/halloween/clock.ts`)

- **In a world, its server decides.** `GameServer.halloweenState()` is the one
  answer. It goes to every player in `WorldInfo.halloween` (on `welcome` and
  `world_info`); the client reads `game.worldInfo.halloween.active` and never
  works it out for itself. `HalloweenSystem` (`src/server/systems/Halloween.ts`)
  looks again every second and sends everyone a fresh `world_info` the moment
  the answer changes (the cutoff passing mid-game, a simulation). So all players
  in a world always see the same thing, whatever their own clocks say.
- **The server's clock** is `ServerOptions.clock` (`GameServer.clock`):
  - the integrated server (single player and browser hosting) uses the
    worker's `seasonClock`, which starts from the page's correction (sent in
    the worker's `start` message) and asks the hub itself;
  - a dedicated Node server uses its own clock (it is the hub).
- **The hub's time**: `GET /api/health` answers `now` (ms), on both the cloud
  hub and the Node server, and CORS exposes the `Date` header too.
  `SeasonClock.sync()` reads `now` (or the header), assuming the answer was
  made halfway through the round trip. Offline, the device clock is all there
  is.
- **The menu** uses the page's `seasonClock`; the App syncs it with the hub at
  start-up and rebuilds the title screen if the hub disagrees with the device
  about the season.
- **Tests**: test browsers (and dev builds) can pin the clock with
  `?clock=2026-11-07T08:01:00Z`; the page hands it to the worker, and the hub
  is then never asked.

### Simulations (Admin Panel)

`HalloweenSystem.sim` is `'none'`, `'expired'` (as if after the cutoff) or
`'always'` (as if the world were Always on). It is **never saved**: it ends
when the world closes. Pumpkins that grow only because of an `'always'`
simulation are cheat-marked.

## Adding a seasonal feature (phases 2-5)

- On the server: `if (server.halloweenState().active) ...`, or
  `server.halloween?.active`. Never `Date.now()`.
- On the client: `game.worldInfo?.halloween?.active`.
- In world generation: generation must stay a pure function of the seed and
  the chunk, and the generation hash tests must keep passing. The pumpkins do
  this with a **pass after generation** (below). Structures that span
  chunks (phase 2's Trick-or-Treat Villages) cannot be added that way. They
  need their own plan, decided by the seed alone and gated by the same answer
  when a chunk first generates, and they must leave unvisited chunks of worlds
  that are not Halloween untouched.

## Dimension pumpkins (`src/common/halloween/pumpkins.ts`)

One block per dimension (`DIMENSION_PUMPKINS`), each a lit (`light` 11-15),
carved `cube` with a `facing` prop that drops itself, in the new `halloween`
creative tab:

| Block | Dimension | Look |
| --- | --- | --- |
| `hallow_pumpkin` | `overworld` | the classic orange jack o'lantern |
| `ember_pumpkin` | `nether` | charred, cracked with lava light, a flickering fiery face |
| `ender_pumpkin` | `end` (the main End and the Expanded End) | pale violet, many glowing eyes |
| `glitched_pumpkin` | `farlands` | missing-texture patches, a face that tears (animated) |
| `data_pumpkin` | `computer` | a circuit rind, a face on a screen with a scanline (animated) |

Textures are painted in `tools/textures/v7.ts` (`npm run gen:assets`).

**Scattering.** `Dimension.processGeneration` calls
`HalloweenSystem.decorate(dim, chunk)` on every newly generated chunk, before
it is lit and sent. While Halloween is on, `decoratePumpkins` may add one
pumpkin:

- whether a chunk gets one, where, and which way it faces are a pure function
  of the world's seed, the dimension and the chunk (`pumpkinSpot`);
- chance per chunk (`PUMPKIN_CHUNK_CHANCE`): about 1 in 20 in the Overworld and
  the computer world (where trees, water and plants turn many columns down),
  1 in 24 in the Nether, the End and the Farlands, whose land fills more of
  each chunk;
- only on natural ground (`PUMPKIN_GROUND`) with open air above, never inside
  or on a structure (`generator.structureAt`); in the Nether, on cavern floors
  between the lava sea and the roof;
- only ever **into air**: nothing else in the chunk changes.

The generator itself is untouched, so the regression hash tests
(`v3-regression`, `v4-regression`, `v6-regression`) are unaffected, and
`v7-halloween.test.ts` checks that every difference between a plain and a
decorated chunk is one pumpkin placed into air. A chunk that gets a pumpkin is
then **modified**, so it is saved: unmodified chunks are regenerated from the
seed on every load, and without that, a pumpkin would vanish once the season
was over. `/regen` and the Admin Panel's chunk regeneration apply the same
pass.

## Ghosts (`src/client/render/Ghosts.ts`)

Purely atmospheric and client-side: one instanced draw (like the redstone
torch glow), a blocky sheet ghost drawn on a 16x16 pixel grid in the
fragment shader. They are not entities: nothing can hit, follow or notice
them, and they touch no block.

- They come by themselves only when `FrameState.halloween` is set (the world's
  answer) under a night sky (daylight below 0.3) in the Overworld or the
  Farlands, outside (not in caves or water): the first 20-50 s into the
  night, then one every 55-140 s, never two at once.
- Each drifts across the view for 9-14 s, low over the land or high in the
  air, and fades in and out. One fades out at once if the camera comes within
  7 blocks.
- Reduce Motion: slower, longer fades, no bobbing and no rippling hem.
- The Admin Panel's "Show a ghost now" sends `{ t: 'ghost' }` to the player
  who asked; the title scenes keep a few in view (`ambient`).

## The title screen (`src/client/render/TitlePanorama.ts`)

While `seasonActive` (the menu's answer), the backdrop is one of five
Halloween nights, each built on freshly generated terrain, taking turns every
40 s with a fade:

- `haunted_forest`: a path into a dark forest (cleared of trunks, its edge lit
  by Hallow Pumpkins), thick night fog, and Herobrine standing at its end,
  to the right of the menu;
- `pumpkin_patch`: an open field (no village near) of pumpkins, most of them
  carved and glowing, round three scarecrows;
- `ghost_marsh`: a swamp's water seen from its bank, ghosts drifting over it;
- `trick_village` (phase 2): circling the plaza of a Trick-or-Treat Village
  in open country (plains, savanna, desert or cherry grove), lit by its
  pumpkins and lights;
- `abandoned_village` (phase 2): circling an Abandoned Village's ruins,
  ghosts drifting over them.

The two villages come from a generator with `villages.force` (every village
that variant), the nearest one in open country. `?title=` with any of the five
shows one (and stops the turns). After the season the End Expansion's scenes
come back. The logo turns orange during the season, and the splashes are all
Halloween ones.

## Admin Panel (`a: 'halloween'`)

`op`: `status` (the state, why, the cutoff, the server's time, pumpkins grown
since the world opened), `ghost`, `place` (`pumpkin`), `place_all`,
`simulate` (`sim`). Everything it places is cheat-marked; nothing done there
counts towards advancements.

## Phase 2: villages (generator 9)

World generator **9** (`LATEST_GENERATOR`, `GENERATOR_VERSION`) is V7's.
Worlds keep the generator they were made with, so only worlds made in V7 or
later have the new villages; older worlds' villages never change.
`src/common/gen/v9/village.ts` (`VILLAGE_V9`) plans every village exactly as
V4 does (`planVillage` in `src/common/gen/v4/village.ts`, which now also
fills an optional `VillageLog` of what went where: logging draws no random
numbers), at the same place with the same bounds. So a **normal** village is
the V4 village block for block, and so is the layout of both variants. Rules
and numbers are in `src/common/halloween/villages.ts`.

### Which village is which (`villageVariant`)

A pure function of the world seed and the village's start chunk (no planning
needed, so searches skip other villages cheaply):

| Variant | Share | Seasonal |
| --- | --- | --- |
| Abandoned | 1 in 40 villages (`ABANDONED_ONE_IN`); Minecraft's zombie villages are about 1 in 50 | no |
| Trick-or-Treat eligible | 2 in 3 of the rest (`TRICK_IN` / `TRICK_OUT_OF`) | yes |
| normal | the rest | - |

Measured over many seeds, a village starts in about **1 region in 15**
(regions are 28 x 28 chunks, 448 x 448 blocks): villages are about 1.7 km
apart. So an Abandoned Village is about one in 600 regions, roughly one per
120 km²: most worlds have only a handful within 10,000 blocks of spawn
(extremely rare, as asked). Trick-or-Treat Villages are about two thirds of
the villages a player finds during the season: the season is a few weeks, and
villages are spread out, so making them rarer would leave most players
without one. Ordinary villages remain, so they still feel like an event.

### Trick-or-Treat Villages: decided once, recorded, never half dressed

- The dressing (Hallow Pumpkins and a skull on a fence post by every house
  door, orange and purple factory lights along the top of the front walls,
  jack o'lanterns on the lamp posts and plaza lamps, scarecrows and pumpkins
  in the fields, pumpkins on the stalls and watchtowers, a pile by the bell,
  a few cobwebs) is a set of extra pieces with the **same boxes** as the
  village's own, so its bounds, and every other structure's placement, stay
  as they were.
- Each dressing piece asks `PlanContext.villages.trick(start)`
  (`GeneratorOptions.villages`, the server's `VillageSystem.hooks`). The
  server decides **the first time it is asked about a village**, which is when
  any of its chunks is first built: dressed if Halloween is on in the world
  right then (`server.halloweenState()`, the Phase 1 check), ordinary if not.
  The answer is saved in `LevelData.villages` under the village's key (its
  start chunk, `"cx,cz"`), so every later chunk agrees: a village explored
  across the cutoff is dressed all through, and one first explored after the
  cutoff is ordinary for good. Unmodified chunks are regenerated from the
  seed on load: with the record they come out the same. A new record is
  written to the save within ten seconds, not only at the next autosave.
- Without a server (tests, the title screen) nothing is dressed unless
  `villages.force` says so.
- Only an Admin Panel simulation made it Halloween: the record is `cheat`.

### The door records (for phase 3)

`LevelData.villages["cx,cz"]` is a `VillageRecord`:

```ts
{
  kind: 'trick' | 'normal' | 'abandoned', // 'abandoned': Admin Panel ones only
  decidedAt: number,                     // server time (ms) it was decided
  x, y, z,                               // the village's centre (the plaza)
  style: string,                         // plains, desert, savanna, taiga, snowy, jungle, swamp, cherry
  doors: DoorRecord[],                   // Trick-or-Treat Villages only
  cheat?: true,                          // Admin Panel (or simulation): counts for nothing
  area?: GuardArea,                      // Admin Panel Abandoned Villages: the haunted area
}
DoorRecord = {
  id: number,                  // 0.. in plan order
  x, y, z,                     // the door's lower block
  facing: 'north' | 'south' | 'west' | 'east', // the way the door looks out
  out: [x, y, z],              // the block straight in front of it (where a knocker stands)
  design: 'cottage' | 'house' | 'manor' | 'workshop',
  kind: 'candy' | 'trick',
  seed: number,                // for whatever happens at this door
  used: boolean,               // knocked on and given out (false until phase 3)
}
```

Every house door (cottages, houses, manors, workshops; not the chapel,
storehouse or smithy) is one. The kinds are dealt by `dealDoors` from the
seed: 2 to 4 Trick Homes (`TRICK_HOMES_MIN`, `TRICK_HOMES_MAX`), never all of
a village's doors (a village needs 3 house doors to be eligible), the rest
Candy Homes. Nothing outside tells them apart. Admin Panel villages are keyed
`"admin@x,z"`. Phase 3 should look a door up by position in the nearest
record (`VillageSystem.record(key)`, `doorsNear`), set `used`, and leave the
format as it is (records are read back by `sanitizeVillageRecords`).

### Abandoned Villages

- `type: 'abandoned_village'` (so `structureAt` and discovery tell them
  apart); the same plan, built through a **ruin view** (`RuinView`) that
  decides block by block, from the seed and the position only: each building
  falls in on a side picked by the seed (its walls broken down towards it,
  nearly to the floor at the far edge), its roof holed, gone where the walls
  fell, or gone entirely (3 in 10); broken windows, doors hanging open or
  gone, broken fences and gates, no beds; no torches or lanterns (a few soul
  lanterns burn), campfires out, the smithy's lava gone to magma; mossy and
  cracked stone, holes in walls, overgrown roads and plaza. Then overgrowth:
  rubble where it fell, moss carpets, cobwebs (thickest in the corners), vines
  on what still stands.
- Loot: houses `chest/abandoned_village`, the smithy
  `chest/abandoned_village_smithy`, and the finest house (manor, chapel,
  house...) holds one `chest/abandoned_village_treasure`.
- People: villagers become `zombie_villager` (at most 8, keeping their
  profession's robe), the golem, cat and animals are gone, and 5 to 10
  guardians stand on the plaza and the roads (zombies and skeletons; husks
  in the desert, strays in the snow). All of them carry `data.guard`, the
  village's bounds (`GuardArea`).
- Ghosts: `VillageSystem` sends `{ t: 'haunted_area', area }` to a player
  within 16 blocks of one (and `area: null` on leaving); the client's
  `Ghosts.village` keeps up to three drifting over it, day and night.
- At night more undead spawn there (`STRUCTURE_SPAWNS.abandoned_village`):
  ordinary ones, that burn and despawn.

### Guardians (`data.guard`)

- **No burning**: `Mob` skips sunlight burning for any mob with `data.guard`,
  and their brains get no `FleeSunGoal`.
- **Boundary**: `GuardAreaGoal` (priority 0) walks a mob back to the nearest
  point 3 blocks inside the area when it is outside it, or more than
  `GUARD_LEASH` (6) blocks out while chasing. `WanderGoal` never picks a spot
  outside. They never take or keep a target more than `GUARD_TARGET_LEASH`
  (10) blocks outside (`guardAllows`, also in `HurtByTargetGoal`). One stuck
  outside for a minute with no player within 32 blocks is put back at its post
  (`data.home`, where it first stood): no teleporting while anyone watches.
- **Persistent**: spawned with the chunk (`persistent: true`), saved with it,
  never despawned. Mobs stay in the chunk they are saved in, and far from
  players they do nothing, so a chunk unload never lets one out.
- **Capped**: the number is fixed when the village generates (at most 10
  guardians and 8 zombie villagers); nothing respawns them.
- They never hurt each other (a stray arrow starts no feud).
- Multiplayer: all of it is server-side; every player sees the same.

### Costume heads (`src/common/halloween/heads.ts`)

`skeleton_skull`, `zombie_head`, `creeper_head`, `herobrine_head`: `custom`
model blocks (an 8 x 8 x 8 box, a whole texture on each face, facing the
placer), `place: 'needs_solid_below'`, drop themselves, in the Halloween
creative tab. **No recipes.** How they are obtained:

- skeleton skulls, zombie and creeper heads: on fence posts beside half the
  house doors of Trick-or-Treat Villages (45% / 35% / 20%), and now and then
  in Abandoned Villages' chests and treasure;
- the Herobrine Head: nowhere yet (creative and the Admin Panel): phase 3 can
  hand it out.

`WEARABLE_BLOCKS` (the heads and a carved pumpkin) go in the helmet slot
(`Containers.armorOk`, shift-click) or on the head when used in the air
(`Interaction.handleUse`); `ServerPlayer.meta().headwear` tells every client,
which draws the block over the player's head (`headwear.ts`, also on the
inventory doll). A worn head halves how far its own kind notices the wearer
(`disguised` in `goals.ts`: zombie head for zombies, husks, drowned and zombie
villagers; skull for skeletons and strays; creeper head for creepers).

### Admin Panel and Teleport tab

`a: 'halloween'` adds `op`: `spawn_trick_village`, `spawn_abandoned_village`
(planned around the player on the live ground, in any world and any season,
Overworld only, built chunk by chunk as they load: chunks cheat-marked, mobs
`admin`, records `cheat`), `village_doors` (the nearest Trick-or-Treat
Village, built or one that would be dressed now, with every door) and
`door_tp` (`door`: to the front of one). The generator's structure list has
`trick_village` and `abandoned_village` for the Teleport tab
(`OverworldGenerator.villageSteps`).

### Discovery

Walking into a Trick-or-Treat Village (dressed, not cheat-made) or an
Abandoned Village shows its name as a title with the discovery sting (once a
player a village), and grants **Trick or Treat!** (`find_trick_village`) or
**Ghost Town** (`find_abandoned_village`); never in an Admin Panel context.

## Protocol

`PROTOCOL_VERSION` 7 (phase 2; 6 was phase 1): `WorldInfo.halloween`
(`HalloweenState`), the `ghost` and `haunted_area` messages, the Admin Panel's
`halloween` action, and the player meta `headwear`.
