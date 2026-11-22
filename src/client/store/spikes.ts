import { createProducer } from "@rbxts/reflex";
import { BULLET_SPIKE, INVITE_SPIKE, InviteSpikeAction } from "shared/config";

/**
 * Client-local Reflex slice for the Task 1 spikes and the invites spike I0 (docs/SPIKES.md): the settings both the
 * keyboard and the HUD buttons change, and the stats the spike controllers report back for the
 * HUD to show. Nothing here replicates.
 */

export type BulletPattern = "rings" | "spiral";

/**
 * The bullet spike's measurements over its last stats window, reported by BulletSpikeController for the spike HUD:
 * frame rate, where the per-frame milliseconds went, and how many bullets moved. All zero (art "") until the first
 * report and whenever the spike is switched on or off.
 */
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

/**
 * The `spikes` slice's state, one group per spike: the bullet spike's settings and stats, and the invites spike's log
 * lines and last button press. The settings are changed from the
 * keyboard and the spike HUD; each spike's controller sets `active` and reports its numbers.
 */
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
	readonly invites: {
		readonly active: boolean;
		/** The last INVITE_SPIKE.hudLines log lines of both sides, oldest first. */
		readonly lines: ReadonlyArray<string>;
		readonly request?: InviteSpikeRequest;
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
	invites: { active: false, lines: [] },
};

/**
 * The spikes slice (state: `SpikeState`, see the file comment). The index setters clamp to their config lists, and
 * switching the invites spike on or off empties its log and drops the last request.
 */
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

/**
 * The bullet spike's group: whether it is running, the indices into `BULLET_SPIKE.counts` and `BULLET_SPIKE.modes`, the
 * pattern, the extra player bullets, and the last stats. BulletSpikeController follows the settings; the spike HUD
 * shows them.
 */
export const selectBulletSpike = (state: { spikes: SpikeState }) => state.spikes.bullets;
/**
 * The invites spike's group: whether it is running, the last `INVITE_SPIKE.hudLines` log lines of both sides (oldest
 * first; empty at first), and the last HUD button press.
 */
export const selectInviteSpike = (state: { spikes: SpikeState }) => state.spikes.invites;
/**
 * The last button press of the invites spike's HUD, undefined before the first and after the spike is switched. Its
 * `seq` grows by one per press, so InviteSpikeController, which subscribes to this, acts on a repeat of the same action
 * too.
 */
export const selectInviteSpikeRequest = (state: { spikes: SpikeState }) => state.spikes.invites.request;
