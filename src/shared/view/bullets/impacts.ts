import type { BulletSimulation } from "shared/sim";
import { BULLET_IMPACT_VIEW } from "./config";

/** What BulletImpacts reads of a bullet simulation (a BulletSimulation, or a scripted stand-in in specs). */
export type BulletImpactSource = Pick<
	BulletSimulation,
	"stepCount" | "highWater" | "isLive" | "positionAt" | "lifeAt" | "payloadAt" | "emitterIdAt"
>;

export interface BulletImpactOptions {
	/** Bullets left out (by payload), e.g. the stationary embers. Absent: every bullet counts. */
	readonly skip?: (payload: number) => boolean;
	/** Impacts reported per frame at most (default BULLET_IMPACT_VIEW.maxPerFrame). */
	readonly maxPerFrame?: number;
	/** Remaining life above which a vanished bullet counts as a hit, ticks (default BULLET_IMPACT_VIEW.minLifeTicks). */
	readonly minLifeTicks?: number;
	/** Seconds per step of the simulation (default BULLET_IMPACT_VIEW.stepDt). */
	readonly stepDt?: number;
}

/**
 * One frame's impacts, column-wise in fixed arrays of `capacity` (allocated once; the arrays are refilled every
 * frame, `count` entries valid, in ascending slot order). Positions are sim world units at the bullet's last seen
 * position. `dropped`: impacts this frame over the cap (not reported).
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
 * slot whose bullet vanished while it still had more than `minLifeTicks` of life (its last seen life minus the steps
 * since) hit something (an enemy, a wall, a breakable) at its last seen position; one that ran out of life expired
 * and is not an impact. A slot that holds a different bullet than last frame (another payload or emitter, or more
 * life than before: life only falls) lost the old one in between. A new simulation (run restart) or a step count that
 * went back resets the diff without impacts; `reset()` does the same for a caller that clears bullets mid-run (a
 * floor change). Feeds PA7's `fx.bullet.hit` cue.
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
	private source: BulletImpactSource | undefined;
	private lastStep = 0;
	private readonly skip: ((payload: number) => boolean) | undefined;
	private readonly minLife: number;
	private readonly stepDt: number;

	constructor(options: BulletImpactOptions = {}) {
		this.feed = new BulletImpactFeed(options.maxPerFrame ?? BULLET_IMPACT_VIEW.maxPerFrame);
		this.skip = options.skip;
		this.stepDt = options.stepDt ?? BULLET_IMPACT_VIEW.stepDt;
		this.minLife = (options.minLifeTicks ?? BULLET_IMPACT_VIEW.minLifeTicks) * this.stepDt;
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
		}
		const slots = this.tracked.size();
		for (let i = 0; i < slots; i++) {
			const live = i < n && sim.isLive(i);
			const payload = live ? sim.payloadAt(i) : 0;
			const counted = live && (this.skip === undefined || !this.skip(payload));
			if (this.tracked[i]) {
				const same =
					counted &&
					payload === this.payload[i] &&
					sim.emitterIdAt(i) === this.emitter[i] &&
					sim.lifeAt(i) <= this.life[i];
				if (!same) {
					this.tracked[i] = false;
					const left = this.life[i] - (now - this.step[i]) * this.stepDt;
					if (left > this.minLife) this.report(i);
				}
			}
			if (counted) {
				const p = sim.positionAt(i);
				this.tracked[i] = true;
				this.life[i] = sim.lifeAt(i);
				this.step[i] = now;
				this.payload[i] = payload;
				this.emitter[i] = sim.emitterIdAt(i);
				this.px[i] = p.x;
				this.py[i] = p.y;
				this.pz[i] = p.z;
			}
		}
		return feed.count;
	}

	private report(i: number): void {
		const feed = this.feed;
		const k = feed.count;
		if (k >= feed.capacity) {
			feed.dropped += 1;
			return;
		}
		feed.x[k] = this.px[i];
		feed.y[k] = this.py[i];
		feed.z[k] = this.pz[i];
		feed.payload[k] = this.payload[i];
		feed.emitter[k] = this.emitter[i];
		feed.slot[k] = i;
		feed.count = k + 1;
	}
}
