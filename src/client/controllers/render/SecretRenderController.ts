import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { DEV_MONO_FONT, createKvBillboardGui, createKvSurfaceGui, currentHudFont, onLocaleChanged } from "client/ui";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { gridToWorld, type ActorSpawn, type Dungeon, type FloorSecret } from "shared/dungeon";
import { RUN_ATTRIBUTES } from "shared/play";
import type { JuiceSettings } from "shared/settings";
import { SIM_HZ, SecretStatus, partySize, type SimState } from "shared/sim";
import {
	DECOR_FX_TINT,
	SECRET_CRACK_ID,
	SECRET_DUST_FX_ID,
	SECRET_RUBBLE_ID,
	TREASURE_CHEST_ID,
	TREASURE_CHEST_OPEN_ID,
	TREASURE_COLUMN_FX_ID,
	treasureFloorRole,
	treasureUiRole,
	type FxSprite,
	type ThemePack,
	type TreasurePiece,
} from "shared/theme";
import {
	DECOR_LIGHTS,
	GAME_WORLD,
	RENDER_ORDER,
	ReadinessCursor,
	SPRITE_VIEW,
	animDtSec,
	degToRad,
	floorStudsY,
	isoBasis,
	lookWhenReady,
	spriteBillboard,
	studsX,
	studsZ,
	type TileRect,
} from "shared/view";
import { burstSeed, effectiveParticles, floorShoutText } from "shared/view/fx";
import {
	SECRET_VIEW,
	SecretPhase,
	SecretViewTracker,
	newSecretShardLook,
	secretChamberBuild,
	secretCrackCentre,
	secretCrackList,
	secretCrackRect,
	secretCrackVariant,
	secretFaceName,
	secretFrontBox,
	secretLabelText,
	secretMatchesPlan,
	secretOpenLogLine,
	secretRewardTexts,
	secretRingRect,
	secretRoomPlansCharger,
	secretRubbleSpots,
	secretShardAt,
	secretShout,
	secretSinkTiles,
	type CellRect,
	type SecretLook,
	type SecretOpenedEvent,
	type SecretTakenEvent,
} from "shared/view/secrets";
import {
	PedestalChestTracker,
	TREASURE_VIEW,
	newPedestalChestLook,
	openLineAt,
	rewardCardAt,
	type CardLook,
	type PedestalChestLook,
	type RewardCardText,
} from "shared/view/treasure";
import { ComboController } from "../fx/ComboController";
import { FreezeFrameController } from "../fx/FreezeFrameController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { ParticleController } from "../fx/ParticleController";
import { attachmentHolder, floorPoint } from "../fx/fxHelpers";
import { PreloadController } from "../game/PreloadController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { buildWorldSlabs, worldSurfaces, type WorldSurface } from "../game/worldSurfaces";
import { renderPart } from "./placeholders";
import {
	TREASURE_PARKED,
	buildPieceBody,
	buildTreasureCard,
	buildTreasureColumn,
	destroyPieceBody,
	drawTreasureCard,
	drawTreasureColumn,
	hidePieceBody,
	hideTreasureCard,
	hideTreasureColumn,
	placePieceBody,
	type PieceBody,
	type TreasureCard,
	type TreasureColumn,
} from "./treasureBody";
import { VoidController } from "./VoidController";

const V = SECRET_VIEW;
const S = STUDS_PER_TILE;
const HIDDEN = 1;
const HALF = 0.5;
const CENTRE = new Vector2(HALF, HALF);
const BLACK = new Color3(0, 0, 0);
/** Reward cards at most (relic / draft / boosts / points), as the vault's. */
const MAX_CARDS = 4;
/** A quarter turn (the overlay on a top face whose crack runs along Z). */
const QUARTER_TURN_DEG = 90;

/** One frame of the crack / rubble art: its sheet and rect. */
interface OverlayFrame {
	readonly image: string;
	readonly offset: Vector2;
	readonly size: Vector2;
}

/** The crack / rubble art: its variants (a sprites set's idle frames, or the one image). */
interface OverlayArt {
	readonly frames: ReadonlyArray<OverlayFrame>;
}

/** A torch on the chamber's back wall: its flame block and PointLight. */
interface Torch {
	readonly flame: Part;
	readonly light: PointLight;
}

/** One floor's secret room on screen (built in the floor listener, dropped with the floor Janitor). */
interface SecretScene {
	readonly plan: FloorSecret;
	readonly janitor: Janitor;
	/** Workspace folder: the crack Part, the shards, the dust, the chest bodies, the column, the debug outlines. */
	readonly folder: Folder;
	/** The chamber's floor and walls, the rubble and the torches: parented to `folder` from the open on. */
	readonly chamber: Folder;
	readonly surfaces: { readonly floor: WorldSurface; readonly wall: WorldSurface };
	/** The wall colour darkened (the overlay's tint, the fallback band). */
	readonly crackTint: Color3;
	readonly charger: boolean;
	crack: Part;
	crackShown: boolean;
	chamberShown: boolean;
	/** The rubble's Instances inside `chamber` (rebuilt when `secret.rubble` downloads). */
	rubble: Instance[];
	readonly torches: Torch[];
	torchLevel: number;
	readonly shards: Part[];
	shardsShown: boolean;
	readonly dustAnchor: Part;
	dustGui: BillboardGui | undefined;
	dustLabel: ImageLabel | undefined;
	readonly dustMote: Part;
	closed: PieceBody;
	opened: PieceBody;
	readonly rest: CFrame;
	readonly column: TreasureColumn;
	readonly chestLook: PedestalChestLook;
	drawnShown: boolean;
	drawnOpen: boolean;
	drawnLift: number;
	redraw: boolean;
	columnOn: boolean;
	readonly holder: Part;
	readonly cards: TreasureCard[];
	readonly title: TreasureCard;
	/** The take whose cards show, for whom, and their texts. */
	taken: SecretTakenEvent | undefined;
	cardsPlayer: number;
	/** The take the texts were read for (undefined: read again, a new take or a locale switch). */
	cardsFor: SecretTakenEvent | undefined;
	cardTexts: RewardCardText[];
	titleText: string;
	debug: { readonly folder: Folder; readonly label: TextLabel } | undefined;
}

