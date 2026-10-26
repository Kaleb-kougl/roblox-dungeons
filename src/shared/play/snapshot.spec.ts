// The HUD snapshot: what it copies out of a fresh run, and the change check that keeps store writes rare.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_ACT1_ID,
	Boon,
	Boost,
	DROPS_CONFIG,
	SIM_HZ,
	boostTicks,
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
	Curse,
	Relic,
	acceptCurse,
	closeDraft,
	endlessFloorWorld,
	grantRelic,
	playerAt,
	stepParty,
	weaponsAt,
	type SimConfig,
	type SimState,
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

describe("takeSnapshot: boost drops (docs/BOOSTS.md B7)", () => {
	const config = { ...DEFAULT_SIM_CONFIG, drops: DROPS_CONFIG };

	it("none without drops: empty boosts, no Aegis pips", () => {
		const s = takeSnapshot(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG), EXTRAS);
		expect([s.boosts.size(), s.aegisPips]).toEqual([0, 0]);
	});

	it("the running boosts in Boost order, seconds in tenths (rounded up), the bar's fraction, the Aegis pips", () => {
		const st = createSimState(1, 0, 0, config);
		const bp = st.drops!.players[0];
		bp.ticks[Boost.AEGIS] = boostTicks(Boost.AEGIS);
		bp.aegisPips = 1;
		bp.ticks[Boost.FURY] = 3 * SIM_HZ + 1; // 3.0167 s -> 3.1
		const s = takeSnapshot(st, EXTRAS);
		expect(s.boosts).toEqual([
			{ kind: Boost.FURY, secondsLeft: 3.1, fraction: 31 / 100 },
			{ kind: Boost.AEGIS, secondsLeft: 15, fraction: 1 },
		]);
		expect(s.aegisPips).toBe(1);
	});

	it("quantised: a tick inside the same tenth changes nothing the HUD shows; the next tenth does", () => {
		const st = createSimState(1, 0, 0, config);
		const bp = st.drops!.players[0];
		bp.ticks[Boost.FRENZY] = 5 * SIM_HZ;
		const a = takeSnapshot(st, EXTRAS);
		bp.ticks[Boost.FRENZY] -= 1;
		expect(snapshotsEqual(a, takeSnapshot(st, EXTRAS))).toBe(true);
		bp.ticks[Boost.FRENZY] -= SIM_HZ / 10;
		expect(snapshotsEqual(a, takeSnapshot(st, EXTRAS))).toBe(false);
		bp.ticks[Boost.FRENZY] = 0;
		expect(takeSnapshot(st, EXTRAS).boosts.size()).toBe(0);
	});

	it("co-op: the shown player's boosts (SnapshotExtras.playerIndex; no vitalsIndex exists yet)", () => {
		const st = createSimState(1, 0, 0, { ...config, party: { size: 2 } });
		st.drops!.players[1].ticks[Boost.QUICKSTEP] = SIM_HZ;
		st.drops!.players[1].aegisPips = 1;
		expect(takeSnapshot(st, EXTRAS).boosts.size()).toBe(0);
		const mine = takeSnapshot(st, { ...EXTRAS, playerIndex: 1 });
		expect([mine.boosts.map((b) => b.kind), mine.aegisPips]).toEqual([[Boost.QUICKSTEP], 1]);
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
		expect(snapshotsEqual(base, { ...base, aegisPips: 1 })).toBe(false);
		expect(snapshotsEqual(base, { ...base, boosts: [{ kind: 0, secondsLeft: 1, fraction: 0.1 }] })).toBe(false);
		expect(snapshotsEqual(base, { ...base, boosts: [] })).toBe(true);
	});
});

