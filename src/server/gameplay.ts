/**
 * Installs gameplay systems that extend the core server through hooks
 * (combat, mobs, projectiles, explosions...). Keeping this in one place lets
 * both the integrated and dedicated servers share the same setup.
 */
import type { GameServer } from './GameServer';
import { MobSystem } from './systems/Mobs';
import { Workstations } from './systems/Workstations';
import { Portals } from './systems/Portals';
import { Progression } from './systems/Progression';
import { EndSystem } from './systems/TheEnd';
import { FarlandsSystem } from './systems/Farlands';
import { Gadgets } from './systems/Gadgets';

export function installGameplay(server: GameServer): void {
  const mobs = new MobSystem(server);
  server.mobs = mobs;
  const it = server.interaction;
  const h = it.hooks;
  h.attack = (p, target) => mobs.playerAttack(p, target);
  h.interactEntity = (p, target, hand) => mobs.interact(p, target, hand);
  h.restore = (dim, data) => mobs.restore(dim, data) ?? end.restore(dim, data);
  const ws = new Workstations(server);
  server.workstations = ws;
  const end = new EndSystem(server);
  server.theEnd = end;
  const far = new FarlandsSystem(server);
  server.farlands = far;
  const gadgets = new Gadgets(server);
  server.gadgets = gadgets;
  h.useItem = (p, stack, hand) => mobs.useItem(p, stack) || end.fillBottle(p, stack) || ws.fillBottle(p, stack) || ws.throwSplash(p, stack) || end.useItem(p, stack) || far.useItem(p, stack) || gadgets.useItem(p, stack, hand);
  h.useBlock = (p, x, y, z, state) => ws.useBlock(p, x, y, z, state);
  h.windowAction = (p, m) => ws.windowAction(p, m);
  const prevUseOnBlock = h.useItemOnBlock;
  h.useItemOnBlock = (p, stack, x, y, z, face) => end.useOnBlock(p, stack, x, y, z) || far.useOnBlock(p, stack, x, y, z) || mobs.useSpawnEgg(p, stack, x, y, z, face) || gadgets.useOnBlock(p, stack, x, y, z, face) || !!prevUseOnBlock?.(p, stack, x, y, z, face);
  h.enterPortal = (p, kind) => end.enterPortal(p, kind);
  mobs.extraEntity = (dim, type, x, y, z) => {
    if (type !== 'end_crystal') return false;
    end.spawnCrystal(dim, x, y, z);
    return true;
  };
  mobs.onBossDeath = (m, killer) => {
    if (m.type === 'ender_dragon') end.fight.onDeath(m, killer);
  };
  h.releaseItem = (p, stack, ticks, slot) => mobs.releaseBow(p, stack, ticks, slot);
  h.igniteTnt = (dim, x, y, z) => mobs.igniteTnt(dim, x, y, z);
  it.explode = (dim, x, y, z, power, fire, source) => mobs.explode(dim, x, y, z, power, fire, source);
  const portals = new Portals(server);
  server.portals = portals;
  h.portalLight = (dim, x, y, z) => portals.light(dim, x, y, z);
  const progression = new Progression(server);
  const prevDim = h.onDimension;
  h.onDimension = (p, dim) => {
    prevDim?.(p, dim);
    progression.onDimension(p, dim);
  };
  const prevTick = h.tick;
  h.tick = () => {
    prevTick?.();
    mobs.tick();
    mobs.tickArrowPickup();
    ws.tick();
    portals.tick();
    end.tick();
    far.tick();
    gadgets.tick();
    progression.tick();
  };
}
