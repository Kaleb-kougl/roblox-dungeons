import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { isDraftOpen, type SimState } from "shared/sim";
import type { DecorKind, DecorPiece, VoidDecorKind } from "shared/theme";
import {
	BULLET_Y,
	BULLET_VIEW,
	DECOR_BOX,
	DECOR_CAMERA,
	DECOR_DEPTH,
	DECOR_REACT,
	DECOR_RENDER_ORDER,
	DECOR_VIEW,
	DecorDirector,
	VOID_VIEW,
	WALL_DEPTH_BIAS,
	decorEntryFootprint,
	decorFacingDir,
	decorFadeBodies,
	decorFadeStep,
	decorInputOfLayout,
	decorOutline,
	decorPieceLayout,
	decorProfile,
	decorScene,
	degToRad,
	floorStudsY,
	footprintStencil,
	isoBasis,
	planDecor,
	planVoidCached,
	selectDecorFades,
	spriteFacing,
	studsX,
	studsY,
	studsZ,
	voidForceBand,
	voidBiomeOf,
	voidRunInput,
	type DecorBody,
	type DecorEntry,
	type DecorFrame,
	type DecorPlanInput,
	type DecorScene,
	type DecorView,
	type SpriteAnimChoice,
	type SpriteLayout,
	type StandingKind,
	type VoidPlan,
} from "shared/view";
import { motionScale } from "shared/view/fx";
import { FxTrackerController } from "../fx/FxTrackerController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { ArtBillboard, buildFloorArt, restingAnimation, visualLayout, type FloorArt } from "./decorParts";
import { renderPart } from "./placeholders";
import { SPRITE_TINT_NONE, SpriteView } from "./SpriteView";

const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const WALL_BIAS_STUDS = WALL_DEPTH_BIAS * STUDS_PER_TILE;
const HALF = 0.5;
const MS = 1000;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type SpriteAnimChoiceRecord = Pick<SpriteAnimChoice, "anim" | "rate">;

/** A pooled upright body: a sprite set's SpriteView or an image billboard, keyed by piece id and layer. */
interface StandingBody {
	readonly key: string;
	readonly sprite: SpriteView | undefined;
	readonly image: ArtBillboard | undefined;
	readonly anchor: Part;
}

/** One drawn plan entry. */
interface PieceView {
	readonly entry: number;
	readonly piece: DecorPiece;
	readonly body: StandingBody | undefined;
	readonly flat: FloorArt | undefined;
	readonly dirX: number;
	readonly dirZ: number;
	/** The sprite animation shown (standing sprites). */
	anim: string;
	/** Whether the shown animation has more than one frame (clocked every frame). */
	animated: boolean;
	/** Fade share 0..1 (x DECOR_VIEW.fadeTransparency), and the dim shown. */
	fade: number;
	dim: number;
}

/**
 * Room decoration (docs/DECOR.md R4, R10): the floor's decor plan drawn from the theme pack's `decor.*` art, reacting
 * to the run through the DecorDirector. Read-only on the sim.
 *
 *   per floor     on run start and every floor change: decorInputOfLayout (endless floors; M1 the bare dungeon) +
 *                 decorProfile (Workspace KV_DecorBand forces a band) + planDecor with the pack's variant counts ->
 *                 decorScene. An entry is drawn only when the pack has art for its kind (pack.decorVariants; the
 *                 variant by the plan's cell hash); the vale pack's Lords of Pain art (R5) draws once its atlas is
 *                 uploaded, the placeholder pack has none (the director and DecorFxController's lights still run).
 *   tall / low    pooled upright billboards on the wall top (a sprite set: SpriteView, facing from decorFacingDir; an
 *                 image: ArtBillboard), the floor clearance from spriteBillboard. A brazier sprite set with `lit` plays
 *                 it once the director lights it. Drawn with decorPieceLayout: held inside the piece's DECOR_BOX (the
 *                 only box the footprint rule proved safe; by the art's outline in its facing when the pack gives one),
 *                 scaled down / lifted when the art is larger; art that cannot fit at all is not drawn (logged).
 *   wall          the same, pushed WALL_DEPTH_BIAS toward the camera off the wall face.
 *   flat          a top-face SurfaceGui on a thin invisible floor Part (decorParts buildFloorArt), per floor.
 *   void          docs/VOID_DECOR.md VD6: the floor's void plan (planVoidCached of the same band inputs: the void
 *                 geometry shares it) goes into planDecor, whose "void" entries stand / lie on their surface's top
 *                 (entry.y: the billboard anchor, or the flat Part raised to it); a biome void kind draws from
 *                 pack.voidDecorVariants. Workspace KV_VoidOff (VOID_VIEW.offAttribute, boolean, default off) plans
 *                 without the void (the geometry reads the same attribute).
 *   fade          selectDecorFades with every living player and the live boss: a hidden body fades the piece to
 *                 DECOR_VIEW.fadeTransparency over fadeSeconds.
 *   director      once per frame (not while paused, frozen, or a draft is open) DecorDirector.update with the state,
 *                 the frame's events, the scene, dt and the juice motionScale; its view lights braziers and dims the
 *                 shrine crystal here, and drives DecorFxController (flames, lights, glints, particles).
 *   debug         Workspace KV_DecorDebug (boolean): the fade boxes (outlines in their billboard planes), each standing
 *                 piece's footprint stencil (the cells its art could hide, at bullet height) and the breakable cells.
 *
 * Bodies are pooled across floors (parked when unused); flat pieces and debug parts belong to the floor's Janitor.
 */
