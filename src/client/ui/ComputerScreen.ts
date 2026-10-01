/**
 * V5.5: a computer's window. The server runs the programs and sends what the
 * screen shows (PcView, in the window props); this draws it and sends the
 * buttons' commands back (pc_cmd). Two tabs: the screen, and the hardware
 * (the case opened: its twelve slots, what it detects around it, and the
 * player's inventory). Old terminals in the computer world show only their
 * screen.
 */
import { el, clear } from './dom';
import type { PcView, UiBlock, UiButton, UiRow, Tone } from '../../common/digital/view';

export interface ComputerHost {
  /** A window slot element (index into the window's slots). */
  slot(i: number): HTMLElement;
  /** The player's inventory section, starting at window slot `offset`. */
  invSection(offset: number): HTMLElement;
  /** Sends a button's command. */
  cmd(cmd: string, arg?: string | number): void;
}

const SLOT_GROUPS: { label: string; slots: number[] }[] = [
  { label: 'Power Supply', slots: [0] },
  { label: 'Motherboard', slots: [1] },
  { label: 'CPU', slots: [2] },
  { label: 'RAM', slots: [3, 4, 5, 6] },
  { label: 'Hard Drives', slots: [7, 8] },
  { label: 'Graphics', slots: [9] },
  { label: 'Network', slots: [10] },
  { label: 'USB', slots: [11] },
];

const STATE_TEXT: Record<PcView['state'], string> = {
  off: 'Off',
  no_power: 'No power',
  missing: 'Missing parts',
  post: 'Starting',
  bios: 'BIOS',
  desktop: 'Running',
  takeover: '██████',
  gateway: '. . .',
};

export class ComputerPanel {
  private view: PcView;
  private tab: 'screen' | 'hw' = 'screen';
  private readonly gui: HTMLElement;
  private screenEl!: HTMLElement;
  private appsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private stateEl!: HTMLElement;
  private energyEl!: HTMLElement;
  private powerBtn!: HTMLButtonElement;
  private hwInfoEl!: HTMLElement;
  private screenTab!: HTMLElement;
  private hwTab!: HTMLElement;
  private tabBtns: HTMLElement[] = [];
  private sig = '';
  private readonly terminal: boolean;

  constructor(gui: HTMLElement, view: PcView, private readonly host: ComputerHost) {
    this.gui = gui;
    this.view = view;
    this.terminal = !!view.terminal;
    this.build();
    this.update(view);
  }

