/**
 * V6: the Admin Panel's End Expansion tools. Every one of them is a cheat:
 * switching the portal on before the dragon's defeat makes travel through it
 * a cheat visit, and every teleport here marks its arrival area, so nothing
 * done with them earns an advancement.
 */
import type { ServerPlayer } from '../player/ServerPlayer';
import type { V6Op } from '../../common/game/admin';
import type { EndGenerator } from '../../common/gen/end';
import { arrivalLayout } from '../../common/gen/endExpansion';
import { EXPANSION_BIOMES, expansionBiomeIndex } from '../../common/endExpansion/biomes';
import { inExpansion } from '../../common/endExpansion/region';
import type { EndExpansionSystem } from '../systems/EndExpansion';
import { expansionGiveSets } from '../../common/endExpansion/resources';
import { EXPANSION_STRUCTURE_IDS, GIANT_IDS, expansionStructureName } from '../../common/endExpansion/structures';
import { LORE, NEST_LORE } from '../../common/endExpansion/lore';
import { stackOf, markAdmin, type ItemStack } from '../../common/game/itemstack';
import { S, stateOf } from '../../common/registry/blocks';
import { portAt } from '../engineering/ports';
import { END_QUESTS, type EndQuestId } from '../../common/endExpansion/quests';
import { RARE_END_LOOT } from '../../common/endExpansion/guardian';

export interface ExpansionAdminHelpers {
  /** Teleports (as a cheat) once the destination has loaded; the result follows as a second reply. */
  queueTeleport(p: ServerPlayer, x: number, y: number, z: number, label: string, surface: boolean): void;
  /** Gives cheat-marked items (they never count for advancements). */
  give(p: ServerPlayer, id: string, count: number): void;
  /** Gives one cheat-marked stack as it is (a lore book with its fragment). */
  giveStack(p: ServerPlayer, stack: ItemStack): void;
}

type Result = { ok: boolean; text: string; data?: unknown } | null;

