/**
 * Stand-in swaps (docs/STAGE_ASSETS.md "Revision 2", SA17): the renderers' side of art readiness. A renderer that asks
 * the pack for art (`pack.sprites(id)`, `pack.bullet(id)`, `pack.floorSprite`, `pack.hazardSprite`, `pack.fx(...)`)
 * draws it only while the id is also READY on this device (ArtReadiness.isReady); otherwise it takes the placeholder
 * branch it already has for a pack without art (the stand-in), and swaps when the id flips, in either direction
 * (debug `KV_StandInsForce` flips ids back to stand-ins).
 *
 *   drawsArt      hasArt && ready: the one rule.
 *   FlipTracker   per frame: has the readiness moved since the last poll, and which logical ids flipped (a set, so a
 *                 renderer touches only views of those ids). The first poll of a feed syncs to its epoch and reports
 *                 nothing (views built before it read isReady themselves); a different feed object reports every id
 *                 as flipped (`all`).
 *   ReadyIds      a fixed list of logical ids (by index, undefined = no art: never ready) and their readiness, re-read
 *                 only when the feed's epoch moved: the bullet looks, the hazards, the aura kinds, read per frame as an
 *                 array index.
 *
 * Pure: no Roblox APIs; the feed is ArtReadiness (or a fake in specs).
 *
 * @module
 */

/** What the stand-in helpers read from the readiness (ArtReadiness satisfies it). */
export interface ReadinessFeed {
	epoch(): number;
	isReady(logicalId: string): boolean;
	flippedSince(epoch: number): ReadonlyArray<string>;
}

/** The one rule: art is drawn only when the pack has it AND its content is ready; else the placeholder (stand-in). */
export function drawsArt(hasArt: boolean, ready: boolean): boolean {
	return hasArt && ready;
}

/** See the module comment. One per renderer (each keeps its own last-seen epoch). */
export class FlipTracker {
	private feed: ReadinessFeed | undefined;
	private seen = 0;
	private readonly flipped = new Set<string>();
	private all = false;
	private moved = false;

	/**
	 * Once per frame: true when the feed's epoch moved since the last poll (then `has` answers for this frame's flips),
	 * false otherwise (`has` is false for every id until the next poll that moves).
	 */
	poll(feed: ReadinessFeed): boolean {
		this.flipped.clear();
		this.all = false;
		this.moved = false;
		const epoch = feed.epoch();
		if (feed !== this.feed) {
			const first = this.feed === undefined;
			this.feed = feed;
			this.seen = epoch;
			if (first) return false;
			this.all = true;
			this.moved = true;
			return true;
		}
		if (epoch === this.seen) return false;
		for (const id of feed.flippedSince(this.seen)) this.flipped.add(id);
		this.seen = epoch;
		this.moved = true;
		return true;
	}

	/** This frame's poll moved the epoch. */
	changed(): boolean {
		return this.moved;
	}

	/** `logicalId` flipped (either way) between the last two polls; re-read isReady for the direction. */
	has(logicalId: string): boolean {
		return this.all || this.flipped.has(logicalId);
	}

	/** The ids that flipped at this frame's poll (empty with `all`: every id counts as flipped). */
	count(): number {
		return this.flipped.size();
	}
}

/** See the module comment. */
export class ReadyIds {
	private readonly ready = new Array<boolean>();
	private feed: ReadinessFeed | undefined;
	private seen = -1;

	/** `ids[i]`: index i's logical id, or undefined when it has no art (never ready, never asked). */
	constructor(private readonly ids: ReadonlyArray<string | undefined>) {
		for (let i = 0; i < ids.size(); i++) this.ready.push(false);
	}

	/** Re-reads every id when the epoch (or the feed) changed; true when any index's readiness changed. */
	refresh(feed: ReadinessFeed): boolean {
		const epoch = feed.epoch();
		if (feed === this.feed && epoch === this.seen) return false;
		this.feed = feed;
		this.seen = epoch;
		let changed = false;
		for (let i = 0; i < this.ids.size(); i++) {
			const id = this.ids[i];
			const r = id !== undefined && feed.isReady(id);
			if (r !== this.ready[i]) {
				this.ready[i] = r;
				changed = true;
			}
		}
		return changed;
	}

	/** Index i's art is ready (as of the last refresh; false before the first one and for an index out of range). */
	isReady(i: number): boolean {
		return this.ready[i] === true;
	}

	size(): number {
		return this.ids.size();
	}
}
