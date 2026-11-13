import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HapticService, UserInputService, Workspace } from "@rbxts/services";
import { clientStore, selectDisplay, selectInputDevice, selectMenuShown } from "client/store";
import { touchHapticsOn } from "shared/settings";
import { partySize } from "shared/sim";
import { StateWatch } from "shared/view";
import {
	HAPTIC_DEBUG,
	HapticGenerations,
	PLAY_HAPTICS,
	PLAY_HAPTICS_PRIORITY,
	PLAY_HAPTICS_RULES,
	PLAY_HAPTIC_KINDS,
	PlayHapticsDirector,
	PlayHapticsInputBuilder,
	hapticDebugOf,
	hapticDeviceOf,
	hapticTimeline as playTimeline,
	hurtKindLanded,
	localParryCount,
	newPlayHapticsFacts,
	playCueSeconds,
	scanHapticEvents,
	touchWaveform,
	type FxEventBuffer,
	type HapticDevice,
	type HapticEvent,
	type HapticMotor,
	type HapticWaveInterp,
	type PlayHaptic,
	type PlayHapticsFrame,
} from "shared/view/fx";
import { hapticTimeline, menuHapticsOn, type MenuHaptic } from "shared/view/menu";
import { InputController } from "../game/InputController";
import { SimController } from "../game/SimController";
import { FX_FRAME_PHASE, FxTrackerController } from "./FxTrackerController";
import { NearMissController } from "./NearMissController";

/** The engine's motor for a pulse's motor name. */
const MOTORS: { readonly [K in HapticMotor]: Enum.VibrationMotor } = {
	Small: Enum.VibrationMotor.Small,
	Large: Enum.VibrationMotor.Large,
};
const MOTOR_NAMES: ReadonlyArray<HapticMotor> = ["Small", "Large"];
/** The engine's key interpolation for a waveform point's (never a bare string to an engine constructor). */
const WAVE_INTERP: { readonly [K in HapticWaveInterp]: Enum.KeyInterpolationMode } = {
	Constant: Enum.KeyInterpolationMode.Constant,
	Linear: Enum.KeyInterpolationMode.Linear,
};

/** The phone effects' folder (Workspace: see TOUCH_EFFECT_PARENT). */
const TOUCH_FOLDER_NAME = "KV_Haptics";
/** Debug print prefix. */
const LOG = "[Haptics]";

/** The navigation gamepad, else the first connected one, else none (menu cues: today's pad). */
function navigationPad(): Enum.UserInputType | undefined {
	const [okNav, nav] = pcall(() => UserInputService.GetNavigationGamepads());
	if (okNav && nav.size() > 0) return nav[0];
	const [okAll, all] = pcall(() => UserInputService.GetConnectedGamepads());
	if (okAll && all.size() > 0) return all[0];
	return undefined;
}

/** The pad can vibrate `motor` (every engine call behind pcall: unsupported pads and platforms answer false). */
function motorSupported(pad: Enum.UserInputType, motor: Enum.VibrationMotor): boolean {
	const [okVib, vib] = pcall(() => HapticService.IsVibrationSupported(pad));
	if (!okVib || !vib) return false;
	const [okMotor, has] = pcall(() => HapticService.IsMotorSupported(pad, motor));
	return okMotor && has;
}

/** A play cue's pad timeline and, per motor, the second its last event lands (0: the cue leaves that motor alone). */
interface PadCue {
	readonly events: ReadonlyArray<HapticEvent>;
	readonly untilSec: { readonly [K in HapticMotor]: number };
	readonly uses: { readonly [K in HapticMotor]: boolean };
}

function padCueOf(kind: PlayHaptic): PadCue {
	const events = playTimeline(PLAY_HAPTICS[kind].pad, PLAY_HAPTICS_RULES.rampStepSec);
	const untilSec = { Small: 0, Large: 0 };
	const uses = { Small: false, Large: false };
	for (const e of events) {
		untilSec[e.motor] = math.max(untilSec[e.motor], e.atSec);
		uses[e.motor] = true;
	}
	return { events, untilSec, uses };
}

