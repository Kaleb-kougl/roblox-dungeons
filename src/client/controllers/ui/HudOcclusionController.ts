import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { clientStore, selectDisplay, selectGameActive, selectJuice, selectRunInfo } from "client/store";
import { cornerFrame, setCornerFade } from "client/ui";
import { NO_KIND, playerAt } from "shared/sim";
import { RENDER_ORDER, floorStudsY, lerp, studsX, studsY, studsZ } from "shared/view";
import { motionScale } from "shared/view/fx";
import {
	ALWAYS_ON_PANELS,
	HUD_CORNERS,
	HUD_FOOTPRINT,
	HUD_OCCLUSION,
	OcclusionFader,
	occludedPanels,
	type HudCorner,
	type ScreenPoint,
	type ScreenRect,
} from "shared/view/hud";
import { SimController } from "../game/SimController";

const RENDER_STEP = "KV_HudOcclusion";
/** The KV_Debug footprint check runs this often (seconds) and allows this much rounding (px). */
const FOOTPRINT_CHECK_SECONDS = 1;
const FOOTPRINT_TOLERANCE_PX = 1;

interface MutableRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The UIScale under the panel's ScreenGui (GameHud's useHudScale), 1 when there is none. */
function hudScaleOf(frame: GuiObject): number {
	const gui = frame.FindFirstAncestorOfClass("ScreenGui");
	return gui?.FindFirstChildOfClass("UIScale")?.Scale ?? 1;
}

/**
 * The corner panels' occlusion fade (docs/HUD_LAYOUT.md H7) and the KV_Debug footprint check (H1). A render step
 * after the camera: every HUD_OCCLUSION.everyFrames frames it projects the watched player (spectating: the teammate,
 * `getViewPlayerIndex`), every living actor (enemies and the boss) and up to HUD_OCCLUSION.maxBullets enemy bullets to
 * GUI space, tests them against the mounted corner panels' rects (client/ui/hud cornerFade registry), and every frame
 * advances one OcclusionFader per corner and writes its transparency to the corner's binding (no React re-render).
 *
 * Coordinates: GuiObject.AbsolutePosition / AbsoluteSize are in GUI space, whose origin is the viewport's top left
 * moved by GuiService:GetGuiInset() (the top bar); ScreenInsets only moves where a ScreenGui's frames sit, not that
 * origin. Camera:WorldToScreenPoint returns points in that same space (it is WorldToViewportPoint minus the GUI inset),
 * so the two compare directly. Off (Options > Display > HUD fade) or no run: every corner opaque and no work. Read
 * only on the sim.
 */
