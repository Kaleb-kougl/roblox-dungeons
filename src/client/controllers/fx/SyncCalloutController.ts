import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { STUDS_PER_TILE } from "shared/config";
import { MAX_PARTY_SIZE, type SimState } from "shared/sim";
import type { JuiceSettings } from "shared/settings";
import type { ThemePack } from "shared/theme";
import { studsX, studsZ } from "shared/view";
import {
	FX_SPRITE_VIEW,
	FX_VIEW,
	SyncCallout,
	TEAM_MOMENTS_VIEW,
	comboQuiet,
	type SyncCalloutLook,
} from "shared/view/fx";
import {
	COMBO_SHOUT_DRAW,
	ShoutDuck,
	floorAxes,
	parryFlashOpacity,
	shoutBoxAt,
	shoutDucked,
	syncCalloutLabel,
	syncCalloutSize,
	syncTetherOpacity,
	type ShoutBox,
} from "shared/view/hud";
import { currentHudFont, onLocaleChanged } from "client/ui";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FLOOR_CANVAS_YAW } from "../render/floorCanvas";
import { renderPart } from "../render/placeholders";
import { FxTrackerController } from "./FxTrackerController";
import { NearMissController } from "./NearMissController";
import { TeamMomentsController } from "./TeamMomentsController";
import { floorText, floorTextTopStuds, fxFolder, type FloorText } from "./fxHelpers";

const HIDDEN = 1;
const PARKED = new CFrame(FX_VIEW.parkedStuds[0], FX_VIEW.parkedStuds[1], FX_VIEW.parkedStuds[2]);
const AXES = floorAxes();

/** One floor text (built once on first use, reused) and what it last showed. */
interface TextSlot {
	readonly text: FloorText;
	readonly duck: ShoutDuck;
	visible: boolean;
	shownLabel: string;
	shownOpacity: number;
	shownSize: number;
}

/**
 * The SYNC! callout (docs/RUN_RECAP.md CM5, B2): a NearMissController subscriber that, per rendered frame, reads the
 * frame's SYNC! records (TeamMomentsController.syncs(): the co-op moments' parry half, stepped on its first call),
 * hands each to the pure SyncCallout timeline (shared/view/fx; a new or grown sync restarts it) and draws its look:
 *   - the text: `fx.parry.sync` / `fx.parry.syncCount` (syncCalloutLabel) on the combo shout's construction
 *     (fxHelpers floorText, the PARRY! flash's: a SurfaceGui on a thin floor Part at the shout's layer, under every
 *     bullet, telegraph, marking, effect and body), at the points' mean when `tethered`, else a small one at each point
 *     (syncCalloutSize); opacity parryFlashOpacity: COMBO_SHOUT.maxOpacity (55 %) x the fade, under each slot's
 *     ShoutDuck ceiling, ducked by shoutDucked over the enemy bullet pool in the text's own box (CD9's rule);
 *   - the tether (tethered syncs): ONE pooled bright Neon bar on the same layer between the first and latest parry
 *     points, TEAM_MOMENTS_VIEW.tether.sec, snapping thin and fading (reduced motion: no snap, the thin bar fades).
 * No freeze (co-op has none). Quiet (the stage cover, run over), a run start / exit or a frame with no run hides it.
 * Colour role TEAM_MOMENTS_VIEW.callout.role / tether.role (the PARRY! flash's). Presentation only, read-only on the sim.
 * The KV_TeamMomentsDebug "sync" forms (TeamMomentsController) show here like real ones.
 */
