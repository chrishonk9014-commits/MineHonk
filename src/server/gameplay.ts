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
import { Mounts } from './systems/Mounts';
import { Power } from './systems/Power';
import { Sculk } from './systems/Sculk';
import { WardenSystem } from './systems/Warden';
import { EndingsSystem } from './systems/Endings';
import { EndgameSystem } from './systems/Endgame';
import { ErrorBossSystem } from './systems/ErrorBoss';
import { GlitchedQuestSystem } from './systems/GlitchedQuest';
import { StructureQuests } from './systems/StructureQuests';
import { TempleTrials } from './systems/TempleTrials';
import { Engineering } from './engineering/Engineering';
import { HerobrineSystem } from './herobrine/Herobrine';
import { EndExpansionSystem } from './systems/EndExpansion';
import { EndMobsSystem } from './systems/EndMobs';
import { ConstructsSystem } from './systems/Constructs';
import { EndStructuresSystem } from './systems/EndStructures';
import { EndTransportSystem } from './systems/EndTransport';
import { EndQuestsSystem } from './systems/EndQuests';
import { ElytraUpgrades } from './systems/ElytraUpgrades';
import { EndEventsSystem } from './systems/EndEvents';
import { EndCitadelSystem } from './systems/EndCitadel';
import { EndGuardianSystem } from './systems/EndGuardian';
import { itemIdOf, type ItemStack } from '../common/game/itemstack';
import { Mob } from './entity/Mob';
import type { ServerPlayer } from './player/ServerPlayer';
import type { Entity } from './entity/Entity';
import { OFFHAND } from './player/Inventory';

