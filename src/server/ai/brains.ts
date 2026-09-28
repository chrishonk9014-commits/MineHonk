/** Assembles goal sets for each mob brain type. */
import type { Mob } from '../entity/Mob';
import { isPlayer } from '../entity/Mob';
import * as G from './goals';
import type { Entity } from '../entity/Entity';
import { items } from '../../common/registry/items';

const hostileTo = (types: string[]) => (e: Entity): boolean => types.includes(e.type);
const isMonster = (e: Entity): boolean => (e as Mob).def?.category === 'monster' && e.type !== 'creeper';

function wearsGold(p: Entity): boolean {
  if (!isPlayer(p)) return false;
  for (let i = 36; i < 40; i++) {
    const s = p.inventory.get(i);
    if (s && items[s.id]!.id.startsWith('golden_')) return true;
  }
  return false;
}

function inDarkness(m: Mob, p: Entity): boolean {
  const l = m.dim.getLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
  return Math.max(l >> 4, l & 15) <= 7;
}

export function installBrain(m: Mob): void {
  const d = m.def;
  const breed = d.breedItems ?? [];
  switch (d.brain) {
    case 'passive':
    case 'chicken':
    case 'sheep':
    case 'goat':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(1, new G.PanicGoal());
      m.addGoal(2, new G.BreedGoal());
      m.addGoal(3, new G.TemptGoal(breed));
      m.addGoal(4, new G.FollowParentGoal());
      if (d.brain === 'sheep') m.addGoal(5, new G.EatGrassGoal());
      if (d.id === 'rabbit') m.addGoal(1, new G.AvoidGoal((e) => e.type === 'player' || e.type === 'wolf' || e.type === 'fox', 6, 1.6));
      m.addGoal(6, new G.WanderGoal(1));
      m.addGoal(7, new G.LookAtPlayerGoal(6));
      m.addGoal(8, new G.LookRandomGoal());
      if (d.brain === 'goat') {
        m.addTargetGoal(1, new G.HurtByTargetGoal());
        m.addGoal(1, new G.MeleeAttackGoal(1.4));
      }
      break;
    case 'wolf':
    case 'cat':
    case 'fox':
    case 'neutral_bear':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(1, new G.MeleeAttackGoal(1.3));
      if (d.brain === 'wolf' || d.brain === 'cat') m.addGoal(2, new G.FollowOwnerGoal());
      m.addGoal(3, new G.BreedGoal());
      m.addGoal(4, new G.TemptGoal(breed));
      m.addGoal(5, new G.FollowParentGoal());
      if (d.brain === 'fox') m.addGoal(1, new G.AvoidGoal((e) => e.type === 'player' || e.type === 'wolf' || e.type === 'polar_bear', 10, 1.6));
      m.addGoal(6, new G.WanderGoal(1));
      m.addGoal(7, new G.LookAtPlayerGoal(8));
      m.addGoal(8, new G.LookRandomGoal());
      m.addTargetGoal(1, new G.HurtByTargetGoal(d.brain === 'wolf' || d.brain === 'neutral_bear'));
      if (d.brain === 'fox') m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestEntityTarget(12, hostileTo(['chicken', 'rabbit'])), true, 0.02));
      if (d.brain === 'cat') m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestEntityTarget(10, hostileTo(['rabbit', 'chicken'])), true, 0.01));
      break;
    case 'turtle':
      m.addGoal(1, new G.PanicGoal(1.2));
      m.addGoal(2, new G.BreedGoal());
      m.addGoal(3, new G.TemptGoal(breed));
      m.addGoal(4, new G.FollowParentGoal());
      m.addGoal(5, new G.SwimWanderGoal());
      m.addGoal(6, new G.WanderGoal(1, 1 / 80));
      m.addGoal(7, new G.LookAtPlayerGoal(6));
      break;
    case 'parrot':
      m.addGoal(1, new G.FollowOwnerGoal());
      m.addGoal(2, new G.FlyWanderGoal(8, 0, 6));
      m.addGoal(3, new G.LookAtPlayerGoal(8));
      break;
    case 'ocelot':
      m.addGoal(0, new G.FloatGoal());
      // Shy until it trusts the player; a trusted ocelot no longer runs
      m.addGoal(1, new G.AvoidGoal((e) => e.type === 'player' && !m.data.trusting, 10, 1.8));
      m.addGoal(2, new G.MeleeAttackGoal(1.4));
      m.addGoal(3, new G.BreedGoal());
      m.addGoal(4, new G.TemptGoal(breed, 0.6));
      m.addGoal(5, new G.FollowParentGoal());
      m.addGoal(6, new G.WanderGoal(1, 1 / 80));
      m.addGoal(7, new G.LookAtPlayerGoal(6));
      m.addTargetGoal(1, new G.NearestTargetGoal(G.nearestEntityTarget(10, hostileTo(['chicken'])), true, 0.02));
      break;
    case 'panda': {
      const aggressive = m.data.variant === 'aggressive';
      m.addGoal(0, new G.FloatGoal());
      if (aggressive) m.addGoal(1, new G.MeleeAttackGoal(1.2));
      else m.addGoal(1, new G.PanicGoal(1.4));
      m.addGoal(2, new G.BreedGoal());
      m.addGoal(3, new G.TemptGoal(breed, 1));
      m.addGoal(4, new G.FollowParentGoal());
      m.addGoal(5, new G.WanderGoal(m.data.variant === 'lazy' ? 0.6 : 0.9, m.data.variant === 'lazy' ? 1 / 200 : 1 / 80));
      m.addGoal(6, new G.LookAtPlayerGoal(6));
      m.addGoal(7, new G.LookRandomGoal());
      if (aggressive) m.addTargetGoal(1, new G.HurtByTargetGoal(true));
      break;
    }
    case 'llama':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(1, new G.RangedAttackGoal('llama_spit', 40, 10, 1.2));
      m.addGoal(2, new G.BreedGoal());
      m.addGoal(3, new G.TemptGoal(breed));
      m.addGoal(4, new G.FollowParentGoal());
      m.addGoal(5, new G.WanderGoal(0.8, 1 / 80));
      m.addGoal(6, new G.LookAtPlayerGoal(6));
      m.addGoal(7, new G.LookRandomGoal());
      m.addTargetGoal(1, new G.HurtByTargetGoal(true));
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestEntityTarget(12, (e) => e.type === 'wolf' && !(e as Mob).owner), true, 0.05));
      break;
    case 'camel':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(1, new G.PanicGoal(1.6));
      m.addGoal(2, new G.BreedGoal());
      m.addGoal(3, new G.TemptGoal(breed));
      m.addGoal(4, new G.FollowParentGoal());
      m.addGoal(5, new G.WanderGoal(0.8, 1 / 150, 14));
      m.addGoal(6, new G.LookAtPlayerGoal(8));
      break;
    case 'frog':
      m.addGoal(1, new G.MeleeAttackGoal(1.3, 1.5));
      m.addGoal(2, new G.BreedGoal());
      m.addGoal(3, new G.TemptGoal(breed));
      m.addGoal(4, new G.SwimWanderGoal());
      m.addGoal(5, new G.WanderGoal(1, 1 / 50));
      m.addGoal(6, new G.LookAtPlayerGoal(6));
      // Small slimes and magma cubes are frog food
      m.addTargetGoal(1, new G.NearestTargetGoal(G.nearestEntityTarget(10, (e) => (e.type === 'slime' || e.type === 'magma_cube') && Number((e as Mob).data.size ?? 1) === 1), false, 0.05));
      break;
    case 'axolotl':
      m.addGoal(1, new G.MeleeAttackGoal(1.4));
      m.addGoal(2, new G.BreedGoal());
      m.addGoal(3, new G.TemptGoal(breed));
      m.addGoal(4, new G.FollowParentGoal());
      m.addGoal(5, new G.SwimWanderGoal());
      m.addGoal(6, new G.WanderGoal(1, 1 / 120));
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      // Hunts other swimmers (and drowned), but only in the water
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestEntityTarget(12, (e) => ['cod', 'salmon', 'tropical_fish', 'pufferfish', 'squid', 'drowned'].includes(e.type) && (e as Mob).body.inWater), false, 0.05));
      break;
    case 'warden':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(1, new G.WardenGoal());
      break;
    case 'fish':
    case 'squid':
      m.addGoal(1, new G.PanicGoal(1.5));
      m.addGoal(2, new G.SwimWanderGoal());
      break;
    case 'bat':
      m.addGoal(1, new G.FlyWanderGoal(6, 0, 6));
      break;
    case 'sky_ray':
      m.addGoal(1, new G.MeleeAttackGoal(1.4));
      m.addGoal(2, new G.FlyWanderGoal(20, 8, 40));
      m.addTargetGoal(1, new G.HurtByTargetGoal(true));
      break;
    case 'villager':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(1, new G.AvoidGoal((e) => ['zombie', 'husk', 'drowned', 'pillager', 'glitch_zombie', 'zombified_piglin'].includes(e.type), 8, 1.5));
      m.addGoal(2, new G.PanicGoal(1.5));
      m.addGoal(3, new G.FollowParentGoal());
      m.addGoal(5, new G.WanderGoal(0.8, 1 / 80, 8));
      m.addGoal(6, new G.LookAtPlayerGoal(8));
      m.addGoal(7, new G.LookRandomGoal());
      break;
    case 'golem':
      m.addGoal(1, new G.MeleeAttackGoal(1.0));
      m.addGoal(5, new G.WanderGoal(0.6, 1 / 120, 10));
      m.addGoal(6, new G.LookAtPlayerGoal(8));
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestEntityTarget(16, isMonster), true, 0.1));
      break;
    case 'zombie':
    case 'zombified_piglin':
    case 'hoglin':
    case 'silverfish':
    case 'wanderer':
    case 'ember_beast':
    case 'cave_stalker':
    case 'piglin':
      m.addGoal(0, new G.FloatGoal());
      if (d.brain === 'piglin' && m.held && items[m.held.id]!.id === 'crossbow') m.addGoal(2, new G.RangedAttackGoal('crossbow', 40, 12));
      else m.addGoal(2, new G.MeleeAttackGoal(d.brain === 'cave_stalker' ? 1.5 : d.brain === 'ember_beast' ? 1.3 : 1.2));
      if (d.burnsInDay) m.addGoal(1, new G.FleeSunGoal());
      if (d.brain === 'hoglin') m.addGoal(3, new G.BreedGoal());
      m.addGoal(5, new G.WanderGoal(d.brain === 'wanderer' ? 0.7 : 1, d.brain === 'wanderer' ? 1 / 20 : 1 / 60));
      m.addGoal(6, new G.LookAtPlayerGoal(8));
      m.addGoal(7, new G.LookRandomGoal());
      m.addTargetGoal(1, new G.HurtByTargetGoal(d.brain === 'zombified_piglin' || d.brain === 'zombie'));
      if (d.brain === 'zombified_piglin') break; // neutral until provoked
      if (d.brain === 'piglin') {
        m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(16, (_m, p) => !wearsGold(p)), true, 0.1));
        break;
      }
      if (d.brain === 'wanderer') {
        m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(6), true, 0.05));
        break;
      }
      if (d.brain === 'cave_stalker') {
        m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(24, (mm, p) => inDarkness(mm, p)), false, 0.2));
        break;
      }
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(d.followRange ?? 32), true, 0.2));
      if (d.brain === 'zombie') m.addTargetGoal(3, new G.NearestTargetGoal(G.nearestEntityTarget(24, hostileTo(['villager', 'iron_golem'])), true, 0.05));
      break;
    case 'skeleton':
    case 'pillager': {
      m.addGoal(0, new G.FloatGoal());
      const bow = !!m.held && ['bow', 'crossbow'].includes(items[m.held.id]!.id);
      if (bow) m.addGoal(2, new G.RangedAttackGoal(d.brain === 'pillager' ? 'crossbow' : 'arrow', d.brain === 'pillager' ? 50 : 30, 15));
      else m.addGoal(2, new G.MeleeAttackGoal(1.2));
      if (d.burnsInDay) m.addGoal(1, new G.FleeSunGoal());
      m.addGoal(1, new G.AvoidGoal((e) => e.type === 'wolf' && !!(e as Mob).owner, 6, 1.3));
      m.addGoal(5, new G.WanderGoal(1));
      m.addGoal(6, new G.LookAtPlayerGoal(8));
      m.addGoal(7, new G.LookRandomGoal());
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(d.followRange ?? 24), true, 0.2));
      if (d.brain === 'pillager') m.addTargetGoal(3, new G.NearestTargetGoal(G.nearestEntityTarget(20, hostileTo(['villager', 'iron_golem'])), true, 0.05));
      break;
    }
    case 'creeper':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(1, new G.CreeperSwellGoal());
      m.addGoal(2, new G.AvoidGoal((e) => e.type === 'cat', 6, 1.4));
      m.addGoal(3, new G.MeleeAttackGoal(1.0, -10));
      m.addGoal(5, new G.WanderGoal(0.8));
      m.addGoal(6, new G.LookAtPlayerGoal(8));
      m.addTargetGoal(1, new G.NearestTargetGoal(G.nearestPlayerTarget(16), true, 0.2));
      m.addTargetGoal(2, new G.HurtByTargetGoal());
      break;
    case 'spider':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(2, new G.MeleeAttackGoal(1.1));
      m.addGoal(5, new G.WanderGoal(0.8));
      m.addGoal(6, new G.LookAtPlayerGoal(8));
      m.addGoal(7, new G.LookRandomGoal());
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      // Spiders are only hostile in the dark
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(16, (mm) => {
        const l = mm.dim.getLight(Math.floor(mm.x), Math.floor(mm.y + 1), Math.floor(mm.z));
        return mm.def.id === 'cave_spider' || Math.max((l >> 4) * (mm.isDaytime() ? 1 : 0.3), l & 15) < 10;
      }), true, 0.2));
      break;
    case 'enderman':
      m.addGoal(0, new G.TeleportGoal(false));
      m.addGoal(2, new G.MeleeAttackGoal(1.4));
      m.addGoal(5, new G.WanderGoal(0.8));
      m.addGoal(7, new G.LookRandomGoal());
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.staringPlayer, false, 0.5));
      break;
    case 'rift_walker':
      m.addGoal(0, new G.TeleportGoal(true));
      m.addGoal(2, new G.MeleeAttackGoal(1.3));
      m.addGoal(5, new G.WanderGoal(0.8));
      m.addGoal(6, new G.LookAtPlayerGoal(10));
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(24), false, 0.1));
      break;
    case 'witch':
      m.addGoal(0, new G.FloatGoal());
      m.addGoal(2, new G.RangedAttackGoal('potion', 60, 10));
      m.addGoal(5, new G.WanderGoal(0.8));
      m.addGoal(6, new G.LookAtPlayerGoal(8));
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(16), true, 0.2));
      break;
    case 'slime':
      m.addGoal(1, new G.SlimeHopGoal());
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(16), true, 0.2));
      break;
    case 'blaze':
      m.addGoal(2, new G.RangedAttackGoal('small_fireball', 60, 20));
      m.addGoal(5, new G.FlyWanderGoal(8, 1, 8));
      m.addTargetGoal(1, new G.HurtByTargetGoal(true));
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(40), true, 0.2));
      break;
    case 'ghast':
      m.addGoal(2, new G.RangedAttackGoal('fireball', 60, 60));
      m.addGoal(5, new G.FlyWanderGoal(24, 4, 30));
      m.addTargetGoal(1, new G.NearestTargetGoal(G.nearestPlayerTarget(64), true, 0.2));
      break;
    case 'shulker':
      m.addGoal(2, new G.RangedAttackGoal('shulker_bullet', 50, 16));
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(16), true, 0.2));
      break;
    case 'phantom':
    case 'void_wisp':
      m.addGoal(2, new G.MeleeAttackGoal(1.5));
      m.addGoal(5, new G.FlyWanderGoal(16, 6, 24));
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(32), false, 0.2));
      break;
    case 'glitch_beast':
      m.addGoal(1, new G.TeleportGoal(true));
      m.addGoal(2, new G.MeleeAttackGoal(1.3, 1));
      m.addGoal(3, new G.RangedAttackGoal('rift_bolt', 50, 24));
      m.addGoal(6, new G.LookAtPlayerGoal(24));
      m.addTargetGoal(1, new G.HurtByTargetGoal());
      m.addTargetGoal(2, new G.NearestTargetGoal(G.nearestPlayerTarget(64), false, 0.5));
      break;
    case 'dragon':
      // The dragon fight is driven by its own controller
      break;
  }
}
