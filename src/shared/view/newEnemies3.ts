/**
 * The fourth endless set on screen (docs/NEW_ENEMIES_3.md NT7): the pure rules the client renderers share, in plain
 * numbers so they run headlessly (newEnemies3.spec.ts). Presentation only: read-only on the sim, nothing here feeds
 * `step()`. Tunables: newEnemies3Config.ts; sprite inputs: newEnemy3Sprites.ts; the frame's events: fx/newEnemy3Events.
 *
 *   Mortar   its shell is a BulletKind.STRIKE with the Mortar's payload `source` (its archetype index + 1, stamped by
 *            ctx.fireEnemy; NTD12, NT0 finding 3): isShellPayload / isLightningPayload split every strike reader (the
 *            strike flash pool, its hazard art and scorch take lightning only; the shell is the plain disc). The shell's
 *            arc from the hand to the ring over the flight (ShellArcs: the release point kept per slot, view-only), and
 *            mortarFlying / mortarCorpseFlying (NTD5: a corpse's shell still lands, so its ring and arc stay drawn)
 *   Mender   the heal tether (menderTetherAlly: only while its link or channel is live and only to a living ally;
 *            tetherShare: the beam forming over the link; tetherPulse: the bright run after each heal pulse), the `+`
 *            over a healed enemy (HealPlusMarks)
 *   Jackal   the stagger's stars (jackalStaggered: a guard stopped its lunge, NTD9; drawn with dizzyStarSegments)
 *   bursts   newEnemy3Bursts: the frame's shell impacts (dust), heal sparks and beam snaps as one list
 *
 * @module
 */
import {
	AiState,
	BulletKind,
	BulletPayload,
	JACKAL,
	JACKAL_STAGGER,
	MENDER,
	MENDER_ATTACK_HEAL,
	MENDER_CHANNEL,
	MENDER_CHANNEL_TICKS,
	MENDER_PULSE,
	MORTAR,
	MORTAR_FLIGHT,
	MORTAR_FLIGHT_TICKS,
	MORTAR_LAND_X,
	MORTAR_LAND_Z,
	NO_KIND,
	SIM_HZ,
	archetypeIndex,
	menderAllyOf,
	type ActorState,
} from "shared/sim";
import type { ColorRole } from "shared/theme";
import type { ChipBurst } from "./fx/particles";
import type { NewEnemy3FrameSource } from "./fx/newEnemy3Events";
import type { SegmentSink } from "./markings";
import { HEAL_PLUS_VIEW, HEAL_TETHER_VIEW, NEW_ENEMY_3_BURSTS, SHELL_ARC_VIEW } from "./newEnemies3Config";

/** Archetype index of `id`, or NO_KIND when it is not registered. */
function kindOf(id: string): number {
	const [ok, index] = pcall(() => archetypeIndex(id));
	return ok ? (index as number) : NO_KIND;
}

/** The three's archetype indices. */
export interface NewEnemy3Kinds {
	readonly mortar: number;
	readonly mender: number;
	readonly jackal: number;
}

let kinds: NewEnemy3Kinds | undefined;

/** The three's archetype indices the rules key on (resolved once). */
export function newEnemy3Kinds(): NewEnemy3Kinds {
	if (kinds === undefined) {
		kinds = { mortar: kindOf(MORTAR.id), mender: kindOf(MENDER.id), jackal: kindOf(JACKAL.id) };
	}
	return kinds;
}

function isKind(a: Readonly<ActorState>, kind: number): boolean {
	return kind !== NO_KIND && a.kind === kind;
}

// ---------------------------------------------------------------------------------------------
// Mortar

/** True for a Mortar's shell (BulletKind.STRIKE whose `source` is the Mortar's archetype index + 1). */
export function isShellPayload(payload: number): boolean {
	const mortar = newEnemy3Kinds().mortar;
	return (
		mortar !== NO_KIND &&
		BulletPayload.get(payload, "kind") === BulletKind.STRIKE &&
		BulletPayload.get(payload, "source") === mortar + 1
	);
}

