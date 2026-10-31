import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, Players, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore, selectRecordsStatus } from "client/store";
import { NEW_BEST_UI, resetNewBestUi } from "client/ui";
import type { JuiceSettings } from "shared/settings";
import { partySize } from "shared/sim";
import type { ColorRole, StringVars, ThemePack } from "shared/theme";
import {
	HUD_VIEW,
	NEW_BEST,
	NEW_BEST_DRAW,
	NEW_BEST_ROLE,
	NEW_BEST_STRINGS,
	NO_NEW_BEST_CUES,
	NewBestTracker,
	baselineFrom,
	boardFor,
	clearZoneRect,
	confettiPieceAt,
	debugBaseline,
	newBestRowText,
	parseNewBestDebug,
	type ConfettiPiece,
	type NewBestCueSource,
	type NewBestFrame,
	type NewBestInput,
	type NewBestLine,
	type RunBaseline,
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

/**
 * The new-best celebration's per-frame view (docs/NEW_BEST.md NB7). Presentation only, read-only on the sim.
 *
 *   records    listens to `records(RecordsStatus)` and asks once itself on start (`requestRecords`: the join's push
 *              may have come first); the status goes to the client store (records slice).
 *   baseline   at every run start (SimController.onRunStarted) the run's RunBaseline is frozen (NBD10) and stored with
 *              the run's counter: shared/view/hud baselineFrom(records, party size, world, ranked), where ranked is a
 *              server run session (RunContext.runId), not the tutorial, and scored; KV_NewBestDebug
 *              (NEW_BEST.debugAttribute, parseNewBestDebug / debugBaseline, read at run start) overrides a ranked run's
 *              baseline. A new NewBestTracker per run; a per-run Janitor drops what the run left on screen.
 *   frame      an onShownScore subscriber of RoomClearController: inside its FX_FRAME_PHASE.scoreRoll frame handler, right
 *              after the score roller produced the shown score and before every normal-phase handler (AudioController's
 *              cue mapper, which reads this frame through setNewBestCues; ComboController, which draws the shout). The
 *              tracker gets the shown score, the true score and floor, `underCover` (the stage card is up and not yet
 *              lifting: StageController.coverLifting, so an edge held under it fires on the reveal's first frame), the
 *              run's end (SimController.isRunOver) and reduced motion. On the fanfare frame RoomClearController's own
 *              clear / perfect jingle is dropped (dropClearJingle, NBD7).
 *   draws      NEW_BEST_UI (the score panel's target row: text only on a change, colour, slam; the number's gold and
 *              shine; the touch strip's compact line), the NEW BEST! floor shout on the crossing (ComboController's
 *              shout slot, priority over a tier shout), and the gold confetti: one ScreenGui (KV_NewBestConfetti, over the
 *              HUD: NEW_BEST_DRAW.confettiDisplayOrderAboveHud) with a pool of plain Frames placed by confettiPieceAt
 *              (in-run: only outside HUD_CLEAR_ZONE; none under reduced motion).
 * An unranked run (tutorial, M1, unscored, a local-seed run) writes nothing: its HUD is exactly the old one.
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

	// --- the run ----------------------------------------------------------------------------------------

	private newRun(ctx: RunContext): void {
		this.endRun();
		const baseline = this.baselineOf(ctx);
		clientStore.setRunBaseline(baseline, ctx.counter);
		if (baseline.kind === "unranked") return;
		this.tracker = new NewBestTracker(baseline);
		// What this run draws goes with it (a run start, Leave run / Main menu): the bindings, the confetti.
		this.runJanitor.Add(() => {
			resetNewBestUi();
			this.rowLine = "";
			this.rowGap = -1;
			this.rowMargin = -1;
			this.hideConfetti();
		}, true);
	}

	/** The run's frozen baseline (see the class comment). */
	private baselineOf(ctx: RunContext): RunBaseline {
		const state = ctx.run.state;
		const ranked = ctx.runId !== undefined && !ctx.tutorial && state.score !== undefined;
		const party = partySize(state);
		const baseline = baselineFrom(selectRecordsStatus(clientStore.getState()), party, ctx.world, ranked);
		if (baseline.kind === "unranked") return baseline;
		const debug = parseNewBestDebug(Workspace.GetAttribute(NEW_BEST.debugAttribute));
		return debug !== undefined ? debugBaseline(debug, boardFor(party)) : baseline;
	}

	/** Nothing of the last run left: no tracker, no cues, neutral bindings, no confetti (ComboController drops the shout). */
	private endRun(): void {
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
		this.drawRow(look);
		if (look.fanfare) this.roomClear.dropClearJingle();
		if (look.scoreCrossed) this.shout();
		this.drawConfetti(look.confettiSeed, look.confettiAge, false);
	}

	private str(key: string, vars?: StringVars): string {
		return this.pack?.str(key, vars) ?? key;
	}

	private color(roleName: string): Color3 {
		return this.pack?.color(roleName as ColorRole) ?? new Color3();
	}

	/** The score panel's target row, the number's gold and shine, the touch strip's compact line. */
	private drawRow(look: NewBestFrame): void {
		const U = NEW_BEST_UI;
		if (look.line !== this.rowLine || look.gap !== this.rowGap || look.margin !== this.rowMargin) {
			this.rowLine = look.line;
			this.rowGap = look.gap;
			this.rowMargin = look.margin;
			const s = (key: string, vars?: StringVars) => this.str(key, vars);
			U.rowText.write(newBestRowText(look, false, s));
			U.compactText.write(newBestRowText(look, true, s));
		}
		if (look.line === "chasing") U.rowColor.write(this.color("uiTextDim"));
		else if (look.line === "reach") {
			const ember = this.color("ember");
			const mix = look.pulse * NEW_BEST_DRAW.reachPulseMix;
			U.rowColor.write(mix > 0 ? ember.Lerp(this.color("uiText"), mix) : ember);
		} else if (look.line === "passed") U.rowColor.write(this.color(NEW_BEST_ROLE));
		U.rowScale.write(look.slamScale);
		U.scoreGold.write(look.goldMix * (1 - look.whiteFlash));
		U.shine.write(look.shine);
	}

	/** NEW BEST! in the floor shout's slot (priority over a tier shout; ComboController draws it). */
	private shout(): void {
		this.combo.requestShout(this.str(NEW_BEST_STRINGS.shout), this.color(NEW_BEST_ROLE), NEW_BEST.shout.lifeSec);
	}

	// --- confetti ---------------------------------------------------------------------------------------

	private buildConfetti(): ScreenGui {
		const gui = new Instance("ScreenGui");
		gui.Name = GUI_NAME;
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
