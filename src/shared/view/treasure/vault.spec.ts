// The vault's per-frame look (docs/TREASURE.md TR7): TreasureViewTracker over hand-set treasure states and the frame
// events TreasureFrameEvents collects from them (the real sim drives the same path in shared/play treasureView.spec.ts):
// the arm, the crack's flash / step / shards / tier line, the unlock's bars / kept line / wobble, the open's jolt, pop
// edge (once), column and cards; a vault met mid-way shows settled; a new vault forgets; another vault's events are
// ignored; reduced motion and Particles off.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, VaultTier } from "shared/dungeon";
import {
	ENDLESS_TREASURE_CONFIG,
	SIM_HZ,
	TREASURE_UNSET,
	VaultStatus,
	clearTreasureEvents,
	createTreasureState,
	type SimState,
	type TreasureState,
} from "shared/sim";
import {
	NEVER_AGE,
	NO_TREASURE_EVENTS,
	TREASURE_VIEW,
	TreasureFrameEvents,
	TreasureViewTracker,
	vaultOnFloor,
	type TreasureLookSettings,
} from ".";

const V = TREASURE_VIEW;
const FULL: TreasureLookSettings = { reducedMotion: false, particles: true };
const REDUCED: TreasureLookSettings = { reducedMotion: true, particles: true };
const NO_PARTICLES: TreasureLookSettings = { reducedMotion: false, particles: false };

/** A sealed Legendary UNTOUCHED vault in room 3, slot 9, facing +z. */
function sealed(): TreasureState {
	const t = createTreasureState(ENDLESS_TREASURE_CONFIG, 7, 1);
	t.status = VaultStatus.SEALED;
	t.room = 3;
	t.record = 2;
	t.slot = 9;
	t.x = 10.5;
	t.z = 4.5;
	t.fx = 0;
	t.fz = 1;
	t.lock = VaultLock.UNTOUCHED;
	t.startTier = VaultTier.LEGENDARY;
	t.tier = VaultTier.LEGENDARY;
	return t;
}

class Driver {
	readonly tracker = new TreasureViewTracker();
	readonly frame = new TreasureFrameEvents();
	tick = 100;
	readonly state: { tick: number; treasure: TreasureState | undefined };

	constructor(readonly t: TreasureState | undefined) {
		this.state = { tick: this.tick, treasure: t };
	}

	/** One tick with `change` applied (its events set), collected into this frame. */
	step(change?: (t: TreasureState) => void): void {
		const t = this.state.treasure;
		this.tick += 1;
		this.state.tick = this.tick;
		if (t !== undefined) {
			clearTreasureEvents(t);
			if (change !== undefined) change(t);
		}
		this.frame.collect(this.state as unknown as SimState);
	}

	/** Renders a frame at this tick (+ `alpha`), then starts the next frame's events. */
	look(settings: TreasureLookSettings = FULL, alpha = 0) {
		const look = this.tracker.update(
			this.state as unknown as SimState,
			this.frame,
			(this.tick + alpha) / SIM_HZ,
			settings,
		);
		this.frame.reset();
		return look;
	}

	/** `sec` of single-tick frames; returns how many frames had a pop edge. */
	run(sec: number, settings: TreasureLookSettings = FULL): number {
		let pops = 0;
		const n = math.ceil(sec * SIM_HZ);
		for (let i = 0; i < n; i++) {
			this.step();
			if (this.look(settings).popEdge) pops++;
		}
		return pops;
	}

	arm(): void {
		this.step((t) => {
			t.status = VaultStatus.ARMED;
			t.armTick = this.tick;
			t.allowance = 0;
			t.events.armed = 1;
		});
	}

	crack(): void {
		this.step((t) => {
			t.status = VaultStatus.CRACKED;
			t.tier = t.startTier - 1;
			t.crackTick = this.tick;
			t.events.cracked = 1;
		});
	}

	unlock(): void {
		this.step((t) => {
			const kept = t.crackTick === TREASURE_UNSET;
			t.status = VaultStatus.UNLOCKED;
			if (kept) t.spare = 0;
			else t.missBy = 1;
			t.events.unlocked = 1;
		});
	}

	open(): void {
		this.step((t) => {
			t.status = VaultStatus.OPENED;
			t.events.opened = {
				opener: 0,
				tier: t.tier,
				startTier: t.startTier,
				lock: t.lock,
				kept: t.crackTick === TREASURE_UNSET ? 1 : 0,
				missBy: t.missBy,
				spare: t.spare,
				points: 1500,
				grants: [{ player: 0, relic: TREASURE_UNSET, bonusDeal: 1, boosts: [2], slots: [0] }],
			};
		});
	}
}

