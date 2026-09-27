/** Tiny DOM helpers for the UI. */
export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'text') e.textContent = String(v);
    else if (k in e && k !== 'list') (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function button(label: string, onClick: () => void, cls = 'btn wide', disabled = false): HTMLButtonElement {
  const b = el('button', { class: cls, disabled, onclick: (e: Event) => {
    e.stopPropagation();
    if (!disabled) onClick();
  } }, label);
  return b;
}

export function clear(e: HTMLElement): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}

/** Minecraft-like option slider. */
export function slider(label: (v: number) => string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLDivElement {
  const text = el('div', { class: 'text' }, label(value));
  const knob = el('div', { class: 'knob' });
  const s = el('div', { class: 'slider' }, knob, text);
  const setPos = (v: number): void => {
    const f = (v - min) / (max - min);
    knob.style.left = `calc(${f * 100}% - ${f} * var(--s) * 8)`;
    text.textContent = label(v);
  };
  setPos(value);
  const fromEvent = (ev: MouseEvent): void => {
    const r = s.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    let v = min + f * (max - min);
    v = Math.round(v / step) * step;
    v = Math.min(max, Math.max(min, v));
    setPos(v);
    onChange(v);
  };
  s.addEventListener('mousedown', (ev) => {
    fromEvent(ev);
    const move = (e: MouseEvent): void => fromEvent(e);
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  return s;
}

/** Cycle button: click to go through values. */
export function cycle<T>(label: (v: T) => string, values: readonly T[], value: T, onChange: (v: T) => void, cls = 'btn'): HTMLButtonElement {
  let i = Math.max(0, values.indexOf(value));
  const b = el('button', { class: cls }) as HTMLButtonElement;
  b.textContent = label(values[i]!);
  b.style.width = 'calc(var(--s) * 150)';
  b.onclick = (e) => {
    e.stopPropagation();
    i = (i + 1) % values.length;
    b.textContent = label(values[i]!);
    onChange(values[i]!);
  };
  return b;
}
