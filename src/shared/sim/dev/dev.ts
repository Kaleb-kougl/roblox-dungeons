/**
 * Developer mode in the sim (docs/DEV_MODE.md; a Roblox-port tool, no web source). Opt-in: only a SimConfig with `dev`
 * creates `SimState.dev`, and only then does the hash grow the appended `dev` group (after `affixes`, LAST). Without it
 * nothing here runs, so every fixture, M1, the tutorial, endless and co-op replay exactly as before.
 *
 * God mode: while `state.dev.invulnerable` is 1, damagePlayer (player.ts) lands no hit at all: no armor, hearts,
 * events.playerHits, post-hit invulnerability, on-hit hooks or death; the attempt counts in `blockedHits`. A press edge
 * of DEV_GOD_BUTTON on any present player's input toggles it (once per tick, whoever pressed; step.ts / stepParty run
 * stepDevToggle right after the event clears, before a boon draft can freeze the tick, so it works under a draft too).
 *
 * Dev runs are never submitted (the client's `dev` world is in shared/run SERVER_REFUSED_WORLDS); this state exists so
 * the toggle is replayable (F8's replay check) like every other input.
 *
 * @module
 */
import type { InputFrame } from "../input";
import type { SimState } from "../state";
import { DEV_GOD_BUTTON } from "./devData";

/** SimConfig.dev. */
export interface DevSimConfig {
	/** God mode at run start (the dev panel's toggle; DEV_GOD_BUTTON flips it mid-run). */
	readonly invulnerable: boolean;
}

/** SimState.dev: plain numbers, every field hashed (writeDevHash). */
export interface DevState {
	/** 1 while hits are blocked (god mode). */
	invulnerable: number;
	/** Hits god mode blocked this run (damagePlayer calls that would have landed). */
	blockedHits: number;
	/** DEV_GOD_BUTTON toggles this run. */
	toggles: number;
}

export function createDevState(config: Readonly<DevSimConfig>): DevState {
	return { invulnerable: config.invulnerable ? 1 : 0, blockedHits: 0, toggles: 0 };
}

export function cloneDevState(d: Readonly<DevState>): DevState {
	return { ...d };
}

/**
 * God mode check for damagePlayer: true (and blockedHits += 1) when the run is a dev run with invulnerability on, so
 * the hit must not land. False otherwise (no dev state: always).
 */
export function devBlocksHit(state: SimState): boolean {
	const d = state.dev;
	if (d === undefined || d.invulnerable === 0) return false;
	d.blockedHits += 1;
	return true;
}

/**
 * A DEV_GOD_BUTTON press edge on any of `inputs` (player index order; `prevButtons[i]` = that player's buttons of the
 * previous tick) toggles invulnerability, once per tick. Nothing without dev state.
 */
export function stepDevToggle(
	state: SimState,
	inputs: ReadonlyArray<Readonly<InputFrame>>,
	prevButtons: ReadonlyArray<number>,
): void {
	const d = state.dev;
	if (d === undefined) return;
	for (let i = 0; i < inputs.size(); i++) {
		const now = bit32.band(inputs[i].buttons, DEV_GOD_BUTTON) !== 0;
		const before = bit32.band(prevButtons[i] ?? 0, DEV_GOD_BUTTON) !== 0;
		if (now && !before) {
			d.invulnerable = d.invulnerable !== 0 ? 0 : 1;
			d.toggles += 1;
			return;
		}
	}
}

/** writeDevHash order (dump names `dev.<name>`). Append only. */
export const DEV_HASH_FIELDS = ["invulnerable", "blockedHits", "toggles"] as const;

export function writeDevHash(d: Readonly<DevState>, out: number[]): void {
	for (const f of DEV_HASH_FIELDS) out.push(d[f]);
}

/** Dump names for writeDevHash (`dev.<field>`, DEV_HASH_FIELDS order). */
export function devHashNames(out: string[]): void {
	for (const f of DEV_HASH_FIELDS) out.push(`dev.${f}`);
}
