import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { SIM_HZ, dropsGround, type GroundDrop } from "shared/sim";
import {
	BOOST_COLLECT_FX_ID,
	BOOST_KINDS,
	type Boost,
	type SpriteSet,
	type ThemePack,
	type WorldImage,
} from "shared/theme";
import {
	BULLET_VIEW,
	RENDER_ORDER,
	SPRITE_VIEW,
	animDtSec,
	breakableArtLayout,
	degToRad,
	floorStudsY,
	isoBasis,
	spriteBillboard,
	studsX,
	studsZ,
	type SpriteAnimChoice,
	type SpriteBillboard,
	type SpriteLayout,
} from "shared/view";
import {
	BOOST_VIEW,
	DropSlotTracker,
	boostBlinkTransparency,
	dropAgeSec,
	dropBobStuds,
	dropPopScale,
	dropSecondsLeft,
} from "shared/view/boosts";
import { burstSeed, motionScale } from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { FxSpriteController } from "../fx/FxSpriteController";
import { ParticleController } from "../fx/ParticleController";
import {
	buildPlaceholder,
	destroyModel,
	renderPart,
	setModelTransparency,
	type PlaceholderModel,
} from "./placeholders";
import { SpriteView } from "./SpriteView";

const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const HIDDEN = 1;
const IDLE: SpriteAnimChoice = { anim: BOOST_VIEW.idleAnimation, rate: 1 };

/** How one kind is drawn with this pack (resolved once): exactly one of set / image, or neither (placeholder gem). */
interface KindLook {
	readonly theme: Boost;
	readonly set: SpriteSet | undefined;
	readonly image: WorldImage | undefined;
	/** Billboard layout (sprite / image paths), scaled down to BOOST_VIEW.maxHeightTiles. */
	readonly layout: SpriteLayout | undefined;
}

/** A static image billboard (image art): an invisible anchor Part with a BillboardGui + ImageLabel. */
interface ImageBody {
	readonly anchor: Part;
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
	readonly board: SpriteBillboard;
}

/** The drawn body of one drop, pooled per kind. Exactly one of model / sprite / image is set. */
interface DropBody {
	readonly kind: number;
	readonly model: PlaceholderModel | undefined;
	/** The model's pieces at full size (the landing pop scales them). */
	readonly sizes: ReadonlyArray<Vector3>;
	readonly sprite: SpriteView | undefined;
	readonly image: ImageBody | undefined;
	transparency: number;
	scale: number;
}

interface DropView {
	readonly slot: number;
	/** Base point on the floor at the drop's position. */
	readonly rest: CFrame;
	readonly body: DropBody;
}

/**
 * Boost drops on the floor (docs/BOOSTS.md B6), drawn from the sim's ground slots (shared/sim dropsGround; runs with
 * SimConfig.drops, nothing otherwise). Once per rendered frame (after the camera, like every view) the pure
 * DropSlotTracker (shared/view/boosts) diffs the slots against the last frame, so multi-tick frames, floor changes and
 * restarts are handled from state:
 *
 *   landed   a body per occupied slot, by what the pack has for `boost.<kind>` (ThemePack.boost): a sprite set's
 *            `idle` (SpriteView), an upright image billboard, or the placeholder gem (`Diamond`, the kind's colour
 *            role). Art is capped at BOOST_VIEW.maxHeightTiles (breakableArtLayout's rule).
 *   on the floor  bob (dropBobStuds, x the juice motionScale: still under reduced motion), the landing pop (dropPopScale;
 *            placeholder and image paths), and the fade blink during the last BOOST_VIEW.blinkSeconds of its ground
 *            life (boostBlinkTransparency on `ticksLeft`; steady dim under reduced motion). Every value is read from
 *            state each frame (age from `spawnTick` + the sim's alpha); nothing is interpolated.
 *   cleared  the body goes back to its kind's pool (parked far below).
 *
 * Effects come from the run view's per-tick boost events (`RunView.boostEvents`, every tick of the frame): a pickup
 * plays `fx.boost.collect` when the pack has it (FxSpriteController.boostCollect), else a particle burst in the kind's
 * colour (ParticleController.boostBurst); a drop that faded leaves a small poof. Sounds are not played here:
 * AudioController maps the same events (shared/view/audio cues.ts). All moves in one workspace:BulkMoveTo per frame
 * (one CFrame per part, the last written). Read-only on the sim.
 */
