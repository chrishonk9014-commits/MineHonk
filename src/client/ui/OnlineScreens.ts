/**
 * Playing online through the cloud hub (worlds hosted in players' browsers):
 * the Multiplayer screen's four tabs (Host, Join, Friends, Public), the
 * hosting settings, the in-game hosting panel, inviting friends and the
 * player list with roles.
 */
import { el, button, clear, cycle } from './dom';
import { titled, wrapClick, confirmScreen, type Screen, type ScreenHost, type WorldSummary as LocalWorld } from './Screens';
import type { HubApi } from '../net/HubApi';
import type { HostOptions, HostSession } from '../net/HostSession';
import { normalizeJoinCode, type FriendsResponse, type WorldSummary, type WorldRole, type WorldVisibility } from '../../common/net/multiplayer';
import { GAME_MODE_INFO, type GameMode } from '../../common/game/gamemode';

export interface OnlineContext {
  api: HubApi;
  isTouch: boolean;
  localWorlds(): Promise<LocalWorld[]>;
  /** Starts hosting a single player world (null: create a new one first). */
  host(worldId: string | null, options: HostOptions): void;
  /** Joins a world that is online now (by its hub id). */
  join(worldId: string): Promise<void>;
  serverAddress(): void;
  signOut(): void;
  back(): void;
}

const VIS: WorldVisibility[] = ['private', 'friends', 'public'];
const VIS_LABEL: Record<WorldVisibility, string> = { private: 'Private (code only)', friends: 'Friends', public: 'Public' };
const VIS_HELP: Record<WorldVisibility, string> = {
  private: 'Only players with the join code can come in.',
  friends: 'Your friends can join from their friends list, no code needed.',
  public: 'Listed in the Public tab for anyone. Connections always go through a relay, so nobody sees anyone else’s IP address.',
};
const ROLE_LABEL: Record<WorldRole, string> = { owner: 'Owner', operator: 'Operator', builder: 'Builder', visitor: 'Visitor' };

function status(): HTMLElement {
  return el('div', { class: 'muted status-line', style: { minHeight: 'calc(var(--s) * 10)', textAlign: 'center', maxWidth: 'calc(var(--s) * 300)' } });
}

function setStatus(s: HTMLElement, text: string, error = false): void {
  s.textContent = text;
  s.classList.toggle('error-text', error);
}

function field(placeholder: string, opts: { max?: number; value?: string } = {}): HTMLInputElement {
  const i = el('input', { class: 'field', placeholder, maxLength: opts.max ?? 64, value: opts.value ?? '', autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
  i.addEventListener('keydown', (e) => e.stopPropagation());
  return i;
}

async function busy<T>(btns: HTMLButtonElement[], s: HTMLElement, work: () => Promise<T>, label = 'Please wait...'): Promise<T | null> {
  for (const b of btns) b.disabled = true;
  setStatus(s, label);
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

const badge = (text: string, cls = ''): HTMLElement => el('span', { class: `badge ${cls}` }, text);
const modeName = (m: string): string => GAME_MODE_INFO[m as GameMode]?.name ?? m;

// ---------------------------------------------------------------------------
// Hosting settings (the Host tab, "Open to Multiplayer", the hosting panel)
// ---------------------------------------------------------------------------
export function hostOptionsForm(o: HostOptions, isTouch: boolean, opts: { lockName?: boolean } = {}): { root: HTMLElement; read: () => HostOptions } {
  const cur = { ...o };
  const name = field('World name', { max: 48, value: cur.name });
  if (opts.lockName) name.disabled = true;
  const visHelp = el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } }, VIS_HELP[cur.visibility]);
  const vis = cycle((v: WorldVisibility) => `Visibility: ${VIS_LABEL[v]}`, VIS, cur.visibility, (v) => {
    cur.visibility = v;
    visHelp.textContent = VIS_HELP[v];
  }, 'btn half');
  const sizes = [2, 3, 4, 5, 6, 8, 10, 12, 16];
  const max = cycle((v: number) => `Max Players: ${v}`, sizes, sizes.includes(cur.maxPlayers) ? cur.maxPlayers : 8, (v) => (cur.maxPlayers = v), 'btn half');
  const onOff = (label: string) => (v: boolean): string => `${label}: ${v ? 'ON' : 'OFF'}`;
  const cheats = cycle(onOff('Allow Cheats'), [false, true], cur.cheats, (v) => (cur.cheats = v), 'btn half');
  const pvp = cycle(onOff('PvP'), [false, true], cur.pvp, (v) => (cur.pvp = v), 'btn half');
  const role = cycle((v: 'builder' | 'visitor') => `Joiners: ${v === 'visitor' ? 'Visitors' : 'Builders'}`, ['builder', 'visitor'] as const, cur.defaultRole, (v) => (cur.defaultRole = v), 'btn half');
  const root = el(
    'div',
    { class: 'stack' },
    name,
    el('div', { class: 'row' }, vis, max),
    visHelp,
    el('div', { class: 'row' }, cheats, pvp),
    el('div', { class: 'row' }, role),
    el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } }, 'Builders can build and break; visitors can only look around. With cheats on, you and your operators get the Admin Panel.'),
    isTouch ? el('div', { class: 'warn-text', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } }, 'Hosting works best on a computer.') : null,
  );
  return {
    root,
    read: () => ({ ...cur, name: name.value.trim().slice(0, 48) || cur.name }),
  };
}

