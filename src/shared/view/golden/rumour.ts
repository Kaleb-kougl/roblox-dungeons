/**
 * Goldling rumours (docs/GOLDLING_RUMOURS.md GR5, RD1-RD7): what a client hears and shows about a Goldling hiding on
 * its floor before anyone has found it. Pure and per client (no Roblox API); read-only on the sim (every input is hashed
 * state: GoldenState.status / engageTick, the endless floor, the draft flags, a player's position).
 *
 *   phase   goldenRumourPhase: NONE without a Goldling or once it is not WAITING (out, caught, escaped, skipped); FLOOR
 *           while it hides and its room has not engaged (`engageTick < 0`); ROOM while it hides and its room has
 *           engaged (`engageTick` latches once: the room's clear does not end it, so the chip stays ROOM after the
 *           clear while it still hides, RD12).
 *   clock   GoldenRumourClock, stepped once per rendered frame with the frame's dt (the client's SimController, after
 *           the frame's ticks): the floor cue once per floor (keyed by the endless floor number) after
 *           GOLDEN_VIEW.rumour.floorDelaySec of UNFROZEN time in FLOOR (a frame with a draft open, or held by the
 *           caller: stage cover, solo pause, run over, counts nothing), skipped if ROOM came first; the room cue once,
 *           on the first unfrozen ROOM frame. A new floor number re-arms both; `reset` (a new run) too. The step's two
 *           edges (`floorCue`, `roomCue`) are GoldenRumourCueSource for the audio cue mapper (shared/view/audio
 *           AudioCueMapper.frame), true for exactly the one step that fired them.
 *   chip    `chip()`: the phase the HUD chip shows (GoldenRumourChip): NONE until this floor's first rumour cue played,
 *           and NONE on a frozen frame (a draft open, the stage cover); else the phase, except that ROOM shows only
 *           while the view player stands in the Goldling's room (goldenRumourInRoom): out of it (they left, or a
 *           teammate engaged it) the chip reads FLOOR again, and back in it reads ROOM (no second room cue).
 *   heard   `heard()`: this floor's first rumour cue has played (the first-time card `golden.rumour` is queued then).
 *   room    goldenRumourInRoom: the view player stands in the Goldling's room (the room cue's full volume; outside it
 *           plays at the teammate volume, RD6).
 *   chip    goldenRumourChipKey / goldenRumourChipText: the chip's line per phase (theme GOLDEN_RUMOUR_STRING_KEYS);
 *           goldenRumourChipScale: its gentle pulse while it reads "hiding" (none under reduced motion);
 *           chipRowWidth: the status corner's boost row split between the chips and one boost cell.
 *
 * Co-op (RD6): every client steps the same merged state, so every client hears both cues (their own clock, their own
 * frame times). Muted: the chip and the glint say what the sounds say.
 */
import { GoldenStatus, goldenInRoom, isDraftOpen, partySize, playerAt, type SimState } from "shared/sim";
import { GOLDEN_VIEW } from "./config";

const TAU = 2 * math.pi;

/** The rumours' theme strings (shared/theme GOLDEN_RUMOUR_STRING_KEYS and GOLDEN_RUMOUR_BESTIARY_KEY). */
export const GOLDEN_RUMOUR_STRINGS = {
	/** The chip in FLOOR ("Coins jingling..."). */
	floor: "hud.chip.golden.rumour",
	/** The chip in ROOM ("It's hiding here!"). */
	room: "hud.chip.golden.hiding",
	/** The first-time card (the sighting id `golden.rumour`'s bestiary line). */
	card: "bestiary.golden.rumour",
} as const;

/** The rumour's phase (goldenRumourPhase). */
export const GoldenRumourPhase = {
	/** No Goldling hides on this floor (none rolled, or it is out / caught / escaped / skipped). */
	NONE: 0,
	/** It hides somewhere on this floor; nobody has engaged its room. */
	FLOOR: 1,
	/** It hides in a room that has engaged (someone walked in). */
	ROOM: 2,
} as const;
export type GoldenRumourPhaseId = (typeof GoldenRumourPhase)[keyof typeof GoldenRumourPhase];

/** GoldenRumourPhase names by value (KV_GoldenLabel's developer text). */
export const GOLDEN_RUMOUR_PHASE_NAMES: ReadonlyArray<string> = ["NONE", "FLOOR", "ROOM"];

/** The rumour's phase from hashed state alone (see the file comment). Read-only. */
export function goldenRumourPhase(state: Readonly<SimState>): GoldenRumourPhaseId {
	const g = state.golden;
	if (g === undefined || g.status !== GoldenStatus.WAITING || g.room < 0) return GoldenRumourPhase.NONE;
	return g.engageTick >= 0 ? GoldenRumourPhase.ROOM : GoldenRumourPhase.FLOOR;
}

/** True when player `viewIndex` (player 0 when out of the party) stands on a floor cell of the Goldling's room. */
export function goldenRumourInRoom(state: Readonly<SimState>, viewIndex: number): boolean {
	const g = state.golden;
	if (g === undefined || g.floor === undefined) return false;
	const p = playerAt(state, viewIndex >= 0 && viewIndex < partySize(state) ? viewIndex : 0);
	return goldenInRoom(g, p.x, p.z);
}

/** One frame's rumour cues (the clock's edges), for the audio cue mapper. */
export interface GoldenRumourCueSource {
	/** The floor rumour starts this frame. */
	readonly floorCue: boolean;
	/** The room rumour starts this frame. */
	readonly roomCue: boolean;
}

