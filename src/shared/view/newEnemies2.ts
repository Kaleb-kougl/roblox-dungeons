/**
 * The third endless set on screen (docs/NEW_ENEMIES_2.md NX7): the pure rules the client renderers share, in plain
 * numbers so they run headlessly (newEnemies2.spec.ts). Presentation only: read-only on the sim, nothing here feeds
 * `step()`. Tunables: newEnemies2Config.ts; sprite inputs: newEnemy2Sprites.ts; the frame's events: fx/newEnemy2Events.
 *
 *   Shieldwall  the guard arc (bulwarkGuarding: alive with v[BULWARK_GUARDING] 1; guardArcSegments: the sim's front
 *   (bulwark)   cone around its facing), the stagger stars (staggerMarked: BULWARK_STAGGER; drawn with newEnemies.ts
 *               dizzyStarSegments)
 *   Chainhook   the chain (chainTarget: to its flying HOOK bullet while THROWN, found by its emitter id with
 *               hookBulletSlot; to the hooked player while it drags, hookedPlayerOf; chainSegments from its hand)
 *   Snatcher    the belly pips (bellyPips: its carried count, v[SNATCHER_CARRIED]; bellyPipSegments, pulsing while it
 *               swallows: snatcherSwallowing, bellyPulse)
 *   Pyre-keeper the torch's flight to the landing cell over the light telegraph (torchArcPoint), the pyre's flame
 *   / pyre      (pyreFlameScale: growing while it lights, flickering once lit; reduced motion: steady)
 *   bursts      newEnemy2Bursts: the frame's sparks, guard breaks, chain snaps, gulps, fizzles and puffs as one list
 */
import {
	AiState,
	BULWARK,
	BULWARK_GUARDING,
	BULWARK_STAGGER,
	BulletKind,
	BulletPayload,
	CHAINHOOK,
	CHAINHOOK_THROWN,
	NO_KIND,
	PYRE,
	PYREKEEPER,
	PYREKEEPER_ATTACK_LIGHT,
	PYREKEEPER_LAND_X,
	PYREKEEPER_LAND_Z,
	SNATCHER,
	SNATCHER_ATTACK_SWALLOW,
	SNATCHER_CARRIED,
	archetypeIndex,
	hookedPlayerOf,
	type ActorState,
} from "shared/sim";
import { arc, type SegmentSink } from "./markings";
import type { ColorRole } from "shared/theme";
import {
	BELLY_VIEW,
	CHAIN_VIEW,
	GUARD_VIEW,
	NEW_ENEMY_2_BURSTS,
	PYRE_FLAME_VIEW,
	TORCH_VIEW,
} from "./newEnemies2Config";
import type { NewEnemy2FrameSource } from "./fx/newEnemy2Events";
import type { ChipBurst } from "./fx/particles";

const TAU = 2 * math.pi;

/** Archetype index of `id`, or NO_KIND when it is not registered. */
function kindOf(id: string): number {
	const [ok, index] = pcall(() => archetypeIndex(id));
	return ok ? (index as number) : NO_KIND;
}

/** The five's archetype indices. */
export interface NewEnemy2Kinds {
	readonly bulwark: number;
	readonly chainhook: number;
	readonly snatcher: number;
	readonly pyrekeeper: number;
	readonly pyre: number;
}

let kinds: NewEnemy2Kinds | undefined;

/** The five's archetype indices the rules key on (resolved once). */
export function newEnemy2Kinds(): NewEnemy2Kinds {
	if (kinds === undefined) {
		kinds = {
			bulwark: kindOf(BULWARK.id),
			chainhook: kindOf(CHAINHOOK.id),
			snatcher: kindOf(SNATCHER.id),
			pyrekeeper: kindOf(PYREKEEPER.id),
			pyre: kindOf(PYRE.id),
		};
	}
	return kinds;
}

function isKind(a: Readonly<ActorState>, kind: number): boolean {
	return kind !== NO_KIND && a.kind === kind && a.alive !== 0;
}

// ---------------------------------------------------------------------------------------------
// Shieldwall

/** True while the Shieldwall `a` guards (alive, v[BULWARK_GUARDING] 1: every state but its recovery and stagger). */
export function bulwarkGuarding(a: Readonly<ActorState>): boolean {
	return isKind(a, newEnemy2Kinds().bulwark) && a.v[BULWARK_GUARDING] === 1;
}