export function hostSettingsScreen(host: ScreenHost, title: string, initial: HostOptions, isTouch: boolean, startLabel: string, start: (o: HostOptions) => void | Promise<void>): Screen {
  const { root, body } = titled(title);
  const form = hostOptionsForm(initial, isTouch);
  const s = status();
  const go = button(startLabel, () => {
    host.uiClick();
    const o = form.read();
    if (!o.name) return setStatus(s, 'Give your world a name', true);
    void busy([go], s, async () => start(o), 'Going online...');
  }, 'btn half');
  body.append(form.root, el('div', { class: 'muted' }, 'Keep this tab open while you host: your world is online only while it runs here.'), s, el('div', { class: 'row' }, go, button('Cancel', wrapClick(host, () => host.pop()), 'btn half')));
  return { root };
}

// ---------------------------------------------------------------------------
// The Multiplayer screen: Host / Join / Friends / Public
// ---------------------------------------------------------------------------
type Tab = 'host' | 'join' | 'friends' | 'public';

export function onlineScreen(host: ScreenHost, ctx: OnlineContext, start: Tab = 'host'): Screen {
  const { root, body } = titled('Multiplayer');
  const api = ctx.api;
  let tab: Tab = start;
  const tabs = el('div', { class: 'row' });
  const content = el('div', { class: 'stack online-tab' });
  const s = status();
  const who = el('div', { class: 'muted' }, `Signed in as ${api.account?.name ?? '?'}`);
  let timer: ReturnType<typeof setInterval> | null = null;
  const names: Record<Tab, string> = { host: 'Host', join: 'Join', friends: 'Friends', public: 'Public' };
  let incoming = 0;

  const renderTabs = (): void => {
    clear(tabs);
    for (const t of ['host', 'join', 'friends', 'public'] as Tab[]) {
      const b = el('button', { class: 'btn chip online-chip' + (t === tab ? ' active' : '') }, t === 'friends' && incoming ? `Friends (${incoming})` : names[t]) as HTMLButtonElement;
      b.dataset.tab = t;
      b.onclick = (e) => {
        e.stopPropagation();
        host.uiClick();
        show(t);
      };
      tabs.append(b);
    }
  };

  const show = (t: Tab): void => {
    tab = t;
    if (timer) clearInterval(timer);
    timer = null;
    setStatus(s, '');
    renderTabs();
    clear(content);
    if (t === 'host') void hostTab();
    else if (t === 'join') joinTab();
    else if (t === 'friends') {
      void friendsTab();
      timer = setInterval(() => void friendsTab(true), 15_000);
    } else {
      void publicTab();
      timer = setInterval(() => void publicTab(true), 30_000);
    }
  };

  // ------------------------------------------------------------ Host
  const hostTab = async (): Promise<void> => {
    const list = el('div', { class: 'list' });
    let worlds: LocalWorld[] = [];
    try {
      worlds = await ctx.localWorlds();
    } catch (e) {
      setStatus(s, (e as Error).message, true);
    }
    let selected: LocalWorld | null = worlds[0] ?? null;
    const render = (): void => {
      clear(list);
      list.append(el('div', { class: 'list-header' }, 'Your worlds (on this device)'));
      for (const w of worlds) {
        const item = el(
          'div',
          { class: 'list-item' + (selected?.id === w.id ? ' selected' : '') },
          el('div', { class: 'icon', style: w.icon ? { backgroundImage: `url(${w.icon})`, backgroundSize: 'cover' } : { backgroundImage: 'var(--menu-tex)', backgroundSize: 'calc(var(--s) * 16)' } }),
          el('div', {}, el('div', {}, w.name), el('div', { class: 'meta' }, `${modeName(w.mode)}${w.cheats ? ' · Cheats' : ''}`)),
        );
        item.addEventListener('click', () => {
          selected = w;
          render();
        });
        item.addEventListener('dblclick', () => openSettings(w));
        list.append(item);
      }
      if (!worlds.length) list.append(el('div', { class: 'muted', style: { padding: 'calc(var(--s) * 8)', textAlign: 'center' } }, 'No worlds yet: create a new one to host.'));
      hostBtn.disabled = !selected;
    };
    const openSettings = (w: LocalWorld | null): void => {
      host.uiClick();
      const initial: HostOptions = { name: w?.name ?? `${api.account?.name ?? 'My'}'s World`, visibility: 'friends', maxPlayers: 8, cheats: w?.cheats ?? false, pvp: false, defaultRole: 'builder', mode: w?.mode ?? 'survival' };
      host.push(hostSettingsScreen(host, w ? `Host "${w.name}"` : 'Host a New World', initial, ctx.isTouch, 'Start Hosting', (o) => ctx.host(w?.id ?? null, o)));
    };
    const hostBtn = button('Host Selected World', () => selected && openSettings(selected), 'btn half');
    render();
    content.append(list, el('div', { class: 'row' }, hostBtn, button('Create New World', () => openSettings(null), 'btn half')));
    if (ctx.isTouch) content.append(el('div', { class: 'warn-text' }, 'Hosting works best on a computer.'));
  };

  // ------------------------------------------------------------ Join
  const joinTab = (): void => {
    const input = field('Join code, e.g. ABC7-92KD', { max: 12 });
    const btn = button('Join', () => void go(), 'btn half join-go');
    const go = async (): Promise<void> => {
      const code = normalizeJoinCode(input.value);
      if (!code) return setStatus(s, 'Join codes look like ABC7-92KD', true);
      host.uiClick();
      const w = await busy([btn], s, () => api.join(code), 'Looking for the world...');
      if (w) await joinWorld(w.id, btn);
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
    content.append(el('div', { class: 'muted' }, 'Ask a friend for their world’s join code.'), input, el('div', { class: 'row' }, btn));
    setTimeout(() => input.focus(), 0);
  };

  const joinWorld = async (worldId: string, btn?: HTMLButtonElement): Promise<void> => {
    await busy(btn ? [btn] : [], s, () => ctx.join(worldId), 'Connecting to the host...');
  };

  // ------------------------------------------------------------ Friends
  let friendsData: FriendsResponse | null = null;
  const friendsTab = async (quiet = false): Promise<void> => {
    const r = quiet ? await api.friends().catch(() => null) : await busy([], s, () => api.friends());
    if (!r || tab !== 'friends') return;
    friendsData = r;
    incoming = r.incoming.length;
    renderTabs();
    renderFriends();
  };
  const act = async (fn: () => Promise<FriendsResponse>): Promise<void> => {
    const r = await busy([], s, fn);
    if (r) {
      friendsData = r;
      incoming = r.incoming.length;
      renderTabs();
      renderFriends();
    }
  };
  const renderFriends = (): void => {
    const f = friendsData;
    clear(content);
    if (!f) return;
    const list = el('div', { class: 'list' });
    if (f.incoming.length) {
      list.append(el('div', { class: 'list-header' }, 'Friend requests'));
      for (const r of f.incoming)
        list.append(el('div', { class: 'list-item' }, el('div', { style: { flex: '1' } }, r.name, el('div', { class: 'meta' }, 'wants to be friends')), button('Accept', () => void act(() => api.acceptFriend(r.uuid)), 'btn tiny'), button('Decline', () => void act(() => api.declineFriend(r.uuid)), 'btn tiny')));
    }
    list.append(el('div', { class: 'list-header' }, `Friends (${f.friends.length})`));
    if (!f.friends.length) list.append(el('div', { class: 'muted', style: { padding: 'calc(var(--s) * 6)' } }, 'Add friends by their player name.'));
    for (const fr of f.friends) {
      const where = fr.worldId ? `Playing ${fr.world}` : fr.online ? 'Online' : 'Offline';
      const row = el(
        'div',
        { class: 'list-item friend-row' },
        el('div', { class: 'presence ' + (fr.online ? 'on' : 'off') }),
        el('div', { style: { flex: '1' } }, fr.name, el('div', { class: 'meta' }, where, fr.worldId && fr.cheats ? badge('Cheats ON', 'cheats') : null)),
      );
      if (fr.worldId) row.append(button('JOIN', () => void joinWorld(fr.worldId!), 'btn tiny join-btn'));
      row.append(button('Remove', () => host.push(confirmScreen(host, 'Remove friend?', `Remove ${fr.name} from your friends?`, 'Remove', async () => {
        await act(() => api.removeFriend(fr.uuid));
      })), 'btn tiny'));
      row.append(button('Block', () => host.push(confirmScreen(host, 'Block player?', `${fr.name} will no longer be your friend, cannot send you requests or invites, and cannot join your worlds.`, 'Block', async () => {
        await act(() => api.blockPlayer({ uuid: fr.uuid }));
      })), 'btn tiny danger'));
      list.append(row);
    }
    if (f.outgoing.length) {
      list.append(el('div', { class: 'list-header' }, 'Sent requests'));
      for (const o of f.outgoing) list.append(el('div', { class: 'list-item' }, el('div', { style: { flex: '1' } }, o.name, el('div', { class: 'meta' }, 'waiting')), button('Cancel', () => void act(() => api.declineFriend(o.uuid)), 'btn tiny')));
    }
    if (f.blocked?.length) {
      list.append(el('div', { class: 'list-header' }, 'Blocked'));
      for (const b of f.blocked) list.append(el('div', { class: 'list-item' }, el('div', { style: { flex: '1' } }, b.name), button('Unblock', () => void act(() => api.unblockPlayer(b.uuid)), 'btn tiny')));
    }
    const name = field('Player name', { max: 16 });
    const add = button('Add Friend', () => void addFriend(), 'btn quarter');
    const addFriend = async (): Promise<void> => {
      const n = name.value.trim();
      if (!n) return;
      const r = await busy([add], s, () => api.requestFriend(n));
      if (r) {
        name.value = '';
        setStatus(s, r.result === 'accepted' ? `You and ${n} are now friends` : `Friend request sent to ${n}`);
        friendsData = r;
        renderFriends();
      }
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && void addFriend());
    const block = button('Block', () => {
      const n = name.value.trim();
      if (n) void act(() => api.blockPlayer({ name: n }));
    }, 'btn quarter');
    content.append(list, el('div', { class: 'row' }, name, add, block));
  };

  // ------------------------------------------------------------ Public
  let publicWorlds: WorldSummary[] = [];
  const search = field('Search worlds or hosts', { max: 32 });
  search.addEventListener('input', () => renderPublic());
  const publicTab = async (quiet = false): Promise<void> => {
    const r = quiet ? await api.worlds().catch(() => null) : await busy([], s, () => api.worlds());
    if (!r || tab !== 'public') return;
    publicWorlds = r.public;
    renderPublic();
  };
  const renderPublic = (): void => {
    if (tab !== 'public') return;
    clear(content);
    const q = search.value.trim().toLowerCase();
    const shown = publicWorlds.filter((w) => !q || w.name.toLowerCase().includes(q) || w.ownerName.toLowerCase().includes(q));
    const list = el('div', { class: 'list' });
    for (const w of shown) {
      const item = el(
        'div',
        { class: 'list-item public-world' },
        el('div', { class: 'icon', style: { backgroundImage: 'var(--menu-tex)', backgroundSize: 'calc(var(--s) * 16)' } }),
        el(
          'div',
          { style: { flex: '1' } },
          el('div', {}, w.name, w.cheats ? badge('Cheats ON', 'cheats') : null),
          el('div', { class: 'meta' }, `${w.ownerName} · ${modeName(w.mode)} · ${w.players}/${w.maxPlayers} playing · v${w.version ?? '?'}`),
        ),
        button('Join', () => void joinWorld(w.id), 'btn tiny join-btn', w.players >= w.maxPlayers),
      );
      item.addEventListener('dblclick', () => void joinWorld(w.id));
      list.append(item);
    }
    if (!shown.length) list.append(el('div', { class: 'muted', style: { padding: 'calc(var(--s) * 8)', textAlign: 'center' } }, publicWorlds.length ? 'No world matches your search.' : 'No public worlds are online right now.'));
    content.append(el('div', { class: 'row' }, search, button('Refresh', wrapClick(host, () => void publicTab()), 'btn quarter')), list);
  };

  body.append(
    who,
    tabs,
    content,
    s,
    el(
      'div',
      { class: 'row' },
      button('Sign Out', wrapClick(host, () => ctx.signOut()), 'btn quarter'),
      button('Server address...', wrapClick(host, () => ctx.serverAddress()), 'btn quarter'),
      button('Back', wrapClick(host, () => ctx.back()), 'btn half'),
    ),
  );
  show(start);
  // A count of friend requests on the tab
  void api.friends().then((f) => {
    incoming = f.incoming.length;
    renderTabs();
  }).catch(() => {});
  return { root, onClose: () => timer && clearInterval(timer) };
}

// ---------------------------------------------------------------------------
// In game: the hosting panel
// ---------------------------------------------------------------------------
export interface PanelPlayer {
  name: string;
  uuid: string;
  role?: WorldRole;
}

export interface HostingPanelActions {
  players(): PanelPlayer[];
  /** Runs a chat command as the host (/op, /deop, /kick, /ban). */
  command(line: string): void;
  invite(): void;
  stop(): void;
  isTouch: boolean;
}

export function hostingPanelScreen(host: ScreenHost, session: HostSession, actions: HostingPanelActions): Screen {
  const { root, body } = titled('Hosting', 'screen dim');
  const code = el('div', { class: 'join-code' });
  const info = el('div', { class: 'muted' });
  const list = el('div', { class: 'list' });
  const s = status();
  const render = (): void => {
    const d = session.details;
    code.textContent = d.joinCode ?? '—';
    const t = session.transports();
    info.textContent = `${session.options.name} · ${VIS_LABEL[session.options.visibility]} · ${session.players}/${session.options.maxPlayers} players${t.relay ? ` · ${t.relay} relayed` : ''}${session.options.cheats ? ' · Cheats ON' : ''}`;
    clear(list);
    list.append(el('div', { class: 'list-header' }, 'Players'));
    for (const p of actions.players()) {
      const role = p.role ?? 'builder';
      const row = el('div', { class: 'list-item' }, el('div', { style: { flex: '1' } }, p.name, el('div', { class: 'meta' }, ROLE_LABEL[role])));
      if (role !== 'owner') {
        if (role === 'operator') row.append(button('Remove Op', () => actions.command(`/deop ${p.name}`), 'btn tiny'));
        else row.append(button('Make Op', () => actions.command(`/op ${p.name}`), 'btn tiny'));
        row.append(button('Kick', () => actions.command(`/kick ${p.name}`), 'btn tiny'));
        row.append(button('Ban', () => host.push(confirmScreen(host, 'Ban player?', `${p.name} will be removed and cannot come back to this world.`, 'Ban', () => actions.command(`/ban ${p.name}`))), 'btn tiny danger'));
      }
      list.append(row);
    }
  };
  const copy = button('Copy', () => {
    host.uiClick();
    const c = session.details.joinCode ?? '';
    void navigator.clipboard?.writeText(c).then(() => setStatus(s, 'Join code copied'), () => setStatus(s, `Join code: ${c}`));
  }, 'btn tiny');
  const newCode = button('New Code', () => {
    host.uiClick();
    void busy([newCode], s, () => session.update({ newCode: true })).then(render);
  }, 'btn tiny');
  const settings = button('Settings...', () => {
    host.uiClick();
    host.push(hostSettingsScreen(host, 'Hosting Settings', { ...session.options }, actions.isTouch, 'Save', async (o) => {
      await session.update(o);
      host.pop();
      render();
    }));
  }, 'btn half');
  const announce = { on: true };
  void session.api.world(session.worldId).then((d) => {
    announce.on = d.announceAdmin !== false;
    announceBtn.textContent = `Announce Admin Actions: ${announce.on ? 'ON' : 'OFF'}`;
  }).catch(() => {});
  const announceBtn = button('Announce Admin Actions: ON', () => {
    host.uiClick();
    announce.on = !announce.on;
    announceBtn.textContent = `Announce Admin Actions: ${announce.on ? 'ON' : 'OFF'}`;
    void session.api.updateWorld(session.worldId, { announceAdmin: announce.on }).catch((e) => setStatus(s, (e as Error).message, true));
  }, 'btn half');
  body.append(
    el('div', { class: 'row' }, el('div', { class: 'muted' }, 'Join code:'), code, copy, newCode),
    info,
    list,
    s,
    el('div', { class: 'row' }, button('Invite Friends', wrapClick(host, actions.invite), 'btn half'), settings),
    el('div', { class: 'row' }, announceBtn, button('Stop Hosting', wrapClick(host, () => host.push(confirmScreen(host, 'Stop hosting?', 'Everyone else leaves the world. You keep playing on your own.', 'Stop Hosting', () => actions.stop()))), 'btn half danger')),
    el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } }, 'Keep this tab open to keep your world online.'),
    button('Done', wrapClick(host, () => host.pop())),
  );
  render();
  const prev = session.onChange;
  session.onChange = () => {
    prev();
    render();
  };
  const timer = setInterval(render, 2000);
  return {
    root,
    onClose: () => {
      clearInterval(timer);
      session.onChange = prev;
    },
  };
}

