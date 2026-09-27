/**
 * Chat commands: gameplay administration and developer/debug tools.
 * Cheat and debug commands require operator status AND cheats enabled on the
 * world, so they are unavailable in normal survival worlds.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { GAME_MODES, type GameMode, DIFFICULTIES, type Difficulty, maxHealthFor, normalizeGodHearts } from '../../common/game/gamemode';
import { itemById, items } from '../../common/registry/items';
import { stackOf } from '../../common/game/itemstack';
import { ENCHANT_BY_ID } from '../../common/data/enchantments';
import type { DimensionId } from '../../common/data/biomes';
import { biomeOf } from '../../common/registry/biomes';
import { chunkIndex } from '../../common/world/constants';
import { blocks, STATE_BLOCK, stateToString } from '../../common/registry/blocks';
import type { GameRules } from '../world/LevelData';

type Level = 'any' | 'op' | 'cheat';
interface Cmd {
  name: string;
  aliases?: string[];
  usage: string;
  level: Level;
  run(p: ServerPlayer, args: string[]): string | void;
}

export class Commands {
  private readonly cmds = new Map<string, Cmd>();
  /** Extension point for later systems (summon, locate...). */
  register(c: Cmd): void {
    this.cmds.set(c.name, c);
    for (const a of c.aliases ?? []) this.cmds.set(a, c);
  }

  constructor(private readonly server: GameServer) {
    const s = server;
    const findPlayer = (name: string | undefined, self: ServerPlayer): ServerPlayer | null => {
      if (!name || name === '@s') return self;
      for (const o of s.players.values()) if (o.name.toLowerCase() === name.toLowerCase()) return o;
      return null;
    };
    this.register({
      name: 'help',
      usage: '/help',
      level: 'any',
      run: (p) => {
        const list = [...new Set(this.cmds.values())].filter((c) => this.allowed(p, c.level)).map((c) => c.usage);
        return 'Commands: ' + list.join(', ');
      },
    });
    this.register({
      name: 'list',
      usage: '/list',
      level: 'any',
      run: () => `Players online (${s.players.size}): ${[...s.players.values()].map((o) => o.name).join(', ')}`,
    });
    this.register({
      name: 'msg',
      aliases: ['tell', 'w'],
      usage: '/msg <player> <message>',
      level: 'any',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t || !a[1]) return 'Usage: /msg <player> <message>';
        const text = a.slice(1).join(' ');
        const filtered = s.opts.filterChat ? s.opts.filterChat(text, p) : text;
        if (filtered === null) return 'Message blocked by the chat filter.';
        t.send({ t: 'chat', text: `${p.name} whispers to you: ${filtered}`, kind: 'whisper' });
        return `You whisper to ${t.name}: ${filtered}`;
      },
    });
    this.register({
      name: 'me',
      usage: '/me <action>',
      level: 'any',
      run: (p, a) => {
        if (!a.length) return;
        const text = a.join(' ');
        const filtered = s.opts.filterChat ? s.opts.filterChat(text, p) : text;
        if (filtered !== null) s.broadcastChat(`* ${p.name} ${filtered}`, 'chat');
      },
    });
    this.register({ name: 'seed', usage: '/seed', level: 'op', run: () => `Seed: ${s.level.seed}` });
    this.register({
      name: 'gamemode',
      aliases: ['gm'],
      usage: '/gamemode <mode> [player]',
      level: 'cheat',
      run: (p, a) => {
        const alias: Record<string, GameMode> = { s: 'survival', c: 'creative', a: 'adventure', sp: 'spectator', '0': 'survival', '1': 'creative', '2': 'adventure', '3': 'spectator', g: 'god' };
        const mode = (alias[a[0] ?? ''] ?? a[0]) as GameMode;
        if (!GAME_MODES.includes(mode) || mode === 'hardcore') return 'Unknown game mode';
        const t = findPlayer(a[1], p);
        if (!t) return 'Player not found';
        t.setGamemode(mode);
        t.maxHealth = maxHealthFor(mode, s.level.godHearts);
        if (Number.isFinite(t.maxHealth)) t.health = Math.min(t.health, t.maxHealth);
        else t.health = 20;
        t.statsDirty = true;
        t.send({ t: 'gamemode', mode, abilities: t.abilitiesMsg() });
        s.sendPlayerList();
        return `Set ${t.name}'s game mode to ${mode}`;
      },
    });
    this.register({
      name: 'tp',
      aliases: ['teleport'],
      usage: '/tp <x> <y> <z> | /tp <player> [target]',
      level: 'cheat',
      run: (p, a) => {
        if (a.length >= 3) {
          const rel = (v: string, base: number): number => (v.startsWith('~') ? base + (parseFloat(v.slice(1)) || 0) : parseFloat(v));
          const x = rel(a[0]!, p.x);
          const y = rel(a[1]!, p.y);
          const z = rel(a[2]!, p.z);
          if (![x, y, z].every(Number.isFinite) || Math.abs(x) > 29_999_000 || Math.abs(z) > 29_999_000) return 'Invalid coordinates';
          s.teleport(p, x, y, z);
          return `Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
        }
        const who = a.length === 2 ? findPlayer(a[0], p) : p;
        const target = findPlayer(a.length === 2 ? a[1] : a[0], p);
        if (!who || !target) return 'Player not found';
        if (who.dim !== target.dim) s.changeDimension(who, target.dim.id, target.x, target.y, target.z);
        else s.teleport(who, target.x, target.y, target.z);
        return `Teleported ${who.name} to ${target.name}`;
      },
    });
    this.register({
      name: 'give',
      usage: '/give <item> [count] [player]',
      level: 'cheat',
      run: (p, a) => {
        const id = (a[0] ?? '').replace('minehonk:', '');
        const it = itemById.get(id);
        if (!it || it.num === 0) return `Unknown item ${id}`;
        const count = Math.max(1, Math.min(64 * 36, parseInt(a[1] ?? '1', 10) || 1));
        const t = findPlayer(a[2], p);
        if (!t) return 'Player not found';
        let left = count;
        while (left > 0) {
          const n = Math.min(left, it.maxStack);
          const rem = t.inventory.add(stackOf(id, n));
          if (rem) s.interaction.dropStack(t, rem);
          left -= n;
        }
        s.interaction.syncInventory(t);
        return `Gave ${count} ${it.def.name} to ${t.name}`;
      },
    });
    this.register({
      name: 'clear',
      usage: '/clear [player]',
      level: 'cheat',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t) return 'Player not found';
        t.inventory.clear();
        s.interaction.syncInventory(t);
        return `Cleared ${t.name}'s inventory`;
      },
    });
    this.register({
      name: 'time',
      usage: '/time set <day|noon|night|midnight|ticks> | /time add <ticks> | /time query',
      level: 'cheat',
      run: (_p, a) => {
        const named: Record<string, number> = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
        if (a[0] === 'query') return `Time: ${s.level.dayTime} (day ${Math.floor(s.level.time / 24000)})`;
        const v = named[a[1] ?? ''] ?? parseInt(a[1] ?? '', 10);
        if (!Number.isFinite(v)) return 'Usage: /time set <value>';
        s.level.dayTime = a[0] === 'add' ? (s.level.dayTime + v) % 24000 : ((v % 24000) + 24000) % 24000;
        s.sendTime();
        return `Set time to ${s.level.dayTime}`;
      },
    });
    this.register({
      name: 'weather',
      usage: '/weather <clear|rain|thunder> [seconds]',
      level: 'cheat',
      run: (_p, a) => {
        const k = a[0] as 'clear' | 'rain' | 'thunder';
        if (!['clear', 'rain', 'thunder'].includes(k)) return 'Usage: /weather <clear|rain|thunder>';
        const secs = parseInt(a[1] ?? '', 10);
        s.interaction.weather.set(k, Number.isFinite(secs) ? secs * 20 : undefined);
        return `Weather set to ${k}`;
      },
    });
    this.register({
      name: 'difficulty',
      usage: '/difficulty <peaceful|easy|normal|hard>',
      level: 'op',
      run: (_p, a) => {
        if (s.level.hardcore) return 'Difficulty is locked in Hardcore';
        const d = a[0] as Difficulty;
        if (!DIFFICULTIES.includes(d)) return `Difficulty: ${s.level.difficulty}`;
        s.level.difficulty = d;
        for (const o of s.players.values()) o.send({ t: 'world_info', world: s.worldInfo(o) });
        return `Difficulty set to ${d}`;
      },
    });
    this.register({
      name: 'gamerule',
      usage: '/gamerule <rule> [value]',
      level: 'op',
      run: (_p, a) => {
        const rules = s.level.rules as unknown as Record<string, unknown>;
        const name = a[0] ?? '';
        if (!(name in rules)) return 'Rules: ' + Object.keys(rules).join(', ');
        if (a[1] === undefined) return `${name} = ${rules[name]}`;
        const cur = rules[name];
        if (typeof cur === 'boolean') rules[name] = a[1] === 'true';
        else if (typeof cur === 'number') {
          const n = parseFloat(a[1]);
          if (!Number.isFinite(n)) return 'Invalid number';
          rules[name] = name === 'randomTickSpeed' ? Math.max(0, Math.min(100, n)) : name === 'dayLengthMinutes' ? Math.max(1, Math.min(240, n)) : n;
        }
        if (name === 'doDaylightCycle' || name === 'dayLengthMinutes') s.sendTime();
        return `Gamerule ${name} is now ${rules[name]}`;
        void (null as unknown as GameRules);
      },
    });
    this.register({
      name: 'godhearts',
      usage: '/godhearts <1-99|infinite>',
      level: 'op',
      run: (_p, a) => {
        if (s.level.mode !== 'god') return 'This world is not in God Mode';
        const v = normalizeGodHearts(a[0] === 'infinite' || a[0] === 'inf' ? 'infinite' : a[0]);
        s.level.godHearts = v;
        for (const o of s.players.values()) {
          if (o.gamemode !== 'god') continue;
          o.maxHealth = maxHealthFor('god', v);
          o.health = Number.isFinite(o.maxHealth) ? Math.min(o.maxHealth, Math.max(o.health, 1)) : 20;
          o.statsDirty = true;
          o.send({ t: 'world_info', world: s.worldInfo(o) });
        }
        return `God Mode maximum health set to ${v === 'infinite' ? 'infinite' : v + ' hearts'}`;
      },
    });
    this.register({
      name: 'kill',
      usage: '/kill [player]',
      level: 'cheat',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t) return 'Player not found';
        s.interaction.survival.damage(t, Number.MAX_SAFE_INTEGER, { source: 'kill' });
        if (!t.dead) s.interaction.survival.die(t, { source: 'kill' });
      },
    });
    this.register({
      name: 'heal',
      usage: '/heal [player]',
      level: 'cheat',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t) return 'Player not found';
        if (Number.isFinite(t.maxHealth)) t.health = t.maxHealth;
        t.food = 20;
        t.saturation = 20;
        t.air = t.maxAir;
        t.statsDirty = true;
        return `Healed ${t.name}`;
      },
    });
    this.register({
      name: 'effect',
      usage: '/effect <id|clear> [seconds] [amplifier]',
      level: 'cheat',
      run: (p, a) => {
        if (a[0] === 'clear') {
          p.effects.clear();
          p.statsDirty = true;
          return 'Cleared effects';
        }
        const id = a[0];
        if (!id) return 'Usage: /effect <id> [seconds] [amplifier]';
        const secs = Math.max(1, Math.min(100000, parseInt(a[1] ?? '30', 10) || 30));
        const amp = Math.max(0, Math.min(255, parseInt(a[2] ?? '0', 10) || 0));
        s.interaction.survival.addEffect(p, id, amp, secs * 20);
        return `Applied ${id} ${amp + 1} for ${secs}s`;
      },
    });
    this.register({
      name: 'xp',
      aliases: ['experience'],
      usage: '/xp <amount>[L]',
      level: 'cheat',
      run: (p, a) => {
        const v = a[0] ?? '';
        if (v.endsWith('L') || v.endsWith('l')) {
          const lv = parseInt(v, 10);
          let total = 0;
          const target = p.xpLevel().level + lv;
          for (let l = 0; l < target; l++) total += l >= 30 ? 112 + (l - 30) * 9 : l >= 15 ? 37 + (l - 15) * 5 : 7 + l * 2;
          p.xpTotal = Math.max(0, total);
          p.statsDirty = true;
          return `Set level to ${target}`;
        }
        const n = parseInt(v, 10);
        if (!Number.isFinite(n)) return 'Usage: /xp <amount>';
        s.interaction.survival.giveXp(p, n);
        return `Gave ${n} experience`;
      },
    });
    this.register({
      name: 'enchant',
      usage: '/enchant <id> [level]',
      level: 'cheat',
      run: (p, a) => {
        const e = ENCHANT_BY_ID.get(a[0] ?? '');
        const held = p.heldItem();
        if (!e) return 'Unknown enchantment';
        if (!held) return 'Hold an item';
        const lvl = Math.max(1, Math.min(10, parseInt(a[1] ?? '1', 10) || 1));
        held.tag = { ...(held.tag ?? {}), ench: { ...(held.tag?.ench ?? {}), [e.id]: lvl } };
        p.inventory.set(p.selectedSlot, held);
        s.interaction.syncInventory(p);
        return `Enchanted with ${e.name} ${lvl}`;
      },
    });
    this.register({
      name: 'spawnpoint',
      usage: '/spawnpoint',
      level: 'cheat',
      run: (p) => {
        p.spawnPoint = { dim: p.dim.id, x: p.x, y: p.y, z: p.z, forced: true };
        return 'Spawn point set';
      },
    });
    this.register({
      name: 'setworldspawn',
      usage: '/setworldspawn',
      level: 'op',
      run: (p) => {
        s.level.spawn = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
        return 'World spawn set';
      },
    });
    this.register({
      name: 'dimension',
      aliases: ['dim'],
      usage: '/dimension <overworld|nether|end|farlands>',
      level: 'cheat',
      run: (p, a) => {
        const d = a[0] as DimensionId;
        if (!s.dims.has(d)) return 'Unknown dimension';
        const scale = s.dim(d).rules.scale / p.dim.rules.scale;
        const x = p.x / scale;
        const z = p.z / scale;
        s.changeDimension(p, d, x, 128, z);
        (p as { needsSafeSpawn?: boolean }).needsSafeSpawn = true;
        return `Travelling to ${d}`;
      },
    });
    this.register({
      name: 'save',
      aliases: ['save-all'],
      usage: '/save',
      level: 'op',
      run: (p) => {
        void s.saveAll().then(
          () => p.send({ t: 'chat', text: 'World saved', kind: 'system' }),
          (e) => p.send({ t: 'chat', text: `Save failed: ${e}`, kind: 'error' }),
        );
        return 'Saving...';
      },
    });
    this.register({
      name: 'kick',
      usage: '/kick <player> [reason]',
      level: 'op',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t || t === p) return 'Player not found';
        s.kick(t, a.slice(1).join(' ') || 'Kicked by an operator');
        return `Kicked ${t.name}`;
      },
    });
    this.register({
      name: 'ban',
      usage: '/ban <player>',
      level: 'op',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t || t === p) return 'Player not found';
        if (!s.level.banned.includes(t.uuid)) s.level.banned.push(t.uuid);
        s.kick(t, 'You have been banned from this world');
        return `Banned ${t.name}`;
      },
    });
    this.register({
      name: 'op',
      usage: '/op <player>',
      level: 'op',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t) return 'Player not found';
        if (!s.level.operators.includes(t.uuid)) s.level.operators.push(t.uuid);
        t.send({ t: 'world_info', world: s.worldInfo(t) });
        return `${t.name} is now an operator`;
      },
    });
    this.register({
      name: 'deop',
      usage: '/deop <player>',
      level: 'op',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t) return 'Player not found';
        if (t.uuid === s.level.owner) return 'The owner cannot be de-opped';
        s.level.operators = s.level.operators.filter((u) => u !== t.uuid);
        t.send({ t: 'world_info', world: s.worldInfo(t) });
        return `${t.name} is no longer an operator`;
      },
    });
    this.register({
      name: 'pvp',
      usage: '/pvp <on|off>',
      level: 'op',
      run: (_p, a) => {
        if (a[0] !== 'on' && a[0] !== 'off') return `PvP is ${s.level.pvp ? 'on' : 'off'}`;
        s.level.pvp = a[0] === 'on';
        for (const o of s.players.values()) o.send({ t: 'world_info', world: s.worldInfo(o) });
        s.broadcastChat(`PvP has been turned ${a[0]}`, 'announce');
      },
    });
    this.register({
      name: 'locate',
      usage: '/locate <structure>',
      level: 'cheat',
      run: (p, args) => {
        const type = args[0];
        if (!type) return 'Usage: /locate <village|stronghold|desert_temple|jungle_temple|witch_hut|igloo|ruined_portal|shipwreck|ocean_ruin|pillager_outpost|mineshaft|sky_shrine|overgrown_ruin|stalker_den|glitched_ruin>';
        const loc = p.dim.generator.locate?.(type, Math.floor(p.x), Math.floor(p.z));
        if (!loc) return `No ${type} found nearby`;
        const d = Math.round(Math.hypot(loc.x - p.x, loc.z - p.z));
        return `The nearest ${type} is at [${loc.x}, ~, ${loc.z}] (${d} blocks away)`;
      },
    });
    // --- Debug tools ---
    this.register({
      name: 'tps',
      aliases: ['perf'],
      usage: '/tps',
      level: 'op',
      run: () => {
        const tps = Math.min(20, 1000 / Math.max(50, s.avgTickMs));
        let chunks = 0;
        let ents = 0;
        for (const d of s.dims.values()) {
          chunks += d.chunks.size;
          ents += d.entities.size;
        }
        const ow = s.overworld;
        const gen = ow.genCount ? (ow.genMsTotal / ow.genCount).toFixed(2) : '-';
        return `TPS ${tps.toFixed(1)} | tick ${s.avgTickMs.toFixed(1)}ms | chunks ${chunks} | entities ${ents} | gen ${gen}ms/chunk | pending ${ow.pendingGeneration}`;
      },
    });
    this.register({
      name: 'chunk',
      usage: '/chunk',
      level: 'cheat',
      run: (p) => {
        const cx = Math.floor(p.x) >> 4;
        const cz = Math.floor(p.z) >> 4;
        const c = p.dim.chunks.get(chunkIndex(cx, cz));
        if (!c) return 'Chunk not loaded';
        const sections = c.sections.map((sec, i) => (sec ? `${i}:${c.counts[i]}` : '')).filter(Boolean).join(' ');
        const bx = Math.floor(p.x);
        const by = Math.floor(p.y - 0.5);
        const bz = Math.floor(p.z);
        const under = stateToString(p.dim.getState(bx, by, bz));
        return `Chunk ${cx},${cz} biome ${biomeOf(c.getBiome(bx & 15, bz & 15)).name} | modified ${c.modified} | sections ${sections} | block entities ${c.blockEntities.size} | light ${p.dim.getLight(bx, by + 1, bz).toString(16)} | under ${under}`;
      },
    });
    this.register({
      name: 'regen',
      usage: '/regen',
      level: 'cheat',
      run: (p) => {
        const cx = Math.floor(p.x) >> 4;
        const cz = Math.floor(p.z) >> 4;
        const fresh = p.dim.generator.generate(cx, cz);
        for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
          const st = fresh.get(x, y, z);
          const wx = (cx << 4) + x;
          const wz = (cz << 4) + z;
          if (p.dim.getState(wx, y, wz) !== st) p.dim.setBlock(wx, y, wz, st, { updateNeighbors: false });
        }
        return `Regenerated chunk ${cx},${cz}`;
      },
    });
    this.register({
      name: 'blockinfo',
      usage: '/blockinfo',
      level: 'cheat',
      run: (p) => {
        const st = p.dim.getState(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z));
        const def = blocks[STATE_BLOCK[st]!]!.def;
        return `${stateToString(st)} hardness=${def.hardness} tool=${def.tool ?? '-'} level=${def.harvestLevel ?? '-'}`;
      },
    });
    void items;
  }

  private allowed(p: ServerPlayer, level: Level): boolean {
    if (level === 'any') return true;
    if (level === 'op') return this.server.isOperator(p);
    return this.server.isOperator(p) && this.server.level.cheats;
  }

  run(p: ServerPlayer, line: string): void {
    const parts = line.trim().split(/\s+/);
    const name = (parts.shift() ?? '').toLowerCase();
    const cmd = this.cmds.get(name);
    if (!cmd) {
      p.send({ t: 'chat', text: `Unknown command /${name}. Type /help`, kind: 'error' });
      return;
    }
    if (!this.allowed(p, cmd.level)) {
      p.send({ t: 'chat', text: cmd.level === 'cheat' && this.server.isOperator(p) ? 'Cheats are disabled in this world' : 'You do not have permission to use this command', kind: 'error' });
      return;
    }
    try {
      const out = cmd.run(p, parts);
      if (out) p.send({ t: 'chat', text: out, kind: 'system' });
    } catch (e) {
      p.send({ t: 'chat', text: `Command failed: ${(e as Error).message}`, kind: 'error' });
    }
    this.server.log(`[cmd] ${p.name}: /${line}`);
  }
}
