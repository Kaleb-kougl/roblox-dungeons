import { describe, expect, it } from "@rbxts/jest-globals";
import { defaultJuiceSettings, type JuiceSettings, type ParticlesLevel } from "shared/settings";
import {
	BOSS_DEMONLORD_ID,
	DEMONLORD_V_MARK,
	DemonlordAttack,
	DemonlordState,
	ROLL_TICKS,
	SIM_HZ,
	type ActorState,
} from "shared/sim";
import { SPRITE_VIEW } from "../config";
import { GhostTrail, brimstoneCharging, ghostTransparency, ghostsOn } from "./afterimage";
import { FEEL_GHOST, GHOST_POOL_SIZE } from "./motionFxConfig";

function settings(particles: ParticlesLevel, reducedMotion: boolean): JuiceSettings {
	return { ...defaultJuiceSettings(), particles, reducedMotion };
}

/** Steps a trail through a roll of ROLL_TICKS ticks at one frame per tick; returns the ticks that recorded a ghost. */
function roll(trail: GhostTrail, from: number, ticks: number): number[] {
	const out: number[] = [];
	for (let t = from; t < from + ticks; t++) {
		const g = trail.due(true, t, t / SIM_HZ);
		if (g !== undefined) out.push(t);
		for (const ghost of trail.ghosts) trail.transparencyOf(ghost, t / SIM_HZ);
		expect(trail.aliveCount() <= FEEL_GHOST.perSource).toBe(true);
	}
	return out;
}

describe("FEEL_GHOST", () => {
	it("keeps three ghosts per source, alive 0.15 s, from half transparent", () => {
		expect(FEEL_GHOST.perSource).toBe(3);
		expect(FEEL_GHOST.lifeSec).toBe(0.15);
		expect(FEEL_GHOST.startTransparency).toBe(0.5);
		expect(FEEL_GHOST.behindStuds > 0 && FEEL_GHOST.behindStuds < SPRITE_VIEW.floorClearanceMarginStuds).toBe(true);
		expect(GHOST_POOL_SIZE).toBe(FEEL_GHOST.perSource * (FEEL_GHOST.playerTrails + FEEL_GHOST.bossTrails));
	});
});

describe("ghostTransparency", () => {
	it("fades 0.5 -> 1 over the life, 1 outside it", () => {
		expect(ghostTransparency(0)).toBe(0.5);
		expect(ghostTransparency(FEEL_GHOST.lifeSec / 2)).toBeCloseTo(0.75, 9);
		expect(ghostTransparency(FEEL_GHOST.lifeSec)).toBe(1);
		expect(ghostTransparency(-0.01)).toBe(1);
		expect(ghostTransparency(0 / 0)).toBe(1);
	});
});

describe("ghostsOn (JD9)", () => {
	it("is off under reduced motion and with particles off", () => {
		expect(ghostsOn(settings("normal", false))).toBe(true);
		expect(ghostsOn(settings("low", false))).toBe(true);
		expect(ghostsOn(settings("off", false))).toBe(false);
		expect(ghostsOn(settings("high", true))).toBe(false);
		expect(ghostsOn(settings("normal", true))).toBe(false);
	});
});

