import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, Players, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import {
	clientStore,
	selectAnyPanelOpen,
	selectCoopOverlay,
	selectDailyStatus,
	selectMenuScreen,
	selectRecordsStatus,
	type VerdictView,
} from "client/store";
import { NEW_BEST_UI, resetNewBestUi, runOverBest, type RunOverBest, createKvScreenGui } from "client/ui";
import { DAILY_WORLD_KIND } from "shared/daily";
import type { JuiceSettings } from "shared/settings";
import { partySize } from "shared/sim";
import type { ColorRole, StringVars, ThemePack } from "shared/theme";
import { SFX } from "shared/view/audio";
import {
	DAILY_RANK,
	FLOOR_SHOUT_PRIORITY,
	HUD_VIEW,
	NEW_BEST,
	NEW_BEST_DRAW,
	NEW_BEST_ROLE,
	NO_NEW_BEST_CUES,
	NewBestTracker,
	baselineFrom,
	boardFor,
	clearZoneRect,
	confettiPieceAt,
	dailyBaselineFrom,
	debugBaseline,
	isDailyBaseline,
	newBestRowText,
	newBestShoutKey,
	parseDailyRankDebug,
	parseNewBestDebug,
	recordRollEdges,
	recordRollValue,
	recordRowText,
	type ConfettiPiece,
	type NewBestCueSource,
	type NewBestFrame,
	type NewBestInput,
	type NewBestLine,
	type RecordRollEdges,
	type RecordRow,
	type RunBaseline,
	withPendingRuns,
} from "shared/view/hud";
import { AudioController } from "../audio/AudioController";
import { SimController, type RunContext } from "../game/SimController";
import { StageController } from "../game/StageController";
import { ThemeController } from "../game/ThemeController";
import { ComboController } from "./ComboController";
import { RoomClearController } from "./RoomClearController";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const GUI_NAME = "KV_NewBestConfetti";
const HIDDEN = 1;
const UNRANKED: RunBaseline = { kind: "unranked" };
/** The confetti pool: enough Frames for the larger burst. */
const CONFETTI_POOL = math.max(NEW_BEST.confetti.inRun.count, NEW_BEST.confetti.runOver.count);
/** A gold piece's sparkle: its tone (0..1) mixes the gold this far toward uiText. */
const CONFETTI_TONE_MIX = 0.5;
/** The run-over burst's seed is the run's last in-run burst seed plus this (a pattern of its own). */
const RUN_OVER_SEED_STEP = 1;
const NO_ROWS: ReadonlyArray<RecordRow> = [];

/** What a rank layer puts in the score panel's target row in place of new best's text (strings resolved). */
export interface NewBestRowOverride {
	readonly text: string;
	readonly compact: string;
	readonly color: Color3;
}

/**
 * The Daily's in-run rank layer (docs/DAILY.md DS10: DailyRankController), driven from here so its order is fixed: it
 * starts with a daily run's frozen best-today baseline, ends with the run, and steps right after the new-best tracker
 * in the same frame (the shown score, the cover, run over); a row it returns replaces new best's text.
 */
export interface NewBestRankLayer {
	newRun(ctx: RunContext, baseline: RunBaseline): void;
	endRun(): void;
	frame(look: Readonly<NewBestFrame>, input: Readonly<NewBestInput>): NewBestRowOverride | undefined;
}

