/**
 * The second endless set on screen (docs/NEW_ENEMIES.md NE8): the pure rules the client renderers share, in plain
 * numbers so they run headlessly (newEnemies.spec.ts). Presentation only: read-only on the sim, nothing here feeds
 * `step()`. Tunables: newEnemiesConfig.ts.
 *
 *   Bomber      the fuse flash (bomberFuseFlashOn: the flash / telegraph looks alternating ever faster over the fuse);
 *               the detonation (bomberDetonated: v[BOMBER_FUSED] = BOMBER_DETONATED on the corpse), its corpse length
 *               without a `death.2` animation (detonationCorpseView: a quick fade) and DetonationWatch (the frame a
 *               Bomber blew up, for the burst)
 *   Charger /   the stun / dizzy marker (dizzyMarked: the Charger's CHARGER_STUN, the Reaper's REAPER_DIZZY) and its
 *   Reaper      stars (dizzyStarSegments, a placeholder for an fx)
 *   Warbanner   the aura (AuraView: shared/sim warbannerAuraMask on the view's state, the actors it buffs; never a
 *               Highlight, EVD12) and the ring under each banner (auraRingSegments, the sim's auraRadius)
 *   Stormcaller the strike row's circles (markings.ts strikeRowPoint / actorFxMarkings) and the strike flash's look
 *               (isStrikePayload: the decal pool's filter; strikeDecalLook)
 *
 * @module
 */
import {
	AiState,
	BOMBER,
	BOMBER_ATTACK_FUSE,
	BOMBER_DETONATED,
	BOMBER_FUSED,
	BulletKind,
	BulletPayload,
	CHARGER,
	CHARGER_STUN,
	NO_KIND,
	REAPER,
	REAPER_DIZZY,
	WARBANNER,
	archetypeIndex,
	warbannerAuraMask,
	type ActorState,
} from "shared/sim";
import { arc, type SegmentSink } from "./markings";
import { DETONATION_VIEW, DIZZY_VIEW, FUSE_VIEW, STRIKE_VIEW } from "./newEnemiesConfig";
import type { CorpseView, GooLook } from "./variants";

const TAU = 2 * math.pi;

/** Archetype index of `id`, or NO_KIND when it is not registered. */
function kindOf(id: string): number {
	const [ok, index] = pcall(() => archetypeIndex(id));
	return ok ? (index as number) : NO_KIND;
}

let kinds: { bomber: number; charger: number; reaper: number; warbanner: number } | undefined;

/** The five's archetype indices the rules key on (resolved once). */
export function newEnemyKinds(): {
	readonly bomber: number;
	readonly charger: number;
	readonly reaper: number;
	readonly warbanner: number;
} {
	if (kinds === undefined) {
		kinds = {
			bomber: kindOf(BOMBER.id),
			charger: kindOf(CHARGER.id),
			reaper: kindOf(REAPER.id),
			warbanner: kindOf(WARBANNER.id),
		};
	}
	return kinds;
}

// ---------------------------------------------------------------------------------------------
// Bomber

/** True while the Bomber `a` fuses (its view contract: TELEGRAPH, BOMBER_ATTACK_FUSE). */
export function bomberFusing(a: Readonly<ActorState>): boolean {
	return a.alive !== 0 && a.aiState === AiState.TELEGRAPH && a.attack === BOMBER_ATTACK_FUSE;
}

/**
 * The fuse flash's on half at `aiTicks` left of the fuse (render alpha `alpha`): a chirp whose period shrinks linearly
 * from FUSE_VIEW.periodStartTicks to periodEndTicks over BOMBER.data.fuseTicks; phase = the integral of 1 / period, so
 * the flashing only ever quickens. On for the first half of every period.
 */
