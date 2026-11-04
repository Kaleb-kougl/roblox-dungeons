/**
 * DecorDirector (docs/DECOR.md Phase 2 part 3, task R10; a Roblox-port feature, no web source): how the decoration
 * reacts to the run, as a pure director built like the TutorialDirector. The client (DecorController) calls
 * `update(frame)` once per rendered frame, after the frame's sim ticks, with the live state (read only), the frame's
 * accumulated events, the floor's DecorScene and the real dt; it returns a reused DecorView the renderers apply. It
 * never writes the sim, and for a given frame sequence it always gives the same views (no clock, no randomness).
 *
 * What it reads (state wherever the state keeps the fact, so a frame that ran several ticks, or none, loses nothing;
 * the one event read, emberUsed, is backed by a diff of every player's Ember count):
 *   state.endless     the floor (a scene for another floor is not applied), roomsEntered, stairsOpen
 *   state.score       per-room records: engaged (engageTick >= 0, not cleared) and cleared
 *   state.combat      the live boss: engaged (phase > 0), its phase, its death
 *   state.run         shrineUsed, pedestalTaken (by RunState.pedestalRooms)
 *   players           positions (the sweep origin: the nearest living player), Embers, all down (isPartyWiped)
 *
 * The trigger table (docs/DECOR.md Phase 2 part 3):
 *   room not entered       its torches out, braziers dark (corridor torches are lit from the start)
 *   first entry            torches light in a sweep from the entering player (the door), DECOR_REACT.igniteStepSeconds
 *                          apart (x motionScale), nearest first; each fades in over igniteFadeSeconds
 *   engaged / cleared      engaged: flame height -> engagedFlameScale; cleared: the room's braziers light with a warm
 *                          flare. A room without a score record (entrance, treasure, shrine, empty) counts as cleared on
 *                          entry, so its braziers light with its torches
 *   boss floor             the boss room stays dark until the boss is engaged (its torches then sweep from the player);
 *                          the boss ring (DecorScene.bossRing: flat fire pits, see scene.ts) lights one more
 *                          1 / bossPhases on each phase; everything lit and steady after the kill (its braziers flare)
 *   stairwell open         stairGlow -> 1 (a boss floor: after the kill; other floors: from the start)
 *   shrine used            shrineDim -> 1 (its crystal dims; the shrine's fixed lights dim); pacts (docs/FORTUNE.md):
 *                          once nothing is left at the floor's altars (shared/sim pactsSpent)
 *   pedestal taken         that pedestal's glint -> 0
 *   Ember                  gutter: 1 -> 0 over emberGutterSeconds (x motionScale), every flame on screen
 *   run over (all down)    cold: 0 -> 1 over coldFadeSeconds (lights fade to the cold palette)
 *
 * A new scene (floor change), a new state (restart) or the tick going back resets the director; the first frame after
 * a reset SNAPS (no sweep, no flare): what the state already says is shown at once. While a draft is open the view is
 * returned unchanged (no time passes; a new floor's snap is still taken, at dt 0); the client does not call update while the run is paused. Co-op: everything is
 * read from the shared state, so every client shows the same rooms lit.
 *
 * The view object is reused: update() mutates and returns the same DecorView (and its arrays) every frame.
 */
import {
	NO_KIND,
	archetypeAt,
	isDraftOpen,
	isPartyWiped,
	nearestLivingPlayer,
	pactsSpent,
	partySize,
	playerAt,
	type ActorState,
	type SimEvents,
	type SimState,
} from "shared/sim";
import type { DecorEntry } from "./decorPlan";
import { DECOR_REACT } from "./reactConfig";
import type { DecorScene } from "./scene";

/** One rendered frame, as the director sees it. */
export interface DecorFrame {
	/** The live sim state after this frame's ticks. Read only. */
	readonly state: Readonly<SimState>;
	/** The frame's accumulated sim events (LiveRun.frameEvents / RunView.frameEvents). */
	readonly events: Readonly<Pick<SimEvents, "emberUsed">>;
	/** The current floor's scene (DecorController builds it per floor); undefined: nothing to direct. */
	readonly scene: DecorScene | undefined;
	/** Real seconds since the previous frame. */
	readonly dt: number;
	/** The juice motionScale (1 normally, 0 under reduced motion); default 1. */
	readonly motion?: number;
}

