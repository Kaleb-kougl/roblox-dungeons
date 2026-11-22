import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { logInfo, logWarn } from "client/log";
import { clientStore, selectDisplay } from "client/store";
import { buildScoreRooms } from "shared/sim";
import { ROOM_EDGE_HORDE_ROLE, ROOM_EDGE_ROLES } from "shared/theme";
import { hordeLiveRoom } from "shared/view/pacts";
import {
	RENDER_ORDER,
	ROOM_EDGE_VIEW,
	RoomEdgeState,
	RoomEdgeStates,
	roomEdgeInsetTiles,
	roomEdgeLine,
	roomEdgeLook,
	roomEdges,
	type RoomEdgeLook,
} from "shared/view";
import { motionScale } from "shared/view/fx";
import { FxTrackerController } from "../fx/FxTrackerController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { DashLayer } from "./DashLayer";

const RENDER_STEP = "KV_RoomEdges";
/** this.colors' last entry: `roomEdge.horde`, the live horde room's colour (docs/FORTUNE.md FO7). */
const HORDE_COLOR = ROOM_EDGE_ROLES.size();

/** One room's dashed edge and its fade (docs/ROOM_EDGES.md §4). */
interface RoomLayer {
	readonly room: number;
	readonly layer: DashLayer;
	/** The state faded from and the state shown / faded to. */
	from: RoomEdgeState;
	to: RoomEdgeState;
	/** The colour faded from / to (this.colors index: a state, or HORDE_COLOR for the live horde room). */
	fromColor: number;
	toColor: number;
	/** os.clock() of the last state change. */
	since: number;
}

/**
 * Room edges (docs/ROOM_EDGES.md RE5): a dashed line on the floor wherever a corridor (or another room) meets a room,
 * inner edge on the room's edge, tinted by the room's state. Per floor (`onRunStarted` / `onFloorChanged`, Janitor):
 * shared/view `roomEdges` gives the runs, one static DashLayer per room (ROOM_EDGE_VIEW.dash, SmoothPlastic,
 * `liftStuds` under the tutorial arrow and the markings) is filled once; shared/view `RoomEdgeStates` gives each room's
 * SAFE / WAITING / LIVE from scoring's room records (unscored M1: `buildScoreRooms` at run start), and `roomEdgeLook`
 * the fade and the live pulse (juice `motionScale`). Colours: theme ROOM_EDGE_ROLES; the horde room while its fight
 * is on (docs/FORTUNE.md FO7, shared/view/pacts hordeLiveRoom) `roomEdge.horde` instead of the live colour (the same
 * fade in and out, the live pulse and transparency). Options > Display > Room edges
 * (`DisplaySettings.roomEdges`) takes the folder out of Workspace and skips the frame. Read-only on the sim.
 */
@Controller({})
export class RoomEdgeController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly rooms = new Array<RoomLayer>();
	private readonly look: RoomEdgeLook = { mix: 1, transparency: 0 };
	private readonly line = [0, 0, 0, 0];
	private colors: ReadonlyArray<Color3> = [];
	private states: RoomEdgeStates | undefined;
	private folder: Folder | undefined;
	private enabled = true;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		this.janitor.Add(this.floorJanitor, "Cleanup");
		this.sim.onRunStarted((ctx) => this.build(ctx));
		this.sim.onFloorChanged((ctx) => this.build(ctx));
		this.enabled = selectDisplay(clientStore.getState()).roomEdges;
		this.janitor.Add(clientStore.subscribe(selectDisplay, (d) => this.setEnabled(d.roomEdges)));
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private setEnabled(on: boolean): void {
		if (on === this.enabled) return;
		this.enabled = on;
		if (this.folder !== undefined) this.folder.Parent = on ? Workspace : undefined;
	}

	private build(ctx: RunContext): void {
		this.floorJanitor.Cleanup();
		this.rooms.clear();
		this.states = undefined;
		this.folder = undefined;
		const d = ctx.dungeon;
		if (d === undefined) return; // greybox: no rooms
		const v = ROOM_EDGE_VIEW;
		const pack = this.theme.getPack();
		this.colors = [...ROOM_EDGE_ROLES.map((role) => pack.color(role)), pack.color(ROOM_EDGE_HORDE_ROLE)];
		const folder = this.floorJanitor.Add(new Instance("Folder"));
		folder.Name = v.folderName;
		const edges = roomEdges(d);
		const inset = roomEdgeInsetTiles();
		let dashes = 0;
		for (let room = 0; room < edges.byRoom.size(); room++) {
			const runs = edges.byRoom[room];
			if (runs.size() === 0) continue;
			const layer = new DashLayer(folder, `RoomEdge${room}`, {
				width: v.dash.width,
				height: v.dash.height,
				length: v.dash.length,
				gap: v.dash.gap,
				color: this.colors[RoomEdgeState.SAFE],
				material: Enum.Material[v.material],
				transparency: v.transparency[RoomEdgeState.SAFE],
				liftStuds: v.liftStuds,
			});
			this.floorJanitor.Add(() => layer.destroy(), true);
			layer.begin();
			for (const i of runs) {
				roomEdgeLine(edges.runs[i], inset, this.line);
				layer.seg(this.line[0], this.line[1], this.line[2], this.line[3]);
			}
			layer.finish();
			dashes += layer.poolSize();
			this.rooms.push({
				room,
				layer,
				from: RoomEdgeState.SAFE,
				to: RoomEdgeState.SAFE,
				fromColor: RoomEdgeState.SAFE,
				toColor: RoomEdgeState.SAFE,
				since: -math.huge,
			});
		}
		const state = this.sim.getState();
		let fallback;
		if (state !== undefined && state.score === undefined) {
			if (state.tick !== 0)
				logWarn(`[RoomEdges] unscored run built its room records at tick ${state.tick}, not 0`);
			fallback = buildScoreRooms(state, ctx.config.encounter);
		}
		this.states = new RoomEdgeStates(d.rooms.size(), fallback);
		this.folder = folder;
		folder.Parent = this.enabled ? Workspace : undefined;
		logInfo(
			`[RoomEdges] built ${dashes} dashes, ${edges.runs.size()} runs, ${this.rooms.size()} rooms (${d.name})`,
		);
	}

	private frame(): void {
		const states = this.states;
		if (!this.enabled || states === undefined) return;
		const state = this.sim.getState();
		const ctx = this.sim.getContext();
		if (state === undefined || ctx === undefined || ctx.config.encounter === undefined) return;
		const now = os.clock();
		const shown = states.update(state, ctx.config.encounter);
		const motion = motionScale(this.fx.settings());
		const fadeSec = ROOM_EDGE_VIEW.stateFadeSeconds;
		const horde = hordeLiveRoom(state);
		for (const r of this.rooms) {
			const s = shown[r.room] ?? RoomEdgeState.SAFE;
			const c = r.room === horde && s === RoomEdgeState.LIVE ? HORDE_COLOR : s;
			if (s !== r.to || c !== r.toColor) {
				r.from = r.to;
				r.fromColor = r.toColor;
				r.to = s;
				r.toColor = c;
				r.since = now;
			}
			const fade = fadeSec > 0 ? (now - r.since) / fadeSec : 1;
			const look = roomEdgeLook(r.from, r.to, fade, now, motion, this.look);
			const to = this.colors[r.toColor];
			const color = look.mix >= 1 ? to : this.colors[r.fromColor].Lerp(to, look.mix);
			r.layer.setColor(color);
			r.layer.setTransparency(look.transparency);
		}
	}
}
