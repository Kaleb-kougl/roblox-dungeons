import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { DEV_MONO_FONT, createKvBillboardGui, createKvSurfaceGui, currentHudFont, onLocaleChanged } from "client/ui";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { charCount } from "shared/l10n";
import { RUN_ATTRIBUTES } from "shared/play";
import type { JuiceSettings } from "shared/settings";
import { SIM_HZ, TILE_SIZE, VaultStatus, partySize, type SimState } from "shared/sim";
import {
	TREASURE_CAGE_ID,
	TREASURE_CHEST_ID,
	TREASURE_CHEST_OPEN_ID,
	TREASURE_COLUMN_FX_ID,
	decorFxId,
	isFxId,
	treasureFloorRole,
	treasureUiRole,
	type DecorPiece,
	type FxSprite,
	type ThemePack,
	type TreasurePiece,
	type WorldImage,
} from "shared/theme";
import {
	BREAKABLE_LOOT_VIEW,
	BULLET_VIEW,
	RENDER_ORDER,
	SPRITE_VIEW,
	animDtSec,
	artPieceTop,
	boxPieceTop,
	breakableArtLayout,
	degToRad,
	floorStudsY,
	isoBasis,
	lootGlintBillboard,
	lootGlintDucked,
	spriteBillboard,
	studsX,
	studsZ,
	type PieceTop,
	type SpriteAnimChoice,
	type SpriteBillboard,
	type SpriteLayout,
} from "shared/view";
import { FX_SPRITE_VIEW, FX_VIEW, SCORE_POP_GLYPH_PX, burstSeed, effectiveParticles } from "shared/view/fx";
import {
	COMBO_SHOUT_DRAW,
	ShoutDuck,
	comboShardAt,
	floorAxes,
	shoutDucked,
	type ComboShardLook,
} from "shared/view/hud";
import {
	TREASURE_VIEW,
	TreasureViewTracker,
	cageBarOffsets,
	countdownAt,
	floorTextBoxAt,
	floorTextCanvas,
	forwardPoint,
	lockPlateText,
	openLineText,
	pipCentres,
	platePips,
	rewardCardAt,
	openLineAt,
	rewardCardTexts,
	sparkleStarTransparency,
	tierNameText,
	treasureDebugText,
	treasureSparkleFrame,
	unlockLineText,
	vaultHits,
	SPARKLE_HIDDEN,
	type CardLook,
	type CountdownLook,
	type FloorTextBox,
	type RewardCardText,
	type TreasureLook,
	type TreasureOpenedEvent,
} from "shared/view/treasure";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FreezeFrameController } from "../fx/FreezeFrameController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { FLOOR_CANVAS_YAW, floorCanvasPartSize } from "./floorCanvas";
import { ParticleController } from "../fx/ParticleController";
import { attachmentHolder, floorPoint } from "../fx/fxHelpers";
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

const V = TREASURE_VIEW;
const HIDDEN = 1;
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const AXES = floorAxes();
const CENTRE = new Vector2(0.5, 0.5);
const WHITE = new Color3(1, 1, 1);
const IDLE: SpriteAnimChoice = { anim: "idle", rate: 1 };
/** The Diamond star: a cube turned an eighth of a turn about Y, then about its own Z. */
const EIGHTH_TURN = math.pi / 4;
const STAR_TURN = CFrame.Angles(0, EIGHTH_TURN, 0).mul(CFrame.Angles(0, 0, EIGHTH_TURN));
/** Most pips the plate shows (a full party: allowance 7, plus the cracking pip). */
const MAX_PIPS = 8;
/** Reward cards at most (relic / draft / boosts / points). */
const MAX_CARDS = 4;
/** The plate's lock name takes this share of its height (the pips or the countdown the rest). */
const PLATE_LABEL_SHARE = 0.42;
/** A shard is this share of the plate's height. */
const SHARD_HEIGHT_SHARE = 0.35;

/** A drawn piece (the closed / open chest, an art cage): exactly one of model / sprite / image. */
interface PieceBody {
	readonly model: PlaceholderModel | undefined;
	readonly sprite: SpriteView | undefined;
	readonly image: ImageBody | undefined;
	/** Its drawn top (the sparkle's place). */
	readonly top: PieceTop;
	/** Its drawn height, studs (the cage's sink). */
	readonly heightStuds: number;
	shown: boolean;
	transparency: number;
}

interface ImageBody {
	readonly anchor: Part;
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
}

/** A floor text (the plate, a line): a thin invisible Part with a Top-face SurfaceGui, on the combo shout's layer. */
interface FloorText {
	readonly part: Part;
	readonly surface: SurfaceGui;
	readonly duck: ShoutDuck;
	readonly box: FloorTextBox;
	readonly canvas: readonly [number, number];
	visible: boolean;
}

interface Plate extends FloorText {
	readonly label: TextLabel;
	readonly clock: TextLabel;
	readonly pips: Frame[];
	readonly pipStrokes: UIStroke[];
	readonly shards: Frame[];
}

interface Line extends FloorText {
	readonly label: TextLabel;
	text: string;
}

/** A billboard text over the chest (a reward card, the near-miss / kept line). */
interface CardView {
	readonly att: Attachment;
	readonly gui: BillboardGui;
	readonly label: TextLabel;
	shown: boolean;
	text: string;
}

interface Column {
	readonly part: Part;
	readonly anchor: Part;
	readonly gui: BillboardGui | undefined;
	readonly label: ImageLabel | undefined;
}