/** No rumour cue (the mapper's default: every other cue as before). */
export const NO_GOLDEN_RUMOUR_CUES: GoldenRumourCueSource = { floorCue: false, roomCue: false };

/** The clock's floor key before any floor (and outside endless runs). */
const NO_FLOOR = -1;

/** The per-client rumour clock (see the file comment). */
export class GoldenRumourClock implements GoldenRumourCueSource {
	floorCue = false;
	roomCue = false;
	private floor = NO_FLOOR;
	private unfrozenSec = 0;
	private floorDone = false;
	private roomDone = false;
	private heardFloor = false;
	private shown: GoldenRumourPhaseId = GoldenRumourPhase.NONE;
	private last: GoldenRumourPhaseId = GoldenRumourPhase.NONE;

	/** A new run (or none): forget the floor, its time and its cues. */
	reset(): void {
		this.floorCue = false;
		this.roomCue = false;
		this.floor = NO_FLOOR;
		this.rearm();
	}

	private rearm(): void {
		this.unfrozenSec = 0;
		this.floorDone = false;
		this.roomDone = false;
		this.heardFloor = false;
		this.shown = GoldenRumourPhase.NONE;
		this.last = GoldenRumourPhase.NONE;
	}

	/**
	 * One rendered frame of `dt` seconds, after the frame's ticks. `hold`: the caller's freeze (the stage cover, a solo
	 * pause, the run over): no time counts, no cue starts, the chip hides. A frame with a draft open is frozen too.
	 * `viewIndex`: the player the chip speaks for (the view player; goldenRumourInRoom's fallback for a bad index).
	 * Never writes `state`.
	 */
	step(state: Readonly<SimState>, dt: number, hold = false, viewIndex = 0): void {
		this.floorCue = false;
		this.roomCue = false;
		const floor = state.endless !== undefined ? state.endless.floor : NO_FLOOR;
		if (floor !== this.floor) {
			this.floor = floor;
			this.rearm();
		}
		const phase = goldenRumourPhase(state);
		this.last = phase;
		const frozen = hold || isDraftOpen(state);
		if (!frozen) {
			if (phase === GoldenRumourPhase.ROOM && !this.roomDone) {
				this.roomDone = true;
				this.roomCue = true;
				this.floorDone = true; // the room came first (or after): no floor cue on this floor from now on
				this.heardFloor = true;
			} else if (phase === GoldenRumourPhase.FLOOR && !this.floorDone) {
				this.unfrozenSec += dt > 0 ? dt : 0;
				if (this.unfrozenSec >= GOLDEN_VIEW.rumour.floorDelaySec) {
					this.floorDone = true;
					this.floorCue = true;
					this.heardFloor = true;
				}
			}
		}
		if (frozen || !this.heardFloor) this.shown = GoldenRumourPhase.NONE;
		else if (phase === GoldenRumourPhase.ROOM && !goldenRumourInRoom(state, viewIndex))
			this.shown = GoldenRumourPhase.FLOOR;
		else this.shown = phase;
	}

	/** The phase the HUD chip shows (NONE: no chip). */
	chip(): GoldenRumourPhaseId {
		return this.shown;
	}

	/** The phase at the last step (KV_GoldenLabel). */
	phase(): GoldenRumourPhaseId {
		return this.last;
	}

	/** This floor's first rumour cue has played (the first-time card's moment). */
	heard(): boolean {
		return this.heardFloor;
	}

	/** Unfrozen seconds counted toward this floor's floor cue (specs / debug). */
	floorSec(): number {
		return this.unfrozenSec;
	}
}

/** The chip's theme string for `phase`, or undefined for NONE (no chip). */
export function goldenRumourChipKey(phase: number): string | undefined {
	if (phase === GoldenRumourPhase.FLOOR) return GOLDEN_RUMOUR_STRINGS.floor;
	if (phase === GoldenRumourPhase.ROOM) return GOLDEN_RUMOUR_STRINGS.room;
	return undefined;
}

/** The chip's line for `phase` through the pack's string lookup ("" for NONE). */
export function goldenRumourChipText(str: (key: string) => string, phase: number): string {
	const key = goldenRumourChipKey(phase);
	return key !== undefined ? str(key) : "";
}

/**
 * The chip content's scale `ageSec` seconds into its ROOM look: 1 + pulseAmp x a 0..1 wave (0 at each cycle's start),
 * one cycle per pulseSec. 1 in FLOOR / NONE, and under reduced motion (`motion` 0, shared/view/fx motionScale).
 */
export function goldenRumourChipScale(ageSec: number, phase: number, motion: number): number {
	const c = GOLDEN_VIEW.rumour.chip;
	if (phase !== GoldenRumourPhase.ROOM || !(motion > 0) || !(c.pulseSec > 0)) return 1;
	const wave = 0.5 - 0.5 * math.cos((TAU * math.max(0, ageSec)) / c.pulseSec);
	return 1 + c.pulseAmp * wave;
}

/**
 * The width of each of `chips` chips sharing the status corner's boost row with one boost cell (`cellWidth`): the row
 * minus the cell and the gaps, split evenly (shared/view/pacts hordeChipWidth for one chip). 0 for no chip.
 */
export function chipRowWidth(rowWidth: number, cellWidth: number, gap: number, chips: number): number {
	if (!(chips > 0)) return 0;
	return math.max(0, (rowWidth - cellWidth - gap - (chips - 1) * gap) / chips);
}
