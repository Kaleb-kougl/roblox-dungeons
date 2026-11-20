/**
 * A secret room's look per frame (docs/SECRET_ROOMS.md SR6, Design 6), the pure half of SecretRenderController:
 *
 *   secretLook          a pure function of the state (state.secrets: status, openTick, tier), the floor's plan (the
 *                       layout's FloorSecret: the geometry; a plan that is not the state's secret reads as none) and
 *                       the views' sim clock: HIDDEN (the crack, the dust) / OPENING t (the burst, the sink, the reveal)
 *                       / OPEN / TAKEN, each step's progress, which parts show. A view met mid-way (a co-op client that
 *                       joins late, a spectator) draws the same look from the state alone.
 *   SecretViewTracker   secretLook plus the frame's one-shot edges from the run view's events (RunView.secrets): the
 *                       open (the burst, the freeze, the nudge, the shout), the reveal (the jingle, the torches), the
 *                       chest's take (the vault's open and cards); an open met mid-way has no edges (it is silent),
 *                       its look is still right. Also the frame's knock puffs, through one KnockThrottle per secret.
 *
 * Timeline and tunables: SECRET_VIEW (config.ts). Reduced motion: no dust, no sink (the chamber cuts in at the open:
 * sinkU 1), the shout and the edges unchanged. Read-only on the sim; presentation only; tested headlessly.
 *
 * @module
 */
import type { FloorSecret } from "shared/dungeon";
import { SIM_HZ, SecretStatus, type SimState } from "shared/sim";
import { SECRET_VIEW } from "./config";
import type { SecretFrameSource, SecretKnockEvent, SecretOpenedEvent, SecretTakenEvent } from "./events";
import { KnockThrottle } from "./knock";

/** The look's phase. */
export const SecretPhase = { NONE: 0, HIDDEN: 1, OPENING: 2, OPEN: 3, TAKEN: 4 } as const;
/** One `SecretPhase` value (0 none, 1 hidden, 2 opening, 3 open, 4 taken): `SecretLook.phase`. */
export type SecretPhaseId = (typeof SecretPhase)[keyof typeof SecretPhase];

/** What secretLook reads of the settings (JuiceSettings' reduced motion). */
export interface SecretLookSettings {
	readonly reducedMotion: boolean;
}

/** One dust pass: shown while a pass runs, its flipbook frame (0-based) and the crack cell it falls from. */
export interface SecretDust {
	readonly shown: boolean;
	readonly frame: number;
	/** Index into the crack's cells (0 .. cells - 1). */
	readonly cell: number;
}

/**
 * What a secret room looks like this frame, from `secretLook`: its phase, the open's clock, and for each part (crack,
 * burst, sinking rock, chamber, torches, chest, dust) whether it shows and how far along it is (progress values run
 * 0..1). A pure function of the state, the floor's plan and the sim clock, so a late joiner or a spectator draws the
 * same thing. Without a secret on the floor every part is off. SecretRenderController applies it.
 */
export interface SecretLook {
	readonly phase: SecretPhaseId;
	/** Seconds since the open (0 before it; the open's tick end is t = 0). */
	readonly t: number;
	/** VaultTier of the chest (-1 without a secret). */
	readonly tier: number;
	/** The crack Part with its overlay (HIDDEN only: it goes at the open). */
	readonly crackShown: boolean;
	/** The burst's progress 0 -> 1 over burst.sec (0 before the open, 1 after the burst). */
	readonly burstU: number;
	/** The burst is running (its shards / dust fly this frame). */
	readonly bursting: boolean;
	/** The void rock's sink 0 (in place) -> 1 (sunk) over sink.sec; reduced motion: 1 at the open. */
	readonly sinkU: number;
	/** The chamber (floor, ring walls, torches, chest) shows from the open on; the rubble too. */
	readonly chamberShown: boolean;
	/** The two torches are lit (from reveal.jingleSec). */
	readonly torchesLit: boolean;
	/** The chest is open (TAKEN). */
	readonly chestOpen: boolean;
	/** The crack's dust trickle (HIDDEN, not reduced motion). */
	readonly dust: SecretDust;
}

