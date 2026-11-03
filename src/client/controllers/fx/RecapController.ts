import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { ContextActionService } from "@rbxts/services";
import {
	clientStore,
	selectAnyPanelOpen,
	selectMenuScreen,
	selectStageCovered,
	type ClientState,
	type VerdictView,
} from "client/store";
import { RECAP_BINDINGS, onLocaleChanged, resetRecapBindings, runOverBest } from "client/ui";
import { DAILY_WORLD_KIND } from "shared/daily";
import { bossKindFor, floorSeed, isBossFloor } from "shared/dungeon";
import { RunOverRetryGate, inputsFor, type RunOverPressSource } from "shared/play";
import { DEV_WORLD_KIND, ENDLESS_WORLD_KIND } from "shared/run";
import type { JuiceSettings } from "shared/settings";
import { BOON_MAX_LEVEL, floorRoomTally, partySize, playerAt } from "shared/sim";
import type { ColorRole, StringVars } from "shared/theme";
import { SFX, recapCue, type RecapCue } from "shared/view/audio";
import {
	NEW_BEST_DRAW,
	NO_TEAM_MOMENTS,
	RECAP_UI,
	RecapTimeline,
	bossFraction,
	nearMissFor,
	pickHighlights,
	recapHighlightRow,
	recapHighlightValue,
	recapNearMissRow,
	recapNearMissText,
	recapRecordRowsSec,
	recapRowTransparency,
	stairsPathTiles,
	type RecapBossInput,
	type RecapBuildsInput,
	type RecapHighlight,
	type RecapNearMiss,
	type RecapTeamInput,
	type RecapTimelineOptions,
	type RecapWorld,
	type RunBaseline,
	type RunRecapInput,
} from "shared/view/hud";
import { runOverExits } from "shared/view/menu";
import { AudioController } from "../audio/AudioController";
import { InputController } from "../game/InputController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FX_FRAME_PHASE, FxTrackerController } from "./FxTrackerController";
import { TeamMomentsController } from "./TeamMomentsController";

/**
 * Part B's seam (docs/RUN_RECAP.md CM6): the co-op moments of the run (`TeamMoments`: best TEAM PERFECT streak, sync
 * parries), read every time the recap's input is built (the panel opening, a verdict re-derive). Registered by the
 * controller that owns them (`setTeamMomentsProvider`); none: NO_TEAM_MOMENTS.
 */
export type RecapTeamMomentsProvider = (ctx: RunContext) => RecapTeamInput;

const CONFIRM_ACTION = "KV_RecapConfirm";
/** Enter / Space press the focused Again on a keyboard (RR7); above the input sink's High priority (Space is roll). */
const CONFIRM_KEYS = [Enum.KeyCode.Return, Enum.KeyCode.KeypadEnter, Enum.KeyCode.Space];
const CONFIRM_PRIORITY = Enum.ContextActionPriority.High.Value + 1;
const UNRANKED: RunBaseline = { kind: "unranked" };

/** The recap's world from the run's world kind (shared/run, shared/daily): the tutorial and every other world: none. */
function recapWorldOf(ctx: RunContext): RecapWorld {
	if (ctx.tutorial) return "other";
	if (ctx.world === ENDLESS_WORLD_KIND) return "endless";
	if (ctx.world === DAILY_WORLD_KIND) return "daily";
	if (ctx.world === DEV_WORLD_KIND) return "dev";
	return "other";
}

/** What decides a re-derive (docs/RUN_RECAP.md "Rules": a verdict with other numbers re-derives silently). */
interface DeriveKey {
	readonly verdict: VerdictView;
	readonly score: number;
	readonly floor: number;
	readonly baselineRun: number;
}

/** A compact fingerprint of the recap's content (near-miss line and cells): a re-derive swaps only when it differs. */
function recapSignature(nearMiss: RecapNearMiss | undefined, highlights: ReadonlyArray<RecapHighlight>): string {
	const parts = new Array<string>();
	if (nearMiss !== undefined) {
		parts.push(nearMiss.key, nearMiss.dim ? "d" : "-");
		for (const [k, v] of pairs(nearMiss.vars as unknown as ReadonlyMap<string, number>)) parts.push(`${k}=${v}`);
	}
	for (const h of highlights) parts.push(`${h.id}:${h.value}:${h.from}:${h.key}:${h.scope ?? ""}`);
	return parts.join("|");
}

