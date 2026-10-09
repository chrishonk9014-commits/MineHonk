# MineHonk multiplayer

Two ways to play together:

- **Online from the website** (the default). A player hosts a world in their own
  browser tab; friends join from theirs. A free cloud hub on Cloudflare handles
  accounts, friends, join codes, the public list and connecting players. Nobody
  installs anything.
- **Self-hosting** (advanced). The Node dedicated server in `src/server-node`
  runs worlds on a machine you control. It works exactly as before; see the
  README's *Self-hosting (advanced)*.

Both use the same game protocol, the same authoritative `GameServer`, the same
roles, bans, allowlists and Admin Panel rules, and the same account, friends
and world-registry logic (`src/hub`, shared by the two hubs).

Setting the hub up (once, on websites only): [ONLINE_SETUP.md](ONLINE_SETUP.md).

---

## Architecture

```
 host's browser tab                         Cloudflare (free plan)                     joiner's browser tab
 ┌──────────────────────────┐              ┌───────────────────────────────┐            ┌──────────────────────┐
 │ page: HostSession        │── HTTPS ────▶│ Worker  hub/src/index.ts      │◀── HTTPS ──│ page: RemoteConnection│
 │   (signaling, peers,     │              │   accounts, friends, worlds,  │            │   (WebRTC or relay)   │
 │    relay socket)         │◀─ WebSocket ─│   codes, tickets, ICE servers │─ WebSocket▶│                       │
 │ Web Worker: GameServer   │              │ D1  hub/migrations/*.sql      │            │ Game (renderer, UI)   │
 │   + BrowserHost          │              │ DO  LobbyDO  (presence,       │            └──────────────────────┘
 │   (src/worker/hosting.ts)│              │      signaling, invites)      │                       ▲
 │ IndexedDB: the world     │              │ DO  RelayDO  (one per world)  │                       │
 └──────────────────────────┘              └───────────────────────────────┘                       │
            ▲   WebRTC data channel (direct, or through Cloudflare TURN)  ─────────────────────────┘
            └── or the hub relay (RelayDO) when a direct connection is not possible or not allowed
```

- **The world runs in the host's browser.** The single player integrated
  server (a Web Worker running `GameServer`) simply accepts more connections.
  The host plays over the local connection; every joiner is another
  `Connection` on the same server, speaking the same protocol as a dedicated
  server. The world and every player's data (inventory, position, stats) are
  saved in the host's IndexedDB, so a player who comes back finds everything
  where they left it.
- **Opening a world adds data, never changes it.** The level gets a `hosting`
  record (its hub id and player limit) and, if it had none, an owner. Single
  player, offline play and `.mhworld` export/import are untouched.
- **The hub** is a Cloudflare Worker with a D1 database (accounts, sessions,
  friends, requests, blocks, the world registry and members, the ticket
  signing key) and two Durable Objects:
  - `LobbyDO`: one instance; every signed-in player keeps a hibernating
    WebSocket to it. It knows who is online, which worlds are hosted (and by
    which tab), forwards WebRTC signaling between a joiner and that world's
    host only, and delivers invitations and settings changes.
  - `RelayDO`: one per world, a dumb pipe between the host and joiners who
    cannot (or may not) connect directly.
- **Shared logic** (`src/hub`): `AccountsCore`, `FriendsCore`, `WorldsCore`
  and `RateLimiter` sit behind a storage interface (`HubStore`). The Node hub
  uses JSON files (`src/server-node/HubFileStore.ts`, the same files as
  before); the cloud hub uses SQL (`src/hub/sqlStore.ts`, D1). Both hubs answer
  the same JSON API, so the client's `HubApi` works with either.

## Joining, step by step

1. The joiner asks the hub for a **join ticket** (`POST /api/ticket`). The hub
   checks the registry: banned, private, the host's presence and version, and
   whether the world is full. Errors are plain words: *Code not found*, *The
   host is offline*, *World is full*, *You're banned from this world*,
   *Version mismatch — refresh the page*.
