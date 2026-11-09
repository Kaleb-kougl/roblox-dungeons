/**
 * The rollback spike's per-tick view digest (docs/ROLLBACK_SPIKE.md Design 2, task R2): what a client would DRAW of a
 * state, compact, so a prediction can be kept and compared with a later prediction of the same tick and with the
 * truth, without keeping the state. Roblox-API-free and allocation-light (every array preallocated at the capacities
 * of ROLLBACK_SPIKE.model): the same code runs headless (harness.ts) and live in the client's worker (R4b).
 *
 *   BulletTracker  per bullet pool slot, who the bullet in it is (its identity key), followed tick by tick
 *   PreSnap        the few pre-step facts a tick's events need (actor ids alive, players dead, ground drops)
 *   ViewDigest     actors (id, kind, alive, x, z, hp), players (x, z, hearts, armor, dead), bullets near the
 *                  observing player (key, emitter, kind, x, z), the tick's events (kills, deaths, pickups, hits on
 *                  players, erased bullets); fillDigest writes one
 *   BulletMatcher  pairs two digests' bullets (identity first, then position)
 *   roomTypeOf     combat / boss / walk (or a draft) for the observing player
 *
 * ## Bullet identity (R0 census (c))
 *
 * A pool slot is not an identity (slots are reused last-freed-first, so one extra release shifts a whole burst), and no
 * bullet carries a spawn tick or a serial id. The tracker gives every bullet a KEY when it first sees it:
 *
 *   key = (tag x EMITTER_SPAN + emitterKey) x ORDINAL_SPAN + ordinal       (an exact integer < 2^52)
 *
 *   tag         the state's tick right after the step that spawned it (state.tick at the observe); for the bullets
 *               already alive when a tracker starts (`init`), that start tick
 *   emitterKey  the pool's emitter id (enemy bullets: unique per actor for the run; the stress emitter its own),
 *               player bullets EMITTER_SPAN / 2 + their owner's id (player index + 1), so the two pools never collide
 *   ordinal     rank among the bullets the same emitter spawned in that step, by (velocity direction as a diamond
 *               angle, speed, x, z): content, not slot, so two predictions that fired the same burst rank it alike
 *
 * A bullet in slot s CONTINUES from one observe to the next while the slot stays live with the same emitter and the same
 * stable payload bits (damage, kind, source: `pierce` / `lastHit` change in flight) and its life fell by more than 0
 * and at most one tick's dt (the Hourglass slows enemy bullets' dt, never speeds it). Anything else is a new bullet (a
 * slot freed and refilled between two observes; Ember's clear and builds' procs can do both in one tick). A tracker
 * must observe every tick of the state it follows: the model's confirmed tracker follows the confirmed state, and each
 * prediction starts from a copy of it (`copyFrom`) and observes every predicted step, so identical play gives identical
 * keys in every prediction and in the truth.
 *
 * ## Matching two digests of the same tick (BulletMatcher)
 *
 * 1. by key (exact): the same bullet in both;
 * 2. a bullet left over in A takes the nearest left over in B with the same emitter and kind within
 *    `bulletMatchTiles`: a burst fired a tick early or late (another tag) or aimed slightly differently (another rank)
 *    is still the same bullet on screen.
 * What is left after both stages is a bullet one digest shows and the other does not: a phantom (Design 3). A digest
 * keeps bullets within `viewRadiusTiles + viewMarginTiles` of its observer and flags those within `viewRadiusTiles`
 * (`bulletInner`); only an INNER bullet with no match counts, so a bullet on the screen's edge is never a phantom.
 *
 * ## Events (one tick's: the step into `tick`)
 *
 * kill (actor id, alive before and gone or dead after), death (player index), pickup (a ground boost by its spawn tick
 * and kind; a pellet by floor and index, negative), hit (player index; score runs' `hurtPlayer`, else the solo
 * `playerHits`), erase (bullet key): an enemy bullet removed with life left that neither a wall nor an intact piece
 * nor a player's hit circle (`hitRadiusTiles`) explains: a sword guard / swing, an Ember, a power pellet, Phantom Step
 * (a heuristic, applied the same way to every digest, so truth and predictions are judged alike; strikes never erase).
 */