export function bomberFuseFlashOn(aiTicks: number, alpha: number, fuseTicks: number = BOMBER.data.fuseTicks): boolean {
	if (!(fuseTicks > 0)) return false;
	const t = math.clamp(fuseTicks - aiTicks + alpha, 0, fuseTicks);
	const f0 = 1 / FUSE_VIEW.periodStartTicks;
	const f1 = 1 / FUSE_VIEW.periodEndTicks;
	const phase = t * (f0 + ((f1 - f0) * t) / (2 * fuseTicks));
	return phase - math.floor(phase) < 0.5;
}

/** True for a Bomber corpse that detonated (the quiet death; v[BOMBER_FUSED] = BOMBER_DETONATED, hashed). */
export function bomberDetonated(a: Readonly<ActorState>): boolean {
	return a.alive === 0 && a.v[BOMBER_FUSED] === BOMBER_DETONATED;
}

/**
 * A detonated corpse's drawn length: with a `death.2` animation (`hasDetonationAnim`) the normal corpse (baseTicks:
 * the Explode plays over it); without one (placeholders, a set that lacks it) a quick fade over
 * DETONATION_VIEW.quickFadeTicks (the burst replaces the body).
 */
export function detonationCorpseView(baseTicks: number, hasDetonationAnim: boolean): CorpseView {
	if (hasDetonationAnim) return { corpseTicks: baseTicks, fadeFrom: 0 };
	return { corpseTicks: math.min(baseTicks, DETONATION_VIEW.quickFadeTicks), fadeFrom: 0 };
}

/** One detonation: the actor and where it blew up (sim units). */
export interface Detonation {
	slot: number;
	actorId: number;
	x: number;
	z: number;
}

/** The slice of SimState DetonationWatch reads. */
export interface DetonationWatchState {
	readonly tick: number;
	readonly combat: { readonly actors: ReadonlyArray<Readonly<ActorState>> };
}

/**
 * Bomber detonations by a per-frame diff of (slot, actor id) -> alive: a Bomber slot alive last frame that is a
 * detonated corpse now (bomberDetonated) blew up since. A fizzled Bomber (shot, even mid-fuse) is no detonation. A new
 * run (another state, the tick going back) forgets everything, so nothing fires on the first frame of a state.
 */
export class DetonationWatch {
	private readonly ids: number[] = [];
	private readonly wasAlive: boolean[] = [];
	private readonly out: Detonation[] = [];
	private lastState: DetonationWatchState | undefined;
	private lastTick = -1;

	constructor(private readonly capacity: number) {
		for (let i = 0; i < capacity; i++) {
			this.ids.push(0);
			this.wasAlive.push(false);
			this.out.push({ slot: 0, actorId: 0, x: 0, z: 0 });
		}
	}

	/** Diffs this frame; returns how many detonations `at(0 .. n - 1)` holds (reused records: read now, never keep). */
	update(state: DetonationWatchState, bomberKind: number): number {
		if (state !== this.lastState || state.tick < this.lastTick) {
			for (let i = 0; i < this.capacity; i++) this.ids[i] = 0;
			this.lastState = state;
		}
		this.lastTick = state.tick;
		const actors = state.combat.actors;
		const n = math.min(actors.size(), this.capacity);
		let count = 0;
		for (let i = 0; i < this.capacity; i++) {
			const a = i < n ? actors[i] : undefined;
			if (a === undefined || a.kind !== bomberKind || bomberKind === NO_KIND) {
				this.ids[i] = 0;
				continue;
			}
			if (this.ids[i] === a.id && this.wasAlive[i] && bomberDetonated(a)) {
				const d = this.out[count];
				d.slot = i;
				d.actorId = a.id;
				d.x = a.x;
				d.z = a.z;
				count++;
			}
			this.ids[i] = a.id;
			this.wasAlive[i] = a.alive !== 0;
		}
		return count;
	}

	at(i: number): Readonly<Detonation> {
		return this.out[i];
	}
}

// ---------------------------------------------------------------------------------------------
// Charger stun / Reaper dizzy

