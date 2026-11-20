/**
 * Hit reaction (docs/FEEL.md section 5, tasks J4 / J5): what an enemy's body does when a hit lands. Three parts, all
 * view-only (JD1, JD2: the sim position, the hitbox, never moves):
 *
 *   rim flash  the rim (sprites: the baked outline label; placeholders: the shared flashing Highlight) shows the
 *              flash colour for FEEL_HIT.flashSec. At most one flash start per actor per FEEL_HIT.minSec.
 *   hold       the actor's sprite frame stops for FEEL_HIT.holdSec on an uncapped hit, and for the kill's freeze
 *              length on a kill (KILL_FREEZE_MS, or HEAVY_KILL_FREEZE_MS for an elite / hpMax >= HEAVY_KILL_HP; the
 *              boss death BOSS_DEATH_FREEZE_MS): the co-op "local freeze"; in solo it lines up with the global one.
 *   push       the body is drawn FEEL_HIT.pushTexels (heavy hits: heavyPushTexels) whole render texels away from the
 *              nearest living player, along the camera's right / up axes; full for pushHoldSec, then eased back to 0
 *              over easeSec, each axis rounded to whole texels (JD4).
 *
 * Capped hits (FxEvent.capped, and 'capped' events) flash only. Bosses hold and flash, never pushed. Reduced motion
 * (motionScale 0) shows the flash only (JD9). Preallocated arrays per actor pool slot keyed by (slot, ActorState.id),
 * like HealthBarSlots: an event or a look for another id in the slot starts it fresh. Times are seconds of the
 * caller's hit-reaction clock (FEEL_HIT). Pure; no Roblox API; read-only on the sim.
 *
 * @module
 */
import { MAX_ACTORS, partySize, playerAt, type SimState } from "shared/sim";
import type { IsoBasis } from "../iso";
import type { FxEvent } from "./events";
import { BOSS_DEATH_FREEZE_MS, HEAVY_KILL_FREEZE_MS, HEAVY_KILL_HP, KILL_FREEZE_MS } from "./freezeRules";
import { FEEL_HIT } from "./hitReactConfig";

const MS = 1000;
/** Float slack on time comparisons. */
const EPS = 1e-6;
/** A screen direction shorter than this (the player on top of the actor) gives no push. */
const MIN_DIR = 1e-9;

/** The event fields the hit reaction reads (FxEvent satisfies it; tests pass plain objects). */
export type HitReactEvent = Pick<
	FxEvent,
	"type" | "slot" | "actorId" | "x" | "z" | "heavy" | "boss" | "elite" | "capped" | "hpMax" | "revived"
>;

/** One actor's hit reaction this frame (look()). Pooled: valid until the next look() call. */
export interface HitLook {
	/** Draw the rim in the flash colour. */
	rimFlash: boolean;
	/** Do not advance the sprite clock / frame. */
	hold: boolean;
	/** Push in whole render texels along the camera's right (x) and up (y) axes. */
	pushX: number;
	pushY: number;
}

/** A sim-space point (nearestLivingPlayer's output). */
export interface HitReactPoint {
	x: number;
	z: number;
}

/** Hold ms a kill asks for (the freeze-frame lengths, freezeRules.ts); 0 for other events and a boss's own 'killed'. */
export function killHoldMs(e: Pick<HitReactEvent, "type" | "boss" | "elite" | "hpMax">): number {
	if (e.type === "bossDefeated") return BOSS_DEATH_FREEZE_MS;
	if (e.type !== "killed" || e.boss) return 0;
	return e.elite || e.hpMax >= HEAVY_KILL_HP ? HEAVY_KILL_FREEZE_MS : KILL_FREEZE_MS;
}

/** How much of the push is left `age` seconds after the hit, in [0, 1] (full, then a linear ease back). */
export function pushFraction(age: number): number {
	if (!(age >= 0)) return 0;
	if (age < FEEL_HIT.pushHoldSec) return 1;
	const t = (age - FEEL_HIT.pushHoldSec) / FEEL_HIT.easeSec;
	return t < 1 - EPS ? 1 - t : 0;
}

/** math.round without -0. */
function wholeTexels(v: number): number {
	const r = math.round(v);
	return r === 0 ? 0 : r;
}