/** True for the Stormcaller's lightning: a STRIKE that is not a Mortar's shell (the flash, its art and its scorch). */
export function isLightningPayload(payload: number): boolean {
	return BulletPayload.get(payload, "kind") === BulletKind.STRIKE && !isShellPayload(payload);
}

/** True while the Mortar `a` (alive or its corpse, NTD5) has a shell in the air (MORTAR_FLIGHT, flight ticks left). */
export function mortarFlying(a: Readonly<ActorState>): boolean {
	return (
		isKind(a, newEnemy3Kinds().mortar) && a.aiState === MORTAR_FLIGHT && a.v[MORTAR_FLIGHT_TICKS] > 0 && a.id !== 0
	);
}

/**
 * True for a dead Mortar whose shell is still in the air (NTD5: it lands on time): the view keeps drawing its ring and
 * its shell, so a visible ring never lies (TelegraphController skips every other corpse).
 */
export function mortarCorpseFlying(a: Readonly<ActorState>): boolean {
	return a.alive === 0 && mortarFlying(a);
}

/** The shell in flight this frame (ShellArcs.point): where it is (sim units) and how high (tiles); shown false: none. */
export interface ShellPoint {
	shown: boolean;
	x: number;
	z: number;
	heightTiles: number;
}

export function newShellPoint(): ShellPoint {
	return { shown: false, x: 0, z: 0, heightTiles: 0 };
}

/**
 * The shell's flight at progress `u` (0 at the release, 1 at the impact) from (fromX, fromZ) to (toX, toZ): straight
 * on the floor, its height falling from the hand (SHELL_ARC_VIEW.handTiles) to the floor plus a parabola peaking at
 * arcTiles. Writes `out` and returns it.
 */
export function shellArcAt(
	fromX: number,
	fromZ: number,
	toX: number,
	toZ: number,
	u: number,
	out: ShellPoint,
): ShellPoint {
	const t = math.clamp(u, 0, 1);
	out.shown = true;
	out.x = fromX + (toX - fromX) * t;
	out.z = fromZ + (toZ - fromZ) * t;
	out.heightTiles = SHELL_ARC_VIEW.handTiles * (1 - t) + SHELL_ARC_VIEW.arcTiles * 4 * t * (1 - t);
	return out;
}

/**
 * The Mortars' shells in flight (Architecture 4, view-only). The sim keeps the landing point (v[MORTAR_LAND_*]) but not
 * where the shell left: per actor slot this remembers the Mortar's drawn position on the first frame of each flight
 * (a new actor id, or the flight's ticks left rising again: a new lob), so the arc starts at the hand it left and does
 * not follow the Mortar as it keeps walking. `reset()` on a new run.
 */
export class ShellArcs {
	private readonly ids: number[] = [];
	private readonly lastLeft: number[] = [];
	private readonly fromX: number[] = [];
	private readonly fromZ: number[] = [];

	reset(): void {
		this.ids.clear();
		this.lastLeft.clear();
		this.fromX.clear();
		this.fromZ.clear();
	}

	/**
	 * The shell of the Mortar in actor slot `slot` (`a`, drawn at (x, z)) at render alpha `alpha`: not shown unless it
	 * flies (mortarFlying). Writes `out` and returns it.
	 */
	point(slot: number, a: Readonly<ActorState>, x: number, z: number, alpha: number, out: ShellPoint): ShellPoint {
		out.shown = false;
		while (this.ids.size() <= slot) {
			this.ids.push(0);
			this.lastLeft.push(0);
			this.fromX.push(0);
			this.fromZ.push(0);
		}
		if (!mortarFlying(a)) {
			this.ids[slot] = 0;
			return out;
		}
		const left = a.v[MORTAR_FLIGHT_TICKS];
		if (this.ids[slot] !== a.id || left > this.lastLeft[slot]) {
			this.ids[slot] = a.id;
			this.fromX[slot] = x;
			this.fromZ[slot] = z;
		}
		this.lastLeft[slot] = left;
		const total = MORTAR.data.flightTicks;
		if (!(total > 0)) return out;
		const u = (total - left + alpha) / total;
		return shellArcAt(this.fromX[slot], this.fromZ[slot], a.v[MORTAR_LAND_X], a.v[MORTAR_LAND_Z], u, out);
	}
}

