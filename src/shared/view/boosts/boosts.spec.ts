// Boost drops on screen (docs/BOOSTS.md B6 / B7): the theme / sim cross-check (BOOST_KINDS[i] is BOOSTS[i]), the
// readability caps (the aura under the bullets' plane, the drop's art cap), the drop's look (bob, pop, the fade blink,
// reduced motion), the slot diff, the per-frame event collection over several ticks, the HUD's quantised entries, the
// aura's discs and the tutorial highlight id.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
import {
	BOOSTS,
	BOOST_COUNT,
	BULLET_Y,
	Boost,
	DEBUG_DROP_BUTTON,
	DEFAULT_SIM_CONFIG,
	DROPS_CONFIG,
	EMPTY_INPUT,
	NO_BOOST,
	SIM_HZ,
	boostTicks,
	createSimState,
	dropsGround,
	playerAt,
	step,
	type SimConfig,
	type SimState,
} from "shared/sim";
import {
	BOOST_KINDS,
	PLACEHOLDER_MANIFEST,
	PLACEHOLDER_PROPORTIONS,
	ThemePack,
	boostId,
	boostStringKey,
} from "shared/theme";
import { BULLET_VIEW } from "../config";
import {
	BOOST_VIEW,
	BoostFrameEvents,
	DropSlotTracker,
	NOT_ON_GROUND,
	auraDisc,
	auraTopStuds,
	auraTransparency,
	boostBlinkTransparency,
	boostColorRole,
	boostEntriesEqual,
	boostHudEntries,
	boostHudEntry,
	boostIconArtId,
	boostIconKey,
	boostKindName,
	dropAgeSec,
	dropBobStuds,
	dropPopScale,
	dropSecondsLeft,
	isBoostsHighlight,
	pieceLandingAt,
} from ".";

const CONFIG: SimConfig = { ...DEFAULT_SIM_CONFIG, drops: DROPS_CONFIG };
const PRESS = { ...EMPTY_INPUT, buttons: DEBUG_DROP_BUTTON };

function fresh(): SimState {
	return createSimState(1, 0, 0, CONFIG);
}

/** Steps one tick with `input`. */
function tick(s: SimState, input = EMPTY_INPUT): void {
	step(s, input, CONFIG);
}

/** Puts the player on slot `slot`'s drop (it is taken on the next tick). */
function standOn(s: SimState, slot: number): void {
	const g = dropsGround(s)[slot];
	const p = playerAt(s, 0);
	p.x = g.x;
	p.z = g.z;
	p.prevX = g.x;
	p.prevZ = g.z;
}

describe("boosts: theme and sim agree", () => {
	it("BOOST_KINDS[i] is BOOSTS[i] (`boost.<kind>`) for every i, same length, in the sim's Boost order", () => {
		expect(BOOST_KINDS.size()).toBe(BOOSTS.size());
		expect(BOOST_COUNT).toBe(BOOSTS.size());
		for (let i = 0; i < BOOSTS.size(); i++) {
			expect([i, boostId(BOOST_KINDS[i])]).toEqual([i, BOOSTS[i].id]);
			expect([i, boostKindName(i)]).toEqual([i, BOOST_KINDS[i]]);
		}
		expect([Boost.FURY, Boost.QUICKSTEP, Boost.FRENZY, Boost.AEGIS].map((k) => BOOST_KINDS[k])).toEqual([
			"fury",
			"quickstep",
			"frenzy",
			"aegis",
		]);
		expect(boostKindName(NO_BOOST)).toBe(undefined);
		expect(boostKindName(BOOST_COUNT)).toBe(undefined);
	});

	it("every kind's colour role, icon and toast strings exist in the placeholder pack", () => {
		const warnings: string[] = [];
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
		for (let k = 0; k < BOOST_COUNT; k++) {
			expect(boostColorRole(k)).toBe(boostId(BOOST_KINDS[k]));
			expect(pack.hasString(boostIconKey(k))).toBe(true);
			pack.color(boostColorRole(k));
		}
		expect(pack.str("hud.toast.boost", { name: pack.str(boostStringKey("fury", "name")), desc: "x" })).toBe(
			"Fury: x",
		);
		expect(warnings).toEqual([]);
	});

	it("every kind's icon art id is ui.boost.<kind> (the placeholder has none: the boost row keeps its labels)", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		for (let k = 0; k < BOOST_COUNT; k++) {
			expect(boostIconArtId(k)).toBe(`ui.boost.${BOOST_KINDS[k]}`);
			expect(pack.image(boostIconArtId(k))).toBe(undefined);
		}
		expect(boostIconArtId(BOOST_COUNT)).toBe("ui.boost.fury");
	});
});

