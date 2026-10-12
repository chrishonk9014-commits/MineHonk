/** Chat display and input. */
import { el } from './dom';
import type { ChatKind } from '../../common/net/protocol';

interface Line {
  el: HTMLElement;
  time: number;
}

const COLORS: Record<ChatKind, string> = {
  chat: '#ffffff',
  system: '#ffff55',
  join: '#ffff55',
  leave: '#ffff55',
  death: '#ffffff',
  announce: '#55ffff',
  error: '#ff5555',
  achievement: '#ffffff',
  whisper: '#aaaaaa',
  herobrine: '#ff3030',
};

export class Chat {
  readonly root = el('div', { class: 'chat' });
  readonly input = el('input', { class: 'chat-input hidden', maxLength: 256 }) as HTMLInputElement;
  private readonly lines: Line[] = [];
  private readonly history: string[] = [];
  private histIndex = -1;
  open = false;
  /** How Herobrine's words glitch (the Glitch Effects setting). */
  glitchFx: 'full' | 'reduced' | 'off' = 'full';
  onSend: (text: string) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = this.input.value.trim();
        if (v) {
          this.onSend(v);
          this.history.unshift(v);
          if (this.history.length > 100) this.history.pop();
        }
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      } else if (e.key === 'ArrowUp') {
        if (this.histIndex < this.history.length - 1) this.input.value = this.history[++this.histIndex]!;
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        if (this.histIndex > 0) this.input.value = this.history[--this.histIndex]!;
        else {
          this.histIndex = -1;
          this.input.value = '';
        }
        e.preventDefault();
      }
    });
  }

  add(text: string, kind: ChatKind = 'chat', from?: string): void {
    const line = el('div', { class: 'line' });
    if (from) line.append(el('span', {}, `<${from}> `));
    const body = el('span', {}, text);
    body.style.color = COLORS[kind];
    if (kind === 'achievement') {
      const m = /^(.*)\[(.*)\]$/.exec(text);
      if (m) {
        body.textContent = m[1]!;
        const a = el('span', {}, `[${m[2]}]`);
        a.style.color = '#55ff55';
        line.append(body, a);
      } else line.append(body);
    } else line.append(body);
    if (kind === 'herobrine') {
      line.classList.add('chat-herobrine');
      if (this.glitchFx !== 'off') {
        if (this.glitchFx === 'reduced') line.classList.add('calm');
        scramble(body, text, this.glitchFx === 'reduced' ? 700 : 1800);
      }
    }
    this.root.append(line);
    this.lines.push({ el: line, time: performance.now() });
    while (this.lines.length > 100) this.lines.shift()!.el.remove();
  }

  openInput(prefix = ''): void {
    this.open = true;
    this.histIndex = -1;
    this.root.classList.add('open');
    this.input.classList.remove('hidden');
    this.input.value = prefix;
    setTimeout(() => {
      this.input.focus();
      this.input.setSelectionRange(prefix.length, prefix.length);
    }, 0);
  }

  close(): void {
    this.open = false;
    this.root.classList.remove('open');
    this.input.classList.add('hidden');
    this.input.blur();
    this.onClose();
  }

  update(): void {
    const now = performance.now();
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i]!;
      const age = (now - l.time) / 1000;
      const visible = this.open || age < 10;
      l.el.style.display = visible || i >= this.lines.length - 10 ? '' : 'none';
      l.el.style.opacity = this.open ? '1' : String(Math.max(0, Math.min(1, (10 - age) / 1.5)));
      if (!this.open && i < this.lines.length - 10) l.el.style.display = 'none';
    }
  }
}

const GLYPHS = '#@%&?!*/\\|<>01$=+~^';

/** Text that tears itself apart and settles into its words. */
function scramble(node: HTMLElement, text: string, ms: number): void {
  const t0 = performance.now();
  const step = (): void => {
    const k = (performance.now() - t0) / ms;
    if (k >= 1) {
      node.textContent = text;
      return;
    }
    let out = '';
    for (const ch of text) out += ch === ' ' || Math.random() < k * k ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    node.textContent = out;
    setTimeout(step, 45);
  };
  step();
}
