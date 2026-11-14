import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { DEV_MONO_FONT, createKvBillboardGui, createKvSurfaceGui } from "client/ui";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { RUN_ATTRIBUTES } from "shared/play";
import { BREAKABLE_KINDS, gridToWorld, type Dungeon } from "shared/dungeon";
import { NO_BOOST, SIM_HZ, breakableLootAt, silverPieceAt, type SimState } from "shared/sim";
import {
	BIOMES,
	BREAKABLE_SHATTER_ANIMATION,
	decorFxId,
	type BiomeId,
	type Breakable,
	type DecorPiece,
	type Pivot,
	type SpriteSet,
	type ThemePack,
	type WorldImage,
} from "shared/theme";
import {
	BREAKABLE_DEBRIS,
	BREAKABLE_LOOT_VIEW,
	BREAKABLE_VIEW,
	BULLET_VIEW,
	BreakableTracker,
	LOOT_GLINT_HIDDEN,
	RENDER_ORDER,
	SPRITE_VIEW,
	animDtSec,
	artPieceTop,
	boxPieceTop,
	breakableArtLayout,
	breakableBaseStuds,
	breakableBoxStuds,
	breakableHitActive,
	breakableHitFlash,
	breakableKindName,
	breakableShakeStuds,
	debrisVariant,
	degToRad,
	isInertPieceKind,
	floorImageOffset,
	floorImageSize,
	glintSlotCount,
	isoBasis,
	lookWhenReady,
	lootDebugText,
	lootGlintBillboard,
	lootGlintDucked,
	lootGlintFrame,
	lootGlintPhaseSec,
	lootGlintTransparency,
	oneShotSec,
	pieceGlints,
	silverDebugText,
	spriteBillboard,
	ReadinessCursor,
	type PieceTop,
	type SpriteAnimChoice,
	type SpriteBillboard,
	type SpriteLayout,
} from "shared/view";
import { burstSeed, motionScale } from "shared/view/fx";
import { SILVER_CRATE_FX } from "shared/view/silver";
import { PreloadController } from "../game/PreloadController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { FxSpriteController } from "../fx/FxSpriteController";
import { ParticleController } from "../fx/ParticleController";
import { FLOOR_CANVAS_TURN, floorCanvasPartSize } from "./floorCanvas";
import {
	buildPlaceholder,
	destroyModel,
	renderPart,
	setModelColor,
	setModelTransparency,
	type PlaceholderModel,
} from "./placeholders";
import { SPRITE_TINT_NONE, SpriteView } from "./SpriteView";
import { visualLayout } from "./decorParts";
import { buildGlint, setGlintBoard, setGlintFrame, setGlintTransparency, type Glint } from "./glintParts";

const RENDER_STEP = "KV_Breakables";
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const HIDDEN = 1;
/** Flat floor images turn with the camera, so their x axis is the screen's right (as the co-op ring). */
const CAMERA_YAW = CFrame.Angles(0, degToRad(CAMERA_YAW_DEG), 0);
/** No hit yet (sim seconds). */
const NEVER = -math.huge;
const IDLE: SpriteAnimChoice = { anim: BREAKABLE_VIEW.idleAnimation, rate: 1 };
const SHATTER: SpriteAnimChoice = { anim: BREAKABLE_SHATTER_ANIMATION, rate: 1 };

/** How one kind is drawn with this pack (resolved once): exactly one of set / image, or neither (placeholder). */
interface KindLook {
	readonly theme: Breakable;
	/** Drawn with its art (the art is in the pack and downloaded, docs/STAGE_ASSETS.md SA18), else the placeholder. */
	readonly art: boolean;
	readonly set: SpriteSet | undefined;
	readonly image: WorldImage | undefined;
	/** Billboard layout (sprite / image paths), scaled down to BREAKABLE_VIEW.maxHeightTiles. */
	readonly layout: SpriteLayout | undefined;
	/** The sprite set's one-shot break, seconds (0: none). */
	readonly shatterSec: number;
	readonly flash: Color3;
	/** Where a loaded piece's glint sits: the drawn piece's top (art layout or placeholder box). */
	readonly top: PieceTop;
}

/** A static image billboard (image art): an invisible anchor Part with a BillboardGui + ImageLabel. */
interface ImageBody {
	readonly anchor: Part;
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
}

/** The drawn body of one intact piece, pooled per kind across floors. Exactly one of model / sprite / image is set. */
interface PieceBody {
	readonly kind: number;
	/** Built from an art look (KindLook.art): a pooled body of the other look is discarded, never reused. */
	readonly art: boolean;
	readonly model: PlaceholderModel | undefined;
	readonly sprite: SpriteView | undefined;
	readonly image: ImageBody | undefined;
	flashed: boolean;
}

