/** Friend relationships and pending requests between accounts. */
import * as path from 'node:path';
import { JsonStore } from './JsonStore';

const MAX_FRIENDS = 200;
const MAX_PENDING = 50;

interface FriendData {
  friends: Record<string, string[]>;
  requests: { from: string; to: string; at: number }[];
}

export class FriendError extends Error {}

export class Friends {
  private constructor(private readonly store: JsonStore<FriendData>) {}

  static async open(dir: string, log: (m: string) => void): Promise<Friends> {
    const store = await JsonStore.open<FriendData>(
      path.join(dir, 'friends.json'),
      () => ({ friends: {}, requests: [] }),
      (raw) => {
        const r = raw as Partial<FriendData>;
        if (!r || typeof r !== 'object' || !r.friends || !Array.isArray(r.requests)) return null;
        return { friends: r.friends, requests: r.requests };
      },
      log,
    );
    return new Friends(store);
  }

  list(uuid: string): string[] {
    return this.store.data.friends[uuid] ?? [];
  }

  areFriends(a: string, b: string): boolean {
    return this.list(a).includes(b);
  }

  incoming(uuid: string): string[] {
    return this.store.data.requests.filter((r) => r.to === uuid).map((r) => r.from);
  }

  outgoing(uuid: string): string[] {
    return this.store.data.requests.filter((r) => r.from === uuid).map((r) => r.to);
  }

  /** Sends a request, or accepts immediately when the other side already asked. */
  request(from: string, to: string): 'sent' | 'accepted' {
    if (from === to) throw new FriendError('You cannot befriend yourself');
    if (this.areFriends(from, to)) throw new FriendError('Already friends');
    const reqs = this.store.data.requests;
    if (reqs.some((r) => r.from === to && r.to === from)) {
      this.accept(from, to);
      return 'accepted';
    }
    if (reqs.some((r) => r.from === from && r.to === to)) throw new FriendError('Request already sent');
    if (this.outgoing(from).length >= MAX_PENDING || this.incoming(to).length >= MAX_PENDING) throw new FriendError('Too many pending requests');
    if (this.list(from).length >= MAX_FRIENDS) throw new FriendError('Friend list is full');
    reqs.push({ from, to, at: Date.now() });
    this.store.changed();
    return 'sent';
  }

  /** `me` accepts the request from `other`. */
  accept(me: string, other: string): void {
    const reqs = this.store.data.requests;
    const i = reqs.findIndex((r) => r.from === other && r.to === me);
    if (i < 0) throw new FriendError('No such request');
    if (this.list(me).length >= MAX_FRIENDS || this.list(other).length >= MAX_FRIENDS) throw new FriendError('Friend list is full');
    reqs.splice(i, 1);
    const f = this.store.data.friends;
    (f[me] ??= []).push(other);
    (f[other] ??= []).push(me);
    this.store.changed();
  }

  decline(me: string, other: string): void {
    this.store.data.requests = this.store.data.requests.filter((r) => !(r.from === other && r.to === me) && !(r.from === me && r.to === other));
    this.store.changed();
  }

  remove(me: string, other: string): void {
    const f = this.store.data.friends;
    f[me] = (f[me] ?? []).filter((u) => u !== other);
    f[other] = (f[other] ?? []).filter((u) => u !== me);
    this.store.changed();
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