describe("boosts: readability caps", () => {
	it("the aura's whole stack stays under auraMaxHeightTiles, itself under the lowest bullet", () => {
		const capStuds = BOOST_VIEW.auraMaxHeightTiles * STUDS_PER_TILE;
		expect(BOOST_VIEW.auraMaxHeightTiles < BULLET_Y - BULLET_VIEW.enemyDrawRadius).toBe(true);
		for (let n = 1; n <= BOOST_COUNT + 4; n++) expect([n, auraTopStuds(n) <= capStuds + 1e-9]).toEqual([n, true]);
		expect(auraTopStuds(BOOST_COUNT) > 0).toBe(true);
	});

	it("the drop's art cap is the placeholder gem's height (the breakables' 5/8 tile)", () => {
		expect(BOOST_VIEW.maxHeightTiles).toBe(PLACEHOLDER_PROPORTIONS.boost[1]);
		expect(BOOST_VIEW.blinkSeconds < DROPS_CONFIG.groundTicks / SIM_HZ).toBe(true);
	});
});

describe("boosts: the drop's look", () => {
	it("age and seconds left come from state (spawnTick, ticksLeft), never negative", () => {
		expect(dropAgeSec(10, 0, 10)).toBe(0);
		expect(dropAgeSec(10 + SIM_HZ, 0.5, 10)).toBe(1 + 0.5 / SIM_HZ);
		expect(dropAgeSec(5, 0, 10)).toBe(0);
		expect(dropSecondsLeft(SIM_HZ * 2)).toBe(2);
		expect(dropSecondsLeft(-3)).toBe(0);
	});

	it("bobs between the rest height and bobStuds above it; still under reduced motion", () => {
		const half = 1 / (2 * BOOST_VIEW.bobHz);
		expect(dropBobStuds(0, 1)).toBe(0);
		expect(dropBobStuds(half, 1)).toBeCloseTo(BOOST_VIEW.bobStuds, 9);
		for (let t = 0; t < 3; t += 0.05) {
			const b = dropBobStuds(t, 1);
			expect(b >= 0 && b <= BOOST_VIEW.bobStuds + 1e-9).toBe(true);
			expect(dropBobStuds(t, 0)).toBe(0);
		}
	});

	it("pops from popFromScale up to full size, never past it; none under reduced motion", () => {
		expect(dropPopScale(0, 1)).toBe(BOOST_VIEW.popFromScale);
		expect(dropPopScale(BOOST_VIEW.popSeconds, 1)).toBe(1);
		expect(dropPopScale(10, 1)).toBe(1);
		expect(dropPopScale(0, 0)).toBe(1);
		let last = 0;
		for (let t = 0; t < BOOST_VIEW.popSeconds; t += 0.01) {
			const s = dropPopScale(t, 1);
			expect(s >= last && s <= 1).toBe(true);
			last = s;
		}
	});

	it("blinks only in the last blinkSeconds, alternating every blinkPeriodSec; steady dim under reduced motion", () => {
		const v = BOOST_VIEW;
		expect(boostBlinkTransparency(v.blinkSeconds, 1)).toBe(0);
		expect(boostBlinkTransparency(10, 1)).toBe(0);
		expect(boostBlinkTransparency(0, 1)).toBe(0);
		expect(boostBlinkTransparency(v.blinkPeriodSec * 0.5, 1)).toBe(0); // the last period is opaque
		expect(boostBlinkTransparency(v.blinkPeriodSec * 1.5, 1)).toBe(v.blinkTransparency);
		expect(boostBlinkTransparency(v.blinkPeriodSec * 2.5, 1)).toBe(0);
		let on = 0;
		let off = 0;
		for (let t = 0.01; t < v.blinkSeconds; t += 0.01) {
			if (boostBlinkTransparency(t, 1) > 0) on++;
			else off++;
			expect(boostBlinkTransparency(t, 0)).toBe(v.reducedBlinkTransparency);
		}
		expect(on > 0 && off > 0).toBe(true);
	});
});