interface PieceView {
	readonly slot: number;
	readonly kind: number;
	readonly cellX: number;
	readonly cellY: number;
	/** The resting CFrame (base on the floor at the cell centre). */
	readonly rest: CFrame;
	/** Undefined once broken and its shatter (if any) is over. */
	body: PieceBody | undefined;
	/** Sim seconds of the last hit (NEVER: none). */
	hitSec: number;
	/** Sim seconds the shatter one-shot ends (sprite path, while it plays), else undefined. */
	shatterEnd: number | undefined;
	debris: BasePart | undefined;
}

/** A loaded piece's glint (docs/BREAKABLE_DROPS.md BL6): `decor.fx.glint` on its own anchor at the piece's base. Pooled. */
interface LootGlint {
	readonly anchor: Part;
	readonly glint: Glint;
	/** lootGlintPhaseSec of the piece's cell, and its cell centre (sim units: the bullet duck). */
	phaseSec: number;
	x: number;
	z: number;
}

/** A zero-size billboard (a pooled glint before a piece sets its own). */
const EMPTY_BOARD: SpriteBillboard = { w: 0, h: 0, offsetX: 0, offsetY: 0, offsetZ: 0 };

/**
 * Breakable barrels and crates (docs/DECOR.md D4, task R13), drawn from the sim's `state.breakables` (endless runs;
 * nothing without it). Once per rendered frame (after the camera, like every view) the pure BreakableTracker
 * (shared/view breakables.ts) diffs the pieces' hp / brokenTick against the last frame, so multi-tick frames, floor
 * changes and restarts are all handled from state (the sim's per-tick hit / broken slots are not read):
 *
 *   new layout   (run start, floor change, restart, the first frame) every piece's view is rebuilt without effects:
 *                intact pieces get a body, broken ones their debris.
 *   intact       a body per piece, by what the pack has for `breakable.<kind>` (ThemePack.breakable): a sprite set's
 *                `idle` (SpriteView), an image billboard, or the placeholder box (`placeholder`, the kind's colour
 *                role). Every path is capped at BREAKABLE_VIEW.maxHeightTiles (breakableBoxStuds / breakableArtLayout).
 *                The art only once its id has downloaded (PreloadController.isArtReady, docs/STAGE_ASSETS.md SA18):
 *                until then the placeholder box is the stand-in, and on the readiness flip every intact piece of the
 *                kind is given a body in the new look (swapLooks; KV_StandInsForce flips it back the same way).
 *   hit          a blink in BREAKABLE_VIEW.flashRole (Part colour / ImageColor3) and a small decaying shake along the
 *                screen's x axis, x the juice motionScale (none under reduced motion), on sim time; plus the juice
 *                layer's hit sparks at the piece (ParticleController.breakableHitSparks), which is also what a bullet
 *                stopped by the piece ends in.
 *   break        chips (ParticleController.breakableChips) and the splinter sprite effect
 *                (FxSpriteController.breakableSplinter; nothing without fx art), then the sprite set's one-shot
 *                `shatter` if it has one, then the body goes back to its pool and the flat debris decal is laid: the
 *                biome's decor brokenBarrel / brokenCrate (a variant by cell hash; nothing when the pack has none).
 *                Sounds are not played here: AudioController maps the frame's summed breakableHits / breakablesBroken to
 *                sfx.breakable.hit / .break (shared/view/audio cues.ts).
 *
 * Loot (docs/BREAKABLE_DROPS.md BL6, BLD3): every frame, each intact piece whose slot holds a boost (shared/sim
 * breakableLootAt; nothing while the run has no breakable loot) gets a glint: the pack's `decor.fx.loot` (the anime
 * twinkle; without it `decor.fx.glint`, the treasure sparkle also drawn over boost gems; no art, no glint) on its own pooled anchor at the piece's base, its billboard on
 * the drawn piece's top (lootGlintBillboard), depth-tested. It plays once every BREAKABLE_LOOT_VIEW.glintEverySeconds of
 * sim time, phased by the piece's cell (lootGlintPhaseSec: every client of a party sees the same sparkle), soft
 * (glintTransparency); a still sparkle under reduced motion; hidden while an enemy bullet is within duckTiles
 * (lootGlintDucked), so it is never drawn over a bullet. It goes the frame the piece breaks (or its loot is released) and
 * with every new layout (floor change, restart, run end). The Goldling's hiding place (docs/GOLDLING_RUMOURS.md RD14,
 * GR4: shared/sim goldenPieceAt, while it hides) gets the very same glint: shared/view pieceGlints is the one test, so the
 * art, tint, cadence and per-cell phase are the loot glint's, and it goes the frame the piece breaks. Debug: KV_LootDebug (Workspace boolean, Studio or KV_Debug,
 * off by default) labels every loaded intact piece with its boost kind (lootDebugText, developer English).
 *
 * An inert slot (isInertPieceKind) gets no view at all: a vault's chest (docs/TREASURE.md TR7) is
 * TreasureRenderController's, a secret room's crack and chest (docs/SECRET_ROOMS.md SR7) SecretRenderController's.
 *
 * Bodies are pooled per kind and reused across floors (parked far below when unused); debris decals belong to the
 * floor's Janitor (cleaned on every new layout and when the run ends). Static pieces are placed once; only shaking
 * ones move, all in one workspace:BulkMoveTo per frame (one CFrame per part, the last written). Read-only on the sim.
 */
