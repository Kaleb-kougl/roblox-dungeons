import { PAYLOAD_FIELDS, type BulletSimulation, type PayloadField } from "shared/sim";
import { BULLET_IMPACT_VIEW } from "./config";

/** What BulletImpacts reads of a bullet simulation (a BulletSimulation, or a scripted stand-in in specs). */
export type BulletImpactSource = Pick<
	BulletSimulation,
	"stepCount" | "highWater" | "isLive" | "positionAt" | "velocityAt" | "lifeAt" | "payloadAt" | "emitterIdAt"
>;

/** All 31 payload bits a stored payload may use (BulletPayload.with masks to them). */
const PAYLOAD_ALL_BITS = 0x7fffffff;

/** The payload bits that stay put while a bullet flies: every bit but `flightFields`' (PAYLOAD_FIELDS layout). */
function identityMask(flightFields: ReadonlyArray<PayloadField>): number {
	let mask = PAYLOAD_ALL_BITS;
	let shift = 0;
	for (const [name, bits] of PAYLOAD_FIELDS) {
		if (flightFields.includes(name)) {
			const field = bit32.lshift(bit32.lshift(1, bits) - 1, shift);
			mask = bit32.band(mask, bit32.bnot(field));
		}
		shift += bits;
	}
	return mask;
}

const IDENTITY_MASK = identityMask(BULLET_IMPACT_VIEW.flightFields);

/**
 * A bullet's payload without the fields the sim rewrites in flight (BULLET_IMPACT_VIEW.flightFields: a pierce's
 * `pierce` / `lastHit`): equal for one bullet over its whole flight.
 */
export function bulletIdentity(payload: number): number {
	return bit32.band(payload, IDENTITY_MASK);
}

export interface BulletImpactOptions {
	/** Bullets left out (by payload), e.g. the stationary embers. Absent: every bullet counts. */
	readonly skip?: (payload: number) => boolean;
	/** Impacts reported per frame at most (default BULLET_IMPACT_VIEW.maxPerFrame). */
	readonly maxPerFrame?: number;
	/** Remaining life above which a vanished bullet counts as a hit, ticks (default BULLET_IMPACT_VIEW.minLifeTicks). */
	readonly minLifeTicks?: number;
	/** Seconds per step of the simulation (default BULLET_IMPACT_VIEW.stepDt). */
	readonly stepDt?: number;
	/** Life over the projected one that marks a new bullet, ticks (default BULLET_IMPACT_VIEW.sameLifeToleranceTicks). */
	readonly sameLifeToleranceTicks?: number;
}

/**
 * One frame's impacts, column-wise in fixed arrays of `capacity` (allocated once; the arrays are refilled every
 * frame, `count` entries valid, in ascending slot order). Positions are sim world units at the bullet's projected
 * position (BulletImpacts). `dropped`: impacts this frame over the cap (not reported).
 */
export class BulletImpactFeed {
	readonly x: number[];
	readonly y: number[];
	readonly z: number[];
	readonly payload: number[];
	readonly emitter: number[];
	readonly slot: number[];
	count = 0;
	dropped = 0;

	constructor(readonly capacity: number) {
		this.x = table.create(capacity, 0);
		this.y = table.create(capacity, 0);
		this.z = table.create(capacity, 0);
		this.payload = table.create(capacity, 0);
		this.emitter = table.create(capacity, 0);
		this.slot = table.create(capacity, 0);
	}
}

/**
 * Player bullet impacts as a view-side diff (docs/PROJECTILE_ART.md §3; presentation only, read-only on the sim): a
 * slot whose bullet vanished while it still had more than `minLifeTicks` of life (its PROJECTED life: last seen life
 * minus the steps since) hit something (an enemy, a wall, a breakable); one that ran out of life expired and is not an
 * impact. The impact is placed at the projected position: the last seen position plus the last seen velocity over
 * the steps since (at most the steps its life allowed), where the bullet was on the step it vanished in a frame of
 * one step.
 *
 * Identity: a slot holds the same bullet while its emitter and its payload identity (bulletIdentity: every field but
 * the in-flight `pierce` / `lastHit`, so a pierce is not a vanish; the arrow's last hit is the impact) match, and its
 * life is at most the projected life plus `sameLifeToleranceTicks` (life only falls, one step at a time). More life
 * than that is a new bullet in a reused slot (the free list is LIFO), so the old one vanished in between.
 *
 * A new simulation (run restart) or a step count that went back resets the diff without impacts; `reset()` does the
 * same for a caller that clears bullets mid-run (a floor change). Feeds PA7's `fx.bullet.hit` cue.
 *
 * Allocation-free per frame: per-slot arrays grow to the high-water mark once; the feed is fixed-size.
 */
