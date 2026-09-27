import { Tex } from './canvas';

export interface Painted {
  frames: Tex[];
  /** Ticks per animation frame. */
  frameTime: number;
}

export type Painter = (t: Tex, name: string) => void;

export class PainterRegistry {
  readonly painters = new Map<string, { fn: (name: string) => Painted }>();

  add(name: string, fn: Painter): void {
    this.painters.set(name, {
      fn: (n) => {
        const t = new Tex(16, 16, n);
        fn(t, n);
        return { frames: [t], frameTime: 1 };
      },
    });
  }

  anim(name: string, frames: number, frameTime: number, fn: (t: Tex, frame: number, name: string) => void): void {
    this.painters.set(name, {
      fn: (n) => {
        const out: Tex[] = [];
        for (let i = 0; i < frames; i++) {
          const t = new Tex(16, 16, n + '#' + i);
          fn(t, i, n);
          out.push(t);
        }
        return { frames: out, frameTime };
      },
    });
  }

  has(name: string): boolean {
    return this.painters.has(name);
  }

  paint(name: string): Painted | null {
    const p = this.painters.get(name);
    return p ? p.fn(name) : null;
  }
}
