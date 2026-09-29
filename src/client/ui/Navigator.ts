/**
 * Held-item instruments drawn next to the hotbar: compass needles (world
 * spawn, a linked lodestone, the last death for the Recovery Compass) and
 * the clock's day/night dial. Needles spin where they have nothing to point
 * at (another dimension, no lodestone, no death yet).
 */
import { el } from './dom';

export type Instrument =
  | { kind: 'needle'; target: [number, number] | null; colors: { face: string; rim: string; tip: string } }
  | { kind: 'clock'; dayTime: number | null };

export class Navigator {
  readonly root = el('div', { class: 'navigator hidden' });
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly label = el('div', { class: 'navigator-label shadow' });
  private needle = 0;
  private needleV = 0;

  constructor() {
    this.canvas.width = 32;
    this.canvas.height = 32;
    this.g = this.canvas.getContext('2d')!;
    this.root.append(this.canvas, this.label);
  }

  /** Draws the instrument for this tick (or hides it). `yaw` is the player's view yaw. */
  update(inst: Instrument | null, px: number, pz: number, yaw: number, time: number): void {
    this.root.classList.toggle('hidden', !inst);
    if (!inst) return;
    const g = this.g;
    g.clearRect(0, 0, 32, 32);
    if (inst.kind === 'clock') {
      this.drawClock(inst.dayTime, time);
      return;
    }
    // Needle angle relative to the view: 0 = straight ahead
    let want: number;
    if (inst.target) {
      const bearing = Math.atan2(-(inst.target[0] - px), -(inst.target[1] - pz));
      want = -(bearing - yaw);
      const d = Math.hypot(inst.target[0] - px, inst.target[1] - pz);
      this.label.textContent = d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)}km`;
    } else {
      want = this.needle + 0.9 + Math.sin(time * 0.37) * 0.8;
      this.label.textContent = '?';
    }
    // Damped spring so the needle swings a little
    let diff = (want - this.needle) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.needleV = this.needleV * 0.7 + diff * 0.25;
    this.needle += this.needleV;
    const c = inst.colors;
    g.fillStyle = '#1a1a1a';
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.rim;
    g.beginPath();
    g.arc(16, 16, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.face;
    g.beginPath();
    g.arc(16, 16, 11, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(16, 16);
    g.rotate(this.needle);
    g.fillStyle = c.tip;
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(3, 0);
    g.lineTo(-3, 0);
    g.closePath();
    g.fill();
    g.fillStyle = '#e8e8e8';
    g.beginPath();
    g.moveTo(0, 10);
    g.lineTo(3, 0);
    g.lineTo(-3, 0);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#1a1a1a';
    g.fillRect(15, 15, 2, 2);
  }

  private drawClock(dayTime: number | null, time: number): void {
    const g = this.g;
    // The dial turns once a day: sun at the top at noon, moon at midnight
    const t = dayTime ?? (time * 97) % 24000;
    const a = ((t - 6000) / 24000) * Math.PI * 2;
    g.fillStyle = '#6a4a10';
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(16, 16, 13, 0, Math.PI * 2);
    g.clip();
    g.translate(16, 16);
    g.rotate(-a);
    g.fillStyle = '#6ab0f0';
    g.fillRect(-14, -14, 28, 14);
    g.fillStyle = '#101838';
    g.fillRect(-14, 0, 28, 14);
    g.fillStyle = '#ffe050';
    g.beginPath();
    g.arc(0, -8, 3.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8e8f0';
    g.beginPath();
    g.arc(0, 8, 3, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.fillStyle = '#f0c040';
    g.fillRect(15, 1, 2, 5);
    if (dayTime === null) {
      this.label.textContent = '??:??';
      return;
    }
    // 06:00 at dayTime 0
    const mins = Math.floor((((dayTime + 6000) % 24000) / 1000) * 60);
    this.label.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
}