/** What the renderers apply. Reused and mutated by every update() (see the file comment). */
export interface DecorView {
	/** The view describes `scene` and the state's floor (false: no scene, or the scene is for another floor). */
	ready: boolean;
	scene: DecorScene | undefined;
	/** Grows on every reset (new floor, restart): renderers rebuild what they keyed on the old view. */
	revision: number;
	/** Director seconds (advances only on frames it updates). */
	time: number;
	/** This frame was a reset's snap (what the state says shown at once: renderers play no effect for it). */
	snapped: boolean;
	/** Per plan entry: light level 0..1 (0 for every entry that is not a light, and for dead torches). */
	readonly lit: number[];
	/** Per plan entry: the light's ignition is scheduled (state-derived; for specs and the debug overlay). */
	readonly ignited: boolean[];
	/** Per plan entry: a warm flare 1 -> 0 (a brazier lit by a room clear). */
	readonly flare: number[];
	/** Per plan entry: flame height multiplier (1; engagedFlameScale while its room is engaged). */
	readonly flame: number[];
	/** Per plan entry: dim level 0..1 (the shrine crystal once the shrine is used). */
	readonly dim: number[];
	/** Per room id. */
	readonly roomEntered: boolean[];
	readonly roomEngaged: boolean[];
	readonly roomCleared: boolean[];
	/** Per DecorScene.bossRing spot: fire pit level 0..1. */
	readonly ring: number[];
	/** The ring is steady (no flicker): not a boss floor, or the boss is dead. */
	ringSteady: boolean;
	bossFloor: boolean;
	bossEngaged: boolean;
	/** The live boss's phase (0 none). */
	bossPhase: number;
	bossDefeated: boolean;
	stairOpen: boolean;
	/** The stairwell's glow 0..1. */
	stairGlow: number;
	/** The used shrine's dim 0..1. */
	shrineDim: number;
	/** Per DecorScene.pedestals: glint level 0..1 (1 until taken; 0 without progression state). */
	readonly glint: number[];
	/** The Ember gutter, 1 -> 0 (x motionScale). */
	gutter: number;
	/** The run-over fade to the cold palette, 0 -> 1. */
	cold: number;
}

/** Never (a time that has not come: math.huge) and always (already past at any time: -math.huge). */
const NEVER = math.huge;
const ALWAYS = -math.huge;

function newView(): DecorView {
	return {
		ready: false,
		scene: undefined,
		revision: 0,
		time: 0,
		snapped: false,
		lit: [],
		ignited: [],
		flare: [],
		flame: [],
		dim: [],
		roomEntered: [],
		roomEngaged: [],
		roomCleared: [],
		ring: [],
		ringSteady: true,
		bossFloor: false,
		bossEngaged: false,
		bossPhase: 0,
		bossDefeated: false,
		stairOpen: false,
		stairGlow: 0,
		shrineDim: 0,
		glint: [],
		gutter: 0,
		cold: 0,
	};
}

function fill<T extends defined>(arr: T[], n: number, value: T): void {
	for (let i = 0; i < n; i++) arr[i] = value;
	for (let i = arr.size() - 1; i >= n; i--) arr.pop();
}

/** 0..1 ramp of `seconds` since `at` (NEVER: 0, ALWAYS: 1). */
function ramp(t: number, at: number, seconds: number): number {
	if (at === NEVER) return 0;
	if (at === ALWAYS || seconds <= 0) return 1;
	return math.clamp((t - at) / seconds, 0, 1);
}

/** 1 -> 0 over `seconds` since `at` (NEVER / ALWAYS: 0). */
function decay(t: number, at: number, seconds: number): number {
	if (at === NEVER || at === ALWAYS || seconds <= 0) return 0;
	return math.clamp(1 - (t - at) / seconds, 0, 1);
}

/** `value` moved toward `target` by dt / seconds (snaps when seconds <= 0). */
function approach(value: number, target: number, dt: number, seconds: number): number {
	if (seconds <= 0) return target;
	const stepSize = dt / seconds;
	return value < target ? math.min(target, value + stepSize) : math.max(target, value - stepSize);
}

