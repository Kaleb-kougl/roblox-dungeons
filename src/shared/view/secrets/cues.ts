/**
 * A secret room's sound edges (docs/SECRET_ROOMS.md SR6, Player experience): when the cue mapper (shared/view/audio
 * AudioCueMapper) plays the hollow knock (`sfx.secret.knock`, once per SECRET_VIEW.knock.throttleSec), the crumble at
 * the open (`sfx.secret.open`) and the discovery jingle at the reveal (`sfx.jingle.secret`, reveal.jingleSec after the
 * open). They follow the look's edges (SecretViewTracker, its own instance: the audio never depends on the order the
 * client's render steps run in), so a secret met mid-way is silent. Each edge says whether it is NEAR the listener (the
 * local / view player made it, or stands within SECRET_VIEW.audio.nearTiles of the crack): far ones play at the
 * teammate's volume (a far teammate's open). The chest's open plays the vault's open path: `chestTier` on the frame the
 * lid pops (TREASURE_VIEW.open.popSec after the take, shared/view/treasure popCrossed: the same moment a
 * PedestalChestTracker-drawn chest pops), and the mapper plays it exactly as a vault's (sfx.treasure.open pitched by the
 * tier, a Legendary's jingle). Pure, tested headlessly.
 *
 * @module
 */
import { gridToWorld, type FloorSecret } from "shared/dungeon";
import { SIM_HZ, partySize, playerAt, type SimState } from "shared/sim";
import { NO_TREASURE_OPEN } from "../treasure/cues";
import { popCrossed } from "../treasure/timeline";
import { SECRET_VIEW } from "./config";
import type { SecretFrameSource } from "./events";
import { SecretPhase, SecretViewTracker } from "./look";

/** A frame's secret sound edges (what the cue mapper reads). */
export interface SecretCueSource {
	/** A knock got through the throttle this frame; `knockNear`: the listener's own or within nearTiles. */
	readonly knock: boolean;
	readonly knockNear: boolean;
	/** The crack opened this frame (the crumble); `openNear` as above. */
	readonly open: boolean;
	readonly openNear: boolean;
	/** The reveal fell in this frame (the jingle); near when the open was. */
	readonly jingle: boolean;
	readonly jingleNear: boolean;
	/** The chest's lid popped this frame: its VaultTier (the vault's open cues), else NO_TREASURE_OPEN. */
	readonly chestTier: number;
}

/** No secret sounds (the mapper's default). */
export const NO_SECRET_CUES: SecretCueSource = table.freeze({
	knock: false,
	knockNear: false,
	open: false,
	openNear: false,
	jingle: false,
	jingleNear: false,
	chestTier: NO_TREASURE_OPEN,
});

/** The crack's centre (world, between its cells). */
export function secretCrackCentre(plan: Readonly<FloorSecret>): { x: number; z: number } {
	return {
		x: gridToWorld(plan.x) + (plan.ax * (plan.cells - 1)) / 2,
		z: gridToWorld(plan.y) + (plan.az * (plan.cells - 1)) / 2,
	};
}

/** Is player `index` within `tiles` of (x, z)? (False for an index outside the party.) */
export function playerNear(state: Readonly<SimState>, index: number, x: number, z: number, tiles: number): boolean {
	if (index < 0 || index >= partySize(state)) return false;
	const p = playerAt(state, index);
	const dx = p.x - x;
	const dz = p.z - z;
	return dx * dx + dz * dz <= tiles * tiles;
}

const QUIET = { reducedMotion: false };

/** See the file comment. */
export class SecretCueTracker implements SecretCueSource {
	private readonly view = new SecretViewTracker();
	knock = false;
	knockNear = false;
	open = false;
	openNear = false;
	jingle = false;
	jingleNear = false;
	chestTier = NO_TREASURE_OPEN;
	private nearOpen = false;
	/** The chest's take (sim seconds) seen live, until its lid's pop; undefined otherwise. */
	private takenAt: number | undefined;
	private takenTier = NO_TREASURE_OPEN;
	private lastAge = -1;

	/** Forget the secret (run start, floor change, run exit). */
	reset(): void {
		this.view.reset();
		this.clearEdges();
		this.nearOpen = false;
		this.takenAt = undefined;
	}

	/** Nothing this frame (no run). */
	clearEdges(): void {
		this.knock = false;
		this.knockNear = false;
		this.open = false;
		this.openNear = false;
		this.jingle = false;
		this.jingleNear = false;
		this.chestTier = NO_TREASURE_OPEN;
	}

	/**
	 * One rendered frame: `state` after the frame's ticks, `plan` the floor's FloorSecret, `events` RunView.secrets,
	 * `simSec` the views' sim clock, `listener` the cue mapper's player (the local one; the watched teammate while
	 * spectating). Returns this (the frame's edges).
	 */
	update(
		state: Readonly<SimState>,
		plan: Readonly<FloorSecret> | undefined,
		events: SecretFrameSource,
		simSec: number,
		listener: number,
	): SecretCueSource {
		this.clearEdges();
		const f = this.view.update(state, plan, events, simSec, QUIET);
		if (plan === undefined || f.look.phase === SecretPhase.NONE) {
			this.takenAt = undefined;
			return this;
		}
		const near = SECRET_VIEW.audio.nearTiles;
		const c = secretCrackCentre(plan);
		const listenerNear = playerNear(state, listener, c.x, c.z, near);
		for (const k of f.puffs) {
			this.knock = true;
			if (k.player === listener || listenerNear) this.knockNear = true;
		}
		const o = f.openEdge;
		if (o !== undefined) {
			this.open = true;
			this.nearOpen = o.player === listener || o.finder === listener || listenerNear;
			this.openNear = this.nearOpen;
		}
		if (f.revealEdge) {
			this.jingle = true;
			this.jingleNear = this.nearOpen;
		}
		const t = f.takenEdge;
		if (t !== undefined) {
			this.takenAt = t.tick / SIM_HZ;
			this.takenTier = t.tier;
			this.lastAge = -1;
		}
		const at = this.takenAt;
		if (at !== undefined) {
			const age = math.max(0, simSec - at);
			if (popCrossed(this.lastAge, age)) {
				this.chestTier = this.takenTier;
				this.takenAt = undefined;
			}
			this.lastAge = age;
		}
		return this;
	}
}