/** The last play cue's generation on one pad + motor (one object per pad + motor, reused). */
interface PlayHold {
	readonly pad: Enum.UserInputType;
	readonly motor: HapticMotor;
	gen: number;
	active: boolean;
}

/** Which backend a play cue went to (KV_HapticDebug). */
type BackendResult = "motor" | "effect" | "no pad" | "no motor" | "held" | "effect off" | "no device";

/**
 * The ONE haptics controller (docs/HAPTICS.md HP2-HP4, HP6; was PadHapticsController, docs/GAMEPAD_MENUS.md GM9): the
 * only code that touches the haptic engine APIs. Two backends:
 *
 *   motor    pads, through HapticService:SetMotor, every call behind pcall and only on a motor the pad reports
 *            (IsVibrationSupported / IsMotorSupported). Menu cues (`play`, MENU_HAPTICS, unchanged) go to the
 *            navigation pad and always take over (HapticGenerations without a priority). Play cues go to the pad that
 *            drives the view player (InputController.getActivePad, else the navigation pad, else the first connected)
 *            with PLAY_HAPTICS_PRIORITY per pad + motor, so a weaker play cue never cuts a stronger one. Pulses are
 *            scheduled with task.delay (a closure per event of a played cue: cues are rare, never per frame).
 *   effect   phones (touch, Touch vibration On): one HapticEffect per play kind (nine), Custom, never Looped, the
 *            waveform set once (SetWaveformKeys from touchWaveform, ms), created on the first frame touch is on.
 *            A newer stronger cue Stop()s the running weaker one first; a weaker one while a stronger runs is never
 *            played. Any engine failure disables the backend for the session (logged once under KV_HapticDebug).
 *            Pads on phones get nothing from it (HPD11: no fallback to the phone's actuator).
 *
 * Play cues (HP4): once a frame, in FX_FRAME_PHASE.haptics (after every normal frame handler, so the freeze of the
 * same frame and NearMissController's parry cues are in), the frame's facts (the tracker events of the frame, the run
 * view's per-killer kills, the view player's local parry, its hurt edge from this controller's own StateWatch, the
 * quiet gates, the device) go through shared/view/fx PlayHapticsInputBuilder into the ONE PlayHapticsDirector, and its
 * cue plays on the current device's backend. `stopAll` (the edge into quiet, spectating or no device; a device change)
 * drops every pending play pulse and zeroes the motors play cues hold (a menu cue that took a motor over keeps it);
 * the phone's running effect stops. A run exit, a new run and the tracker's reset do the same. The run's end is the
 * exception (the director's `ending`): the lethal hit or boss death of the frame the run ends on plays and rings out.
 *
 * Everything (menus and play) goes to 0 on cleanup, on Gamepad vibration Off and when the device leaves the gamepad;
 * the phone's effects stop on Touch vibration Off and when the device leaves touch.
 *
 * Debug (HP6): Workspace attribute KV_HapticDebug (HAPTIC_DEBUG, off by default) prints every play cue played (kind,
 * device, backend) and every drop with its reason; an integer 1..7 fires that test cue once per change on the current
 * device, even outside a run (still only on a vibrating device with its setting On).
 */
@Controller({})
export class HapticsController implements OnStart {
	private readonly janitor = new Janitor();
	/** Per pad + motor: the latest cue's generation (a scheduled event of an older one is skipped). */
	private readonly generations = new HapticGenerations();
	/** Pads and motors set above 0, to turn off on cleanup. */
	private readonly touched = new Map<Enum.UserInputType, Set<Enum.VibrationMotor>>();
	/** Cleaned up: scheduled events do nothing more. */
	private stopped = false;

