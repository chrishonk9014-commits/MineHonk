# MineHonk

A multiplayer voxel survival sandbox that runs in the browser. Every block
texture, model, sound and line of code is original. The world is infinite and
deterministic. The server is authoritative. There are four dimensions: the
Overworld, the Nether, the End and the Farlands.

## Quick start

```bash
npm install
npm run dev            # game at http://localhost:5173 (single player works immediately)
```

Single player runs an integrated server in a Web Worker and saves worlds in
IndexedDB. Worlds can be exported to and imported from `.mhworld` files.

### Multiplayer server

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

## Development

```bash
npm run typecheck      # TypeScript
npm test               # unit and integration tests (vitest)
npm run test:e2e       # browser smoke test against the production build
npm run test:e2e:mp    # two-browser multiplayer test against a real hub
npm run gen:assets     # regenerate textures, atlases and the pixel font
```

End-to-end tests use the production build (`npx vite build`). The multiplayer
test also needs `npm run build:server`.

### Architecture

```
src/common    shared, deterministic code: registries (blocks, items, biomes, mobs,
              recipes, loot, potions), world generation for all four dimensions,
              physics, protocol and validation
src/server    authoritative GameServer: dimensions and chunk streaming, lighting,
              mining and building, containers, survival, mobs and AI, combat,
              explosions, portals, the End and dragon fight, the Farlands,
              workstations, commands, moderation and roles
src/worker    single player integrated server (Web Worker + IndexedDB)
src/server-node  dedicated hub: accounts, friends, world registry, hosting, file
              storage, HTTP API and the WebSocket game transport
src/client    three.js renderer, meshing worker, UI, audio synthesis, input
tools         procedural asset generation (textures, font) and debug maps
tests         unit, integration and end-to-end tests
```

The client only sends intentions (move, dig, use, click, chat). The server
validates everything: reach, line of sight, break timing, inventory
ownership, crafting, damage, XP, drops and rewards. It corrects the client
when they disagree.

### Security notes

- Passwords are hashed with scrypt. Session tokens are random, sent as
  bearer headers and stored only as hashes. Repeated failed logins lock the
  account for a few minutes.
- The in-game name always comes from the account and never from the client.
  Join codes are only visible to owners and operators.
- Sign-in, join codes and the API are rate limited. Game sockets have packet
  flood and payload size limits.
- The server sets CSP and other security headers, and blocks path traversal
  when serving files.
- Cheat and debug commands require operator status and a world with cheats
  enabled. The developer handle (`window.minehonk`) only exists in
  development builds and automated test browsers.
