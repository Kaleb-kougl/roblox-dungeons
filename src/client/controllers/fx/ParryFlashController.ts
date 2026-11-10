import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { currentHudFont, onLocaleChanged } from "client/ui";
import { MAX_PARTY_SIZE, partySize, type SimState } from "shared/sim";
import type { JuiceSettings } from "shared/settings";
import type { ThemePack } from "shared/theme";
import { lerp, studsX, studsZ } from "shared/view";
import {
	FX_SPRITE_VIEW,
	FX_VIEW,
	NEAR_MISS_VIEW,
	comboQuiet,
	parryFlashFade,
	parryFlashPop,
	type NearMissFrame,
	type ParryFlash,
} from "shared/view/fx";
import {
	COMBO_SHOUT_DRAW,
	PARRY_DEBUG,
	PARRY_FLASH_DRAW,
	ShoutDuck,
	floorAxes,
	parryFlashCentre,
	parryFlashLabel,
	parryFlashOpacity,
	parryFlashSize,
	shoutBoxAt,
	shoutDucked,
	type ParryFlashPoint,
	type ShoutBox,
} from "shared/view/hud";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";
import { NearMissController } from "./NearMissController";
import { FLOOR_CANVAS_YAW } from "../render/floorCanvas";
import { floorText, floorTextTopStuds, fxFolder } from "./fxHelpers";

const HIDDEN = 1;
const PARKED = new CFrame(FX_VIEW.parkedStuds[0], FX_VIEW.parkedStuds[1], FX_VIEW.parkedStuds[2]);
const AXES = floorAxes();

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** One player slot's floor text (built once on first use, reused) and what it last showed. */
interface FlashSlot {
	readonly part: Part;
	readonly surface: SurfaceGui;
	readonly label: TextLabel;
	readonly duck: ShoutDuck;
	visible: boolean;
	/** Listed by this frame's director output (or the debug flash). */
	seen: boolean;
	/** The label was built for this count (0: "PARRY!" alone; -1: never built). */
	shownCount: number;
	shownOpacity: number;
	shownSize: number;
}

/**
 * The PARRY! floor flash and the parry's solo freeze (docs/GRAZE_PARRY.md GP7, GPD5-GPD7). It subscribes to the ONE
 * near-miss director (NearMissController.onFrame, stepped once per rendered frame after the ticks) and, per frame:
 *   - for each live ParryFlash draws one floor text on that player's slot: `fx.parry.text`, plus ` fx.parry.count`
 *     ("PARRY! x5") once showCount (parryFlashLabel, rebuilt only when the count it shows changes), in colour role
 *     nearMiss.parry, centred NEAR_MISS_VIEW.flash.offsetTiles SCREEN-DOWN of the guarding player's feet at the frame's
 *     alpha (parryFlashCentre: minus the camera's floor up-screen axis, the opposite of the combo shout's offset), so
 *     the two texts never overlap, and following the player while it shows. Its text fills parryFlashSize(scale, pop)
 *     of the combo shout's box (the pop-in; a teammate's at flash.teammateScale); opacity parryFlashOpacity: the
 *     shout's cap (COMBO_SHOUT.maxOpacity) x the flash's fade, under the slot's ShoutDuck ceiling, ducked by
 *     shoutDucked over the enemy bullet pool in the text's own box (shoutBoxAt with that size) grown by
 *     COMBO_SHOUT.duckMarginTiles (CD9's rule and numbers, shared with ComboController).
 *     The construction is the combo shout's (CD9): ONE SurfaceGui on the Top face of a thin invisible floor Part per
 *     slot (COMBO_SHOUT's box, shoutCanvasSize's canvas, TextScaled HUD font with the background-coloured stroke),
 *     yawed by the camera, on FxSpriteController's "floor" placement at the shout's layer
 *     (COMBO_SHOUT_DRAW.layerStepsBelowEffects under the sprite effects), so every bullet, telegraph, marking, effect
 *     and body draws over it. A slot the frame no longer lists is hidden.
 *   - when `freezeMs > 0` asks the SimController's hitstop clock for it, like the heavy hit and the hurt freeze do. The
 *     director already gave it only for the view player's guard in a solo run with freezeFrameOn; the clock applies
 *     freezeFrameOn again (the same gate), the 150 ms clamp and the rate cap. No camera nudge (GPD7).
 * The director puts nothing out while quiet (the stage cover, run over) or on an unscored run, so those frames hide
 * every slot; a run start / exit and a frame with no run hide them too. Presentation only, read-only on the sim. Studio
 * aid: PARRY_DEBUG.attribute (KV_ParryDebug, off by default) forces one drawn flash on the view player.
 */
