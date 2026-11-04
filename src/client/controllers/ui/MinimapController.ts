import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { AssetService, RunService } from "@rbxts/services";
import {
	clientStore,
	selectDisplay,
	selectGameActive,
	selectInputDevice,
	selectMapView,
	selectMenuOpen,
} from "client/store";
import { cornerMapShown, minimapHostFrame, MINIMAP_HOSTS, type MinimapHost } from "client/ui";
import { CAMERA_YAW_DEG } from "shared/config";
import { RoomType, TILE_SIZE, worldToGrid, type WorldXZ } from "shared/dungeon";
import { NO_BOOST, NO_KIND, archetypeAt, buildScoreRooms, partySize, playerAt, type SimState } from "shared/sim";
import { ROOM_EDGE_ROLES, type ColorRole, type ThemePack } from "shared/theme";
import { RENDER_ORDER, RoomEdgeState, RoomEdgeStates, lerp } from "shared/view";
import {
	FogOfWar,
	FogState,
	MAP_NO_CELL,
	MINIMAP_VIEW,
	createMinimapBuffer,
	gridImageLayout,
	minimapBasis,
	minimapTiles,
	paintAll,
	paintCells,
	worldToMap,
	type FogSource,
	type GridImageLayout,
	type MapPoint,
	type MinimapBasis,
	type MinimapPalette,
	type MinimapRgb,
	type MinimapTiles,
} from "shared/view/minimap";
import { GOLDEN_VIEW, goldenBlipSlot, isGoldenKind } from "shared/view/golden";
import { InputController } from "../game/InputController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";

const RENDER_STEP = "KV_Minimap";
const HALF = 0.5;
const FULL = 1;
const HIDDEN = 1;
/** A square turned this far is a diamond (corner up). */
const DIAMOND_DEG = 45;
/** Draw order inside a map layer (ZIndex, Sibling behaviour): the image under every marker, the watched player on top. */
const LAYER_Z = { image: 1, room: 2, stairs: 3, drop: 4, enemy: 5, golden: 6, teammate: 7, self: 8 } as const;

type MarkerShape = "dot" | "diamond" | "square";

/** fill: a solid mark; outlined: solid with the dark edge (markers.outline); hollow: a ring in its own colour. */
type MarkerStyle = "fill" | "outlined" | "hollow";

/** One pooled marker Frame; writes only what changed (size, colour, style, rotation, visibility). */
interface Marker {
	readonly frame: Frame;
	readonly stroke: UIStroke;
	size: number;
	color: Color3 | undefined;
	style: MarkerStyle | undefined;
	rotation: number;
	visible: boolean;
}

function makeMarker(parent: Instance, z: number, shape: MarkerShape): Marker {
	const frame = new Instance("Frame");
	frame.Name = "Marker";
	frame.AnchorPoint = new Vector2(HALF, HALF);
	frame.BorderSizePixel = 0;
	frame.ZIndex = z;
	frame.Visible = false;
	frame.Rotation = shape === "diamond" ? DIAMOND_DEG : 0;
	if (shape === "dot") {
		const corner = new Instance("UICorner");
		corner.CornerRadius = new UDim(HALF, 0);
		corner.Parent = frame;
	}
	const stroke = new Instance("UIStroke");
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	stroke.Enabled = false;
	stroke.Parent = frame;
	frame.Parent = parent;
	return { frame, stroke, size: -1, color: undefined, style: undefined, rotation: frame.Rotation, visible: false };
}

/**
 * Shows `m` at map pixel (u, v) from the host's centre. Placed by Scale, not Offset: a UDim's Offset is an integer, so
 * fractional pixel offsets would be truncated toward zero one by one (the image and each mark differently, so a mark
 * could sit a pixel off its cell). As fractions of the host's size (`invW` / `invH` = 1 / its reference size) they keep
 * every fraction, and the image and the marks are resolved to screen pixels by the same rule. Sizes stay whole Offsets
 * (the marker sizes are whole reference px).
 */
function showMarker(
	m: Marker,
	u: number,
	v: number,
	invW: number,
	invH: number,
	size: number,
	color: Color3,
	style: MarkerStyle,
	outline: Color3,
): void {
	const f = m.frame;
	if (m.size !== size) {
		m.size = size;
		f.Size = new UDim2(0, size, 0, size);
	}
	if (m.color !== color || m.style !== style) {
		m.color = color;
		m.style = style;
		f.BackgroundColor3 = color;
		f.BackgroundTransparency = style === "hollow" ? HIDDEN : 0;
		m.stroke.Enabled = style !== "fill";
		m.stroke.Color = style === "hollow" ? color : outline;
		m.stroke.Thickness = style === "hollow" ? MINIMAP_VIEW.markers.ringStroke : MINIMAP_VIEW.markers.outline;
	}
	f.Position = UDim2.fromScale(HALF + u * invW, HALF + v * invH);
	if (!m.visible) {
		m.visible = true;
		f.Visible = true;
	}
}

