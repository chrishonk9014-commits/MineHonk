/**
 * In-game controller. Owns the client world mirror, local player
 * prediction, renderer, HUD and screens, and translates server messages
 * into client state. The server stays authoritative for everything; the
 * client only predicts movement, mining progress and placements.
 */
import { CAVE_BIOMES } from '../../common/gen/caves/caveBiomes';
import type { ClientConnection } from '../net/ClientConnection';
import type { C2S, S2C, PlayerStats, WorldInfo, AbilitiesMsg, WindowKind } from '../../common/net/protocol';
import { ClientWorld } from '../world/ClientWorld';
import { LocalPlayer } from './LocalPlayer';
import { BlockInteraction } from './BlockInteraction';
import { ClientEntity } from './ClientEntity';
import { WorldRenderer, type GameAssets, type FrameState } from '../render/WorldRenderer';
import { Hud } from '../ui/Hud';
import { Chat } from '../ui/Chat';
import { InventoryScreen, type WindowState } from '../ui/InventoryScreen';
import { SignEditor, PlayerList } from '../ui/Overlays';
import type { Input } from '../input/Input';
import type { Settings } from '../settings';
import type { AudioEngine } from '../audio/Audio';
import { MusicPlayer, discTitle } from '../audio/Audio';
import type { Slot, ItemStack } from '../../common/game/itemstack';
import type { GameMode } from '../../common/game/gamemode';
import type { DimensionId } from '../../common/data/biomes';
import { items, itemById } from '../../common/registry/items';
import { blocks, blockOf, getProp, STATE_BLOCK, STATE_FLUID, STATE_SOLID } from '../../common/registry/blocks';
import { lookDirection, rayBox } from './look';
import { entityInfo } from '../../common/data/entities';
import { raycastBlocks } from '../../common/physics/raycast';
import { newBody } from '../../common/physics/movement';
import { el } from '../ui/dom';
import { attachPlayerPreview } from '../render/PlayerPreview';
import { chunkIndex } from '../../common/world/constants';
import { enchantLevel } from '../../common/game/enchanting';
import type { AdminAction } from '../../common/game/admin';
import type { AdminReply } from '../ui/AdminPanel';
import { keyName } from '../ui/Screens';
import { Navigator, type Instrument } from '../ui/Navigator';
import * as THREE from 'three';
import { GlitchHud } from '../ui/GlitchHud';
import { DigitalHud } from '../ui/DigitalHud';
import { TouchControls } from '../ui/TouchControls';
import { EndingCard } from '../ui/EndingCard';
import { guideEntry } from '../../common/engineering/guide';
import { EndAtmosphere } from './EndAtmosphere';

export interface GameHost {
  openPause(): void;
  openAdmin(): void;
  openDeath(message: string, hardcore: boolean, score: number): void;
  closeScreens(): void;
  exit(reason: string | null): void;
  setLoading(text: string | null, detail?: string): void;
  openAchievements(): void;
  openEngineeringBook(entry?: string): void;
  /** V5.5: the Witch's Grimoire. */
  openGrimoire(): void;
  /** V6 phase 3: a lore book's page; an Ender Glyph Stone's glyphs. */
  openLore(id: string): void;
  showGlyphs(seed: number, face: number): void;
  readonly screenOpen: boolean;
}

const HOTBAR0 = 36;
const OFFHAND = 45;
const HELMET = 5;

/** Maps block ids to the item that places them (for pick block). */
let pickMap: Map<string, number> | null = null;
function pickItemFor(state: number): number {
  if (!pickMap) {
    pickMap = new Map();
    for (const it of items) {
      if (it.def.block && !pickMap.has(it.def.block)) pickMap.set(it.def.block, it.num);
      if (it.def.wallBlock && !pickMap.has(it.def.wallBlock)) pickMap.set(it.def.wallBlock, it.num);
    }
  }
  const b = blocks[STATE_BLOCK[state]!]!;
  return pickMap.get(b.id) ?? itemById.get(b.id)?.num ?? 0;
}

export class Game {
  readonly world = new ClientWorld();
  readonly player: LocalPlayer;
  readonly interaction: BlockInteraction;
  readonly renderer: WorldRenderer;
  readonly hud = new Hud();
  /** Compass needles and the clock dial for held instruments. */
  private readonly navigator = new Navigator();
  /** Dark vignette with a round view while looking through a spyglass. */
  private readonly scopeOverlay = el('div', { class: 'spyglass-overlay hidden' });
  /** Frost creeping in from the edges while freezing, and white-out when buried in powder snow. */
  private readonly frostOverlay = el('div', { class: 'frost-overlay' });
  private readonly powderOverlay = el('div', { class: 'powder-overlay hidden' });
  private scoping = false;
  private scopeZoom = 1;
  /** World spawn (compasses) and the last death (Recovery Compass). */
  private worldSpawn: [number, number, number] = [0, 64, 0];
  private deathPos: { dim: DimensionId; x: number; y: number; z: number } | null = null;
  readonly chat = new Chat();
  readonly entities = new Map<number, ClientEntity>();
  readonly root = el('div', { class: 'layer' });
  /** Glitch effects on the interface and the ending cards (V3). */
  private readonly glitchHud: GlitchHud;
  /** V5.5: Herobrine's words and the computer world's screen effects. */
  private readonly digitalHud: DigitalHud;
  /** V5.5: movement reversed until this tick (PLAYER CONTROL OVERRIDE). */
  private reverseControlsUntil = 0;
  /** On-screen controls for phones and tablets. */
  private readonly touch: TouchControls;
  private readonly touchClose = el('div', { class: 'touch-close hidden' }, 'X');
  private readonly endingCard: EndingCard;
  private readonly playerList = new PlayerList();

  // Server-provided state
  worldInfo: WorldInfo | null = null;
  stats: PlayerStats = { health: 20, maxHealth: 20, absorption: 0, food: 20, saturation: 5, xp: 0, level: 0, xpProgress: 0, air: 300, maxAir: 300, armor: 0, effects: [] };
  invSlots: Slot[] = new Array(46).fill(null);
  cursor: Slot = null;
  selected = 0;
  time = 0;
  dayTime = 1000;
  rain = 0;
  thunder = 0;
  dayCycle = true;
  dimension: DimensionId = 'overworld';
  players: { name: string; uuid: string; ping: number; mode: GameMode }[] = [];
  private readonly otherDigs = new Map<number, { x: number; y: number; z: number; stage: number }>();
  private readonly blockEntities = new Map<string, Record<string, unknown>>();

