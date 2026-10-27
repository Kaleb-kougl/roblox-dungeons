// Hit reaction (docs/FEEL.md J4 / J5): rim flash, hold and push per actor slot.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { createSimState, playerAt } from "shared/sim";
import { degToRad, isoBasis } from "../iso";
import { BOSS_DEATH_FREEZE_MS, HEAVY_KILL_FREEZE_MS, HEAVY_KILL_HP, KILL_FREEZE_MS } from "./freezeRules";
import {
	HitReactSlots,
	killHoldMs,
	nearestLivingPlayer,
	pushFraction,
	pushOffsetStuds,
	spriteRimShown,
	type HitReactEvent,
	type HitReactPoint,
} from "./hitReact";
import { FEEL_HIT } from "./hitReactConfig";

const BASIS = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
const MS = 1000;
/** Half a millisecond: inside / outside a window without hitting its edge. */
const D = 0.0005;

function ev(overrides: Partial<HitReactEvent> = {}): HitReactEvent {
	return {
		type: "hit",
		slot: 0,
		actorId: 1,
		x: 0,
		z: 0,
		heavy: false,
		boss: false,
		elite: false,
		capped: false,
		hpMax: 3,
		revived: false,
		...overrides,
	};
}

function point(x: number, z: number): HitReactPoint {
	return { x, z };
}

/** Screen direction (right, up) of a ground vector under BASIS, as the module projects it. */
function screenDir(dx: number, dz: number): [number, number] {
	const sx = dx * BASIS.right[0] + dz * BASIS.right[2];
	const sy = dx * BASIS.up[0] + dz * BASIS.up[2];
	const len = math.sqrt(sx * sx + sy * sy);
	return [sx / len, sy / len];
}

/** The ground direction that projects onto screen-up (no screen-right component) under BASIS, unit length. */
function screenUpGround(): [number, number] {
	// Perpendicular (on the ground) to camera right's ground part.
	const rx = BASIS.right[0];
	const rz = BASIS.right[2];
	// Two candidates; pick the one whose screen y is positive.
	const [cx, cz] = [-rz, rx];
	const sy = cx * BASIS.up[0] + cz * BASIS.up[2];
	const len = math.sqrt(cx * cx + cz * cz);
	return sy > 0 ? [cx / len, cz / len] : [-cx / len, -cz / len];
}