function hideMarker(m: Marker): void {
	if (!m.visible) return;
	m.visible = false;
	m.frame.Visible = false;
}

function rotateMarker(m: Marker, deg: number): void {
	if (m.rotation === deg) return;
	m.rotation = deg;
	m.frame.Rotation = deg;
}

function rgbOf(c: Color3): MinimapRgb {
	return { r: c.R, g: c.G, b: c.B };
}

/** The UIScale under the host's ScreenGui (GameHud's useHudScale), 1 when there is none. */
function hudScaleOf(frame: GuiObject): number {
	const gui = frame.FindFirstAncestorOfClass("ScreenGui");
	return gui?.FindFirstChildOfClass("UIScale")?.Scale ?? 1;
}

/** A treasure / shrine room's mark (world centre of its room, its colour role). */
interface RoomMark {
	readonly room: number;
	/** Its centre's grid cell (shown once that cell is not UNKNOWN, or the room was revealed). */
	readonly cell: number;
	readonly x: number;
	readonly z: number;
	readonly role: ColorRole;
}

/** Everything one floor's map owns (built per floor, dropped with the floor Janitor). */
interface FloorMap {
	readonly tiles: MinimapTiles;
	readonly fog: FogOfWar;
	readonly buf: buffer;
	readonly image: EditableImage;
	readonly content: Content;
	readonly size: Vector2;
	readonly palette: MinimapPalette;
	readonly roomLook: Array<MinimapRgb | undefined>;
	/** The RoomEdgeState each room was last painted with (-1: not yet). */
	readonly roomPainted: number[];
	readonly states: RoomEdgeStates | undefined;
	readonly marks: ReadonlyArray<RoomMark>;
	/** The stairwell (endless), world. */
	readonly stair: WorldXZ | undefined;
	/** The floor's centre, world: the full map's centre. */
	readonly centreX: number;
	readonly centreZ: number;
	/** Pixels changed since the last upload. */
	pending: boolean;
	lastWrite: number;
}

/** The markers of one frame, gathered once and drawn into every visible layer (reused arrays). */
interface FrameMarks {
	selfX: number;
	selfZ: number;
	faceX: number;
	faceZ: number;
	mates: number;
	readonly mateX: number[];
	readonly mateZ: number[];
	readonly mateIndex: number[];
	readonly mateDead: boolean[];
	enemies: number;
	readonly enemyX: number[];
	readonly enemyZ: number[];
	readonly enemyBoss: boolean[];
	drops: number;
	readonly dropX: number[];
	readonly dropZ: number[];
	/** The running Goldling on a cell in sight (docs/FORTUNE.md FO8), and where. */
	golden: boolean;
	goldenX: number;
	goldenZ: number;
	stairShown: boolean;
	stairOpen: boolean;
}

/**
 * One drawn map (a host's contents): the shared EditableImage in an ImageLabel (Content.fromObject, pixelated), turned
 * by the camera yaw and placed by gridImageLayout, and the marker pool over it (upright, placed by worldToMap). Built
 * when its host frame appears, destroyed with the floor or when the host goes away (React may already have destroyed
 * its instances with the host: Destroy on a destroyed Instance is a no-op).
 */
class MapLayer {
	readonly root: Frame;
	private readonly image: ImageLabel;
	private readonly selfBody: Marker;
	private readonly selfNose: Marker;
	private readonly mates: Marker[] = [];
	private readonly enemies: Marker[] = [];
	private readonly drops: Marker[] = [];
	private readonly rooms: Marker[] = [];
	private readonly stairs: Marker;
	/** The Goldling's gold blip (docs/FORTUNE.md FO8), over the enemy dots. */
	private readonly golden: Marker;
	private readonly layout: GridImageLayout = {
		centreU: 0,
		centreV: 0,
		width: 0,
		height: 0,
		rotationDeg: 0,
		pxPerTile: 1,
		cos: 1,
		sin: 0,
	};
	private readonly pt: MapPoint = { u: 0, v: 0 };
	private imageW = -1;
	private imageH = -1;
	private imageRotation = math.huge;