/** True while the Shieldwall `a` staggers (its guard broken, NXD7): the stars. */
export function staggerMarked(a: Readonly<ActorState>): boolean {
	return isKind(a, newEnemy2Kinds().bulwark) && a.aiState === BULWARK_STAGGER;
}

/**
 * The guard arc in front of a Shieldwall at (x, z) facing (faceX, faceZ): an arc of radius `radius` +
 * GUARD_VIEW.marginTiles spanning the sim's front cone (dot >= frontCos: acos(frontCos) either side of the facing).
 * Nothing without a facing.
 */
export function guardArcSegments(
	sink: SegmentSink,
	x: number,
	z: number,
	faceX: number,
	faceZ: number,
	radius: number,
	frontCos: number = BULWARK.data.frontCos,
): void {
	if (faceX === 0 && faceZ === 0) return;
	const h = math.atan2(faceX, faceZ);
	const half = math.acos(math.clamp(frontCos, -1, 1));
	arc(sink, x, z, radius + GUARD_VIEW.marginTiles, h - half, h + half);
}

// ---------------------------------------------------------------------------------------------
// Chainhook

/** The bullet pool slice hookBulletSlot reads (shared/sim BulletSimulation satisfies it). */
export interface HookBulletSource {
	highWater(): number;
	isLive(i: number): boolean;
	payloadAt(i: number): number;
	emitterIdAt(i: number): number;
}

/** The slot of the live HOOK bullet thrown by emitter `emitter`, or -1 (a Chainhook has at most one in flight). */
export function hookBulletSlot(sim: HookBulletSource, emitter: number): number {
	const n = sim.highWater();
	for (let i = 0; i < n; i++) {
		if (!sim.isLive(i) || sim.emitterIdAt(i) !== emitter) continue;
		if (BulletPayload.get(sim.payloadAt(i), "kind") === BulletKind.HOOK) return i;
	}
	return -1;
}

/** What a Chainhook's chain runs to this frame. */
export const ChainTarget = {
	NONE: 0,
	/** Its HOOK bullet in flight (CHAINHOOK_THROWN). */
	HOOK: 1,
	/** The player it drags (hookedPlayerOf). */
	PLAYER: 2,
} as const;
export type ChainTarget = (typeof ChainTarget)[keyof typeof ChainTarget];

/** The chain's target kind for actor `a` (any actor: NONE unless it is a living Chainhook throwing or dragging). */
export function chainTarget(a: Readonly<ActorState>): ChainTarget {
	if (!isKind(a, newEnemy2Kinds().chainhook)) return ChainTarget.NONE;
	if (a.aiState === CHAINHOOK_THROWN) return ChainTarget.HOOK;
	return hookedPlayerOf(a) >= 0 ? ChainTarget.PLAYER : ChainTarget.NONE;
}

/**
 * The chain from a Chainhook at (x, z) of body radius `radius` to (tx, tz): one segment from its hand (radius +
 * CHAIN_VIEW.handTiles out toward the target) to the target. Nothing when the target is inside its hand.
 */
export function chainSegments(sink: SegmentSink, x: number, z: number, radius: number, tx: number, tz: number): void {
	const dx = tx - x;
	const dz = tz - z;
	const len = math.sqrt(dx * dx + dz * dz);
	const hand = radius + CHAIN_VIEW.handTiles;
	if (!(len > hand)) return;
	sink.seg(x + (dx / len) * hand, z + (dz / len) * hand, tx, tz);
}

// ---------------------------------------------------------------------------------------------
// Snatcher

/** Pellets the Snatcher `a` carries (v[SNATCHER_CARRIED]), clamped to the pips; 0 for any other actor. */
export function bellyPips(a: Readonly<ActorState>): number {
	if (!isKind(a, newEnemy2Kinds().snatcher)) return 0;
	return math.clamp(a.v[SNATCHER_CARRIED], 0, BELLY_VIEW.pips);
}

/** True while the Snatcher `a` swallows (TELEGRAPH, SNATCHER_ATTACK_SWALLOW: the window to kill it). */
export function snatcherSwallowing(a: Readonly<ActorState>): boolean {
	return (
		isKind(a, newEnemy2Kinds().snatcher) && a.aiState === AiState.TELEGRAPH && a.attack === SNATCHER_ATTACK_SWALLOW
	);
}

