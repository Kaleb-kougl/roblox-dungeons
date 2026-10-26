/**
 * Sprite-effect cues (docs/FX_AUDIO.md F3; a Roblox-port feature, no web source): the pure half of the client's
 * FxSpriteController. Once per rendered frame, after the frame's sim ticks, `frame()` turns the hit tracker's FX events,
 * the frame's summed SimEvents and reads of the live state into one-shot cues `{ id, x, z, rotationDeg, scale }` (sim
 * world position, ImageLabel rotation in degrees clockwise) plus the looping stairwell effect. Nothing is drawn here;
 * the controller draws the cues with the theme's `fx.*` art (a pack without that art gets no cue: `durationOf`).
 *
 * Cue sources (state wherever it keeps the fact, so a frame of 0..5 ticks loses nothing; snapshots per player / slot):
 *   fx.boss.death    FxEvent bossDefeated (any data.boss): FX_SPRITE_VIEW.bossDeathBursts, staggered on the effect
 *                    clock
 *   fx.boss.phase    FxEvent bossPhase (any data.boss) with phase >= 2 (not the fight's start)
 *   fx.boss.slam     a boss's charge LANDS (BOSS_IMPACTS): Mother Bramble's SLAM and the Demon Lord's CHARGE, each
 *                    ACTIVE with its impact mark v[MARK] 0 -> > 0 (the impact tick, after its telegraph; never during
 *                    it), at the boss
 *   fx.ember.ring    a player's Ember count dropped, at the player
 *   fx.flask         a player's flask count dropped, at the player
 *   fx.guard.shield  a player's sword guard went up (swordGuard > 0 from 0), or deleted bullets while up
 *                    (SimEvents.bulletsDeleted, at most every guardMinSec per player), ahead of the player, turned to
 *                    the facing. bulletsDeleted is the party's sum (the sim keeps no per-player count, and swings
 *                    delete bullets too), so the re-flash goes to the guarding player only when no one else could
 *                    have made the deletes: no other player's guard up (this frame or the last) and no other swing
 *                    this frame. Solo: always the player.
 *   fx.roll.dust     a player's rollTicks grew (a roll started), at the player
 *   fx.swing.<n>     a player's WeaponsState.swingTick moved: n = the sword slot's v[SWORD_V_LAST] (1, 2, 3 = finisher),
 *                    swingAheadFraction of the swing radius ahead of its origin, turned to the swing direction
 *   fx.relic.take    RunState.pedestalTaken[k] 0 -> 1, at that pedestal (spots.pedestals by room)
 *   fx.shrine.use    RunState.shrineUsed 0 -> 1, at the shrine (spots.shrine)
 *   fx.death.puff    FxEvent killed (not a boss: bossDefeated owns it)
 *   fx.breakable.splinter  `breakableSplinter(x, z)` (called by the breakable renderer when a piece breaks)
 *   fx.hit.light / fx.hit.heavy  FxEvent hit (heavy: the tracker's `heavy`), at most every hitMarkMinSec per actor
 *   fx.stairwell     loop (`loop`): while state.endless.stairsOpen and the spots' floor is the state's floor
 * Sources are taken in that order (most important first) against the budget: at most FX_SPRITE_VIEW.maxSprites live
 * effects for the effective particle level (24 / 48 / 64; one level lower under reduced motion; none when off). A cue
 * that would land within telegraphClearTiles of an actor on the frame its telegraph starts (or of a boss's charge
 * target: the slam's, the Demon Lord's charge's) is dropped: an effect never sits on a telegraph's first frame. A new
 * run (state identity, the tick going back, the tracker's reset) or a new floor drops everything (`dropAll` is set for
 * that frame).
 *
 * No allocation per frame: cues come from a fixed pool (FxCueBuffer, like FxEventBuffer), scratch arrays are reused.
 * Read-only on the sim. No Roblox API: tested headlessly (fxCues.spec.ts).
 */
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import {
	AiState,
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BossAttack,
	BossState,
	DEMONLORD_V_AUX_X,
	DEMONLORD_V_AUX_Z,
	DEMONLORD_V_MARK,
	DemonlordAttack,
	DemonlordState,
	MAX_ACTORS,
	NO_KIND,
	NO_WEAPON,
	SWORD,
	SWORD_V_LAST,
	V_AUX_X,
	V_AUX_Z,
	V_MARK,
	archetypeIndex,
	hasLeft,
	partySize,
	playerAt,
	swordGuard,
	weaponIndex,
	weaponsAt,
	type SimEvents,
	type SimState,
	type WeaponsState,
} from "shared/sim";
import type { JuiceSettings } from "shared/settings";
import type { FxId } from "shared/theme";
import { degToRad, isoBasis, type IsoBasis } from "../iso";
import { screenAngleFromBasis } from "../sprites";
import { FX_SPRITE_VIEW } from "./config";
import type { FxEvent } from "./events";
import { effectiveParticles } from "./juiceRules";

