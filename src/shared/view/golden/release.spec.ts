// The Goldling's hiding place on screen (docs/GOLDLING_RUMOURS.md GR4, RD14): its barrel or crate glints exactly like a
// loaded piece (the one test pieceGlints, the same slots scan, the same per-cell phase and cadence) while it hides,
// never after its break, never without the Goldling's config; the release: the piece breaks, the Goldling comes out at
// the piece's cell centre on that tick, and the coin flash and GOLDLING! wait afterBreakSec of sim time
// (GoldenAppearQueue) so the break reads first.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import { buildDevRunConfig, buildEndlessRunConfig } from "shared/run";
import {
	BreakableSource,
	EMPTY_INPUT,
	ENDLESS_GOLDEN_CONFIG,
	GoldenStatus,
	NO_BOOST,
	SIM_HZ,
	breakableLootAt,
	createSimState,
	damageBreakable,
	goldenPieceAt,
	goldenPieceCentre,
	step,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { glintSlotCount, LOOT_GLINT_HIDDEN, lootGlintFrame, lootGlintPhaseSec, pieceGlints } from "../breakableLoot";
import { BREAKABLE_LOOT_VIEW } from "../breakableLootConfig";
import { GOLDEN_VIEW, GoldenAppearQueue, GoldenFrameEvents } from ".";

/** The first (run seed, floor) from floor 2 whose floor rolled a Goldling (the sim spec's search). */
function findGoldenFloor(): [number, number] {
	for (let seed = 1; seed <= 60; seed++) {
		const setup = buildEndlessRunConfig(seed);
		for (let floor = 2; floor <= 4; floor++)
			if (setup.endlessFloor(floor).golden !== undefined) return [seed, floor];
	}
	error("no Goldling floor in run seeds 1-60, floors 2-4", 0);
}

const [SEED, FLOOR] = findGoldenFloor();

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
	readonly ev: GoldenFrameEvents;
}

/** A god-mode dev run of SEED from FLOOR, with the Goldling config on (the dev world's) or off. */
function devRun(golden = true): Run {
	const dev = buildDevRunConfig(SEED, { startFloor: FLOOR, invulnerable: true });
	const config: SimConfig = { ...dev.config, golden: golden ? ENDLESS_GOLDEN_CONFIG : undefined };
	return { config, s: createSimState(SEED, dev.spawn!.x, dev.spawn!.z, config), ev: new GoldenFrameEvents() };
}

function tick(r: Run): void {
	r.ev.reset();
	step(r.s, EMPTY_INPUT, r.config);
	r.ev.collect(r.s);
}

/** The floor's Goldling piece slot (FloorGolden.piece, from the world: also without the config). */
function pieceSlot(): number {
	return buildEndlessRunConfig(SEED).endlessFloor(FLOOR).golden!.piece;
}

/** The loaded pieces of the floor (their slots), in slot order. */
function loadedSlots(s: SimState): number[] {
	const out: number[] = [];
	const n = s.breakables!.pieces.size();
	for (let k = 0; k < n; k++) if (breakableLootAt(s, k) !== NO_BOOST) out.push(k);
	return out;
}

