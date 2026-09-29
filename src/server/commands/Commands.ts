/**
 * Chat commands: gameplay administration and developer/debug tools.
 * Cheat and debug commands require operator status AND cheats enabled on the
 * world, so they are unavailable in normal survival worlds.
 */
import type { GameServer } from '../GameServer';
import type { ServerPlayer } from '../player/ServerPlayer';
import { stateFromString } from '../../common/registry/blocks';
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
        if (s.isMuted(p)) return 'You are muted in this world.';
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
        if (s.isMuted(p)) return 'You are muted in this world.';
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
        s.admin.setGamemode(t, mode);
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
          s.admin.moveTo(p, p.dim.id, x, y, z);
          return `Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
        }
        const who = a.length === 2 ? findPlayer(a[0], p) : p;
        const target = findPlayer(a.length === 2 ? a[1] : a[0], p);
        if (!who || !target) return 'Player not found';
        s.admin.moveTo(who, target.dim.id, target.x, target.y, target.z);
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
        return s.admin.give(t, id, count).text;
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
        s.admin.markSky();
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
        s.admin.markSky();
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
          rules[name] = name === 'randomTickSpeed' ? Math.max(0, Math.min(100, n)) : name === 'dayLengthMinutes' ? Math.max(1, Math.min(240, n)) : name === 'wardenCalmSeconds' ? Math.max(10, Math.min(3600, n)) : n;
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
          const target = Math.max(0, p.xpLevel().level + lv);
          s.admin.setXpLevel(p, target);
          return `Set level to ${target}`;
        }
        const n = parseInt(v, 10);
        if (!Number.isFinite(n)) return 'Usage: /xp <amount>';
        if (n > 0) s.interaction.survival.giveXp(p, n, false, true);
        else {
          const before = p.xpTotal;
          p.xpTotal = Math.max(0, p.xpTotal + n);
          s.admin.onXpLost(p, before - p.xpTotal);
          p.statsDirty = true;
        }
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
        held.tag = { ...(held.tag ?? {}), ench: { ...(held.tag?.ench ?? {}), [e.id]: lvl }, admin: true };
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
        s.admin.moveTo(p, d, x, 128, z);
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
      name: 'mute',
      usage: '/mute <player> [minutes]',
      level: 'op',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t || t === p) return 'Player not found';
        if (s.roleOf(t) === 'owner') return 'The owner cannot be muted';
        const minutes = Math.max(1, Math.min(60 * 24 * 30, parseInt(a[1] ?? '15', 10) || 15));
        s.level.muted[t.uuid] = Date.now() + minutes * 60000;
        t.send({ t: 'chat', text: `You have been muted for ${minutes} minute${minutes === 1 ? '' : 's'}.`, kind: 'error' });
        return `Muted ${t.name} for ${minutes} minute${minutes === 1 ? '' : 's'}`;
      },
    });
    this.register({
      name: 'unmute',
      usage: '/unmute <player>',
      level: 'op',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t) return 'Player not found';
        delete s.level.muted[t.uuid];
        t.send({ t: 'chat', text: 'You can chat again.', kind: 'system' });
        return `Unmuted ${t.name}`;
      },
    });
    this.register({
      name: 'report',
      usage: '/report <player> <reason>',
      level: 'any',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t || t === p) return 'Player not found';
        const reason = a.slice(1).join(' ').slice(0, 200);
        if (reason.length < 3) return 'Please describe what happened: /report <player> <reason>';
        const recent = s.level.reports.filter((r) => r.from === p.uuid && Date.now() - r.at < 60000).length;
        if (recent >= 3) return 'You have sent several reports recently. Please wait a moment.';
        s.level.reports.push({ from: p.uuid, target: t.uuid, reason, at: Date.now() });
        if (s.level.reports.length > 200) s.level.reports.shift();
        s.log(`[report] ${p.name} reported ${t.name}: ${reason}`);
        s.onReport?.(p, t, reason);
        for (const o of s.players.values()) if (o !== p && s.isOperator(o)) o.send({ t: 'chat', text: `${p.name} reported ${t.name}: ${reason}`, kind: 'error' });
        return 'Thank you. Your report was sent to the world operators.';
      },
    });
    this.register({
      name: 'reports',
      usage: '/reports',
      level: 'op',
      run: () => {
        const list = s.level.reports.slice(-5);
        if (!list.length) return 'No reports.';
        const name = (uuid: string): string => [...s.players.values()].find((o) => o.uuid === uuid)?.name ?? uuid.slice(0, 8);
        return list.map((r) => `${new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')} ${name(r.from)} -> ${name(r.target)}: ${r.reason}`).join('\n');
      },
    });
    this.register({
      name: 'role',
      usage: '/role <player> <builder|visitor>',
      level: 'op',
      run: (p, a) => {
        const t = findPlayer(a[0], p);
        if (!t) return 'Player not found';
        const role = a[1];
        if (role !== 'builder' && role !== 'visitor') return `${t.name} is a ${s.roleOf(t)}`;
        const cur = s.roleOf(t);
        if (cur === 'owner' || cur === 'operator') return 'Use /deop first to change an operator';
        s.level.roles[t.uuid] = role;
        t.send({ t: 'world_info', world: s.worldInfo(t) });
        t.send({ t: 'chat', text: role === 'visitor' ? 'You are now a visitor: you can explore but not build.' : 'You can now build in this world.', kind: 'system' });
        return `${t.name} is now a ${role}`;
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
      name: 'fill',
      usage: '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>',
      level: 'cheat',
      run: (p, args) => {
        if (args.length < 7) return 'Usage: /fill <x1> <y1> <z1> <x2> <y2> <z2> <block>';
        const base = [p.x, p.y, p.z];
        const c = args.slice(0, 6).map((v, i) => Math.floor(v.startsWith('~') ? base[i % 3]! + (Number(v.slice(1)) || 0) : Number(v)));
        if (!c.every(Number.isFinite)) return 'Invalid coordinates';
        let state: number;
        try {
          state = args[6] === 'air' ? 0 : stateFromString(args[6]!);
        } catch {
          return `Unknown block: ${args[6]}`;
        }
        const [x0, x1] = [Math.min(c[0]!, c[3]!), Math.max(c[0]!, c[3]!)];
        const [y0, y1] = [Math.max(0, Math.min(c[1]!, c[4]!)), Math.min(255, Math.max(c[1]!, c[4]!))];
        const [z0, z1] = [Math.min(c[2]!, c[5]!), Math.max(c[2]!, c[5]!)];
        const vol = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
        if (vol > 32768) return `Too many blocks (${vol} > 32768)`;
        let n = 0;
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++)
            for (let z = z0; z <= z1; z++) {
              if (!p.dim.isLoaded(x, z)) continue;
              if (p.dim.getState(x, y, z) !== state) {
                p.dim.setBlock(x, y, z, state);
                s.admin.setBlockMark(p.dim, x, y, z, state !== 0);
                n++;
              }
            }
        return `Filled ${n} blocks`;
      },
    });
    this.register({
      name: 'summon',
      usage: '/summon <mob> [x y z] [noai]',
      level: 'cheat',
      run: (p, args) => {
        const type = args[0];
        if (!type || !s.mobs) return 'Usage: /summon <mob> [x y z]';
        const coord = (v: string | undefined, base: number): number => (v === undefined ? base : v.startsWith('~') ? base + (Number(v.slice(1)) || 0) : Number(v));
        const x = coord(args[1], p.x);
        const y = coord(args[2], p.y);
        const z = coord(args[3], p.z);
        if (![x, y, z].every(Number.isFinite)) return 'Invalid coordinates';
        const m = s.mobs.spawn(p.dim, type, x, y, z, { reason: 'command', persistent: true });
        if (m) m.admin = true;
        if (m && args.includes('noai')) {
          m.noAi = true;
          // Face the summoner (handy for inspecting models)
          m.yaw = m.headYaw = Math.atan2(-(p.x - x), -(p.z - z));
        }
        return m ? `Summoned ${m.def.name}` : `Unknown mob: ${type}`;
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
        s.admin.markChunk(p.dim, cx, cz);
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
      // Cheat commands run as admin actions: nothing they cause counts for advancements
      const out = cmd.level === 'cheat' ? this.server.admin.run(() => cmd.run(p, parts)) : cmd.run(p, parts);
      if (out) for (const line of out.split('\n')) p.send({ t: 'chat', text: line, kind: 'system' });
    } catch (e) {
      p.send({ t: 'chat', text: `Command failed: ${(e as Error).message}`, kind: 'error' });
    }
    this.server.log(`[cmd] ${p.name}: /${line}`);
  }
}