/**
 * The new-best celebration's per-frame view (docs/NEW_BEST.md NB7). Presentation only, read-only on the sim.
 *
 *   records    listens to `records(RecordsStatus)` and asks once itself on start (`requestRecords`: the join's push
 *              may have come first); the status goes to the client store (records slice).
 *   baseline   at every run start (SimController.onRunStarted) the run's RunBaseline is frozen (NBD10) and stored with
 *              the run's counter: shared/view/hud baselineFrom(records, party size, world, ranked), where ranked is a
 *              server run session (RunContext.runId), not the tutorial, and scored, and records are the store's with
 *              earlier ranked runs still awaiting their verdict / records push folded in (withPendingRuns over
 *              SimController.pendingRunClaims: an R-restart or a quick Again must not aim at the old best); KV_NewBestDebug
 *              (NEW_BEST.debugAttribute, parseNewBestDebug / debugBaseline, read at run start) overrides a ranked run's
 *              baseline. A new NewBestTracker per run; a per-run Janitor drops what the run left on screen.
 *   frame      an onShownScore subscriber of RoomClearController: inside its FX_FRAME_PHASE.scoreRoll frame handler,
 *              right after the score roller produced the shown score and before every normal-phase handler (AudioController's
 *              cue mapper, which reads this frame through setNewBestCues; ComboController, which draws the shout). The
 *              tracker gets the shown score, the true score and floor, `underCover` (the stage card is up and not yet
 *              lifting: StageController.coverLifting, so an edge held under it fires on the reveal's first frame), the
 *              run's end (SimController.isRunOver) and reduced motion. On the fanfare frame RoomClearController's own
 *              clear / perfect jingle is dropped (dropClearJingle, NBD7).
 *   draws      NEW_BEST_UI (the score panel's target row: text only on a change, colour, slam; the number's gold and
 *              shine; the touch strip's compact line), the NEW BEST! floor shout on the crossing (ComboController's
 *              shout slot, priority over a tier shout), and the gold confetti: one ScreenGui (KV_NewBestConfetti, over
 *              the HUD: NEW_BEST_DRAW.confettiDisplayOrderAboveHud) with a pool of plain Frames placed by confettiPieceAt
 *              (in-run: only outside HUD_CLEAR_ZONE, hidden while a menu is up over the run (menuOver: the solo pause,
 *              the party overlay, options, leaderboards); none under reduced motion).
 *   run over   (NB9) from the run's end, the run-over panel's record (client/ui runOverBest: the same function the
 *              panel draws from, so both agree; the server's verdict records win once they arrive): the record rows roll
 *              (recordRollValue, real seconds since the run ended) into NEW_BEST_UI.recordRows with sfx.score.tick at
 *              each row's start and sfx.score.land at its landing (recordRollEdges, through AudioController), and a
 *              record run throws the full-screen confetti once (none under reduced motion). The record fanfare itself
 *              is the cue mapper's (the tracker's recordRun on the wipe frame).
 * An unranked run (tutorial, M1, unscored, a local-seed run) writes nothing: its HUD is exactly the old one.
 *
 * Daily runs (docs/DAILY.md DS10, DSD6): the baseline is best today (shared/view/hud dailyBaselineFrom over the store's
 * last dailyStatus, for the run's own seed, with this day's pending daily claims folded in; KV_DailyRankDebug's `best`
 * or KV_NewBestDebug override it in Studio), the strings say "best today", the shout ranks FLOOR_SHOUT_PRIORITY.newBest
 * (over the rank layer's thresholds), and the rank layer (setRankLayer: DailyRankController) starts with the run, steps
 * right after the tracker each frame and may take over the target row once best today is passed.
 */