/** True while `a` is stunned (a Charger's CHARGER_STUN) or dizzy (a Reaper's REAPER_DIZZY): the punish window. */
export function dizzyMarked(a: Readonly<ActorState>): boolean {
	if (a.alive === 0 || a.kind === NO_KIND) return false;
	const k = newEnemyKinds();
	return (a.kind === k.charger && a.aiState === CHARGER_STUN) || (a.kind === k.reaper && a.aiState === REAPER_DIZZY);
}

/**
 * The stun stars around (x, z): DIZZY_VIEW.stars small crosses evenly spaced on a circle of radius + marginTiles,
 * turning turnsPerSec at sim time `simSec` (they freeze with the run).
 */
export function dizzyStarSegments(sink: SegmentSink, x: number, z: number, radius: number, simSec: number): void {
	const n = DIZZY_VIEW.stars;
	if (n <= 0) return;
	const r = radius + DIZZY_VIEW.marginTiles;
	const half = DIZZY_VIEW.starTiles / 2;
	const turn = simSec * DIZZY_VIEW.turnsPerSec * TAU;
	for (let i = 0; i < n; i++) {
		const h = turn + (i * TAU) / n;
		const sx = x + math.sin(h) * r;
		const sz = z + math.cos(h) * r;
		sink.seg(sx - half, sz - half, sx + half, sz + half);
		sink.seg(sx - half, sz + half, sx + half, sz - half);
	}
}

// ---------------------------------------------------------------------------------------------
// Warbanner aura

/** The slice of SimState AuraView reads. */
export interface AuraState {
	readonly combat: { readonly actors: ReadonlyArray<ActorState> };
}

/**
 * The actors a Warbanner buffs this frame: shared/sim warbannerAuraMask (the sim's own rule: living aura targets within
 * auraRadius of a living Warbanner) run on the view's state, once per frame. The sim rebuilds its mask from tick-start
 * positions; the view reads end-of-tick positions, so at the radius edge the tint can lead the buff by one tick.
 */
export class AuraView {
	private readonly mask = new Map<ActorState, number>();

	update(state: AuraState): void {
		warbannerAuraMask(state.combat.actors, this.mask);
	}

	/** True when `a` (alive, the same actor id as when the mask was built) is inside an aura. */
	buffed(a: Readonly<ActorState>): boolean {
		return a.alive !== 0 && a.id !== 0 && this.mask.get(a as ActorState) === a.id;
	}

	/** How many actors are buffed (specs / debug). */
	size(): number {
		return this.mask.size();
	}
}

/** The aura's ring around a Warbanner at (x, z): a circle of the sim's auraRadius (dashed by the layer). */
export function auraRingSegments(
	sink: SegmentSink,
	x: number,
	z: number,
	radius: number = WARBANNER.data.auraRadius,
): void {
	arc(sink, x, z, radius, 0, TAU);
}

// ---------------------------------------------------------------------------------------------
// Stormcaller strike

/** True for a strike's payload (BulletKind.STRIKE; graze bits above the layout are ignored). */
export function isStrikePayload(payload: number): boolean {
	return BulletPayload.get(payload, "kind") === BulletKind.STRIKE;
}

/**
 * A strike flash with `lifeLeft` of its `totalLife` seconds (bullet time): it lands at STRIKE_VIEW.startScale and
 * settles to 1 over popSec, fading out over its last fadeSec. Writes `out` and returns it.
 */
export function strikeDecalLook(lifeLeft: number, totalLife: number, out: GooLook): GooLook {
	const age = totalLife - lifeLeft;
	const settle = STRIKE_VIEW.popSec > 0 ? math.clamp(age / STRIKE_VIEW.popSec, 0, 1) : 1;
	out.scale = STRIKE_VIEW.startScale + (1 - STRIKE_VIEW.startScale) * settle;
	out.transparency = STRIKE_VIEW.fadeSec > 0 ? 1 - math.clamp(lifeLeft / STRIKE_VIEW.fadeSec, 0, 1) : 0;
	return out;
}