  private build(): void {
    const g = this.gui;
    g.classList.add('pc-gui');
    if (this.terminal) g.classList.add('pc-terminal');
    // The case's top: name, state, energy, power, tabs
    this.stateEl = el('span', { class: 'pc-state' });
    this.energyEl = el('div', { class: 'pc-energy' }, el('div', { class: 'pc-energy-fill' }));
    this.powerBtn = el('button', { class: 'pc-power', title: 'Power' }, '⏻') as HTMLButtonElement;
    this.powerBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.host.cmd('power');
    });
    const top = el('div', { class: 'pc-top' }, el('span', { class: 'pc-name' }, this.view.name), this.stateEl);
    if (!this.terminal) {
      const tabs = el('div', { class: 'pc-tabs' });
      for (const [id, label] of [
        ['screen', 'Screen'],
        ['hw', 'Hardware'],
      ] as const) {
        const b = el('div', { class: 'pc-tab' + (id === this.tab ? ' active' : '') }, label);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.tab = id;
          this.syncTabs();
        });
        this.tabBtns.push(b);
        tabs.append(b);
      }
      top.append(el('div', { class: 'pc-grow' }), this.energyEl, this.powerBtn, tabs);
    }
    g.append(top);
    // The screen
    this.appsEl = el('div', { class: 'pc-apps' });
    this.titleEl = el('div', { class: 'pc-title' });
    this.bodyEl = el('div', { class: 'pc-body' });
    this.screenEl = el('div', { class: 'pc-screen' }, el('div', { class: 'pc-scan' }), this.appsEl, el('div', { class: 'pc-main' }, this.titleEl, this.bodyEl));
    this.screenTab = el('div', { class: 'pc-pane' }, el('div', { class: 'pc-bezel' }, this.screenEl));
    g.append(this.screenTab);
    if (this.terminal) return;
    // The hardware
    const slots = el('div', { class: 'pc-slots' });
    for (const grp of SLOT_GROUPS) {
      const row = el('div', { class: 'pc-slot-row' }, ...grp.slots.map((i) => this.host.slot(i)));
      slots.append(el('div', { class: 'pc-slot-group' }, el('div', { class: 'eng-label' }, grp.label), row));
    }
    this.hwInfoEl = el('div', { class: 'pc-hwinfo' });
    this.hwTab = el('div', { class: 'pc-pane pc-hw' }, el('div', { class: 'row pc-hw-row' }, slots, this.hwInfoEl), this.host.invSection(12));
    g.append(this.hwTab);
    this.syncTabs();
  }

  private syncTabs(): void {
    if (this.terminal) return;
    this.screenTab.style.display = this.tab === 'screen' ? '' : 'none';
    this.hwTab.style.display = this.tab === 'hw' ? '' : 'none';
    this.tabBtns.forEach((b, i) => b.classList.toggle('active', (i === 0) === (this.tab === 'screen')));
  }

  update(view: PcView): void {
    this.view = view;
    const sig = JSON.stringify(view);
    if (sig === this.sig) return;
    this.sig = sig;
    const v = view;
    this.stateEl.textContent = STATE_TEXT[v.state] ?? v.state;
    this.stateEl.className = 'pc-state ' + v.state;
    if (!this.terminal) {
      const f = v.energyMax ? Math.max(0, Math.min(1, v.energy / v.energyMax)) : 0;
      (this.energyEl.firstChild as HTMLElement).style.width = `${f * 100}%`;
      this.energyEl.title = `Energy: ${v.energy.toLocaleString('en-US')} / ${v.energyMax.toLocaleString('en-US')} EU · uses ${v.use.toFixed(1)} EU/t`;
      this.powerBtn.classList.toggle('on', v.power);
      this.powerBtn.disabled = v.state === 'takeover' || v.state === 'gateway';
    }
    // Screen
    const scr = this.screenEl;
    scr.className = 'pc-screen st-' + v.state + (v.glitch ? ' glitching' : '');
    scr.style.setProperty('--glitch', String(v.glitch ?? 0));
    clear(this.appsEl);
    this.appsEl.style.display = v.apps.length ? '' : 'none';
    if (v.apps.length) {
      const home = el('div', { class: 'pc-app' + (v.app === '' ? ' active' : '') }, v.state === 'bios' ? 'BIOS' : 'Desktop');
      home.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.host.cmd('home');
      });
      this.appsEl.append(home);
      for (const a of v.apps) {
        const b = el('div', { class: 'pc-app' + (a.id === v.app ? ' active' : '') + (a.ok ? '' : ' locked'), title: a.ok ? a.name : `${a.name}: ${a.why}` }, a.name);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.host.cmd('app', a.id);
        });
        this.appsEl.append(b);
      }
    }
    this.titleEl.textContent = v.title;
    this.titleEl.style.display = v.title ? '' : 'none';
    clear(this.bodyEl);
    if (v.message) this.bodyEl.append(el('div', { class: 'pc-message' }, v.message));
    for (const b of v.blocks) {
      const e = this.block(b);
      if (e) this.bodyEl.append(e);
    }
    if (!this.terminal) this.renderHw(v);
  }

  private tone(t?: Tone): string {
    return t ? ' tone-' + t : '';
  }

  private button(b: UiButton): HTMLElement {
    const btn = el('button', { class: 'pc-btn' + this.tone(b.tone) + (b.on === true ? ' on' : b.on === false ? ' off' : ''), disabled: !!b.disabled }, b.label) as HTMLButtonElement;
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (!b.disabled) this.host.cmd(b.cmd, b.arg);
    });
    return btn;
  }

  private row(r: UiRow): HTMLElement {
    const e = el('div', { class: 'pc-row' + this.tone(r.tone) + (r.sel ? ' sel' : '') + (r.cmd ? ' click' : '') }, el('span', { class: 'pc-row-text' }, r.text), r.sub ? el('span', { class: 'pc-row-sub' }, r.sub) : null);
    if (r.cmd) {
      e.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        this.host.cmd(r.cmd!, r.arg);
      });
    }
    if (r.btns?.length) e.append(el('span', { class: 'pc-row-btns' }, ...r.btns.map((b) => this.button(b))));
    return e;
  }

  private block(b: UiBlock): HTMLElement | null {
    switch (b.t) {
      case 'h':
        return el('div', { class: 'pc-h' }, b.text);
      case 'p':
        return el('div', { class: 'pc-p' + this.tone(b.tone) }, b.text);
      case 'kv':
        return el('div', { class: 'pc-kv' + this.tone(b.tone) }, el('span', { class: 'k' }, b.k), el('span', { class: 'v' }, b.v));
      case 'bar': {
        const f = b.max > 0 ? Math.max(0, Math.min(1, b.value / b.max)) : 0;
        return el('div', { class: 'pc-bar' + this.tone(b.tone) }, el('div', { class: 'pc-bar-label' }, b.label), el('div', { class: 'pc-bar-track' }, el('div', { class: 'pc-bar-fill', style: { width: `${f * 100}%` } })));
      }
      case 'btns':
        return el('div', { class: 'pc-btns' }, ...b.items.map((x) => this.button(x)));
      case 'list': {
        const list = el('div', { class: 'pc-list' });
        if (!b.rows.length && b.empty) list.append(el('div', { class: 'pc-row tone-dim' }, b.empty));
        for (const r of b.rows) list.append(this.row(r));
        return list;
      }
      case 'text':
        return el('pre', { class: 'pc-text' + this.tone(b.tone) }, b.lines.join('\n'));
      case 'map':
        return this.map(b);
    }
    return null;
  }

  private map(b: Extract<UiBlock, { t: 'map' }>): HTMLElement {
    const c = el('canvas', { class: 'pc-map', width: b.w, height: b.h }) as HTMLCanvasElement;
    const g = c.getContext('2d');
    if (g) {
      const img = g.createImageData(b.w, b.h);
      for (let i = 0; i < b.w * b.h; i++) {
        const col = b.colors[i] ?? 0;
        img.data[i * 4] = (col >> 16) & 255;
        img.data[i * 4 + 1] = (col >> 8) & 255;
        img.data[i * 4 + 2] = col & 255;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      if (b.marker) {
        g.fillStyle = '#ff3b3b';
        g.fillRect(b.marker[0] - 1, b.marker[1] - 1, 3, 3);
      }
    }
    return c;
  }

  private renderHw(v: PcView): void {
    const h = this.hwInfoEl;
    clear(h);
    h.append(el('div', { class: 'eng-label' }, 'Detected'));
    for (const x of v.hw) h.append(el('div', { class: 'pc-hw-line ' + (x.ok ? 'ok' : 'bad') }, `${x.ok ? '✔' : '✘'} ${x.label}${x.detail ? ` (${x.detail})` : ''}`));
    const p = v.periph;
    h.append(el('div', { class: 'eng-label', style: { marginTop: 'calc(var(--s) * 3)' } }, 'Beside it'));
    const line = (ok: boolean, text: string): HTMLElement => el('div', { class: 'pc-hw-line ' + (ok ? 'ok' : 'dim') }, `${ok ? '✔' : '·'} ${text}`);
    h.append(line(p.monitors > 0, `Monitors: ${p.monitors}`), line(p.keyboard, 'Keyboard'), line(p.mouse, 'Mouse'), line(p.speaker, 'Speaker'), line(p.leds > 0, `LEDs: ${p.leds}`));
    h.append(el('div', { class: 'pc-hw-use' }, `Uses ${v.use.toFixed(1)} EU/t while running`));
  }
}
