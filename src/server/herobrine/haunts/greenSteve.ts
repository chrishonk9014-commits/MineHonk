import type { ServerPlayer } from '../../player/ServerPlayer';
import type { HauntingSystem } from '../Haunting';
import type { HauntPart, HauntState, Figure } from './types';

export class GreenSteveHaunt implements HauntPart {
  readonly id = 'green_steve' as const;
  readonly budget = {};
  constructor(private readonly h: HauntingSystem) {}
  event(): void {}
  oneOffs(): void {}
  finale(st: HauntState): void {
    this.h.finish(st, { kind: 'ban' });
  }
  atmosphere(): void {}
  stepFigure(_fg: Figure, age: number): boolean {
    return age < 100;
  }
  appear(_p: ServerPlayer): boolean {
    return false;
  }
  reset(): void {}
}