/** The pips' radius factor at sim time `simSec`: 1, or a pulse to 1 + pulseAmp while it swallows (motion 0: steady). */
export function bellyPulse(swallowing: boolean, simSec: number, motion: number): number {
	if (!swallowing || motion <= 0) return 1;
	const w = math.abs(math.sin(math.pi * BELLY_VIEW.pulseHz * simSec));
	return 1 + BELLY_VIEW.pulseAmp * w * motion;
}

/**
 * `count` belly pips around a Snatcher at (x, z): BELLY_VIEW.pips evenly spaced slots on a ring of (radius +
 * marginTiles) x `scale`, the first `count` drawn, each a small cross.
 */
export function bellyPipSegments(
	sink: SegmentSink,
	x: number,
	z: number,
	radius: number,
	count: number,
	scale: number,
): void {
	const n = BELLY_VIEW.pips;
	if (n <= 0 || count <= 0) return;
	const r = (radius + BELLY_VIEW.marginTiles) * scale;
	const half = BELLY_VIEW.pipTiles / 2;
	for (let k = 0; k < math.min(count, n); k++) {
		const h = (k * TAU) / n;
		const px = x + math.sin(h) * r;
		const pz = z + math.cos(h) * r;
		sink.seg(px - half, pz, px + half, pz);
		sink.seg(px, pz - half, px, pz + half);
	}
}

// ---------------------------------------------------------------------------------------------
// Pyre-keeper and pyre

/** The torch in flight this frame (torchArcPoint): where it is (sim units) and how high (tiles); shown false: none. */
export interface TorchPoint {
	shown: boolean;
	x: number;
	z: number;
	heightTiles: number;
}

export function newTorchPoint(): TorchPoint {
	return { shown: false, x: 0, z: 0, heightTiles: 0 };
}

/**
 * The Pyre-keeper `a`'s torch (view-only, Architecture 4) at render alpha `alpha`: during the light telegraph
 * (TELEGRAPH, PYREKEEPER_ATTACK_LIGHT, the landing point in v[PYREKEEPER_LAND_*]) it flies over the telegraph's last
 * TORCH_VIEW.flightShare from the keeper (`kx`, `kz`: its drawn position) to the landing point on a parabola peaking at
 * arcTiles, landing as the telegraph runs out (the pyre spawns there). Writes `out` and returns it.
 */
export function torchArcPoint(
	a: Readonly<ActorState>,
	kx: number,
	kz: number,
	alpha: number,
	out: TorchPoint,
): TorchPoint {
	out.shown = false;
	if (
		!isKind(a, newEnemy2Kinds().pyrekeeper) ||
		a.aiState !== AiState.TELEGRAPH ||
		a.attack !== PYREKEEPER_ATTACK_LIGHT
	)
		return out;
	const total = PYREKEEPER.data.lightTelegraphTicks;
	const flight = total * math.clamp(TORCH_VIEW.flightShare, 0, 1);
	if (!(flight > 0)) return out;
	const elapsed = total - a.aiTicks + alpha;
	const u = (elapsed - (total - flight)) / flight;
	if (u < 0) return out;
	const t = math.min(u, 1);
	out.shown = true;
	out.x = kx + (a.v[PYREKEEPER_LAND_X] - kx) * t;
	out.z = kz + (a.v[PYREKEEPER_LAND_Z] - kz) * t;
	out.heightTiles = TORCH_VIEW.arcTiles * 4 * t * (1 - t);
	return out;
}

/** True for a living pyre (its flame is drawn: lighting or lit). */
export function pyreBurning(a: Readonly<ActorState>): boolean {
	return isKind(a, newEnemy2Kinds().pyre);
}

/**
 * The pyre `a`'s flame size factor at sim time `simSec`: while it lights (aiTicks counting PYRE.data.litTicks down)
 * it grows from PYRE_FLAME_VIEW.lightingFrom to 1; once lit (aiTicks 0) it flickers by flickerAmp (a sum of sines,
 * phased by actor id; motion 0: steady 1). 0 for anything but a living pyre.
 */
export function pyreFlameScale(a: Readonly<ActorState>, alpha: number, simSec: number, motion: number): number {
	if (!pyreBurning(a)) return 0;
	const V = PYRE_FLAME_VIEW;
	const lit = PYRE.data.litTicks;
	if (a.aiTicks > 0 && lit > 0) {
		const u = math.clamp((lit - a.aiTicks + alpha) / lit, 0, 1);
		return V.lightingFrom + (1 - V.lightingFrom) * u;
	}
	if (motion <= 0 || V.flickerHz.size() === 0) return 1;
	let n = 0;
	for (let k = 0; k < V.flickerHz.size(); k++) n += math.sin(TAU * V.flickerHz[k] * simSec + a.id * (k + 1));
	return 1 + V.flickerAmp * motion * (n / V.flickerHz.size());
}