describe("takeSnapshot: co-op vitals and spectating (docs/SPECTATE.md S2)", () => {
	/** A 2-player endless run; player 1 carries the bow in set 0 so the two players' weapon lists differ. */
	function coopRun(): { st: SimState; config: SimConfig } {
		const setup = buildEndlessRunConfig(42, 2);
		const config: SimConfig = {
			...setup.config,
			party: { size: 2, loadouts: [undefined, ["weapon.bow", "weapon.sword"]] },
		};
		return { st: createSimState(42, setup.spawn!.x, setup.spawn!.z, config), config };
	}

	it("vitals and weapons come from vitalsIndex; boons / relics / curses and the shrine hint from playerIndex", () => {
		const { st, config } = coopRun();
		grantBoon(st, 0, Boon.LINGERING);
		grantRelic(st, 1, Relic.HOURGLASS);
		acceptCurse(st, 1, Curse.HASTE);
		const me = playerAt(st, 0);
		const mate = playerAt(st, 1);
		mate.hearts = me.hearts - 3;
		mate.heartsMax = me.heartsMax + 2;
		mate.armor = me.armor + 1;
		mate.armorMax = me.armorMax + 1;
		mate.flask = me.flask - 1;
		mate.flaskMax = me.flaskMax + 1;
		mate.embers = me.embers - 1;
		mate.emberMax = me.emberMax + 1;
		weaponsAt(st, 1).activeSet = 1;
		// Player 0 stands in floor 1's shrine zone, player 1 does not.
		const r = st.run!;
		expect(r.shrineRoom).toBeGreaterThanOrEqual(0);
		const shrine = endlessFloorWorld(st, config)!.config.encounter!.rooms[r.shrineRoom];
		me.x = shrine.cx;
		me.z = shrine.cz;
		const extras = { ...EXTRAS, config };

		const watching = takeSnapshot(st, { ...extras, playerIndex: 0, vitalsIndex: 1 });
		expect([watching.hearts, watching.heartsMax, watching.armor, watching.armorMax]).toEqual([
			mate.hearts,
			mate.heartsMax,
			mate.armor,
			mate.armorMax,
		]);
		expect([watching.flask, watching.flaskMax, watching.embers, watching.emberMax]).toEqual([
			mate.flask,
			mate.flaskMax,
			mate.embers,
			mate.emberMax,
		]);
		expect([watching.weapons, watching.activeSet]).toEqual([["weapon.bow", "weapon.sword"], 1]);
		expect([watching.boons, watching.relics, watching.curses]).toEqual([[Boon.LINGERING], [], []]);
		expect(watching.atShrine).toBe(true);

		const other = takeSnapshot(st, { ...extras, playerIndex: 1, vitalsIndex: 0 });
		expect([other.hearts, other.armor, other.flask, other.embers]).toEqual([
			me.hearts,
			me.armor,
			me.flask,
			me.embers,
		]);
		expect([other.weapons, other.activeSet]).toEqual([["weapon.sword", "weapon.bow"], 0]);
		expect([other.boons, other.relics, other.curses]).toEqual([[], [Relic.HOURGLASS], [Curse.HASTE]]);
		expect(other.atShrine).toBe(false);
	});

	it("the draft and the waiting count follow playerIndex, never vitalsIndex", () => {
		const { st, config } = coopRun();
		stepParty(st, [{ ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON }, EMPTY_INPUT], config);
		const r = st.run!;
		closeDraft(r.players[1]); // player 1 has confirmed; player 0 is still choosing
		const extras = { ...EXTRAS, config };
		const mine = takeSnapshot(st, { ...extras, playerIndex: 0, vitalsIndex: 1 });
		expect([mine.draftOpen, mine.draftWaiting]).toEqual([true, 0]);
		expect(mine.draftOffers).toEqual(r.players[0].draftOffers);
		const theirs = takeSnapshot(st, { ...extras, playerIndex: 1, vitalsIndex: 0 });
		expect([theirs.draftOpen, theirs.draftOffers, theirs.draftWaiting]).toEqual([false, [], 1]);
	});

	it("without vitalsIndex and spectate: today's snapshot (vitals from playerIndex, not spectating)", () => {
		const { st, config } = coopRun();
		playerAt(st, 1).hearts -= 1;
		const extras = { ...EXTRAS, config, playerIndex: 1 };
		const plain = takeSnapshot(st, extras);
		expect(plain).toEqual(takeSnapshot(st, { ...extras, vitalsIndex: 1 }));
		expect([plain.hearts, plain.weapons]).toEqual([playerAt(st, 1).hearts, ["weapon.bow", "weapon.sword"]]);
		expect([plain.spectating, plain.spectateName, plain.spectatePosition, plain.spectateCount]).toEqual([
			false,
			"",
			0,
			0,
		]);
		const solo = takeSnapshot(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG), EXTRAS);
		expect([solo.spectating, solo.spectateName, solo.spectatePosition, solo.spectateCount]).toEqual([
			false,
			"",
			0,
			0,
		]);
		expect([EMPTY_SNAPSHOT.spectating, EMPTY_SNAPSHOT.spectateName]).toEqual([false, ""]);
		expect([EMPTY_SNAPSHOT.spectatePosition, EMPTY_SNAPSHOT.spectateCount]).toEqual([0, 0]);
	});

	it("carries the spectate bar's fields, and snapshotsEqual sees each of them", () => {
		const { st, config } = coopRun();
		const s = takeSnapshot(st, {
			...EXTRAS,
			config,
			playerIndex: 0,
			vitalsIndex: 1,
			spectate: { name: "Bea", position: 1, count: 1 },
		});
		expect([s.spectating, s.spectateName, s.spectatePosition, s.spectateCount]).toEqual([true, "Bea", 1, 1]);
		expect(snapshotsEqual(s, { ...s })).toBe(true);
		expect(snapshotsEqual(s, { ...s, spectating: false })).toBe(false);
		expect(snapshotsEqual(s, { ...s, spectateName: "Cal" })).toBe(false);
		expect(snapshotsEqual(s, { ...s, spectatePosition: 2 })).toBe(false);
		expect(snapshotsEqual(s, { ...s, spectateCount: 2 })).toBe(false);
	});
});