describe("TreasureFrameEvents", () => {
	it("copies every tick's events with the vault's identity and the tick, in order", () => {
		const d = new Driver(sealed());
		d.arm();
		d.crack();
		d.unlock();
		d.open();
		const f = d.frame;
		expect(f.count()).toBe(4);
		expect([f.armed[0].tick, f.armed[0].room, f.armed[0].slot, f.armed[0].allowance]).toEqual([101, 3, 9, 0]);
		expect([f.cracked[0].tick, f.cracked[0].fromTier, f.cracked[0].tier]).toEqual([102, 2, 1]);
		expect([f.unlocked[0].tick, f.unlocked[0].kept, f.unlocked[0].missBy]).toEqual([103, 0, 1]);
		const o = f.opened[0];
		expect([o.tick, o.tier, o.startTier, o.kept, o.points, o.x, o.z]).toEqual([104, 1, 2, 0, 1500, 10.5, 4.5]);
		expect(o.grants[0].boosts).toEqual([2]);
		// Copies: the sim's reused arrays never leak in.
		d.t!.events.opened!.grants[0].boosts.push(9);
		expect(o.grants[0].boosts).toEqual([2]);
		f.reset();
		expect(f.count()).toBe(0);
		expect(NO_TREASURE_EVENTS.armed.size()).toBe(0);
	});

	it("collects nothing without treasure", () => {
		const d = new Driver(undefined);
		d.step();
		expect(d.frame.count()).toBe(0);
		expect(vaultOnFloor(d.state as unknown as SimState)).toBe(false);
		expect(vaultOnFloor({ treasure: sealed() } as unknown as SimState)).toBe(true);
	});
});

