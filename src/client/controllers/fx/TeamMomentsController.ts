import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { TILE_SIZE, playerAt } from "shared/sim";
import {
	TEAM_MOMENTS,
	TEAM_MOMENTS_VIEW,
	TeamMoments,
	parseTeamMomentsDebug,
	syncTetherReach,
	teamPerfectFor,
	type SyncParryMoment,
	type SyncParryPoint,
	type TeamMomentTotals,
	type TeamMomentsDebug,
	type TeamPerfectMoment,
} from "shared/view/fx";
import { floorAxes } from "shared/view/hud";
import { SimController } from "../game/SimController";
import { FX_FRAME_PHASE, FxTrackerController } from "./FxTrackerController";
import { NearMissController } from "./NearMissController";

const AXES = floorAxes();

/**
 * The co-op shared moments (docs/RUN_RECAP.md Part B): the client's ONE TeamMoments (shared/view/fx), stepped once per
 * rendered frame in two halves so every consumer reads THIS frame's moments whatever Flamework's start order:
 *   - the room-clear half (TEAM PERFECT, its streak) in the FX_FRAME_PHASE.teamMoments frame handler, before
 *     RoomClearController's scoreRoll frame (its stamp, chip, pulse rings and jingle read `teamPerfects()`);
 *   - the parry half (SYNC!) on the frame's NearMissDirector output (the director's parryGroups): stepped on the first
 *     `syncs()` call of a near-miss frame (AudioController's sound frame, SyncCalloutController) or by this controller's
 *     own near-miss subscriber, whichever comes first, once per NearMissController.frameId().
 * TeamMoments itself has moments only in a party run (score.partySize >= TEAM_MOMENTS.minPartySize) and resets on a new
 * run (another state, or the tick going back); a run start resets it too. `totals()` is the run's so far, for the
 * run-over recap (highlights 3, 4 and 7). Presentation only, read-only on the sim.
 *
 * Studio aid: TEAM_MOMENTS_VIEW.debug.attribute (KV_TeamMomentsDebug, off by default) adds a fake team perfect (on the
 * next PERFECT clear, solo too) or a fake SYNC! (next frame, at the view player) to the frame's moments; never to the
 * totals.
 */