	constructor(readonly host: GuiObject, readonly kind: MinimapHost, floor: FloorMap) {
		const root = new Instance("Frame");
		root.Name = "KV_MinimapLayer";
		root.Size = UDim2.fromScale(FULL, FULL);
		root.BackgroundTransparency = HIDDEN;
		root.BorderSizePixel = 0;
		this.root = root;
		const image = new Instance("ImageLabel");
		image.Name = "Map";
		image.AnchorPoint = new Vector2(HALF, HALF);
		image.BackgroundTransparency = HIDDEN;
		image.BorderSizePixel = 0;
		image.ImageContent = floor.content;
		image.ResampleMode = Enum.ResamplerMode.Pixelated;
		image.ImageTransparency = kind === "corner" ? 0 : MINIMAP_VIEW.fullMap.transparency;
		image.ZIndex = LAYER_Z.image;
		image.Parent = root;
		this.image = image;
		for (let i = 0; i < floor.marks.size(); i++) this.rooms.push(makeMarker(root, LAYER_Z.room, "square"));
		this.stairs = makeMarker(root, LAYER_Z.stairs, "diamond");
		this.golden = makeMarker(root, LAYER_Z.golden, "diamond");
		for (let i = 0; i < MINIMAP_VIEW.markerPool; i++) this.enemies.push(makeMarker(root, LAYER_Z.enemy, "dot"));
		this.selfBody = makeMarker(root, LAYER_Z.self, "square");
		this.selfNose = makeMarker(root, LAYER_Z.self, "square");
		root.Parent = host;
	}

	destroy(): void {
		this.root.Destroy();
	}

	/**
	 * Draws the map centred on world (cx, cz) at `ppt` px per tile into a host `hostW` x `hostH` reference px. The image
	 * and every mark are placed by Scale (see showMarker): their map pixels over the host's size.
	 */
	draw(
		floor: FloorMap,
		marks: FrameMarks,
		colors: MinimapColors,
		cx: number,
		cz: number,
		ppt: number,
		hostW: number,
		hostH: number,
		basis: MinimapBasis,
	): void {
		const t = floor.tiles;
		const invW = 1 / hostW;
		const invH = 1 / hostH;
		const layout = gridImageLayout(basis, t.W, t.H, cx, cz, ppt, this.layout);
		const image = this.image;
		const sw = layout.width * invW;
		const sh = layout.height * invH;
		if (sw !== this.imageW || sh !== this.imageH) {
			this.imageW = sw;
			this.imageH = sh;
			image.Size = UDim2.fromScale(sw, sh);
		}
		if (this.imageRotation !== layout.rotationDeg) {
			this.imageRotation = layout.rotationDeg;
			image.Rotation = layout.rotationDeg;
		}
		image.Position = UDim2.fromScale(HALF + layout.centreU * invW, HALF + layout.centreV * invH);

		const m = MINIMAP_VIEW.markers;
		const pt = this.pt;
		const edge = colors.outline;
		// Treasure / shrine marks once their centre cell was seen (through a doorway) or the room revealed.
		for (let i = 0; i < floor.marks.size(); i++) {
			const mark = floor.marks[i];
			const marker = this.rooms[i];
			const seen =
				floor.fog.roomRevealed(mark.room) ||
				(mark.cell >= 0 && mark.cell < t.W * t.H && floor.fog.state(mark.cell) !== FogState.UNKNOWN);
			if (!seen) {
				hideMarker(marker);
				continue;
			}
			worldToMap(basis, mark.x, mark.z, cx, cz, ppt, pt);
			showMarker(marker, pt.u, pt.v, invW, invH, m.room, colors.role(mark.role), "fill", edge);
		}
		// The stairwell once seen (MD4): filled (with the dark edge) when open, hollow while closed.
		if (marks.stairShown && floor.stair !== undefined) {
			worldToMap(basis, floor.stair.x, floor.stair.z, cx, cz, ppt, pt);
			const style = marks.stairOpen ? "outlined" : "hollow";
			showMarker(this.stairs, pt.u, pt.v, invW, invH, m.stairs, colors.stairs, style, edge);
		} else hideMarker(this.stairs);
		// Boost drops in sight (MD14).
		while (this.drops.size() < marks.drops) this.drops.push(makeMarker(this.root, LAYER_Z.drop, "diamond"));
		for (let i = 0; i < this.drops.size(); i++) {
			const marker = this.drops[i];
			if (i >= marks.drops) {
				hideMarker(marker);
				continue;
			}
			worldToMap(basis, marks.dropX[i], marks.dropZ[i], cx, cz, ppt, pt);
			showMarker(marker, pt.u, pt.v, invW, invH, m.boost, colors.boost, "outlined", edge);
		}
		// Enemies and bosses in sight, nearest first (FrameMarks is already capped at the pool).
		for (let i = 0; i < this.enemies.size(); i++) {
			const marker = this.enemies[i];
			if (i >= marks.enemies) {
				hideMarker(marker);
				continue;
			}
			const boss = marks.enemyBoss[i];
			worldToMap(basis, marks.enemyX[i], marks.enemyZ[i], cx, cz, ppt, pt);
			const size = boss ? m.boss : m.enemy;
			showMarker(marker, pt.u, pt.v, invW, invH, size, boss ? colors.boss : colors.enemy, "outlined", edge);
		}
		// The Goldling in sight (docs/FORTUNE.md FO8): a gold diamond with the marks' dark edge, the boost glint's look.
		if (marks.golden) {
			worldToMap(basis, marks.goldenX, marks.goldenZ, cx, cz, ppt, pt);
			showMarker(
				this.golden,
				pt.u,
				pt.v,
				invW,
				invH,
				GOLDEN_VIEW.minimap.sizePx,
				colors.golden,
				"outlined",
				edge,
			);
		} else hideMarker(this.golden);
		// Teammates: a dot in their colour, a hollow ring where a dead one fell.
		while (this.mates.size() < marks.mates) this.mates.push(makeMarker(this.root, LAYER_Z.teammate, "dot"));
		for (let i = 0; i < this.mates.size(); i++) {
			const marker = this.mates[i];
			if (i >= marks.mates) {
				hideMarker(marker);
				continue;
			}
			worldToMap(basis, marks.mateX[i], marks.mateZ[i], cx, cz, ppt, pt);
			const style = marks.mateDead[i] ? "hollow" : "fill";
			showMarker(marker, pt.u, pt.v, invW, invH, m.teammate, colors.teammate(marks.mateIndex[i]), style, edge);
		}
		// The watched player: a diamond turned to the facing with a nose ahead of it.
		worldToMap(basis, marks.selfX, marks.selfZ, cx, cz, ppt, pt);
		const su = pt.u;
		const sv = pt.v;
		const du = marks.faceX * basis.rightX + marks.faceZ * basis.rightZ;
		const dv = -(marks.faceX * basis.upX + marks.faceZ * basis.upZ);
		const len = math.sqrt(du * du + dv * dv);
		const deg = len > 0 ? math.deg(math.atan2(dv, du)) : 0;
		// A square's corner sits at 45 degrees: turned by (facing - 45) one corner points along the facing.
		const turn = deg - DIAMOND_DEG;
		rotateMarker(this.selfBody, turn);
		rotateMarker(this.selfNose, turn);
		showMarker(this.selfBody, su, sv, invW, invH, m.self, colors.self, "fill", edge);
		const k = len > 0 ? m.selfNoseOffset / len : 0;
		showMarker(this.selfNose, su + du * k, sv + dv * k, invW, invH, m.selfNose, colors.self, "fill", edge);
	}
}