// ---------------------------------------------------------------------------------------------
// Bursts

/** A burst's kind (ParticleController maps each to its shape and colour, NEW_ENEMY_2_BURSTS). */
export const NewEnemy2Burst = {
	BLOCK: 0,
	GUARD_BREAK: 1,
	SNAP: 2,
	GULP: 3,
	FIZZLE: 4,
	PUFF: 5,
} as const;
export type NewEnemy2Burst = (typeof NewEnemy2Burst)[keyof typeof NewEnemy2Burst];

/** A burst kind's look: its chip shape, colour role and seed salt (NEW_ENEMY_2_BURSTS). */
export interface NewEnemy2BurstLook {
	readonly shape: Readonly<ChipBurst>;
	readonly role: ColorRole;
	readonly salt: number;
}

const B = NEW_ENEMY_2_BURSTS;

/** Each NewEnemy2Burst's look, by kind (ParticleController builds its palette entries and shapes from it once). */
export const NEW_ENEMY_2_BURST_LOOKS: ReadonlyArray<NewEnemy2BurstLook> = [
	{ shape: B.block, role: B.roles.guard, salt: B.seedSalt.block },
	{ shape: B.guardBreak, role: B.roles.guard, salt: B.seedSalt.guardBreak },
	{ shape: B.snap, role: B.roles.chain, salt: B.seedSalt.snap },
	{ shape: B.gulp, role: B.roles.pellet, salt: B.seedSalt.gulp },
	{ shape: B.fizzle, role: B.roles.pellet, salt: B.seedSalt.fizzle },
	{ shape: B.puff, role: B.roles.flame, salt: B.seedSalt.puff },
];

/** One burst of the frame (sim units). */
export interface NewEnemy2BurstAt {
	kind: NewEnemy2Burst;
	x: number;
	z: number;
}

/** The Snatcher's pellet moments newEnemy2Bursts reads (shared/view/pellets PelletFrameSource satisfies it). */
export interface SnatcherPelletSource {
	readonly stolen: ReadonlyArray<{ readonly x: number; readonly z: number }>;
	readonly swallowed: ReadonlyArray<{ readonly cellX: ReadonlyArray<number>; readonly cellZ: ReadonlyArray<number> }>;
}

function pushBurst(out: NewEnemy2BurstAt[], used: number, kind: NewEnemy2Burst, x: number, z: number): number {
	let b = out[used];
	if (b === undefined) {
		b = { kind, x, z };
		out[used] = b;
	} else {
		b.kind = kind;
		b.x = x;
		b.z = z;
	}
	return used + 1;
}

/**
 * The frame's bursts, in a fixed order (blocks, guard breaks, snaps, gulps, fizzles, puffs; each in tick order): a
 * spark per block, a burst per guard break, a snap per broken chain, a gulp per stolen pellet (its cell), a fizzle on
 * every swallowed pellet's cell, a puff per pyre gone out. Writes `out` (records reused) and returns how many it holds.
 */
export function newEnemy2Bursts(
	events: NewEnemy2FrameSource,
	pellets: SnatcherPelletSource,
	out: NewEnemy2BurstAt[],
): number {
	let n = 0;
	for (let i = 0; i < events.blockX.size(); i++)
		n = pushBurst(out, n, NewEnemy2Burst.BLOCK, events.blockX[i], events.blockZ[i]);
	for (let i = 0; i < events.breakX.size(); i++)
		n = pushBurst(out, n, NewEnemy2Burst.GUARD_BREAK, events.breakX[i], events.breakZ[i]);
	for (let i = 0; i < events.snapX.size(); i++)
		n = pushBurst(out, n, NewEnemy2Burst.SNAP, events.snapX[i], events.snapZ[i]);
	for (const s of pellets.stolen) n = pushBurst(out, n, NewEnemy2Burst.GULP, s.x, s.z);
	for (const w of pellets.swallowed) {
		for (let k = 0; k < w.cellX.size(); k++) n = pushBurst(out, n, NewEnemy2Burst.FIZZLE, w.cellX[k], w.cellZ[k]);
	}
	for (let i = 0; i < events.puffX.size(); i++)
		n = pushBurst(out, n, NewEnemy2Burst.PUFF, events.puffX[i], events.puffZ[i]);
	return n;
}
