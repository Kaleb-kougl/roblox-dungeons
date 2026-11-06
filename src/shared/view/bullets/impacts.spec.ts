// Player bullet impacts (docs/PROJECTILE_ART.md PA4): a scripted slot timeline (a hit vs natural expiry vs slot reuse,
// at once by the same emitter too, vs a pierce vs a run restart vs the per-frame cap, the projected position), then
// the real BulletSimulation.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BULLET_Y,
	BulletKind,
	BulletPayload,
	SIM_DT,
	acquireSpawnData,
	createBulletSimulation,
	type Vec3,
} from "shared/sim";
import { BULLET_IMPACT_VIEW } from "./config";
import { BulletImpacts, bulletIdentity, type BulletImpactSource } from "./impacts";

interface FakeBullet {
	life: number;
	payload: number;
	emitter: number;
	pos: Vec3;
	vel: Vec3;
}

/** A bow arrow's payload (kind PLAYER, the bow's source), optionally piercing. */
function arrow(pierce = 0, lastHit = 0, damage = 1): number {
	let p = BulletPayload.with(0, "damage", damage);
	p = BulletPayload.with(p, "kind", BulletKind.PLAYER);
	p = BulletPayload.with(p, "source", 1);
	p = BulletPayload.with(p, "pierce", pierce);
	return BulletPayload.with(p, "lastHit", lastHit);
}

/** A scripted bullet pool: slots by index, life falls by SIM_DT per step, `step` releases expired bullets. */
class FakeBullets implements BulletImpactSource {
	stepCount = 0;
	private readonly slots = new Map<number, FakeBullet>();
	private top = 0;

	put(slot: number, life: number, x: number, z: number, emitter = 1, payload = 0): void {
		this.slots.set(slot, { life, payload, emitter, pos: { x, y: BULLET_Y, z }, vel: { x: 0, y: 0, z: 0 } });
		this.top = math.max(this.top, slot + 1);
	}

	/** Velocity, units per second (the scripted pool never moves bullets by it: `move` does). */
	setVelocity(slot: number, x: number, z: number): void {
		const b = this.slots.get(slot);
		if (b !== undefined) {
			b.vel.x = x;
			b.vel.z = z;
		}
	}

	/** The sim's in-flight payload rewrite (combat.ts: a pierce spends `pierce` and records `lastHit`). */
	setPayload(slot: number, payload: number): void {
		const b = this.slots.get(slot);
		if (b !== undefined) b.payload = payload;
	}

	/** A hit: the sim releases the bullet with life left. */
	remove(slot: number): void {
		this.slots.delete(slot);
		if (this.slots.size() === 0) this.top = 0;
	}

	move(slot: number, x: number, z: number): void {
		const b = this.slots.get(slot);
		if (b !== undefined) {
			b.pos.x = x;
			b.pos.z = z;
		}
	}

	step(times = 1): void {
		for (let t = 0; t < times; t++) {
			this.stepCount += 1;
			const gone: number[] = [];
			for (const [slot, b] of this.slots) {
				b.life -= SIM_DT;
				if (b.life <= 0) gone.push(slot);
			}
			for (const slot of gone) this.remove(slot);
		}
	}

	highWater(): number {
		return this.top;
	}
	isLive(i: number): boolean {
		return this.slots.has(i);
	}
	positionAt(i: number): Readonly<Vec3> {
		return (this.slots.get(i) as FakeBullet).pos;
	}
	velocityAt(i: number): Readonly<Vec3> {
		return (this.slots.get(i) as FakeBullet).vel;
	}
	lifeAt(i: number): number {
		return (this.slots.get(i) as FakeBullet).life;
	}
	payloadAt(i: number): number {
		return (this.slots.get(i) as FakeBullet).payload;
	}
	emitterIdAt(i: number): number {
		return (this.slots.get(i) as FakeBullet).emitter;
	}
}