/**
 * The run-over recap's driver (docs/RUN_RECAP.md RR6). Presentation only: reads the final state, the HUD snapshot,
 * new best's frozen baseline and the run view's collectors; writes the store's `recap` slice and RECAP_BINDINGS.
 *
 *   open       the frame the run-over panel opens (the snapshot's outcome is no longer "playing", as RunOverPanel reads
 *              it) the recap's input is built once (inputOf: world from the run's world kind; the boss from the
 *              snapshot's bossVisible / bossId / bossHp / bossHpMax; the stairs' walking distance from the death floor's
 *              world and the view player's position, once; room counts from floorRoomTally; the view player's duos and
 *              evolved boons (level III); new best's baseline and the panel's own record (runOverBest); a daily run's
 *              best today from an accepted verdict; RunView.recapTally; Part B's team moments through the provider
 *              seam) and nearMissFor / pickHighlights / a RecapTimeline (a record run's highlights after NB's rows:
 *              recapRecordRowsSec) are made. Dev runs: highlights only (the core gives them no near-miss). Other worlds
 *              (the tutorial, M1): no recap, the old panel (Again restarts at once).
 *   order      a FX_FRAME_PHASE.normal frame handler: after RoomClearController's scoreRoll phase, where NewBestController
 *              stepped its tracker and rolled its record rows, so new best's run-over state is this frame's.
 *   frame      the timeline steps with the frame's real seconds (held at 0 under the stage cover), the counted texts
 *              and fades go to RECAP_BINDINGS (written only on change), its sound edges through shared/view/audio
 *              recapCue (one sfx.score.tick / sfx.score.land a frame, none on the run-over jingle's frame), the arm to
 *              the store (Again's keyboard focus brightens).
 *   re-derive  a new verdict or other final numbers (the cached key: verdict, snapshot score / floor, baseline run)
 *              rebuild the input; when the content differs a new timeline starts at the old one's clock (rows due show
 *              final, silently; a settled recap stays settled).
 *   presses    (RR7) one shared/play RunOverRetryGate: the Again button (HudActions.again), Enter / Space on a
 *              keyboard (a ContextActionService binding above the input sink while the panel is up, nothing over it)
 *              and FIRE press edges that did not begin over a GUI (SimController.getFrameButtons) skip the timeline
 *              before RECAP.retryArmSec and restart after it (SimController.requestRestart); the bound `restart` key
 *              is SimController's own driver action and restarts at once. Party runs: a press only skips.
 *   reset      a run start or exit drops everything (store, bindings, the confirm binding).
 */