describe("TreasureViewTracker", () => {
	it("shows a sealed vault caged and sparkling in its tier, no plate", () => {
		const d = new Driver(sealed());
		const look = d.look();
		expect([look.present, look.fresh, look.open, look.cage.shown, look.sparkleShown]).toEqual([
			true,
			true,
			false,
			true,
			true,
		]);
		expect([look.sparkleTier, look.sparkleSize, look.plateShown, look.lineKind]).toEqual([2, 1.5, false, "none"]);
		expect(d.look().fresh).toBe(false);
	});

	it("fades the plate in on the arm", () => {
		const d = new Driver(sealed());
		d.look();
		d.arm();
		expect(d.look().plateAlpha).toBe(0);
		d.run(V.plate.fadeInSec / 2);
		const half = d.look();
		expect(half.plateShown).toBe(true);
		expect(half.plateAlpha > 0 && half.plateAlpha < 1).toBe(true);
		d.run(V.plate.fadeInSec);
		expect(d.look().plateAlpha).toBe(1);
	});

	it("cracks: a white flash, the lost tier for a moment, shards in its colour, the new tier's line", () => {
		const d = new Driver(sealed());
		d.look();
		d.arm();
		d.look();
		d.crack();
		const look = d.look();
		expect(look.crackEdge).toBe(true);
		expect([look.whiteMix, look.sparkleTier, look.shardU, look.shardTier, look.plateAlpha]).toEqual([
			1, 2, 0, 2, 0,
		]);
		expect([look.plateShown, look.tier]).toEqual([true, 1]);
		d.run(V.crack.stepSec);
		const later = d.look();
		expect([later.crackEdge, later.sparkleTier, later.sparkleSize, later.lineKind]).toEqual([false, 1, 1, "tier"]);
		expect(later.line.riseTiles > 0).toBe(true);
		d.run(V.crack.lineSec);
		const done = d.look();
		expect([done.whiteMix, done.shardU, done.plateShown, done.lineKind]).toEqual([0, -1, false, "none"]);
	});

	it("unlocks after the stamp: the bars go, a kept lock's line and plate fade, the chest wobbles", () => {
		const d = new Driver(sealed());
		d.look();
		d.arm();
		d.run(1);
		d.unlock();
		const look = d.look();
		expect([look.cage.shown, look.cage.sink, look.plateAlpha, look.lineKind, look.unlockEdge]).toEqual([
			true,
			0,
			1,
			"none",
			false,
		]);
		expect(look.sparkleEverySec).toBe(1.5 / V.sparkle.unlockedRate);
		let edges = 0;
		for (let i = 0; i < math.ceil(V.unlock.delaySec * SIM_HZ) + 1; i++) {
			d.step();
			if (d.look().unlockEdge) edges++;
		}
		expect(edges).toBe(1);
		expect(d.look().lineKind).toBe("kept");
		d.run(V.unlock.sinkSec);
		const down = d.look();
		expect([down.cage.shown, down.plateShown]).toEqual([false, false]);
		let wobbled = false;
		for (let i = 0; i < 2 * V.unlock.wobbleEverySec * SIM_HZ; i++) {
			d.step();
			if (d.look().wobbleDeg !== 0) wobbled = true;
		}
		expect(wobbled).toBe(true);
	});

	it("stays quiet at a cracked lock's unlock (no kept line, no plate)", () => {
		const d = new Driver(sealed());
		d.look();
		d.arm();
		d.crack();
		d.run(1);
		d.unlock();
		d.run(V.unlock.delaySec + 0.1);
		const look = d.look();
		expect([look.lineKind, look.plateShown]).toEqual(["none", false]);
	});

	it("opens: the lid jolts, pops once, the column rises and fades, the open is kept for the cards", () => {
		const d = new Driver(sealed());
		d.look();
		d.arm();
		d.unlock();
		d.run(1.2);
		d.open();
		const look = d.look();
		expect([look.open, look.liftStuds, look.popEdge, look.sparkleShown]).toEqual([false, 0, false, true]);
		expect(look.opened?.points).toBe(1500);
		expect(look.openAge).toBe(0);
		d.step();
		expect(d.look().liftStuds > 0).toBe(true);
		const pops = d.run(V.open.popSec + 0.1);
		expect(pops).toBe(1);
		const popped = d.look();
		expect([popped.open, popped.sparkleShown, popped.column.shown]).toEqual([true, false, true]);
		expect(d.run(3)).toBe(0);
		const settled = d.look();
		expect([settled.open, settled.column.shown, settled.opened !== undefined]).toEqual([true, false, true]);
	});

	it("has no column with Particles off, and a still sparkle; reduced motion: no jolt, no wobble", () => {
		const d = new Driver(sealed());
		d.look(NO_PARTICLES);
		expect(d.look(NO_PARTICLES).sparkleStill).toBe(true);
		d.arm();
		d.unlock();
		d.run(2, REDUCED);
		expect(d.look(REDUCED).wobbleDeg).toBe(0);
		d.open();
		d.look(REDUCED);
		d.step();
		expect(d.look(REDUCED).liftStuds).toBe(0);
		d.run(V.open.popSec + 0.05, NO_PARTICLES);
		expect(d.look(NO_PARTICLES).column.shown).toBe(false);
	});

	it("shows a vault met mid-way settled: an opened chest open, no edges, no column, no cards", () => {
		const t = sealed();
		t.status = VaultStatus.OPENED;
		t.tier = VaultTier.RARE;
		t.crackTick = 50;
		const d = new Driver(t);
		const look = d.look();
		expect([look.fresh, look.open, look.popEdge, look.column.shown, look.opened, look.cage.shown]).toEqual([
			true,
			true,
			false,
			false,
			undefined,
			false,
		]);
		expect(look.openAge).toBe(NEVER_AGE);
		expect(d.run(1)).toBe(0);
	});

	it("shows an unlocked vault met mid-way without bars, still wobbling", () => {
		const t = sealed();
		t.status = VaultStatus.UNLOCKED;
		const d = new Driver(t);
		const look = d.look();
		expect([look.cage.shown, look.plateShown, look.lineKind]).toEqual([false, false, "none"]);
		let wobbled = false;
		for (let i = 0; i < 2 * V.unlock.wobbleEverySec * SIM_HZ; i++) {
			d.step();
			if (d.look().wobbleDeg !== 0) wobbled = true;
		}
		expect(wobbled).toBe(true);
	});

	it("forgets on a new vault (another slot, a tick going back) and ignores another vault's events", () => {
		const d = new Driver(sealed());
		d.look();
		d.arm();
		d.crack();
		d.look();
		// A floor change: the next floor's vault, SEALED, while this frame still carries the old one's crack.
		d.crack();
		const t = d.t!;
		t.slot = 4;
		t.status = VaultStatus.SEALED;
		t.tier = VaultTier.RARE;
		t.startTier = VaultTier.RARE;
		t.crackTick = TREASURE_UNSET;
		const look = d.look();
		expect([look.fresh, look.crackEdge, look.shardU, look.whiteMix, look.sparkleTier]).toEqual([
			true,
			false,
			-1,
			0,
			1,
		]);
		// A restart: the tick goes backwards.
		d.tick = 10;
		d.step();
		expect(d.look().fresh).toBe(true);
	});

	it("reports no vault (fresh once) when the floor has none", () => {
		const t = sealed();
		t.status = VaultStatus.NONE;
		const d = new Driver(t);
		const look = d.look();
		expect([look.present, look.fresh]).toEqual([false, true]);
		expect(d.look().fresh).toBe(false);
	});
});