/** The live boss actor (archetype data.boss, alive), if any. */
export function decorLiveBoss(state: Readonly<SimState>): Readonly<ActorState> | undefined {
	for (const a of state.combat.actors) {
		if (a.kind !== NO_KIND && a.alive !== 0 && archetypeAt(a.kind).data.boss === true) return a;
	}
	return undefined;
}

function isBrazier(e: DecorEntry): boolean {
	return e.kind === "brazier";
}

export class DecorDirector {
	private readonly view = newView();
	private scene: DecorScene | undefined;
	private lastState: Readonly<SimState> | undefined;
	private lastTick = -1;
	/** The next update snaps (first frame after a reset). */
	private snap = true;
	/** Per entry: when it ignites / flared (director time; NEVER / ALWAYS). */
	private readonly igniteAt: number[] = [];
	private readonly flareAt: number[] = [];
	/** Per room: its torches were scheduled / its braziers were scheduled. */
	private readonly roomIgnited: boolean[] = [];
	private readonly roomBraziers: boolean[] = [];
	/** Per ring spot: when it lit. */
	private readonly ringAt: number[] = [];
	private bossSeen = false;
	private gutterAt = NEVER;
	private coldAt = NEVER;
	/** Every player's Ember count last frame (an Ember used shows as a drop). */
	private readonly embers: number[] = [];
	/** Scratch: a room's torches with their distance to the sweep origin. */
	private readonly sweep: number[] = [];
	private readonly sweepD2: number[] = [];

	/** The view as of the last update (the same object update returns). */
	getView(): DecorView {
		return this.view;
	}