describe("boosts: DropSlotTracker", () => {
	it("a debug drop lands, stays, is taken (cleared); a reset or a restart re-lands what is there", () => {
		const s = fresh();
		const t = new DropSlotTracker();
		t.update(dropsGround(s), s.tick);
		expect([[...t.landed], [...t.cleared]]).toEqual([[], []]);
		tick(s, PRESS);
		t.update(dropsGround(s), s.tick);
		expect([[...t.landed], [...t.cleared], t.kindAt(0)]).toEqual([[0], [], Boost.FURY]);
		tick(s);
		t.update(dropsGround(s), s.tick);
		expect([[...t.landed], [...t.cleared]]).toEqual([[], []]);
		t.reset();
		t.update(dropsGround(s), s.tick);
		expect([[...t.landed], [...t.cleared]]).toEqual([[0], [0]]);
		standOn(s, 0);
		tick(s);
		t.update(dropsGround(s), s.tick);
		expect([[...t.landed], [...t.cleared], t.kindAt(0)]).toEqual([[], [0], NO_BOOST]);
		// the tick going back (a restart) is a new layout
		const r = fresh();
		tick(r, PRESS);
		t.update(dropsGround(r), r.tick);
		expect([[...t.landed], [...t.cleared]]).toEqual([[0], []]);
	});

	it("a slot freed and refilled between two frames reads as cleared and landed", () => {
		const s = fresh();
		const t = new DropSlotTracker();
		tick(s, PRESS);
		t.update(dropsGround(s), s.tick);
		standOn(s, 0);
		tick(s); // taken
		tick(s, PRESS); // the next kind lands in slot 0 again, 1.5 tiles ahead (out of reach)
		t.update(dropsGround(s), s.tick);
		expect([[...t.landed], [...t.cleared], t.kindAt(0)]).toEqual([[0], [0], Boost.QUICKSTEP]);
	});
});

describe("boosts: BoostFrameEvents (every tick of a frame)", () => {
	it("collects landings, pickups and ends across ticks; reset clears them", () => {
		const s = fresh();
		const e = new BoostFrameEvents();
		tick(s, PRESS);
		e.collect(s);
		const gx = dropsGround(s)[0].x;
		const gz = dropsGround(s)[0].z;
		standOn(s, 0);
		tick(s);
		e.collect(s);
		expect(e.dropped).toEqual([{ slot: 0, kind: Boost.FURY, x: gx, z: gz }]);
		expect(e.collected).toEqual([{ player: 0, kind: Boost.FURY, slot: 0, x: gx, z: gz }]);
		expect(e.count()).toBe(2);
		// the per-tick events are gone after the next tick; the frame's copy keeps them until reset
		tick(s);
		e.collect(s);
		expect(e.count()).toBe(2);
		e.reset();
		expect(e.count()).toBe(0);
		// the boost runs out: one `ended`
		for (let i = 0; i < boostTicks(Boost.FURY); i++) {
			tick(s);
			e.collect(s);
		}
		expect(e.ended).toEqual([{ player: 0, kind: Boost.FURY }]);
	});

	it("a drop taken on its landing tick still reports its landing (from the pickup); one freed unseen is skipped", () => {
		const s = fresh();
		const d = s.drops!;
		d.events.dropped.push(0, 1);
		d.events.collected.push({ player: 0, kind: Boost.AEGIS, slot: 0, x: 3, z: 4 });
		const e = new BoostFrameEvents();
		e.collect(s);
		expect(e.dropped).toEqual([{ slot: 0, kind: Boost.AEGIS, x: 3, z: 4 }]);
		const none = new BoostFrameEvents();
		none.collect(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG));
		expect(none.count()).toBe(0);
	});
});