/** One effect to start this frame. Valid only during the frame it was emitted in (pooled). */
export interface FxCue {
	id: FxId;
	/** Sim world position (tiles). */
	x: number;
	z: number;
	/** ImageLabel.Rotation, degrees clockwise on screen (0: as drawn). */
	rotationDeg: number;
	/** Multiplies the theme's drawn size. */
	scale: number;
}

/** The looping stairwell effect: shown while `active`, at (x, z). */
export interface FxLoop {
	readonly id: FxId;
	active: boolean;
	x: number;
	z: number;
}

/** The FX events the mapper reads (the tracker's pooled buffer satisfies it). */
export interface FxCueEventSource {
	count(): number;
	at(
		i: number,
	): Readonly<Pick<FxEvent, "type" | "slot" | "actorId" | "x" | "z" | "heavy" | "boss" | "phase" | "tick">>;
}

/** Floor spots the cues need (DecorController's DecorScene satisfies it), world tiles. */
export interface FxSpots {
	readonly floor: number;
	readonly stairwell: { readonly x: number; readonly z: number } | undefined;
	readonly shrineRoom: number;
	readonly shrine: { readonly x: number; readonly z: number } | undefined;
	readonly pedestals: ReadonlyArray<{ readonly room: number; readonly x: number; readonly z: number }>;
}

/** One rendered frame, as the mapper sees it. */
export interface FxCueFrame {
	/** The effect clock, seconds (the hitstop clock: frozen in hitstop and while paused). */
	readonly now: number;
	/** The live sim state after this frame's ticks. Read only. */
	readonly state: Readonly<SimState>;
	/** The sim's render alpha (player positions are interpolated like the renderers). */
	readonly alpha: number;
	/** The frame's summed SimEvents (LiveRun.frameEvents). */
	readonly events: Readonly<Pick<SimEvents, "bulletsDeleted">>;
	/** The hit tracker's events of this frame. */
	readonly fx: FxCueEventSource;
	readonly settings: Readonly<JuiceSettings>;
	/** The current floor's spots (stairwell, shrine, pedestals); undefined: none of those cues. */
	readonly spots?: FxSpots;
}

/** How long an effect plays, seconds, or undefined when the pack has no art for it (then it is never cued). */
export type FxDuration = (id: FxId) => number | undefined;

/** Fixed pool of cues, refilled every frame: `count()` / `at(i)`. */
export class FxCueBuffer {
	private readonly pool: FxCue[] = [];
	private n = 0;

	constructor(readonly capacity: number = FX_SPRITE_VIEW.cueCapacity) {
		for (let i = 0; i < capacity; i++) this.pool.push({ id: "fx.hit.light", x: 0, z: 0, rotationDeg: 0, scale: 1 });
	}

	count(): number {
		return this.n;
	}

	at(i: number): FxCue {
		return this.pool[i];
	}

	clear(): void {
		this.n = 0;
	}

	/** The next pooled cue, or undefined when full. */
	push(id: FxId, x: number, z: number, rotationDeg: number, scale: number): FxCue | undefined {
		if (this.n >= this.capacity) return undefined;
		const c = this.pool[this.n];
		this.n++;
		c.id = id;
		c.x = x;
		c.z = z;
		c.rotationDeg = rotationDeg;
		c.scale = scale;
		return c;
	}
}