  // Client state
  private screen: InventoryScreen | null = null;
  private window: WindowState | null = null;
  private sign: SignEditor | null = null;
  private running = true;
  private joined = false;
  private loadingTerrain = true;
  private loadingSince = performance.now();
  private acc = 0;
  private last = performance.now();
  private tickNo = 0;
  private frames = 0;
  fps = 0;
  /** Single player pause (server stopped ticking). */
  paused = false;
  private thumbRequests: { size: number; resolve: (url: string | null) => void }[] = [];
  private fpsTime = performance.now();
  private debug = false;
  private thirdPerson: 0 | 1 | 2 = 0;
  private hudHidden = false;
  private flash = 0;
  /** Account or profile name used for this player's look. */
  private playerName: string | null = null;
  /** Portal swirl strength 0..1 while standing in a portal, and its colour. */
  private portalFx = 0;
  private portalKind: 'nether_portal' | 'far_portal' | 'expansion_portal' | null = null;
  private hurtTilt = 0;
  private shake = 0;
  private eyeCur = 1.62;
  /** Interpolation factor of the frame being drawn. */
  private lastAlpha = 1;
  private eyePrev = 1.62;
  private stepDist = 0;
  private caveMood = 0;
  private usingItem = false;
  private wasSneak = false;
  /** Item number -> client tick until which it can't be used (knocked-aside shield...). */
  private readonly cooldowns = new Map<number, { until: number; total: number }>();
  private useRepeat = 0;
  private lastSwingSent = 0;
  private entityTarget: ClientEntity | null = null;
  private attackCooldown = 0;
  private pingTime = 0;
  ping = 0;
  private screenshotPending = false;
  private rafId = 0;
  private prevHealth = -1;
  private debugData: Record<string, unknown> = {};
  private adminReq = 1;
  private readonly adminWaiters = new Map<number, { done: (r: AdminReply) => void; progress?: (r: AdminReply) => void }>();
  private lastDebugUpdate = 0;
  private musicTimer = 0;
  /** Cave biome the server says we are in (0 = none) and how far the view has blended into it. */
  caveBiome = 0;
  private caveBlend = 0;
  /** V6: the Expanded End's blended sky, fog and ambience around the player. */
  readonly endAtmos = new EndAtmosphere();

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
    readonly assets: GameAssets,
    readonly settings: Settings,
    readonly input: Input,
    readonly audio: AudioEngine,
    readonly conn: ClientConnection,
    readonly host: GameHost,
  ) {
    this.player = new LocalPlayer(this.world);
    this.player.vehiclePos = () => {
      const v = this.player.vehicle;
      const e = v ? this.entities.get(v.id) : undefined;
      return e ? [e.x, e.y, e.z] : null;
    };
    // Elytra in the chest slot that isn't worn down to its last point
    this.player.sneakSpeed = () => {
      const legs = this.invSlots[HELMET + 2];
      const lvl = legs?.tag?.ench?.silent_stride ?? 0;
      return Math.min(1, 0.3 + 0.15 * lvl);
    };
    this.player.powderWalk = () => items[this.invSlots[HELMET + 3]?.id ?? -1]?.id === 'leather_boots';
    this.player.canGlide = () => {
      const c = this.invSlots[HELMET + 1];
      if (!c) return false;
      const it = items[c.id];
      return it?.id === 'elytra' && (c.damage ?? 0) < (it.def.durability ?? 1) - 1;
    };
    this.renderer = new WorldRenderer(canvas, this.world, assets, settings);
    this.interaction = new BlockInteraction(this.world, this.player, (m) => this.send(m), {
      hitParticles: (s, x, y, z, f) => this.settings.particles !== 'minimal' && this.renderer.particles.digHit(s, x, y, z, f),
      breakFx: (s, x, y, z) => {
        const def = blocks[STATE_BLOCK[s]!]!.def;
        this.audio.play('break.' + def.sound, x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
        if (this.settings.particles !== 'minimal') this.renderer.particles.blockBreak(s, x, y, z, this.settings.particles === 'decreased' ? 12 : 32);
      },
      sound: (n, x, y, z, v, p) => this.audio.play(n, x, y, z, v, p),
      swing: () => this.swing(),
    });
    this.root.append(this.scopeOverlay, this.frostOverlay, this.powderOverlay, this.hud.root, this.chat.root, this.chat.input, this.playerList.root);
    this.hud.root.append(this.navigator.root);
    this.touch = new TouchControls(this.input, {
      selectSlot: (i) => this.selectSlot(i),
      hotbarRect: () => this.hud.hotbarRect(),
      targetingEntity: () => !!this.entityTarget,
    });
    this.root.append(this.touch.root, this.touchClose);
    this.touchClose.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (this.chat.open) this.chat.close();
        else if (this.screen) this.closeWindow(true);
      },
      { passive: false },
    );
    this.glitchHud = new GlitchHud(this.root, settings);
    this.digitalHud = new DigitalHud(this.root, settings);
    this.endingCard = new EndingCard(this.root, settings);
    ui.append(this.root);
    this.chat.onSend = (text) => this.send({ t: 'chat', text });
    this.chat.onClose = () => {
      this.input.enabled = !this.screen && !this.sign && !this.host.screenOpen;
      if (this.input.enabled) this.input.lock();
    };
    this.audio.onSubtitle = (t) => this.hud.subtitle(t);
    conn.onMessage = (m) => this.onMessage(m);
    conn.onClose = (reason) => {
      if (this.running) this.host.exit(reason);
    };
    this.input.onKeyDown = (e) => this.onKeyDown(e);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    this.host.setLoading('Joining world...');
    this.rafId = requestAnimationFrame(this.frame);
  }

  send(m: C2S): void {
    this.conn.send(m);
  }

  // ------------------------------------------------------------------ helpers
  get gamemode(): GameMode {
    return this.player.gamemode;
  }

  get survivalHud(): boolean {
    const g = this.player.gamemode;
    return g === 'survival' || g === 'hardcore' || g === 'god' || g === 'adventure';
  }

  held(hand: 0 | 1 = 0): ItemStack | null {
    return (hand === 0 ? this.invSlots[HOTBAR0 + this.selected] : this.invSlots[OFFHAND]) ?? null;
  }

  /** V6: worn armor materials, head to feet ('' for an empty slot or Elytra), for the inventory doll. */
  private wornArmor(): string[] {
    return [0, 1, 2, 3].map((i) => {
      const a = items[this.invSlots[HELMET + i]?.id ?? -1]?.def.armor;
      return a && a.material !== 'elytra' ? a.material : '';
    });
  }

  /**
   * How dark the view is: blindness is total; the Darkness effect (Warden,
   * shriekers) pulses between dim and nearly black. The pulsing strength is
   * an accessibility setting; with Reduce Motion it holds steady.
   */
  private darknessAmount(): number {
    if (this.effectLevel('blindness') > 0) return 1;
    if (this.effectLevel('darkness') <= 0) return 0;
    const k = Math.max(0, Math.min(1, this.settings.darknessPulse ?? 1));
    if (this.settings.reduceMotion || k === 0) return 0.45;
    const t = performance.now() / 1000;
    const pulse = Math.pow((Math.sin(t * 1.6) + 1) / 2, 2);
    return 0.4 + 0.52 * k * pulse;
  }

  private effectLevel(id: string): number {
    const e = this.stats.effects.find((x) => x.id === id);
    return e ? e.amp + 1 : 0;
  }

  private swing(): void {
    this.renderer.hand.triggerSwing();
    if (this.tickNo - this.lastSwingSent >= 4) {
      this.lastSwingSent = this.tickNo;
      this.send({ t: 'swing' });
    }
  }

  /** Pointer lock was lost without the game asking for it (Esc in the browser). */
  private readonly onPointerLock = (): void => {
    if (!this.running || document.pointerLockElement) return;
    if (!this.joined || this.screen || this.sign || this.chat.open || this.host.screenOpen || this.player.dead) return;
    this.host.openPause();
  };

  /** Called by the host when all of its screens are closed. */
  resume(): void {
    this.input.enabled = !this.screen && !this.sign && !this.chat.open;
    if (this.input.enabled) this.input.lock();
  }

  get uiBlocking(): boolean {
    return !!this.screen || !!this.sign || this.chat.open || this.host.screenOpen;
  }

  // ------------------------------------------------------------------ keyboard shortcuts that work outside the action queue
  private onKeyDown(e: KeyboardEvent): boolean {
    if (!this.running) return false;
    if (this.chat.open || this.sign) return true;
    if (this.screen) {
      const typing = e.target instanceof HTMLInputElement;
      if (e.code === 'Escape' || (!typing && e.code === this.settings.keys.inventory)) {
        e.preventDefault();
        this.closeWindow(true);
      }
      return true;
    }
    if (this.host.screenOpen) return false;
    return false;
  }

  // ------------------------------------------------------------------ screens
  private openWindow(win: WindowState): void {
    this.closeScreenLocal();
    const creative = this.player.gamemode === 'creative';
    this.window = win;
    this.screen = new InventoryScreen(win, this.cursor, (m) => this.send(m), {
      creative,
      playerSlots: () => this.invSlots,
      onClose: () => this.closeWindow(true),
      advancedTooltips: this.debug,
      attachPreview: (host: HTMLElement) => attachPlayerPreview(host, this.playerName, () => this.wornArmor()),
    });
    this.root.append(this.screen.root);
    this.input.enabled = false;
    this.input.unlock();
    this.hud.setCrosshair(false);
  }

  private openInventory(): void {
    const creative = this.player.gamemode === 'creative';
    this.openWindow({ id: 0, kind: creative ? 'creative' : 'player', title: creative ? 'Creative Inventory' : 'Crafting', size: 0, slots: this.invSlots, props: {} });
    this.audio.ui('ui.click');
  }

  private closeScreenLocal(): void {
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
    this.window = null;
    this.hud.setCrosshair(true);
  }

  /** Closes the open container window and tells the server. */
  closeWindow(notify: boolean): void {
    const w = this.window;
    this.closeScreenLocal();
    if (notify && w) this.send({ t: 'close_window', window: w.id });
    this.resume();
  }

  private openSign(x: number, y: number, z: number): void {
    this.closeScreenLocal();
    const be = this.blockEntities.get(`${x},${y},${z}`);
    this.sign = new SignEditor((be?.lines as string[] | undefined) ?? ['', '', '', ''], (lines) => {
      this.send({ t: 'sign_text', x, y, z, lines });
      this.sign?.destroy();
      this.sign = null;
      this.resume();
    });
    this.root.append(this.sign.root);
    this.input.enabled = false;
    this.input.unlock();
  }

  // ------------------------------------------------------------------ network
  private onMessage(m: S2C): void {
    switch (m.t) {
      case 'welcome': {
        this.joined = true;
        this.playerName = m.name;
        this.renderer.hand.setSkin(m.name);
        this.player.entityId = m.entityId;
        this.player.gamemode = m.gamemode;
        this.setAbilities(m.abilities);
        this.player.flying = m.abilities.flying;
        this.worldInfo = m.world;
        this.updateCheatsIndicator();
        this.setDimension(m.dimension);
        this.player.setPos(m.x, m.y, m.z);
        this.player.yaw = m.yaw;
        this.player.pitch = m.pitch;
        this.time = m.time;
        this.dayTime = m.dayTime;
        this.worldSpawn = m.spawn;
        this.loadingTerrain = true;
        this.loadingSince = performance.now();
        this.host.setLoading('Loading terrain...');
        break;
      }
      case 'kick':
        this.running = false;
        this.host.exit(m.reason);
        break;
      case 'chunk':
        this.world.loadChunk(m.data);
        break;
      case 'unload_chunk':
        this.world.unloadChunk(m.cx, m.cz);
        break;
      case 'block':
        this.world.setBlock(m.x, m.y, m.z, m.state);
        break;
      case 'blocks': {
        // list = [packed (y << 8 | lz << 4 | lx), state, ...]
        for (let i = 0; i + 1 < m.list.length; i += 2) {
          const p = m.list[i]!;
          this.world.setBlock(m.cx * 16 + (p & 15), p >> 8, m.cz * 16 + ((p >> 4) & 15), m.list[i + 1]!);
        }
        break;
      }
      case 'light':
        this.world.setLightSection(m.cx, m.cz, m.sy, m.data);
        break;
      case 'block_entity': {
        const k = `${m.x},${m.y},${m.z}`;
        if (m.data) this.blockEntities.set(k, m.data);
        else this.blockEntities.delete(k);
        // Keep the chunk copy current too (beacon beams and sign text read it)
        this.world.getChunk(m.x >> 4, m.z >> 4)?.setBlockEntity(m.x & 15, m.y, m.z & 15, (m.data as { type: string } | null) ?? undefined);
        break;
      }
      case 'spawn': {
        const s = m.e;
        if (s.id === this.player.entityId) break;
        this.removeEntity(s.id);
        const e = new ClientEntity(s.id, s.type, s.x, s.y, s.z, s.yaw, s.pitch, s.meta);
        if (s.vx !== undefined) {
          e.vx = s.vx;
          e.vy = s.vy ?? 0;
          e.vz = s.vz ?? 0;
        }
        this.entities.set(s.id, e);
        this.renderer.entities.add(e);
        break;
      }
      case 'despawn':
        for (const id of m.ids) this.removeEntity(id);
        break;
      case 'moves': {
        const l = m.list;
        const steered = this.player.vehicle?.control ? this.player.vehicle.id : -1;
        for (let i = 0; i + 6 < l.length; i += 7) {
          if (l[i] === steered) continue;
          const e = this.entities.get(l[i]!);
          if (e) e.setTarget(l[i + 1]!, l[i + 2]!, l[i + 3]!, l[i + 4]!, l[i + 5]!, l[i + 6]!);
        }
        break;
      }
      case 'velocity':
        if (m.id === this.player.entityId) {
          this.player.body.vx = m.vx;
          this.player.body.vy = m.vy;
          this.player.body.vz = m.vz;
        } else {
          const e = this.entities.get(m.id);
          if (e) {
            e.vx = m.vx;
            e.vy = m.vy;
            e.vz = m.vz;
          }
        }
        break;
      case 'meta': {
        const e = this.entities.get(m.id);
        if (!e) break;
        const visualChange = (['item', 'name', 'count', 'state', 'variant', 'color', 'sheared', 'charged', 'saddle', 'held', 'tame', 'profession', 'size'] as const).some((k) => JSON.stringify(e.meta[k]) !== JSON.stringify(m.meta[k]));
        e.meta = m.meta;
        if (visualChange) this.renderer.entities.refresh(e);
        break;
      }
      case 'anim':
        this.onAnim(m.id, m.anim);
        break;
      case 'equipment': {
        const e = this.entities.get(m.id);
        if (e) e.meta.equipment = m.slots;
        break;
      }
      case 'stats':
        this.onStats(m.s);
        break;
      case 'inventory':
        if (m.window === 0) {
          this.invSlots = m.slots;
          if (this.window && this.window.id === 0) {
            if (m.cursor !== null || this.player.gamemode !== 'creative') this.cursor = m.cursor;
            this.window.slots = this.invSlots;
            this.screen?.setState(this.window, this.cursor);
          } else if (this.screen) this.screen.refresh();
        } else if (this.window && this.window.id === m.window) {
          this.window.slots = m.slots;
          this.cursor = m.cursor;
          this.screen?.setState(this.window, this.cursor);
        }
        this.renderer.hand.setItem(this.held()?.id ?? 0);
        break;
      case 'slot':
        if (m.window === 0) {
          this.invSlots[m.slot] = m.item;
          this.screen?.refresh();
        } else if (this.window && this.window.id === m.window) {
          this.window.slots[m.slot] = m.item;
          this.screen?.setState(this.window, this.cursor);
        }
        break;
      case 'cursor':
        this.cursor = m.item;
        if (this.window) this.screen?.setState(this.window, this.cursor);
        break;
      case 'hotbar':
        this.selected = Math.max(0, Math.min(8, m.slot));
        break;
      case 'open_window': {
        const d = m.data ?? {};
        if (m.window === -1 && Array.isArray(d.sign)) {
          const [x, y, z] = d.sign as number[];
          this.openSign(x!, y!, z!);
          break;
        }
        this.openWindow({ id: m.window, kind: m.kind as WindowKind, title: m.title, size: m.size, slots: [], props: { ...d } });
        break;
      }
      case 'close_window':
        if (this.window && this.window.id === m.window) {
          this.closeScreenLocal();
          this.resume();
        }
        break;
      case 'window_prop':
        if (this.window && this.window.id === m.window) {
          const props = (m.prop === 'furnace' || m.prop === 'all') && m.value && typeof m.value === 'object' ? (m.value as Record<string, unknown>) : { [m.prop]: m.value };
          // A computer's screen is sent whole each time (fields it no longer shows must go)
          if (this.window.kind === 'computer' && m.prop === 'all') this.window.props = { ...props };
          else Object.assign(this.window.props, props);
          this.screen?.setProps(this.window.props);
        }
        break;
      case 'time':
        this.time = m.time;
        this.dayTime = m.dayTime;
        this.rain = m.rain;
        this.thunder = m.thunder;
        this.dayCycle = m.dayCycle;
        break;
      case 'chat':
        this.chat.add(m.text, m.kind, m.from);
        break;
      case 'sound':
        this.audio.play(m.name, m.x, m.y, m.z, m.volume, m.pitch);
        break;
      case 'particles':
        if (this.settings.particles === 'minimal' && m.kind !== 'explosion') break;
        this.renderer.particles.spawn(m.kind, m.x, m.y, m.z, this.settings.particles === 'decreased' ? Math.ceil(m.count / 3) : m.count, m.spread, m.data);
        break;
      case 'cave_biome':
        this.caveBiome = m.id;
        break;
      case 'trail':
        if (this.settings.particles !== 'minimal' || m.kind === 'sonic_boom') this.renderer.particles.trail(m.kind, m.x0, m.y0, m.z0, m.x1, m.y1, m.z1, m.ticks);
        break;
      case 'ending':
        this.endingCard.show(m);
        this.audio.play(m.style === 'calm' ? 'challenge.complete' : 'glitch.static', NaN, NaN, NaN, m.style === 'calm' ? 0.7 : 0.35, m.style === 'calm' ? 0.9 : 0.6, 'ui');
        break;
      case 'fx':
        this.onFx(m);
        break;
      case 'teleport':
        this.player.setPos(m.x, m.y, m.z);
        if (m.yaw !== undefined) this.player.yaw = m.yaw;
        if (m.pitch !== undefined) this.player.pitch = m.pitch;
        this.player.seq = m.seq;
        this.interaction.dig = null;
        break;
      case 'dig_progress':
        if (m.stage < 0 || m.stage > 9) this.otherDigs.delete(m.by);
        else this.otherDigs.set(m.by, { x: m.x, y: m.y, z: m.z, stage: m.stage });
        break;
      case 'gamemode': {
        const prev = this.player.gamemode;
        this.player.gamemode = m.mode;
        this.setAbilities(m.abilities);
        this.player.flying = m.abilities.flying;
        if (prev !== m.mode && this.screen && this.window?.id === 0) this.closeWindow(true);
        break;
      }
      case 'abilities':
        this.setAbilities(m.abilities);
        this.player.flying = m.abilities.flying;
        break;
      case 'dimension':
        this.closeScreenLocal();
        this.clearWorld();
        this.setDimension(m.dimension);
        this.player.setPos(m.x, m.y, m.z);
        this.player.yaw = m.yaw;
        this.loadingTerrain = true;
        this.loadingSince = performance.now();
        this.host.setLoading(m.dimension === 'nether' ? 'Entering the Nether...' : m.dimension === 'end' ? 'Entering the End...' : m.dimension === 'farlands' ? 'Entering the Farlands...' : m.dimension === 'computer' ? 'Connecting...' : 'Returning...');
        break;
      case 'boss':
        this.hud.setBoss(m.id, m.action, m.title, m.progress, m.color);
        break;
      case 'death':
        this.player.dead = true;
        this.closeScreenLocal();
        this.chat.open && this.chat.close();
        this.input.enabled = false;
        this.input.unlock();
        this.host.openDeath(m.message, m.hardcore, m.score);
        break;
      case 'respawned':
        this.player.dead = false;
        this.flash = 0;
        this.host.closeScreens();
        this.resume();
        break;
      case 'achievement':
        this.hud.toast('Advancement Made!', m.title);
        this.audio.play('toast', NaN, NaN, NaN, 0.6, 1, 'ui');
        break;
      case 'player_list':
        this.players = m.players;
        break;
      case 'explosion': {
        this.renderer.particles.spawn('explosion', m.x, m.y, m.z, 1, 0, m.power);
        this.renderer.particles.spawn('explosion_smoke', m.x, m.y, m.z, 16, m.power * 0.6);
        this.audio.play('explode', m.x, m.y, m.z, 4, 0.9 + Math.random() * 0.2);
        this.player.body.vx += m.kx;
        this.player.body.vy += m.ky;
        this.player.body.vz += m.kz;
        const d = Math.hypot(m.x - this.player.body.x, m.y - this.player.body.y, m.z - this.player.body.z);
        if (!this.settings.reduceMotion) this.shake = Math.max(this.shake, Math.max(0, 1 - d / (m.power * 4)));
        break;
      }
      case 'title':
        this.hud.showTitle(m.text, m.sub, m.ticks);
        break;
      case 'glyphs':
        this.input.unlock();
        this.host.showGlyphs(m.seed, m.face);
        break;
      case 'quest':
        this.hud.setQuest(m.quest);
        break;
      case 'world_info':
        this.worldInfo = m.world;
        this.updateCheatsIndicator();
        break;
      case 'admin_result':
        this.onAdminResult(m);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - m.time);
        break;
      case 'take_item': {
        const e = this.entities.get(m.item);
        const by = m.by === this.player.entityId ? null : this.entities.get(m.by);
        if (e) {
          // Short fly-to-collector animation, then remove
          const tx = by ? by.x : this.player.body.x;
          const ty = by ? by.y + 0.8 : this.player.body.y + 0.8;
          const tz = by ? by.z : this.player.body.z;
          e.setTarget(tx, ty, tz, e.yaw, e.pitch, e.headYaw);
          setTimeout(() => this.removeEntity(m.item), 120);
        }
        break;
      }
      case 'use_result':
        break;
      case 'record':
        if (m.track) {
          this.audio.discs.play(m.x, m.y, m.z, m.track);
          this.hud.showTitle('', `Now Playing: MineHonk - ${discTitle(m.track)}`, 60);
        } else this.audio.discs.stop(m.x, m.y, m.z);
        break;
      case 'mount':
        if (m.id === null) {
          this.player.vehicle = null;
        } else {
          const body = newBody(m.x ?? 0, m.y ?? 0, m.z ?? 0, m.width ?? 1, m.height ?? 1);
          body.stepHeight = 1.1;
          this.player.vehicle = { id: m.id, control: !!m.control, seat: m.seat ?? 0.7, speed: m.speed ?? 0.1, jump: m.jump ?? 0, body, yaw: m.yaw ?? 0 };
        }
        break;
      case 'vehicle_pos': {
        const v = this.player.vehicle;
        if (v) {
          v.body.x = m.x;
          v.body.y = m.y;
          v.body.z = m.z;
          v.body.vx = v.body.vy = v.body.vz = 0;
        }
        break;
      }
      case 'death_pos':
        this.deathPos = m.pos;
        break;
      case 'boost':
        if (this.player.gliding) this.player.boostTicks = Math.max(this.player.boostTicks, m.ticks);
        break;
      case 'cooldown': {
        this.cooldowns.set(m.item, { until: this.tickNo + m.ticks, total: m.ticks });
        const held = this.held();
        if (this.usingItem && (held?.id === m.item || (!held && this.held(1)?.id === m.item))) {
          this.usingItem = false;
          this.renderer.hand.using = 0;
          this.send({ t: 'use', hand: 0, action: 'release' });
        }
        break;
      }
      case 'debug':
        this.debugData = m.data;
        break;
    }
  }

  private onCooldown(item: number): boolean {
    const c = this.cooldowns.get(item);
    if (!c) return false;
    if (c.until <= this.tickNo) {
      this.cooldowns.delete(item);
      return false;
    }
    return true;
  }

  /** Remaining cooldown fraction (0..1) for a slot's item. */
  private cooldownFraction(s: Slot): number {
    if (!s) return 0;
    const c = this.cooldowns.get(s.id);
    if (!c || c.until <= this.tickNo) return 0;
    return (c.until - this.tickNo) / Math.max(1, c.total);
  }

  private setAbilities(a: AbilitiesMsg): void {
    this.player.abilities = a;
  }

  private setDimension(d: DimensionId): void {
    this.dimension = d;
    this.world.dimension = d;
    this.world.hasSky = d === 'overworld' || d === 'farlands' || d === 'computer';
    this.renderer.sky.dimension = d;
  }

  private clearWorld(): void {
    this.world.clear();
    this.audio.discs.stopAll();
    for (const id of [...this.entities.keys()]) this.removeEntity(id);
    this.otherDigs.clear();
    this.blockEntities.clear();
    this.renderer.particles.clear();
  }

  private removeEntity(id: number): void {
    if (!this.entities.has(id)) return;
    this.entities.delete(id);
    this.renderer.entities.remove(id);
    if (this.entityTarget?.id === id) this.entityTarget = null;
  }

  private onAnim(id: number, anim: string): void {
    if (id === this.player.entityId) {
      if (anim === 'hurt') this.hurtFx();
      if (anim === 'totem') {
        this.hud.showTitle('', 'Totem of Undying', 40);
        this.renderer.particles.spawn('happy', this.player.body.x, this.player.body.y + 1, this.player.body.z, 40, 1);
      }
      return;
    }
    const e = this.entities.get(id);
    if (!e) return;
    switch (anim) {
      case 'swing':
      case 'attack':
        e.swingTime = 6;
        break;
      case 'hurt':
        e.hurtTime = 10;
        break;
      case 'death':
        e.dead = true;
        e.hurtTime = 10;
        break;
      case 'crit':
      case 'magic_crit':
        this.renderer.particles.spawn(anim, e.x, e.y + 1, e.z, 12, 0.5);
        break;
      default:
        e.anim = anim;
        e.animTime = 0;
    }
  }

  private hurtFx(): void {
    this.flash = 1;
    if (!this.settings.reduceMotion) this.hurtTilt = 1;
  }

  private onStats(s: PlayerStats): void {
    if (this.prevHealth >= 0 && s.health < this.prevHealth && Number.isFinite(s.health)) this.hurtFx();
    this.prevHealth = s.health;
    this.stats = s;
    this.player.effects = s.effects;
  }

  // ------------------------------------------------------------------ simulation
  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    if (this.settings.maxFps > 0 && now - this.last < 1000 / this.settings.maxFps - 1) return;
    const dt = Math.min(250, now - this.last);
    this.last = now;
    this.input.pollGamepad();
    this.acc += dt;
    let n = 0;
    while (this.acc >= 50 && n < 5) {
      this.acc -= 50;
      this.tick();
      n++;
    }
    if (n === 5) this.acc = 0;
    this.touch.setVisible(this.input.touchMode && this.joined && !this.uiBlocking && !this.player.dead);
    this.touchClose.classList.toggle('hidden', !(this.input.touchMode && (!!this.screen || this.chat.open)));
    this.look(dt);
    this.render(this.acc / 50, dt);
    this.frames++;
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.frames = 0;
      this.fpsTime = now;
    }
  };

  /** Mouse / right-stick look, applied per frame for responsiveness. */
  private look(dt: number): void {
    const [mx, my] = this.input.takeMouse();
    if (this.uiBlocking || this.player.dead) return;
    const sens = 0.0022 * this.settings.sensitivity;
    const inv = this.settings.invertY ? -1 : 1;
    let dyaw = -mx * sens;
    let dpitch = my * sens * inv;
    if (this.input.padActive) {
      const k = (dt / 1000) * 3 * this.settings.sensitivity;
      dyaw -= this.input.padLook[0] * k;
      dpitch += this.input.padLook[1] * k * inv;
    }
    this.player.yaw = (this.player.yaw + dyaw) % (Math.PI * 2);
    this.player.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.player.pitch + dpitch));
  }

  private tick(): void {
    if (this.paused) {
      this.input.consume();
      return;
    }
    this.tickNo++;
    const p = this.player;
    // Discrete actions
    for (const a of this.input.consume()) this.onAction(a);
    // Movement input
    const blocking = this.uiBlocking;
    const inp = this.input;
    let forward = 0;
    let strafe = 0;
    let jump = false;
    let sneak = false;
    let sprint = false;
    if (!blocking) {
      forward = (inp.isHeld('forward') ? 1 : 0) - (inp.isHeld('back') ? 1 : 0) - inp.padMove[1] - inp.touchMove[1];
      strafe = (inp.isHeld('right') ? 1 : 0) - (inp.isHeld('left') ? 1 : 0) + inp.padMove[0] + inp.touchMove[0];
      forward = Math.max(-1, Math.min(1, forward));
      strafe = Math.max(-1, Math.min(1, strafe));
      // V5.5: PLAYER CONTROL OVERRIDE
      if (this.tickNo < this.reverseControlsUntil) {
        forward = -forward;
        strafe = -strafe;
      }
      jump = inp.isHeld('jump') || inp.gpJump || inp.touchJump;
      sneak = inp.isHeld('sneak') || inp.gpSneak || inp.touchSneak;
      sprint = inp.isHeld('sprint') || inp.gpSprint || inp.touchSprint;
    }
    const forwardPressed = forward > 0 && !this.wasForward;
    const jumpPressed = jump && !this.wasJump;
    this.wasForward = forward > 0;
    this.wasJump = jump;
    // Hunger prevents sprinting
    if (this.survivalHud && this.stats.food <= 6 && !p.abilities.mayFly) sprint = false;
    const wasFlying = p.flying;
    // Sneak gets off a mount
    const sneakPressed = sneak && !this.wasSneak;
    this.wasSneak = sneak;
    if (p.vehicle && sneakPressed) this.send({ t: 'dismount' });
    if (p.vehicle) sneak = false;
    const move = p.tick({ forward, strafe, jump, sneak, sprint: sprint && !(this.survivalHud && this.stats.food <= 6), jumpPressed, forwardPressed });
    const v = p.vehicle;
    if (v?.control) this.send({ t: 'vehicle_move', x: v.body.x, y: v.body.y, z: v.body.z, yaw: v.yaw });
    if (this.survivalHud && this.stats.food <= 6 && !p.abilities.mayFly) p.sprinting = false;
    if (p.flying !== wasFlying) this.send({ t: 'set_flying', flying: p.flying });
    if (move) this.send(move);
    // Smooth eye height
    this.eyePrev = this.eyeCur;
    this.eyeCur += (p.eyeHeight - this.eyeCur) * 0.5;
    // Footsteps
    this.footsteps();
    // Targeting
    this.updateTargets();
    // Mining / attacking / using
    if (!blocking && !p.dead) {
      const attackHeld = inp.mouseHeld(0) || inp.gpAttack || inp.touchAttack;
      const helmet = this.invSlots[HELMET] ?? null;
      const underwater = p.isUnderwater();
      if (this.entityTarget && attackHeld) this.interaction.tickMining(this.held(), false, underwater, 0, 0, false);
      else this.interaction.tickMining(this.held(), attackHeld, underwater, this.effectLevel('haste'), this.effectLevel('mining_fatigue'), BlockInteraction.aquaAffinity(helmet));
      const useHeld = inp.mouseHeld(2) || inp.gpUse || inp.touchUse;
      if (useHeld && !this.usingItem) {
        if (this.useRepeat > 0) this.useRepeat--;
        else {
          this.useRepeat = 4;
          if (this.interaction.target && !this.entityTarget) this.useOnBlock(false);
        }
      }
      if (!useHeld && this.usingItem) {
        this.usingItem = false;
        this.renderer.hand.using = 0;
        if (this.scoping) this.scoping = false;
        else this.send({ t: 'use', hand: 0, action: 'release' });
      }
      if (!useHeld) this.useRepeat = 0;
    } else if (this.interaction.dig) this.interaction.tickMining(null, false, false, 0, 0, false);
    this.interaction.tick();
    if (this.attackCooldown > 0) this.attackCooldown--;
    // World time
    if (this.dayCycle) this.dayTime = (this.dayTime + 1) % 24000;
    this.time++;
    // Entities & effects
    for (const e of this.entities.values()) e.tick();
    // The mount this client steers is drawn where the local simulation has it
    if (v?.control) {
      const e = this.entities.get(v.id);
      if (e) {
        e.px = e.x;
        e.py = e.y;
        e.pz = e.z;
        e.x = e.tx = v.body.x;
        e.y = e.ty = v.body.y;
        e.z = e.tz = v.body.z;
        e.yaw = e.tyaw = e.headYaw = e.theadYaw = v.yaw;
        e.steps = 0;
      }
    }
    this.renderer.particles.tick();
    this.renderer.hand.tick();
    this.renderer.hand.setItem(this.held()?.id ?? 0);
    this.hud.tick();
    this.renderer.glitch.tick();
    this.glitchHud.tick(this.renderer.glitch.corrupting);
    this.voidAura();
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.1);
    if (this.hurtTilt > 0) this.hurtTilt = Math.max(0, this.hurtTilt - 0.12);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.05);
    this.tickPortalFx();
    this.ambience();
    if (this.tickNo % 100 === 0) {
      this.pingTime = performance.now();
      this.send({ t: 'ping', time: this.pingTime });
    }
    this.hud.update(
      {
        stats: this.stats,
        hotbar: this.invSlots.slice(HOTBAR0, HOTBAR0 + 9),
        cooldowns: this.invSlots.slice(HOTBAR0, HOTBAR0 + 9).map((st) => this.cooldownFraction(st)),
        offhand: this.invSlots[OFFHAND] ?? null,
        selected: this.selected,
        survival: this.survivalHud,
        hardcore: this.worldInfo?.hardcore ?? false,
        spectator: this.player.gamemode === 'spectator',
      },
      this.tickNo,
    );
    this.navigator.update(this.instrument(), this.player.body.x, this.player.body.z, this.player.yaw, this.tickNo);
    this.checkLoading();
  }

  /** The instrument for the held compass or clock (main hand first). */
  private instrument(): Instrument | null {
    for (const st of [this.held(), this.held(1)]) {
      if (!st) continue;
      const id = items[st.id]?.id;
      const overworldLike = this.dimension === 'overworld' || this.dimension === 'farlands';
      if (id === 'clock') return { kind: 'clock', dayTime: overworldLike ? this.dayTime : null };
      if (id === 'compass') {
        const lode = st.tag?.data?.lodestone as number[] | undefined;
        if (lode) return { kind: 'needle', target: st.tag?.data?.dim === this.dimension ? [lode[0]! + 0.5, lode[2]! + 0.5] : null, colors: { face: '#d8d8d8', rim: '#6a6a6a', tip: '#c02020' } };
        return { kind: 'needle', target: this.dimension === 'overworld' ? [this.worldSpawn[0] + 0.5, this.worldSpawn[2] + 0.5] : null, colors: { face: '#d8d8d8', rim: '#8a8a8a', tip: '#d02020' } };
      }
      // V6 phase 3: an Ancient Map points at the giant structure it was drawn for
      if (id === 'ancient_map') {
        const tgt = st.tag?.data?.target as number[] | undefined;
        return { kind: 'needle', target: tgt && st.tag?.data?.dim === this.dimension ? [tgt[0]! + 0.5, tgt[2]! + 0.5] : null, colors: { face: '#d8c8a0', rim: '#8a7a5a', tip: '#3ab0d0' } };
      }
      if (id === 'recovery_compass') {
        const d = this.deathPos;
        return { kind: 'needle', target: d && d.dim === this.dimension ? [d.x + 0.5, d.z + 0.5] : null, colors: { face: '#0e2a30', rim: '#1f4a52', tip: '#3ae0d0' } };
      }
    }
    return null;
  }

  private wasForward = false;
  private wasJump = false;

  private checkLoading(): void {
    if (!this.loadingTerrain || !this.joined) return;
    const b = this.player.body;
    const cx = Math.floor(b.x) >> 4;
    const cz = Math.floor(b.z) >> 4;
    let have = 0;
    let total = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        total++;
        if (this.world.chunks.has(chunkIndex(cx + dx, cz + dz))) have++;
      }
    const st = this.renderer.chunks.stats();
    const meshed = st.meshes > 0 || have === total;
    const waited = performance.now() - this.loadingSince;
    this.host.setLoading('Loading terrain...', `${have}/${total} chunks`);
    if ((have === total && meshed && st.dirty < 40) || waited > 20000) {
      this.loadingTerrain = false;
      this.host.setLoading(null);
      this.resume();
    }
  }

  private footsteps(): void {
    const p = this.player;
    const b = p.body;
    if (p.flying || p.gamemode === 'spectator' || !b.onGround) {
      if (b.inWater && !p.flying) {
        const d = Math.hypot(b.x - p.prev.x, b.z - p.prev.z);
        this.stepDist += d;
        if (this.stepDist > 2.5) {
          this.stepDist = 0;
          this.audio.play('swim', b.x, b.y, b.z, 0.3, 1 + (Math.random() - 0.5) * 0.4);
        }
      }
      return;
    }
    const d = Math.hypot(b.x - p.prev.x, b.z - p.prev.z);
    this.stepDist += d;
    if (this.stepDist > (p.sprinting ? 2 : 1.6)) {
      this.stepDist = 0;
      if (p.sneaking) return;
      const bx = Math.floor(b.x);
      const by = Math.floor(b.y - 0.2);
      const bz = Math.floor(b.z);
      let s = this.world.getState(bx, by, bz);
      if (s === 0) s = this.world.getState(bx, by - 1, bz);
      if (s === 0) return;
      const def = blocks[STATE_BLOCK[s]!]!.def;
      this.audio.play('step.' + def.sound, b.x, b.y, b.z, 0.15, 1);
    }
  }

  /** Local portal overlay: builds up while standing in a portal sheet. */
  private tickPortalFx(): void {
    const b = this.player.body;
    let kind: 'nether_portal' | 'far_portal' | 'expansion_portal' | null = null;
    for (let y = Math.floor(b.y); y <= Math.floor(b.y + 1.7) && !kind; y++)
      for (const [dx, dz] of [
        [-0.3, -0.3],
        [0.3, 0.3],
        [-0.3, 0.3],
        [0.3, -0.3],
      ] as const) {
        const id = blockOf(this.world.getState(Math.floor(b.x + dx), y, Math.floor(b.z + dz))).id;
        if (id === 'nether_portal' || id === 'far_portal' || id === 'expansion_portal') {
          kind = id;
          break;
        }
      }
    if (kind) {
      if (this.portalFx === 0) this.audio.play('portal.trigger', NaN, NaN, NaN, 0.5, 1, 'sound');
      this.portalKind = kind;
      const fast = this.player.gamemode === 'creative' || this.player.gamemode === 'spectator';
      this.portalFx = Math.min(1, this.portalFx + (fast ? 0.5 : 1 / 70));
    } else this.portalFx = Math.max(0, this.portalFx - 0.08);
    // Portal hum when one is close
    if (this.tickNo % 70 === 0 && Math.random() < 0.6) {
      const px = Math.floor(b.x);
      const py = Math.floor(b.y);
      const pz = Math.floor(b.z);
      search: for (let dy = -3; dy <= 3; dy++)
        for (let dz = -4; dz <= 4; dz++)
          for (let dx = -4; dx <= 4; dx++) {
            const id = blockOf(this.world.getState(px + dx, py + dy, pz + dz)).id;
            if (id === 'nether_portal' || id === 'far_portal' || id === 'expansion_portal') {
              this.audio.play('portal.ambient', px + dx + 0.5, py + dy + 0.5, pz + dz + 0.5, 0.5, 0.8 + Math.random() * 0.4, 'ambient');
              break search;
            }
          }
    }
    // Glitched portal frames flicker and hum; one holding the Eye much harder
    if (this.tickNo % 5 === 0 && this.dimension === 'overworld' && this.caveBiome === 10) {
      const px = Math.floor(b.x);
      const py = Math.floor(b.y);
      const pz = Math.floor(b.z);
      for (let i = 0; i < 24; i++) {
        const x = px + Math.floor(Math.random() * 25) - 12;
        const y = py + Math.floor(Math.random() * 13) - 6;
        const z = pz + Math.floor(Math.random() * 25) - 12;
        const s = this.world.getState(x, y, z);
        if (blockOf(s).id !== 'glitched_portal_frame') continue;
        const lit = getProp(s, 'part') === 'eye';
        if (this.settings.particles !== 'minimal') this.renderer.particles.spawn(lit ? 'void_burst' : 'glitch', x + 0.5, y + 0.5, z + 0.5, lit ? 4 : 2, 0.6);
        if (Math.random() < (lit ? 0.25 : 0.08)) this.audio.play('glitch.hum', x + 0.5, y + 0.5, z + 0.5, lit ? 0.8 : 0.4, lit ? 0.7 : 1, 'ambient');
        break;
      }
    }
  }

  /** Cave biome ambience: drifting particles and biome sounds around the player. */
  private caveAmbience(): void {
    const cb = this.dimension === 'overworld' ? this.caveBiome : 0;
    this.caveBlend += ((cb ? 1 : 0) - this.caveBlend) * 0.04;
    if (!cb) return;
    const info = CAVE_BIOMES[cb];
    const b = this.player.body;
    if (info?.particle && this.settings.particles !== 'minimal' && this.tickNo % (this.settings.particles === 'decreased' ? 6 : 2) === 0) {
      const x = b.x + (Math.random() - 0.5) * 16;
      const y = b.y + (Math.random() - 0.3) * 8;
      const z = b.z + (Math.random() - 0.5) * 16;
      if (!STATE_SOLID[this.world.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) this.renderer.particles.spawn(info.particle, x, y, z, 1, 0.2);
    }
    // Each biome has its own sounds
    if (this.tickNo % 40 === 0 && Math.random() < 0.35) {
      const snd = ['', 'cave.drip', 'cave.rumble', 'lush.chirp', 'mushroom.pop', 'crystal.chime', 'cave.drip', 'lava.pop', 'frozen.wind', 'deep_dark.hum', 'glitch.static'][cb];
      if (snd) this.audio.play(snd, b.x + (Math.random() - 0.5) * 20, b.y + (Math.random() - 0.5) * 6, b.z + (Math.random() - 0.5) * 20, 0.6, 0.85 + Math.random() * 0.3, 'ambient');
    }
  }

  /**
   * Screen and world effects from the server (V3): glitches, the End going
   * silent and corrupting, the integrity failure, warnings and attacks.
   */
  private onFx(m: Extract<S2C, { t: 'fx' }>): void {
    const g = this.renderer.glitch;
    const wf = this.renderer.worldFx;
    const now = this.tickNo / 20;
    const secs = (m.ticks ?? 20) / 20;
    switch (m.kind) {
      case 'glitch':
        g.pulse(m.strength ?? 0.5, m.ticks ?? 20);
        if ((m.strength ?? 0.5) >= 0.5) this.audio.play('glitch.static', NaN, NaN, NaN, 0.35, 0.8 + Math.random() * 0.4, 'ui');
        break;
      case 'silence':
        this.audio.silence(true, 0.25);
        break;
      case 'unsilence':
        this.audio.silence(false, secs);
        break;
      case 'corrupt_world':
        g.corruptWorld(m.strength ?? 0.7, m.ticks ?? 100);
        break;
      case 'integrity':
        g.pulse(1, m.ticks ?? 40);
        this.glitchHud.integrity(m.text ?? 'ERROR', m.ticks ?? 40);
        this.audio.playThrough('glitch.static', 0.8);
        break;
      case 'player_glitch':
        g.playerHit();
        this.glitchHud.playerHit();
        this.audio.playThrough('glitch.static', 0.6);
        break;
      case 'stabilize':
        g.stabilize();
        this.glitchHud.clear();
        this.audio.silence(false, 1);
        break;
      case 'warn_circle':
        wf.warnCircle(m.id, m.x ?? 0, m.y ?? 0, m.z ?? 0, m.r ?? 2, secs, now, m.color);
        break;
      case 'warn_cracks':
        wf.warnCracks(m.id, m.x ?? 0, m.y ?? 0, m.z ?? 0, m.r ?? 5, secs, now, m.color);
        break;
      case 'warn_arc':
        wf.warnArc(m.id, new THREE.Vector3(m.x ?? 0, m.y ?? 0, m.z ?? 0), new THREE.Vector3(m.x1 ?? 0, m.y1 ?? 0, m.z1 ?? 0), Math.max(1, Math.round(m.strength ?? 20)), secs, now, m.color ?? 0xe8a8ff);
        break;
      case 'warn_end':
      case 'zone_end':
        if (m.id !== undefined) wf.remove(m.id);
        break;
      case 'warn_beam':
      case 'laser':
        wf.beam(m.id, new THREE.Vector3(m.x ?? 0, m.y ?? 0, m.z ?? 0), new THREE.Vector3(m.x1 ?? 0, m.y1 ?? 0, m.z1 ?? 0), secs, now, m.kind === 'warn_beam', m.color);
        if (m.kind === 'laser') g.pulse(0.35, 12);
        break;
      case 'zone':
        wf.zone(m.id, m.x ?? 0, m.y ?? 0, m.z ?? 0, m.r ?? 3, m.ticks === undefined ? Infinity : secs, now, m.text === 'malware' ? 0x18ff6a : m.text === 'static' ? 0xd8e8ff : 0xe020c8);
        break;
      case 'pulse':
        wf.pulse(m.x ?? 0, m.y ?? 0, m.z ?? 0, m.r ?? 20, secs, now);
        break;
      case 'afterimage': {
        const obj = m.id !== undefined ? this.renderer.entities.objectOf(m.id) : null;
        if (obj) wf.afterimage(obj, secs, now);
        break;
      }
      case 'portal_on':
        g.pulse(0.6, 30);
        this.audio.play('glitch.portal_on', m.x ?? NaN, m.y ?? NaN, m.z ?? NaN, 1.5, 1);
        break;
      case 'farlands_entry':
        g.pulse(1, m.ticks ?? 50);
        this.glitchHud.fragments(10);
        this.audio.playThrough('farlands.entry', 0.7);
        break;
      case 'boss_death':
        g.pulse(1, m.ticks ?? 80);
        g.corruptWorld(0.9, m.ticks ?? 80);
        break;
      // V5.5: the Digital Corruption Update
      case 'hack': {
        const mode = Math.round(m.strength ?? 1);
        this.digitalHud.hack(m.text ?? 'HER0BRINE.EXE', m.ticks ?? 30, mode);
        if (mode === 1) {
          g.pulse(0.35, 12);
          this.audio.play('computer.glitch', NaN, NaN, NaN, 0.6, 0.7, 'ui');
        } else if (mode === 0) this.audio.play('computer.alert', NaN, NaN, NaN, 0.5, 0.6, 'ui');
        else if (mode === 3) g.pulse(0.5, 16);
        break;
      }
      case 'takeover':
        this.digitalHud.takeover(m.text ?? '', m.strength ?? 0);
        g.pulse(0.15 + (m.strength ?? 0) * 0.35, 8);
        break;
      case 'controls_reversed':
        this.reverseControlsUntil = this.tickNo + (m.ticks ?? 60);
        break;
      case 'arc':
        wf.arc(m.id, new THREE.Vector3(m.x ?? 0, m.y ?? 0, m.z ?? 0), new THREE.Vector3(m.x1 ?? 0, m.y1 ?? 0, m.z1 ?? 0), secs, now, (m.strength ?? 0) > 0);
        break;
      case 'bolt':
        wf.bolt(m.x ?? 0, m.y ?? 0, m.z ?? 0, secs, now);
        g.pulse(0.2, 6);
        break;
      case 'enter_computer':
        this.digitalHud.enterComputer(m.ticks ?? 36);
        g.pulse(0.8, m.ticks ?? 36);
        this.audio.playThrough('computer.enter', 0.8);
        break;
      case 'presence':
        this.digitalHud.presence(m.ticks ?? 80);
        break;
      case 'shutdown':
        this.digitalHud.shutdown(m.ticks ?? 80);
        this.audio.playThrough('computer.shutdown', 0.8);
        break;
    }
  }

  /** Voidbound Endermen trail dark violet motes (client-side, no network). */
  private voidAura(): void {
    if (this.settings.particles === 'minimal' || this.tickNo % 3 !== 0) return;
    const p = this.player.body;
    for (const e of this.entities.values()) {
      if (e.type !== 'enderman' || !e.meta?.voidbound) continue;
      if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 > 48 * 48) continue;
      this.renderer.particles.spawn('void_aura', e.x, e.y + 1.6, e.z, this.settings.particles === 'decreased' ? 1 : 2, 0.5);
    }
  }

  /** Cave fog for the renderer: colour, how thick, and how far we are into it. */
  caveFog(): { color: number; density: number; amount: number } | undefined {
    if (this.caveBlend < 0.01) return undefined;
    const info = CAVE_BIOMES[this.caveBiome] ?? CAVE_BIOMES[1]!;
    return { color: info.fog, density: info.fogDensity, amount: this.caveBlend };
  }

  private ambience(): void {
    const p = this.player;
    const b = p.body;
    this.caveAmbience();
    this.errorAmbience();
    this.expansionAmbience();
    const light = this.world.getLight(Math.floor(b.x), Math.floor(b.y + 1.6), Math.floor(b.z));
    const skyLight = light >> 4;
    if (this.dimension === 'overworld') {
      if (skyLight === 0 && (light & 15) < 5 && b.y < 64) this.caveMood++;
      else this.caveMood = Math.max(0, this.caveMood - 2);
      if (this.caveMood > 1200 + Math.random() * 6000) {
        this.caveMood = 0;
        this.audio.play('cave.ambient', b.x + (Math.random() - 0.5) * 12, b.y + (Math.random() - 0.5) * 6, b.z + (Math.random() - 0.5) * 12, 0.8, 0.8 + Math.random() * 0.3, 'ambient');
      }
    } else if (this.dimension === 'nether' && this.tickNo % 140 === 0 && Math.random() < 0.5) {
      this.audio.play('nether.ambient', NaN, NaN, NaN, 0.5, 0.8 + Math.random() * 0.4, 'ambient');
    } else if (this.dimension === 'farlands' && this.tickNo % 120 === 0 && Math.random() < 0.4) {
      this.audio.play('farlands.ambient', NaN, NaN, NaN, 0.45, 0.8 + Math.random() * 0.4, 'ambient');
    } else if (this.dimension === 'computer' && this.tickNo % 120 === 0 && Math.random() < 0.45) {
      // V5.5: the hum of the machine under the world
      this.audio.play('computer.ambient', NaN, NaN, NaN, 0.45, 0.9 + Math.random() * 0.2, 'ambient');
    }
    // Rain loop (scaled by sky exposure)
    const snowy = this.world.biomeAt(b.x, b.z).precipitation === 'snow';
    const exposure = this.world.hasSky ? Math.max(0, skyLight - 4) / 11 : 0;
    this.audio.setRain(this.rain * exposure, snowy);
    if (this.thunder > 0.5 && Math.random() < 0.0015 * this.thunder) this.audio.play('thunder', NaN, NaN, NaN, 0.6 * exposure + 0.2, 0.8 + Math.random() * 0.3, 'ambient');
    // Music mood
    if (++this.musicTimer >= 20) {
      this.musicTimer = 0;
      const boss = this.hud.hasBoss();
      this.audio.music.update(MusicPlayer.moodFor(this.dimension, this.player.gamemode === 'creative', p.body.eyesInWater, boss, this.caveBiome));
    }
  }

  /** V6: the Expanded End: blended atmosphere, ambient motes and the biome's sound bed. */
  private expansionAmbience(): void {
    const b = this.player.body;
    const atm = this.endAtmos;
    atm.update(this.dimension === 'end', b.x, b.z, (x, z) => this.world.biomeAt(x, z));
    const def = atm.dominant;
    this.audio.setBed(def ? `bed.${def.bed}` : null, atm.state.amount);
    const pt = def?.particles;
    if (!pt || this.settings.particles === 'minimal') return;
    const rate = pt.rate * atm.state.amount * (this.settings.particles === 'decreased' ? 0.4 : 1);
    if (Math.random() > rate) return;
    const x = b.x + (Math.random() - 0.5) * 20;
    const y = b.y + (Math.random() - 0.3) * 10;
    const z = b.z + (Math.random() - 0.5) * 20;
    if (!STATE_SOLID[this.world.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) this.renderer.particles.spawn(`end_mote_${pt.motion}`, x, y, z, 1, 0.3, pt.color | (pt.glow ? 0x1000000 : 0));
  }

  private inErrorBiome = false;

  /**
   * V4: inside the Error Biome the air crawls with glitch particles, a low
   * hum plays and the screen stutters now and then (all within the Glitch
   * Effects and particle settings).
   */
  private errorAmbience(): void {
    const b = this.player.body;
    const inside = this.world.biomeAt(b.x, b.z).id === 'error_biome';
    const g = this.renderer.glitch;
    if (inside && !this.inErrorBiome) {
      g.pulse(0.35, 14);
      this.audio.play('glitch.static', NaN, NaN, NaN, 0.3, 0.7, 'ambient');
    }
    this.inErrorBiome = inside;
    if (!inside) return;
    if (this.settings.particles !== 'minimal' && this.tickNo % (this.settings.particles === 'decreased' ? 6 : 2) === 0) {
      const x = b.x + (Math.random() - 0.5) * 16;
      const y = b.y + Math.random() * 6 - 1;
      const z = b.z + (Math.random() - 0.5) * 16;
      if (!STATE_SOLID[this.world.getState(Math.floor(x), Math.floor(y), Math.floor(z))]) this.renderer.particles.spawn('glitch', x, y, z, 1, 0.3);
    }
    if (this.tickNo % 90 === 0) this.audio.play('glitch.hum', NaN, NaN, NaN, 0.25, 0.6 + Math.random() * 0.2, 'ambient');
    if (Math.random() < 1 / 160) g.pulse(0.12 + Math.random() * 0.1, 6 + Math.floor(Math.random() * 6));
  }

  private eyePos(alpha = 1): [number, number, number] {
    const [x, y, z] = this.player.lerpPos(alpha);
    return [x, y + this.eyePrev + (this.eyeCur - this.eyePrev) * alpha, z];
  }

  private updateTargets(): void {
    const p = this.player;
    const eye = this.eyePos();
    const dir = lookDirection(p.yaw, p.pitch);
    this.interaction.updateTarget(eye, dir);
    // Entity ray test
    this.entityTarget = null;
    if (p.gamemode === 'spectator' || p.dead) return;
    const reach = p.gamemode === 'creative' ? 5 : 3;
    const blockHit = this.interaction.target;
    const blockDist = blockHit ? Math.hypot(blockHit.px - eye[0], blockHit.py - eye[1], blockHit.pz - eye[2]) : Infinity;
    let best = Math.min(reach, blockDist);
    for (const e of this.entities.values()) {
      if (e.dead) continue;
      const info = entityInfo(e.type);
      if (!info.attackable && !info.interactable) continue;
      const hw = info.width / 2 + 0.05;
      const t = rayBox(eye, dir, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + info.height + 0.05, e.z + hw);
      if (t !== null && t < best) {
        best = t;
        this.entityTarget = e;
      }
    }
    if (this.entityTarget) this.interaction.target = null;
  }

  private onAction(a: string): void {
    if (a === 'fullscreen') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
      return;
    }
    if (a === 'pause') {
      if (!this.uiBlocking && !this.player.dead) {
        this.input.unlock();
        this.host.openPause();
      }
      return;
    }
    if (this.uiBlocking || this.player.dead || !this.joined) return;
    const p = this.player;
    if (a.startsWith('hotbar')) {
      this.selectSlot(parseInt(a.slice(6), 10));
      return;
    }
    switch (a) {
      case 'scrollUp':
        this.selectSlot((this.selected + 8) % 9);
        break;
      case 'scrollDown':
        this.selectSlot((this.selected + 1) % 9);
        break;
      case 'inventory':
        if (p.gamemode !== 'spectator') this.openInventory();
        break;
      case 'drop':
        if (this.held()) {
          const all = this.input.held.has('ControlLeft') || this.input.held.has('ControlRight');
          this.send({ t: 'drop', all });
          this.swing();
        }
        break;
      case 'chat':
        this.input.enabled = false;
        this.input.unlock();
        this.chat.openInput();
        break;
      case 'command':
        this.input.enabled = false;
        this.input.unlock();
        this.chat.openInput('/');
        break;
      case 'swapHands':
        this.send({ t: 'swap_hands' });
        break;
      case 'debug':
        this.debug = !this.debug;
        if (!this.debug) this.hud.setDebug(null, null);
        break;
      case 'perspective':
        this.thirdPerson = ((this.thirdPerson + 1) % 3) as 0 | 1 | 2;
        break;
      case 'hideHud':
        this.hudHidden = !this.hudHidden;
        this.hud.visible = !this.hudHidden;
        break;
      case 'screenshot':
        this.screenshotPending = true;
        break;
      case 'achievements':
        this.input.unlock();
        this.host.openAchievements();
        break;
      case 'adminPanel':
        if (this.worldInfo?.admin) {
          this.input.unlock();
          this.host.openAdmin();
        } else this.chat.add(this.worldInfo?.cheats ? 'Only the world owner and operators can use the Admin Panel.' : 'Cheats are disabled in this world.', 'error');
        break;
      case 'attack':
        this.attack();
        break;
      case 'use':
        this.use();
        break;
      case 'pick':
        this.pick();
        break;
    }
  }

  private selectSlot(i: number): void {
    if (i < 0 || i > 8 || i === this.selected) return;
    this.selected = i;
    this.send({ t: 'hotbar', slot: i });
    this.scoping = false;
    if (this.usingItem) {
      this.usingItem = false;
      this.renderer.hand.using = 0;
      this.send({ t: 'use', hand: 0, action: 'release' });
    }
  }

  private attack(): void {
    const e = this.entityTarget;
    if (e) {
      if (entityInfo(e.type).attackable && this.attackCooldown <= 0) {
        this.send({ t: 'attack', id: e.id });
        this.attackCooldown = 2;
      }
      this.swing();
      return;
    }
    if (!this.interaction.target) this.swing();
  }

  private use(): void {
    const p = this.player;
    if (p.gamemode === 'spectator') return;
    const e = this.entityTarget;
    if (e) {
      this.send({ t: 'interact', id: e.id, hand: 0 });
      this.swing();
      return;
    }
    if (this.interaction.target) {
      this.useRepeat = 4;
      if (this.useOnBlock(true)) return;
    }
    this.startUsingItem();
  }

  /** Right click on the targeted block. Returns true if the click was consumed. */
  private useOnBlock(first: boolean): boolean {
    const t = this.interaction.target;
    if (!t) return false;
    const held = this.held();
    const def = blocks[STATE_BLOCK[t.state]!]!.def;
    // The Engineering Book on an engineering block opens its entry; on anything without a use, the book
    if (first && held && items[held.id]!.def.use === 'engineering_book' && !this.player.sneaking) {
      if (guideEntry(def.id)) {
        this.input.unlock();
        this.host.openEngineeringBook(def.id);
        return true;
      }
      if (!def.interact) {
        this.input.unlock();
        this.host.openEngineeringBook();
        return true;
      }
    }
    const interacts = !!def.interact && !(this.player.sneaking && held);
    this.interaction.use(held, 0, this.player.sneaking);
    if (interacts) return true;
    // Items that do something over time (food, bows) start using as well
    if (first && held) {
      const idef = items[held.id]!.def;
      if (idef.block) return true;
      // Launched from the block face by the server
      if (idef.use === 'firework') return true;
      if (idef.food || idef.use === 'bow' || idef.use === 'shield' || idef.use === 'crossbow' || idef.use === 'trident') {
        this.startUsingItem();
        return true;
      }
    }
    return !!held?.id && !!items[held.id]!.def.block;
  }

  private startUsingItem(): void {
    const held = this.held();
    if (!held) {
      // Offhand item
      const off = this.held(1);
      if (off) this.send({ t: 'use', hand: 1, action: 'start' });
      return;
    }
    const def = items[held.id]!.def;
    if (this.onCooldown(held.id)) return;
    if (def.use === 'engineering_book') {
      this.input.unlock();
      this.host.openEngineeringBook();
      return;
    }
    // V6 phase 3: a lore book opens on its page (nothing for the server to do)
    if (items[held.id]!.id === 'book' && typeof held.tag?.lore === 'string') {
      this.input.unlock();
      this.host.openLore(held.tag.lore);
      return;
    }
    if (def.use === 'grimoire') {
      // The server notes the reading (an advancement); the pages open here
      this.send({ t: 'use', hand: 0, action: 'start' });
      this.input.unlock();
      this.host.openGrimoire();
      return;
    }
    if (def.use === 'spyglass') {
      this.usingItem = true;
      this.scoping = true;
      this.audio.play('spyglass.use', NaN, NaN, NaN, 0.6, 1, 'ui');
      return;
    }
    this.send({ t: 'use', hand: 0, action: 'start' });
    const overTime = !!def.food || def.use === 'bow' || def.use === 'shield' || def.use === 'crossbow' || def.use === 'trident' || def.use === 'potion';
    if (overTime) {
      const canEat = !def.food || def.food.alwaysEdible || this.stats.food < 20 || !this.survivalHud || (this.player.gamemode === 'god' && !Number.isFinite(this.stats.maxHealth));
      if (canEat) {
        this.usingItem = true;
        this.renderer.hand.using = 1;
      }
    } else this.swing();
  }

  private pick(): void {
    const t = this.interaction.target;
    if (!t) return;
    const num = pickItemFor(t.state);
    if (!num) return;
    for (let i = 0; i < 9; i++) {
      if (this.invSlots[HOTBAR0 + i]?.id === num) {
        this.selectSlot(i);
        return;
      }
    }
    if (this.player.gamemode === 'creative') {
      this.send({ t: 'creative_pick', item: { id: num, count: 1 } });
      return;
    }
    // Survival: swap from main inventory into the selected hotbar slot
    for (let i = 9; i < 36; i++) {
      if (this.invSlots[i]?.id === num) {
        this.send({ t: 'click', window: 0, slot: i, button: this.selected, mode: 'swap', seq: 0 });
        return;
      }
    }
  }

  // ------------------------------------------------------------------ rendering
  private render(alpha: number, dt: number): void {
    const p = this.player;
    const [ex, ey, ez] = this.eyePos(alpha);
    const underwater = p.body.eyesInWater;
    const eyeState = this.world.getState(Math.floor(ex), Math.floor(ey), Math.floor(ez));
    const inLava = STATE_FLUID[eyeState] === 2;
    const biome = this.world.biomeAt(ex, ez);
    const bob = p.prevBob + (p.bob - p.prevBob) * alpha;
    const walk = p.prevWalkDist + (p.walkDist - p.prevWalkDist) * alpha;
    const crack: FrameState['crack'] = [];
    const dig = this.interaction.dig;
    if (dig) crack.push({ x: dig.x, y: dig.y, z: dig.z, stage: Math.min(9, Math.floor(dig.progress * 10)) });
    for (const d of this.otherDigs.values()) crack.push(d);
    const t = this.interaction.target;
    // Third person camera clipping
    let camDist = 4;
    if (this.thirdPerson !== 0) {
      const dir = lookDirection(p.yaw, p.pitch);
      const s = this.thirdPerson === 1 ? -1 : 1;
      const hit = raycastBlocks(this.world, ex, ey, ez, dir[0] * s, dir[1] * s, dir[2] * s, 4.2);
      if (hit) camDist = Math.max(0.3, Math.hypot(hit.px - ex, hit.py - ey, hit.pz - ez) - 0.3);
    }
    const nv = this.effectLevel('night_vision') > 0 ? 1 : 0;
    this.scopeZoom += ((this.scoping ? 0.1 : 1) - this.scopeZoom) * Math.min(1, dt / 60);
    this.scopeOverlay.classList.toggle('hidden', !this.scoping);
    const frost = this.stats?.freeze ?? 0;
    this.frostOverlay.style.opacity = frost > 0 && this.thirdPerson === 0 ? String(Math.min(1, frost)) : '0';
    this.powderOverlay.classList.toggle('hidden', !p.body.headInPowder || this.thirdPerson !== 0);
    const fs: FrameState = {
      x: ex,
      y: ey,
      z: ez,
      yaw: p.yaw,
      pitch: p.pitch,
      fovMod: p.fovMod * this.scopeZoom,
      bobPhase: walk,
      bobAmount: bob,
      dayTime: this.dayTime + alpha,
      time: this.tickNo + alpha,
      alpha,
      rain: this.world.hasSky ? this.rain : 0,
      thunder: this.thunder,
      underwater,
      inLava,
      biomeSky: biome.sky,
      target: t && !this.hudHidden ? { x: t.x, y: t.y, z: t.z, state: t.state } : null,
      crack,
      thirdPerson: this.thirdPerson,
      showHand: !this.hudHidden && p.gamemode !== 'spectator' && !this.scoping,
      nightVision: nv,
      flash: this.flash,
      shake: this.shake,
      darkness: this.darknessAmount(),
      cave: this.caveFog(),
      endAtmos: this.dimension === 'end' && this.endAtmos.state.amount > 0 ? this.endAtmos.state : undefined,
      hurtTilt: this.hurtTilt,
      camDist,
      portal: this.portalFx,
      nausea: this.effectLevel('nausea') > 0 && !this.settings.reduceMotion ? 1 : 0,
      portalColor: this.portalKind === 'far_portal' ? 0x2ad7c2 : this.portalKind === 'expansion_portal' ? 0x9ad8ff : 0x8a2be2,
    };
    // Lines (fishing, leads) end at the local player's hand: lower right of the view
    const game = this;
    this.renderer.entities.local ??= {
      get id() {
        return game.player.entityId;
      },
      hand: () => {
        const [ex, ey, ez] = game.eyePos(game.lastAlpha);
        const yaw = game.player.yaw;
        const pitch = game.player.pitch;
        const cp = Math.cos(pitch);
        const fx = -Math.sin(yaw) * cp;
        const fy = -Math.sin(pitch);
        const fz = -Math.cos(yaw) * cp;
        const rx = -Math.cos(yaw);
        const rz = Math.sin(yaw);
        return [ex + fx * 0.5 - rx * 0.3, ey + fy * 0.5 - 0.25, ez + fz * 0.5 - rz * 0.3];
      },
    };
    this.lastAlpha = alpha;
    // Local player model (third person)
    this.renderer.entities.update(this.entities.values(), alpha, this.tickNo + alpha, (x, y, z) => this.renderer.lightAt(x, y, z));
    this.renderer.render(fs);
    const cam = this.renderer.camera.position;
    const light = this.renderer.lightAt(cam.x, cam.y, cam.z);
    this.renderer.weather.update(cam, this.world.hasSky ? this.rain : 0, dt / 1000, light, (x, z, y) => this.snowAt(x, z, y), (x, y, z) => this.renderer.particles.spawn('rain_splash', x, y, z, 1, 0.1));
    this.audio.setListener(ex, ey, ez, p.yaw, p.pitch, underwater);
    this.chat.update();
    this.playerList.update(this.players, this.input.held.has(this.settings.keys.playerList) && !this.uiBlocking, this.worldInfo);
    if (this.debug && performance.now() - this.lastDebugUpdate > 200) {
      this.lastDebugUpdate = performance.now();
      this.updateDebug();
    }
    if (this.thumbRequests.length) {
      // Must read the WebGL canvas in the same task as the render
      const reqs = this.thumbRequests.splice(0);
      for (const r of reqs) {
        try {
          const c = document.createElement('canvas');
          c.width = r.size;
          c.height = r.size;
          const src = this.canvas;
          const size = Math.min(src.width, src.height);
          c.getContext('2d')!.drawImage(src, (src.width - size) / 2, (src.height - size) / 2, size, size, 0, 0, r.size, r.size);
          r.resolve(c.toDataURL('image/png'));
        } catch {
          r.resolve(null);
        }
      }
    }
    if (this.screenshotPending) {
      this.screenshotPending = false;
      this.canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `minehonk-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        this.chat.add('Saved screenshot as ' + a.download, 'system');
      });
    }
  }

  private snowAt(x: number, z: number, y: number): boolean {
    const b = this.world.biomeAt(x, z);
    if (b.precipitation === 'snow') return true;
    // Temperature drops with altitude
    return b.precipitation === 'rain' && b.temperature - Math.max(0, y - 90) * 0.0125 < 0.15;
  }

  private updateDebug(): void {
    const p = this.player;
    const b = p.body;
    const bx = Math.floor(b.x);
    const by = Math.floor(b.y);
    const bz = Math.floor(b.z);
    const deg = ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north', 'west', 'south', 'east'][Math.round(((p.yaw % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 2)) % 4];
    const light = this.world.getLight(bx, Math.floor(b.y + 1), bz);
    const cs = this.renderer.chunks.stats();
    const biome = this.world.biomeAt(b.x, b.z);
    // V6: the Expanded End's biome by name
    const expanded = this.dimension === 'end' ? EndAtmosphere.biomeAt((x, z) => this.world.biomeAt(x, z), b.x, b.z) : null;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const left = [
      `MineHonk (${this.fps} fps, ${this.renderer.chunks.meshedLastSecond} chunk updates)`,
      `Chunks: ${this.world.chunks.size} loaded, ${cs.drawn}/${cs.sections} sections drawn, ${cs.dirty} pending, ${cs.jobs} building`,
      `Entities: ${this.entities.size}  Particles: ${this.renderer.particles.count}`,
      `Dimension: ${this.dimension}`,
      '',
      `XYZ: ${b.x.toFixed(3)} / ${b.y.toFixed(5)} / ${b.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}  Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      `Facing: ${facing} (${deg.toFixed(1)} / ${((p.pitch * 180) / Math.PI).toFixed(1)})`,
      `Light: ${Math.max(light >> 4, light & 15)} (${light >> 4} sky, ${light & 15} block)`,
      `Biome: ${biome.id}`,
      ...(expanded ? [`Expanded End: ${expanded.name}`] : []),
      `Day ${Math.floor(this.time / 24000)}, time ${Math.floor(this.dayTime)}`,
      `Mode: ${p.gamemode}${p.flying ? ' (flying)' : ''}  Ping: ${this.ping} ms`,
    ];
    if (this.debugData && Object.keys(this.debugData).length) for (const [k, v] of Object.entries(this.debugData)) left.push(`${k}: ${String(v)}`);
    const right: string[] = [`Mesh: ${this.renderer.chunks.lastMeshMs.toFixed(1)} ms`, `Quads: ${cs.drawnQuads} of ${cs.quads} drawn`];
    if (mem) right.push(`Mem: ${Math.round(mem.usedJSHeapSize / 1048576)} / ${Math.round(mem.jsHeapSizeLimit / 1048576)} MB`);
    right.push(`Renderer: ${this.renderer.renderer.info.render.calls} calls, ${this.renderer.renderer.info.render.triangles} tris`);
    const t = this.interaction.target;
    if (t) {
      const blk = blocks[STATE_BLOCK[t.state]!]!;
      right.push('', 'Targeted Block:', `${t.x}, ${t.y}, ${t.z}`, blk.id);
      const props = blk.def.props ? Object.keys(blk.def.props) : [];
      if (props.length) right.push(`state #${t.state}`);
    }
    if (this.entityTarget) right.push('', 'Targeted Entity:', `${this.entityTarget.type} #${this.entityTarget.id}`);
    const held = this.held();
    if (held) right.push('', `Held: ${items[held.id]!.id} x${held.count}` + (enchantLevel(held, 'efficiency') ? ' (efficiency)' : ''));
    this.hud.setDebug(left, right);
  }

  // ------------------------------------------------------------------ admin panel

  get name(): string {
    return this.playerName ?? '';
  }

  chatMessage(text: string, kind: 'system' | 'error' = 'system'): void {
    this.chat.add(text, kind);
  }

  /** Sends an Admin Panel request; resolves with the server's final answer. */
  adminRequest(action: AdminAction, onProgress?: (r: AdminReply) => void): Promise<AdminReply> {
    const req = this.adminReq++;
    this.send({ t: 'admin', req, action });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.adminWaiters.delete(req)) resolve({ ok: false, text: 'No answer from the server.' });
      }, 120000);
      this.adminWaiters.set(req, {
        done: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        progress: onProgress,
      });
    });
  }

  private onAdminResult(m: { req: number; ok: boolean; text: string; data?: unknown }): void {
    const w = this.adminWaiters.get(m.req);
    if (!w) {
      if (m.text) this.chat.add(m.text, m.ok ? 'system' : 'error');
      return;
    }
    // Teleports report progress first ("preparing a safe landing"), then the result
    if (m.ok && (m.data as { pending?: boolean } | undefined)?.pending) {
      w.progress?.(m);
      return;
    }
    this.adminWaiters.delete(m.req);
    w.done(m);
  }

  private updateCheatsIndicator(): void {
    const w = this.worldInfo;
    this.hud.setCheats(!w?.cheats ? 'off' : w.admin ? 'admin' : 'on', keyName(this.settings.keys.adminPanel));
  }

  /** Figures for the Admin Panel's performance tab. */
  perfInfo(): Record<string, string | number> {
    const r = this.renderer;
    const info = r.renderer.info;
    const cs = r.chunks.stats();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      FPS: this.fps,
      'Draw calls': info.render.calls,
      Triangles: info.render.triangles.toLocaleString(),
      'Loaded chunks': this.world.chunks.size,
      'Sections drawn': `${cs.drawn} of ${cs.sections}`,
      'Faces drawn': `${cs.drawnQuads.toLocaleString()} of ${cs.quads.toLocaleString()}`,
      'Render regions': cs.regions,
      'Meshing queue': cs.dirty + cs.jobs,
      'Chunk updates/s': r.chunks.meshedLastSecond,
      Entities: this.entities.size,
      Particles: r.particles.count,
      'Render distance': `${this.settings.renderDistance} chunks`,
      'JS memory': mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB` : 'n/a',
    };
  }

  // ------------------------------------------------------------------ lifecycle
  /** Captures a square thumbnail of the next rendered frame. */
  requestThumbnail(size: number): Promise<string | null> {
    return new Promise((resolve) => this.thumbRequests.push({ size, resolve }));
  }

  respawn(): void {
    this.send({ t: 'respawn' });
  }

  /** Stops the game loop and releases resources. The host handles saving. */
  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    this.input.onKeyDown = null;
    this.input.unlock();
    this.closeScreenLocal();
    this.sign?.destroy();
    this.audio.stopAll();
    this.touch.dispose();
    this.renderer.dispose();
    this.root.remove();
    this.conn.onMessage = () => {};
    this.conn.onClose = () => {};
  }

  applySettings(rebuildChunks = false): void {
    this.renderer.resize();
    if (rebuildChunks) this.renderer.chunks.rebuildAll();
    this.audio.applyVolumes();
    this.send({ t: 'settings', viewDistance: this.settings.renderDistance });
  }
}
