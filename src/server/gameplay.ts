/**
 * Installs gameplay systems that extend the core server through hooks
 * (combat, mobs, projectiles, explosions...). Keeping this in one place lets
 * both the integrated and dedicated servers share the same setup.
 */
import type { GameServer } from './GameServer';
import { MobSystem } from './systems/Mobs';

export function installGameplay(server: GameServer): void {
  const mobs = new MobSystem(server);
  server.mobs = mobs;
  const it = server.interaction;
  const h = it.hooks;
  h.attack = (p, target) => mobs.playerAttack(p, target);
  h.interactEntity = (p, target, hand) => mobs.interact(p, target, hand);
  h.restore = (dim, data) => mobs.restore(dim, data);
  h.useItem = (p, stack) => mobs.useItem(p, stack);
  const prevUseOnBlock = h.useItemOnBlock;
  h.useItemOnBlock = (p, stack, x, y, z, face) => mobs.useSpawnEgg(p, stack, x, y, z, face) || !!prevUseOnBlock?.(p, stack, x, y, z, face);
  h.releaseItem = (p, stack, ticks) => mobs.releaseBow(p, stack, ticks);
  h.igniteTnt = (dim, x, y, z) => mobs.igniteTnt(dim, x, y, z);
  it.explode = (dim, x, y, z, power, fire, source) => mobs.explode(dim, x, y, z, power, fire, source);
  const prevTick = h.tick;
  h.tick = () => {
    prevTick?.();
    mobs.tick();
    mobs.tickArrowPickup();
  };
}