/**
 * A boss attack that charges to a locked target point and lands with an impact (the fx.boss.slam cue): the attack id,
 * the ACTIVE state, the impact mark slot (0 until the impact tick) and the target point's slots.
 */
export interface BossImpactRule {
	readonly bossId: string;
	readonly attack: number;
	readonly activeState: number;
	readonly markSlot: number;
	readonly targetXSlot: number;
	readonly targetZSlot: number;
}

/** The charge impacts that cue fx.boss.slam: Mother Bramble's slam and the Demon Lord's brimstone charge. */
export const BOSS_IMPACTS: ReadonlyArray<BossImpactRule> = [
	{
		bossId: BOSS_ACT1_ID,
		attack: BossAttack.SLAM,
		activeState: BossState.ACTIVE,
		markSlot: V_MARK,
		targetXSlot: V_AUX_X,
		targetZSlot: V_AUX_Z,
	},
	{
		bossId: BOSS_DEMONLORD_ID,
		attack: DemonlordAttack.CHARGE,
		activeState: DemonlordState.ACTIVE,
		markSlot: DEMONLORD_V_MARK,
		targetXSlot: DEMONLORD_V_AUX_X,
		targetZSlot: DEMONLORD_V_AUX_Z,
	},
];

const FULL_TURN = 360;
/** Effect-clock time that has not come. */
const NEVER = math.huge;

function wrapDeg(deg: number): number {
	const a = deg - math.floor(deg / FULL_TURN) * FULL_TURN;
	return a === 0 ? 0 : a;
}

function grow(arr: number[], n: number, value: number): void {
	while (arr.size() < n) arr.push(value);
}

function indexOr(get: () => number): number {
	const [ok, v] = pcall(get);
	return ok ? (v as number) : -1;
}

/** Counters for specs and the debug overlay (never reset except by `clearStats`). */
export interface FxCueStats {
	emitted: number;
	/** Cues dropped by the live budget. */
	overBudget: number;
	/** Cues dropped because they would sit on a telegraph's first frame. */
	telegraph: number;
	/** Hit marks skipped by the per-actor rate limit. */
	rateLimited: number;
}

export class FxCueMapper {
	readonly cues: FxCueBuffer;
	/** The stairwell loop (state each frame). */
	readonly loop: FxLoop = { id: "fx.stairwell", active: false, x: 0, z: 0 };
	/** This frame started a new run or floor: drop every effect drawn so far. */
	dropAll = false;
	readonly stats: FxCueStats = { emitted: 0, overBudget: 0, telegraph: 0, rateLimited: 0 };