describe("boosts: BoostFrameEvents from breakables (docs/BREAKABLE_DROPS.md BL6)", () => {
	/** Lands `kind` in ground slot `slot` at (x, z) on this tick, as the sim's land() does. */
	function landAt(s: SimState, slot: number, kind: number, x: number, z: number): void {
		const g = s.drops!.ground[slot];
		g.kind = kind;
		g.x = x;
		g.z = z;
		g.spawnTick = s.tick;
		g.ticksLeft = DROPS_CONFIG.groundTicks;
	}

	it("a piece's landing is in dropped AND fromPiece (with its landing tick); a kill's only in dropped", () => {
		const s = fresh();
		s.tick = 40;
		const d = s.drops!;
		landAt(s, 0, Boost.FURY, 1, 2); // a kill drop
		landAt(s, 1, Boost.FRENZY, 5.5, 6.5); // out of a piece
		d.events.dropped.push(0, 1);
		d.events.fromPiece.push(1);
		const e = new BoostFrameEvents();
		e.collect(s);
		expect(e.dropped).toEqual([
			{ slot: 0, kind: Boost.FURY, x: 1, z: 2 },
			{ slot: 1, kind: Boost.FRENZY, x: 5.5, z: 6.5 },
		]);
		expect(e.fromPiece).toEqual([{ slot: 1, kind: Boost.FRENZY, x: 5.5, z: 6.5, spawnTick: 40 }]);
		// a piece's landing counts once (as a landing)
		expect(e.count()).toBe(2);
		expect(pieceLandingAt(e, 1, 40)).toEqual(e.fromPiece[0]);
		expect(pieceLandingAt(e, 0, 40)).toBe(undefined);
		// the slot refilled later (another tick) is not the piece's drop
		expect(pieceLandingAt(e, 1, 41)).toBe(undefined);
		e.reset();
		expect([e.count(), e.fromPiece.size(), e.lostLoot.size()]).toEqual([0, 0, 0]);
	});

	it("taken on its landing tick: still a piece landing, NOT_ON_GROUND; freed unseen: in neither list", () => {
		const s = fresh();
		const d = s.drops!;
		d.events.dropped.push(2, 3);
		d.events.fromPiece.push(2, 3);
		d.events.collected.push({ player: 0, kind: Boost.AEGIS, slot: 2, x: 3, z: 4 });
		const e = new BoostFrameEvents();
		e.collect(s);
		expect(e.dropped).toEqual([{ slot: 2, kind: Boost.AEGIS, x: 3, z: 4 }]);
		expect(e.fromPiece).toEqual([{ slot: 2, kind: Boost.AEGIS, x: 3, z: 4, spawnTick: NOT_ON_GROUND }]);
		expect(pieceLandingAt(e, 3, s.tick)).toBe(undefined);
	});

	it("collects lost loot (a copy) across ticks; it counts as an event", () => {
		const s = fresh();
		const d = s.drops!;
		const lost = { kind: Boost.QUICKSTEP, x: 7.5, z: 8.5 };
		d.events.lostLoot.push(lost);
		const e = new BoostFrameEvents();
		e.collect(s);
		tick(s); // the sim clears its per-tick events; the frame's copy keeps them
		e.collect(s);
		expect(e.lostLoot).toEqual([lost]);
		expect(e.lostLoot[0] === lost).toBe(false);
		expect([e.count(), e.dropped.size(), e.fromPiece.size()]).toEqual([1, 0, 0]);
		const none = new BoostFrameEvents();
		none.collect(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG));
		expect([none.fromPiece.size(), none.lostLoot.size()]).toEqual([0, 0]);
	});
});

