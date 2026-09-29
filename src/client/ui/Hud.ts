/** In-game heads-up display. */
import { el, clear } from './dom';
import { sprites } from './sprites';
import { fillSlot, itemDisplayName } from './slots';
import type { PlayerStats } from '../../common/net/protocol';
import type { Slot } from '../../common/game/itemstack';

export interface HudState {
  stats: PlayerStats;
  hotbar: Slot[];
  /** Per hotbar slot: remaining item cooldown 0..1. */
  cooldowns?: number[];
  offhand: Slot;
  selected: number;
  survival: boolean;
  hardcore: boolean;
  spectator: boolean;
  mounted?: boolean;
}

export class Hud {
  readonly root = el('div', { class: 'layer' });
  private readonly bottom = el('div', { class: 'hud' });
  private readonly hotbarEl = el('div', { class: 'hotbar' });
  private readonly selEl = el('div', { class: 'sel' });
  private readonly hslots: HTMLElement[] = [];
  private readonly hearts = el('div', { class: 'stat-row' });
  private readonly heartLabel = el('div', { class: 'hp-label' });
  private readonly food = el('div', { class: 'stat-row' });
  private readonly armor = el('div', { class: 'stat-row' });
  private readonly air = el('div', { class: 'stat-row' });
  private readonly xpbar = el('div', { class: 'xpbar' });
  private readonly xpfill = el('div', { class: 'fill' });
  private readonly xplevel = el('div', { class: 'xplevel' });
  private readonly itemName = el('div', { class: 'item-name shadow' });
  private readonly crosshair = el('div', { class: 'crosshair' });
  private readonly bosses = el('div', { class: 'boss-bars' });
  private readonly title = el('div', { class: 'title-overlay' });
  readonly debugLeft = el('div', { class: 'debug' });
  readonly debugRight = el('div', { class: 'debug-right' });
  private readonly toastEl = el('div', { class: 'toast', style: { transform: 'translateX(120%)' } });
  private readonly subtitlesEl = el('div', { class: 'subtitles' });
  /** Small, unobtrusive notice that cheats are on in this world. */
  private readonly cheatsEl = el('div', { class: 'cheats-indicator hidden' });
  private itemNameTimer = 0;
  private lastSelectedName = '';
  private titleTimer = 0;
  private toastTimer = 0;
  private readonly toastQueue: { t1: string; t2: string }[] = [];
  private lastKey = '';
  private readonly bossBars = new Map<number, HTMLElement>();
  private heartShake = 0;
  private prevHealth = -1;
  visible = true;

  constructor() {
    const sp = sprites();
    this.crosshair.style.backgroundImage = `url(${sp.crosshair})`;
    for (let i = 0; i < 9; i++) {
      const s = el('div', { class: 'hslot' });
      this.hslots.push(s);
      this.hotbarEl.append(s);
    }
    this.hotbarEl.append(this.selEl);
    this.xpbar.append(this.xpfill);
    this.bottom.append(this.hotbarEl, this.xpbar, this.xplevel, this.hearts, this.heartLabel, this.food, this.armor, this.air, this.itemName);
    this.root.append(this.crosshair, this.bottom, this.bosses, this.title, this.debugLeft, this.debugRight, this.toastEl, this.subtitlesEl, this.cheatsEl);
    this.toastEl.append(el('div', { class: 't1' }), el('div', { class: 't2' }));
    this.title.style.opacity = '0';
  }