	private readonly basis: IsoBasis;
	private readonly swordIndex: number;
	/** BOSS_IMPACTS with their archetype index (-1: not registered), parallel. */
	private readonly impactKinds: number[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = -1;
	private lastFloor = -1;
	/** End times (effect clock) of the live one-shot effects. */
	private readonly liveEnds: number[] = [];
	private budget = 0;
	private now = 0;

	// per player
	private readonly pSwingTick: number[] = [];
	private readonly pGuard: number[] = [];
	private readonly pGuardAt: number[] = [];
	private readonly pRoll: number[] = [];
	private readonly pFlask: number[] = [];
	private readonly pEmbers: number[] = [];
	// per actor slot
	private readonly aState: number[] = [];
	private readonly aMark: number[] = [];
	private readonly aHitId: number[] = [];
	private readonly aHitAt: number[] = [];
	// run
	private shrineUsed = 0;
	private readonly pedestals: number[] = [];
	// pending boss-death bursts: time, x, z, scale, burst index (parallel; fixed capacity)
	private readonly pendAt: number[] = [];
	private readonly pendX: number[] = [];
	private readonly pendZ: number[] = [];
	private readonly pendScale: number[] = [];
	// splinters queued by the breakable renderer
	private readonly splX: number[] = [];
	private readonly splZ: number[] = [];
	// this frame's telegraph spots: x, z, radius
	private readonly tgX: number[] = [];
	private readonly tgZ: number[] = [];
	private readonly tgR: number[] = [];

	constructor(private readonly durationOf: FxDuration, options: { basis?: IsoBasis; capacity?: number } = {}) {
		this.cues = new FxCueBuffer(options.capacity ?? FX_SPRITE_VIEW.cueCapacity);
		this.basis = options.basis ?? isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		this.swordIndex = indexOr(() => weaponIndex(SWORD.id));
		for (const rule of BOSS_IMPACTS) this.impactKinds.push(indexOr(() => archetypeIndex(rule.bossId)));
		grow(this.aState, MAX_ACTORS, AiState.IDLE);
		grow(this.aMark, MAX_ACTORS, 0);
		grow(this.aHitId, MAX_ACTORS, 0);
		grow(this.aHitAt, MAX_ACTORS, -NEVER);
	}

	/** Live one-shot effects as of the last frame (the budget's count). */
	liveCount(): number {
		return this.liveEnds.size();
	}

	/** A breakable piece broke at sim (x, z): a splinter burst on the next frame (dropped past splinterQueue). */
	breakableSplinter(x: number, z: number): void {
		if (this.splX.size() >= FX_SPRITE_VIEW.splinterQueue) return;
		this.splX.push(x);
		this.splZ.push(z);
	}

	/** Forget everything (live effects, pending bursts, snapshots): the next frame adopts the state silently. */
	reset(): void {
		this.liveEnds.clear();
		this.pendAt.clear();
		this.pendX.clear();
		this.pendZ.clear();
		this.pendScale.clear();
		this.splX.clear();
		this.splZ.clear();
		this.lastState = undefined;
		this.lastTick = -1;
		this.lastFloor = -1;
		this.loop.active = false;
	}

	/** One rendered frame: fills `cues` (and `loop`, `dropAll`). Returns the number of cues. */
	frame(f: FxCueFrame): number {
		const out = this.cues;
		out.clear();
		this.now = f.now;
		const state = f.state;
		const floor = state.endless !== undefined ? state.endless.floor : 0;
		let adopt = false;
		this.dropAll = false;
		if (state !== this.lastState || state.tick < this.lastTick || floor !== this.lastFloor) {
			if (this.lastState !== undefined) this.dropAll = true;
			this.forgetLive();
			adopt = true;
		}
		for (let i = 0; i < f.fx.count(); i++) {
			if (f.fx.at(i).type === "reset") {
				this.dropAll = true;
				this.forgetLive();
				adopt = true;
			}
		}
		this.lastState = state;
		this.lastTick = state.tick;
		this.lastFloor = floor;
		this.budget = FX_SPRITE_VIEW.maxSprites[effectiveParticles(f.settings)];
		this.expire();
		this.telegraphSpots(state, adopt);

		if (!adopt) {
			this.releasePending();
			this.bossCues(f);
			this.playerCues(f);
			this.runCues(f);
			for (let i = 0; i < f.fx.count(); i++) {
				const e = f.fx.at(i);
				if (e.type === "killed" && !e.boss) this.emit("fx.death.puff", e.x, e.z, 0, 1);
			}
			for (let i = 0; i < this.splX.size(); i++)
				this.emit("fx.breakable.splinter", this.splX[i], this.splZ[i], 0, 1);
			this.hitCues(f);
		}
		this.splX.clear();
		this.splZ.clear();
		this.snapshot(f);
		this.updateLoop(f);
		return out.count();
	}

	// --- budget and placement --------------------------------------------------------------------

	private forgetLive(): void {
		this.liveEnds.clear();
		this.pendAt.clear();
		this.pendX.clear();
		this.pendZ.clear();
		this.pendScale.clear();
		this.splX.clear();
		this.splZ.clear();
	}

	private expire(): void {
		const ends = this.liveEnds;
		let i = 0;
		while (i < ends.size()) {
			if (ends[i] <= this.now) {
				ends[i] = ends[ends.size() - 1];
				ends.pop();
			} else i++;
		}
	}

	/** Starts `id` at (x, z) unless the pack has no art, the budget is full or it would sit on a new telegraph. */
	private emit(id: FxId, x: number, z: number, rotationDeg: number, scale: number): void {
		const seconds = this.durationOf(id);
		if (seconds === undefined) return;
		if (this.liveEnds.size() >= this.budget) {
			this.stats.overBudget++;
			return;
		}
		for (let k = 0; k < this.tgX.size(); k++) {
			const dx = x - this.tgX[k];
			const dz = z - this.tgZ[k];
			const r = this.tgR[k];
			if (dx * dx + dz * dz <= r * r) {
				this.stats.telegraph++;
				return;
			}
		}
		if (this.cues.push(id, x, z, rotationDeg, scale) === undefined) {
			this.stats.overBudget++;
			return;
		}
		this.liveEnds.push(this.now + seconds);
		this.stats.emitted++;
	}

	/** ImageLabel.Rotation (clockwise) that turns art facing `artDeg` to the ground direction (dirX, dirZ). */
	private rotationTo(dirX: number, dirZ: number, artDeg: number): number {
		if (dirX === 0 && dirZ === 0) return 0;
		return wrapDeg(artDeg - screenAngleFromBasis(dirX, dirZ, this.basis));
	}

	/** The impact rule of actor `a`'s running attack, or undefined (not a charging boss). */
	private impactOf(a: Readonly<{ kind: number; attack: number }>): BossImpactRule | undefined {
		for (let k = 0; k < this.impactKinds.size(); k++) {
			const rule = BOSS_IMPACTS[k];
			if (this.impactKinds[k] >= 0 && a.kind === this.impactKinds[k] && a.attack === rule.attack) return rule;
		}
		return undefined;
	}

	/** Actors whose telegraph starts this frame (aiState became TELEGRAPH), and a charging boss's target. */
	private telegraphSpots(state: Readonly<SimState>, adopt: boolean): void {
		this.tgX.clear();
		this.tgZ.clear();
		this.tgR.clear();
		if (adopt) return;
		const actors = state.combat.actors;
		const n = math.min(actors.size(), MAX_ACTORS);
		const clear = FX_SPRITE_VIEW.telegraphClearTiles;
		for (let i = 0; i < n; i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			if (a.aiState !== AiState.TELEGRAPH || this.aState[i] === AiState.TELEGRAPH) continue;
			this.tgX.push(a.x);
			this.tgZ.push(a.z);
			this.tgR.push(a.radius + clear);
			const impact = this.impactOf(a);
			if (impact !== undefined) {
				this.tgX.push(a.v[impact.targetXSlot]);
				this.tgZ.push(a.v[impact.targetZSlot]);
				this.tgR.push(a.radius + clear);
			}
		}
	}

	// --- sources ---------------------------------------------------------------------------------

	private releasePending(): void {
		let i = 0;
		while (i < this.pendAt.size()) {
			if (this.pendAt[i] <= this.now) {
				this.emit("fx.boss.death", this.pendX[i], this.pendZ[i], 0, this.pendScale[i]);
				const last = this.pendAt.size() - 1;
				this.pendAt[i] = this.pendAt[last];
				this.pendX[i] = this.pendX[last];
				this.pendZ[i] = this.pendZ[last];
				this.pendScale[i] = this.pendScale[last];
				this.pendAt.pop();
				this.pendX.pop();
				this.pendZ.pop();
				this.pendScale.pop();
			} else i++;
		}
	}

	private bossCues(f: FxCueFrame): void {
		for (let i = 0; i < f.fx.count(); i++) {
			const e = f.fx.at(i);
			if (e.type === "bossDefeated") {
				for (const b of FX_SPRITE_VIEW.bossDeathBursts) {
					if (b.delaySec <= 0) this.emit("fx.boss.death", e.x + b.dx, e.z + b.dz, 0, b.scale);
					else {
						this.pendAt.push(this.now + b.delaySec);
						this.pendX.push(e.x + b.dx);
						this.pendZ.push(e.z + b.dz);
						this.pendScale.push(b.scale);
					}
				}
			} else if (e.type === "bossPhase" && e.phase >= 2) this.emit("fx.boss.phase", e.x, e.z, 0, 1);
		}
		const actors = f.state.combat.actors;
		const n = math.min(actors.size(), MAX_ACTORS);
		for (let i = 0; i < n; i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			const impact = this.impactOf(a);
			if (
				impact !== undefined &&
				a.aiState === impact.activeState &&
				a.v[impact.markSlot] > 0 &&
				this.aMark[i] === 0
			) {
				const x = a.prevX + (a.x - a.prevX) * f.alpha;
				const z = a.prevZ + (a.z - a.prevZ) * f.alpha;
				this.emit("fx.boss.slam", x, z, 0, 1);
			}
		}
	}

	private swordSwingIndex(w: Readonly<WeaponsState>): number {
		if (this.swordIndex === NO_WEAPON || this.swordIndex < 0) return 1;
		for (const slot of w.sets) {
			if (slot.weapon === this.swordIndex) {
				const last = slot.v[SWORD_V_LAST];
				return last >= 1 && last <= 3 ? last : 1;
			}
		}
		return 1;
	}

	private guardOf(w: Readonly<WeaponsState>): number {
		const active = w.sets[w.activeSet];
		if (active === undefined || active.weapon === NO_WEAPON || active.weapon !== this.swordIndex) return 0;
		return swordGuard(active);
	}

	/**
	 * The one player who could have deleted this frame's enemy bullets (guard up now or last frame, or a swing this
	 * frame), or -1 when none or several could: a re-flash needs an unambiguous deleter.
	 */
	private soleDeflector(state: Readonly<SimState>, n: number): number {
		let sole = -1;
		for (let i = 0; i < n; i++) {
			if (hasLeft(state, i) || i >= this.pEmbers.size()) continue;
			const w = weaponsAt(state, i);
			const swung = w.swingTick >= 0 && w.swingTick !== this.pSwingTick[i];
			if (this.guardOf(w) <= 0 && this.pGuard[i] <= 0 && !swung) continue;
			if (sole >= 0) return -1;
			sole = i;
		}
		return sole;
	}

	private playerCues(f: FxCueFrame): void {
		const state = f.state;
		const n = partySize(state);
		const V = FX_SPRITE_VIEW;
		const deflector = f.events.bulletsDeleted > 0 ? this.soleDeflector(state, n) : -1;
		for (let i = 0; i < n; i++) {
			if (hasLeft(state, i) || i >= this.pEmbers.size()) continue;
			const p = playerAt(state, i);
			const w = weaponsAt(state, i);
			const px = p.prevX + (p.x - p.prevX) * f.alpha;
			const pz = p.prevZ + (p.z - p.prevZ) * f.alpha;
			if (p.embers < this.pEmbers[i]) this.emit("fx.ember.ring", px, pz, 0, 1);
			if (p.flask < this.pFlask[i]) this.emit("fx.flask", px, pz, 0, 1);
			const g = this.guardOf(w);
			if (g > 0 && p.dead === 0) {
				const fresh = this.pGuard[i] <= 0;
				const deflect = deflector === i && this.now - this.pGuardAt[i] >= V.guardMinSec;
				if (fresh || deflect) {
					this.pGuardAt[i] = this.now;
					this.emit(
						"fx.guard.shield",
						px + p.faceX * V.guardAheadTiles,
						pz + p.faceZ * V.guardAheadTiles,
						this.rotationTo(p.faceX, p.faceZ, V.guardArtHeadingDeg),
						1,
					);
				}
			}
			if (p.rollTicks > this.pRoll[i]) this.emit("fx.roll.dust", px, pz, 0, 1);
			if (w.swingTick >= 0 && w.swingTick !== this.pSwingTick[i]) {
				const k = this.swordSwingIndex(w);
				const id: FxId = k === 3 ? "fx.swing.3" : k === 2 ? "fx.swing.2" : "fx.swing.1";
				const ahead = w.swingRadius * V.swingAheadFraction;
				this.emit(
					id,
					w.swingX + w.swingDirX * ahead,
					w.swingZ + w.swingDirZ * ahead,
					this.rotationTo(w.swingDirX, w.swingDirZ, V.swingArtHeadingDeg),
					1,
				);
			}
		}
	}

	private runCues(f: FxCueFrame): void {
		const run = f.state.run;
		const spots = f.spots;
		if (run === undefined || spots === undefined || spots.floor !== this.lastFloor) return;
		for (let k = 0; k < run.pedestalTaken.size(); k++) {
			if (run.pedestalTaken[k] !== 1 || this.pedestals[k] === 1) continue;
			const room = run.pedestalRooms[k];
			for (const p of spots.pedestals) {
				if (p.room === room) {
					this.emit("fx.relic.take", p.x, p.z, 0, 1);
					break;
				}
			}
		}
		const shrine = spots.shrine;
		if (
			run.shrineUsed === 1 &&
			this.shrineUsed !== 1 &&
			shrine !== undefined &&
			run.shrineRoom === spots.shrineRoom
		) {
			this.emit("fx.shrine.use", shrine.x, shrine.z, 0, 1);
		}
	}

	private hitCues(f: FxCueFrame): void {
		const V = FX_SPRITE_VIEW;
		const rotations = V.hitRotationsDeg;
		for (let i = 0; i < f.fx.count(); i++) {
			const e = f.fx.at(i);
			if (e.type !== "hit" || e.slot < 0 || e.slot >= MAX_ACTORS) continue;
			if (this.aHitId[e.slot] === e.actorId && this.now - this.aHitAt[e.slot] < V.hitMarkMinSec) {
				this.stats.rateLimited++;
				continue;
			}
			this.aHitId[e.slot] = e.actorId;
			this.aHitAt[e.slot] = this.now;
			const rot = rotations.size() > 0 ? rotations[(e.actorId + e.tick) % rotations.size()] : 0;
			this.emit(e.heavy ? "fx.hit.heavy" : "fx.hit.light", e.x, e.z, rot, 1);
		}
	}

	// --- snapshots and the loop ------------------------------------------------------------------

	private snapshot(f: FxCueFrame): void {
		const state = f.state;
		const n = partySize(state);
		grow(this.pSwingTick, n, -1);
		grow(this.pGuard, n, 0);
		grow(this.pGuardAt, n, -NEVER);
		grow(this.pRoll, n, 0);
		grow(this.pFlask, n, 0);
		grow(this.pEmbers, n, 0);
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			const w = weaponsAt(state, i);
			this.pSwingTick[i] = w.swingTick;
			this.pGuard[i] = this.guardOf(w);
			this.pRoll[i] = p.rollTicks;
			this.pFlask[i] = p.flask;
			this.pEmbers[i] = p.embers;
		}
		const actors = state.combat.actors;
		const m = math.min(actors.size(), MAX_ACTORS);
		for (let i = 0; i < MAX_ACTORS; i++) {
			const a = i < m ? actors[i] : undefined;
			const present = a !== undefined && a.kind !== NO_KIND && a.alive !== 0;
			this.aState[i] = present ? a.aiState : AiState.IDLE;
			const impact = present ? this.impactOf(a) : undefined;
			this.aMark[i] = present && impact !== undefined ? a.v[impact.markSlot] : 0;
		}
		const run = state.run;
		this.shrineUsed = run !== undefined ? run.shrineUsed : 0;
		const taken = run !== undefined ? run.pedestalTaken : undefined;
		const count = taken !== undefined ? taken.size() : 0;
		for (let k = 0; k < count; k++) this.pedestals[k] = (taken as ReadonlyArray<number>)[k];
		for (let k = this.pedestals.size() - 1; k >= count; k--) this.pedestals.pop();
	}

	private updateLoop(f: FxCueFrame): void {
		const loop = this.loop;
		const endless = f.state.endless;
		const spots = f.spots;
		const stair = spots !== undefined ? spots.stairwell : undefined;
		const open =
			endless !== undefined &&
			endless.stairsOpen === 1 &&
			spots !== undefined &&
			spots.floor === endless.floor &&
			stair !== undefined &&
			this.budget > 0 &&
			this.durationOf(loop.id) !== undefined;
		loop.active = open;
		if (open && stair !== undefined) {
			loop.x = stair.x;
			loop.z = stair.z;
		}
	}
}