@Controller({})
export class ParryFlashController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly slots = new Array<FlashSlot>();
	private readonly box: ShoutBox = { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 };
	private readonly centre: ParryFlashPoint = { x: 0, z: 0 };
	private folder: Folder | undefined;
	private pack: ThemePack | undefined;
	private anyVisible = false;
	// --- KV_ParryDebug: one forced flash on the view player ---
	private debugCount = 0;
	private debugAgeSec = 0;
	private debugActive = false;
	/** The forced flash has been drawn once (its age runs from the next frame). */
	private debugShown = false;
	private readonly debugFlash: Mutable<ParryFlash> = {
		player: 0,
		count: 0,
		isNew: false,
		grew: false,
		ageSec: 0,
		scale: 1,
		pop: 1,
		fade: 1,
		showCount: false,
		x: 0,
		z: 0,
	};

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly nearMiss: NearMissController,
	) {}

	onStart(): void {
		this.pack = this.theme.getPack();
		this.folder = this.janitor.Add(fxFolder(PARRY_FLASH_DRAW.folderName));
		this.sim.onRunStarted(() => this.off());
		this.sim.onRunExited(() => this.off());
		this.nearMiss.onFrame((frame, settings, dt) => this.frame(frame, settings, dt));
		// The director is not stepped without a run: drop what showed.
		this.fx.onFrame(() => {
			if (this.sim.getContext() === undefined) this.off();
		});
		this.janitor.Add(Workspace.GetAttributeChangedSignal(PARRY_DEBUG.attribute).Connect(() => this.readDebug()));
		// A locale switch (docs/LOCALIZATION.md L6): each slot's font, and its label rewritten on the next frame.
		this.janitor.Add(
			onLocaleChanged(() => {
				const font = currentHudFont();
				for (const slot of this.slots) {
					slot.label.Font = font;
					slot.shownCount = -1;
				}
			}),
		);
	}

	// --- the frame ---------------------------------------------------------------------------------

	private frame(frame: Readonly<NearMissFrame>, settings: Readonly<JuiceSettings>, dt: number): void {
		if (frame.freezeMs > 0) this.sim.hitstop.request(frame.freezeMs, settings);
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			this.off();
			return;
		}
		const state = ctx.run.state;
		const alpha = ctx.run.getAlpha();
		const n = math.min(partySize(state), MAX_PARTY_SIZE);
		for (const slot of this.slots) slot.seen = false;
		for (const flash of frame.flashes) {
			if (flash.player < n) this.draw(flash, state, alpha, dt);
		}
		const debug = this.debugFrame(settings, dt, n);
		if (debug !== undefined && !this.slotSeen(debug.player)) this.draw(debug, state, alpha, dt);
		this.hideUnseen();
	}

	private slotSeen(player: number): boolean {
		return this.slots[player]?.seen === true;
	}

	private draw(flash: Readonly<ParryFlash>, state: Readonly<SimState>, alpha: number, dt: number): void {
		const slot = this.slotFor(flash.player);
		const pack = this.pack;
		if (slot === undefined || pack === undefined) return;
		slot.seen = true;
		// docs/LOCAL_PREDICTION.md LP5: as drawn (the predicted local player; the merged one otherwise).
		const p = this.sim.getDrawnPlayer(state, flash.player);
		const c = parryFlashCentre(this.centre, lerp(p.prevX, p.x, alpha), lerp(p.prevZ, p.z, alpha), AXES);
		const size = parryFlashSize(flash.scale, flash.pop);
		shoutBoxAt(this.box, c.x, c.z, AXES.rightX, AXES.rightZ, size);
		if (flash.isNew || !slot.visible) slot.duck.reset();
		const ceiling = slot.duck.step(dt, shoutDucked(this.box, state.combat.enemyBullets));
		const opacity = parryFlashOpacity(flash.fade, ceiling);
		const label = slot.label;
		const count = flash.showCount ? flash.count : 0;
		if (count !== slot.shownCount) {
			slot.shownCount = count;
			label.Text = parryFlashLabel(pack, flash.count, flash.showCount);
		}
		if (size !== slot.shownSize) {
			slot.shownSize = size;
			label.Size = UDim2.fromScale(size, size);
		}
		if (opacity !== slot.shownOpacity) {
			slot.shownOpacity = opacity;
			label.TextTransparency = HIDDEN - opacity;
			label.TextStrokeTransparency = HIDDEN - opacity * (HIDDEN - COMBO_SHOUT_DRAW.strokeTransparency);
		}
		const y = floorTextTopStuds() - FX_SPRITE_VIEW.thicknessStuds / 2;
		slot.part.CFrame = new CFrame(studsX(c.x), y, studsZ(c.z)).mul(FLOOR_CANVAS_YAW);
		if (!slot.visible) {
			slot.visible = true;
			slot.surface.Enabled = true;
		}
		this.anyVisible = true;
	}

	/** Hides every slot this frame did not list. */
	private hideUnseen(): void {
		let any = false;
		for (const slot of this.slots) {
			if (!slot.seen) this.hide(slot);
			else any = true;
		}
		this.anyVisible = any;
	}

	/** Hides everything and drops the debug flash (run start / exit, no run). */
	private off(): void {
		this.debugActive = false;
		if (!this.anyVisible) return;
		this.anyVisible = false;
		for (const slot of this.slots) this.hide(slot);
	}

	private hide(slot: FlashSlot): void {
		if (!slot.visible) return;
		slot.visible = false;
		slot.shownOpacity = -1;
		slot.surface.Enabled = false;
		slot.part.CFrame = PARKED;
	}

	// --- the pool: one floor text per player slot ----------------------------------------------------

	private slotFor(player: number): FlashSlot | undefined {
		if (player < 0 || player >= MAX_PARTY_SIZE || player !== math.floor(player)) return undefined;
		// Slots are built in index order, once each.
		while (this.slots.size() <= player) {
			const slot = this.buildSlot(this.slots.size());
			if (slot === undefined) return undefined;
			this.slots.push(slot);
		}
		return this.slots[player];
	}

	private buildSlot(index: number): FlashSlot | undefined {
		const pack = this.pack;
		const folder = this.folder;
		if (pack === undefined || folder === undefined) return undefined;
		const text = floorText(
			`Flash${index}`,
			folder,
			pack.color(PARRY_FLASH_DRAW.role),
			pack.color("background"),
			PARKED,
		);
		return {
			part: text.part,
			surface: text.surface,
			label: text.label,
			duck: new ShoutDuck(),
			visible: false,
			seen: false,
			shownCount: -1,
			shownOpacity: -1,
			shownSize: -1,
		};
	}

	// --- KV_ParryDebug (Studio check aid, off by default) --------------------------------------------

	private readDebug(): void {
		const raw = Workspace.GetAttribute(PARRY_DEBUG.attribute);
		const n = typeIs(raw, "string") ? tonumber(raw) : typeIs(raw, "number") ? raw : undefined;
		if (n === undefined || n < 1 || n !== math.floor(n)) return;
		this.debugCount = n;
		this.debugAgeSec = 0;
		this.debugShown = false;
		this.debugActive = true;
	}

	/** The forced flash for this frame (its own timeline on the director's pop / fade rules), or undefined. */
	private debugFrame(settings: Readonly<JuiceSettings>, dt: number, n: number): ParryFlash | undefined {
		if (!this.debugActive) return undefined;
		const view = this.sim.getViewPlayerIndex();
		const quiet = comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver());
		const F = NEAR_MISS_VIEW.flash;
		const isNew = !this.debugShown;
		if (!isNew) this.debugAgeSec += math.max(dt, 0);
		this.debugShown = true;
		if (quiet || view >= n || this.debugAgeSec >= F.sec) {
			this.debugActive = false;
			return undefined;
		}
		const f = this.debugFlash;
		f.player = view;
		f.count = this.debugCount;
		f.isNew = isNew;
		f.grew = isNew;
		f.ageSec = this.debugAgeSec;
		f.scale = 1;
		f.pop = parryFlashPop(this.debugAgeSec, settings.reducedMotion);
		f.fade = parryFlashFade(this.debugAgeSec);
		f.showCount = this.debugCount >= F.countFrom;
		return f;
	}
}
