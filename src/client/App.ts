/**
 * Application shell: menu screen stack, world management and the game
 * lifecycle (start integrated server, join, save & quit).
 */
import { encode, decode } from '@msgpack/msgpack';
import { deflateSync, inflateSync } from 'fflate';
import type { Settings, Profile } from './settings';
import type { Input } from './input/Input';
import type { AudioEngine } from './audio/Audio';
import type { GameAssets } from './render/WorldRenderer';
import { Game, type GameHost } from './game/Game';
import { WorkerConnection, type ClientConnection } from './net/ClientConnection';
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
    this.push(
      S.titleScreen(
        this,
        {
          singleplayer: () => void this.showWorlds(),
          multiplayer: () => this.push(S.messageScreen(this, 'Multiplayer', 'Connecting to MineHonk servers is available when this page is served by a MineHonk server (npm run server).')),
          options: () => this.push(S.optionsScreen(this, false)),
          profile: () => this.push(S.profileScreen(this, this.profile, () => this.showTitle())),
        },
        this.profile,
      ),
    );
    this.audio.music.update('menu');
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
    const hello = { t: 'hello' as const, version: PROTOCOL_VERSION, name: this.profile.name, viewDistance: this.settings.renderDistance, registryHash: registryHash() };
    const conn = new WorkerConnection(worldId, create, { uuid: this.profile.uuid, name: this.profile.name, isHost: true }, hello);
    conn.onLog = (t) => console.log(t);
    this.conn = conn;
    this.worldId = worldId;
    this.quitting = false;
    this.startGame(conn);
  }

  private startGame(conn: ClientConnection): void {
    const game = new Game(this.canvas, this.ui, this.assets, this.settings, this.input, this.audio, conn, this);
    this.game = game;
    // Screens must stay above the game's own layers
    this.ui.append(this.screenLayer, this.loading.root, this.fpsEl);
    const origOnMessage = conn.onMessage;
    conn.onMessage = (m) => {
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
        },
        local,
      ),
    );
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
