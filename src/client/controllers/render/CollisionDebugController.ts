import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { worldToGrid, type Dungeon } from "shared/dungeon";
import { RUN_ATTRIBUTES } from "shared/play";
import { PLAYER_RADIUS, partySize, playerAt, solidCells, type SimState } from "shared/sim";
import type { ColorRole } from "shared/theme";
import {
	COLLISION_DEBUG,
	RENDER_ORDER,
	StallDetector,
	blockingCellsNear,
	floorStudsY,
	inputMagnitude,
	lerp,
	stallLine,
	studsX,
	studsZ,
} from "shared/view";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "./placeholders";

const HIDDEN = 1;
/** A CylinderHandleAdornment's axis is its Z: turn it to Y (a flat ring on the floor). */
const FLAT = CFrame.Angles(math.pi / 2, 0, 0);
/** No cell drawn yet (forces the first layout). */
const NONE = math.huge;

/** One floor's overlay: everything here is owned by `janitor` (destroyed when the overlay turns off or the floor changes). */
interface Scene {
	readonly janitor: Janitor;
	readonly dungeon: Dungeon;
	/** Invisible anchor at the sim origin on the floor: the adornments' CFrames are sim offsets in studs from it. */
	readonly anchor: Part;
	/** Pooled cell squares (hidden past the current layout's count). */
	readonly cells: BoxHandleAdornment[];
	readonly ring: CylinderHandleAdornment;
	/** The layout drawn: the watched player's cell, the intact breakables' count, the cells shown. */
	gx: number;
	gy: number;
	intact: number;
	shown: number;
	stalled: boolean;
}

/**
 * KV_CollisionDebug (docs/WALL_SLIDE.md WS6; logic and tunables in shared/view collisionDebug.ts / COLLISION_DEBUG).
 * A Studio check aid, off by default: on in Studio or with KV_Debug, while the Workspace boolean attribute is true.
 * Around the WATCHED player (SimController.getViewPlayerIndex: the spectated teammate after death in co-op) it draws:
 *
 *   blocking cells  every cell within COLLISION_DEBUG.cellRadiusTiles of the player's cell that stops the body (a
 *                   non-FLOOR tile of the floor's Dungeon, or an intact breakable: shared/sim solidCells), as a thin
 *                   translucent square in cellRole; isolated 1x1 blockers (pillars, lone crates) in isolatedRole
 *   body circle     a ring of PLAYER_RADIUS at the interpolated position, in ringRole
 *   stall flash     the ring turns stallRole while StallDetector reports a stall (the local player's input held,
 *                   the body not moving), and one `[collision] stall ...` line is printed per episode. A spectated
 *                   teammate's input is not known here, so the flash covers the local player only.
 *
 * Pieces are HandleAdornments (always on top) under one invisible anchor Part in a Workspace folder; nothing exists
 * while the overlay is off. The render step and the scene are owned by Janitors: turning the attribute off destroys
 * everything, a new floor / run / run exit destroys the scene (rebuilt on the next frame). The cell layout is
 * recomputed only when the player's cell or the breakables' intact count changes. Read-only on the sim.
 */