@Controller({})
export class NewBestController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly runJanitor = new Janitor();
	private readonly input: Mutable<NewBestInput> = {
		dt: 0,
		shownScore: 0,
		score: 0,
		floor: 0,
		underCover: false,
		runOver: false,
		reducedMotion: false,
	};
	private tracker: NewBestTracker | undefined;
	/** The run's baseline is a daily run's (best today): its strings, its rank layer. */
	private daily = false;
	private rankLayer: NewBestRankLayer | undefined;
	/** The rank layer's row strings last written (undefined: new best's own text is in the row). */
	private overrideText: string | undefined;
	private overrideCompact: string | undefined;
	/** The latest tracker frame (this frame's once the tracker stepped; none with no ranked run). */
	private cues: NewBestCueSource = NO_NEW_BEST_CUES;
	private pack: ThemePack | undefined;
	// --- what the row's strings were last built from ---
	private rowLine: NewBestLine | "" = "";
	private rowGap = -1;
	private rowMargin = -1;
	// --- the confetti ---
	private gui: ScreenGui | undefined;
	private readonly pieces = new Array<Frame>();
	private readonly piece: ConfettiPiece = { x: 0, y: 0, sizePx: 0, rotationDeg: 0, transparency: 1, tone: 0 };
	private confettiShown = false;
	// --- the run over (NB9) ---
	/** os.clock() when the run ended (-1: not over), and the last frame's seconds since. */
	private overAt = -1;
	private overPrevT = 0;
	/** Seconds after the run's end when the full-screen confetti started (-1: not yet). */
	private overConfettiAt = -1;
	private overBest: RunOverBest | undefined;
	private overVerdict: VerdictView | undefined;
	private overScore = -1;
	private overFloor = -1;
	private readonly rollEdges: RecordRollEdges = { started: 0, landed: 0 };

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly stage: StageController,
		private readonly audio: AudioController,
		private readonly roomClear: RoomClearController,
		private readonly combo: ComboController,
	) {}

	onStart(): void {
		this.pack = this.theme.getPack();
		this.gui = this.janitor.Add(this.buildConfetti());
		this.janitor.Add(this.runJanitor, "Cleanup");
		this.janitor.Add(Events.records.connect((status) => clientStore.setRecordsStatus(status)));
		Events.requestRecords.fire();
		this.audio.setNewBestCues(() => this.cues);
		this.sim.onRunStarted((ctx) => this.newRun(ctx));
		this.sim.onRunExited(() => this.endRun());
		this.roomClear.onShownScore((shown, settings, dt) => this.frame(shown, settings, dt));
	}

	/** The Daily's rank layer registers itself (DailyRankController.onStart). */
	setRankLayer(layer: NewBestRankLayer): void {
		this.rankLayer = layer;
	}

	// --- the run ----------------------------------------------------------------------------------------

	private newRun(ctx: RunContext): void {
		this.endRun();
		const baseline = this.baselineOf(ctx);
		clientStore.setRunBaseline(baseline, ctx.counter);
		if (baseline.kind === "unranked") return;
		this.tracker = new NewBestTracker(baseline);
		this.daily = isDailyBaseline(baseline);
		if (this.daily) this.rankLayer?.newRun(ctx, baseline);
		// What this run draws goes with it (a run start, Leave run / Main menu): the bindings, the confetti.
		this.runJanitor.Add(() => {
			resetNewBestUi();
			this.rowLine = "";
			this.rowGap = -1;
			this.rowMargin = -1;
			this.overrideText = undefined;
			this.overrideCompact = undefined;
			this.hideConfetti();
			this.overAt = -1;
			this.overPrevT = 0;
			this.overConfettiAt = -1;
			this.overBest = undefined;
			this.overVerdict = undefined;
		}, true);
	}

	/** The run's frozen baseline (see the class comment). */
	private baselineOf(ctx: RunContext): RunBaseline {
		const state = ctx.run.state;
		const ranked = ctx.runId !== undefined && !ctx.tutorial && state.score !== undefined;
		const party = partySize(state);
		if (ctx.world === DAILY_WORLD_KIND) return this.dailyBaselineOf(ctx, party, ranked);
		// Earlier ranked runs whose verdict (and so the records push) has not arrived yet count too (pendingRunClaims).
		const records = withPendingRuns(
			selectRecordsStatus(clientStore.getState()),
			boardFor(party),
			this.sim.pendingRunClaims(),
		);
		const baseline = baselineFrom(records, party, ctx.world, ranked);
		if (baseline.kind === "unranked") return baseline;
		const debug = parseNewBestDebug(Workspace.GetAttribute(NEW_BEST.debugAttribute));
		return debug !== undefined ? debugBaseline(debug, boardFor(party)) : baseline;
	}

	/**
	 * A daily run's frozen baseline (docs/DAILY.md DS10): best today from the store's last dailyStatus for the run's
	 * seed, this day's pending daily claims folded in; in Studio KV_DailyRankDebug's `best` (with its forced board) or
	 * KV_NewBestDebug override a ranked run's, score only.
	 */
	private dailyBaselineOf(ctx: RunContext, party: number, ranked: boolean): RunBaseline {
		const status = selectDailyStatus(clientStore.getState());
		const baseline = dailyBaselineFrom(status, party, ctx.seed, ranked, this.sim.pendingRunClaims());
		if (baseline.kind === "unranked") return baseline;
		const board = boardFor(party);
		const rankDebug = parseDailyRankDebug(Workspace.GetAttribute(DAILY_RANK.debugAttribute));
		if (rankDebug !== undefined) {
			return debugBaseline(
				rankDebug.best > 0 ? { kind: "set", score: rankDebug.best, floor: 0 } : { kind: "first" },
				board,
				true,
			);
		}
		const debug = parseNewBestDebug(Workspace.GetAttribute(NEW_BEST.debugAttribute));
		return debug !== undefined ? debugBaseline(debug, board, true) : baseline;
	}

	/** Nothing of the last run left: no tracker, no cues, neutral bindings, no confetti
	 * (ComboController drops the shout).
	 */
	private endRun(): void {
		if (this.daily) this.rankLayer?.endRun();
		this.daily = false;
		this.tracker = undefined;
		this.cues = NO_NEW_BEST_CUES;
		this.runJanitor.Cleanup();
		if (clientStore.getState().records.baselineRun !== 0) clientStore.setRunBaseline(UNRANKED, 0);
	}

	// --- the frame --------------------------------------------------------------------------------------

	private frame(shown: number, settings: Readonly<JuiceSettings>, dt: number): void {
		const tracker = this.tracker;
		const state = this.sim.getState();
		if (tracker === undefined || state === undefined) return;
		const input = this.input;
		input.dt = dt;
		input.shownScore = shown;
		input.score = state.score?.total ?? 0;
		input.floor = state.endless?.floor ?? 0;
		input.underCover = !this.stage.coverLifting();
		input.runOver = this.sim.isRunOver();
		input.reducedMotion = settings.reducedMotion;
		const look = tracker.frame(input);
		this.cues = look;
		// The Daily's rank layer steps right after the tracker (DS10) and may own the row past best today.
		this.drawRow(look, this.daily ? this.rankLayer?.frame(look, input) : undefined);
		if (look.fanfare) this.roomClear.dropClearJingle();
		if (look.scoreCrossed) this.shout();
		if (input.runOver) this.runOverFrame(look, settings.reducedMotion);
		else if (this.menuOver()) this.hideConfetti();
		else this.drawConfetti(look.confettiSeed, look.confettiAge, false);
	}

	/**
	 * A menu is up over the run: the solo pause (the sim UI-paused: pause overlay, options), the co-op party overlay, a
	 * menu screen, options or leaderboards. The in-run confetti hides under it (its layer sits under the menus, so it
	 * would hang frozen or keep falling behind the dim); the run-over confetti is not affected.
	 */
	private menuOver(): boolean {
		const st = clientStore.getState();
		return (
			this.sim.getContext()?.live?.isPaused() === true ||
			selectAnyPanelOpen(st) ||
			selectCoopOverlay(st) ||
			selectMenuScreen(st) !== "none"
		);
	}

	// --- the run over (NB9) -----------------------------------------------------------------------------

	private runOverFrame(look: NewBestFrame, reducedMotion: boolean): void {
		const now = os.clock();
		if (this.overAt < 0) {
			this.overAt = now;
			this.overPrevT = 0;
		}
		const t = now - this.overAt;
		const records = this.runOverRecordsNow().records;
		const rows = records.record && !records.first ? records.rows : NO_ROWS;
		const s = (key: string, vars?: StringVars) => this.str(key, vars);
		const U = NEW_BEST_UI.recordRows;
		for (let i = 0; i < U.size(); i++) {
			const row = rows[i];
			U[i].write(
				row !== undefined ? recordRowText(row, recordRollValue(row, i, t), s, undefined, this.daily) : "",
			);
		}
		const edges = recordRollEdges(math.min(rows.size(), U.size()), this.overPrevT, t, this.rollEdges);
		for (let i = 0; i < edges.started; i++) this.audio.play(SFX.scoreTick, 1);
		for (let i = 0; i < edges.landed; i++) this.audio.play(SFX.scoreLand, 1);
		this.overPrevT = t;
		if (records.record && !reducedMotion && this.overConfettiAt < 0) this.overConfettiAt = t;
		const age = this.overConfettiAt >= 0 ? t - this.overConfettiAt : -1;
		if (age >= 0 && age < NEW_BEST.confetti.runOver.lifeSec) {
			this.drawConfetti(look.confettiSeed + RUN_OVER_SEED_STEP, age, true);
		} else this.drawConfetti(look.confettiSeed, look.confettiAge, false);
	}

	/** The run-over panel's new-best state now (recomputed only when the verdict or the final numbers change). */
	private runOverRecordsNow(): RunOverBest {
		const st = clientStore.getState();
		const verdict = st.game.verdict;
		const snap = st.game.snapshot;
		const cached = this.overBest;
		if (
			cached !== undefined &&
			verdict === this.overVerdict &&
			snap.score === this.overScore &&
			snap.floor === this.overFloor
		) {
			return cached;
		}
		this.overVerdict = verdict;
		this.overScore = snap.score;
		this.overFloor = snap.floor;
		const best = runOverBest(
			st.records.baseline,
			st.records.baselineRun,
			st.game.run.run,
			verdict,
			snap.score,
			snap.floor,
		);
		this.overBest = best;
		return best;
	}

	private str(key: string, vars?: StringVars): string {
		return this.pack?.str(key, vars) ?? key;
	}

	private color(roleName: string): Color3 {
		return this.pack?.color(roleName as ColorRole) ?? new Color3();
	}

	/**
	 * The score panel's target row, the number's gold and shine, the touch strip's compact line. `override`: the Daily's
	 * rank layer owns the row's text and colour this frame (DS10); the gold number, shine and slam stay new best's.
	 */
	private drawRow(look: NewBestFrame, override?: NewBestRowOverride): void {
		const U = NEW_BEST_UI;
		if (override !== undefined) {
			if (override.text !== this.overrideText) {
				this.overrideText = override.text;
				U.rowText.write(override.text);
			}
			if (override.compact !== this.overrideCompact) {
				this.overrideCompact = override.compact;
				U.compactText.write(override.compact);
			}
			this.rowLine = ""; // new best's text is rebuilt when it takes the row back
			U.rowColor.write(override.color);
		} else {
			this.overrideText = undefined;
			this.overrideCompact = undefined;
			this.drawBestRow(look);
		}
		U.rowScale.write(look.slamScale);
		U.scoreGold.write(look.goldMix * (1 - look.whiteFlash));
		U.shine.write(look.shine);
	}

	/** New best's own target row text and colour (daily runs: the best-today strings). */
	private drawBestRow(look: NewBestFrame): void {
		const U = NEW_BEST_UI;
		if (look.line !== this.rowLine || look.gap !== this.rowGap || look.margin !== this.rowMargin) {
			this.rowLine = look.line;
			this.rowGap = look.gap;
			this.rowMargin = look.margin;
			const s = (key: string, vars?: StringVars) => this.str(key, vars);
			U.rowText.write(newBestRowText(look, false, s, undefined, this.daily));
			U.compactText.write(newBestRowText(look, true, s, undefined, this.daily));
		}
		if (look.line === "chasing") U.rowColor.write(this.color("uiTextDim"));
		else if (look.line === "reach") {
			const ember = this.color("ember");
			const mix = look.pulse * NEW_BEST_DRAW.reachPulseMix;
			U.rowColor.write(mix > 0 ? ember.Lerp(this.color("uiText"), mix) : ember);
		} else if (look.line === "passed") U.rowColor.write(this.color(NEW_BEST_ROLE));
	}

	/**
	 * NEW BEST! (daily: NEW BEST TODAY!) in the floor shout's slot, ranked over the rank layer's threshold shouts and
	 * the tier shouts (FLOOR_SHOUT_PRIORITY; ComboController draws it).
	 */
	private shout(): void {
		this.combo.requestShout(
			this.str(newBestShoutKey(this.daily)),
			this.color(NEW_BEST_ROLE),
			NEW_BEST.shout.lifeSec,
			FLOOR_SHOUT_PRIORITY.newBest,
		);
	}

	// --- confetti ---------------------------------------------------------------------------------------

	private buildConfetti(): ScreenGui {
		const gui = createKvScreenGui(GUI_NAME);
		gui.ResetOnSpawn = false;
		gui.IgnoreGuiInset = true;
		gui.ScreenInsets = Enum.ScreenInsets.None;
		gui.DisplayOrder = HUD_VIEW.hudDisplayOrder + NEW_BEST_DRAW.confettiDisplayOrderAboveHud;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		gui.Enabled = false;
		for (let i = 0; i < CONFETTI_POOL; i++) {
			const frame = new Instance("Frame");
			frame.Name = `Piece${i}`;
			frame.AnchorPoint = new Vector2(1 / 2, 1 / 2);
			frame.BorderSizePixel = 0;
			frame.BackgroundTransparency = HIDDEN;
			frame.Visible = false;
			frame.Active = false;
			frame.Interactable = false;
			frame.Selectable = false;
			frame.Parent = gui;
			this.pieces.push(frame);
		}
		gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
		return gui;
	}

	/**
	 * One burst (`seed`) `age` seconds in (< 0: none): in-run (`fullScreen` false) only outside the clear zone, else
	 * over the whole screen (the run over).
	 */
	private drawConfetti(seed: number, age: number, fullScreen: boolean): void {
		const gui = this.gui;
		if (gui === undefined) return;
		if (age < 0) {
			this.hideConfetti();
			return;
		}
		const viewport = Workspace.CurrentCamera?.ViewportSize ?? Vector2.zero;
		const [ok, inset] = pcall(() => GuiService.TopbarInset);
		const zone = clearZoneRect(viewport.X, viewport.Y, ok ? inset.Max.Y : 0);
		const count = fullScreen ? NEW_BEST.confetti.runOver.count : NEW_BEST.confetti.inRun.count;
		const gold = this.color(NEW_BEST_ROLE);
		const white = this.color("uiText");
		for (let i = 0; i < this.pieces.size(); i++) {
			const frame = this.pieces[i];
			const p =
				i < count
					? confettiPieceAt(seed, i, age, viewport.X, viewport.Y, zone, fullScreen, this.piece)
					: undefined;
			if (p === undefined) {
				if (frame.Visible) frame.Visible = false;
				continue;
			}
			frame.Position = UDim2.fromOffset(p.x, p.y);
			frame.Size = UDim2.fromOffset(p.sizePx, p.sizePx);
			frame.Rotation = p.rotationDeg;
			frame.BackgroundTransparency = p.transparency;
			frame.BackgroundColor3 = gold.Lerp(white, p.tone * CONFETTI_TONE_MIX);
			if (!frame.Visible) frame.Visible = true;
		}
		if (!this.confettiShown) {
			this.confettiShown = true;
			gui.Enabled = true;
		}
	}

	private hideConfetti(): void {
		if (!this.confettiShown) return;
		this.confettiShown = false;
		for (const frame of this.pieces) frame.Visible = false;
		if (this.gui !== undefined) this.gui.Enabled = false;
	}
}
