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
	/** Average ms per frame inside workspace:BulkMoveTo. */
	readonly moveMs: number;
	/** Worst single-frame update (compute + move) in the window, ms. */
	readonly worstMs: number;
	/** Bullets actually moved last frame. */
	readonly live: number;
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
}

const EMPTY_STATS: BulletSpikeStats = { fps: 0, computeMs: 0, moveMs: 0, worstMs: 0, live: 0 };

const initialState: SpikeState = {
	bullets: {
		active: false,
		countIndex: BULLET_SPIKE.defaultCountIndex,
		pattern: "rings",
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
	requestInviteSpike: (state, action: InviteSpikeAction) => ({
		...state,
		invites: { ...state.invites, request: { seq: (state.invites.request?.seq ?? 0) + 1, action } },
	}),
});

export const selectBulletSpike = (state: { spikes: SpikeState }) => state.spikes.bullets;
export const selectCameraSpike = (state: { spikes: SpikeState }) => state.spikes.camera;
export const selectInviteSpike = (state: { spikes: SpikeState }) => state.spikes.invites;
export const selectInviteSpikeRequest = (state: { spikes: SpikeState }) => state.spikes.invites.request;
