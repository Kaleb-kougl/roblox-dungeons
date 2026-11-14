// docs/SILVER.md SV16 (owner call OC18): the half-heart container. An ODD heart maximum (the Archer's 3 half hearts,
// Vigor I's 5) ends in half a container in the status panel and the touch strip: full while it holds its half heart,
// spent once hurt, never a half-filled heart; even maxima draw exactly as before. heartArt picks the pack's container
// art (shared/theme HEART_ICON_IDS, both or neither) over the whole hearts, cuts the whole heart in half without it, and
// draws flat with no heart art; the strip keeps one heart slot per container.
import { describe, expect, it } from "@rbxts/jest-globals";
import { HEART_ICON_IDS } from "shared/theme";
import {
	HEART_FILL,
	heartArt,
	heartFills,
	heartSkinState,
	isHalfContainer,
	touchStripSlots,
	touchStripWidths,
	type SkinHas,
	type TouchStripContent,
} from ".";

const { EMPTY, HALF, FULL, HALF_MAX_FULL, HALF_MAX_EMPTY } = HEART_FILL;

const HEARTS = ["ui.heart.full", "ui.heart.half", "ui.heart.empty"];
function hasOnly(ids: ReadonlyArray<string>): SkinHas {
	return (id) => ids.includes(id);
}
function withHearts(extra: ReadonlyArray<string>): SkinHas {
	return hasOnly([...HEARTS, ...extra]);
}

describe("heartFills: the half container (SV16)", () => {
	it("an odd maximum: full, hurt (each half heart) and empty, never a half-filled heart", () => {
		expect(heartFills(3, 3)).toEqual([FULL, HALF_MAX_FULL]);
		expect(heartFills(2, 3)).toEqual([FULL, HALF_MAX_EMPTY]);
		expect(heartFills(1, 3)).toEqual([HALF, HALF_MAX_EMPTY]);
		expect(heartFills(0, 3)).toEqual([EMPTY, HALF_MAX_EMPTY]);
		expect(heartFills(5, 5)).toEqual([FULL, FULL, HALF_MAX_FULL]);
		expect(heartFills(4, 5)).toEqual([FULL, FULL, HALF_MAX_EMPTY]);
		expect(heartFills(3, 5)).toEqual([FULL, HALF, HALF_MAX_EMPTY]);
		expect(heartFills(1, 1)).toEqual([HALF_MAX_FULL]);
		expect(heartFills(0, 1)).toEqual([HALF_MAX_EMPTY]);
		for (let max = 1; max <= 11; max += 2) {
			for (let hearts = 0; hearts <= max; hearts++) {
				const fills = heartFills(hearts, max);
				expect(fills.size()).toBe((max + 1) / 2);
				expect(isHalfContainer(fills[fills.size() - 1])).toBe(true);
				for (let i = 0; i < fills.size() - 1; i++) expect(isHalfContainer(fills[i])).toBe(false);
				// What the row shows adds up to the hearts held.
				let shown = 0;
				for (const f of fills) shown += f === HALF_MAX_FULL ? 1 : f === HALF_MAX_EMPTY ? 0 : f;
				expect([max, hearts, shown]).toEqual([max, hearts, hearts]);
			}
		}
	});

	it("even maxima are exactly the web split", () => {
		expect(heartFills(6, 6)).toEqual([2, 2, 2]);
		expect(heartFills(5, 6)).toEqual([2, 2, 1]);
		expect(heartFills(4, 4)).toEqual([2, 2]);
		expect(heartFills(3, 4)).toEqual([2, 1]);
		expect(heartFills(0, 4)).toEqual([0, 0]);
		for (let max = 2; max <= 12; max += 2) {
			for (const f of heartFills(max, max)) expect(isHalfContainer(f)).toBe(false);
		}
	});
});

describe("heartArt: the half container's look (SV16)", () => {
	it("whole hearts keep skinFor's art", () => {
		const has = withHearts([]);
		expect([FULL, HALF, EMPTY].map((f) => heartArt(has, f)?.id)).toEqual(HEARTS);
		for (const f of [FULL, HALF, EMPTY]) expect(heartArt(has, f)?.leftHalf).toBe(false);
		expect([heartSkinState(HALF_MAX_FULL), heartSkinState(HALF_MAX_EMPTY)]).toEqual(["full", "empty"]);
	});

	it("the pack's container art when it has both ids (and the hearts)", () => {
		const has = withHearts([HEART_ICON_IDS.halfmax, HEART_ICON_IDS.halfmaxEmpty]);
		expect(heartArt(has, HALF_MAX_FULL)).toEqual({ id: HEART_ICON_IDS.halfmax, leftHalf: false });
		expect(heartArt(has, HALF_MAX_EMPTY)).toEqual({ id: HEART_ICON_IDS.halfmaxEmpty, leftHalf: false });
	});

	it("without it (or with only one of the two): the whole heart's left half", () => {
		for (const extra of [[], [HEART_ICON_IDS.halfmax], [HEART_ICON_IDS.halfmaxEmpty]]) {
			const has = withHearts(extra);
			expect(heartArt(has, HALF_MAX_FULL)).toEqual({ id: "ui.heart.full", leftHalf: true });
			expect(heartArt(has, HALF_MAX_EMPTY)).toEqual({ id: "ui.heart.empty", leftHalf: true });
		}
	});

	it("without the hearts' art: flat, container art or not (a row never mixes art and flat hearts)", () => {
		const has = hasOnly([HEART_ICON_IDS.halfmax, HEART_ICON_IDS.halfmaxEmpty]);
		for (const f of [FULL, HALF, EMPTY, HALF_MAX_FULL, HALF_MAX_EMPTY]) expect(heartArt(has, f)).toBe(undefined);
	});
});

describe("the touch strip: one heart slot per container (SV16)", () => {
	const content = (heartsMax: number): TouchStripContent => ({
		heartsMax,
		ghost: false,
		pips: 0,
		flaskMax: 3,
		emberMax: 2,
		scoring: false,
		score: 0,
	});

	it("an odd maximum takes as many slots as hearts drawn (ceil(max / 2)); its half container a whole slot", () => {
		const slots = touchStripSlots(undefined, 1);
		const width = (max: number) => touchStripWidths(content(max), slots, false, false).hearts;
		expect(width(3)).toBe(width(4));
		expect(width(5)).toBe(width(6));
		expect(width(3)).toBeLessThan(width(5));
	});
});
