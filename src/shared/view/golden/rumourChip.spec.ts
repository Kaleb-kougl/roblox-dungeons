// The Goldling rumour's HUD and card (docs/GOLDLING_RUMOURS.md GR7): the chip's two lines (theme strings, English in
// the placeholder), its gentle pulse in ROOM only and never under reduced motion, its width beside the Horde chip in
// the status corner's boost row, the snapshot field (the client clock's chip, NONE by default), the first-time card
// (sighting id `golden.rumour`, queued once heard, one card at a time so never on top of the Goldling's own, once per
// account), and KV_GoldenLabel's lines while it hides (room, piece slot, rumour phase, release tick).
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import { SIGHTING_IDS, sightingStringKey } from "shared/onboarding";
import { EMPTY_SNAPSHOT, snapshotsEqual, takeSnapshot } from "shared/play";
import { buildDevRunConfig, buildEndlessRunConfig } from "shared/run";
import {
	BreakableSource,
	EMPTY_INPUT,
	createSimState,
	damageBreakable,
	step,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { GOLDEN_RUMOUR_BESTIARY_KEY, GOLDEN_RUMOUR_STRING_KEYS, PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { hordeChipWidth } from "../pacts";
import { GOLDEN_RUMOUR_SIGHTING, SIGHTING_VIEW, SightingQueue, withRumourSighting } from "../sighting";
import {
	GOLDEN_RUMOUR_STRINGS,
	GOLDEN_VIEW,
	GoldenRumourClock,
	GoldenRumourPhase,
	chipRowWidth,
	goldenDebugText,
	goldenRumourChipKey,
	goldenRumourChipScale,
	goldenRumourChipText,
} from ".";

const C = GOLDEN_VIEW.rumour.chip;
const quiet = () => {};

/** The first (run seed, floor) from floor 2 whose floor rolled a Goldling. */
function findGoldenFloor(): [number, number] {
	for (let seed = 1; seed <= 60; seed++) {
		const setup = buildEndlessRunConfig(seed);
		for (let floor = 2; floor <= 4; floor++)
			if (setup.endlessFloor(floor).golden !== undefined) return [seed, floor];
	}
	error("no Goldling floor in run seeds 1-60, floors 2-4", 0);
}

const [SEED, FLOOR] = findGoldenFloor();

function devRun(): { config: SimConfig; s: SimState } {
	const dev = buildDevRunConfig(SEED, { startFloor: FLOOR, invulnerable: true });
	return { config: dev.config, s: createSimState(SEED, dev.spawn!.x, dev.spawn!.z, dev.config) };
}

describe("Goldling rumour chip: lines and look (GR7)", () => {
	it("its two lines are the theme's required strings, in the placeholder's English; nothing for NONE", () => {
		expect([GOLDEN_RUMOUR_STRINGS.floor, GOLDEN_RUMOUR_STRINGS.room]).toEqual([...GOLDEN_RUMOUR_STRING_KEYS]);
		expect(GOLDEN_RUMOUR_STRINGS.card).toBe(GOLDEN_RUMOUR_BESTIARY_KEY);
		expect(goldenRumourChipKey(GoldenRumourPhase.NONE)).toBe(undefined);
		expect(goldenRumourChipKey(GoldenRumourPhase.FLOOR)).toBe("hud.chip.golden.rumour");
		expect(goldenRumourChipKey(GoldenRumourPhase.ROOM)).toBe("hud.chip.golden.hiding");
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const str = (k: string) => pack.str(k);
		expect(goldenRumourChipText(str, GoldenRumourPhase.FLOOR)).toBe("Coins jingling...");
		expect(goldenRumourChipText(str, GoldenRumourPhase.ROOM)).toBe("It's hiding here!");
		expect(goldenRumourChipText(str, GoldenRumourPhase.NONE)).toBe("");
		expect(pack.str(GOLDEN_RUMOUR_BESTIARY_KEY)).toBe(
			"Hear coins? A Goldling is hiding in a barrel or crate on this floor. Find it!",
		);
		// the coin glyph's colour role, on the HUD's dark panel
		expect([C.role, C.fillRole]).toEqual(["golden.coin", "uiPanel"]);
	});

	it("pulses gently in ROOM only (1 .. 1 + pulseAmp over pulseSec); still in FLOOR and under reduced motion", () => {
		expect([C.pulseSec, C.pulseAmp]).toEqual([0.8, 0.08]);
		expect(goldenRumourChipScale(0, GoldenRumourPhase.ROOM, 1)).toBe(1);
		expect(goldenRumourChipScale(C.pulseSec / 2, GoldenRumourPhase.ROOM, 1)).toBeCloseTo(1 + C.pulseAmp, 9);
		expect(goldenRumourChipScale(C.pulseSec, GoldenRumourPhase.ROOM, 1)).toBeCloseTo(1, 9);
		for (let k = 0; k <= 20; k++) {
			const t = (k / 20) * 2 * C.pulseSec;
			const v = goldenRumourChipScale(t, GoldenRumourPhase.ROOM, 1);
			expect(v >= 1 - 1e-9 && v <= 1 + C.pulseAmp + 1e-9).toBe(true);
			expect(goldenRumourChipScale(t, GoldenRumourPhase.FLOOR, 1)).toBe(1);
			expect(goldenRumourChipScale(t, GoldenRumourPhase.NONE, 1)).toBe(1);
			expect(goldenRumourChipScale(t, GoldenRumourPhase.ROOM, 0)).toBe(1);
		}
	});

	it("shares the status corner's boost row: one chip as the Horde chip alone, two split it, none 0", () => {
		const row = 300;
		const cell = 40;
		const gap = 6;
		expect(chipRowWidth(row, cell, gap, 1)).toBe(hordeChipWidth(row, cell, gap));
		const two = chipRowWidth(row, cell, gap, 2);
		expect(2 * two + gap).toBe(hordeChipWidth(row, cell, gap));
		expect(chipRowWidth(row, cell, gap, 0)).toBe(0);
		expect(chipRowWidth(10, cell, gap, 2)).toBe(0);
		expect([C.touchWidth > 0, C.touchTextSize <= C.textSize]).toEqual([true, true]);
	});
});

describe("Goldling rumour chip: the snapshot (GR7)", () => {
	it("carries the client clock's chip (NONE by default) and tells snapshots apart by it", () => {
		const r = devRun();
		const base = { paused: false, outcome: "playing" as const, recordedTicks: 0 };
		expect(EMPTY_SNAPSHOT.goldenRumour).toBe(GoldenRumourPhase.NONE);
		const none = takeSnapshot(r.s, base);
		expect(none.goldenRumour).toBe(GoldenRumourPhase.NONE);
		const c = new GoldenRumourClock();
		for (let k = 0; k < 4; k++) c.step(r.s, GOLDEN_VIEW.rumour.floorDelaySec / 4);
		const floor = takeSnapshot(r.s, { ...base, goldenRumour: c.chip() });
		expect(floor.goldenRumour).toBe(GoldenRumourPhase.FLOOR);
		expect(snapshotsEqual(none, floor)).toBe(false);
		expect(snapshotsEqual(floor, takeSnapshot(r.s, { ...base, goldenRumour: GoldenRumourPhase.FLOOR }))).toBe(true);
	});
});

describe("Goldling rumour: the first-time card (GR7, RD7)", () => {
	it("is SIGHTING_IDS' last id but the secret crack's, its line bestiary.golden.rumour", () => {
		expect(GOLDEN_RUMOUR_SIGHTING).toBe("golden.rumour");
		// docs/SECRET_ROOMS.md SR10 appended `secret.crack` after it (withSecretSighting runs after withRumourSighting)
		expect(SIGHTING_IDS[SIGHTING_IDS.size() - 2]).toBe(GOLDEN_RUMOUR_SIGHTING);
		expect(SIGHTING_IDS[SIGHTING_IDS.size() - 1]).toBe("secret.crack");
		expect(sightingStringKey(GOLDEN_RUMOUR_SIGHTING)).toBe(GOLDEN_RUMOUR_BESTIARY_KEY);
	});

	it("found once heard (this floor's first rumour cue), once in the list, canonical order kept", () => {
		expect(withRumourSighting([], false)).toEqual([]);
		expect(withRumourSighting([], true)).toEqual([GOLDEN_RUMOUR_SIGHTING]);
		expect(withRumourSighting(["golden", GOLDEN_RUMOUR_SIGHTING], true)).toEqual([
			"golden",
			GOLDEN_RUMOUR_SIGHTING,
		]);
		expect(withRumourSighting(["imp", "golden"], true)).toEqual(["imp", "golden", GOLDEN_RUMOUR_SIGHTING]);
		// the clock's heard() over a real floor: false before the floor cue, true from it on
		const r = devRun();
		const c = new GoldenRumourClock();
		c.step(r.s, GOLDEN_VIEW.rumour.floorDelaySec / 2);
		expect(c.heard()).toBe(false);
		c.step(r.s, GOLDEN_VIEW.rumour.floorDelaySec / 2);
		expect([c.floorCue, c.heard()]).toEqual([true, true]);
	});

	it("one card at a time: never on top of the Goldling's own; once per account", () => {
		const q = new SightingQueue();
		q.receive({ loaded: true, tutorialDone: true, seen: [] });
		// the Goldling's card is showing when the rumour is heard: the rumour's waits for it and its gap
		q.observe(["golden"]);
		expect(q.next(0, true)).toBe("golden");
		q.observe(withRumourSighting([], true));
		expect(q.next(1, true)).toBe(undefined);
		const after = SIGHTING_VIEW.toastSeconds + SIGHTING_VIEW.gapSeconds;
		expect(q.next(after, true)).toBe(GOLDEN_RUMOUR_SIGHTING);
		// seen from now on: never again (the account's set)
		q.observe(withRumourSighting([], true));
		expect(q.next(100, true)).toBe(undefined);
		const veteran = new SightingQueue();
		veteran.receive({ loaded: true, tutorialDone: true, seen: [GOLDEN_RUMOUR_SIGHTING] });
		veteran.observe(withRumourSighting([], true));
		expect(veteran.next(0, true)).toBe(undefined);
	});
});

describe("Goldling rumour: KV_GoldenLabel (GR7)", () => {
	it("while it hides: room, piece slot, rumour phase FLOOR then ROOM, release -1; then the release tick", () => {
		const r = devRun();
		const g = r.s.golden!;
		expect(goldenDebugText(r.s)).toBe(`WAITING room ${g.room} piece ${g.piece} rumour FLOOR release -1`);
		const f = g.floor!;
		let lx = math.floor(f.w / 2);
		const ly = math.floor(f.h / 2);
		while (f.walk[ly * f.w + lx] !== 1) lx = (lx + 1) % f.w;
		const p = r.s.player;
		p.x = gridToWorld(f.x0 + lx);
		p.z = gridToWorld(f.y0 + ly);
		p.prevX = p.x;
		p.prevZ = p.z;
		step(r.s, EMPTY_INPUT, r.config);
		expect(goldenDebugText(r.s)).toBe(`WAITING room ${g.room} piece ${g.piece} rumour ROOM release -1`);
		const at = r.s.tick;
		damageBreakable(r.s, g.piece, r.s.breakables!.pieces[g.piece].hp, BreakableSource.MELEE, 0);
		step(r.s, EMPTY_INPUT, r.config);
		expect(g.releaseTick).toBe(at);
		expect(goldenDebugText(r.s)!.sub(1, 7)).toBe("RUNNING");
		for (let k = 0; k < g.config.escapeTicks + 2; k++) step(r.s, EMPTY_INPUT, r.config);
		expect(goldenDebugText(r.s)).toBe(`ESCAPED coins ${g.coins} release ${at}`);
	});
});