/**
 * Whether a sprite's rim label is shown: the normal rule's `shown` (actorOutlined) or a hit flash, which draws even
 * where the rim would be hidden (a corpse's killing blow, KV_EnemyOutline off). Visibility and the outline image still
 * apply (spriteOutlineVisible).
 */
export function spriteRimShown(shown: boolean, flashing: boolean): boolean {
	return shown || flashing;
}

/**
 * World offset (studs) of a push of (x, y) render texels along `basis`'s right / up axes, written to `out`
 * ([x, y, z]). The camera nudge's own formula (CameraController), so a push sits on the texel grid like the camera.
 */
export function pushOffsetStuds(x: number, y: number, basis: IsoBasis, out: number[]): number[] {
	const r = basis.right;
	const u = basis.up;
	const t = FEEL_HIT.texelStuds;
	out[0] = (r[0] * x + u[0] * y) * t;
	out[1] = (r[1] * x + u[1] * y) * t;
	out[2] = (r[2] * x + u[2] * y) * t;
	return out;
}

/**
 * The nearest living party member's interpolated position (sim units) to (x, z), written to `out`. False when every
 * player is dead (no push). Ties go to the lower index.
 */
export function nearestLivingPlayer(
	state: Readonly<SimState>,
	alpha: number,
	x: number,
	z: number,
	out: HitReactPoint,
): boolean {
	const n = partySize(state);
	let best = math.huge;
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead !== 0) continue;
		const px = p.prevX + (p.x - p.prevX) * alpha;
		const pz = p.prevZ + (p.z - p.prevZ) * alpha;
		const dx = px - x;
		const dz = pz - z;
		const d = dx * dx + dz * dz;
		if (d < best) {
			best = d;
			out.x = px;
			out.z = pz;
		}
	}
	return best < math.huge;
}

function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

/** Per-slot hit reaction state (docs/FEEL.md J4 / J5). Feed every tracker event to onEvent; read look() per frame. */
export class HitReactSlots {
	readonly capacity: number;
	/** ActorState.id tracked in the slot, 0 = none. */
	readonly id: number[];
	/** Start of the last rim flash (-math.huge: never). */
	readonly flashAt: number[];
	/**
	 * Time of the last hit (or capped hit), every one, not limited by FEEL_HIT.minSec like the flash (-math.huge:
	 * never). hitAge reads it: a sprite whose hit animation outlasts the 0.1 s sim flash (docs/DUMMY_ART.md DD1).
	 */
	readonly hitAt: number[];
	/** The sprite holds until this time. */
	readonly holdUntil: number[];
	/** Start of the current push (-math.huge: none). */
	readonly pushAt: number[];
	/** The push's full offset, texels along camera right / up (unrounded; look() eases and rounds it). */
	readonly pushX: number[];
	readonly pushY: number[];
	private readonly out: HitLook = { rimFlash: false, hold: false, pushX: 0, pushY: 0 };

	constructor(private readonly basis: IsoBasis, capacity: number = MAX_ACTORS) {
		this.capacity = capacity;
		this.id = filled(capacity, 0);
		this.flashAt = filled(capacity, -math.huge);
		this.hitAt = filled(capacity, -math.huge);
		this.holdUntil = filled(capacity, -math.huge);
		this.pushAt = filled(capacity, -math.huge);
		this.pushX = filled(capacity, 0);
		this.pushY = filled(capacity, 0);
	}

	/** Forget every slot (run reset). */
	clear(): void {
		for (let i = 0; i < this.capacity; i++) this.id[i] = 0;
	}

	/** Start tracking actor `id` in slot i with nothing running. */
	private adopt(i: number, id: number): void {
		this.id[i] = id;
		this.flashAt[i] = -math.huge;
		this.hitAt[i] = -math.huge;
		this.holdUntil[i] = -math.huge;
		this.pushAt[i] = -math.huge;
		this.pushX[i] = 0;
		this.pushY[i] = 0;
	}

