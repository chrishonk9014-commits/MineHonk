/**
 * Application shell: menu screen stack, world management and the game
 * lifecycle (start integrated server, join, save & quit).
 */
import { LorePanel, GlyphPanel } from './ui/LorePage';
import { adminScreen } from './ui/AdminPanel';
import { EngineeringBookPanel } from './ui/EngineeringBook';
import { GrimoirePanel } from './ui/Grimoire';
import { encode, decode } from '@msgpack/msgpack';
import { deflateSync, inflateSync } from 'fflate';
import type { Settings, Profile } from './settings';
import type { Input } from './input/Input';
import type { AudioEngine } from './audio/Audio';
import type { GameAssets } from './render/WorldRenderer';
import { Game, type GameHost } from './game/Game';
import { WorkerConnection, SocketConnection, type ClientConnection } from './net/ClientConnection';
import { HubApi } from './net/HubApi';
import { HubLobby } from './net/HubLobby';
import { HostSession, type HostOptions } from './net/HostSession';
import { RemoteConnection } from './net/RemoteConnection';
import { HUB_URL, compatKey } from './net/version';
import * as MP from './ui/MultiplayerScreens';
import * as ON from './ui/OnlineScreens';
import { TitlePanorama } from './render/TitlePanorama';
import type { WorldSummary as OnlineWorld } from '../common/net/multiplayer';
import { el, clear } from './ui/dom';
import * as S from './ui/Screens';
import { listWorlds, deleteWorld, updateWorld, exportWorld, importWorld } from '../server/storage/IndexedDBStorage';
import type { NewWorldOptions } from '../server/world/LevelData';
import { PROTOCOL_VERSION } from '../common/net/protocol';
import { registryHash } from '../common/registry/hash';
import { normalizeGodHearts, type GameMode } from '../common/game/gamemode';
import { randomSeedString } from '../common/math/rng';