const NO_DUST: SecretDust = table.freeze({ shown: false, frame: 0, cell: 0 });

const NONE_LOOK: SecretLook = table.freeze({
	phase: SecretPhase.NONE,
	t: 0,
	tier: -1,
	crackShown: false,
	burstU: 0,
	bursting: false,
	sinkU: 0,
	chamberShown: false,
	torchesLit: false,
	chestOpen: false,
	dust: NO_DUST,
});

/** The plan is the state's secret: the same crack cell and slot (a floor change's new plan, or none, is not). */
export function secretMatchesPlan(state: Readonly<SimState>, plan: Readonly<FloorSecret> | undefined): boolean {
	const sc = state.secrets;
	if (sc === undefined || plan === undefined || sc.status === SecretStatus.NONE) return false;
	return sc.crackX === plan.x && sc.crackY === plan.y && sc.crackSlot === plan.crackSlot;
}

/** The open's moment on the views' sim clock: the end of its tick (the vault's event time, tick / SIM_HZ). */
export function secretOpenSec(openTick: number): number {
	return (openTick + 1) / SIM_HZ;
}

/** The dust pass at `simSec` for a crack of `cells` cells (no phase: every client the same). */
export function secretDustAt(simSec: number, cells: number): SecretDust {
	const D = SECRET_VIEW.dust;
	if (simSec < 0 || cells <= 0) return NO_DUST;
	const pass = math.floor(simSec / D.everySec);
	const frame = math.floor((simSec - pass * D.everySec) * D.fps);
	if (frame >= D.frames) return NO_DUST;
	return { shown: true, frame, cell: pass % cells };
}

function clamp01(v: number): number {
	return math.clamp(v, 0, 1);
}

/** The look of the floor's secret at the views' sim clock `simSec` (see the file comment). */
export function secretLook(
	state: Readonly<SimState>,
	plan: Readonly<FloorSecret> | undefined,
	simSec: number,
	settings: Readonly<SecretLookSettings>,
): SecretLook {
	if (!secretMatchesPlan(state, plan)) return NONE_LOOK;
	const sc = state.secrets!;
	if (sc.status === SecretStatus.HIDDEN) {
		return {
			...NONE_LOOK,
			phase: SecretPhase.HIDDEN,
			tier: sc.tier,
			crackShown: true,
			dust: settings.reducedMotion ? NO_DUST : secretDustAt(simSec, plan!.cells),
		};
	}
	const t = math.max(0, simSec - secretOpenSec(sc.openTick));
	const V = SECRET_VIEW;
	const burstU = clamp01(t / V.burst.sec);
	const sinkU = settings.reducedMotion ? 1 : clamp01(t / V.sink.sec);
	const taken = sc.status === SecretStatus.TAKEN;
	return {
		phase: taken ? SecretPhase.TAKEN : t < V.openingSec ? SecretPhase.OPENING : SecretPhase.OPEN,
		t,
		tier: sc.tier,
		crackShown: false,
		burstU,
		bursting: !settings.reducedMotion && burstU < 1,
		sinkU,
		chamberShown: true,
		torchesLit: t >= V.reveal.jingleSec,
		chestOpen: taken,
		dust: NO_DUST,
	};
}

/**
 * How far the void rock over the chamber (VoidPlan.held's columns) has sunk, tiles below its top: SECRET_VIEW.sink's
 * depth eased in (slow start, then falling away) by the look's sinkU. 0 while hidden; the whole depth once sunk (and at
 * once under reduced motion, where sinkU is 1 from the open).
 */
export function secretSinkTiles(look: Readonly<SecretLook>): number {
	const u = look.sinkU;
	return SECRET_VIEW.sink.depthTiles * u * u;
}