	/**
	 * One tracker event at `now`. `toward` is the nearest living player's position (nearestLivingPlayer), undefined
	 * when there is none (no push). 'reset' clears every slot; a non-revived 'spawned' starts its slot fresh; 'hit',
	 * 'capped', 'killed' and 'bossDefeated' react. Other events are ignored. `killHolds` false (the Freeze frame setting
	 * off: freezeFrameOn) drops the kill / boss-death holds; hit holds, flashes and pushes stay.
	 */
	onEvent(e: HitReactEvent, now: number, toward: HitReactPoint | undefined, killHolds = true): void {
		if (e.type === "reset") {
			this.clear();
			return;
		}
		const i = e.slot;
		if (i < 0 || i >= this.capacity) return;
		if (e.type === "spawned") {
			if (!e.revived || this.id[i] !== e.actorId) this.adopt(i, e.actorId);
			return;
		}
		const isHit = e.type === "hit";
		const isCapped = e.type === "capped" || (isHit && e.capped);
		const holdMs = killHoldMs(e);
		if (!isHit && !isCapped && holdMs <= 0) return;
		if (this.id[i] !== e.actorId) this.adopt(i, e.actorId);

		if (isHit || isCapped) {
			this.hitAt[i] = now;
			if (now - this.flashAt[i] >= FEEL_HIT.minSec - EPS) this.flashAt[i] = now;
		}
		if (holdMs > 0 && killHolds) this.extendHold(i, now + holdMs / MS);
		if (!isHit || isCapped) return;
		// A hit hold starts only when none runs (a focused target under a hit stream would otherwise never animate).
		if (this.holdUntil[i] <= now) this.extendHold(i, now + FEEL_HIT.holdSec);
		if (e.boss || toward === undefined) return;
		const texels = e.heavy ? FEEL_HIT.heavyPushTexels : FEEL_HIT.pushTexels;
		this.startPush(i, e.x - toward.x, e.z - toward.z, texels, now);
	}

	/** Hold slot i's sprite until `endAt` if it still tracks `actorId` (docs/ROOM_CLEAR.md RC5: the co-op last-kill hold). */
	hold(i: number, actorId: number, endAt: number): void {
		if (i < 0 || i >= this.capacity || this.id[i] !== actorId) return;
		this.extendHold(i, endAt);
	}

	private extendHold(i: number, endAt: number): void {
		if (endAt > this.holdUntil[i]) this.holdUntil[i] = endAt;
	}

	/** Push along the screen projection of the ground direction (dx, dz), `texels` long. */
	private startPush(i: number, dx: number, dz: number, texels: number, now: number): void {
		const r = this.basis.right;
		const u = this.basis.up;
		const sx = dx * r[0] + dz * r[2];
		const sy = dx * u[0] + dz * u[2];
		const len = math.sqrt(sx * sx + sy * sy);
		if (len < MIN_DIR) return;
		this.pushAt[i] = now;
		this.pushX[i] = (sx / len) * texels;
		this.pushY[i] = (sy / len) * texels;
	}

	/**
	 * Seconds since slot i's last hit (or capped hit) at `now`, for actor `actorId`: math.huge when it was never hit or
	 * the slot tracks another actor. Not motion-scaled (it times an animation, not a screen shake).
	 */
	hitAge(i: number, actorId: number, now: number): number {
		if (i < 0 || i >= this.capacity || this.id[i] === 0 || this.id[i] !== actorId) return math.huge;
		const at = this.hitAt[i];
		return at === -math.huge ? math.huge : now - at;
	}

	/**
	 * Slot i's look at `now` for actor `actorId` (another id: nothing). `motion` is motionScale (0 under reduced motion:
	 * the flash only, no hold, no push). The returned object is pooled.
	 */
	look(i: number, actorId: number, now: number, motion: number): Readonly<HitLook> {
		const out = this.out;
		out.rimFlash = false;
		out.hold = false;
		out.pushX = 0;
		out.pushY = 0;
		if (i < 0 || i >= this.capacity || this.id[i] === 0 || this.id[i] !== actorId) return out;
		const flashAge = now - this.flashAt[i];
		out.rimFlash = flashAge >= 0 && flashAge < FEEL_HIT.flashSec - EPS;
		if (motion === 0) return out;
		out.hold = now < this.holdUntil[i] - EPS;
		const f = pushFraction(now - this.pushAt[i]) * motion;
		if (f > 0) {
			out.pushX = wholeTexels(this.pushX[i] * f);
			out.pushY = wholeTexels(this.pushY[i] * f);
		}
		return out;
	}
}
