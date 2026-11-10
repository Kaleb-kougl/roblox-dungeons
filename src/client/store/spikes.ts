import { createProducer } from "@rbxts/reflex";
import { BULLET_SPIKE, CAMERA_SPIKE, INVITE_SPIKE, InviteSpikeAction } from "shared/config";

/**
 * Client-local Reflex slice for the Task 1 spikes and the invites spike I0 (docs/SPIKES.md): the settings both the
 * keyboard and the HUD buttons change, and the stats the spike controllers report back for the
 * HUD to show. Nothing here replicates.
 */

export type BulletPattern = "rings" | "spiral";

export interface BulletSpikeStats {
	/** Frames per second over the last stats window. */
	readonly fps: number;
	/** Average ms per frame computing positions + CFrames. */
	readonly computeMs: number;
	/**
	 * Average ms per frame moving the bullets: inside workspace:BulkMoveTo (modes N / A / B), or the ImageLabels'
	 * Position + Rotation writes (mode C, the canvas).
	 */
	readonly moveMs: number;
	/** Average ms per frame of flipbook writes (Decal.Texture or ImageRectOffset, only on a frame change; 0 for N). */
	readonly frameMs: number;
	/** Worst single-frame update (compute + move + frame writes) in the window, ms. */
	readonly worstMs: number;
	/** Enemy bullets actually moved last frame. */
	readonly live: number;
	/** Extra "player" bullets moved last frame (0 unless the +200 option is on). */
	readonly players: number;
	/** Where the sprite modes' art came from: "pack" (ThemePack.bullet) or "engine" (shared/theme SPIKE_ENGINE_TEXTURES). */
	readonly art: string;
}

/** A HUD button press of the invites spike; `seq` grows by one per press so the controller sees repeats. */
export interface InviteSpikeRequest {
	readonly seq: number;
	readonly action: InviteSpikeAction;
}

export interface SpikeState {
	readonly bullets: {
		readonly active: boolean;
		readonly countIndex: number;
		readonly pattern: BulletPattern;
		/** Index into BULLET_SPIKE.modes (PA0: N neon, A decal, B surface, C canvas). */
		readonly modeIndex: number;
		/** The extra BULLET_SPIKE.players.count "player" bullets (their own pool) are on. */
		readonly playerBullets: boolean;
		readonly stats: BulletSpikeStats;
	};
	readonly camera: {
		readonly active: boolean;
		readonly fovIndex: number;
		/** Index into CAMERA_SPIKE.snapTexels, or -1 for no snapping. */
		readonly snapIndex: number;
		readonly autoWalk: boolean;
		/** Current camera distance from the focus point, studs. */
		readonly distance: number;
	};
	readonly invites: {
		readonly active: boolean;
		/** The last INVITE_SPIKE.hudLines log lines of both sides, oldest first. */
		readonly lines: ReadonlyArray<string>;
		readonly request?: InviteSpikeRequest;
	};
	/** The rollback probe (docs/ROLLBACK_SPIKE.md R3, RollbackSpikeController): its one overlay line. */
	readonly rollback: {
		readonly active: boolean;
		readonly line: string;
	};
}

const EMPTY_STATS: BulletSpikeStats = {
	fps: 0,
	computeMs: 0,
	moveMs: 0,
	frameMs: 0,
	worstMs: 0,
	live: 0,
	players: 0,
	art: "",
};

const initialState: SpikeState = {
	bullets: {
		active: false,
		countIndex: BULLET_SPIKE.defaultCountIndex,
		pattern: "rings",
		modeIndex: BULLET_SPIKE.defaultModeIndex,
		playerBullets: false,
		stats: EMPTY_STATS,
	},
	camera: {
		active: false,
		fovIndex: CAMERA_SPIKE.defaultFovIndex,
		snapIndex: -1,
		autoWalk: false,
		distance: 0,
	},
	invites: { active: false, lines: [] },
	rollback: { active: false, line: "" },
};

export const spikesSlice = createProducer(initialState, {
	setBulletsActive: (state, active: boolean) => ({
		...state,
		bullets: { ...state.bullets, active, stats: EMPTY_STATS },
	}),
	setBulletCountIndex: (state, countIndex: number) => ({
		...state,
		bullets: { ...state.bullets, countIndex: math.clamp(countIndex, 0, BULLET_SPIKE.counts.size() - 1) },
	}),
	toggleBulletPattern: (state) => ({
		...state,
		bullets: { ...state.bullets, pattern: state.bullets.pattern === "rings" ? "spiral" : "rings" },
	}),
	setBulletModeIndex: (state, modeIndex: number) => ({
		...state,
		bullets: { ...state.bullets, modeIndex: math.clamp(modeIndex, 0, BULLET_SPIKE.modes.size() - 1) },
	}),
	toggleBulletPlayers: (state) => ({
		...state,
		bullets: { ...state.bullets, playerBullets: !state.bullets.playerBullets },
	}),
	reportBulletStats: (state, stats: BulletSpikeStats) => ({
		...state,
		bullets: { ...state.bullets, stats },
	}),
	setCameraActive: (state, active: boolean) => ({
		...state,
		camera: { ...state.camera, active },
	}),
	cycleFov: (state) => ({
		...state,
		camera: { ...state.camera, fovIndex: (state.camera.fovIndex + 1) % CAMERA_SPIKE.fovs.size() },
	}),
	cycleSnap: (state) => ({
		...state,
		// -1 (off) -> 0 -> 1 -> ... -> last -> -1
		camera: {
			...state.camera,
			snapIndex: state.camera.snapIndex + 1 >= CAMERA_SPIKE.snapTexels.size() ? -1 : state.camera.snapIndex + 1,
		},
	}),
	toggleAutoWalk: (state) => ({
		...state,
		camera: { ...state.camera, autoWalk: !state.camera.autoWalk },
	}),
	reportCameraDistance: (state, distance: number) => ({
		...state,
		camera: { ...state.camera, distance },
	}),
	setInviteSpikeActive: (state, active: boolean) => ({
		...state,
		invites: { active, lines: [] },
	}),
	pushInviteSpikeLine: (state, line: string) => {
		const lines = new Array<string>();
		const old = state.invites.lines;
		const keep = INVITE_SPIKE.hudLines - 1;
		for (let i = math.max(0, old.size() - keep); i < old.size(); i++) lines.push(old[i]);
		lines.push(line);
		return { ...state, invites: { ...state.invites, lines } };
	},
	setRollbackSpikeLine: (state, line: string | undefined) => ({
		...state,
		rollback: { active: line !== undefined, line: line ?? "" },
	}),
	requestInviteSpike: (state, action: InviteSpikeAction) => ({
		...state,
		invites: { ...state.invites, request: { seq: (state.invites.request?.seq ?? 0) + 1, action } },
	}),
});

export const selectBulletSpike = (state: { spikes: SpikeState }) => state.spikes.bullets;
export const selectCameraSpike = (state: { spikes: SpikeState }) => state.spikes.camera;
export const selectInviteSpike = (state: { spikes: SpikeState }) => state.spikes.invites;
export const selectRollbackSpike = (state: { spikes: SpikeState }) => state.spikes.rollback;
export const selectInviteSpikeRequest = (state: { spikes: SpikeState }) => state.spikes.invites.request;