/**
 * A secret room on screen (docs/SECRET_ROOMS.md SR7, Design 7; the pure half is shared/view/secrets, "As built (Track
 * V1)" lists what each client view calls). Per floor (on run start and every floor change, inside those listeners, so
 * behind the stage cover like the world's build) for a floor with a secret (SimController.getFloorSecret), in
 * Workspace `KV_Secret`:
 *   crack     the crack's cells as their own wall Part (WorldController leaves them out of its wall merge): the biome's
 *             wall material, colour and world-anchored wall texture (worldSurfaces.ts buildWorldSlabs, exactly the
 *             walls' rule, so no seam), the `secret.crack` overlay (a sprites set's idle frame by the crack's cell, or an
 *             image) on its front (+f) and top faces in the wall colour darkened (SECRET_VIEW.crack), else a darker
 *             band across each face; shown while hidden, gone at the open.
 *   chamber   built hidden from secretChamberBuild over the Forge's and the carved grid: the chamber floor and the
 *             opened crack cells as floor slabs, the chamber's own walls (never the parent's wall line), two torches on
 *             its back wall (a self-lit flame and a PointLight at DECOR_LIGHTS' range, lit at the reveal), the rubble on
 *             the crack's cells (`secret.rubble` flat, else a few wall blocks); shown from the open.
 *   chest     the vault's chest (treasureBody.ts, as TreasureRenderController and RunMarkerController draw it) at the
 *             chamber's back, facing the crack; its take plays the vault's open through a PedestalChestTracker (jolt,
 *             pop to the open chest, solo freeze, `stamp` nudge, ring burst, the light column in the tier's floor
 *             colour) and the view player's reward cards under `Secret cache` (secretRewardTexts).
 * Per frame (render step `KV_Secret` after the camera) one SecretViewTracker.update gives the look and its edges:
 *   dust      `fx.secret.dust` hanging from the crack's top edge on the pass's cell (a billboard; without the art, or
 *             until it downloads, one pale mote falling the wall's height); none under reduced motion.
 *   knocks    one dust puff per throttled knock on the knocked cell's face (ParticleController.secretPuff).
 *   the open  the burst (shards flying into the room, none under reduced motion; ParticleController.secretBurst), the
 *             solo freeze (SECRET_VIEW.burst.freezeMs on the hitstop clock) for an open by the view player, the `stamp`
 *             nudge and SECRET! (secretShout through ComboController.requestShout at FLOOR_SHOUT_PRIORITY.secret) when
 *             the view player opened it or stands near, the KV_Debug line `[Secret] floor N: ...`; VoidController sinks
 *             the held-out rock (secretSinkTiles: at once under reduced motion).
 * The sounds are the cue mapper's (AudioController), the minimap's change and chest mark MinimapController's, the
 * co-op toast TreasureToastController's, the first-time card SightingController's. Leaving the run keeps the crack or
 * the opened chamber (the world stays under the menu) and drops the one-shot pieces. Debug: RUN_ATTRIBUTES.secretLabel
 * (KV_SecretLabel, Studio or KV_Debug, read live, off by default) outlines the crack, the chamber and the front box
 * and labels the crack (secretLabelText: tier, status, size, a planned Charger). Stand-ins (docs/STAGE_ASSETS.md
 * SA18): the overlay, the rubble and the chest draw their placeholders until their ids downloaded and are rebuilt on
 * the flip; the dust and the column pick every frame. Read-only on the sim.
 */