	update(frame: DecorFrame): DecorView {
		const v = this.view;
		const scene = frame.scene;
		const state = frame.state;
		if (scene === undefined) {
			v.ready = false;
			return v;
		}
		const endless = state.endless;
		if (endless !== undefined && endless.floor !== scene.floor) {
			// The floor changed and its scene is not built yet: keep the old view, do not apply it.
			v.ready = false;
			return v;
		}
		if (scene !== this.scene || state !== this.lastState || state.tick < this.lastTick) this.reset(scene, state);
		this.lastState = state;
		this.lastTick = state.tick;
		v.ready = true;
		// A draft freezes the world, so the decoration too; a new floor's first look is still taken (it takes no time).
		const frozen = isDraftOpen(state);
		if (frozen && !this.snap) return v;

		const snap = this.snap;
		this.snap = false;
		v.snapped = snap;
		const motion = math.clamp(frame.motion ?? 1, 0, 1);
		const dt = snap || frozen ? 0 : math.clamp(frame.dt, 0, DECOR_REACT.maxDtSeconds);
		v.time += dt;
		const t = v.time;
		const R = DECOR_REACT;

		// --- boss --------------------------------------------------------------------------------
		const boss = decorLiveBoss(state);
		if (boss !== undefined) this.bossSeen = true;
		const bossFloor = scene.bossFloor ?? this.bossSeen;
		v.bossFloor = bossFloor;
		v.bossEngaged = boss !== undefined && boss.phase > 0;
		v.bossPhase = boss !== undefined ? boss.phase : 0;
		if (
			bossFloor &&
			!v.bossDefeated &&
			((endless !== undefined && endless.stairsOpen === 1) || (this.bossSeen && boss === undefined))
		)
			v.bossDefeated = true;

		// --- rooms -------------------------------------------------------------------------------
		const plan = scene.plan;
		const entries = plan.entries;
		const score = state.score;
		const n = scene.roomCount;
		for (let r = 0; r < n; r++) {
			v.roomEngaged[r] = false;
			v.roomCleared[r] = false;
		}
		if (score !== undefined) {
			for (const rec of score.rooms) {
				if (rec.room < 0 || rec.room >= n) continue;
				v.roomCleared[rec.room] = rec.cleared === 1;
				v.roomEngaged[rec.room] = rec.engageTick >= 0 && rec.cleared === 0;
			}
		}
		const hasRecord = this.recordFlags(state, n);
		for (let r = 0; r < n; r++) {
			const entered = endless !== undefined ? endless.roomsEntered[r] === 1 : true;
			v.roomEntered[r] = entered;
			let ignite = entered;
			let cleared = hasRecord[r] ? v.roomCleared[r] : entered;
			if (r === scene.bossRoom && bossFloor) {
				ignite = v.bossEngaged || v.bossDefeated;
				cleared = v.bossDefeated;
				v.roomEngaged[r] = v.bossEngaged && !v.bossDefeated;
				v.roomCleared[r] = v.bossDefeated;
			} else if (!hasRecord[r]) v.roomCleared[r] = cleared;
			if (ignite && !this.roomIgnited[r]) {
				this.roomIgnited[r] = true;
				this.igniteRoom(state, scene, r, snap ? ALWAYS : t, snap ? 0 : R.igniteStepSeconds * motion);
			}
			if (cleared && !this.roomBraziers[r]) {
				this.roomBraziers[r] = true;
				for (const i of plan.lightsByRoom[r] ?? []) {
					if (!isBrazier(entries[i])) continue;
					this.igniteAt[i] = snap ? ALWAYS : t;
					this.flareAt[i] = snap ? NEVER : t;
				}
			}
		}

		// --- per entry ---------------------------------------------------------------------------
		for (let i = 0; i < entries.size(); i++) {
			const e = entries[i];
			if (!e.light || !e.lit) {
				v.lit[i] = 0;
				v.ignited[i] = false;
				v.flare[i] = 0;
				v.flame[i] = 1;
			} else {
				v.lit[i] = ramp(t, this.igniteAt[i], R.igniteFadeSeconds);
				v.ignited[i] = this.igniteAt[i] !== NEVER;
				v.flare[i] = decay(t, this.flareAt[i], R.flareSeconds) * motion;
				const engaged = e.roomId >= 0 && e.roomId < n && v.roomEngaged[e.roomId];
				const target = engaged ? 1 + (R.engagedFlameScale - 1) * motion : 1;
				v.flame[i] = snap ? target : approach(v.flame[i], target, dt, R.flameEaseSeconds);
			}
		}

		// --- boss ring ---------------------------------------------------------------------------
		const ringN = scene.bossRing.size();
		let litCount = 0;
		if (!bossFloor) litCount = scene.bossRoom >= 0 && v.roomEntered[scene.bossRoom] ? ringN : 0;
		else if (v.bossDefeated) litCount = ringN;
		else if (v.bossEngaged) {
			const phase = math.clamp(v.bossPhase, 1, R.bossPhases);
			litCount = math.min(ringN, math.ceil((ringN * phase) / R.bossPhases));
		}
		for (let k = 0; k < ringN; k++) {
			if (k < litCount && this.ringAt[k] === NEVER) this.ringAt[k] = snap ? ALWAYS : t;
			v.ring[k] = ramp(t, this.ringAt[k], R.igniteFadeSeconds);
		}
		v.ringSteady = !bossFloor || v.bossDefeated;

		// --- stairwell, shrine, pedestals ----------------------------------------------------------
		v.stairOpen = endless !== undefined && endless.stairsOpen === 1 && scene.stairwell !== undefined;
		v.stairGlow = snap ? (v.stairOpen ? 1 : 0) : approach(v.stairGlow, v.stairOpen ? 1 : 0, dt, R.stairGlowSeconds);
		const run = state.run;
		const shrineUsed =
			run !== undefined && run.shrineRoom === scene.shrineRoom && (run.shrineUsed === 1 || pactsSpent(state));
		v.shrineDim = snap ? (shrineUsed ? 1 : 0) : approach(v.shrineDim, shrineUsed ? 1 : 0, dt, R.shrineDimSeconds);
		for (let i = 0; i < entries.size(); i++) v.dim[i] = entries[i].kind === "shrineCrystal" ? v.shrineDim : 0;
		for (let j = 0; j < scene.pedestals.size(); j++) {
			let target = 0;
			if (run !== undefined) {
				const k = run.pedestalRooms.indexOf(scene.pedestals[j].room);
				target = k >= 0 && run.pedestalTaken[k] !== 1 ? 1 : 0;
			}
			v.glint[j] = snap ? target : approach(v.glint[j], target, dt, R.glintFadeSeconds);
		}

		// --- Ember gutter, run over --------------------------------------------------------------
		if (this.emberDropped(state) || frame.events.emberUsed > 0) this.gutterAt = snap ? NEVER : t;
		v.gutter = decay(t, this.gutterAt, R.emberGutterSeconds) * motion;
		if (isPartyWiped(state)) {
			if (this.coldAt === NEVER) this.coldAt = snap ? ALWAYS : t;
		} else this.coldAt = NEVER;
		v.cold = ramp(t, this.coldAt, R.coldFadeSeconds);
		return v;
	}