@Controller({})
export class HudOcclusionController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly faders = new Map<HudCorner, OcclusionFader>();
	private readonly rectPool = new Array<MutableRect>();
	/** This pass's mounted panels: their rects, their HUD_CORNERS index, and the occlusion result per rect. */
	private readonly liveRects = new Array<ScreenRect>();
	private readonly liveCorner = new Array<number>();
	private readonly liveOut = new Array<boolean>();
	private readonly points = new Array<ScreenPoint>();
	private readonly occluded = new Array<boolean>();
	private frameCount = 0;
	private active = false;
	private footprintClock = 0;
	private readonly warned = new Set<string>();

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		for (const corner of HUD_CORNERS) {
			this.faders.set(corner, new OcclusionFader());
			this.rectPool.push({ x: 0, y: 0, w: 0, h: 0 });
			this.occluded.push(false);
		}
		this.sim.onRunStarted(() => {
			this.warned.clear();
			this.resetAll();
		});
		this.sim.onFloorChanged(() => this.resetAll());
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			(dt) => this.frame(dt),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private resetAll(): void {
		for (let i = 0; i < HUD_CORNERS.size(); i++) {
			const corner = HUD_CORNERS[i];
			this.faders.get(corner)!.reset();
			this.occluded[i] = false;
			setCornerFade(corner, 0);
		}
	}

	private frame(rawDt: number): void {
		const store = clientStore.getState();
		const state = this.sim.getState();
		const on = selectDisplay(store).hudFade && selectGameActive(store) && state !== undefined;
		if (selectRunInfo(store).debug) this.checkFootprint(rawDt);
		if (!on) {
			if (this.active) {
				this.active = false;
				this.resetAll();
			}
			return;
		}
		this.active = true;
		const dt = math.max(rawDt, 0);
		this.frameCount += 1;
		if (this.frameCount >= HUD_OCCLUSION.everyFrames) {
			this.frameCount = 0;
			this.test(state);
		}
		const motion = motionScale(selectJuice(store));
		for (let i = 0; i < HUD_CORNERS.size(); i++) {
			const corner = HUD_CORNERS[i];
			setCornerFade(corner, this.faders.get(corner)!.update(this.occluded[i], dt, motion));
		}
	}

	/** Projects the action and refreshes `occluded` (one entry per HUD_CORNERS). */
	private test(state: NonNullable<ReturnType<SimController["getState"]>>): void {
		const camera = Workspace.CurrentCamera;
		if (camera === undefined) return;
		let scale = 1;
		this.liveRects.clear();
		this.liveCorner.clear();
		for (let i = 0; i < HUD_CORNERS.size(); i++) {
			this.occluded[i] = false;
			const frame = cornerFrame(HUD_CORNERS[i]);
			if (frame === undefined) continue;
			const size = frame.AbsoluteSize;
			if (size.X <= 0 || size.Y <= 0) continue;
			const r = this.rectPool[i];
			r.x = frame.AbsolutePosition.X;
			r.y = frame.AbsolutePosition.Y;
			r.w = size.X;
			r.h = size.Y;
			this.liveRects.push(r);
			this.liveCorner.push(i);
			scale = hudScaleOf(frame);
		}
		if (this.liveRects.size() === 0) return;
		const alpha = this.sim.getAlpha();
		const floorY = floorStudsY();
		let n = 0;
		// The watched player (a dead co-op player watches a teammate).
		const p = playerAt(state, this.sim.getViewPlayerIndex());
		n = this.push(
			camera,
			n,
			new Vector3(studsX(lerp(p.prevX, p.x, alpha)), floorY, studsZ(lerp(p.prevZ, p.z, alpha))),
		);
		// Living actors: every enemy and the boss.
		const actors = state.combat.actors;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			n = this.push(
				camera,
				n,
				new Vector3(studsX(lerp(a.prevX, a.x, alpha)), floorY, studsZ(lerp(a.prevZ, a.z, alpha))),
			);
		}
		// Enemy bullets, at most maxBullets (any one inside a panel is enough).
		const bullets = state.combat.enemyBullets;
		const high = bullets.highWater();
		let taken = 0;
		for (let i = 0; i < high && taken < HUD_OCCLUSION.maxBullets; i++) {
			if (!bullets.isVisible(i)) continue;
			const b = bullets.positionAt(i);
			taken += 1;
			n = this.push(camera, n, new Vector3(studsX(b.x), studsY(b.y), studsZ(b.z)));
		}
		occludedPanels(this.liveRects, this.points, n, HUD_OCCLUSION.padPx * scale, this.liveOut);
		for (let k = 0; k < this.liveCorner.size(); k++) this.occluded[this.liveCorner[k]] = this.liveOut[k];
	}

	/** Adds the GUI-space point of `world` when it is in front of the camera; returns the new count. */
	private push(camera: Camera, n: number, world: Vector3): number {
		const [screen, visible] = camera.WorldToScreenPoint(world);
		if (!visible) return n;
		if (n >= this.points.size()) this.points.push({ x: 0, y: 0 });
		const pt = this.points[n];
		pt.x = screen.X;
		pt.y = screen.Y;
		return n + 1;
	}

	/**
	 * KV_Debug (docs/HUD_LAYOUT.md H1): once a second, warns once per panel per run when an always-on panel is larger
	 * than its HUD_FOOTPRINT box at the current HUD scale (real text widths, which the headless spec cannot see).
	 */
	private checkFootprint(dt: number): void {
		this.footprintClock += math.max(dt, 0);
		if (this.footprintClock < FOOTPRINT_CHECK_SECONDS) return;
		this.footprintClock = 0;
		for (const panel of ALWAYS_ON_PANELS) {
			if (this.warned.has(panel)) continue;
			const box = HUD_FOOTPRINT[panel];
			const frame = cornerFrame(box.corner);
			if (frame === undefined) continue;
			const scale = hudScaleOf(frame);
			const size = frame.AbsoluteSize;
			const maxW = box.maxW * scale + FOOTPRINT_TOLERANCE_PX;
			const maxH = box.maxH * scale + FOOTPRINT_TOLERANCE_PX;
			if (size.X > maxW || size.Y > maxH) {
				this.warned.add(panel);
				warn(
					string.format(
						"[HudFootprint] %s panel is %dx%d px, over its %dx%d budget (x%.2f HUD scale; docs/HUD_LAYOUT.md)",
						panel,
						size.X,
						size.Y,
						box.maxW * scale,
						box.maxH * scale,
						scale,
					),
				);
			}
		}
	}
}