/**
 * A vault on screen (docs/TREASURE.md TR7, Design §4; the pure half is shared/view/treasure). Once per rendered frame
 * (after the camera) the pure TreasureViewTracker turns `state.treasure` and the run view's vault events
 * (`RunView.treasure`, collected per tick) into one TreasureLook on sim time (pause and hitstop hold it); this draws it:
 *   chest     the closed chest (`treasure.chest`) or, from the pop on, the open one (`treasure.chestopen`), on the
 *             chest piece's cell (BreakableRenderController skips that slot): art (a sprite set's idle, an image
 *             billboard, both capped at TREASURE_VIEW.maxHeightTiles) or the placeholder turned to face into the room.
 *             The lid jolts before the pop and the unlocked chest wobbles (placeholder: a roll about its base; image
 *             art: the label's rotation; sprites: no wobble).
 *   cage      over the closed chest until the unlock: the placeholder's one bar repeated round the chest's footprint
 *             (cageBarOffsets, its `dash` spacing), or the art as a billboard turned like the chest, capped at
 *             cageMaxHeightTiles and cageDepthStuds nearer the camera so it draws over the chest. It sinks into the
 *             floor (reduced motion: fades) unlock.delaySec after the clear.
 *   sparkle   the BL glint art (`decor.fx.loot`, else `decor.fx.glint`) on the chest's top, tinted by the tier's floor
 *             role (white on the crack's flash), Legendary bigger and faster, faster again once unlocked; a still star
 *             under reduced motion or Particles off; a self-lit diamond without art. Hidden near an enemy bullet
 *             (lootGlintDucked) and once open.
 *   plate     the lock plate (ARMED; a kept lock's fades with the bars): a floor SurfaceGui on the combo shout's
 *             construction and layer, the lock's name over pips (UNTOUCHED) or the countdown (SWIFT: ember in the last
 *             10 s, a 1 Hz pulse in the last 5 s; colour only under reduced motion), at most plate.maxOpacity and
 *             ducking (ShoutDuck + shoutDucked over the enemy bullet pool). The crack shatters it: comboShardAt's
 *             shards in the lost tier's floor colour.
 *   lines     one floor text: the crack's new tier name rising, or the unlock's kept line (same construction, ducks).
 *   the pop   once (TreasureLook.popEdge): the solo freeze (TREASURE_VIEW.open.freezeMs on SimController's hitstop
 *             clock, which applies freezeFrameOn), the `stamp` nudge (FreezeFrameController.requestNudge: Screen
 *             shake), the ring burst (ParticleController.treasureBurst; nothing with Particles off), then the light
 *             column (`fx.treasure.column` upright and tinted when the pack has it, else a self-lit Neon block).
 *   cards     the view player's reward cards (rewardCardTexts: a spectator sees the watched player's) and the
 *             near-miss / kept line under them, BillboardGuis in the score pops' style, rising and fading.
 * Toasts, the minimap mark and every sound are TR8's (they read the same RunView.treasure). Debug: KV_TreasureLabel
 * (Workspace boolean, Studio or KV_Debug, off by default) labels the chest (treasureDebugText, developer English).
 * Bodies are built once and reused across floors and runs; nothing is built until a floor has a vault. Read-only on
 * the sim.
 */