@Controller({})
export class SyncCalloutController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly callout = new SyncCallout();
	private readonly slots = new Array<TextSlot>();
	private readonly box: ShoutBox = { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 };
	private folder: Folder | undefined;
	private tether: Part | undefined;
	private tetherVisible = false;
	private pack: ThemePack | undefined;
	private anyVisible = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly nearMiss: NearMissController,
		private readonly team: TeamMomentsController,
	) {}

	onStart(): void {
		this.pack = this.theme.getPack();
		this.folder = this.janitor.Add(fxFolder(TEAM_MOMENTS_VIEW.callout.folderName));
		this.sim.onRunStarted(() => this.off());
		this.sim.onRunExited(() => this.off());
		this.nearMiss.onFrame((_, settings, dt) => this.frame(settings, dt));
		// The director (and so this subscriber) is not stepped without a run: drop what showed.
		this.fx.onFrame(() => {
			if (this.sim.getContext() === undefined) this.off();
		});
		// A locale switch (docs/LOCALIZATION.md L6): each slot's font, and its label rewritten on the next frame.
		this.janitor.Add(
			onLocaleChanged(() => {
				const font = currentHudFont();
				for (const slot of this.slots) {
					slot.text.label.Font = font;
					slot.shownLabel = "";
				}
			}),
		);
	}

	private frame(settings: Readonly<JuiceSettings>, dt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined || comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver())) {
			this.off();
			return;
		}
		for (const m of this.team.syncs()) this.callout.show(m);
		const look = this.callout.frame(dt, settings.reducedMotion);
		if (!look.active) {
			this.hideAll();
			return;
		}
		const state = ctx.run.state;
		const pack = this.pack;
		if (pack === undefined) return;
		const label = syncCalloutLabel(pack, look.count);
		let used = 0;
		if (look.tethered) {
			this.drawText(used++, look.mid.x, look.mid.z, false, label, look, state, dt);
		} else {
			for (let i = 0; i < look.pointCount; i++) {
				const p = look.points[i];
				this.drawText(used++, p.x, p.z, true, label, look, state, dt);
			}
		}
		for (let i = used; i < this.slots.size(); i++) this.hideSlot(this.slots[i]);
		this.drawTether(look);
		this.anyVisible = true;
	}

	private drawText(
		index: number,
		x: number,
		z: number,
		small: boolean,
		label: string,
		look: Readonly<SyncCalloutLook>,
		state: Readonly<SimState>,
		dt: number,
	): void {
		const slot = this.slotFor(index);
		if (slot === undefined) return;
		const size = syncCalloutSize(small, look.pop);
		shoutBoxAt(this.box, x, z, AXES.rightX, AXES.rightZ, size);
		if (look.isNew || !slot.visible) slot.duck.reset();
		const ceiling = slot.duck.step(dt, shoutDucked(this.box, state.combat.enemyBullets));
		const opacity = parryFlashOpacity(look.fade, ceiling);
		const l = slot.text.label;
		if (label !== slot.shownLabel) {
			slot.shownLabel = label;
			l.Text = label;
		}
		if (size !== slot.shownSize) {
			slot.shownSize = size;
			l.Size = UDim2.fromScale(size, size);
		}
		if (opacity !== slot.shownOpacity) {
			slot.shownOpacity = opacity;
			l.TextTransparency = HIDDEN - opacity;
			l.TextStrokeTransparency = HIDDEN - opacity * (HIDDEN - COMBO_SHOUT_DRAW.strokeTransparency);
		}
		const y = floorTextTopStuds() - FX_SPRITE_VIEW.thicknessStuds / 2;
		slot.text.part.CFrame = new CFrame(studsX(x), y, studsZ(z)).mul(FLOOR_CANVAS_YAW);
		if (!slot.visible) {
			slot.visible = true;
			slot.text.surface.Enabled = true;
		}
	}

	/** The tether between the first and latest parry points while the look has one; parked otherwise. */
	private drawTether(look: Readonly<SyncCalloutLook>): void {
		if (!look.tetherOn || look.pointCount < 2) {
			this.hideTether();
			return;
		}
		const part = this.tetherPart();
		if (part === undefined) return;
		const a = look.points[0];
		const b = look.points[look.pointCount - 1];
		const y = floorTextTopStuds() - FX_SPRITE_VIEW.thicknessStuds / 2;
		const from = new Vector3(studsX(a.x), y, studsZ(a.z));
		const to = new Vector3(studsX(b.x), y, studsZ(b.z));
		const length = to.sub(from).Magnitude;
		if (length <= 0) {
			this.hideTether();
			return;
		}
		part.Size = new Vector3(look.tetherWidthTiles * STUDS_PER_TILE, FX_SPRITE_VIEW.thicknessStuds, length);
		part.CFrame = CFrame.lookAt(from.Lerp(to, 0.5), to);
		part.Transparency = HIDDEN - syncTetherOpacity(look.tetherFade);
		this.tetherVisible = true;
	}

	private tetherPart(): Part | undefined {
		if (this.tether !== undefined) return this.tether;
		const pack = this.pack;
		const folder = this.folder;
		if (pack === undefined || folder === undefined) return undefined;
		const part = renderPart("Part", false);
		part.Name = "Tether";
		part.Material = Enum.Material.Neon;
		part.Color = pack.color(TEAM_MOMENTS_VIEW.tether.role);
		part.Transparency = HIDDEN;
		part.Size = Vector3.one;
		part.CFrame = PARKED;
		part.Parent = folder;
		this.tether = part;
		return part;
	}

	private hideTether(): void {
		if (!this.tetherVisible || this.tether === undefined) return;
		this.tetherVisible = false;
		this.tether.Transparency = HIDDEN;
		this.tether.CFrame = PARKED;
	}

	/** Hides everything and drops the callout (quiet, run start / exit, no run). */
	private off(): void {
		this.callout.clear();
		this.hideAll();
	}

	private hideAll(): void {
		if (!this.anyVisible) return;
		this.anyVisible = false;
		for (const slot of this.slots) this.hideSlot(slot);
		this.hideTether();
	}

	private hideSlot(slot: TextSlot): void {
		if (!slot.visible) return;
		slot.visible = false;
		slot.shownOpacity = -1;
		slot.text.surface.Enabled = false;
		slot.text.part.CFrame = PARKED;
	}

	/** Text slot `index` (built in index order, once each; at most MAX_PARTY_SIZE: one per parry point). */
	private slotFor(index: number): TextSlot | undefined {
		if (index < 0 || index >= MAX_PARTY_SIZE) return undefined;
		while (this.slots.size() <= index) {
			const pack = this.pack;
			const folder = this.folder;
			if (pack === undefined || folder === undefined) return undefined;
			const C = TEAM_MOMENTS_VIEW.callout;
			this.slots.push({
				text: floorText(
					`Sync${this.slots.size()}`,
					folder,
					pack.color(C.role),
					pack.color("background"),
					PARKED,
				),
				duck: new ShoutDuck(),
				visible: false,
				shownLabel: "",
				shownOpacity: -1,
				shownSize: -1,
			});
		}
		return this.slots[index];
	}
}