export function expansionAdmin(sys: EndExpansionSystem, h: ExpansionAdminHelpers, p: ServerPlayer, op: V6Op, biome?: string, set?: string, structure?: string, quest?: string, spot?: string, test?: string): Result {
  const s = sys.server;
  const gen = s.dim('end').generator as EndGenerator;
  const ex = gen.terrain.expansion;
  const ok = (text: string): Result => ({ ok: true, text, data: sys.status(p) });
  // Teleports answer twice: this first (the panel shows it as progress), then the landing
  const pending = (text: string): Result => ({ ok: true, text, data: { ...sys.status(p), pending: true } });
  switch (op) {
    case 'status':
      return { ok: true, text: '', data: sys.status(p) };
    case 'activate':
      sys.setActive(true, true);
      return ok(sys.state?.built ? 'The Expansion Portal is open.' : 'The Expansion Portal will be open when the main island loads.');
    case 'deactivate':
      sys.setActive(false, true);
      return ok('The Expansion Portal is closed.');
    case 'build_portal':
      return ok(sys.requestBuild() ? 'Built the Expansion Portal on the main island.' : 'The Expansion Portal will be built as soon as the main island loads.');
    case 'tp_portal': {
      const site = sys.site();
      h.queueTeleport(p, site.x, site.y, site.z - 3, 'Expansion Portal', true);
      return pending('Preparing a landing by the Expansion Portal...');
    }
    case 'tp_arrival': {
      const L = arrivalLayout(ex.arrival());
      h.queueTeleport(p, L.stand.x, L.stand.y, L.stand.z, 'arrival platform', false);
      return pending('Preparing a landing on the arrival platform...');
    }
    case 'tp_biome': {
      const i = expansionBiomeIndex(biome ?? '');
      const def = EXPANSION_BIOMES[i];
      if (!def) return { ok: false, text: 'Unknown biome.' };
      // Search from the player when they're already out there, otherwise from the arrival platform
      const a = ex.arrival();
      const from = p.dim.id === 'end' && inExpansion(p.x, p.z) ? { x: Math.floor(p.x), z: Math.floor(p.z) } : { x: a.x, z: a.z };
      const spot = ex.findBiome(i, from.x, from.z);
      if (!spot) return { ok: false, text: `No ${def.name} found.` };
      h.queueTeleport(p, spot.x, spot.y, spot.z, def.name, true);
      return pending(`Found the ${def.name} at ${spot.x}, ${spot.z}. Preparing a landing...`);
    }
    case 'defeat_dragon': {
      // For testing the portal: the dragon is marked cheat-made first, so its defeat awards
      // nothing and its drops and experience are cheat-made; the fight ends as usual (finish())
      const d = s.theEnd?.fight.dragon;
      if (!d || d.dead) return { ok: false, text: s.level.flags.dragonKilledOnce === true && !s.level.flags.dragonAlive ? 'The Ender Dragon has already been defeated.' : 'The Ender Dragon is not here: go to the End first.' };
      d.admin = true;
      s.level.flags.dragonAdmin = true;
      d.hurt(d.health + 10000, { source: 'mob', attacker: p });
      return ok('The Ender Dragon is defeated (a cheat: no advancement, its drops are cheat-made).');
    }
    // Phase 2: the Expanded End's mobs and resources (spawning single mobs and groups uses the
    // panel's usual spawn action, which marks them as cheat-made)
    case 'give_set': {
      const g = expansionGiveSets().find((k) => k.id === set);
      if (!g) return { ok: false, text: 'Unknown set.' };
      for (const [id, n] of g.items) h.give(p, id, n);
      return ok(`Gave the ${g.name} set (cheat items: they never count for advancements).`);
    }
    case 'kill_mobs': {
      const n = s.endMobs?.killNear(p.dim, p.x, p.y, p.z, 96) ?? 0;
      return ok(n ? `Removed ${n} Expanded End mob${n === 1 ? '' : 's'} nearby.` : 'No Expanded End mobs nearby.');
    }
    case 'mob_spawning_on':
    case 'mob_spawning_off':
      if (s.endMobs) s.endMobs.spawning = op === 'mob_spawning_on';
      return ok(op === 'mob_spawning_on' ? 'Expanded End mobs spawn naturally again.' : 'Expanded End mobs no longer spawn naturally.');
    // Phase 3: the structures, the ancient civilization and the Dragon's Nest
    case 'locate_structures': {
      const es = s.endStructures;
      if (!es) return { ok: false, text: 'The structures are not running.' };
      const a = ex.arrival();
      const from = p.dim.id === 'end' && inExpansion(p.x, p.z) ? { x: Math.floor(p.x), z: Math.floor(p.z) } : { x: a.x, z: a.z };
      const found = EXPANSION_STRUCTURE_IDS.map((id) => {
        const it = gen.expansionSteps(id, from.x, from.z);
        let r = it.next();
        while (!r.done) r = it.next();
        const st = r.value;
        return { id, name: expansionStructureName(id), giant: GIANT_IDS.includes(id), at: st ? { x: st.x, y: st.y, z: st.z, distance: Math.round(Math.hypot(st.x - from.x, st.z - from.z)) } : null };
      });
      const plan = es.nestPlan();
      return {
        ok: true,
        text: gen.expansionStructures ? 'Nearest of each structure (from you in the Expanded End, otherwise from the arrival platform).' : 'This world was made before the Expanded End had structures (only newly made worlds have them). The Dragon\'s Nest is in every world.',
        data: { ...sys.status(p), located: found, nest: { ...((es.status().nest as object) ?? {}), x: plan.floor[0], y: plan.floor[1], z: plan.floor[2] } },
      };
    }
    case 'tp_structure': {
      if (!structure) return { ok: false, text: 'Unknown structure.' };
      const a = ex.arrival();
      const from = p.dim.id === 'end' && inExpansion(p.x, p.z) ? { x: Math.floor(p.x), z: Math.floor(p.z) } : { x: a.x, z: a.z };
      const it = gen.expansionSteps(structure, from.x, from.z);
      let r = it.next();
      while (!r.done) r = it.next();
      const st = r.value;
      if (!st) return { ok: false, text: gen.expansionStructures ? `No ${expansionStructureName(structure)} found nearby.` : 'This world has no Expanded End structures (it was made before them).' };
      h.queueTeleport(p, st.x, st.y + 1, st.z, expansionStructureName(structure), false);
      return pending(`Found the ${expansionStructureName(structure)} at ${st.x}, ${st.z}. Preparing a landing...`);
    }
    case 'generate_here': {
      if (!structure || !s.endStructures) return { ok: false, text: 'Unknown structure.' };
      const st = s.endStructures.generateAt(p, structure);
      if (!st) return { ok: false, text: 'Could not plan that structure here.' };
      const chunks = new Set(st.pieces.flatMap((pc) => [`${pc.box.x0 >> 4},${pc.box.z0 >> 4}`, `${pc.box.x1 >> 4},${pc.box.z1 >> 4}`])).size;
      return ok(`Building the ${expansionStructureName(structure)} here, a chunk at a time (about ${chunks}+ chunks). It is a cheat: its Constructs and loot count for nothing.`);
    }
    case 'build_nest': {
      const es = s.endStructures;
      if (!es) return { ok: false, text: 'The structures are not running.' };
      if (es.nest?.built) return { ok: false, text: "The Dragon's Nest is already built." };
      es.forceNest();
      return ok("The Dragon's Nest is being carved under the main island, a chunk at a time, as its chunks load.");
    }
    case 'tp_nest': {
      const es = s.endStructures;
      if (!es) return { ok: false, text: 'The structures are not running.' };
      const plan = es.nestPlan();
      const built = !!es.nest?.built;
      const [x, y, z] = built ? plan.floor : plan.entrance;
      h.queueTeleport(p, x, y, z, built ? "Dragon's Nest" : "Dragon's Nest entrance (not carved yet)", !built);
      return pending(built ? "Preparing a landing in the Dragon's Nest..." : "The Nest isn't carved yet: going to where its entrance will be...");
    }
    case 'reset_loot': {
      const es = s.endStructures;
      if (!es) return { ok: false, text: 'The structures are not running.' };
      if (es.inNest(p) || (p.dim.id === 'end' && Math.hypot(p.x, p.z) < 120)) {
        const n = es.resetLoot(p.dim, es.nestPlan());
        return ok(n ? `Reset ${n} chest${n === 1 ? '' : 's'} in the Dragon's Nest (loaded chunks).` : "No Nest chests are loaded.");
      }
      const here = es.structuresAt(p.x, p.y, p.z)[0] ?? gen.expansionStartsAt(Math.floor(p.x), Math.floor(p.z))[0];
      if (!here) return { ok: false, text: 'Stand in an Expanded End structure (or the Dragon\'s Nest) first.' };
      const n = es.resetLoot(p.dim, here);
      return ok(`Reset ${n} chest${n === 1 ? '' : 's'} of the ${expansionStructureName(here.type)} (loaded chunks): their loot rolls again when opened.`);
    }
    case 'give_lore': {
      const pool = [...LORE, ...NEST_LORE];
      const f = pool[Math.floor(Math.random() * pool.length)]!;
      h.giveStack(p, { ...stackOf('book', 1), tag: { lore: f.id } });
      return ok(`Gave a lore book (${f.id}; a cheat item: it never counts for advancements).`);
    }
    // Phase 4: the End quests and the testing tools (every one a cheat: nothing here awards anything)
    case 'quest_start':
    case 'quest_complete':
    case 'quest_reset':
    case 'quest_tp': {
      const eq = s.endQuests;
      const q = END_QUESTS.find((x) => x.id === quest)?.id as EndQuestId | undefined;
      if (!eq || !q) return { ok: false, text: 'Unknown quest.' };
      const withQuests = (r: { ok: boolean; text: string }): Result => ({ ...r, data: { ...sys.status(p), quests: eq.status() } });
      if (op === 'quest_reset') return withQuests({ ok: true, text: eq.adminReset(q) });
      if (p.dim.id !== 'end' && q !== 'dragons_history' && op !== 'quest_tp') return { ok: false, text: 'Go to the End first (the quests\' sites are searched from where you are).' };
      if (op === 'quest_start') return withQuests(eq.adminStart(p, q));
      if (op === 'quest_complete') return withQuests(eq.adminComplete(p, q));
      const site = eq.nearestSite(p.dim.id === 'end' ? p : ({ ...p, x: ex.arrival().x, z: ex.arrival().z } as ServerPlayer), q);
      if (!site) return { ok: false, text: `No ${END_QUESTS.find((x) => x.id === q)!.title} site found.` };
      h.queueTeleport(p, site.at[0] + 0.5, site.at[1], site.at[2] + 0.5, `start of ${END_QUESTS.find((x) => x.id === q)!.title}`, false);
      return { ok: true, text: `Going to the nearest start of ${END_QUESTS.find((x) => x.id === q)!.title}...`, data: { ...sys.status(p), pending: true } };
    }
    case 'fill_eu': {
      const eng = s.engineering;
      const hit = s.endQuests?.lookedAt(p);
      const n = hit && eng ? eng.node(p.dim, hit[0], hit[1], hit[2]) : null;
      const be = n?.be();
      if (!n || !be || !n.c.energy) return { ok: false, text: 'Look at a machine with an energy buffer.' };
      be.energy = eng!.capacityOf(n);
      be.cheat = 1;
      n.dirty = true;
      n.sleep = 0;
      return ok(`Filled the ${n.c.name}'s buffer (${Math.floor(be.energy).toLocaleString('en-US')} EU; cheat-marked: what it does never counts for advancements).`);
    }
    case 'force_gate': {
      if (!s.endQuests) return { ok: false, text: 'The quests are not running.' };
      return { ...s.endQuests.forceGate(p), data: sys.status(p) };
    }
    case 'open_sanctum': {
      if (!s.endQuests) return { ok: false, text: 'The quests are not running.' };
      return { ...s.endQuests.openSanctum(), data: sys.status(p) };
    }
    case 'end_rig': {
      // A working End line beside the player, on its own floor (over the void, the bridge has somewhere to go):
      // a fuelled Crystal Generator -> cable -> Void Cell, End Processor, Crystal Grower, two Teleportation
      // Nodes, and an Ender Bridge Projector at the far end facing east. Everything in it is a cheat.
      const eng = s.engineering;
      if (!eng) return { ok: false, text: 'Engineering is not running.' };
      const dim = p.dim;
      const x0 = Math.floor(p.x) + 2;
      const y0 = Math.floor(p.y);
      const z0 = Math.floor(p.z) + 2;
      const place = (x: number, y: number, z: number, st: number): void => {
        dim.setBlock(x, y, z, st);
        s.admin.setBlockMark(dim, x, y, z, st !== 0);
        const be = eng.node(dim, x, y, z)?.be();
        if (be) {
          be.cheat = 1;
          be.by = p.uuid;
        }
      };
      for (let x = -1; x <= 10; x++) for (let z = -1; z <= 3; z++) for (let y = 0; y <= 3; y++) place(x0 + x, y0 + y, z0 + z, 0);
      for (let x = -1; x <= 10; x++) for (let z = -1; z <= 3; z++) place(x0 + x, y0 - 1, z0 + z, S('end_stone_bricks'));
      place(x0, y0, z0, S('crystal_generator'));
      place(x0, y0, z0 + 1, S('insulated_cable'));
      for (let x = 1; x <= 9; x++) place(x0 + x, y0, z0 + 1, S('insulated_cable'));
      place(x0 + 2, y0, z0, S('void_cell'));
      place(x0 + 4, y0, z0, stateOf('end_processor', { facing: 'north' }));
      place(x0 + 6, y0, z0, S('crystal_grower'));
      place(x0 + 6, y0, z0 - 1, S('crystalline_end_stone'));
      for (const z of [z0, z0 + 2]) {
        place(x0 + 8, y0, z, S('teleport_node'));
        s.endTransport?.onNodePlaced(p, dim, x0 + 8, y0, z, true);
      }
      place(x0 + 10, y0, z0 + 1, stateOf('ender_bridge_projector', { facing: 'east' }));
      const cell = eng.node(dim, x0 + 2, y0, z0)?.be();
      if (cell) cell.energy = 500_000;
      portAt(s, dim, x0, y0, z0, 1)?.insert(markAdmin(stackOf('end_crystal_fragment', 64)));
      portAt(s, dim, x0 + 4, y0, z0, 1)?.insert(markAdmin(stackOf('ender_ore', 32)));
      return { ok: true, text: 'Built an End test line beside you: a fuelled Crystal Generator charging a Void Cell along a cable, an End Processor, a Crystal Grower on Crystalline End Stone, two Teleportation Nodes and an Ender Bridge Projector facing east. Everything in it is a cheat.', data: { ...sys.status(p), rig: [x0, y0, z0] } };
    }
    // Phase 5: the events, the Void Citadel, the End Guardian, rare loot and the Dragon's new moves
    case 'storm_start':
    case 'storm_stop':
    case 'eclipse_start':
    case 'eclipse_stop': {
      const ev = s.endEvents;
      if (!ev) return { ok: false, text: 'The End events are not running.' };
      if (op === 'storm_start') ev.startStorm(true);
      else if (op === 'storm_stop') ev.stopStorm();
      else if (op === 'eclipse_start') ev.startEclipse(true);
      else ev.stopEclipse();
      const text = { storm_start: 'A Void Storm breaks in a few seconds over the Expanded End (cheat: no advancements).', storm_stop: 'The Void Storm is over.', eclipse_start: 'The End Eclipse begins (cheat: no advancements).', eclipse_stop: 'The End Eclipse is over.' }[op];
      return ok(text);
    }
    case 'citadel_tp': {
      const c = s.citadel;
      if (!c?.plan) return { ok: false, text: 'The Void Citadel has no site yet (it is chosen when the End is first loaded).' };
      const which = spot === 'entrance' || spot === 'arena' ? spot : Number(spot) - 1;
      const at = c.spotOf(which);
      if (!at) return { ok: false, text: 'No such place in the Citadel.' };
      const label = spot === 'entrance' ? 'the Void Citadel\'s entrance' : spot === 'arena' ? 'the End Guardian\'s arena' : `floor ${spot} of the Void Citadel`;
      h.queueTeleport(p, at[0] + 0.5, at[1], at[2] + 0.5, label, false);
      return pending(`Preparing a landing at ${label}...`);
    }
    case 'citadel_solve': {
      const c = s.citadel;
      if (!c?.plan) return { ok: false, text: 'The Void Citadel has no site yet.' };
      return ok(c.solve(p));
    }
    case 'citadel_reset': {
      const c = s.citadel;
      if (!c) return { ok: false, text: 'The Void Citadel is not running.' };
      return ok(c.reset());
    }
    case 'guardian_spawn': {
      const g = s.guardian;
      if (!g || !s.citadel?.plan) return { ok: false, text: 'The Void Citadel has no site yet.' };
      if (g.fight) return { ok: false, text: 'The End Guardian is already awake.' };
      return g.begin(p, true) ? ok('The End Guardian awakens (cheat: no advancements, no loot).') : { ok: false, text: 'The arena is not loaded: go there first (Citadel: arena).' };
    }
    case 'guardian_defeat':
      return s.guardian ? ok(s.guardian.forceDefeat()) : { ok: false, text: 'The End Guardian is not running.' };
    case 'guardian_reset':
      return s.guardian ? ok(s.guardian.reset()) : { ok: false, text: 'The End Guardian is not running.' };
    case 'guardian_phase':
      return s.guardian ? ok(s.guardian.nextPhase()) : { ok: false, text: 'The End Guardian is not running.' };
    case 'dragon_respawn': {
      const f = s.theEnd?.fight;
      if (!f) return { ok: false, text: 'The End is not running.' };
      if (f.dragon && !f.dragon.dead) return { ok: false, text: 'The Ender Dragon is already here.' };
      return f.adminRespawn() ? ok('The Ender Dragon is back, with its crystals (a cheat: its defeat counts for nothing).') : { ok: false, text: 'Go to the End\'s main island first (it must be loaded).' };
    }
    case 'give_rare': {
      const g = RARE_END_LOOT.find((k) => k.id === set);
      if (!g) return { ok: false, text: 'Unknown item.' };
      for (const [id, n] of g.items) h.give(p, id, n);
      return ok(`Gave the ${g.name} (cheat items: they never count for advancements).`);
    }
    case 'dragon_test': {
      const f = s.theEnd?.fight;
      if (!f) return { ok: false, text: 'The End is not running.' };
      // A test makes the fight a cheat: its defeat awards nothing
      if (f.dragon && !f.dragon.dead) {
        f.dragon.admin = true;
        s.level.flags.dragonAdmin = true;
      }
      return { ...f.extras.test(test ?? ''), data: sys.status(p) };
    }
    case 'where': {
      const st = sys.status(p) as { here: { x: number; y: number; z: number; inExpansion: boolean; biome: string | null } };
      const here = st.here;
      const where = here.inExpansion ? `in the ${here.biome} (Expanded End)` : p.dim.id === 'end' ? 'in the End, outside the Expanded End' : `in the ${p.dim.id}`;
      return ok(`You are ${where} at ${here.x}, ${here.y}, ${here.z}.`);
    }
  }
  return { ok: false, text: 'Unknown action.' };
}