  private icons(row: HTMLElement, list: string[], rightAlign: boolean, jitter?: (i: number) => number): void {
    clear(row);
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const d = el('div', { class: 'ico' });
      d.style.backgroundImage = `url(${list[i]})`;
      if (jitter) d.style.transform = `translateY(calc(var(--s) * ${jitter(i)}))`;
      row.append(d);
    }
    if (rightAlign) row.style.flexDirection = 'row-reverse';
  }

  update(s: HudState, tickTime: number): void {
    this.root.classList.toggle('hidden', !this.visible);
    const sp = sprites();
    const st = s.stats;
    // hotbar
    const key = JSON.stringify([s.hotbar, s.selected]);
    if (key !== this.lastKey) {
      this.lastKey = key;
      s.hotbar.forEach((stack, i) => fillSlot(this.hslots[i]!, stack));
    }
    this.selEl.style.left = `calc(var(--s) * ${-2 + s.selected * 20})`;
    s.hotbar.forEach((_, i) => {
      const slot = this.hslots[i]!;
      const f = s.cooldowns?.[i] ?? 0;
      let cd = slot.querySelector<HTMLElement>('.cooldown');
      if (f <= 0) {
        cd?.remove();
        return;
      }
      if (!cd) {
        cd = el('div', { class: 'cooldown' });
        slot.append(cd);
      }
      cd.style.height = `${Math.round(f * 100)}%`;
    });
    const name = itemDisplayName(s.hotbar[s.selected] ?? null);
    if (name !== this.lastSelectedName) {
      this.lastSelectedName = name;
      this.itemNameTimer = name ? 40 : 0;
      this.itemName.textContent = name;
    }
    if (this.itemNameTimer > 0) this.itemNameTimer--;
    this.itemName.style.opacity = String(Math.min(1, this.itemNameTimer / 10));
    const showStats = s.survival && !s.spectator;
    this.hearts.classList.toggle('hidden', !showStats);
    this.food.classList.toggle('hidden', !showStats);
    this.xpbar.classList.toggle('hidden', s.spectator);
    this.xplevel.classList.toggle('hidden', s.spectator || st.level <= 0);
    this.hotbarEl.classList.toggle('hidden', s.spectator);
    this.itemName.style.bottom = showStats ? 'calc(var(--s) * 59)' : 'calc(var(--s) * 32)';
    this.xpfill.style.width = `${Math.min(100, st.xpProgress * 100)}%`;
    this.xplevel.textContent = String(st.level);
    if (!showStats) {
      this.armor.classList.add('hidden');
      this.air.classList.add('hidden');
      this.heartLabel.classList.add('hidden');
      return;
    }
    // hearts
    if (this.prevHealth >= 0 && st.health < this.prevHealth) this.heartShake = 10;
    this.prevHealth = st.health;
    if (this.heartShake > 0) this.heartShake--;
    const poison = st.effects.some((e) => e.id === 'poison');
    const wither = st.effects.some((e) => e.id === 'wither');
    const full = s.hardcore ? sp.heartHardcore : poison ? sp.heartPoison : wither ? sp.heartWither : sp.heart;
    const half = s.hardcore ? sp.heartHardcoreHalf : poison ? sp.heartPoisonHalf : wither ? sp.heartWitherHalf : sp.heartHalf;
    const infinite = !Number.isFinite(st.maxHealth);
    const maxHearts = infinite ? 0 : Math.ceil(st.maxHealth / 2);
    const low = !infinite && st.health <= 4;
    const jitter = (i: number): number => (low ? ((i * 7 + Math.floor(tickTime)) % 3) - 1 : 0) + (this.heartShake > 0 && this.heartShake % 2 === 0 ? -1 : 0);
    const heartIcons: string[] = [];
    let label = '';
    if (infinite) {
      heartIcons.push(sp.heartInfinite);
      label = '∞';
    } else if (maxHearts <= 20) {
      const hp = Math.ceil(st.health);
      for (let i = 0; i < maxHearts; i++) {
        const v = hp - i * 2;
        heartIcons.push(v >= 2 ? full : v === 1 ? half : sp.heartEmpty);
      }
    } else {
      // Compact display for very large health pools (God Mode)
      const frac = st.health / st.maxHealth;
      for (let i = 0; i < 10; i++) {
        const v = frac * 20 - i * 2;
        heartIcons.push(v >= 2 ? full : v >= 1 ? half : sp.heartEmpty);
      }
      label = `${Math.ceil(st.health / 2)}/${maxHearts}`;
    }
    const absorb = Math.ceil(st.absorption / 2);
    for (let i = 0; i < absorb && heartIcons.length < 40; i++) heartIcons.push(i * 2 + 1 === Math.ceil(st.absorption) ? sp.heartGoldHalf : sp.heartGold);
    const rows = Math.ceil(heartIcons.length / 10);
    clear(this.hearts);
    this.hearts.style.flexDirection = 'column-reverse';
    this.hearts.style.height = 'auto';
    const rowGap = rows > 2 ? Math.max(3, 10 - (rows - 2) * 2) : 10;
    for (let r = 0; r < rows; r++) {
      const row = el('div', { style: { display: 'flex', height: `calc(var(--s) * ${rowGap})` } });
      this.icons(row, heartIcons.slice(r * 10, r * 10 + 10), false, (i) => jitter(i + r * 10));
      this.hearts.append(row);
    }
    this.hearts.style.left = '0';
    this.hearts.style.bottom = 'calc(var(--s) * 30)';
    this.heartLabel.classList.toggle('hidden', !label);
    this.heartLabel.textContent = label;
    let heartRowsHeight = infinite ? 10 : 10 + (rows - 1) * rowGap;
    // '∞' sits beside the single heart; large counts go above the compact row
    // (there is no room between the hearts and the hunger bar).
    this.heartLabel.style.left = `calc(var(--s) * ${infinite ? 11 : 0})`;
    this.heartLabel.style.bottom = `calc(var(--s) * ${infinite ? 30 : 30 + heartRowsHeight})`;
    this.heartLabel.style.color = infinite ? '#ff80ff' : '#ff5555';
    if (label && !infinite) heartRowsHeight += 9;
    // food
    const hunger = st.effects.some((e) => e.id === 'hunger');
    const foodIcons: string[] = [];
    for (let i = 0; i < 10; i++) {
      const v = st.food - i * 2;
      foodIcons.push(v >= 2 ? (hunger ? sp.foodHunger : sp.food) : v === 1 ? (hunger ? sp.foodHungerHalf : sp.foodHalf) : sp.foodEmpty);
    }
    this.icons(this.food, foodIcons, true, (i) => (st.saturation <= 0 && Math.floor(tickTime / 2 + i) % 7 === 0 ? -1 : 0));
    this.food.style.right = '0';
    this.food.style.bottom = 'calc(var(--s) * 30)';
    // armor (above hearts)
    this.armor.classList.toggle('hidden', st.armor <= 0);
    if (st.armor > 0) {
      const a: string[] = [];
      for (let i = 0; i < 10; i++) {
        const v = st.armor - i * 2;
        a.push(v >= 2 ? sp.armor : v === 1 ? sp.armorHalf : sp.armorEmpty);
      }
      this.icons(this.armor, a, false);
      this.armor.style.left = '0';
      this.armor.style.bottom = `calc(var(--s) * ${30 + heartRowsHeight})`;
    }
    // air (above food)
    const underwater = st.air < st.maxAir;
    this.air.classList.toggle('hidden', !underwater);
    if (underwater) {
      const bubbles: string[] = [];
      const n = Math.ceil((Math.max(0, st.air) / st.maxAir) * 10);
      for (let i = 0; i < 10; i++) bubbles.push(i < n ? sp.bubble : i === n ? sp.bubblePop : '');
      this.icons(this.air, bubbles.filter(Boolean), true);
      this.air.style.right = '0';
      this.air.style.bottom = 'calc(var(--s) * 40)';
    }
  }

  setCrosshair(visible: boolean): void {
    this.crosshair.classList.toggle('hidden', !visible);
  }

  showTitle(text: string, sub = '', ticks = 60): void {
    clear(this.title);
    this.title.append(el('div', {}, text));
    if (sub) this.title.append(el('div', { class: 'sub' }, sub));
    this.title.style.opacity = '1';
    this.titleTimer = ticks;
  }

  toast(t1: string, t2: string): void {
    this.toastQueue.push({ t1, t2 });
  }

  setBoss(id: number, action: 'add' | 'update' | 'remove', title?: string, progress?: number): void {
    let b = this.bossBars.get(id);
    if (action === 'remove') {
      b?.remove();
      this.bossBars.delete(id);
      return;
    }
    if (!b) {
      b = el('div', { class: 'boss-bar' }, el('div', { class: 'shadow', style: { textAlign: 'center' } }), el('div', { class: 'bar' }, el('div')));
      this.bossBars.set(id, b);
      this.bosses.append(b);
    }
    if (title !== undefined) (b.children[0] as HTMLElement).textContent = title;
    if (progress !== undefined) ((b.children[1] as HTMLElement).children[0] as HTMLElement).style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }

  hasBoss(): boolean {
    return this.bossBars.size > 0;
  }

  subtitle(text: string): void {
    const d = el('div', {}, text);
    this.subtitlesEl.append(d);
    setTimeout(() => d.remove(), 2500);
    while (this.subtitlesEl.childElementCount > 6) this.subtitlesEl.firstElementChild?.remove();
  }

  tick(): void {
    if (this.titleTimer > 0) {
      this.titleTimer--;
      if (this.titleTimer === 0) this.title.style.opacity = '0';
    }
    if (this.toastTimer > 0) {
      this.toastTimer--;
      if (this.toastTimer === 20) this.toastEl.style.transform = 'translateX(120%)';
    } else if (this.toastQueue.length) {
      const t = this.toastQueue.shift()!;
      (this.toastEl.children[0] as HTMLElement).textContent = t.t1;
      (this.toastEl.children[1] as HTMLElement).textContent = t.t2;
      this.toastEl.style.transform = 'translateX(0)';
      this.toastTimer = 120;
    }
  }

  /** 'off' hides the notice; 'on' = cheats enabled; 'admin' = this player can use the Admin Panel. */
  setCheats(state: 'off' | 'on' | 'admin', key = 'F8'): void {
    this.cheatsEl.classList.toggle('hidden', state === 'off');
    this.cheatsEl.textContent = state === 'admin' ? `Cheats enabled · Admin Panel: ${key}` : 'Cheats enabled';
  }

  setDebug(left: string[] | null, right: string[] | null): void {
    this.debugLeft.classList.toggle('hidden', !left);
    this.debugRight.classList.toggle('hidden', !right);
    if (left) this.debugLeft.innerHTML = left.map((l) => `<span>${escapeHtml(l)}</span>`).join('\n');
    if (right) this.debugRight.innerHTML = right.map((l) => `<span>${escapeHtml(l)}</span>`).join('\n');
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