@Controller({})
export class CollisionDebugController implements OnStart {
	private readonly janitor = new Janitor();
	/** While the overlay is on: the render step binding and the scene's cleanup. */
	private overlay: Janitor | undefined;
	private scene: Scene | undefined;
	private readonly detector = new StallDetector();

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		const reset = () => this.clearScene();
		this.sim.onRunStarted(reset);
		this.sim.onRunExited(reset);
		this.sim.onFloorChanged(reset);
		this.janitor.Add(Workspace.GetAttributeChangedSignal(COLLISION_DEBUG.attribute).Connect(() => this.read()));
		this.janitor.Add(Workspace.GetAttributeChangedSignal(RUN_ATTRIBUTES.debug).Connect(() => this.read()));
		this.janitor.Add(() => this.stop(), true);
		this.read();
	}

	/** KV_CollisionDebug: on in Studio or with KV_Debug, while the Workspace attribute is true. */
	private read(): void {
		const allowed = RunService.IsStudio() || Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		const on = allowed && Workspace.GetAttribute(COLLISION_DEBUG.attribute) === true;
		if (on === (this.overlay !== undefined)) return;
		if (on) this.start();
		else this.stop();
	}

	private start(): void {
		const overlay = new Janitor();
		this.overlay = overlay;
		RunService.BindToRenderStep(
			COLLISION_DEBUG.renderStep,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => this.frame(),
		);
		overlay.Add(() => RunService.UnbindFromRenderStep(COLLISION_DEBUG.renderStep), true);
		overlay.Add(() => this.clearScene(), true);
		print(`[collision] ${COLLISION_DEBUG.attribute} on`);
	}

	private stop(): void {
		const overlay = this.overlay;
		if (overlay === undefined) return;
		this.overlay = undefined;
		overlay.Destroy();
	}

	/** The scene goes (rebuilt on the next frame while on), and the stall detector forgets. */
	private clearScene(): void {
		this.detector.reset();
		const scene = this.scene;
		if (scene === undefined) return;
		this.scene = undefined;
		scene.janitor.Destroy();
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		const d = ctx?.dungeon;
		if (ctx === undefined || d === undefined) {
			this.clearScene();
			return;
		}
		const state = ctx.run.state;
		const viewIndex = this.sim.getViewPlayerIndex();
		if (viewIndex < 0 || viewIndex >= partySize(state)) {
			this.clearScene();
			return;
		}
		if (this.scene !== undefined && this.scene.dungeon !== d) this.clearScene();
		const scene = this.scene ?? this.buildScene(d);
		const p = playerAt(state, viewIndex);

		// The blocking cells around the player's cell (only when it or the breakables changed).
		const gx = worldToGrid(p.x);
		const gy = worldToGrid(p.z);
		const intact = state.breakables?.intact ?? 0;
		if (gx !== scene.gx || gy !== scene.gy || intact !== scene.intact) {
			scene.gx = gx;
			scene.gy = gy;
			scene.intact = intact;
			this.layoutCells(scene, d, gx, gy, state);
		}

		// The stall flash: the local player's input only (a spectated teammate's is not known on this client).
		const input = this.sim.getFrameInput();
		const ownInput = viewIndex === this.sim.getLocalPlayerIndex() && p.dead === 0;
		const magnitude = ownInput ? inputMagnitude(input.moveX, input.moveZ) : 0;
		if (this.detector.update(state.tick, p.x, p.z, magnitude)) print(stallLine(p.x, p.z, input.moveX, input.moveZ));
		const stalled = this.detector.isStalled();
		if (stalled !== scene.stalled) {
			scene.stalled = stalled;
			scene.ring.Color3 = this.color(stalled ? COLLISION_DEBUG.stallRole : COLLISION_DEBUG.ringRole);
		}

		const alpha = this.sim.getAlpha();
		const x = lerp(p.prevX, p.x, alpha);
		const z = lerp(p.prevZ, p.z, alpha);
		scene.ring.CFrame = new CFrame(x * STUDS_PER_TILE, COLLISION_DEBUG.ringLiftStuds, z * STUDS_PER_TILE).mul(FLAT);
	}

	private color(role: ColorRole): Color3 {
		return this.theme.getPack().color(role);
	}

	private buildScene(d: Dungeon): Scene {
		const v = COLLISION_DEBUG;
		const janitor = new Janitor();
		const folder = new Instance("Folder");
		folder.Name = v.folderName;
		janitor.Add(folder);
		const anchor = renderPart("Part", false);
		anchor.Name = "CollisionDebugAnchor";
		anchor.Transparency = HIDDEN;
		anchor.Size = Vector3.one;
		anchor.CFrame = new CFrame(studsX(0), floorStudsY(), studsZ(0));
		anchor.Parent = folder;

		const radius = PLAYER_RADIUS * STUDS_PER_TILE;
		const ring = new Instance("CylinderHandleAdornment");
		ring.Name = "Body";
		ring.Radius = radius;
		ring.InnerRadius = math.max(0, radius - v.ringWidthStuds);
		ring.Height = v.ringThicknessStuds;
		ring.Color3 = this.color(v.ringRole);
		ring.Transparency = v.ringTransparency;
		ring.AlwaysOnTop = v.alwaysOnTop;
		ring.ZIndex = v.ringZIndex;
		ring.Adornee = anchor;
		ring.Parent = anchor;
		folder.Parent = Workspace;

		const scene: Scene = {
			janitor,
			dungeon: d,
			anchor,
			cells: [],
			ring,
			gx: NONE,
			gy: NONE,
			intact: -1,
			shown: 0,
			stalled: false,
		};
		this.scene = scene;
		return scene;
	}

	/** Lays out the squares for the cells around (gx, gy): pooled adornments reused, the extra ones hidden. */
	private layoutCells(scene: Scene, d: Dungeon, gx: number, gy: number, state: Readonly<SimState>): void {
		const v = COLLISION_DEBUG;
		const list = blockingCellsNear(d, gx, gy, solidCells(state));
		const side = (1 - v.cellInsetTiles) * STUDS_PER_TILE;
		const cellColor = this.color(v.cellRole);
		const isolatedColor = this.color(v.isolatedRole);
		for (let i = 0; i < list.size(); i++) {
			const c = list[i];
			let box = scene.cells[i];
			if (box === undefined) {
				box = new Instance("BoxHandleAdornment");
				box.Name = "Cell";
				box.Size = new Vector3(side, v.cellThicknessStuds, side);
				box.Transparency = v.cellTransparency;
				box.AlwaysOnTop = v.alwaysOnTop;
				box.ZIndex = v.cellZIndex;
				box.Adornee = scene.anchor;
				box.Parent = scene.anchor;
				scene.cells.push(box);
			}
			box.CFrame = new CFrame(c.gx * STUDS_PER_TILE, v.cellLiftStuds, c.gy * STUDS_PER_TILE);
			box.Color3 = c.isolated ? isolatedColor : cellColor;
			box.Visible = true;
		}
		for (let i = list.size(); i < scene.shown; i++) scene.cells[i].Visible = false;
		scene.shown = list.size();
	}
}