// ---------------------------------------------------------------------------------------------
// Mender

/**
 * The ally the Mender `a`'s tether runs to this frame: only while `a` is alive and its link or channel is live
 * (TELEGRAPH with MENDER_ATTACK_HEAL, or MENDER_CHANNEL) and only to a living ally (v[MENDER_ALLY], menderAllyOf);
 * undefined otherwise (any other actor, keeping range, the bolt, the flinch, a corpse, a dead or freed ally).
 */
export function menderTetherAlly(
	actors: ReadonlyArray<ActorState>,
	a: Readonly<ActorState>,
): Readonly<ActorState> | undefined {
	if (!isKind(a, newEnemy3Kinds().mender) || a.alive === 0) return undefined;
	const linking = a.aiState === AiState.TELEGRAPH && a.attack === MENDER_ATTACK_HEAL;
	if (!linking && a.aiState !== MENDER_CHANNEL) return undefined;
	return menderAllyOf(actors, a);
}

/** How much of the tether is drawn (0..1): growing from the Mender over the link, whole through the channel. */
export function tetherShare(a: Readonly<ActorState>, alpha: number): number {
	if (a.aiState === MENDER_CHANNEL) return 1;
	const link = MENDER.data.linkTicks;
	if (!(link > 0)) return 1;
	return math.clamp((link - a.aiTicks + alpha) / link, 0, 1);
}

/**
 * The pulse after the last heal (1 on the pulse's tick, falling to 0 over HEAL_TETHER_VIEW.pulseSec; 0 before the
 * channel's first heal or outside the channel). v[MENDER_PULSE] is reset to pulseTicks on every heal, so the ticks since
 * it are pulseTicks - v[MENDER_PULSE] once the channel has run pulseTicks.
 */
export function tetherPulse(a: Readonly<ActorState>, alpha: number): number {
	if (a.aiState !== MENDER_CHANNEL) return 0;
	const pulse = MENDER.data.pulseTicks;
	if (a.v[MENDER_CHANNEL_TICKS] < pulse) return 0;
	const ageSec = (pulse - a.v[MENDER_PULSE] + alpha) / SIM_HZ;
	const span = HEAL_TETHER_VIEW.pulseSec;
	if (!(span > 0) || ageSec >= span) return 0;
	return 1 - math.max(ageSec, 0) / span;
}

/**
 * The tether from a Mender at (x, z) of radius `radius` to an ally at (ax, az) of radius `allyRadius`: one segment from
 * its hands (radius + handTiles toward the ally) to the ally's rim (allyRadius + allyGapTiles short of its centre), of
 * which the first `share` is drawn. Nothing when the two overlap.
 */
export function tetherSegments(
	sink: SegmentSink,
	x: number,
	z: number,
	radius: number,
	ax: number,
	az: number,
	allyRadius: number,
	share: number,
): void {
	const dx = ax - x;
	const dz = az - z;
	const len = math.sqrt(dx * dx + dz * dz);
	const from = radius + HEAL_TETHER_VIEW.handTiles;
	const to = len - allyRadius - HEAL_TETHER_VIEW.allyGapTiles;
	if (!(len > 0) || !(to > from)) return;
	const s = math.clamp(share, 0, 1);
	if (!(s > 0)) return;
	const stop = from + (to - from) * s;
	const ux = dx / len;
	const uz = dz / len;
	sink.seg(x + ux * from, z + uz * from, x + ux * stop, z + uz * stop);
}

/**
 * The `+` over each healed enemy (view-only): `push` one per heal pulse (the run view's heal positions), `segments`
 * draws every live one (sim seconds: a cross growing from fromTiles to toTiles over plusSec, offsetTiles screen-up of
 * the spot), the oldest reused past HEAL_PLUS_VIEW.max. `reset()` on a new run or floor.
 */
export class HealPlusMarks {
	private readonly x: number[] = [];
	private readonly z: number[] = [];
	private readonly start: number[] = [];
	private next = 0;

	reset(): void {
		this.x.clear();
		this.z.clear();
		this.start.clear();
		this.next = 0;
	}

