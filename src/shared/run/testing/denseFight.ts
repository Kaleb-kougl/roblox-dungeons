/**
 * Test support for specs (never imported by the game): a fight on a chosen endless floor, as run/replay.bench.spec.ts
 * sets it up (docs/SERVER.md "Replay capacity") and the rollback spike's state copy spec reuses (docs/ROLLBACK_SPIKE.md
 * R1). Test-only shortcuts: debug-skip to the floor with every draft dismissed, then the party teleported onto a
 * room's first spawn so its enemies aggro.
 */
import {
	AXIS_MAX,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	NO_KIND,
	archetypeAt,
	archetypeIndex,
	partySize,
	playerAt,
	step,
	stepParty,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import type { EndlessRunSetup } from "../endless";
import { dismissDraft } from "./endlessBot";

/** One tick: step for a single frame (solo), stepParty otherwise. */
export function tickAll(s: SimState, config: Readonly<SimConfig>, frames: InputFrame[]): void {
	if (frames.size() === 1) step(s, frames[0], config);
	else stepParty(s, frames, config);
}

/** `n` copies of `f`. */
export function sameFrames(n: number, f: InputFrame): InputFrame[] {
	const out: InputFrame[] = [];
	for (let i = 0; i < n; i++) out.push({ ...f });
	return out;
}

/** Debug-skips a solo or party state to `floor` (press, release), dismissing every draft. */
export function skipPartyToFloor(s: SimState, config: Readonly<SimConfig>, floor: number): void {
	const n = partySize(s);
	while (s.endless!.floor < floor) {
		tickAll(s, config, sameFrames(n, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON }));
		dismissDraft(s);
		tickAll(s, config, sameFrames(n, EMPTY_INPUT));
	}
}

/** The floor's room with the most deferred spawns. */
export function busiestRoom(setup: EndlessRunSetup, floor: number): number {
	const w = setup.endlessFloor(floor);
	let best = -1;
	for (let id = 0; id < w.roomSpawns.size(); id++) {
		if (best < 0 || w.roomSpawns[id].size() > w.roomSpawns[best].size()) best = id;
	}
	return best;
}

/** The floor's room whose deferred spawns hold a boss (archetype data.boss), or -1. */
export function bossRoomOf(setup: EndlessRunSetup, floor: number): number {
	const w = setup.endlessFloor(floor);
	for (let id = 0; id < w.roomSpawns.size(); id++) {
		for (const sp of w.roomSpawns[id]) if (archetypeAt(archetypeIndex(sp.kind)).data.boss === true) return id;
	}
	return -1;
}

/** Teleports every player to (x, z) (prev position too, so nothing interpolates across the jump). */
export function placeParty(s: SimState, x: number, z: number): void {
	const n = partySize(s);
	for (let i = 0; i < n; i++) {
		const p = playerAt(s, i);
		p.x = x;
		p.z = z;
		p.prevX = x;
		p.prevZ = z;
	}
}

/** Every player's hearts back to max (test-only: nobody dies during a measured fight). */
export function topUpHearts(s: SimState): void {
	const n = partySize(s);
	for (let i = 0; i < n; i++) {
		const p = playerAt(s, i);
		p.hearts = p.heartsMax;
	}
}

/** Player i's frame: strafe, aim at the nearest enemy, roll now and then (no attacks: the room stays full). */
export function denseFighterFrame(s: SimState, i: number): InputFrame {
	const p = playerAt(s, i);
	let best = math.huge;
	let ax = 0;
	let az = 0;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const dx = a.x - p.x;
		const dz = a.z - p.z;
		const d2 = dx * dx + dz * dz;
		if (d2 < best) {
			best = d2;
			ax = dx;
			az = dz;
		}
	}
	const len = math.sqrt(ax * ax + az * az);
	const t = s.tick + i * 17;
	return {
		moveX: math.floor(t / 30) % 2 === 0 ? 400 : -400,
		moveZ: 0,
		aimX: len > 0 ? math.round((ax / len) * AXIS_MAX) : AXIS_MAX,
		aimZ: len > 0 ? math.round((az / len) * AXIS_MAX) : 0,
		buttons: t % 90 === 0 ? Button.ROLL : 0,
	};
}