/** SecretViewTracker's frame: the look plus the frame's edges and knock puffs. One object, rewritten every frame. */
export interface SecretViewFrame {
	readonly look: SecretLook;
	/** The open happened in this frame's ticks (the frame's own event): burst, freeze, nudge, shout. */
	readonly openEdge: SecretOpenedEvent | undefined;
	/** The reveal moment (reveal.jingleSec after an open this tracker saw live) fell in this frame: jingle, torches. */
	readonly revealEdge: boolean;
	/** The chest was taken in this frame's ticks: the vault's open and its reward cards. */
	readonly takenEdge: SecretTakenEvent | undefined;
	/** This frame's knocks on the current crack that the throttle let through (a dust puff each). */
	readonly puffs: ReadonlyArray<SecretKnockEvent>;
}

interface MutableFrame {
	look: SecretLook;
	openEdge: SecretOpenedEvent | undefined;
	revealEdge: boolean;
	takenEdge: SecretTakenEvent | undefined;
	puffs: SecretKnockEvent[];
}

/** See the file comment. One per client view (SecretRenderController; the cue tracker owns its own). */
export class SecretViewTracker {
	private readonly out: MutableFrame = {
		look: NONE_LOOK,
		openEdge: undefined,
		revealEdge: false,
		takenEdge: undefined,
		puffs: [],
	};
	private readonly throttle = new KnockThrottle();
	/** The crack slot of the secret this tracker follows (-1: none yet). */
	private slot = -1;
	private crackX = 0;
	private crackY = 0;
	/** The reveal's sim time for an open seen live, undefined otherwise (or once played). */
	private revealAt: number | undefined;
	private lastSec = -math.huge;

	/** Forget the secret (run start, floor change, run exit). */
	reset(): void {
		this.slot = -1;
		this.revealAt = undefined;
		this.lastSec = -math.huge;
		this.throttle.reset();
	}

	/** The last update's frame. */
	frame(): SecretViewFrame {
		return this.out;
	}

	/**
	 * One rendered frame: `state` after the frame's ticks, `plan` the current floor's FloorSecret (undefined: none),
	 * `events` the frame's secret events (RunView.secrets), `simSec` the views' sim clock ((tick + alpha) / SIM_HZ).
	 */
	update(
		state: Readonly<SimState>,
		plan: Readonly<FloorSecret> | undefined,
		events: SecretFrameSource,
		simSec: number,
		settings: Readonly<SecretLookSettings>,
	): SecretViewFrame {
		const out = this.out;
		out.openEdge = undefined;
		out.revealEdge = false;
		out.takenEdge = undefined;
		out.puffs.clear();
		const matches = secretMatchesPlan(state, plan);
		if (!matches || plan!.x !== this.crackX || plan!.y !== this.crackY || plan!.crackSlot !== this.slot) {
			// A new secret (or none): forget the last one's edges and throttle.
			this.reset();
			if (matches) {
				this.slot = plan!.crackSlot;
				this.crackX = plan!.x;
				this.crackY = plan!.y;
			}
		}
		if (simSec < this.lastSec) this.revealAt = undefined; // the clock went back (a restart): no stale reveal
		this.lastSec = simSec;
		out.look = secretLook(state, plan, simSec, settings);
		if (!matches) return out;
		const first = this.slot;
		const last = first + plan!.cells - 1;
		for (const k of events.knocks)
			if (k.slot >= first && k.slot <= last && this.throttle.admit(k.tick / SIM_HZ)) out.puffs.push(k);
		for (const o of events.opened) {
			if (o.slot !== first) continue;
			out.openEdge = o;
			this.revealAt = o.tick / SIM_HZ + SECRET_VIEW.reveal.jingleSec;
		}
		const reveal = this.revealAt;
		if (reveal !== undefined && simSec >= reveal) {
			out.revealEdge = true;
			this.revealAt = undefined;
		}
		for (const t of events.taken) if (t.slot === first) out.takenEdge = t;
		return out;
	}
}
