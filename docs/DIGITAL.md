# Version 5.5 - The Digital Corruption Update

Design notes. **Spoilers**: this file describes the Herobrine story in full.

## Computers

Computers are engineering machines (`src/server/engineering/computer/`).

- `Computers.ts` is the runtime. Each engineering step it does the following:
  - Hardware: scans the twelve slots and the 3x3x3 around the case for monitors and peripherals (cached for half a second, and invalidated by block changes nearby).
  - Power and start-up: draws energy by hardware (`useOf`), runs POST, then shows HonkOS or the BIOS.
  - USB: notices a drive in the USB slot once per insertion.
  - Every second: runs automation rules and alerts, and drives monitors.
  - Windows: sends the screen to open windows as a `PcView` (a diff only).
- `programs.ts` holds every program, as a function from the computer's context to a screen made of a few block kinds:
  - headings, text, key/values, bars, buttons, lists, maps;
  - plus the commands on their buttons (`pc_cmd`).

  The client (`ComputerScreen.ts`) is one generic renderer, so programs stay server authoritative.
- `disks.ts`: a drive item carries only its disk id (and a label and usage for tooltips). Files live in `level.digital`.
  - Copies are data, never items.
  - System and story files never copy.
  - Corrupted drives can't be wiped.
- **Signals**:
  - A computer is redstone kind `pc`. It emits its output (the Engineering Control program), and lights LEDs beside it while running.
  - LEDs elsewhere behave as lamps.
- **Network**: `network_cable` is a data conduit. A BFS from a computer with a network card finds the computers (with cards) and powered server racks on it.

## The Herobrine story

`src/server/herobrine/`: `Herobrine.ts` (the story), `Malware.ts`, `Fight.ts`, `admin.ts`. The world's state is `level.herobrine`. The canon path:

1. **Mysterious Potion**. The V3 item, unchanged; witch's huts also hold the **Witch's Grimoire**.
2. **Flash Drive**.
3. **The End**.
4. **The potion is fed to the Ender Dragon.** Right click it while it's within reach (on the portal, or diving past).
   - Any other mob reacts as in V3 (the Enderman still becomes Voidbound).
   - A second bottle isn't taken.
5. **The dragon spits malware.** Until it dies, it leaks green data and every ~15-20 s coughs a slow `malware` shot near a player. The shot bursts into a 3-block cloud that lasts 45 s (and stings: 1 damage a second).
6. **A flash drive held in the malware** (either hand) for 3 s...
7. **...becomes the Corrupted Flash Drive.**
   - It holds `HER0BRINE.EXE`, `dragon.log` and `README.txt`, plus whatever the drive held before, mangled.
   - It records the dragon-kill counters at the time it was made.
   - It is never crafted and never dropped.
8. **The dragon is defeated**, in the ordinary V3 fight. `onDragonDefeated` counts the kill, and the malware dies with the dragon. A Voidbound (Farlands) kill doesn't count: that is the other story.
9. **The Overworld.**
10. **The drive in a working computer** (running; no hard drive needed). Until the dragon has died since the drive was made, it is *dormant*. Elsewhere than the Overworld there is *no world data*.
11. **The takeover**:
    - lines typed onto the screen and across the view of everyone near;
    - glitches;
    - LEDs lit;
    - the slots locked;
    - the computer protected from breaking.
12. **Herobrine comes out of the screen.**
13. **The first fight** (300 HP, +150 per extra player). Attacks:
    - blink-behind strikes;
    - bolt volleys;
    - a ground shockwave;
    - static zones;
    - a wound-up melee swing.

    It changes no blocks.
14. **At 25% he goes back into the computer.** He never dies. The drive is spent, and the screen becomes a way in (`ENTER`).
15. **Inside the computer**: dimension `computer`. It is the seed `478868574082066804`, generated with terrain version 1 and no structures, the same in every world (`gen/computer.ts`). You arrive on a hill over a still lake.
16. **Exploring.**
    - Things people swore they saw in that seed:
      - leafless trees;
      - 2x2 tunnels;
      - sand pyramids in water;
      - redstone torches nobody placed.
    - The computer showing through:
      - digital ground;
      - data blocks;
      - server towers with old terminals (logs, and a cable trace pointing to the cave);
      - broken chunks.
    - The figure across the lake in the fog, gone once you have seen him.
    - The exit terminal (LOG OUT).
17. **The cave**: a hall of servers, screens of static, giant hard drives, tesla coils and the core. Five ways lead down to it, all lit by redstone torches: the original straight 2x2 tunnel from the west, and four wider tunnels that wind up to the surface from the hall's north and south sides. You find one wherever you explore. The old terminals' cable traces point to the nearest one.
18. **The final fight** (600 HP, +300 per extra player; three phases; he plugs back into the core between them). Attacks:
    - **Electricity**: coil arcs, lightning, a current beam (cover blocks it).
    - **Hacking**:
      - PLAYER CONTROL OVERRIDE (reversed movement);
      - ACCESS DENIED (weakness);
      - CONNECTION LOST (snapped back two seconds);
      - SYSTEM BREACH (broken screen, slowness).
    - **Block manipulation**:
      - WORLD DATA CORRUPTED (holes in the floor; the pit puts you back on the floor);
      - wireframe cages;
      - falling data blocks.
    - **Forced movement**: a pull into a slam, a push blast.

    Every attack is warned for at least 24 ticks (32 with company) and resolved on the server when it lands. Changed blocks are restored (and saved until they are).
19. **Defeated for real.** The digital world collapses (CONNECTION LOST, corruption, SHUTDOWN), and everyone inside is put back in front of the computer.
20. **SECRET ENDING — HEROBRINE.**
    - It is recorded for the world and the player.
    - The computer is a computer again.
    - The computer world's `epoch` is bumped, so it is generated afresh.
    - The story can be played again with a new potion and drive.

### Rules

- Herobrine is never saved. A restart:
  - mid-takeover or mid-first-fight puts the story back to "plug the drive in";
  - mid-final-fight leaves the way in open.
- **Cheats**: a run touched by cheats plays out the same but awards nothing, and its ending is only *forced*. Cheats here include:
  - a cheat-made drive or potion;
  - a cheat-spawned dragon (`legitKills`);
  - the Admin Panel;
  - a cheat context.
- **Multiplayer**:
  - Health scales with the players who start a fight.
  - Warnings are longer with company.
  - Everyone nearby is in the party.
  - Anyone can follow through the screen while it's open.
- **The grimoire** foreshadows both doors in ink drawings (`common/digital/grimoire.ts`). It is not a walkthrough.

## Admin Panel (Digital Corruption tab)

The tab offers:

- **Give**: potion, hard drive, flash drive, corrupted drive (awake).
- **The dragon**: spawn/test the dragon, trigger malware.
- **The story**:
  - trigger the event (uses or builds a computer);
  - spawn the first Herobrine;
  - enter the computer world;
  - teleport to the seed (the first sighting) and to the cave;
  - spawn the final Herobrine.
- **Endings and resets**: force the ending, reset progression, reset the ending.

All of these are cheats: zero advancements.

## Tests

- `tests/unit/v55-herobrine.test.ts`: the whole canon path end to end, plus cheats, saves and multiplayer.
- `tests/unit/v55-computers.test.ts`: computers, drives, networks, blueprints, signals, saving.
- `tests/e2e/v55.mjs`: the browser check, with screenshots.