@Controller({})
export class BreakableRenderController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly tracker = new BreakableTracker();
	private readonly views = new Array<PieceView | undefined>();
	/** Views with a hit look or a shatter running (updated every frame until they settle). */
	private readonly active = new Set<PieceView>();
	/** Intact sprite views whose idle loop is clocked every frame. */
	private readonly idling = new Set<PieceView>();
	private readonly free = new Map<number, PieceBody[]>();
	private readonly looks = new Array<KindLook>();
	/**
	 * This frame's moves, the last per part winning (a body released and taken again in one frame, a shatter started
	 * and stepped): a part must not be listed twice in one BulkMoveTo.
	 */
	private readonly moves = new Map<BasePart, CFrame>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
	private readonly right: Vector3;
	private pack: ThemePack | undefined;
	private folder: Folder | undefined;
	/** Debris pieces by kind for the current floor's biome (resolved on each new layout). */
	private readonly debrisArt = new Array<ReadonlyArray<DecorPiece>>();
	private dungeon: Dungeon | undefined;
	private lastSimSec: number | undefined;
	private shown = false;
	/** The pack's `decor.fx.loot` (else `decor.fx.glint`) and its layout (undefined: no glint on loaded pieces). */
	private glintArt: DecorPiece | undefined;
	private glintLayout: SpriteLayout | undefined;
	/** Loaded intact pieces' glints by slot, and the pool. */
	private readonly glints = new Map<number, LootGlint>();
	private readonly freeGlints = new Array<LootGlint>();
	/** KV_LootDebug's labels by slot (their anchor Parts), and whether it is on. */
	private readonly lootLabels = new Map<number, Part>();
	private lootDebug = false;
	/** docs/SILVER.md SV8: KV_SilverLabel labels the intact Silver pieces with their stacks (in lootLabels too). */
	private silverDebug = false;
	private readonly slotScratch = new Array<number>();
	/** The readiness flips this view has not handled yet (docs/STAGE_ASSETS.md SA18). */
	private cursor: ReadinessCursor | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
		private readonly sprites: FxSpriteController,
		private readonly preload: PreloadController,
	) {
		const r = this.basis.right;
		this.right = new Vector3(r[0], r[1], r[2]);
	}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		const folder = new Instance("Folder");
		folder.Name = BREAKABLE_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		this.cursor = new ReadinessCursor(this.preload.getReadiness());
		for (let k = 0; k < BREAKABLE_KINDS.size(); k++) this.looks.push(this.lookFor(pack, k));
		this.glintArt =
			pack.decor(decorFxId(BREAKABLE_LOOT_VIEW.glintFx)) ??
			pack.decor(decorFxId(BREAKABLE_LOOT_VIEW.glintFallbackFx));
		this.glintLayout = this.glintArt !== undefined ? visualLayout(this.glintArt.art) : undefined;
		this.readLootDebug();
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(BREAKABLE_LOOT_VIEW.debugAttribute).Connect(() => this.readLootDebug()),
		);
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(SILVER_CRATE_FX.labelAttribute).Connect(() => this.readLootDebug()),
		);
		this.janitor.Add(Workspace.GetAttributeChangedSignal(RUN_ATTRIBUTES.debug).Connect(() => this.readLootDebug()));

		const reset = (ctx: RunContext) => {
			this.dungeon = ctx.dungeon;
			this.tracker.reset();
		};
		this.sim.onRunStarted(reset);
		this.sim.onFloorChanged(reset);
		this.sim.onRunExited(() => this.clear());
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
		this.janitor.Add(this.floorJanitor, "Cleanup");
		this.janitor.Add(() => this.destroyPools(), true);
	}

	private lookFor(pack: ThemePack, kind: number): KindLook {
		// a stand-in (the placeholder box) until the art has downloaded (docs/STAGE_ASSETS.md SA18)
		const full = pack.breakable(BREAKABLE_KINDS[kind]);
		const theme = lookWhenReady(full, this.preload.isArtReady(full.id));
		const flash = pack.color(BREAKABLE_VIEW.flashRole);
		const art = theme.art;
		if (art !== undefined && art.kind === "sprites") {
			const set = art.set;
			const shatter = set.animation(BREAKABLE_SHATTER_ANIMATION);
			const layout = breakableArtLayout(set);
			return {
				theme,
				art: true,
				set,
				image: undefined,
				layout,
				shatterSec: shatter !== undefined && !shatter.loop ? oneShotSec(shatter.frames, shatter.fps) : 0,
				flash,
				top: artPieceTop(layout),
			};
		}
		if (art !== undefined && art.kind === "image") {
			const layout: SpriteLayout = {
				frameW: art.size.X,
				frameH: art.size.Y,
				pivot: art.pivot,
				pixelsPerTile: art.pixelsPerTile,
			};
			const capped = breakableArtLayout(layout);
			return {
				theme,
				art: true,
				set: undefined,
				image: art,
				layout: capped,
				shatterSec: 0,
				flash,
				top: artPieceTop(capped),
			};
		}
		const top = boxPieceTop(breakableBoxStuds(theme.placeholder.size));
		return { theme, art: false, set: undefined, image: undefined, layout: undefined, shatterSec: 0, flash, top };
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			if (this.shown) this.clear();
			return;
		}
		const state = ctx.run.state;
		debug.profilebegin(BREAKABLE_VIEW.profileLabel);
		const simSec = (state.tick + this.sim.getAlpha()) / SIM_HZ;
		const dtSec = animDtSec(this.lastSimSec, simSec);
		this.lastSimSec = simSec;
		const t = this.tracker;
		this.swapLooks();
		if (t.update(state.breakables, state.tick)) {
			this.rebuild(ctx.dungeon ?? this.dungeon);
		} else {
			for (const slot of t.restored) this.restore(slot);
			for (const slot of t.broken) this.breakPiece(slot, simSec, state.tick);
			for (const slot of t.hits) this.hitPiece(slot, simSec, state.tick);
		}
		const motion = motionScale(this.fx.settings());
		for (const view of this.active) this.animate(view, simSec, dtSec, motion);
		for (const view of this.idling) {
			if (!this.active.has(view)) view.body?.sprite?.update(IDLE, 0, 0, this.basis, dtSec);
		}
		this.syncLoot(state, simSec, motion);
		this.flushMoves();
		debug.profileend();
	}

	/** Every move of this frame in one BulkMoveTo. */
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

	// --- layout ----------------------------------------------------------------------------------

	/** A new layout: every view rebuilt from the tracker's copy, no effects (broken pieces show their debris). */
	private rebuild(dungeon: Dungeon | undefined): void {
		this.clearViews();
		this.resolveDebris(dungeon);
		const t = this.tracker;
		for (let slot = 0; slot < t.count(); slot++) {
			// An inert piece: a chest (docs/TREASURE.md TR7: TreasureRenderController draws a vault's, SecretRenderController
			// a secret room's) or a secret's crack (docs/SECRET_ROOMS.md SR7: SecretRenderController); no view here (so no
			// hit, break, glint or debris either).
			if (isInertPieceKind(t.kindAt(slot))) continue;
			const [x, y, z] = breakableBaseStuds(t.cellX(slot), t.cellY(slot));
			const view: PieceView = {
				slot,
				kind: t.kindAt(slot),
				cellX: t.cellX(slot),
				cellY: t.cellY(slot),
				rest: new CFrame(x, y, z),
				body: undefined,
				hitSec: NEVER,
				shatterEnd: undefined,
				debris: undefined,
			};
			this.views[slot] = view;
			if (t.isIntact(slot)) this.attach(view);
			else this.layDebris(view);
		}
		this.shown = t.count() > 0;
	}

	/** Run over (left / exited) or no run: everything parked, debris gone; the next run starts a new layout. */
	private clear(): void {
		this.clearViews();
		this.flushMoves();
		this.tracker.reset();
		this.lastSimSec = undefined;
		this.shown = false;
	}

	/** Every view's body back to its pool (parked), every debris decal destroyed (the floor's Janitor). */
	private clearViews(): void {
		this.releaseLoot();
		for (let slot = 0; slot < this.views.size(); slot++) {
			const view = this.views[slot];
			if (view !== undefined && view.body !== undefined) this.release(view);
		}
		this.views.clear();
		this.active.clear();
		this.idling.clear();
		this.floorJanitor.Cleanup();
	}

	/** The current floor's debris art per kind (its biome's decor brokenBarrel / brokenCrate variants). */
	private resolveDebris(dungeon: Dungeon | undefined): void {
		this.debrisArt.clear();
		const pack = this.pack!;
		const key = dungeon?.params.themeKey;
		const biome = key !== undefined ? BIOMES.find((b) => b.forgeTheme === key) : undefined;
		for (let k = 0; k < BREAKABLE_KINDS.size(); k++) {
			const name = breakableKindName(k);
			this.debrisArt.push(
				biome !== undefined && name !== undefined
					? pack.decorVariants(biome.id as BiomeId, BREAKABLE_DEBRIS[name])
					: [],
			);
		}
	}

	// --- piece changes ---------------------------------------------------------------------------

	private hitPiece(slot: number, simSec: number, tick: number): void {
		const view = this.views[slot];
		if (view === undefined || view.body === undefined) return;
		view.hitSec = simSec;
		this.active.add(view);
		if (BREAKABLE_VIEW.hitSparks) {
			this.particles.breakableHitSparks(
				gridToWorld(view.cellX),
				gridToWorld(view.cellY),
				burstSeed(slot, tick, BREAKABLE_VIEW.hitSeedSalt),
			);
		}
	}

	private breakPiece(slot: number, simSec: number, tick: number): void {
		const view = this.views[slot];
		if (view === undefined) return;
		this.particles.breakableChips(
			gridToWorld(view.cellX),
			gridToWorld(view.cellY),
			view.kind,
			burstSeed(slot, tick, BREAKABLE_VIEW.chipSeedSalt),
		);
		this.sprites.breakableSplinter(gridToWorld(view.cellX), gridToWorld(view.cellY));
		view.hitSec = NEVER;
		const look = this.looks[view.kind];
		const sprite = view.body?.sprite;
		if (sprite !== undefined && look !== undefined && look.shatterSec > 0) {
			// The one-shot plays from frame 0 at the rest spot, untinted; the body is released when it ends.
			view.shatterEnd = simSec + look.shatterSec;
			this.setFlash(view.body!, false);
			this.moves.set(sprite.anchor, view.rest);
			sprite.update(SHATTER, 0, 0, this.basis, 0);
			this.idling.delete(view);
			this.active.add(view);
			return;
		}
		if (view.body !== undefined) this.release(view);
		this.layDebris(view);
	}

	/** Broken -> intact without a new layout (not a play path): debris removed, a body again, no effects. */
	private restore(slot: number): void {
		const view = this.views[slot];
		if (view === undefined) return;
		view.hitSec = NEVER;
		view.shatterEnd = undefined;
		this.active.delete(view);
		if (view.debris !== undefined) {
			// The floor's Janitor still lists it; destroying an Instance twice is harmless.
			view.debris.Destroy();
			view.debris = undefined;
		}
		if (view.body === undefined) this.attach(view);
		else {
			const body = view.body;
			this.setFlash(body, false);
			this.place(body, view.rest);
			// caught mid-shatter: back to the idle loop (else it keeps the shatter frame), clocked with the idlers
			if (body.sprite !== undefined) {
				body.sprite.update(IDLE, 0, 0, this.basis, 0);
				this.idling.add(view);
			}
		}
	}

	/** One frame of a hit look or a shatter; settles the view (rest pose, no tint) when both are over. */
	private animate(view: PieceView, simSec: number, dtSec: number, motion: number): void {
		const body = view.body;
		if (body === undefined) {
			this.active.delete(view);
			return;
		}
		if (view.shatterEnd !== undefined) {
			if (simSec >= view.shatterEnd) {
				view.shatterEnd = undefined;
				this.active.delete(view);
				this.release(view);
				this.layDebris(view);
				return;
			}
			body.sprite?.update(SHATTER, 0, 0, this.basis, dtSec);
			return;
		}
		const age = simSec - view.hitSec;
		if (!breakableHitActive(age)) {
			view.hitSec = NEVER;
			this.active.delete(view);
			this.setFlash(body, false);
			this.place(body, view.rest);
			return;
		}
		this.setFlash(body, breakableHitFlash(age));
		const shake = breakableShakeStuds(age, motion);
		this.place(body, shake !== 0 ? view.rest.add(this.right.mul(shake)) : view.rest);
		body.sprite?.update(IDLE, 0, 0, this.basis, dtSec);
	}

	// --- bodies ----------------------------------------------------------------------------------

	/** Gives an intact view a body (pooled) at its rest spot. */
	private attach(view: PieceView): void {
		const body = this.acquire(view.kind);
		view.body = body;
		this.setFlash(body, false);
		this.place(body, view.rest);
		if (body.sprite !== undefined) {
			body.sprite.update(IDLE, 0, 0, this.basis, 0);
			this.idling.add(view);
		}
	}

	/**
	 * docs/STAGE_ASSETS.md SA18: a kind whose art readiness flipped gets its look again, and every intact piece of it a
	 * new body in that look (a piece mid-shatter keeps its body until the shatter ends); pooled bodies of the old look
	 * are discarded as they are met (acquire).
	 */
	private swapLooks(): void {
		const flipped = this.cursor?.take();
		if (flipped === undefined || flipped.size() === 0) return;
		const pack = this.pack!;
		for (let k = 0; k < BREAKABLE_KINDS.size(); k++) {
			if (!flipped.includes(pack.breakable(BREAKABLE_KINDS[k]).id)) continue;
			const look = this.lookFor(pack, k);
			this.looks[k] = look;
			// by slot index (a chest's slot holds no view: `for of` would stop at the hole)
			for (let slot = 0; slot < this.tracker.count(); slot++) {
				const view = this.views[slot];
				if (view === undefined || view.kind !== k || view.body === undefined) continue;
				if (view.body.art === look.art || view.shatterEnd !== undefined) continue;
				this.releaseGlint(view.slot); // its glint sits on the drawn top: re-attached by syncLoot
				this.release(view);
				this.attach(view);
			}
		}
	}

	private acquire(kind: number): PieceBody {
		const want = (this.looks[kind] ?? this.looks[0]).art;
		const list = this.free.get(kind);
		let pooled = list?.pop();
		while (pooled !== undefined && pooled.art !== want) {
			this.discard(pooled);
			pooled = list?.pop();
		}
		if (pooled !== undefined) {
			if (pooled.sprite !== undefined) pooled.sprite.reset();
			if (pooled.image !== undefined) pooled.image.gui.Enabled = true;
			if (pooled.model !== undefined) setModelTransparency(pooled.model, 0);
			return pooled;
		}
		return this.build(kind);
	}

	private build(kind: number): PieceBody {
		const pack = this.pack!;
		const folder = this.folder!;
		const look = this.looks[kind] ?? this.looks[0];
		if (look.set !== undefined) {
			const sprite = new SpriteView(look.set, folder, look.layout);
			return { kind, art: true, model: undefined, sprite, image: undefined, flashed: false };
		}
		if (look.image !== undefined && look.layout !== undefined) {
			return {
				kind,
				art: true,
				model: undefined,
				sprite: undefined,
				image: buildImage(look.image, look.layout, folder),
				flashed: false,
			};
		}
		const visual = look.theme.placeholder;
		const capped = { ...visual, size: breakableBoxStuds(visual.size) };
		const model = buildPlaceholder(pack, look.theme.id, capped, 1, folder, true);
		return { kind, art: false, model, sprite: undefined, image: undefined, flashed: false };
	}

	/** A pooled body of a look no longer drawn: its parts leave this frame's moves, then it is destroyed. */
	private discard(body: PieceBody): void {
		if (body.model !== undefined) {
			for (const piece of body.model.pieces) this.moves.delete(piece.part);
			destroyModel(body.model);
		}
		if (body.sprite !== undefined) {
			this.moves.delete(body.sprite.anchor);
			body.sprite.destroy();
		}
		if (body.image !== undefined) {
			this.moves.delete(body.image.anchor);
			body.image.anchor.Destroy();
		}
	}

	/** The view's body back to its kind's pool, parked. */
	private release(view: PieceView): void {
		const body = view.body;
		if (body === undefined) return;
		view.body = undefined;
		this.idling.delete(view);
		this.setFlash(body, false);
		if (body.sprite !== undefined) body.sprite.park();
		if (body.image !== undefined) body.image.gui.Enabled = false;
		this.place(body, PARKED);
		const list = this.free.get(body.kind);
		if (list !== undefined) list.push(body);
		else this.free.set(body.kind, [body]);
	}

	private place(body: PieceBody, origin: CFrame): void {
		if (body.model !== undefined) {
			for (const piece of body.model.pieces) this.moves.set(piece.part, origin.mul(piece.offset));
		}
		if (body.sprite !== undefined) this.moves.set(body.sprite.anchor, origin);
		if (body.image !== undefined) this.moves.set(body.image.anchor, origin);
	}

	/** The hit blink: the flash colour on (Part colour / ImageColor3), or the body's own look. Written on change. */
	private setFlash(body: PieceBody, on: boolean): void {
		if (body.flashed === on) return;
		body.flashed = on;
		const flash = (this.looks[body.kind] ?? this.looks[0]).flash;
		if (body.model !== undefined) setModelColor(body.model, on ? flash : body.model.baseColor);
		if (body.sprite !== undefined) body.sprite.setTint(on ? flash : SPRITE_TINT_NONE);
		if (body.image !== undefined) body.image.label.ImageColor3 = on ? flash : SPRITE_TINT_NONE;
	}

	// --- loot (docs/BREAKABLE_DROPS.md BL6) ------------------------------------------------------------

	/** Slot `slot` is an intact piece of the layout drawn whose slot holds a boost (KV_LootDebug's labels). */
	private loaded(state: Readonly<SimState>, slot: number): boolean {
		return (
			this.views[slot] !== undefined && this.tracker.isIntact(slot) && breakableLootAt(state, slot) !== NO_BOOST
		);
	}

	/** Slot `slot` is an intact piece of the layout drawn whose slot holds Silver (KV_SilverLabel's labels). */
	private silvered(state: Readonly<SimState>, slot: number): boolean {
		return this.views[slot] !== undefined && this.tracker.isIntact(slot) && silverPieceAt(state, slot) > 0;
	}

	/** Slot `slot` wears a debug label: KV_LootDebug's on a loaded piece, KV_SilverLabel's on a Silver piece. */
	private labelled(state: Readonly<SimState>, slot: number): boolean {
		return (this.lootDebug && this.loaded(state, slot)) || (this.silverDebug && this.silvered(state, slot));
	}

	/**
	 * Slot `slot` is an intact piece of the layout drawn that glints: a loaded piece or the Goldling's hiding place
	 * (shared/view pieceGlints, docs/GOLDLING_RUMOURS.md GR4).
	 */
	private glinting(state: Readonly<SimState>, slot: number): boolean {
		return this.views[slot] !== undefined && this.tracker.isIntact(slot) && pieceGlints(state, slot);
	}

	/**
	 * One frame of the loot hints: glints follow the glinting intact pieces (loaded ones and the Goldling's hiding
	 * place), KV_LootDebug labels the loaded ones, then every glint steps its cadence (hidden between passes and near an
	 * enemy bullet). Nothing while no piece can glint and nothing is shown.
	 */
	private syncLoot(state: Readonly<SimState>, simSec: number, motion: number): void {
		const n = glintSlotCount(state);
		if (n === 0 && this.glints.size() === 0 && this.lootLabels.size() === 0) return;
		const gone = this.slotScratch;
		gone.clear();
		for (const [slot] of this.glints) if (!this.glinting(state, slot)) gone.push(slot);
		for (const slot of gone) this.releaseGlint(slot);
		gone.clear();
		for (const [slot] of this.lootLabels) if (!this.labelled(state, slot)) gone.push(slot);
		for (const slot of gone) this.removeLabel(slot);
		gone.clear();
		if (this.glintArt !== undefined || this.lootDebug || this.silverDebug) {
			for (let slot = 0; slot < n; slot++) {
				if (this.glintArt !== undefined && !this.glints.has(slot) && this.glinting(state, slot))
					this.attachGlint(slot);
				if (!this.lootLabels.has(slot) && this.labelled(state, slot)) {
					const loot = breakableLootAt(state, slot);
					this.addLabel(
						slot,
						loot !== NO_BOOST ? lootDebugText(loot) : silverDebugText(silverPieceAt(state, slot)),
					);
				}
			}
		}
		if (this.glints.size() === 0) return;
		const bullets = state.combat.enemyBullets;
		const shown = lootGlintTransparency(motion);
		for (const [, g] of this.glints) {
			const glint = g.glint;
			const frame = lootGlintFrame(simSec, g.phaseSec, glint.fps, glint.frames, motion);
			if (frame === LOOT_GLINT_HIDDEN || lootGlintDucked(g.x, g.z, bullets)) {
				setGlintTransparency(glint, HIDDEN);
				continue;
			}
			setGlintFrame(glint, frame);
			setGlintTransparency(glint, shown);
		}
	}

	/** A loaded piece's glint (pooled), on its top, hidden until its cadence shows it. */
	private attachGlint(slot: number): void {
		const view = this.views[slot];
		const layout = this.glintLayout;
		if (view === undefined || layout === undefined) return;
		const g = this.freeGlints.pop() ?? this.buildLootGlint();
		if (g === undefined) return;
		const look = this.looks[view.kind] ?? this.looks[0];
		setGlintBoard(g.glint, lootGlintBillboard(look.top, layout));
		setGlintTransparency(g.glint, HIDDEN);
		g.glint.gui.Enabled = true;
		g.phaseSec = lootGlintPhaseSec(view.cellX, view.cellY);
		g.x = gridToWorld(view.cellX);
		g.z = gridToWorld(view.cellY);
		this.moves.set(g.anchor, view.rest);
		this.glints.set(slot, g);
	}

	private buildLootGlint(): LootGlint | undefined {
		const art = this.glintArt;
		if (art === undefined) return undefined;
		const anchor = renderPart("Part", false);
		anchor.Name = "LootGlint";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = PARKED;
		anchor.Parent = this.folder;
		const glint = buildGlint(art, anchor, EMPTY_BOARD, BREAKABLE_VIEW.idleAnimation);
		return { anchor, glint, phaseSec: 0, x: 0, z: 0 };
	}

	private releaseGlint(slot: number): void {
		const g = this.glints.get(slot);
		if (g === undefined) return;
		this.glints.delete(slot);
		setGlintTransparency(g.glint, HIDDEN);
		g.glint.gui.Enabled = false;
		this.moves.set(g.anchor, PARKED);
		this.freeGlints.push(g);
	}

	/** Every glint back to the pool and every debug label gone (new layout, run end, teardown). */
	private releaseLoot(): void {
		const slots = this.slotScratch;
		slots.clear();
		for (const [slot] of this.glints) slots.push(slot);
		for (const slot of slots) this.releaseGlint(slot);
		slots.clear();
		for (const [slot] of this.lootLabels) slots.push(slot);
		for (const slot of slots) this.removeLabel(slot);
		slots.clear();
	}

	/** KV_LootDebug: on in Studio or with KV_Debug, while the Workspace attribute is true. */
	private readLootDebug(): void {
		const allowed = RunService.IsStudio() || Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.lootDebug = allowed && Workspace.GetAttribute(BREAKABLE_LOOT_VIEW.debugAttribute) === true;
		this.silverDebug = allowed && Workspace.GetAttribute(SILVER_CRATE_FX.labelAttribute) === true;
	}

	/** A debug label `text` over slot `slot`'s piece (its boost, or its Silver: developer English, AutoLocalize off). */
	private addLabel(slot: number, text: string): void {
		const view = this.views[slot];
		if (view === undefined) return;
		const v = BREAKABLE_LOOT_VIEW;
		const anchor = renderPart("Part", false);
		anchor.Name = "LootDebug";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = view.rest;
		const gui = createKvBillboardGui("LootDebug");
		gui.Size = UDim2.fromOffset(v.debugWidthPx, v.debugHeightPx);
		gui.StudsOffsetWorldSpace = new Vector3(0, v.debugLiftStuds, 0);
		gui.AlwaysOnTop = true;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = DEV_MONO_FONT;
		label.TextSize = v.debugTextSize;
		label.TextColor3 = this.pack!.color(v.debugRole);
		label.TextStrokeTransparency = 0;
		label.Text = text;
		label.Parent = gui;
		gui.Parent = anchor;
		anchor.Parent = this.folder;
		this.lootLabels.set(slot, anchor);
	}

	private removeLabel(slot: number): void {
		const anchor = this.lootLabels.get(slot);
		if (anchor === undefined) return;
		this.lootLabels.delete(slot);
		anchor.Destroy();
	}

	// --- debris ----------------------------------------------------------------------------------

	/** The flat decal a broken piece leaves (its biome's variant by cell hash), or nothing without art. */
	private layDebris(view: PieceView): void {
		if (view.debris !== undefined) return;
		const variants = this.debrisArt[view.kind];
		if (variants === undefined) return;
		const i = debrisVariant(view.cellX, view.cellY, variants.size());
		const piece = i >= 0 ? variants[i] : undefined;
		if (piece === undefined) return;
		const part = buildDebris(piece, view.rest.Position, this.folder!);
		if (part === undefined) return;
		view.debris = this.floorJanitor.Add(part);
	}

	private destroyPools(): void {
		this.releaseLoot();
		for (const g of this.freeGlints) g.anchor.Destroy();
		this.freeGlints.clear();
		for (const [, list] of this.free) for (const body of list) this.discard(body);
		this.free.clear();
	}
}