describe("sprite bullets: impacts", () => {
	it("a bullet that vanished with life left is an impact at its last seen position; expiry is not", () => {
		const sim = new FakeBullets();
		const impacts = new BulletImpacts();
		sim.put(0, 1, 2, 3);
		sim.put(1, 5 * SIM_DT, 7, 8);
		expect(impacts.frame(sim)).toBe(0);
		sim.step();
		sim.move(0, 2.5, 3.25);
		expect(impacts.frame(sim)).toBe(0);
		// slot 0 hits a wall during the next step; slot 1 keeps flying
		sim.step();
		sim.remove(0);
		expect(impacts.frame(sim)).toBe(1);
		const f = impacts.feed;
		expect([f.x[0], f.y[0], f.z[0], f.slot[0], f.emitter[0], f.payload[0]]).toEqual([2.5, BULLET_Y, 3.25, 0, 1, 0]);
		expect(f.dropped).toBe(0);
		// slot 1 runs out of life: never an impact, frame by frame or over a multi-step frame
		sim.step();
		expect(impacts.frame(sim)).toBe(0);
		sim.step(4);
		expect(sim.isLive(1)).toBe(false);
		expect(impacts.frame(sim)).toBe(0);
		expect(impacts.feed.count).toBe(0);
	});

	it("projects the last seen life over the steps since (a frame that covered several ticks)", () => {
		const sim = new FakeBullets();
		const impacts = new BulletImpacts();
		// 3.5 ticks of life: after 3 steps half a tick left. Gone then: not more than minLifeTicks left, an expiry.
		sim.put(0, 3.5 * SIM_DT, 0, 0);
		// 10 ticks: after 3 steps 7 left, gone: a hit.
		sim.put(1, 10 * SIM_DT, 1, 0);
		impacts.frame(sim);
		sim.step(3);
		sim.remove(0);
		sim.remove(1);
		expect(BULLET_IMPACT_VIEW.minLifeTicks).toBe(1);
		expect(impacts.frame(sim)).toBe(1);
		expect(impacts.feed.slot[0]).toBe(1);
	});

	it("a slot reused between two frames reports the old bullet when it was hit", () => {
		const sim = new FakeBullets();
		const impacts = new BulletImpacts();
		sim.put(2, 1, 4, 4, 1);
		sim.put(3, 1, 5, 5, 1);
		sim.put(4, 2.5 * SIM_DT, 6, 6, 1);
		sim.step();
		impacts.frame(sim);
		// two ticks in one frame; slot 4 runs out of life in them
		sim.step(2);
		expect(sim.isLive(4)).toBe(false);
		// slot 2: hit, a new arrow from the same bow takes it (more life than the old one had)
		sim.remove(2);
		sim.put(2, 1, 0, 0, 1);
		// slot 3: hit, another emitter's bullet takes it (less life: the emitter tells them apart)
		sim.remove(3);
		sim.put(3, 0.1, 0, 0, 2);
		// slot 4: expired, a new bullet takes it: not an impact
		sim.put(4, 1, 0, 0, 1);
		expect(impacts.frame(sim)).toBe(2);
		const f = impacts.feed;
		expect([f.slot[0], f.x[0], f.slot[1], f.x[1]]).toEqual([2, 4, 3, 5]);
		// the new bullets are tracked: hit now, they report their own positions
		sim.step();
		sim.remove(2);
		sim.remove(3);
		expect(impacts.frame(sim)).toBe(2);
		expect([f.x[0], f.x[1]]).toEqual([0, 0]);
	});

	it("a slot reused at once by the same emitter and payload (LIFO free list) still reports the old bullet's hit", () => {
		const sim = new FakeBullets();
		const impacts = new BulletImpacts();
		// Arrow A is fired and stepped once: seen with 1 - dt of life.
		sim.put(0, 1, 2, 0, 1, arrow());
		sim.step();
		impacts.frame(sim);
		// Next tick: A hits point-blank and is freed; the bow's next arrow B takes slot 0 at once and is stepped in the
		// same tick, so it also shows 1 - dt: as much life as A had when last seen, more than A's projected 1 - 2 dt.
		sim.remove(0);
		sim.put(0, 1, 9, 0, 1, arrow());
		sim.step();
		expect(sim.lifeAt(0)).toBe(1 - SIM_DT);
		expect(impacts.frame(sim)).toBe(1);
		expect([impacts.feed.slot[0], impacts.feed.x[0]]).toEqual([0, 2]);
		// B is tracked now: its own hit reports its own position
		sim.step();
		sim.remove(0);
		expect(impacts.frame(sim)).toBe(1);
		expect(impacts.feed.x[0]).toBe(9);
	});

	it("the same bullet over multi-step frames is never a reuse (projected life within sameLifeToleranceTicks)", () => {
		const sim = new FakeBullets();
		const impacts = new BulletImpacts();
		expect(BULLET_IMPACT_VIEW.sameLifeToleranceTicks > 0 && BULLET_IMPACT_VIEW.sameLifeToleranceTicks < 1).toBe(
			true,
		);
		sim.put(0, 0.7, 0, 0, 1, arrow());
		impacts.frame(sim);
		for (const steps of [1, 3, 2, 5, 1, 4]) {
			sim.step(steps);
			expect(impacts.frame(sim)).toBe(0);
		}
		// it was tracked all along: its hit is reported once, at its last seen position
		sim.step();
		sim.remove(0);
		expect(impacts.frame(sim)).toBe(1);
		expect(impacts.feed.count).toBe(1);
	});

	it("a pierce (pierce / lastHit rewritten in flight) is not an impact; the arrow's last hit is", () => {
		const sim = new FakeBullets();
		const impacts = new BulletImpacts();
		const heavy = arrow(2, 0, 4);
		sim.put(0, 0.7, 0, 0, 1, heavy);
		impacts.frame(sim);
		// pierces the first enemy (actor slot 4), then the second (slot 6)
		sim.step();
		sim.setPayload(0, arrow(1, 5, 4));
		expect(bulletIdentity(arrow(1, 5, 4))).toBe(bulletIdentity(heavy));
		expect(impacts.frame(sim)).toBe(0);
		sim.step(2);
		sim.setPayload(0, arrow(0, 7, 4));
		sim.move(0, 3, 0);
		expect(impacts.frame(sim)).toBe(0);
		// the third enemy stops it: one impact, at its last position, with its current payload
		sim.step();
		sim.remove(0);
		expect(impacts.frame(sim)).toBe(1);
		expect([impacts.feed.x[0], impacts.feed.payload[0]]).toEqual([3, arrow(0, 7, 4)]);
		// a fixed field that differs (damage: a stream arrow, not the heavy) still marks a new bullet in the slot
		sim.put(0, 0.7, 5, 0, 1, heavy);
		impacts.frame(sim);
		sim.step();
		sim.remove(0);
		sim.put(0, 0.1, 0, 0, 1, arrow());
		expect(impacts.frame(sim)).toBe(1);
		expect(impacts.feed.x[0]).toBe(5);
	});

	it("places an impact at the projected position: last position + velocity x the steps since", () => {
		const sim = new FakeBullets();
		const impacts = new BulletImpacts();
		sim.put(0, 1, 2, 3);
		sim.setVelocity(0, 6, -3);
		impacts.frame(sim);
		// a frame of three steps, the arrow hit in it
		sim.step(3);
		sim.remove(0);
		expect(impacts.frame(sim)).toBe(1);
		const f = impacts.feed;
		expect(f.x[0]).toBeCloseTo(2 + 6 * 3 * SIM_DT, 12);
		expect(f.z[0]).toBeCloseTo(3 - 3 * 3 * SIM_DT, 12);
		expect(f.y[0]).toBe(BULLET_Y);
		// clamped to the steps its life allowed (only a count that lets expiries through can show it)
		const all = new BulletImpacts({ minLifeTicks: -10 });
		sim.put(1, 1.5 * SIM_DT, 0, 0);
		sim.setVelocity(1, 60, 0);
		all.frame(sim);
		sim.step(4);
		expect(all.frame(sim)).toBe(1);
		expect(all.feed.x[0]).toBeCloseTo(60 * SIM_DT, 12);
	});

	it("a new simulation (run restart), a step count that went back or reset() reports nothing", () => {
		const old = new FakeBullets();
		const impacts = new BulletImpacts();
		old.put(0, 1, 1, 1);
		old.put(1, 1, 2, 2);
		old.step(5);
		impacts.frame(old);
		const fresh = new FakeBullets();
		expect(impacts.frame(fresh)).toBe(0);
		fresh.put(0, 1, 1, 1);
		fresh.step(2);
		impacts.frame(fresh);
		fresh.stepCount = 0; // the same pool rebuilt from scratch
		fresh.remove(0);
		expect(impacts.frame(fresh)).toBe(0);
		fresh.put(0, 1, 1, 1);
		impacts.frame(fresh);
		fresh.step();
		impacts.reset();
		fresh.remove(0);
		expect(impacts.frame(fresh)).toBe(0);
	});

	it("caps the impacts per frame in slot order and counts the rest as dropped", () => {
		const sim = new FakeBullets();
		const impacts = new BulletImpacts();
		const cap = BULLET_IMPACT_VIEW.maxPerFrame;
		const n = cap + 4;
		for (let i = 0; i < n; i++) sim.put(i, 1, i, 0);
		impacts.frame(sim);
		sim.step();
		for (let i = 0; i < n; i++) sim.remove(i);
		expect(impacts.frame(sim)).toBe(cap);
		const slots: number[] = [];
		for (let i = 0; i < impacts.feed.count; i++) slots.push(impacts.feed.slot[i]);
		const want: number[] = [];
		for (let i = 0; i < cap; i++) want.push(i);
		expect(slots).toEqual(want);
		expect(impacts.feed.dropped).toBe(4);
		expect(impacts.feed.capacity).toBe(cap);
		// next frame starts empty
		expect(impacts.frame(sim)).toBe(0);
		expect(impacts.feed.dropped).toBe(0);
		// a smaller cap from the options
		const two = new BulletImpacts({ maxPerFrame: 2 });
		for (let i = 0; i < 3; i++) sim.put(i, 1, i, 0);
		two.frame(sim);
		sim.step();
		for (let i = 0; i < 3; i++) sim.remove(i);
		expect([two.frame(sim), two.feed.dropped]).toEqual([2, 1]);
	});

	it("skips bullets by payload (the stationary embers)", () => {
		const ember = BulletPayload.with(0, "kind", BulletKind.EMBER);
		const sim = new FakeBullets();
		const impacts = new BulletImpacts({
			skip: (payload) => BulletPayload.get(payload, "kind") === BulletKind.EMBER,
		});
		sim.put(0, 1, 0, 0, 1, ember);
		sim.put(1, 1, 1, 0, 1, 0);
		impacts.frame(sim);
		sim.step();
		sim.remove(0);
		sim.remove(1);
		expect(impacts.frame(sim)).toBe(1);
		expect(impacts.feed.slot[0]).toBe(1);
	});

	it("reads the real BulletSimulation: a cleared bullet hit, an expired one did not", () => {
		const sim = createBulletSimulation({ maxBullets: 8 });
		const impacts = new BulletImpacts();
		const fire = (life: number) =>
			sim.fireAt({ x: 1, y: BULLET_Y, z: 2 }, () => {
				const p = acquireSpawnData();
				p.life = life;
				p.velocity.x = 1;
				return [p];
			});
		fire(3 * SIM_DT);
		impacts.frame(sim);
		for (let i = 0; i < 4; i++) {
			sim.step(SIM_DT);
			expect(impacts.frame(sim)).toBe(0);
		}
		expect(sim.activeCount).toBe(0);
		fire(1);
		impacts.frame(sim);
		sim.step(SIM_DT);
		impacts.frame(sim);
		const x = sim.positionAt(0).x;
		sim.step(SIM_DT);
		sim.clear();
		// projected one step on along the velocity (1 unit / s): where it was on the step it vanished in
		expect(impacts.frame(sim)).toBe(1);
		expect([impacts.feed.slot[0], impacts.feed.z[0]]).toEqual([0, 2]);
		expect(impacts.feed.x[0]).toBeCloseTo(x + SIM_DT, 12);
	});
});