	private readonly records: boolean[] = [];

	/** Per room: it has a score record (an encounter room with enemies). */
	private recordFlags(state: Readonly<SimState>, n: number): boolean[] {
		const out = this.records;
		fill(out, n, false);
		const score = state.score;
		if (score === undefined) return out;
		for (const rec of score.rooms) if (rec.room >= 0 && rec.room < n) out[rec.room] = true;
		return out;
	}

	/** Schedules room `r`'s torches: a sweep from the nearest living player, `step` seconds apart from `at`. */
	private igniteRoom(state: Readonly<SimState>, scene: DecorScene, r: number, at: number, step: number): void {
		const plan = scene.plan;
		const lights = plan.lightsByRoom[r];
		if (lights === undefined) return;
		const centre = scene.roomCentres[r];
		const cx = centre !== undefined ? centre.x : 0;
		const cz = centre !== undefined ? centre.z : 0;
		const p = playerAt(state, nearestLivingPlayer(state, cx, cz));
		const ox = p.x;
		const oz = p.z;
		const order = this.sweep;
		const d2 = this.sweepD2;
		order.clear();
		d2.clear();
		for (const i of lights) {
			const e = plan.entries[i];
			if (isBrazier(e) || !e.lit) continue; // braziers light on the clear; dead torches never
			const dx = e.x - ox;
			const dz = e.z - oz;
			// insertion by distance, ties by entry index (lights are in index order): deterministic
			const dist = dx * dx + dz * dz;
			let k = order.size();
			order.push(i);
			d2.push(dist);
			while (k > 0 && d2[k - 1] > dist) {
				order[k] = order[k - 1];
				d2[k] = d2[k - 1];
				k--;
			}
			order[k] = i;
			d2[k] = dist;
		}
		for (let k = 0; k < order.size(); k++) this.igniteAt[order[k]] = at === ALWAYS ? ALWAYS : at + k * step;
	}

	/** Some player's Ember count dropped since the last frame (the copies follow every frame). */
	private emberDropped(state: Readonly<SimState>): boolean {
		const n = partySize(state);
		let dropped = false;
		for (let i = 0; i < n; i++) {
			const e = playerAt(state, i).embers;
			const last = this.embers[i];
			if (last !== undefined && e < last) dropped = true;
			this.embers[i] = e;
		}
		for (let i = this.embers.size() - 1; i >= n; i--) this.embers.pop();
		return dropped;
	}

	/** A new scene or run: every per-floor fact forgotten; the next update snaps. */
	private reset(scene: DecorScene, state: Readonly<SimState>): void {
		const v = this.view;
		const restart = state !== this.lastState || state.tick < this.lastTick;
		this.scene = scene;
		this.snap = true;
		const m = scene.plan.entries.size();
		const n = scene.roomCount;
		fill(this.igniteAt, m, NEVER);
		fill(this.flareAt, m, NEVER);
		fill(this.roomIgnited, n, false);
		fill(this.roomBraziers, n, false);
		fill(this.ringAt, scene.bossRing.size(), NEVER);
		// corridor torches are lit from the start
		for (const i of scene.plan.corridorLights) this.igniteAt[i] = ALWAYS;
		this.bossSeen = false;
		this.gutterAt = NEVER;
		if (restart) {
			this.coldAt = NEVER;
			this.embers.clear();
		}
		v.scene = scene;
		v.revision++;
		fill(v.lit, m, 0);
		fill(v.ignited, m, false);
		fill(v.flare, m, 0);
		fill(v.flame, m, 1);
		fill(v.dim, m, 0);
		fill(v.roomEntered, n, false);
		fill(v.roomEngaged, n, false);
		fill(v.roomCleared, n, false);
		fill(v.ring, scene.bossRing.size(), 0);
		fill(v.glint, scene.pedestals.size(), 0);
		v.bossEngaged = false;
		v.bossPhase = 0;
		v.bossDefeated = false;
		v.stairOpen = false;
		v.stairGlow = 0;
		v.shrineDim = 0;
		v.gutter = 0;
		v.cold = 0;
	}
}
