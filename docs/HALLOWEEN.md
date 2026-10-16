# Version 7 - The Halloween Update

Design notes. V7 (7.0.0) is complete; it came in five phases:

1. **Foundation** (7.0.0-phase1): the season's rules, the "Halloween content"
   world option, the Update Log's V7 and V6.5 tabs, a pumpkin for every
   dimension, ghosts at night, the Halloween title screen, and the Admin
   Panel's Halloween tab.
2. **Villages** (7.0.0-phase2): Trick-or-Treat Villages (with 2-4 Trick
   Homes each), Abandoned Villages, zombie villagers and their undead
   guardians, the costume heads, the orange and purple factory lights.
3. **Trick-or-treating** (7.0.0-phase3): the Trick-or-Treat Sack (128
   candy), four candies, costumes, knocking on doors, Candy Homes' cutscene,
   Trick Home fights, the Herobrine Head, the Trick or Treat! quest.
4. **Hauntings** (7.0.0-phase4, not seasonal): the automatic haunting
   (Herobrine comes back by himself, about 45 minutes), and three more
   creepypasta characters in the Admin Panel (Null, Green Steve, the Cave
   Dweller), each with their own AI conversations.
5. **The release** (7.0.0): the Admin Panel's season tests and quest view,
   the Halloween advancements, an honest quest, a multiplayer and save
   audit (fixtures from V6.5 and every phase), performance against V6.5,
   two more title scenes, the final Update Log. See "Phase 5" below.

How seasons work, and how to add another window (a later Halloween), is in
[docs/SEASONS.md](SEASONS.md).

## The season (`src/common/halloween/season.ts`)

The dates live in one list, `HALLOWEEN_WINDOWS` (see [SEASONS.md](SEASONS.md));
today it has one window. Halloween content is on before **`HALLOWEEN_ENDS_AT` = 2026-11-07T08:00:00Z**
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

### Season tests (Admin Panel)

