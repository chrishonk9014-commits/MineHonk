# Version 7 - The Halloween Update

Design notes. V7 comes in five phases:

1. **Foundation** (7.0.0-phase1): the season's rules, the "Halloween content"
   world option, the Update Log's V7 and V6.5 tabs, a pumpkin for every
   dimension, ghosts at night, the Halloween title screen, and the Admin
   Panel's Halloween tab.
2. **Villages**: Trick-or-Treat Villages (with 2-4 Trick Homes each) and
   Abandoned Villages.
3. **Trick-or-treating**: the sack (128 candy), candy, costume heads, knocking
   on doors, Trick Home fights, the quest.
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

While `seasonActive` (the menu's answer), the backdrop is one of three
Halloween nights, each built on freshly generated terrain and then stamped,
taking turns every 40 s with a fade:

- `haunted_forest`: a path into a dark forest (cleared of trunks, its edge lit
  by Hallow Pumpkins), thick night fog, and Herobrine standing at its end,
  to the right of the menu;
- `pumpkin_patch`: an open field (no village near) of pumpkins, most of them
  carved and glowing, round three scarecrows;
- `ghost_marsh`: a swamp's water seen from its bank, ghosts drifting over it.

`?title=haunted_forest|pumpkin_patch|ghost_marsh` shows one (and stops the
turns). After the season the End Expansion's scenes come back. The logo turns
orange during the season, and the splashes are all Halloween ones. Phase 2's
villages can add scenes to `HALLOWEEN_SCENES`.

## Admin Panel (`a: 'halloween'`)

`op`: `status` (the state, why, the cutoff, the server's time, pumpkins grown
since the world opened), `ghost`, `place` (`pumpkin`), `place_all`,
`simulate` (`sim`). Everything it places is cheat-marked; nothing done there
counts towards advancements.

## Protocol

`PROTOCOL_VERSION` 6: `WorldInfo.halloween` (`HalloweenState`), the `ghost`
message, and the Admin Panel's `halloween` action.