import {
	BulletKind,
	GIVEN_DROP_SLOT,
	NO_KIND,
	SIM_DT,
	archetypeAt,
	breakableSlotAt,
	isDraftOpen,
	partySize,
	playerAt,
	type BulletSimulation,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { ROLLBACK_SPIKE } from "./config";

const MODEL = ROLLBACK_SPIKE.model;

/** Key layout (see the file comment): 2^21 emitter ids per pool, 2^11 bullets per emitter and step. */
export const BULLET_EMITTER_SPAN = 4194304;
export const BULLET_ORDINAL_SPAN = 2048;
const PLAYER_EMITTER_BASE = BULLET_EMITTER_SPAN / 2;
/** Payload bits that never change in flight: damage (6), kind (4), source (8). */
const STABLE_PAYLOAD_MASK = 0x3ffff;
const KIND_SHIFT = 6;
const KIND_MASK = 15;
/** A continuing bullet's life fell by at most one tick (with float slack). */
const LIFE_STEP_MAX = SIM_DT * (1 + 1e-6);

/** Event kinds (bit flags: a digest indexes an entity's kinds as one mask). */
export const DigestEvent = {
	KILL: 1,
	DEATH: 2,
	PICKUP: 4,
	ERASE: 8,
	HIT: 16,
} as const;
export type DigestEventKind = (typeof DigestEvent)[keyof typeof DigestEvent];
/** The event kinds in report order. */
export const DIGEST_EVENT_KINDS: ReadonlyArray<DigestEventKind> = [
	DigestEvent.KILL,
	DigestEvent.DEATH,
	DigestEvent.PICKUP,
	DigestEvent.ERASE,
	DigestEvent.HIT,
];

/** A ground boost pickup's entity: spawn tick x this + kind. */
const PICKUP_KIND_SPAN = 64;
/** A pellet pickup's entity: -(floor x this + index + 1). */
const PELLET_FLOOR_SPAN = 65536;

/** Room types, in ROLLBACK_ROOM_TYPES order (shared/spikes); a draft tick is none of them. */
export const RoomKind = {
	COMBAT: 0,
	BOSS: 1,
	WALK: 2,
	DRAFT: -1,
} as const;

/** Packs a bullet key (exact for tag < 2^19). */
export function bulletKey(tag: number, emitterKey: number, ordinal: number): number {
	return (tag * BULLET_EMITTER_SPAN + emitterKey) * BULLET_ORDINAL_SPAN + ordinal;
}

/** The tag (spawn tick) of a bullet key. */
export function bulletKeyTag(key: number): number {
	return math.floor(key / (BULLET_EMITTER_SPAN * BULLET_ORDINAL_SPAN));
}

/** Direction of (x, z) as a diamond angle in [0, 4) (monotonic in the true angle, no trig); -1 for (0, 0). */
function diamondAngle(x: number, z: number): number {
	if (x === 0 && z === 0) return -1;
	if (z >= 0) return x >= 0 ? z / (x + z) : 1 - x / (-x + z);
	return x < 0 ? 2 - z / (-x - z) : 3 + x / (x - z);
}

// ---------------------------------------------------------------------------------------------
// Bullet tracker

/** One pool's per-slot identity table. */
class PoolTrack {
	readonly live: boolean[];
	readonly emitter: number[];
	readonly stable: number[];
	readonly life: number[];
	readonly x: number[];
	readonly z: number[];
	readonly vx: number[];
	readonly vz: number[];
	readonly key: number[];
	/** Live slots (after the last observe), `count` of them. */
	list: number[];
	count = 0;
	private spare: number[];
	private readonly stamp: number[];
	private epoch = 0;
	/** This observe's new slots (scratch). */
	private readonly fresh: number[];
	private freshCount = 0;

	constructor(readonly capacity: number, private readonly emitterBase: number) {
		this.live = table.create(capacity, false);
		this.emitter = table.create(capacity, 0);
		this.stable = table.create(capacity, 0);
		this.life = table.create(capacity, 0);
		this.x = table.create(capacity, 0);
		this.z = table.create(capacity, 0);
		this.vx = table.create(capacity, 0);
		this.vz = table.create(capacity, 0);
		this.key = table.create(capacity, 0);
		this.list = table.create(capacity, 0);
		this.spare = table.create(capacity, 0);
		this.stamp = table.create(capacity, 0);
		this.fresh = table.create(capacity, 0);
	}

	clear(): void {
		for (let k = 0; k < this.count; k++) this.live[this.list[k]] = false;
		this.count = 0;
	}

	copyFrom(o: PoolTrack): void {
		this.clear();
		const n = o.count;
		for (let k = 0; k < n; k++) {
			const s = o.list[k];
			this.list[k] = s;
			this.live[s] = true;
			this.emitter[s] = o.emitter[s];
			this.stable[s] = o.stable[s];
			this.life[s] = o.life[s];
			this.x[s] = o.x[s];
			this.z[s] = o.z[s];
			this.vx[s] = o.vx[s];
			this.vz[s] = o.vz[s];
			this.key[s] = o.key[s];
		}
		this.count = n;
	}

	/**
	 * Reads the pool after a step. `removed(slot)` is called for every bullet that left (before its data is
	 * overwritten); `init`: every live bullet is new (a tracker's start), nothing is removed.
	 */
	observe(sim: BulletSimulation, tag: number, init: boolean, removed: ((slot: number) => void) | undefined): void {
		this.epoch += 1;
		const epoch = this.epoch;
		if (init) this.clear();
		const fill = this.spare;
		let n = 0;
		this.freshCount = 0;
		const hw = math.min(sim.highWater(), this.capacity);
		for (let i = 0; i < hw; i++) {
			if (!sim.isLive(i)) continue;
			this.stamp[i] = epoch;
			fill[n] = i;
			n++;
			const e = sim.emitterIdAt(i);
			const st = bit32.band(sim.payloadAt(i), STABLE_PAYLOAD_MASK);
			const l = sim.lifeAt(i);
			const p = sim.positionAt(i);
			const v = sim.velocityAt(i);
			if (this.live[i] && this.emitter[i] === e && this.stable[i] === st) {
				const fell = this.life[i] - l;
				if (fell > 0 && fell <= LIFE_STEP_MAX) {
					this.life[i] = l;
					this.x[i] = p.x;
					this.z[i] = p.z;
					this.vx[i] = v.x;
					this.vz[i] = v.z;
					continue;
				}
			}
			if (this.live[i] && removed !== undefined) removed(i);
			this.live[i] = true;
			this.emitter[i] = e;
			this.stable[i] = st;
			this.life[i] = l;
			this.x[i] = p.x;
			this.z[i] = p.z;
			this.vx[i] = v.x;
			this.vz[i] = v.z;
			this.fresh[this.freshCount] = i;
			this.freshCount++;
		}
		// Slots live before and not now: removed.
		for (let k = 0; k < this.count; k++) {
			const s = this.list[k];
			if (this.stamp[s] === epoch || !this.live[s]) continue;
			if (removed !== undefined) removed(s);
			this.live[s] = false;
		}
		this.spare = this.list;
		this.list = fill;
		this.count = n;
		this.assignKeys(tag);
	}

	/** Keys for this observe's new bullets: rank among the same emitter's (see the file comment). */
	private assignKeys(tag: number): void {
		const fresh = this.fresh;
		const m = this.freshCount;
		for (let a = 0; a < m; a++) {
			const sa = fresh[a];
			const e = this.emitter[sa];
			const angA = diamondAngle(this.vx[sa], this.vz[sa]);
			const spA = this.vx[sa] * this.vx[sa] + this.vz[sa] * this.vz[sa];
			let rank = 0;
			for (let b = 0; b < m; b++) {
				if (b === a) continue;
				const sb = fresh[b];
				if (this.emitter[sb] !== e) continue;
				const angB = diamondAngle(this.vx[sb], this.vz[sb]);
				let less = angB < angA;
				if (angB === angA) {
					const spB = this.vx[sb] * this.vx[sb] + this.vz[sb] * this.vz[sb];
					less = spB < spA;
					if (spB === spA) {
						less = this.x[sb] < this.x[sa];
						if (this.x[sb] === this.x[sa]) {
							less = this.z[sb] < this.z[sa];
							// Exact duplicates: any order is the same bullet twice; the slot breaks the tie.
							if (this.z[sb] === this.z[sa]) less = b < a;
						}
					}
				}
				if (less) rank++;
			}
			const ordinal = math.min(rank, BULLET_ORDINAL_SPAN - 1);
			const emitterKey = math.min(this.emitterBase + e, BULLET_EMITTER_SPAN - 1);
			this.key[sa] = bulletKey(tag, emitterKey, ordinal);
		}
	}

	kindAt(slot: number): number {
		return bit32.band(bit32.rshift(this.stable[slot], KIND_SHIFT), KIND_MASK);
	}

	emitterKeyAt(slot: number): number {
		return this.emitterBase + this.emitter[slot];
	}
}

/**
 * Follows both bullet pools of one state (see "Bullet identity"). `observe(state, world)` after every step;
 * `init(state)` to start on a state; `copyFrom(other)` to fork (a prediction starting on the confirmed state).
 */
export class BulletTracker {
	readonly enemy: PoolTrack;
	readonly player: PoolTrack;
	/** Keys of the enemy bullets erased by the last observe (see "Events"), `erasedCount` of them. */
	readonly erased: number[];
	erasedCount = 0;
	private state: SimState | undefined;
	private world: Readonly<SimConfig> | undefined;
	private readonly onEnemyRemoved = (slot: number) => this.enemyRemoved(slot);

	constructor(enemyCapacity: number, playerCapacity: number) {
		this.enemy = new PoolTrack(enemyCapacity, 0);
		this.player = new PoolTrack(playerCapacity, PLAYER_EMITTER_BASE);
		this.erased = table.create(MODEL.digestEvents, 0);
	}

	/** A tracker sized for `state`'s pools. */
	static forState(state: Readonly<SimState>): BulletTracker {
		return new BulletTracker(state.combat.enemyBullets.capacity, state.combat.playerBullets.capacity);
	}

	init(state: SimState): void {
		this.erasedCount = 0;
		this.enemy.observe(state.combat.enemyBullets, state.tick, true, undefined);
		this.player.observe(state.combat.playerBullets, state.tick, true, undefined);
	}

	copyFrom(o: BulletTracker): void {
		this.enemy.copyFrom(o.enemy);
		this.player.copyFrom(o.player);
		this.erasedCount = 0;
	}

	/** After a step of `state`; `world` is the floor's SimConfig the step used (its bullet blocker). */
	observe(state: SimState, world: Readonly<SimConfig>): void {
		this.erasedCount = 0;
		this.state = state;
		this.world = world;
		this.enemy.observe(state.combat.enemyBullets, state.tick, false, this.onEnemyRemoved);
		this.player.observe(state.combat.playerBullets, state.tick, false, undefined);
		this.state = undefined;
		this.world = undefined;
	}

	/** An enemy bullet left: an erase unless its life ran out, a wall / piece or a player's body explains it. */
	private enemyRemoved(slot: number): void {
		const t = this.enemy;
		if (t.life[slot] <= LIFE_STEP_MAX) return;
		if (t.kindAt(slot) === BulletKind.STRIKE) return;
		const state = this.state!;
		const nx = t.x[slot] + t.vx[slot] * SIM_DT;
		const nz = t.z[slot] + t.vz[slot] * SIM_DT;
		const blocked = this.world?.isBulletBlocked;
		if (blocked !== undefined && (blocked(nx, nz) || blocked(t.x[slot], t.z[slot]))) return;
		const b = state.breakables;
		if (b !== undefined && b.intact > 0 && breakableSlotAt(b, nx, nz) >= 0) return;
		const r2 = MODEL.hitRadiusTiles * MODEL.hitRadiusTiles;
		const n = partySize(state);
		for (let k = 0; k < n; k++) {
			const p = playerAt(state, k);
			if (p.dead !== 0) continue;
			const dx = nx - p.x;
			const dz = nz - p.z;
			if (dx * dx + dz * dz < r2) return;
		}
		if (this.erasedCount < this.erased.size()) {
			this.erased[this.erasedCount] = t.key[slot];
			this.erasedCount++;
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Pre-step snapshot

/** What a tick's events need from the state before the step (see fillDigest). */
export class PreSnap {
	actorCount = 0;
	readonly id: number[];
	readonly alive: boolean[];
	playerCount = 0;
	readonly dead: boolean[];
	groundCount = 0;
	readonly groundSpawn: number[];
	readonly groundKind: number[];

	constructor() {
		this.id = table.create(ROLLBACK_SPIKE.digestActors, 0);
		this.alive = table.create(ROLLBACK_SPIKE.digestActors, false);
		this.dead = table.create(ROLLBACK_SPIKE.digestPlayers, false);
		this.groundSpawn = [];
		this.groundKind = [];
	}

	take(state: Readonly<SimState>): void {
		const actors = state.combat.actors;
		const na = math.min(actors.size(), this.id.size());
		for (let k = 0; k < na; k++) {
			const a = actors[k];
			this.id[k] = a.kind === NO_KIND ? 0 : a.id;
			this.alive[k] = a.kind !== NO_KIND && a.alive !== 0;
		}
		this.actorCount = na;
		const np = math.min(partySize(state), this.dead.size());
		for (let k = 0; k < np; k++) this.dead[k] = playerAt(state, k).dead !== 0;
		this.playerCount = np;
		const ground = state.drops?.ground;
		const ng = ground !== undefined ? ground.size() : 0;
		for (let k = 0; k < ng; k++) {
			this.groundSpawn[k] = ground![k].spawnTick;
			this.groundKind[k] = ground![k].kind;
		}
		this.groundCount = ng;
	}
}

// ---------------------------------------------------------------------------------------------
// View digest

/** One drawn (or true) tick, compact. Fields are read by metrics.ts; write only through fillDigest / copyFrom. */
export class ViewDigest {
	valid = false;
	tick = -1;
	/** The confirmed tick of the frame that drew it (a prediction), or the tick itself (the truth). */
	frameTick = -1;
	floor = 0;
	draft = false;
	observerX = 0;
	observerZ = 0;

	actorCount = 0;
	readonly actorId: number[];
	readonly actorKind: number[];
	readonly actorAlive: boolean[];
	readonly actorX: number[];
	readonly actorZ: number[];
	readonly actorHp: number[];

	playerCount = 0;
	readonly playerX: number[];
	readonly playerZ: number[];
	readonly hearts: number[];
	readonly armor: number[];
	readonly dead: boolean[];

	bulletCount = 0;
	/** Bullets past the capacity this tick (dropped). */
	bulletOverflow = 0;
	readonly bulletKey: number[];
	readonly bulletEmitter: number[];
	readonly bulletKind: number[];
	readonly bulletX: number[];
	readonly bulletZ: number[];
	/** Within viewRadiusTiles of the observer (counts as seen); the rest is the margin. */
	readonly bulletInner: boolean[];
	/** key -> bullet index. */
	readonly keyIndex = new Map<number, number>();

	eventCount = 0;
	eventOverflow = 0;
	readonly eventKind: number[];
	readonly eventEntity: number[];
	/** entity -> OR of its DigestEvent kinds. */
	readonly eventIndex = new Map<number, number>();

	constructor() {
		const na = ROLLBACK_SPIKE.digestActors;
		this.actorId = table.create(na, 0);
		this.actorKind = table.create(na, 0);
		this.actorAlive = table.create(na, false);
		this.actorX = table.create(na, 0);
		this.actorZ = table.create(na, 0);
		this.actorHp = table.create(na, 0);
		const np = ROLLBACK_SPIKE.digestPlayers;
		this.playerX = table.create(np, 0);
		this.playerZ = table.create(np, 0);
		this.hearts = table.create(np, 0);
		this.armor = table.create(np, 0);
		this.dead = table.create(np, false);
		const nb = MODEL.digestBullets;
		this.bulletKey = table.create(nb, 0);
		this.bulletEmitter = table.create(nb, 0);
		this.bulletKind = table.create(nb, 0);
		this.bulletX = table.create(nb, 0);
		this.bulletZ = table.create(nb, 0);
		this.bulletInner = table.create(nb, false);
		const ne = MODEL.digestEvents;
		this.eventKind = table.create(ne, 0);
		this.eventEntity = table.create(ne, 0);
	}

	invalidate(): void {
		this.valid = false;
	}

	/** True when the tick shows event `kind` for `entity`. */
	hasEvent(kind: number, entity: number): boolean {
		return bit32.band(this.eventIndex.get(entity) ?? 0, kind) !== 0;
	}

	/** The index of actor `id`, or -1 (`hint`: the slot to try first). */
	actorIndexOf(id: number, hint: number): number {
		if (hint >= 0 && hint < this.actorCount && this.actorId[hint] === id) return hint;
		for (let k = 0; k < this.actorCount; k++) if (this.actorId[k] === id) return k;
		return -1;
	}

	addEvent(kind: number, entity: number): void {
		const had = this.eventIndex.get(entity) ?? 0;
		if (bit32.band(had, kind) !== 0) return;
		if (this.eventCount >= this.eventKind.size()) {
			this.eventOverflow++;
			return;
		}
		this.eventKind[this.eventCount] = kind;
		this.eventEntity[this.eventCount] = entity;
		this.eventCount++;
		this.eventIndex.set(entity, bit32.bor(had, kind));
	}
}

/** Appends `pool`'s live bullets near the observer to `out`. */
function digestPool(out: ViewDigest, t: PoolTrack, inner2: number, outer2: number): void {
	const cap = out.bulletKey.size();
	const ox = out.observerX;
	const oz = out.observerZ;
	for (let k = 0; k < t.count; k++) {
		const s = t.list[k];
		const dx = t.x[s] - ox;
		const dz = t.z[s] - oz;
		const d2 = dx * dx + dz * dz;
		if (d2 > outer2) continue;
		if (out.bulletCount >= cap) {
			out.bulletOverflow++;
			continue;
		}
		const b = out.bulletCount;
		const key = t.key[s];
		out.bulletKey[b] = key;
		out.bulletEmitter[b] = t.emitterKeyAt(s);
		out.bulletKind[b] = t.kindAt(s);
		out.bulletX[b] = t.x[s];
		out.bulletZ[b] = t.z[s];
		out.bulletInner[b] = d2 <= inner2;
		out.keyIndex.set(key, b);
		out.bulletCount++;
	}
}

/**
 * Writes `state`'s view digest (its tick: `state.tick`) into `out`, seen by player `observer`. `pre`: the snapshot
 * taken before the step into this tick (its events); undefined: no events (a start). `tracker` observed this state.
 */
export function fillDigest(
	out: ViewDigest,
	state: Readonly<SimState>,
	pre: PreSnap | undefined,
	tracker: BulletTracker,
	observer: number,
	frameTick: number,
): void {
	out.valid = true;
	out.tick = state.tick;
	out.frameTick = frameTick;
	out.floor = state.endless !== undefined ? state.endless.floor : 0;
	out.draft = state.run !== undefined && isDraftOpen(state);
	const me = playerAt(state, observer);
	out.observerX = me.x;
	out.observerZ = me.z;

	const actors = state.combat.actors;
	const cap = out.actorId.size();
	let na = 0;
	for (let k = 0; k < actors.size() && na < cap; k++) {
		const a = actors[k];
		if (a.kind === NO_KIND) continue;
		out.actorId[na] = a.id;
		out.actorKind[na] = a.kind;
		out.actorAlive[na] = a.alive !== 0;
		out.actorX[na] = a.x;
		out.actorZ[na] = a.z;
		out.actorHp[na] = a.hp;
		na++;
	}
	out.actorCount = na;

	const np = math.min(partySize(state), out.playerX.size());
	for (let k = 0; k < np; k++) {
		const p = playerAt(state, k);
		out.playerX[k] = p.x;
		out.playerZ[k] = p.z;
		out.hearts[k] = p.hearts;
		out.armor[k] = p.armor;
		out.dead[k] = p.dead !== 0;
	}
	out.playerCount = np;

	out.bulletCount = 0;
	out.bulletOverflow = 0;
	out.keyIndex.clear();
	const inner = MODEL.viewRadiusTiles;
	const outer = inner + MODEL.viewMarginTiles;
	digestPool(out, tracker.enemy, inner * inner, outer * outer);
	digestPool(out, tracker.player, inner * inner, outer * outer);

	out.eventCount = 0;
	out.eventOverflow = 0;
	out.eventIndex.clear();
	if (pre === undefined) return;
	// Kills: alive before, gone or dead now (by slot: the snapshot is by slot).
	for (let k = 0; k < pre.actorCount; k++) {
		if (!pre.alive[k]) continue;
		const a = actors[k];
		if (a === undefined || a.kind === NO_KIND || a.id !== pre.id[k] || a.alive === 0) {
			out.addEvent(DigestEvent.KILL, pre.id[k]);
		}
	}
	for (let k = 0; k < math.min(np, pre.playerCount); k++) {
		if (!pre.dead[k] && out.dead[k]) out.addEvent(DigestEvent.DEATH, k);
	}
	const score = state.score;
	if (score !== undefined) {
		const hurt = score.events.hurtPlayer;
		for (let k = 0; k < hurt.size(); k++) out.addEvent(DigestEvent.HIT, hurt[k]);
	} else if (state.events.playerHits > 0) {
		out.addEvent(DigestEvent.HIT, 0);
	}
	const drops = state.drops;
	if (drops !== undefined) {
		const got = drops.events.collected;
		for (let k = 0; k < got.size(); k++) {
			const slot = got[k].slot;
			if (slot === GIVEN_DROP_SLOT || slot < 0 || slot >= pre.groundCount) continue;
			out.addEvent(DigestEvent.PICKUP, pre.groundSpawn[slot] * PICKUP_KIND_SPAN + pre.groundKind[slot]);
		}
	}
	const pellets = state.pellets;
	if (pellets !== undefined) {
		const eaten = pellets.events.eaten;
		for (let k = 0; k < eaten.size(); k++) {
			out.addEvent(DigestEvent.PICKUP, -(out.floor * PELLET_FLOOR_SPAN + eaten[k].index + 1));
		}
	}
	for (let k = 0; k < tracker.erasedCount; k++) out.addEvent(DigestEvent.ERASE, tracker.erased[k]);
}

// ---------------------------------------------------------------------------------------------
// Matching

/** Pairs two digests' bullets (see "Matching two digests"). Scratch reused across calls. */
export class BulletMatcher {
	/** Per bullet of A: its partner's index in B, or -1. */
	readonly ofA: number[];
	/** Per bullet of B: matched. */
	readonly takenB: boolean[];

	constructor() {
		this.ofA = table.create(MODEL.digestBullets, -1);
		this.takenB = table.create(MODEL.digestBullets, false);
	}

	match(a: ViewDigest, b: ViewDigest): void {
		const na = a.bulletCount;
		const nb = b.bulletCount;
		for (let j = 0; j < nb; j++) this.takenB[j] = false;
		let left = 0;
		for (let i = 0; i < na; i++) {
			const j = b.keyIndex.get(a.bulletKey[i]);
			if (j !== undefined && !this.takenB[j]) {
				this.ofA[i] = j;
				this.takenB[j] = true;
			} else {
				this.ofA[i] = -1;
				left++;
			}
		}
		if (left === 0) return;
		const tol2 = MODEL.bulletMatchTiles * MODEL.bulletMatchTiles;
		for (let i = 0; i < na; i++) {
			if (this.ofA[i] >= 0) continue;
			const e = a.bulletEmitter[i];
			const kind = a.bulletKind[i];
			const x = a.bulletX[i];
			const z = a.bulletZ[i];
			let best = -1;
			let bestD2 = tol2;
			for (let j = 0; j < nb; j++) {
				if (this.takenB[j] || b.bulletEmitter[j] !== e || b.bulletKind[j] !== kind) continue;
				const dx = b.bulletX[j] - x;
				const dz = b.bulletZ[j] - z;
				const d2 = dx * dx + dz * dz;
				if (d2 <= bestD2) {
					best = j;
					bestD2 = d2;
				}
			}
			if (best >= 0) {
				this.ofA[i] = best;
				this.takenB[best] = true;
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Room type

/**
 * The observing player's room type on this tick (Design 3), a RoomKind: DRAFT while a boon draft freezes the world;
 * BOSS while a boss fights (a live boss in phase > 0); COMBAT while the player stands in an engaged, uncleared score
 * room; else WALK.
 */
export function roomTypeOf(state: Readonly<SimState>, observer: number): number {
	if (state.run !== undefined && isDraftOpen(state)) return RoomKind.DRAFT;
	const actors = state.combat.actors;
	for (let k = 0; k < actors.size(); k++) {
		const a = actors[k];
		if (a.kind === NO_KIND || a.alive === 0 || a.phase <= 0) continue;
		if (archetypeAt(a.kind).data.boss === true) return RoomKind.BOSS;
	}
	const score = state.score;
	if (score !== undefined) {
		const p = playerAt(state, observer);
		for (const r of score.rooms) {
			if (r.engageTick < 0 || r.cleared !== 0) continue;
			if (p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ) return RoomKind.COMBAT;
		}
	}
	return RoomKind.WALK;
}
