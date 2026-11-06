/**
 * Relic pedestals drawn as treasure chests (presentation only; drawn by the client's RunMarkerController): a live
 * pedestal is the closed chest, taking its relic plays the vault's opening (timeline.ts: lidJoltStuds, chestPopped,
 * popCrossed, columnAt on TREASURE_VIEW.open) from the frame the view first sees it taken, and the open chest stays. A
 * pedestal nobody can take (shared/sim pedestalOffered) is not drawn. A pedestal already taken when the tracker was
 * reset (a rebuilt view) is open and settled: no jolt, no pop. Ages are sim seconds (the views' clock: pause and the
 * hitstop freeze hold it). Tested headlessly (pedestal.spec.ts).
 */
import { chestPopped, columnAt, lidJoltStuds, popCrossed, type ColumnLook } from "./timeline";

/** A pedestal chest's look this frame. Mutable, reused. */
export interface PedestalChestLook {
	/** The chest is drawn (false: a live pedestal nobody can take). */
	shown: boolean;
	/** The open chest (`treasure.chestopen`) is drawn instead of the closed one. */
	open: boolean;
	/** The lid's hop, studs (the opening's jolt; 0 under reduced motion and once popped). */
	liftStuds: number;
	/** The lid popped this frame: the freeze, the shake and the ring burst, once. */
	popEdge: boolean;
	/** Sim seconds since the opening began (math.huge: never seen opening, or live). */
	openAge: number;
	readonly column: ColumnLook;
}

/** A fresh, hidden look. */
export function newPedestalChestLook(): PedestalChestLook {
	return {
		shown: false,
		open: false,
		liftStuds: 0,
		popEdge: false,
		openAge: math.huge,
		column: { shown: false, height: 0, opacity: 0 },
	};
}

/** Not opened yet (live), as an open time. */
const LIVE = math.huge;
/** Opened before the view saw it (settled), as an open time: every age is math.huge. */
const SETTLED = -math.huge;

/**
 * Per pedestal (an index into RunState.pedestalTaken), when its opening began. reset() on every floor build (with the
 * floor's taken flags), then update() once per pedestal per frame.
 */
export class PedestalChestTracker {
	private readonly openSec: number[] = [];
	private readonly lastAge: number[] = [];

	/** A new floor or run: `taken` (RunState.pedestalTaken); a pedestal already taken shows open and settled. */
	reset(taken: ReadonlyArray<number>): void {
		this.openSec.clear();
		this.lastAge.clear();
		for (let k = 0; k < taken.size(); k++) {
			this.openSec.push(taken[k] !== 0 ? SETTLED : LIVE);
			this.lastAge.push(math.huge);
		}
	}

	/**
	 * Pedestal `k`'s look at sim second `simSec`: `taken` (RunState.pedestalTaken[k] !== 0), `offered` (shared/sim
	 * pedestalOffered), `reduced` (reduced motion: no jolt, the column at full height) and `particles` (Particles off: no
	 * column).
	 */
	update(
		k: number,
		taken: boolean,
		offered: boolean,
		simSec: number,
		reduced: boolean,
		particles: boolean,
		out: PedestalChestLook,
	): PedestalChestLook {
		while (this.openSec.size() <= k) {
			this.openSec.push(LIVE);
			this.lastAge.push(math.huge);
		}
		if (taken && this.openSec[k] === LIVE) {
			this.openSec[k] = simSec;
			this.lastAge[k] = -1;
		}
		out.popEdge = false;
		if (!taken || this.openSec[k] === LIVE) {
			out.shown = offered;
			out.open = false;
			out.liftStuds = 0;
			out.openAge = math.huge;
			columnAt(math.huge, particles, reduced, out.column);
			return out;
		}
		const at = this.openSec[k];
		const age = at === SETTLED ? math.huge : math.max(0, simSec - at);
		out.shown = true;
		out.open = chestPopped(age);
		out.liftStuds = lidJoltStuds(age, reduced);
		out.popEdge = popCrossed(this.lastAge[k], age);
		out.openAge = age;
		columnAt(age, particles, reduced, out.column);
		this.lastAge[k] = age;
		return out;
	}
}