@Controller({})
export class SecretRenderController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly tracker = new SecretViewTracker();
	private readonly chestTracker = new PedestalChestTracker();
	private readonly basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
	private readonly shard = newSecretShardLook();
	private readonly cardLook: CardLook = { alpha: 0, riseTiles: 0 };
	private scene: SecretScene | undefined;
	private cursor: ReadinessCursor | undefined;
	private lastSimSec: number | undefined;
	private debugOn = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
		private readonly freeze: FreezeFrameController,
		private readonly preload: PreloadController,
		private readonly combo: ComboController,
		private readonly voids: VoidController,
	) {}

	onStart(): void {
		this.cursor = new ReadinessCursor(this.preload.getReadiness());
		this.janitor.Add(this.floorJanitor, "Cleanup");
		this.sim.onRunStarted((ctx) => this.build(ctx));
		this.sim.onFloorChanged((ctx) => this.build(ctx));
		this.sim.onRunExited(() => this.exited());
		this.readDebug();
		for (const attribute of [RUN_ATTRIBUTES.secretLabel, RUN_ATTRIBUTES.debug])
			this.janitor.Add(Workspace.GetAttributeChangedSignal(attribute).Connect(() => this.readDebug()));
		this.janitor.Add(onLocaleChanged(() => this.onLocale()));
		RunService.BindToRenderStep(
			V.renderStep,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(V.renderStep), true);
	}

	// --- per floor ---------------------------------------------------------------------------------------

	private clear(): void {
		this.floorJanitor.Cleanup();
		this.scene = undefined;
		this.tracker.reset();
		this.lastSimSec = undefined;
	}

	/**
	 * The run was left: the world stays under the menu (WorldController keeps its Parts), so the crack or the opened
	 * chamber stay as they are; the one-shot pieces (shards, dust, cards, column) go and the tracker forgets.
	 */
	private exited(): void {
		const scene = this.scene;
		this.tracker.reset();
		this.lastSimSec = undefined;
		if (scene === undefined) return;
		for (const p of scene.shards) {
			p.Transparency = HIDDEN;
			p.CFrame = TREASURE_PARKED;
		}
		scene.shardsShown = false;
		if (scene.dustGui !== undefined) scene.dustGui.Enabled = false;
		scene.dustMote.Transparency = HIDDEN;
		for (const c of scene.cards) hideTreasureCard(c);
		hideTreasureCard(scene.title);
		scene.taken = undefined;
		hideTreasureColumn(scene.column);
		scene.columnOn = false;
	}

	private build(ctx: RunContext): void {
		this.clear();
		const plan = this.sim.getFloorSecret();
		const forge = ctx.dungeon;
		if (plan === undefined || forge === undefined) return;
		const roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>> =
			ctx.endlessFloor !== undefined && ctx.floor > 0 ? ctx.endlessFloor(ctx.floor).roomSpawns : [];
		this.scene = this.buildScene(ctx.run.state, plan, forge, roomSpawns);
		this.frame();
	}

	private buildScene(
		state: Readonly<SimState>,
		plan: FloorSecret,
		forge: Dungeon,
		roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>,
	): SecretScene {
		const pack = this.theme.getPack();
		const janitor = new Janitor();
		this.floorJanitor.Add(janitor, "Destroy");
		const folder = janitor.Add(new Instance("Folder"));
		folder.Name = V.folderName;
		const chamber = janitor.Add(new Instance("Folder"));
		chamber.Name = "Chamber";
		const { floor, wall } = worldSurfaces(pack, forge.params.themeKey);
		const crackTint = wall.color.Lerp(BLACK, V.crack.darken);
		const build = secretChamberBuild(plan, forge, plan.dungeon);
		const wallHeight = GAME_WORLD.wallHeightTiles * S;
		const y0 = floorStudsY();
		const floorThick = floor.visual.size[1];
		// the chamber, hidden: its floor and the opened crack's floor, its own walls
		const floorRects: TileRect[] = [build.floor, secretCrackRect(plan)];
		buildWorldSlabs(chamber, "SecretFloor", floorRects, floor, y0 - floorThick / 2, floorThick, false);
		buildWorldSlabs(chamber, "SecretWall", build.walls, wall, y0 + wallHeight / 2, wallHeight, true);
		const torches = build.torches.map((t) => this.buildTorch(pack, chamber, t.x, t.y, t.fx, t.fz));
		// the chest at the back, facing the crack
		const base = new Vector3(
			studsX(gridToWorld(build.chestX)),
			y0 + TREASURE_VIEW.liftStuds,
			studsZ(gridToWorld(build.chestY)),
		);
		const rest = CFrame.lookAt(base, base.add(new Vector3(build.chestFx, 0, build.chestFz)));
		const closed = buildPieceBody(pack, this.lookOf(pack, TREASURE_CHEST_ID), folder, TREASURE_VIEW.maxHeightTiles);
		const opened = buildPieceBody(
			pack,
			this.lookOf(pack, TREASURE_CHEST_OPEN_ID),
			folder,
			TREASURE_VIEW.openMaxHeightTiles,
		);
		hidePieceBody(closed);
		hidePieceBody(opened);
		const holder = attachmentHolder(folder, "Anchors");
		const cards = new Array<TreasureCard>();
		for (let i = 0; i < MAX_CARDS; i++) cards.push(buildTreasureCard(pack, holder, folder, `SecretCard${i}`));
		const scene: SecretScene = {
			plan,
			janitor,
			folder,
			chamber,
			surfaces: { floor, wall },
			crackTint,
			charger: secretRoomPlansCharger(roomSpawns, plan.room),
			crack: this.buildCrack(pack, plan, wall, crackTint, folder),
			crackShown: true,
			chamberShown: false,
			rubble: [],
			torches,
			torchLevel: -1,
			shards: this.buildShards(wall, folder),
			shardsShown: false,
			dustAnchor: anchorPart(folder, "SecretDust"),
			dustGui: undefined,
			dustLabel: undefined,
			dustMote: this.buildMote(pack, folder),
			closed,
			opened,
			rest,
			column: buildTreasureColumn(pack, folder),
			chestLook: newPedestalChestLook(),
			drawnShown: false,
			drawnOpen: false,
			drawnLift: 0,
			redraw: true,
			columnOn: false,
			holder,
			cards,
			title: buildTreasureCard(pack, holder, folder, "SecretTitle"),
			taken: undefined,
			cardsPlayer: -1,
			cardsFor: undefined,
			cardTexts: [],
			titleText: "",
			debug: undefined,
		};
		janitor.Add(() => {
			destroyPieceBody(scene.closed);
			destroyPieceBody(scene.opened);
		}, true);
		scene.rubble = this.buildRubble(pack, scene);
		this.buildDust(pack, scene);
		const sc = state.secrets;
		const taken = secretMatchesPlan(state, plan) && sc !== undefined && sc.status === SecretStatus.TAKEN;
		this.chestTracker.reset([taken ? 1 : 0]);
		folder.Parent = Workspace;
		return scene;
	}

	/** A chest look: its art once downloaded, else the stand-in placeholder (docs/STAGE_ASSETS.md SA18). */
	private lookOf(pack: ThemePack, id: string): TreasurePiece {
		return lookWhenReady(pack.treasurePiece(id), this.preload.isArtReady(id));
	}

	/** The crack Part: the wall's look on the crack's cells, the overlay (or the band) on its front and top faces. */
	private buildCrack(pack: ThemePack, plan: FloorSecret, wall: WorldSurface, tint: Color3, folder: Folder): Part {
		const wallHeight = GAME_WORLD.wallHeightTiles * S;
		const rect = secretCrackRect(plan);
		const [part] = buildWorldSlabs(
			folder,
			"SecretCrack",
			[rect],
			wall,
			floorStudsY() + wallHeight / 2,
			wallHeight,
			true,
		);
		const art = this.preload.isArtReady(SECRET_CRACK_ID) ? overlayArt(pack, SECRET_CRACK_ID) : undefined;
		const frame = art !== undefined ? art.frames[secretCrackVariant(plan.x, plan.y, art.frames.size())] : undefined;
		const front = Enum.NormalId[secretFaceName(plan.fx, plan.fz)];
		// the front face spans the crack along x the wall's height; the top face its cells (x by z, turned when along z)
		overlaySurface(part, front, rect.w * rect.h, GAME_WORLD.wallHeightTiles, false, frame, tint);
		overlaySurface(part, Enum.NormalId.Top, rect.w, rect.h, rect.h > rect.w, frame, tint);
		return part;
	}

	/** One torch on the chamber's back wall cell (gx, gy), hanging on its (fx, fz) face: hidden, unlit. */
	private buildTorch(pack: ThemePack, parent: Instance, gx: number, gy: number, fx: number, fz: number): Torch {
		const L = DECOR_LIGHTS;
		const off = HALF + L.wallOffsetTiles;
		const flame = renderPart("Part", false);
		flame.Name = "SecretTorch";
		flame.Material = Enum.Material.Neon;
		flame.Color = pack.color(DECOR_FX_TINT.flame);
		const side = V.torch.flameStuds;
		flame.Size = new Vector3(side, side, side);
		flame.CFrame = new CFrame(
			studsX(gridToWorld(gx) + fx * off),
			floorStudsY() + L.heightTiles * S,
			studsZ(gridToWorld(gy) + fz * off),
		);
		flame.Transparency = HIDDEN;
		const light = new Instance("PointLight");
		light.Shadows = L.shadows;
		light.Range = L.rangeTiles * S;
		light.Brightness = 0;
		light.Enabled = false;
		light.Color = flame.Color;
		light.Parent = flame;
		flame.Parent = parent;
		return { flame, light };
	}

	/** The burst's shards: wall-coloured blocks, parked until the open. */
	private buildShards(wall: WorldSurface, folder: Folder): Part[] {
		const out = new Array<Part>();
		const side = V.burst.shardStuds;
		for (let i = 0; i < V.burst.shards; i++) {
			const p = renderPart("Part", false);
			p.Name = "SecretShard";
			p.Size = new Vector3(side, side, side);
			p.Color = wall.color;
			p.Material = wall.material;
			p.CFrame = TREASURE_PARKED;
			p.Parent = folder;
			out.push(p);
		}
		return out;
	}

	/** The dust's fallback mote (no `fx.secret.dust` art, or not downloaded yet). */
	private buildMote(pack: ThemePack, folder: Folder): Part {
		const p = renderPart("Part", false);
		p.Name = "SecretDustMote";
		p.Material = Enum.Material.Neon;
		p.Color = pack.color(V.dustLook.role);
		const side = V.dustLook.fallbackStuds;
		p.Size = new Vector3(side, side, side);
		p.Transparency = HIDDEN;
		p.CFrame = TREASURE_PARKED;
		p.Parent = folder;
		return p;
	}

	/** The dust trickle's billboard on the dust anchor, when the pack has `fx.secret.dust`. */
	private buildDust(pack: ThemePack, scene: SecretScene): void {
		const art = dustArt(pack);
		if (art === undefined) return;
		const b = spriteBillboard(art.set);
		const gui = createKvBillboardGui("SecretDust");
		gui.Size = new UDim2(b.w, 0, b.h, 0);
		gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
		gui.LightInfluence = 0;
		gui.AlwaysOnTop = false;
		gui.ResetOnSpawn = false;
		gui.Enabled = false;
		gui.Adornee = scene.dustAnchor;
		const label = new Instance("ImageLabel");
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.ResampleMode = Enum.ResamplerMode[art.set.resample];
		label.ImageColor3 = art.color;
		label.Parent = gui;
		gui.Parent = scene.dustAnchor;
		scene.dustGui = gui;
		scene.dustLabel = label;
	}

	/** The rubble on the opened crack's cells, in the chamber folder: the art laid flat, else wall blocks. */
	private buildRubble(pack: ThemePack, scene: SecretScene): Instance[] {
		const plan = scene.plan;
		const R = V.rubble;
		const wall = scene.surfaces.wall;
		const art = this.preload.isArtReady(SECRET_RUBBLE_ID) ? overlayArt(pack, SECRET_RUBBLE_ID) : undefined;
		const out = new Array<Instance>();
		if (art !== undefined) {
			const rect = secretCrackRect(plan);
			const part = renderPart("Part", false);
			part.Name = "SecretRubble";
			part.Transparency = HIDDEN;
			part.Size = new Vector3(rect.w * S, R.liftStuds, rect.h * S);
			part.CFrame = new CFrame(
				studsX(rect.x + (rect.w - 1) / 2),
				floorStudsY() + R.liftStuds / 2,
				studsZ(rect.y + (rect.h - 1) / 2),
			);
			const frame = art.frames[secretCrackVariant(plan.x, plan.y, art.frames.size())];
			const tint = wall.color.Lerp(BLACK, R.darken);
			overlaySurface(part, Enum.NormalId.Top, rect.w, rect.h, rect.h > rect.w, frame, tint);
			part.Parent = scene.chamber;
			out.push(part);
			return out;
		}
		for (const spot of secretRubbleSpots(plan)) {
			const p = renderPart("Part", false);
			p.Name = "SecretRubble";
			p.Size = new Vector3(spot.sizeStuds, spot.heightStuds, spot.sizeStuds);
			p.CFrame = new CFrame(studsX(spot.x), floorStudsY() + spot.heightStuds / 2, studsZ(spot.z));
			p.Color = wall.color;
			p.Material = wall.material;
			p.Parent = scene.chamber;
			out.push(p);
		}
		return out;
	}

	/**
	 * docs/STAGE_ASSETS.md SA18: an id whose art readiness flipped gets its part rebuilt in the new look (the crack Part
	 * with its overlay, the rubble, the chest bodies); the next draw places them.
	 */
	private swapLooks(scene: SecretScene): void {
		const flipped = this.cursor?.take();
		if (flipped === undefined || flipped.size() === 0) return;
		const pack = this.theme.getPack();
		if (flipped.includes(SECRET_CRACK_ID)) {
			scene.crack.Destroy();
			scene.crack = this.buildCrack(pack, scene.plan, scene.surfaces.wall, scene.crackTint, scene.folder);
			scene.crack.Parent = scene.crackShown ? scene.folder : undefined;
		}
		if (flipped.includes(SECRET_RUBBLE_ID)) {
			for (const r of scene.rubble) r.Destroy();
			scene.rubble = this.buildRubble(pack, scene);
		}
		if (flipped.includes(TREASURE_CHEST_ID)) {
			destroyPieceBody(scene.closed);
			scene.closed = buildPieceBody(
				pack,
				this.lookOf(pack, TREASURE_CHEST_ID),
				scene.folder,
				TREASURE_VIEW.maxHeightTiles,
			);
			hidePieceBody(scene.closed);
			scene.redraw = true;
		}
		if (flipped.includes(TREASURE_CHEST_OPEN_ID)) {
			destroyPieceBody(scene.opened);
			scene.opened = buildPieceBody(
				pack,
				this.lookOf(pack, TREASURE_CHEST_OPEN_ID),
				scene.folder,
				TREASURE_VIEW.openMaxHeightTiles,
			);
			hidePieceBody(scene.opened);
			scene.redraw = true;
		}
	}

	// --- per frame ---------------------------------------------------------------------------------------

	private frame(): void {
		const scene = this.scene;
		const ctx = this.sim.getContext();
		if (scene === undefined || ctx === undefined) return;
		if (this.sim.getFloorSecret() !== scene.plan) return; // a floor change's rebuild is on its way
		debug.profilebegin(V.profileLabel);
		const state = ctx.run.state;
		const simSec = (state.tick + this.sim.getAlpha()) / SIM_HZ;
		const dtSec = animDtSec(this.lastSimSec, simSec);
		this.lastSimSec = simSec;
		const settings = this.fx.settings();
		const reduced = settings.reducedMotion;
		const f = this.tracker.update(state, scene.plan, ctx.run.secrets, simSec, { reducedMotion: reduced });
		const look = f.look;
		this.swapLooks(scene);
		// No look (the state has no secret: never on an endless floor): the crack stays, the wall has no hole.
		this.showCrack(scene, look.phase === SecretPhase.NONE || look.crackShown);
		this.showChamber(scene, look.chamberShown);
		this.voids.sinkHeld(secretSinkTiles(look));
		this.drawTorches(scene, look, reduced);
		this.drawDust(scene, look);
		for (const k of f.puffs) {
			this.particles.secretPuff(
				k.x + scene.plan.fx * HALF,
				k.z + scene.plan.fz * HALF,
				burstSeed(k.slot, k.tick, V.knock.seedSalt),
			);
		}
		if (f.openEdge !== undefined) this.opened(scene, f.openEdge, state, ctx, settings);
		this.drawShards(scene, look);
		this.drawChest(scene, look, state, simSec, dtSec, settings);
		if (f.takenEdge !== undefined) scene.taken = f.takenEdge;
		this.drawCards(scene, look, reduced);
		this.drawDebug(scene, state);
		debug.profileend();
	}

	private showCrack(scene: SecretScene, shown: boolean): void {
		if (scene.crackShown === shown) return;
		scene.crackShown = shown;
		scene.crack.Parent = shown ? scene.folder : undefined;
	}

	private showChamber(scene: SecretScene, shown: boolean): void {
		if (scene.chamberShown === shown) return;
		scene.chamberShown = shown;
		scene.chamber.Parent = shown ? scene.folder : undefined;
	}

	/** The torches light at the reveal and fade in over torch.fadeSec (at once under reduced motion). */
	private drawTorches(scene: SecretScene, look: Readonly<SecretLook>, reduced: boolean): void {
		const since = look.t - V.reveal.jingleSec;
		const level = !look.torchesLit ? 0 : reduced ? 1 : math.clamp(since / V.torch.fadeSec, 0, 1);
		if (level === scene.torchLevel) return;
		scene.torchLevel = level;
		for (const t of scene.torches) {
			t.flame.Transparency = HIDDEN - level;
			t.light.Enabled = level > 0;
			t.light.Brightness = DECOR_LIGHTS.brightness * level;
		}
	}

	/** The dust pass on its crack cell: the art's frame, else the falling mote. */
	private drawDust(scene: SecretScene, look: Readonly<SecretLook>): void {
		const d = look.dust;
		const gui = scene.dustGui;
		const label = scene.dustLabel;
		const art = d.shown && gui !== undefined && label !== undefined && this.preload.isArtReady(SECRET_DUST_FX_ID);
		if (!d.shown) {
			if (gui !== undefined && gui.Enabled) gui.Enabled = false;
			if (scene.dustMote.Transparency !== HIDDEN) {
				scene.dustMote.Transparency = HIDDEN;
				scene.dustMote.CFrame = TREASURE_PARKED;
			}
			return;
		}
		const plan = scene.plan;
		const cell = secretCrackList(plan)[d.cell] ?? secretCrackList(plan)[0];
		const off = HALF + V.dustLook.faceTiles;
		const x = studsX(gridToWorld(cell.x) + plan.fx * off);
		const z = studsZ(gridToWorld(cell.y) + plan.fz * off);
		const top = floorStudsY() + GAME_WORLD.wallHeightTiles * S;
		if (art) {
			const fxArt = dustArt(this.theme.getPack())!;
			const frame = fxArt.frame(d.frame);
			scene.dustAnchor.CFrame = new CFrame(x, top, z);
			label!.Image = frame.image;
			label!.ImageRectOffset = frame.offset;
			label!.ImageRectSize = frame.size;
			if (!gui!.Enabled) gui!.Enabled = true;
			if (scene.dustMote.Transparency !== HIDDEN) scene.dustMote.Transparency = HIDDEN;
			return;
		}
		if (gui !== undefined && gui.Enabled) gui.Enabled = false;
		const u = (d.frame + 1) / V.dust.frames;
		const fade = V.dustLook.fallbackFadeShare;
		scene.dustMote.CFrame = new CFrame(x, top - u * GAME_WORLD.wallHeightTiles * S, z);
		scene.dustMote.Transparency = u <= 1 - fade ? 0 : math.clamp((u - (1 - fade)) / fade, 0, 1);
	}

	/** The open (this frame's own event): burst, freeze, nudge, shout, the debug line. */
	private opened(
		scene: SecretScene,
		o: Readonly<SecretOpenedEvent>,
		state: Readonly<SimState>,
		ctx: RunContext,
		settings: Readonly<JuiceSettings>,
	): void {
		const plan = scene.plan;
		const c = secretCrackCentre(plan);
		const view = this.sim.getViewPlayerIndex();
		this.particles.secretBurst(
			c.x + plan.fx * HALF,
			c.z + plan.fz * HALF,
			burstSeed(o.slot, o.tick, V.burst.seedSalt),
		);
		const mine = o.player === view || o.finder === view;
		if (mine && partySize(state) <= 1) this.sim.hitstop.request(V.burst.freezeMs, settings);
		const shout = secretShout(o, state, view);
		if (shout !== undefined) {
			const pack = this.theme.getPack();
			this.freeze.requestNudge("stamp");
			this.combo.requestShout(floorShoutText(pack, shout), pack.color(shout.role), shout.lifeSec, shout.priority);
		}
		if (Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true) print(secretOpenLogLine(ctx.floor, plan, o));
	}

	/** The burst's shards while it runs (none under reduced motion: look.bursting is false there). */
	private drawShards(scene: SecretScene, look: Readonly<SecretLook>): void {
		if (!look.bursting) {
			if (!scene.shardsShown) return;
			scene.shardsShown = false;
			for (const p of scene.shards) {
				p.Transparency = HIDDEN;
				p.CFrame = TREASURE_PARKED;
			}
			return;
		}
		scene.shardsShown = true;
		const plan = scene.plan;
		const c = secretCrackCentre(plan);
		const n = scene.shards.size();
		const baseY = floorStudsY() + (GAME_WORLD.wallHeightTiles * S) / 2;
		for (let i = 0; i < n; i++) {
			const s = secretShardAt(i, n, look.burstU, plan.x, plan.y, this.shard);
			const x = c.x + plan.fx * (HALF + s.out) + plan.ax * s.along;
			const z = c.z + plan.fz * (HALF + s.out) + plan.az * s.along;
			const p = scene.shards[i];
			p.CFrame = new CFrame(studsX(x), baseY + s.up * S, studsZ(z));
			p.Transparency = s.transparency;
		}
	}

	/** The chest: shown with the chamber; its take plays the vault's open (PedestalChestTracker). */
	private drawChest(
		scene: SecretScene,
		look: Readonly<SecretLook>,
		state: Readonly<SimState>,
		simSec: number,
		dtSec: number,
		settings: Readonly<JuiceSettings>,
	): void {
		const particles = effectiveParticles(settings) !== "off";
		const c = this.chestTracker.update(
			0,
			look.chestOpen,
			look.chamberShown,
			simSec,
			settings.reducedMotion,
			particles,
			scene.chestLook,
		);
		const shown = c.shown && look.chamberShown;
		if (
			scene.redraw ||
			shown !== scene.drawnShown ||
			c.open !== scene.drawnOpen ||
			c.liftStuds !== scene.drawnLift
		) {
			scene.redraw = false;
			scene.drawnShown = shown;
			scene.drawnOpen = c.open;
			scene.drawnLift = c.liftStuds;
			const show = c.open ? scene.opened : scene.closed;
			hidePieceBody(c.open ? scene.closed : scene.opened);
			if (!shown) hidePieceBody(show);
			else {
				const origin = c.liftStuds !== 0 ? scene.rest.add(new Vector3(0, c.liftStuds, 0)) : scene.rest;
				placePieceBody(show, origin, this.basis, dtSec, scene.plan.fx, scene.plan.fz);
			}
		}
		const pos = scene.rest.Position;
		if (c.popEdge) {
			if (partySize(state) <= 1) this.sim.hitstop.request(TREASURE_VIEW.open.freezeMs, settings);
			this.freeze.requestNudge("stamp");
			const x = gridToWorld(scene.plan.chestX);
			const z = gridToWorld(scene.plan.chestY);
			this.particles.treasureBurst(
				x,
				z,
				look.tier,
				burstSeed(scene.plan.crackSlot, state.tick, TREASURE_VIEW.open.seedSalt),
			);
		}
		if (c.column.shown || scene.columnOn) {
			scene.columnOn = c.column.shown;
			const color = this.theme.getPack().color(treasureFloorRole(math.max(0, look.tier)));
			drawTreasureColumn(
				scene.column,
				c.column,
				pos,
				color,
				c.openAge,
				this.preload.isArtReady(TREASURE_COLUMN_FX_ID),
			);
		}
	}

	/** The view player's reward cards under `Secret cache`, on the open's age (the chest tracker's). */
	private drawCards(scene: SecretScene, look: Readonly<SecretLook>, reduced: boolean): void {
		const t = scene.taken;
		const age = scene.chestLook.openAge;
		if (t === undefined || age === math.huge) {
			for (const card of scene.cards) hideTreasureCard(card);
			hideTreasureCard(scene.title);
			return;
		}
		const pack = this.theme.getPack();
		const view = this.sim.getViewPlayerIndex();
		if (view !== scene.cardsPlayer || t !== scene.cardsFor) {
			scene.cardsFor = t;
			const s = (k: string, vars?: Readonly<Record<string, string | number>>) => pack.str(k, vars);
			const texts = secretRewardTexts(s, t, view);
			scene.cardsPlayer = view;
			scene.cardTexts = [...texts.cards];
			scene.titleText = texts.title;
			for (const card of scene.cards) card.text = "";
			scene.title.text = "";
		}
		const O = TREASURE_VIEW.open;
		const at = floorPoint(gridToWorld(scene.plan.chestX), gridToWorld(scene.plan.chestY));
		const tier = math.max(0, look.tier);
		const tierColor = pack.color(treasureUiRole(tier));
		const n = math.min(scene.cardTexts.size(), scene.cards.size());
		for (let i = 0; i < scene.cards.size(); i++) {
			const cardView = scene.cards[i];
			if (i >= n) {
				hideTreasureCard(cardView);
				continue;
			}
			const card = scene.cardTexts[i];
			rewardCardAt(age, i, reduced, this.cardLook);
			const color = card.kind === "points" ? pack.color(TREASURE_VIEW.pointsRole) : tierColor;
			const up = O.cardBaseStuds + (n - 1 - i) * O.cardRowStuds + this.cardLook.riseTiles * S;
			drawTreasureCard(cardView, at, card.text, O.cardScale, up, this.cardLook.alpha, color);
		}
		openLineAt(age, reduced, this.cardLook);
		const up = O.cardBaseStuds - O.cardRowStuds + this.cardLook.riseTiles * S;
		drawTreasureCard(scene.title, at, scene.titleText, O.lineScale, up, this.cardLook.alpha, tierColor);
	}

	private onLocale(): void {
		const scene = this.scene;
		if (scene === undefined) return;
		const font = currentHudFont();
		for (const c of scene.cards) c.label.Font = font;
		scene.title.label.Font = font;
		scene.cardsFor = undefined; // re-read in the new language on the next frame
	}

	// --- KV_SecretLabel -----------------------------------------------------------------------------------

	private readDebug(): void {
		const allowed = RunService.IsStudio() || Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.debugOn = allowed && Workspace.GetAttribute(RUN_ATTRIBUTES.secretLabel) === true;
		const scene = this.scene;
		if (!this.debugOn && scene?.debug !== undefined) {
			scene.debug.folder.Destroy();
			scene.debug = undefined;
		}
	}

	private drawDebug(scene: SecretScene, state: Readonly<SimState>): void {
		if (!this.debugOn) return;
		if (scene.debug === undefined) scene.debug = this.buildDebug(scene);
		const status = secretMatchesPlan(state, scene.plan) ? state.secrets!.status : SecretStatus.NONE;
		const text = secretLabelText(scene.plan, status, scene.charger);
		if (scene.debug.label.Text !== text) scene.debug.label.Text = text;
	}

	private buildDebug(scene: SecretScene): { readonly folder: Folder; readonly label: TextLabel } {
		const D = V.debug;
		const pack = this.theme.getPack();
		const folder = scene.janitor.Add(new Instance("Folder"));
		folder.Name = "SecretDebug";
		const plan = scene.plan;
		const r = secretCrackRect(plan);
		const crack: CellRect = { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 };
		const chamber: CellRect = { x0: plan.x0, y0: plan.y0, x1: plan.x0 + plan.w - 1, y1: plan.y0 + plan.h - 1 };
		outlineBox(folder, "Crack", crack, pack.color(D.crackRole));
		outlineBox(folder, "Chamber", chamber, pack.color(D.chamberRole));
		outlineBox(folder, "Ring", secretRingRect(plan), pack.color(D.chamberRole));
		outlineBox(folder, "FrontBox", secretFrontBox(plan), pack.color(D.frontRole));
		const c = secretCrackCentre(plan);
		const anchor = anchorPart(folder, "SecretLabel");
		anchor.CFrame = new CFrame(studsX(c.x), floorStudsY(), studsZ(c.z));
		const gui = createKvBillboardGui("SecretLabel");
		gui.Size = UDim2.fromOffset(D.widthPx, D.heightPx);
		gui.StudsOffsetWorldSpace = new Vector3(0, D.liftStuds, 0);
		gui.AlwaysOnTop = true;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = DEV_MONO_FONT;
		label.TextSize = D.textSize;
		label.TextColor3 = pack.color(D.textRole);
		label.TextStrokeTransparency = 0;
		label.Parent = gui;
		gui.Parent = anchor;
		folder.Parent = scene.folder;
		return { folder, label };
	}
}

