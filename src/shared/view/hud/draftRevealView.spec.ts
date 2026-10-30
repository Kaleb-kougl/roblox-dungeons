// docs/DRAFT_REVEAL.md DR5: the overlay's pure draw helpers (skull placement, slice rects, the card look).
import { describe, expect, it } from "@rbxts/jest-globals";
import { Rarity } from "shared/sim";
import { DraftReveal } from "./draftReveal";
import {
	DRAFT_REVEAL_VIEW,
	DRAFT_SKIN,
	draftCardLook,
	draftFaceImageId,
	draftOverlayLook,
	draftRayAngle,
	draftShineOffset,
	draftSkullPlacement,
	draftSliceCenter,
	newDraftCardLook,
} from "./draftRevealView";
import { HUD_VIEW } from "./layout";
import { PROGRESSION_VIEW } from "./progression";

const STEP = 1 / 60;

function stepTo(reveal: DraftReveal, seconds: number): void {
	let t = 0;
	while (t < seconds) {
		reveal.step(STEP);
		t += STEP;
	}
}

describe("draft reveal view: art helpers", () => {
	it("puts the skulls' pivots on the rare face's art pixels (1, 3) and (86, 3) at 2x", () => {
		const left = draftSkullPlacement("left", { w: 17, h: 18, pivot: { x: 3, y: 5 } }, 87);
		expect(left.fromRight).toBe(false);
		expect(left.x).toBe(2);
		expect(left.y).toBe(6);
		expect(left.w).toBe(34);
		expect(left.h).toBe(36);
		expect(left.anchorX).toBe(3 / 17);
		expect(left.anchorY).toBe(5 / 18);
		const right = draftSkullPlacement("right", { w: 17, h: 18, pivot: { x: 14, y: 5 } }, 87);
		expect(right.fromRight).toBe(true);
		expect(right.x).toBe((87 - 86) * 2);
		expect(right.y).toBe(6);
		expect(right.anchorX).toBe(14 / 17);
	});

	it("anchors a skull without a pivot at its centre and measures a widthless face on the default width", () => {
		const s = draftSkullPlacement("right", { w: 10, h: 8 }, 0);
		expect(s.anchorX).toBe(0.5);
		expect(s.anchorY).toBe(0.5);
		expect(s.x).toBe((DRAFT_REVEAL_VIEW.skullFaceWidth - DRAFT_REVEAL_VIEW.skullRightAt.x) * 2);
	});

	it("builds SliceCenter as (left, top, w - right, h - bottom)", () => {
		expect(draftSliceCenter(87, 61, { left: 43, top: 30, right: 43, bottom: 30 })).toEqual({
			x0: 43,
			y0: 30,
			x1: 44,
			y1: 31,
		});
	});

	it("keeps every sliced card art's fixed corners inside the 240 x 150 card at 2x", () => {
		const s = DRAFT_REVEAL_VIEW.artScale;
		for (const [l, t, r, b] of [
			[46, 20, 46, 24],
			[6, 6, 6, 6],
			[43, 30, 43, 30],
		]) {
			expect((l + r) * s).toBeLessThanOrEqual(PROGRESSION_VIEW.cardWidth);
			expect((t + b) * s).toBeLessThanOrEqual(PROGRESSION_VIEW.cardHeight);
		}
	});

	it("draws common faces on the plain panel and rare / legendary on the studded one", () => {
		expect(draftFaceImageId(Rarity.COMMON)).toBe(DRAFT_SKIN.common);
		expect(draftFaceImageId(Rarity.RARE)).toBe(DRAFT_SKIN.rare);
		expect(draftFaceImageId(Rarity.LEGENDARY)).toBe(DRAFT_SKIN.rare);
	});

	it("spreads the beams over half a turn and sweeps the shine from off-left to off-right", () => {
		expect(draftRayAngle(0, 8)).toBe(0);
		expect(draftRayAngle(4, 8)).toBe(90);
		expect(draftRayAngle(1, 0)).toBe(0);
		const reach = 0.5 + DRAFT_REVEAL_VIEW.shine.bandWidth / 2;
		expect(draftShineOffset(0)).toBe(-reach);
		expect(draftShineOffset(1)).toBe(reach);
		expect(draftShineOffset(2)).toBe(reach);
	});
});

