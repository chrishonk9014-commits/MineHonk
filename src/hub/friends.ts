/** Friend relationships, pending requests and blocks between accounts. */
import type { FriendStore } from './store';

const MAX_FRIENDS = 200;
const MAX_PENDING = 50;
const MAX_BLOCKED = 500;

export class FriendError extends Error {}

export class FriendsCore {
  constructor(readonly store: FriendStore) {}

  list(uuid: string): Promise<string[]> {
    return this.store.friendsOf(uuid);
  }

  areFriends(a: string, b: string): Promise<boolean> {
    return this.store.areFriends(a, b);
  }

  incoming(uuid: string): Promise<string[]> {
    return this.store.incoming(uuid);
  }

  outgoing(uuid: string): Promise<string[]> {
    return this.store.outgoing(uuid);
  }

  blocked(uuid: string): Promise<string[]> {
    return this.store.blocked(uuid);
  }

  /** Either side has blocked the other. */
  async blockedEither(a: string, b: string): Promise<boolean> {
    return (await this.store.isBlocked(a, b)) || (await this.store.isBlocked(b, a));
  }

  /** Sends a request, or accepts immediately when the other side already asked. */
  async request(from: string, to: string): Promise<'sent' | 'accepted'> {
    if (from === to) throw new FriendError('You cannot befriend yourself');
    if (await this.store.isBlocked(from, to)) throw new FriendError('Unblock that player first');
    // Someone who blocked you never hears from you (and you cannot tell)
    if (await this.store.isBlocked(to, from)) return 'sent';
    if (await this.store.areFriends(from, to)) throw new FriendError('Already friends');
    if (await this.store.hasRequest(to, from)) {
      await this.accept(from, to);
      return 'accepted';
    }
    if (await this.store.hasRequest(from, to)) throw new FriendError('Request already sent');
    if ((await this.store.outgoing(from)).length >= MAX_PENDING || (await this.store.incoming(to)).length >= MAX_PENDING) throw new FriendError('Too many pending requests');
    if ((await this.store.friendsOf(from)).length >= MAX_FRIENDS) throw new FriendError('Friend list is full');
    await this.store.addRequest(from, to, Date.now());
    return 'sent';
  }

  /** `me` accepts the request from `other`. */
  async accept(me: string, other: string): Promise<void> {
    if (!(await this.store.hasRequest(other, me))) throw new FriendError('No such request');
    if ((await this.store.friendsOf(me)).length >= MAX_FRIENDS || (await this.store.friendsOf(other)).length >= MAX_FRIENDS) throw new FriendError('Friend list is full');
    await this.store.deleteRequest(other, me);
    await this.store.addFriends(me, other);
  }

  /** Declines a request from `other`, or cancels one `me` sent. */
  async decline(me: string, other: string): Promise<void> {
    await this.store.deleteRequest(other, me);
    await this.store.deleteRequest(me, other);
  }

  async remove(me: string, other: string): Promise<void> {
    await this.store.removeFriends(me, other);
  }

  /** Blocks a player: no friendship, no requests, no invites, no joining your worlds. */
  async block(me: string, other: string): Promise<void> {
    if (me === other) throw new FriendError('You cannot block yourself');
    if ((await this.store.blocked(me)).length >= MAX_BLOCKED) throw new FriendError('Block list is full');
    await this.store.removeFriends(me, other);
    await this.decline(me, other);
    await this.store.setBlocked(me, other, true);
  }

  async unblock(me: string, other: string): Promise<void> {
    await this.store.setBlocked(me, other, false);
  }
}