	// --- play cues -------------------------------------------------------------------------------
	private readonly director = new PlayHapticsDirector();
	private readonly builder = new PlayHapticsInputBuilder();
	private readonly facts = newPlayHapticsFacts();
	private readonly watch = new StateWatch();
	private readonly padCues = new Map<PlayHaptic, PadCue>();
	/** Per pad + motor key: the last play cue's generation there. */
	private readonly playHolds = new Map<string, PlayHold>();
	/** The local parry cue NearMissController dispatched this frame (undefined: none). */
	private pendingParry: number | undefined;
	/** Per player: the run view's credited kills already seen (RecapTally.kills). */
	private readonly seenKills = new Array<number>();
	private seenRun: object | undefined;

	// --- phone effects ---------------------------------------------------------------------------
	private readonly effects = new Map<PlayHaptic, HapticEffect>();
	private effectsBuilt = false;
	private effectsOff = false;
	private effectFolder: Folder | undefined;
	private runningEffect: PlayHaptic | undefined;
	private runningEffectUntil = 0;

	// --- debug -----------------------------------------------------------------------------------
	private debug = false;
	/** Why the phone backend was disabled (undefined: it was not), and whether that was printed. */
	private effectFailure: string | undefined;
	private loggedEffectFailure = false;

	constructor(
		private readonly sim: SimController,
		private readonly fx: FxTrackerController,
		private readonly nearMiss: NearMissController,
		private readonly input: InputController,
	) {}

