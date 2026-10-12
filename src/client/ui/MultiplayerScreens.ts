/**
 * Multiplayer menus: signing in to a MineHonk server, friends, the world
 * browser, creating online worlds, joining by code and world settings for
 * owners and operators.
 */
import { el, button, clear, cycle } from './dom';
import { titled, wrapClick, messageScreen, confirmScreen, textPrompt, type Screen, type ScreenHost } from './Screens';
import { HubApi } from '../net/HubApi';
import { normalizeJoinCode, validatePassword, validateUsername, type WorldDetails, type WorldSummary, type WorldRole, type FriendsResponse } from '../../common/net/multiplayer';
import { GAME_MODE_INFO, GOD_HEART_PRESETS, type GameMode, type Difficulty, type GodHearts } from '../../common/game/gamemode';

export interface MultiplayerActions {
  play(world: WorldSummary): void;
  back(): void;
}

function status(): HTMLElement {
  return el('div', { class: 'muted status-line', style: { minHeight: 'calc(var(--s) * 10)', textAlign: 'center', maxWidth: 'calc(var(--s) * 300)' } });
}

function setStatus(s: HTMLElement, text: string, error = false): void {
  s.textContent = text;
  s.classList.toggle('error-text', error);
}

function field(placeholder: string, opts: { type?: string; max?: number; value?: string } = {}): HTMLInputElement {
  const i = el('input', { class: 'field', placeholder, type: opts.type ?? 'text', maxLength: opts.max ?? 64, value: opts.value ?? '', autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
  i.addEventListener('keydown', (e) => e.stopPropagation());
  return i;
}

async function busy<T>(btns: HTMLButtonElement[], s: HTMLElement, work: () => Promise<T>): Promise<T | null> {
  for (const b of btns) b.disabled = true;
  setStatus(s, 'Please wait...');
  try {
    const r = await work();
    setStatus(s, '');
    return r;
  } catch (e) {
    setStatus(s, (e as Error).message, true);
    return null;
  } finally {
    for (const b of btns) b.disabled = false;
  }
}

const VIS_LABEL: Record<string, string> = { private: 'Private (join code)', friends: 'Friends', public: 'Public' };
const ROLE_LABEL: Record<WorldRole, string> = { owner: 'Owner', operator: 'Operator', builder: 'Builder', visitor: 'Visitor' };

// ---------------------------------------------------------------------------
// Server address (when no MineHonk server answers)
// ---------------------------------------------------------------------------
export function serverScreen(host: ScreenHost, current: string, actions: { connect(url: string): void }): Screen {
  const { root, body } = titled('Multiplayer');
  const input = field('Server address, e.g. play.example.com', { max: 200, value: current });
  body.append(
    el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } }, current ? `No MineHonk server answered at ${current}.` : 'This page is not served by a MineHonk server. Enter the address of one, or ask whoever runs your server.'),
    input,
    el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } }, 'Leave empty to use the site this game was loaded from.'),
    el('div', { class: 'row' }, button('Connect', wrapClick(host, () => actions.connect(HubApi.normalizeServer(input.value))), 'btn half'), button('Back', wrapClick(host, () => host.pop()), 'btn half')),
  );
  return { root };
}

