// The HUD snapshot: what it copies out of a fresh run, and the change check that keeps store writes rare.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_ACT1_ID,
	Boon,
	COMBO_WINDOW_TICKS,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	SOLO_PLAYER,
	grantBoon,
	step,
	EMBERS_PER_AREA,
	FLASK_CHARGES,
	START_HALF_HEARTS,
	archetypeIndex,
	createSimState,
} from "shared/sim";
import { EMPTY_SNAPSHOT, bossPhaseMarks, findBoss, snapshotsEqual, takeSnapshot, type GameSnapshot } from "shared/play";
import { buildEndlessRunConfig } from "shared/run";

const EXTRAS = { paused: false, outcome: "playing" as const, recordedTicks: 0 };

describe("takeSnapshot", () => {
	it("copies the player's resources, the weapon sets and the counts of a fresh run", () => {
		const s = takeSnapshot(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG), EXTRAS);
		expect(s.hearts).toBe(START_HALF_HEARTS);
		expect(s.heartsMax).toBe(START_HALF_HEARTS);
		expect(s.flask).toBe(FLASK_CHARGES);
		expect(s.embers).toBe(EMBERS_PER_AREA);
		expect(s.activeSet).toBe(0);
		expect(s.weapons).toEqual(["weapon.sword", "weapon.bow"]);
		expect(s.bossVisible).toBe(false);
		expect(s.bossId).toBe("");
		expect(s.enemiesAlive).toBe(0);
		expect(s.enemyBullets).toBe(0);
		expect(s.outcome).toBe("playing");
	});

	it("finds no boss without actors", () => {
		expect(findBoss(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG))).toBe(undefined);
	});

	it("carries the run totals and the boss's phase marks (66 % / 33 % for Mother Bramble)", () => {
		const s = takeSnapshot(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG), { ...EXTRAS, kills: 4, hitsTaken: 2 });
		expect([s.kills, s.hitsTaken]).toEqual([4, 2]);
		expect(s.bossPhaseMarks).toEqual([]);
		expect(bossPhaseMarks(archetypeIndex(BOSS_ACT1_ID))).toEqual([0.66, 0.33]);
		expect(bossPhaseMarks(archetypeIndex("swarmer"))).toEqual([]);
	});
});

describe("takeSnapshot: M2 progression (endless runs)", () => {
	it("the draft's offers and selection, owned boons, the combo window, the shrine hint", () => {
		const setup = buildEndlessRunConfig(42);
		const st = createSimState(42, setup.spawn!.x, setup.spawn!.z, setup.config);
		const extras = { ...EXTRAS, config: setup.config };
		const fresh = takeSnapshot(st, extras);
		expect([fresh.draftOpen, fresh.boons.size(), fresh.comboWindowTicks, fresh.atShrine]).toEqual([
			false,
			0,
			COMBO_WINDOW_TICKS,
			false,
		]);
		grantBoon(st, SOLO_PLAYER, Boon.LINGERING);
		step(st, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON }, setup.config);
		const s = takeSnapshot(st, extras);
		expect(s.draftOpen).toBe(true);
		expect(s.draftOffers).toEqual(st.run!.players[SOLO_PLAYER].draftOffers);
		expect([s.draftSelected, s.draftReady]).toEqual([1, false]);
		expect([s.boons, s.comboWindowTicks]).toEqual([[Boon.LINGERING], 270]);
		expect(snapshotsEqual(s, { ...s, draftSelected: 0 })).toBe(false);
		expect(snapshotsEqual(s, { ...s, boons: [] })).toBe(false);
		expect(snapshotsEqual(s, { ...s, draftOffers: [...s.draftOffers] })).toBe(true);
	});
});

describe("snapshotsEqual", () => {
	const base = takeSnapshot(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG), EXTRAS);

	it("equal for identical content, also across fresh arrays", () => {
		const copy: GameSnapshot = { ...base, weapons: [...base.weapons] };
		expect(snapshotsEqual(base, copy)).toBe(true);
	});

	it("differs on any shown field", () => {
		expect(snapshotsEqual(base, { ...base, hearts: base.hearts - 1 })).toBe(false);
		expect(snapshotsEqual(base, { ...base, paused: true })).toBe(false);
		expect(snapshotsEqual(base, { ...base, outcome: "dead" })).toBe(false);
		expect(snapshotsEqual(base, { ...base, weapons: ["weapon.bow", "weapon.sword"] })).toBe(false);
		expect(snapshotsEqual(base, EMPTY_SNAPSHOT)).toBe(false);
		expect(snapshotsEqual(base, { ...base, kills: 1 })).toBe(false);
		expect(snapshotsEqual(base, { ...base, bossPhaseMarks: [0.5] })).toBe(false);
	});
});