describe("GhostTrail", () => {
	it("records on the first rolling frame, then every everyTicks ticks", () => {
		const trail = new GhostTrail();
		const ticks = roll(trail, 100, ROLL_TICKS);
		const want: number[] = [];
		for (let t = 100; t < 100 + ROLL_TICKS; t += FEEL_GHOST.everyTicks) want.push(t);
		expect(ticks).toEqual(want);
	});

	it("keeps the cadence when frames skip ticks", () => {
		const trail = new GhostTrail();
		expect(trail.due(true, 10, 0)).toBeDefined();
		expect(trail.due(true, 13, 0.05)).toBeUndefined();
		expect(trail.due(true, 15, 0.08)).toBeDefined();
	});

	it("never has more than perSource alive, reusing the oldest", () => {
		const trail = new GhostTrail();
		// a frozen effect clock: nothing fades, so the ring has to recycle
		const seen = new Set<object>();
		for (let k = 0; k < 5; k++) {
			const g = trail.due(true, k * FEEL_GHOST.everyTicks, 0);
			expect(g).toBeDefined();
			seen.add(g!);
		}
		expect(trail.aliveCount()).toBe(FEEL_GHOST.perSource);
		expect(seen.size()).toBe(FEEL_GHOST.perSource);
	});

	it("bumps a ghost's serial on every recording", () => {
		const trail = new GhostTrail(1);
		const a = trail.due(true, 0, 0)!;
		const s = a.serial;
		const b = trail.due(true, FEEL_GHOST.everyTicks, 0)!;
		expect(b).toBe(a);
		expect(b.serial).toBe(s + 1);
	});

	it("lets ghosts fade out and die after lifeSec", () => {
		const trail = new GhostTrail();
		const g = trail.due(true, 0, 0)!;
		expect(trail.transparencyOf(g, 0)).toBe(0.5);
		expect(trail.transparencyOf(g, FEEL_GHOST.lifeSec / 2)).toBeCloseTo(0.75, 9);
		expect(trail.transparencyOf(g, FEEL_GHOST.lifeSec)).toBe(1);
		expect(g.alive).toBe(false);
		expect(trail.transparencyOf(g, 0)).toBe(1); // dead stays dead
	});

	it("stops recording when the source stops, and starts at once on the next activation", () => {
		const trail = new GhostTrail();
		expect(trail.due(true, 0, 0)).toBeDefined();
		expect(trail.due(false, 1, 0)).toBeUndefined();
		expect(trail.due(true, 2, 0)).toBeDefined();
	});

	it("restarts the count when the tick goes back (a new run)", () => {
		const trail = new GhostTrail();
		expect(trail.due(true, 500, 0)).toBeDefined();
		expect(trail.due(true, 1, 0)).toBeDefined();
	});

	it("drops a cancelled ghost and every ghost on clear / a new key", () => {
		const trail = new GhostTrail();
		const g = trail.due(true, 0, 0)!;
		trail.cancel(g);
		expect(trail.aliveCount()).toBe(0);
		trail.due(true, FEEL_GHOST.everyTicks, 0);
		trail.bind(42);
		expect(trail.aliveCount()).toBe(0);
		trail.due(true, 0, 0);
		trail.bind(42); // same key: kept
		expect(trail.aliveCount()).toBe(1);
		trail.clear();
		expect(trail.aliveCount()).toBe(0);
	});
});

describe("brimstoneCharging", () => {
	function demonlord(aiState: number, attack: number, mark: number, alive = 1): ActorState {
		const v: number[] = [];
		for (let i = 0; i <= DEMONLORD_V_MARK; i++) v.push(0);
		v[DEMONLORD_V_MARK] = mark;
		return { alive, aiState, attack, v } as unknown as ActorState;
	}

	it("is the charge's run only: ACTIVE CHARGE before the impact", () => {
		expect(brimstoneCharging(demonlord(DemonlordState.ACTIVE, DemonlordAttack.CHARGE, 0), BOSS_DEMONLORD_ID)).toBe(
			true,
		);
		// the impact (v[MARK] set) and the hold after it
		expect(brimstoneCharging(demonlord(DemonlordState.ACTIVE, DemonlordAttack.CHARGE, 7), BOSS_DEMONLORD_ID)).toBe(
			false,
		);
		// the wind-up, another attack, a dead lord, another archetype
		expect(
			brimstoneCharging(demonlord(DemonlordState.TELEGRAPH, DemonlordAttack.CHARGE, 0), BOSS_DEMONLORD_ID),
		).toBe(false);
		expect(brimstoneCharging(demonlord(DemonlordState.ACTIVE, DemonlordAttack.CLEAVE, 0), BOSS_DEMONLORD_ID)).toBe(
			false,
		);
		expect(
			brimstoneCharging(demonlord(DemonlordState.ACTIVE, DemonlordAttack.CHARGE, 0, 0), BOSS_DEMONLORD_ID),
		).toBe(false);
		expect(brimstoneCharging(demonlord(DemonlordState.ACTIVE, DemonlordAttack.CHARGE, 0), "boss.act1")).toBe(false);
	});
});
