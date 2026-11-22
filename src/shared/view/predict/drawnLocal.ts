/**
 * The local player as drawn in a co-op run (docs/LOCAL_PREDICTION.md LP5, Design 4 / 6), as one object: the
 * {@link PredictionSmoother}, the Chainhook's {@link PredictionResume} blend and the drawn body the views read. It was
 * SimController's `smoother` / `predictResume` / `drawn*` fields and `updateDrawn` (docs/SIM_CONTROLLER.md step 2),
 * moved unchanged. Pure: no clock (the caller passes the frame's `dt`), no Instance; presentation only, it never
 * writes the state it reads.
 *
 * Per co-op frame, after the pump and the spectate update: `update(...)`; the views then read `playerOf` and
 * `aheadTicks`, and the next frame's input sample takes its aim origin from `aimX` / `aimZ`.
 *
 * @module
 */
import { chainhookHolderOf, newPlayerState, playerAt, type PlayerState, type SimState } from "shared/sim";
import type { PredictionViewTunables } from "./config";
import { writeDrawnPlayer } from "./drawn";
import { PredictionResume, blendTowardMerged } from "./resume";
import { PredictionSmoother, type PredictionPath } from "./smoother";

/**
 * What {@link DrawnLocalPlayer.update} reads of the co-op run: a structural subset of shared/lockstep LockstepClient
 * (so this module does not import it, and a spec can script one).
 */
export interface PredictionSource {
	/** The merged state (the last tick stepped). */
	readonly state: Readonly<SimState>;
	/** The predicted head of the local player, or undefined while the client predicts nothing. */
	predicted(): Readonly<PlayerState> | undefined;
	/** The last prediction's positions by tick, or undefined whenever `predicted()` is. */
	predictedPath(): PredictionPath | undefined;
	/** Ticks the head is past the merged state. */
	predictionHorizonTicks(): number;
	/** The render interpolation factor, 0..1. */
	getAlpha(): number;
}

/** The smoother's counters for the KV_Debug co-op line (LP6): run-session totals, the offset in tiles. */
export interface PredictionSmoothing {
	readonly snaps: number;
	readonly corrections: number;
	readonly offsetTiles: number;
}

/** The drawn local player of a co-op run (see the file comment). One per SimController, for its life. */
export class DrawnLocalPlayer {
	/**
	 * Local prediction on screen (docs/LOCAL_PREDICTION.md LP5): the co-op client's predicted head smoothed into the
	 * drawn local player (update, once per co-op frame after the pump). `drawnState` / `drawnIndex`: the state and
	 * the player it was drawn for; `drawnActive` false while nothing is predicted (solo, KV_PredictOff, spectating, dead,
	 * a draft, the stage cover), then every view gets the merged player exactly as before.
	 */
	private readonly smoother: PredictionSmoother;
	/**
	 * docs/NEW_ENEMIES_2.md NX7: prediction suspended while merged state says a Chainhook drags the local player
	 * (chainhookHolderOf), then blended back over PREDICTION_VIEW.resumeSec (shared/view/predict PredictionResume).
	 */
	private readonly predictResume: PredictionResume;
	private readonly drawnBody: PlayerState = newPlayerState(0, 0);
	private drawnState: SimState | undefined;
	private drawnIndex = -1;
	private drawnActive = false;
	private drawnAheadTicks = 0;
	/** The drawn pose this frame (the aim origin of the next sample). */
	private drawnX = 0;
	private drawnZ = 0;

	constructor(tunables: PredictionViewTunables) {
		this.smoother = new PredictionSmoother(tunables);
		this.predictResume = new PredictionResume(tunables);
	}

	/** A new run: nothing to glide from (LP5's run-start snap), and nothing drawn until the first `update`. */
	reset(): void {
		this.smoother.snap();
		this.drawnActive = false;
	}

	/** The local player is drawn predicted this frame. */
	isActive(): boolean {
		return this.drawnActive;
	}

	/** The smoother's snaps so far (the debug line). */
	snapCount(): number {
		return this.smoother.snapCount();
	}

	/**
	 * The aim origin's x for the next input sample: the pose drawn this frame when `drawn` (a `playerOf` result) is the
	 * predicted body, else `mergedX`.
	 */
	aimX(drawn: Readonly<PlayerState>, mergedX: number): number {
		return this.drawnActive && drawn === this.drawnBody ? this.drawnX : mergedX;
	}