@Controller({})
export class RecapController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly gate = new RunOverRetryGate();
	private readonly cue: RecapCue = { id: "", volume: 0 };
	private teamProvider: RecapTeamMomentsProvider | undefined;
	/** The run over the recap belongs to (RunInfo.run); 0: no panel. */
	private openRun = 0;
	private timeline: RecapTimeline | undefined;
	private nearMiss: RecapNearMiss | undefined;
	private highlights: ReadonlyArray<RecapHighlight> = [];
	private signature = "";
	private key: DeriveKey | undefined;
	/** The stairs' walking distance, computed once per run over (a BFS over the floor). */
	private stairsTiles: number | undefined;
	private reducedMotion = false;
	/** The panel's first frame: the run-over jingle's (no recap sound). */
	private firstFrame = true;
	private confirmBound = false;
	// --- what the bindings were last written from (NaN: rewrite, e.g. after a locale switch) ---
	private shownNearMiss = 0 / 0;
	private readonly shownCells: number[] = [];

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly audio: AudioController,
		private readonly fx: FxTrackerController,
		private readonly input: InputController,
		private readonly teamMoments: TeamMomentsController,
	) {}

	onStart(): void {
		// docs/RUN_RECAP.md CM6: the run's co-op moments (zero outside party runs; debug moments never count).
		this.setTeamMomentsProvider(() => this.teamMoments.totals());
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt), FX_FRAME_PHASE.normal);
		this.sim.onRunStarted(() => this.close());
		this.sim.onRunExited(() => this.close());
		this.janitor.Add(onLocaleChanged(() => this.invalidateTexts()));
		this.janitor.Add(() => this.unbindConfirm());
	}

	/**
	 * Part B's seam (docs/RUN_RECAP.md CM6): the controller owning the run's TeamMoments registers how to read them;
	 * undefined unregisters. Read at the panel's open and at every verdict re-derive.
	 */
	setTeamMomentsProvider(provider: RecapTeamMomentsProvider | undefined): void {
		this.teamProvider = provider;
	}

	/** The run-over Again / Retry Daily button (HudActions.again): through the gate. */
	again(): void {
		this.press("again");
	}

	/** The run-over Details / Highlights button (HudActions.toggleRecapDetails, RRD5). */
	toggleDetails(): void {
		this.audio.playUi(SFX.uiClick);
		clientStore.toggleRecapDetails();
	}

	// --- the frame --------------------------------------------------------------------------------------

	private frame(settings: Readonly<JuiceSettings>, dt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const st = clientStore.getState();
		if (st.game.snapshot.outcome === "playing") {
			if (this.openRun !== 0) this.close();
			return;
		}
		const run = st.game.run.run;
		if (this.openRun !== run) this.open(ctx, st, settings.reducedMotion);
		else this.rederive(ctx, st);
		this.syncConfirm(st);
		if (this.gate.fireEdge(this.sim.getFrameButtons(), this.input.mousePressOnGui()) && this.pressAllowed(st)) {
			this.press("fire");
		}
		const t = this.timeline;
		if (t === undefined) return;
		const f = t.step(selectStageCovered(st) ? 0 : dt);
		const cue = recapCue(f, this.firstFrame, this.cue);
		this.firstFrame = false;
		if (cue !== undefined) this.audio.play(cue.id, cue.volume);
		if (f.armedNow) clientStore.setRecapArmed(true);
		this.writeBindings(t);
	}

	/** The panel opened for run `RunInfo.run`: build the recap (see the class comment). */
	private open(ctx: RunContext, st: ClientState, reducedMotion: boolean): void {
		this.close();
		const run = st.game.run.run;
		this.openRun = run;
		this.reducedMotion = reducedMotion;
		this.firstFrame = true;
		this.stairsTiles = this.stairsOf(ctx);
		this.key = this.deriveKeyOf(st);
		// FIRE counts as held at the open: an attack held or mashed through the death must be let go first.
		this.gate.open(true);
		const input = this.inputOf(ctx, st);
		if (input === undefined) {
			// No recap (the tutorial, M1, unscored worlds): the old panel; Again restarts at once (the gate's rule).
			clientStore.clearRecap();
			return;
		}
		this.nearMiss = nearMissFor(input);
		this.highlights = pickHighlights(input);
		this.signature = recapSignature(this.nearMiss, this.highlights);
		this.timeline = new RecapTimeline(this.timelineOptions(st));
		clientStore.showRecap(run, this.nearMiss, this.highlights, this.timeline.isArmed());
	}

	/** A new verdict / other final numbers: rebuild, and swap the content silently when it differs. */
	private rederive(ctx: RunContext, st: ClientState): void {
		const old = this.timeline;
		if (old === undefined) return;
		const key = this.deriveKeyOf(st);
		const k = this.key;
		if (
			k !== undefined &&
			k.verdict === key.verdict &&
			k.score === key.score &&
			k.floor === key.floor &&
			k.baselineRun === key.baselineRun
		) {
			return;
		}
		this.key = key;
		const input = this.inputOf(ctx, st);
		if (input === undefined) return;
		const nearMiss = nearMissFor(input);
		const highlights = pickHighlights(input);
		const signature = recapSignature(nearMiss, highlights);
		if (signature === this.signature) return;
		this.nearMiss = nearMiss;
		this.highlights = highlights;
		this.signature = signature;
		const base = this.timelineOptions(st);
		let renewed = new RecapTimeline({ ...base, atSec: old.elapsed() });
		// A settled (or skipped) recap stays settled: the new rows show final, with no sound.
		if (old.isSettled() && !renewed.isSettled()) {
			renewed = new RecapTimeline({ ...base, atSec: math.max(old.elapsed(), renewed.settleSec) });
		}
		this.timeline = renewed;
		this.invalidateTexts();
		clientStore.updateRecap(nearMiss, highlights);
	}

	/** Drops the recap (a run start / exit, or the panel closed). */
	private close(): void {
		this.unbindConfirm();
		this.openRun = 0;
		this.timeline = undefined;
		this.nearMiss = undefined;
		this.highlights = [];
		this.signature = "";
		this.key = undefined;
		this.stairsTiles = undefined;
		this.invalidateTexts();
		resetRecapBindings();
		clientStore.clearRecap();
	}

	private timelineOptions(st: ClientState): RecapTimelineOptions {
		const best = this.runOverBestOf(st);
		const records = best.records;
		// A record run (docs/RUN_RECAP.md RRD3): the highlights (and the dim sub-line) after NB's rows have rolled.
		const rows = records.first ? 0 : math.min(records.rows.size(), NEW_BEST_DRAW.maxRecordRows);
		const nm = this.nearMiss;
		return {
			nearMiss: nm !== undefined ? recapNearMissRow(nm) : undefined,
			highlights: this.highlights.map((h) => recapHighlightRow(h)),
			recordRowsSec: records.record ? recapRecordRowsSec(rows) : undefined,
			reducedMotion: this.reducedMotion,
		};
	}

	// --- presses (RR7) ----------------------------------------------------------------------------------

	/** Nothing is over the run-over panel (Options, leaderboards, a menu screen, the stage cover). */
	private pressAllowed(st: ClientState): boolean {
		return (
			this.openRun !== 0 &&
			!selectAnyPanelOpen(st) &&
			selectMenuScreen(st) === "none" &&
			!selectStageCovered(st) &&
			!st.menu.leaveConfirm
		);
	}

	private press(source: RunOverPressSource): void {
		const st = clientStore.getState();
		if (this.openRun === 0 || this.openRun !== st.game.run.run) {
			// No recap yet (the panel's first frame has not run): the old rule, Again restarts at once.
			if (source === "again") this.retry();
			return;
		}
		const exits = runOverExits(st.game.run.coop, st.lobby.mine !== undefined);
		const result = this.gate.press(source, this.timeline, exits.again);
		if (result === "retry") this.retry();
	}

	private retry(): void {
		this.audio.playUi(SFX.uiConfirm);
		this.sim.requestRestart();
	}

	/** Enter / Space on a keyboard press the focused Again while the panel is up and nothing is over it (RR7). */
	private syncConfirm(st: ClientState): void {
		const want = this.timeline !== undefined && st.game.inputDevice === "keyboard" && this.pressAllowed(st);
		if (want === this.confirmBound) return;
		if (want) {
			// A confirm key the player bound to `restart` stays the restart key (it retries at once, SimController).
			const restart = inputsFor(this.input.getBindings(), "kbm", "restart");
			const keys = CONFIRM_KEYS.filter((k) => !restart.includes(k.Name));
			ContextActionService.BindActionAtPriority(
				CONFIRM_ACTION,
				(_, state) => {
					if (state !== Enum.UserInputState.Begin) return Enum.ContextActionResult.Sink;
					if (!this.pressAllowed(clientStore.getState())) return Enum.ContextActionResult.Pass;
					this.press("confirm");
					return Enum.ContextActionResult.Sink;
				},
				false,
				CONFIRM_PRIORITY,
				...keys,
			);
			this.confirmBound = true;
		} else this.unbindConfirm();
	}

	private unbindConfirm(): void {
		if (!this.confirmBound) return;
		ContextActionService.UnbindAction(CONFIRM_ACTION);
		this.confirmBound = false;
	}

	// --- bindings ---------------------------------------------------------------------------------------

	private invalidateTexts(): void {
		this.shownNearMiss = 0 / 0;
		this.shownCells.clear();
	}

	private writeBindings(t: RecapTimeline): void {
		const B = RECAP_BINDINGS;
		const pack = this.theme.getPack();
		const s = (key: string, vars?: StringVars) => pack.str(key, vars);
		const now = t.elapsed();
		const nm = this.nearMiss;
		if (nm !== undefined && t.nearMissRow >= 0) {
			const row = t.rows[t.nearMissRow];
			if (row.value !== this.shownNearMiss) {
				this.shownNearMiss = row.value;
				B.nearMissText.write(recapNearMissText(nm, row.value, s));
			}
			const fade = recapRowTransparency(row, now);
			B.nearMissTransparency.write(nm.dim ? 1 - (1 - fade) * (1 - RECAP_UI.dimTransparency) : fade);
		}
		for (let i = 0; i < B.cellValue.size(); i++) {
			const h = this.highlights[i];
			const row = t.rows[t.firstHighlightRow + i];
			if (h === undefined || row === undefined) continue;
			if (this.shownCells[i] !== row.value) {
				this.shownCells[i] = row.value;
				const hex = h.colourRole !== undefined ? pack.hex(h.colourRole as ColorRole) : "";
				B.cellValue[i].write(recapHighlightValue(h, row.value, s, hex));
			}
			B.cellTransparency[i].write(recapRowTransparency(row, now));
		}
	}

	// --- the input (RR6) --------------------------------------------------------------------------------

	private deriveKeyOf(st: ClientState): DeriveKey {
		const snap = st.game.snapshot;
		return { verdict: st.game.verdict, score: snap.score, floor: snap.floor, baselineRun: st.records.baselineRun };
	}

	private runOverBestOf(st: ClientState) {
		const snap = st.game.snapshot;
		return runOverBest(
			st.records.baseline,
			st.records.baselineRun,
			st.game.run.run,
			st.game.verdict,
			snap.score,
			snap.floor,
		);
	}

	/** The stairs' walking distance from the view player's death position (non-boss endless floors; once a run over). */
	private stairsOf(ctx: RunContext): number | undefined {
		const state = ctx.run.state;
		const e = state.endless;
		const floorOf = ctx.endlessFloor;
		if (e === undefined || floorOf === undefined || isBossFloor(e.floor)) return undefined;
		const [ok, world] = pcall(() => floorOf(e.floor));
		if (!ok) return undefined;
		const p = playerAt(state, this.sim.getViewPlayerIndex());
		return stairsPathTiles(
			{ dungeon: world.dungeon, stairX: world.stairX, stairZ: world.stairZ, stairsOpen: e.stairsOpen !== 0 },
			p.x,
			p.z,
		);
	}

	/** The view player's duos and evolved boons (level III, BOON_MAX_LEVEL); zeros without builds. */
	private buildsOf(ctx: RunContext, view: number): RecapBuildsInput {
		const state = ctx.run.state;
		const build = state.builds?.players[view];
		const owned = state.run?.players[view];
		if (build === undefined) return { duos: 0, evolutions: 0 };
		let evolutions = 0;
		if (owned !== undefined)
			for (const b of owned.boons) if ((build.levels[b] ?? 0) >= BOON_MAX_LEVEL) evolutions++;
		return { duos: build.duos.size(), evolutions };
	}

	/** Everything the recap reads, or undefined when the run gets no recap (see the class comment). */
	private inputOf(ctx: RunContext, st: ClientState): RunRecapInput | undefined {
		const world = recapWorldOf(ctx);
		const state = ctx.run.state;
		const score = state.score;
		if (world === "other" || score === undefined) return undefined;
		const snap = st.game.snapshot;
		const view = this.sim.getViewPlayerIndex();
		const floor = state.endless?.floor ?? snap.floor;
		const depth = state.endless?.depth ?? snap.depth;
		const bossFloor = floor > 0 && isBossFloor(floor);
		// The snapshot names the boss while it is engaged and alive (bossVisible) or defeated (bossId alone).
		const boss: RecapBossInput | undefined =
			snap.bossId !== ""
				? {
						engaged: true,
						alive: snap.bossVisible,
						hpFraction: bossFraction(snap.bossHp, snap.bossHpMax),
						bossId: snap.bossId,
				  }
				: undefined;
		const nextBossId =
			floor > 0 && isBossFloor(floor + 1) ? bossKindFor(floorSeed(ctx.seed, floor + 1)) : undefined;
		const [cleared, total] = floorRoomTally(score);
		const best = this.runOverBestOf(st);
		const baseline = st.records.baselineRun === st.game.run.run ? st.records.baseline : UNRANKED;
		const verdict = st.game.verdict;
		const accepted = verdict.run === st.game.run.run && verdict.status === "accepted";
		const prevToday = accepted ? verdict.daily?.previous?.score : undefined;
		return {
			world,
			partySize: partySize(state),
			viewIndex: view,
			score,
			kills: snap.kills,
			floor,
			depth,
			startDepth: ctx.config.endless?.startDepth,
			builds: this.buildsOf(ctx, view),
			bossFloor,
			boss,
			nextBossId,
			stairsTiles: this.stairsTiles,
			roomsCleared: cleared,
			roomsUncleared: math.max(0, total - cleared),
			baseline,
			records: best.records,
			dailyBestToday: world === "daily" ? prevToday : undefined,
			tally: ctx.run.recapTally,
			team: this.teamProvider?.(ctx) ?? NO_TEAM_MOMENTS,
		};
	}
}