/** The marker colours (theme roles, resolved once per floor). */
class MinimapColors {
	self = new Color3();
	enemy = new Color3();
	boss = new Color3();
	stairs = new Color3();
	boost = new Color3();
	/** The Goldling's blip (GOLDEN_VIEW.minimap.role). */
	golden = new Color3();
	/** The marks' dark edge (MINIMAP_VIEW.outlineRole). */
	outline = new Color3();
	private mates: Color3[] = [];
	private readonly byRole = new Map<ColorRole, Color3>();
	private pack: ThemePack | undefined;

	load(pack: ThemePack): void {
		this.pack = pack;
		this.byRole.clear();
		this.self = pack.color("minimap.self");
		this.enemy = pack.color("minimap.enemy");
		this.boss = pack.color("minimap.boss");
		this.stairs = pack.color("minimap.stairs");
		this.boost = pack.color("minimap.boost");
		this.golden = pack.color(GOLDEN_VIEW.minimap.role);
		this.outline = pack.color(MINIMAP_VIEW.outlineRole);
		this.mates = MINIMAP_VIEW.teammateRoles.map((r) => pack.color(r));
	}

	/** Player `index`'s teammate colour (MINIMAP_VIEW.teammateRoles by index). */
	teammate(index: number): Color3 {
		return this.mates[index % this.mates.size()];
	}

	role(r: ColorRole): Color3 {
		let c = this.byRole.get(r);
		if (c === undefined) {
			c = this.pack?.color(r) ?? new Color3();
			this.byRole.set(r, c);
		}
		return c;
	}
}