	/** As `aimX`, for z. */
	aimZ(drawn: Readonly<PlayerState>, mergedZ: number): number {
		return this.drawnActive && drawn === this.drawnBody ? this.drawnZ : mergedZ;
	}

	/**
	 * Player `index` of `state` as the views draw it (docs/LOCAL_PREDICTION.md Design 1 / 6): while this client's own
	 * player is predicted (co-op, viewing yourself, alive, no draft, no cover, not KV_PredictOff) the local player is
	 * the predicted, smoothed body (shared/view/predict writeDrawnPlayer: position, facing, roll, the flask's slowdown;
	 * everything else merged); otherwise, and for every other player, exactly `playerAt(state, index)`. For views that
	 * draw on or at the player (the census's "drawn" rows); what shows the sim's decisions keeps `playerAt`. Read only.
	 */
	playerOf(state: Readonly<SimState>, index: number): Readonly<PlayerState> {
		if (this.drawnActive && index === this.drawnIndex && state === this.drawnState) return this.drawnBody;
		return playerAt(state, index);
	}

	/**
	 * How many ticks past the merged state the drawn local player is this frame (docs/LOCAL_PREDICTION.md LP10: the
	 * enemy bullets are drawn as far ahead): the predictor's horizon (shared/lockstep LocalPredictor.horizonTicks, at
	 * most PREDICTION.maxTicks) while getDrawnPlayer draws the local player predicted, else 0 (solo, KV_PredictOff,
	 * spectating, dead, a draft, the stage cover, no run).
	 */
	aheadTicks(): number {
		return this.drawnActive ? this.drawnAheadTicks : 0;
	}

	/** The smoother's snaps and corrections so far this session (the KV_Debug co-op line, LP6). */
	smoothing(): PredictionSmoothing {
		return {
			snaps: this.smoother.snapCount(),
			corrections: this.smoother.correctionCount(),
			offsetTiles: this.smoother.offset(),
		};
	}

	/**
	 * Local prediction on screen (docs/LOCAL_PREDICTION.md LP5): this frame's prediction into the smoother and the drawn
	 * local player. Nothing is predicted while the views follow a teammate, under the stage cover, or whenever the client
	 * predicts nothing (KV_PredictOff, dead or left, a draft open, the run over): the smoother then resets (the death,
	 * revive and draft snaps); `snap` (a floor change, a spectate switch) drops any glide first.
	 */
	update(
		coop: PredictionSource,
		index: number,
		viewingSelf: boolean,
		covered: boolean,
		dt: number,
		snap: boolean,
	): void {
		// docs/NEW_ENEMIES_2.md NX7: a drag the predictor cannot mirror; drawn merged while hooked, then blended back.
		if (snap) this.predictResume.reset();
		const weight = this.predictResume.update(chainhookHolderOf(coop.state, index) >= 0, dt);
		const head = viewingSelf && !covered && weight > 0 ? coop.predicted() : undefined;
		if (snap) this.smoother.snap();
		this.smoother.feed(head, head !== undefined ? coop.predictedPath() : undefined);
		const alpha = coop.getAlpha();
		const pose = this.smoother.draw(alpha, dt);
		if (head === undefined || pose === undefined) {
			this.drawnActive = false;
			this.drawnAheadTicks = 0;
			return;
		}
		const merged = playerAt(coop.state, index);
		writeDrawnPlayer(this.drawnBody, merged, head, this.smoother.offsetX(), this.smoother.offsetZ());
		blendTowardMerged(this.drawnBody, merged, weight);
		this.drawnState = coop.state;
		this.drawnIndex = index;
		this.drawnActive = true;
		this.drawnAheadTicks =
			weight >= 1 ? coop.predictionHorizonTicks() : math.floor(coop.predictionHorizonTicks() * weight);
		const body = this.drawnBody;
		this.drawnX = weight >= 1 ? pose.x : body.prevX + (body.x - body.prevX) * alpha;
		this.drawnZ = weight >= 1 ? pose.z : body.prevZ + (body.z - body.prevZ) * alpha;
	}
}