export class App implements GameHost, S.ScreenHost {
  private readonly stack: S.Screen[] = [];
  private readonly screenLayer = el('div', { class: 'layer screens' });
  private readonly loading = S.loadingScreen();
  private readonly fpsEl = el('div', { class: 'fps-counter hidden' });
  game: Game | null = null;
  private conn: ClientConnection | null = null;
  private worldId: string | null = null;
  private progressScreen: { update: (x: never) => void; kind: 'ach' | 'stats' } | null = null;
  private quitting = false;
  // Playing online through the cloud hub
  private cloudApi: HubApi | null = null;
  private lobby: HubLobby | null = null;
  private hostSession: HostSession | null = null;
  /** Hosting settings to apply once the world being opened has started. */
  private pendingHost: HostOptions | null = null;
  /** The hosted world joined as a guest (friends see "Playing ..."). */
  private onlineWorld: string | null = null;
  private hiddenAt = 0;
  private readonly isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
    readonly assets: GameAssets,
    readonly settings: Settings,
    readonly profile: Profile,
    readonly audio: AudioEngine,
    readonly input: Input,
  ) {
    this.loading.root.classList.add('hidden');
    ui.append(this.screenLayer, this.loading.root, this.fpsEl);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', () => this.applyGuiScale());
    // Tabs can be closed or frozen at any time: save single player worlds when hidden
    const saveNow = (): void => {
      if (this.conn instanceof WorkerConnection) void this.conn.save();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNow();
    });
    window.addEventListener('pagehide', saveNow);
    // A hosted world lives in this tab: remind the host when they come back from elsewhere
    document.addEventListener('visibilitychange', () => {
      if (!this.hostSession) return;
      if (document.visibilityState === 'hidden') this.hiddenAt = Date.now();
      else if (this.hiddenAt && Date.now() - this.hiddenAt > 20_000) ON.notice(this.ui, 'Keep this tab open to keep your world online.');
    });
    document.addEventListener('visibilitychange', () => {
      // Flush the world to storage when the tab is hidden (it may be closed)
      if (document.visibilityState === 'hidden' && this.conn instanceof WorkerConnection) void this.conn.save();
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.conn instanceof WorkerConnection && !this.quitting) {
        void this.conn.save();
        e.preventDefault();
      }
    });
    // First interaction unlocks audio
    const unlock = (): void => {
      this.audio.unlock();
      this.audio.music.update('menu', true);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    canvas.addEventListener('click', () => {
      if (this.game && !this.screenOpen && !this.input.locked) this.game.resume();
    });
    setInterval(() => this.updateFps(), 500);
    this.applyGuiScale();
    this.showTitle();
  }

  get icons(): GameAssets['icons'] {
    return this.assets.icons;
  }

  // ------------------------------------------------------------------ screen stack
  get screenOpen(): boolean {
    return this.stack.length > 0;
  }

  push(s: S.Screen): void {
    const top = this.stack[this.stack.length - 1];
    if (top) top.root.classList.add('hidden');
    this.stack.push(s);
    this.screenLayer.append(s.root);
    this.input.enabled = false;
    if (this.game) this.input.unlock();
    this.updatePanorama();
  }

  // ------------------------------------------------------------------ title panorama
  private panorama: TitlePanorama | null = null;

  private updatePanorama(): void {
    const p = this.panorama;
    if (!p) return;
    const top = this.stack[this.stack.length - 1];
    const onTitle = !!top && top.root.classList.contains('title-screen');
    p.setActive(onTitle);
    if (onTitle && p.ready) top.root.classList.remove('dirt');
  }

  private stopPanorama(): void {
    this.panorama?.dispose();
    this.panorama = null;
  }

  pop(): void {
    const s = this.stack.pop();
    if (!s) return;
    s.root.remove();
    const top = this.stack[this.stack.length - 1];
    if (top) top.root.classList.remove('hidden');
    else if (this.game) {
      this.setPaused(false);
      this.game.resume();
    }
    this.updatePanorama();
  }

  private setPaused(p: boolean): void {
    if (this.conn instanceof WorkerConnection) this.conn.setPaused(p);
    if (this.game) this.game.paused = p;
  }

  replace(s: S.Screen): void {
    const old = this.stack.pop();
    old?.root.remove();
    this.push(s);
  }

  private clearStack(): void {
    for (const s of this.stack) s.root.remove();
    this.stack.length = 0;
    this.progressScreen = null;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    if (top.onKey?.(e)) {
      e.stopImmediatePropagation();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (top.escapable === false) return;
      this.uiClick();
      this.pop();
      top.onClose?.();
    } else if (this.game && e.target instanceof HTMLInputElement === false) {
      // Keep game keys from reaching the game while a menu is open
      e.stopImmediatePropagation();
    }
  };

  uiClick(): void {
    this.audio.ui('ui.click');
  }

  settingsChanged(rebuildChunks = false): void {
    this.applyGuiScale();
    document.body.classList.toggle('high-contrast', this.settings.highContrast);
    document.documentElement.style.setProperty('--chat-opacity', String(this.settings.chatOpacity));
    this.audio.applyVolumes();
    this.game?.applySettings(rebuildChunks);
  }

  private applyGuiScale(): void {
    const auto = Math.max(1, Math.min(4, Math.floor(Math.min(window.innerWidth / 320, window.innerHeight / 240))));
    const scale = this.settings.guiScale > 0 ? Math.min(this.settings.guiScale, auto) : auto;
    document.documentElement.style.setProperty('--s', `${scale}px`);
  }

  private updateFps(): void {
    const show = this.settings.showFps && !!this.game;
    this.fpsEl.classList.toggle('hidden', !show);
    if (show && this.game) this.fpsEl.textContent = `${this.game.fps} fps`;
  }

  // ------------------------------------------------------------------ menus
  showTitle(): void {
    this.clearStack();
    if (!this.game && !this.panorama && !this.settings.reduceMotion) {
      this.panorama = new TitlePanorama(this.canvas, this.assets, this.settings);
      this.panorama.onReady = () => this.updatePanorama();
      this.panorama.run();
    }
    this.push(
      S.titleScreen(
        this,
        {
          singleplayer: () => void this.showWorlds(),
          multiplayer: () => void this.openMultiplayer(),
          options: () => this.push(S.optionsScreen(this, false)),
          profile: () => this.push(S.profileScreen(this, this.profile, () => this.showTitle())),
        },
        this.profile,
      ),
    );
    this.audio.music.update('menu');
  }

  // ------------------------------------------------------------------ multiplayer
  private hub: HubApi | null = null;

  private async openMultiplayer(server = HubApi.savedServer()): Promise<void> {
    // Playing online through the cloud hub, unless the player chose a server of their own
    if (!server && HUB_URL) return this.openOnline();
    return this.openSelfHosted(server);
  }

  /** A self-hosted MineHonk server (the Node dedicated server): its own accounts and worlds. */
  private async openSelfHosted(server: string): Promise<void> {
    const api = new HubApi(server);
    this.hub = api;
    this.setLoading('Contacting server...');
    const ok = await api.health();
    this.setLoading(null);
    if (!ok) {
      this.push(
        MP.serverScreen(this, server, {
          connect: (url) => {
            HubApi.saveServer(url);
            this.pop();
            void this.openMultiplayer(url);
          },
        }),
      );
      return;
    }
    const lobby = (): void =>
      this.replace(
        MP.lobbyScreen(this, api, {
          play: (w) => this.startRemote(api, w),
          back: () => this.showTitle(),
        }),
      );
    if (await api.resume()) {
      this.push(MP.lobbyScreen(this, api, { play: (w) => this.startRemote(api, w), back: () => this.showTitle() }));
      return;
    }
    this.push(MP.signInScreen(this, api, lobby));
  }

  private startRemote(api: HubApi, world: OnlineWorld): void {
    if (!api.token) return;
    this.clearStack();
    this.audio.music.stop();
    this.setLoading(`Joining ${world.name}...`);
    const conn = new SocketConnection(api.playUrl(world.id));
    conn.send({ t: 'hello', version: PROTOCOL_VERSION, name: api.account?.name ?? this.profile.name, token: api.token, viewDistance: this.settings.renderDistance, registryHash: registryHash() });
    this.conn = conn;
    this.worldId = null;
    this.quitting = false;
    this.startGame(conn);
  }

  // ------------------------------------------------------------------ playing online (cloud hub)

  private cloud(): HubApi {
    this.cloudApi ??= new HubApi(HUB_URL);
    return this.cloudApi;
  }

  /** The lobby socket (presence, invites, signaling) while signed in. */
  private ensureLobby(): HubLobby {
    if (this.lobby) return this.lobby;
    const lobby = new HubLobby(this.cloud());
    this.lobby = lobby;
    lobby.on((m) => {
      if (m.t !== 'invite') return;
      ON.inviteToast(this.ui, `${m.fromName} invited you to ${m.worldName}${m.cheats ? ' (Cheats ON)' : ''}`, () => void this.joinOnline(m.world).catch((e) => this.showOnlineError((e as Error).message)));
    });
    return lobby;
  }

  private showOnlineError(text: string): void {
    if (this.game) this.game.chatMessage(text, 'error');
    else this.push(S.messageScreen(this, 'Multiplayer', text));
  }

  private onlineContext(): ON.OnlineContext {
    return {
      api: this.cloud(),
      isTouch: this.isTouch,
      localWorlds: () => this.loadLocalWorlds(),
      host: (worldId, options) => void this.hostFromMenu(worldId, options),
      join: (worldId) => this.joinOnline(worldId),
      serverAddress: () =>
        this.push(
          MP.serverScreen(this, HubApi.savedServer(), {
            connect: (url) => {
              HubApi.saveServer(url);
              this.pop();
              this.pop();
              void this.openMultiplayer(url);
            },
          }),
        ),
      signOut: () => {
        void this.cloud().logout();
        this.lobby?.close();
        this.lobby = null;
        this.showTitle();
      },
      back: () => this.showTitle(),
    };
  }

  /** Title > Multiplayer: sign in, then Host / Join / Friends / Public. */
  private async openOnline(tab: 'host' | 'join' | 'friends' | 'public' = 'host'): Promise<void> {
    const api = this.cloud();
    this.setLoading('Contacting MineHonk online...');
    const ok = await api.health();
    this.setLoading(null);
    if (!ok) {
      this.push(
        S.messageScreen(this, 'Multiplayer', 'MineHonk online cannot be reached right now. Check your connection and try again. (Players with their own server can use Server address... instead.)'),
      );
      return;
    }
    const open = (): void => {
      this.ensureLobby();
      this.replace(ON.onlineScreen(this, this.onlineContext(), tab));
    };
    if (await api.resume()) {
      this.ensureLobby();
      this.push(ON.onlineScreen(this, this.onlineContext(), tab));
      return;
    }
    this.push(MP.signInScreen(this, api, open, { cloud: true }));
  }

  private async loadLocalWorlds(): Promise<S.WorldSummary[]> {
    return (await listWorlds())
      .map((w) => ({
        id: String(w.id),
        name: String(w.name ?? 'World'),
        mode: (w.mode as GameMode) ?? 'survival',
        godHearts: normalizeGodHearts(w.godHearts),
        hardcore: !!w.hardcore,
        lastPlayed: Number(w.lastPlayed ?? 0),
        seed: String(w.seed ?? ''),
        icon: typeof w.icon === 'string' ? w.icon : undefined,
        cheats: !!w.cheats,
      }))
      .sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  /** Host tab: opens a single player world (or a new one) and puts it online. */
  private async hostFromMenu(worldId: string | null, options: HostOptions): Promise<void> {
    this.pendingHost = options;
    if (worldId) {
      await this.startWorld(worldId, null);
      return;
    }
    const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const mode = (options.mode as GameMode) ?? 'survival';
    await this.startWorld(id, {
      id,
      name: options.name,
      seed: randomSeedString(),
      mode,
      // (a Hardcore world is made hard, as in single player)
      difficulty: 'normal',
      godHearts: options.godHearts ?? 10,
      cheats: mode === 'hardcore' ? false : options.cheats,
      owner: this.profile.uuid,
    });
  }

  /** Puts the running single player world online (the integrated server keeps running). */
  private async beginHosting(options: HostOptions): Promise<void> {
    const conn = this.conn;
    if (!(conn instanceof WorkerConnection) || this.hostSession) return;
    const api = this.cloud();
    if (!api.account && !(await api.resume())) {
      this.game?.chatMessage('Sign in under Multiplayer to host this world online.', 'error');
      return;
    }
    try {
      const session = await HostSession.start(api, this.ensureLobby(), conn, { ...options, hubId: conn.level?.hosting?.hubId, hostUuid: this.profile.uuid });
      this.hostSession = session;
      session.onError = (m) => this.game?.chatMessage(m, 'error');
      session.onThrottled = () => {
        if (document.visibilityState === 'visible') ON.notice(this.ui, 'Keep this tab open to keep your world online.');
      };
      const code = session.details.joinCode;
      this.game?.chatMessage(`Your world is online${code ? `. Join code: ${code}` : ''}`, 'system');
      if (this.isTouch) ON.notice(this.ui, 'Hosting works best on a computer.');
    } catch (e) {
      this.game?.chatMessage(`Could not go online: ${(e as Error).message}`, 'error');
    }
  }

  /** Pause menu > Open to Multiplayer (single player, signed in or not). */
  private async openToMultiplayer(): Promise<void> {
    const api = this.cloud();
    if (this.game?.worldInfo?.mode === 'spectator') {
      this.push(S.messageScreen(this, 'Open to Multiplayer', "Spectator worlds can't be put online. Host a world in another game mode."));
      return;
    }
    if (!(await api.health())) {
      this.push(S.messageScreen(this, 'Open to Multiplayer', 'MineHonk online cannot be reached right now. Try again in a moment.'));
      return;
    }
    const level = (this.conn as WorkerConnection).level ?? {};
    const initial: HostOptions = {
      name: this.game?.worldInfo?.name ?? level.name ?? 'My World',
      visibility: 'friends',
      maxPlayers: level.hosting?.maxPlayers ?? 8,
      cheats: !!this.game?.worldInfo?.cheats,
      pvp: !!this.game?.worldInfo?.pvp,
      defaultRole: 'builder',
      mode: this.game?.worldInfo?.mode ?? 'survival',
    };
    const settings = (): void =>
      this.push(
        ON.hostSettingsScreen(this, 'Open to Multiplayer', initial, this.isTouch, 'Start Hosting', async (o) => {
          await this.beginHosting(o);
          if (this.hostSession) {
            this.clearStack();
            this.openHostingPanel();
          }
        }),
      );
    if (api.account || (await api.resume())) settings();
    else
      this.push(
        MP.signInScreen(
          this,
          api,
          () => {
            this.pop();
            settings();
          },
          { cloud: true },
        ),
      );
  }

  private openHostingPanel(): void {
    const session = this.hostSession;
    if (!session) return;
    this.push(
      ON.hostingPanelScreen(this, session, {
        players: () => this.game?.players.map((p) => ({ name: p.name, uuid: p.uuid, role: p.role })) ?? [],
        command: (line) => this.game?.send({ t: 'chat', text: line }),
        invite: () => this.push(ON.inviteScreen(this, this.cloud(), session.worldId)),
        stop: () => {
          this.stopHosting();
          this.clearStack();
          this.setPaused(false);
          this.game?.resume();
        },
        isTouch: this.isTouch,
      }),
    );
  }

  private stopHosting(reason?: string): void {
    this.hostSession?.stop(reason);
    this.hostSession = null;
  }

  /** Joins a world hosted in someone's browser (by its hub id). */
  private async joinOnline(worldId: string): Promise<void> {
    const api = this.cloud();
    const lobby = this.ensureLobby();
    // Ask first: the hub says no (offline, full, banned, another version) before anything closes
    const t = await api.ticket(worldId, compatKey());
    if (this.game) await this.quitToTitle();
    this.clearStack();
    this.audio.music.stop();
    this.setLoading(`Joining ${t.world.name}...`, `Hosted by ${t.hostName}${t.world.cheats ? ' · Cheats ON' : ''}`);
    const hello = { t: 'hello' as const, version: PROTOCOL_VERSION, name: api.account?.name ?? this.profile.name, viewDistance: this.settings.renderDistance, registryHash: registryHash() };
    const forceRelay = new URLSearchParams(location.search).has('relay');
    const conn = new RemoteConnection(api, lobby, t, hello, { forceRelay });
    // Connect first, then build the game: setting up the renderer on a slow
    // device must not hold up the connection (what arrives meanwhile is kept)
    try {
      await conn.ready;
    } catch (e) {
      this.setLoading(null);
      this.push(S.messageScreen(this, 'Multiplayer', (e as Error).message));
      return;
    }
    this.conn = conn;
    this.worldId = null;
    this.quitting = false;
    this.onlineWorld = worldId;
    lobby.send({ t: 'playing', world: worldId });
    this.startGame(conn);
  }

  private async showWorlds(): Promise<void> {
    let worlds: S.WorldSummary[] = [];
    try {
      worlds = (await listWorlds())
        .map((w) => ({
          id: String(w.id),
          name: String(w.name ?? 'World'),
          mode: (w.mode as GameMode) ?? 'survival',
          godHearts: normalizeGodHearts(w.godHearts),
          hardcore: !!w.hardcore,
          lastPlayed: Number(w.lastPlayed ?? 0),
          seed: String(w.seed ?? ''),
          icon: typeof w.icon === 'string' ? w.icon : undefined,
          cheats: !!w.cheats,
        }))
        .sort((a, b) => b.lastPlayed - a.lastPlayed);
    } catch (e) {
      this.push(S.messageScreen(this, 'Storage unavailable', `Worlds cannot be saved in this browser: ${(e as Error).message}`));
      return;
    }
    const screen = S.worldListScreen(this, worlds, {
      play: (id) => void this.startWorld(id, null),
      create: () => this.push(S.createWorldScreen(this, (o) => void this.createWorld(o))),
      remove: (id) => deleteWorld(id),
      rename: (id, name) => updateWorld(id, { name }),
      exportWorld: (id) => this.exportWorld(id),
      importWorld: (f) => this.importWorld(f),
      refresh: () => {
        this.pop();
        void this.showWorlds();
      },
    });
    this.push(screen);
  }

  private async exportWorld(id: string): Promise<void> {
    const data = await exportWorld(id);
    const bytes = deflateSync(encode({ format: 'minehonk-world', version: 1, ...data }));
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = String((data.level as { name?: string })?.name ?? 'world').replace(/[^A-Za-z0-9_-]+/g, '_');
    a.download = `${name}.mhworld`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  private async importWorld(file: File): Promise<void> {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const obj = decode(inflateSync(buf)) as { format?: string; level: unknown; chunks: [string, Uint8Array][]; players: [string, unknown][]; meta: [string, unknown][] };
      if (obj.format !== 'minehonk-world' || !obj.level || !Array.isArray(obj.chunks)) throw new Error('Not a MineHonk world file');
      const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await importWorld(id, obj);
    } catch (e) {
      this.push(S.messageScreen(this, 'Import failed', (e as Error).message));
    }
  }

  private async createWorld(o: S.CreateWorldOptions): Promise<void> {
    const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const create: NewWorldOptions = {
      id,
      name: o.name,
      seed: o.seed || randomSeedString(),
      mode: o.mode,
      difficulty: o.difficulty,
      godHearts: o.godHearts,
      cheats: o.cheats,
      bonusChest: o.bonusChest,
      generateStructures: o.generateStructures,
      owner: this.profile.uuid,
      rules: { godHunger: o.godHunger, godHazards: o.godHazards, keepInventory: o.keepInventory },
    };
    await this.startWorld(id, create);
  }

  // ------------------------------------------------------------------ game lifecycle
  private async startWorld(worldId: string, create: NewWorldOptions | null): Promise<void> {
    this.clearStack();
    this.audio.music.stop();
    this.setLoading(create ? 'Generating world...' : 'Loading world...');
    // Ask the browser not to evict saved worlds under storage pressure
    void navigator.storage?.persist?.().catch(() => false);
    const hello = { t: 'hello' as const, version: PROTOCOL_VERSION, name: this.profile.name, viewDistance: this.settings.renderDistance, registryHash: registryHash() };
    const conn = new WorkerConnection(worldId, create, { uuid: this.profile.uuid, name: this.profile.name, isHost: true }, hello);
    conn.onLog = (t) => console.log(t);
    this.conn = conn;
    this.worldId = worldId;
    this.quitting = false;
    this.startGame(conn);
  }

  private startGame(conn: ClientConnection): void {
    this.stopPanorama();
    const game = new Game(this.canvas, this.ui, this.assets, this.settings, this.input, this.audio, conn, this);
    this.game = game;
    // Screens must stay above the game's own layers
    this.ui.append(this.screenLayer, this.loading.root, this.fpsEl);
    const origOnMessage = conn.onMessage;
    conn.onMessage = (m) => {
      // Host tab: the world is up, now it goes online
      if (m.t === 'welcome' && this.pendingHost) {
        const o = this.pendingHost;
        this.pendingHost = null;
        setTimeout(() => void this.beginHosting(o), 0);
      }
      if (m.t === 'progress' && this.progressScreen) {
        if (this.progressScreen.kind === 'ach') (this.progressScreen.update as (u: Set<string>) => void)(new Set(m.achievements));
        else (this.progressScreen.update as (s: Record<string, number>) => void)(m.stats);
      }
      origOnMessage(m);
    };
    this.settingsChanged(false);
  }

  /** Saves (integrated server), tears the game down and returns to the title. */
  async quitToTitle(reason: string | null = null): Promise<void> {
    if (this.quitting) return;
    this.quitting = true;
    this.clearStack();
    const game = this.game;
    const conn = this.conn;
    const worldId = this.worldId;
    this.setLoading(conn instanceof WorkerConnection ? 'Saving world...' : 'Disconnecting...');
    // Everyone else leaves a hosted world with the host
    this.stopHosting('The host left the game');
    this.pendingHost = null;
    if (this.onlineWorld) {
      this.onlineWorld = null;
      this.lobby?.send({ t: 'playing', world: null });
    }
    let icon: string | null = null;
    if (game && !reason) icon = await Promise.race([game.requestThumbnail(64), new Promise<null>((r) => setTimeout(() => r(null), 500))]);
    game?.destroy();
    this.game = null;
    if (conn instanceof WorkerConnection) {
      await conn.stop();
      if (worldId && icon) await updateWorld(worldId, { icon }).catch(() => {});
    } else conn?.close();
    this.conn = null;
    this.worldId = null;
    this.setLoading(null);
    const gl = this.canvas.getContext('webgl2');
    gl?.clearColor(0, 0, 0, 1);
    gl?.clear(gl.COLOR_BUFFER_BIT);
    this.showTitle();
    if (reason) this.push(S.messageScreen(this, 'Disconnected', reason));
    this.quitting = false;
  }

  // ------------------------------------------------------------------ GameHost
  openPause(): void {
    if (this.screenOpen || !this.game) return;
    const local = this.conn instanceof WorkerConnection;
    if (local) {
      void (this.conn as WorkerConnection).save();
      this.setPaused(true);
    }
    this.push(
      S.pauseScreen(
        this,
        {
          resume: () => {
            if (this.stack.length) this.pop();
          },
          options: () => this.push(S.optionsScreen(this, true)),
          achievements: () => this.openAchievements(),
          stats: () => {
            const s = S.statsScreen(this, null);
            this.progressScreen = { update: s.update as (x: never) => void, kind: 'stats' };
            this.push(s);
            this.game?.send({ t: 'request_progress' });
          },
          quit: () => void this.quitToTitle(),
          admin: this.game.worldInfo?.admin
            ? () => {
                this.pop();
                this.openAdmin();
              }
            : undefined,
          cheats: this.game.worldInfo?.isOwner
            ? {
                on: !!this.game.worldInfo?.cheats,
                toggle: () => {
                  const on = !this.game?.worldInfo?.cheats;
                  void this.game?.adminRequest({ a: 'set_cheats', on }).then((r) => {
                    this.game?.chatMessage(r.text, r.ok ? 'system' : 'error');
                    if (this.stack.length) this.pop();
                  });
                },
              }
            : undefined,
          online:
            local && this.hostSession
              ? { label: 'Hosting...', open: () => this.openHostingPanel() }
              : local && HUB_URL
                ? { label: 'Open to Multiplayer', open: () => void this.openToMultiplayer() }
                : undefined,
          invite: this.hostSession
            ? () => this.push(ON.inviteScreen(this, this.cloud(), this.hostSession!.worldId))
            : local
            ? undefined
            : () => {
                const code = this.game?.worldInfo?.joinCode;
                this.push(S.messageScreen(this, 'Invite Friends', code ? `Join code: ${code}\n\nFriends can enter it under Multiplayer > Join.` : 'Only the world owner and operators can share the join code. Friends of the owner can join friends-only worlds from their world list.'));
              },
        },
        local,
      ),
    );
  }

  /** Opens the Admin Panel (cheats). The world keeps running while it is open. */
  openAdmin(): void {
    const game = this.game;
    if (!game || !game.worldInfo?.admin || this.screenOpen) return;
    this.setPaused(false);
    const screen: S.Screen = adminScreen({
      request: (a, onProgress) => game.adminRequest(a, onProgress),
      close: () => {
        if (this.stack[this.stack.length - 1] !== screen) return;
        this.pop();
        screen.onClose?.();
      },
      clientPerf: () => game.perfInfo(),
      playerName: () => game.name,
      isOwner: () => !!game.worldInfo?.isOwner,
      cheats: () => !!game.worldInfo?.cheats,
    });
    this.push(screen);
  }

  /** The Engineering Book on its own (from the item), optionally at an entry. */
  openEngineeringBook(entry?: string): void {
    const game = this.game;
    if (!game || this.screenOpen) return;
    const root = el('div', { class: 'screen dim eng-book-screen' });
    const panel = new EngineeringBookPanel({ advancedTooltips: false, close: () => this.pop() });
    panel.update(game.invSlots);
    if (entry) panel.open(entry);
    root.append(panel.root);
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.pop();
    });
    this.push({ root, onClose: () => panel.destroy() });
  }

  /** V6 phase 3: a lore book's page. */
  openLore(id: string): void {
    const game = this.game;
    if (!game || this.screenOpen) return;
    const root = el('div', { class: 'screen dim grimoire-screen' });
    const panel = new LorePanel(id, { close: () => this.pop() });
    root.append(panel.root);
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.pop();
    });
    game.audio.play('book.page', NaN, NaN, NaN, 0.6, 1, 'ui');
    this.push({ root });
  }

  /** V6 phase 3: an Ender Glyph Stone's glyphs (and nothing else). */
  showGlyphs(seed: number, face: number): void {
    const game = this.game;
    if (!game || this.screenOpen) return;
    const root = el('div', { class: 'screen dim glyph-screen' });
    const panel = new GlyphPanel(seed, face, { close: () => this.pop() });
    root.append(panel.root);
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.pop();
    });
    this.push({ root });
  }

  /** V5.5: the Witch's Grimoire, from the item. */
  openGrimoire(): void {
    const game = this.game;
    if (!game || this.screenOpen) return;
    const root = el('div', { class: 'screen dim grimoire-screen' });
    const panel = new GrimoirePanel({ close: () => this.pop(), turn: () => game.audio.play('book.page', NaN, NaN, NaN, 0.6, 0.9 + Math.random() * 0.2, 'ui') });
    root.append(panel.root);
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.pop();
    });
    const key = (e: KeyboardEvent): void => {
      if (panel.onKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    this.push({ root, onClose: () => window.removeEventListener('keydown', key) });
  }

  openAchievements(): void {
    if (!this.game) return;
    const s = S.achievementsScreen(this, null);
    this.progressScreen = { update: s.update as (x: never) => void, kind: 'ach' };
    this.push(s);
    this.game.send({ t: 'request_progress' });
  }

  openDeath(message: string, hardcore: boolean, score: number): void {
    this.clearStack();
    this.push(
      S.deathScreen(this, message, hardcore, score, {
        respawn: () => {
          this.game?.respawn();
        },
        title: () => void this.quitToTitle(),
      }),
    );
  }

  closeScreens(): void {
    this.clearStack();
    this.setPaused(false);
  }

  exit(reason: string | null): void {
    void this.quitToTitle(reason);
  }

  setLoading(text: string | null, detail?: string): void {
    this.loading.root.classList.toggle('hidden', text === null);
    if (text !== null) this.loading.set(text, detail ?? '');
    if (text !== null) clear(this.fpsEl);
  }
}