/**
 * The minimap with fog of war (docs/MINIMAP.md M8 / M9), presentation only (MD1: reads the sim, never writes it).
 *
 * Per floor (`onRunStarted` / `onFloorChanged`, floor Janitor; dungeon floors only, the greybox has no `ctx.dungeon`):
 * shared/view/minimap `minimapTiles` (with the endless floor's stairwell, `ctx.endlessFloor(ctx.floor).layout`), a fresh
 * `FogOfWar` (seeded from state when the floor is attached at tick > 0: a late co-op join, a floor change), a W x H RGBA8
 * buffer painted with `paintAll`, and ONE `EditableImage` (`AssetService:CreateEditableImage`, in a pcall: on failure it
 * warns once and the floor has no map; TODO(docs/MINIMAP.md M0): the §9 screen-space fallback). The image is shown by
 * an ImageLabel per host (Content.fromObject, ResamplerMode.Pixelated, sized W x H x px per tile, turned by the camera
 * yaw: shared/view/minimap gridImageLayout) and destroyed with the floor.
 *
 * Hosts (client/ui/hud minimapHosts): the corner panel's (MinimapPanel; its corner CanvasGroup clips the turned image),
 * the full map overlay's (FullMapOverlay) and the solo pause overlay's (PauseMap). Each gets a MapLayer when its frame
 * appears (rebuilt if React replaced the frame).
 *
 * Every frame (render step `KV_Minimap` after the camera): the fog's sources are the living players' interpolated
 * positions by player index (`false` for a dead or departed one, MD3); the room tints follow shared/view
 * `RoomEdgeStates` (roomEdge.* colours; a room's cells are repainted when its state changes); drained dirty cells are
 * repainted and uploaded with `WritePixelsBuffer` at most MINIMAP_VIEW.writeHz times a second. The corner map centres on
 * `getViewPlayerIndex()` at MINIMAP_VIEW.pxPerTile; the full map centres on the floor, fitted so the turned floor fits
 * its host. Markers (plain Frames, MD8): the watched player's arrow, teammates (MINIMAP_VIEW.teammateRoles by index;
 * dead: hollow), enemies and bosses on IN_SIGHT cells only (nearest first, MINIMAP_VIEW.markerPool), boost drops in
 * sight, the running Goldling's gold blip in sight (docs/FORTUNE.md FO8; never an enemy dot), the stairwell once its cell
 * is not UNKNOWN (hollow while closed), treasure / shrine marks once revealed.
 *
 * The full map: `InputController.onMapAction` toggles Reflex `game.map.open` (opening needs a playing run with no menu
 * open, client/store selectMenuOpen, and an unfrozen sim; closing always works); it closes on a floor change, run over
 * and run exit (the store resets it). Image and marks are placed by Scale of the host (showMarker says why).
 */