@Controller({})
export class BoostDropRenderController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly tracker = new DropSlotTracker();
	/** Views by ground slot. A Map, not an array: freed slots would leave holes, and `#` on a holey table is unreliable. */
	private readonly views = new Map<number, DropView>();
	private readonly slotScratch = new Array<number>();
	private readonly free = new Map<number, DropBody[]>();
	private readonly looks = new Array<KindLook>();
	private readonly moves = new Map<BasePart, CFrame>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
	private pack: ThemePack | undefined;
	private folder: Folder | undefined;
	/** The pack draws `fx.boost.collect` (else pickups burst particles). */
	private collectFx = false;
	private lastSimSec: number | undefined;
	private shown = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
		private readonly sprites: FxSpriteController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		this.collectFx = pack.fx(BOOST_COLLECT_FX_ID) !== undefined;
		const folder = new Instance("Folder");
		folder.Name = BOOST_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		for (const k of BOOST_KINDS) this.looks.push(lookFor(pack.boost(k)));

		const reset = () => this.tracker.reset();
		this.sim.onRunStarted(reset);
		this.sim.onFloorChanged(reset);
		this.sim.onRunExited(() => this.clear());
		RunService.BindToRenderStep(
			BOOST_VIEW.renderStep,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(BOOST_VIEW.renderStep), true);
		this.janitor.Add(() => this.destroyPools(), true);
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			if (this.shown) this.clear();
			return;
		}
		const state = ctx.run.state;
		const ground = dropsGround(state);
		if (ground.size() === 0 && !this.shown) return;
		debug.profilebegin(BOOST_VIEW.profileLabel);
		const alpha = this.sim.getAlpha();
		const simSec = (state.tick + alpha) / SIM_HZ;
		const dtSec = animDtSec(this.lastSimSec, simSec);
		this.lastSimSec = simSec;
		const t = this.tracker;
		t.update(ground, state.tick);
		for (const slot of t.cleared) this.release(slot);
		for (const slot of t.landed) this.attach(slot, ground[slot]);

		const ev = ctx.run.boostEvents;
		for (const c of ev.collected) {
			if (this.collectFx) this.sprites.boostCollect(c.x, c.z);
			else
				this.particles.boostBurst(
					c.x,
					c.z,
					c.kind,
					false,
					burstSeed(c.slot, state.tick, BOOST_VIEW.collectSeedSalt),
				);
		}
		for (const e of ev.expired) {
			this.particles.boostBurst(e.x, e.z, e.kind, true, burstSeed(e.slot, state.tick, BOOST_VIEW.poofSeedSalt));
		}

		const motion = motionScale(this.fx.settings());
		let any = false;
		for (const [slot, view] of this.views) {
			const g = ground[slot];
			if (g === undefined) continue;
			any = true;
			this.animate(view, g, state.tick, alpha, dtSec, motion);
		}
		this.shown = any;
		this.flushMoves();
		debug.profileend();
	}

	/** One frame of a drop: bob, pop, blink, the sprite's idle loop. */
	private animate(
		view: DropView,
		g: Readonly<GroundDrop>,
		tick: number,
		alpha: number,
		dtSec: number,
		motion: number,
	): void {
		const body = view.body;
		const age = dropAgeSec(tick, alpha, g.spawnTick);
		const bob = dropBobStuds(age, motion);
		this.setScale(body, dropPopScale(age, motion));
		this.setTransparency(body, boostBlinkTransparency(dropSecondsLeft(g.ticksLeft), motion));
		this.place(body, bob !== 0 ? view.rest.add(new Vector3(0, bob, 0)) : view.rest);
		body.sprite?.update(IDLE, 0, 0, this.basis, dtSec);
	}

	private flushMoves(): void {
		if (this.moves.size() === 0) return;
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (const [part, cf] of this.moves) {
			this.moveParts.push(part);
			this.moveCFrames.push(cf);
		}
		this.moves.clear();
		Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
	}

	/** Run over (left / exited) or no run: every body parked; the next run starts fresh. */
	private clear(): void {
		this.releaseAll();
		this.flushMoves();
		this.tracker.reset();
		this.lastSimSec = undefined;
		this.shown = false;
	}

	// --- bodies ----------------------------------------------------------------------------------

	private attach(slot: number, g: Readonly<GroundDrop> | undefined): void {
		if (g === undefined) return;
		if (this.views.has(slot)) this.release(slot);
		const body = this.acquire(g.kind);
		const rest = new CFrame(studsX(g.x), floorStudsY() + BOOST_VIEW.liftStuds, studsZ(g.z));
		this.views.set(slot, { slot, rest, body });
		body.sprite?.update(IDLE, 0, 0, this.basis, 0);
		this.place(body, rest);
	}

	private release(slot: number): void {
		const view = this.views.get(slot);
		if (view === undefined) return;
		this.views.delete(slot);
		const body = view.body;
		if (body.sprite !== undefined) body.sprite.park();
		if (body.image !== undefined) body.image.gui.Enabled = false;
		this.place(body, PARKED);
		const list = this.free.get(body.kind);
		if (list !== undefined) list.push(body);
		else this.free.set(body.kind, [body]);
	}

	private acquire(kind: number): DropBody {
		const pooled = this.free.get(kind)?.pop();
		if (pooled !== undefined) {
			if (pooled.sprite !== undefined) pooled.sprite.reset();
			if (pooled.image !== undefined) pooled.image.gui.Enabled = true;
			this.setTransparency(pooled, 0);
			this.setScale(pooled, 1);
			return pooled;
		}
		return this.build(kind);
	}

	private build(kind: number): DropBody {
		const folder = this.folder!;
		const look = this.looks[kind] ?? this.looks[0];
		const empty = { transparency: 0, scale: 1 };
		if (look.set !== undefined) {
			const sprite = new SpriteView(look.set, folder, look.layout);
			return { kind, model: undefined, sizes: [], sprite, image: undefined, ...empty };
		}
		if (look.image !== undefined && look.layout !== undefined) {
			const image = buildImage(look.image, look.layout, folder);
			return { kind, model: undefined, sizes: [], sprite: undefined, image, ...empty };
		}
		const model = buildPlaceholder(this.pack!, look.theme.id, look.theme.placeholder, 1, folder, false);
		const sizes = model.pieces.map((p) => p.part.Size);
		return { kind, model, sizes, sprite: undefined, image: undefined, ...empty };
	}

	/** Moves the body's parts to `origin` (the model's pieces at their offsets, scaled with the pop). */
	private place(body: DropBody, origin: CFrame): void {
		const model = body.model;
		if (model !== undefined) {
			const s = body.scale;
			for (const piece of model.pieces) {
				const o = piece.offset;
				this.moves.set(piece.part, origin.mul(s === 1 ? o : new CFrame(o.Position.mul(s)).mul(o.Rotation)));
			}
		}
		if (body.sprite !== undefined) this.moves.set(body.sprite.anchor, origin);
		if (body.image !== undefined) this.moves.set(body.image.anchor, origin);
	}

	/** The landing pop's scale (placeholder pieces and the image billboard; a sprite set keeps its size). On change. */
	private setScale(body: DropBody, scale: number): void {
		if (body.scale === scale) return;
		body.scale = scale;
		const model = body.model;
		if (model !== undefined) {
			for (let i = 0; i < model.pieces.size(); i++) model.pieces[i].part.Size = body.sizes[i].mul(scale);
		}
		const image = body.image;
		if (image !== undefined) {
			const b = image.board;
			image.gui.Size = new UDim2(b.w * scale, 0, b.h * scale, 0);
			image.gui.StudsOffset = new Vector3(b.offsetX * scale, b.offsetY * scale, b.offsetZ);
		}
	}

	/** The fade blink (Part / ImageLabel transparency). On change. */
	private setTransparency(body: DropBody, t: number): void {
		if (body.transparency === t) return;
		body.transparency = t;
		if (body.model !== undefined) setModelTransparency(body.model, t);
		if (body.sprite !== undefined) body.sprite.setTransparency(t);
		if (body.image !== undefined) body.image.label.ImageTransparency = t;
	}

	/** Releases every view (slot keys copied first: no map edits while iterating it). */
	private releaseAll(): void {
		const slots = this.slotScratch;
		slots.clear();
		for (const [slot] of this.views) slots.push(slot);
		for (const slot of slots) this.release(slot);
		this.views.clear();
	}

	private destroyPools(): void {
		this.releaseAll();
		for (const [, list] of this.free) {
			for (const body of list) {
				if (body.model !== undefined) destroyModel(body.model);
				body.sprite?.destroy();
				body.image?.anchor.Destroy();
			}
		}
		this.free.clear();
	}
}