describe("boosts: HUD entries", () => {
	it("rounds seconds up to tenths and draws the bar in the same steps", () => {
		const full = boostTicks(Boost.FURY);
		const ticksPerQuantum = SIM_HZ / BOOST_VIEW.secondsQuantum;
		const q = full / ticksPerQuantum; // tenths in a full boost (300 for Fury's 30 s)
		expect(boostHudEntry({ kind: 0, ticksLeft: full, totalTicks: full })).toEqual({
			kind: 0,
			secondsLeft: q / BOOST_VIEW.secondsQuantum,
			fraction: 1,
		});
		expect(boostHudEntry({ kind: 0, ticksLeft: full - 1, totalTicks: full }).secondsLeft).toBe(
			q / BOOST_VIEW.secondsQuantum,
		);
		const e = boostHudEntry({ kind: 0, ticksLeft: full - ticksPerQuantum, totalTicks: full });
		expect([e.secondsLeft, e.fraction]).toEqual([(q - 1) / BOOST_VIEW.secondsQuantum, (q - 1) / q]);
		expect(boostHudEntry({ kind: 0, ticksLeft: 1, totalTicks: full }).secondsLeft).toBe(0.1);
		// every tick of a boost: one value per tenth, so the HUD re-renders at most 10 times a second
		const seen = new Set<number>();
		for (let t = 1; t <= full; t++)
			seen.add(boostHudEntry({ kind: 0, ticksLeft: t, totalTicks: full }).secondsLeft);
		expect(seen.size()).toBe(full / (SIM_HZ / BOOST_VIEW.secondsQuantum));
	});

	it("reads a player's running boosts in Boost order; empty without drops; compares element-wise", () => {
		expect(boostHudEntries(createSimState(1, 0, 0, DEFAULT_SIM_CONFIG), 0).size()).toBe(0);
		const s = fresh();
		const bp = s.drops!.players[0];
		bp.ticks[Boost.AEGIS] = boostTicks(Boost.AEGIS);
		bp.ticks[Boost.FURY] = SIM_HZ;
		const a = boostHudEntries(s, 0);
		expect(a.map((x) => x.kind)).toEqual([Boost.FURY, Boost.AEGIS]);
		expect(a[1].fraction).toBe(1);
		expect(boostEntriesEqual(a, boostHudEntries(s, 0))).toBe(true);
		bp.ticks[Boost.FURY] -= 1; // same tenth: equal
		expect(boostEntriesEqual(a, boostHudEntries(s, 0))).toBe(true);
		bp.ticks[Boost.FURY] -= SIM_HZ / BOOST_VIEW.secondsQuantum;
		expect(boostEntriesEqual(a, boostHudEntries(s, 0))).toBe(false);
		expect(boostEntriesEqual(a, [a[0]])).toBe(false);
	});

	it("the boost row's highlight id is `boosts`", () => {
		expect(isBoostsHighlight("boosts")).toBe(true);
		expect(isBoostsHighlight("hearts")).toBe(false);
		expect(isBoostsHighlight(undefined)).toBe(false);
	});
});

describe("boosts: the aura", () => {
	it("discs widen outward and the first running kind sits on top; one disc is the base size", () => {
		const one = auraDisc(0, 1);
		expect(one.radiusTiles).toBe(BOOST_VIEW.auraRadiusTiles);
		for (let n = 2; n <= BOOST_COUNT; n++) {
			for (let r = 1; r < n; r++) {
				const inner = auraDisc(r - 1, n);
				const outer = auraDisc(r, n);
				expect(outer.radiusTiles > inner.radiusTiles).toBe(true);
				expect(outer.liftStuds < inner.liftStuds).toBe(true);
			}
		}
	});

	it("pulses around auraTransparency, steady under reduced motion", () => {
		const v = BOOST_VIEW;
		expect(auraTransparency(1.234, 0)).toBe(v.auraTransparency);
		for (let t = 0; t < 2; t += 0.07) {
			const a = auraTransparency(t, 1);
			expect(a >= v.auraTransparency - v.auraPulseAmplitude - 1e-9).toBe(true);
			expect(a <= v.auraTransparency + v.auraPulseAmplitude + 1e-9).toBe(true);
			expect(a >= 0 && a < 1).toBe(true);
		}
	});
});