describe("hit reaction", () => {
	it("a hit flashes the rim for flashSec, holds for holdSec and pushes 1 texel away from the player", () => {
		const s = new HitReactSlots(BASIS);
		// The player is screen-left of the actor: the push goes screen-right.
		const [rx, rz] = [BASIS.right[0], BASIS.right[2]];
		s.onEvent(ev({ x: 0, z: 0 }), 10, point(-rx, -rz));
		const look = s.look(0, 1, 10, 1);
		expect(look.rimFlash).toBe(true);
		expect(look.hold).toBe(true);
		expect(look.pushX).toBe(FEEL_HIT.pushTexels);
		expect(look.pushY).toBe(0);
		expect(s.look(0, 1, 10 + FEEL_HIT.flashSec - D, 1).rimFlash).toBe(true);
		expect(s.look(0, 1, 10 + FEEL_HIT.flashSec + D, 1).rimFlash).toBe(false);
		expect(s.look(0, 1, 10 + FEEL_HIT.holdSec - D, 1).hold).toBe(true);
		expect(s.look(0, 1, 10 + FEEL_HIT.holdSec + D, 1).hold).toBe(false);
	});

	it("the push stays full for pushHoldSec, then eases back to 0 over easeSec in whole texels", () => {
		expect(pushFraction(0)).toBe(1);
		expect(pushFraction(FEEL_HIT.pushHoldSec - D)).toBe(1);
		expect(pushFraction(FEEL_HIT.pushHoldSec + FEEL_HIT.easeSec / 2)).toBeCloseTo(0.5, 6);
		expect(pushFraction(FEEL_HIT.pushHoldSec + FEEL_HIT.easeSec + D)).toBe(0);
		expect(pushFraction(-1)).toBe(0);
		expect(pushFraction(0 / 0)).toBe(0);

		const s = new HitReactSlots(BASIS);
		const [ux, uz] = screenUpGround();
		// Heavy hit, the player screen-below: 2 texels up, then 1, then 0.
		s.onEvent(ev({ heavy: true }), 0, point(-ux, -uz));
		expect(s.look(0, 1, 0, 1).pushY).toBe(FEEL_HIT.heavyPushTexels);
		expect(s.look(0, 1, 0, 1).pushX).toBe(0);
		const mid = FEEL_HIT.pushHoldSec + FEEL_HIT.easeSec * 0.5;
		expect(s.look(0, 1, mid, 1).pushY).toBe(1);
		const done = FEEL_HIT.pushHoldSec + FEEL_HIT.easeSec + D;
		expect(s.look(0, 1, done, 1).pushY).toBe(0);
		// Every push value is a whole number of texels.
		for (let t = 0; t <= 20; t++) {
			const look = s.look(0, 1, (t * done) / 20, 1);
			expect(look.pushX % 1).toBe(0);
			expect(look.pushY % 1).toBe(0);
		}
	});

	it("a diagonal push rounds each axis to whole texels, away from the nearest player", () => {
		const s = new HitReactSlots(BASIS);
		// Player toward world -x: away = +x on the ground.
		s.onEvent(ev({ heavy: true }), 0, point(-1, 0));
		const [dx, dy] = screenDir(1, 0);
		const look = s.look(0, 1, 0, 1);
		expect(look.pushX).toBe(math.round(dx * FEEL_HIT.heavyPushTexels));
		expect(look.pushY).toBe(math.round(dy * FEEL_HIT.heavyPushTexels));
		expect(look.pushX).toBeGreaterThan(0);
	});

	it("no push when no player is alive or the player stands on the actor", () => {
		const s = new HitReactSlots(BASIS);
		s.onEvent(ev(), 0, undefined);
		expect(s.look(0, 1, 0, 1).pushX).toBe(0);
		expect(s.look(0, 1, 0, 1).pushY).toBe(0);
		expect(s.look(0, 1, 0, 1).hold).toBe(true);
		s.onEvent(ev({ actorId: 2 }), 0, point(0, 0));
		expect(s.look(0, 2, 0, 1).pushX).toBe(0);
		expect(s.look(0, 2, 0, 1).pushY).toBe(0);
	});

	it("the rim flash starts at most every minSec per actor; hits in between do not extend it", () => {
		const s = new HitReactSlots(BASIS);
		s.onEvent(ev(), 0, undefined);
		s.onEvent(ev(), FEEL_HIT.flashSec - 2 * D, undefined); // too soon
		expect(s.look(0, 1, FEEL_HIT.flashSec + D, 1).rimFlash).toBe(false);
		s.onEvent(ev(), FEEL_HIT.minSec - 2 * D, undefined); // still too soon
		expect(s.look(0, 1, FEEL_HIT.minSec, 1).rimFlash).toBe(false);
		s.onEvent(ev(), FEEL_HIT.minSec, undefined); // allowed again
		expect(s.look(0, 1, FEEL_HIT.minSec, 1).rimFlash).toBe(true);
		// Another actor flashes on its own schedule.
		s.onEvent(ev({ slot: 1, actorId: 7 }), FEEL_HIT.minSec + D, undefined);
		expect(s.look(1, 7, FEEL_HIT.minSec + D, 1).rimFlash).toBe(true);
	});

	it("capped hits flash only: no hold, no push (a 'hit' with capped and a 'capped' event)", () => {
		const s = new HitReactSlots(BASIS);
		s.onEvent(ev({ capped: true, heavy: true }), 0, point(-1, 0));
		let look = s.look(0, 1, 0, 1);
		expect(look.rimFlash).toBe(true);
		expect(look.hold).toBe(false);
		expect(look.pushX).toBe(0);
		expect(look.pushY).toBe(0);
		s.onEvent(ev({ type: "capped", slot: 1, actorId: 2, capped: true }), 0, point(-1, 0));
		look = s.look(1, 2, 0, 1);
		expect(look.rimFlash).toBe(true);
		expect(look.hold).toBe(false);
		expect(look.pushX).toBe(0);
	});

	it("bosses hold and flash but are never pushed", () => {
		const s = new HitReactSlots(BASIS);
		s.onEvent(ev({ boss: true, heavy: true, hpMax: 300 }), 0, point(-1, 0));
		const look = s.look(0, 1, 0, 1);
		expect(look.rimFlash).toBe(true);
		expect(look.hold).toBe(true);
		expect(look.pushX).toBe(0);
		expect(look.pushY).toBe(0);
	});

	it("a kill keeps the hold for its freeze length (kill, heavy / elite kill, boss death)", () => {
		expect(killHoldMs(ev({ type: "killed" }))).toBe(KILL_FREEZE_MS);
		expect(killHoldMs(ev({ type: "killed", hpMax: HEAVY_KILL_HP }))).toBe(HEAVY_KILL_FREEZE_MS);
		expect(killHoldMs(ev({ type: "killed", elite: true }))).toBe(HEAVY_KILL_FREEZE_MS);
		expect(killHoldMs(ev({ type: "killed", boss: true }))).toBe(0);
		expect(killHoldMs(ev({ type: "bossDefeated", boss: true }))).toBe(BOSS_DEATH_FREEZE_MS);
		expect(killHoldMs(ev({ type: "hit" }))).toBe(0);

		const s = new HitReactSlots(BASIS);
		// The killing blow's 'hit' then its 'killed', in the same frame.
		s.onEvent(ev({ hpMax: HEAVY_KILL_HP }), 5, undefined);
		s.onEvent(ev({ type: "killed", hpMax: HEAVY_KILL_HP }), 5, undefined);
		expect(s.look(0, 1, 5 + HEAVY_KILL_FREEZE_MS / MS - D, 1).hold).toBe(true);
		expect(s.look(0, 1, 5 + HEAVY_KILL_FREEZE_MS / MS + D, 1).hold).toBe(false);
		// A regular kill: KILL_FREEZE_MS (longer than the hit's own hold).
		s.onEvent(ev({ slot: 2, actorId: 9 }), 0, undefined);
		s.onEvent(ev({ type: "killed", slot: 2, actorId: 9 }), 0, undefined);
		expect(KILL_FREEZE_MS / MS).toBeGreaterThan(FEEL_HIT.holdSec);
		expect(s.look(2, 9, KILL_FREEZE_MS / MS - D, 1).hold).toBe(true);
		expect(s.look(2, 9, KILL_FREEZE_MS / MS + D, 1).hold).toBe(false);
		// The boss: its 'killed' asks nothing, its 'bossDefeated' the boss death freeze.
		s.onEvent(ev({ type: "killed", slot: 3, actorId: 4, boss: true }), 0, undefined);
		expect(s.look(3, 4, 0, 1).hold).toBe(false);
		s.onEvent(ev({ type: "bossDefeated", slot: 3, actorId: 4, boss: true }), 0, undefined);
		expect(s.look(3, 4, BOSS_DEATH_FREEZE_MS / MS - D, 1).hold).toBe(true);
	});

	it("reduced motion (motion 0) shows the flash only", () => {
		const s = new HitReactSlots(BASIS);
		s.onEvent(ev({ heavy: true }), 0, point(-1, 0));
		s.onEvent(ev({ type: "killed" }), 0, point(-1, 0));
		const look = s.look(0, 1, 0, 0);
		expect(look.rimFlash).toBe(true);
		expect(look.hold).toBe(false);
		expect(look.pushX).toBe(0);
		expect(look.pushY).toBe(0);
	});

	it("keys by (slot, actorId): a new actor in the slot starts fresh, a look for another id shows nothing", () => {
		const s = new HitReactSlots(BASIS);
		s.onEvent(ev({ heavy: true }), 0, point(-1, 0));
		// Another id asks for the slot: nothing.
		let look = s.look(0, 2, 0, 1);
		expect(look.rimFlash).toBe(false);
		expect(look.hold).toBe(false);
		expect(look.pushX).toBe(0);
		// A new actor spawns in the slot: the old one's reaction is gone.
		s.onEvent(ev({ type: "spawned", actorId: 2 }), 0, undefined);
		look = s.look(0, 2, 0, 1);
		expect(look.rimFlash).toBe(false);
		expect(look.hold).toBe(false);
		expect(s.look(0, 1, 0, 1).rimFlash).toBe(false);
		// A hit on a new id with no spawn event also starts the slot fresh (and may flash at once).
		s.onEvent(ev({ actorId: 5 }), D, undefined);
		expect(s.look(0, 5, D, 1).rimFlash).toBe(true);
		expect(s.look(0, 5, D, 1).pushX).toBe(0);
		// A revive keeps the same actor's state.
		s.onEvent(ev({ type: "spawned", actorId: 5, revived: true }), D, undefined);
		expect(s.look(0, 5, D, 1).rimFlash).toBe(true);
	});

	it("'reset' forgets every slot; other events and bad slots are ignored", () => {
		const s = new HitReactSlots(BASIS);
		s.onEvent(ev(), 0, undefined);
		s.onEvent(ev({ type: "reset", slot: -1, actorId: 0 }), 0, undefined);
		expect(s.look(0, 1, 0, 1).rimFlash).toBe(false);
		s.onEvent(ev({ type: "bossPhase" }), 0, undefined);
		expect(s.look(0, 1, 0, 1).rimFlash).toBe(false);
		s.onEvent(ev({ slot: s.capacity }), 0, undefined);
		expect(s.look(s.capacity, 1, 0, 1).rimFlash).toBe(false);
		expect(s.look(-1, 1, 0, 1).hold).toBe(false);
	});

	it("the sprite rim draws while shown or flashing", () => {
		expect(spriteRimShown(true, false)).toBe(true);
		expect(spriteRimShown(false, true)).toBe(true);
		expect(spriteRimShown(false, false)).toBe(false);
	});

	it("a push of (x, y) texels is that many texels along the camera's right / up in studs", () => {
		const out = [0, 0, 0];
		pushOffsetStuds(2, 0, BASIS, out);
		const len = math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
		expect(len).toBeCloseTo(2 * FEEL_HIT.texelStuds, 9);
		expect(out[1]).toBe(0); // camera right is level
		pushOffsetStuds(0, 1, BASIS, out);
		expect(out[0] * BASIS.right[0] + out[1] * BASIS.right[1] + out[2] * BASIS.right[2]).toBeCloseTo(0, 9);
		expect(out[0] * BASIS.up[0] + out[1] * BASIS.up[1] + out[2] * BASIS.up[2]).toBeCloseTo(FEEL_HIT.texelStuds, 9);
	});

	it("nearestLivingPlayer: interpolated, skips the dead, false when the party is down", () => {
		const s = createSimState(1, 0, 0, { party: { size: 2 } });
		const a = playerAt(s, 0);
		const b = playerAt(s, 1);
		a.prevX = 0;
		a.x = 2;
		a.prevZ = 0;
		a.z = 0;
		b.prevX = 10;
		b.x = 10;
		b.prevZ = 0;
		b.z = 0;
		const out = point(0, 0);
		expect(nearestLivingPlayer(s, 0.5, 0, 0, out)).toBe(true);
		expect(out.x).toBe(1);
		expect(nearestLivingPlayer(s, 0.5, 9, 0, out)).toBe(true);
		expect(out.x).toBe(10);
		b.dead = 1;
		expect(nearestLivingPlayer(s, 0.5, 9, 0, out)).toBe(true);
		expect(out.x).toBe(1);
		a.dead = 1;
		expect(nearestLivingPlayer(s, 0.5, 9, 0, out)).toBe(false);
	});
});