@Controller({})
export class TreasureRenderController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly tracker = new TreasureViewTracker();
	private readonly basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
	private pack: ThemePack | undefined;
	private folder: Folder | undefined;
	private holder: Part | undefined;
	private built = false;
	private shown = false;
	private lastSimSec: number | undefined;
	// --- looks
	private chestLook: TreasurePiece | undefined;
	private openLook: TreasurePiece | undefined;
	private cageLook: TreasurePiece | undefined;
	private glintArt: DecorPiece | undefined;
	private glintLayout: SpriteLayout | undefined;
	private columnFx: FxSprite | undefined;
	private readonly floorColors = new Array<Color3>();
	private readonly uiColors = new Array<Color3>();
	// --- bodies
	private closed: PieceBody | undefined;
	private opened: PieceBody | undefined;
	private cageArt: PieceBody | undefined;
	private readonly bars = new Array<PlaceholderModel>();
	private barOffsets = new Array<readonly [number, number]>();
	private barHeight = 0;
	/** Where the bars were last placed (undefined: parked), how far sunk and faded. */
	private barsAt: CFrame | undefined;
	private barsDown = 0;
	private barsFade = 0;
	private glintAnchor: Part | undefined;
	private glint: Glint | undefined;
	private glintTint: Color3 | undefined;
	private glintBoardSize = -1;
	private star: Part | undefined;
	private plate: Plate | undefined;
	private line: Line | undefined;
	private column: Column | undefined;
	private readonly cards = new Array<CardView>();
	private openLine: CardView | undefined;
	private debugLabel: { anchor: Part; label: TextLabel } | undefined;
	private debugOn = false;
	// --- per open: the texts drawn (rebuilt when the open or the view player changes)
	private cardsFor: TreasureOpenedEvent | undefined;
	private cardsPlayer = -1;
	private cardTexts: RewardCardText[] = [];
	private lineText: string | undefined;
	private relabel = false;
	private readonly cardLook: CardLook = { alpha: 0, riseTiles: 0 };
	private readonly countdown: CountdownLook = { warn: false, pulse: 1 };
	private readonly shard: ComboShardLook = { xScale: 0, dxPx: 0, dyPx: 0, rotationDeg: 0, transparency: 0 };

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
		private readonly freeze: FreezeFrameController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		const folder = new Instance("Folder");
		folder.Name = V.folderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		this.holder = attachmentHolder(folder, "Anchors");
		const reset = () => this.tracker.reset();
		this.sim.onRunStarted(reset);
		this.sim.onFloorChanged(reset);
		this.sim.onRunExited(() => this.clear());
		this.readDebug();
		this.janitor.Add(Workspace.GetAttributeChangedSignal(V.debugAttribute).Connect(() => this.readDebug()));
		this.janitor.Add(Workspace.GetAttributeChangedSignal(RUN_ATTRIBUTES.debug).Connect(() => this.readDebug()));
		this.janitor.Add(onLocaleChanged(() => this.onLocale()));
		RunService.BindToRenderStep(
			V.renderStep,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(V.renderStep), true);
		this.janitor.Add(() => this.destroyBodies(), true);
	}

	// --- the frame -------------------------------------------------------------------------------------

	private frame(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			if (this.shown) this.clear();
			return;
		}
		const state = ctx.run.state;
		if (state.treasure === undefined && !this.shown) return;
		debug.profilebegin(V.profileLabel);
		const simSec = (state.tick + this.sim.getAlpha()) / SIM_HZ;
		const dtSec = animDtSec(this.lastSimSec, simSec);
		this.lastSimSec = simSec;
		const settings = this.fx.settings();
		const particles = effectiveParticles(settings) !== "off";
		const look = this.tracker.update(state, ctx.run.treasure, simSec, {
			reducedMotion: settings.reducedMotion,
			particles,
		});
		if (!look.present) {
			if (this.shown) this.hideAll();
			debug.profileend();
			return;
		}
		this.build();
		if (look.fresh) this.hideTransients();
		this.shown = true;
		const rest = this.restFrame(look);
		this.drawChest(look, rest, dtSec);
		this.drawCage(look, rest);
		this.drawSparkle(look, state, rest, simSec);
		this.drawPlate(look, state, simSec, settings.reducedMotion, dtSec);
		this.drawLine(look, state, dtSec);
		if (look.popEdge) this.pop(look, state, settings);
		this.drawColumn(look, rest);
		this.drawCards(look, settings.reducedMotion);
		this.drawDebug(state);
		this.relabel = false;
		debug.profileend();
	}

	/** The chest's base on the floor at its centre, turned to face into its room. */
	private restFrame(look: TreasureLook): CFrame {
		const at = new Vector3(studsX(look.x), floorStudsY() + V.liftStuds, studsZ(look.z));
		if (look.fx === 0 && look.fz === 0) return new CFrame(at);
		return CFrame.lookAt(at, at.add(new Vector3(look.fx, 0, look.fz)));
	}

	// --- the chest -------------------------------------------------------------------------------------

	private drawChest(look: TreasureLook, rest: CFrame, dtSec: number): void {
		const show = look.open ? this.opened : this.closed;
		const hide = look.open ? this.closed : this.opened;
		if (hide !== undefined) this.hideBody(hide);
		if (show === undefined) return;
		let origin = rest;
		if (look.liftStuds !== 0) origin = origin.add(new Vector3(0, look.liftStuds, 0));
		const wobble = degToRad(look.wobbleDeg);
		if (show.model !== undefined && wobble !== 0) origin = origin.mul(CFrame.Angles(0, 0, wobble));
		this.placeBody(show, origin, dtSec, look.fx, look.fz);
		if (show.image !== undefined) show.image.label.Rotation = look.wobbleDeg;
	}

	private drawCage(look: TreasureLook, rest: CFrame): void {
		const cage = look.cage;
		const art = this.cageArt;
		if (!cage.shown) {
			if (art !== undefined) this.hideBody(art);
			this.parkBars();
			return;
		}
		const down = cage.sink * (art !== undefined ? art.heightStuds : this.barHeight);
		if (art !== undefined) {
			this.setBodyTransparency(art, cage.transparency);
			// turned like the chest (the vale cage has the chest's four facings: its bars are cut round that facing)
			this.placeBody(art, rest.add(new Vector3(0, -down, 0)), 0, look.fx, look.fz);
			return;
		}
		// Static bars are placed once; they move only while sinking or fading (or the vault moved).
		if (
			this.barsAt !== undefined &&
			this.barsAt === rest &&
			this.barsDown === down &&
			this.barsFade === cage.transparency
		)
			return;
		this.barsAt = rest;
		this.barsDown = down;
		this.barsFade = cage.transparency;
		for (let i = 0; i < this.bars.size(); i++) {
			const bar = this.bars[i];
			const [ox, oz] = this.barOffsets[i];
			const origin = rest.mul(new CFrame(ox, -down, oz));
			for (const piece of bar.pieces) piece.part.CFrame = origin.mul(piece.offset);
			setModelTransparency(bar, cage.transparency);
		}
	}

	// --- the sparkle -----------------------------------------------------------------------------------

	private drawSparkle(look: TreasureLook, state: Readonly<SimState>, rest: CFrame, simSec: number): void {
		const glint = this.glint;
		const star = this.star;
		const ducked =
			look.sparkleShown &&
			lootGlintDucked(look.x, look.z, state.combat.enemyBullets, V.sparkle.duckTiles * TILE_SIZE);
		const color = this.floorColors[look.sparkleTier].Lerp(WHITE, look.whiteMix);
		if (glint !== undefined && this.glintAnchor !== undefined) {
			const frame = look.sparkleShown
				? treasureSparkleFrame(
						simSec,
						look.sparkleEverySec,
						glint.fps,
						glint.frames,
						look.sparkleStill,
						BREAKABLE_LOOT_VIEW.glintStillFrame,
						BREAKABLE_LOOT_VIEW.glintFlashSeconds,
				  )
				: SPARKLE_HIDDEN;
			if (frame === SPARKLE_HIDDEN || ducked) {
				setGlintTransparency(glint, HIDDEN);
				return;
			}
			this.glintAnchor.CFrame = new CFrame(rest.Position);
			if (look.sparkleSize !== this.glintBoardSize) {
				this.glintBoardSize = look.sparkleSize;
				setGlintBoard(glint, this.sparkleBoard(look.sparkleSize));
			}
			if (this.glintTint !== color) {
				this.glintTint = color;
				glint.label.ImageColor3 = color;
			}
			setGlintFrame(glint, frame);
			setGlintTransparency(
				glint,
				look.sparkleStill ? BREAKABLE_LOOT_VIEW.reducedTransparency : BREAKABLE_LOOT_VIEW.glintTransparency,
			);
			return;
		}
		if (star === undefined) return;
		if (!look.sparkleShown || ducked) {
			star.Transparency = HIDDEN;
			return;
		}
		const top = this.closed?.top;
		const up = (top?.upStuds ?? 0) + V.sparkle.starLiftStuds;
		const s = V.sparkle.starStuds * look.sparkleSize;
		star.Size = new Vector3(s, s, s);
		star.Color = color;
		star.CFrame = new CFrame(rest.Position.add(new Vector3(0, up, 0))).mul(STAR_TURN);
		star.Transparency = sparkleStarTransparency(simSec, look.sparkleEverySec, look.sparkleStill);
	}

	/** The sparkle's billboard on the closed chest's top, x `size`. */
	private sparkleBoard(size: number): SpriteBillboard {
		const layout = this.glintLayout!;
		const top = this.closed?.top ?? { upStuds: 0, frontStuds: 0 };
		const b = lootGlintBillboard(top, layout);
		return { w: b.w * size, h: b.h * size, offsetX: b.offsetX, offsetY: b.offsetY, offsetZ: b.offsetZ };
	}

	// --- the plate and the floor line -------------------------------------------------------------------

	private drawPlate(
		look: TreasureLook,
		state: Readonly<SimState>,
		simSec: number,
		reduced: boolean,
		dtSec: number,
	): void {
		const plate = this.plate;
		const pack = this.pack;
		const t = state.treasure;
		if (plate === undefined || pack === undefined || t === undefined) return;
		if (!look.plateShown) {
			this.hideFloorText(plate);
			return;
		}
		const P = V.plate;
		const [cx, cz] = forwardPoint(look.x, look.z, look.fx, look.fz, P.forwardTiles);
		floorTextBoxAt(plate.box, cx, cz, AXES.rightX, AXES.rightZ, P.widthTiles, P.depthTiles);
		if (!plate.visible) plate.duck.reset();
		const ceiling = plate.duck.step(
			dtSec,
			shoutDucked(plate.box, state.combat.enemyBullets, P.duckMarginTiles * TILE_SIZE),
		);
		this.placeFloorText(plate, cx, cz);
		// The body: the lock's name over pips / the countdown.
		const s = (k: string, vars?: Readonly<Record<string, string | number>>) => pack.str(k, vars);
		const body = look.plateAlpha > 0 ? math.min(look.plateAlpha * P.maxOpacity, ceiling) : 0;
		const texts = lockPlateText(s, look.lock, t.ticksLeft);
		let pulse = 1;
		let labelColor = pack.color(V.plateRole);
		if (texts.clock !== undefined) {
			countdownAt(math.max(0, t.ticksLeft) / SIM_HZ, simSec, reduced, this.countdown);
			pulse = this.countdown.pulse;
			if (this.countdown.warn) labelColor = pack.color(V.warnRole);
		}
		setText(plate.label, texts.label, body, pack.color(V.plateRole));
		setText(plate.clock, texts.clock ?? "", texts.clock !== undefined ? body * pulse : 0, labelColor);
		const pips = texts.clock === undefined ? platePips(t.allowance, vaultHits(state)) : undefined;
		const centres = pips !== undefined ? pipCentres(pips.total, P.pipPx, P.pipGapPx, plate.canvas[0]) : [];
		const tierColor = this.floorColors[look.tier];
		for (let i = 0; i < plate.pips.size(); i++) {
			const pip = plate.pips[i];
			const stroke = plate.pipStrokes[i];
			if (pips === undefined || i >= pips.total || body <= 0) {
				pip.Visible = false;
				continue;
			}
			pip.Visible = true;
			pip.Position = new UDim2(centres[i], 0, (1 + PLATE_LABEL_SHARE) / 2, 0);
			const last = i === pips.total - 1;
			const spent = i < pips.spent;
			const fill = last ? 0 : spent ? body * (1 - P.spentTransparency) : body;
			pip.BackgroundColor3 = tierColor;
			pip.BackgroundTransparency = HIDDEN - fill;
			stroke.Color = tierColor;
			stroke.Transparency = HIDDEN - body;
		}
		// The shards (the crack), in the lost tier's colour.
		const u = look.shardU;
		const n = plate.shards.size();
		for (let i = 0; i < n; i++) {
			const f = plate.shards[i];
			if (u < 0) {
				f.Visible = false;
				continue;
			}
			const sh = comboShardAt(i, n, reduced ? 0 : u, this.shard);
			f.Visible = true;
			f.BackgroundColor3 = this.floorColors[look.shardTier];
			f.Position = new UDim2(sh.xScale, sh.dxPx * V.crack.shardPxScale, 0.5, sh.dyPx * V.crack.shardPxScale);
			f.Rotation = sh.rotationDeg;
			f.BackgroundTransparency = HIDDEN - math.min(P.maxOpacity, ceiling) * (1 - u);
		}
		this.showFloorText(plate);
	}

	private drawLine(look: TreasureLook, state: Readonly<SimState>, dtSec: number): void {
		const line = this.line;
		const pack = this.pack;
		const t = state.treasure;
		if (line === undefined || pack === undefined || t === undefined) return;
		if (look.lineKind === "none") {
			this.hideFloorText(line);
			return;
		}
		const L = V.line;
		const [fx, fz] = forwardPoint(look.x, look.z, look.fx, look.fz, L.forwardTiles);
		const rise = look.line.riseTiles;
		const cx = fx + AXES.upX * rise;
		const cz = fz + AXES.upZ * rise;
		floorTextBoxAt(line.box, cx, cz, AXES.rightX, AXES.rightZ, L.widthTiles, L.depthTiles);
		if (!line.visible) line.duck.reset();
		const ceiling = line.duck.step(
			dtSec,
			shoutDucked(line.box, state.combat.enemyBullets, V.plate.duckMarginTiles * TILE_SIZE),
		);
		const s = (k: string, vars?: Readonly<Record<string, string | number>>) => pack.str(k, vars);
		const text = look.lineKind === "tier" ? tierNameText(s, look.tier) : unlockLineText(s, look.lock, t.spare);
		if (text !== line.text || this.relabel) {
			line.text = text;
			line.label.Text = text;
		}
		const opacity = math.min(look.line.alpha * V.plate.maxOpacity, ceiling);
		setText(line.label, text, opacity, this.floorColors[look.tier]);
		this.placeFloorText(line, cx, cz);
		this.showFloorText(line);
	}

	private placeFloorText(f: FloorText, x: number, z: number): void {
		const F = FX_SPRITE_VIEW;
		const top = floorStudsY() + F.liftStuds - COMBO_SHOUT_DRAW.layerStepsBelowEffects * F.layerStepStuds;
		f.part.CFrame = new CFrame(studsX(x), top - F.thicknessStuds / 2, studsZ(z)).mul(FLOOR_CANVAS_YAW);
	}

	private showFloorText(f: FloorText): void {
		if (f.visible) return;
		f.visible = true;
		f.surface.Enabled = true;
	}

	private hideFloorText(f: FloorText): void {
		if (!f.visible) return;
		f.visible = false;
		f.surface.Enabled = false;
		f.part.CFrame = PARKED;
	}

	// --- the open --------------------------------------------------------------------------------------

	/** The lid popped (once): the solo freeze, the stamp nudge, the ring burst. */
	private pop(look: TreasureLook, state: Readonly<SimState>, settings: Readonly<JuiceSettings>): void {
		if (partySize(state) <= 1) this.sim.hitstop.request(V.open.freezeMs, settings);
		this.freeze.requestNudge("stamp");
		this.particles.treasureBurst(look.x, look.z, look.tier, burstSeed(look.lock, state.tick, V.open.seedSalt));
	}

	private drawColumn(look: TreasureLook, rest: CFrame): void {
		const col = this.column;
		if (col === undefined) return;
		const c = look.column;
		if (!c.shown) {
			col.part.Transparency = HIDDEN;
			col.part.CFrame = PARKED;
			if (col.gui !== undefined) col.gui.Enabled = false;
			return;
		}
		const C = V.open.column;
		const color = this.floorColors[look.tier];
		const h = C.heightTiles * STUDS_PER_TILE * c.height;
		const w = C.widthTiles * STUDS_PER_TILE;
		const fxArt = this.columnFx;
		if (fxArt !== undefined && col.gui !== undefined && col.label !== undefined) {
			col.anchor.CFrame = new CFrame(rest.Position);
			col.gui.Size = new UDim2(w, 0, h, 0);
			col.gui.StudsOffset = new Vector3(0, h / 2, 0);
			col.gui.Enabled = true;
			const frameIndex = fxArt.fps > 0 ? math.floor((look.openAge - V.open.popSec) * fxArt.fps) : 0;
			const f = fxArt.frame(math.max(0, frameIndex));
			col.label.Image = f.image;
			col.label.ImageRectOffset = f.offset;
			col.label.ImageRectSize = f.size;
			col.label.ImageColor3 = color;
			col.label.ImageTransparency = HIDDEN - c.opacity;
			return;
		}
		col.part.Size = new Vector3(w, math.max(h, FX_SPRITE_VIEW.thicknessStuds), w);
		col.part.Color = color.Lerp(WHITE, V.columnCoreMix);
		col.part.CFrame = new CFrame(rest.Position.add(new Vector3(0, h / 2, 0)));
		col.part.Transparency = HIDDEN - c.opacity;
	}

	private drawCards(look: TreasureLook, reduced: boolean): void {
		const pack = this.pack;
		const o = look.opened;
		if (pack === undefined || o === undefined) {
			this.hideCards();
			return;
		}
		const view = this.sim.getViewPlayerIndex();
		const s = (k: string, vars?: Readonly<Record<string, string | number>>) => pack.str(k, vars);
		if (o !== this.cardsFor || view !== this.cardsPlayer || this.relabel) {
			this.cardsFor = o;
			this.cardsPlayer = view;
			this.cardTexts = rewardCardTexts(s, o, view);
			this.lineText = openLineText(s, o);
			for (const c of this.cards) c.text = "";
			if (this.openLine !== undefined) this.openLine.text = "";
		}
		const O = V.open;
		const at = floorPoint(look.x, look.z);
		const n = math.min(this.cardTexts.size(), this.cards.size());
		for (let i = 0; i < this.cards.size(); i++) {
			const cardView = this.cards[i];
			if (i >= n) {
				hideCard(cardView);
				continue;
			}
			const card = this.cardTexts[i];
			rewardCardAt(look.openAge, i, reduced, this.cardLook);
			const color = card.kind === "points" ? pack.color(V.pointsRole) : this.uiColors[o.tier];
			const up = O.cardBaseStuds + (n - 1 - i) * O.cardRowStuds + this.cardLook.riseTiles * STUDS_PER_TILE;
			drawCard(cardView, at, card.text, O.cardScale, up, this.cardLook.alpha, color);
		}
		const line = this.openLine;
		if (line === undefined) return;
		const text = this.lineText;
		if (text === undefined) {
			hideCard(line);
			return;
		}
		openLineAt(look.openAge, reduced, this.cardLook);
		const color = o.kept !== 0 ? this.uiColors[o.tier] : pack.color(V.nearMissRole);
		const up = O.cardBaseStuds - O.cardRowStuds + this.cardLook.riseTiles * STUDS_PER_TILE;
		drawCard(line, at, text, O.lineScale, up, this.cardLook.alpha, color);
	}

	private hideCards(): void {
		for (const c of this.cards) hideCard(c);
		if (this.openLine !== undefined) hideCard(this.openLine);
		this.cardsFor = undefined;
	}

	// --- KV_TreasureLabel ------------------------------------------------------------------------------

	private readDebug(): void {
		const allowed = RunService.IsStudio() || Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.debugOn = allowed && Workspace.GetAttribute(V.debugAttribute) === true;
		if (!this.debugOn && this.debugLabel !== undefined) {
			this.debugLabel.anchor.Destroy();
			this.debugLabel = undefined;
		}
	}

	private drawDebug(state: Readonly<SimState>): void {
		const t = state.treasure;
		if (!this.debugOn || t === undefined || t.status === VaultStatus.NONE) {
			if (this.debugLabel !== undefined) this.debugLabel.anchor.CFrame = PARKED;
			return;
		}
		if (this.debugLabel === undefined) this.debugLabel = this.buildDebugLabel();
		const d = this.debugLabel;
		d.anchor.CFrame = new CFrame(studsX(t.x), floorStudsY(), studsZ(t.z));
		const text = treasureDebugText(t, vaultHits(state));
		if (d.label.Text !== text) d.label.Text = text;
	}

	private buildDebugLabel(): { anchor: Part; label: TextLabel } {
		const anchor = renderPart("Part", false);
		anchor.Name = "TreasureDebug";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = PARKED;
		const gui = createKvBillboardGui("TreasureDebug");
		gui.Size = UDim2.fromOffset(V.debugWidthPx, V.debugHeightPx);
		gui.StudsOffsetWorldSpace = new Vector3(0, V.debugLiftStuds, 0);
		gui.AlwaysOnTop = true;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = DEV_MONO_FONT;
		label.TextSize = V.debugTextSize;
		label.TextColor3 = this.pack!.color(V.debugRole);
		label.TextStrokeTransparency = 0;
		label.Parent = gui;
		gui.Parent = anchor;
		anchor.Parent = this.folder;
		return { anchor, label };
	}

	// --- show / hide -----------------------------------------------------------------------------------

	/** Run over or exited: everything parked, the tracker forgets the vault. */
	private clear(): void {
		this.hideAll();
		this.tracker.reset();
		this.lastSimSec = undefined;
	}

	private hideAll(): void {
		this.shown = false;
		if (!this.built) return;
		if (this.closed !== undefined) this.hideBody(this.closed);
		if (this.opened !== undefined) this.hideBody(this.opened);
		if (this.cageArt !== undefined) this.hideBody(this.cageArt);
		this.parkBars();
		if (this.glint !== undefined) setGlintTransparency(this.glint, HIDDEN);
		if (this.star !== undefined) {
			this.star.Transparency = HIDDEN;
			this.star.CFrame = PARKED;
		}
		if (this.plate !== undefined) this.hideFloorText(this.plate);
		this.hideTransients();
		if (this.debugLabel !== undefined) this.debugLabel.anchor.CFrame = PARKED;
	}

	/** The one-shot pieces: lines, column, cards (a new vault starts without them). */
	private hideTransients(): void {
		if (this.line !== undefined) this.hideFloorText(this.line);
		if (this.column !== undefined) {
			this.column.part.Transparency = HIDDEN;
			this.column.part.CFrame = PARKED;
			if (this.column.gui !== undefined) this.column.gui.Enabled = false;
		}
		this.hideCards();
	}

	private onLocale(): void {
		const font = currentHudFont();
		if (this.plate !== undefined) {
			this.plate.label.Font = font;
			this.plate.clock.Font = font;
		}
		if (this.line !== undefined) this.line.label.Font = font;
		for (const c of this.cards) c.label.Font = font;
		if (this.openLine !== undefined) this.openLine.label.Font = font;
		this.relabel = true;
		this.cardsFor = undefined;
	}

	// --- bodies ----------------------------------------------------------------------------------------

	/** `faceX` / `faceZ`: the way a sprite chest faces (into its room: the vale art's four facings); 0, 0 keeps its row. */
	private placeBody(body: PieceBody, origin: CFrame, dtSec: number, faceX = 0, faceZ = 0): void {
		if (!body.shown) {
			body.shown = true;
			if (body.sprite !== undefined) {
				body.sprite.reset();
				body.sprite.setTransparency(body.transparency);
			}
			if (body.image !== undefined) body.image.gui.Enabled = true;
			if (body.model !== undefined) setModelTransparency(body.model, body.transparency);
		}
		if (body.model !== undefined) {
			for (const piece of body.model.pieces) piece.part.CFrame = origin.mul(piece.offset);
		}
		if (body.sprite !== undefined) {
			body.sprite.anchor.CFrame = new CFrame(origin.Position);
			body.sprite.update(IDLE, faceX, faceZ, this.basis, dtSec);
		}
		if (body.image !== undefined) body.image.anchor.CFrame = new CFrame(origin.Position);
	}

	private hideBody(body: PieceBody): void {
		if (!body.shown) return;
		body.shown = false;
		if (body.model !== undefined) this.parkModel(body.model);
		if (body.sprite !== undefined) body.sprite.park();
		if (body.image !== undefined) {
			body.image.gui.Enabled = false;
			body.image.anchor.CFrame = PARKED;
		}
	}

	private setBodyTransparency(body: PieceBody, t: number): void {
		if (body.transparency === t) return;
		body.transparency = t;
		if (body.model !== undefined) setModelTransparency(body.model, t);
		if (body.sprite !== undefined) body.sprite.setTransparency(t);
		if (body.image !== undefined) body.image.label.ImageTransparency = t;
	}

	private parkBars(): void {
		if (this.barsAt === undefined) return;
		this.barsAt = undefined;
		for (const bar of this.bars) this.parkModel(bar);
	}

	private parkModel(model: PlaceholderModel): void {
		for (const piece of model.pieces) if (piece.part.CFrame !== PARKED) piece.part.CFrame = PARKED;
	}

	/** Builds every body once (on the first floor with a vault). */
	private build(): void {
		if (this.built) return;
		this.built = true;
		const pack = this.pack!;
		const folder = this.folder!;
		for (let tier = 0; tier < 3; tier++) {
			this.floorColors.push(pack.color(treasureFloorRole(tier)));
			this.uiColors.push(pack.color(treasureUiRole(tier)));
		}
		this.chestLook = pack.treasurePiece(TREASURE_CHEST_ID);
		this.openLook = pack.treasurePiece(TREASURE_CHEST_OPEN_ID);
		this.cageLook = pack.treasurePiece(TREASURE_CAGE_ID);
		this.closed = this.buildBody(this.chestLook, folder, V.maxHeightTiles);
		this.opened = this.buildBody(this.openLook, folder, V.openMaxHeightTiles);
		this.hideBody(this.closed);
		this.hideBody(this.opened);
		this.buildCage(pack, folder);
		this.buildSparkle(pack, folder);
		this.plate = this.buildPlate(pack, folder);
		this.line = this.buildLine(pack, folder);
		this.column = this.buildColumn(pack, folder);
		for (let i = 0; i < MAX_CARDS; i++) this.cards.push(this.buildCard(pack, `Card${i}`));
		this.openLine = this.buildCard(pack, "Line");
	}

	private buildBody(look: TreasurePiece, folder: Folder, maxHeightTiles: number, extraDepthStuds = 0): PieceBody {
		const art = look.art;
		if (art !== undefined && art.kind === "sprites") {
			const layout = breakableArtLayout(art.set, maxHeightTiles);
			const sprite = new SpriteView(art.set, folder, layout, extraDepthStuds);
			return {
				model: undefined,
				sprite,
				image: undefined,
				top: artPieceTop(layout),
				heightStuds: artHeightStuds(layout),
				shown: true,
				transparency: 0,
			};
		}
		if (art !== undefined && art.kind === "image") {
			const layout = breakableArtLayout(
				{ frameW: art.size.X, frameH: art.size.Y, pivot: art.pivot, pixelsPerTile: art.pixelsPerTile },
				maxHeightTiles,
			);
			return {
				model: undefined,
				sprite: undefined,
				image: buildImage(art, layout, folder, extraDepthStuds),
				top: artPieceTop(layout),
				heightStuds: artHeightStuds(layout),
				shown: true,
				transparency: 0,
			};
		}
		const visual = look.placeholder;
		const model = buildPlaceholder(this.pack!, look.id, visual, 1, folder, true);
		return {
			model,
			sprite: undefined,
			image: undefined,
			top: boxPieceTop(visual.size),
			heightStuds: visual.size[1],
			shown: true,
			transparency: 0,
		};
	}

	private buildCage(pack: ThemePack, folder: Folder): void {
		const look = this.cageLook!;
		if (look.art !== undefined) {
			this.cageArt = this.buildBody(look, folder, V.cageMaxHeightTiles, V.cageDepthStuds);
			this.hideBody(this.cageArt);
			return;
		}
		const bar = look.placeholder;
		const dash = bar.dash;
		const chest = this.chestLook!.placeholder.size;
		this.barHeight = bar.size[1];
		this.barOffsets = cageBarOffsets(
			chest[0],
			chest[2],
			dash?.length ?? bar.size[0],
			dash?.gap ?? bar.size[0],
			V.cageMarginStuds,
		);
		for (let i = 0; i < this.barOffsets.size(); i++) {
			const model = buildPlaceholder(pack, look.id, bar, 1, folder, false);
			setModelColor(model, look.color);
			this.parkModel(model);
			this.bars.push(model);
		}
	}

	private buildSparkle(pack: ThemePack, folder: Folder): void {
		const S = V.sparkle;
		this.glintArt = pack.decor(decorFxId(S.fx)) ?? pack.decor(decorFxId(S.fallbackFx));
		if (this.glintArt !== undefined) {
			this.glintLayout = visualLayout(this.glintArt.art);
			const anchor = renderPart("Part", false);
			anchor.Name = "TreasureSparkle";
			anchor.Transparency = HIDDEN;
			anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
			anchor.CFrame = PARKED;
			anchor.Parent = folder;
			this.glintAnchor = anchor;
			this.glint = buildGlint(this.glintArt, anchor, this.sparkleBoard(1), IDLE.anim);
			this.glintBoardSize = 1;
			this.glint.gui.Enabled = true;
			return;
		}
		const star = renderPart("Part", false);
		star.Name = "TreasureStar";
		star.Material = Enum.Material.Neon;
		star.Transparency = HIDDEN;
		star.CFrame = PARKED;
		star.Parent = folder;
		this.star = star;
	}

	private buildFloorText(name: string, widthTiles: number, depthTiles: number, folder: Folder): FloorText {
		const part = renderPart("Part", false);
		part.Name = name;
		part.Transparency = HIDDEN;
		part.Size = floorCanvasPartSize(
			widthTiles * STUDS_PER_TILE,
			FX_SPRITE_VIEW.thicknessStuds,
			depthTiles * STUDS_PER_TILE,
		);
		part.CFrame = PARKED;
		const canvas = floorTextCanvas(widthTiles, depthTiles);
		const surface = createKvSurfaceGui(name);
		surface.Face = Enum.NormalId.Top;
		surface.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
		surface.CanvasSize = new Vector2(canvas[0], canvas[1]);
		surface.AlwaysOnTop = false;
		surface.LightInfluence = COMBO_SHOUT_DRAW.lightInfluence;
		surface.ResetOnSpawn = false;
		surface.Enabled = false;
		surface.ClipsDescendants = false;
		surface.Parent = part;
		part.Parent = folder;
		return {
			part,
			surface,
			duck: new ShoutDuck(),
			box: { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 },
			canvas,
			visible: false,
		};
	}

	private buildPlate(pack: ThemePack, folder: Folder): Plate {
		const P = V.plate;
		const f = this.buildFloorText("TreasurePlate", P.widthTiles, P.depthTiles, folder);
		const label = floorLabel(pack, f.surface, "Label");
		label.Size = UDim2.fromScale(1, PLATE_LABEL_SHARE);
		label.Position = UDim2.fromScale(0.5, PLATE_LABEL_SHARE / 2);
		const clock = floorLabel(pack, f.surface, "Clock");
		clock.Size = UDim2.fromScale(1, 1 - PLATE_LABEL_SHARE);
		clock.Position = UDim2.fromScale(0.5, (1 + PLATE_LABEL_SHARE) / 2);
		const pips: Frame[] = [];
		const pipStrokes: UIStroke[] = [];
		for (let i = 0; i < MAX_PIPS; i++) {
			const pip = new Instance("Frame");
			pip.Name = `Pip${i}`;
			pip.AnchorPoint = CENTRE;
			pip.Size = UDim2.fromOffset(P.pipPx, P.pipPx);
			pip.BorderSizePixel = 0;
			pip.BackgroundTransparency = HIDDEN;
			pip.Visible = false;
			const stroke = new Instance("UIStroke");
			stroke.Thickness = P.pipStrokePx;
			stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
			stroke.Transparency = HIDDEN;
			stroke.Parent = pip;
			pip.Parent = f.surface;
			pips.push(pip);
			pipStrokes.push(stroke);
		}
		const shards: Frame[] = [];
		const n = V.crack.shardCount;
		for (let i = 0; i < n; i++) {
			const shard = new Instance("Frame");
			shard.Name = `Shard${i}`;
			shard.AnchorPoint = CENTRE;
			shard.Size = new UDim2(1 / n, 0, SHARD_HEIGHT_SHARE, 0);
			shard.BorderSizePixel = 0;
			shard.BackgroundTransparency = HIDDEN;
			shard.Visible = false;
			shard.Parent = f.surface;
			shards.push(shard);
		}
		return { ...f, label, clock, pips, pipStrokes, shards };
	}

	private buildLine(pack: ThemePack, folder: Folder): Line {
		const L = V.line;
		const f = this.buildFloorText("TreasureLine", L.widthTiles, L.depthTiles, folder);
		const label = floorLabel(pack, f.surface, "Text");
		return { ...f, label, text: "" };
	}

	private buildColumn(pack: ThemePack, folder: Folder): Column {
		const part = renderPart("Part", false);
		part.Name = "TreasureColumn";
		part.Material = Enum.Material.Neon;
		part.Transparency = HIDDEN;
		part.CFrame = PARKED;
		part.Parent = folder;
		const anchor = renderPart("Part", false);
		anchor.Name = "TreasureColumnAnchor";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = PARKED;
		anchor.Parent = folder;
		this.columnFx = isFxId(TREASURE_COLUMN_FX_ID) ? pack.fx(TREASURE_COLUMN_FX_ID) : undefined;
		if (this.columnFx === undefined) return { part, anchor, gui: undefined, label: undefined };
		const gui = createKvBillboardGui("TreasureColumn");
		gui.LightInfluence = 0;
		gui.AlwaysOnTop = false;
		gui.ResetOnSpawn = false;
		gui.Enabled = false;
		gui.Adornee = anchor;
		const label = new Instance("ImageLabel");
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.ImageTransparency = HIDDEN;
		label.ResampleMode = Enum.ResamplerMode[this.columnFx.set.resample];
		label.Parent = gui;
		gui.Parent = anchor;
		return { part, anchor, gui, label };
	}

	private buildCard(pack: ThemePack, name: string): CardView {
		const att = new Instance("Attachment");
		att.Name = name;
		att.Parent = this.holder;
		const gui = createKvBillboardGui(name);
		gui.Adornee = att;
		gui.AlwaysOnTop = true;
		gui.LightInfluence = 0;
		gui.MaxDistance = math.huge;
		gui.ResetOnSpawn = false;
		gui.Enabled = false;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = currentHudFont();
		label.TextScaled = true;
		label.TextStrokeColor3 = pack.color("background");
		label.Parent = gui;
		gui.Parent = this.folder;
		return { att, gui, label, shown: false, text: "" };
	}

	private destroyBodies(): void {
		for (const body of [this.closed, this.opened, this.cageArt]) {
			if (body === undefined) continue;
			if (body.model !== undefined) destroyModel(body.model);
			body.sprite?.destroy();
			body.image?.anchor.Destroy();
		}
		for (const bar of this.bars) destroyModel(bar);
		this.bars.clear();
	}
}

