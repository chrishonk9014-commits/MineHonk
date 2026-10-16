# Seasons: how seasonal content is switched on and off

MineHonk's first seasonal content is V7, the Halloween Update. This page is
how the season system works, and how to bring Halloween back (or add another
season) later. The Halloween features themselves are in
[docs/HALLOWEEN.md](HALLOWEEN.md).

## One check, one place

Every seasonal feature asks one shared check, and the dates live in one list:

| What | Where |
| --- | --- |
| The windows (the only place dates are written) | `HALLOWEEN_WINDOWS` in `src/common/halloween/season.ts` |
| Is it the season now? (the menu) | `seasonActive(now)` |
| Is Halloween content on in this world? | `halloweenState(now, setting, tests)`, asked through `GameServer.halloweenState()` |
| The clock everything is checked against | `src/common/halloween/clock.ts` (the hub's time when online) |

A **window** is:

```ts
{ id: 'halloween-2026', name: 'Halloween 2026', from: null, until: Date.UTC(2026, 10, 7, 8, 0, 0),
  untilText: 'November 7, 2026, 12:00 AM PST', untilDate: 'November 7, 2026' }
```

- `from`: when it starts (milliseconds since 1970, UTC); `null` means "since
  the update that brought it".
- `until`: when it ends. Content is on before this instant and off from it.
  It is one instant for everyone (the check compares UTC milliseconds, never
  a local date), so players in different time zones switch at the same moment.
- `untilText` / `untilDate`: how players read it (the world option, splashes,
  the Admin Panel, the Update Log all read these; no other code writes a
  date).

Today there is one window, Halloween 2026, ending
**2026-11-07T08:00:00Z** (November 7, 2026, 12:00 AM PST). Nothing repeats
by itself: when the last window has passed, the season is simply over, next
year included.

## What a world does with it

Each world has a **Halloween content** setting, chosen when it is made:

| Setting | In a window | Outside every window |
| --- | --- | --- |
| Seasonal (the default; every world from before V7) | on | off |
| Always on | on | on |

"Off" only stops *new* seasonal content (no knocking, no new candy or sacks,
no new pumpkins, no new dressed villages, no ghosts by themselves). Nothing is
ever deleted or taken away: worlds, blocks, items and saves all stay, and
sacks, candy and costumes keep working.

**Never seasonal:** hauntings (automatic and from the Admin Panel), Abandoned
Villages, the Update Log, and everything players already have.

The world's server decides (in multiplayer, the host or the dedicated
server) and tells every player in `WorldInfo.halloween`, so everyone in a
world always sees the same thing. Seasonal features ask only:

- on the server: `server.halloweenState().active`;
- on the client: `game.worldInfo?.halloween?.active`;
- the menu: `seasonActive(seasonClock.now())`.

Never call `Date.now()` for a seasonal decision.

## Testing it (the Admin Panel's Halloween tab)

Two tests, for the world that is open, never saved (they end when the world
closes) and never changing the world's own setting; only the world's owner
and its operators, in a world with cheats, can use them:

- **Halloween content:** Real / Force on / Force off.
- **Simulate date:** Real / Just before the cutoff / Just after the cutoff.
  The simulated date starts a minute from the cutoff and runs on, so "just
  before" shows the season ending live a minute later.

Anything made only because a test turned Halloween on (a village dressed, a
pumpkin grown, a sack crafted, candy given) is cheat-made, and counts for no
advancement. A test that turns Halloween off stops knocking, candy, the
recipe and ghosts, but what world generation decides for good (a village's
dressing, a chunk's pumpkin) still follows the real season: a test is never
saved, so it must not leave the world without what the real season gives it.
Test browsers can also pin the clock with `?clock=2026-11-07T08:01:00Z`.

## Adding a new window (for example, Halloween year 2)

1. Add a window to `HALLOWEEN_WINDOWS`, after the last one:

   ```ts
   { id: 'halloween-2027', name: 'Halloween 2027', from: Date.UTC(2027, 9, 1, 7, 0, 0), until: Date.UTC(2027, 10, 7, 8, 0, 0),
     untilText: 'November 7, 2027, 12:00 AM PST', untilDate: 'November 7, 2027' },
   ```

   Give it a real `from` (a later window must not start "since the update"),
   and write both instants in UTC. PST is UTC-8; PDT (before the first Sunday
   of November) is UTC-7.
2. That is all the code needs: every seasonal feature, Seasonal worlds, the
   menu's scenes and splashes, the Admin Panel's state and tests and the
   texts that say when it ends follow the windows. Seasonal worlds come back
   on during the new window by themselves; Always on worlds never went off.
3. Check `tests/unit/v7-halloween.test.ts` ("is one window, written in one
   place"): it expects one window today. Update the expected list and add the
   new window's edges (on one millisecond before `until`, off at it; off
   before `from`).
4. New content for the new year goes behind the same check
   (`halloweenState().active`). Content that should only exist in the new
   year can look at `seasonWindowAt(now)?.id`.

Do not add a window in advance "just in case": a window in the list is a
promise that the content turns on then.

## Adding a different season

The pattern carries over: a list of windows in its own module (its own
`seasonActive`), a world setting with a safe default for old saves, the
server's one answer sent to every player, Admin Panel tests that are never
saved, and nothing ever deleted when it ends. Keep its content reusable, as
Halloween's is: the code stays after the season so a later window can use it
again.