/** Friends to invite into the world you host. */
export function inviteScreen(host: ScreenHost, api: HubApi, worldId: string): Screen {
  const { root, body } = titled('Invite Friends', 'screen dim');
  const list = el('div', { class: 'list' });
  const s = status();
  void busy([], s, () => api.friends()).then((f) => {
    if (!f) return;
    clear(list);
    if (!f.friends.length) list.append(el('div', { class: 'muted', style: { padding: 'calc(var(--s) * 6)' } }, 'No friends yet: add them in Multiplayer > Friends.'));
    for (const fr of f.friends) {
      const b = button(fr.online ? 'Invite' : 'Offline', () => {
        host.uiClick();
        void busy([b], s, () => api.invite(fr.uuid, worldId)).then((r) => {
          if (!r) return;
          b.textContent = 'Invited';
          b.disabled = true;
          setStatus(s, r.delivered ? `${fr.name} got your invitation` : `${fr.name} is not online; they can join from their friends list`);
        });
      }, 'btn tiny', !fr.online);
      list.append(el('div', { class: 'list-item' }, el('div', { class: 'presence ' + (fr.online ? 'on' : 'off') }), el('div', { style: { flex: '1' } }, fr.name), b));
    }
  });
  body.append(list, s, button('Done', wrapClick(host, () => host.pop())));
  return { root };
}

/** An invitation, as a toast with Join / Ignore (in the menus or in game). */
export function inviteToast(parent: HTMLElement, text: string, onJoin: () => void): void {
  const t = el('div', { class: 'invite-toast' }, el('div', { class: 't1' }, text));
  const close = (): void => t.remove();
  t.append(el('div', { class: 'row' }, button('Join', () => {
    close();
    onJoin();
  }, 'btn tiny join-btn'), button('Ignore', close, 'btn tiny')));
  parent.append(t);
  setTimeout(close, 30_000);
}

/** A short notice in the corner (hosting warnings). */
export function notice(parent: HTMLElement, text: string, ms = 8000): void {
  const t = el('div', { class: 'invite-toast notice' }, el('div', { class: 't1' }, text));
  parent.append(t);
  setTimeout(() => t.remove(), ms);
}
