// docs/COSMETICS.md "Preview actions": the Armory preview rolls for a trail and attacks for a spark, with the in-run
// ghosts and parry burst. Ids are read from COSMETIC_ITEMS (the palette may change).
import { describe, expect, it } from "@rbxts/jest-globals";
import { COSMETIC_ITEMS, LOOK_SLOTS, type CosmeticItemDef } from "shared/cosmetics";
import { ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { COSMETIC_VIEW } from "../cosmetics/config";
import { FEEL_GHOST } from "../fx/motionFxConfig";
import { NEAR_MISS_VIEW } from "../fx/nearMissConfig";
import {
	cosmeticPreviewAction,
	previewActionAnim,
	previewActionPhase,
	previewActionSec,
	previewBurst,
	previewBurstAt,
	previewBurstOrigin,
	previewBurstSec,
	previewGhosts,
	previewRollAngleDeg,
	previewRollOffset,
} from "./cosmeticAction";

const A = COSMETIC_VIEW.preview.action;
const P = NEAR_MISS_VIEW.parry;
const FPS = 14;
const FRAMES = 8;
const LEN = FRAMES / FPS;
const EPS = 1e-9;

function firstOf(slot: string): CosmeticItemDef {
	const it = COSMETIC_ITEMS.find((i) => i.slot === slot);
	if (it === undefined) error(`no ${slot} item`, 0);
	return it;
}

describe("cosmetic preview actions", () => {
	it("a trail rolls, a spark attacks, a dye or an outline idles", () => {
		expect(cosmeticPreviewAction(firstOf(LOOK_SLOTS.trail).id)).toBe("roll");
		expect(cosmeticPreviewAction(firstOf(LOOK_SLOTS.spark).id)).toBe("attack");
		expect(cosmeticPreviewAction(firstOf(LOOK_SLOTS.outline).id)).toBe("idle");
		expect(cosmeticPreviewAction(firstOf("dye.knight").id)).toBe("idle");
		expect(cosmeticPreviewAction(undefined)).toBe("idle");
		expect(cosmeticPreviewAction("no.such.item")).toBe("idle");
	});

	it("the animation is the first the set has; idle and unknown sets play none", () => {
		const knight = (anim: string) => ["idle", "roll", "attack.1", "attack.2"].includes(anim);
		expect(previewActionAnim("roll", knight)).toBe("roll");
		expect(previewActionAnim("attack", knight)).toBe("attack.1");
		expect(previewActionAnim("attack", (a) => a === "attack")).toBe("attack");
		expect(previewActionAnim("idle", knight)).toBe(undefined);
		expect(previewActionAnim("roll", () => false)).toBe(undefined);
	});

	it("both vale characters resolve a roll and an attack animation (the theme's own names)", () => {
		const vale = new ThemePack(VALE_MANIFEST, { warn: () => {} });
		for (const id of ["class.vanguard", "class.ranger"]) {
			const set = vale.sprites(id);
			expect(set !== undefined).toBe(true);
			const has = (anim: string) => set!.has(anim);
			expect([id, previewActionAnim("roll", has)]).toEqual([id, "roll"]);
			expect([id, previewActionAnim("attack", has)]).toEqual([id, "attack.1"]);
			const attack = set!.animation("attack.1")!;
			expect(previewActionSec(attack.fps, attack.frames) > 0).toBe(true);
		}
	});

	it("a cycle rests restSec, then plays the action once, its last frame held", () => {
		expect(previewActionSec(FPS, FRAMES)).toBe(LEN);
		expect(previewActionSec(0, FRAMES)).toBe(0);
		expect(previewActionPhase(0, FPS, FRAMES).acting).toBe(false);
		expect(previewActionPhase(A.restSec * 0.5, FPS, FRAMES).acting).toBe(false);
		const start = previewActionPhase(A.restSec + EPS, FPS, FRAMES);
		expect([start.acting, start.frame, start.cycle]).toEqual([true, 0, 0]);
		const mid = previewActionPhase(A.restSec + 3.5 / FPS, FPS, FRAMES);
		expect(mid.frame).toBe(3);
		const last = previewActionPhase(A.restSec + LEN - EPS, FPS, FRAMES);
		expect(last.frame).toBe(FRAMES - 1);
		const after = previewActionPhase(A.restSec + LEN + EPS, FPS, FRAMES);
		expect([after.acting, after.cycle]).toEqual([false, 1]);
		// no animation: always resting
		expect(previewActionPhase(5, 0, 0).acting).toBe(false);
	});

	it("a roll ping-pongs across the box, so a cycle starts where the last one ended", () => {
		const half = A.rollSlideShare / 2;
		expect(previewRollAngleDeg(0)).toBe(0);
		expect(previewRollAngleDeg(1)).toBe(180);
		expect(previewRollOffset(false, 0, LEN, 0)).toBeCloseTo(-half);
		expect(previewRollOffset(true, 0, LEN, 0)).toBeCloseTo(-half);
		expect(previewRollOffset(true, LEN, LEN, 0)).toBeCloseTo(half);
		expect(previewRollOffset(false, 0, LEN, 1)).toBeCloseTo(half);
		expect(previewRollOffset(true, LEN, LEN, 1)).toBeCloseTo(-half);
		// monotone to the right on an even cycle
		let prev = -math.huge;
		for (let i = 0; i <= 10; i++) {
			const x = previewRollOffset(true, (LEN * i) / 10, LEN, 0);
			expect(x >= prev).toBe(true);
			prev = x;
		}
	});

	it("ghosts: in-run spacing, life and fade, at most perSource, behind the sprite, gone after lifeSec", () => {
		const every = FEEL_GHOST.everyTicks / 60;
		for (let i = 0; i <= 40; i++) {
			const t = (LEN * i) / 40;
			const ghosts = previewGhosts(true, t, LEN, 0);
			expect(ghosts.size() <= FEEL_GHOST.perSource).toBe(true);
			for (const g of ghosts) {
				expect(g.recordedSec <= t + EPS).toBe(true);
				expect(t - g.recordedSec < FEEL_GHOST.lifeSec).toBe(true);
				expect(g.transparency >= FEEL_GHOST.startTransparency - EPS).toBe(true);
				expect(g.transparency < 1).toBe(true);
				// on a right roll a ghost never sits ahead of the sprite
				expect(g.offset <= previewRollOffset(true, t, LEN, 0) + EPS).toBe(true);
			}
		}
		// the first ghost is recorded on the roll's first frame, the next one tick group later
		expect(previewGhosts(true, 0, LEN, 0).map((g) => g.recordedSec)).toEqual([0]);
		expect(previewGhosts(true, every, LEN, 0).map((g) => g.recordedSec)).toEqual([0, every]);
		// they fade out after the roll ends, then none are left
		expect(previewGhosts(false, 0, LEN, 0, FEEL_GHOST.lifeSec * 0.5).size() > 0).toBe(true);
		expect(previewGhosts(false, 0, LEN, 0, FEEL_GHOST.lifeSec + EPS).size()).toBe(0);
		expect(previewGhosts(true, 0.1, 0, 0).size()).toBe(0);
	});

	it("the burst: none before sparkAtShare or after its life; sparkCount sparks in the fan, flying outward and fading", () => {
		const at = A.sparkAtShare * LEN;
		const angle = A.attackAngleDeg;
		expect(previewBurst(at - EPS * 1e3, LEN, angle)).toBe(undefined);
		const life = previewBurstSec();
		expect(life).toBeCloseTo(P.lifeSec * A.burstSlowdown);
		expect(previewBurst(at + life + EPS, LEN, angle)).toBe(undefined);
		const early = previewBurst(at + 0.02, LEN, angle)!;
		const late = previewBurst(at + life * 0.9, LEN, angle)!;
		expect(early.sparks.size()).toBe(P.sparkCount);
		expect(early.sparks[0].transparency).toBe(0);
		expect(late.sparks[0].transparency > 0).toBe(true);
		expect(late.ring.radius > early.ring.radius).toBe(true);
		expect(late.ring.radius <= P.ringR1Tiles * A.spreadScale + EPS).toBe(true);
		const fx = math.cos(math.rad(angle));
		const fy = -math.sin(math.rad(angle));
		for (let i = 0; i < late.sparks.size(); i++) {
			const s = late.sparks[i];
			const d = math.sqrt(s.x * s.x + s.y * s.y);
			const e = early.sparks[i];
			expect(d > math.sqrt(e.x * e.x + e.y * e.y)).toBe(true);
			// within the fan: the angle to the facing is at most fanRad
			expect((s.x * fx + s.y * fy) / d >= math.cos(P.fanRad) - 1e-6).toBe(true);
			expect(s.sizePx === P.sparkMinPx || s.sizePx === P.sparkMaxPx).toBe(true);
		}
		const o = previewBurstOrigin(angle);
		expect(math.sqrt(o.x * o.x + o.y * o.y)).toBeCloseTo(A.sparkReachTiles);
	});

	it("the staged burst runs on into the rest after the attack and is gone before the next one", () => {
		const angle = A.attackAngleDeg;
		const start = A.restSec + A.sparkAtShare * LEN;
		const life = previewBurstSec();
		expect(previewBurstAt(start - 0.01, FPS, FRAMES, angle)).toBe(undefined);
		expect(previewBurstAt(start + 0.01, FPS, FRAMES, angle) !== undefined).toBe(true);
		// past the attack's end (rest of cycle 1) while still alive
		const afterEnd = A.restSec + LEN + 0.01;
		if (start + life > afterEnd) expect(previewBurstAt(afterEnd, FPS, FRAMES, angle) !== undefined).toBe(true);
		expect(previewBurstAt(start + life + 0.01, FPS, FRAMES, angle)).toBe(undefined);
		// the rest is longer than what the burst outlives the attack by: none left when the next attack starts
		const nextAttack = 2 * A.restSec + LEN + 0.001;
		expect(previewBurstAt(nextAttack, FPS, FRAMES, angle)).toBe(undefined);
		expect(previewBurstAt(0.1, FPS, FRAMES, angle)).toBe(undefined);
	});
});
