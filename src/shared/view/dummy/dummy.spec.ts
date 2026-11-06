// The training dummy on screen (docs/DUMMY_ART.md DA3 / DD1): its sprite input, and the view-side hit clip that plays
// the 7-frame wobble over 0.7 s instead of the sim's 0.1 s hit flash.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CORPSE_TICKS, DUMMY, HIT_FLASH_TICKS, archetypeIds, type ActorState } from "shared/sim";
import type { SpriteAnimationDef } from "shared/theme";
import {
	ACTOR_SPRITE_INPUTS,
	chooseActorAnim,
	spriteFrame,
	type ActorSpriteInput,
	type SpriteAnimSource,
} from "../sprites";
import { DUMMY_CORPSE_TICKS, DUMMY_SPRITE_VIEW, VIEW_HIT_CLIP_SEC, dummySpriteInput } from ".";

function anim(start: number, frames: number, fps: number, loop: boolean): SpriteAnimationDef {
	return { sheet: 0, start, frames, fps, loop };
}

/** The enemy.dummy set's animations as art/atlases.json builds them (packs/vale/layout.ts). */
const DUMMY_ANIMS: Record<string, SpriteAnimationDef> = {
	attack: anim(0, 1, 1, true),
	death: anim(8, 9, 18, false),
	hit: anim(1, 7, 10, false),
	idle: anim(0, 1, 1, true),
	move: anim(0, 1, 1, true),
};

function source(anims: Readonly<Record<string, SpriteAnimationDef>>): SpriteAnimSource {
	return {
		animation(name: string) {
			return anims[name];
		},
	};
}

const SET = source(DUMMY_ANIMS);

/** A dummy's ActorState (only the fields its input reads). */
function dummyState(over: Partial<ActorState>): ActorState {
	return { alive: 1, deadTicks: 0, flashTicks: 0, x: 3, z: 4, prevX: 3, prevZ: 4, ...over } as unknown as ActorState;
}

function clipped(input: ActorSpriteInput, elapsed: number): ActorSpriteInput {
	return { ...input, hitClip: { elapsed, total: DUMMY_SPRITE_VIEW.hitSec } };
}

describe("training dummy sprite input", () => {
	it("is registered for the dummy archetype: never attacks or moves, its corpse time is the default", () => {
		expect(ACTOR_SPRITE_INPUTS.get(DUMMY.id)).toBe(dummySpriteInput);
		expect(DUMMY_CORPSE_TICKS).toBe(DUMMY.data.corpseTicks ?? CORPSE_TICKS);
		const input = dummySpriteInput(dummyState({ flashTicks: 4 }), 0.25);
		expect(input).toEqual({
			alive: true,
			deadTicks: 0,
			corpseTicks: DUMMY_CORPSE_TICKS,
			flashTicks: 4,
			attack: undefined,
			speed: 0,
			refSpeed: 0,
			alpha: 0.25,
		});
		expect(dummySpriteInput(dummyState({ alive: 0, deadTicks: 7 }), 0).alive).toBe(false);
	});

	it("only the dummy takes a view-side hit clip, of hitSec (the pack's 7 frames at 10 fps)", () => {
		expect(DUMMY_SPRITE_VIEW.hitSec).toBe(0.7);
		expect(VIEW_HIT_CLIP_SEC.get(DUMMY.id)).toBe(DUMMY_SPRITE_VIEW.hitSec);
		let n = 0;
		for (const id of archetypeIds()) if (VIEW_HIT_CLIP_SEC.get(id) !== undefined) n++;
		expect(n).toBe(1);
	});
});

describe("view-side hit clip (DD1)", () => {
	const calm = dummySpriteInput(dummyState({}), 0);

	it("plays hit stretched over the clip: the white frame first, frame 3 at half, idle once it ends", () => {
		const at = (elapsed: number) => {
			const choice = chooseActorAnim(clipped(calm, elapsed), SET);
			return [choice.anim, spriteFrame(SET, choice, undefined, 0).frame];
		};
		expect(at(0)).toEqual(["hit", 0]);
		expect(at(0.099)).toEqual(["hit", 0]);
		expect(at(0.35)).toEqual(["hit", 3]);
		expect(at(0.69)).toEqual(["hit", 6]);
		expect(at(0.7)).toEqual(["idle", 0]);
		expect(at(math.huge)).toEqual(["idle", 0]);
	});

	it("replaces the flash as the hit's timer: no hit outside the clip even while the sim flash runs", () => {
		const flashing = dummySpriteInput(dummyState({ flashTicks: HIT_FLASH_TICKS }), 0);
		expect(chooseActorAnim(clipped(flashing, math.huge), SET).anim).toBe("idle");
		// Without a clip (the placeholder path never asks; another set) the flash rule is unchanged.
		const flash = chooseActorAnim(flashing, SET);
		expect([flash.anim, flash.progress]).toEqual(["hit", 0]);
		expect(chooseActorAnim(calm, SET).anim).toBe("idle");
	});

	it("death beats the clip; no flinch and a 1-frame hit stand-in skip it", () => {
		const dead = dummySpriteInput(dummyState({ alive: 0, deadTicks: 15 }), 0);
		const death = chooseActorAnim(clipped(dead, 0.1), SET);
		expect(death.anim).toBe("death");
		// the break is stretched over the corpse time (SPRITE_VIEW.deathCorpseFraction 1): halfway at 15 of 30 ticks
		expect(spriteFrame(SET, death, undefined, 0).frame).toBe(math.floor((15 / DUMMY_CORPSE_TICKS) * 9));
		expect(chooseActorAnim({ ...clipped(calm, 0.1), flinch: false }, SET).anim).toBe("idle");
		const stub = source({ ...DUMMY_ANIMS, hit: anim(0, 1, 1, false) });
		expect(chooseActorAnim(clipped(calm, 0.1), stub).anim).toBe("idle");
	});

	it("a negative elapsed (a hit stamped after this frame's clock) is not inside the clip", () => {
		expect(chooseActorAnim(clipped(calm, -0.01), SET).anim).toBe("idle");
	});
});
