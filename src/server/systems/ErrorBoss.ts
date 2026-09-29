/**
 * The Error: the Farlands boss (V3). Filled in by the boss phase of V3.
 */
import type { GameServer } from '../GameServer';
import type { Mob } from '../entity/Mob';
import type { ServerPlayer } from '../player/ServerPlayer';
import type { HurtInfo } from '../entity/Living';

export class ErrorBossSystem {
  constructor(private readonly server: GameServer) {}

  tick(): void {
    void this.server;
  }

  onDeath(m: Mob, killer: ServerPlayer | null, info: HurtInfo): void {
    void m;
    void killer;
    void info;
  }
}