/** A floor text's TextLabel: centred, TextScaled HUD font with the background-coloured stroke, hidden. */
function floorLabel(pack: ThemePack, parent: Instance, name: string): TextLabel {
	const label = new Instance("TextLabel");
	label.Name = name;
	label.AnchorPoint = CENTRE;
	label.Position = UDim2.fromScale(CENTRE.X, CENTRE.Y);
	label.Size = UDim2.fromScale(1, 1);
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Font = currentHudFont();
	label.TextScaled = true;
	label.TextColor3 = pack.color("uiText");
	label.TextStrokeColor3 = pack.color("background");
	label.TextTransparency = HIDDEN;
	label.TextStrokeTransparency = HIDDEN;
	label.Parent = parent;
	return label;
}

/** A label's text, opacity (fill and stroke together, the shout's stroke rule) and colour. */
function setText(label: TextLabel, text: string, opacity: number, color: Color3): void {
	if (label.Text !== text) label.Text = text;
	if (label.TextColor3 !== color) label.TextColor3 = color;
	label.TextTransparency = HIDDEN - opacity;
	label.TextStrokeTransparency = HIDDEN - opacity * (HIDDEN - COMBO_SHOUT_DRAW.strokeTransparency);
}

/** A card billboard at floor point `at`, `upStuds` up the screen, sized from its text (the score pops' glyphs x scale). */
function drawCard(
	view: CardView,
	at: Vector3,
	text: string,
	scale: number,
	upStuds: number,
	alpha: number,
	color: Color3,
): void {
	if (alpha <= 0) {
		hideCard(view);
		return;
	}
	const px = FX_VIEW.pxStuds;
	const glyphW = SCORE_POP_GLYPH_PX.w * scale;
	const glyphH = SCORE_POP_GLYPH_PX.h * scale;
	if (text !== view.text) {
		view.text = text;
		view.label.Text = text;
		view.gui.Size = new UDim2(math.max(charCount(text), 1) * glyphW * px, 0, glyphH * px, 0);
	}
	view.att.WorldPosition = at;
	view.gui.StudsOffset = new Vector3(0, upStuds, 0);
	view.label.TextColor3 = color;
	view.label.TextTransparency = HIDDEN - alpha;
	view.label.TextStrokeTransparency = HIDDEN - alpha * (HIDDEN - FX_VIEW.numberStroke);
	if (!view.shown) {
		view.shown = true;
		view.gui.Enabled = true;
	}
}

function hideCard(view: CardView): void {
	if (!view.shown) return;
	view.shown = false;
	view.gui.Enabled = false;
}

/** The drawn height of art laid out as `layout` above its pivot, studs. */
function artHeightStuds(layout: SpriteLayout): number {
	return (math.min(layout.frameH, math.max(0, layout.pivot.y)) * STUDS_PER_TILE) / layout.pixelsPerTile;
}

/**
 * An upright image billboard (image art) on an invisible anchor, its pivot on the anchor, `extraDepthStuds` nearer the
 * camera (the cage over the chest).
 */
function buildImage(art: WorldImage, layout: SpriteLayout, parent: Instance, extraDepthStuds = 0): ImageBody {
	const anchor = renderPart("Part", false);
	anchor.Name = "TreasureImage";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = PARKED;
	const b = spriteBillboard(layout);
	const gui = createKvBillboardGui("Treasure");
	gui.Size = new UDim2(b.w, 0, b.h, 0);
	gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ + extraDepthStuds);
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