// ---------------------------------------------------------------------------
// Sign in / create account
// ---------------------------------------------------------------------------
export function signInScreen(host: ScreenHost, api: HubApi, done: () => void, opts: { cloud?: boolean } = {}): Screen {
  const { root, body } = titled('MineHonk Account');
  let creating = false;
  const name = field('Player name', { max: 16 });
  const pw = field('Password', { type: 'password', max: 128 });
  const pw2 = field('Repeat password', { type: 'password', max: 128 });
  const s = status();
  const tabLogin = button('Log In', () => setMode(false), 'btn half');
  const tabCreate = button('Create Account', () => setMode(true), 'btn half');
  const go = button('Log In', () => void submit(), 'btn half');
  const help = el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } });
  const setMode = (c: boolean): void => {
    host.uiClick();
    creating = c;
    tabLogin.classList.toggle('active', !c);
    tabCreate.classList.toggle('active', c);
    pw2.classList.toggle('hidden', !c);
    go.textContent = c ? 'Create Account' : 'Log In';
    help.textContent = opts.cloud
      ? c
        ? 'Names are 3-16 letters, numbers or _. Passwords need 8+ characters. There is no email: remember your password, because it cannot be reset.'
        : 'Your password never leaves this device: it is scrambled here first.'
      : c
        ? 'Names are 3-16 letters, numbers or _. Use a password you do not use anywhere else (8+ characters).'
        : 'Your password is only sent to this server.';
    setStatus(s, '');
  };
  const submit = async (): Promise<void> => {
    const n = name.value.trim();
    if (creating) {
      const err = validateUsername(n) ?? validatePassword(pw.value) ?? (pw.value !== pw2.value ? 'Passwords do not match' : null);
      if (err) return setStatus(s, err, true);
    } else if (!n || !pw.value) return setStatus(s, 'Enter your name and password', true);
    const ok = await busy([go, tabLogin, tabCreate], s, () => (creating ? api.register(n, pw.value) : api.login(n, pw.value)));
    if (ok && creating && opts.cloud) setStatus(s, 'Account created. Remember your password: it cannot be reset.');
    if (ok) {
      pw.value = '';
      pw2.value = '';
      done();
    }
  };
  for (const i of [name, pw, pw2]) i.addEventListener('keydown', (e) => e.key === 'Enter' && void submit());
  setMode(false);
  body.append(el('div', { class: 'row' }, tabLogin, tabCreate), name, pw, pw2, help, s, el('div', { class: 'row' }, go, button('Back', wrapClick(host, () => host.pop()), 'btn half')));
  setTimeout(() => name.focus(), 0);
  return { root };
}