describe("Goldling hiding place: the glint (GR4, RD14)", () => {
	it("glints while it hides: pieceGlints on its slot, which glintSlotCount scans; no boost in it", () => {
		const r = devRun();
		const g = r.s.golden!;
		const slot = g.piece;
		expect(slot).toBe(pieceSlot());
		expect([g.status, goldenPieceAt(r.s, slot), breakableLootAt(r.s, slot)]).toEqual([
			GoldenStatus.WAITING,
			true,
			NO_BOOST,
		]);
		expect(pieceGlints(r.s, slot)).toBe(true);
		expect(glintSlotCount(r.s) >= slot + 1).toBe(true);
		// exactly the loaded pieces and the hiding place glint
		const want = [...loadedSlots(r.s), slot];
		const got: number[] = [];
		for (let k = 0; k < r.s.breakables!.pieces.size(); k++) if (pieceGlints(r.s, k)) got.push(k);
		expect(got).toEqual(want);
		for (let k = 0; k < 120; k++) tick(r);
		expect(pieceGlints(r.s, slot)).toBe(true);
	});

	it("looks exactly like a loaded piece: its phase is its cell's (lootGlintPhaseSec), one pass per cycle", () => {
		const r = devRun();
		const p = r.s.breakables!.pieces[r.s.golden!.piece];
		const phase = lootGlintPhaseSec(p.x, p.y);
		const V = BREAKABLE_LOOT_VIEW;
		expect(phase >= 0 && phase < V.glintEverySeconds).toBe(true);
		// one cycle sampled at 60 Hz: shown for one pass, hidden for the rest, like any loaded piece's
		let shown = 0;
		const samples = math.floor(V.glintEverySeconds * SIM_HZ);
		for (let k = 0; k < samples; k++) if (lootGlintFrame(k / SIM_HZ, phase, 0, 1, 1) !== LOOT_GLINT_HIDDEN) shown++;
		const pass = V.glintFlashSeconds * SIM_HZ;
		expect(math.abs(shown - pass) <= 1).toBe(true);
		// reduced motion: the still sparkle, always shown
		expect(lootGlintFrame(0.37, phase, 0, 1, 0)).toBe(V.glintStillFrame % 1);
	});

	it("stops at the break: the piece broken, the Goldling out, no glint; the loaded pieces keep theirs", () => {
		const r = devRun();
		const g = r.s.golden!;
		const slot = g.piece;
		const loaded = loadedSlots(r.s);
		expect(damageBreakable(r.s, slot, r.s.breakables!.pieces[slot].hp, BreakableSource.MELEE, 0)).toBe(true);
		// broken this tick: no longer its intact piece, already no glint before the step
		expect([goldenPieceAt(r.s, slot), pieceGlints(r.s, slot)]).toEqual([false, false]);
		tick(r);
		expect(g.status).toBe(GoldenStatus.RUNNING);
		expect(pieceGlints(r.s, slot)).toBe(false);
		expect(glintSlotCount(r.s)).toBe(r.s.drops?.pieceLoot.size() ?? 0);
		for (const k of loaded) expect(pieceGlints(r.s, k)).toBe(true);
	});

	it("no Goldling config: its piece is an ordinary piece, no glint", () => {
		const r = devRun(false);
		const slot = pieceSlot();
		expect(r.s.golden).toBe(undefined);
		expect([goldenPieceAt(r.s, slot), pieceGlints(r.s, slot)]).toEqual([false, false]);
		expect(glintSlotCount(r.s)).toBe(r.s.drops?.pieceLoot.size() ?? 0);
	});
});

describe("Goldling hiding place: the release beat (GR4)", () => {
	it("the break, then the coins: out at the piece's cell centre on the break tick; the flash waits afterBreakSec", () => {
		const r = devRun();
		const g = r.s.golden!;
		const slot = g.piece;
		const at = r.s.tick;
		damageBreakable(r.s, slot, r.s.breakables!.pieces[slot].hp, BreakableSource.MELEE, 0);
		tick(r);
		const piece = r.s.breakables!.pieces[slot];
		expect(piece.brokenTick).toBe(at);
		expect(r.ev.appeared.size()).toBe(1);
		const ap = r.ev.appeared[0];
		const c = goldenPieceCentre(g)!;
		expect([ap.x, ap.z]).toEqual([c.x, c.z]);
		expect([ap.x, ap.z]).toEqual([gridToWorld(piece.x), gridToWorld(piece.y)]);
		expect(ap.tick).toBe(at + 1);

		const q = new GoldenAppearQueue();
		q.push(r.ev.appeared);
		const t0 = ap.tick / SIM_HZ;
		const wait = GOLDEN_VIEW.appear.afterBreakSec;
		expect(wait > 0 && wait < 0.5).toBe(true);
		expect(q.due(t0).size()).toBe(0);
		expect(q.due(t0 + wait / 2).size()).toBe(0);
		const due = q.due(t0 + wait);
		expect(due.size()).toBe(1);
		expect(due[0]).toBe(ap);
		// once each
		expect(q.due(t0 + 10).size()).toBe(0);
		expect(q.size()).toBe(0);
	});

	it("holds with sim time and keeps order; clear drops what waits", () => {
		const q = new GoldenAppearQueue();
		const a = { x: 1, z: 2, actorId: 5, tick: 60 };
		const b = { x: 3, z: 4, actorId: 6, tick: 66 };
		q.push([a, b]);
		const wait = GOLDEN_VIEW.appear.afterBreakSec;
		expect(q.due(1 + wait)).toEqual([a]);
		expect(q.due(1 + wait)).toEqual([]);
		expect(q.due(66 / SIM_HZ + wait)).toEqual([b]);
		q.push([a]);
		q.clear();
		expect(q.size()).toBe(0);
		expect(q.due(1000).size()).toBe(0);
	});
});