2. The ticket is signed by the hub (ECDSA P-256) over
   `{uuid, name, world, exp, via, relay}`, valid for 2 minutes. `via` says
   why the player may join (owner, member, friend, public, code).
3. The joiner offers a WebRTC connection through the lobby. The host checks
   the ticket with the hub's public key **before** creating a peer connection.
4. If the data channel does not open within 12 seconds of the offer (30 at
   most, for slow devices), or the network blocks WebRTC, the joiner connects
   to the world's relay instead, presenting the ticket.
5. The first message on either transport is `{t:'join', ticket, hello}`. The
   host verifies the ticket again (signature, world, expiry), checks the game
   version, then applies the world's own rules (bans, private worlds, roles,
   the player limit) exactly as the dedicated server does. The player's name
   and id come from the ticket, never from the client.

From then on it is the ordinary game protocol: msgpack batches (one per
tick), cut into pieces of at most 16 KiB for data channels and relay frames
(`src/common/net/hubProtocol.ts`).

## The host is authoritative

Joiners send intentions; the host's `GameServer` validates everything (reach,
line of sight, break timing, inventories, crafting, combat) as on a dedicated
server. The hub never sees game traffic except as opaque relay frames.

- **Roles**: owner, operator, builder, visitor (`WorldRole`). The owner is the
  host's account. New joiners get the world's default role (builders, or
  visitors who can only look around).
- **Cheats**: *Allow Cheats* is the owner's choice when hosting and can be
  toggled at any time from the hosting panel. With cheats on, the owner and
  operators get the Admin Panel (F8) and cheat commands; builders and visitors
  never do, whatever their client sends (`validateAdmin`, `AdminService`,
  command levels). Admin actions are announced in chat (*[Admin] Name used:
  give diamond ×64*) unless the owner turns that off. Cheat-gating of
  advancements is unchanged.
- **Operators**: the owner uses the hosting panel's player list (*Make Op*,
  *Remove Op*, *Kick*, *Ban*) or `/op` and `/deop`. The Tab list shows each
  player's role.