/** An invisible anchor Part (a billboard's Adornee) in `parent`, parked. */
function anchorPart(parent: Instance, name: string): Part {
	const anchor = renderPart("Part", false);
	anchor.Name = name;
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = TREASURE_PARKED;
	anchor.Parent = parent;
	return anchor;
}

/** The crack / rubble art's frame: a one-facing sprites set's idle frames (its variants) or an image; undefined: none. */
function overlayArt(pack: ThemePack, id: string): OverlayArt | undefined {
	if (!pack.has(id)) return undefined;
	const set = pack.sprites(id);
	if (set !== undefined) {
		const count = math.max(1, set.animation("idle")?.frames ?? 1);
		const frames = new Array<OverlayFrame>();
		for (let i = 0; i < count; i++) {
			const f = set.frame("idle", 0, i);
			frames.push({ image: f.image, offset: f.offset, size: f.size });
		}
		return { frames };
	}
	const image = pack.image(id);
	if (image === undefined) return undefined;
	const rect = image.rect;
	return {
		frames: [
			{
				image: image.assetId,
				offset: rect !== undefined ? new Vector2(rect.x, rect.y) : Vector2.zero,
				size: rect !== undefined ? new Vector2(rect.w, rect.h) : new Vector2(image.w, image.h),
			},
		],
	};
}

