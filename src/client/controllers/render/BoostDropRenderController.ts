import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { createKvBillboardGui } from "client/ui";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { SIM_DT, SIM_HZ, dropsGround, type GroundDrop } from "shared/sim";
import {
	BOOST_BEAM_IMAGE_ID,
	BOOST_COLLECT_FX_ID,
	BOOST_GLINT_FX,
	BOOST_HALO_FX,
	BOOST_KINDS,
	decorFxId,
	type Boost,
	type DecorPiece,
	type ImageRef,
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
	uprightImageBillboard,
	type SpriteAnimChoice,
	type SpriteBillboard,
	type SpriteLayout,
} from "shared/view";
import {
	BOOST_VIEW,
	DropSlotTracker,
	boostBeamTransparency,
	boostBlinkTransparency,
	boostGlintBillboard,
	boostGlintFrame,
	boostHaloTransparency,
	boostImageLayout,
	boostLayerTransparency,
	boostPickupGlintFrame,
	boostPickupGlintTransparency,
	boostPickupHaloScale,
	boostPickupHaloTransparency,
	boostPickupSeconds,
	scaleBillboard,
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
import { buildFloorArt, restingAnimation, visualLayout, widthLayout } from "./decorParts";
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
const OPAQUE = 0;
const SELF_LIT = 0;
const WHITE = new Color3(1, 1, 1);
const IDLE: SpriteAnimChoice = { anim: BOOST_VIEW.idleAnimation, rate: 1 };
/** A Cylinder's axis is X: turn it upright (the Neon halo disc). */
const UPRIGHT = CFrame.Angles(0, 0, math.pi / 2);
const S = STUDS_PER_TILE;

/** How one kind is drawn with this pack (resolved once): exactly one of set / image, or neither (placeholder gem). */
interface KindLook {
	readonly theme: Boost;
	readonly set: SpriteSet | undefined;
	readonly image: WorldImage | undefined;
	/** Billboard layout (sprite / image paths): an image at the Lords of Pain scale, both capped by maxHeightTiles. */
	readonly layout: SpriteLayout | undefined;
	/** The prop's billboard at full size (art paths; the glint centres on it). */
	readonly board: SpriteBillboard | undefined;
}

/** A static image billboard (image art): an invisible anchor Part with a BillboardGui + ImageLabel. */
interface ImageBody {
	readonly anchor: Part;
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
	readonly board: SpriteBillboard;
}

/** The halo: `decor.fx.glow` flat on the floor (label set), or the Neon disc fallback (label undefined). */
interface Halo {
	readonly part: Part;
	readonly label: ImageLabel | undefined;
	/** Full-size Part size, and the Part's frame relative to the floor point under the drop. */
	readonly size: Vector3;
	readonly rel: CFrame;
	/** Its own transparency before the pulse and blink (haloTransparency / haloFallbackTransparency). */
	readonly base: number;
	/** As last written (float64; the properties read back as float32). */
	shown: number;
	scale: number;
}

/** The beam: `ui.marker.boost` on its own anchor at the drop's base (it does not bob). */
interface Beam {
	readonly anchor: Part;
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
	shown: number;
}

/** The glint: `decor.fx.glint` as a BillboardGui on an anchor (the prop's, or its own for a pickup flash). */
interface Glint {
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
	readonly piece: DecorPiece;
	readonly anim: string | undefined;
	readonly frames: number;
	readonly fps: number;
	shownFrame: number;
	shown: number;
}

/** The art layers of a drop with art (docs/BOOST_ART.md BA3), pooled with its body. */
interface ArtLayers {
	readonly halo: Halo;
	readonly beam: Beam | undefined;
	readonly glint: Glint | undefined;
}

/** The drawn body of one drop, pooled per kind. Exactly one of model / sprite / image is set. */
interface DropBody {
	readonly kind: number;
	readonly model: PlaceholderModel | undefined;
	/** The model's pieces at full size (the landing pop scales them). */
	readonly sizes: ReadonlyArray<Vector3>;
	readonly sprite: SpriteView | undefined;
	readonly image: ImageBody | undefined;
	/** Halo, beam and glint: art bodies only (the placeholder gem keeps its own look). */
	readonly layers: ArtLayers | undefined;
	transparency: number;
	scale: number;
}

interface DropView {
	readonly slot: number;
	/** Base point on the floor at the drop's position. */
	readonly rest: CFrame;
	readonly body: DropBody;
}

/** A pickup flash (BA-P4): a halo flash and the glint played once, at the pickup point. Pooled. */
interface Flash {
	readonly halo: Halo;
	readonly anchor: Part;
	readonly glint: Glint | undefined;
	at: CFrame;
	startSec: number;
	endSec: number;
}

/**
 * Boost drops on the floor (docs/BOOSTS.md B6, art layers docs/BOOST_ART.md BA3), drawn from the sim's ground slots
 * (shared/sim dropsGround; runs with SimConfig.drops, nothing otherwise). Once per rendered frame (after the camera,
 * like every view) the pure DropSlotTracker (shared/view/boosts) diffs the slots against the last frame, so multi-tick
 * frames, floor changes and restarts are handled from state:
 *
 *   landed   a body per occupied slot, by what the pack has for `boost.<kind>` (ThemePack.boost): a sprite set's
 *            `idle` (SpriteView), an upright image billboard (boostImageLayout: the art's own pixelsPerTile,
 *            vale 29.6 from the swarmer set, BOOST_VIEW.artPixelsPerTile as the fallback; never taller than maxHeightTiles), or the placeholder gem (`Diamond`, the
 *            kind's colour role). A body with art also gets its layers, bottom to top:
 *              halo   `decor.fx.glow` (ThemePack.decor) flat on the floor, tinted by the kind's role, haloTiles across,
 *                     over the decor flats and floor effects, under markings and bullets; a Neon disc without it
 *              prop   the billboard above
 *              beam   `ui.marker.boost` (ThemePack.image) rising from the drop's base, tinted, beamHeightTiles; none
 *                     without the image; it does not bob
 *              glint  `decor.fx.glint` looping over the prop's centre, phase per slot (boostGlintFrame)
 *   on the floor  bob (dropBobStuds, x the juice motionScale: still under reduced motion; prop and glint), the landing
 *            pop (dropPopScale; placeholder and image paths, the glint with the image), the halo's pulse in phase with
 *            the bob (boostHaloTransparency), and the fade blink during the last BOOST_VIEW.blinkSeconds of its ground
 *            life (boostBlinkTransparency on `ticksLeft`; steady dim under reduced motion) over the whole stack
 *            (boostLayerTransparency). Every value is read from state each frame (age from `spawnTick` + the sim's
 *            alpha); nothing is interpolated.
 *   cleared  the body and its layers go back to its kind's pool (parked far below).
 *
 * Effects come from the run view's per-tick boost events (`RunView.boostEvents`, every tick of the frame): a pickup
 * plays `fx.boost.collect` when the pack has it (FxSpriteController.boostCollect); else, for a kind with art, a pickup
 * flash (the glint once at pickupGlintScale and a growing, fading halo, on sim time; pooled); else a particle burst in
 * the kind's colour (ParticleController.boostBurst). A drop that faded leaves a small poof. Sounds are not played
 * here: AudioController maps the same events (shared/view/audio cues.ts). All moves in one workspace:BulkMoveTo per
 * frame (one CFrame per part, the last written). Read-only on the sim.
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
	private readonly flashes = new Array<Flash>();
	private readonly freeFlashes = new Array<Flash>();
	private readonly moves = new Map<BasePart, CFrame>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
	private pack: ThemePack | undefined;
	private folder: Folder | undefined;
	/** The pack draws `fx.boost.collect` (else pickups flash or burst particles). */
	private collectFx = false;
	/** The layers' art: `decor.fx.glow` (halo), `decor.fx.glint`, `ui.marker.boost` (beam); undefined when absent. */
	private glow: DecorPiece | undefined;
	private glint: DecorPiece | undefined;
	private beam: ImageRef | undefined;
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
		this.glow = pack.decor(decorFxId(BOOST_HALO_FX));
		this.glint = pack.decor(decorFxId(BOOST_GLINT_FX));
		this.beam = pack.image(BOOST_BEAM_IMAGE_ID);
		const folder = new Instance("Folder");
		folder.Name = BOOST_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		for (const k of BOOST_KINDS) this.looks.push(lookFor(pack.boost(k)));

		const reset = () => {
			this.tracker.reset();
			this.parkFlashes();
			this.flushMoves();
		};
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
			if (this.shown || this.flashes.size() > 0) this.clear();
			return;
		}
		const state = ctx.run.state;
		const ground = dropsGround(state);
		if (ground.size() === 0 && !this.shown && this.flashes.size() === 0) return;
		debug.profilebegin(BOOST_VIEW.profileLabel);
		const alpha = this.sim.getAlpha();
		const simSec = (state.tick + alpha) / SIM_HZ;
		const dtSec = animDtSec(this.lastSimSec, simSec);
		this.lastSimSec = simSec;
		const motion = motionScale(this.fx.settings());
		const t = this.tracker;
		t.update(ground, state.tick);
		for (const slot of t.cleared) this.release(slot);
		for (const slot of t.landed) this.attach(slot, ground[slot]);

		const ev = ctx.run.boostEvents;
		for (const c of ev.collected) {
			if (this.collectFx) this.sprites.boostCollect(c.x, c.z);
			else if (this.hasArt(c.kind)) this.startFlash(c.kind, c.x, c.z, simSec, motion);
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

		let any = false;
		for (const [slot, view] of this.views) {
			const g = ground[slot];
			if (g === undefined) continue;
			any = true;
			this.animate(view, g, state.tick, alpha, dtSec, motion);
		}
		this.shown = any;
		this.updateFlashes(simSec, motion);
		this.flushMoves();
		debug.profileend();
	}

	/** One frame of a drop: bob, pop, blink, the sprite's idle loop, the art layers. */
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
		const blink = boostBlinkTransparency(dropSecondsLeft(g.ticksLeft), motion);
		this.setScale(body, dropPopScale(age, motion));
		this.setTransparency(body, blink);
		this.place(body, bob !== 0 ? view.rest.add(new Vector3(0, bob, 0)) : view.rest);
		body.sprite?.update(IDLE, 0, 0, this.basis, dtSec);
		const layers = body.layers;
		if (layers === undefined) return;
		const halo = layers.halo;
		setHaloTransparency(halo, boostLayerTransparency(boostHaloTransparency(age, motion, halo.base), blink));
		if (layers.beam !== undefined) setBeamTransparency(layers.beam, boostBeamTransparency(blink));
		const glint = layers.glint;
		if (glint !== undefined) {
			setGlintTransparency(glint, boostLayerTransparency(OPAQUE, blink));
			setGlintFrame(glint, boostGlintFrame(age, glint.fps, glint.frames, view.slot, motion));
		}
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

	/** Run over (left / exited) or no run: every body and flash parked; the next run starts fresh. */
	private clear(): void {
		this.releaseAll();
		this.parkFlashes();
		this.flushMoves();
		this.tracker.reset();
		this.lastSimSec = undefined;
		this.shown = false;
	}

	// --- bodies ----------------------------------------------------------------------------------

	private hasArt(kind: number): boolean {
		const look = this.looks[kind];
		return look !== undefined && look.board !== undefined;
	}

	private attach(slot: number, g: Readonly<GroundDrop> | undefined): void {
		if (g === undefined) return;
		if (this.views.has(slot)) this.release(slot);
		const body = this.acquire(g.kind);
		const rest = new CFrame(studsX(g.x), floorStudsY() + BOOST_VIEW.liftStuds, studsZ(g.z));
		this.views.set(slot, { slot, rest, body });
		body.sprite?.update(IDLE, 0, 0, this.basis, 0);
		this.place(body, rest);
		this.placeLayers(body, new CFrame(studsX(g.x), floorStudsY(), studsZ(g.z)), rest);
	}

	private release(slot: number): void {
		const view = this.views.get(slot);
		if (view === undefined) return;
		this.views.delete(slot);
		const body = view.body;
		if (body.sprite !== undefined) body.sprite.park();
		if (body.image !== undefined) body.image.gui.Enabled = false;
		this.setLayersEnabled(body, false);
		this.place(body, PARKED);
		this.placeLayers(body, PARKED, PARKED);
		const list = this.free.get(body.kind);
		if (list !== undefined) list.push(body);
		else this.free.set(body.kind, [body]);
	}

	private acquire(kind: number): DropBody {
		const pooled = this.free.get(kind)?.pop();
		if (pooled !== undefined) {
			if (pooled.sprite !== undefined) pooled.sprite.reset();
			if (pooled.image !== undefined) pooled.image.gui.Enabled = true;
			this.setLayersEnabled(pooled, true);
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
			const layers = this.buildLayers(look, sprite.anchor, folder);
			return { kind, model: undefined, sizes: [], sprite, image: undefined, layers, ...empty };
		}
		if (look.image !== undefined && look.layout !== undefined) {
			const image = buildImage(look.image, look.layout, folder);
			const layers = this.buildLayers(look, image.anchor, folder);
			return { kind, model: undefined, sizes: [], sprite: undefined, image, layers, ...empty };
		}
		const model = buildPlaceholder(this.pack!, look.theme.id, look.theme.placeholder, 1, folder, false);
		const sizes = model.pieces.map((p) => p.part.Size);
		return { kind, model, sizes, sprite: undefined, image: undefined, layers: undefined, ...empty };
	}

	/** Halo, beam and glint for an art body whose prop billboard sits on `propAnchor`. */
	private buildLayers(look: KindLook, propAnchor: Part, folder: Folder): ArtLayers | undefined {
		const board = look.board;
		if (board === undefined) return undefined;
		const color = look.theme.color;
		const halo = this.buildHalo(color, folder);
		const beam = this.beam !== undefined ? buildBeam(this.beam, color, folder) : undefined;
		const glintPiece = this.glint;
		const glint =
			glintPiece !== undefined
				? buildGlint(glintPiece, propAnchor, boostGlintBillboard(board, visualLayout(glintPiece.art)))
				: undefined;
		return { halo, beam, glint };
	}

	/** The halo in `color`: the glow laid flat (haloTiles across, self-lit), else the Neon disc. Built parked. */
	private buildHalo(color: Color3, folder: Folder): Halo {
		const v = BOOST_VIEW;
		const glow = this.glow;
		if (glow !== undefined) {
			const layout = widthLayout(visualLayout(glow.art), v.haloTiles);
			// built at the origin, so its frame there is its frame relative to the floor point
			const art = buildFloorArt(
				"BoostHalo",
				glow.art,
				Vector3.zero,
				folder,
				v.haloThicknessStuds,
				v.haloLiftStuds,
				0,
				layout,
			);
			if (art !== undefined) {
				const rel = art.part.CFrame;
				art.part.CFrame = PARKED;
				art.gui.LightInfluence = SELF_LIT;
				art.label.ImageColor3 = color;
				art.label.ImageTransparency = HIDDEN;
				const size = art.part.Size;
				return {
					part: art.part,
					label: art.label,
					size,
					rel,
					base: v.haloTransparency,
					shown: HIDDEN,
					scale: 1,
				};
			}
		}
		const d = v.haloTiles * S;
		const part = renderPart("Part", false);
		part.Name = "BoostHalo";
		part.Shape = Enum.PartType.Cylinder;
		part.Material = Enum.Material[v.haloMaterial];
		part.Color = color;
		part.Transparency = HIDDEN;
		const size = new Vector3(v.haloThicknessStuds, d, d);
		part.Size = size;
		part.CFrame = PARKED;
		part.Parent = folder;
		const rel = new CFrame(0, v.haloLiftStuds - v.haloThicknessStuds / 2, 0).mul(UPRIGHT);
		return { part, label: undefined, size, rel, base: v.haloFallbackTransparency, shown: HIDDEN, scale: 1 };
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

	/** The layers that do not bob: the halo on the floor point `floor`, the beam's anchor on the drop's base `base`. */
	private placeLayers(body: DropBody, floor: CFrame, base: CFrame): void {
		const layers = body.layers;
		if (layers === undefined) return;
		this.moves.set(layers.halo.part, floor.mul(layers.halo.rel));
		if (layers.beam !== undefined) this.moves.set(layers.beam.anchor, base);
	}

	private setLayersEnabled(body: DropBody, on: boolean): void {
		const layers = body.layers;
		if (layers === undefined) return;
		if (layers.beam !== undefined) layers.beam.gui.Enabled = on;
		if (layers.glint !== undefined) layers.glint.gui.Enabled = on;
		if (!on) {
			setHaloTransparency(layers.halo, HIDDEN);
			if (layers.beam !== undefined) setBeamTransparency(layers.beam, HIDDEN);
		}
	}

	/** The landing pop's scale (placeholder pieces and the image billboard with its glint; a sprite set keeps its size). */
	private setScale(body: DropBody, scale: number): void {
		if (body.scale === scale) return;
		body.scale = scale;
		const model = body.model;
		if (model !== undefined) {
			for (let i = 0; i < model.pieces.size(); i++) model.pieces[i].part.Size = body.sizes[i].mul(scale);
		}
		const image = body.image;
		if (image !== undefined) {
			const b = scaleBillboard(image.board, scale);
			image.gui.Size = new UDim2(b.w, 0, b.h, 0);
			image.gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
			const glint = body.layers?.glint;
			if (glint !== undefined) setGlintBoard(glint, boostGlintBillboard(b, visualLayout(glint.piece.art), scale));
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

	// --- pickup flashes (BA-P4) ---------------------------------------------------------------------

	/** A pickup of Boost `kind` at sim (x, z): the kind's halo flash and the glint once, from sim second `simSec`. */
	private startFlash(kind: number, x: number, z: number, simSec: number, motion: number): void {
		const look = this.looks[kind];
		if (look === undefined || look.board === undefined) return;
		const flash = this.freeFlashes.pop() ?? this.buildFlash();
		const color = look.theme.color;
		const halo = flash.halo;
		if (halo.label !== undefined) halo.label.ImageColor3 = color;
		else halo.part.Color = color;
		const glint = flash.glint;
		let frames = 1;
		let fps = 0;
		if (glint !== undefined) {
			frames = glint.frames;
			fps = glint.fps;
			setGlintBoard(
				glint,
				boostGlintBillboard(look.board, visualLayout(glint.piece.art), BOOST_VIEW.pickupGlintScale),
			);
			glint.gui.Enabled = true;
		}
		flash.at = new CFrame(studsX(x), floorStudsY(), studsZ(z));
		flash.startSec = simSec;
		flash.endSec = simSec + boostPickupSeconds(fps, frames, motion);
		this.moves.set(flash.anchor, flash.at.add(new Vector3(0, BOOST_VIEW.liftStuds, 0)));
		this.flashes.push(flash);
	}

	private buildFlash(): Flash {
		const folder = this.folder!;
		const halo = this.buildHalo(WHITE, folder);
		const anchor = renderPart("Part", false);
		anchor.Name = "BoostFlash";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = PARKED;
		anchor.Parent = folder;
		const piece = this.glint;
		const glint =
			piece !== undefined
				? buildGlint(piece, anchor, boostGlintBillboard(EMPTY_BOARD, visualLayout(piece.art)))
				: undefined;
		if (glint !== undefined) glint.gui.Enabled = false;
		return { halo, anchor, glint, at: PARKED, startSec: 0, endSec: 0 };
	}

	/** Every live flash one frame on (on sim time: they hold in pause); finished ones (or a sim clock gone back) park. */
	private updateFlashes(simSec: number, motion: number): void {
		const list = this.flashes;
		let i = 0;
		while (i < list.size()) {
			const f = list[i];
			const age = simSec - f.startSec;
			// A sim clock gone back by more than one tick (a restart); within a tick it is the resume after a pause
			// (the loop's accumulator cleared, alpha back to ~0), which keeps the flash.
			if (age < -SIM_DT || simSec >= f.endSec) {
				this.parkFlash(f);
				list[i] = list[list.size() - 1];
				list.pop();
				this.freeFlashes.push(f);
				continue;
			}
			const halo = f.halo;
			setHaloScale(halo, boostPickupHaloScale(age, motion));
			setHaloTransparency(halo, boostPickupHaloTransparency(age));
			this.moves.set(halo.part, f.at.mul(scaledRel(halo)));
			const glint = f.glint;
			if (glint !== undefined) {
				setGlintFrame(glint, boostPickupGlintFrame(age, glint.fps, glint.frames, motion));
				setGlintTransparency(glint, boostPickupGlintTransparency(age, glint.fps, glint.frames, motion));
			}
			i++;
		}
	}

	private parkFlash(f: Flash): void {
		setHaloTransparency(f.halo, HIDDEN);
		setHaloScale(f.halo, 1);
		this.moves.set(f.halo.part, PARKED);
		this.moves.set(f.anchor, PARKED);
		if (f.glint !== undefined) {
			setGlintTransparency(f.glint, HIDDEN);
			f.glint.gui.Enabled = false;
		}
	}

	private parkFlashes(): void {
		for (const f of this.flashes) {
			this.parkFlash(f);
			this.freeFlashes.push(f);
		}
		this.flashes.clear();
	}

	private destroyPools(): void {
		this.releaseAll();
		this.parkFlashes();
		for (const [, list] of this.free) {
			for (const body of list) {
				if (body.model !== undefined) destroyModel(body.model);
				body.sprite?.destroy();
				body.image?.anchor.Destroy();
				const layers = body.layers;
				if (layers !== undefined) {
					layers.halo.part.Destroy();
					layers.beam?.anchor.Destroy();
				}
			}
		}
		this.free.clear();
		for (const f of this.freeFlashes) {
			f.halo.part.Destroy();
			f.anchor.Destroy();
		}
		this.freeFlashes.clear();
	}
}

/** A zero-size prop billboard (a flash's glint before its first pickup sets the kind's). */
const EMPTY_BOARD: SpriteBillboard = { w: 0, h: 0, offsetX: 0, offsetY: 0, offsetZ: 0 };

/** How a kind is drawn with the pack: its sprite set, its image, or the placeholder gem (both undefined). */
function lookFor(theme: Boost): KindLook {
	const art = theme.art;
	if (art !== undefined && art.kind === "sprites") {
		const layout = breakableArtLayout(art.set, BOOST_VIEW.maxHeightTiles);
		return { theme, set: art.set, image: undefined, layout, board: spriteBillboard(layout) };
	}
	if (art !== undefined && art.kind === "image") {
		const layout = boostImageLayout(art.size.X, art.size.Y, art.pivot, art.pixelsPerTile);
		return { theme, set: undefined, image: art, layout, board: spriteBillboard(layout) };
	}
	return { theme, set: undefined, image: undefined, layout: undefined, board: undefined };
}

/** An upright image billboard (like the pedestal beam): the region on an invisible anchor, its pivot on the anchor. */
function buildImage(art: WorldImage, layout: SpriteLayout, parent: Instance): ImageBody {
	const anchor = renderPart("Part", false);
	anchor.Name = "BoostImage";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = PARKED;
	const board = spriteBillboard(layout);
	const gui = createKvBillboardGui("Boost");
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

/**
 * The beam in `color` on its own anchor (the RunMarkerController pedestal beam's build): `ui.marker.boost`,
 * beamHeightTiles tall, its pivot (else its bottom centre) on the drop's base. Built parked and hidden.
 */
function buildBeam(image: ImageRef, color: Color3, parent: Instance): Beam {
	const anchor = renderPart("Part", false);
	anchor.Name = "BoostBeam";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = PARKED;
	const b = uprightImageBillboard(image.w, image.h, BOOST_VIEW.beamHeightTiles, image.pivot);
	const gui = createKvBillboardGui("Beam");
	gui.Size = new UDim2(b.w, 0, b.h, 0);
	gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
	gui.LightInfluence = SELF_LIT;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	gui.Adornee = anchor;
	const label = new Instance("ImageLabel");
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.Image = image.assetId;
	label.ImageColor3 = color;
	label.ImageTransparency = HIDDEN;
	label.Parent = gui;
	gui.Parent = anchor;
	anchor.Parent = parent;
	return { anchor, gui, label, shown: HIDDEN };
}

/** The glint billboard on `anchor`, drawn as `board` (boostGlintBillboard), untinted, hidden until its first frame. */
function buildGlint(piece: DecorPiece, anchor: Part, board: SpriteBillboard): Glint {
	const art = piece.art;
	let anim: string | undefined;
	let frames = 1;
	let fps = 0;
	const gui = createKvBillboardGui("Glint");
	gui.LightInfluence = SELF_LIT;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	gui.Adornee = anchor;
	const label = new Instance("ImageLabel");
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.ImageColor3 = WHITE;
	label.ImageTransparency = HIDDEN;
	if (art.kind === "image") {
		label.Image = art.image;
		label.ImageRectOffset = art.offset;
		label.ImageRectSize = art.size;
	} else {
		label.ResampleMode = Enum.ResamplerMode[art.set.resample];
		anim = restingAnimation(art.set, BOOST_VIEW.idleAnimation);
		const def = anim !== undefined ? art.set.animation(anim) : undefined;
		if (def !== undefined) {
			frames = math.max(1, def.frames);
			fps = def.fps;
		}
	}
	label.Parent = gui;
	gui.Parent = anchor;
	const glint: Glint = { gui, label, piece, anim, frames, fps, shownFrame: -1, shown: HIDDEN };
	setGlintBoard(glint, board);
	setGlintFrame(glint, 0);
	return glint;
}

function setGlintBoard(glint: Glint, b: SpriteBillboard): void {
	glint.gui.Size = new UDim2(b.w, 0, b.h, 0);
	glint.gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
}

/** A sprite glint's frame (image art: nothing). Written only when it changes. */
function setGlintFrame(glint: Glint, frame: number): void {
	const art = glint.piece.art;
	if (art.kind !== "sprites" || glint.anim === undefined || frame === glint.shownFrame) return;
	glint.shownFrame = frame;
	const f = art.set.frame(glint.anim, 0, frame);
	if (glint.label.Image !== f.image) glint.label.Image = f.image;
	glint.label.ImageRectOffset = f.offset;
	glint.label.ImageRectSize = f.size;
}

function setGlintTransparency(glint: Glint, t: number): void {
	if (t === glint.shown) return;
	glint.shown = t;
	glint.label.ImageTransparency = t;
}

function setBeamTransparency(beam: Beam, t: number): void {
	if (t === beam.shown) return;
	beam.shown = t;
	beam.label.ImageTransparency = t;
}

/** The halo's transparency (the glow's ImageTransparency, or the Neon disc's Part.Transparency). On change. */
function setHaloTransparency(halo: Halo, t: number): void {
	if (t === halo.shown) return;
	halo.shown = t;
	if (halo.label !== undefined) halo.label.ImageTransparency = t;
	else halo.part.Transparency = t;
}

/** The halo's size (a pickup flash grows it; the glow's SurfaceGui scales with its Part). On change. */
function setHaloScale(halo: Halo, scale: number): void {
	if (scale === halo.scale) return;
	halo.scale = scale;
	// the glow's Part is (width, thickness, depth); the Neon Cylinder's (thickness, diameter, diameter)
	const flat = halo.label !== undefined;
	halo.part.Size = halo.size.mul(new Vector3(flat ? scale : 1, flat ? 1 : scale, scale));
}

/** The halo's frame relative to the floor point at its current scale (its pivot shift across the floor scaled). */
function scaledRel(halo: Halo): CFrame {
	const s = halo.scale;
	if (s === 1) return halo.rel;
	const p = halo.rel.Position;
	return new CFrame(p.X * s, p.Y, p.Z * s).mul(halo.rel.Rotation);
}