@Controller({})
export class TeamMomentsController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly moments = new TeamMoments();
	private readonly perfects = new Array<TeamPerfectMoment>();
	private readonly syncList = new Array<SyncParryMoment>();
	/** NearMissController.frameId() of the near-miss frame the parry half last stepped for (-1: none yet). */
	private syncFrame = -1;
	private debugPerfect: number | undefined;
	private debugSync: Extract<TeamMomentsDebug, { kind: "sync" }> | undefined;
	private debugId = 0;

	constructor(
		private readonly sim: SimController,
		private readonly fx: FxTrackerController,
		private readonly nearMiss: NearMissController,
	) {}

	onStart(): void {
		this.sim.onRunStarted(() => this.newRun());
		this.fx.onFrame(() => this.clearsFrame(), FX_FRAME_PHASE.teamMoments);
		this.nearMiss.onFrame(() => this.syncs());
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(TEAM_MOMENTS_VIEW.debug.attribute).Connect(() => this.readDebug()),
		);
	}

	/**
	 * This frame's team perfects (clear order): valid from the FX_FRAME_PHASE.teamMoments phase to the end of the frame
	 * (the array is refilled every frame: read it now, never keep it). Empty outside a party run (but a debug one).
	 */
	teamPerfects(): ReadonlyArray<TeamPerfectMoment> {
		return this.perfects;
	}

	/** The team perfect of a clear of this frame, or undefined. */
	teamPerfectOf(c: { readonly tick: number; readonly room: number }): TeamPerfectMoment | undefined {
		return teamPerfectFor(c, this.perfects);
	}

	/**
	 * This near-miss frame's SYNC! records (tick order; a grown sync repeats its id with `grew`): call it from a
	 * NearMissController subscriber (it steps the parry half on the frame's first call). Refilled every frame.
	 */
	syncs(): ReadonlyArray<SyncParryMoment> {
		const id = this.nearMiss.frameId();
		if (id === this.syncFrame) return this.syncList;
		this.syncFrame = id;
		this.syncList.clear();
		const ctx = this.sim.getContext();
		const frame = this.nearMiss.latest();
		if (ctx === undefined || frame === undefined) return this.syncList;
		const out = this.moments.parriesFrame(ctx.run.state, frame.parryGroups);
		for (const s of out.syncs) this.syncList.push(s);
		const debug = this.debugSync;
		if (debug !== undefined) {
			this.debugSync = undefined;
			this.syncList.push(this.fakeSync(debug));
		}
		return this.syncList;
	}

	/**
	 * The run's co-op totals so far (docs/RUN_RECAP.md CM6: the recap's TEAM PERFECT rooms, best team streak and sync
	 * parries), a copy. Zero outside a party run; debug moments never count. Stable after run over until the next run.
	 */
	totals(): TeamMomentTotals {
		const t = this.moments.totals;
		return { teamPerfects: t.teamPerfects, bestTeamStreak: t.bestTeamStreak, syncParries: t.syncParries };
	}

	private newRun(): void {
		this.moments.reset();
		this.perfects.clear();
		this.syncList.clear();
		this.debugPerfect = undefined;
		this.debugSync = undefined;
	}

	/** The room-clear half (FX_FRAME_PHASE.teamMoments). */
	private clearsFrame(): void {
		this.perfects.clear();
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const clears = ctx.run.roomClears.clears;
		const out = this.moments.clearsFrame(ctx.run.state, clears);
		for (const p of out.teamPerfects) this.perfects.push(p);
		const streak = this.debugPerfect;
		if (streak === undefined) return;
		for (const c of clears) {
			if (!c.perfect || teamPerfectFor(c, this.perfects) !== undefined) continue;
			this.debugPerfect = undefined;
			this.perfects.push({
				kind: "teamPerfect",
				tick: c.tick,
				room: c.room,
				rooms: c.rooms,
				streak,
				showStreak: streak >= TEAM_MOMENTS.streakShowFrom,
				points: c.perfectPoints,
				x: c.x,
				z: c.z,
			});
			return;
		}
	}

	// --- KV_TeamMomentsDebug (check aid, off by default, read anywhere) ------------------------------

	private readDebug(): void {
		const d = parseTeamMomentsDebug(Workspace.GetAttribute(TEAM_MOMENTS_VIEW.debug.attribute));
		if (d === undefined) return;
		if (d.kind === "perfect") this.debugPerfect = d.streak;
		else this.debugSync = d;
	}

	/** A SYNC! at the view player: points along screen-right (a third and fourth up-screen), near or far apart. */
	private fakeSync(d: Extract<TeamMomentsDebug, { kind: "sync" }>): SyncParryMoment {
		const state = this.sim.getContext()!.run.state;
		const view = this.sim.getViewPlayerIndex();
		const p = playerAt(state, view);
		const D = TEAM_MOMENTS_VIEW.debug;
		const half = ((d.far ? D.farTiles : D.nearTiles) * TILE_SIZE) / 2;
		const offsets: ReadonlyArray<readonly [number, number]> = [
			[-half, 0],
			[half, 0],
			[0, half],
			[0, -half],
		];
		const points = new Array<SyncParryPoint>();
		let sx = 0;
		let sz = 0;
		for (let i = 0; i < d.count && i < offsets.size(); i++) {
			const [r, u] = offsets[i];
			const x = p.x + AXES.rightX * r + AXES.upX * u;
			const z = p.z + AXES.rightZ * r + AXES.upZ * u;
			points.push({ player: i, tick: state.tick, x, z });
			sx += x;
			sz += z;
		}
		const n = points.size();
		this.debugId -= 1;
		return {
			kind: "sync",
			id: this.debugId,
			firstTick: state.tick,
			tick: state.tick,
			count: n,
			grew: false,
			points,
			midX: sx / n,
			midZ: sz / n,
			tethered: 2 * half <= syncTetherReach(),
		};
	}
}