// ---------------------------------------------------------------------------
// Lobby: world browser
// ---------------------------------------------------------------------------
export function lobbyScreen(host: ScreenHost, api: HubApi, actions: MultiplayerActions): Screen {
  const { root, body } = titled('Multiplayer');
  const who = el('div', { class: 'muted' }, `Signed in as ${api.account?.name ?? '?'}`);
  const list = el('div', { class: 'list' });
  const s = status();
  let selected: WorldSummary | null = null;
  let incoming = 0;
  const joinBtn = button('Join World', () => selected && (host.uiClick(), actions.play(selected)), 'btn half');
  const settingsBtn = button('World Settings', () => selected && (host.uiClick(), host.push(worldSettingsScreen(host, api, selected.id, refresh))), 'btn half');
  const friendsBtn = button('Friends', () => (host.uiClick(), host.push(friendsScreen(host, api, () => void refresh()))), 'btn quarter');
  const render = (groups: { title: string; worlds: WorldSummary[] }[]): void => {
    clear(list);
    let any = false;
    for (const g of groups) {
      if (!g.worlds.length) continue;
      any = true;
      list.append(el('div', { class: 'list-header' }, g.title));
      for (const w of g.worlds) {
        const item = el(
          'div',
          { class: 'list-item' + (selected?.id === w.id ? ' selected' : '') },
          el('div', { class: 'icon', style: { backgroundImage: 'var(--menu-tex)', backgroundSize: 'calc(var(--s) * 16)' } }),
          el(
            'div',
            {},
            el('div', {}, w.name),
            el('div', { class: 'meta' }, `${w.ownerName} · ${GAME_MODE_INFO[w.mode as GameMode]?.name ?? w.mode} · ${VIS_LABEL[w.visibility] ?? w.visibility}`),
            el('div', { class: 'meta' }, `${w.players}/${w.maxPlayers} playing${w.role ? ` · you: ${ROLE_LABEL[w.role]}` : ''}`),
          ),
        );
        item.addEventListener('click', () => {
          selected = w;
          render(groups);
        });
        item.addEventListener('dblclick', () => {
          host.uiClick();
          actions.play(w);
        });
        list.append(item);
      }
    }
    if (!any) list.append(el('div', { class: 'muted', style: { padding: 'calc(var(--s) * 8)', textAlign: 'center' } }, 'No worlds yet. Create one, join with a code, or add friends to see theirs.'));
    joinBtn.disabled = !selected;
    settingsBtn.disabled = !selected || (selected.role !== 'owner' && selected.role !== 'operator');
  };
  async function refresh(): Promise<void> {
    const r = await busy([], s, async () => {
      const [w, f] = await Promise.all([api.worlds(), api.friends()]);
      return { w, f };
    });
    if (!r) return;
    incoming = r.f.incoming.length;
    friendsBtn.textContent = incoming ? `Friends (${incoming})` : 'Friends';
    const all = [...r.w.mine, ...r.w.friends, ...r.w.public];
    selected = all.find((x) => x.id === selected?.id) ?? all[0] ?? null;
    render([
      { title: 'Your worlds', worlds: r.w.mine },
      { title: "Friends' worlds", worlds: r.w.friends },
      { title: 'Public worlds', worlds: r.w.public },
    ]);
  }
  body.append(
    who,
    list,
    s,
    el('div', { class: 'row' }, joinBtn, settingsBtn),
    el(
      'div',
      { class: 'row' },
      button('Join by Code', wrapClick(host, () => host.push(joinCodeScreen(host, api, (w) => {
        void refresh();
        actions.play(w);
      }))), 'btn quarter'),
      button('Create World', wrapClick(host, () => host.push(createOnlineWorldScreen(host, api, () => void refresh()))), 'btn quarter'),
      friendsBtn,
      button('Refresh', wrapClick(host, () => void refresh()), 'btn quarter'),
    ),
    el(
      'div',
      { class: 'row' },
      button('Sign Out', wrapClick(host, () => {
        void api.logout();
        actions.back();
      }), 'btn half'),
      button('Back', wrapClick(host, () => actions.back()), 'btn half'),
    ),
  );
  void refresh();
  // Keep presence fresh while the lobby is open
  const timer = setInterval(() => void refresh(), 30000);
  return { root, onClose: () => clearInterval(timer) };
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
export function friendsScreen(host: ScreenHost, api: HubApi, changed: () => void): Screen {
  const { root, body } = titled('Friends');
  const list = el('div', { class: 'list' });
  const s = status();
  const name = field('Friend name', { max: 16 });
  const render = (f: FriendsResponse): void => {
    clear(list);
    if (f.incoming.length) {
      list.append(el('div', { class: 'list-header' }, 'Requests'));
      for (const r of f.incoming) {
        list.append(
          el(
            'div',
            { class: 'list-item' },
            el('div', { style: { flex: '1' } }, r.name, el('div', { class: 'meta' }, 'wants to be friends')),
            button('Accept', () => void act(() => api.acceptFriend(r.uuid)), 'btn tiny'),
            button('Decline', () => void act(() => api.declineFriend(r.uuid)), 'btn tiny'),
          ),
        );
      }
    }
    list.append(el('div', { class: 'list-header' }, `Friends (${f.friends.length})`));
    if (!f.friends.length) list.append(el('div', { class: 'muted', style: { padding: 'calc(var(--s) * 6)' } }, 'Add friends by their player name.'));
    for (const fr of f.friends) {
      list.append(
        el(
          'div',
          { class: 'list-item' },
          el('div', { class: 'presence ' + (fr.online ? 'on' : 'off') }),
          el('div', { style: { flex: '1' } }, fr.name, el('div', { class: 'meta' }, fr.online ? (fr.world ? `Playing in ${fr.world}` : 'Online') : 'Offline')),
          button('Remove', () => host.push(confirmScreen(host, `Remove ${fr.name}?`, 'You will no longer see each other’s friends-only worlds.', 'Remove', () => act(() => api.removeFriend(fr.uuid)))), 'btn tiny'),
        ),
      );
    }
    if (f.outgoing.length) {
      list.append(el('div', { class: 'list-header' }, 'Sent requests'));
      for (const o of f.outgoing) list.append(el('div', { class: 'list-item' }, el('div', { style: { flex: '1' } }, o.name, el('div', { class: 'meta' }, 'waiting')), button('Cancel', () => void act(() => api.declineFriend(o.uuid)), 'btn tiny')));
    }
  };
  const act = async (fn: () => Promise<FriendsResponse>): Promise<void> => {
    host.uiClick();
    const r = await busy([], s, fn);
    if (r) {
      render(r);
      changed();
    }
  };
  const add = async (): Promise<void> => {
    const n = name.value.trim();
    if (!n) return;
    const r = await busy([addBtn], s, () => api.requestFriend(n));
    if (r) {
      name.value = '';
      render(r);
      setStatus(s, r.result === 'accepted' ? `You and ${n} are now friends!` : `Request sent to ${n}.`);
      changed();
    }
  };
  const addBtn = button('Add Friend', () => void add(), 'btn half');
  name.addEventListener('keydown', (e) => e.key === 'Enter' && void add());
  body.append(list, el('div', { class: 'row' }, name, addBtn), s, button('Done', wrapClick(host, () => host.pop()), 'btn half'));
  void busy([], s, () => api.friends()).then((r) => r && render(r));
  return { root };
}

// ---------------------------------------------------------------------------
// Join by code
// ---------------------------------------------------------------------------
export function joinCodeScreen(host: ScreenHost, api: HubApi, joined: (w: WorldSummary) => void): Screen {
  const { root, body } = titled('Join by Code');
  const input = field('ABC7-92KD', { max: 9 });
  input.style.textTransform = 'uppercase';
  input.addEventListener('input', () => {
    const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  });
  const s = status();
  const go = async (): Promise<void> => {
    const code = normalizeJoinCode(input.value);
    if (!code) return setStatus(s, 'Codes look like ABC7-92KD', true);
    const w = await busy([btn], s, () => api.join(code));
    if (w) {
      host.pop();
      joined(w);
    }
  };
  const btn = button('Join', () => void go(), 'btn half');
  input.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
  body.append(el('div', { class: 'muted' }, 'Ask a friend for their world’s join code.'), input, s, el('div', { class: 'row' }, btn, button('Cancel', wrapClick(host, () => host.pop()), 'btn half')));
  setTimeout(() => input.focus(), 0);
  return { root };
}

// ---------------------------------------------------------------------------
// Create an online world
// ---------------------------------------------------------------------------
export function createOnlineWorldScreen(host: ScreenHost, api: HubApi, created: () => void): Screen {
  const { root, body } = titled('Create Online World');
  const o = { name: 'My World', seed: '', mode: 'survival' as GameMode, difficulty: 'normal' as Difficulty, visibility: 'friends', godHearts: 10 as GodHearts };
  const name = field('World name', { max: 48, value: o.name });
  const seed = field('Seed (optional)', { max: 64 });
  const hearts = cycle((v: GodHearts) => `Max Hearts: ${v === 'infinite' ? '∞' : v}`, GOD_HEART_PRESETS, 10 as GodHearts, (v) => (o.godHearts = v));
  const modes: GameMode[] = ['survival', 'hardcore', 'creative', 'adventure', 'god'];
  const mode = cycle((v: GameMode) => `Game Mode: ${GAME_MODE_INFO[v].name}`, modes, o.mode, (v) => {
    o.mode = v;
    hearts.classList.toggle('hidden', v !== 'god');
  });
  hearts.classList.add('hidden');
  const diff = cycle((v: Difficulty) => `Difficulty: ${v[0]!.toUpperCase() + v.slice(1)}`, ['peaceful', 'easy', 'normal', 'hard'] as const, o.difficulty, (v) => (o.difficulty = v));
  const vis = cycle((v: string) => `Who can join: ${VIS_LABEL[v]}`, ['private', 'friends', 'public'], o.visibility, (v) => (o.visibility = v));
  vis.style.width = 'calc(var(--s) * 200)';
  const s = status();
  const go = async (): Promise<void> => {
    const n = name.value.trim();
    if (!n) return setStatus(s, 'Give your world a name', true);
    const d = await busy([btn], s, () => api.createWorld({ name: n, seed: seed.value.trim(), mode: o.mode, difficulty: o.difficulty, visibility: o.visibility, godHearts: o.godHearts }));
    if (d) {
      created();
      host.replace(messageScreen(host, 'World Created', `"${d.name}" is ready.\n\nJoin code: ${d.joinCode ?? 'none'}\nShare it with friends so they can join.`));
    }
  };
  const btn = button('Create', () => void go(), 'btn half');
  body.append(name, el('div', { class: 'row' }, mode, hearts), el('div', { class: 'row' }, diff, vis), seed, s, el('div', { class: 'row' }, btn, button('Cancel', wrapClick(host, () => host.pop()), 'btn half')));
  return { root };
}

// ---------------------------------------------------------------------------
// World settings (owner / operators)
// ---------------------------------------------------------------------------
export function worldSettingsScreen(host: ScreenHost, api: HubApi, id: string, changed: () => void): Screen {
  const { root, body } = titled('World Settings');
  const content = el('div', { class: 'stack' });
  const s = status();
  let d: WorldDetails | null = null;
  const apply = async (fn: () => Promise<WorldDetails>): Promise<void> => {
    host.uiClick();
    const r = await busy([], s, fn);
    if (r) {
      d = r;
      render();
      changed();
    }
  };
  const render = (): void => {
    clear(content);
    if (!d) return;
    const w = d;
    const isOwner = w.role === 'owner';
    const code = el('div', { class: 'join-code' }, w.joinCode ?? 'Join code disabled');
    content.append(
      el('div', {}, w.name),
      el('div', { class: 'row' }, el('div', { class: 'muted' }, 'Join code:'), code),
      el(
        'div',
        { class: 'row' },
        button('New Code', () => void apply(() => api.newCode(id, true)), 'btn quarter'),
        button(w.joinCode ? 'Disable Code' : 'Enable Code', () => void apply(() => api.newCode(id, !w.joinCode)), 'btn quarter'),
        button('Rename', () => host.push(textPrompt(host, 'Rename World', w.name, 48, (n) => apply(() => api.updateWorld(id, { name: n })))), 'btn quarter'),
      ),
      el(
        'div',
        { class: 'row' },
        cycle((v: string) => `Who can join: ${VIS_LABEL[v]}`, ['private', 'friends', 'public'], w.visibility, (v) => void apply(() => api.updateWorld(id, { visibility: v }))),
        cycle((v: boolean) => `PvP: ${v ? 'ON' : 'OFF'}`, [false, true], w.pvp, (v) => void apply(() => api.updateWorld(id, { pvp: v }))),
      ),
      el('div', { class: 'row' }, cycle((v: string) => `New players: ${v === 'visitor' ? 'Visitors' : 'Builders'}`, ['builder', 'visitor'], w.defaultRole, (v) => void apply(() => api.updateWorld(id, { defaultRole: v })))),
    );
    const members = el('div', { class: 'list' });
    for (const m of w.members ?? []) {
      const roles: string[] = isOwner ? ['builder', 'visitor', 'operator'] : ['builder', 'visitor'];
      const canEdit = m.role !== 'owner' && (isOwner || m.role !== 'operator');
      members.append(
        el(
          'div',
          { class: 'list-item' },
          el('div', { style: { flex: '1' } }, m.name, el('div', { class: 'meta' }, ROLE_LABEL[m.role])),
          canEdit ? cycle((v: string) => ROLE_LABEL[v as WorldRole], roles, m.role, (v) => void apply(() => api.setRole(id, m.uuid, v)), 'btn tiny') : null,
          canEdit ? button('Ban', () => host.push(confirmScreen(host, `Ban ${m.name}?`, 'They will be removed and cannot come back until unbanned.', 'Ban', () => apply(() => api.ban(id, m.uuid, true)))), 'btn tiny') : null,
        ),
      );
    }
    content.append(el('div', { class: 'label' }, 'Members'), members);
    if (isOwner)
      content.append(
        button('Delete World', () => host.push(confirmScreen(host, 'Delete this world?', `'${w.name}' will be deleted for everyone. This cannot be undone.`, 'Delete', async () => {
          await api.deleteWorld(id);
          changed();
          host.pop();
        })), 'btn half danger'),
      );
  };
  body.append(content, s, button('Done', wrapClick(host, () => host.pop()), 'btn half'));
  void busy([], s, () => api.world(id)).then((r) => {
    d = r;
    render();
  });
  return { root };
}
