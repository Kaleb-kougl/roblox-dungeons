import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { ContextActionService, RunService, UserInputService, Workspace } from "@rbxts/services";
import { clientStore, selectCameraSpike } from "client/store";
import {
	CAMERA_PITCH_DEG,
	CAMERA_SPIKE,
	CAMERA_YAW_DEG,
	PIXELS_PER_TILE,
	STUDS_PER_TILE,
	VIEW_TILES_HIGH,
} from "shared/config";
import { cameraPosition, degToRad, distanceForFov, followAlpha, isoBasis, snapToGrid, Vec3 } from "shared/view";
import { watchSpikeFlag } from "./spikeFlags";

const MOVE_ACTION = "KV_SpikeCameraMove";
const RENDER_STEP = "KV_SpikeCamera";
const FOV_KEY = Enum.KeyCode.V; // not F: the game binds F (flask) in CAS and sinks it
const SNAP_KEY = Enum.KeyCode.G;
const AUTO_WALK_KEY = Enum.KeyCode.T;

/** Screen-space direction (x right, y up) for each movement key. */
const MOVE_KEYS = new Map<Enum.KeyCode, readonly [number, number]>([
	[Enum.KeyCode.W, [0, 1]],
	[Enum.KeyCode.Up, [0, 1]],
	[Enum.KeyCode.S, [0, -1]],
	[Enum.KeyCode.Down, [0, -1]],
	[Enum.KeyCode.A, [-1, 0]],
	[Enum.KeyCode.Left, [-1, 0]],
	[Enum.KeyCode.D, [1, 0]],
	[Enum.KeyCode.Right, [1, 0]],
]);

function rgb(color: readonly [number, number, number]): Color3 {
	return Color3.fromRGB(color[0], color[1], color[2]);
}

function block(name: string, size: Vector3, position: Vector3, color: Color3, parent: Instance): Part {
	const part = new Instance("Part");
	part.Name = name;
	part.Size = size;
	part.Position = position;
	part.Color = color;
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.TopSurface = Enum.SurfaceType.Smooth;
	part.BottomSurface = Enum.SurfaceType.Smooth;
	part.Parent = parent;
	return part;
}

/**
 * Spike B (docs/SPIKES.md): does a narrow-FOV perspective camera from far away pass for the web
 * build's orthographic iso view?
 *
 * Scriptable camera at the web build's yaw/pitch (shared/config view.ts), distance chosen so the
 * screen shows VIEW_TILES_HIGH tiles top to bottom at every FOV, following a placeholder
 * character with exponential damping and optional snapping of the camera position to a
 * screen-aligned grid (the web build snaps to its texel grid). WASD / arrows walk the
 * placeholder screen-relative, like the web build; F cycles FOV, G cycles snap, T toggles a
 * circular auto-walk (for touch devices).
 *
 * Off unless `KV_SpikeCamera` (or SPIKE_DEFAULTS.camera) is true; restores the previous camera
 * and removes everything it made when the flag goes false.
 */
@Controller({})
export class CameraSpikeController implements OnStart {
	private session?: Janitor;

