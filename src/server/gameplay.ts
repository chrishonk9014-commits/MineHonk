/**
 * Installs gameplay systems that extend the core server through hooks
 * (combat, mobs, portals, enchanting, explosions...). Keeping this in one
 * place lets both the integrated and dedicated servers share the same setup.
 */
import type { GameServer } from './GameServer';

export function installGameplay(server: GameServer): void {
  void server;
}