`HalloweenSystem.tests` (phase 5; it replaced phase 1's simulations):

- `content`: `'real'`, `'on'` (forced on) or `'off'` (forced off);
- `date`: `'real'`, `'before'` or `'after'`: a simulated date starting a
  minute before or after the cutoff (`DATE_TEST_LEAD`) and running on from
  there (`HalloweenSystem.now()`), so "just before" shows the season ending.

They are **never saved** (a new server for the world starts without them),
never change `LevelData.halloween`, and only the owner and operators of a
world with cheats can set them. `WorldInfo.halloween` carries `inSeason`,
`content` and `date`, and the state's `reason` is `'forced'` under a content
test. Anything made only because a test turned Halloween on
(`HalloweenSystem.onByTest`) is cheat-made: pumpkins grown, villages dressed,
and trick-or-treating (the knock is a cheat, its candy cheat-made).

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

### The door records

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
  used: boolean,               // Candy Home: anyone got candy here; Trick Home: beaten and looted
  got?: string[],              // phase 3, Candy Homes: uuids of the players given candy here
}
```

Every house door (cottages, houses, manors, workshops; not the chapel,
storehouse or smithy) is one. The kinds are dealt by `dealDoors` from the
seed: 2 to 4 Trick Homes (`TRICK_HOMES_MIN`, `TRICK_HOMES_MAX`), never all of
a village's doors (a village needs 3 house doors to be eligible), the rest
Candy Homes. Nothing outside tells them apart. Admin Panel villages are keyed
`"admin@x,z"`. Phase 3 looks a door up by position in the records within
220 blocks (`TrickOrTreatSystem.doorAt`), writes `got` and `used`, and calls
`VillageSystem.markDirty()`; records are read back by
`sanitizeVillageRecords` (which keeps `got`: strings only, no repeats, at most 1024).

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
- the Herobrine Head: only from beating Herobrine for real (phase 3, below).

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

## Phase 3: trick-or-treating

The same season check as everything else (`server.halloweenState().active`).
When Halloween is over, these stop: knocking, Candy Homes, Trick Homes,
candy coming from anywhere, and the sack's recipe (`SEASONAL_RECIPES`; the
recipe book hides it). These keep working: sacks and candy already owned,
eating candy, the Herobrine Head, hauntings, Abandoned Villages and the
Update Log. Nothing is ever deleted.

### The Trick-or-Treat Sack (`src/common/halloween/candy.ts`, `src/server/systems/Candy.ts`)

- `trick_or_treat_sack`: crafted from string over wool (only while Halloween
  is on). It stacks to 1 and holds `SACK_CAPACITY` = 128 candies of every
  kind together.
- The contents live in the sack's own item data, so they go wherever the sack
  goes (chests, the ground, a dead player's drops):
  `tag.data.candy = {regular, big, king, poisoned}`, plus `tag.data.cheat`
  with the same keys, counting how many of each are cheat-made. Read it only
  through `sackContents()`: malformed data is cut back and anything over 128
  is dropped.
- Only `CandySystem` changes a sack, and always against the sack as the
  server has it. Counts move between the sack and the inventory and are never
  copied:
  - **take**: only what fits in the inventory comes out; the rest stays in.
  - **eat**: eats one straight from the sack.
  - **fill**: puts every candy you carry in.
  - Clicking candy onto a sack, or a sack onto candy, works in any inventory
    window (`Containers` calls `click`).
- Honest candy is taken out first, so cheat candy stays cheat-made and
  nothing is laundered.
- Nothing can forge a sack's contents:
  - Creative mode drops a stack's data and temporary enchantment
    (`sanitizeStack`).
  - A sack put back down keeps the server's copy of its data.
  - Creative pick-block or clone gives an empty sack.
- The client: `SackPanel` (src/client/ui/SackScreen.ts) opens by using a sack.
  It only asks (C2S `sack {slot, op, kind, n}`) and redraws from whatever the
  server sends back. Tooltip: "n / 128 candy" and a line for each kind.
- **Awards** (`CandySystem.award`): the candy goes into the player's sacks
  first, then the inventory, then the ground at their feet, with "Your sack is
  full!".

### Candy

| Candy | Food | What it does |
| --- | --- | --- |
| Candy (`candy`) | 1 | One of Speed, Jump Boost or Haste, for 20 s |
| Big Candy (`big_candy`) | 2 | Two different ones of those, for 45 s |
| King-Sized Candy (`king_sized_candy`) | 4 | 50%: strong buffs for a minute (Speed II, Haste II, Jump Boost II, Regeneration). 30%: a temporary enchantment. 20%: a payout (2-4 gold ingots, or 1 diamond in 3 of 10) |
| Poisoned Candy (`poisoned_candy`) | 1 | One in three each: Poison and Blindness; Wither and Nausea; Blindness and 2 hearts lost at once. Never enough to kill from full health (`poisonWorstCase`, and a test plays each one out) |

- Candy can be eaten at any hunger (a quick snack). Effects refresh rather
  than stack (`addEffect` keeps the stronger or the longer of the two).
- Poisoned Candy looks wrong everywhere it is shown:
  - its item icon;
  - in the hand and on the ground;
  - the tooltip's colour;
  - the sack panel's row;
  - purple and yellow-brown 'witch' wisps when eaten.
- What a Candy Home gives, per candy: regular 62%, big 25%, king 5%,
  poisoned 8% (`CANDY_HOME_ODDS`). How many: 1 (40%), 2 (40%), 3 (20%), so
  1.8 on average. The unit tests check that each table adds up to 100, and
  sample the odds: 40,000 Candy Home handfuls, and 200,000 door seeds for the
  Trick Home table.

**Temporary enchantments** (`src/common/halloween/tempEnchant.ts`):

- What it is: `tag.temp = {id, lvl, until}`, with `until` in world ticks.
  There is one at a time, kept apart from `tag.ench`, and it lasts three
  minutes.
- How it is checked: `enchantLevel` counts it only while
  `tempClock() < until`. That clock is a module value: the server sets it
  from `level.time` every tick, and the client sets it from the time
  messages. So it runs out wherever the item is (a chest, the ground, an
  unloaded chunk).
- How it is cleared: the server strips expired ones from the inventories and
  open containers it touches (`stripExpiredTemp`).
- It can never become permanent:
  - nothing copies it into `ench`, and an anvil never carries over the
    sacrifice's;
  - it gives way when an enchanting table or an anvil adds a real enchantment
    it conflicts with, or the same one at least as high (`tidyTemp`);
  - anything claiming to last longer than three minutes counts as expired.
- How it is picked (`enchantSomething`): the first item that can take one
  (the main hand, the offhand, armour, then the hotbar). The enchantment is
  one it could normally have, with no conflicts and no curses, and at most
  its maximum level.

### Costumes

A costume is any `WEARABLE_BLOCKS` item (the four heads, or a carved pumpkin)
in the helmet slot. You see it from inside as a mask overlay (`Hud`), and
others see it on your head.

**The Herobrine Head** (`ONLY_WON` in heads.ts):

- It only ever drops from a real win in the Herobrine boss fight
  (`Herobrine.dropHead`), and only when at least one player in the fight was
  not in an Admin Panel context.
- If nobody picks it up, it goes to the nearest of them when the hall comes
  down.
- It is never anywhere else:
  - not in the creative menu, `/give` or the Admin Panel's give;
  - not dropped by a block placed with cheats;
  - not from a Trick Home's Herobrine;
  - and a creative player can only put back down one they picked up.
- It has no recipe (none of the heads do).

### Knocking (`src/server/systems/TrickOrTreat.ts`, rules in `src/common/halloween/trickOrTreat.ts`)

- **The prompt:** every 10 ticks the server sends each player the doors they
  could knock on within 7 blocks (S2C `knock_doors`; empty when Halloween is
  off). The client shows "Knock [G]" while you look at one within 4 blocks,
  from outside. You knock with G or by tapping the prompt (C2S
  `knock {x, y, z}`).
- **Opening a door is unchanged:** right-clicking it still just opens it.
- **The server checks** that it is a recorded Trick-or-Treat door, within
  reach, and that you are on the outside.
- **When it is not answered,** a voice behind the door says why. Each case has
  2 to 4 lines (`*_LINES`):
  - no costume;
  - no sack;
  - the sack is full;
  - you already got candy here;
  - the door is busy;
  - there is a fight inside;
  - the house was already beaten;
  - Halloween is over.
- **Lines on screen** use S2C `speech {text, who, tone}`: captions at the
  bottom, styled by tone.

### Candy Homes

- **The candy:** it is rolled and awarded the moment the door answers
  (`startCandy`), so skipping, leaving or dying cannot lose it or give it
  twice.
- **Once per player per home:** the knocker's uuid goes onto `door.got`, and
  `door.used` becomes true.
- **The cutscene** (`CANDY_TIMES`, about 6 s):
  - The camera holds a step back from the door (scene step `look`,
    letterboxed).
  - The door opens and a villager in a costume steps into the doorway. It is
    not saved, cannot be hurt, has no AI, and drops nothing. Its profession is
    random; its costume comes with the way of answering.
  - It says hello, hands over the candy and says goodbye, then shuts the
    door.
  - Four ways of answering (`CANDY_SCENES`), picked from the door's seed and
    the knocker's uuid.
- **Skipping:** Space, Esc or the Skip button sends C2S `scene_skip`. The
  server ends the scene, tells you what you got, and shuts the door.
- **Others nearby** see the door and the villager, but not the camera.
- **Residents:** the house's own villagers in the doorway, or the step inside
  it, move to the far side of the house while the door is answered
  (`clearResidents(..., 'in')`), so the costumed villager stands there
  alone.

### Trick Homes

- **Which encounter:** each Trick Home's encounter is fixed by its door's
  seed (`trickKindFor`, weights out of 100). Herobrine is 1 in 100:

| Kind | Inside | Weight |
| --- | --- | --- |
| `zombie_villagers` | 3 zombie villagers | 25 |
| `witch` | a witch and a zombie villager | 17 |
| `skeletons` | 2 skeletons | 20 |
| `undead` | zombie, skeleton, zombie villager | 21 |
| `spiders` | spider, 2 cave spiders | 16 |
| `herobrine` | Herobrine | 1 |

- **The opening** (`TRICK_TIMES`): the door creaks open and the first monster
  appears in the doorway. It grabs the knocker (scene `grab`) and walks
  backwards into the house while the camera is dragged along the floor (scene
  `drag`). Then the door slams and the rest appear deep in the house. The
  drag can be skipped (straight to the slam).
- **The house:** a flood fill of the floor behind the door (`house`): within
  7 blocks, at most 160 cells, with feet and head clear. If the house has
  been broken open, a fixed 4 x 5 box is used instead.
- **Residents:** villagers inside the house or in its doorway are moved a few
  steps behind the knocker, out of sight of the door, at the knock and every
  few ticks while it runs (`clearResidents(..., 'out')`). Villagers never
  open doors, so once it is shut they stay out.
- **The monsters** (`spawnTrickMob`):
  - They carry `data.trickHome` (the run id), `data.noDrops` (no drops, no
    XP) and `data.guard` with leash 0.
  - Each tick they are held inside the house box: one found outside is put
    back where it last stood inside.
  - They are never saved, and only target players inside the house.
- **Herobrine** here is not the boss:
  - He has 40 health, plus 20 for each extra player inside.
  - He blinks behind his target every 2.5 to 4 s and hits for 4.
  - It is driven by `herobrineTurn`, with no AI. The Fight hooks see
    `trickHome` and let him be hurt and die normally.
  - His chest is `trick_home_herobrine`: rarer loot, and never the head.
- **Getting out:** open or break the door. When nobody has been inside for 3
  s (`TRICK_EMPTY_TICKS`), or the knocker dies or leaves during the opening,
  the run ends: the monsters are removed, nothing is used up, and the house
  can be tried again. If the monsters disappear some other way (peaceful
  mode, a chunk unloading), that also ends it.
- **Winning:** beat every monster and:
  - the house goes quiet and the door opens;
  - a chest appears on the floor as far from the door as there is room;
  - its loot (`trick_home`) is rolled from the door's seed;
  - `door.used` becomes true, so this happens once per home, for everyone.
- **Multiplayer:**
  - Everyone who walks in joins the fight (`party`); the monsters target the
    nearest of them.
  - A boss bar shows how many monsters are left to everyone within 24 blocks.
  - Anyone in an Admin Panel context, or a cheat kill, makes the run cheat:
    the chest is cheat-marked, and no stats or advancements are given.
- **Advancements:**
  - `first_candy`: get candy from a Candy Home.
  - `full_sack`: fill a sack with honest candy.
  - `beat_trick_home`.
  - `herobrine_trick` (secret): beat a Trick Home's Herobrine.

### The quest: "Trick or Treat!"

- **The six steps** (`QUEST_STEPS`):
  1. Get a sack.
  2. Get a costume.
  3. Wear it.
  4. Find a Trick-or-Treat Village.
  5. Knock.
  6. Collect 10 candies from Candy Homes.
- **How steps are checked:** each step is read off the real game every 10
  ticks (`stepDone`). Steps are done in order, and once done they stay done.
- **Creative and cheats:** the quest is a guide that rewards nothing, so like
  the game's other trackers it works in any mode. A sack or costume from the
  creative menu or the Admin Panel counts. Being near the doors of any
  Trick-or-Treat Village counts as finding one (within 24 blocks, Admin Panel
  villages and teleports included). Every answered knock and every Candy Home
  candy counts, the Admin Panel's forced knock too. The advancements along
  the way still only come from honest play (`Interaction.grant`), and candy
  from cheats stays cheat-made.
- **Saved per player** in `PlayerData.halloween`: steps, knocks, candy,
  tricks and done (`sanitizeProgress`).
- **The tracker** is the V4 quest tracker. It shows only while Halloween is
  on, and gives way to any other tracker that needs the space (each system's
  `showing(p)`). When the quest is finished it says so once.

### The shared cutscene and drag (`src/server/world/drag.ts`) - for phase 4

- **The drag module:** the Haunting's grab-and-drag lair ending was pulled out
  into `drag.ts`:
  - ground queries: `openAt`, `solidGround`, `floorNear`, `dragWay`;
  - the scene steps: `sendGrab`, `sendDrag`, `sendSceneEnd`;
  - `ease`.
- **Who uses it:** the Haunting imports the ground queries from there. Trick
  Homes use all of it.
- **Each caller keeps its own timeline** and does the actual moving (the
  server teleports the player at the end; the camera only plays it).
- **The client:** `Game.playScene` / `sceneCamera` and
  `src/client/ui/HauntScene.ts`. Scene `fx` messages carry `text` (the step),
  `ticks`, `x/y/z`, `x1/y1/z1`, `strength` (now honoured on the client;
  0 = nowhere to drag) and `skip`.
- **Phase 3 added two things:**
  - the `look` step: the camera is held at a point watching another,
    letterboxed;
  - skippable scenes: a Skip button, with Space and Esc also skipping, which
    sends C2S `scene_skip`. The server decides what a skip means.
- **For phase 4:** a new cutscene sends these steps on its own timeline and
  handles `scene_skip` in its system (GameServer routes it).

### Admin Panel (`a: 'halloween'`)

New ops:

- `give_sack` and `give_full_sack` (128 candy of mixed kinds).
- `give_candy` (`candy`: a kind).
- `knock`: the nearest door, ignoring the season, the costume, the sack and
  once-each.
- `trick` (`trick`: any kind): starts that encounter at the nearest Trick
  Home.
- `reset_doors`: clears `got` and `used` on the nearest village's doors.

Everything they make is cheat-marked. A forced knock or trick never uses up a
real door, and its chest is cheat-marked. The status op also lists the
cutscenes and fights that are running.

## Phase 4: hauntings

Hauntings are not seasonal: everything here works in every world, all year.

### The shared core and the characters' parts (`src/server/herobrine/Haunting.ts`, `haunts/`)

The Haunting was split into a core and a part per character, without
changing Herobrine's: his part (`haunts/herobrine.ts`) is the old code moved
over, and his tests (`haunting.test.ts`, `haunting2.test.ts`) pass unchanged.

- **The core** (`HauntingSystem`) runs what every haunting shares: the saved
  timeline (`level.flags.haunt`, only moving while someone is there), the
  stages (`HAUNT_CAST[c].stages`, fractions of the whole), each stage's
  budget of random events per player rolled every 10 ticks, the character's
  lines and fake joins (each once), figures (untouchable, AI-less, never
  saved), every block change recorded (`level.flags.hauntBlocks`) and
  cheat-marked, monsters marked (`hauntMob`: no loot, no XP), keepInventory
  while haunted, talking back, the end (kicks, the owner-only deletion), Stop.
- **A part** (`haunts/types.ts`, `HauntPart`) says what happens: its budget,
  `event`, `oneOffs`, `atmosphere` (every 20 ticks), `everyTick`, `finale`,
  `stepFigure`/`vanish`, `appear` (the panel's test), `notice` (what players
  did), `reset('stop' | 'end')`, `holds` (a cutscene has a player),
  `silent` (not answering now) and `chatText` (Null erasing words).
- **Data** (`src/common/game/hauntCast.ts`): each character's name, chat
  speaker, mob, stages, talking-back and end moments, endings, lines, signs
  and end screens. Herobrine's comes from `haunting.ts` as before.
- **Shared helpers** (`haunts/shared.ts`): `seenByAnyone`, `soundAround`,
  `openDoor`, `steady` and `safeToTake` (a block is only taken when nothing
  rests on it, hangs off it, falls or flows in, so Stop puts back exactly
  what was there and nothing drops), and `putCell`/`undoCells` (blocks a part
  removes again itself).
- **A reload in the end** goes back to the start of the end (checked once,
  on the server's first tick), keeping the ending already decided
  (`st.final`). A cutscene is never resumed half way.

### The automatic haunting

- **Eligibility: a real win.** The client records `minehonk.herobrineBeaten`
  in localStorage when the `defeat_final_herobrine` advancement arrives
  (`src/client/hauntRecord.ts`). That advancement is only ever granted
  without cheats (`Interaction.grant` refuses in a cheat context, and the
  fight skips it for an Admin-Panel fight). Wins from before V7: once per
  start, if nothing is recorded, the IndexedDB `players` store is searched
  for this profile's uuid with that advancement (`anyPlayerHas`). The hub
  keeps no per-account progress, so nothing is stored there.
- **The roll** (`rollAutoHaunt`, `AUTO_HAUNT_CHANCE` 0.1) is made in
  `createLevelData` when `NewWorldOptions.hauntEligible` is set, with
  `crypto.getRandomValues` (`realRandom`), never the seed. It is saved as
  `level.flags.autoHaunt` (`AutoHauntRoll`: `haunted`, `after`, `played`,
  `at`, later `begun`, `over`). Worlds made before have no roll and never get
  one (`sanitizeLevelData` does not roll).
- **Multiplayer:** a browser-hosted world is created by its host's client
  (`App.createWorld`, `hostFromMenu`), so the host's eligibility counts;
  joining players never cause a roll. On a dedicated server the creating
  player's client sends `hauntEligible` with `POST /worlds`
  (`HubApi.createWorld` to `Worlds.create`) and the server rolls; it is
  self-reported, which is acceptable because all it can do is haunt that
  player's own new world.
- **The delay:** `after` is 20 to 40 minutes of play (`AUTO_HAUNT_DELAY_MIN`,
  `_MAX`), counted only while someone is in the world (`played`). A
  Minecraft day is 20 minutes: by then the first night or two have passed
  and the world has become someone's home (a shelter, a mine), which is when
  a haunting means something; it still comes within the first evening or two
  of play. A manual haunting running at that moment makes it wait.
- **The haunting** (`beginAuto`) is Herobrine's usual timeline over
  `AUTO_HAUNT_MINUTES` (45), `ending: 'random'` (the lair one time in four),
  `erase: false`, `auto: true`. `finish` never deletes when `st.auto` (even if
  `erase` were set). At the end, or when ended from the panel, `roll.over` is
  set: never again in that world.
- **Noticing** (automatic hauntings only, so the manual one is unchanged):
  `onBlock` (from `Mining.breakBlock` and `Interaction` placing) and
  `watchPlayers` (sprinting 8 s, underground 90 s, asleep, a death) call
  `HerobrineHaunt.react`. Each kind is noticed at most every 4 minutes; a
  remark (scripted, `HEROBRINE_NOTICES`, never the AI) at most once a minute
  and only from *Closer* on; before that only a sign of him (a sound behind
  you; a placed torch turned red; a figure while running; a sign by the bed).
- **The flag for phase 5:** an automatic haunting seen through to its end
  without being moved along from the panel (`st.touched` is set by skip,
  finale, finale_in and restart) adds the stat **`haunting.experienced`** to
  every player there who is not in a cheat context. Manual hauntings never
  count.

### The characters

Picked from well-known Minecraft creepypastas, each playing differently
from Herobrine and from each other (and none like the ERROR storyline).
Entity 303 was considered (USC Digital Folklore Archives, ExpertBeacon) and
left out: a hostile white-eyed figure who griefs and kills is too close to
Herobrine himself.

| Character | What it does | Sources |
| --- | --- | --- |
| **Null** (`null_entity`) | Takes things away while nobody is looking (blocks you placed, torches, clean holes, the sound, the colour); never moves while watched; erases chat words. Ending: the world erased around everyone, Connection Lost, *Disconnected: null*; everything put back. | Sportskeeda, "Minecraft myths: Null"; CyberPost, "Who is Null in Minecraft?" (Null as a glitch, the "null" signs) |
| **Green Steve** (`green_steve`) | Deceives: fake joins, a friend waving, gift houses with blue clay traps over bedrock rooms, copies wearing players' names, fake chat, creepers that only puff. Endings: the bedrock room ("Hello, brother."), or replaced. | Sportskeeda, "Minecraft myths: Green Steve"; ExpertBeacon on Green Steve; Sportskeeda's list of the most famous Minecraft creepypastas |
| **The Cave Dweller** (`cave_dweller`) | Stalks: skittering and breathing (louder underground and at night), a tall pale figure at the edge of the light that freezes when watched and runs on all fours, doors, torches, crawl holes, lunges (a shove). Ending: the hunt, then taken (dragged into its den) or dawn. | The Cave Dweller mod's pages (CurseForge, Modrinth, ModBay) and the CurseForge blog's Cave Dweller FAQ; WePC's write-up |

- **Models** (`src/client/render/entities/mobs.ts`): Null is a faceless
  black humanoid that drops a frame now and then; Green Steve is Steve gone
  green (`wave`, `stare`, `idle`); the Cave Dweller is tall, thin and pale,
  with long arms and hollow eyes (`stare`, `crawl`, `lunge`, `drag`), never
  darker than `minLight`. All three are `figure: true` mobs: no spawn eggs,
  not in the Admin Panel's spawn list, never natural, and killing one (only
  `/kill` can) leaves nothing.
- **Effects:** fx `drain` (the colour going: a CSS grayscale over the view,
  eased; with `ticks`, a pulse), `silence`/`unsilence`, the darkness, the
  new chat kinds `null`, `greensteve`, `dweller`, and the scene steps
  `erase`, `flash`, `rise`, `eyes`, `watch` (`HauntScene.ts`; the camera in
  `Game.sceneCamera`). The Cave Dweller's drag reuses the drag cutscene
  (`dragWay`, the `grab` and `drag` steps).
- **End screens:** the kick carries `screen: HauntEndScreen` (`style`,
  `title`, `reason`, `note`, `deleted`); `App.quitToTitle` shows
  `S.hauntEndScreen`. The owner-only "Delete the world" choice applies to
  every character's ending exactly as to Herobrine's.
- **What stays:** Null puts back everything it changed when it ends.
  Herobrine and Green Steve leave their marks (his houses stay, cheat-marked)
  but Green Steve's bedrock rooms are always removed (`undoCells`) and
  nobody is ever left in one; a trapped player is let out after 8 seconds.
  Stop puts back everything, for every character.

### The voices (`src/hub/herobrineVoice.ts`, `src/common/game/herobrineVoice.ts`, `hauntBrains.ts`)

- A `VoiceRequest` names a `character` (missing = Herobrine; anything not in
  `HAUNT_CHARACTERS` is refused by `parseVoiceRequest`, so the hub answers
  400). New facts: `stage`, `broken`, `placed`, `torches`, `slept`,
  `running`. Only things in the game are sent (the voice request is built in
  `HauntingSystem.voiceRequest`; a test checks its keys).
- The hub: `POST /api/voice` for every character, `POST /api/herobrine`
  kept (forced to Herobrine) for tabs opened before the update. Both share
  the per-IP limiters and **one daily cap** (`herobrine_usage`,
  `HEROBRINE_DAILY_LIMIT` 200) for all characters together. The answer is
  `{ text }` or `{ text: null, reason }` (`off`, `busy`, `limit`, `none`,
  `unsaid`).
- Each character has its own system prompt (server side only:
  `VOICE_SYSTEMS`), its own cleaning (`VOICE_STYLE`: capitals, lowercase,
  plain, whisper; a leading `/` is always stripped) and its own scripted
  brain (`BRAINS`). The model is `claude-haiku-5-5`, `effort: 'low'`.
- In the game the line goes through the chat filter again; if it would be
  masked, or no answer came within 10 seconds, the scripted brain answers.
  The line is only ever sent as chat. The Admin Panel's `talk` op returns
  `{ line, source: 'claude' | 'scripted', reason }`.

### Admin Panel (`a: 'haunt'`)

New ops and fields: `character` (start, appear, talk), `ending` (any of
the character's), `finale` (straight to the end), `finale_in` (`minutes`
until the end begins), `restart` (an automatic haunting from the
beginning, or starting a waiting one now), `appear` (the character near
you, for a few seconds), `talk` (`text`; answered asynchronously). The
status adds `character`, `auto`, `autoState` (`none`, `waiting`, `running`,
`over`) and `autoIn`. All of it runs in the admin context: nothing earns
advancements, and an automatic haunting touched from here does not count.

### Notes for phase 5

- The flag for the advancement: the per-player stat `haunting.experienced`
  (automatic hauntings seen through honestly, see above). The world's roll
  is `level.flags.autoHaunt` (`over: true` once it has happened).
- The Admin Panel's Haunting tab is in `AdminPanel.renderHaunt`: *Who* (the
  picker and blurb), *The Haunting* (start or the running controls),
  *Tests* (show it, talk to it), and on the right *Status* and *What
  happens*.
- Left for polish: the characters' figures are shown to everyone nearby
  (like Herobrine's); Green Steve's copies wear a player's name but not
  their skin; the Cave Dweller's crawl holes need natural walls nearby.

## Phase 5: the release

### The Admin Panel

- **Halloween tab**, in clear sections with a line of help each: *Halloween
  in this world* (content on or off, the world's setting, the season and its
  time left, the date the world goes by, any tests, pumpkins grown, why);
  *Season tests* (above); *Villages*; *Ghosts*; *Dimension pumpkins*; *Sacks
  and candy*; *Knocking and Trick Homes* (a test knock, every encounter, the
  doors list, resetting a village's doors); *Your Trick or Treat! quest*
  (each step, done or not and why not; `op: 'quest'`, and `quest_reset`).
- Two columns that wrap to one on narrow windows; the browser test checks
  both tabs at 800 x 600 and 1920 x 1080 for anything spilling out.
- **Every V7 action is cheat-made and counts for nothing.**
  `tests/unit/v7-release.test.ts` runs every Halloween and Haunting op (and
  checks that it ran them all, against `HALLOWEEN_OPS` and `HAUNT_OPS`), with
  two players standing in a real village, and shows that no advancement,
  quest step, stat, ending or honest flag (`haunting.experienced`, Herobrine's
  defeat) came of it.
- The Haunting tab's **talk** test waits five seconds between asks (each can
  be a call to Claude).
- **Reset doors** keeps what each door had given out (`DoorRecord.before`):
  having it again (a Candy Home's candy for the same player, a beaten Trick
  Home's fight and chest) is cheat-made. A knock with the panel's sack or
  costume is cheat-made too, and so is a sack crafted while only a test turns
  Halloween on.
- A test that turns Halloween **off** never decides a village or a chunk's
  pumpkin for good: those follow the real season (`HalloweenSystem.offByTest`).
- A haunting makes no block change it could not record: random events stop at
  4,000 changes, an ending at 12,000 (`HAUNT_MAX_CHANGES`), and the saved
  lists keep as many; a player's own edit forgets every change recorded at
  that block.

### Advancements (`src/common/data/achievements.ts`, category `halloween`)

A tab of their own. `seasonal: 'halloween'` marks those that need Halloween
content (shown with a Halloween badge; never removed, still earned in Always
on worlds after the season):

| Id | Title | How | Seasonal |
| --- | --- | --- | --- |
| `find_abandoned_village` | Ghost Town | find an Abandoned Village | no |
| `find_trick_village` | Spooky Streets (was "Trick or Treat!") | find a Trick-or-Treat Village | yes |
| `craft_sack` | Bring a Bag | craft a sack (`Interaction.onCrafted`) | yes |
| `obtain_costume` | Dressed to Scare | carry a head or a carved pumpkin | no |
| `first_candy` | Sweet! | candy from a Candy Home | yes |
| `obtain_big_candy` | Big Treat | carry Big Candy (inventory, or honest candy in a sack) | yes |
| `obtain_king_candy` | Fit for a King | carry King-Sized Candy | yes |
| `full_sack` | Sweet Tooth | fill a sack to 128 | yes |
| `trick_or_treat_quest` | Trick or Treat! | finish the quest | yes |
| `find_trick_home` | Not a Treat | knock on a Trick Home (honestly) | yes |
| `beat_trick_home` | Who Goes There? | win a Trick Home | yes |
| `herobrine_trick` | He Was Never Here (secret) | beat a Trick Home's Herobrine | yes |
| `experience_haunting` | It Came Back (secret) | see an automatic haunting through, untouched | no |

- All are granted by the server through `Interaction.grant` (never in a
  cheat context), per player, saved with the player.
- The carried ones are read off the inventory every 10 ticks
  (`TrickOrTreatSystem.checkCarried`), honest items only.
- `experience_haunting` comes with phase 4's flag (`haunting.experienced`).
  A player whose save has the flag gets it on loading.
- `trick_or_treat_quest` is also given to a player who finished the quest
  in phase 3 or 4 (when cheats still counted) and has `first_candy`, which
  only honest candy gives.

### The quest is honest

Phase 3's fix made the quest count cheats ("a guide"). Phase 5 asks that it
"can't be completed without really doing" it and that no admin action grants
a step, so:

- it moves on only outside cheat contexts;
- a sack or costume must not be cheat-made;
- the village must not be one the panel built;
- knocks and candy count only from honest knocks (`HalloweenProgress.knocks`,
  `treats`: Candy Homes that gave candy, new; and `candy`);
- the knock step is now "Knock on doors until a Candy Home treats you".

A Creative *world* still works (its own mode is normal play). When something
does not count, the tracker says why (`QuestInfo.note`): "Cheat-made sacks
do not count", "Villages built by the Admin Panel do not count", "Cheats and
the Admin Panel do not count".

### Multiplayer and modified clients

Audited for browser-hosted worlds and the dedicated server (the same
`GameServer`). Fixed:

- **Creative cloning:** a creative middle-drag cloned Herobrine Heads and
  full sacks. It now copies like Creative's clone: never a head, an empty
  sack, cheat-made under a cheat.
- **Herobrine Head:**
  - one placed without using it up (Creative) is cheat-made;
  - a real one in a cheat-marked chunk no longer breaks into nothing (only
    the block's own mark counts);
  - a creative player can no longer lose one into a slot it cannot go in;
  - an unclaimed one goes only to an honest winner.
- **Knocks:** one every half second (`KNOCK_GAP`).
- **Eating from a sack:** waits as long as eating from the hand.
- **A season test** makes trick-or-treating cheat-made.
- **Trick Home runs** always use the Overworld.
- **Wearing from a stack:** puts one head on, not the whole stack.
- **Door records** are written at once after candy or a win (a crash right
  after cannot forget them).
- **Temporary enchantments** read each world's own clock (a dedicated server
  runs several worlds in one process; loading strips only malformed ones,
  the in-tick sweep the expired ones).
- **Saves:** a player a haunting moved (a trap, an end's cutscene) is saved
  where they were taken from (`HauntPart.originOf` / `release`).
- **Haunting restores:** blocks a haunting changed in chunks that are not
  loaded are put back when those chunks load (`level.flags.hauntRestore`),
  and a player's own block is never undone.
- **AI voices:**
  - the dedicated server's voices have the hub's limits (`VoiceBudget`: 6 a
    minute and 40 an hour per world, one daily cap) and parse their
    requests;
  - the cloud hub adds a per-address daily share (`voice_address_usage`,
    hashed, `VOICE_ADDRESS_DAILY_LIMIT` 30);
  - a call is 256 tokens at most, with no retries;
  - the deploy workflow gives the API key to its deploy step only.

`tests/unit/v7-release.test.ts` ("a modified client") checks:

- knocks without a costume or sack, from afar, from inside, on a non-door,
  twice, in bursts, two players at once;
- sack messages for more than there is, a slot that is not a sack, a
  sackful eaten at once;
- creative drags and the creative menu;
- guests sending admin actions;
- a Trick Home's chest opened by two players.

### Saves (`tests/fixtures/worlds/`, `tests/unit/v7-saves.test.ts`)

Fixtures made by the real older versions with
`tools/fixtures/make-save.ts`: V6.5 (78eaa4e) and every V7 phase (1: the
setting and pumpkins; 2: generator 9, villages, heads; 3: sacks, candy, temp
enchantments, door records, quest progress; 4: the automatic roll, a haunting
by a character). Each loads (memory storage, as the browser keeps it, and the
dedicated server's file storage) with everything kept, runs, saves and loads
again; after the cutoff Seasonal ones turn off and nothing is removed. The
browser test also plays the V6.5 one from IndexedDB.

New sanitizers, on load:

- `hauntSave.ts`: the haunting state, recorded blocks and the automatic roll.
  A bogus character (even a prototype name), wrong types, out-of-range block
  states and huge lists are dropped or cut back. Before, some of these
  stopped the server's tick.
- `sanitizeVillageRecords`: capped (4096 records, 64 doors), keys checked,
  integer door ids.
- Player effects are clamped.

### Performance

Measured against V6.5 on the same machine, seed (`v7-villages`) and view
distance (6). Headless Chromium draws with SwiftShader (software WebGL), so
frame times are far above a real GPU's and noisy; JS time, draw calls and
memory carry over.

| Scene | | Frame (ms) | JS (ms) | Draw calls | Heap (MB) | Server tick (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Plain terrain by day | V6.5 | 386 | 24.3 | 415 | 303 | 17.4 |
| | V7 | 376-403 | 23.8-29.7 | 538-592 | 319-324 | 17.4-18.8 |
| Trick-or-Treat Village at night, ghosts out | V6.5 | 537 | 14.2 | 160 | 383 | 8.4 |
| | V7 | 600 | 12.9 | 173 | 386 | 10.2 |
| A Trick Home's fight | V6.5 | 537 | 13.8 | 125 | 416 | 7.7 |
| | V7 | 424-457 | 16.8-17.3 | 82-188 | 412-417 | 7.5-7.7 |

(V6.5 has no Trick-or-Treat Villages or Trick Homes: the same village by
night, and the same house with the same monsters, are measured instead.)

Found and fixed: the first ghost of a night compiled its shader on the spot,
a frame of 1.7 seconds (JS 137 ms on average over the measurement, against
13 once fixed): its material now compiles up front with the chunks'.

The haunting, simulated quickly (two players walking and building, 45
minutes of ticks), server tick time:

| Haunting | Version | Average | 99th percentile | Heap growth over it (MB) | Blocks recorded |
| --- | --- | --- | --- | --- | --- |
| None | V6.5 | 0.72 | 1.8 | 1.6 | 0 |
| | V7 | 0.76 | 2.4 | 2.9 | 0 |
| Herobrine (the Admin Panel's) | V6.5 | 1.12 | 5.7 | 2.5 | 1,080 |
| | V7 | 1.17 | 7.9 | 2.3 | 1,620 |
| Herobrine coming back by himself | V7 | 1.03 | 4.5 | 2.2 | 1,267 |
| Null | V7 | 0.78 | 2.4 | 3.3 | 749 |
| Green Steve | V7 | 0.74 | 2.4 | 3.3 | 203 |
| The Cave Dweller | V7 | 0.82 | 2.5 | 2.2 | 24 |

All well inside the 50 ms a tick may take; the heap ends within a few MB of
where it began (no leak). The longest single tick, up to about 160 ms, is
the moment an ending begins (the lair or the screen effects being set up),
once.

- `tests/perf/v7-bench.mjs`: frame time, JS time, draw calls, memory and
  server tick time, for plain terrain by day, the Trick-or-Treat Village at
  night with ghosts, and a Trick Home's fight.
- `tools/perf/haunt-bench.ts`: the server's tick time and memory over a
  whole 45-minute haunting, for each character, the automatic one and none.

Caps:

- ghosts: 8, and fewer on lower graphics (`ghostBudget`: Particles
  Decreased 4, Minimal 2; Abandoned Villages 3, 2 and 1; rarer too). Auto
  Optimize lowers Particles, so it lowers them as well;
- village decorations: fixed by the plan;
- village mobs: guardians 10, zombie villagers 8;
- AI requests: the per-minute, per-hour, per-address and daily limits;
- cutscenes: one per player;
- candy effects: refresh, never stack;
- haunting updates: events every 10 ticks, atmosphere every 20, recorded
  blocks 4,000 from its events and 12,000 at most;
- the long-haunting leak test.

## Protocol

`PROTOCOL_VERSION` 10 (phase 5; 9 was phase 4, 8 phase 3, 7 phase 2, 6 phase 1).

- **Phase 5:**
  - `HalloweenState` now has `inSeason`, `content` and `date` (it had `sim`);
  - `QuestInfo.note`;
  - the Admin Panel's `halloween` ops `test`, `quest` and `quest_reset`
    (`simulate` is gone);
  - `{ t: 'elytra', a: 'veil' }` is accepted (V6's Eclipse Veil, which the
    validator had been turning away).

- **Phase 1 and 2:** `WorldInfo.halloween` (`HalloweenState`), the `ghost`
  and `haunted_area` messages, the Admin Panel's `halloween` action, and the
  player meta `headwear`.
- **Phase 3 adds:**
  - C2S: `knock`, `sack`, `scene_skip`.
  - S2C: `speech`, `knock_doors`.
  - The scene step `look` and the `skip` flag on scene `fx`.
  - The new Admin Panel ops.
- **Phase 4 adds:**
  - The kick's `screen` (`HauntEndScreen`).
  - fx `drain`; scene steps `erase`, `flash`, `rise`, `eyes`, `watch`.
  - Chat kinds `null`, `greensteve`, `dweller`.
  - The mobs `null_entity`, `green_steve`, `cave_dweller` (so the registry
    hash changes).
  - The `haunt` action's new ops and fields, and `HauntStatus`'s new fields.