	onStart(): void {
		watchSpikeFlag("camera", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		this.session?.Destroy();
		this.session = undefined;
	}

	private start(): void {
		if (this.session) {
			return;
		}
		const camera = Workspace.CurrentCamera;
		if (!camera) {
			return;
		}
		const janitor = new Janitor();
		this.session = janitor;

		clientStore.setCameraActive(true);
		janitor.Add(() => clientStore.setCameraActive(false), true);

		// Restore the camera exactly as we found it.
		const previous = { cameraType: camera.CameraType, fov: camera.FieldOfView, cframe: camera.CFrame };
		janitor.Add(() => {
			camera.CameraType = previous.cameraType;
			camera.FieldOfView = previous.fov;
			camera.CFrame = previous.cframe;
		}, true);

		const folder = new Instance("Folder");
		folder.Name = CAMERA_SPIKE.folderName;
		folder.Parent = Workspace;
		janitor.Add(folder);
		this.buildFloor(folder);

		const [w, h, d] = CAMERA_SPIKE.characterSize;
		const character = block(
			"Placeholder",
			new Vector3(w, h, d),
			new Vector3(0, h / 2, 0),
			rgb(CAMERA_SPIKE.characterColor),
			folder,
		);

		// Movement keys are sunk so the default character controls do not also walk.
		const held = new Set<Enum.KeyCode>();
		const moveKeys = new Array<Enum.KeyCode>();
		MOVE_KEYS.forEach((_, key) => moveKeys.push(key));
		ContextActionService.BindActionAtPriority(
			MOVE_ACTION,
			(_, state, input) => {
				if (state === Enum.UserInputState.Begin) {
					held.add(input.KeyCode);
				} else if (state === Enum.UserInputState.End || state === Enum.UserInputState.Cancel) {
					held.delete(input.KeyCode);
				}
				return Enum.ContextActionResult.Sink;
			},
			false,
			Enum.ContextActionPriority.High.Value,
			...moveKeys,
		);
		janitor.Add(() => ContextActionService.UnbindAction(MOVE_ACTION), true);

		janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				if (processed) {
					return;
				}
				if (input.KeyCode === FOV_KEY) {
					clientStore.cycleFov();
				} else if (input.KeyCode === SNAP_KEY) {
					clientStore.cycleSnap();
				} else if (input.KeyCode === AUTO_WALK_KEY) {
					clientStore.toggleAutoWalk();
				}
			}),
		);

		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		// Screen-up on the ground: the camera's forward, flattened (web: world (-1, 0, -1) / sqrt 2).
		const yaw = degToRad(CAMERA_YAW_DEG);
		const groundUp: Vec3 = [-math.sin(yaw), 0, -math.cos(yaw)];
		const visibleHeight = VIEW_TILES_HIGH * STUDS_PER_TILE;
		const studsPerTexel = STUDS_PER_TILE / PIXELS_PER_TILE;
		const rightVector = new Vector3(basis.right[0], basis.right[1], basis.right[2]);
		const upVector = new Vector3(basis.up[0], basis.up[1], basis.up[2]);

		let settings = selectCameraSpike(clientStore.getState());
		let distance = distanceForFov(CAMERA_SPIKE.fovs[settings.fovIndex], visibleHeight);
		clientStore.reportCameraDistance(distance);
		janitor.Add(
			clientStore.subscribe(selectCameraSpike, (latest) => {
				if (latest.fovIndex !== settings.fovIndex) {
					distance = distanceForFov(CAMERA_SPIKE.fovs[latest.fovIndex], visibleHeight);
					clientStore.reportCameraDistance(distance);
				}
				settings = latest;
			}),
			true,
		);

		let px = 0;
		let pz = 0;
		let focus: Vec3 = [0, 0, 0];
		let walkAngle = 0;

		camera.CameraType = Enum.CameraType.Scriptable;
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + CAMERA_SPIKE.renderPriorityOffset,
			(dt) => {
				// placeholder character
				if (settings.autoWalk) {
					walkAngle += dt * CAMERA_SPIKE.autoWalkRadPerSec;
					px = math.cos(walkAngle) * CAMERA_SPIKE.autoWalkRadiusStuds;
					pz = math.sin(walkAngle) * CAMERA_SPIKE.autoWalkRadiusStuds;
				} else {
					let sx = 0;
					let sy = 0;
					held.forEach((key) => {
						const dir = MOVE_KEYS.get(key);
						if (dir) {
							sx += dir[0];
							sy += dir[1];
						}
					});
					const len = math.sqrt(sx * sx + sy * sy);
					if (len > 0) {
						const step = (CAMERA_SPIKE.walkStuds * dt) / len;
						px += (basis.right[0] * sx + groundUp[0] * sy) * step;
						pz += (basis.right[2] * sx + groundUp[2] * sy) * step;
					}
				}
				character.CFrame = new CFrame(px, h / 2, pz);

				// damped follow of the ground point under the character
				const a = followAlpha(dt, CAMERA_SPIKE.followTauSec);
				focus = [focus[0] + (px - focus[0]) * a, 0, focus[2] + (pz - focus[2]) * a];

				let eye = cameraPosition(focus, basis, distance);
				if (settings.snapIndex >= 0) {
					eye = snapToGrid(eye, basis, CAMERA_SPIKE.snapTexels[settings.snapIndex] * studsPerTexel);
				}
				camera.FieldOfView = CAMERA_SPIKE.fovs[settings.fovIndex];
				camera.CFrame = CFrame.fromMatrix(new Vector3(eye[0], eye[1], eye[2]), rightVector, upVector);
			},
		);
		janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	/** Checker floor of tile-sized slabs plus a pillar grid, so motion, depth and snapping are visible. */
	private buildFloor(parent: Instance): void {
		const half = CAMERA_SPIKE.floorHalfTiles;
		const tile = STUDS_PER_TILE;
		const slab = new Vector3(tile, tile / PIXELS_PER_TILE, tile);
		const colors = CAMERA_SPIKE.floorColors.map(rgb);
		const pillarHeight = CAMERA_SPIKE.pillarHeightTiles * tile;
		const pillarSize = new Vector3(tile, pillarHeight, tile);
		const pillarColor = rgb(CAMERA_SPIKE.pillarColor);
		for (let gx = -half; gx <= half; gx++) {
			for (let gz = -half; gz <= half; gz++) {
				const color = colors[(gx + gz + 2 * half) % colors.size()];
				block("Tile", slab, new Vector3(gx * tile, -slab.Y / 2, gz * tile), color, parent);
				const pillar = gx % CAMERA_SPIKE.pillarEveryTiles === 0 && gz % CAMERA_SPIKE.pillarEveryTiles === 0;
				if (pillar && (gx !== 0 || gz !== 0)) {
					block(
						"Pillar",
						pillarSize,
						new Vector3(gx * tile, pillarHeight / 2, gz * tile),
						pillarColor,
						parent,
					);
				}
			}
		}
	}
}
