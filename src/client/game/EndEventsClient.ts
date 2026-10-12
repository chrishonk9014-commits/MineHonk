/**
 * V6 - The End Expansion, phase 5: the events as the client sees them. The
 * server owns the Void Storm and the End Eclipse and sends their state
 * (`end_event`); this eases the sky, fog and light towards them while the
 * player is in the Expanded End (the classic End never changes), keeps the
 * low-gravity pockets the player may stand in, and the Dragon's cosmetic
 * storm over the main island.
 */
import type { EndEventsView } from '../../common/endExpansion/events';

export interface EndEventsLook {
  /** 0..1: a Void Storm (its warning is a part of it: the sky dims first). */
  storm: number;
  /** 0..1: the End Eclipse. */
  eclipse: number;
  /** 0..1: the Dragon's storm over the main island (below a quarter of its health). */
  dragonStorm: number;
  /** Where the Void Citadel stands (its beam shows during an eclipse). */
  citadel: [number, number, number] | null;
}

interface Pocket {
  x: number;
  y: number;
  z: number;
  r: number;
  until: number;
}

export class EndEventsClient {
  view: EndEventsView = { storm: 'calm', stormLeft: 0, eclipse: false, eclipseLeft: 0 };
  /** Client tick the view arrived (its countdowns run from there). */
  private at = 0;
  readonly look: EndEventsLook = { storm: 0, eclipse: 0, dragonStorm: 0, citadel: null };
  private dragonWant = 0;
  private readonly pockets = new Map<number, Pocket>();

  onView(v: EndEventsView, tick: number): void {
    this.view = v;
    this.at = tick;
  }

  onDragonStorm(on: boolean): void {
    this.dragonWant = on ? 1 : 0;
  }

  addPocket(id: number, x: number, y: number, z: number, r: number, ticks: number, tick: number): void {
    this.pockets.set(id, { x, y, z, r, until: tick + ticks });
  }

  removePocket(id: number): boolean {
    return this.pockets.delete(id);
  }

  /** Inside a low-gravity pocket (a storm's, or the Guardian's Gravity Well). */
  inPocket(x: number, y: number, z: number, tick: number): boolean {
    for (const [id, p] of this.pockets) {
      if (tick > p.until) {
        this.pockets.delete(id);
        continue;
      }
      if ((x - p.x) ** 2 + (z - p.z) ** 2 <= p.r * p.r && y >= p.y - 2 && y <= p.y + 10) return true;
    }
    return false;
  }

  /** Leaving the End (or the world): nothing carries over. */
  reset(): void {
    this.view = { storm: 'calm', stormLeft: 0, eclipse: false, eclipseLeft: 0 };
    this.pockets.clear();
    this.dragonWant = 0;
    this.look.storm = this.look.eclipse = this.look.dragonStorm = 0;
    this.look.citadel = null;
  }

  /**
   * Once a tick. `band` is how far the view has blended into the Expanded
   * End (0 in the classic End: the events never reach it).
   */
  update(tick: number, inEnd: boolean, band: number): void {
    const v = this.view;
    const dt = tick - this.at;
    let storm = 0;
    if (v.storm === 'active') storm = 1;
    else if (v.storm === 'warning') {
      // The minute's warning: the sky dims towards the storm
      const left = Math.max(0, v.stormLeft - dt);
      storm = 0.45 * (1 - Math.min(1, left / 1200));
    }
    let eclipse = 0;
    if (v.eclipse) {
      const left = Math.max(0, v.eclipseLeft - dt);
      // A quick dusk into it, and the last half minute a slow dawn
      eclipse = Math.min(1, left / 600);
    }
    const k = 0.04;
    const l = this.look;
    l.storm += ((inEnd ? storm * band : 0) - l.storm) * k;
    l.eclipse += ((inEnd ? eclipse * band : 0) - l.eclipse) * k;
    l.dragonStorm += ((inEnd ? this.dragonWant * (1 - band) : 0) - l.dragonStorm) * k;
    if (l.storm < 0.002) l.storm = 0;
    if (l.eclipse < 0.002) l.eclipse = 0;
    if (l.dragonStorm < 0.002) l.dragonStorm = 0;
    l.citadel = v.eclipse && v.citadel ? v.citadel : null;
  }
}