	push(x: number, z: number, nowSec: number): void {
		const cap = math.max(1, HEAL_PLUS_VIEW.max);
		const i = this.x.size() < cap ? this.x.size() : this.next;
		this.x[i] = x;
		this.z[i] = z;
		this.start[i] = nowSec;
		this.next = (i + 1) % cap;
	}

	/** How many show at `nowSec`. */
	live(nowSec: number): number {
		let n = 0;
		for (let i = 0; i < this.x.size(); i++) {
			const age = nowSec - this.start[i];
			if (age >= 0 && age < HEAL_PLUS_VIEW.plusSec) n++;
		}
		return n;
	}

	/** Draws every `+` alive at `nowSec`; `upX` / `upZ`: the screen-up direction on the floor (unit). */
	segments(sink: SegmentSink, nowSec: number, upX: number, upZ: number): void {
		const V = HEAL_PLUS_VIEW;
		for (let i = 0; i < this.x.size(); i++) {
			const age = nowSec - this.start[i];
			if (age < 0 || age >= V.plusSec) continue;
			const t = V.plusSec > 0 ? age / V.plusSec : 1;
			const half = (V.fromTiles + (V.toTiles - V.fromTiles) * t) / 2;
			const cx = this.x[i] + upX * V.offsetTiles;
			const cz = this.z[i] + upZ * V.offsetTiles;
			sink.seg(cx - half, cz, cx + half, cz);
			sink.seg(cx, cz - half, cx, cz + half);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Jackal

/** True while the Jackal `a` staggers (a sword guard stopped its lunge, NTD9): the stars. */
export function jackalStaggered(a: Readonly<ActorState>): boolean {
	return isKind(a, newEnemy3Kinds().jackal) && a.alive !== 0 && a.aiState === JACKAL_STAGGER;
}

// ---------------------------------------------------------------------------------------------
// Bursts

/** A burst's kind (ParticleController maps each to its shape and colour, NEW_ENEMY_3_BURST_LOOKS). */
export const NewEnemy3Burst = {
	IMPACT: 0,
	HEAL: 1,
	SNAP: 2,
} as const;
export type NewEnemy3Burst = (typeof NewEnemy3Burst)[keyof typeof NewEnemy3Burst];

/** A burst kind's look: its chip shape, colour role and seed salt (NEW_ENEMY_3_BURSTS). */
export interface NewEnemy3BurstLook {
	readonly shape: Readonly<ChipBurst>;
	readonly role: ColorRole;
	readonly salt: number;
}

const B = NEW_ENEMY_3_BURSTS;

/** Each NewEnemy3Burst's look, by kind (ParticleController builds its palette entries once). */
export const NEW_ENEMY_3_BURST_LOOKS: ReadonlyArray<NewEnemy3BurstLook> = [
	{ shape: B.impact, role: B.roles.dust, salt: B.seedSalt.impact },
	{ shape: B.heal, role: B.roles.heal, salt: B.seedSalt.heal },
	{ shape: B.snap, role: B.roles.heal, salt: B.seedSalt.snap },
];

/** One burst of the frame (sim units). */
export interface NewEnemy3BurstAt {
	kind: NewEnemy3Burst;
	x: number;
	z: number;
}

function pushBurst(out: NewEnemy3BurstAt[], used: number, kind: NewEnemy3Burst, x: number, z: number): number {
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
 * The frame's bursts in a fixed order (impacts, heals, snaps; each in tick order): dust where every shell landed,
 * sparks on every healed enemy, a snap on every cut beam. Writes `out` (records reused) and returns how many it holds.
 */
export function newEnemy3Bursts(events: NewEnemy3FrameSource, out: NewEnemy3BurstAt[]): number {
	let n = 0;
	for (let i = 0; i < events.impactX.size(); i++)
		n = pushBurst(out, n, NewEnemy3Burst.IMPACT, events.impactX[i], events.impactZ[i]);
	for (let i = 0; i < events.healX.size(); i++)
		n = pushBurst(out, n, NewEnemy3Burst.HEAL, events.healX[i], events.healZ[i]);
	for (let i = 0; i < events.snapX.size(); i++)
		n = pushBurst(out, n, NewEnemy3Burst.SNAP, events.snapX[i], events.snapZ[i]);
	return n;
}