/** How a kind is drawn with the pack: its sprite set, its image, or the placeholder gem (both undefined). */
function lookFor(theme: Boost): KindLook {
	const art = theme.art;
	if (art !== undefined && art.kind === "sprites") {
		return {
			theme,
			set: art.set,
			image: undefined,
			layout: breakableArtLayout(art.set, BOOST_VIEW.maxHeightTiles),
		};
	}
	if (art !== undefined && art.kind === "image") {
		const layout: SpriteLayout = {
			frameW: art.size.X,
			frameH: art.size.Y,
			pivot: art.pivot,
			pixelsPerTile: art.pixelsPerTile,
		};
		return { theme, set: undefined, image: art, layout: breakableArtLayout(layout, BOOST_VIEW.maxHeightTiles) };
	}
	return { theme, set: undefined, image: undefined, layout: undefined };
}

/** An upright image billboard (like the pedestal beam): the region on an invisible anchor, its pivot on the anchor. */
function buildImage(art: WorldImage, layout: SpriteLayout, parent: Instance): ImageBody {
	const anchor = renderPart("Part", false);
	anchor.Name = "BoostImage";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = PARKED;
	const board = spriteBillboard(layout);
	const gui = new Instance("BillboardGui");
	gui.Name = "Boost";
	gui.Size = new UDim2(board.w, 0, board.h, 0);
	gui.StudsOffset = new Vector3(board.offsetX, board.offsetY, board.offsetZ);
	gui.LightInfluence = 0;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	gui.Adornee = anchor;
	const label = new Instance("ImageLabel");
	label.Name = "Frame";
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.Image = art.image;
	label.ImageRectOffset = art.offset;
	label.ImageRectSize = art.size;
	label.Parent = gui;
	gui.Parent = anchor;
	anchor.Parent = parent;
	return { anchor, gui, label, board };
}