/** The dust flipbook (`fx.secret.dust`), when the pack has it. */
function dustArt(pack: ThemePack): FxSprite | undefined {
	return pack.has(SECRET_DUST_FX_ID) ? pack.fx(SECRET_DUST_FX_ID) : undefined;
}

/**
 * A SurfaceGui on `face` of `part` (`wTiles` x `hTiles` on the canvas; `turned`: the art runs along the canvas's
 * height, a quarter turn) drawing the art's `frame` in `tint`, or without art a band of `tint` across the face's middle
 * (SECRET_VIEW.crack.bandShare of its height).
 */
function overlaySurface(
	part: Part,
	face: Enum.NormalId,
	wTiles: number,
	hTiles: number,
	turned: boolean,
	frame: OverlayFrame | undefined,
	tint: Color3,
): void {
	const C = V.crack;
	const gui = createKvSurfaceGui("SecretCrack");
	gui.Face = face;
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud;
	gui.PixelsPerStud = C.pixelsPerStud;
	gui.LightInfluence = C.lightInfluence;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	gui.ClipsDescendants = true;
	const ratio = hTiles / wTiles;
	const size = turned ? UDim2.fromScale(ratio, 1 / ratio) : UDim2.fromScale(1, 1);
	if (frame !== undefined) {
		const label = new Instance("ImageLabel");
		label.Name = "Overlay";
		label.AnchorPoint = CENTRE;
		label.Position = UDim2.fromScale(HALF, HALF);
		label.Size = size;
		label.Rotation = turned ? QUARTER_TURN_DEG : 0;
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Image = frame.image;
		label.ImageRectSize = frame.size;
		label.ImageRectOffset = frame.offset;
		label.ImageColor3 = tint;
		label.ResampleMode = Enum.ResamplerMode.Pixelated;
		label.Parent = gui;
	} else {
		const band = new Instance("Frame");
		band.Name = "Band";
		band.AnchorPoint = CENTRE;
		band.Position = UDim2.fromScale(HALF, HALF);
		band.Size = turned ? UDim2.fromScale(C.bandShare, 1) : UDim2.fromScale(1, C.bandShare);
		band.BorderSizePixel = 0;
		band.BackgroundColor3 = tint;
		band.BackgroundTransparency = C.bandTransparency;
		band.Parent = gui;
	}
	gui.Parent = part;
}

/** A KV_SecretLabel outline: an invisible box over the cells of `r` carrying a SelectionBox in `color`. */
function outlineBox(parent: Instance, name: string, r: Readonly<CellRect>, color: Color3): void {
	const D = V.debug;
	const w = r.x1 - r.x0 + 1;
	const h = r.y1 - r.y0 + 1;
	const part = renderPart("Part", false);
	part.Name = name;
	part.Transparency = HIDDEN;
	part.Size = new Vector3(w * S, D.heightStuds, h * S);
	part.CFrame = new CFrame(studsX(r.x0 + (w - 1) / 2), floorStudsY() + D.heightStuds / 2, studsZ(r.y0 + (h - 1) / 2));
	const box = new Instance("SelectionBox");
	box.Adornee = part;
	box.Color3 = color;
	box.LineThickness = D.outlineStuds;
	box.SurfaceTransparency = HIDDEN;
	box.Parent = part;
	part.Parent = parent;
}