export function installGameplay(server: GameServer): void {
  const mobs = new MobSystem(server);
  server.mobs = mobs;
  const it = server.interaction;
  const h = it.hooks;
  h.attack = (p, target) => mobs.playerAttack(p, target);
  h.interactEntity = (p, target, hand) => server.endgame?.useOnEntity(p, target, hand) || vehicle(p, target, hand) || mobs.interact(p, target, hand);
  h.restore = (dim, data) => mobs.restore(dim, data) ?? end.restore(dim, data);
  const ws = new Workstations(server);
  server.workstations = ws;
  const end = new EndSystem(server);
  server.theEnd = end;
  // V6: the Expansion Portal on the main island and the Expanded End beyond
  const expansion = new EndExpansionSystem(server);
  server.endExpansion = expansion;
  // V6 phase 2: the Expanded End's mobs
  const endMobs = new EndMobsSystem(server);
  server.endMobs = endMobs;
  // V6 phase 3: the Guardian Constructs, and the structures, ancient civilization and Dragon's Nest
  server.constructs = new ConstructsSystem(server);
  const endStructures = new EndStructuresSystem(server);
  server.endStructures = endStructures;
  // V6 phase 4: getting about (nodes, gateways, carts, the Void Skiff), the five End quests, Elytra upgrades
  const endTransport = new EndTransportSystem(server);
  server.endTransport = endTransport;
  const endQuests = new EndQuestsSystem(server);
  server.endQuests = endQuests;
  const elytra = new ElytraUpgrades(server);
  // V6 phase 5: the End's events, the Void Citadel and the End Guardian
  const endEvents = new EndEventsSystem(server);
  server.endEvents = endEvents;
  const citadel = new EndCitadelSystem(server);
  server.citadel = citadel;
  const guardian = new EndGuardianSystem(server);
  server.guardian = guardian;
  server.elytra = elytra;
  const vehicle = (p: ServerPlayer, target: Entity, hand: 0 | 1): boolean => {
    if (!(target instanceof Mob) || !target.def.vehicle) return false;
    const slot = hand === 1 ? OFFHAND : p.selectedSlot;
    return endTransport.interact(p, target, p.inventory.get(slot), slot);
  };
  // Vehicles go out from the hand, blueprints teach, the Silent Bell rings, lore books are read
  const endUse = (p: Parameters<NonNullable<typeof h.useItem>>[0], stack: ItemStack, hand: number): boolean => {
    const slot = hand === 1 ? OFFHAND : p.selectedSlot;
    if (itemIdOf(stack) === 'book' && typeof stack.tag?.lore === 'string') {
      endQuests.onRead(p, stack.tag.lore);
      return true;
    }
    return (itemIdOf(stack) === 'void_skiff' && endTransport.placeVehicle(p, stack, slot)) || endTransport.useBlueprint(p, stack, slot) || endQuests.ringBell(p, stack);
  };
  const far = new FarlandsSystem(server);
  server.farlands = far;
  const gadgets = new Gadgets(server);
  server.gadgets = gadgets;
  const mounts = new Mounts(server);
  server.mounts = mounts;
  const power = new Power(server);
  server.power = power;
  const sculk = new Sculk(server);
  server.sculk = sculk;
  server.warden = new WardenSystem(server);
  power.extraPower = (dim, x, y, z) => sculk.sensorPower(dim, x, y, z);
  // V6: a Void Pack opens its nine slots
  const voidPack = (p: Parameters<NonNullable<typeof h.useItem>>[0], stack: ItemStack, hand: number): boolean => {
    if (itemIdOf(stack) !== 'void_pack') return false;
    it.containers.openVoidPack(p, hand === 1 ? OFFHAND : p.selectedSlot);
    return true;
  };
  h.useItem = (p, stack, hand) => voidPack(p, stack, hand) || endUse(p, stack, hand) || endStructures.useItem(p, stack, hand) || guardian.useItem(p, stack, hand) || !!server.herobrine?.useItem(p, stack) || !!server.endgame?.useItem(p, stack) || mobs.useItem(p, stack) || end.fillBottle(p, stack) || ws.fillBottle(p, stack) || ws.throwSplash(p, stack) || end.useItem(p, stack) || far.useItem(p, stack) || gadgets.useItem(p, stack, hand);
  const quests = new StructureQuests(server);
  server.structureQuests = quests;
  const temples = new TempleTrials(server);
  server.templeTrials = temples;
  const engineering = new Engineering(server);
  server.engineering = engineering;
  h.useBlock = (p, x, y, z, state) => citadel.useBlock(p, x, y, z, state) || endQuests.useBlock(p, x, y, z, state) || endStructures.useBlock(p, x, y, z, state) || !!server.herobrine?.useBlock(p, x, y, z, state) || quests.useBlock(p, x, y, z, state) || temples.useBlock(p, x, y, z, state) || engineering.useBlock(p, x, y, z, state) || ws.useBlock(p, x, y, z, state);
  h.windowAction = (p, m) => ws.windowAction(p, m);
  const prevUseOnBlock = h.useItemOnBlock;
  // A minecart onto a rail, a Void Skiff onto the block (on top of it)
  const placeVehicle = (p: Parameters<NonNullable<typeof h.useItem>>[0], stack: ItemStack, x: number, y: number, z: number, face: number): boolean => {
    const id = itemIdOf(stack);
    if (id !== 'minecart' && id !== 'void_skiff') return false;
    const slot = p.inventory.get(p.selectedSlot) === stack ? p.selectedSlot : OFFHAND;
    void face;
    return endTransport.placeVehicle(p, stack, slot, [x, y, z]);
  };
  h.useItemOnBlock = (p, stack, x, y, z, face) => voidPack(p, stack, 0) || placeVehicle(p, stack, x, y, z, face) || end.useOnBlock(p, stack, x, y, z) || far.useOnBlock(p, stack, x, y, z) || mobs.useSpawnEgg(p, stack, x, y, z, face) || gadgets.useOnBlock(p, stack, x, y, z, face) || !!prevUseOnBlock?.(p, stack, x, y, z, face);
  h.enterPortal = (p, kind) => end.enterPortal(p, kind);
  mobs.extraEntity = (dim, type, x, y, z) => {
    if (type !== 'end_crystal') return false;
    end.spawnCrystal(dim, x, y, z);
    return true;
  };
  const endings = new EndingsSystem(server);
  server.endings = endings;
  const endgame = new EndgameSystem(server);
  server.endgame = endgame;
  const errorBoss = new ErrorBossSystem(server);
  server.errorBoss = errorBoss;
  const glitched = new GlitchedQuestSystem(server);
  server.glitchedQuest = glitched;
  // V5.5: the Herobrine story (after the dragon fight and the computers it hooks into)
  const herobrine = new HerobrineSystem(server);
  server.herobrine = herobrine;
  mobs.onBossDeath = (m, killer, info) => {
    if (m.type === 'ender_dragon') end.fight.onDeath(m, killer, info);
    else if (m.type === 'the_error') errorBoss.onDeath(m, killer, info);
    else if (m.type === 'herobrine') herobrine.onBossDeath(m, killer, info);
    // V6 phase 5: the End Guardian (and its pylons and orbs)
    else if (guardian.onDeath(m, killer)) return true;
    // Other bosses (the Glitch Beast) drop their loot like any mob
    else return false;
    return true;
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
    // V6 phase 5: arriving in the End, hear of its events at once
    endEvents.sync(p);
  };
  const prevTick = h.tick;
  h.tick = () => {
    prevTick?.();
    mobs.tick();
    endMobs.tick();
    mobs.tickArrowPickup();
    ws.tick();
    portals.tick();
    end.tick();
    expansion.tick();
    endStructures.tick();
    endTransport.tick();
    endQuests.tick();
    elytra.tick();
    endEvents.tick();
    citadel.tick();
    guardian.tick();
    endgame.tick();
    errorBoss.tick();
    glitched.tick();
    quests.tick();
    temples.tick();
    engineering.tick();
    herobrine.tick();
    far.tick();
    gadgets.tick();
    mounts.tick();
    power.tick();
    sculk.tick();
    progression.tick();
  };
}
