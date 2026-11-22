import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import { clientStore, selectInputDevice, selectJuice } from "client/store";
import {
	GAME_CAMERA,
	RENDER_ORDER,
	SPECTATE,
	cameraFraming,
	cameraPosition,
	degToRad,
	floorStudsY,
	followAlpha,
	isoBasis,
	lerp,
	snapToGrid,
	studsX,
	studsZ,
	type Vec3,
} from "shared/view";
import { motionScale } from "shared/view/fx";
import { FreezeFrameController } from "../fx/FreezeFrameController";
import { SimController } from "./SimController";

const RENDER_STEP = "KV_GameCamera";

/**
 * The iso camera rig from spike B (docs/SPIKES.md), on the live run: a Scriptable camera at the web build's yaw /
 * pitch with a narrow FOV (GAME_CAMERA.fovDeg) placed far enough away to show VIEW_TILES_HIGH tiles on the screen's
 * short side (docs/PORTRAIT.md: shared/view cameraFraming, read from the viewport every frame, so a phone turning
 * reframes at once; upright on touch the player is lifted above the thumbs' band),
 * following the player's INTERPOLATED sim position with exponential damping and snapping to the render-texel grid
 * (web IsoCamera). Snaps straight to the player at every run start.
 * The freeze frame's whole-render-pixel nudge (boss phase / death, player hurt, heavy hits; off when screenShakeOn is
 * false: the Screen shake setting or reduced motion) is added after the snap.
 *
 * Co-op spectating (docs/SPECTATE.md): it follows SimController.getViewPlayerIndex(). When that index changes the
 * camera snaps to the new player if they are farther than SPECTATE.snapBeyondTiles from the focus or under reduced
 * motion, else glides there (damping SPECTATE.glideTauSec) for SPECTATE.glideSettleSec, then follows as usual.
 */
@Controller({})
export class CameraController implements OnStart {
	private focus: Vec3 | undefined;
	/** The player index the camera followed last frame (undefined: none yet this run / floor). */
	private viewIndex: number | undefined;
	/** Seconds left of a spectate switch's glide to the newly watched player (0: none running). */
	private glideLeft = 0;

	constructor(private readonly sim: SimController, private readonly freeze: FreezeFrameController) {}

	onStart(): void {
		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		const grid = GAME_CAMERA.snapTexels * (STUDS_PER_TILE / PIXELS_PER_TILE);
		const right = new Vector3(basis.right[0], basis.right[1], basis.right[2]);
		const up = new Vector3(basis.up[0], basis.up[1], basis.up[2]);

		this.sim.onRunStarted(() => this.snapNext()); // snap on the next frame
		// Endless mode: the player arrives at the next floor's entrance; snap there instead of gliding across.
		this.sim.onFloorChanged(() => this.snapNext());

		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.cameraAfterCamera,
			(rawDt) => {
				const camera = Workspace.CurrentCamera;
				const state = this.sim.getState();
				if (camera === undefined || state === undefined) return;
				const dt = math.min(math.max(rawDt, 0), GAME_CAMERA.maxFollowDtSec);
				// Co-op: this client's player, or the teammate it watches while spectating.
				const index = this.sim.getViewPlayerIndex();
				// docs/LOCAL_PREDICTION.md LP5: as drawn (the predicted local player; the merged one otherwise).
				const p = this.sim.getDrawnPlayer(state, index);
				const alpha = this.sim.getAlpha();
				const tx = studsX(lerp(p.prevX, p.x, alpha));
				const tz = studsZ(lerp(p.prevZ, p.z, alpha));
				const y = floorStudsY();
				if (index !== this.viewIndex) {
					if (this.viewIndex !== undefined) this.startSwitch(tx, tz);
					this.viewIndex = index;
				}
				let focus = this.focus;
				if (focus === undefined) {
					focus = [tx, y, tz];
					this.glideLeft = 0;
				} else {
					const tau = this.glideLeft > 0 ? SPECTATE.glideTauSec : GAME_CAMERA.followTauSec;
					this.glideLeft = math.max(this.glideLeft - dt, 0);
					const a = followAlpha(dt, tau);
					focus = [focus[0] + (tx - focus[0]) * a, y, focus[2] + (tz - focus[2]) * a];
				}
				this.focus = focus;
				const vp = camera.ViewportSize;
				const touch = selectInputDevice(clientStore.getState()) === "touch";
				const framing = cameraFraming(vp.X, vp.Y, touch);
				let eye = cameraPosition(focus, basis, framing.distance);
				if (framing.liftTiles > 0) {
					// Down the camera's up axis: the followed player shows liftTiles above the screen's centre (PD5).
					const lift = framing.liftTiles * STUDS_PER_TILE;
					const u = basis.up;
					eye = [eye[0] - u[0] * lift, eye[1] - u[1] * lift, eye[2] - u[2] * lift];
				}
				if (grid > 0) eye = snapToGrid(eye, basis, grid);
				const nudge = this.freeze.getNudge();
				if (nudge.x !== 0 || nudge.y !== 0) {
					const texel = STUDS_PER_TILE / PIXELS_PER_TILE;
					const r = basis.right;
					const u = basis.up;
					const ox = (r[0] * nudge.x + u[0] * nudge.y) * texel;
					const oy = (r[1] * nudge.x + u[1] * nudge.y) * texel;
					const oz = (r[2] * nudge.x + u[2] * nudge.y) * texel;
					eye = [eye[0] + ox, eye[1] + oy, eye[2] + oz];
				}
				camera.CameraType = Enum.CameraType.Scriptable;
				camera.FieldOfView = framing.fovDeg;
				camera.CFrame = CFrame.fromMatrix(new Vector3(eye[0], eye[1], eye[2]), right, up);
				camera.Focus = new CFrame(focus[0], focus[1], focus[2]);
			},
		);
	}

	/** Run start / floor change: snap to the followed player on the next frame, no glide. */
	private snapNext(): void {
		this.focus = undefined;
		this.viewIndex = undefined;
		this.glideLeft = 0;
	}

	/** The followed player changed (spectating): snap when far or under reduced motion, else glide to (tx, tz) studs. */
	private startSwitch(tx: number, tz: number): void {
		const focus = this.focus;
		if (focus === undefined) return; // snapping anyway
		const far = distanceTiles(focus, tx, tz) > SPECTATE.snapBeyondTiles;
		if (far || motionScale(selectJuice(clientStore.getState())) <= 0) {
			this.focus = undefined;
			this.glideLeft = 0;
		} else {
			this.glideLeft = SPECTATE.glideSettleSec;
		}
	}
}

/** Floor-plane distance from a camera focus (studs) to (tx, tz) studs, in tiles. */
function distanceTiles(focus: Vec3, tx: number, tz: number): number {
	const dx = tx - focus[0];
	const dz = tz - focus[2];
	return math.sqrt(dx * dx + dz * dz) / STUDS_PER_TILE;
}