@Controller({})
export class DecorController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly debugJanitor = new Janitor();
	private readonly director = new DecorDirector();
	private readonly basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
	private readonly free = new Map<string, StandingBody[]>();
	private readonly drawn = new Array<PieceView>();
	/** Per plan entry: the piece it is drawn with (undefined: no art, or art that cannot fit its box). */
	private readonly pieces = new Map<number, DecorPiece>();
	/** Per plan entry with a piece: the layout it is drawn with (decorPieceLayout: held inside its DECOR_BOX). */
	private readonly layouts = new Map<number, SpriteLayout>();
	/** Reused per frame: the standing sprites' animation choice and the director's frame. */
	private readonly animChoice: Mutable<SpriteAnimChoiceRecord> = { anim: "", rate: 1 };
	private directorFrame: Mutable<DecorFrame> | undefined;
	/** Per plan fade box: its drawn view (absent: not drawn). */
	private readonly fadeViews = new Map<number, PieceView>();
	private readonly fades = new Array<boolean>();
	private readonly bodies = new Array<DecorBody>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private folder: Folder | undefined;
	private scene: DecorScene | undefined;
	private sceneRevision = 0;
	/** Seconds the decoration moved this frame (0 while frozen) and in total: DecorFxController's clock. */
	private frameDt = 0;
	private clock = 0;
	private frozen = true;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const folder = new Instance("Folder");
		folder.Name = DECOR_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		this.sim.onRunStarted((ctx) => this.build(ctx));
		this.sim.onFloorChanged((ctx) => this.build(ctx));
		this.sim.onRunExited(() => this.clear());
		const rebuild = () => {
			const ctx = this.sim.getContext();
			if (ctx !== undefined) this.build(ctx);
		};
		this.janitor.Add(Workspace.GetAttributeChangedSignal(DECOR_DEPTH.forceBandAttribute).Connect(rebuild));
		this.janitor.Add(Workspace.GetAttributeChangedSignal(VOID_VIEW.offAttribute).Connect(rebuild));
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(DECOR_VIEW.debugAttribute).Connect(() => this.buildDebug()),
		);
		RunService.BindToRenderStep(
			DECOR_VIEW.renderStep,
			Enum.RenderPriority.Camera.Value + DECOR_RENDER_ORDER.decorAfterCamera,
			(dt) => this.frame(dt),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(DECOR_VIEW.renderStep), true);
		this.janitor.Add(this.floorJanitor, "Cleanup");
		this.janitor.Add(this.debugJanitor, "Cleanup");
		this.janitor.Add(() => this.destroyPools(), true);
	}

	// --- read by DecorFxController ---------------------------------------------------------------

	/** The current floor's scene (undefined: no floor drawn). */
	getScene(): DecorScene | undefined {
		return this.scene;
	}

	/** Grows with every new scene (a floor, a restart, a forced band). */
	getSceneRevision(): number {
		return this.sceneRevision;
	}

	/** This frame's director view, or undefined while it does not describe the scene. */
	getView(): DecorView | undefined {
		const v = this.director.getView();
		return this.scene !== undefined && v.ready && v.scene === this.scene ? v : undefined;
	}

	/** The piece plan entry `i` is drawn with (undefined: the pack has no art for it, or none that fits its box). */
	getPiece(i: number): DecorPiece | undefined {
		return this.pieces.get(i);
	}

	/** The layout plan entry `i`'s piece is drawn with (its art's own, or scaled / lifted into its DECOR_BOX). */
	getLayout(i: number): SpriteLayout | undefined {
		return this.layouts.get(i);
	}

	/** The decoration stands still this frame (paused, a draft, a frozen tutorial, no scene). */
	isFrozen(): boolean {
		return this.frozen;
	}

	/** Seconds the decoration moved this frame (0 while frozen), and its clock (the sum). */
	getFrameDt(): number {
		return this.frameDt;
	}

	getClock(): number {
		return this.clock;
	}

	// --- per floor -------------------------------------------------------------------------------

	private build(ctx: RunContext): void {
		this.clearFloor();
		const dungeon = ctx.dungeon;
		if (dungeon === undefined) return; // the greybox world
		const started = os.clock();
		const layout = ctx.endlessFloor !== undefined && ctx.floor > 0 ? ctx.endlessFloor(ctx.floor).layout : undefined;
		const depth = ctx.run.state.endless?.depth ?? 1;
		const base: DecorPlanInput = layout !== undefined ? decorInputOfLayout(layout, depth) : { dungeon };
		const forced = Workspace.GetAttribute(DECOR_DEPTH.forceBandAttribute);
		const forceBand = voidForceBand(forced);
		const profile = decorProfile(base.floor ?? 1, base.depth ?? 1, dungeon.params.themeKey, forceBand);
		const pack = this.theme.getPack();
		const variants = new Map<DecorKind, ReadonlyArray<DecorPiece>>();
		const variantsOf = (kind: DecorKind) => {
			let list = variants.get(kind);
			if (list === undefined) {
				list = pack.decorVariants(profile.biome, kind);
				variants.set(kind, list);
			}
			return list;
		};
		const voidVariants = new Map<VoidDecorKind, ReadonlyArray<DecorPiece>>();
		const voidVariantsOf = (kind: VoidDecorKind) => {
			let list = voidVariants.get(kind);
			if (list === undefined) {
				list = pack.voidDecorVariants(profile.biome, kind);
				voidVariants.set(kind, list);
			}
			return list;
		};
		let voidPlan: VoidPlan | undefined;
		if (
			Workspace.GetAttribute(VOID_VIEW.offAttribute) !== true &&
			voidBiomeOf(dungeon.params.themeKey) !== undefined
		) {
			// the same input VoidController builds (voidRunInput), so both read one cached plan
			voidPlan = planVoidCached(voidRunInput(dungeon, layout, depth, forced));
		}
		const input: DecorPlanInput = {
			...base,
			profile,
			variants: (kind) => variantsOf(kind).size(),
			voidPlan,
			voidVariants: (kind) => voidVariantsOf(kind).size(),
		};
		const plan = planDecor(input);
		const scene = decorScene(input, plan, layout?.bossFloor);
		this.scene = scene;
		this.sceneRevision++;
		this.fadeViews.clear();
		this.pieces.clear();
		this.layouts.clear();
		let instances = 0;
		let unfit = 0;
		plan.entries.forEach((e, i) => {
			const list = e.voidKind !== undefined ? voidVariantsOf(e.voidKind) : variantsOf(e.kind);
			const piece = list[e.variant] ?? list[0];
			if (piece === undefined) return;
			// held inside its box by its outline in the facing it is drawn in (a diagonal wall's cell is mostly corners)
			const [dirX, dirZ] = decorFacingDir(e);
			const facing =
				piece.art.kind === "sprites" ? spriteFacing(dirX, dirZ, piece.art.set.facings, this.basis, 0) : 0;
			const layout = decorPieceLayout(plan, i, visualLayout(piece.art), decorOutline(piece.core, facing));
			if (layout === undefined) {
				unfit++;
				return;
			}
			this.pieces.set(i, piece);
			this.layouts.set(i, layout);
			const view = this.draw(i, e, piece, layout);
			if (view === undefined) return;
			this.drawn.push(view);
			instances += DECOR_VIEW.instancesPerPiece;
			if (e.fade >= 0) this.fadeViews.set(e.fade, view);
		});
		this.flushMoves();
		this.buildDebug();
		const c = plan.counts;
		const v = plan.voidCounts;
		print(
			`[Decor] floor ${plan.floor} (${profile.bandName}, ${profile.biome}): plan ${plan.entries.size()} ` +
				`(flat ${c.flat}, low ${c.low}, tall ${c.tall}, wall ${c.wall}; void ${
					voidPlan !== undefined ? `tall ${v.tall}, low ${v.low}, flat ${v.flat}` : "off"
				}), drawn ${this.drawn.size()} ` +
				`(~${instances} instances${unfit > 0 ? `, ${unfit} art too large for its box` : ""}), ` +
				`${string.format("%.1f", (os.clock() - started) * MS)} ms`,
		);
	}

	/** One entry's instances, standing ones with `layout` (undefined: its art cannot be drawn). */
	private draw(i: number, e: DecorEntry, piece: DecorPiece, layout: SpriteLayout): PieceView | undefined {
		const [dirX, dirZ] = decorFacingDir(e);
		if (e.layer === "flat") {
			const facing =
				piece.art.kind === "sprites" ? spriteFacing(dirX, dirZ, piece.art.set.facings, this.basis, 0) : 0;
			// a void flat piece lies on its surface's top (entry.y), every other on the floor
			const at = new Vector3(studsX(e.x), e.source === "void" ? studsY(e.y) : floorStudsY(), studsZ(e.z));
			const flat = buildFloorArt(
				piece.id,
				piece.art,
				at,
				this.folder!,
				DECOR_VIEW.flatThicknessStuds,
				DECOR_VIEW.flatLiftStuds,
				facing,
				layout,
			);
			if (flat === undefined) return undefined;
			this.floorJanitor.Add(flat.part);
			return { entry: i, piece, body: undefined, flat, dirX, dirZ, anim: "", animated: false, fade: 0, dim: 0 };
		}
		const body = this.acquire(piece, e.layer === "wall", layout);
		const anchorAt = new CFrame(studsX(e.x), studsY(e.y), studsZ(e.z));
		this.moveParts.push(body.anchor);
		this.moveCFrames.push(anchorAt);
		const view: PieceView = {
			entry: i,
			piece,
			body,
			flat: undefined,
			dirX,
			dirZ,
			anim: "",
			animated: false,
			fade: 0,
			dim: 0,
		};
		if (body.sprite !== undefined) this.showAnim(view, DECOR_VIEW.idleAnimation, 0);
		return view;
	}

	private acquire(piece: DecorPiece, wall: boolean, layout: SpriteLayout): StandingBody {
		// bodies pool by piece, layer and drawn size (one kind's box fits a point piece and a segment differently)
		const key = `${piece.id}|${wall ? "wall" : "stand"}|${layout.pixelsPerTile}|${layout.pivot.x},${
			layout.pivot.y
		}`;
		const pooled = this.free.get(key)?.pop();
		if (pooled !== undefined) {
			pooled.sprite?.reset();
			if (pooled.image !== undefined) {
				pooled.image.setEnabled(true);
				pooled.image.setTransparency(0);
				pooled.image.setTint(SPRITE_TINT_NONE);
			}
			return pooled;
		}
		const extra = wall ? WALL_BIAS_STUDS : 0;
		const folder = this.folder!;
		if (piece.art.kind === "sprites") {
			const sprite = new SpriteView(piece.art.set, folder, layout, extra);
			return { key, sprite, image: undefined, anchor: sprite.anchor };
		}
		const image = new ArtBillboard(piece.art, folder, piece.id, layout, extra);
		return { key, sprite: undefined, image, anchor: image.anchor };
	}

	private release(body: StandingBody): void {
		body.sprite?.park();
		body.image?.setEnabled(false);
		this.moveParts.push(body.anchor);
		this.moveCFrames.push(PARKED);
		const list = this.free.get(body.key);
		if (list !== undefined) list.push(body);
		else this.free.set(body.key, [body]);
	}

	/** Shows animation `anim` (falls back to the set's resting one) on a standing sprite; dt steps its clock. */
	private showAnim(view: PieceView, anim: string, dt: number): void {
		const sprite = view.body?.sprite;
		if (sprite === undefined) return;
		const set = sprite.set;
		const name = set.has(anim) ? anim : restingAnimation(set, DECOR_VIEW.idleAnimation);
		if (name === undefined) return;
		if (name !== view.anim) {
			view.anim = name;
			const def = set.animation(name);
			view.animated = def !== undefined && def.frames > 1;
		}
		const choice = this.animChoice;
		choice.anim = name;
		sprite.update(choice, view.dirX, view.dirZ, this.basis, dt);
	}

	/** Every drawn piece gone (bodies back to their pools, flats destroyed); no scene. */
	private clearFloor(): void {
		for (const view of this.drawn) if (view.body !== undefined) this.release(view.body);
		this.drawn.clear();
		this.fadeViews.clear();
		this.pieces.clear();
		this.layouts.clear();
		this.floorJanitor.Cleanup();
		this.debugJanitor.Cleanup();
		this.flushMoves();
		this.scene = undefined;
		this.sceneRevision++;
	}

	private clear(): void {
		this.clearFloor();
		this.frozen = true;
		this.frameDt = 0;
	}

	private flushMoves(): void {
		if (this.moveParts.size() === 0) return;
		Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		this.moveParts.clear();
		this.moveCFrames.clear();
	}

	// --- per frame -------------------------------------------------------------------------------

	private frame(dt: number): void {
		const ctx = this.sim.getContext();
		const scene = this.scene;
		if (ctx === undefined || scene === undefined) {
			this.frozen = true;
			this.frameDt = 0;
			return;
		}
		debug.profilebegin(DECOR_VIEW.profileLabel);
		const state = ctx.run.state;
		const paused = ctx.live?.isPaused() === true || this.sim.isFrozen();
		const motion = motionScale(this.fx.settings());
		let view = this.director.getView();
		if (!paused) {
			let f = this.directorFrame;
			if (f === undefined) {
				f = { state, config: ctx.config, events: ctx.run.frameEvents, scene, dt, motion };
				this.directorFrame = f;
			} else {
				f.state = state;
				f.config = ctx.config;
				f.events = ctx.run.frameEvents;
				f.scene = scene;
				f.dt = dt;
				f.motion = motion;
			}
			view = this.director.update(f);
		}
		this.frozen = paused || isDraftOpen(state) || !view.ready || view.scene !== scene;
		this.frameDt = this.frozen ? 0 : math.min(math.max(dt, 0), DECOR_REACT.maxDtSeconds);
		this.clock += this.frameDt;
		this.apply(view, scene);
		this.applyFades(dt, state);
		debug.profileend();
	}

	/** The director's view on the pieces: lit braziers, the dimmed shrine crystal, animated loops. */
	private apply(view: DecorView, scene: DecorScene): void {
		if (!view.ready || view.scene !== scene) return;
		const plan = scene.plan;
		for (const pv of this.drawn) {
			const e = plan.entries[pv.entry];
			if (pv.body?.sprite !== undefined) {
				const lit = e.kind === "brazier" && view.lit[pv.entry] >= DECOR_VIEW.litSwapLevel;
				const want = lit ? DECOR_VIEW.litAnimation : DECOR_VIEW.idleAnimation;
				const fallback = pv.body.sprite.set.has(want) ? want : DECOR_VIEW.idleAnimation;
				if (fallback !== pv.anim || pv.animated) this.showAnim(pv, fallback, this.frameDt);
			}
			const dim = view.dim[pv.entry] ?? 0;
			if (dim !== pv.dim) {
				pv.dim = dim;
				const k = 1 - dim * (1 - DECOR_VIEW.dimBrightness);
				const tint = dim === 0 ? SPRITE_TINT_NONE : new Color3(k, k, k);
				if (pv.flat !== undefined) pv.flat.label.ImageColor3 = tint;
				pv.body?.sprite?.setTint(tint);
				pv.body?.image?.setTint(tint);
			}
		}
	}

	/** Tall / low pieces with a player or the boss behind them fade (tweened on real time). */
	private applyFades(dt: number, state: Readonly<SimState>): void {
		const plan = this.scene?.plan;
		if (plan === undefined || this.drawn.size() === 0) return;
		selectDecorFades(plan, decorFadeBodies(state, this.bodies), this.fades);
		for (const [b, pv] of this.fadeViews) {
			const target = this.fades[b] ? 1 : 0;
			if (pv.fade === target) continue;
			pv.fade = decorFadeStep(pv.fade, target, dt, DECOR_VIEW.fadeSeconds);
			const t = pv.fade * DECOR_VIEW.fadeTransparency;
			pv.body?.sprite?.setTransparency(t);
			pv.body?.image?.setTransparency(t);
		}
	}

	// --- debug overlay (KV_DecorDebug) -------------------------------------------------------------

	private buildDebug(): void {
		this.debugJanitor.Cleanup();
		const scene = this.scene;
		if (scene === undefined || Workspace.GetAttribute(DECOR_VIEW.debugAttribute) !== true) return;
		const pack = this.theme.getPack();
		const folder = this.debugJanitor.Add(new Instance("Folder"));
		folder.Name = DECOR_VIEW.debugFolderName;
		const plan = scene.plan;
		const S = STUDS_PER_TILE;
		const fadeColor = pack.color(DECOR_VIEW.debugFadeRole);
		const stencilColor = pack.color(DECOR_VIEW.debugStencilRole);
		const breakableColor = pack.color(DECOR_VIEW.debugBreakableRole);
		const cam = DECOR_CAMERA;
		const toWorld = (sx: number, sy: number, depth: number) =>
			new Vector3(
				studsX(cam.right[0] * sx + cam.up[0] * sy + cam.forward[0] * depth),
				studsY(cam.right[1] * sx + cam.up[1] * sy + cam.forward[1] * depth),
				studsZ(cam.right[2] * sx + cam.up[2] * sy + cam.forward[2] * depth),
			);
		let parts = 0;
		for (const box of plan.fadeBoxes) {
			const poly = box.polygon;
			const m = math.floor(poly.size() / 2);
			for (let k = 0; k < m; k++) {
				const j = (k + 1) % m;
				const a = toWorld(poly[k * 2], poly[k * 2 + 1], box.depth);
				const b = toWorld(poly[j * 2], poly[j * 2 + 1], box.depth);
				debugEdge(folder, a, b, fadeColor);
				parts++;
			}
		}
		const cell = S * (1 - 2 * DECOR_VIEW.debugCellInsetTiles);
		for (const e of plan.entries) {
			if (e.layer !== "tall" && e.layer !== "low") continue;
			const box = DECOR_BOX[e.kind as StandingKind];
			if (box === undefined) continue;
			// a void piece's stencil at its surface's top (entry.y), every other at the wall top (the default)
			const st =
				e.source === "void"
					? footprintStencil(decorEntryFootprint(e), box, DECOR_CAMERA, e.y)
					: footprintStencil(decorEntryFootprint(e), box);
			for (let k = 0; k < st.size(); k += 2) {
				const x = e.cellX + st[k];
				const z = e.cellY + st[k + 1];
				debugCell(folder, new Vector3(studsX(x), studsY(BULLET_Y), studsZ(z)), cell, stencilColor);
				parts++;
			}
		}
		for (const b of scene.breakables) {
			const at = new Vector3(studsX(b.x), floorStudsY() + DECOR_VIEW.flatLiftStuds, studsZ(b.y));
			debugCell(folder, at, cell, breakableColor);
			parts++;
		}
		folder.Parent = Workspace;
		print(`[Decor] debug overlay: ${parts} parts`);
	}

	private destroyPools(): void {
		for (const [, list] of this.free) {
			for (const body of list) {
				body.sprite?.destroy();
				body.image?.destroy();
			}
		}
		this.free.clear();
	}
}

/** A thin neon edge from a to b (debug). */
function debugEdge(parent: Instance, a: Vector3, b: Vector3, color: Color3): void {
	const len = a.sub(b).Magnitude;
	if (len <= 0) return;
	const part = renderPart("Part", false);
	part.Material = Enum.Material.Neon;
	part.Color = color;
	part.Size = new Vector3(DECOR_VIEW.debugEdgeStuds, DECOR_VIEW.debugEdgeStuds, len);
	part.CFrame = CFrame.lookAt(a.add(b).mul(HALF), b);
	part.Parent = parent;
}

/** A translucent flat square at `at` (debug). */
function debugCell(parent: Instance, at: Vector3, size: number, color: Color3): void {
	const part = renderPart("Part", false);
	part.Material = Enum.Material.Neon;
	part.Color = color;
	part.Transparency = DECOR_VIEW.debugTransparency;
	part.Size = new Vector3(size, DECOR_VIEW.debugEdgeStuds, size);
	part.CFrame = new CFrame(at);
	part.Parent = parent;
}