/** An upright image billboard for image art: the region on an invisible anchor, its pivot on the anchor. */
function buildImage(art: WorldImage, layout: SpriteLayout, parent: Instance): ImageBody {
	const anchor = renderPart("Part", false);
	anchor.Name = "BreakableImage";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = PARKED;
	const b = spriteBillboard(layout);
	const gui = createKvBillboardGui("Breakable");
	gui.Size = new UDim2(b.w, 0, b.h, 0);
	gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
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
	label.ImageColor3 = SPRITE_TINT_NONE;
	label.Parent = gui;
	gui.Parent = anchor;
	anchor.Parent = parent;
	return { anchor, gui, label };
}

/**
 * A decor piece laid flat on the floor at `at` (a cell centre): an invisible Part as thin as
 * BREAKABLE_VIEW.debrisThicknessStuds, turned by the camera yaw, with a top-face SurfaceGui showing the image region
 * (a Decal cannot crop an atlas region). Sized like the co-op ring (floorImageSize: depth stretched by 1 / sin(pitch))
 * with the art's pivot on the cell centre (floorImageOffset).
 */
function buildDebris(piece: DecorPiece, at: Vector3, parent: Instance): BasePart | undefined {
	const art = piece.art;
	let image: string;
	let offset: Vector2;
	let size: Vector2;
	let pixelsPerTile: number;
	let pivot: Readonly<Pivot>;
	let resample: Enum.ResamplerMode = Enum.ResamplerMode.Default;
	if (art.kind === "image") {
		image = art.image;
		offset = art.offset;
		size = art.size;
		pixelsPerTile = art.pixelsPerTile;
		pivot = art.pivot;
	} else {
		const set = art.set;
		const anim = set.has(BREAKABLE_VIEW.idleAnimation) ? BREAKABLE_VIEW.idleAnimation : set.animationNames[0];
		if (anim === undefined) return undefined;
		const f = set.frame(anim, 0, 0);
		image = f.image;
		offset = f.offset;
		size = f.size;
		pixelsPerTile = set.pixelsPerTile;
		pivot = set.pivot;
		resample = Enum.ResamplerMode[set.resample];
	}
	const [w, d] = floorImageSize(size.X, size.Y, pixelsPerTile);
	const [ox, oz] = floorImageOffset(size.X, size.Y, pixelsPerTile, pivot);
	const v = BREAKABLE_VIEW;
	const part = renderPart("Part", false);
	part.Name = piece.id;
	part.Transparency = HIDDEN;
	part.Size = floorCanvasPartSize(w, v.debrisThicknessStuds, d);
	part.CFrame = new CFrame(at.X, at.Y + v.debrisLiftStuds - v.debrisThicknessStuds / 2, at.Z)
		.mul(CAMERA_YAW)
		.mul(new CFrame(ox, 0, oz))
		.mul(FLOOR_CANVAS_TURN);
	const gui = createKvSurfaceGui("Debris");
	gui.Face = Enum.NormalId.Top;
	gui.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
	gui.CanvasSize = size;
	gui.LightInfluence = 1;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	const label = new Instance("ImageLabel");
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.Image = image;
	label.ImageRectOffset = offset;
	label.ImageRectSize = size;
	label.ResampleMode = resample;
	label.Parent = gui;
	gui.Parent = part;
	part.Parent = parent;
	return part;
}
