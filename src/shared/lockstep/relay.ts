/**
 * The server's lockstep relay (M4): assembles one merged frame (one InputFrame per player, index order) per tick and
 * is the authority over the run's input log. Pure; the server's clock calls `finalizeNext()` (session.ts).
 *
 *   submit(i, firstTick, frames)  player i's inputs for ticks firstTick.. (normally tick T + lead, lead >= 3). Inputs
 *                                 for a tick already finalized are LATE and dropped; for a tick more than maxInputAhead
 *                                 past it, refused. A later submit for the same tick replaces the earlier one.
 *                                 Invalid frames (axes, unknown bits, the leave bit) are refused; debug bits are
 *                                 stripped unless allowed (the server's log never carries what the run may not use).
 *   finalizeNext()                tick T = finalizedTicks(): each player's input for T, else (missed deadline) a
 *                                 REPEAT of that player's last finalized input (EMPTY_INPUT before the first); a
 *                                 player who left sends PARTY_LEFT_BUTTON alone, every tick from the one after the
 *                                 leave. Returns the merged frame (also kept by the caller's log).
 *   leave(i)                      player i left (quit, disconnect, stalled): no input for the rest of the run.
 *
 * @module
 */
import {
	Button,
	EMPTY_INPUT,
	PARTY_LEFT_BUTTON,
	PORT_BUTTONS,
	copyInput,
	isValidSimInput,
	type InputFrame,
} from "shared/sim";
import { DEFAULT_LOCKSTEP, type LockstepTunables } from "./config";

/** The debug bits (K, J, the endless floor skip) the relay strips unless debug input is allowed. */
const DEBUG_BUTTONS = bit32.bor(Button.DEBUG_HIT, Button.DEBUG_BOSS, PORT_BUTTONS);

/** A left player's frame: the leave bit alone (frozen, shared). */
export const LEFT_FRAME: Readonly<InputFrame> = table.freeze({ ...EMPTY_INPUT, buttons: PARTY_LEFT_BUTTON });

const NOT_LEFT = -1;

/** How the frames of one submitted input batch were sorted. */
export interface SubmitResult {
	/** Frames queued for a future tick. */
	readonly accepted: number;
	/** Frames for ticks already finalized (dropped). */
	readonly late: number;
	/** Frames refused: too far ahead, invalid, or the player left. */
	readonly refused: number;
}

/** Per-player counts of inputs that missed their deadline, came late or were refused. */
export interface RelayStats {
	/** Per player: ticks finalized with a repeated input (the deadline was missed). */
	readonly missed: number[];
	/** Per player: frames that arrived after their tick was finalized. */
	readonly late: number[];
	/** Per player: frames refused. */
	readonly refused: number[];
}

/**
 * Assembles one merged frame per tick from the players' submitted inputs and is the authority over the run's input log:
 * a player who missed the deadline repeats their last input, a player who left gets LEFT_FRAME.
 */
export class LockstepRelay {
	readonly size: number;
	private readonly tunables: LockstepTunables;
	private finalized = 0;
	private readonly pending: Array<Map<number, InputFrame>> = [];
	private readonly last: Array<Readonly<InputFrame>> = [];
	/** Per player: the first tick of LEFT_FRAME, or NOT_LEFT (Luau arrays cannot hold undefined). */
	private readonly leftAt: number[] = [];
	private readonly stats: RelayStats = { missed: [], late: [], refused: [] };

	constructor(size: number, tunables: LockstepTunables = DEFAULT_LOCKSTEP) {
		this.size = size;
		this.tunables = tunables;
		for (let i = 0; i < size; i++) {
			this.pending.push(new Map());
			this.last.push(EMPTY_INPUT);
			this.leftAt.push(NOT_LEFT);
			this.stats.missed.push(0);
			this.stats.late.push(0);
			this.stats.refused.push(0);
		}
	}

	/** Ticks finalized so far (= the next tick to finalize). */
	finalizedTicks(): number {
		return this.finalized;
	}

	/** Player `i` has not left. */
	isPresent(i: number): boolean {
		return this.leftAt[i] === NOT_LEFT;
	}

	/** Players still present. */
	presentCount(): number {
		let n = 0;
		for (let i = 0; i < this.size; i++) if (this.leftAt[i] === NOT_LEFT) n++;
		return n;
	}

	/** The first tick player `i`'s frames carry the leave bit (undefined while present). */
	leftFromTick(i: number): number | undefined {
		const t = this.leftAt[i];
		return t === NOT_LEFT ? undefined : t;
	}

	getStats(): RelayStats {
		return this.stats;
	}

	/** Player `i`'s inputs for ticks firstTick, firstTick + 1, ... (see the file comment). */
	submit(i: number, firstTick: number, frames: ReadonlyArray<Readonly<InputFrame>>): SubmitResult {
		let accepted = 0;
		let late = 0;
		let refused = 0;
		const valid = i >= 0 && i < this.size && i % 1 === 0 && firstTick % 1 === 0 && this.leftAt[i] === NOT_LEFT;
		const limit = this.finalized + this.tunables.maxInputAhead;
		for (let k = 0; k < frames.size(); k++) {
			const tick = firstTick + k;
			const f = valid ? this.clean(frames[k]) : undefined;
			if (f === undefined || tick > limit) {
				refused++;
			} else if (tick < this.finalized) {
				late++;
			} else {
				this.pending[i].set(tick, f);
				accepted++;
			}
		}
		if (i >= 0 && i < this.size) {
			this.stats.late[i] += late;
			this.stats.refused[i] += refused;
		}
		return { accepted, late, refused };
	}

	/** A validated copy with the debug bits stripped (unless allowed), or undefined for an invalid frame. */
	private clean(frame: Readonly<InputFrame>): InputFrame | undefined {
		if (!typeIs(frame, "table") || !isValidSimInput(frame)) return undefined;
		const f = copyInput(frame);
		if (!this.tunables.allowDebugInput) f.buttons = bit32.band(f.buttons, bit32.bnot(DEBUG_BUTTONS));
		return f;
	}

	/** Player `i` left: from the next finalized tick on their frames are LEFT_FRAME. Idempotent. */
	leave(i: number): void {
		if (i < 0 || i >= this.size || this.leftAt[i] !== NOT_LEFT) return;
		this.leftAt[i] = this.finalized;
		this.pending[i].clear();
	}

	/** Finalizes the next tick (see the file comment) and returns its merged frame. */
	finalizeNext(): InputFrame[] {
		const tick = this.finalized;
		const merged: InputFrame[] = [];
		for (let i = 0; i < this.size; i++) {
			let f: Readonly<InputFrame>;
			if (this.leftAt[i] !== NOT_LEFT) {
				f = LEFT_FRAME;
			} else {
				const q = this.pending[i];
				const got = q.get(tick);
				if (got !== undefined) {
					q.delete(tick);
					f = got;
				} else {
					f = this.last[i];
					this.stats.missed[i] += 1;
				}
			}
			this.last[i] = f;
			merged.push(copyInput(f));
		}
		this.finalized = tick + 1;
		return merged;
	}
}