describe("draft reveal view: the card look", () => {
	it("shows only the back, untexted, before the first flip, then the face with its text once landed", () => {
		const reveal = new DraftReveal();
		reveal.begin([Rarity.COMMON, Rarity.COMMON, Rarity.COMMON], false);
		const look = newDraftCardLook();
		stepTo(reveal, 0.3);
		draftCardLook(reveal.frame.cards[0], 1, false, look);
		expect(look.shown).toBe(true);
		expect(look.faceAlpha).toBe(0);
		expect(look.backAlpha).toBeGreaterThan(0.99);
		expect(look.textAlpha).toBe(0);
		expect(look.backFillAlpha).toBeCloseTo(look.backAlpha * (1 - HUD_VIEW.panelTransparency), 9);
		stepTo(reveal, 0.5);
		draftCardLook(reveal.frame.cards[0], 1, false, look);
		expect(look.faceAlpha).toBe(1);
		expect(look.backAlpha).toBe(0);
		expect(look.textAlpha).toBe(1);
		expect(look.width).toBe(1);
	});

	it("hides the text and the skulls while the card is thin mid-flip", () => {
		const reveal = new DraftReveal();
		reveal.begin([Rarity.COMMON], false);
		const look = newDraftCardLook();
		// The flip lands at 0.55 s; its second half (face up, springing back) runs over 0.45 .. 0.55 s.
		stepTo(reveal, 0.47);
		const card = reveal.frame.cards[0];
		draftCardLook(card, 1, false, look);
		expect(card.width).toBeLessThan(DRAFT_REVEAL_VIEW.textMinWidth);
		expect(look.faceAlpha).toBe(1);
		expect(look.ornamentAlpha).toBe(0);
		expect(look.textAlpha).toBe(0);
	});

	it("folds the overlay's exit fade into every opacity and scales the selected card", () => {
		const reveal = new DraftReveal();
		reveal.begin([Rarity.COMMON, Rarity.RARE], false);
		stepTo(reveal, 2);
		expect(reveal.frame.settled).toBe(true);
		const look = newDraftCardLook();
		draftCardLook(reveal.frame.cards[1], 0.5, true, look);
		expect(look.faceAlpha).toBe(0.5);
		expect(look.textAlpha).toBe(0.5);
		expect(look.faceFillAlpha).toBe(0.5);
		expect(look.scale).toBe(PROGRESSION_VIEW.selectedScale);
		draftCardLook(reveal.frame.cards[0], 1, false, look);
		expect(look.scale).toBe(1);
		expect(look.faceFillAlpha).toBeCloseTo(1 - HUD_VIEW.panelTransparency, 9);
	});

	it("never shows a slot past the offer count", () => {
		const reveal = new DraftReveal();
		reveal.begin([Rarity.COMMON], false);
		stepTo(reveal, 1);
		const look = draftCardLook(reveal.frame.cards[2], 1, true, newDraftCardLook());
		expect(look.shown).toBe(false);
		expect(look.selected).toBe(false);
		expect(look.faceAlpha).toBe(0);
		expect(look.burstVisible).toBe(false);
	});

	it("puts a legendary's rays behind the other cards and lights its eyes during the charge", () => {
		const reveal = new DraftReveal();
		reveal.begin([Rarity.COMMON, Rarity.LEGENDARY], false);
		// The common lands at 0.55 s; the charge runs 0.55 .. 1.25 s.
		stepTo(reveal, 1.1);
		const look = draftCardLook(reveal.frame.cards[1], 1, false, newDraftCardLook());
		expect(look.eyesAlpha).toBeGreaterThan(0);
		expect(look.raysBehind).toBe(true);
		const other = draftCardLook(reveal.frame.cards[0], 1, false, newDraftCardLook());
		expect(other.dimAlpha).toBeGreaterThan(0);
		expect(other.raysBehind).toBe(false);
		// After the flare: the halo stays.
		stepTo(reveal, 1.5);
		draftCardLook(reveal.frame.cards[1], 1, false, look);
		expect(look.faceAlpha).toBe(1);
		expect(look.haloAlpha).toBeGreaterThan(0);
		expect(look.raysBehind).toBe(true);
	});

	it("fades the panel and title in with the title and out with the exit fade", () => {
		const reveal = new DraftReveal();
		expect(draftOverlayLook(reveal.frame).visible).toBe(false);
		reveal.begin([Rarity.COMMON], false);
		expect(draftOverlayLook(reveal.frame).titleAlpha).toBe(0);
		stepTo(reveal, 1);
		const settled = draftOverlayLook(reveal.frame);
		expect(settled.visible).toBe(true);
		expect(settled.titleAlpha).toBe(1);
		expect(settled.panelAlpha).toBeCloseTo(1 - HUD_VIEW.panelTransparency, 9);
		reveal.pick(0);
		stepTo(reveal, 1);
		expect(reveal.frame.done).toBe(true);
		expect(draftOverlayLook(reveal.frame).visible).toBe(false);
	});
});