export class BulletImpacts {
	readonly feed: BulletImpactFeed;
	private readonly tracked = new Array<boolean>();
	private readonly life = new Array<number>();
	private readonly step = new Array<number>();
	private readonly payload = new Array<number>();
	private readonly emitter = new Array<number>();
	private readonly px = new Array<number>();
	private readonly py = new Array<number>();
	private readonly pz = new Array<number>();
	private readonly vx = new Array<number>();
	private readonly vy = new Array<number>();
	private readonly vz = new Array<number>();
	private source: BulletImpactSource | undefined;
	private lastStep = 0;
	private readonly skip: ((payload: number) => boolean) | undefined;
	private readonly minLife: number;
	private readonly stepDt: number;
	private readonly lifeTolerance: number;

	constructor(options: BulletImpactOptions = {}) {
		this.feed = new BulletImpactFeed(options.maxPerFrame ?? BULLET_IMPACT_VIEW.maxPerFrame);
		this.skip = options.skip;
		this.stepDt = options.stepDt ?? BULLET_IMPACT_VIEW.stepDt;
		this.minLife = (options.minLifeTicks ?? BULLET_IMPACT_VIEW.minLifeTicks) * this.stepDt;
		this.lifeTolerance =
			(options.sameLifeToleranceTicks ?? BULLET_IMPACT_VIEW.sameLifeToleranceTicks) * this.stepDt;
	}

	/** Forgets every tracked bullet without reporting impacts (the next frame starts a fresh diff). */
	reset(): void {
		for (let i = 0; i < this.tracked.size(); i++) this.tracked[i] = false;
	}

	/** Diffs `sim` against the last frame; fills `feed` and returns its count. */
	frame(sim: BulletImpactSource): number {
		const feed = this.feed;
		feed.count = 0;
		feed.dropped = 0;
		const now = sim.stepCount;
		if (sim !== this.source || now < this.lastStep) {
			this.source = sim;
			this.reset();
		}
		this.lastStep = now;
		const n = sim.highWater();
		while (this.tracked.size() < n) {
			this.tracked.push(false);
			this.life.push(0);
			this.step.push(0);
			this.payload.push(0);
			this.emitter.push(0);
			this.px.push(0);
			this.py.push(0);
			this.pz.push(0);
			this.vx.push(0);
			this.vy.push(0);
			this.vz.push(0);
		}
		const slots = this.tracked.size();
		for (let i = 0; i < slots; i++) {
			const live = i < n && sim.isLive(i);
			const payload = live ? sim.payloadAt(i) : 0;
			const counted = live && (this.skip === undefined || !this.skip(payload));
			const identity = counted ? bulletIdentity(payload) : 0;
			const life = counted ? sim.lifeAt(i) : 0;
			const emitter = counted ? sim.emitterIdAt(i) : 0;
			if (this.tracked[i]) {
				const steps = now - this.step[i];
				const left = this.life[i] - steps * this.stepDt;
				const same =
					counted &&
					identity === bulletIdentity(this.payload[i]) &&
					emitter === this.emitter[i] &&
					life <= left + this.lifeTolerance;
				if (!same) {
					this.tracked[i] = false;
					if (left > this.minLife) this.report(i, steps);
				}
			}
			if (counted) {
				const p = sim.positionAt(i);
				const v = sim.velocityAt(i);
				this.tracked[i] = true;
				this.life[i] = life;
				this.step[i] = now;
				this.payload[i] = payload;
				this.emitter[i] = emitter;
				this.px[i] = p.x;
				this.py[i] = p.y;
				this.pz[i] = p.z;
				this.vx[i] = v.x;
				this.vy[i] = v.y;
				this.vz[i] = v.z;
			}
		}
		return feed.count;
	}

	/** Reports slot i's vanished bullet, projected `steps` steps on (at most the steps its life allowed). */
	private report(i: number, steps: number): void {
		const feed = this.feed;
		const k = feed.count;
		if (k >= feed.capacity) {
			feed.dropped += 1;
			return;
		}
		const dt = this.stepDt;
		const t = math.max(0, math.min(steps, math.floor(this.life[i] / dt))) * dt;
		feed.x[k] = this.px[i] + this.vx[i] * t;
		feed.y[k] = this.py[i] + this.vy[i] * t;
		feed.z[k] = this.pz[i] + this.vz[i] * t;
		feed.payload[k] = this.payload[i];
		feed.emitter[k] = this.emitter[i];
		feed.slot[k] = i;
		feed.count = k + 1;
	}
}
