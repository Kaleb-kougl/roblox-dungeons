import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { clientStore, selectGameActive, selectInputDevice, selectSnapshot } from "client/store";
import { bossBarFrame, bossBarSpot, setBossBarSpot } from "client/ui";
import { STUDS_PER_TILE } from "shared/config";
import { findBoss } from "shared/play";
import { RENDER_ORDER, floorStudsY, lerp, studsX, studsZ } from "shared/view";
import { BOSS_BAR_PLACE, BossBarPlacer, bossScreenBox, type MutableScreenRect } from "shared/view/hud";
import { SimController } from "../game/SimController";

const RENDER_STEP = "KV_BossBarPlacement";

/** The UIScale under the frame's ScreenGui (GameHud's useHudScale), 1 when there is none. */
function hudScaleOf(frame: GuiObject): number {
	const gui = frame.FindFirstAncestorOfClass("ScreenGui");
	return gui?.FindFirstChildOfClass("UIScale")?.Scale ?? 1;
}

/**
 * Moves the boss bar to the bottom centre while the boss is under its top spot, and back (shared/view/hud
 * bossBarPlace.ts). A render step after the camera: every BOSS_BAR_PLACE.everyFrames frames it projects the boss's floor
 * point and head (BOSS_BAR_PLACE.heightTiles up) to GUI space and steps one BossBarPlacer against the bar's two spots,
 * then writes client/ui bossBarSpot (a binding: no React re-render).
 *
 * The spots' rects come from the mounted bar: both are centred (one X and size), the top spot's Y is read while the
 * bar is at the top and kept, the bottom spot's while it is at the bottom. The bar always mounts at the top (the spot is
 * reset whenever no boss bar shows), so the top spot is known before the bar can move. Not on touch (the slim bar stays
 * in the touch strip; the bottom of a phone is the thumbs'). Camera:WorldToScreenPoint is GUI space, as AbsolutePosition
 * (HudOcclusionController). Presentation only, read only on the sim.
 */
@Controller({})
export class BossBarPlacementController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly placer = new BossBarPlacer();
	private readonly boss: MutableScreenRect = { x: 0, y: 0, w: 0, h: 0 };
	private readonly top: MutableScreenRect = { x: 0, y: 0, w: 0, h: 0 };
	private readonly bottom: MutableScreenRect = { x: 0, y: 0, w: 0, h: 0 };
	private topKnown = false;
	private bottomKnown = false;
	private frameCount = 0;
	private elapsed = 0;

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		this.sim.onRunStarted(() => this.reset());
		this.sim.onFloorChanged(() => this.reset());
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			(dt) => this.frame(dt),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private reset(): void {
		this.placer.reset();
		this.topKnown = false;
		this.bottomKnown = false;
		this.frameCount = 0;
		this.elapsed = 0;
		setBossBarSpot("top");
	}

	private frame(dt: number): void {
		const store = clientStore.getState();
		const state = this.sim.getState();
		const frame = bossBarFrame();
		if (
			frame === undefined ||
			state === undefined ||
			!selectGameActive(store) ||
			!selectSnapshot(store).bossVisible ||
			selectInputDevice(store) === "touch"
		) {
			if (this.topKnown || this.bottomKnown || bossBarSpot() !== "top") this.reset();
			return;
		}
		this.elapsed += math.max(dt, 0);
		this.frameCount += 1;
		if (this.frameCount < BOSS_BAR_PLACE.everyFrames) return;
		this.frameCount = 0;
		const step = this.elapsed;
		this.elapsed = 0;
		const camera = Workspace.CurrentCamera;
		if (camera === undefined) return;
		const size = frame.AbsoluteSize;
		if (size.X <= 0 || size.Y <= 0) return;
		const at = frame.AbsolutePosition;
		// The spot the bar is drawn at now (the binding has been applied by this frame's render step).
		const spotRect = bossBarSpot() === "top" ? this.top : this.bottom;
		spotRect.y = at.Y;
		if (bossBarSpot() === "top") this.topKnown = true;
		else this.bottomKnown = true;
		this.fit(this.top, at.X, size);
		this.fit(this.bottom, at.X, size);
		if (!this.topKnown) return;
		const boss = this.projectBoss(state, camera);
		setBossBarSpot(
			this.placer.update(boss, this.top, this.bottomKnown ? this.bottom : undefined, hudScaleOf(frame), step),
		);
	}

	/** Both spots are centred: the same X and size, only Y differs. */
	private fit(r: MutableScreenRect, x: number, size: Vector2): void {
		r.x = x;
		r.w = size.X;
		r.h = size.Y;
	}

	/** The boss's screen box (undefined: no living boss, or behind the camera). */
	private projectBoss(
		state: NonNullable<ReturnType<SimController["getState"]>>,
		camera: Camera,
	): MutableScreenRect | undefined {
		const a = findBoss(state);
		if (a === undefined || a.alive === 0) return undefined;
		const alpha = this.sim.getAlpha();
		const feet = new Vector3(studsX(lerp(a.prevX, a.x, alpha)), floorStudsY(), studsZ(lerp(a.prevZ, a.z, alpha)));
		const head = feet.add(new Vector3(0, BOSS_BAR_PLACE.heightTiles * STUDS_PER_TILE, 0));
		// Off-screen points still project (the head above the screen's top is the case this is for); only points
		// behind the camera (Z <= 0) are meaningless.
		const [f] = camera.WorldToScreenPoint(feet);
		const [h] = camera.WorldToScreenPoint(head);
		if (f.Z <= 0 || h.Z <= 0) return undefined;
		return bossScreenBox(f.X, f.Y, h.X, h.Y, BOSS_BAR_PLACE.widthShare, this.boss);
	}
}