	onStart(): void {
		for (const kind of PLAY_HAPTIC_KINDS) this.padCues.set(kind, padCueOf(kind));
		this.janitor.Add(() => {
			this.stopped = true;
			this.stopPads();
			this.stopTouch();
			this.destroyEffects();
		}, true);
		// Gamepad vibration Off or the device leaving the gamepad: every motor off now, pending pulses dropped. Touch
		// vibration Off or the device leaving touch: the phone's effect stops.
		const gates = () => {
			const state = clientStore.getState();
			const device = selectInputDevice(state);
			const display = selectDisplay(state);
			if (!menuHapticsOn(device, display.padVibration)) this.stopPads();
			if (!touchHapticsOn(device, display.touchVibration)) this.stopTouch();
		};
		this.janitor.Add(clientStore.subscribe(selectInputDevice, gates));
		this.janitor.Add(clientStore.subscribe((s) => selectDisplay(s).padVibration, gates));
		this.janitor.Add(clientStore.subscribe((s) => selectDisplay(s).touchVibration, gates));

		this.nearMiss.onFrame((frame) => {
			this.pendingParry = localParryCount(frame, PLAY_HAPTICS_RULES.parryBigFrom);
		});
		this.fx.onEvent((e) => {
			if (e.type === "reset") this.resetPlay();
		});
		this.fx.onFrame((events) => this.frame(events), FX_FRAME_PHASE.haptics);
		this.sim.onRunStarted(() => this.resetPlay());
		this.sim.onRunExited(() => this.resetPlay());

		this.readDebug(false);
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(HAPTIC_DEBUG.attribute).Connect(() => this.readDebug(true)),
		);
	}

	/** Plays menu `cue` on the navigation pad (nothing off the pad, with vibration Off, or on a pad without that motor). */
	play(cue: MenuHaptic): void {
		const state = clientStore.getState();
		if (this.stopped) return;
		if (!menuHapticsOn(selectInputDevice(state), selectDisplay(state).padVibration)) return;
		const pad = navigationPad();
		if (pad === undefined) return;
		const padName = pad.Name;
		const gens = new Map<HapticMotor, number>();
		for (const e of hapticTimeline(cue)) {
			const motor = MOTORS[e.motor];
			if (!motorSupported(pad, motor)) continue;
			let gen = gens.get(e.motor);
			if (gen === undefined) {
				gen = this.generations.begin(padName, e.motor);
				gens.set(e.motor, gen);
			}
			const g = gen;
			const apply = () => {
				if (this.stopped || !this.generations.current(padName, e.motor, g)) return;
				this.setMotor(pad, motor, e.strength);
			};
			if (e.atSec <= 0) apply();
			// Not kept in the Janitor (one entry per pulse would pile up): cleanup sets `stopped` and turns the motors off.
			else task.delay(e.atSec, apply);
		}
	}

	// --- play frame ------------------------------------------------------------------------------

	private frame(events: FxEventBuffer): void {
		const parry = this.pendingParry;
		this.pendingParry = undefined;
		if (this.stopped) return;
		const ctx = this.sim.getContext();
		const f = this.facts;
		const store = clientStore.getState();
		const display = selectDisplay(store);
		f.inputDevice = selectInputDevice(store);
		f.padVibration = display.padVibration;
		f.touchVibration = display.touchVibration;
		f.menuShown = selectMenuShown(store);
		f.parryCount = parry;
		scanHapticEvents(events, f.events);
		f.inRun = ctx !== undefined;
		f.hurt = "none";
		f.viewPops = 0;
		f.teamPops = 0;
		if (ctx !== undefined) {
			const state = ctx.run.state;
			const localIndex = this.sim.getLocalPlayerIndex();
			const view = this.sim.getViewPlayerIndex();
			f.localIndex = localIndex;
			f.viewIndex = view;
			f.partySize = partySize(state);
			f.paused = ctx.live?.isPaused() === true;
			const mine = state.run?.players[localIndex];
			f.draftOpen = mine !== undefined && mine.draftOpen !== 0;
			f.stageCovered = this.sim.isInputCovered() || this.sim.isHeldByLoader();
			f.runOver = this.sim.isRunOver() || this.sim.isFrozen();
			f.scored = state.score !== undefined;
			this.countPops(ctx.run, view);
			this.watch.update(state, view);
			if (view < this.watch.players()) {
				f.hurt = hurtKindLanded(this.watch.hurtKind[view], this.sim.getFrameEvents()?.playerHits);
			}
		}
		const out = this.director.frame(this.builder.build(f), os.clock());
		this.apply(out, hapticDeviceOf(f.inputDevice, f.padVibration, f.touchVibration));
	}

	/** The run view's credited kills since the last frame: the view player's and everyone's (facts.viewPops / teamPops). */
	private countPops(run: { readonly recapTally: { readonly kills: ReadonlyArray<number> } }, view: number): void {
		const kills = run.recapTally.kills;
		const seen = this.seenKills;
		if (this.seenRun !== run) {
			// A new run view: its tally starts from what it holds now.
			this.seenRun = run;
			seen.clear();
		}
		const n = kills.size();
		while (seen.size() < n) seen.push(kills[seen.size()]);
		let team = 0;
		let mine = 0;
		for (let p = 0; p < n; p++) {
			const delta = math.max(0, kills[p] - seen[p]);
			seen[p] = kills[p];
			team += delta;
			if (p === view) mine = delta;
		}
		this.facts.viewPops = mine;
		this.facts.teamPops = team;
	}

	private apply(out: PlayHapticsFrame, device: HapticDevice | undefined): void {
		if (out.stopAll) {
			this.stopPlay();
			if (this.debug) print(`${LOG} stopAll`);
		}
		if (this.debug) {
			for (const d of out.drops) print(`${LOG} drop ${d.kind} (${d.reason})`);
		}
		const cue = out.cue;
		if (cue === undefined) return;
		const backend = this.playCue(cue, device);
		if (this.debug) print(`${LOG} play ${cue} on ${device ?? "none"} (${backend})`);
	}

	/** Plays play cue `kind` on `device`'s backend now. */
	private playCue(kind: PlayHaptic, device: HapticDevice | undefined): BackendResult {
		if (device === "pad") return this.playPadCue(kind, os.clock());
		if (device === "touch") return this.playTouchCue(kind, os.clock());
		return "no device";
	}

	// --- motor backend (pads) ------------------------------------------------------------------

	/** The pad play cues vibrate: the one driving the local / view player, else the navigation pad. */
	private playPad(): Enum.UserInputType | undefined {
		return this.input.getActivePad() ?? navigationPad();
	}

	private playPadCue(kind: PlayHaptic, nowSec: number): BackendResult {
		const pad = this.playPad();
		if (pad === undefined) return "no pad";
		const cue = this.padCues.get(kind);
		if (cue === undefined) return "no motor";
		const padName = pad.Name;
		const priority = PLAY_HAPTICS_PRIORITY[kind];
		let smallGen: number | undefined;
		let largeGen: number | undefined;
		let supported = false;
		let held = false;
		for (const m of MOTOR_NAMES) {
			if (!cue.uses[m] || !motorSupported(pad, MOTORS[m])) continue;
			supported = true;
			const gen = this.generations.begin(padName, m, priority, nowSec, nowSec + cue.untilSec[m]);
			if (gen === undefined) {
				held = true;
				continue;
			}
			this.holdOf(pad, m).gen = gen;
			this.holdOf(pad, m).active = true;
			if (m === "Small") smallGen = gen;
			else largeGen = gen;
		}
		if (!supported) return "no motor";
		if (smallGen === undefined && largeGen === undefined) return held ? "held" : "no motor";
		for (const e of cue.events) {
			const gen = e.motor === "Small" ? smallGen : largeGen;
			if (gen === undefined) continue;
			const motor = MOTORS[e.motor];
			const apply = () => {
				if (this.stopped || !this.generations.current(padName, e.motor, gen)) return;
				this.setMotor(pad, motor, e.strength);
			};
			if (e.atSec <= 0) apply();
			else task.delay(e.atSec, apply);
		}
		return "motor";
	}

	private holdOf(pad: Enum.UserInputType, motor: HapticMotor): PlayHold {
		const key = `${pad.Name}/${motor}`;
		let hold = this.playHolds.get(key);
		if (hold === undefined) {
			hold = { pad, motor, gen: 0, active: false };
			this.playHolds.set(key, hold);
		}
		return hold;
	}

	private setMotor(pad: Enum.UserInputType, motor: Enum.VibrationMotor, strength: number): void {
		pcall(() => HapticService.SetMotor(pad, motor, strength));
		let set = this.touched.get(pad);
		if (set === undefined) {
			set = new Set();
			this.touched.set(pad, set);
		}
		if (strength > 0) set.add(motor);
		else set.delete(motor);
	}

	/** Every motor this controller set, on every pad, back to 0; every pending event (menu and play) is dropped. */
	private stopPads(): void {
		this.generations.clear();
		for (const [pad, motors] of this.touched) {
			for (const motor of motors) pcall(() => HapticService.SetMotor(pad, motor, 0));
		}
		this.touched.clear();
		for (const [, hold] of this.playHolds) hold.active = false;
	}

	/**
	 * Play cues stop (stopAll, a menu or the quiet gates, a new run): every pad + motor a play cue still holds goes to 0
	 * and its pending events are dropped (a menu cue that has taken the motor over since is left alone); the phone's
	 * running effect stops.
	 */
	private stopPlay(): void {
		for (const [, hold] of this.playHolds) {
			if (!hold.active) continue;
			hold.active = false;
			const padName = hold.pad.Name;
			if (!this.generations.current(padName, hold.motor, hold.gen)) continue;
			// A priority-free begin drops the play cue's later events and its hold.
			this.generations.begin(padName, hold.motor);
			this.setMotor(hold.pad, MOTORS[hold.motor], 0);
		}
		this.stopTouch();
	}

	/** A new run, a run exit or the tracker's reset: the director and the watch start over, play cues stop. */
	private resetPlay(): void {
		this.director.reset();
		this.watch.reset();
		this.pendingParry = undefined;
		this.seenRun = undefined;
		this.seenKills.clear();
		this.stopPlay();
	}

	// --- effect backend (phones) ---------------------------------------------------------------

	private playTouchCue(kind: PlayHaptic, nowSec: number): BackendResult {
		if (!this.buildEffects()) return "effect off";
		const effect = this.effects.get(kind);
		if (effect === undefined) return "effect off";
		const running = this.runningEffect;
		if (running !== undefined && nowSec < this.runningEffectUntil) {
			// The director already drops a weaker cue; guard anyway: a weaker cue never cuts a stronger one.
			if (PLAY_HAPTICS_PRIORITY[kind] < PLAY_HAPTICS_PRIORITY[running]) return "held";
			const old = this.effects.get(running);
			if (old !== undefined && !this.effectCall(() => old.Stop())) return "effect off";
		}
		if (!this.effectCall(() => effect.Play())) return "effect off";
		this.runningEffect = kind;
		this.runningEffectUntil = nowSec + playCueSeconds(kind, "touch");
		return "effect";
	}

	/** The running phone effect stops (one that already ran out is left alone: no needless engine call). */
	private stopTouch(): void {
		const running = this.runningEffect;
		this.runningEffect = undefined;
		if (running === undefined || this.effectsOff || !(os.clock() < this.runningEffectUntil)) return;
		const effect = this.effects.get(running);
		if (effect !== undefined) this.effectCall(() => effect.Stop());
	}

	/**
	 * The nine phone effects exist (built on first use; false once the backend is disabled). Parent: a Folder in
	 * Workspace, no Position / Radius set (a non-spatial effect; HP0 row 1e confirms where one must live to vibrate the
	 * phone).
	 */
	private buildEffects(): boolean {
		if (this.effectsOff) return false;
		if (this.effectsBuilt) return true;
		this.effectsBuilt = true;
		const [okFolder, folder] = pcall(() => {
			const f = new Instance("Folder");
			f.Name = TOUCH_FOLDER_NAME;
			f.Parent = Workspace;
			return f;
		});
		if (!okFolder) return this.disableEffects(`folder: ${folder}`);
		this.effectFolder = folder;
		for (const kind of PLAY_HAPTIC_KINDS) {
			const [ok, result] = pcall(() => {
				const effect = new Instance("HapticEffect");
				effect.Name = kind;
				effect.Type = Enum.HapticEffectType.Custom;
				effect.Looped = false;
				const keys = new Array<FloatCurveKey>();
				for (const p of touchWaveform(PLAY_HAPTICS[kind].touch))
					keys.push(new FloatCurveKey(p.tMs, p.value, WAVE_INTERP[p.interp]));
				effect.SetWaveformKeys(keys);
				effect.Parent = folder;
				return effect;
			});
			if (!ok) return this.disableEffects(`${kind}: ${result}`);
			this.effects.set(kind, result);
		}
		return true;
	}

	/** One engine call on an effect; a failure disables the backend for the session. */
	private effectCall(call: () => void): boolean {
		const [ok, err] = pcall(call);
		if (!ok) this.disableEffects(`call: ${err}`);
		return ok;
	}

	private disableEffects(reason: string): false {
		this.effectsOff = true;
		this.runningEffect = undefined;
		this.effectFailure = reason;
		this.logEffectFailure();
		this.destroyEffects();
		return false;
	}

	/** The phone backend's failure, printed once, and only under KV_HapticDebug (now or when it is turned on). */
	private logEffectFailure(): void {
		const reason = this.effectFailure;
		if (!this.debug || reason === undefined || this.loggedEffectFailure) return;
		this.loggedEffectFailure = true;
		warn(`${LOG} HapticEffect backend disabled for this session (${reason})`);
	}

	private destroyEffects(): void {
		for (const [, effect] of this.effects) pcall(() => effect.Destroy());
		this.effects.clear();
		const folder = this.effectFolder;
		this.effectFolder = undefined;
		if (folder !== undefined) pcall(() => folder.Destroy());
	}

	// --- debug (HP6) -------------------------------------------------------------------------------

	/** Reads KV_HapticDebug; on a change to an integer 1..7, fires that test cue once on the current device. */
	private readDebug(changed: boolean): void {
		const mode = hapticDebugOf(Workspace.GetAttribute(HAPTIC_DEBUG.attribute));
		this.debug = mode.print;
		this.logEffectFailure();
		if (!changed || mode.testCue === undefined) return;
		const state = clientStore.getState();
		const display = selectDisplay(state);
		const device = hapticDeviceOf(selectInputDevice(state), display.padVibration, display.touchVibration);
		const backend = this.playCue(mode.testCue, device);
		print(`${LOG} test ${mode.testCue} on ${device ?? "none"} (${backend})`);
	}
}