- **Bans and the allowlist** live in the world (the host's save) and are
  mirrored to the hub so it can refuse tickets early. Code joins and
  invitations put players on the allowlist.

## Presence and leaving

- The host's lobby socket is its heartbeat. Closing the tab takes the world
  offline at once: the hub's list drops it, the relay closes every joiner with
  *The host left the game*, and direct joiners see their data channel close
  with the same message.
- The tick runs in the Worker, so a background tab keeps the world going;
  browsers may still slow it down, so the host sees *Keep this tab open to
  keep your world online* if that happens.
- Phones can join. Hosting from a phone works but shows *Hosting works best
  on a computer*.

## Privacy

- **Public worlds are relay-only.** A stranger who joins from the public list
  gets a ticket with `relay: true`: their browser and the host's both use
  `iceTransportPolicy: 'relay'` (TURN only) or, without TURN, the hub relay. Neither
  ever sees the other's IP address.
- Friends, invited players and players with the join code may connect
  directly (peer-to-peer, after STUN), which is faster.
- ICE servers: Cloudflare's public STUN, plus Cloudflare TURN with short-lived
  credentials minted by the hub (4 hours) when the TURN key is configured.
- Passwords never leave the device in a form that can be replayed elsewhere:
  the browser stretches them (PBKDF2-SHA256, 600,000 rounds, salted with the
  user name) and the hub stores a salted PBKDF2 of that. There is no email and
  no reset: players are warned to remember their password.

## Hub API

All JSON over HTTPS under `/api`; signed-in calls send `Authorization: Bearer
<session token>`. CORS allows only `ALLOWED_ORIGINS` (the GitHub Pages site).

| Call | Purpose |
| --- | --- |
| `GET /health` | `{ok, kind: 'cloud', auth: 'stretched-v1'}` (the Node hub answers without `kind`) |
| `GET /hub-key` | public key for verifying join tickets (JWK, ES256) |
| `POST /register`, `POST /login`, `POST /logout`, `GET /me` | accounts and sessions |
| `GET /friends` | friends (online, playing which world, JOIN if allowed, Cheats ON), requests, blocked |
| `POST /friends/request · accept · decline · remove · block · unblock` | friends |
| `GET /worlds` | your worlds, friends' online worlds, online public worlds |
| `POST /host` | register or update the world you host (from the host's own settings) |
| `POST /join` | redeem a join code (returns the world's summary) |
| `POST /ticket` | a signed join ticket and ICE servers for a world |
| `POST /ice` | ICE servers for the host |
| `POST /invite` | invite a friend: allowlist them and send an invitation toast |
| `GET · PATCH · DELETE /worlds/:id`, `POST /worlds/:id/code · role · ban` | world settings (owner and operators) |
| `WS /lobby` | presence, signaling, invitations (session in the `auth.<token>` subprotocol) |
| `WS /relay/:world` | the relay (host: `auth.<token>`; joiners: `ticket.<ticket>`) |

Relay frames are `[u8 type][u32 conn][u32 length][bytes]` records (data, open,
close); the host multiplexes every relayed joiner over one socket, packing
each moment's traffic into as few frames as possible (at most 256 KiB each).

## Moderation and limits

- The chat filter, reports, kick, ban and roles all work as on the dedicated
  server (they are the same code).
- Rate limits (per IP or per account, per minute): sign-in 10, join codes 20,
  friend requests 20, tickets 30, sockets 30, other API calls 240, lobby
  messages 240 per player.
- At most 16 players per world (default 8); the host's tab accepts at most 32
  connections in flight.

## Free plan limits

The hub is built for Cloudflare's free Workers plan:

| Resource | Free allowance | What uses it |
| --- | --- | --- |
| Worker requests | 100,000 a day | API calls (sign-in, lists, tickets) |
| Durable Object requests | 100,000 a day; incoming WebSocket messages count 1 per 20 | lobby messages, relay frames |
| Durable Object duration | 13,000 GB-s a day | relay rooms while busy (lobby sockets hibernate) |
| D1 | 5 million rows read, 100,000 written a day, 5 GB | accounts, friends, registry |
| TURN (optional) | 1,000 GB a month | direct connections through strict networks |
| STUN | free, unlimited | direct connections |

Accounts, friends and lists cost almost nothing. The scarce resource is the
**relay**: a relayed player sends and receives a few dozen frames a second, so
the free plan covers roughly 10–15 relayed player-hours a day (see the
measurements below). Most players connect directly and never touch it; public
worlds use TURN first when the TURN key is set, which is why the setup guide
suggests it. If a daily limit is reached, the hub pauses until the next day
(nothing is charged).

## Bandwidth

Measured by `tests/e2e/online.mjs` (section `bandwidth`): a host and four
players walking around in survival for a minute, render distance 4.

BANDWIDTH_TABLE

The host's upload grows with the number of players and how much the world
changes around them (new chunks are the largest part). Hosting eight players
needs roughly twice the four-player figure.

## Tests

- `tests/unit/hub-core.test.ts`: accounts, friends and worlds on **both**
  stores (JSON files and SQL).
- `tests/unit/hub-worker.test.ts`: the real Worker under Wrangler (workerd,
  D1, Durable Objects): API shapes, tickets, lobby, relay.
- `tests/unit/browser-host.test.ts`: who gets into a browser-hosted world:
  forged and expired tickets, versions, bans, private worlds, a full world, and
  the Admin Panel's rules.
- `tests/e2e/online.mjs`: up to five browsers against a local hub: hosting,
  joining by code, building, chat, fighting, cheats and operators, coming
  back, the host leaving, friends (JOIN, private, invitations), the public list
  over the relay only, the relay fallback, a phone, security, Open to
  Multiplayer, and the bandwidth figures above.
