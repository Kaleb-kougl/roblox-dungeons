import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { ContextActionService, UserInputService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
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
import {
	DEV_WORLD_KIND,
	ENDLESS_WORLD_KIND,
	RUN_RECAP_NO_NEAR_MISS,
	RunRecapViewClock,
	type RunRecapClose,
	type RunRecapReport,
} from "shared/run";
import type { JuiceSettings } from "shared/settings";
import { BOON_MAX_LEVEL, floorRoomTally, partySize, playerAt, treasureRunSummary } from "shared/sim";
import type { ColorRole, StringVars } from "shared/theme";
import { SFX, recapCue, type RecapCue } from "shared/view/audio";
import {
	NEW_BEST_DRAW,
	NO_TEAM_MOMENTS,
	RECAP_DEBUG,
	RECAP_UI,
	RecapViews,
	bossFraction,
	contribCellText,
	contributionOf,
	nearMissFor,
	pickHighlights,
	recapHighlightRow,
	recapHighlightValue,
	recapNearMissRow,
	recapNearMissText,
	recapRecordRowsSec,
	recapRowTransparency,
	recapTabStep,
	recapTabsShown,
	stairsPathTiles,
	type RecapTab,
	type RecapBossInput,
	type RecapBuildsInput,
	type RecapHighlight,
	type RecapNearMiss,
	type RecapTeamInput,
	type RecapViewsOptions,
	type RecapWorld,
	type RunBaseline,
	type RunContribution,
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
const TABS_ACTION = "KV_RecapTabs";
/**
 * docs/RUN_CONTRIBUTION.md CT6: a party run's tabs on the keyboard (Q previous, E next, Tab next / Shift+Tab previous),
 * bound like the confirm keys (above the input sink, only while the tabs show with nothing over the panel; a key bound
 * to `restart` is left to it). Q / E are Ember / Swap in a run: idle on the run-over panel.
 */
const TAB_PREV_KEYS: ReadonlyArray<Enum.KeyCode> = [Enum.KeyCode.Q];
const TAB_NEXT_KEYS: ReadonlyArray<Enum.KeyCode> = [Enum.KeyCode.E, Enum.KeyCode.Tab];
const UNRANKED: RunBaseline = { kind: "unranked" };

/** The recap's world from the run's world kind (shared/run, shared/daily): the tutorial and every other world: none. */
function recapWorldOf(ctx: RunContext): RecapWorld {
	if (ctx.tutorial) return "other";
	if (ctx.world === ENDLESS_WORLD_KIND) return "endless";
	if (ctx.world === DAILY_WORLD_KIND) return "daily";
	if (ctx.world === DEV_WORLD_KIND) return "dev";
	return "other";
}

/**
 * What the run-over's telemetry report (docs/RUN_RECAP.md RR9) needs beyond the recap's content: the run session, when
 * the panel opened, whether a press skipped the recap, the record flag and the team moments as last derived.
 */
interface ReportFacts {
	/** The server's run session (RunContext.runId); undefined: an unranked / dev run, nothing is sent. */
	readonly runId: string | undefined;
	readonly openedAt: number;
	readonly coop: boolean;
	skipped: boolean;
	record: boolean;
	team: RecapTeamInput;
	sent: boolean;
	/** docs/RUN_CONTRIBUTION.md CT8: a party run's tab views (undefined: no tabs). */
	readonly views: RunRecapViewClock | undefined;
}

/** What decides a re-derive (docs/RUN_RECAP.md "Rules": a verdict with other numbers re-derives silently). */
interface DeriveKey {
	readonly verdict: VerdictView;
	readonly score: number;
	readonly floor: number;
	readonly baselineRun: number;
}

/**
 * A compact fingerprint of the recap's content (near-miss line, cells and a party run's contribution: its You cells,
 * every row's numbers and title): a re-derive swaps only when it differs.
 */
function recapSignature(
	nearMiss: RecapNearMiss | undefined,
	highlights: ReadonlyArray<RecapHighlight>,
	contribution?: RunContribution,
): string {
	const parts = new Array<string>();
	if (nearMiss !== undefined) {
		parts.push(nearMiss.key, nearMiss.dim ? "d" : "-");
		for (const [k, v] of pairs(nearMiss.vars as unknown as ReadonlyMap<string, number>)) parts.push(`${k}=${v}`);
	}
	for (const h of highlights) parts.push(`${h.id}:${h.value}:${h.from}:${h.key}:${h.scope ?? ""}`);
	if (contribution !== undefined) {
		for (const c of contribution.youCells) parts.push(`y${c.kind}:${c.value}:${c.share ?? ""}`);
		for (const r of contribution.rows) {
			parts.push(`p${r.index}:${r.title}:${r.damageShare}:${r.kills}:${r.parries}:${r.hits}:${r.standing.kind}`);
		}
	}
	return parts.join("|");
}

/**
 * The run-over recap's driver (docs/RUN_RECAP.md RR6). Presentation only: reads the final state, the HUD snapshot,
 * new best's frozen baseline and the run view's collectors; writes the store's `recap` slice and RECAP_BINDINGS.
 *
 *   open       the frame the run-over panel opens (the snapshot's outcome is no longer "playing", as RunOverPanel reads
 *              it) the recap's input is built once (inputOf: world from the run's world kind; the boss from the
 *              snapshot's bossVisible / bossId / bossHp / bossHpMax; the stairs' walking distance from the death floor's
 *              world and the view player's position, once; room counts from floorRoomTally; the LOCAL player's duos
 *              and evolved boons (level III; `You` is the local player, never the view, docs/RUN_CONTRIBUTION.md CT1); new
 *              best's baseline and the panel's own record (runOverBest); a daily run's
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
 *   tabs       (docs/RUN_CONTRIBUTION.md CT6 / CT7) a party run's contribution is built at the open with the highlights
 *              (contributionOf: the run's tally, the LOCAL player, ctx.memberNames) and stored for the panel; the clocks are
 *              one shared/view/hud RecapViews (the near-miss line and the arm; the You cells counting where the
 *              highlights did; Team's highlights on its first open; Party final), setTab switches them (HudActions
 *              .setRecapTab from a tap or LB / RB, and Q / E / Tab bound here like the confirm keys), never a retry or a
 *              skip; a re-derive renews every clock at its old time.
 *   reset      a run start or exit drops everything (store, bindings, the confirm and tab bindings).
 *   telemetry  (RR9) once per run over with a recap, when the panel is left: `runRecap` (shared/run RunRecapReport) with
 *              the close (`retry`: Again / Retry Daily / the restart key, seen as our own retry, the run context going
 *              away under a ranked restart, or the next run starting; `exit`: the run left for the menu; `lobby`: any
 *              close of a party run), the seconds since the open (os.clock), the near-miss kind shown (or `none`), the
 *              record flag, whether a press skipped the timeline first, and a party run's team moments and tab views
 *              (CT8: RunRecapViewClock, seconds on You / Party and the last tab). Ranked runs
 *              only (the server takes one per run session it issued); the server logs it as `RunRecap`.
 *   timing     (RR8 aid) with the Workspace attribute RECAP_DEBUG.retryTimingAttribute (`KV_RetryTiming`, off by
 *              default, read at the press) a retry prints `[Recap] retry: press -> control <s> s` once the next run takes
 *              input (its stage cover gone, the fade included). Nothing is connected for it.
 */
@Controller({})
export class RecapController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly gate = new RunOverRetryGate();
	private readonly cue: RecapCue = { id: "", volume: 0 };
	private teamProvider: RecapTeamMomentsProvider | undefined;
	/** The run over the recap belongs to (RunInfo.run); 0: no panel. */
	private openRun = 0;
	/** The recap's clocks: the near-miss line and the arm, the highlights, a party run's tabs (shared/view/hud RecapViews). */
	private views: RecapViews | undefined;
	private nearMiss: RecapNearMiss | undefined;
	private highlights: ReadonlyArray<RecapHighlight> = [];
	/** docs/RUN_CONTRIBUTION.md CT7: a party run's contribution, built once at the open (re-derived with the recap). */
	private contribution: RunContribution | undefined;
	private signature = "";
	private key: DeriveKey | undefined;
	/** The stairs' walking distance, computed once per run over (a BFS over the floor). */
	private stairsTiles: number | undefined;
	private reducedMotion = false;
	/** The panel's first frame: the run-over jingle's (no recap sound). */
	private firstFrame = true;
	private confirmBound = false;
	private tabsBound = false;
	private facts: ReportFacts | undefined;
	/** RR8 aid: a retry press waiting for the next run's first controllable frame (KV_RetryTiming). */
	private retryTiming: { readonly at: number; readonly run: number } | undefined;
	// --- what the bindings were last written from (NaN: rewrite, e.g. after a locale switch) ---
	private shownNearMiss = 0 / 0;
	private readonly shownCells: number[] = [];
	private readonly shownYou: number[] = [];

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
		this.sim.onRunStarted(() => {
			this.reportClose("retry");
			this.close();
		});
		this.sim.onRunExited(() => {
			this.retryTiming = undefined;
			this.reportClose("exit");
			this.close();
		});
		this.janitor.Add(onLocaleChanged(() => this.invalidateTexts()));
		this.janitor.Add(() => this.unbindConfirm());
		this.janitor.Add(() => this.unbindTabs());
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

	/**
	 * A party run's run-over tab (docs/RUN_CONTRIBUTION.md CT6 / CT7: a tap, the pad's LB / RB, Q / E / Tab): the views
	 * switch (the tab left settles, Team's first open starts its count-up) and the store follows. Never a press for
	 * RunOverRetryGate: a tab neither retries nor skips.
	 */
	setTab(tab: RecapTab): void {
		const v = this.views;
		if (v === undefined || !v.tabbed || this.openRun === 0 || v.tab() === tab) return;
		if (clientStore.getState().recap.details) return;
		this.audio.playUi(SFX.uiClick);
		v.setTab(tab);
		this.invalidateTexts();
		clientStore.setRecapTab(tab);
	}

	// --- the frame --------------------------------------------------------------------------------------

	private frame(settings: Readonly<JuiceSettings>, dt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			// A ranked restart drops the run context on the press frame (SimController.beginRun): the restart key's too.
			if (this.openRun !== 0) this.reportClose("retry");
			return;
		}
		const st = clientStore.getState();
		this.stepRetryTiming(st);
		if (st.game.snapshot.outcome === "playing") {
			if (this.openRun !== 0) {
				this.reportClose("retry");
				this.close();
			}
			return;
		}
		const run = st.game.run.run;
		if (this.openRun !== run) this.open(ctx, st, settings.reducedMotion);
		else this.rederive(ctx, st);
		this.syncConfirm(st);
		this.syncTabs(st);
		if (this.gate.fireEdge(this.sim.getFrameButtons(), this.input.mousePressOnGui()) && this.pressAllowed(st)) {
			this.press("fire");
		}
		const t = this.views;
		if (t === undefined) return;
		const step = selectStageCovered(st) ? 0 : dt;
		// CT8: the seconds each tab's content showed (Details over the tabs counts for none).
		this.facts?.views?.step(step, t.tab(), st.recap.details ? undefined : t.tab());
		const f = t.step(step);
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
		this.contribution = this.contributionOf(ctx, input);
		this.signature = recapSignature(this.nearMiss, this.highlights, this.contribution);
		this.views = new RecapViews(this.viewsOptions(st));
		clientStore.showRecap(run, this.nearMiss, this.highlights, this.views.isArmed(), this.contribution);
		this.facts = {
			runId: ctx.runId,
			openedAt: os.clock(),
			coop: st.game.run.coop,
			skipped: false,
			record: this.runOverBestOf(st).records.record,
			team: input.team ?? NO_TEAM_MOMENTS,
			sent: false,
			views: this.views.tabbed ? new RunRecapViewClock() : undefined,
		};
	}

	/** A new verdict / other final numbers: rebuild, and swap the content silently when it differs. */
	private rederive(ctx: RunContext, st: ClientState): void {
		const old = this.views;
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
		const facts = this.facts;
		if (facts !== undefined) {
			facts.record = this.runOverBestOf(st).records.record;
			facts.team = input.team ?? NO_TEAM_MOMENTS;
		}
		const nearMiss = nearMissFor(input);
		const highlights = pickHighlights(input);
		const contribution = this.contributionOf(ctx, input);
		const signature = recapSignature(nearMiss, highlights, contribution);
		if (signature === this.signature) return;
		this.nearMiss = nearMiss;
		this.highlights = highlights;
		this.contribution = contribution;
		this.signature = signature;
		// Every clock at its old time; a settled (or skipped) one stays settled: new rows show final, with no sound.
		this.views = old.renewed(this.viewsOptions(st));
		this.invalidateTexts();
		clientStore.updateRecap(nearMiss, highlights, contribution);
	}

	/** Drops the recap (a run start / exit, or the panel closed). */
	private close(): void {
		this.unbindConfirm();
		this.unbindTabs();
		this.openRun = 0;
		this.views = undefined;
		this.nearMiss = undefined;
		this.highlights = [];
		this.contribution = undefined;
		this.signature = "";
		this.key = undefined;
		this.stairsTiles = undefined;
		this.facts = undefined;
		this.invalidateTexts();
		resetRecapBindings();
		clientStore.clearRecap();
	}

	private viewsOptions(st: ClientState): RecapViewsOptions {
		const best = this.runOverBestOf(st);
		const records = best.records;
		// A record run (docs/RUN_RECAP.md RRD3): the highlights (and the dim sub-line) after NB's rows have rolled; a
		// party run's You cells count there in their place (docs/RUN_CONTRIBUTION.md CT7).
		const rows = records.first ? 0 : math.min(records.rows.size(), NEW_BEST_DRAW.maxRecordRows);
		const nm = this.nearMiss;
		const c = this.contribution;
		return {
			tabbed: recapTabsShown(c, this.highlights.size()),
			nearMiss: nm !== undefined ? recapNearMissRow(nm) : undefined,
			highlights: this.highlights.map((h) => recapHighlightRow(h)),
			you: c !== undefined ? c.youCells.map((cell) => ({ from: 0, to: cell.value, counted: true })) : [],
			recordRowsSec: records.record ? recapRecordRowsSec(rows) : undefined,
			reducedMotion: this.reducedMotion,
		};
	}

	/**
	 * A party run's contribution (docs/RUN_CONTRIBUTION.md CT7), from the run's tally: the local player (CT1, never the
	 * view player), the party's display names by index. Solo runs: undefined (contributionOf's rule).
	 */
	private contributionOf(ctx: RunContext, input: RunRecapInput): RunContribution | undefined {
		return contributionOf({
			tally: input.tally,
			partySize: input.partySize,
			localIndex: input.localIndex,
			names: ctx.memberNames,
		});
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
		// A skip settles the near-miss line and the tab showing (RecapViews.skip).
		const result = this.gate.press(source, this.views, exits.again);
		if (result === "skip" && this.facts !== undefined) this.facts.skipped = true;
		if (result === "retry") this.retry();
	}

	private retry(): void {
		this.audio.playUi(SFX.uiConfirm);
		this.reportClose("retry");
		this.sim.requestRestart();
	}

	// --- telemetry (RR9) and the retry timing aid (RR8) -------------------------------------------------

	/** The run-over panel is being left (see the class comment): one `runRecap` per run over, ranked runs only. */
	private reportClose(close: RunRecapClose): void {
		const f = this.facts;
		if (f === undefined || f.sent) return;
		f.sent = true;
		const how: RunRecapClose = f.coop ? "lobby" : close;
		if (how === "retry" && Workspace.GetAttribute(RECAP_DEBUG.retryTimingAttribute) === true) {
			this.retryTiming = { at: os.clock(), run: this.openRun };
		}
		if (f.runId === undefined) return;
		const report: RunRecapReport = {
			runId: f.runId,
			close: how,
			seconds: os.clock() - f.openedAt,
			nearMiss: this.nearMiss?.kind ?? RUN_RECAP_NO_NEAR_MISS,
			record: f.record,
			skipped: f.skipped,
		};
		Events.runRecap.fire(
			how === "lobby"
				? {
						...report,
						team: {
							teamPerfects: f.team.teamPerfects,
							bestTeamStreak: f.team.bestTeamStreak,
							syncParries: f.team.syncParries,
						},
						// docs/RUN_CONTRIBUTION.md CT8: seconds on You and Party, the last tab (runs with the tabs).
						views: f.views?.views(),
				  }
				: report,
		);
	}

	/** KV_RetryTiming: the next run's first frame that takes input after a retry press prints the wait. */
	private stepRetryTiming(st: ClientState): void {
		const t = this.retryTiming;
		if (t === undefined || st.game.run.run === t.run || st.game.snapshot.outcome !== "playing") return;
		if (this.sim.isInputCovered() || this.sim.isHeldByLoader()) return;
		this.retryTiming = undefined;
		print(`[Recap] retry: press -> control ${string.format("%.2f", os.clock() - t.at)} s (run ${st.game.run.run})`);
	}

	/** Enter / Space on a keyboard press the focused Again while the panel is up and nothing is over it (RR7). */
	private syncConfirm(st: ClientState): void {
		const want = this.views !== undefined && st.game.inputDevice === "keyboard" && this.pressAllowed(st);
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

	/**
	 * docs/RUN_CONTRIBUTION.md CT6: Q / E / Tab (Shift+Tab: back) step a party run's tabs while they show (Details closed)
	 * and nothing is over the panel, on any device (a keyboard press must work on the first try); a key bound to
	 * `restart` is left to it. A tab key is never a press for the retry gate.
	 */
	private syncTabs(st: ClientState): void {
		const v = this.views;
		const want = v !== undefined && v.tabbed && !st.recap.details && this.pressAllowed(st);
		if (want === this.tabsBound) return;
		if (want) {
			const restart = inputsFor(this.input.getBindings(), "kbm", "restart");
			const keys = [...TAB_PREV_KEYS, ...TAB_NEXT_KEYS].filter((k) => !restart.includes(k.Name));
			ContextActionService.BindActionAtPriority(
				TABS_ACTION,
				(_, state, input) => {
					if (state !== Enum.UserInputState.Begin) return Enum.ContextActionResult.Sink;
					const now = this.views;
					if (now === undefined || !this.pressAllowed(clientStore.getState())) {
						return Enum.ContextActionResult.Pass;
					}
					const shift =
						UserInputService.IsKeyDown(Enum.KeyCode.LeftShift) ||
						UserInputService.IsKeyDown(Enum.KeyCode.RightShift);
					const back = TAB_PREV_KEYS.includes(input.KeyCode) || (input.KeyCode === Enum.KeyCode.Tab && shift);
					this.setTab(recapTabStep(now.tab(), back ? -1 : 1));
					return Enum.ContextActionResult.Sink;
				},
				false,
				CONFIRM_PRIORITY,
				...keys,
			);
			this.tabsBound = true;
		} else this.unbindTabs();
	}

	private unbindTabs(): void {
		if (!this.tabsBound) return;
		ContextActionService.UnbindAction(TABS_ACTION);
		this.tabsBound = false;
	}

	// --- bindings ---------------------------------------------------------------------------------------

	private invalidateTexts(): void {
		this.shownNearMiss = 0 / 0;
		this.shownCells.clear();
		this.shownYou.clear();
	}

	private writeBindings(t: RecapViews): void {
		const B = RECAP_BINDINGS;
		const pack = this.theme.getPack();
		const s = (key: string, vars?: StringVars) => pack.str(key, vars);
		const nm = this.nearMiss;
		const nmRow = t.nearMissRow();
		if (nm !== undefined && nmRow !== undefined) {
			if (nmRow.value !== this.shownNearMiss) {
				this.shownNearMiss = nmRow.value;
				B.nearMissText.write(recapNearMissText(nm, nmRow.value, s));
			}
			const fade = recapRowTransparency(nmRow, t.elapsed());
			B.nearMissTransparency.write(nm.dim ? 1 - (1 - fade) * (1 - RECAP_UI.dimTransparency) : fade);
		}
		// The highlights (a party run's Team tab: once opened, on its own clock).
		const teamNow = t.tabElapsed("team");
		for (let i = 0; i < B.cellValue.size(); i++) {
			const h = this.highlights[i];
			const row = t.cellRow("team", i);
			if (h === undefined || row === undefined) continue;
			if (this.shownCells[i] !== row.value) {
				this.shownCells[i] = row.value;
				const hex = h.colourRole !== undefined ? pack.hex(h.colourRole as ColorRole) : "";
				B.cellValue[i].write(recapHighlightValue(h, row.value, s, hex));
			}
			B.cellTransparency[i].write(recapRowTransparency(row, teamNow));
		}
		// docs/RUN_CONTRIBUTION.md CT7: the You cells (a party run's).
		const c = this.contribution;
		if (c === undefined || !t.tabbed) return;
		const youNow = t.tabElapsed("you");
		for (let i = 0; i < B.youValue.size(); i++) {
			const cell = c.youCells[i];
			const row = t.cellRow("you", i);
			if (cell === undefined || row === undefined) continue;
			if (this.shownYou[i] !== row.value) {
				this.shownYou[i] = row.value;
				B.youValue[i].write(contribCellText(cell, row.value, s));
			}
			B.youTransparency[i].write(recapRowTransparency(row, youNow));
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

	/** Player `me`'s duos and evolved boons (level III, BOON_MAX_LEVEL); zeros without builds. */
	private buildsOf(ctx: RunContext, me: number): RecapBuildsInput {
		const state = ctx.run.state;
		const build = state.builds?.players[me];
		const owned = state.run?.players[me];
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
		// `You` rows are the local player's (CT1): at a wipe the view stays on the last watched teammate.
		const me = this.sim.getLocalPlayerIndex();
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
			localIndex: me,
			score,
			kills: snap.kills,
			floor,
			depth,
			startDepth: ctx.config.endless?.startDepth,
			builds: this.buildsOf(ctx, me),
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
			// docs/TREASURE.md: the reserved Chests highlight, only in runs with treasure rooms (presentation only)
			chests: state.treasure !== undefined ? treasureRunSummary(state) : undefined,
		};
	}
}
