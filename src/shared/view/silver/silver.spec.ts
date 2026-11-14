// Silver in crates on screen (docs/SILVER.md SC3): Silver pieces twinkle exactly like boost pieces (pieceGlints /
// glintSlotCount list the intact ones, drop them at the break; boost, Silver and Goldling pieces all answer the same
// one test, with the same per-cell phase), the frame's breaks collected per tick, and the crate burst planner
// (SilverCrateFx): the counter's gain from every break (a far co-op one included), the pops capped per frame without
// losing Silver, the coins' count, cap, hop, flight and determinism, none under reduced motion, the clink's step climbing
// for quick successive breaks and starting again after a gap.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import { buildEndlessRunConfig, endlessRunFloor } from "shared/run";
import {
	BREAKABLES_CONFIG,
	BreakableSource,
	EMPTY_INPUT,
	NO_BOOST,
	NO_SILVER,
	breakableLootAt,
	createSimState,
	damageBreakable,
	goldenPieceAt,
	silverPieceAt,
	step,
	stepParty,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { glintSlotCount, lootGlintPhaseSec, pieceGlints, silverDebugText } from "../breakableLoot";
import {
	SILVER_CRATE_FX,
	SilverCrateFx,
	SilverFrameEvents,
	silverClinkSemitones,
	silverClinkSpeed,
	silverCoinCount,
	silverCoinFlight,
	silverCoinHop,
	silverPopLook,
	type SilverBreakEvent,
} from ".";
import { semitonesToSpeed } from "../hud/comboConfig";

const V = SILVER_CRATE_FX;

/** A real endless run's state on floor 1 of `seed`. */
function endless(seed: number): { s: SimState; config: SimConfig } {
	const setup = buildEndlessRunConfig(seed);
	const spawn = setup.spawn!;
	return { s: createSimState(seed, spawn.x, spawn.z, setup.config), config: setup.config };
}

function brk(slot: number, amount: number, x = 0, z = 0, tick = 1): SilverBreakEvent {
	return { tick, slot, x, z, amount };
}

function source(...breaks: SilverBreakEvent[]): { breaks: SilverBreakEvent[] } {
	return { breaks };
}

describe("silver: the twinkle (SC3, OC8 / SVD21)", () => {
	it("every intact Silver piece glints (exactly the loot, Silver and hiding-Goldling slots), scanned by glintSlotCount", () => {
		let silverPieces = 0;
		for (let seed = 1; seed <= 6; seed++) {
			const { s } = endless(seed);
			const n = s.breakables!.pieces.size();
			expect(glintSlotCount(s)).toBe(n);
			for (let k = 0; k < n; k++) {
				const want =
					breakableLootAt(s, k) !== NO_BOOST || silverPieceAt(s, k) !== NO_SILVER || goldenPieceAt(s, k);
				expect(pieceGlints(s, k)).toBe(want);
				if (silverPieceAt(s, k) !== NO_SILVER) {
					silverPieces++;
					expect(breakableLootAt(s, k)).toBe(NO_BOOST); // never both (SVD16)
				}
			}
		}
		expect(silverPieces > 0).toBe(true);
	});

	it("stops at the break; the other glinting pieces keep theirs", () => {
		const { s } = endless(3);
		const first = endlessRunFloor(3, 1).breakableSilver!;
		expect(first.size() >= 2).toBe(true);
		const [a, b] = [first[0].slot, first[1].slot];
		expect([pieceGlints(s, a), pieceGlints(s, b)]).toEqual([true, true]);
		expect(damageBreakable(s, a, 100, BreakableSource.ENEMY_BULLET)).toBe(true);
		expect([pieceGlints(s, a), pieceGlints(s, b)]).toEqual([false, true]);
	});

	it("indistinguishable: the glint's phase reads the cell alone, so a Silver crate and a boost crate on a cell match", () => {
		const { s } = endless(2);
		const silverSlot = endlessRunFloor(2, 1).breakableSilver![0].slot;
		const p = s.breakables!.pieces[silverSlot];
		// The renderer's only per-piece inputs are pieceGlints (a boolean) and the cell (lootGlintPhaseSec).
		expect(pieceGlints(s, silverSlot)).toBe(true);
		expect(lootGlintPhaseSec(p.x, p.y)).toBe(lootGlintPhaseSec(p.x, p.y));
		const c = s.breakables!;
		const loot: SimConfig = {
			...endlessRunFloor(2, 1).config,
			breakables: {
				...BREAKABLES_CONFIG,
				pieces: [{ x: p.x, y: p.y, kind: c.pieces[silverSlot].kind === 1 ? "crate" : "barrel" }],
			},
			silver: { floor: [{ slot: 0, amount: 5 }] },
		};
		const t = createSimState(1, gridToWorld(p.x) + 3, gridToWorld(p.y), loot);
		expect(pieceGlints(t, 0)).toBe(true);
		expect(glintSlotCount(t)).toBe(1); // no drops state: the Silver table alone sets the scan
	});

	it("KV_SilverLabel's text and attribute", () => {
		expect(silverDebugText(7)).toBe("silver: 7");
		expect(V.labelAttribute).toBe("KV_SilverLabel");
	});
});

describe("silver: the frame's breaks", () => {
	it("collects every tick's breaks with the tick, copies them, resets per frame; no-op without state.silver", () => {
		const { s, config } = endless(3);
		const ev = new SilverFrameEvents();
		const silver = endlessRunFloor(3, 1).breakableSilver!;
		damageBreakable(s, silver[0].slot, 100, BreakableSource.MELEE);
		ev.collect(s);
		const p = s.breakables!.pieces[silver[0].slot];
		expect(ev.breaks).toEqual([
			{ tick: s.tick, slot: silver[0].slot, x: gridToWorld(p.x), z: gridToWorld(p.y), amount: silver[0].amount },
		]);
		step(s, EMPTY_INPUT, config); // the sim clears its list; ours is a copy
		expect(ev.breaks.size()).toBe(1);
		ev.collect(s);
		expect(ev.breaks.size()).toBe(1);
		ev.reset();
		expect(ev.breaks.size()).toBe(0);
		const off = createSimState(1, 0, 0, {});
		ev.collect(off);
		expect(ev.breaks.size()).toBe(0);
	});
});

describe("silver: the crate burst (SilverCrateFx)", () => {
	it("the pure parts: coins per stack, the clink's ladder, the pop's rise and fade, the hop, the flight", () => {
		expect([1, 2, 3, 4, 5, 6, 8, 9, 12, 13, 40].map(silverCoinCount)).toEqual([2, 2, 2, 2, 3, 3, 4, 5, 6, 6, 6]);
		expect(silverCoinCount(0)).toBe(0);
		expect([0, 1, 3, 6, 9, -2].map(silverClinkSemitones)).toEqual([0, 2, 6, 12, 12, 0]);
		expect(silverClinkSpeed(0)).toBe(1);
		expect(silverClinkSpeed(3)).toBe(semitonesToSpeed(6));
		const start = silverPopLook(0, 1);
		expect([start.alive, start.transparency, start.riseStuds]).toEqual([true, 0, V.popStartTiles]);
		const mid = silverPopLook(V.popSeconds * 0.5, 1);
		expect(mid.riseStuds > start.riseStuds && mid.transparency === 0).toBe(true);
		const late = silverPopLook(V.popSeconds * 0.95, 1);
		expect(late.transparency > 0 && late.transparency < 1 && late.riseStuds > mid.riseStuds).toBe(true);
		expect(silverPopLook(V.popSeconds, 1).alive).toBe(false);
		expect(silverPopLook(-0.1, 1).alive).toBe(false);
		const h = silverCoinHop(V.hopSeconds / 2, 1);
		expect([h.along, h.heightStuds, h.landed]).toEqual([0.5, V.hopTiles, false]);
		expect(silverCoinHop(V.hopSeconds, 1)).toEqual({ along: 1, heightStuds: 0, landed: true });
		expect(silverCoinFlight(V.hopSeconds, 0)).toBe(0);
		expect(silverCoinFlight(V.hopSeconds + 0.1, 0.2)).toBe(0);
		const f = silverCoinFlight(V.hopSeconds + V.flySeconds / 2, 0);
		expect(f > 0 && f < 1).toBe(true);
		expect(silverCoinFlight(V.hopSeconds + V.flySeconds + 1, 0)).toBe(1);
	});

	it("one break: the counter's gain, a pop at the cell, its coins hopping near it, one clink at step 0", () => {
		const fx = new SilverCrateFx();
		const out = fx.frame(source(brk(4, 6, 10.5, 20.5)), 1, 1);
		expect(out.gained).toBe(6);
		expect(out.pops).toEqual([{ x: 10.5, z: 20.5, amount: 6 }]);
		expect(out.coins.size()).toBe(silverCoinCount(6));
		for (let k = 0; k < out.coins.size(); k++) {
			const c = out.coins[k];
			expect([c.x, c.z]).toEqual([10.5, 20.5]);
			expect(math.abs(c.landX - c.x) <= V.spreadTiles && math.abs(c.landZ - c.z) <= V.spreadTiles).toBe(true);
			expect(c.flyDelaySec).toBe(k * V.flyStaggerSeconds);
		}
		expect(out.clink).toEqual({ step: 0, speed: 1 });
		// An empty frame: nothing, no clink.
		const empty = fx.frame(source(), 1.1, 1);
		expect([empty.gained, empty.pops.size(), empty.coins.size(), empty.clink]).toEqual([0, 0, 0, undefined]);
	});

	it("the same break throws the same coins (render rng from slot and tick); another break other coins", () => {
		const a = new SilverCrateFx().frame(source(brk(4, 8, 1, 1, 30)), 0, 1).coins.map((c) => [c.landX, c.landZ]);
		const b = new SilverCrateFx().frame(source(brk(4, 8, 1, 1, 30)), 5, 1).coins.map((c) => [c.landX, c.landZ]);
		const c = new SilverCrateFx().frame(source(brk(5, 8, 1, 1, 30)), 0, 1).coins.map((c) => [c.landX, c.landZ]);
		expect(a).toEqual(b);
		expect(a).never.toEqual(c);
	});

	it("reduced motion: the pop and the counter only, no coins (the clink still plays)", () => {
		const out = new SilverCrateFx().frame(source(brk(1, 9), brk(2, 4)), 0, 0);
		expect(out.gained).toBe(13);
		expect(out.pops.size()).toBe(2);
		expect(out.coins.size()).toBe(0);
		expect(out.clink).never.toBe(undefined);
	});

	it("caps: at most maxPopsPerFrame pops (later Silver folds into the last), maxCoinsPerFrame coins; gain is never capped", () => {
		const many: SilverBreakEvent[] = [];
		let sum = 0;
		for (let i = 0; i < 9; i++) {
			many.push(brk(i, 10 + i, i, 0));
			sum += 10 + i;
		}
		const out = new SilverCrateFx().frame(source(...many), 0, 1);
		expect(out.gained).toBe(sum);
		expect(out.pops.size()).toBe(V.maxPopsPerFrame);
		let shown = 0;
		for (const p of out.pops) shown += p.amount;
		expect(shown).toBe(sum);
		expect(out.pops[0]).toEqual({ x: 0, z: 0, amount: 10 });
		expect(out.coins.size()).toBe(V.maxCoinsPerFrame);
		expect(out.clink?.step).toBe(math.min(V.maxStep, 8)); // one clink, the frame's last step
	});

	it("a far co-op break ticks the counter: the gain is every break of the frame, wherever it is", () => {
		const party = buildEndlessRunConfig(5, 2);
		const spawn = party.spawn!;
		const ps = createSimState(5, spawn.x, spawn.z, party.config);
		const silver = party.endlessFloor(1).breakableSilver!;
		const ev = new SilverFrameEvents();
		// Player 1 far away; a break across the floor (any source pays the team).
		ps.party!.players[1].x = spawn.x + 40;
		const far = silver[silver.size() - 1];
		damageBreakable(ps, far.slot, 100, BreakableSource.PLAYER_BULLET, 1);
		ev.collect(ps);
		stepParty(ps, [EMPTY_INPUT, EMPTY_INPUT], party.config);
		const out = new SilverCrateFx().frame(ev, 0, 1);
		expect(out.gained).toBe(far.amount);
		expect(ps.silver!.total).toBe(far.amount);
	});

	it("the clink climbs a step per quick break, caps at maxStep, starts again after a gap; reset forgets the chain", () => {
		const fx = new SilverCrateFx();
		const steps: number[] = [];
		let t = 0;
		for (let i = 0; i < V.maxStep + 3; i++) {
			steps.push(fx.frame(source(brk(i, 5)), t, 1).clink!.step);
			t += V.chainWindowSeconds * 0.5;
		}
		const want: number[] = [];
		for (let i = 0; i < V.maxStep + 3; i++) want.push(math.min(i, V.maxStep));
		expect(steps).toEqual(want);
		// A gap longer than the window: back to 0.
		t += V.chainWindowSeconds * 2;
		expect(fx.frame(source(brk(1, 5)), t, 1).clink!.step).toBe(0);
		expect(fx.frame(source(brk(2, 5)), t + 0.1, 1).clink!.step).toBe(1);
		fx.reset();
		expect(fx.frame(source(brk(3, 5)), t + 0.2, 1).clink!.step).toBe(0);
	});
});