@Controller({})
export class MinimapController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly basis = minimapBasis(CAMERA_YAW_DEG);
	private readonly colors = new MinimapColors();
	private readonly layers = new Map<MinimapHost, MapLayer>();
	private readonly sources = new Array<FogSource>();
	private readonly points = new Array<WorldXZ>();
	private readonly candidates = new Array<number>();
	private readonly candidateDist = new Array<number>();
	private readonly byDistance = (a: number, b: number) => this.candidateDist[a] < this.candidateDist[b];
	private readonly marks: FrameMarks = {
		selfX: 0,
		selfZ: 0,
		faceX: 0,
		faceZ: 0,
		mates: 0,
		mateX: [],
		mateZ: [],
		mateIndex: [],
		mateDead: [],
		enemies: 0,
		enemyX: [],
		enemyZ: [],
		enemyBoss: [],
		drops: 0,
		dropX: [],
		dropZ: [],
		golden: false,
		goldenX: 0,
		goldenZ: 0,
		stairShown: false,
		stairOpen: false,
	};
	private readonly hostSize = { w: 0, h: 0 };
	private floor: FloorMap | undefined;
	private warnedCreate = false;
	private warnedWrite = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly input: InputController,
	) {}

	onStart(): void {
		this.janitor.Add(this.floorJanitor, "Cleanup");
		this.sim.onRunStarted((ctx) => this.build(ctx));
		this.sim.onFloorChanged((ctx) => this.build(ctx));
		this.sim.onRunExited(() => this.clear());
		this.janitor.Add(
			this.input.onMapAction(() => this.toggle()),
			true,
		);
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	// --- per floor ---------------------------------------------------------------------------------

	private clear(): void {
		this.floorJanitor.Cleanup();
		this.layers.clear();
		this.floor = undefined;
	}

	private setMap(available: boolean, open: boolean): void {
		clientStore.setMapView({ available, open });
	}

	private build(ctx: RunContext): void {
		this.clear();
		this.setMap(false, false);
		const d = ctx.dungeon;
		if (d === undefined) return; // greybox: no rooms, no map
		const stair =
			ctx.endlessFloor !== undefined && ctx.floor > 0 ? ctx.endlessFloor(ctx.floor).layout.stairwell : undefined;
		const tiles = minimapTiles(d, stair);
		if (tiles.W > MINIMAP_VIEW.maxImageSide || tiles.H > MINIMAP_VIEW.maxImageSide) {
			warn(
				`[Minimap] ${tiles.W} x ${tiles.H} floor is over the ${MINIMAP_VIEW.maxImageSide} px image limit; no map`,
			);
			return;
		}
		const fog = new FogOfWar(tiles);
		const state = this.sim.getState();
		if (state !== undefined && state.tick > 0) fog.seedFromState(state);
		const pack = this.theme.getPack();
		this.colors.load(pack);
		const palette: MinimapPalette = {
			floor: rgbOf(pack.color("minimap.floor")),
			wall: rgbOf(pack.color("minimap.wall")),
			pool: rgbOf(pack.color("minimap.pool")),
			frontier: rgbOf(pack.color("minimap.frontier")),
		};
		// Room looks are only ever indexed (holes are no tint): refreshRooms fills them.
		const roomLook = new Array<MinimapRgb | undefined>();
		const roomPainted = new Array<number>();
		for (let r = 0; r < tiles.roomCells.size(); r++) roomPainted.push(-1);
		let states: RoomEdgeStates | undefined;
		const encounter = ctx.config.encounter;
		if (state !== undefined && encounter !== undefined) {
			const fallback = state.score === undefined ? buildScoreRooms(state, encounter) : undefined;
			states = new RoomEdgeStates(d.rooms.size(), fallback);
		}
		const marks = new Array<RoomMark>();
		for (let r = 0; r < d.rooms.size(); r++) {
			const room = d.rooms[r];
			const role =
				room.type === RoomType.TREASURE
					? MINIMAP_VIEW.roomMarkRoles.treasure
					: room.type === RoomType.SHRINE
					? MINIMAP_VIEW.roomMarkRoles.shrine
					: undefined;
			if (role === undefined) continue;
			const cell = room.cy * tiles.W + room.cx;
			marks.push({ room: r, cell, x: room.cx * TILE_SIZE, z: room.cy * TILE_SIZE, role });
		}
		const buf = createMinimapBuffer(tiles);
		const size = new Vector2(tiles.W, tiles.H);
		const [ok, made] = pcall(() => AssetService.CreateEditableImage({ Size: size }));
		if (!ok || made === undefined) {
			if (!this.warnedCreate) {
				this.warnedCreate = true;
				warn(`[Minimap] CreateEditableImage failed (${tostring(made)}); the minimap is off`);
			}
			return;
		}
		const image = made;
		this.floorJanitor.Add(image, "Destroy");
		this.floorJanitor.Add(() => {
			for (const [, layer] of this.layers) layer.destroy();
			this.layers.clear();
		}, true);
		const floor: FloorMap = {
			tiles,
			fog,
			buf,
			image,
			content: Content.fromObject(image),
			size,
			palette,
			roomLook,
			roomPainted,
			states,
			marks,
			stair,
			centreX: ((tiles.W - 1) / 2) * TILE_SIZE,
			centreZ: ((tiles.H - 1) / 2) * TILE_SIZE,
			pending: true,
			lastWrite: -math.huge,
		};
		if (state !== undefined) this.refreshRooms(floor, state, ctx);
		paintAll(tiles, fog, roomLook, palette, buf);
		fog.drainDirty();
		this.floor = floor;
		this.upload(floor, os.clock(), true);
		if (this.floor !== floor) return; // the first upload failed
		this.setMap(true, false);
		print(`[Minimap] ${tiles.W} x ${tiles.H} map, ${tiles.roomCells.size()} rooms (${d.name})`);
	}

	// --- full map toggle ----------------------------------------------------------------------------

	private toggle(): void {
		const store = clientStore.getState();
		const map = selectMapView(store);
		if (this.floor === undefined || !map.available) return;
		if (map.open) {
			this.setMap(true, false);
			return;
		}
		// Opening only over live play: no menu owning the controls (pause / party overlay, menu screens, panels, the
		// run-over panel, the tutorial outro: selectMenuOpen) and not while the finished tutorial run is frozen. So M
		// under the solo pause overlay never leaves the map open for after Resume (closing always works).
		if (!selectGameActive(store) || store.game.snapshot.outcome !== "playing" || selectMenuOpen(store)) return;
		if (this.sim.isFrozen()) return;
		this.setMap(true, true);
	}

	// --- per frame ----------------------------------------------------------------------------------

	private frame(): void {
		const floor = this.floor;
		if (floor === undefined) return;
		const state = this.sim.getState();
		const ctx = this.sim.getContext();
		if (state === undefined || ctx === undefined) return;
		const store = clientStore.getState();
		const map = selectMapView(store);
		const outcome = store.game.snapshot.outcome;
		if (map.open && outcome !== "playing") this.setMap(true, false);

		const alpha = this.sim.getAlpha();
		this.updateFog(floor, state, alpha);
		this.refreshRooms(floor, state, ctx);
		const dirty = floor.fog.drainDirty();
		if (dirty.size() > 0) {
			paintCells(floor.tiles, floor.fog, floor.roomLook, floor.palette, dirty, floor.buf);
			floor.pending = true;
		}
		this.upload(floor, os.clock(), false);
		if (this.floor !== floor) return; // the upload failed and dropped the map

		this.syncLayers(floor);
		const corner = this.layers.get("corner");
		const touch = selectInputDevice(store) === "touch";
		const cornerOn = corner !== undefined && cornerMapShown(map, selectDisplay(store).minimap, outcome, touch);
		let any = cornerOn;
		for (const [kind] of this.layers) if (kind !== "corner") any = true;
		if (!any) return;
		this.gather(floor, state, alpha);
		const marks = this.marks;
		const size = this.hostSize;
		for (const [kind, layer] of this.layers) {
			if (kind === "corner" && !cornerOn) continue;
			if (!this.measureHost(layer.host)) continue;
			if (kind === "corner") {
				const ppt = MINIMAP_VIEW.pxPerTile;
				layer.draw(floor, marks, this.colors, marks.selfX, marks.selfZ, ppt, size.w, size.h, this.basis);
				continue;
			}
			const ppt = this.fitPxPerTile(floor.tiles);
			layer.draw(floor, marks, this.colors, floor.centreX, floor.centreZ, ppt, size.w, size.h, this.basis);
		}
	}

	/** One fog update from every party slot: a living player's interpolated position, false when dead or gone. */
	private updateFog(floor: FloorMap, state: SimState, alpha: number): void {
		const n = partySize(state);
		const sources = this.sources;
		const points = this.points;
		while (points.size() < n) points.push({ x: 0, z: 0 });
		while (sources.size() > n) sources.pop();
		const left = state.party?.left;
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			if (p.dead !== 0 || (left !== undefined && left[i] === 1)) {
				sources[i] = false;
				continue;
			}
			const pt = points[i];
			pt.x = lerp(p.prevX, p.x, alpha);
			pt.z = lerp(p.prevZ, p.z, alpha);
			sources[i] = pt;
		}
		floor.fog.update(sources);
	}

	/** Room tints from RoomEdgeStates (roomEdge.* by state): a room whose state changed is repainted. */
	private refreshRooms(floor: FloorMap, state: SimState, ctx: RunContext): void {
		const states = floor.states;
		const encounter = ctx.config.encounter;
		if (states === undefined || encounter === undefined) return;
		const shown = states.update(state, encounter);
		const pack = this.theme.getPack();
		for (let r = 0; r < floor.roomPainted.size(); r++) {
			const s = shown[r] ?? RoomEdgeState.SAFE;
			if (floor.roomPainted[r] === s) continue;
			floor.roomPainted[r] = s;
			floor.roomLook[r] = rgbOf(pack.color(ROOM_EDGE_ROLES[s]));
			paintCells(floor.tiles, floor.fog, floor.roomLook, floor.palette, floor.tiles.roomCells[r], floor.buf);
			floor.pending = true;
		}
	}

	/** Uploads the buffer when pixels changed, at most MINIMAP_VIEW.writeHz times a second (`force`: now). */
	private upload(floor: FloorMap, now: number, force: boolean): void {
		if (!floor.pending) return;
		if (!force && now - floor.lastWrite < 1 / MINIMAP_VIEW.writeHz) return;
		floor.pending = false;
		floor.lastWrite = now;
		const [ok, err] = pcall(() => floor.image.WritePixelsBuffer(Vector2.zero, floor.size, floor.buf));
		if (ok) return;
		if (!this.warnedWrite) {
			this.warnedWrite = true;
			warn(`[Minimap] WritePixelsBuffer failed (${tostring(err)}); the minimap is off`);
		}
		this.clear();
		this.setMap(false, false);
	}

	/** A MapLayer in every mounted host; a layer whose host went away (or was replaced) is destroyed. */
	private syncLayers(floor: FloorMap): void {
		for (const kind of MINIMAP_HOSTS) {
			const host = minimapHostFrame(kind);
			const layer = this.layers.get(kind);
			if (layer !== undefined && (layer.host !== host || layer.root.Parent !== host)) {
				layer.destroy();
				this.layers.delete(kind);
			}
			if (host !== undefined && !this.layers.has(kind)) this.layers.set(kind, new MapLayer(host, kind, floor));
		}
	}

	/** The host's size in reference px (AbsoluteSize over the ScreenGui's UIScale) into hostSize; false before layout. */
	private measureHost(host: GuiObject): boolean {
		const scale = hudScaleOf(host);
		const w = host.AbsoluteSize.X / scale;
		const h = host.AbsoluteSize.Y / scale;
		if (!(w > 0) || !(h > 0)) return false;
		this.hostSize.w = w;
		this.hostSize.h = h;
		return true;
	}

	/** The full map's px per tile: the turned W x H floor's bounding box fitted into hostSize (reference px). */
	private fitPxPerTile(tiles: MinimapTiles): number {
		const c = math.abs(math.cos(math.rad(this.basis.rotationDeg)));
		const s = math.abs(math.sin(math.rad(this.basis.rotationDeg)));
		const bw = tiles.W * c + tiles.H * s;
		const bh = tiles.W * s + tiles.H * c;
		return math.min(this.hostSize.w / bw, this.hostSize.h / bh);
	}

	/** This frame's markers (world positions), shared by every visible layer. */
	private gather(floor: FloorMap, state: SimState, alpha: number): void {
		const marks = this.marks;
		const fog = floor.fog;
		const tiles = floor.tiles;
		const view = this.sim.getViewPlayerIndex();
		const n = partySize(state);
		const left = state.party?.left;
		const me = playerAt(state, math.clamp(view, 0, n - 1));
		marks.selfX = lerp(me.prevX, me.x, alpha);
		marks.selfZ = lerp(me.prevZ, me.z, alpha);
		marks.faceX = me.faceX;
		marks.faceZ = me.faceZ;

		let mates = 0;
		for (let i = 0; i < n; i++) {
			if (i === view || (left !== undefined && left[i] === 1)) continue;
			const p = playerAt(state, i);
			const dead = p.dead !== 0;
			marks.mateX[mates] = dead ? p.x : lerp(p.prevX, p.x, alpha);
			marks.mateZ[mates] = dead ? p.z : lerp(p.prevZ, p.z, alpha);
			marks.mateIndex[mates] = i;
			marks.mateDead[mates] = dead;
			mates++;
		}
		marks.mates = mates;

		// Enemies on cells in sight; bosses first, then nearest to the watched player, at most the pool.
		const cand = this.candidates;
		const dist = this.candidateDist;
		cand.clear();
		const actors = state.combat.actors;
		while (dist.size() < actors.size()) dist.push(0);
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			// The Goldling has its own blip (below), never an enemy dot.
			if (isGoldenKind(a.kind)) continue;
			if (!this.inSight(fog, tiles, a.x, a.z)) continue;
			const dx = a.x - marks.selfX;
			const dz = a.z - marks.selfZ;
			dist[i] = archetypeAt(a.kind).data.boss === true ? -1 : dx * dx + dz * dz;
			cand.push(i);
		}
		if (cand.size() > MINIMAP_VIEW.markerPool) cand.sort(this.byDistance);
		const shown = math.min(cand.size(), MINIMAP_VIEW.markerPool);
		for (let k = 0; k < shown; k++) {
			const a = actors[cand[k]];
			marks.enemyX[k] = lerp(a.prevX, a.x, alpha);
			marks.enemyZ[k] = lerp(a.prevZ, a.z, alpha);
			marks.enemyBoss[k] = dist[cand[k]] < 0;
		}
		marks.enemies = shown;

		let drops = 0;
		const ground = state.drops?.ground;
		if (ground !== undefined) {
			for (const g of ground) {
				if (g.kind === NO_BOOST || !this.inSight(fog, tiles, g.x, g.z)) continue;
				marks.dropX[drops] = g.x;
				marks.dropZ[drops] = g.z;
				drops++;
			}
		}
		marks.drops = drops;

		// The running Goldling on a cell in sight (docs/FORTUNE.md FO8: the boost glint's rule, MD14).
		const gs = goldenBlipSlot(state);
		const ga = gs >= 0 ? actors[gs] : undefined;
		marks.golden = ga !== undefined && this.inSight(fog, tiles, ga.x, ga.z);
		if (ga !== undefined && marks.golden) {
			marks.goldenX = lerp(ga.prevX, ga.x, alpha);
			marks.goldenZ = lerp(ga.prevZ, ga.z, alpha);
		}

		marks.stairShown = tiles.stairCell !== MAP_NO_CELL && fog.state(tiles.stairCell) !== FogState.UNKNOWN;
		marks.stairOpen = state.endless !== undefined && state.endless.stairsOpen !== 0;
	}

	private inSight(fog: FogOfWar, tiles: MinimapTiles, x: number, z: number): boolean {
		const gx = worldToGrid(x);
		const gy = worldToGrid(z);
		if (gx < 0 || gy < 0 || gx >= tiles.W || gy >= tiles.H) return false;
		return fog.state(gy * tiles.W + gx) === FogState.IN_SIGHT;
	}
}
